import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
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

export type EstatisticasFinanceiras = {
  /** Soma dos pedidos pagos (PAGO + ENVIADO + ENTREGUE), com frete incluído. */
  faturamentoBruto: number;
  /** Soma do frete (delivery_fee) dos pedidos pagos. */
  custoDelivery: number;
  /** faturamentoBruto / pedidosPagos. */
  ticketMedio: number;
  pedidosPagos: number;
  /** Soma de todas as despesas lançadas em /admin/expenses. */
  despesasTotal: number;
  /** faturamentoBruto − despesasTotal. */
  resultado: number;
  /** Parte do faturamento que veio de vendas presenciais (feira, balcão): já somada em faturamentoBruto. */
  vendasPresenciais: { total: number; quantidade: number };
  /**
   * Últimos 12 meses (meses sem movimento vêm com zero). `mes` = "AAAA-MM". Vendas pela data do
   * pedido (horário de Brasília); despesas pela data da compra.
   */
  receitaMensal: { mes: string; receita: number; pedidos: number; despesas: number }[];
  transacoesRecentes: {
    id: string;
    createdAt: string;
    cliente: string;
    status: StatusPedido;
    total: number;
    deliveryFee: number;
  }[];
};

const FUSO = "America/Sao_Paulo";
const MESES_NO_GRAFICO = 12;

// Lista SQL a partir da mesma constante usada no resto do código. São literais fixos
// (nunca vêm do usuário), por isso podem entrar como SQL cru.
const SQL_STATUS_PAGOS = Prisma.raw(STATUS_PAGOS.map((s) => `'${s}'`).join(", "));

function ultimosMeses(quantidade: number): string[] {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  let ano = Number(partes.find((p) => p.type === "year")!.value);
  let mes = Number(partes.find((p) => p.type === "month")!.value);

  const meses: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    meses.unshift(`${ano}-${String(mes).padStart(2, "0")}`);
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
  }
  return meses;
}

export async function estatisticasFinanceiras(): Promise<EstatisticasFinanceiras> {
  const meses = ultimosMeses(MESES_NO_GRAFICO);
  // Início da janela: meia-noite de Brasília do 1º mês, convertida pelo Postgres (base de fusos),
  // do mesmo jeito que o painel de despesas conta as vendas do mês (despesas-admin.ts).
  const inicioLocal = `${meses[0]}-01`;
  const pagos = { status: { in: [...STATUS_PAGOS] } } satisfies Prisma.OrderWhereInput;

  const [porCanal, mensal, recentes, somaDespesas, despesasMensais] = await Promise.all([
    // Uma leitura só, por canal: o faturamento total e a parte presencial saem do mesmo instante.
    db.order.groupBy({ by: ["canal"], where: pagos, _sum: { total: true, deliveryFee: true }, _count: { _all: true } }),
    // created_at é guardado em UTC; converte para o horário de Brasília antes de agrupar por mês.
    db.$queryRaw<{ mes: string; receita: unknown; pedidos: bigint }[]>`
      SELECT to_char(date_trunc('month', (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
             SUM(total) AS receita,
             COUNT(*) AS pedidos
      FROM orders
      WHERE status IN (${SQL_STATUS_PAGOS})
        AND created_at >= ((${inicioLocal}::timestamp AT TIME ZONE ${FUSO}) AT TIME ZONE 'UTC')
      GROUP BY 1
      ORDER BY 1`,
    db.order.findMany({
      where: pagos,
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { user: { select: { nome: true } } },
    }),
    db.expense.aggregate({ _sum: { valorTotal: true } }),
    // `data` é DATE (dia da compra, sem fuso): agrupa direto pelo mês.
    db.$queryRaw<{ mes: string; despesas: unknown }[]>`
      SELECT to_char(date_trunc('month', data), 'YYYY-MM') AS mes,
             SUM(valor_total) AS despesas
      FROM expenses
      WHERE data >= ${inicioLocal}::date
      GROUP BY 1
      ORDER BY 1`,
  ]);

  // Decimal (não float) para somar dinheiro sem erro de arredondamento.
  const somaTotal = porCanal.reduce((s, l) => s.add(l._sum.total ?? 0), new Prisma.Decimal(0));
  const somaFrete = porCanal.reduce((s, l) => s.add(l._sum.deliveryFee ?? 0), new Prisma.Decimal(0));
  const presencial = porCanal.find((l) => l.canal === "PRESENCIAL");
  const faturamentoBruto = somaTotal.toNumber();
  const pedidosPagos = porCanal.reduce((s, l) => s + l._count._all, 0);
  // Ticket médio a partir dos valores exatos (Decimal), arredondado só no fim.
  const ticketMedio = pedidosPagos > 0 ? somaTotal.div(pedidosPagos).toDecimalPlaces(2).toNumber() : 0;
  const despesasDecimal = somaDespesas._sum.valorTotal ?? new Prisma.Decimal(0);
  const porMes = new Map(mensal.map((l) => [l.mes, l]));
  const despesasPorMes = new Map(despesasMensais.map((l) => [l.mes, Number(String(l.despesas))]));

  return {
    faturamentoBruto,
    custoDelivery: somaFrete.toNumber(),
    ticketMedio,
    pedidosPagos,
    despesasTotal: despesasDecimal.toNumber(),
    resultado: somaTotal.sub(despesasDecimal).toNumber(),
    vendasPresenciais: { total: presencial?._sum.total?.toNumber() ?? 0, quantidade: presencial?._count._all ?? 0 },
    receitaMensal: meses.map((mes) => {
      const linha = porMes.get(mes);
      return {
        mes,
        receita: linha ? Number(String(linha.receita)) : 0,
        pedidos: linha ? Number(linha.pedidos) : 0,
        despesas: despesasPorMes.get(mes) ?? 0,
      };
    }),
    transacoesRecentes: recentes.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      cliente: nomeDoCliente(p),
      status: p.status,
      total: p.total.toNumber(),
      deliveryFee: p.deliveryFee.toNumber(),
    })),
  };
}
