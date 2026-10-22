import { autenticarApi, comTratamento, erro, origemInvalida } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { abrirLinkDePagamento, situacaoComConferencia } from "@/lib/pagamentos";

/**
 * GET /api/orders/[id]/pagamento → 200 `SituacaoPagamentoDTO` (etapa, prazo e a cobrança mais
 * recente) ou 404. Na etapa CONFIRMANDO (voltou da InfinitePay ou chegou o aviso), o servidor confere
 * de novo no payment_check (no máximo a cada 8 s), então a tela confirma mesmo se o aviso atrasar.
 */
export const GET = comTratamento("api/orders/pagamento GET", async (_request: Request, ctx: RouteContext<"/api/orders/[id]/pagamento">) => {
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;
  if (!dentroDoLimite(`pagamento-consulta|${auth.usuario.id}`, 240, 10 * 60_000)) {
    return erro(429, "Muitas consultas em pouco tempo. Aguarde um pouco.");
  }
  const { id } = await ctx.params;
  const situacao = await situacaoComConferencia(id, auth.usuario.id);
  if (!situacao) return erro(404, "Pedido não encontrado.");
  return Response.json(situacao);
});

/**
 * POST /api/orders/[id]/pagamento (corpo `{}`) → 200 `{ cobranca: CobrancaDTO }`, com `checkoutUrl`
 * quando é da InfinitePay. Reaproveita o link que ainda vale; senão abre outro (o anterior venceu, ou
 * a InfinitePay falhou quando o pedido foi feito). 404; 409 (já pago, expirou ou não está
 * aguardando pagamento); 429; 502 (InfinitePay fora); 503 (pagamento desligado).
 */
export const POST = comTratamento("api/orders/pagamento POST", async (request: Request, ctx: RouteContext<"/api/orders/[id]/pagamento">) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;
  if (!dentroDoLimite(`pagamento-novo|${auth.usuario.id}`, 20, 60 * 60_000)) {
    return erro(429, "Muitas tentativas de pagamento em pouco tempo. Tente novamente mais tarde.");
  }
  const { id } = await ctx.params;
  return Response.json({ cobranca: await abrirLinkDePagamento(id, auth.usuario.id) });
});
