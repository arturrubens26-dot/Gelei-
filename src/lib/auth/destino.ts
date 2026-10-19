/**
 * Só aceita caminhos internos como destino pós-login. Bloqueia URLs externas e também as
 * variações que os navegadores "consertam" sozinhos: `//host`, `/\host` e caminhos com TAB,
 * CR ou LF (`/<TAB>/host` vira `//host` quando o navegador remove o TAB — open redirect).
 */
const CAMINHO_INTERNO = /^\/(?![/\\])[^\u0000-\u001f\u007f\\]*$/;

export function destinoSeguro(destino: string | string[] | undefined, padrao = "/"): string {
  const valor = Array.isArray(destino) ? destino[0] : destino;
  if (!valor || !CAMINHO_INTERNO.test(valor)) return padrao;
  // Confere de verdade: resolvido contra um host fictício, tem de continuar nele.
  try {
    if (new URL(valor, "http://interno.invalid").origin !== "http://interno.invalid") return padrao;
  } catch {
    return padrao;
  }
  return valor;
}
