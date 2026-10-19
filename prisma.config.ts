import { defineConfig, env } from "prisma/config";

// O Prisma 7 não carrega o .env sozinho. O Node já sabe fazer isso.
try {
  process.loadEnvFile();
} catch {
  // Sem .env: DATABASE_URL precisa vir do ambiente (CI, produção).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
