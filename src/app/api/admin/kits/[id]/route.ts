import { autenticarApi, comTratamento, erro, erroDeValidacao, lerJson, origemInvalida } from "@/lib/api";
import { atualizarKit, definirVisibilidadeKit } from "@/lib/kits-admin";
import { kitSchema, kitVisibilidadeSchema } from "@/lib/kits-regras";

/** Corpo com só o campo `ativo`: é o botão "Mostrar na loja", não a edição completa. */
const soVisibilidade = (corpo: unknown) =>
  typeof corpo === "object" && corpo !== null && !Array.isArray(corpo) && Object.keys(corpo).length === 1 && "ativo" in corpo;

/**
 * PATCH /api/admin/kits/[id] — só JSON. Resposta: `{ kit: KitAdminDTO }`.
 * - `{ ativo }`: mostra ou oculta o kit na loja;
 * - `{ nome, descricao, precoCentavos, pesoCaixaGramas, ativo }`: edição completa (todos os campos).
 * A vitrine expira o cache dos kits na hora (tag "kits"). Sem POST nem DELETE na v1.
 */
export const PATCH = comTratamento("api/admin/kits PATCH", async (request: Request, ctx: RouteContext<"/api/admin/kits/[id]">) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const { id } = await ctx.params;

  const corpo = await lerJson(request);
  if (corpo === undefined) return erro(400, "Envie um corpo JSON (Content-Type: application/json).");

  if (soVisibilidade(corpo)) {
    const lido = kitVisibilidadeSchema.safeParse(corpo);
    if (!lido.success) return erroDeValidacao(lido.error);
    const kit = await definirVisibilidadeKit(id, lido.data.ativo);
    console.info(`[admin] ${auth.usuario.id} ${lido.data.ativo ? "mostrou" : "ocultou"} o kit ${id}`);
    return Response.json({ kit });
  }

  const lido = kitSchema.safeParse(corpo);
  if (!lido.success) return erroDeValidacao(lido.error);
  const kit = await atualizarKit(id, lido.data);
  console.info(`[admin] ${auth.usuario.id} editou o kit ${id} (preço ${kit.preco.toFixed(2)}, ${kit.ativo ? "visível" : "oculto"})`);
  return Response.json({ kit });
});
