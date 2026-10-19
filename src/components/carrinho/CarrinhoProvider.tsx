"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { CarrinhoLateral } from "./CarrinhoLateral";
import { ContextoCarrinhoUI } from "./contexto";

export function CarrinhoProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const abrir = useCallback(() => setAberto(true), []);
  const fechar = useCallback(() => setAberto(false), []);
  const valor = useMemo(() => ({ aberto, abrir, fechar }), [aberto, abrir, fechar]);

  return (
    <ContextoCarrinhoUI value={valor}>
      {children}
      <CarrinhoLateral />
    </ContextoCarrinhoUI>
  );
}
