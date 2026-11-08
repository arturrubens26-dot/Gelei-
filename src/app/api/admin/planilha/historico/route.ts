import { autenticarApi, comTratamento, erro } from "@/lib/api";
import { listarHistorico } from "@/lib/planilha/auditoria";

const ENTIDADES = new Set(["despesa", "entrada", "categoria", "config", "importacao", "usuario"]);

/**
 * GET /api/admin/planilha/historico?entidade=&entidadeId=&limite=50 — o histórico das alterações financeiras
 * (quem criou, alterou ou excluiu o quê), mais recente primeiro. Tudo opcional; limite de 1 a 200.
 */
export const GET = comTratamento("api/admin/planilha/historico GET", async (request: Request) => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;

  const busca = new URL(request.url).searchParams;
  const entidade = busca.get("entidade") ?? undefined;
  const entidadeId = busca.get("entidadeId") ?? undefined;
  const textoLimite = busca.get("limite") ?? "50";
  if (entidade !== undefined && !ENTIDADES.has(entidade)) return erro(400, "Entidade inválida.");
  if (entidadeId !== undefined && (entidadeId.length < 1 || entidadeId.length > 100)) return erro(400, "Identificador inválido.");
  if (!/^\d{1,3}$/.test(textoLimite) || Number(textoLimite) < 1 || Number(textoLimite) > 200) return erro(400, "Limite inválido (1 a 200).");

  return Response.json({ itens: await listarHistorico({ entidade, entidadeId, limite: Number(textoLimite) }) });
});
