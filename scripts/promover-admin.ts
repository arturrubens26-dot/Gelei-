/**
 * Promove a ADMINISTRADOR uma conta que já existe (a pessoa se cadastrou pelo site, com a senha dela).
 * Uso: npm run admin:promover -- email@exemplo.com
 *
 * Sobe `sessao_versao` junto: a sessão de cliente que ela já tinha aberta (7 dias) cai, e o próximo
 * login já sai com a duração de admin (12 h). Não mexe na senha. `isAdmin` nunca vem de entrada do
 * site: só deste comando, rodado no PC do dono.
 */
import { PrismaPg } from "@prisma/adapter-pg";
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

async function principal() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe o e-mail: npm run admin:promover -- email@exemplo.com");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const usuario = await db.user.findUnique({ where: { email }, select: { id: true, nome: true, isAdmin: true } });
    if (!usuario) throw new Error(`Não existe conta com o e-mail ${email}. Ela precisa se cadastrar no site primeiro.`);
    if (usuario.isAdmin) {
      console.log(`✔ ${email} já é administrador. Nada foi alterado.`);
      return;
    }
    // `select` mínimo: o cliente gerado pode conhecer colunas que o banco de produção ainda não tem.
    await db.user.update({
      where: { id: usuario.id },
      data: { isAdmin: true, sessaoVersao: { increment: 1 } },
      select: { id: true },
    });
    console.log(`✔ ${usuario.nome} (${email}) agora é administrador. Ela precisa entrar de novo em /login.`);
  } finally {
    await db.$disconnect();
  }
}

principal().catch((erro) => {
  console.error(`✖ ${erro instanceof Error ? erro.message : erro}`);
  process.exitCode = 1;
});
