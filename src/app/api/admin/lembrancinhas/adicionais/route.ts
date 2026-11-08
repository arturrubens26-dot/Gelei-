import { autenticarApi, comTratamento } from "@/lib/api";
import { listarAdicionaisAdmin } from "@/lib/mimos-adicionais-admin";

/**
 * GET /api/admin/lembrancinhas/adicionais (admin) → 200 `{ adicionais: AdicionalAdminDTO[] }`: os itens
 * adicionais dos mimos (ativos e inativos), com o preço por potinho em centavos (0 = sem custo), a ordem, a
 * imagem enviada (ou `null`: a loja mostra a ilustração padrão) e quantas encomendas já usam cada um.
 */
export const GET = comTratamento("api/admin/lembrancinhas/adicionais GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ adicionais: await listarAdicionaisAdmin() });
});
