/**
 * Configuração de ambiente. `pagamentosSimuladosPermitidos` é a ÚNICA fonte da verdade
 * sobre o pagamento simulado, e `validarAmbiente` roda na subida do servidor
 * (src/instrumentation.ts) para falhar cedo e alto em vez de operar mal configurado.
 */
import { FORMATO_HANDLE, origemPublicaDe } from "@/lib/infinitepay-regras";

/**
 * O pagamento simulado deixa o cliente marcar o próprio pedido como pago. Em produção só vale
 * se houver um SEGUNDO sinal explícito de que o ambiente é uma demonstração (APP_ENV=demo):
 * esquecer a flag ligada não basta para abrir o buraco.
 */
export function pagamentosSimuladosPermitidos(): boolean {
  if (process.env.PAGAMENTOS_SIMULADOS !== "true") return false;
  return process.env.NODE_ENV !== "production" || process.env.APP_ENV === "demo";
}

/** Hosts deste computador: só neles a APP_URL pode ser http. */
const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost"]);

/** A APP_URL aponta para este computador (http://localhost ou http://127.0.0.1, qualquer porta)? */
export function appUrlEmLoopback(bruto: string | undefined): boolean {
  const valor = bruto?.trim();
  if (!valor) return false;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" && HOSTS_LOCAIS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * APP_ENV que diz "este é o site de produção". `demo` NÃO entra aqui: o .env local usa APP_ENV=demo para o
 * pagamento simulado funcionar sob `next start`; um site de demonstração publicado cai na outra trava (a
 * APP_URL não é http://localhost).
 */
const APP_ENV_PRODUCAO = new Set(["production", "prod", "producao", "produção"]);

/**
 * E2E_DADOS_LEGAIS=1 faz o teste ponta a ponta local ignorar a trava dos dados legais (D13). Por que o
 * processo NÃO é o site publicado: sem NETLIFY, sem APP_ENV de produção e com a APP_URL
 * em http://localhost (o teste sobe `next start`, que roda com NODE_ENV=production, então só o NODE_ENV não
 * distingue). `null`: pode; texto: por que não pode (para o aviso de quem esqueceu a variável no site).
 */
export function motivoDeRecusarE2eDadosLegais(env: Record<string, string | undefined> = process.env): string | null {
  if (env.NETLIFY && env.NETLIFY !== "false") return "o site está na Netlify (NETLIFY)";
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv && APP_ENV_PRODUCAO.has(appEnv)) return `APP_ENV=${appEnv} é o ambiente de produção`;
  if (!appUrlEmLoopback(env.APP_URL)) return "a APP_URL não é http://localhost nem http://127.0.0.1";
  return null;
}

/** O bypass dos dados legais vale agora? (Só E2E_DADOS_LEGAIS=1 e um ambiente local; ver o motivo acima.) */
export function e2eDadosLegaisAtivo(env: Record<string, string | undefined> = process.env): boolean {
  return env.E2E_DADOS_LEGAIS === "1" && motivoDeRecusarE2eDadosLegais(env) === null;
}

export function validarAmbiente(): void {
  const problemas: string[] = [];

  if (!process.env.DATABASE_URL) {
    problemas.push("DATABASE_URL não está definida.");
  }
  if ((process.env.SESSION_SECRET ?? "").length < 32) {
    problemas.push("SESSION_SECRET ausente ou curta demais (mínimo 32 caracteres aleatórios).");
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.PAGAMENTOS_SIMULADOS === "true" &&
    process.env.APP_ENV !== "demo"
  ) {
    problemas.push(
      "PAGAMENTOS_SIMULADOS=true em produção: qualquer cliente conseguiria 'pagar' o próprio pedido. " +
        'Desligue a flag ou, se for mesmo uma demonstração, defina APP_ENV="demo".',
    );
  }

  // InfinitePay: handle malformado é erro de digitação (o servidor não sobe); faltar a chave ou a
  // APP_URL só deixa o pagamento desligado (checkout "em breve"), sem derrubar o site.
  const handle = process.env.INFINITEPAY_HANDLE?.trim();
  const chaveInfinitePay = process.env.INFINITEPAY_API_KEY?.trim();
  if (handle && !FORMATO_HANDLE.test(handle)) {
    problemas.push(
      'INFINITEPAY_HANDLE inválido: use a InfiniteTag sem o "$", em minúsculas (ex.: "geleio").',
    );
  }
  if (handle && !chaveInfinitePay) {
    console.warn("[ambiente] INFINITEPAY_HANDLE sem INFINITEPAY_API_KEY: o pagamento pelo site fica desligado (checkout \"em breve\").");
  }
  if (chaveInfinitePay && !handle) {
    console.warn("[ambiente] INFINITEPAY_API_KEY sem INFINITEPAY_HANDLE: o pagamento pelo site fica desligado.");
  }
  if (chaveInfinitePay && !chaveInfinitePay.startsWith("inchk_")) {
    console.warn("[ambiente] INFINITEPAY_API_KEY não começa com \"inchk_\": confira se é a chave do Checkout Integrado.");
  }
  if (handle && chaveInfinitePay && !origemPublicaDe(process.env.APP_URL)) {
    console.warn("[ambiente] InfinitePay sem APP_URL válida (https): o pagamento pelo site fica desligado.");
  }
  const segredoAviso = process.env.INFINITEPAY_WEBHOOK_SECRET?.trim();
  if (segredoAviso !== undefined && segredoAviso !== "" && segredoAviso.length < 32) {
    problemas.push("INFINITEPAY_WEBHOOK_SECRET curta demais (mínimo 32 caracteres aleatórios; sem ela, vale o SESSION_SECRET).");
  }
  // O bypass do teste ponta a ponta nunca vale no site publicado: ele abriria as encomendas sem o CNPJ/CPF e o
  // e-mail de contato (Decreto 7.962/2013, art. 2º). Definida fora de um ambiente local, o servidor não sobe.
  const e2e = process.env.E2E_DADOS_LEGAIS?.trim();
  if (e2e && e2e !== "0") {
    const motivo = motivoDeRecusarE2eDadosLegais();
    if (motivo) {
      problemas.push(`E2E_DADOS_LEGAIS é só para o teste ponta a ponta neste computador (${motivo}): remova-a do site publicado.`);
    }
  }
  // O servidor falso dos testes nunca vale no site publicado (APP_URL https).
  if (process.env.INFINITEPAY_API_URL?.trim() && process.env.NODE_ENV === "production" && process.env.APP_URL?.trim().startsWith("https://")) {
    problemas.push("INFINITEPAY_API_URL é só para testes neste computador: remova-a do site publicado.");
  }
  const sobrasMercadoPago = ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "MERCADOPAGO_API_URL"].filter((v) =>
    process.env[v]?.trim(),
  );
  if (sobrasMercadoPago.length > 0) {
    console.warn(`[ambiente] ${sobrasMercadoPago.join(", ")} não são mais usadas (o pagamento é pela InfinitePay): pode remover.`);
  }

  // E-mail (redefinição de senha por e-mail): pela metade não derruba o site, só fica desligado.
  const variaveisSmtp = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_REMETENTE"];
  const smtpDefinidas = variaveisSmtp.filter((v) => process.env[v]?.trim());
  if (smtpDefinidas.length > 0 && smtpDefinidas.length < variaveisSmtp.length) {
    console.warn(
      `[ambiente] SMTP incompleto (faltam ${variaveisSmtp.filter((v) => !smtpDefinidas.includes(v)).join(", ")}): ` +
        "o e-mail fica desligado e a redefinição de senha segue só pelo painel.",
    );
  } else if (smtpDefinidas.length > 0 && !["465", "587"].includes(process.env.SMTP_PORT!.trim())) {
    console.warn("[ambiente] SMTP_PORT precisa ser 465 (TLS) ou 587 (STARTTLS): o e-mail fica desligado.");
  }

  if (problemas.length > 0) {
    throw new Error(`Ambiente mal configurado:\n- ${problemas.join("\n- ")}`);
  }
}
