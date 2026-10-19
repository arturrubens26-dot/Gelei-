import { z } from "zod";
import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { alterarStatusPedido } from "@/lib/admin";
import { statusPedidoSchema } from "@/lib/validacao";

const corpoSchema = z.object({ status: statusPedidoSchema });

/**
 * PATCH /api/admin/orders/[id]  { status } — muda o status de um pedido (admin).
 * Só aceita transições válidas (ex.: PAGO → ENVIADO), não pula etapas.
 */
export const PATCH = comTratamento(
  "api/admin/orders PATCH",
  async (request: Request, ctx: RouteContext<"/api/admin/orders/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const corpo = await lerCorpo(request, corpoSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const resultado = await alterarStatusPedido(id, corpo.dados.status);
    if (resultado.ok) {
      console.info(`[admin] ${auth.usuario.id} mudou o pedido ${id} para ${corpo.dados.status}`);
      return Response.json({ id, status: corpo.dados.status });
    }
    if (resultado.motivo === "nao-encontrado") return erro(404, "Pedido não encontrado.");
    if (resultado.motivo === "conflito") {
      return erro(409, `O pedido mudou enquanto você alterava (agora está ${resultado.atual}). Atualize a lista e tente de novo.`, {
        statusAtual: resultado.atual,
      });
    }
    return erro(409, `Não é possível mudar de ${resultado.atual} para ${corpo.dados.status}.`, {
      statusAtual: resultado.atual,
    });
  },
);
