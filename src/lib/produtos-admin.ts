import "server-only";
import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { erro, erroDeValidacao } from "@/lib/api";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import {
  MAX_BYTES_FOTO,
  idParaProduto,
  montarNome,
  produtoSchema,
  separarNome,
  tipoDaImagem,
  type ProdutoEntrada,
  type TipoFoto,
} from "@/lib/produtos-regras";

/** Cadastro de produtos pelo painel (criar, editar, ocultar, excluir) e as fotos enviadas. */

export type ProdutoAdminDTO = {
  id: string;
  nome: string;
  sabor: string;
  descricao: string;
  preco: number;
  pesoGramas: number;
  imagemUrl: string;
  ativo: boolean;
  /** "Pode entrar no Kit Presente": só os potes do tamanho padrão (produto novo nasce fora). */
  permitidoEmKit: boolean;
  /** Verso da foto: "Harmoniza com" e "Por que você vai gostar" (listas vazias: foto sem verso). */
  harmonizacoes: string[];
  destaques: string[];
  /**
   * Vendas (itens avulsos de pedido + caixas de kit com este sabor) e produções que apontam para o
   * produto: com alguma, ele só pode ser ocultado.
   */
  vendas: number;
  producoes: number;
};

type Foto = { tipo: TipoFoto; dados: Uint8Array<ArrayBuffer> };

// `kitSabores`: um sabor vendido só dentro de kits também tem histórico (a composição aponta para ele).
const comContagens = {
  _count: { select: { orderItems: true, kitSabores: true, producoes: true } },
} satisfies Prisma.ProductInclude;

type ProdutoComContagens = Prisma.ProductGetPayload<{ include: typeof comContagens }>;

/** Linhas de venda que citam o produto: avulso ou dentro de uma caixa de kit. */
const vendasDo = (p: ProdutoComContagens) => p._count.orderItems + p._count.kitSabores;

function paraDTO(p: ProdutoComContagens): ProdutoAdminDTO {
  return {
    id: p.id,
    nome: p.nome,
    sabor: separarNome(p.nome).sabor,
    descricao: p.descricao,
    preco: p.preco.toNumber(),
    pesoGramas: p.pesoGramas,
    imagemUrl: p.imagemUrl,
    ativo: p.ativo,
    permitidoEmKit: p.permitidoEmKit,
    harmonizacoes: p.harmonizacoes ?? [],
    destaques: p.destaques ?? [],
    vendas: vendasDo(p),
    producoes: p._count.producoes,
  };
}

/**
 * A loja (páginas e /api/products) lê o catálogo em cache: depois de mudar, expira na hora. Expira
 * também os kits: os sabores do montador (/kits) e a economia dependem de preço, visibilidade e
 * "Pode entrar no Kit Presente" de cada produto.
 */
function atualizarLoja(): void {
  revalidateTag("produtos", { expire: 0 });
  revalidateTag("kits", { expire: 0 });
}

export async function listarProdutosAdmin(): Promise<ProdutoAdminDTO[]> {
  const produtos = await db.product.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }], include: comContagens });
  return produtos.map(paraDTO);
}

type Lido = { ok: true; dados: ProdutoEntrada; foto: Foto | null } | { ok: false; resposta: Response };

/** Campos e foto do formulário multipart. A foto é conferida pelos primeiros bytes, não pelo nome. */
export async function lerProdutoDoFormulario(form: FormData, opcoes: { fotoObrigatoria: boolean }): Promise<Lido> {
  const campo = (nome: string) => {
    const valor = form.get(nome);
    return typeof valor === "string" ? valor : undefined;
  };
  const lido = produtoSchema.safeParse({
    sabor: campo("sabor"),
    pesoGramas: campo("pesoGramas"),
    precoCentavos: campo("precoCentavos"),
    descricao: campo("descricao"),
    ativo: campo("ativo"),
    permitidoEmKit: campo("permitidoEmKit"),
    // Um item por linha (o textarea do painel). Sem o campo: a lista fica como estava.
    harmonizacoes: campo("harmonizacoes"),
    destaques: campo("destaques"),
  });
  if (!lido.success) return { ok: false, resposta: erroDeValidacao(lido.error) };

  const arquivo = form.get("foto");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return opcoes.fotoObrigatoria
      ? { ok: false, resposta: erro(400, "Escolha uma foto do produto.", { foto: ["Escolha uma foto do produto."] }) }
      : { ok: true, dados: lido.data, foto: null };
  }
  if (arquivo.size > MAX_BYTES_FOTO) {
    return { ok: false, resposta: erro(413, "A foto pode ter no máximo 2 MB.", { foto: ["A foto pode ter no máximo 2 MB."] }) };
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoDaImagem(dados);
  if (!tipo) {
    return { ok: false, resposta: erro(400, "A foto precisa ser JPG, PNG ou WebP.", { foto: ["A foto precisa ser JPG, PNG ou WebP."] }) };
  }
  return { ok: true, dados: lido.data, foto: { tipo, dados } };
}

/** Outro produto com o mesmo sabor e peso confundiria o cliente (e o rótulo). */
async function garantirNomeLivre(nome: string, exceto?: string): Promise<void> {
  const igual = await db.product.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(exceto ? { NOT: { id: exceto } } : {}) },
    select: { id: true },
  });
  if (igual) throw new ErroNegocio(409, `Já existe um produto "${nome}".`, { sabor: ["Já existe um produto com esse sabor e peso."] });
}

const novoIdDeFoto = () => randomUUID().replaceAll("-", "");

function camposDoProduto(entrada: ProdutoEntrada) {
  return {
    nome: montarNome(entrada.sabor, entrada.pesoGramas),
    descricao: entrada.descricao,
    // Centavos inteiros → Decimal exato (sem passar por float).
    preco: new Prisma.Decimal(entrada.precoCentavos).div(100),
    pesoGramas: entrada.pesoGramas,
    ativo: entrada.ativo,
    // Sem o campo (formulário antigo): ao editar fica como estava; ao criar, o default (fora do kit).
    ...(entrada.permitidoEmKit === undefined ? {} : { permitidoEmKit: entrada.permitidoEmKit }),
    // Verso: o mesmo padrão (campo ausente = não mexe; "" = lista vazia).
    ...(entrada.harmonizacoes === undefined ? {} : { harmonizacoes: entrada.harmonizacoes }),
    ...(entrada.destaques === undefined ? {} : { destaques: entrada.destaques }),
  };
}

export async function criarProduto(entrada: ProdutoEntrada, foto: Foto): Promise<ProdutoAdminDTO> {
  const campos = camposDoProduto(entrada);
  await garantirNomeLivre(campos.nome);

  // Id legível; se já existir (produto antigo excluído não libera vendas), acrescenta -2, -3...
  const base = idParaProduto(entrada.sabor, entrada.pesoGramas);
  const usados = new Set((await db.product.findMany({ where: { id: { startsWith: base } }, select: { id: true } })).map((p) => p.id));
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;

  const fotoId = novoIdDeFoto();
  try {
    const criado = await db.product.create({
      data: { id, ...campos, imagemUrl: `/fotos/${fotoId}`, fotos: { create: { id: fotoId, tipo: foto.tipo, dados: foto.dados } } },
      include: comContagens,
    });
    atualizarLoja();
    return paraDTO(criado);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ErroNegocio(409, "Outro produto acabou de ser criado com esse nome. Confira a lista e tente de novo.");
    }
    throw e;
  }
}

export async function atualizarProduto(id: string, entrada: ProdutoEntrada, foto: Foto | null): Promise<ProdutoAdminDTO> {
  const atual = await db.product.findUnique({ where: { id }, select: { id: true } });
  if (!atual) throw new ErroNegocio(404, "Produto não encontrado.");
  const campos = camposDoProduto(entrada);
  await garantirNomeLivre(campos.nome, id);

  const fotoId = foto ? novoIdDeFoto() : null;
  const atualizar = db.product.update({
    where: { id },
    data: {
      ...campos,
      ...(foto && fotoId
        ? { imagemUrl: `/fotos/${fotoId}`, fotos: { create: { id: fotoId, tipo: foto.tipo, dados: foto.dados } } }
        : {}),
    },
    include: comContagens,
  });
  // Foto nova: as antigas enviadas pelo painel saem junto (a da pasta public, se era essa, fica no projeto).
  const atualizado = fotoId
    ? (await db.$transaction([db.produtoFoto.deleteMany({ where: { productId: id } }), atualizar]))[1]
    : await atualizar;
  atualizarLoja();
  return paraDTO(atualizado);
}

/** Mostra ou oculta o produto na loja (o histórico de vendas e produções não muda). */
export async function definirVisibilidade(id: string, ativo: boolean): Promise<ProdutoAdminDTO> {
  try {
    const atualizado = await db.product.update({ where: { id }, data: { ativo }, include: comContagens });
    atualizarLoja();
    return paraDTO(atualizado);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw new ErroNegocio(404, "Produto não encontrado.");
    throw e;
  }
}

/**
 * Exclui de vez um produto sem histórico. Com vendas (avulsas ou em kits) ou produções, recusa (409):
 * os pedidos e as fichas de produção apontam para ele, então o caminho é ocultá-lo da loja.
 */
export async function excluirProduto(id: string): Promise<void> {
  const produto = await db.product.findUnique({ where: { id }, include: comContagens });
  if (!produto) throw new ErroNegocio(404, "Produto não encontrado.");
  const vendas = vendasDo(produto);
  const { producoes } = produto._count;
  if (vendas > 0 || producoes > 0) {
    const partes = [
      vendas > 0 ? `${vendas} ${vendas === 1 ? "venda" : "vendas"}` : null,
      producoes > 0 ? `${producoes} ${producoes === 1 ? "produção" : "produções"}` : null,
    ].filter(Boolean);
    throw new ErroNegocio(
      409,
      `"${produto.nome}" tem ${partes.join(" e ")} no histórico e não pode ser excluído. Use "Ocultar da loja": ele some da vitrine e o histórico continua certo.`,
    );
  }
  // Uma venda criada entre a conferência e a exclusão esbarra na chave estrangeira (409 genérico).
  await db.product.delete({ where: { id } });
  atualizarLoja();
}

export async function lerFoto(id: string): Promise<{ tipo: string; dados: Uint8Array<ArrayBuffer> } | null> {
  return db.produtoFoto.findUnique({ where: { id }, select: { tipo: true, dados: true } });
}
