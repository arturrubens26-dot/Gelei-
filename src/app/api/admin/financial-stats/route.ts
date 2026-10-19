import { autenticarApi, comTratamento } from "@/lib/api";
import { estatisticasFinanceiras } from "@/lib/admin";

/**
 * GET /api/admin/financial-stats — KPIs, receita mensal e transações recentes.
 * Valida is_admin no banco a cada chamada.
 */
export const GET = comTratamento("api/admin/financial-stats", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  return Response.json(await estatisticasFinanceiras());
});
