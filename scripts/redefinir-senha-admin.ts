/**
 * Redefine a senha de um ADMINISTRADOR. Você digita a senha no terminal: ela não aparece na tela,
 * não vai para o histórico e não passa pelo chat. Uso: npm run admin:senha
 *
 * Só altera contas que já são admin (não serve para tomar contas de clientes). O SEED_ADMIN_PASSWORD
 * do .env só vale na criação do admin; depois disso é ignorado.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline";
import { PrismaClient } from "../src/generated/prisma/client";

try {
  process.loadEnvFile();
} catch {
  // Sem .env: usa só as variáveis do ambiente.
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não está definida. Veja o .env.");
  process.exit(1);
}

const emProducao = process.env.NODE_ENV === "production";
const MINIMO = emProducao ? 12 : 8;
const MAX_BYTES = 72; // o bcrypt só considera os primeiros 72 bytes

// Entrada canalizada (sem terminal, como nos testes): uma única leitura com fila, senão a primeira
// leitura engole as linhas seguintes.
const linhasRecebidas: string[] = [];
const aguardando: ((linha: string) => void)[] = [];
let leitorCanalizado: ReturnType<typeof createInterface> | null = null;

function perguntarCanalizado(pergunta: string): Promise<string> {
  if (!leitorCanalizado) {
    leitorCanalizado = createInterface({ input: process.stdin, terminal: false });
    leitorCanalizado.on("line", (linha) => {
      const espera = aguardando.shift();
      if (espera) espera(linha);
      else linhasRecebidas.push(linha);
    });
    leitorCanalizado.on("close", () => {
      while (aguardando.length) aguardando.shift()!("");
    });
  }
  process.stdout.write(pergunta);
  const pronta = linhasRecebidas.shift();
  if (pronta !== undefined) return Promise.resolve(pronta);
  return new Promise((resolver) => aguardando.push(resolver));
}

/** Lê uma linha. Com `oculto`, não mostra o que é digitado (terminal interativo). */
function perguntar(pergunta: string, oculto: boolean): Promise<string> {
  if (!process.stdin.isTTY) return perguntarCanalizado(pergunta);

  if (!oculto) {
    // Terminal interativo, pergunta comum (o e-mail): uma leitura de uma linha.
    return new Promise((resolver) => {
      const leitor = createInterface({ input: process.stdin, output: process.stdout });
      leitor.question(pergunta, (linha) => {
        leitor.close();
        resolver(linha);
      });
    });
  }

  return new Promise((resolver) => {
    process.stdout.write(pergunta);
    let digitado = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const aoDigitar = (tecla: string) => {
      for (const c of tecla) {
        if (c === "\r" || c === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", aoDigitar);
          process.stdout.write("\n");
          resolver(digitado);
          return;
        }
        if (c === "\u0003") process.exit(130); // Ctrl+C
        if (c === "\u007f" || c === "\b") digitado = digitado.slice(0, -1);
        else digitado += c;
      }
    };
    process.stdin.on("data", aoDigitar);
  });
}

async function principal() {
  const padrao = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase();
  const resposta = (await perguntar(`E-mail do administrador${padrao ? ` [${padrao}]` : ""}: `, false)).trim().toLowerCase();
  const email = resposta || padrao;
  if (!email) throw new Error("Informe o e-mail do administrador.");

  const senha = await perguntar(`Nova senha (mínimo ${MINIMO} caracteres): `, true);
  const confirmacao = await perguntar("Repita a nova senha: ", true);

  if (senha !== confirmacao) throw new Error("As senhas não conferem. Nada foi alterado.");
  if (senha.length < MINIMO) throw new Error(`A senha precisa ter pelo menos ${MINIMO} caracteres.`);
  if (Buffer.byteLength(senha, "utf8") > MAX_BYTES) {
    throw new Error("A senha é longa demais (máximo de 72 bytes; acentos e emojis ocupam mais de 1).");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const usuario = await db.user.findUnique({ where: { email }, select: { id: true, isAdmin: true } });
    if (!usuario) throw new Error(`Não existe conta com o e-mail ${email}.`);
    if (!usuario.isAdmin) throw new Error(`${email} não é administrador: este comando só troca senha de admin.`);

    // A versão de sessão sobe junto: as sessões abertas com a senha antiga (outro navegador) caem.
    await db.user.update({
      where: { id: usuario.id },
      data: { passwordHash: await bcrypt.hash(senha, 12), sessaoVersao: { increment: 1 } },
    });
    console.log(`✔ Senha de ${email} redefinida e sessões antigas encerradas. Já pode entrar em /login com ela.`);
  } finally {
    await db.$disconnect();
  }
}

principal().catch((erro) => {
  console.error(`✖ ${erro instanceof Error ? erro.message : erro}`);
  process.exitCode = 1;
});
