/**
 * Roda uma vez quando o servidor Next.js sobe. Valida o ambiente para o processo recusar
 * iniciar mal configurado (ex.: pagamento simulado ligado em produção).
 */
export async function register() {
  // Só no servidor Node, e não durante o `next build` (que pode rodar sem as variáveis de produção).
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;

  const { validarAmbiente } = await import("./lib/ambiente");
  validarAmbiente();
}
