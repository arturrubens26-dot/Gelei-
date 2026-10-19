import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { criarDespesa, plannerDoMes } from "@/lib/despesas-admin";
import { PADRAO_MES } from "@/lib/despesas";
import { despesaSchema } from "@/lib/validacao";

/**
 * GET /api/admin/expenses?mes=AAAA-MM — o mês no painel de despesas: lançamentos, total por
 * categoria, vendas pagas e saldo. Sem `mes`, o mês corrente (horário de Brasília).
 */
export const GET = comTratamento("api/admin/expenses GET", async (request: Request) => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const mes = new URL(request.url).searchParams.get("mes") ?? undefined;
  if (mes !== undefined && !PADRAO_MES.test(mes)) return erro(400, "Mês inválido (use AAAA-MM).");

  return Response.json(await plannerDoMes(mes));
});

/** POST /api/admin/expenses — lança uma despesa (ex.: Adesivos, 50 un, R$ 20,00). */
export const POST = comTratamento("api/admin/expenses POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const corpo = await lerCorpo(request, despesaSchema);
  if (!corpo.ok) return corpo.resposta;

  const despesa = await criarDespesa(corpo.dados, auth.usuario.id);
  console.info(`[admin] ${auth.usuario.id} lançou a despesa ${despesa.id}`);
  return Response.json(despesa, { status: 201 });
});
