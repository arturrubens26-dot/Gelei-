/**
 * Chave única por tentativa de compra ou solicitação (cabeçalho Idempotency-Key). `randomUUID` só
 * existe em contexto seguro (HTTPS/localhost); fora dele, uma chave aleatória no mesmo formato aceito.
 */
export function novaChave(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  );
}
