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

  if (problemas.length > 0) {
    throw new Error(`Ambiente mal configurado:\n- ${problemas.join("\n- ")}`);
  }
}
