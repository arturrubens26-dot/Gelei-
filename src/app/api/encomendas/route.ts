import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { criarEncomenda, expirarVencidas, listarEncomendasDoUsuario } from "@/lib/encomendas";
import { encomendaSchema } from "@/lib/encomendas-regras";
import { MAX_ENCOMENDAS_POR_HORA } from "@/lib/limites";

const FORMATO_CHAVE = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * GET /api/encomendas — as encomendas de lembrancinhas da cliente logada (até 50, da mais nova para a
 * mais antiga). Resposta: `{ encomendas: EncomendaDTO[] }`. Grava antes os prazos vencidos dela.
 */
export const GET = comTratamento("api/encomendas GET", async () => {
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;
  const agora = new Date();
  await expirarVencidas(agora, { userId: auth.usuario.id });
  return Response.json({ encomendas: await listarEncomendasDoUsuario(auth.usuario.id, agora) });
});

/**
 * POST /api/encomendas — solicita uma encomenda de lembrancinhas (status SOLICITADA; nada é cobrado
 * até a loja aprovar). Cabeçalho `Idempotency-Key` OBRIGATÓRIO (8 a 100 letras, números, _ ou -).
 *
 * Entrada: { itens: [{ productId, quantidade }], dataFesta: "AAAA-MM-DD", dataEntrega: "AAAA-MM-DD",
 *            modoEntrega: "RETIRADA" | "ENTREGA", addressId? | endereco?, telefone, observacao?,
 *            aceitePolitica: true, politicaVersao, percentualRetido, totalEsperadoCentavos }
 *
 * Respostas: 201 (200 se for repetição da mesma chave) `{ encomenda: EncomendaDTO }`;
 * 400 por campo (`detalhes["dataFesta"]`, `["dataEntrega"]`, `["itens"]`, `["telefone"]`,
 *     `["aceitePolitica"]`, `["endereco"]`…); 401; 403 origem; 404 `addressId` de outra pessoa;
 * 409 total mudou `detalhes: { precoPotinho, frete, total, entrada, restante, pesoTotalGramas }` (reais)
 *     ou política mudou `detalhes: { politicaVersao, percentualRetido }`;
 * 422 `detalhes: { indisponiveis: productId[] }`, chave reaproveitada com outro conteúdo (potinhos, datas, modo,
 *     telefone, observação ou endereço), ou CEP
 *     inválido/que não bate com a cidade (`detalhes["endereco.cep"]`);
 * 429 limite por hora ou 3 encomendas abertas; 503 recurso desativado ou pagamento indisponível.
 */
export const POST = comTratamento("api/encomendas POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi();
  if (!auth.ok) return auth.resposta;

  // Por conta (não depende de IP): contém quem automatiza solicitações em série.
  if (!dentroDoLimite(`encomendas|${auth.usuario.id}`, MAX_ENCOMENDAS_POR_HORA, 60 * 60_000)) {
    return erro(429, "Muitas solicitações em pouco tempo. Tente novamente mais tarde.");
  }

  const chave = request.headers.get("idempotency-key");
  if (!chave || !FORMATO_CHAVE.test(chave)) {
    return erro(400, "Envie o cabeçalho Idempotency-Key (de 8 a 100 letras, números, _ ou -).");
  }

  const corpo = await lerCorpo(request, encomendaSchema);
  if (!corpo.ok) return corpo.resposta;

  const agora = new Date();
  // Prazos vencidos da cliente gravados antes: uma SOLICITADA expirada não conta como aberta.
  await expirarVencidas(agora, { userId: auth.usuario.id });
  const { encomenda, repetida } = await criarEncomenda(auth.usuario.id, corpo.dados, chave, agora);
  return Response.json({ encomenda }, { status: repetida ? 200 : 201 });
});
