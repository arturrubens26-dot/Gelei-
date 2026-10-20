/**
 * Conversa entre o formulário da tela /login e o pote animado ao lado, sem um conhecer o outro:
 * o formulário dispara este evento (borbulhando até o <main>) e o pote, que escuta o <main>,
 * reage — balança "não" num erro e dá um pulinho quando o login dá certo.
 */
export const EVENTO_RESULTADO_LOGIN = "geleio:resultado-login";

export type ResultadoLogin = "erro" | "sucesso";

export function avisarResultadoLogin(origem: Element, resultado: ResultadoLogin) {
  origem.dispatchEvent(new CustomEvent<ResultadoLogin>(EVENTO_RESULTADO_LOGIN, { bubbles: true, detail: resultado }));
}

/** Animações disparadas por JS (Web Animations) não passam pela regra de reduzir movimento do CSS. */
export function movimentoReduzido() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
