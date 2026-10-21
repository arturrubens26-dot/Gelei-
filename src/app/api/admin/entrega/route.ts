import { autenticarApi, comTratamento, lerCorpo, origemInvalida } from "@/lib/api";
import { definirTaxaDeEntrega, obterConfigEntregaAdmin } from "@/lib/entrega";
import { taxaEntregaSchema } from "@/lib/validacao";

/** GET /api/admin/entrega — `{ taxaEntregaCentavos, atualizadoEm }` (taxa fixa de entrega em Teresina). */
export const GET = comTratamento("api/admin/entrega GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json(await obterConfigEntregaAdmin());
});

/**
 * PATCH /api/admin/entrega — `{ taxaEntregaCentavos }` (inteiro de 0 a 10000) →
 * `200 { taxaEntregaCentavos, atualizadoEm }`; 400 em `detalhes.taxaEntregaCentavos`.
 * Vale para os pedidos novos (o checkout expira o cache na hora); os já criados não mudam.
 */
export const PATCH = comTratamento("api/admin/entrega PATCH", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const corpo = await lerCorpo(request, taxaEntregaSchema);
  if (!corpo.ok) return corpo.resposta;
  return Response.json(await definirTaxaDeEntrega(corpo.dados.taxaEntregaCentavos, auth.usuario.id));
});
