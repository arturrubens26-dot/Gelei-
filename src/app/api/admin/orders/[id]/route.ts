import { z } from "zod";
import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida, registrarErro } from "@/lib/api";
import { alterarStatusPedido } from "@/lib/admin";
import { encerrarCobrancasDoPedido } from "@/lib/pagamentos";
import { detalhePedidoAdmin } from "@/lib/pedidos-admin";
import { statusPedidoSchema } from "@/lib/validacao";

const corpoSchema = z.object({ status: statusPedidoSchema });

/**
 * GET /api/admin/orders/[id] — ficha do pedido (admin): cliente, endereço, potes avulsos, caixas de
 * kit com a composição e o bloco "Separar…". Resposta: `{ pedido: PedidoAdminDetalheDTO }`; 404 se
 * não existir. Valida is_admin no banco a cada chamada.
 */
export const GET = comTratamento(
  "api/admin/orders GET [id]",
  async (_request: Request, ctx: RouteContext<"/api/admin/orders/[id]">) => {
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const { id } = await ctx.params;
    const pedido = await detalhePedidoAdmin(id);
    if (!pedido) return erro(404, "Pedido não encontrado.");
    return Response.json({ pedido });
  },
);

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
      // Pedido cancelado: o PIX aberto é cancelado no gateway, para o cliente não pagar um pedido cancelado.
      let aviso: string | undefined;
      if (corpo.dados.status === "CANCELADO") {
        try {
          const { algumPago } = await encerrarCobrancasDoPedido(id);
          if (algumPago) aviso = "O cliente já tinha pago o PIX deste pedido. Devolva o valor pelo painel do Mercado Pago.";
        } catch (e) {
          registrarErro(`api/admin/orders ${id}: cancelar o PIX falhou`, e);
          aviso = "Não foi possível cancelar o PIX no Mercado Pago agora. Confira o pagamento no painel do Mercado Pago.";
        }
      }
      return Response.json({ id, status: corpo.dados.status, ...(aviso ? { aviso } : {}) });
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
