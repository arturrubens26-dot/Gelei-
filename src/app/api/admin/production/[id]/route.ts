import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { atualizarProducao, detalheProducao, excluirProducao } from "@/lib/producao-admin";
import { producaoSchema } from "@/lib/validacao-producao";

/** GET /api/admin/production/[id] — a ficha do lote (itens com custo, custos, totais e sobra atual). */
export const GET = comTratamento(
  "api/admin/production/[id] GET",
  async (_request: Request, ctx: RouteContext<"/api/admin/production/[id]">) => {
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const { id } = await ctx.params;
    const lote = await detalheProducao(id);
    return lote ? Response.json(lote) : erro(404, "Produção não encontrada.");
  },
);

/** PATCH /api/admin/production/[id] — corrige o lote (envia tudo, como no registro). */
export const PATCH = comTratamento(
  "api/admin/production/[id] PATCH",
  async (request: Request, ctx: RouteContext<"/api/admin/production/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const corpo = await lerCorpo(request, producaoSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const lote = await atualizarProducao(id, corpo.dados);
    if (!lote) return erro(404, "Produção não encontrada. Ela pode ter sido excluída.");
    console.info(`[admin] ${auth.usuario.id} corrigiu a produção ${id}`);
    return Response.json(lote);
  },
);

/** DELETE /api/admin/production/[id] — exclui o lote (o que ele usou volta para o estoque). */
export const DELETE = comTratamento(
  "api/admin/production/[id] DELETE",
  async (request: Request, ctx: RouteContext<"/api/admin/production/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const { id } = await ctx.params;
    if (!(await excluirProducao(id))) return erro(404, "Produção não encontrada. Ela pode já ter sido excluída.");
    console.info(`[admin] ${auth.usuario.id} excluiu a produção ${id}`);
    return new Response(null, { status: 204 });
  },
);
