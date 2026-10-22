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
 * Só aceita transições válidas (ex.: PAGO → ENVIADO), não pula etapas. → 200 `{ id, status, aviso? }`;
 * no cancelamento, `aviso` diz se é preciso devolver dinheiro ou se o link ainda pode ser pago.
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
    const resultado = await alterarStatusPedido(id, corpo.dados.status, auth.usuario.id);
    if (resultado.ok) {
      console.info(`[admin] ${auth.usuario.id} mudou o pedido ${id} para ${corpo.dados.status}`);
      // Pedido cancelado: os links abertos são encerrados no nosso banco. A InfinitePay não tem
      // cancelamento de link pela API: o link ainda aceita pagamento até vencer (no máximo 1 hora).
      let aviso: string | undefined;
      if (corpo.dados.status === "CANCELADO") {
        try {
          const { algumPago, linkAberto } = await encerrarCobrancasDoPedido(id);
          if (algumPago) {
            aviso = "A cliente já tinha pago este pedido. Devolva o valor pelo app InfinitePay.";
          } else if (linkAberto) {
            aviso =
              "O link de pagamento ainda pode ser usado por até 1 hora. Se a cliente pagar, o pedido mostrará " +
              "'Pago após o cancelamento': devolva pelo app InfinitePay.";
          }
        } catch (e) {
          registrarErro(`api/admin/orders ${id}: encerrar os links de pagamento falhou`, e);
          aviso =
            "O pedido foi cancelado, mas não conseguimos encerrar o link de pagamento agora. Se a cliente pagar, " +
            "o pedido mostrará 'Pago após o cancelamento': devolva pelo app InfinitePay.";
        }
      } else if (corpo.dados.status === "PAGO") {
        // Marcado como pago à mão (plano C): os links abertos são encerrados no nosso banco. Se a
        // cliente ainda pagar um deles (até 1 hora), o painel mostra "Confirmado após marcar como pago".
        try {
          const { linkAberto } = await encerrarCobrancasDoPedido(id);
          if (linkAberto) {
            aviso =
              "Os links de pagamento abertos foram encerrados no site, mas ainda aceitam pagamento na InfinitePay por até 1 hora. " +
              "Se a cliente pagar, o painel avisará: confira no app se ela não pagou duas vezes.";
          }
        } catch (e) {
          registrarErro(`api/admin/orders ${id}: encerrar os links de pagamento falhou`, e);
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
