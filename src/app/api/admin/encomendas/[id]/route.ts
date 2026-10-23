import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { detalheEncomendaAdmin, executarAcaoAdmin } from "@/lib/encomendas-admin";
import { acaoAdminSchema } from "@/lib/encomendas-regras";

/**
 * GET /api/admin/encomendas/[id] (admin) → 200 `{ encomenda: EncomendaAdminDetalheDTO }` (cliente,
 * telefone, itens, endereço ou retirada, cobranças (com `emConferencia` e `conferenciaAte`), devoluções
 * (com os `id` que o `devolucao-feita` manda de volta), linha do tempo, `acoes`, faixa do cancelamento,
 * `whatsapp: { texto, link }` e a agenda de E−3 a E+3); 404.
 */
export const GET = comTratamento(
  "api/admin/encomendas GET [id]",
  async (_request: Request, ctx: RouteContext<"/api/admin/encomendas/[id]">) => {
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const { id } = await ctx.params;
    const encomenda = await detalheEncomendaAdmin(id, new Date());
    if (!encomenda) return erro(404, "Encomenda não encontrada.");
    return Response.json({ encomenda });
  },
);

/**
 * PATCH /api/admin/encomendas/[id] (admin, JSON, CSRF) — uma ação por vez, SEMPRE com o
 * `statusEsperado` (o `statusEfetivo` que a tela mostrava):
 *   { acao: "aprovar" } | { acao: "recusar", motivo } | { acao: "iniciar-producao" } |
 *   { acao: "marcar-pronta" } | { acao: "marcar-entregue" } |
 *   { acao: "registrar-entrada", formaPagamento, observacao? } |
 *   { acao: "registrar-restante", formaPagamento, observacao? } |
 *   { acao: "cancelar", motivo, devolverCentavos, aPedidoDaCliente? } |
 *   { acao: "devolucao-feita", devolucaoIds: string[], observacao? } | { acao: "avisada", status }
 * → 200 `{ encomenda: EncomendaAdminDetalheDTO, aviso? }`. 400 por campo (motivo de 5 a 300
 * caracteres; `devolverCentavos` fora da faixa da ficha, com `detalhes.minimoCentavos/maximoCentavos`;
 * `devolucaoIds` vazio); 404; 409 `{ statusAtual, motivo: "status-mudou" | "transicao-invalida" |
 * "prazo-vencido" | "nao-quitada" | "pagamento-em-conferencia" | "devolucao-mudou" }`.
 *
 * - `registrar-entrada`: só com a encomenda aguardando a entrada; dá a entrada como recebida fora do site
 *   (ou conferida no app InfinitePay), a encomenda vira CONFIRMADA. Com pagamento da entrada em
 *   conferência (no máximo 24 h), 409 "pagamento-em-conferencia" com `detalhes.conferenciaAte`.
 * - `cancelar` vale mesmo com pagamento em conferência (devolve `aviso` de conferir no app InfinitePay);
 *   se o dinheiro aparecer depois, vira devolução pendente.
 * - `devolucao-feita` fecha SÓ as devoluções pendentes cujos `id` a tela mandou, todas ou nenhuma; se
 *   alguma já não está pendente, 409 "devolucao-mudou" e nada muda. Uma devolução nova segue pendente.
 */
export const PATCH = comTratamento(
  "api/admin/encomendas PATCH",
  async (request: Request, ctx: RouteContext<"/api/admin/encomendas/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const corpo = await lerCorpo(request, acaoAdminSchema);
    if (!corpo.ok) return corpo.resposta;
    const { id } = await ctx.params;
    return Response.json(await executarAcaoAdmin(id, corpo.dados, auth.usuario.id, new Date()));
  },
);
