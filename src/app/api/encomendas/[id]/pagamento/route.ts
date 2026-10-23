import { z } from "zod";
import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { dentroDoLimite } from "@/lib/auth/limitador";
import { expirarVencidas } from "@/lib/encomendas";
import { abrirCobrancaDaParcela, situacaoDaParcela } from "@/lib/encomendas-pagamentos";
import { MAX_PIX_ENCOMENDA_POR_HORA } from "@/lib/limites";

const parcelaSchema = z.enum(["ENTRADA", "RESTANTE"], "Informe a parcela: ENTRADA ou RESTANTE.");
const corpoSchema = z.object({ parcela: parcelaSchema });

/**
 * GET /api/encomendas/[id]/pagamento?parcela=ENTRADA|RESTANTE — situação da parcela para a tela da
 * cliente: `{ status, entradaPaga, restantePaga, cobranca: CobrancaDTO | null }` (`status` = efetivo).
 * Com o PIX aberto, o servidor pergunta ao gateway no máximo a cada 8 s (a tela pergunta a cada 5 s).
 * 240 consultas a cada 10 min por conta; 404 para encomenda de outra pessoa.
 */
export const GET = comTratamento(
  "api/encomendas/pagamento GET",
  async (request: Request, ctx: RouteContext<"/api/encomendas/[id]/pagamento">) => {
    const auth = await autenticarApi();
    if (!auth.ok) return auth.resposta;
    if (!dentroDoLimite(`encomenda-pagamento-consulta|${auth.usuario.id}`, 240, 10 * 60_000)) {
      return erro(429, "Muitas consultas em pouco tempo. Aguarde um pouco.");
    }
    const parcela = parcelaSchema.safeParse(new URL(request.url).searchParams.get("parcela"));
    if (!parcela.success) return erro(400, "Informe a parcela: ENTRADA ou RESTANTE.", { parcela: ["Use ENTRADA ou RESTANTE."] });

    const { id } = await ctx.params;
    const agora = new Date();
    await expirarVencidas(agora, { userId: auth.usuario.id, encomendaId: id });
    const situacao = await situacaoDaParcela(id, auth.usuario.id, parcela.data, agora);
    if (!situacao) return erro(404, "Encomenda não encontrada.");
    return Response.json(situacao);
  },
);

/**
 * POST /api/encomendas/[id]/pagamento  { parcela } — gera o PIX da parcela (ou devolve o que ainda
 * vale): `{ cobranca: CobrancaDTO }`. Erros: 404; 409 "não está aguardando a entrada", "o prazo para
 * pagar a entrada terminou", "o restante já foi pago", "só com a encomenda confirmada", "o pagamento
 * acabou de ser confirmado" (`detalhes.statusAtual` quando houver); 429 mais de 20 PIX por hora na
 * conta ou mais de 10 na parcela; 503 pagamento indisponível.
 */
export const POST = comTratamento(
  "api/encomendas/pagamento POST",
  async (request: Request, ctx: RouteContext<"/api/encomendas/[id]/pagamento">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi();
    if (!auth.ok) return auth.resposta;
    if (!dentroDoLimite(`encomenda-pagamento-novo|${auth.usuario.id}`, MAX_PIX_ENCOMENDA_POR_HORA, 60 * 60_000)) {
      return erro(429, "Muitos PIX gerados em pouco tempo. Tente novamente mais tarde.");
    }
    const corpo = await lerCorpo(request, corpoSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const agora = new Date();
    await expirarVencidas(agora, { userId: auth.usuario.id, encomendaId: id });
    return Response.json({ cobranca: await abrirCobrancaDaParcela(id, auth.usuario.id, corpo.dados.parcela, agora) });
  },
);
