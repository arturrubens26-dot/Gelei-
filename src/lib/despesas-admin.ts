import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { liquidoLembrancinhasDoMes } from "@/lib/encomendas-financeiro";
import { FUSO_LOJA, hojeNaLoja, somarMeses, type DespesaDTO, type PlannerMes } from "@/lib/despesas";
import { ErroNegocio } from "@/lib/erros";
import { fotoDaLinha, registrarAuditoria, type ClienteDb } from "@/lib/planilha/auditoria";
import { fimDoMes } from "@/lib/planilha/regras";
import { incluirDespesa, linhaDeDespesa, totaisDoPeriodo } from "@/lib/planilha/livro";
import { categoriaDoGrupo } from "@/lib/planilha/tipos";
import { SIGLA_INSUMO, arredondarQtd, fatorConversao } from "@/lib/producao";
import { STATUS_PAGOS } from "@/lib/status";
import type { DespesaEntrada } from "@/lib/validacao";

/** Teto de linhas por mês na lista (os totais e as categorias contam todas). */
const MAX_LISTA_MES = 500;

/** Junto da despesa vem o insumo (compra que entrou no estoque da Produção). */
const comInsumo = {
  insumo: { select: { id: true, nome: true, unidade: true } },
  categoriaFin: { select: { foraDoResultado: true } },
} satisfies Prisma.ExpenseInclude;
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
    categoriaId: d.categoriaId,
    foraDoResultado: d.categoriaFin?.foraDoResultado ?? false,
    versao: d.versao,
  };
}

/** Dia "AAAA-MM-DD" → Date à meia-noite UTC (o que a coluna DATE espera). */
const diaParaDate = (dia: string) => new Date(`${dia}T00:00:00Z`);

/**
 * Compra de insumo: confere o insumo e calcula quanto entra no estoque na unidade dele
 * (kg → g e L → mL sozinho; pacote/caixa só se a pessoa informar quanto veio).
 * Usado também pela planilha (alterar a quantidade de uma compra ligada recalcula o estoque).
 */
export async function vinculoComEstoque(
  e: Pick<DespesaEntrada, "insumoId" | "unidade" | "quantidade" | "quantidadeBase">,
  cliente: ClienteDb = db,
): Promise<{ insumoId: string | null; quantidadeBase: Prisma.Decimal | null }> {
  if (!e.insumoId) return { insumoId: null, quantidadeBase: null };
  const insumo = await cliente.insumo.findUnique({ where: { id: e.insumoId }, select: { nome: true, unidade: true } });
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

async function paraBanco(e: DespesaEntrada, cliente: ClienteDb) {
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
    ...(await vinculoComEstoque(e, cliente)),
  };
}

/** Lança a despesa (tela de Despesas) na categoria semeada do grupo, com o histórico na mesma transação. */
export async function criarDespesa(entrada: DespesaEntrada, criadoPorId: string): Promise<DespesaDTO> {
  return db.$transaction(async (tx) => {
    const criada = await tx.expense.create({
      data: { ...(await paraBanco(entrada, tx)), categoriaId: categoriaDoGrupo(entrada.categoria), criadoPorId },
      include: incluirDespesa,
    });
    await registrarAuditoria(tx, { entidade: "despesa", entidadeId: criada.id, acao: "CRIOU", depois: fotoDaLinha(linhaDeDespesa(criada)), adminId: criadoPorId });
    return paraDTO(criada);
  });
}

/**
 * Substitui os campos da despesa (tela de Despesas) e devolve a linha gravada. `null` se ela não existe (ou
 * foi excluída no meio do caminho). Com `entrada.versao`, responde 409 se outro admin alterou antes; sem ela
 * (tela antiga), vale a última gravação, mas a troca fica registrada no histórico com quem fez.
 * A categoria da planilha continua a mesma se o grupo não mudou ("Gás" continua "Gás" dentro de Outros);
 * se mudou, passa para a categoria semeada do grupo novo.
 */
export async function atualizarDespesa(id: string, entrada: DespesaEntrada, adminId: string): Promise<DespesaDTO | null> {
  return db.$transaction(async (tx) => {
    const atual = await tx.expense.findUnique({ where: { id }, include: incluirDespesa });
    if (!atual) return null;
    if (entrada.versao !== undefined && entrada.versao !== atual.versao) {
      throw new ErroNegocio(409, "Outra pessoa alterou esta despesa. Atualize a página para ver a versão atual.", { atual: paraDTO(atual) }, "versao");
    }
    const categoriaId = atual.categoriaFin && atual.categoriaFin.grupo === entrada.categoria ? atual.categoriaFin.id : categoriaDoGrupo(entrada.categoria);
    const { count } = await tx.expense.updateMany({
      where: { id, versao: atual.versao },
      data: { ...(await paraBanco(entrada, tx)), categoriaId, versao: { increment: 1 }, atualizadoEm: new Date(), atualizadoPorId: adminId },
    });
    if (count === 0) throw new ErroNegocio(409, "Outra pessoa alterou esta despesa agora mesmo. Atualize a página.", undefined, "versao");
    const gravada = await tx.expense.findUniqueOrThrow({ where: { id }, include: incluirDespesa });
    await registrarAuditoria(tx, {
      entidade: "despesa",
      entidadeId: id,
      acao: "ALTEROU",
      antes: fotoDaLinha(linhaDeDespesa(atual)),
      depois: fotoDaLinha(linhaDeDespesa(gravada)),
      adminId,
    });
    return paraDTO(gravada);
  });
}

/** Exclui (tela de Despesas), guardando no histórico como ela era. */
export async function excluirDespesa(id: string, adminId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const atual = await tx.expense.findUnique({ where: { id }, include: incluirDespesa });
    if (!atual) return false;
    const { count } = await tx.expense.deleteMany({ where: { id } });
    if (count !== 1) return false;
    await registrarAuditoria(tx, { entidade: "despesa", entidadeId: id, acao: "EXCLUIU", antes: fotoDaLinha(linhaDeDespesa(atual)), adminId });
    return true;
  });
}

/**
 * O mês no painel de despesas: lançamentos, total por categoria, vendas pagas do mês e saldo.
 * Sem `mes`, usa o mês corrente no horário de Brasília. Entradas, despesas e saldo saem do livro-caixa da
 * planilha (src/lib/planilha/livro.ts): os mesmos números do Financeiro e da planilha.
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
  // Retirada da dona (pró-labore) e outras saídas "fora do resultado": aparecem na lista, mas não no total.
  const noResultado = { OR: [{ categoriaId: null }, { categoriaFin: { foraDoResultado: false } }] } satisfies Prisma.ExpenseWhereInput;

  const [lista, contagem, categorias, vendas, lembrancinhas, totais, entradasManuais] = await Promise.all([
    db.expense.findMany({
      where: doMes,
      // Mais recentes primeiro; `id` desempata para a ordem não mudar entre recargas.
      orderBy: [{ data: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: MAX_LISTA_MES + 1,
      include: comInsumo,
    }),
    db.expense.count({ where: doMes }),
    db.expense.groupBy({ by: ["categoria"], where: { AND: [doMes, noResultado] }, _sum: { valorTotal: true }, _count: { _all: true } }),
    db.order.aggregate({ where: vendasDoMes, _count: { _all: true } }),
    // O mesmo líquido dos mimos do Financeiro (parcelas pagas − devoluções feitas no mês).
    liquidoLembrancinhasDoMes(limites.inicio, limites.fim),
    totaisDoPeriodo(`${alvo}-01`, fimDoMes(alvo)),
    db.entradaManual.aggregate({
      where: { data: { gte: diaParaDate(`${alvo}-01`), lt: diaParaDate(`${proximo}-01`) }, categoria: { foraDoResultado: false } },
      _sum: { valor: true },
    }),
  ]);

  return {
    mes: alvo,
    hoje,
    despesas: lista.slice(0, MAX_LISTA_MES).map(paraDTO),
    truncado: lista.length > MAX_LISTA_MES,
    totalDespesas: totais.saidasCentavos / 100,
    lancamentos: contagem,
    entradas: totais.entradasCentavos / 100,
    pedidosPagos: vendas._count._all,
    lembrancinhas,
    entradasManuais: (entradasManuais._sum.valor ?? new Prisma.Decimal(0)).toNumber(),
    saldo: totais.resultadoCentavos / 100,
    porCategoria: categorias
      .map((c) => ({ categoria: c.categoria, total: c._sum.valorTotal?.toNumber() ?? 0, lancamentos: c._count._all }))
      .sort((a, b) => b.total - a.total),
  };
}
