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

/**
 * Alerta do painel (um por pedido, na ordem de prioridade abaixo):
 * - PAGO_APOS_CANCELAMENTO e PAGO_EM_DOBRO: dinheiro que entrou e precisa ser devolvido pelo app;
 * - CONFIRMADO_APOS_BAIXA_MANUAL (informativo): a dona marcou PAGO à mão e depois a InfinitePay
 *   confirmou um pagamento do site; conferir no app se não foi pago duas vezes (por fora e pelo site);
 * - PAGO_COM_DIVERGENCIA: a InfinitePay diz "pago", mas o valor, o método ou as parcelas não
 *   conferem; o pedido NÃO virou PAGO. Conferir no app e marcar como pago ou cancelar (some ao resolver);
 * - AVISO_NAO_CONFERIDO: chegou o aviso de pagamento, mas há mais de 30 min a conferência não
 *   fecha (InfinitePay fora, chave recusada, resposta estranha). Conferir no app e marcar como pago
 *   ou cancelar (some ao resolver).
 */
export type AlertaPagamento =
  | "PAGO_APOS_CANCELAMENTO"
  | "PAGO_EM_DOBRO"
  | "CONFIRMADO_APOS_BAIXA_MANUAL"
  | "PAGO_COM_DIVERGENCIA"
  | "AVISO_NAO_CONFERIDO";

/** Prefixo de `pagamentos.status_gateway` quando a conferência achou divergência. */
export const MARCA_DIVERGENTE = "divergente:";
/** `status_gateway` da cobrança confirmada quando o pedido já tinha sido marcado PAGO à mão. */
export const MARCA_APOS_BAIXA_MANUAL = "pago-apos-baixa-manual";

const emAberto = (status: StatusCobranca) => status === "PENDENTE" || status === "CANCELADO";

/** Cobrança paga com divergência e ainda não resolvida (não aprovada). */
export function cobrancaDivergente(c: { status: StatusCobranca; statusGateway: string | null }): boolean {
  return emAberto(c.status) && Boolean(c.statusGateway?.startsWith(MARCA_DIVERGENTE));
}

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
  /** A cobrança que decide a etapa (`cobrancaParaEtapa`). */
  ultimaCobranca: {
    status: StatusCobranca;
    /** Quando chegou o candidato do aviso, ainda não conferido (null sem candidato gravado). */
    avisadoEm: Date | string | null;
    /** Quando a dona do pedido voltou da InfinitePay por esta cobrança. */
    retornoEm?: Date | string | null;
  } | null;
  /** Alguma cobrança do pedido foi paga com divergência (`cobrancaDivergente`). */
  pagamentoDivergente?: boolean;
  agora?: number;
};

/** Voltou da InfinitePay há menos de 30 min (sem confirmar nada: só segura a tela e o link novo). */
export function retornoRecente(retornoEm: Date | string | null | undefined, agora: number = Date.now()): boolean {
  if (!retornoEm) return false;
  const desde = agora - ms(retornoEm);
  return desde >= 0 && desde < JANELA_CONFIRMANDO_MS;
}

/** A cobrança está "em confirmação": tem candidato do aviso não resolvido ou retorno recente. */
export function cobrancaEmConfirmacao(
  c: { status: StatusCobranca; avisadoEm: Date | string | null; retornoEm?: Date | string | null },
  agora: number = Date.now(),
): boolean {
  return emAberto(c.status) && (c.avisadoEm !== null || retornoRecente(c.retornoEm, agora));
}

/**
 * Qual cobrança decide a etapa (lista da mais nova para a mais antiga): a mais recente em
 * confirmação (candidato do aviso, de qualquer idade, ou retorno recente); sem nenhuma, a mais
 * recente. Assim, um link novo aberto depois de pagar o anterior não esconde a confirmação.
 */
export function cobrancaParaEtapa<T extends { status: StatusCobranca; avisadoEm: Date | string | null; retornoEm?: Date | string | null }>(
  cobrancas: readonly T[],
  agora: number = Date.now(),
): T | null {
  return cobrancas.find((c) => cobrancaEmConfirmacao(c, agora)) ?? cobrancas[0] ?? null;
}

/**
 * Etapa mostrada à cliente, na ordem:
 * 1. pedido PAGO, ENVIADO ou ENTREGUE → PAGO; CANCELADO → CANCELADO;
 * 2. pago com divergência → CONFIRMANDO ("fale com a loja"), sem prazo;
 * 3. pedido PENDENTE com o gateway desligado → INDISPONIVEL;
 * 4. candidato do aviso ainda não resolvido, de QUALQUER idade (só sai quando a conferência o recusa
 *    de vez, ou quando a dona marca pago ou cancela), ou retorno do navegador há menos de 30 min →
 *    CONFIRMANDO. Vem antes do prazo: quem pagou no fim das 48 h não vê "expirou";
 * 5. mais de 48 h desde o pedido → EXPIRADO;
 * 6. o resto → PAGAR.
 * Com dinheiro possivelmente entrando, a tela NUNCA volta a "Pagar": isso evitaria um segundo pagamento.
 */
export function etapaDoPagamento(e: EntradaEtapa): EtapaPagamento {
  if (e.pedidoStatus === "PAGO" || e.pedidoStatus === "ENVIADO" || e.pedidoStatus === "ENTREGUE") return "PAGO";
  if (e.pedidoStatus === "CANCELADO") return "CANCELADO";
  if (e.pagamentoDivergente) return "CONFIRMANDO";
  if (!e.gatewayAtivo) return "INDISPONIVEL";
  const agora = e.agora ?? Date.now();
  if (e.ultimaCobranca && cobrancaEmConfirmacao(e.ultimaCobranca, agora)) return "CONFIRMANDO";
  if (pedidoExpirado(e.pedidoCriadoEm, agora)) return "EXPIRADO";
  return "PAGAR";
}

/** Uma cobrança como o painel a vê. */
export type CobrancaNoPainel = {
  status: StatusCobranca;
  statusGateway: string | null;
  metodo: string | null;
  parcelas: number | null;
  /** Reais. */
  valorPago: number | null;
  aprovadoEm: Date | string | null;
  /** Só com candidato do aviso gravado (senão null). */
  avisadoEm: Date | string | null;
};

/** O pedido e TODAS as cobranças dele (no máximo 10), para o painel. */
export type EntradaPagamentoAdmin = {
  pedidoStatus: StatusPedido;
  /** Quando a dona cancelou (orders.cancelado_em); null nos pedidos cancelados antes de existir o registro. */
  canceladoEm: Date | string | null;
  cobrancas: readonly CobrancaNoPainel[];
  agora?: number;
};

const aprovadasEmOrdem = (cobrancas: readonly CobrancaNoPainel[]) =>
  cobrancas
    .filter((c) => c.status === "APROVADO")
    .sort((a, b) => (a.aprovadoEm ? ms(a.aprovadoEm) : 0) - (b.aprovadoEm ? ms(b.aprovadoEm) : 0));

/**
 * O alerta do pedido no painel (ver `AlertaPagamento`). PAGO_APOS_CANCELAMENTO: cobrança aprovada
 * depois do cancelamento (sem a hora do cancelamento, alerta por segurança); pago e DEPOIS cancelado
 * não tem alerta (o próprio cancelamento avisou). PAGO_COM_DIVERGENCIA e AVISO_NAO_CONFERIDO só
 * enquanto o pedido está PENDENTE: somem quando a dona marca pago ou cancela.
 */
export function alertaDoPagamento(e: EntradaPagamentoAdmin): AlertaPagamento | null {
  const agora = e.agora ?? Date.now();
  const aprovadas = aprovadasEmOrdem(e.cobrancas);
  if (e.pedidoStatus === "CANCELADO" && aprovadas.length > 0) {
    const cancelado = e.canceladoEm === null ? null : ms(e.canceladoEm);
    if (cancelado === null || aprovadas.some((a) => a.aprovadoEm === null || ms(a.aprovadoEm) >= cancelado)) {
      return "PAGO_APOS_CANCELAMENTO";
    }
  }
  if (aprovadas.length > 1) return "PAGO_EM_DOBRO";
  if (aprovadas.some((a) => a.statusGateway === MARCA_APOS_BAIXA_MANUAL)) return "CONFIRMADO_APOS_BAIXA_MANUAL";
  if (e.pedidoStatus !== "PENDENTE") return null;
  if (e.cobrancas.some(cobrancaDivergente)) return "PAGO_COM_DIVERGENCIA";
  const avisoParado = e.cobrancas.some(
    (c) => emAberto(c.status) && c.avisadoEm !== null && agora - ms(c.avisadoEm) >= JANELA_CONFIRMANDO_MS,
  );
  return avisoParado ? "AVISO_NAO_CONFERIDO" : null;
}

/**
 * `PedidoAdminDTO.pagamento`: método e valor da PRIMEIRA cobrança aprovada, mais o alerta. Sem
 * cobrança aprovada mas com alerta: método, parcelas e valor nulos. Sem nada: null.
 */
export function pagamentoAdminDe(e: EntradaPagamentoAdmin): PagamentoAdminDTO | null {
  const primeira = aprovadasEmOrdem(e.cobrancas)[0];
  const alerta = alertaDoPagamento(e);
  if (!primeira) return alerta ? { metodo: null, parcelas: null, valorPago: null, alerta } : null;
  return {
    metodo: primeira.metodo === "pix" || primeira.metodo === "credit_card" ? primeira.metodo : null,
    parcelas: primeira.parcelas,
    valorPago: primeira.valorPago,
    alerta,
  };
}

/**
 * `expirado` e `pagamento` do painel. Expirado: online, PENDENTE, mais de 48 h e NADA em confirmação
 * (com aviso ou divergência, o dinheiro pode ter entrado: não é "expirado", é "conferir").
 */
export function painelDoPagamento(
  e: EntradaPagamentoAdmin & { canal: "ONLINE" | "PRESENCIAL"; createdAt: Date | string },
): { expirado: boolean; pagamento: PagamentoAdminDTO | null } {
  const agora = e.agora ?? Date.now();
  const emConferencia = e.cobrancas.some((c) => cobrancaDivergente(c) || (emAberto(c.status) && c.avisadoEm !== null));
  return {
    expirado: e.canal === "ONLINE" && e.pedidoStatus === "PENDENTE" && !emConferencia && pedidoExpirado(e.createdAt, agora),
    pagamento: pagamentoAdminDe(e),
  };
}

/** "PIX", "Cartão à vista", "Cartão em 3x" (painel e confirmação). */
export function rotuloDoMetodo(metodo: MetodoPagamento | null, parcelas: number | null): string | null {
  if (metodo === "pix") return "PIX";
  if (metodo === "credit_card") return parcelas && parcelas > 1 ? `Cartão em ${parcelas}x` : "Cartão à vista";
  return null;
}
