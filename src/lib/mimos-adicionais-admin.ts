import "server-only";
import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { adicionalAdminSchema, type AdicionalAdminEntrada } from "@/lib/adicionais-regras";
import { erro, erroDeValidacao } from "@/lib/api";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { MAX_BYTES_FOTO, tipoDaImagem, type TipoFoto } from "@/lib/produtos-regras";

/**
 * Cadastro dos itens adicionais dos mimos no painel (admin): editar nome, descrição curta, preço por potinho
 * (0 = sem custo), ativo, ordem e a imagem. Os quatro itens já vêm da migração; criar e excluir ficam para a
 * etapa 2 (um item com encomenda nunca se apaga: desative-o). Mudar o preço NÃO altera as encomendas já feitas
 * (nome e preço ficam congelados nelas).
 */

export type AdicionalAdminDTO = {
  id: string;
  nome: string;
  descricao: string;
  /** Centavos por potinho; 0 = sem custo. */
  precoCentavos: number;
  ativo: boolean;
  ordem: number;
  /** Foto enviada pela dona ("/fotos/<id>"); `null` = a loja mostra a ilustração padrão. */
  imagemUrl: string | null;
  /** Encomendas que já usam este item (com alguma, ele só pode ser desativado). */
  encomendas: number;
  atualizadoEm: string;
};

type Foto = { tipo: TipoFoto; dados: Uint8Array<ArrayBuffer> };

const comContagem = { _count: { select: { encomendas: true } } } satisfies Prisma.MimoAdicionalInclude;
type ComContagem = Prisma.MimoAdicionalGetPayload<{ include: typeof comContagem }>;

function paraDTO(a: ComContagem): AdicionalAdminDTO {
  return {
    id: a.id,
    nome: a.nome,
    descricao: a.descricao,
    precoCentavos: a.precoPorPotinho.mul(100).toNumber(),
    ativo: a.ativo,
    ordem: a.ordem,
    imagemUrl: a.imagemUrl,
    encomendas: a._count.encomendas,
    atualizadoEm: a.atualizadoEm.toISOString(),
  };
}

/** A página /mimos lê os itens em cache (tag "lembrancinhas"): depois de mudar, expira na hora. */
function atualizarLoja(): void {
  revalidateTag("lembrancinhas", { expire: 0 });
}

export async function listarAdicionaisAdmin(): Promise<AdicionalAdminDTO[]> {
  const itens = await db.mimoAdicional.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }], include: comContagem });
  return itens.map(paraDTO);
}

type Lido = { ok: true; dados: AdicionalAdminEntrada; foto: Foto | null } | { ok: false; resposta: Response };

/** Campos e foto do formulário multipart. A foto é conferida pelos primeiros bytes, não pelo nome. */
export async function lerAdicionalDoFormulario(form: FormData): Promise<Lido> {
  const campo = (nome: string) => {
    const valor = form.get(nome);
    return typeof valor === "string" ? valor : undefined;
  };
  const lido = adicionalAdminSchema.safeParse({
    nome: campo("nome"),
    descricao: campo("descricao"),
    precoCentavos: campo("precoCentavos"),
    ativo: campo("ativo"),
    ordem: campo("ordem"),
    removerFoto: campo("removerFoto"),
  });
  if (!lido.success) return { ok: false, resposta: erroDeValidacao(lido.error) };

  const arquivo = form.get("foto");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: true, dados: lido.data, foto: null };
  if (arquivo.size > MAX_BYTES_FOTO) {
    return { ok: false, resposta: erro(413, "A imagem pode ter no máximo 2 MB.", { foto: ["A imagem pode ter no máximo 2 MB."] }) };
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoDaImagem(dados);
  if (!tipo) {
    return { ok: false, resposta: erro(400, "A imagem precisa ser JPG, PNG ou WebP.", { foto: ["A imagem precisa ser JPG, PNG ou WebP."] }) };
  }
  return { ok: true, dados: lido.data, foto: { tipo, dados } };
}

const novoIdDeFoto = () => randomUUID().replaceAll("-", "");

/**
 * Edita um item. Imagem nova: substitui a anterior (as antigas saem junto); `removerFoto` (sem imagem nova)
 * volta à ilustração padrão. O id da foto é novo a cada envio, então o endereço pode ficar em cache para sempre.
 */
export async function atualizarAdicional(id: string, entrada: AdicionalAdminEntrada, foto: Foto | null): Promise<AdicionalAdminDTO> {
  const atual = await db.mimoAdicional.findUnique({ where: { id }, select: { id: true } });
  if (!atual) throw new ErroNegocio(404, "Item adicional não encontrado.");

  const fotoId = foto ? novoIdDeFoto() : null;
  const campos = {
    nome: entrada.nome,
    descricao: entrada.descricao,
    precoPorPotinho: new Prisma.Decimal(entrada.precoCentavos).div(100),
    ativo: entrada.ativo,
    ordem: entrada.ordem,
  };
  const atualizar = db.mimoAdicional.update({
    where: { id },
    data:
      foto && fotoId
        ? { ...campos, imagemUrl: `/fotos/${fotoId}`, fotos: { create: { id: fotoId, tipo: foto.tipo, dados: foto.dados } } }
        : entrada.removerFoto
          ? { ...campos, imagemUrl: null }
          : campos,
    include: comContagem,
  });
  const apagarFotos = fotoId || entrada.removerFoto;
  const atualizado = apagarFotos
    ? // A transação apaga as fotos antigas ANTES de criar a nova (a nova entra pelo `update`, depois do deleteMany).
      (await db.$transaction([db.mimoAdicionalFoto.deleteMany({ where: { adicionalId: id } }), atualizar]))[1]
    : await atualizar;
  atualizarLoja();
  return paraDTO(atualizado);
}

/** Mostra ou oculta o item (as encomendas já feitas não mudam). */
export async function definirAtivoDoAdicional(id: string, ativo: boolean): Promise<AdicionalAdminDTO> {
  try {
    const atualizado = await db.mimoAdicional.update({ where: { id }, data: { ativo }, include: comContagem });
    atualizarLoja();
    return paraDTO(atualizado);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw new ErroNegocio(404, "Item adicional não encontrado.");
    throw e;
  }
}
