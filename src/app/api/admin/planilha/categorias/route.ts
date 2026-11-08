import { autenticarApi, comTratamento, lerCorpo, origemInvalida } from "@/lib/api";
import { criarCategoria, listarCategorias } from "@/lib/planilha/categorias-admin";
import { novaCategoriaSchema } from "@/lib/planilha/validacao";

/** GET /api/admin/planilha/categorias — todas as categorias (inclusive inativas e as de sistema), com o uso. */
export const GET = comTratamento("api/admin/planilha/categorias GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ categorias: await listarCategorias() });
});

/** POST /api/admin/planilha/categorias — `{ tipo, nome, grupo?, foraDoResultado? }` → 201; nome repetido: 409. */
export const POST = comTratamento("api/admin/planilha/categorias POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const corpo = await lerCorpo(request, novaCategoriaSchema);
  if (!corpo.ok) return corpo.resposta;

  const categoria = await criarCategoria(corpo.dados, auth.usuario.id);
  console.info(`[planilha] ${auth.usuario.id} criou a categoria ${categoria.id}`);
  return Response.json(categoria, { status: 201 });
});
