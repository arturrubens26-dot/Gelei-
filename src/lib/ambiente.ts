/**
 * Configuração de ambiente. `pagamentosSimuladosPermitidos` é a ÚNICA fonte da verdade
 * sobre o pagamento simulado, e `validarAmbiente` roda na subida do servidor
 * (src/instrumentation.ts) para falhar cedo e alto em vez de operar mal configurado.
 */

/**
 * O PIX simulado deixa o cliente marcar o próprio pedido como pago. Em produção só vale
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

  const tokenMercadoPago = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (tokenMercadoPago && !/^(APP_USR|TEST)-/.test(tokenMercadoPago)) {
    problemas.push("MERCADOPAGO_ACCESS_TOKEN não parece um Access Token do Mercado Pago (começa com APP_USR- ou TEST-).");
  }
  if (tokenMercadoPago && process.env.NODE_ENV === "production") {
    if (tokenMercadoPago.startsWith("TEST-")) {
      console.warn("[ambiente] Mercado Pago com credencial de TESTE: os PIX gerados não cobram de verdade.");
    }
    if (!process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() && !process.env.APP_URL?.startsWith("https://")) {
      console.warn(
        "[ambiente] Sem MERCADOPAGO_WEBHOOK_SECRET nem APP_URL com https: o Mercado Pago não tem para onde avisar, " +
          "e o pagamento só é confirmado enquanto o cliente está na página do pedido.",
      );
    }
  }

  if (problemas.length > 0) {
    throw new Error(`Ambiente mal configurado:\n- ${problemas.join("\n- ")}`);
  }
}
