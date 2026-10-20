import { z } from "zod";
import { autenticarApi, comTratamento, erro, lerCorpo, lerFormulario, origemInvalida } from "@/lib/api";
import { atualizarProduto, definirVisibilidade, excluirProduto, lerProdutoDoFormulario } from "@/lib/produtos-admin";
import { MAX_BYTES_FOTO } from "@/lib/produtos-regras";

const MAX_BYTES_ENVIO = MAX_BYTES_FOTO + 64 * 1024;
const visibilidadeSchema = z.object({ ativo: z.boolean() });

/**
 * PATCH /api/admin/products/[id]
 * - JSON `{ ativo }`: mostra ou oculta o produto na loja;
 * - multipart/form-data: edição completa (os mesmos campos da criação; a foto é opcional).
 */
export const PATCH = comTratamento("api/admin/products PATCH", async (request: Request, ctx: RouteContext<"/api/admin/products/[id]">) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;

  if (request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    const corpo = await lerCorpo(request, visibilidadeSchema);
    if (!corpo.ok) return corpo.resposta;
    const produto = await definirVisibilidade(id, corpo.dados.ativo);
    console.info(`[admin] ${auth.usuario.id} ${corpo.dados.ativo ? "mostrou" : "ocultou"} o produto ${id}`);
    return Response.json({ produto });
  }

  const form = await lerFormulario(request, MAX_BYTES_ENVIO);
  if (!form) return erro(400, "Envie o formulário do produto (multipart/form-data).");
  const lido = await lerProdutoDoFormulario(form, { fotoObrigatoria: false });
  if (!lido.ok) return lido.resposta;
  const produto = await atualizarProduto(id, lido.dados, lido.foto);
  console.info(`[admin] ${auth.usuario.id} editou o produto ${id}`);
  return Response.json({ produto });
});

/** DELETE /api/admin/products/[id] — só para produto sem vendas nem produções (senão 409: oculte). */
export const DELETE = comTratamento("api/admin/products DELETE", async (request: Request, ctx: RouteContext<"/api/admin/products/[id]">) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;
  await excluirProduto(id);
  console.info(`[admin] ${auth.usuario.id} excluiu o produto ${id}`);
  return Response.json({ id, excluido: true });
});
