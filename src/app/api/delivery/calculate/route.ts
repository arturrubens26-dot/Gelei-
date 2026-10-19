import { comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { dentroDoLimitePorCliente } from "@/lib/auth/limitador";
import { consultarCep } from "@/lib/cep";
import { calcularFrete } from "@/lib/frete";
import { calculoFreteSchema } from "@/lib/validacao";

/**
 * POST /api/delivery/calculate
 * Entrada: { cep: string, pesoTotalGramas: number }
 * Saída:   { valor, taxaBase, adicionalPeso, regiao, pesoTotalGramas, endereco }
 *
 * Frete SIMULADO (regras em src/lib/frete.ts). O CEP é validado com
 * cep-promise; o valor cobrado no pedido é recalculado no servidor.
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

  const consulta = await consultarCep(cep);
  if (!consulta.ok) {
    return consulta.motivo === "invalido"
      ? erro(422, "CEP inválido ou não encontrado.")
      : erro(503, "Não foi possível consultar o CEP agora. Tente novamente em instantes.");
  }

  return Response.json({ ...calcularFrete(cep, pesoTotalGramas), endereco: consulta.endereco });
});
