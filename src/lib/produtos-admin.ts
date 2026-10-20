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
  /** Itens de pedido e produções que apontam para o produto: com algum, ele só pode ser ocultado. */
  vendas: number;
  producoes: number;
};

type Foto = { tipo: TipoFoto; dados: Uint8Array<ArrayBuffer> };

const comContagens = { _count: { select: { orderItems: true, producoes: true } } } satisfies Prisma.ProductInclude;

function paraDTO(p: Prisma.ProductGetPayload<{ include: typeof comContagens }>): ProdutoAdminDTO {
  return {
    id: p.id,
    nome: p.nome,
    sabor: separarNome(p.nome).sabor,
    descricao: p.descricao,
    preco: p.preco.toNumber(),
    pesoGramas: p.pesoGramas,
    imagemUrl: p.imagemUrl,
    ativo: p.ativo,
    vendas: p._count.orderItems,
    producoes: p._count.producoes,
  };
}

/** A loja (páginas e /api/products) lê o catálogo em cache: depois de mudar, expira na hora. */
function atualizarLoja(): void {
  revalidateTag("produtos", { expire: 0 });
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
 * Exclui de vez um produto sem histórico. Com vendas ou produções, recusa (409): os pedidos e as
 * fichas de produção apontam para ele, então o caminho é ocultá-lo da loja.
 */
export async function excluirProduto(id: string): Promise<void> {
  const produto = await db.product.findUnique({ where: { id }, include: comContagens });
  if (!produto) throw new ErroNegocio(404, "Produto não encontrado.");
  const { orderItems, producoes } = produto._count;
  if (orderItems > 0 || producoes > 0) {
    const partes = [
      orderItems > 0 ? `${orderItems} ${orderItems === 1 ? "venda" : "vendas"}` : null,
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
