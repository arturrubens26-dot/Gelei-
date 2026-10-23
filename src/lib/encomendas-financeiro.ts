import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { FUSO_LOJA, hojeNaLoja } from "@/lib/despesas";
import { codigoPedido } from "@/lib/formatacao";

/**
 * Dinheiro das encomendas de lembrancinhas no Financeiro e nas Despesas, por CAIXA (decisão 3.8 do
 * plano, coerente com o README):
 * - entra cada parcela paga pelo site na data em que foi aprovada (`pagamentos.aprovado_em`, com o
 *   valor da parcela: os juros do parcelado ficam com a InfinitePay), e a entrada ou o restante
 *   recebidos fora do site na data do registro (`encomendas.entrada_paga_em` / `restante_pago_em`);
 * - a devolução FEITA sai da receita no mês em que foi feita (`encomenda_devolucoes.feita_em`);
 * - os potinhos por sabor contam as encomendas ENTREGUES no mês (`entregue_em`), num bloco à parte.
 * Vendas e ticket médio continuam só com os pedidos.
 */

export type LembrancinhasDoMesDTO = {
  /** Reais. Entradas pagas pelo site no mês. */
  sinais: number;
  /** Restantes pagos pelo site no mês. */
  restantes: number;
  /** Entradas recebidas fora do site (dinheiro, PIX direto) ou dadas como recebidas pela dona, registradas no mês. */
  sinaisForaDoSite: number;
  /** Restantes recebidos fora do site (dinheiro, PIX direto) e registrados no mês. */
  restantesForaDoSite: number;
  /** Devoluções feitas no mês (saem da receita). */
  devolucoes: number;
  /** sinais + sinaisForaDoSite + restantes + restantesForaDoSite − devoluções: o que entra no resumo e no gráfico. */
  liquido: number;
  /** Encomendas com algum dinheiro (entrada ou devolução) no mês. */
  encomendas: number;
  /** Potinhos entregues no mês, por sabor, com o valor dos potinhos (sem o frete). */
  potinhosEntregues: { productId: string; nome: string; potinhos: number; valor: number }[];
};

/** Uma linha das movimentações do Financeiro (mesmo formato de MovimentacaoDTO, em admin.ts). */
export type MovimentacaoLembrancinha = {
  tipo: "entrada" | "devolucao";
  id: string;
  dia: string;
  descricao: string;
  detalhe: string;
  valor: number;
  ordem: number;
};

const SOMA = (v: unknown) => Number(String(v ?? 0));
const MAX_LINHAS = 100;

/** O mês [inicio, fim) já convertido para instantes (como o Financeiro faz com os pedidos). */
export async function lembrancinhasDoMes(inicio: Date, fim: Date): Promise<{ resumo: LembrancinhasDoMesDTO; movimentacoes: MovimentacaoLembrancinha[] }> {
  const pagas = { encomendaId: { not: null }, status: { in: ["APROVADO", "ESTORNADO"] }, aprovadoEm: { gte: inicio, lt: fim } } satisfies Prisma.PagamentoWhereInput;
  const foraDoSite = { restanteForaDoSite: true, restantePagoEm: { gte: inicio, lt: fim } } satisfies Prisma.EncomendaWhereInput;
  const entradaForaDoSite = { entradaForaDoSite: true, entradaPagaEm: { gte: inicio, lt: fim } } satisfies Prisma.EncomendaWhereInput;
  const feitas = { status: "FEITA", feitaEm: { gte: inicio, lt: fim } } satisfies Prisma.EncomendaDevolucaoWhereInput;

  const [porParcela, somaFora, somaSinaisFora, somaDevolucoes, idsPagas, idsFora, idsSinaisFora, idsDevolucoes, potinhos, linhasPagas, linhasFora, linhasSinaisFora, linhasDevolucoes] =
    await Promise.all([
      db.pagamento.groupBy({ by: ["parcela"], where: pagas, _sum: { valor: true } }),
      db.encomenda.aggregate({ where: foraDoSite, _sum: { valorRestante: true } }),
      db.encomenda.aggregate({ where: entradaForaDoSite, _sum: { valorEntrada: true } }),
      db.encomendaDevolucao.aggregate({ where: feitas, _sum: { valor: true } }),
      db.pagamento.findMany({ where: pagas, select: { encomendaId: true }, distinct: ["encomendaId"] }),
      db.encomenda.findMany({ where: foraDoSite, select: { id: true } }),
      db.encomenda.findMany({ where: entradaForaDoSite, select: { id: true } }),
      db.encomendaDevolucao.findMany({ where: feitas, select: { encomendaId: true }, distinct: ["encomendaId"] }),
      db.$queryRaw<{ productId: string; nome: string; potinhos: number; valor: unknown }[]>`
        SELECT ei.product_id AS "productId", p.nome, SUM(ei.quantidade)::int AS potinhos, SUM(ei.preco_unitario * ei.quantidade) AS valor
        FROM encomenda_itens ei
        JOIN encomendas e ON e.id = ei.encomenda_id
        JOIN products p ON p.id = ei.product_id
        WHERE e.status = 'ENTREGUE' AND e.entregue_em >= ${inicio} AND e.entregue_em < ${fim}
        GROUP BY ei.product_id, p.nome
        ORDER BY potinhos DESC, p.nome`,
      db.pagamento.findMany({
        where: pagas,
        orderBy: [{ aprovadoEm: "desc" }, { id: "desc" }],
        take: MAX_LINHAS,
        select: { id: true, parcela: true, valor: true, aprovadoEm: true, encomenda: { select: { id: true, user: { select: { nome: true } } } } },
      }),
      db.encomenda.findMany({
        where: foraDoSite,
        orderBy: [{ restantePagoEm: "desc" }, { id: "desc" }],
        take: MAX_LINHAS,
        select: { id: true, valorRestante: true, restantePagoEm: true, user: { select: { nome: true } } },
      }),
      db.encomenda.findMany({
        where: entradaForaDoSite,
        orderBy: [{ entradaPagaEm: "desc" }, { id: "desc" }],
        take: MAX_LINHAS,
        select: { id: true, valorEntrada: true, entradaPagaEm: true, user: { select: { nome: true } } },
      }),
      db.encomendaDevolucao.findMany({
        where: feitas,
        orderBy: [{ feitaEm: "desc" }, { id: "desc" }],
        take: MAX_LINHAS,
        select: { id: true, valor: true, feitaEm: true, encomenda: { select: { id: true, user: { select: { nome: true } } } } },
      }),
    ]);

  const zero = new Prisma.Decimal(0);
  const sinais = porParcela.find((l) => l.parcela === "ENTRADA")?._sum.valor ?? zero;
  const restantes = porParcela.find((l) => l.parcela === "RESTANTE")?._sum.valor ?? zero;
  const fora = somaFora._sum.valorRestante ?? zero;
  const sinaisFora = somaSinaisFora._sum.valorEntrada ?? zero;
  const devolucoes = somaDevolucoes._sum.valor ?? zero;
  const encomendas = new Set([
    ...idsPagas.map((l) => l.encomendaId),
    ...idsFora.map((l) => l.id),
    ...idsSinaisFora.map((l) => l.id),
    ...idsDevolucoes.map((l) => l.encomendaId),
  ]);

  const movimentacoes: MovimentacaoLembrancinha[] = [
    ...linhasPagas.map((p) => ({
      tipo: "entrada" as const,
      id: p.id,
      dia: hojeNaLoja(p.aprovadoEm!),
      descricao: `Lembrancinhas ${codigoPedido(p.encomenda!.id)} · ${p.parcela === "ENTRADA" ? "entrada" : "restante"} · ${p.encomenda!.user.nome}`,
      detalhe: "Lembrancinhas (site)",
      valor: p.valor.toNumber(),
      ordem: p.aprovadoEm!.getTime(),
    })),
    ...linhasSinaisFora.map((e) => ({
      tipo: "entrada" as const,
      id: `${e.id}-entrada`,
      dia: hojeNaLoja(e.entradaPagaEm!),
      descricao: `Lembrancinhas ${codigoPedido(e.id)} · entrada · ${e.user.nome}`,
      detalhe: "Lembrancinhas (fora do site)",
      valor: e.valorEntrada.toNumber(),
      ordem: e.entradaPagaEm!.getTime(),
    })),
    ...linhasFora.map((e) => ({
      tipo: "entrada" as const,
      id: `${e.id}-restante`,
      dia: hojeNaLoja(e.restantePagoEm!),
      descricao: `Lembrancinhas ${codigoPedido(e.id)} · restante · ${e.user.nome}`,
      detalhe: "Lembrancinhas (fora do site)",
      valor: e.valorRestante.toNumber(),
      ordem: e.restantePagoEm!.getTime(),
    })),
    ...linhasDevolucoes.map((d) => ({
      tipo: "devolucao" as const,
      id: d.id,
      dia: hojeNaLoja(d.feitaEm!),
      descricao: `Devolução · lembrancinhas ${codigoPedido(d.encomenda.id)} · ${d.encomenda.user.nome}`,
      detalhe: "Lembrancinhas",
      valor: d.valor.toNumber(),
      ordem: d.feitaEm!.getTime(),
    })),
  ];

  return {
    resumo: {
      sinais: sinais.toNumber(),
      sinaisForaDoSite: sinaisFora.toNumber(),
      restantes: restantes.toNumber(),
      restantesForaDoSite: fora.toNumber(),
      devolucoes: devolucoes.toNumber(),
      liquido: sinais.add(sinaisFora).add(restantes).add(fora).sub(devolucoes).toNumber(),
      encomendas: encomendas.size,
      potinhosEntregues: potinhos.map((l) => ({ productId: l.productId, nome: l.nome, potinhos: Number(l.potinhos), valor: SOMA(l.valor) })),
    },
    movimentacoes,
  };
}

/** Só o líquido do mês (Despesas). */
export async function liquidoLembrancinhasDoMes(inicio: Date, fim: Date): Promise<number> {
  const porMes = await liquidoLembrancinhasPorMes(inicio, fim);
  return [...porMes.values()].reduce((s, v) => s + v, 0);
}

/** Líquido das lembrancinhas por mês da loja ("AAAA-MM") entre dois instantes (gráfico de evolução). */
export async function liquidoLembrancinhasPorMes(inicio: Date, fim: Date): Promise<Map<string, number>> {
  const mes = (coluna: Prisma.Sql) => Prisma.sql`to_char(date_trunc('month', (${coluna} AT TIME ZONE 'UTC') AT TIME ZONE ${FUSO_LOJA}), 'YYYY-MM')`;
  const linhas = await db.$queryRaw<{ mes: string; liquido: unknown }[]>`
    SELECT mes, SUM(v) AS liquido FROM (
      SELECT ${mes(Prisma.raw("aprovado_em"))} AS mes, valor AS v
      FROM pagamentos
      WHERE encomenda_id IS NOT NULL AND status IN ('APROVADO', 'ESTORNADO') AND aprovado_em >= ${inicio} AND aprovado_em < ${fim}
      UNION ALL
      SELECT ${mes(Prisma.raw("entrada_paga_em"))}, valor_entrada
      FROM encomendas
      WHERE entrada_fora_do_site AND entrada_paga_em >= ${inicio} AND entrada_paga_em < ${fim}
      UNION ALL
      SELECT ${mes(Prisma.raw("restante_pago_em"))}, valor_restante
      FROM encomendas
      WHERE restante_fora_do_site AND restante_pago_em >= ${inicio} AND restante_pago_em < ${fim}
      UNION ALL
      SELECT ${mes(Prisma.raw("feita_em"))}, -valor
      FROM encomenda_devolucoes
      WHERE status = 'FEITA' AND feita_em >= ${inicio} AND feita_em < ${fim}
    ) x
    GROUP BY mes`;
  return new Map(linhas.map((l) => [l.mes, SOMA(l.liquido)]));
}
