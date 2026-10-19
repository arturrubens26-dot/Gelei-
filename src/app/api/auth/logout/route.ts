import { comTratamento, origemInvalida } from "@/lib/api";
import { encerrarSessao } from "@/lib/auth/sessao";

/** POST /api/auth/logout — encerra a sessão. */
export const POST = comTratamento("api/auth/logout", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;

  await encerrarSessao();
  return Response.json({ ok: true });
});
