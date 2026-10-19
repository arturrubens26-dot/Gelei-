import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { atualizarDespesa, excluirDespesa } from "@/lib/despesas-admin";
import { despesaSchema } from "@/lib/validacao";

/** PATCH /api/admin/expenses/[id] — corrige uma despesa (envia todos os campos, como no lançamento). */
export const PATCH = comTratamento(
  "api/admin/expenses PATCH",
  async (request: Request, ctx: RouteContext<"/api/admin/expenses/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const corpo = await lerCorpo(request, despesaSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const despesa = await atualizarDespesa(id, corpo.dados);
    if (!despesa) return erro(404, "Despesa não encontrada. Ela pode ter sido excluída.");
    console.info(`[admin] ${auth.usuario.id} alterou a despesa ${id}`);
    return Response.json(despesa);
  },
);

/** DELETE /api/admin/expenses/[id] — exclui uma despesa lançada por engano. */
export const DELETE = comTratamento(
  "api/admin/expenses DELETE",
  async (request: Request, ctx: RouteContext<"/api/admin/expenses/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const { id } = await ctx.params;
    if (!(await excluirDespesa(id))) return erro(404, "Despesa não encontrada. Ela pode já ter sido excluída.");
    console.info(`[admin] ${auth.usuario.id} excluiu a despesa ${id}`);
    return new Response(null, { status: 204 });
  },
);
