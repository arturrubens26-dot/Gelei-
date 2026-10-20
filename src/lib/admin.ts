import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  PADRAO_MES,
  PRIMEIRO_MES,
  ROTULO_CATEGORIA,
  hojeNaLoja,
  somarMeses,
  type CategoriaDespesa,
} from "@/lib/despesas";
import { codigoPedido } from "@/lib/formatacao";
import { STATUS_PAGOS, transicoesPermitidas, type StatusPedido } from "@/lib/status";
import { nomeDoCliente, type CanalPedido, type FormaPagamento } from "@/lib/vendas";

export type PedidoAdminDTO = {
  id: string;
  /** Online: nome e e-mail do cadastro. Presencial: "Venda presencial · nome digitado" e e-mail nulo. */
  cliente: { nome: string; email: string | null };
  canal: CanalPedido;
  formaPagamento: FormaPagamento | null;
  createdAt: string;
  /** Venda presencial: quando foi lançada no painel (pode ser depois da data da venda). */
  lancadoEm: string | null;
  total: number;
  deliveryFee: number;
  status: StatusPedido;
  qtdItens: number;
};

const POR_PAGINA = 50;

export async function listarPedidosAdmin(opcoes: { status?: StatusPedido; canal?: CanalPedido; pagina?: number }) {
  const pagina = Math.max(1, opcoes.pagina ?? 1);
  const where: Prisma.OrderWhereInput = {
    ...(opcoes.status ? { status: opcoes.status } : {}),
    ...(opcoes.canal ? { canal: opcoes.canal } : {}),
  };

  const [pedidos, total] = await Promise.all([
    db.order.findMany({
      where,
      // `id` desempata pedidos criados no mesmo instante: a paginação não repete nem pula linhas.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      include: { user: { select: { nome: true, email: true } }, _count: { select: { items: true } } },
    }),
    db.order.count({ where }),
  ]);

  const dados: PedidoAdminDTO[] = pedidos.map((p) => ({
    id: p.id,
    cliente: { nome: nomeDoCliente(p), email: p.user?.email ?? null },
    canal: p.canal,
    formaPagamento: p.formaPagamento,
    createdAt: p.createdAt.toISOString(),
    lancadoEm: p.lancadoEm?.toISOString() ?? null,
    total: p.total.toNumber(),
    deliveryFee: p.deliveryFee.toNumber(),
    status: p.status,
    qtdItens: p._count.items,
  }));

  return { pedidos: dados, total, pagina, porPagina: POR_PAGINA };
}

/** Muda o status respeitando as transições do canal; atômico contra cliques simultâneos. */
export async function alterarStatusPedido(
  id: string,
  novo: StatusPedido,
): Promise<{ ok: true } | { ok: false; motivo: "nao-encontrado" | "transicao-invalida" | "conflito"; atual?: StatusPedido }> {
  const pedido = await db.order.findUnique({ where: { id }, select: { status: true, canal: true } });
  if (!pedido) return { ok: false, motivo: "nao-encontrado" };
  if (!transicoesPermitidas(pedido.status, pedido.canal).includes(novo)) {
    return { ok: false, motivo: "transicao-invalida", atual: pedido.status };
  }
  // O `where` com o status lido garante que ninguém mudou o pedido no meio do caminho.
  const { count } = await db.order.updateMany({
    where: { id, status: pedido.status },
    data: { status: novo },
  });
  if (count !== 1) {
    // Alguém mudou o pedido entre a leitura e a escrita (outra aba, outro admin): não é a transição
    // que é inválida, é o pedido que mudou. Relê para a mensagem dizer o status de agora.
    const atual = await db.order.findUnique({ where: { id }, select: { status: true } });
    return { ok: false, motivo: "conflito", atual: atual?.status ?? pedido.status };
  }
  return { ok: true };
}

/** Números rápidos da tela inicial do painel (uma consulta agrupada por status). */
export async function resumoDashboard() {
  const [porStatus, recentes] = await Promise.all([
    db.order.groupBy({ by: ["status"], _count: { _all: true }, _sum: { total: true } }),
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: { select: { nome: true } } },
    }),
  ]);

  const contagem = (s: StatusPedido) => porStatus.find((l) => l.status === s)?._count._all ?? 0;
  const pagos = porStatus.filter((l) => (STATUS_PAGOS as readonly string[]).includes(l.status));
  // Decimal (não float) para somar dinheiro sem erro de arredondamento.
  const faturamentoDecimal = pagos.reduce((soma, l) => soma.add(l._sum.total ?? 0), new Prisma.Decimal(0));
  const faturamentoBruto = faturamentoDecimal.toNumber();
  const pedidosPagos = pagos.reduce((soma, l) => soma + l._count._all, 0);

  return {
    pendentes: contagem("PENDENTE"),
    aEnviar: contagem("PAGO"),
    faturamentoBruto,
    pedidosPagos,
    ticketMedio: pedidosPagos > 0 ? faturamentoDecimal.div(pedidosPagos).toDecimalPlaces(2).toNumber() : 0,
    recentes: recentes.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      cliente: nomeDoCliente(p),
      status: p.status,
      total: p.total.toNumber(),
    })),
  };
}

/** Uma linha de "Movimentações do mês": venda paga (entrada) ou despesa (saída). */
export type MovimentacaoDTO = {
  tipo: "entrada" | "saida";
  id: string;
  /** Dia no horário de Brasília, "AAAA-MM-DD". */
  dia: string;
  descricao: string;
  /** Entrada: canal (Site / Feira ou balcão). Saída: categoria da despesa. */
  detalhe: string;
  valor: number;
};

/**
 * Financeiro de UM mês (horário de Brasília). Entradas = vendas pagas (Pago, Enviado, Entregue) pela
 * data do pedido; saídas = despesas pela data da compra. Mesma conta do painel de Despesas.
 */
export type FinanceiroDoMes = {
  mes: string;
  /** Mês corrente: a navegação não passa dele. */
  mesAtual: string;
  resumo: { entradas: number; saidas: number; resultado: number; vendas: number; lancamentos: number };
  entradas: {
    /** Pedidos pelo site; `frete` já está dentro do `total`. */
    site: { total: number; pedidos: number; frete: number };
    presencial: { total: number; vendas: number };
    /** Entradas ÷ vendas (site e presencial juntos). */
    ticketMedio: number;
    /** Potes e valor por sabor (sem o frete), do que mais vendeu para o que menos vendeu. */
    porSabor: { productId: string; nome: string; potes: number; valor: number }[];
  };
  saidas: { categoria: CategoriaDespesa; total: number; lancamentos: number }[];
  /** 12 meses terminando no mês escolhido (meses sem movimento vêm com zero). */
  evolucao: { mes: string; receita: number; pedidos: number; despesas: number }[];
  movimentacoes: MovimentacaoDTO[];
  movimentacoesTruncadas: boolean;
};

const FUSO = "America/Sao_Paulo";
const MESES_NO_GRAFICO = 12;
const MAX_MOVIMENTACOES = 100;

// Lista SQL a partir da mesma constante usada no resto do código. São literais fixos
// (nunca vêm do usuário), por isso podem entrar como SQL cru.
const SQL_STATUS_PAGOS = Prisma.raw(STATUS_PAGOS.map((s) => `'${s}'`).join(", "));

/** Meia-noite de Brasília do dia 1º do mês, como instante UTC (quem converte é o Postgres). */
const inicioDoMesSql = (mes: string) => Prisma.sql`((${`${mes}-01`}::timestamp AT TIME ZONE ${FUSO}) AT TIME ZONE 'UTC')`;

/** Mês válido para o Financeiro: "AAAA-MM", de 2020 até o mês corrente. */
export function mesDoFinanceiroValido(mes: string): boolean {
  return PADRAO_MES.test(mes) && mes >= PRIMEIRO_MES && mes <= hojeNaLoja().slice(0, 7);
}

export async function financeiroDoMes(mesPedido?: string): Promise<FinanceiroDoMes> {
  const mesAtual = hojeNaLoja().slice(0, 7);
  const mes = mesPedido ?? mesAtual;
  const proximo = somarMeses(mes, 1);
  const inicioEvolucao = somarMeses(mes, -(MESES_NO_GRAFICO - 1));

  const [limites] = await db.$queryRaw<{ inicio: Date; fim: Date }[]>`
    SELECT ${inicioDoMesSql(mes)} AS inicio, ${inicioDoMesSql(proximo)} AS fim`;
  const vendasDoMes = {
    status: { in: [...STATUS_PAGOS] },
    createdAt: { gte: limites.inicio, lt: limites.fim },
  } satisfies Prisma.OrderWhereInput;
  // `data` é DATE (dia da compra, sem fuso): o mês é [dia 1, dia 1 do mês seguinte).
  const despesasDoMes = {
    data: { gte: new Date(`${mes}-01T00:00:00Z`), lt: new Date(`${proximo}-01T00:00:00Z`) },
  } satisfies Prisma.ExpenseWhereInput;

  const [porCanal, porSabor, somaDespesas, porCategoria, vendasMensais, despesasMensais, pedidos, despesas] = await Promise.all([
    db.order.groupBy({ by: ["canal"], where: vendasDoMes, _sum: { total: true, deliveryFee: true }, _count: { _all: true } }),
    db.$queryRaw<{ productId: string; nome: string; potes: number; valor: unknown }[]>`
      SELECT oi.product_id AS "productId", p.nome, SUM(oi.quantidade)::int AS potes, SUM(oi.preco_unitario * oi.quantidade) AS valor
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.status IN (${SQL_STATUS_PAGOS})
        AND o.created_at >= ${inicioDoMesSql(mes)} AND o.created_at < ${inicioDoMesSql(proximo)}
      GROUP BY oi.product_id, p.nome
      ORDER BY valor DESC, p.nome`,
    db.expense.aggregate({ where: despesasDoMes, _sum: { valorTotal: true }, _count: { _all: true } }),
    db.expense.groupBy({ by: ["categoria"], where: despesasDoMes, _sum: { valorTotal: true }, _count: { _all: true } }),
    // created_at é guardado em UTC; converte para o horário de Brasília antes de agrupar por mês.
    db.$queryRaw<{ mes: string; receita: unknown; pedidos: bigint }[]>`
      SELECT to_char(date_trunc('month', (created_at AT TIME ZONE 'UTC') AT TIME ZONE ${FUSO}), 'YYYY-MM') AS mes,
             SUM(total) AS receita,
             COUNT(*) AS pedidos
      FROM orders
      WHERE status IN (${SQL_STATUS_PAGOS})
        AND created_at >= ${inicioDoMesSql(inicioEvolucao)} AND created_at < ${inicioDoMesSql(proximo)}
      GROUP BY 1`,
    db.$queryRaw<{ mes: string; despesas: unknown }[]>`
      SELECT to_char(date_trunc('month', data), 'YYYY-MM') AS mes, SUM(valor_total) AS despesas
      FROM expenses
      WHERE data >= ${`${inicioEvolucao}-01`}::date AND data < ${`${proximo}-01`}::date
      GROUP BY 1`,
    db.order.findMany({
      where: vendasDoMes,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_MOVIMENTACOES + 1,
      include: { user: { select: { nome: true } } },
    }),
    db.expense.findMany({
      where: despesasDoMes,
      orderBy: [{ data: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: MAX_MOVIMENTACOES + 1,
      select: { id: true, data: true, descricao: true, categoria: true, valorTotal: true, createdAt: true },
    }),
  ]);

  // Decimal (não float) para somar dinheiro sem erro de arredondamento; vira number só na saída.
  const zero = new Prisma.Decimal(0);
  const site = porCanal.find((l) => l.canal === "ONLINE");
  const presencial = porCanal.find((l) => l.canal === "PRESENCIAL");
  const entradas = porCanal.reduce((s, l) => s.add(l._sum.total ?? 0), zero);
  const vendas = porCanal.reduce((s, l) => s + l._count._all, 0);
  const saidas = somaDespesas._sum.valorTotal ?? zero;

  const receitaPorMes = new Map(vendasMensais.map((l) => [l.mes, l]));
  const despesaPorMes = new Map(despesasMensais.map((l) => [l.mes, Number(String(l.despesas))]));

  // Entradas e saídas numa lista só, do dia mais recente para o mais antigo.
  const linhas = [
    ...pedidos.map((p) => ({
      ordem: p.createdAt.getTime(),
      linha: {
        tipo: "entrada" as const,
        id: p.id,
        dia: hojeNaLoja(p.createdAt),
        // O canal já vai em `detalhe`: aqui só o pedido e quem comprou (na feira, o nome é opcional).
        descricao:
          p.canal === "PRESENCIAL"
            ? `Pedido ${codigoPedido(p.id)}${p.clienteNome ? ` · ${p.clienteNome}` : ""}`
            : `Pedido ${codigoPedido(p.id)} · ${p.user?.nome ?? "cliente"}`,
        detalhe: p.canal === "PRESENCIAL" ? "Feira ou balcão" : "Site",
        valor: p.total.toNumber(),
      },
    })),
    ...despesas.map((d) => ({
      ordem: d.createdAt.getTime(),
      linha: {
        tipo: "saida" as const,
        id: d.id,
        dia: d.data.toISOString().slice(0, 10),
        descricao: d.descricao,
        detalhe: ROTULO_CATEGORIA[d.categoria],
        valor: d.valorTotal.toNumber(),
      },
    })),
  ].sort((a, b) => (a.linha.dia === b.linha.dia ? b.ordem - a.ordem : a.linha.dia < b.linha.dia ? 1 : -1));

  return {
    mes,
    mesAtual,
    resumo: {
      entradas: entradas.toNumber(),
      saidas: saidas.toNumber(),
      resultado: entradas.sub(saidas).toNumber(),
      vendas,
      lancamentos: somaDespesas._count._all,
    },
    entradas: {
      site: {
        total: site?._sum.total?.toNumber() ?? 0,
        pedidos: site?._count._all ?? 0,
        frete: site?._sum.deliveryFee?.toNumber() ?? 0,
      },
      presencial: { total: presencial?._sum.total?.toNumber() ?? 0, vendas: presencial?._count._all ?? 0 },
      ticketMedio: vendas > 0 ? entradas.div(vendas).toDecimalPlaces(2).toNumber() : 0,
      porSabor: porSabor.map((l) => ({ productId: l.productId, nome: l.nome, potes: Number(l.potes), valor: Number(String(l.valor)) })),
    },
    saidas: porCategoria
      .map((c) => ({ categoria: c.categoria, total: c._sum.valorTotal?.toNumber() ?? 0, lancamentos: c._count._all }))
      .sort((a, b) => b.total - a.total),
    evolucao: Array.from({ length: MESES_NO_GRAFICO }, (_, i) => {
      const m = somarMeses(inicioEvolucao, i);
      const linha = receitaPorMes.get(m);
      return {
        mes: m,
        receita: linha ? Number(String(linha.receita)) : 0,
        pedidos: linha ? Number(linha.pedidos) : 0,
        despesas: despesaPorMes.get(m) ?? 0,
      };
    }),
    movimentacoes: linhas.slice(0, MAX_MOVIMENTACOES).map((l) => l.linha),
    movimentacoesTruncadas: linhas.length > MAX_MOVIMENTACOES,
  };
}
