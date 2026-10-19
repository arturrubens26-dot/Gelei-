import { autenticarApi, comTratamento, erro, origemInvalida } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { abrirCobranca, situacaoDoPagamento } from "@/lib/pagamentos";

/**
 * GET /api/orders/[id]/pagamento — situação do pagamento do pedido do próprio cliente. Enquanto o PIX
 * está aberto, o servidor pergunta ao gateway (no máximo a cada 8 s), então a tela confirma o
 * pagamento mesmo se o aviso do Mercado Pago atrasar.
 */
export const GET = comTratamento("api/orders/pagamento GET", async (_request: Request, ctx: RouteContext<"/api/orders/[id]/pagamento">) => {
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;
  if (!dentroDoLimite(`pagamento-consulta|${auth.usuario.id}`, 240, 10 * 60_000)) {
    return erro(429, "Muitas consultas em pouco tempo. Aguarde um pouco.");
  }
  const { id } = await ctx.params;
  const situacao = await situacaoDoPagamento(id, auth.usuario.id);
  if (!situacao) return erro(404, "Pedido não encontrado.");
  return Response.json(situacao);
});

/**
 * POST /api/orders/[id]/pagamento — gera o PIX do pedido (o anterior venceu, ou o gateway falhou
 * quando o pedido foi feito). Se ainda houver um PIX valendo, devolve o mesmo.
 */
export const POST = comTratamento("api/orders/pagamento POST", async (request: Request, ctx: RouteContext<"/api/orders/[id]/pagamento">) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;
  if (!dentroDoLimite(`pagamento-novo|${auth.usuario.id}`, 20, 60 * 60_000)) {
    return erro(429, "Muitos PIX gerados em pouco tempo. Tente novamente mais tarde.");
  }
  const { id } = await ctx.params;
  return Response.json({ cobranca: await abrirCobranca(id, auth.usuario.id) });
});
