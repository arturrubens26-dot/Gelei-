"use client";

import { totaisDoCarrinho, useCarrinho } from "@/lib/carrinho/store";
import { useCarrinhoUI } from "./contexto";

/** Botão do cabeçalho que abre o carrinho lateral e mostra a quantidade de itens. */
export function BotaoCarrinho() {
  const { abrir } = useCarrinhoUI();
  const { quantidadeTotal } = totaisDoCarrinho(useCarrinho());

  return (
    <button
      type="button"
      onClick={abrir}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-2 border-accent2 bg-destaque px-3 text-primaria transition hover:bg-accent1/30"
      aria-label={
        quantidadeTotal === 0
          ? "Abrir carrinho (vazio)"
          : `Abrir carrinho (${quantidadeTotal} ${quantidadeTotal === 1 ? "item" : "itens"})`
      }
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.76L19.5 8H6.2" />
        <circle cx="9" cy="19.5" r="1.3" />
        <circle cx="17" cy="19.5" r="1.3" />
      </svg>
      {quantidadeTotal > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-secundaria px-1 text-xs font-bold text-destaque"
          aria-hidden="true"
        >
          {quantidadeTotal}
        </span>
      )}
    </button>
  );
}
