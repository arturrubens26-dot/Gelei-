import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { hojeNaLoja } from "@/lib/despesas";
import { executarLote } from "@/lib/planilha/lancamentos-admin";
import { lancamentosDoPeriodo } from "@/lib/planilha/livro";
import { periodoDoMes, validarPeriodo } from "@/lib/planilha/regras";
import { MAX_BYTES_LOTE, MAX_DIAS_PERIODO } from "@/lib/planilha/tipos";
import { loteSchema } from "@/lib/planilha/validacao";

/**
 * GET /api/admin/planilha/lancamentos?de=AAAA-MM-DD&ate=AAAA-MM-DD[&nomes=1] — a carga da grade: lançamentos
 * manuais e automáticos (vendas e mimos) do período, totais, saldo no fim, categorias e autocompletar.
 * Sem período: o mês corrente da loja. Contrato: README, "Planilha financeira".
 */
export const GET = comTratamento("api/admin/planilha/lancamentos GET", async (request: Request) => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const busca = new URL(request.url).searchParams;
  const padrao = periodoDoMes(hojeNaLoja());
  const periodo = validarPeriodo(busca.get("de") ?? padrao.de, busca.get("ate") ?? padrao.ate, MAX_DIAS_PERIODO);
  if (!periodo.ok) return erro(400, periodo.erro);

  return Response.json(await lancamentosDoPeriodo(periodo.valor.de, periodo.valor.ate, { nomes: busca.get("nomes") === "1" }));
});

/**
 * POST /api/admin/planilha/lancamentos — lote de 1 a 200 operações (criar, alterar, excluir) numa transação
 * só. Corpo até 256 KB (413 acima). Erros 404/409/422 com `codigo` e `detalhes.indice` da operação.
 */
export const POST = comTratamento("api/admin/planilha/lancamentos POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const corpo = await lerCorpo(request, loteSchema, { maxBytes: MAX_BYTES_LOTE });
  if (!corpo.ok) return corpo.resposta;

  const resultados = await executarLote(corpo.dados.operacoes, auth.usuario.id);
  const conta = (op: string) => resultados.filter((r) => r.op === op).length;
  console.info(`[planilha] ${auth.usuario.id} gravou um lote: ${conta("criar")} novas, ${conta("alterar")} alteradas, ${conta("excluir")} excluídas`);
  return Response.json({ resultados });
});
