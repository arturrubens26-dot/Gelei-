import { autenticarApi, comTratamento, erroDeValidacao, lerJson, origemInvalida } from "@/lib/api";
import { obterConfigLembrancinhasAdmin, salvarConfigLembrancinhas } from "@/lib/encomendas-admin";
import { configAtivoSchema, configLembrancinhasSchema } from "@/lib/encomendas-regras";

/**
 * GET /api/admin/lembrancinhas (admin) → 200 `{ config: ConfigLembrancinhasAdminDTO }` =
 * `{ ativo, precoPotinhoCentavos, pesoPotinhoGramas, pesoEmbalagemGramas, percentualRetido,
 * atualizadoEm, sabores, pendenciasLegais, avisos, avisoJuridico }`.
 */
export const GET = comTratamento("api/admin/lembrancinhas GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ config: await obterConfigLembrancinhasAdmin() });
});

/**
 * PATCH /api/admin/lembrancinhas (admin, JSON, CSRF) — edição completa `{ precoPotinhoCentavos,
 * pesoPotinhoGramas, pesoEmbalagemGramas, percentualRetido, ativo }` ou só `{ ativo }` →
 * 200 `{ config }`. 400 por campo; 409 `detalhes.pendenciasLegais` ao ativar sem CNPJ/CPF ou e-mail
 * da loja (D13). Encomendas já feitas não mudam (preço e percentual ficam congelados nelas).
 */
export const PATCH = comTratamento("api/admin/lembrancinhas PATCH", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const json = await lerJson(request);
  const soAtivo = json !== null && typeof json === "object" && Object.keys(json).length === 1 && "ativo" in json;
  const lido = soAtivo ? configAtivoSchema.safeParse(json) : configLembrancinhasSchema.safeParse(json);
  if (!lido.success) return erroDeValidacao(lido.error);
  const config = await salvarConfigLembrancinhas(lido.data);
  console.info(`[admin] ${auth.usuario.id} mudou a configuração das lembrancinhas (ativo=${config.ativo})`);
  return Response.json({ config });
});
