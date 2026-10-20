import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";

export type ProdutoDTO = {
  id: string;
  nome: string;
  descricao: string;
  /** Preço em reais. */
  preco: number;
  imagemUrl: string;
  pesoGramas: number;
};

/**
 * Catálogo. Fica em cache (`use cache`) para a loja prerenderizar; quando o
 * admin editar produtos, invalide com a tag "produtos".
 * Devolve objetos simples (Decimal vira number) para poderem ser cacheados.
 */
export async function listarProdutos(): Promise<ProdutoDTO[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("produtos");

  // Só os visíveis: produto oculto pelo painel some da vitrine (o histórico continua no banco).
  const produtos = await db.product.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } });
  return produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    preco: p.preco.toNumber(),
    imagemUrl: p.imagemUrl,
    pesoGramas: p.pesoGramas,
  }));
}
