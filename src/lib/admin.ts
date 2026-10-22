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
import type { ModoEntrega } from "@/lib/entrega-regras";
import { pagamentoAdminDe, pedidoExpirado, type PagamentoAdminDTO } from "@/lib/pagamentos-regras";
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
  /** Linhas de pote avulso. */
  qtdItens: number;
  /** Linhas de kit (composições diferentes; cada uma pode ter várias caixas). */
  qtdKits: number;
  /** Pedido online: entrega ou retirada. Venda presencial: null. */
  modoEntrega: ModoEntrega | null;
  /** WhatsApp da cliente (só dígitos; linkWhatsApp). Null na venda presencial e nos pedidos antigos. */
  telefone: string | null;
  /** Pedido online PENDENTE com mais de 48 h: não abre mais link de pagamento (selo "Expirado"). */
  expirado: boolean;
  /** Pagamento pelo site (InfinitePay) já confirmado: método, parcelas, valor pago e alerta. Null sem cobrança aprovada. */
  pagamento: PagamentoAdminDTO | null;
};

/** Cobranças aprovadas do pedido, na ordem em que foram pagas (para `pagamentoAdminDe`). */
export const COBRANCAS_APROVADAS = {
  where: { status: "APROVADO" },
  orderBy: [{ aprovadoEm: "asc" }, { id: "asc" }],
  select: { metodo: true, parcelas: true, valorPago: true, aprovadoEm: true },
} satisfies Prisma.Order$pagamentosArgs;

/** `expirado` e `pagamento` do painel a partir do pedido e das cobranças aprovadas. */
export function situacaoDoPagamentoNoPainel(p: {
  canal: CanalPedido;
  status: StatusPedido;
  createdAt: Date;
  canceladoEm: Date | null;
  pagamentos: { metodo: string | null; parcelas: number | null; valorPago: Prisma.Decimal | null; aprovadoEm: Date | null }[];
}): { expirado: boolean; pagamento: PagamentoAdminDTO | null } {
  return {
    expirado: p.canal === "ONLINE" && p.status === "PENDENTE" && pedidoExpirado(p.createdAt),
    pagamento: pagamentoAdminDe({
      pedidoStatus: p.status,
      canceladoEm: p.canceladoEm,
      aprovadas: p.pagamentos.map((c) => ({ ...c, valorPago: c.valorPago?.toNumber() ?? null })),
    }),
  };
}

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
      include: {
        user: { select: { nome: true, email: true } },
        _count: { select: { items: true, kits: true } },
        pagamentos: COBRANCAS_APROVADAS,
      },
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
    qtdKits: p._count.kits,
    modoEntrega: p.modoEntrega,
    telefone: p.telefone,
    ...situacaoDoPagamentoNoPainel(p),
  }));

  return { pedidos: dados, total, pagina, porPagina: POR_PAGINA };
}

/**
 * Muda o status respeitando as transições do canal; atômico contra cliques simultâneos. No
 * cancelamento, guarda quando e quem cancelou (orders.cancelado_em: o painel distingue "pago depois
 * do cancelamento" de "cancelado depois de pago").
 */
export async function alterarStatusPedido(
  id: string,
  novo: StatusPedido,
  adminId?: string,
): Promise<{ ok: true } | { ok: false; motivo: "nao-encontrado" | "transicao-invalida" | "conflito"; atual?: StatusPedido }> {
  const pedido = await db.order.findUnique({ where: { id }, select: { status: true, canal: true } });
  if (!pedido) return { ok: false, motivo: "nao-encontrado" };
  if (!transicoesPermitidas(pedido.status, pedido.canal).includes(novo)) {
    return { ok: false, motivo: "transicao-invalida", atual: pedido.status };
  }
  // O `where` com o status lido garante que ninguém mudou o pedido no meio do caminho.
  const { count } = await db.order.updateMany({
    where: { id, status: pedido.status },
    data: novo === "CANCELADO" ? { status: novo, canceladoEm: new Date(), canceladoPorId: adminId ?? null } : { status: novo },
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
    /**
     * Potes e valor por sabor (sem o frete), do que mais vendeu para o que menos vendeu. `potes` é o
     * total (avulsos + em kits); `potesEmKits` é a parte que saiu dentro de caixas. O valor de um pote
     * em kit é a parte rateada do preço da caixa, então a soma de `valor` = entradas − frete.
     */
    porSabor: { productId: string; nome: string; potes: number; potesEmKits: number; valor: number }[];
    /**
     * Caixas de kit vendidas no mês, o que entrou com elas (já incluído em site/presencial e no por
     * sabor) e o desconto dado: quanto os mesmos potes custariam avulsos, menos o preço da caixa.
     */
    kits: { caixas: number; valor: number; desconto: number };
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

  // Pedidos pagos do mês, para as consultas cruas por sabor e de kits (filtra antes de juntar as linhas).
  const pedidosPagosDoMesSql = Prisma.sql`
    SELECT id FROM orders
    WHERE status IN (${SQL_STATUS_PAGOS})
      AND created_at >= ${inicioDoMesSql(mes)} AND created_at < ${inicioDoMesSql(proximo)}`;

  const [porCanal, porSabor, somaKits, somaDespesas, porCategoria, vendasMensais, despesasMensais, pedidos, despesas] = await Promise.all([
    db.order.groupBy({ by: ["canal"], where: vendasDoMes, _sum: { total: true, deliveryFee: true }, _count: { _all: true } }),
    // Potes avulsos + potes dentro de caixas. O pote em kit vale a parte rateada do preço da caixa
    // (valor_rateado é de TODOS os potes daquele sabor numa caixa; × caixas).
    db.$queryRaw<{ productId: string; nome: string; potes: number; potesEmKits: number; valor: unknown }[]>`
      WITH pagos AS (${pedidosPagosDoMesSql})
      SELECT v.product_id AS "productId", p.nome,
             SUM(v.potes)::int AS potes, SUM(v.em_kits)::int AS "potesEmKits", SUM(v.valor) AS valor
      FROM (
        SELECT oi.product_id, oi.quantidade AS potes, 0 AS em_kits, oi.preco_unitario * oi.quantidade AS valor
        FROM order_items oi
        JOIN pagos ON pagos.id = oi.order_id
        UNION ALL
        SELECT oks.product_id, oks.quantidade * ok.quantidade, oks.quantidade * ok.quantidade, oks.valor_rateado * ok.quantidade
        FROM order_kits ok
        JOIN pagos ON pagos.id = ok.order_id
        JOIN order_kit_sabores oks ON oks.order_kit_id = ok.id
      ) v
      JOIN products p ON p.id = v.product_id
      GROUP BY v.product_id, p.nome
      ORDER BY valor DESC, p.nome`,
    // Desconto de cada caixa = potes avulsos no preço do dia − preço da caixa (nunca negativo: kit
    // mais caro que os avulsos não "deu" desconto).
    db.$queryRaw<{ caixas: number; valor: unknown; desconto: unknown }[]>`
      WITH pagos AS (${pedidosPagosDoMesSql})
      SELECT COALESCE(SUM(ok.quantidade), 0)::int AS caixas,
             COALESCE(SUM(ok.preco_unitario * ok.quantidade), 0) AS valor,
             COALESCE(SUM(GREATEST(av.avulsos - ok.preco_unitario, 0) * ok.quantidade), 0) AS desconto
      FROM order_kits ok
      JOIN pagos ON pagos.id = ok.order_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(oks.preco_avulso * oks.quantidade), 0) AS avulsos
        FROM order_kit_sabores oks
        WHERE oks.order_kit_id = ok.id
      ) av`,
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
      porSabor: porSabor.map((l) => ({
        productId: l.productId,
        nome: l.nome,
        potes: Number(l.potes),
        potesEmKits: Number(l.potesEmKits),
        valor: Number(String(l.valor)),
      })),
      kits: {
        caixas: Number(somaKits[0]?.caixas ?? 0),
        valor: Number(String(somaKits[0]?.valor ?? 0)),
        desconto: Number(String(somaKits[0]?.desconto ?? 0)),
      },
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
