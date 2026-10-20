import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";

/** Kit à venda na loja (a caixa é desenhada na tela, com as fotos reais dos sabores escolhidos). */
export type KitDTO = {
  id: string;
  nome: string;
  descricao: string;
  /** Preço de UMA caixa, em reais. */
  preco: number;
  /** Quantos potes vão na caixa. */
  potes: number;
  /** Peso da caixa vazia (somado ao dos potes no frete). */
  pesoCaixaGramas: number;
};

/**
 * Kits visíveis na loja. Fica em cache (`use cache`) como o catálogo de produtos; o painel expira
 * na hora com a tag "kits" ao editar ou mostrar/ocultar. Lista vazia = sem kit à venda (a loja
 * esconde o link "Kits" e a página mostra "Os kits voltam em breve").
 */
export async function listarKits(): Promise<KitDTO[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("kits");

  const kits = await db.kit.findMany({ where: { ativo: true }, orderBy: [{ preco: "asc" }, { id: "asc" }] });
  return kits.map((k) => ({
    id: k.id,
    nome: k.nome,
    descricao: k.descricao,
    preco: k.preco.toNumber(),
    potes: k.potes,
    pesoCaixaGramas: k.pesoCaixaGramas,
  }));
}
