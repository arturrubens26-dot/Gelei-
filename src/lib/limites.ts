/** Limites de negócio compartilhados entre servidor e navegador (módulo puro). */

/** Quantidade máxima do mesmo produto por pedido. */
export const MAX_POR_PRODUTO = 99;

/** Endereços salvos manualmente por usuário (POST /api/addresses). */
export const MAX_ENDERECOS_POR_USUARIO = 10;

/** Pedidos aguardando pagamento por usuário (evita encher o banco de pedidos abandonados). */
export const MAX_PEDIDOS_PENDENTES = 20;

/** O bcrypt só considera os primeiros 72 BYTES da senha (acentos ocupam mais de 1). */
export const MAX_BYTES_SENHA = 72;

/** Tamanho mínimo da senha (cadastro e redefinição; o AuthForm usa o mesmo número). */
export const MIN_CARACTERES_SENHA = 8;

/** Caixas de kit por pedido (soma das quantidades de todas as linhas de kit). */
export const MAX_KITS_POR_PEDIDO = 20;

/** Linhas de kit (composições diferentes) por pedido. */
export const MAX_LINHAS_DE_KIT = 20;

/**
 * Potes numa caixa de kit: teto da validação de entrada (o kit atual leva 3; a CHECK do banco aceita
 * de 2 a 6). A soma exata quem confere é `conferirComposicao`, com os potes do kit lidos do banco.
 */
export const MAX_POTES_POR_KIT = 6;
