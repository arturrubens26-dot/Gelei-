import { comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { conferirContraHashFalso, conferirSenha } from "@/lib/auth/hash";
import {
  LIMITE_TENTATIVAS_CONTA_E_IP,
  LIMITE_TENTATIVAS_POR_CONTA_COM_IP,
  LIMITE_TENTATIVAS_POR_CONTA_SEM_IP,
  dentroDoLimitePorCliente,
  ipConfiavel,
  liberarTentativa,
  limparTentativas,
  reservarTentativa,
} from "@/lib/auth/limitador";
import { criarSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/validacao";

/** POST /api/auth/login — abre a sessão. */
export const POST = comTratamento("api/auth/login", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;

  // Com proxy confiável há um teto por minuto por IP. Sem ele, quem protege a CPU é o semáforo do bcrypt.
  if (!dentroDoLimitePorCliente(request, "login-tentativas", { porIp: 20, janelaMs: 60_000 })) {
    return erro(429, "Muitas tentativas. Aguarde um instante e tente novamente.");
  }

  const corpo = await lerCorpo(request, loginSchema);
  if (!corpo.ok) return corpo.resposta;
  const { email, senha } = corpo.dados;

  // Reserva a tentativa ANTES de gastar CPU (e antes de qualquer await): uma rajada paralela de
  // palpites contra a mesma conta não passa toda de uma vez. Com IP confiável o bloqueio é por
  // conta+IP (o atacante não tranca a conta da vítima a partir do próprio IP), com teto por conta.
  const ip = ipConfiavel(request);
  const chaveConta = `login|conta|${email}`;
  const chaveContaIp = ip ? `login|conta-ip|${email}|${ip}` : null;

  const permitido = chaveContaIp
    ? reservarTentativa(chaveContaIp, LIMITE_TENTATIVAS_CONTA_E_IP) &&
      reservarTentativa(chaveConta, LIMITE_TENTATIVAS_POR_CONTA_COM_IP)
    : reservarTentativa(chaveConta, LIMITE_TENTATIVAS_POR_CONTA_SEM_IP);
  if (!permitido) {
    return erro(429, "Muitas tentativas para esta conta. Aguarde alguns minutos e tente novamente.");
  }

  const usuario = await db.user.findUnique({
    where: { email },
    select: { id: true, nome: true, email: true, isAdmin: true, passwordHash: true, sessaoVersao: true },
  });

  // Sempre roda uma comparação de bcrypt, mesmo sem usuário, para o tempo não revelar e-mails cadastrados.
  const senhaConfere = usuario
    ? await conferirSenha(senha, usuario.passwordHash)
    : await conferirContraHashFalso(senha);
  if (!usuario || !senhaConfere) {
    return erro(401, "E-mail ou senha incorretos.");
  }

  // Sucesso: zera o contador desta conta+IP e devolve a vaga do teto por conta.
  if (chaveContaIp) {
    limparTentativas(chaveContaIp);
    liberarTentativa(chaveConta);
  } else {
    limparTentativas(chaveConta);
  }
  await criarSessao(usuario.id, { admin: usuario.isAdmin, versao: usuario.sessaoVersao });
  return Response.json({
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, isAdmin: usuario.isAdmin },
  });
});
