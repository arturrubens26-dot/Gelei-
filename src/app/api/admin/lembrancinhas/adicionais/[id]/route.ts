import { autenticarApi, comTratamento, erro, lerCorpo, lerFormulario, origemInvalida } from "@/lib/api";
import { adicionalAtivoSchema } from "@/lib/adicionais-regras";
import { atualizarAdicional, definirAtivoDoAdicional, lerAdicionalDoFormulario } from "@/lib/mimos-adicionais-admin";
import { MAX_BYTES_FOTO } from "@/lib/produtos-regras";

const MAX_BYTES_ENVIO = MAX_BYTES_FOTO + 64 * 1024;

/**
 * PATCH /api/admin/lembrancinhas/adicionais/[id] (admin, CSRF)
 * - JSON `{ ativo }`: mostra ou oculta o item no formulário dos mimos;
 * - multipart/form-data: edição completa `{ nome, descricao, precoCentavos (0 = sem custo), ativo, ordem }`, com
 *   `foto` opcional (JPG, PNG ou WebP até 2 MB; o navegador já reduz) e `removerFoto` para voltar à ilustração padrão.
 * → 200 `{ adicional }`; 400 por campo; 404. Encomendas já feitas não mudam (nome e preço ficam congelados nelas).
 */
export const PATCH = comTratamento(
  "api/admin/lembrancinhas/adicionais PATCH",
  async (request: Request, ctx: RouteContext<"/api/admin/lembrancinhas/adicionais/[id]">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const { id } = await ctx.params;

    if (request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      const corpo = await lerCorpo(request, adicionalAtivoSchema);
      if (!corpo.ok) return corpo.resposta;
      const adicional = await definirAtivoDoAdicional(id, corpo.dados.ativo);
      console.info(`[admin] ${auth.usuario.id} ${corpo.dados.ativo ? "mostrou" : "ocultou"} o item adicional ${id}`);
      return Response.json({ adicional });
    }

    const form = await lerFormulario(request, MAX_BYTES_ENVIO);
    if (!form) return erro(400, "Envie o formulário do item (multipart/form-data).");
    const lido = await lerAdicionalDoFormulario(form);
    if (!lido.ok) return lido.resposta;
    const adicional = await atualizarAdicional(id, lido.dados, lido.foto);
    console.info(`[admin] ${auth.usuario.id} editou o item adicional ${id} (preço ${adicional.precoCentavos} centavos por potinho)`);
    return Response.json({ adicional });
  },
);
