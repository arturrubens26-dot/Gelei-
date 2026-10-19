import "server-only";
import {
  corpoDaCobrancaPix,
  pagamentoMercadoPagoSchema,
  type EntradaCobrancaPix,
  type PagamentoMercadoPago,
} from "@/lib/mercadopago-regras";

/**
 * Chamadas à API do Mercado Pago (PIX do Checkout Transparente). Só esta camada conhece o token;
 * o resto do sistema fala com `GatewayPagamento` (src/lib/pagamentos.ts).
 *
 * Variáveis: MERCADOPAGO_ACCESS_TOKEN (APP_USR-... em produção, TEST-... para testar) e, opcional,
 * MERCADOPAGO_WEBHOOK_SECRET (assinatura secreta dos avisos, no painel do Mercado Pago).
 */

const API_OFICIAL = "https://api.mercadopago.com";
const TEMPO_LIMITE_MS = 15_000;

/** Falha ao falar com o Mercado Pago. `status` 0 = sem resposta (rede, tempo esgotado). */
export class ErroMercadoPago extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroMercadoPago";
  }
}

function token(): string {
  const valor = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!valor) throw new ErroMercadoPago(0, "MERCADOPAGO_ACCESS_TOKEN não está definida.");
  return valor;
}

export function mercadoPagoConfigurado(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN?.trim());
}

/**
 * Endereço da API. MERCADOPAGO_API_URL só é aceita apontando para este computador (testes com um
 * Mercado Pago falso): nunca dá para desviar o token para outro servidor por variável.
 */
function baseDaApi(): string {
  const pedida = process.env.MERCADOPAGO_API_URL;
  if (pedida) {
    try {
      const url = new URL(pedida);
      if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) return url.origin;
    } catch {
      // URL inválida: usa a oficial.
    }
  }
  return API_OFICIAL;
}

async function chamar(metodo: "GET" | "POST" | "PUT", caminho: string, corpo?: unknown, chaveIdempotencia?: string) {
  let resposta: Response;
  try {
    resposta = await fetch(`${baseDaApi()}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/json",
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
        ...(chaveIdempotencia ? { "X-Idempotency-Key": chaveIdempotencia } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof ErroMercadoPago) throw e;
    throw new ErroMercadoPago(0, `sem resposta (${e instanceof Error ? e.name : "erro"})`);
  }
  const json: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    // A mensagem do Mercado Pago (ex.: "Payer email forbidden") ajuda a diagnosticar e não traz o token.
    const mensagem = (json as { message?: unknown } | null)?.message;
    throw new ErroMercadoPago(
      resposta.status,
      `HTTP ${resposta.status}${typeof mensagem === "string" ? `: ${mensagem.slice(0, 200)}` : ""}`,
    );
  }
  return json;
}

function lerPagamento(json: unknown): PagamentoMercadoPago {
  const lido = pagamentoMercadoPagoSchema.safeParse(json);
  if (!lido.success) throw new ErroMercadoPago(502, "resposta do Mercado Pago em formato inesperado");
  return lido.data;
}

/**
 * Cria a cobrança PIX. A mesma `chaveIdempotencia` devolve o MESMO pagamento (o Mercado Pago repete
 * a resposta), então uma nova tentativa depois de uma falha de rede não abre um segundo PIX.
 */
export async function criarPixNoMercadoPago(
  entrada: EntradaCobrancaPix,
  chaveIdempotencia: string,
): Promise<PagamentoMercadoPago> {
  return lerPagamento(await chamar("POST", "/v1/payments", corpoDaCobrancaPix(entrada), chaveIdempotencia));
}

export async function consultarPagamentoNoMercadoPago(id: string): Promise<PagamentoMercadoPago> {
  if (!/^\d{1,20}$/.test(id)) throw new ErroMercadoPago(400, "id de pagamento inválido");
  return lerPagamento(await chamar("GET", `/v1/payments/${id}`));
}

/** Cancela um PIX ainda não pago (o QR Code deixa de funcionar). Devolve o pagamento atualizado. */
export async function cancelarPagamentoNoMercadoPago(id: string): Promise<PagamentoMercadoPago> {
  if (!/^\d{1,20}$/.test(id)) throw new ErroMercadoPago(400, "id de pagamento inválido");
  return lerPagamento(await chamar("PUT", `/v1/payments/${id}`, { status: "cancelled" }));
}
