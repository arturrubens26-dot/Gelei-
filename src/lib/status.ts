/** Regras de status de pedido. Módulo puro: usado no servidor e no navegador. */

export const TODOS_STATUS = ["PENDENTE", "PAGO", "ENVIADO", "ENTREGUE", "CANCELADO"] as const;

export type StatusPedido = (typeof TODOS_STATUS)[number];

/**
 * Pedidos que contam como venda paga: do pagamento em diante, exceto cancelados.
 * Inclui ENVIADO de propósito — o pedido já foi pago; se ficasse de fora, o
 * faturamento cairia ao marcar um pedido como enviado.
 */
export const STATUS_PAGOS = ["PAGO", "ENVIADO", "ENTREGUE"] as const satisfies readonly StatusPedido[];

/** Mudanças de status permitidas a partir de cada status (não se pulam etapas). */
export const TRANSICOES: Record<StatusPedido, readonly StatusPedido[]> = {
  PENDENTE: ["PAGO", "CANCELADO"],
  PAGO: ["ENVIADO", "CANCELADO"],
  ENVIADO: ["ENTREGUE"],
  ENTREGUE: [],
  CANCELADO: [],
};

/**
 * Venda presencial (feira, balcão): nasce PAGA ou ENTREGUE e não tem envio. Pode ser cancelada
 * mesmo depois de entregue, para estornar um lançamento errado (o banco recusa PENDENTE/ENVIADO).
 */
export const TRANSICOES_PRESENCIAL: Record<StatusPedido, readonly StatusPedido[]> = {
  PENDENTE: [],
  PAGO: ["ENTREGUE", "CANCELADO"],
  ENVIADO: [],
  ENTREGUE: ["CANCELADO"],
  CANCELADO: [],
};

/** Próximos status possíveis conforme o canal do pedido (usado no PATCH e nos botões da tabela). */
export function transicoesPermitidas(status: StatusPedido, canal: "ONLINE" | "PRESENCIAL"): readonly StatusPedido[] {
  return canal === "PRESENCIAL" ? TRANSICOES_PRESENCIAL[status] : TRANSICOES[status];
}
