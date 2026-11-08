import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { FUSO_LOJA, hojeNaLoja } from "@/lib/despesas";
import { movimentosMimosSql } from "@/lib/encomendas-financeiro";
import { codigoPedido } from "@/lib/formatacao";
import { listarCategorias } from "@/lib/planilha/categorias-admin";
import { agruparPorDiaEOrigem, somarDias } from "@/lib/planilha/regras";
import {
  CATEGORIAS_SISTEMA,
  CATEGORIA_DA_ORIGEM,
  MAX_DESCRICOES,
  MAX_LINHAS_PERIODO,
  type LancamentosDoPeriodoDTO,
  type LinhaPlanilhaDTO,
  type Origem,
  type TotaisDTO,
} from "@/lib/planilha/tipos";
import { STATUS_PAGOS } from "@/lib/status";

/**
 * O livro-caixa da loja: UMA definição do que entrou e do que saiu, lida pela planilha, pelo Financeiro e
 * pelas Despesas (para os números nunca divergirem). Une, sem copiar nada:
 * - saídas manuais (`expenses`, pela `data`) e entradas manuais (`entradas_manuais`, pela `data`);
 * - pedidos pagos do site e vendas presenciais (Pago, Enviado, Entregue), pelo dia da loja do `created_at`
 *   (decisão D13); o pedido pago e depois cancelado some do mês da venda (D4, igual ao Financeiro);
 * - o dinheiro dos mimos, com a regra de `encomendas-financeiro.ts` (`movimentosMimosSql`): parcelas pagas,
 *   entrada/restante fora do site e devoluções feitas (estas como ENTRADA NEGATIVA, como o Financeiro conta).
 * Somas em centavos inteiros no Postgres (`ROUND(valor * 100)::bigint`): nada de float.
 * Categorias com `fora_do_resultado` (aporte, retirada) mexem no saldo, não no lucro.
 */

// Literais fixos (nunca vêm do usuário): podem entrar como SQL cru.
const SQL_STATUS_PAGOS = Prisma.raw(STATUS_PAGOS.map((s) => `'${s}'`).join(", "));

/** "AAAA-MM-DD" como expressão SQL de data (parâmetro, nunca concatenado). */
export const diaSql = (dia: string) => Prisma.sql`${dia}::date`;

/** Meia-noite da loja do dia (expressão de data) como instante UTC sem fuso, como o resto do projeto. */
const instanteDoDia = (dia: Prisma.Sql) => Prisma.sql`(((${dia})::timestamp AT TIME ZONE ${FUSO_LOJA}) AT TIME ZONE 'UTC')`;

/** Dia da loja de uma coluna de instante (timestamp sem fuso gravado em UTC). */
const diaDaLoja = (coluna: Prisma.Sql) => Prisma.sql`((${coluna} AT TIME ZONE 'UTC') AT TIME ZONE ${FUSO_LOJA})::date`;

/**
 * Os movimentos de [de, ate] (dias da loja, `ate` INCLUSIVE), uma linha por movimento. `de` e `ate` são
 * expressões SQL de data (por exemplo `diaSql("2026-11-01")` ou uma subconsulta). Colunas: `origem`, `tipo`
 * ('ENTRADA' | 'SAIDA'), `dia` (date), `centavos` (bigint com sinal: só a devolução de mimos é negativa),
 * `categoria_id`, `fora` (fora do resultado), `ref_id` (id da linha de origem), `alvo_id` (pedido ou
 * encomenda; a própria linha nas manuais) e `instante` (para ordenar).
 */
export function movimentosSql(de: Prisma.Sql, ate: Prisma.Sql, partes: { manuais?: boolean; automaticas?: boolean } = {}): Prisma.Sql {
  const { manuais = true, automaticas = true } = partes;
  const inicio = instanteDoDia(de);
  const fim = instanteDoDia(Prisma.sql`(${ate})::date + 1`);
  const blocos: Prisma.Sql[] = [];
  if (manuais) {
    blocos.push(Prisma.sql`
      SELECT 'manual-saida' AS origem, 'SAIDA' AS tipo, e.data AS dia, ROUND(e.valor_total * 100)::bigint AS centavos,
             cat.id AS categoria_id, COALESCE(c.fora_do_resultado, false) AS fora,
             e.id AS ref_id, e.id AS alvo_id, e.created_at AS instante
      FROM expenses e
      CROSS JOIN LATERAL (SELECT COALESCE(e.categoria_id, 'saida-' || lower(e.categoria::text)) AS id) cat
      LEFT JOIN categorias_financeiras c ON c.id = cat.id
      WHERE e.data >= (${de})::date AND e.data <= (${ate})::date`);
    blocos.push(Prisma.sql`
      SELECT 'manual-entrada' AS origem, 'ENTRADA' AS tipo, m.data AS dia, ROUND(m.valor * 100)::bigint AS centavos,
             m.categoria_id AS categoria_id, c.fora_do_resultado AS fora, m.id AS ref_id, m.id AS alvo_id, m.criado_em AS instante
      FROM entradas_manuais m
      JOIN categorias_financeiras c ON c.id = m.categoria_id
      WHERE m.data >= (${de})::date AND m.data <= (${ate})::date`);
  }
  if (automaticas) {
    blocos.push(Prisma.sql`
      SELECT CASE o.canal WHEN 'ONLINE' THEN 'site' ELSE 'presencial' END AS origem, 'ENTRADA' AS tipo,
             ${diaDaLoja(Prisma.raw("o.created_at"))} AS dia, ROUND(o.total * 100)::bigint AS centavos,
             CASE o.canal WHEN 'ONLINE' THEN ${CATEGORIAS_SISTEMA.site.id}::text ELSE ${CATEGORIAS_SISTEMA.presencial.id}::text END AS categoria_id,
             false AS fora, o.id AS ref_id, o.id AS alvo_id, o.created_at AS instante
      FROM orders o
      WHERE o.status IN (${SQL_STATUS_PAGOS}) AND o.created_at >= ${inicio} AND o.created_at < ${fim}`);
    blocos.push(Prisma.sql`
      SELECT mm.origem AS origem, 'ENTRADA' AS tipo, ${diaDaLoja(Prisma.raw("mm.instante"))} AS dia, ROUND(mm.valor * 100)::bigint AS centavos,
             CASE mm.origem WHEN 'mimos-devolucao' THEN ${CATEGORIAS_SISTEMA.devolucoes.id}::text ELSE ${CATEGORIAS_SISTEMA.mimos.id}::text END AS categoria_id,
             false AS fora, mm.ref_id AS ref_id, mm.encomenda_id AS alvo_id, mm.instante AS instante
      FROM (${movimentosMimosSql(inicio, fim)}) mm`);
  }
  return Prisma.join(blocos, " UNION ALL ");
}

type LinhaTotal = { tipo: "ENTRADA" | "SAIDA"; fora: boolean; centavos: bigint | number | null; linhas: number };

/** Soma por tipo e "fora do resultado" → os totais da tela (puro). */
export function montarTotais(linhas: readonly LinhaTotal[]): TotaisDTO {
  const t: TotaisDTO = {
    entradasCentavos: 0,
    saidasCentavos: 0,
    resultadoCentavos: 0,
    foraDoResultado: { entradasCentavos: 0, saidasCentavos: 0 },
    movimentoCentavos: 0,
    linhas: 0,
  };
  for (const l of linhas) {
    const v = Number(l.centavos ?? 0);
    t.linhas += Number(l.linhas);
    if (l.tipo === "ENTRADA") {
      if (l.fora) t.foraDoResultado.entradasCentavos += v;
      else t.entradasCentavos += v;
    } else if (l.fora) t.foraDoResultado.saidasCentavos += v;
    else t.saidasCentavos += v;
  }
  t.resultadoCentavos = t.entradasCentavos - t.saidasCentavos;
  t.movimentoCentavos = t.resultadoCentavos + t.foraDoResultado.entradasCentavos - t.foraDoResultado.saidasCentavos;
  return t;
}

const somaPorTipoSql = (mov: Prisma.Sql) => Prisma.sql`
  SELECT tipo, fora, COALESCE(SUM(centavos), 0)::bigint AS centavos, COUNT(*)::int AS linhas
  FROM (${mov}) m GROUP BY tipo, fora`;

/** Totais de [de, ate] (dias da loja, inclusive). */
export async function totaisDoPeriodo(de: string, ate: string): Promise<TotaisDTO> {
  return montarTotais(await db.$queryRaw<LinhaTotal[]>(somaPorTipoSql(movimentosSql(diaSql(de), diaSql(ate)))));
}

/** Totais por mês ("AAAA-MM") de [de, ate]: o gráfico de 12 meses do Financeiro. */
export async function totaisPorMes(de: string, ate: string): Promise<Map<string, TotaisDTO>> {
  const linhas = await db.$queryRaw<(LinhaTotal & { mes: string })[]>`
    SELECT to_char(dia, 'YYYY-MM') AS mes, tipo, fora, COALESCE(SUM(centavos), 0)::bigint AS centavos, COUNT(*)::int AS linhas
    FROM (${movimentosSql(diaSql(de), diaSql(ate))}) m
    GROUP BY 1, tipo, fora`;
  const porMes = new Map<string, LinhaTotal[]>();
  for (const l of linhas) porMes.set(l.mes, [...(porMes.get(l.mes) ?? []), l]);
  return new Map([...porMes].map(([mes, ls]) => [mes, montarTotais(ls)]));
}

// --- linhas da grade ----------------------------------------------------------------------------------------

const centavosDe = (valor: Prisma.Decimal) => valor.mul(100).toDecimalPlaces(0).toNumber();
const pessoa = (u: { id: string; nome: string } | null) => (u ? { id: u.id, nome: u.nome } : null);
const diaDe = (d: Date) => d.toISOString().slice(0, 10);

/** O que a consulta de uma despesa precisa trazer para virar linha da grade. */
export const incluirDespesa = {
  insumo: { select: { id: true, nome: true, unidade: true } },
  categoriaFin: { select: { id: true, nome: true, foraDoResultado: true, grupo: true } },
  criadoPor: { select: { id: true, nome: true } },
  atualizadoPor: { select: { id: true, nome: true } },
} satisfies Prisma.ExpenseInclude;
export type DespesaDaGrade = Prisma.ExpenseGetPayload<{ include: typeof incluirDespesa }>;

export const incluirEntrada = {
  categoria: { select: { id: true, nome: true, foraDoResultado: true } },
  criadoPor: { select: { id: true, nome: true } },
  atualizadoPor: { select: { id: true, nome: true } },
} satisfies Prisma.EntradaManualInclude;
export type EntradaDaGrade = Prisma.EntradaManualGetPayload<{ include: typeof incluirEntrada }>;

export function linhaDeDespesa(d: DespesaDaGrade): LinhaPlanilhaDTO {
  return {
    id: d.id,
    origem: "manual-saida",
    tipo: "SAIDA",
    editavel: true,
    versao: d.versao,
    data: diaDe(d.data),
    categoriaId: d.categoriaFin?.id ?? `saida-${d.categoria.toLowerCase()}`,
    categoriaNome: d.categoriaFin?.nome ?? d.categoria,
    foraDoResultado: d.categoriaFin?.foraDoResultado ?? false,
    descricao: d.descricao,
    valorCentavos: centavosDe(d.valorTotal),
    formaPagamento: d.formaPagamento,
    observacao: d.observacao,
    quantidade: d.quantidade.toNumber(),
    unidade: d.unidade,
    fornecedor: d.fornecedor,
    insumo: d.insumo,
    quantidadeBase: d.quantidadeBase ? d.quantidadeBase.toNumber() : null,
    criadoPor: pessoa(d.criadoPor),
    criadoEm: d.createdAt.toISOString(),
    atualizadoPor: pessoa(d.atualizadoPor),
    atualizadoEm: d.atualizadoEm?.toISOString() ?? null,
    importacaoId: d.importacaoId,
    link: null,
    codigo: null,
  };
}

export function linhaDeEntrada(m: EntradaDaGrade): LinhaPlanilhaDTO {
  return {
    id: m.id,
    origem: "manual-entrada",
    tipo: "ENTRADA",
    editavel: true,
    versao: m.versao,
    data: diaDe(m.data),
    categoriaId: m.categoria.id,
    categoriaNome: m.categoria.nome,
    foraDoResultado: m.categoria.foraDoResultado,
    descricao: m.descricao,
    valorCentavos: centavosDe(m.valor),
    formaPagamento: m.formaPagamento,
    observacao: m.observacao,
    quantidade: null,
    unidade: null,
    fornecedor: null,
    insumo: null,
    quantidadeBase: null,
    criadoPor: pessoa(m.criadoPor),
    criadoEm: m.criadoEm.toISOString(),
    atualizadoPor: pessoa(m.atualizadoPor),
    atualizadoEm: m.atualizadoEm?.toISOString() ?? null,
    importacaoId: m.importacaoId,
    link: null,
    codigo: null,
  };
}

type LinhaAutomaticaSql = {
  origem: Exclude<Origem, "manual-saida" | "manual-entrada">;
  dia: Date;
  centavos: bigint;
  ref_id: string;
  alvo_id: string;
  instante: Date;
  forma: LinhaPlanilhaDTO["formaPagamento"];
  cliente: string | null;
};

const DESCRICAO_ORIGEM: Record<LinhaAutomaticaSql["origem"], (codigo: string) => string> = {
  site: (c) => `Pedido ${c}`,
  presencial: (c) => `Venda presencial ${c}`,
  "mimos-entrada": (c) => `Mimos ${c} · entrada`,
  "mimos-restante": (c) => `Mimos ${c} · restante`,
  "mimos-devolucao": (c) => `Devolução · mimos ${c}`,
};

/** Linha automática (venda ou mimos): somente leitura, com link e SEM nome de cliente (só com `nomes`). */
function linhaAutomatica(l: LinhaAutomaticaSql, nomes: boolean): LinhaPlanilhaDTO {
  const codigo = codigoPedido(l.alvo_id);
  const categoria = CATEGORIA_DA_ORIGEM[l.origem];
  const pedido = l.origem === "site" || l.origem === "presencial";
  return {
    id: `${l.origem}:${l.ref_id}`,
    origem: l.origem,
    tipo: "ENTRADA",
    editavel: false,
    versao: null,
    data: diaDe(l.dia),
    categoriaId: categoria.id,
    categoriaNome: categoria.nome,
    foraDoResultado: false,
    descricao: DESCRICAO_ORIGEM[l.origem](codigo),
    valorCentavos: Number(l.centavos),
    formaPagamento: l.forma,
    observacao: null,
    quantidade: null,
    unidade: null,
    fornecedor: null,
    insumo: null,
    quantidadeBase: null,
    criadoPor: null,
    criadoEm: null,
    atualizadoPor: null,
    atualizadoEm: null,
    importacaoId: null,
    link: pedido ? `/admin/orders/${l.alvo_id}` : `/admin/encomendas/${l.alvo_id}`,
    codigo,
    ...(nomes ? { cliente: l.cliente } : {}),
  };
}

/** Linhas automáticas de [de, ate], mais recentes primeiro (até MAX_LINHAS_PERIODO + 1, para saber se cortou). */
async function linhasAutomaticas(de: string, ate: string): Promise<LinhaAutomaticaSql[]> {
  return db.$queryRaw<LinhaAutomaticaSql[]>`
    SELECT mov.origem, mov.dia, mov.centavos, mov.ref_id, mov.alvo_id, mov.instante,
           o.forma_pagamento AS forma,
           COALESCE(u.nome, o.cliente_nome, ue.nome) AS cliente
    FROM (${movimentosSql(diaSql(de), diaSql(ate), { manuais: false })}) mov
    LEFT JOIN orders o ON mov.origem IN ('site', 'presencial') AND o.id = mov.alvo_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN encomendas en ON mov.origem LIKE 'mimos-%' AND en.id = mov.alvo_id
    LEFT JOIN users ue ON ue.id = en.user_id
    ORDER BY mov.dia DESC, mov.instante DESC, mov.ref_id DESC
    LIMIT ${MAX_LINHAS_PERIODO + 1}`;
}

/** Descrições usadas nos últimos 12 meses (as mais frequentes primeiro): o autocompletar da grade. */
async function descricoesRecentes(hoje: string): Promise<string[]> {
  const desde = somarDias(hoje, -365);
  const linhas = await db.$queryRaw<{ descricao: string }[]>`
    SELECT descricao FROM (
      SELECT descricao FROM expenses WHERE data >= ${desde}::date
      UNION ALL
      SELECT descricao FROM entradas_manuais WHERE data >= ${desde}::date
    ) d
    GROUP BY descricao
    ORDER BY COUNT(*) DESC, descricao
    LIMIT ${MAX_DESCRICOES}`;
  return linhas.map((l) => l.descricao);
}

/** Ordem da grade: dia mais recente primeiro; no mesmo dia, o lançado/pago por último primeiro. */
const chaveDeOrdem = (l: LinhaPlanilhaDTO, instante: number) => ({ l, instante });

/**
 * A carga da grade: lançamentos manuais e linhas automáticas de [de, ate], totais do período, saldo no fim,
 * categorias e o autocompletar. Uma ida ao banco por consulta, todas em paralelo.
 */
export async function lancamentosDoPeriodo(de: string, ate: string, opcoes: { nomes?: boolean } = {}): Promise<LancamentosDoPeriodoDTO> {
  const hoje = hojeNaLoja();
  const doPeriodo = { data: { gte: new Date(`${de}T00:00:00Z`), lte: new Date(`${ate}T00:00:00Z`) } };
  const ordem = [{ data: "desc" as const }, { id: "desc" as const }];
  const subSaldo = Prisma.sql`(SELECT saldo_inicial_em FROM config_financeiro WHERE id = 1)`;

  const [despesas, entradas, automaticas, totais, config, movimentoAteOFim, categorias, descricoes] = await Promise.all([
    db.expense.findMany({ where: doPeriodo, orderBy: ordem, take: MAX_LINHAS_PERIODO + 1, include: incluirDespesa }),
    db.entradaManual.findMany({ where: doPeriodo, orderBy: ordem, take: MAX_LINHAS_PERIODO + 1, include: incluirEntrada }),
    linhasAutomaticas(de, ate),
    totaisDoPeriodo(de, ate),
    db.configFinanceiro.findUnique({ where: { id: 1 } }),
    // Saldo no fim = saldo inicial + tudo o que entrou e saiu do dia do saldo inicial até `ate`.
    db.$queryRaw<LinhaTotal[]>(somaPorTipoSql(movimentosSql(subSaldo, diaSql(ate)))),
    listarCategorias(),
    descricoesRecentes(hoje),
  ]);

  const manuais = [
    ...despesas.map((d) => chaveDeOrdem(linhaDeDespesa(d), d.createdAt.getTime())),
    ...entradas.map((m) => chaveDeOrdem(linhaDeEntrada(m), m.criadoEm.getTime())),
  ];
  const auto = automaticas.map((a) => chaveDeOrdem(linhaAutomatica(a, opcoes.nomes === true), a.instante.getTime()));
  const todas = [...manuais, ...auto].sort((a, b) =>
    a.l.data === b.l.data ? b.instante - a.instante || (a.l.id < b.l.id ? 1 : -1) : a.l.data < b.l.data ? 1 : -1,
  );
  const truncado = despesas.length > MAX_LINHAS_PERIODO || entradas.length > MAX_LINHAS_PERIODO || automaticas.length > MAX_LINHAS_PERIODO || todas.length > MAX_LINHAS_PERIODO;

  const inicialEm = config?.saldoInicialEm ? diaDe(config.saldoInicialEm) : null;
  const inicialCentavos = config ? centavosDe(config.saldoInicial) : 0;
  const noFimCentavos = inicialEm && ate >= inicialEm ? inicialCentavos + montarTotais(movimentoAteOFim).movimentoCentavos : null;

  return {
    de,
    ate,
    hoje,
    linhas: todas.slice(0, MAX_LINHAS_PERIODO).map((x) => x.l),
    truncado,
    totais,
    automaticasPorDia: agruparPorDiaEOrigem(auto.map((x) => x.l)),
    saldo: { inicialCentavos, inicialEm, noFimCentavos },
    categorias,
    descricoes,
  };
}

/**
 * Vendas do sistema (site e presencial) de [de, ate] com algum dos valores dados: base do aviso "parece venda
 * presencial" antes de lançar uma entrada manual (a venda da feira contada duas vezes). Quem chama casa o dia.
 */
export async function vendasComValores(
  cliente: Prisma.TransactionClient | typeof db,
  de: string,
  ate: string,
  valoresCentavos: readonly number[],
): Promise<LinhaPlanilhaDTO[]> {
  if (valoresCentavos.length === 0) return [];
  const linhas = await cliente.$queryRaw<LinhaAutomaticaSql[]>`
    SELECT mov.origem, mov.dia, mov.centavos, mov.ref_id, mov.alvo_id, mov.instante, o.forma_pagamento AS forma, NULL::text AS cliente
    FROM (${movimentosSql(diaSql(de), diaSql(ate), { manuais: false })}) mov
    JOIN orders o ON o.id = mov.alvo_id
    WHERE mov.origem IN ('site', 'presencial') AND mov.centavos IN (${Prisma.join(valoresCentavos.map((v) => Prisma.sql`${v}::bigint`))})
    ORDER BY mov.instante DESC
    LIMIT 500`;
  return linhas.map((l) => linhaAutomatica(l, false));
}
