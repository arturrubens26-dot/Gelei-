import { autenticarApi, comTratamento, lerCorpo, origemInvalida } from "@/lib/api";
import { gerarLinkPeloPainel } from "@/lib/auth/redefinicao";
import { linkSenhaSchema } from "@/lib/validacao";

/**
 * POST /api/admin/clientes/[id]/link-senha
 * `{ conferencia: ("EMAIL"|"NOME"|"PEDIDO"|"ENDERECO"|"TELEFONE")[], observacao?: string }` →
 * 201 `{ link, expiraEm, mensagemSugerida }` (o link aparece UMA vez; `no-store`).
 * 400 `detalhes.conferencia` (conferência insuficiente); 404 (não existe ou é admin); 429; 503 sem APP_URL.
 */
export const POST = comTratamento(
  "api/admin/clientes/link-senha",
  async (request: Request, ctx: RouteContext<"/api/admin/clientes/[id]/link-senha">) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const { id } = await ctx.params;

    const corpo = await lerCorpo(request, linkSenhaSchema);
    if (!corpo.ok) return corpo.resposta;
    const gerado = await gerarLinkPeloPainel({
      clienteId: id,
      adminId: auth.usuario.id,
      conferencia: corpo.dados.conferencia,
      observacao: corpo.dados.observacao,
    });
    // O link é uma credencial de uso único: nunca em cache (o comTratamento também marca, mas aqui é explícito).
    return Response.json(gerado, { status: 201, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  },
);
