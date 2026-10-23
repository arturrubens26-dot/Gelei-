import { autenticarApi, comTratamento, erro } from "@/lib/api";
import { buscarEncomendaDoUsuario, expirarVencidas } from "@/lib/encomendas";

/**
 * GET /api/encomendas/[id] — a encomenda da cliente logada: `{ encomenda: EncomendaDTO }`. Encomenda de
 * outra pessoa (ou inexistente): 404, sem dizer qual dos dois. Grava antes o prazo vencido dela.
 */
export const GET = comTratamento("api/encomendas GET [id]", async (_request: Request, ctx: RouteContext<"/api/encomendas/[id]">) => {
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;
  const agora = new Date();
  await expirarVencidas(agora, { userId: auth.usuario.id, encomendaId: id });
  const encomenda = await buscarEncomendaDoUsuario(id, auth.usuario.id, agora);
  if (!encomenda) return erro(404, "Encomenda não encontrada.");
  return Response.json({ encomenda });
});
