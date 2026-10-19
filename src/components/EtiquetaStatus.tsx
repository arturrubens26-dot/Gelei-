import { ROTULO_STATUS, type StatusPedidoChave } from "@/lib/formatacao";

// Texto sempre vinho sobre fundos claros (contraste alto); a cor da borda e
// do fundo diferencia o estado, e o texto do rótulo diz o estado por extenso.
const ESTILO: Record<StatusPedidoChave, string> = {
  PENDENTE: "border-accent2 bg-accent2/20",
  PAGO: "border-accent3 bg-accent3/20",
  ENVIADO: "border-secundaria bg-accent1/40",
  ENTREGUE: "border-accent3 bg-accent3/35",
  CANCELADO: "border-primaria/40 bg-primaria/10 line-through decoration-1",
};

export function EtiquetaStatus({ status }: { status: StatusPedidoChave }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold text-primaria ${ESTILO[status]}`}>
      {ROTULO_STATUS[status]}
    </span>
  );
}
