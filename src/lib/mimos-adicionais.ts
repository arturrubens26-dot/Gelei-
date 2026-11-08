import "server-only";
import type { MimoAdicional } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Itens adicionais dos mimos, lado da loja (leitura): o catálogo ATIVO que a cliente vê no formulário e que o
 * servidor usa para conferir a solicitação. O cadastro pelo painel fica em mimos-adicionais-admin.ts; as regras
 * puras, em adicionais-regras.ts.
 */

/** Um item à venda, como a página /mimos o mostra. Dinheiro em reais e em centavos (a conta da tela é em centavos). */
export type AdicionalPublicoDTO = {
  id: string;
  nome: string;
  descricao: string;
  /** Reais por potinho (0 = sem custo). */
  precoPorPotinho: number;
  precoCentavos: number;
  /** "/fotos/<id>" da foto enviada pela dona; `null` = a loja desenha a ilustração padrão. */
  imagemUrl: string | null;
};

/** Centavos inteiros a partir do Decimal (sem passar por float). */
export const centavosDe = (valor: MimoAdicional["precoPorPotinho"]): number => valor.mul(100).toNumber();

export function paraAdicionalPublico(a: Pick<MimoAdicional, "id" | "nome" | "descricao" | "precoPorPotinho" | "imagemUrl">): AdicionalPublicoDTO {
  const precoCentavos = centavosDe(a.precoPorPotinho);
  return { id: a.id, nome: a.nome, descricao: a.descricao, precoPorPotinho: precoCentavos / 100, precoCentavos, imagemUrl: a.imagemUrl };
}

/** Os itens ativos, na ordem do painel (ordem, depois nome). Sem cache: quem grava ou cobra lê daqui. */
export async function listarAdicionaisAtivos(): Promise<AdicionalPublicoDTO[]> {
  const itens = await db.mimoAdicional.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }, { id: "asc" }],
    select: { id: true, nome: true, descricao: true, precoPorPotinho: true, imagemUrl: true },
  });
  return itens.map(paraAdicionalPublico);
}

/** Foto enviada pelo painel para um item adicional (rota /fotos/<id>). */
export async function lerFotoDoAdicional(id: string): Promise<{ tipo: string; dados: Uint8Array<ArrayBuffer> } | null> {
  return db.mimoAdicionalFoto.findUnique({ where: { id }, select: { tipo: true, dados: true } });
}
