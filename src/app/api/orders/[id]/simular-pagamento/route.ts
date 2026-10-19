import { autenticarApi, comTratamento, erro, origemInvalida } from "@/lib/api";
import { pagamentosSimuladosAtivos, simularPagamento } from "@/lib/pagamentos";

/**
 * POST /api/orders/[id]/simular-pagamento — DEMONSTRAÇÃO: marca o pedido do
 * próprio usuário como PAGO. Existe só enquanto PAGAMENTOS_SIMULADOS=true;
 * sem isso responde 404, para ninguém "pagar" sozinho em produção.
 */
export const POST = comTratamento(
  "api/orders/simular-pagamento",
  async (request: Request, ctx: RouteContext<"/api/orders/[id]/simular-pagamento">) => {
    if (!pagamentosSimuladosAtivos()) return erro(404, "Recurso indisponível.");

    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi();
    if (!auth.ok) return auth.resposta;

    const { id } = await ctx.params;
    const confirmado = await simularPagamento(id, auth.usuario.id);
    if (!confirmado) {
      return erro(409, "Pedido não encontrado ou já não está pendente.");
    }
    return Response.json({ id, status: "PAGO" });
  },
);
