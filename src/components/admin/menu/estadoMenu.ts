"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CHAVE_MENU_FIXADO, LARGURA_MENU_FIXADO_PADRAO } from "@/components/admin/menu/scriptDoMenu";

const EVENTO = "painel-menu-fixado";
const CONSULTA = `(min-width:${LARGURA_MENU_FIXADO_PADRAO}px)`;

/** A escolha salva; sem escolha, o padrão por largura (o mesmo cálculo do script do <head>). */
export function lerFixado(): boolean {
  try {
    const guardado = localStorage.getItem(CHAVE_MENU_FIXADO);
    if (guardado === "1") return true;
    if (guardado === "0") return false;
  } catch {
    // Armazenamento bloqueado (janela privada, dados do site desligados): vale o padrão.
  }
  try {
    return window.matchMedia(CONSULTA).matches;
  } catch {
    return false;
  }
}

/**
 * Põe o estado no <html>, de onde o CSS o lê. O script do <head> faz o mesmo antes da primeira
 * pintura; isto só garante o valor quando a página abriu por navegação dentro do site (o script não
 * roda de novo) e acompanha mudanças feitas em outra aba.
 */
export function aplicarFixado(fixado: boolean) {
  document.documentElement.dataset.painelFixado = fixado ? "true" : "false";
}

export function guardarFixado(fixado: boolean) {
  try {
    localStorage.setItem(CHAVE_MENU_FIXADO, fixado ? "1" : "0");
  } catch {
    // Sem armazenamento a escolha vale só até recarregar.
  }
  aplicarFixado(fixado);
  window.dispatchEvent(new Event(EVENTO));
}

function assinar(avisar: () => void) {
  const consulta = window.matchMedia(CONSULTA);
  const mudou = () => {
    aplicarFixado(lerFixado());
    avisar();
  };
  consulta.addEventListener("change", mudou);
  window.addEventListener("storage", mudou);
  window.addEventListener(EVENTO, avisar);
  return () => {
    consulta.removeEventListener("change", mudou);
    window.removeEventListener("storage", mudou);
    window.removeEventListener(EVENTO, avisar);
  };
}

/** `[fixado, alternar]`. No servidor é `false`; a primeira pintura certa vem do atributo do <html>. */
export function useMenuFixado(): [boolean, () => void] {
  const fixado = useSyncExternalStore(assinar, lerFixado, () => false);
  const alternar = useCallback(() => guardarFixado(!lerFixado()), []);
  return [fixado, alternar];
}
