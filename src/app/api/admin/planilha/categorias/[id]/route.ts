import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { alterarCategoria, excluirCategoria } from "@/lib/planilha/categorias-admin";
import { alterarCategoriaSchema } from "@/lib/planilha/validacao";

type Contexto = { params: Promise<{ id: string }> };

/** PATCH /api/admin/planilha/categorias/[id] — `{ nome?, grupo?, foraDoResultado?, ativo?, ordem? }`. */
export const PATCH = comTratamento("api/admin/planilha/categorias PATCH", async (request: Request, ctx: Contexto) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const corpo = await lerCorpo(request, alterarCategoriaSchema);
  if (!corpo.ok) return corpo.resposta;

  const { id } = await ctx.params;
  if (!id || id.length > 100) return erro(400, "Identificador inválido.");
  const categoria = await alterarCategoria(id, corpo.dados, auth.usuario.id);
  console.info(`[planilha] ${auth.usuario.id} alterou a categoria ${id}`);
  return Response.json(categoria);
});

/** DELETE /api/admin/planilha/categorias/[id] — 204; com lançamentos ou padrão do grupo: 409 (desative). */
export const DELETE = comTratamento("api/admin/planilha/categorias DELETE", async (request: Request, ctx: Contexto) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const { id } = await ctx.params;
  if (!id || id.length > 100) return erro(400, "Identificador inválido.");
  await excluirCategoria(id, auth.usuario.id);
  console.info(`[planilha] ${auth.usuario.id} excluiu a categoria ${id}`);
  return new Response(null, { status: 204 });
});
