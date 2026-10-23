import { comTratamento } from "@/lib/api";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { temEncomendas } from "@/lib/encomendas";

/**
 * GET /api/auth/me — `{ usuario, temEncomendas }`: o usuário logado (ou `null`) e se ele já fez alguma
 * encomenda de lembrancinhas (para o menu mostrar "Minhas encomendas" mesmo com o recurso fechado).
 * Sem sessão: `{ usuario: null, temEncomendas: false }`.
 */
export const GET = comTratamento("api/auth/me", async () => {
  const usuario = await getUsuarioAtual();
  return Response.json({ usuario, temEncomendas: usuario ? await temEncomendas(usuario.id) : false });
});
