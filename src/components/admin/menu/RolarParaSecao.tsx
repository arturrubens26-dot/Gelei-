"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Atalhos do menu para uma parte da página (`?secao=kits` leva a `id="secao-kits"`): rola até ela e
 * leva o foco para lá (o leitor de tela anuncia onde chegou). A parte precisa de `tabIndex={-1}`.
 * Fica dentro de <Suspense> (lê a consulta da página) e não desenha nada.
 */
export function RolarParaSecao() {
  const secao = useSearchParams().get("secao");
  useEffect(() => {
    if (!secao) return;
    const alvo = document.getElementById(`secao-${secao}`);
    if (!alvo) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    alvo.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" });
    alvo.focus({ preventScroll: true });
  }, [secao]);
  return null;
}
