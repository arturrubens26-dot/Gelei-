import "server-only";
import type { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { CategoriaDespesa } from "@/lib/despesas";
import { vinculoComEstoque } from "@/lib/despesas-admin";
import { ErroNegocio } from "@/lib/erros";
import { fotoDaLinha, registrarAuditoria } from "@/lib/planilha/auditoria";
import {
  incluirDespesa,
  incluirEntrada,
  linhaDeDespesa,
  linhaDeEntrada,
  vendasComValores,
  type DespesaDaGrade,
  type EntradaDaGrade,
} from "@/lib/planilha/livro";
import { CATEGORIA_PADRAO, type LinhaPlanilhaDTO, type ResultadoOperacao, type TipoLancamento } from "@/lib/planilha/tipos";
import { lancamentoSchema, type CamposAlteracao, type LancamentoEntrada, type Operacao } from "@/lib/planilha/validacao";
import { SIGLA_INSUMO } from "@/lib/producao";

/**
 * Gravação da planilha (lançamentos manuais): criar, alterar e excluir entradas e saídas, sozinhos ou em lote
 * (colar do Excel), sempre numa transação com o histórico. As saídas vão para `expenses` (a mesma tabela da
 * tela de Despesas e da Produção: nada é contado duas vezes); as entradas, para `entradas_manuais`.
 * - Dois admins: toda alteração e exclusão leva a `versao` da linha; se mudou, 409 `versao` com a linha atual.
 * - Retry de rede: cada linha nova leva uma chave (Idempotency-Key) única por admin; a mesma chave devolve a
 *   mesma linha (`repetida`), e com outro conteúdo é 422 `chave-repetida`.
 * - Entrada manual com o mesmo dia e valor de uma venda do sistema: 409 `parece-venda-presencial`, até a
 *   tela confirmar (`confirmado`).
 */

type Tx = Prisma.TransactionClient;
type Categoria = { id: string; tipo: TipoLancamento; nome: string; grupo: CategoriaDespesa | null; ativo: boolean };

const TEMPO_TRANSACAO = { timeout: 30_000, maxWait: 10_000 };
const formatoQtd = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const diaParaDate = (dia: string) => new Date(`${dia}T00:00:00Z`);
const reais = (centavos: number) => new Prisma.Decimal(centavos).div(100);

// --- erros ---------------------------------------------------------------------------------------------------

/** `indice` vai em `detalhes` só no lote (a rota de uma linha não tem). */
const comIndice = (indice: number | null, detalhes: Record<string, unknown> = {}) => (indice === null ? detalhes : { indice, ...detalhes });

function erroDeValidacao(falha: z.ZodError, prefixo: string): ErroNegocio {
  const detalhes: Record<string, string[]> = {};
  for (const p of falha.issues) {
    const campo = [prefixo, ...p.path.map(String)].filter(Boolean).join(".") || "_";
    (detalhes[campo] ??= []).push(p.message);
  }
  return new ErroNegocio(400, "Dados inválidos.", detalhes);
}

function validar(bruto: unknown, prefixo: string): LancamentoEntrada {
  const r = lancamentoSchema.safeParse(bruto);
  if (!r.success) throw erroDeValidacao(r.error, prefixo);
  return r.data;
}

const naoEncontrada = (indice: number | null, id: string) =>
  new ErroNegocio(404, "Esta linha não existe mais (pode ter sido excluída por outra pessoa). Atualize a planilha.", comIndice(indice, { id }), "nao-encontrada");

const versaoMudou = (indice: number | null, atual: LinhaPlanilhaDTO) => {
  const quem = atual.atualizadoPor?.nome ?? atual.criadoPor?.nome;
  return new ErroNegocio(409, `Esta linha foi alterada${quem ? ` por ${quem}` : " por outra pessoa"} depois que você abriu a planilha.`, comIndice(indice, { atual }), "versao");
};

// --- leitura -------------------------------------------------------------------------------------------------

async function carregarCategorias(tx: Tx): Promise<Map<string, Categoria>> {
  const lista = await tx.categoriaFinanceira.findMany({ select: { id: true, tipo: true, nome: true, grupo: true, ativo: true } });
  return new Map(lista.map((c) => [c.id, c]));
}

/** A categoria precisa existir e ser do tipo da linha; ativa, quando a linha muda para ela. */
function exigirCategoria(categorias: Map<string, Categoria>, id: string, tipo: TipoLancamento, exigirAtiva: boolean, indice: number | null): Categoria {
  const c = categorias.get(id);
  const motivo = !c
    ? "Categoria não encontrada. Atualize a planilha."
    : c.tipo !== tipo
      ? `A categoria "${c.nome}" é de ${c.tipo === "ENTRADA" ? "entrada" : "saída"}.`
      : exigirAtiva && !c.ativo
        ? `A categoria "${c.nome}" está desativada.`
        : null;
  if (motivo || !c) throw new ErroNegocio(422, motivo ?? "Categoria inválida.", comIndice(indice, { categoriaId: id }), "categoria");
  return c;
}

type Manual = { tipo: "SAIDA"; linha: LinhaPlanilhaDTO; registro: DespesaDaGrade } | { tipo: "ENTRADA"; linha: LinhaPlanilhaDTO; registro: EntradaDaGrade };

async function carregarManual(tx: Tx, tipo: TipoLancamento, id: string): Promise<Manual | null> {
  if (tipo === "SAIDA") {
    const d = await tx.expense.findUnique({ where: { id }, include: incluirDespesa });
    return d ? { tipo, linha: linhaDeDespesa(d), registro: d } : null;
  }
  const m = await tx.entradaManual.findUnique({ where: { id }, include: incluirEntrada });
  return m ? { tipo, linha: linhaDeEntrada(m), registro: m } : null;
}

/** A linha atual como entrada da API (para mesclar com os campos de um "alterar"). */
function brutoDaLinha(l: LinhaPlanilhaDTO): Record<string, unknown> {
  return {
    tipo: l.tipo,
    data: l.data,
    categoriaId: l.categoriaId,
    descricao: l.descricao,
    valorCentavos: l.valorCentavos,
    formaPagamento: l.formaPagamento,
    observacao: l.observacao,
    ...(l.tipo === "SAIDA"
      ? { quantidade: l.quantidade ?? undefined, unidade: l.unidade ?? undefined, fornecedor: l.fornecedor, insumoId: l.insumo?.id ?? null, quantidadeBase: l.quantidadeBase }
      : {}),
  };
}

// --- montagem do que vai para o banco ------------------------------------------------------------------------

async function dadosDaSaida(tx: Tx, l: LancamentoEntrada, c: Categoria) {
  return {
    descricao: l.descricao,
    // O grupo antigo continua gravado: relatórios e a tela de Despesas leem `categoria`.
    categoria: c.grupo ?? "OUTROS",
    categoriaId: c.id,
    quantidade: new Prisma.Decimal(String(l.quantidade)),
    unidade: l.unidade,
    valorTotal: reais(l.valorCentavos),
    data: diaParaDate(l.data),
    fornecedor: l.fornecedor,
    observacao: l.observacao,
    formaPagamento: l.formaPagamento,
    ...(await vinculoComEstoque({ insumoId: l.insumoId, unidade: l.unidade, quantidade: l.quantidade, quantidadeBase: l.quantidadeBase }, tx)),
  };
}

function dadosDaEntrada(l: LancamentoEntrada, c: Categoria) {
  return {
    data: diaParaDate(l.data),
    categoriaId: c.id,
    descricao: l.descricao,
    valor: reais(l.valorCentavos),
    formaPagamento: l.formaPagamento,
    observacao: l.observacao,
  };
}

/** A mesma chave com o mesmo conteúdo é retry; com outro conteúdo é erro de quem enviou. */
function mesmoConteudo(l: LancamentoEntrada, gravada: LinhaPlanilhaDTO): boolean {
  return (
    l.tipo === gravada.tipo &&
    l.data === gravada.data &&
    l.valorCentavos === gravada.valorCentavos &&
    l.descricao === gravada.descricao &&
    l.categoriaId === gravada.categoriaId
  );
}

// --- alterar e excluir uma linha (dentro da transação) -------------------------------------------------------

async function alterarUma(
  tx: Tx,
  op: { id: string; tipoAtual: TipoLancamento; versao: number; campos: CamposAlteracao },
  indice: number | null,
  adminId: string,
  categorias: Map<string, Categoria>,
): Promise<{ linha: LinhaPlanilhaDTO; idAnterior?: string }> {
  const atual = await carregarManual(tx, op.tipoAtual, op.id);
  if (!atual) throw naoEncontrada(indice, op.id);
  if (atual.linha.versao !== op.versao) throw versaoMudou(indice, atual.linha);

  const prefixo = indice === null ? "campos" : `operacoes.${indice}.campos`;
  const bruto: Record<string, unknown> = { ...brutoDaLinha(atual.linha), ...op.campos };
  const novoTipo = (op.campos.tipo ?? atual.tipo) as TipoLancamento;
  const trocaDeTipo = novoTipo !== atual.tipo;
  if (trocaDeTipo && op.campos.categoriaId === undefined) bruto.categoriaId = CATEGORIA_PADRAO[novoTipo];
  const l = validar(bruto, prefixo);
  const c = exigirCategoria(categorias, l.categoriaId, l.tipo, l.categoriaId !== atual.linha.categoriaId, indice);
  const agora = new Date();

  if (trocaDeTipo) {
    if (atual.tipo === "SAIDA" && atual.registro.insumoId) {
      throw new ErroNegocio(409, "Esta compra entrou no estoque da Produção: desligue o estoque em Despesas antes de trocar para entrada.", comIndice(indice, { id: op.id }), "ligada-ao-estoque");
    }
    // Troca de tipo = sai de uma tabela e entra na outra (outro id), com quem lançou e quando preservados.
    const removidas =
      atual.tipo === "SAIDA"
        ? await tx.expense.deleteMany({ where: { id: op.id, versao: op.versao } })
        : await tx.entradaManual.deleteMany({ where: { id: op.id, versao: op.versao } });
    if (removidas.count !== 1) throw versaoMudou(indice, atual.linha);
    const autoria = { atualizadoEm: agora, atualizadoPorId: adminId, importacaoId: atual.linha.importacaoId };
    const criadoPorId = atual.linha.criadoPor?.id ?? null;
    const criadoEm = atual.linha.criadoEm ? new Date(atual.linha.criadoEm) : agora;
    let nova: LinhaPlanilhaDTO;
    if (novoTipo === "SAIDA") {
      const d = await tx.expense.create({ data: { ...(await dadosDaSaida(tx, { ...l, insumoId: null, quantidadeBase: null }, c)), ...autoria, criadoPorId, createdAt: criadoEm }, include: incluirDespesa });
      nova = linhaDeDespesa(d);
    } else {
      const m = await tx.entradaManual.create({ data: { ...dadosDaEntrada(l, c), ...autoria, criadoPorId, criadoEm }, include: incluirEntrada });
      nova = linhaDeEntrada(m);
    }
    const entidadeAntiga = atual.tipo === "SAIDA" ? "despesa" : "entrada";
    const entidadeNova = novoTipo === "SAIDA" ? "despesa" : "entrada";
    await registrarAuditoria(tx, { entidade: entidadeAntiga, entidadeId: op.id, acao: "EXCLUIU", antes: fotoDaLinha(atual.linha), depois: { movidaPara: nova.id }, adminId });
    await registrarAuditoria(tx, { entidade: entidadeNova, entidadeId: nova.id, acao: "CRIOU", antes: { vindaDe: op.id, ...fotoDaLinha(atual.linha) }, depois: fotoDaLinha(nova), adminId });
    return { linha: nova, idAnterior: op.id };
  }

  const marca = { versao: { increment: 1 }, atualizadoEm: agora, atualizadoPorId: adminId };
  const { count } =
    atual.tipo === "SAIDA"
      ? await tx.expense.updateMany({ where: { id: op.id, versao: op.versao }, data: { ...(await dadosDaSaida(tx, l, c)), ...marca } })
      : await tx.entradaManual.updateMany({ where: { id: op.id, versao: op.versao }, data: { ...dadosDaEntrada(l, c), ...marca } });
  if (count !== 1) throw versaoMudou(indice, atual.linha);
  const gravada = await carregarManual(tx, atual.tipo, op.id);
  if (!gravada) throw naoEncontrada(indice, op.id);
  await registrarAuditoria(tx, {
    entidade: atual.tipo === "SAIDA" ? "despesa" : "entrada",
    entidadeId: op.id,
    acao: "ALTEROU",
    antes: fotoDaLinha(atual.linha),
    depois: fotoDaLinha(gravada.linha),
    adminId,
  });
  return { linha: gravada.linha };
}

async function excluirUma(
  tx: Tx,
  op: { id: string; tipoAtual: TipoLancamento; versao: number; confirmarEstoque?: boolean },
  indice: number | null,
  adminId: string,
): Promise<LinhaPlanilhaDTO> {
  const atual = await carregarManual(tx, op.tipoAtual, op.id);
  if (!atual) throw naoEncontrada(indice, op.id);
  if (atual.linha.versao !== op.versao) throw versaoMudou(indice, atual.linha);
  if (atual.tipo === "SAIDA" && atual.registro.insumo && !op.confirmarEstoque) {
    const insumo = atual.registro.insumo;
    const qtd = atual.linha.quantidadeBase ?? 0;
    throw new ErroNegocio(
      409,
      `Excluir tira ${formatoQtd.format(qtd)} ${SIGLA_INSUMO[insumo.unidade]} de ${insumo.nome} do estoque. Confirme para excluir.`,
      comIndice(indice, { id: op.id, insumo: { nome: insumo.nome, unidade: insumo.unidade }, quantidadeBase: qtd }),
      "confirmar-estoque",
    );
  }
  const { count } =
    atual.tipo === "SAIDA"
      ? await tx.expense.deleteMany({ where: { id: op.id, versao: op.versao } })
      : await tx.entradaManual.deleteMany({ where: { id: op.id, versao: op.versao } });
  if (count !== 1) throw versaoMudou(indice, atual.linha);
  await registrarAuditoria(tx, { entidade: atual.tipo === "SAIDA" ? "despesa" : "entrada", entidadeId: op.id, acao: "EXCLUIU", antes: fotoDaLinha(atual.linha), adminId });
  return atual.linha;
}

// --- criar em lote -------------------------------------------------------------------------------------------

type Criacao = { indice: number; chave: string; confirmado: boolean; l: LancamentoEntrada };

async function criarVarias(tx: Tx, criacoes: Criacao[], adminId: string, categorias: Map<string, Categoria>, resultados: ResultadoOperacao[]) {
  if (criacoes.length === 0) return;
  const chaves = criacoes.map((c) => c.chave);
  // Retry: chaves que este admin já gravou devolvem a mesma linha.
  const [jaDespesas, jaEntradas] = await Promise.all([
    tx.expense.findMany({ where: { criadoPorId: adminId, idempotencyKey: { in: chaves } }, include: incluirDespesa }),
    tx.entradaManual.findMany({ where: { criadoPorId: adminId, idempotencyKey: { in: chaves } }, include: incluirEntrada }),
  ]);
  const jaGravadas = new Map<string, LinhaPlanilhaDTO>([
    ...jaDespesas.map((d) => [d.idempotencyKey!, linhaDeDespesa(d)] as const),
    ...jaEntradas.map((m) => [m.idempotencyKey!, linhaDeEntrada(m)] as const),
  ]);

  const novas: (Criacao & { c: Categoria })[] = [];
  for (const cr of criacoes) {
    const gravada = jaGravadas.get(cr.chave);
    if (gravada) {
      if (!mesmoConteudo(cr.l, gravada)) {
        throw new ErroNegocio(422, "Esta chave já foi usada para outro lançamento. Recarregue a planilha.", { indice: cr.indice, chave: cr.chave }, "chave-repetida");
      }
      resultados[cr.indice] = { indice: cr.indice, op: "criar", linha: gravada, repetida: true };
      continue;
    }
    novas.push({ ...cr, c: exigirCategoria(categorias, cr.l.categoriaId, cr.l.tipo, true, cr.indice) });
  }

  // Aviso: entrada manual com o mesmo dia e valor de uma venda do site ou presencial (a venda da feira
  // lançada duas vezes). Uma consulta só para o lote inteiro.
  const suspeitas = novas.filter((n) => n.l.tipo === "ENTRADA" && !n.confirmado);
  if (suspeitas.length) {
    const dias = suspeitas.map((s) => s.l.data).sort();
    const vendas = await vendasComValores(tx, dias[0], dias[dias.length - 1], [...new Set(suspeitas.map((s) => s.l.valorCentavos))]);
    for (const s of suspeitas) {
      const iguais = vendas.filter((v) => v.data === s.l.data && v.valorCentavos === s.l.valorCentavos);
      if (iguais.length) {
        throw new ErroNegocio(
          409,
          "Já existe uma venda do sistema neste dia com este valor. Venda de geleia se lança em Venda presencial; lance aqui só o que não passa pelo sistema. Lançar mesmo assim?",
          { indice: s.indice, vendas: iguais },
          "parece-venda-presencial",
        );
      }
    }
  }

  const saidas = novas.filter((n) => n.l.tipo === "SAIDA");
  const entradas = novas.filter((n) => n.l.tipo === "ENTRADA");
  const dadosSaidas = [];
  for (const s of saidas) dadosSaidas.push({ ...(await dadosDaSaida(tx, s.l, s.c)), criadoPorId: adminId, idempotencyKey: s.chave });
  const [criadasSaidas, criadasEntradas] = await Promise.all([
    saidas.length ? tx.expense.createManyAndReturn({ data: dadosSaidas, select: { id: true } }) : [],
    entradas.length
      ? tx.entradaManual.createManyAndReturn({ data: entradas.map((e) => ({ ...dadosDaEntrada(e.l, e.c), criadoPorId: adminId, idempotencyKey: e.chave })), select: { id: true } })
      : [],
  ]);
  const [lidasSaidas, lidasEntradas] = await Promise.all([
    criadasSaidas.length ? tx.expense.findMany({ where: { id: { in: criadasSaidas.map((x) => x.id) } }, include: incluirDespesa }) : [],
    criadasEntradas.length ? tx.entradaManual.findMany({ where: { id: { in: criadasEntradas.map((x) => x.id) } }, include: incluirEntrada }) : [],
  ]);
  const porChave = new Map<string, LinhaPlanilhaDTO>([
    ...lidasSaidas.map((d) => [d.idempotencyKey!, linhaDeDespesa(d)] as const),
    ...lidasEntradas.map((m) => [m.idempotencyKey!, linhaDeEntrada(m)] as const),
  ]);
  const auditorias: Prisma.AuditoriaFinanceiraCreateManyInput[] = [];
  for (const n of novas) {
    const linha = porChave.get(n.chave);
    if (!linha) throw new Error("linha criada não foi relida");
    resultados[n.indice] = { indice: n.indice, op: "criar", linha, repetida: false };
    auditorias.push({ entidade: n.l.tipo === "SAIDA" ? "despesa" : "entrada", entidadeId: linha.id, acao: "CRIOU", antes: Prisma.DbNull, depois: fotoDaLinha(linha) as Prisma.InputJsonObject, adminId });
  }
  if (auditorias.length) await tx.auditoriaFinanceira.createMany({ data: auditorias });
}

// --- entradas públicas do módulo -----------------------------------------------------------------------------

const ehChaveRepetida = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Executa o lote (de 1 a 200 operações) numa transação só: ou tudo, ou nada. Alterações e exclusões rodam na
 * ordem; as criações vão juntas no fim (poucas idas ao banco, mesmo com 200 linhas coladas). Duas requisições
 * com a mesma chave ao mesmo tempo: a segunda bate no UNIQUE e roda de novo, devolvendo a linha da primeira.
 */
export async function executarLote(operacoes: Operacao[], adminId: string): Promise<ResultadoOperacao[]> {
  // Valida as linhas novas antes de abrir a transação (erro de digitação não segura conexão).
  const criacoes: Criacao[] = [];
  operacoes.forEach((o, indice) => {
    if (o.op === "criar") criacoes.push({ indice, chave: o.chave, confirmado: o.confirmado === true, l: validar(o.lancamento, `operacoes.${indice}.lancamento`) });
  });

  const rodar = () =>
    db.$transaction(async (tx) => {
      const categorias = await carregarCategorias(tx);
      const resultados: ResultadoOperacao[] = new Array(operacoes.length);
      for (const [indice, o] of operacoes.entries()) {
        if (o.op === "alterar") resultados[indice] = { indice, op: "alterar", ...(await alterarUma(tx, o, indice, adminId, categorias)) };
        else if (o.op === "excluir") resultados[indice] = { indice, op: "excluir", id: o.id, linha: await excluirUma(tx, o, indice, adminId) };
      }
      await criarVarias(tx, criacoes, adminId, categorias, resultados);
      return resultados;
    }, TEMPO_TRANSACAO);

  try {
    return await rodar();
  } catch (e) {
    if (ehChaveRepetida(e) && criacoes.length) return rodar();
    throw e;
  }
}

/** PATCH de uma linha (rotas /saidas/[id] e /entradas/[id]). */
export async function alterarLinha(tipoAtual: TipoLancamento, id: string, versao: number, campos: CamposAlteracao, adminId: string) {
  return db.$transaction(async (tx) => alterarUma(tx, { id, tipoAtual, versao, campos }, null, adminId, await carregarCategorias(tx)), TEMPO_TRANSACAO);
}

/** DELETE de uma linha; devolve como ela era (para o desfazer da tela). */
export async function excluirLinha(tipoAtual: TipoLancamento, id: string, versao: number, confirmarEstoque: boolean, adminId: string) {
  return db.$transaction(async (tx) => excluirUma(tx, { id, tipoAtual, versao, confirmarEstoque }, null, adminId), TEMPO_TRANSACAO);
}
