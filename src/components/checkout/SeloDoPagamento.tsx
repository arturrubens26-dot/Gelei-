import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import type { EtapaPagamento } from "@/lib/pagamentos-regras";
import type { StatusPedido } from "@/lib/status";

/** O que falta no pedido pendente (texto curto do selo). */
export const ROTULO_ETAPA_PENDENTE: Record<EtapaPagamento, string> = {
  PAGAR: "Falta pagar",
  CONFIRMANDO: "Confirmando o pagamento",
  EXPIRADO: "Prazo para pagar terminou",
  INDISPONIVEL: "Aguardando pagamento",
  PAGO: "Pago",
  CANCELADO: "Cancelado",
};

// Mesmo desenho da EtiquetaStatus: texto vinho sobre fundo claro; a borda e o fundo mudam com a etapa.
const ESTILO: Partial<Record<EtapaPagamento, string>> = {
  CONFIRMANDO: "border-secundaria bg-accent1/40",
  EXPIRADO: "border-primaria/40 bg-primaria/5",
  CANCELADO: "border-primaria/40 bg-primaria/5",
  PAGO: "border-accent3 bg-accent3/20",
};

/** Selo de uma etapa de pagamento, com o rótulo de cada tela (pedido pendente, parcela da encomenda). */
export function SeloDaEtapa({ etapa, rotulo }: { etapa: EtapaPagamento; rotulo: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold text-primaria ${
        ESTILO[etapa] ?? "border-accent2 bg-accent2/20"
      }`}
    >
      {rotulo}
    </span>
  );
}

/**
 * Selo do pedido para a cliente: pago, enviado, entregue ou cancelado mostram o status do pedido;
 * o pendente mostra em que pé está o pagamento (falta pagar, confirmando, prazo terminou).
 */
export function SeloDoPagamento({ status, etapa }: { status: StatusPedido; etapa: EtapaPagamento }) {
  if (status !== "PENDENTE") return <EtiquetaStatus status={status} />;
  return <SeloDaEtapa etapa={etapa} rotulo={ROTULO_ETAPA_PENDENTE[etapa]} />;
}
