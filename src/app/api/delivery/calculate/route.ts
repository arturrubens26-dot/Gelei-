import { comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { dentroDoLimitePorCliente } from "@/lib/auth/limitador";
import { consultarCep } from "@/lib/cep";
import { taxaDeEntregaAtualCentavos } from "@/lib/entrega";
import { CIDADE_ATENDIDA, UF_ATENDIDA, calcularFrete } from "@/lib/entrega-regras";
import { calculoFreteSchema } from "@/lib/validacao";

/**
 * POST /api/delivery/calculate
 * Entrada: { cep: string, pesoTotalGramas?: number }
 * Saída 200 (CEP de Teresina): { valor, taxaBase, adicionalPeso: 0, regiao: "Teresina/PI", pesoTotalGramas, endereco }
 * 422 fora da área: { erro: MENSAGEM_FORA_DA_AREA, detalhes: { foraDaArea: true } } (sem consultar o CEP).
 * 422 CEP inexistente; 503 serviços de CEP fora do ar.
 *
 * A taxa é fixa (painel) e não depende do peso; o pedido a recalcula no servidor (criarPedido).
 */
export const POST = comTratamento("api/delivery/calculate", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;

  // A rota aciona serviços externos de CEP: limite por IP (com proxy confiável) e, sempre, o
  // semáforo + cache de src/lib/cep.ts protegem os provedores.
  if (!dentroDoLimitePorCliente(request, "frete", { porIp: 30, janelaMs: 60_000 })) {
    return erro(429, "Muitas consultas. Aguarde um instante e tente de novo.");
  }

  const corpo = await lerCorpo(request, calculoFreteSchema);
  if (!corpo.ok) return corpo.resposta;
  const { cep, pesoTotalGramas } = corpo.dados;

  // Fora de Teresina responde sem gastar consulta de CEP.
  const frete = calcularFrete({ modo: "ENTREGA", cep, taxaCentavos: await taxaDeEntregaAtualCentavos() });
  if (!frete.ok) return erro(422, frete.mensagem, frete.motivo === "FORA_DA_AREA" ? { foraDaArea: true } : undefined);

  const consulta = await consultarCep(cep);
  if (!consulta.ok) {
    return consulta.motivo === "invalido"
      ? erro(422, "CEP inválido ou não encontrado.")
      : erro(503, "Não foi possível consultar o CEP agora. Tente novamente em instantes.");
  }

  const valor = frete.freteCentavos / 100;
  return Response.json({
    valor,
    taxaBase: valor,
    adicionalPeso: 0,
    regiao: `${CIDADE_ATENDIDA}/${UF_ATENDIDA}`,
    pesoTotalGramas,
    endereco: consulta.endereco,
  });
});
