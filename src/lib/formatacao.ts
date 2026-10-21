import type { StatusPedido } from "@/lib/status";

const formatadorData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026-10-13T22:40:00.000Z" → "13/10/2026, 19:40" (horário de Brasília). */
export function formatarDataHora(iso: string): string {
  return formatadorData.format(new Date(iso));
}

/** Código curto e legível do pedido, ex.: "#9F3K2XQP". */
export function codigoPedido(id: string): string {
  return `#${id.slice(-8).toUpperCase()}`;
}

/** Rótulos em português. `Record<StatusPedido, …>` obriga a cobrir todo status novo. */
export const ROTULO_STATUS: Record<StatusPedido, string> = {
  PENDENTE: "Pendente",
  PAGO: "Pago",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

export type StatusPedidoChave = StatusPedido;

/**
 * O que foi comprado, numa linha: "2 × Pimenta, 112g · 1 × Kit Presente". Corta em `max` caracteres
 * com "…" (Meus pedidos e a ficha do cliente no painel).
 */
export function resumoDoPedido(linhas: readonly { nome: string; quantidade: number }[], max = 120): string {
  const texto = linhas.map((l) => `${l.quantidade} × ${l.nome}`).join(" · ");
  return texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;
}
