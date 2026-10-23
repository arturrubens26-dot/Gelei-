import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { liquidoLembrancinhasDoMes } from "@/lib/encomendas-financeiro";
import { FUSO_LOJA, hojeNaLoja, somarMeses, type DespesaDTO, type PlannerMes } from "@/lib/despesas";
import { ErroNegocio } from "@/lib/erros";
import { SIGLA_INSUMO, arredondarQtd, fatorConversao } from "@/lib/producao";
import { STATUS_PAGOS } from "@/lib/status";
import type { DespesaEntrada } from "@/lib/validacao";

/** Teto de linhas por mês na lista (os totais e as categorias contam todas). */
const MAX_LISTA_MES = 500;

/** Junto da despesa vem o insumo (compra que entrou no estoque da Produção). */
const comInsumo = { insumo: { select: { id: true, nome: true, unidade: true } } } satisfies Prisma.ExpenseInclude;
type DespesaDoBanco = Prisma.ExpenseGetPayload<{ include: typeof comInsumo }>;

function paraDTO(d: DespesaDoBanco): DespesaDTO {
  return {
    id: d.id,
    descricao: d.descricao,
    categoria: d.categoria,
    quantidade: d.quantidade.toNumber(),
    unidade: d.unidade,
    valorTotal: d.valorTotal.toNumber(),
    // Coluna DATE: o Prisma devolve meia-noite UTC desse dia.
    data: d.data.toISOString().slice(0, 10),
    fornecedor: d.fornecedor,
    observacao: d.observacao,
    insumo: d.insumo,
    quantidadeBase: d.quantidadeBase ? d.quantidadeBase.toNumber() : null,
  };
}

/** Dia "AAAA-MM-DD" → Date à meia-noite UTC (o que a coluna DATE espera). */
const diaParaDate = (dia: string) => new Date(`${dia}T00:00:00Z`);

/**
 * Compra de insumo: confere o insumo e calcula quanto entra no estoque na unidade dele
 * (kg → g e L → mL sozinho; pacote/caixa só se a pessoa informar quanto veio).
 */
async function vinculoComEstoque(e: DespesaEntrada): Promise<{ insumoId: string | null; quantidadeBase: Prisma.Decimal | null }> {
  if (!e.insumoId) return { insumoId: null, quantidadeBase: null };
  const insumo = await db.insumo.findUnique({ where: { id: e.insumoId }, select: { nome: true, unidade: true } });
  if (!insumo) throw new ErroNegocio(400, "Insumo não encontrado.", { insumoId: ["Insumo não encontrado. Atualize a página."] });
  // Com conversão conhecida o servidor calcula sempre: um valor enviado que não bate (2 kg chegando
  // como 5 g) deixaria o custo médio absurdo. Só pacote/caixa usam o "quantos vieram" informado.
  const fator = fatorConversao(e.unidade, insumo.unidade);
  let base: number;
  if (fator !== null) base = arredondarQtd(e.quantidade * fator);
  else if (e.quantidadeBase !== null) base = e.quantidadeBase;
  else {
    const sigla = SIGLA_INSUMO[insumo.unidade];
    throw new ErroNegocio(400, `Informe quantos ${sigla} de ${insumo.nome} vieram nesta compra.`, {
      quantidadeBase: [`Informe quantos ${sigla} entraram no estoque.`],
    });
  }
  return { insumoId: e.insumoId, quantidadeBase: new Prisma.Decimal(String(base)) };
}

async function paraBanco(e: DespesaEntrada) {
  return {
    descricao: e.descricao,
    categoria: e.categoria,
    // Pela string: Decimal(0.1 + 0.2) carregaria o erro do float.
    quantidade: new Prisma.Decimal(String(e.quantidade)),
    unidade: e.unidade,
    valorTotal: new Prisma.Decimal(e.valorCentavos).div(100),
    data: diaParaDate(e.data),
    fornecedor: e.fornecedor,
    observacao: e.observacao,
    ...(await vinculoComEstoque(e)),
  };
}

export async function criarDespesa(entrada: DespesaEntrada, criadoPorId: string): Promise<DespesaDTO> {
  const despesa = await db.expense.create({ data: { ...(await paraBanco(entrada)), criadoPorId }, include: comInsumo });
  return paraDTO(despesa);
}

/**
 * Substitui os campos da despesa e devolve a linha gravada (numa consulta só: sem janela entre gravar
 * e reler). `null` se ela não existe (ou foi excluída no meio do caminho).
 */
export async function atualizarDespesa(id: string, entrada: DespesaEntrada): Promise<DespesaDTO | null> {
  try {
    return paraDTO(await db.expense.update({ where: { id }, data: await paraBanco(entrada), include: comInsumo }));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return null;
    throw e;
  }
}

export async function excluirDespesa(id: string): Promise<boolean> {
  const { count } = await db.expense.deleteMany({ where: { id } });
  return count === 1;
}

/**
 * O mês no painel de despesas: lançamentos, total por categoria, vendas pagas do mês e saldo.
 * Sem `mes`, usa o mês corrente no horário de Brasília.
 */
export async function plannerDoMes(mes?: string): Promise<PlannerMes> {
  const hoje = hojeNaLoja();
  const alvo = mes ?? hoje.slice(0, 7);
  const proximo = somarMeses(alvo, 1);

  // Despesas: a coluna é DATE, então o mês é [dia 1, dia 1 do mês seguinte).
  const doMes = { data: { gte: diaParaDate(`${alvo}-01`), lt: diaParaDate(`${proximo}-01`) } } satisfies Prisma.ExpenseWhereInput;
  // Vendas: created_at é um instante (gravado em UTC). O mês começa à meia-noite de Brasília, e quem
  // converte é o Postgres, com a base de fusos (como o gráfico do Financeiro em admin.ts): as duas
  // telas contam o mesmo mês mesmo se o horário de verão voltar.
  const [limites] = await db.$queryRaw<{ inicio: Date; fim: Date }[]>`
    SELECT ((${`${alvo}-01`}::timestamp AT TIME ZONE ${FUSO_LOJA}) AT TIME ZONE 'UTC') AS inicio,
           ((${`${proximo}-01`}::timestamp AT TIME ZONE ${FUSO_LOJA}) AT TIME ZONE 'UTC') AS fim`;
  const vendasDoMes = {
    status: { in: [...STATUS_PAGOS] },
    createdAt: { gte: limites.inicio, lt: limites.fim },
  } satisfies Prisma.OrderWhereInput;

  const [lista, soma, categorias, vendas, lembrancinhas] = await Promise.all([
    db.expense.findMany({
      where: doMes,
      // Mais recentes primeiro; `id` desempata para a ordem não mudar entre recargas.
      orderBy: [{ data: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: MAX_LISTA_MES + 1,
      include: comInsumo,
    }),
    db.expense.aggregate({ where: doMes, _sum: { valorTotal: true }, _count: { _all: true } }),
    db.expense.groupBy({ by: ["categoria"], where: doMes, _sum: { valorTotal: true }, _count: { _all: true } }),
    db.order.aggregate({ where: vendasDoMes, _sum: { total: true }, _count: { _all: true } }),
    // O mesmo líquido das lembrancinhas do Financeiro (parcelas pagas − devoluções feitas no mês).
    liquidoLembrancinhasDoMes(limites.inicio, limites.fim),
  ]);

  // Saldo com Decimal (sem erro de arredondamento); vira number só na saída.
  const totalDespesas = soma._sum.valorTotal ?? new Prisma.Decimal(0);
  const entradas = (vendas._sum.total ?? new Prisma.Decimal(0)).add(lembrancinhas);

  return {
    mes: alvo,
    hoje,
    despesas: lista.slice(0, MAX_LISTA_MES).map(paraDTO),
    truncado: lista.length > MAX_LISTA_MES,
    totalDespesas: totalDespesas.toNumber(),
    lancamentos: soma._count._all,
    entradas: entradas.toNumber(),
    pedidosPagos: vendas._count._all,
    lembrancinhas,
    saldo: entradas.sub(totalDespesas).toNumber(),
    porCategoria: categorias
      .map((c) => ({ categoria: c.categoria, total: c._sum.valorTotal?.toNumber() ?? 0, lancamentos: c._count._all }))
      .sort((a, b) => b.total - a.total),
  };
}
