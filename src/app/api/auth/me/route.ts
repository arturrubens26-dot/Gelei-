import { comTratamento } from "@/lib/api";
import { getUsuarioAtual } from "@/lib/auth/dal";

/** GET /api/auth/me — usuário logado, ou `{ usuario: null }`. */
export const GET = comTratamento("api/auth/me", async () => {
  return Response.json({ usuario: await getUsuarioAtual() });
});
