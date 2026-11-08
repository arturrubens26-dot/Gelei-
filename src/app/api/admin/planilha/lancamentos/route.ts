import { autenticarApi, comTratamento, erro } from "@/lib/api";
import { hojeNaLoja } from "@/lib/despesas";
import { lancamentosDoPeriodo } from "@/lib/planilha/livro";
import { periodoDoMes, validarPeriodo } from "@/lib/planilha/regras";
import { MAX_DIAS_PERIODO } from "@/lib/planilha/tipos";

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
