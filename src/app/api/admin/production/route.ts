import { autenticarApi, comTratamento, lerCorpo, origemInvalida } from "@/lib/api";
import { criarProducao, listarProducoes } from "@/lib/producao-admin";
import { producaoSchema } from "@/lib/validacao-producao";

/** GET /api/admin/production — lotes de geleia, do mais recente ao mais antigo, com custo por pote e margem. */
export const GET = comTratamento("api/admin/production GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ producoes: await listarProducoes() });
});

/**
 * POST /api/admin/production — registra um lote: ingredientes e embalagens usados (o custo sai das
 * compras ou do valor informado), custos da produção (gás, energia…) e quantos potes renderam.
 */
export const POST = comTratamento("api/admin/production POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const corpo = await lerCorpo(request, producaoSchema);
  if (!corpo.ok) return corpo.resposta;

  const lote = await criarProducao(corpo.dados, auth.usuario.id);
  console.info(`[admin] ${auth.usuario.id} registrou a produção ${lote.id}`);
  return Response.json(lote, { status: 201 });
});
