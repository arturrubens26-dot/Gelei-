// Migrações do Prisma no banco do site no ar (Neon), pela URL DIRETA do .env.producao
// (DATABASE_URL_UNPOOLED): pelo pooler (PgBouncer em modo transação) o Prisma Migrate falha.
//   npm run db:deploy:producao          aplica as migrações pendentes
//   npm run db:deploy:producao status   só mostra o que está aplicado e o que falta
// Aplique ANTES de publicar o código que depende da migração.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivo = path.join(RAIZ, ".env.producao");
if (!existsSync(arquivo)) {
  console.error("Falta o arquivo .env.producao (rode: neon env pull --file .env.producao).");
  process.exit(1);
}
const url = parseEnv(readFileSync(arquivo, "utf8")).DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("O .env.producao não tem DATABASE_URL_UNPOOLED (a URL direta, sem -pooler).");
  process.exit(1);
}

const comando = process.argv[2] === "status" ? "status" : "deploy";
// O prisma.config.ts carrega o .env, mas não sobrescreve uma DATABASE_URL que já está no ambiente.
const r = spawnSync(process.execPath, [path.join(RAIZ, "node_modules", "prisma", "build", "index.js"), "migrate", comando], {
  cwd: RAIZ,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exitCode = r.status ?? 1;
