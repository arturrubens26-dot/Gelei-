"use client";

import { acoesCarrinho } from "@/lib/carrinho/store";
import type { ProdutoDTO } from "@/lib/produtos";
import { useCarrinhoUI } from "./contexto";

/**
 * "Adicionar ao Carrinho": coloca o produto no carrinho e abre o carrinho lateral.
 * O nome acessível CONTÉM o texto visível (WCAG 2.5.3, "rótulo no nome"): quem usa comando de
 * voz diz "Adicionar ao Carrinho"; o nome do produto vai em texto só para leitores de tela.
 */
export function BotaoAdicionar({ produto }: { produto: ProdutoDTO }) {
  const { abrir } = useCarrinhoUI();

  return (
    <button
      type="button"
      className="btn-primario w-full"
      onClick={() => {
        acoesCarrinho.adicionar({
          productId: produto.id,
          nome: produto.nome,
          preco: produto.preco,
          pesoGramas: produto.pesoGramas,
          imagemUrl: produto.imagemUrl,
        });
        abrir();
      }}
    >
      Adicionar ao Carrinho<span className="sr-only">: {produto.nome}</span>
    </button>
  );
}
