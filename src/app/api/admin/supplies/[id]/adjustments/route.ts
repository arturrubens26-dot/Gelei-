import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { registrarAjuste } from "@/lib/producao-admin";
import { ajusteEstoqueSchema } from "@/lib/validacao-producao";

/**
 * POST /api/admin/supplies/[id]/adjustments — corrige o estoque de um insumo
 * (ex.: −200 g "maçã estragou"; +50 g "recontagem"). Devolve o insumo com a sobra nova.
 */
export const POST = comTratamento(
  "api/admin/supplies/adjustments POST",
  async (request: Request, ctx: RouteContext<"/api/admin/supplies/[id]/adjustments">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const corpo = await lerCorpo(request, ajusteEstoqueSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const insumo = await registrarAjuste(id, corpo.dados, auth.usuario.id);
    if (!insumo) return erro(404, "Insumo não encontrado.");
    console.info(`[admin] ${auth.usuario.id} ajustou o estoque do insumo ${id}`);
    return Response.json(insumo, { status: 201 });
  },
);
