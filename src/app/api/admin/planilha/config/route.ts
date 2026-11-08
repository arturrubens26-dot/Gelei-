import { autenticarApi, comTratamento, lerCorpo, origemInvalida } from "@/lib/api";
import { obterConfigFinanceiro, salvarConfigFinanceiro } from "@/lib/planilha/categorias-admin";
import { configFinanceiroSchema } from "@/lib/planilha/validacao";

/** GET /api/admin/planilha/config — saldo inicial (centavos) e a data a partir da qual vale. */
export const GET = comTratamento("api/admin/planilha/config GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json(await obterConfigFinanceiro());
});

/** PATCH /api/admin/planilha/config — `{ saldoInicialCentavos, saldoInicialEm: "AAAA-MM-DD" | null }`. */
export const PATCH = comTratamento("api/admin/planilha/config PATCH", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const corpo = await lerCorpo(request, configFinanceiroSchema);
  if (!corpo.ok) return corpo.resposta;

  const config = await salvarConfigFinanceiro(corpo.dados, auth.usuario.id);
  console.info(`[planilha] ${auth.usuario.id} alterou o saldo inicial`);
  return Response.json(config);
});
