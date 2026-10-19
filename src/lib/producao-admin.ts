import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import {
  CUSTOS_PADRAO,
  arredondarQtd,
  custoDoItem,
  linhaDeEstoque,
  totaisDaProducao,
  type CustoDeProducao,
  type InsumoDTO,
  type ItemDeProducao,
  type TotaisDeProducao,
} from "@/lib/producao";
import type { AjusteEntrada, InsumoEntrada, ProducaoEntrada } from "@/lib/validacao-producao";

// --- tipos que a tela recebe ------------------------------------------------------

export type ProdutoParaProducao = { id: string; nome: string; preco: number; pesoGramas: number };

export type ProducaoResumoDTO = {
  id: string;
  data: string;
  nome: string;
  potes: number;
  produto: ProdutoParaProducao | null;
  totais: TotaisDeProducao;
};

export type ProducaoDetalheDTO = ProducaoResumoDTO & {
  itens: (ItemDeProducao & { custo: number; sobraHoje: number | null })[];
  custos: CustoDeProducao[];
  observacao: string | null;
};

export type DadosDoFormulario = {
  hoje: string;
  insumos: InsumoDTO[];
  produtos: ProdutoParaProducao[];
  /** Custos da última produção (ou os nomes do caderno, sem valor, na primeira). */
  custosSugeridos: { descricao: string; valor: number | null }[];
  /** "Receita N", contando as produções já registradas. */
  sugestaoNome: string;
};

// --- ajudantes --------------------------------------------------------------------

const diaParaDate = (dia: string) => new Date(`${dia}T00:00:00Z`);
const dateParaDia = (d: Date) => d.toISOString().slice(0, 10);
const dec = (v: number) => new Prisma.Decimal(String(v));
const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);

const produtoDTO = (p: { id: string; nome: string; preco: Prisma.Decimal; pesoGramas: number } | null): ProdutoParaProducao | null =>
  p ? { id: p.id, nome: p.nome, preco: p.preco.toNumber(), pesoGramas: p.pesoGramas } : null;

// --- estoque ------------------------------------------------------------------------

/** Todos os insumos com compras, usos, ajustes, sobra e custo médio (a "planilha" do estoque). */
export async function listarInsumos(opcoes: { ids?: string[] } = {}): Promise<InsumoDTO[]> {
  const filtro = opcoes.ids ? { in: opcoes.ids } : undefined;
  const [insumos, compras, usos, ajustes] = await Promise.all([
    db.insumo.findMany({ where: filtro ? { id: filtro } : {}, orderBy: [{ ativo: "desc" }, { tipo: "asc" }, { nome: "asc" }] }),
    db.expense.groupBy({
      by: ["insumoId"],
      where: { insumoId: filtro ?? { not: null } },
      _sum: { quantidadeBase: true, valorTotal: true },
      _count: { _all: true },
    }),
    db.producaoItem.groupBy({ by: ["insumoId"], where: filtro ? { insumoId: filtro } : {}, _sum: { quantidade: true }, _count: { _all: true } }),
    db.ajusteEstoque.groupBy({ by: ["insumoId"], where: filtro ? { insumoId: filtro } : {}, _sum: { quantidade: true }, _count: { _all: true } }),
  ]);
  const porId = <T extends { insumoId: string | null }>(linhas: T[]) => new Map(linhas.map((l) => [l.insumoId, l]));
  const c = porId(compras);
  const u = porId(usos);
  const a = porId(ajustes);

  return insumos.map((i) => {
    const compra = c.get(i.id);
    const uso = u.get(i.id);
    const ajuste = a.get(i.id);
    const base = {
      comprado: num(compra?._sum.quantidadeBase),
      totalComprado: num(compra?._sum.valorTotal),
      usado: num(uso?._sum.quantidade),
      ajustado: num(ajuste?._sum.quantidade),
    };
    return {
      id: i.id,
      nome: i.nome,
      tipo: i.tipo,
      unidade: i.unidade,
      estoqueMinimo: i.estoqueMinimo ? i.estoqueMinimo.toNumber() : null,
      controlaEstoque: i.controlaEstoque,
      ativo: i.ativo,
      ...base,
      ...linhaDeEstoque(base, i.controlaEstoque),
      temMovimento: Boolean(compra?._count._all || uso?._count._all || ajuste?._count._all),
    };
  });
}

/** Nome já usado (sem diferenciar maiúsculas: "Açúcar" e "açúcar" são o mesmo insumo)? */
async function nomeEmUso(nome: string, excetoId?: string) {
  const existente = await db.insumo.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(excetoId ? { id: { not: excetoId } } : {}) },
    select: { id: true },
  });
  return Boolean(existente);
}

export async function criarInsumo(e: InsumoEntrada): Promise<InsumoDTO> {
  if (await nomeEmUso(e.nome)) throw new ErroNegocio(409, `Já existe um insumo chamado "${e.nome}".`, { nome: ["Nome já usado."] });
  const criado = await db.insumo.create({
    data: {
      nome: e.nome,
      tipo: e.tipo,
      unidade: e.unidade,
      estoqueMinimo: e.estoqueMinimo === null ? null : dec(e.estoqueMinimo),
      controlaEstoque: e.controlaEstoque,
      ativo: e.ativo,
    },
  });
  return (await listarInsumos({ ids: [criado.id] }))[0];
}

/** Edita o insumo. A unidade só muda enquanto não houver compra, uso ou ajuste (senão as contas virariam outra coisa). */
export async function atualizarInsumo(id: string, e: InsumoEntrada): Promise<InsumoDTO | null> {
  const [atual] = await listarInsumos({ ids: [id] });
  if (!atual) return null;
  if (atual.unidade !== e.unidade && atual.temMovimento) {
    throw new ErroNegocio(409, "A unidade não pode mudar: este insumo já tem compras, usos ou ajustes.", { unidade: ["Já tem movimento."] });
  }
  if (await nomeEmUso(e.nome, id)) throw new ErroNegocio(409, `Já existe um insumo chamado "${e.nome}".`, { nome: ["Nome já usado."] });
  await db.insumo.update({
    where: { id },
    data: {
      nome: e.nome,
      tipo: e.tipo,
      unidade: e.unidade,
      estoqueMinimo: e.estoqueMinimo === null ? null : dec(e.estoqueMinimo),
      controlaEstoque: e.controlaEstoque,
      ativo: e.ativo,
    },
  });
  return (await listarInsumos({ ids: [id] }))[0] ?? null;
}

export async function registrarAjuste(insumoId: string, e: AjusteEntrada, criadoPorId: string): Promise<InsumoDTO | null> {
  const existe = await db.insumo.findUnique({ where: { id: insumoId }, select: { id: true } });
  if (!existe) return null;
  await db.ajusteEstoque.create({
    data: { insumoId, quantidade: dec(e.quantidade), motivo: e.motivo, data: diaParaDate(e.data), criadoPorId },
  });
  return (await listarInsumos({ ids: [insumoId] }))[0] ?? null;
}

// --- produção ---------------------------------------------------------------------------

const incluirLote = {
  product: { select: { id: true, nome: true, preco: true, pesoGramas: true } },
  itens: { include: { insumo: { select: { nome: true, tipo: true, unidade: true } } }, orderBy: { id: "asc" } },
  custos: { orderBy: { id: "asc" } },
} satisfies Prisma.ProducaoInclude;

type LoteDoBanco = Prisma.ProducaoGetPayload<{ include: typeof incluirLote }>;

function itensDoLote(l: LoteDoBanco): ItemDeProducao[] {
  return l.itens.map((i) => ({
    insumoId: i.insumoId,
    nome: i.insumo.nome,
    tipo: i.insumo.tipo,
    unidade: i.insumo.unidade,
    quantidade: i.quantidade.toNumber(),
    custoUnitario: i.custoUnitario.toNumber(),
  }));
}

function resumo(l: LoteDoBanco): ProducaoResumoDTO {
  const produto = produtoDTO(l.product);
  const custos = l.custos.map((c) => ({ descricao: c.descricao, valor: c.valor.toNumber() }));
  return {
    id: l.id,
    data: dateParaDia(l.data),
    nome: l.nome,
    potes: l.potes,
    produto,
    totais: totaisDaProducao(itensDoLote(l), custos, l.potes, produto?.preco ?? null),
  };
}

export async function listarProducoes(): Promise<ProducaoResumoDTO[]> {
  const lotes = await db.producao.findMany({
    orderBy: [{ data: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 300,
    include: incluirLote,
  });
  return lotes.map(resumo);
}

export async function detalheProducao(id: string): Promise<ProducaoDetalheDTO | null> {
  const l = await db.producao.findUnique({ where: { id }, include: incluirLote });
  if (!l) return null;
  const estoque = new Map((await listarInsumos({ ids: [...new Set(l.itens.map((i) => i.insumoId))] })).map((i) => [i.id, i]));
  const itens = itensDoLote(l).map((i) => {
    const insumo = estoque.get(i.insumoId);
    return {
      ...i,
      // O mesmo arredondamento dos totais: a soma das linhas fecha com a conta do lote.
      custo: custoDoItem(i),
      sobraHoje: insumo && insumo.controlaEstoque ? insumo.sobra : null,
    };
  });
  return {
    ...resumo(l),
    itens,
    custos: l.custos.map((c) => ({ descricao: c.descricao, valor: c.valor.toNumber() })),
    observacao: l.observacao,
  };
}

/**
 * Custo unitário de cada item: o informado pela pessoa (ex.: 0 para limão do quintal) ou o custo
 * médio das compras. Na correção de um lote, quem não mudou de insumo guarda o custo do dia original.
 */
async function custosUnitarios(
  entrada: ProducaoEntrada,
  anteriores: Map<string, Prisma.Decimal> = new Map(),
): Promise<Prisma.Decimal[]> {
  const ids = [...new Set(entrada.itens.map((i) => i.insumoId))];
  const [insumos, compras] = await Promise.all([
    db.insumo.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, tipo: true } }),
    db.expense.groupBy({ by: ["insumoId"], where: { insumoId: { in: ids } }, _sum: { quantidadeBase: true, valorTotal: true } }),
  ]);
  const nomes = new Map(insumos.map((i) => [i.id, i.nome]));
  // A tela já exige; a API também (um lote só de potes não é geleia).
  if (insumos.length === ids.length && !insumos.some((i) => i.tipo === "INGREDIENTE")) {
    throw new ErroNegocio(400, "Informe pelo menos um ingrediente.", { itens: ["Informe pelo menos um ingrediente."] });
  }
  const medias = new Map(
    compras
      .filter((c) => c.insumoId && c._sum.quantidadeBase && c._sum.quantidadeBase.gt(0))
      .map((c) => [c.insumoId as string, (c._sum.valorTotal ?? new Prisma.Decimal(0)).div(c._sum.quantidadeBase as Prisma.Decimal)]),
  );

  const detalhes: Record<string, string[]> = {};
  const resultado = entrada.itens.map((item, i) => {
    if (!nomes.has(item.insumoId)) {
      detalhes[`itens.${i}.insumoId`] = ["Insumo não encontrado. Atualize a página."];
      return new Prisma.Decimal(0);
    }
    if (item.custoInformadoCentavos !== null) {
      return new Prisma.Decimal(item.custoInformadoCentavos).div(100).div(dec(item.quantidade)).toDecimalPlaces(6);
    }
    const anterior = anteriores.get(item.insumoId);
    if (anterior) return anterior;
    const media = medias.get(item.insumoId);
    if (!media) {
      detalhes[`itens.${i}.custoInformadoCentavos`] = [
        `"${nomes.get(item.insumoId)}" não tem compra lançada: informe quanto custou (0 se foi de casa).`,
      ];
      return new Prisma.Decimal(0);
    }
    return media.toDecimalPlaces(6);
  });
  if (Object.keys(detalhes).length > 0) throw new ErroNegocio(400, "Confira os itens da produção.", detalhes);
  return resultado;
}

async function conferirProduto(productId: string | null) {
  if (!productId) return;
  const existe = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!existe) throw new ErroNegocio(400, "Sabor não encontrado.", { productId: ["Sabor não encontrado."] });
}

const dadosDoLote = (e: ProducaoEntrada) => ({
  data: diaParaDate(e.data),
  productId: e.productId,
  nome: e.nome,
  potes: e.potes,
  observacao: e.observacao,
});

const itensParaCriar = (e: ProducaoEntrada, unitarios: Prisma.Decimal[]) =>
  e.itens.map((item, i) => ({ insumoId: item.insumoId, quantidade: dec(arredondarQtd(item.quantidade)), custoUnitario: unitarios[i] }));

const custosParaCriar = (e: ProducaoEntrada) =>
  e.custos.map((c) => ({ descricao: c.descricao, valor: new Prisma.Decimal(c.valorCentavos).div(100) }));

export async function criarProducao(e: ProducaoEntrada, criadoPorId: string): Promise<ProducaoDetalheDTO> {
  await conferirProduto(e.productId);
  const unitarios = await custosUnitarios(e);
  const lote = await db.producao.create({
    data: {
      ...dadosDoLote(e),
      criadoPorId,
      itens: { create: itensParaCriar(e, unitarios) },
      custos: { create: custosParaCriar(e) },
    },
    select: { id: true },
  });
  return (await detalheProducao(lote.id)) as ProducaoDetalheDTO;
}

/** Corrige um lote (substitui tudo numa transação). `null` se ele não existe mais. */
export async function atualizarProducao(id: string, e: ProducaoEntrada): Promise<ProducaoDetalheDTO | null> {
  const antes = await db.producao.findUnique({ where: { id }, select: { itens: { select: { insumoId: true, custoUnitario: true } } } });
  if (!antes) return null;
  await conferirProduto(e.productId);
  const unitarios = await custosUnitarios(e, new Map(antes.itens.map((i) => [i.insumoId, i.custoUnitario])));
  try {
    // O UPDATE do lote vem primeiro e trava a linha até o fim: a outra aba corrigindo o mesmo lote
    // espera, e o deleteMany dela já enxerga (e apaga) os itens desta. Com o deleteMany primeiro,
    // as duas versões dos itens ficavam no lote (uso de estoque e custo em dobro).
    await db.$transaction([
      db.producao.update({ where: { id }, data: dadosDoLote(e) }),
      db.producaoItem.deleteMany({ where: { producaoId: id } }),
      db.producaoCusto.deleteMany({ where: { producaoId: id } }),
      db.producao.update({
        where: { id },
        data: { itens: { create: itensParaCriar(e, unitarios) }, custos: { create: custosParaCriar(e) } },
      }),
    ]);
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2025") return null;
    throw erro;
  }
  return detalheProducao(id);
}

export async function excluirProducao(id: string): Promise<boolean> {
  const { count } = await db.producao.deleteMany({ where: { id } });
  return count === 1;
}

/** O que o formulário precisa: insumos com estoque e custo, sabores do catálogo e os custos sugeridos. */
export async function dadosDoFormulario(hoje: string): Promise<DadosDoFormulario> {
  const [insumos, produtos, ultima, total] = await Promise.all([
    listarInsumos(),
    db.product.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true, preco: true, pesoGramas: true } }),
    db.producao.findFirst({ orderBy: [{ data: "desc" }, { createdAt: "desc" }], select: { custos: { orderBy: { id: "asc" } } } }),
    db.producao.count(),
  ]);
  const custosSugeridos =
    ultima && ultima.custos.length > 0
      ? ultima.custos.map((c) => ({ descricao: c.descricao, valor: c.valor.toNumber() }))
      : CUSTOS_PADRAO.map((descricao) => ({ descricao, valor: null }));
  return {
    hoje,
    insumos,
    produtos: produtos.map((p) => produtoDTO(p) as ProdutoParaProducao),
    custosSugeridos,
    sugestaoNome: `Receita ${total + 1}`,
  };
}
