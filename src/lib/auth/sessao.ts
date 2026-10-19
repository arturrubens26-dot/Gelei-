import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

const emProducao = process.env.NODE_ENV === "production";
// O prefixo `__Host-` faz o navegador exigir Secure + path=/ + sem Domain: o cookie não pode ser
// sobrescrito por subdomínios. Só em produção (HTTPS); em desenvolvimento (http) seria recusado.
const NOME_COOKIE = emProducao ? "__Host-geleio_sessao" : "geleio_sessao";

const DURACAO_CLIENTE_SEGUNDOS = 60 * 60 * 24 * 7; // 7 dias
const DURACAO_ADMIN_SEGUNDOS = 60 * 60 * 12; // 12 horas: o painel é mais sensível e não há MFA

function chaveSecreta(): Uint8Array {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo || segredo.length < 32) {
    throw new Error("SESSION_SECRET ausente ou curta demais (mínimo 32 caracteres).");
  }
  return new TextEncoder().encode(segredo);
}

/**
 * A sessão guarda SÓ o id do usuário. Papel (admin) e demais dados são sempre
 * lidos do banco a cada requisição, então rebaixar um admin vale na hora.
 * A duração é menor para administradores.
 */
export async function criarSessao(userId: string, opcoes: { admin: boolean }): Promise<void> {
  const duracao = opcoes.admin ? DURACAO_ADMIN_SEGUNDOS : DURACAO_CLIENTE_SEGUNDOS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${duracao}s`)
    .sign(chaveSecreta());

  (await cookies()).set(NOME_COOKIE, token, {
    httpOnly: true,
    secure: emProducao,
    sameSite: "lax",
    path: "/",
    maxAge: duracao,
  });
}

export async function lerSessao(): Promise<{ userId: string } | null> {
  const token = (await cookies()).get(NOME_COOKIE)?.value;
  if (!token) return null;
  // Fora do try de propósito: SESSION_SECRET ausente é erro de configuração e deve
  // estourar alto (500 + log), não deslogar todo mundo em silêncio.
  const chave = chaveSecreta();
  try {
    const { payload } = await jwtVerify(token, chave, { algorithms: ["HS256"] });
    return payload.sub ? { userId: payload.sub } : null;
  } catch {
    // Token expirado, adulterado ou malformado.
    return null;
  }
}

export async function encerrarSessao(): Promise<void> {
  // Não usar `cookies().delete()`: ele não envia `Secure`, e o navegador REJEITA (em silêncio) apagar
  // um cookie com prefixo `__Host-` sem `Secure` — o logout parecia funcionar e a sessão continuava.
  // Apaga com os mesmos atributos do cookie original e expiração imediata.
  (await cookies()).set(NOME_COOKIE, "", {
    httpOnly: true,
    secure: emProducao,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
