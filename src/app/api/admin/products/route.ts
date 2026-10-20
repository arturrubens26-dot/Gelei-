import { autenticarApi, comTratamento, erro, lerFormulario, origemInvalida } from "@/lib/api";
import { criarProduto, lerProdutoDoFormulario, listarProdutosAdmin } from "@/lib/produtos-admin";
import { MAX_BYTES_FOTO } from "@/lib/produtos-regras";

/** Folga para os campos de texto e o envelope do multipart, além da foto. */
const MAX_BYTES_ENVIO = MAX_BYTES_FOTO + 64 * 1024;

/** GET /api/admin/products — todos os produtos, inclusive os ocultos, com o histórico de cada um. */
export const GET = comTratamento("api/admin/products GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ produtos: await listarProdutosAdmin() });
});

/**
 * POST /api/admin/products — cria um produto. multipart/form-data com sabor, pesoGramas,
 * precoCentavos, descricao, ativo e foto (obrigatória; JPG, PNG ou WebP, até 2 MB).
 */
export const POST = comTratamento("api/admin/products POST", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const form = await lerFormulario(request, MAX_BYTES_ENVIO);
  if (!form) return erro(400, "Envie o formulário do produto (multipart/form-data).");
  const lido = await lerProdutoDoFormulario(form, { fotoObrigatoria: true });
  if (!lido.ok) return lido.resposta;

  const produto = await criarProduto(lido.dados, lido.foto!);
  console.info(`[admin] ${auth.usuario.id} criou o produto ${produto.id}`);
  return Response.json({ produto }, { status: 201 });
});
