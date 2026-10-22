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
