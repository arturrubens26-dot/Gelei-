import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

// Um pool de conexões por processo, guardado no `globalThis`. O build de produção copia este
// módulo para mais de um pacote (páginas e rotas da API), e o hot reload do desenvolvimento o
// recria; sem o `globalThis`, cada cópia abriria o seu pool e o processo, várias conexões.
const globalDoBanco = globalThis as unknown as { poolDoBanco?: pg.Pool };

function criarPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não está definida. Veja o .env.example.");
  }
  // Tamanho do pool. No .env local, com o Postgres embutido do `prisma dev`, use
  // DATABASE_POOL_MAX=1: ele executa uma consulta por vez, então mais conexões não ajudam.
  // Valor fora de 1–100 (vazio, "abc", -1) vale o padrão: com -1 todo pedido esperava 10 s e virava 503.
  const pedido = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  const max = pedido >= 1 && pedido <= 100 ? pedido : 10;
  // O banco embutido (pglite-socket 0.1.3, o que vem com o Prisma) tem 10 vagas de conexão, e
  // cada conexão que cai sem se despedir (processo morto: um worker no fim do build, o site
  // fechado no X) ocupa a vaga até o banco reiniciar; sem vagas, tudo falha com "Connection
  // terminated unexpectedly". Fechar a conexão ociosa em 500 ms faz o site quase nunca morrer com
  // uma aberta. No build os workers morrem logo depois da última página (mesmo 500 ms ainda vazava
  // uma vaga por build), então lá ela fecha assim que é devolvida. Em outro Postgres, 10 s.
  const noBuild = process.env.NEXT_PHASE === "phase-production-build";
  const idleTimeoutMillis = max !== 1 ? 10_000 : noBuild ? 1 : 500;
  // `connectionTimeoutMillis`: se o pool saturar, a requisição falha em 10 s (vira 503)
  // em vez de esperar para sempre por uma conexão.
  return new pg.Pool({ connectionString, max, idleTimeoutMillis, connectionTimeoutMillis: 10_000 });
}

const pool = (globalDoBanco.poolDoBanco ??= criarPool());

// Só o pool é compartilhado; o cliente é um por cópia do módulo. Assim os erros do Prisma saem
// das classes da própria cópia, e os `instanceof Prisma.PrismaClientKnownRequestError` (P2002 da
// idempotência, P2025) continuam reconhecendo-os. O adaptador não fecha um pool que não criou.
// Conexão ociosa que cai (banco reiniciado, rede): o pool a descarta e abre outra na próxima consulta.
// Fica só um registro curto, como o de `registrarErro` (que não dá para importar: api.ts importa este).
const aoErroDoPool = (e: Error) => console.error(`[db pool] ${e.name}: ${(e.message.split("\n")[0] ?? "").slice(0, 200)}`);
export const db = new PrismaClient({ adapter: new PrismaPg(pool, { onPoolError: aoErroDoPool }) });
