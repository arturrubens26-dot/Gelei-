/**
 * Regras puras da integração com o Mercado Pago (sem rede e sem banco), testadas em
 * testes/mercadopago.test.ts. As chamadas HTTP ficam em src/lib/mercadopago.ts.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Situação de uma cobrança, do nosso lado (enum PaymentStatus do banco). */
export type StatusCobranca = "PENDENTE" | "APROVADO" | "CANCELADO" | "RECUSADO" | "ESTORNADO";

/**
 * Traduz o status do pagamento no Mercado Pago. "in_mediation" (o cliente abriu uma disputa depois de
 * pagar) continua APROVADO: o dinheiro entrou e a disputa se resolve no painel do Mercado Pago.
 * Status desconhecido conta como PENDENTE: na dúvida, o pedido não muda.
 */
export function statusDoMercadoPago(status: string): StatusCobranca {
  switch (status) {
    case "approved":
    case "in_mediation":
      return "APROVADO";
    case "cancelled":
      return "CANCELADO";
    case "rejected":
      return "RECUSADO";
    case "refunded":
    case "charged_back":
      return "ESTORNADO";
    default:
      return "PENDENTE";
  }
}

/**
 * Data no formato que o Mercado Pago pede em `date_of_expiration` (ISO 8601 com fuso explícito),
 * no horário de Brasília (UTC−3, sem horário de verão desde 2019): 2026-10-19T15:30:00.000-03:00.
 */
export function dataParaMercadoPago(data: Date): string {
  const brasilia = new Date(data.getTime() - 3 * 60 * 60_000);
  return `${brasilia.toISOString().slice(0, 23)}-03:00`;
}

/** Primeiro nome (o Mercado Pago aceita sem sobrenome); limita o tamanho para não ser recusado. */
function primeiroNome(nome: string): string {
  return (nome.trim().split(/\s+/)[0] ?? "").slice(0, 60);
}

export type EntradaCobrancaPix = {
  pedidoId: string;
  /** Em reais, com no máximo 2 casas (o total do pedido). */
  valor: number;
  descricao: string;
  email: string;
  nome: string;
  expiraEm: Date;
  /** Endereço público do nosso webhook; sem ele, o aviso vem da configuração do painel. */
  urlNotificacao?: string;
};

/** Corpo do POST /v1/payments para um PIX. `external_reference` amarra o pagamento ao pedido. */
export function corpoDaCobrancaPix(entrada: EntradaCobrancaPix) {
  return {
    transaction_amount: entrada.valor,
    description: entrada.descricao.slice(0, 250),
    payment_method_id: "pix",
    external_reference: entrada.pedidoId,
    date_of_expiration: dataParaMercadoPago(entrada.expiraEm),
    ...(entrada.urlNotificacao ? { notification_url: entrada.urlNotificacao } : {}),
    payer: { email: entrada.email, first_name: primeiroNome(entrada.nome) },
  };
}

const texto = z.string().nullish();

/** O que lemos de um pagamento do Mercado Pago (o resto da resposta é ignorado). */
export const pagamentoMercadoPagoSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]).transform(String),
  status: z.string().min(1).max(40),
  status_detail: texto,
  external_reference: texto,
  transaction_amount: z.number(),
  currency_id: texto,
  payment_method_id: texto,
  date_of_expiration: texto,
  date_approved: texto,
  point_of_interaction: z
    .object({
      transaction_data: z
        .object({ qr_code: texto, qr_code_base64: texto, ticket_url: texto })
        .nullish(),
    })
    .nullish(),
});

export type PagamentoMercadoPago = z.output<typeof pagamentoMercadoPagoSchema>;

/**
 * Confere se um pagamento APROVADO no Mercado Pago quita mesmo esta cobrança: mesmo pedido, mesmo
 * valor (em centavos, sem erro de arredondamento), em reais e por PIX. Devolve o motivo da recusa.
 */
export function divergenciaDoPagamento(
  pagamento: Pick<PagamentoMercadoPago, "external_reference" | "transaction_amount" | "currency_id" | "payment_method_id">,
  esperado: { pedidoId: string; valor: number },
): string | null {
  if (pagamento.external_reference !== esperado.pedidoId) return "pedido diferente";
  if (Math.round(pagamento.transaction_amount * 100) !== Math.round(esperado.valor * 100)) return "valor diferente";
  if (pagamento.currency_id && pagamento.currency_id !== "BRL") return "moeda diferente";
  if (pagamento.payment_method_id && pagamento.payment_method_id !== "pix") return "forma de pagamento diferente";
  return null;
}

/**
 * Confere a assinatura do aviso (webhook) do Mercado Pago. O cabeçalho `x-signature` vem como
 * "ts=<timestamp>,v1=<hmac>" e o HMAC-SHA256 (chave = assinatura secreta do painel) é calculado sobre
 * o manifesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Partes ausentes saem do manifesto,
 * e o data.id alfanumérico vai em minúsculas, como manda a documentação do Mercado Pago.
 */
export function assinaturaDoAvisoValida(entrada: {
  cabecalho: string | null;
  requestId: string | null;
  dataId: string | null;
  segredo: string;
}): boolean {
  if (!entrada.cabecalho || !entrada.segredo) return false;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of entrada.cabecalho.split(",")) {
    const [chave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (chave?.trim() === "ts") ts = valor;
    else if (chave?.trim() === "v1") v1 = valor;
  }
  if (!ts || !/^\d{1,20}$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;

  let manifesto = "";
  if (entrada.dataId) manifesto += `id:${entrada.dataId.toLowerCase()};`;
  if (entrada.requestId) manifesto += `request-id:${entrada.requestId};`;
  manifesto += `ts:${ts};`;

  const esperado = createHmac("sha256", entrada.segredo).update(manifesto).digest();
  const recebido = Buffer.from(v1, "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
