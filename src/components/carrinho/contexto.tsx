"use client";

import { createContext, useContext } from "react";

type ContextoCarrinhoUI = {
  aberto: boolean;
  abrir: () => void;
  fechar: () => void;
};

export const ContextoCarrinhoUI = createContext<ContextoCarrinhoUI | null>(null);

/** Controla só a abertura do carrinho lateral; os itens vivem em lib/carrinho/store. */
export function useCarrinhoUI(): ContextoCarrinhoUI {
  const contexto = useContext(ContextoCarrinhoUI);
  if (!contexto) throw new Error("useCarrinhoUI precisa estar dentro de <CarrinhoProvider>.");
  return contexto;
}
