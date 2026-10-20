import { autenticarApi, comTratamento } from "@/lib/api";
import { listarKitsAdmin } from "@/lib/kits-admin";

/**
 * GET /api/admin/kits — todos os kits, inclusive os ocultos, com as caixas vendidas e a faixa de
 * economia contra os potes avulsos. Resposta: `{ kits: KitAdminDTO[] }`.
 * Valida is_admin no banco a cada chamada.
 */
export const GET = comTratamento("api/admin/kits GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json({ kits: await listarKitsAdmin() });
});
