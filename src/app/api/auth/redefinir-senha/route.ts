import { after } from "next/server";
import { comTratamento, erro, lerCorpo, origemInvalida, registrarErro } from "@/lib/api";
import { dentroDoLimitePorCliente } from "@/lib/auth/limitador";
import { avisarSenhaAlterada, redefinirComToken } from "@/lib/auth/redefinicao";
import { redefinirSenhaSchema } from "@/lib/validacao";

/**
 * POST /api/auth/redefinir-senha `{ token, senha }` → 200 `{ ok: true }`. A senha é conferida ANTES
 * de gastar o token (400 com `detalhes.senha`). Token vencido, usado, substituído, malformado ou de
 * admin: 400 `{ erro: "Este link não vale mais. Peça um novo." }`, sem `detalhes`. 403 CSRF; 429 por IP.
 * Não abre sessão: a cliente entra pelo /login (o limitador de login continua valendo), e as sessões
 * antigas da conta deixam de valer (versão de sessão).
 */
export const POST = comTratamento("api/auth/redefinir-senha", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;
  if (!dentroDoLimitePorCliente(request, "redefinir-senha", { porIp: 10, janelaMs: 15 * 60_000 })) {
    return erro(429, "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
  }

  const corpo = await lerCorpo(request, redefinirSenhaSchema);
  if (!corpo.ok) return corpo.resposta;

  const conta = await redefinirComToken(corpo.dados.token, corpo.dados.senha);
  after(() => avisarSenhaAlterada(conta).catch((e) => registrarErro("api/auth/redefinir-senha (aviso)", e)));
  return Response.json({ ok: true });
});
