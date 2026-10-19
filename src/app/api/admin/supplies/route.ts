import { autenticarApi, comTratamento, lerCorpo, origemInvalida } from "@/lib/api";
import { criarInsumo, listarInsumos } from "@/lib/producao-admin";
import { insumoSchema } from "@/lib/validacao-producao";

/** GET /api/admin/supplies — insumos com compras, usos, ajustes, sobra e custo médio (o estoque). */
export const GET = comTratamento("api/admin/supplies GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ insumos: await listarInsumos() });
});

/** POST /api/admin/supplies — cadastra um insumo (ex.: Maçã, ingrediente, em gramas). */
export const POST = comTratamento("api/admin/supplies POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const corpo = await lerCorpo(request, insumoSchema);
  if (!corpo.ok) return corpo.resposta;

  const insumo = await criarInsumo(corpo.dados);
  console.info(`[admin] ${auth.usuario.id} cadastrou o insumo ${insumo.id}`);
  return Response.json(insumo, { status: 201 });
});
