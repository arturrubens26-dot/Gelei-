/**
 * Contrato e regras puras do pagamento (servidor e navegador; sem rede e sem banco), testados em
 * testes/pagamentos-regras.test.ts. Quem fala com a InfinitePay é src/lib/infinitepay.ts; quem grava
 * no banco é src/lib/pagamentos.ts.
 */
import type { StatusPedido } from "@/lib/status";

/** Situação de uma cobrança, do nosso lado (enum PaymentStatus do banco). */
export type StatusCobranca = "PENDENTE" | "APROVADO" | "CANCELADO" | "RECUSADO" | "ESTORNADO";

/** Como a cliente pagou no checkout da InfinitePay (`capture_method`). */
export type MetodoPagamento = "pix" | "credit_card";
export const METODOS_PAGAMENTO = ["pix", "credit_card"] as const satisfies readonly MetodoPagamento[];

/** O que a tela do pedido mostra (ver `etapaDoPagamento`). */
export type EtapaPagamento = "PAGAR" | "CONFIRMANDO" | "PAGO" | "EXPIRADO" | "CANCELADO" | "INDISPONIVEL";

/** O que a cliente vê de uma cobrança (sem ids internos nem dados da transação). */
export type CobrancaDTO = {
  gateway: "infinitepay" | "simulado";
  status: StatusCobranca;
  /** Reais: o total do pedido quando o link foi aberto. */
  valor: number;
  /** ISO: validade do link. */
  expiraEm: string;
  /** https em *.infinitepay.io; null no simulado ou quando o link não vale mais. */
  checkoutUrl: string | null;
  metodo: MetodoPagamento | null;
  parcelas: number | null;
  /** Reais; pode ser maior que `valor` (juros do parcelado, pagos pela cliente). */
  valorPago: number | null;
  /** Só https em *.infinitepay.io. */
  comprovanteUrl: string | null;
};

/** GET /api/orders/[id]/pagamento e `obterSituacaoPagamento` (página do pedido). */
export type SituacaoPagamentoDTO = {
  pedidoStatus: StatusPedido;
  etapa: EtapaPagamento;
  /** ISO: createdAt + 48 h (só quando o pedido está PENDENTE). */
  pagarAte: string | null;
  /** A mais recente. */
  cobranca: CobrancaDTO | null;
};

/** Alerta do painel: dinheiro que entrou e precisa ser devolvido pelo app InfinitePay. */
export type AlertaPagamento = "PAGO_APOS_CANCELAMENTO" | "PAGO_EM_DOBRO";

/** Resumo do pagamento na lista e na ficha do painel (`PedidoAdminDTO.pagamento`). */
export type PagamentoAdminDTO = {
  metodo: MetodoPagamento | null;
  parcelas: number | null;
  valorPago: number | null;
  alerta: AlertaPagamento | null;
};

/** Uma linha de "Meus pedidos" (`listarPedidosDoUsuario`, em @/lib/pedidos). */
export type PedidoResumoDTO = {
  id: string;
  /** "#A1B2C3" (codigoPedido). */
  codigo: string;
  /** ISO. */
  createdAt: string;
  status: StatusPedido;
  etapa: EtapaPagamento;
  /** Reais. */
  total: number;
  modoEntrega: "ENTREGA" | "RETIRADA";
  /** "2 × Pimenta, 112g · 1 × Kit Presente" (cortado em ~120 caracteres com "…"). */
  resumo: string;
};

/** Validade de cada link de pagamento (`valid_until`). */
export const VALIDADE_DO_LINK_MS = 60 * 60_000;
/** O pedido pendente pode ser pago por até 48 h depois de criado; depois disso, "expirou". */
export const PRAZO_PARA_PAGAR_MS = 48 * 60 * 60_000;
/** Depois de um retorno ou aviso (candidato gravado), quanto tempo a tela fica em "confirmando". */
export const JANELA_CONFIRMANDO_MS = 30 * 60_000;
/** `assured_installments`: até quantas parcelas a loja absorve os juros (0 = a cliente paga os juros). */
export const PARCELAS_SEM_JUROS = 0;
/** Máximo de parcelas no cartão (InfinitePay). */
export const MAX_PARCELAS = 12;

const ms = (data: Date | string) => (typeof data === "string" ? new Date(data).getTime() : data.getTime());

/** Fim do prazo para pagar o pedido (createdAt + 48 h). */
export function pagarAteDe(criadoEm: Date | string): Date {
  return new Date(ms(criadoEm) + PRAZO_PARA_PAGAR_MS);
}

/** O pedido pendente passou do prazo para pagar? (Não muda o status: só não abre link novo.) */
export function pedidoExpirado(criadoEm: Date | string, agora: number = Date.now()): boolean {
  return agora > ms(criadoEm) + PRAZO_PARA_PAGAR_MS;
}

export type EntradaEtapa = {
  /** `pagamentoOnlineDisponivel()` agora. */
  gatewayAtivo: boolean;
  pedidoStatus: StatusPedido;
  pedidoCriadoEm: Date | string;
  /** A cobrança mais recente do pedido. */
  ultimaCobranca: {
    status: StatusCobranca;
    /** Quando chegou o último candidato (aviso com token ou retorno), ainda não conferido. */
    avisadoEm: Date | string | null;
  } | null;
  agora?: number;
};

/**
 * Etapa mostrada à cliente, na ordem:
 * 1. pedido PAGO, ENVIADO ou ENTREGUE → PAGO; CANCELADO → CANCELADO;
 * 2. pedido PENDENTE com o gateway desligado → INDISPONIVEL;
 * 3. última cobrança aberta com candidato gravado há menos de 30 min → CONFIRMANDO (vem antes do
 *    prazo: quem pagou no fim das 48 h não vê "expirou" enquanto a conferência anda);
 * 4. mais de 48 h desde o pedido → EXPIRADO;
 * 5. o resto → PAGAR.
 */
export function etapaDoPagamento(e: EntradaEtapa): EtapaPagamento {
  if (e.pedidoStatus === "PAGO" || e.pedidoStatus === "ENVIADO" || e.pedidoStatus === "ENTREGUE") return "PAGO";
  if (e.pedidoStatus === "CANCELADO") return "CANCELADO";
  if (!e.gatewayAtivo) return "INDISPONIVEL";
  const agora = e.agora ?? Date.now();
  const c = e.ultimaCobranca;
  if (c && c.avisadoEm && (c.status === "PENDENTE" || c.status === "CANCELADO")) {
    const desde = agora - ms(c.avisadoEm);
    if (desde >= 0 && desde < JANELA_CONFIRMANDO_MS) return "CONFIRMANDO";
  }
  if (pedidoExpirado(e.pedidoCriadoEm, agora)) return "EXPIRADO";
  return "PAGAR";
}

/** O que o painel precisa saber das cobranças APROVADAS de um pedido (as outras não importam aqui). */
export type EntradaPagamentoAdmin = {
  pedidoStatus: StatusPedido;
  /** Quando a dona cancelou (orders.cancelado_em); null nos pedidos cancelados antes de existir o registro. */
  canceladoEm: Date | string | null;
  /** Cobranças APROVADAS, da mais antiga para a mais nova (aprovadoEm). */
  aprovadas: {
    metodo: string | null;
    parcelas: number | null;
    /** Reais. */
    valorPago: number | null;
    aprovadoEm: Date | string | null;
  }[];
};

/**
 * Dinheiro que entrou e precisa ser devolvido pelo app InfinitePay:
 * - PAGO_APOS_CANCELAMENTO: pedido CANCELADO com cobrança aprovada depois do cancelamento (sem a hora
 *   do cancelamento, não dá para saber a ordem: alerta por segurança). Pedido pago e DEPOIS cancelado
 *   pela dona não tem alerta: o próprio cancelamento já avisou para devolver.
 * - PAGO_EM_DOBRO: mais de uma cobrança aprovada no mesmo pedido.
 */
export function alertaDoPagamento(e: EntradaPagamentoAdmin): AlertaPagamento | null {
  if (e.aprovadas.length === 0) return null;
  if (e.pedidoStatus === "CANCELADO") {
    const cancelado = e.canceladoEm === null ? null : ms(e.canceladoEm);
    if (cancelado === null || e.aprovadas.some((a) => a.aprovadoEm === null || ms(a.aprovadoEm) >= cancelado)) {
      return "PAGO_APOS_CANCELAMENTO";
    }
  }
  if (e.aprovadas.length > 1) return "PAGO_EM_DOBRO";
  return null;
}

/** `PedidoAdminDTO.pagamento`: método e valor da PRIMEIRA cobrança aprovada, mais o alerta. Sem cobrança aprovada: null. */
export function pagamentoAdminDe(e: EntradaPagamentoAdmin): PagamentoAdminDTO | null {
  const primeira = e.aprovadas[0];
  if (!primeira) return null;
  return {
    metodo: primeira.metodo === "pix" || primeira.metodo === "credit_card" ? primeira.metodo : null,
    parcelas: primeira.parcelas,
    valorPago: primeira.valorPago,
    alerta: alertaDoPagamento(e),
  };
}

/** "PIX", "Cartão à vista", "Cartão em 3x" (painel e confirmação). */
export function rotuloDoMetodo(metodo: MetodoPagamento | null, parcelas: number | null): string | null {
  if (metodo === "pix") return "PIX";
  if (metodo === "credit_card") return parcelas && parcelas > 1 ? `Cartão em ${parcelas}x` : "Cartão à vista";
  return null;
}
