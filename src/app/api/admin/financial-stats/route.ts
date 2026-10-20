import { autenticarApi, comTratamento, erro } from "@/lib/api";
import { financeiroDoMes, mesDoFinanceiroValido } from "@/lib/admin";

/**
 * GET /api/admin/financial-stats?mes=AAAA-MM — o Financeiro de um mês: resumo, de onde veio e para
 * onde foi o dinheiro, os 12 meses até ele e as movimentações. Sem `mes`, o mês corrente.
 * Valida is_admin no banco a cada chamada.
 */
export const GET = comTratamento("api/admin/financial-stats", async (request: Request) => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const mes = new URL(request.url).searchParams.get("mes") ?? undefined;
  if (mes !== undefined && !mesDoFinanceiroValido(mes)) {
    return erro(400, "Mês inválido (use AAAA-MM, de 2020 até o mês atual).");
  }
  return Response.json(await financeiroDoMes(mes));
});
