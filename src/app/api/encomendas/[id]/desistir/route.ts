import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { desistirDaEncomenda } from "@/lib/encomendas";
import { desistenciaSchema } from "@/lib/encomendas-regras";

/**
 * POST /api/encomendas/[id]/desistir  { devolucaoEsperadaCentavos } — a cliente desiste da encomenda
 * (Decreto 7.962, art. 5º: pela mesma ferramenta). `devolucaoEsperadaCentavos` é a prévia que a tela
 * mostrou (`encomenda.acoes.desistir.devolucaoCentavos`).
 *
 * Resposta: `{ encomenda: EncomendaDTO, devolucao: { valor, retido } }` (reais). Erros: 404; 409 status
 * final (`detalhes.statusAtual`); 409 a prévia mudou (o corte passou entre a tela e o clique):
 * `detalhes: { statusAtual, devolucao, retido, devolucaoCentavos, retidoCentavos }`, e nada muda.
 */
export const POST = comTratamento(
  "api/encomendas/desistir",
  async (request: Request, ctx: RouteContext<"/api/encomendas/[id]/desistir">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi();
    if (!auth.ok) return auth.resposta;
    if (!dentroDoLimite(`encomenda-desistir|${auth.usuario.id}`, 30, 60 * 60_000)) {
      return erro(429, "Muitas tentativas em pouco tempo. Tente novamente mais tarde.");
    }
    const corpo = await lerCorpo(request, desistenciaSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    return Response.json(await desistirDaEncomenda(id, auth.usuario.id, corpo.dados.devolucaoEsperadaCentavos, new Date()));
  },
);
