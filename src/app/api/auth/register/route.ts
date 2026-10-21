import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { gerarHash } from "@/lib/auth/hash";
import { dentroDoLimitePorCliente } from "@/lib/auth/limitador";
import { criarSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { registroSchema } from "@/lib/validacao";

/** POST /api/auth/register — cria conta de cliente e já abre a sessão. */
export const POST = comTratamento("api/auth/register", async (request: Request) => {
  const bloqueio = origemInvalida(request);
  if (bloqueio) return bloqueio;

  // Só com proxy confiável existe limite por IP; sem ele o semáforo do bcrypt protege a CPU.
  if (!dentroDoLimitePorCliente(request, "registro", { porIp: 10, janelaMs: 60 * 60_000 })) {
    return erro(429, "Muitas tentativas de cadastro. Tente novamente mais tarde.");
  }

  const corpo = await lerCorpo(request, registroSchema);
  if (!corpo.ok) return corpo.resposta;
  const { nome, email, senha } = corpo.dados;

  try {
    // `isAdmin` não vem da entrada: toda conta criada aqui é de cliente.
    const usuario = await db.user.create({
      data: { nome, email, passwordHash: await gerarHash(senha) },
      select: { id: true, nome: true, email: true, isAdmin: true, sessaoVersao: true },
    });
    await criarSessao(usuario.id, { admin: false, versao: usuario.sessaoVersao });
    return Response.json(
      { usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, isAdmin: usuario.isAdmin } },
      { status: 201 },
    );
  } catch (e) {
    unstable_rethrow(e); // criarSessao() usa cookies(): sinais internos do Next não são erros daqui
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return erro(409, "Este e-mail já está cadastrado. Tente entrar.");
    }
    throw e;
  }
});
