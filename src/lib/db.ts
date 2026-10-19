import "server-only";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

// Dois caminhos até o banco, escolhidos pela URL:
// - Neon (o site no ar, nas funções da Netlify): o driver serverless do Neon, como a Neon recomenda
//   para funções serverless. Consulta avulsa vai por HTTP (sem conexão TCP para abrir, nem para ficar
//   aberta entre uma execução e outra da função); transação interativa (pedido, endereço) abre um
//   WebSocket. Use a URL com pooler (-pooler) no DATABASE_URL.
// - Qualquer outro Postgres (o embutido do `prisma dev` neste computador): node-postgres, com um pool
//   só por processo (abaixo).

function urlDoBanco(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não está definida. Veja o .env.example.");
  return url;
}

/** Valor fora de 1–100 (vazio, "abc", -1) vale o padrão: com -1 todo pedido esperava 10 s e virava 503. */
function tamanhoDoPool(): number {
  const pedido = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return pedido >= 1 && pedido <= 100 ? pedido : 10;
}

function ehNeon(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

// Um pool de conexões por processo, guardado no `globalThis`. O build de produção copia este
// módulo para mais de um pacote (páginas e rotas da API), e o hot reload do desenvolvimento o
// recria; sem o `globalThis`, cada cópia abriria o seu pool e o processo, várias conexões.
const globalDoBanco = globalThis as unknown as { poolDoBanco?: pg.Pool };

function criarPool(connectionString: string, max: number): pg.Pool {
  // O banco embutido (pglite-socket 0.1.3, o que vem com o Prisma) tem 10 vagas de conexão, e
  // cada conexão que cai sem se despedir (processo morto: um worker no fim do build, o site
  // fechado no X) ocupa a vaga até o banco reiniciar; sem vagas, tudo falha com "Connection
  // terminated unexpectedly". Fechar a conexão ociosa em 500 ms faz o site quase nunca morrer com
  // uma aberta. No build os workers morrem logo depois da última página (mesmo 500 ms ainda vazava
  // uma vaga por build), então lá ela fecha assim que é devolvida. Em outro Postgres, 10 s.
  // No .env local use DATABASE_POOL_MAX=1: o embutido executa uma consulta por vez.
  const noBuild = process.env.NEXT_PHASE === "phase-production-build";
  const idleTimeoutMillis = max !== 1 ? 10_000 : noBuild ? 1 : 500;
  // `connectionTimeoutMillis`: se o pool saturar, a requisição falha em 10 s (vira 503)
  // em vez de esperar para sempre por uma conexão.
  return new pg.Pool({ connectionString, max, idleTimeoutMillis, connectionTimeoutMillis: 10_000 });
}

// Conexão que cai (banco reiniciado, rede): o pool a descarta e abre outra na próxima consulta.
// Fica só um registro curto, como o de `registrarErro` (que não dá para importar: api.ts importa este).
const aoErroDoPool = (e: Error) => console.error(`[db pool] ${e.name}: ${(e.message.split("\n")[0] ?? "").slice(0, 200)}`);

function adaptador() {
  const connectionString = urlDoBanco();
  const max = tamanhoDoPool();
  if (ehNeon(connectionString)) {
    // Consultas fora de transação pelo fetch (HTTP); transações seguem pelo WebSocket do pool.
    neonConfig.poolQueryViaFetch = true;
    return new PrismaNeon(
      { connectionString, max, connectionTimeoutMillis: 10_000 },
      { onPoolError: aoErroDoPool, onConnectionError: aoErroDoPool },
    );
  }
  return new PrismaPg((globalDoBanco.poolDoBanco ??= criarPool(connectionString, max)), { onPoolError: aoErroDoPool });
}

// O cliente é um por cópia do módulo (só o pool local é compartilhado). Assim os erros do Prisma
// saem das classes da própria cópia, e os `instanceof Prisma.PrismaClientKnownRequestError` (P2002
// da idempotência, P2025) continuam reconhecendo-os. O adaptador não fecha um pool que não criou.
export const db = new PrismaClient({ adapter: adaptador() });
