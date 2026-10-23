import { z } from "zod";
import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { expirarVencidas } from "@/lib/encomendas";
import { simularPagamentoDaParcela } from "@/lib/encomendas-pagamentos";
import { pagamentosSimuladosAtivos } from "@/lib/pagamentos";

const corpoSchema = z.object({ parcela: z.enum(["ENTRADA", "RESTANTE"], "Informe a parcela: ENTRADA ou RESTANTE.") });

/**
 * POST /api/encomendas/[id]/simular-pagamento  { parcela } — DEMONSTRAÇÃO: paga a parcela da própria
 * encomenda pelo PIX simulado (o mesmo caminho de um pagamento real). Existe só com
 * PAGAMENTOS_SIMULADOS=true e sem Mercado Pago; fora disso responde 404.
 * Resposta: `{ status, entradaPaga, restantePaga, cobranca }` (como o GET .../pagamento).
 */
export const POST = comTratamento(
  "api/encomendas/simular-pagamento",
  async (request: Request, ctx: RouteContext<"/api/encomendas/[id]/simular-pagamento">) => {
    if (!pagamentosSimuladosAtivos()) return erro(404, "Recurso indisponível.");
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi();
    if (!auth.ok) return auth.resposta;
    const corpo = await lerCorpo(request, corpoSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const agora = new Date();
    await expirarVencidas(agora, { userId: auth.usuario.id, encomendaId: id });
    return Response.json(await simularPagamentoDaParcela(id, auth.usuario.id, corpo.dados.parcela, agora));
  },
);
