/** Limites de negócio compartilhados entre servidor e navegador (módulo puro). */

/** Quantidade máxima do mesmo produto por pedido. */
export const MAX_POR_PRODUTO = 99;

/** Endereços salvos manualmente por usuário (POST /api/addresses). */
export const MAX_ENDERECOS_POR_USUARIO = 10;

/** Pedidos aguardando pagamento por usuário (evita encher o banco de pedidos abandonados). */
export const MAX_PEDIDOS_PENDENTES = 20;

/** O bcrypt só considera os primeiros 72 BYTES da senha (acentos ocupam mais de 1). */
export const MAX_BYTES_SENHA = 72;
