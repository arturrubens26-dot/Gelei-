import "server-only";
import {
  FORMATO_HANDLE,
  corpoDoLink,
  lerConferencia,
  lerRespostaDoLink,
  origemDeTesteDe,
  origemPublicaDe,
  type Conferencia,
  type EntradaDoLink,
} from "@/lib/infinitepay-regras";

/**
 * Chamadas à API do checkout da InfinitePay. Só esta camada conhece a chave (X-Api-Key); o resto do
 * sistema fala com src/lib/pagamentos.ts. Os logs nunca levam a chave nem o corpo enviado (nome,
 * e-mail e endereço da cliente).
 *
 * Variáveis: INFINITEPAY_HANDLE (a InfiniteTag sem "$", ex.: "geleio"), INFINITEPAY_API_KEY
 * (inchk_..., criada no app) e APP_URL (de onde saem o retorno e o aviso). INFINITEPAY_API_URL só
 * para testes, e só apontando para este computador.
 */

const API_OFICIAL = "https://api.checkout.infinitepay.io";
const TEMPO_LIMITE_MS = 10_000;

/** Falha ao falar com a InfinitePay. `status` 0 = sem resposta (rede, tempo esgotado). */
export class ErroInfinitePay extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroInfinitePay";
  }
}

export function handleInfinitePay(): string | null {
  const valor = process.env.INFINITEPAY_HANDLE?.trim();
  return valor && FORMATO_HANDLE.test(valor) ? valor : null;
}

function chave(): string | null {
  return process.env.INFINITEPAY_API_KEY?.trim() || null;
}

/** Servidor falso dos testes (INFINITEPAY_API_URL, só 127.0.0.1/localhost). `null`: API oficial. */
export function origemDaApiDeTeste(): string | null {
  return origemDeTesteDe(process.env.INFINITEPAY_API_URL);
}

/**
 * Endereço público do site (retorno e aviso): SÓ a APP_URL, nunca o cabeçalho Host. https; http só
 * para este computador (teste local com `next start`, que roda como produção).
 */
export function origemPublica(): string | null {
  return origemPublicaDe(process.env.APP_URL);
}

/** Handle válido, chave e APP_URL: sem os três, o checkout fica "em breve". */
export function infinitePayConfigurado(): boolean {
  return Boolean(handleInfinitePay() && chave() && origemPublica());
}

async function chamar(caminho: string, corpo: unknown, tempoLimiteMs: number): Promise<unknown> {
  const apiKey = chave();
  if (!apiKey) throw new ErroInfinitePay(0, "INFINITEPAY_API_KEY não está definida.");
  let resposta: Response;
  try {
    resposta = await fetch(`${origemDaApiDeTeste() ?? API_OFICIAL}${caminho}`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(tempoLimiteMs),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    throw new ErroInfinitePay(0, `sem resposta (${e instanceof Error ? e.name : "erro"})`);
  }
  const json: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    // A mensagem da API ajuda a diagnosticar e não traz a chave; cortada e sem quebras de linha.
    const bruta = (json as { message?: unknown; error?: unknown } | null)?.message ?? (json as { error?: unknown } | null)?.error;
    const mensagem = typeof bruta === "string" ? bruta.replace(/\s+/g, " ").slice(0, 200) : "sem mensagem";
    throw new ErroInfinitePay(resposta.status, `HTTP ${resposta.status}: ${mensagem}`);
  }
  return json;
}

/** Cria o link do checkout. A URL devolvida já passou pelo allowlist (https em *.infinitepay.io). */
export async function criarLink(entrada: EntradaDoLink): Promise<{ url: string; slug: string | null }> {
  const json = await chamar("/links", corpoDoLink(entrada), TEMPO_LIMITE_MS);
  const lido = lerRespostaDoLink(json, { origemLocal: origemDaApiDeTeste() });
  if (!lido) {
    const campos = json && typeof json === "object" ? Object.keys(json).join(",").slice(0, 120) : typeof json;
    throw new ErroInfinitePay(502, `resposta de /links sem URL válida da InfinitePay (campos: ${campos})`);
  }
  return lido;
}

/**
 * payment_check: a confirmação de verdade, feita por este servidor com a própria chave e a
 * referência do NOSSO banco. Formato inesperado conta como falha passageira (status 502).
 */
export async function conferirPagamento(
  consulta: { referencia: string; transacaoNsu: string; slug: string },
  tempoLimiteMs = TEMPO_LIMITE_MS,
): Promise<Conferencia> {
  const handle = handleInfinitePay();
  if (!handle) throw new ErroInfinitePay(0, "INFINITEPAY_HANDLE ausente ou inválido.");
  const json = await chamar(
    "/payment_check",
    { handle, order_nsu: consulta.referencia, transaction_nsu: consulta.transacaoNsu, slug: consulta.slug },
    tempoLimiteMs,
  );
  const lida = lerConferencia(json);
  if (!lida) throw new ErroInfinitePay(502, "resposta do payment_check em formato inesperado");
  return lida;
}
