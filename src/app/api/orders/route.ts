import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida, registrarErro } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { ErroNegocio } from "@/lib/erros";
import { abrirLinkDePagamento, pagamentoOnlineDisponivel } from "@/lib/pagamentos";
import { criarPedido } from "@/lib/pedidos";
import { pedidoSchema } from "@/lib/validacao";

const FORMATO_CHAVE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * POST /api/orders — finaliza a compra: cria o pedido (status PENDENTE), seus
 * potes avulsos e caixas de kit, e abre o link de pagamento na InfinitePay (PIX ou cartão).
 *
 * Entrada: { itens?: [{ productId, quantidade }],
 *            kits?: [{ kitId, quantidade, sabores: [{ productId, quantidade }] }],
 *            modoEntrega: "ENTREGA" | "RETIRADA", telefone,
 *            addressId | endereco: {...} (só na ENTREGA), totalEsperadoCentavos? }
 * Entrega só em Teresina (CEP 640…); fora: 422 `{ detalhes: { foraDaArea: true } }`. Telefone
 * inválido: 400 em `detalhes.telefone`. Na RETIRADA, endereço enviado: 400 em `detalhes.endereco`.
 * `itens` e `kits` podem faltar (viram []), mas não os dois vazios. `sabores` é a
 * composição de UMA caixa; `quantidade` do kit é o número de caixas.
 * Cabeçalho opcional `Idempotency-Key`: reenviar a mesma chave com o mesmo conteúdo
 * devolve o pedido já criado (200) em vez de criar outro (201); com outro conteúdo, 422.
 *
 * Respostas: 201/200 `{ pedido: PedidoDTO (com kits), pagamento: CobrancaDTO | null }` (`null` se a
 * InfinitePay falhou: a página do pedido oferece "Pagar"; com `checkoutUrl`, a tela leva até lá);
 * 400 dados inválidos (composição errada em `detalhes["kits.N.sabores"]`);
 * 409 total mudou: `detalhes: { total, deliveryFee, itens: [{ productId, nome, preco, pesoGramas }],
 *     kits: [{ kitId, nome, preco, pesoCaixaGramas, potes }] }`;
 * 422 indisponível: `detalhes: { indisponiveis: productId[], kitsIndisponiveis: kitId[] }`.
 *
 * O endereço é validado por completo e conferido com o CEP. Preços, peso, frete e a
 * composição válida do kit são recalculados aqui; o cliente não os informa.
 */
export const POST = comTratamento("api/orders", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;

  // Sem como cobrar, não grava o pedido (ficaria pendente para sempre).
  if (!pagamentoOnlineDisponivel()) {
    return erro(503, "Os pedidos pelo site ainda não estão abertos. Em breve você poderá comprar por aqui.");
  }

  // Por usuário (não depende de IP): contém quem automatiza pedidos em série.
  if (!dentroDoLimite(`pedidos|${auth.usuario.id}`, 30, 60 * 60_000)) {
    return erro(429, "Muitos pedidos em pouco tempo. Tente novamente mais tarde.");
  }

  const chave = request.headers.get("idempotency-key") ?? undefined;
  if (chave !== undefined && !FORMATO_CHAVE.test(chave)) {
    return erro(400, "Idempotency-Key inválida (use de 8 a 100 letras, números, _ ou -).");
  }

  const corpo = await lerCorpo(request, pedidoSchema);
  if (!corpo.ok) return corpo.resposta;

  const { pedido, repetido } = await criarPedido(auth.usuario.id, { ...corpo.dados, chaveIdempotencia: chave });

  // Se a InfinitePay falhar, o pedido continua PENDENTE e a tela do pedido oferece "Pagar".
  // Pedido repetido (mesma Idempotency-Key) reaproveita o link que ainda estiver valendo.
  let pagamento = null;
  try {
    pagamento = await abrirLinkDePagamento(pedido.id, auth.usuario.id);
  } catch (e) {
    if (!(e instanceof ErroNegocio)) registrarErro(`api/orders pedido ${pedido.id}: abrir o link de pagamento falhou`, e);
  }

  return Response.json({ pedido, pagamento }, { status: repetido ? 200 : 201 });
});
