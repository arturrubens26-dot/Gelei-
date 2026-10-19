import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { atualizarInsumo } from "@/lib/producao-admin";
import { insumoEdicaoSchema } from "@/lib/validacao-producao";

/** PATCH /api/admin/supplies/[id] — edita o insumo (envia todos os campos). A unidade só muda sem movimento. */
export const PATCH = comTratamento(
  "api/admin/supplies PATCH",
  async (request: Request, ctx: RouteContext<"/api/admin/supplies/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const corpo = await lerCorpo(request, insumoEdicaoSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const insumo = await atualizarInsumo(id, corpo.dados);
    if (!insumo) return erro(404, "Insumo não encontrado.");
    console.info(`[admin] ${auth.usuario.id} alterou o insumo ${id}`);
    return Response.json(insumo);
  },
);
