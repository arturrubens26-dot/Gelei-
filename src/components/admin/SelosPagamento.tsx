import { rotuloDoMetodo, type AlertaPagamento, type PagamentoAdminDTO } from "@/lib/pagamentos-regras";
import type { StatusPedido } from "@/lib/status";

/**
 * O que o painel sabe do pagamento online de um pedido (`PedidoAdminDTO` e `PedidoAdminDetalheDTO`,
 * contrato 7.3/12.1). Opcional aqui para a tela funcionar antes e depois de o backend mandar os campos.
 */
export type PagamentoDoPedidoAdmin = {
  /** Pendente há mais de 48 h: a cliente já não consegue abrir o pagamento. */
  expirado?: boolean;
  pagamento?: PagamentoAdminDTO | null;
};

/**
 * Dinheiro que precisa da dona: devolver pelo app InfinitePay (pago após o cancelamento, em dobro) ou
 * conferir no app antes de marcar como pago (divergência de valor, método ou parcelas).
 */
export const ROTULO_ALERTA: Record<AlertaPagamento, string> = {
  PAGO_APOS_CANCELAMENTO: "Pago após o cancelamento: devolver",
  PAGO_EM_DOBRO: "Pago em dobro: devolver",
  PAGO_COM_DIVERGENCIA: "Pago com divergência: conferir no app",
};

export const EXPLICACAO_ALERTA: Record<AlertaPagamento, string> = {
  PAGO_APOS_CANCELAMENTO:
    "A cliente pagou depois que o pedido foi cancelado. Confira no app InfinitePay e devolva o valor por lá.",
  PAGO_EM_DOBRO: "Este pedido recebeu dois pagamentos. Confira no app InfinitePay e devolva um deles por lá.",
  PAGO_COM_DIVERGENCIA:
    "A InfinitePay informou um pagamento, mas o valor, o método ou as parcelas não conferem, e o pedido continua pendente. Confira no app InfinitePay: se estiver tudo certo, marque o pedido como pago.",
};

const selo = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";

/**
 * Selos do pagamento ao lado do status: "Expirado" (pendente fora do prazo), o método ("PIX",
 * "Cartão em 3x") e o alerta de devolução, em Carmesim com texto Creme (≈ 5,9:1) para chamar atenção.
 */
export function SelosPagamento({ status, expirado, pagamento }: { status: StatusPedido } & PagamentoDoPedidoAdmin) {
  const vencido = status === "PENDENTE" && expirado === true;
  const metodo = pagamento ? rotuloDoMetodo(pagamento.metodo, pagamento.parcelas) : null;
  const alerta = pagamento?.alerta ?? null;
  if (!vencido && !metodo && !alerta) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {vencido && (
        <span className={`${selo} border-primaria/40 bg-primaria/5 text-primaria`} title="Pendente há mais de 48 horas: a cliente não consegue mais pagar.">
          Expirado
        </span>
      )}
      {metodo && <span className={`${selo} border-accent3 bg-accent3/15 text-primaria`}>{metodo}</span>}
      {alerta && (
        <span className={`${selo} border-secundaria bg-secundaria font-bold text-destaque`}>
          <span aria-hidden="true" className="mr-1">!</span>
          {ROTULO_ALERTA[alerta]}
        </span>
      )}
    </span>
  );
}
