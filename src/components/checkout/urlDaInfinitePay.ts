/**
 * Segunda trava (o servidor já confere o host): só seguimos para um link de pagamento, ou mostramos
 * um comprovante, em https na InfinitePay. Com o site aberto em localhost, aceita também o servidor
 * falso local em http (testes/infinitepay-falso.mjs).
 */
const ehLocal = (host: string) => host === "localhost" || host === "127.0.0.1";

export function urlDaInfinitePay(url: unknown, siteLocal = false): url is string {
  if (typeof url !== "string" || url.length > 500) return false;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && (u.hostname === "infinitepay.io" || u.hostname.endsWith(".infinitepay.io"))) return true;
    return siteLocal && u.protocol === "http:" && ehLocal(u.hostname);
  } catch {
    return false;
  }
}

/** O site está rodando em localhost? (Só no navegador; no servidor, falso.) */
export function siteEmLocalhost(): boolean {
  return typeof window !== "undefined" && ehLocal(window.location.hostname);
}
