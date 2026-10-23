import { ROTULO_STATUS_ENCOMENDA, type StatusEncomenda } from "@/lib/encomendas-regras";

// Mesmo desenho da EtiquetaStatus dos pedidos: texto vinho sobre fundo claro (contraste alto); a borda e
// o fundo diferenciam o estado, e o rótulo diz o estado por extenso.
const ESTILO: Record<StatusEncomenda, string> = {
  SOLICITADA: "border-accent2 bg-accent2/20",
  AGUARDANDO_ENTRADA: "border-secundaria bg-accent1/40",
  CONFIRMADA: "border-accent3 bg-accent3/20",
  EM_PRODUCAO: "border-accent3 bg-accent3/20",
  PRONTA: "border-accent3 bg-accent3/35",
  ENTREGUE: "border-accent3 bg-accent3/35",
  RECUSADA: "border-primaria/40 bg-primaria/5",
  EXPIRADA: "border-primaria/40 bg-primaria/5",
  CANCELADA: "border-primaria/40 bg-primaria/10 line-through decoration-1",
};

/** Selo do status da encomenda (use sempre o `statusEfetivo`). */
export function SeloDaEncomenda({ status }: { status: StatusEncomenda }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-bold text-primaria ${ESTILO[status]}`}>
      {ROTULO_STATUS_ENCOMENDA[status]}
    </span>
  );
}
