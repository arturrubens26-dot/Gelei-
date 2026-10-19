import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida, registrarErro } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { obterGateway } from "@/lib/pagamentos";
import { criarPedido } from "@/lib/pedidos";
import { pedidoSchema } from "@/lib/validacao";

const FORMATO_CHAVE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * POST /api/orders — finaliza a compra: cria o pedido (status PENDENTE) e seus
 * itens e abre a cobrança PIX no gateway.
 *
 * Entrada: { itens: [{ productId, quantidade }], addressId | endereco: {...},
 *            totalEsperadoCentavos? }
 * Cabeçalho opcional `Idempotency-Key`: reenviar a mesma chave devolve o pedido
 * já criado (200) em vez de criar outro (201).
 *
 * O endereço é validado por completo e conferido com o CEP. Preços, peso e frete
 * são recalculados aqui; o cliente não os informa. Se `totalEsperadoCentavos`
 * não bater com o total calculado, responde 409 com os valores atuais.
 */
export const POST = comTratamento("api/orders", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;

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

  // Se o gateway falhar, o pedido continua PENDENTE e o cliente pode tentar de novo.
  let pagamento = null;
  try {
    const gateway = obterGateway();
    pagamento = {
      gateway: gateway.nome,
      ...(await gateway.criarCobrancaPix({ id: pedido.id, total: pedido.total })),
    };
  } catch (e) {
    registrarErro(`api/orders pedido ${pedido.id}: cobrança PIX falhou`, e);
  }

  return Response.json({ pedido, pagamento }, { status: repetido ? 200 : 201 });
});
