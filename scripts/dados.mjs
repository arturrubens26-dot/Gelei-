// Cópia dos dados do site em arquivo, guardada num Git só deste computador (a pasta dados/, que é
// um repositório à parte e NUNCA vai para o GitHub: tem clientes, endereços e pedidos — LGPD).
// O banco fica fora da pasta do projeto, e o Git só versiona arquivos; por isso esta cópia.
//
//   node scripts/dados.mjs salvar [--producao] [--commit]
//       grava dados/local.json (banco deste computador, do .env) ou dados/producao.json (banco do site
//       no ar, do .env.producao) e, com --commit, registra no Git da pasta dados/.
//   node scripts/dados.mjs restaurar <arquivo> [--producao] --confirmar
//       TROCA todos os dados do banco pelos do arquivo (antes guarda os atuais em dados/copias-de-seguranca/).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASTA = path.join(RAIZ, "dados");
const SEGURANCA = path.join(PASTA, "copias-de-seguranca");
const FORMATO = "geleio-dados";
const VERSAO = 1;

const q = (nome) => `"${nome.replace(/"/g, '""')}"`;

/**
 * URL do banco. Local: DATABASE_URL do ambiente ou do .env. Produção: SÓ a do .env.producao (nunca
 * a do ambiente, para um engano não gravar no banco errado). No .env.producao vai a URL direta do
 * Neon (sem "-pooler"): a cópia usa uma transação longa só de leitura.
 */
function urlDoBanco(producao) {
  if (producao) {
    const arquivo = path.join(RAIZ, ".env.producao");
    if (!existsSync(arquivo)) throw new Error("Falta o arquivo .env.producao com a DATABASE_URL do banco do site no ar.");
    const url = parseEnv(readFileSync(arquivo, "utf8")).DATABASE_URL;
    if (!url) throw new Error("O .env.producao não tem DATABASE_URL.");
    return url;
  }
  if (!process.env.DATABASE_URL && existsSync(path.join(RAIZ, ".env"))) process.loadEnvFile(path.join(RAIZ, ".env"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está definida (veja o .env).");
  return process.env.DATABASE_URL;
}

async function conectar(producao) {
  const c = new pg.Client({ connectionString: urlDoBanco(producao), connectionTimeoutMillis: 15_000 });
  // Os erros chegam pelas consultas; sem um ouvinte, um erro solto da conexão derrubaria o processo.
  c.on("error", () => {});
  try {
    await c.connect();
  } catch {
    throw new Error(
      producao ? "Não consegui conectar ao banco do site no ar (confira o .env.producao e a internet)." : "Não consegui conectar ao banco local. Ele está ligado? (iniciar.bat ou npm run db:dev)",
    );
  }
  return c;
}

/** Tabelas do site (sem a de controle das migrações), na ordem em que podem ser inseridas: pais antes dos filhos. */
async function tabelasEmOrdem(c) {
  const nomes = (
    await c.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations' order by 1`,
    )
  ).rows.map((r) => r.table_name);
  const fks = (
    await c.query(
      `select conrelid::regclass::text as filho, confrelid::regclass::text as pai
       from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`,
    )
  ).rows;
  const pais = new Map(nomes.map((n) => [n, new Set()]));
  for (const { filho, pai } of fks) if (filho !== pai && pais.has(filho) && pais.has(pai)) pais.get(filho).add(pai);
  const ordem = [];
  const restantes = new Set(nomes);
  while (restantes.size > 0) {
    const prontas = [...restantes].filter((n) => [...pais.get(n)].every((p) => !restantes.has(p))).sort();
    if (prontas.length === 0) throw new Error(`Dependência circular entre as tabelas: ${[...restantes].join(", ")}`);
    for (const n of prontas) {
      ordem.push(n);
      restantes.delete(n);
    }
  }
  return ordem;
}

async function migracoes(c) {
  const r = await c.query(
    `select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name`,
  );
  return r.rows.map((x) => x.migration_name);
}

/** Linhas da tabela como texto JSON, na ordem da chave primária (a mesma a cada cópia: o Git mostra só o que mudou). */
async function linhas(c, tabela) {
  const colunas = (
    await c.query(
      `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [tabela],
    )
  ).rows;
  const chave = (
    await c.query(
      `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = $1::regclass and i.indisprimary order by a.attnum`,
      [q(tabela)],
    )
  ).rows.map((r) => q(r.attname));
  // numeric e bigint saem como texto: como número de JavaScript perderiam casas (DECIMAL(16,6)).
  const lista = colunas
    .map(({ column_name: n, data_type: t }) => (t === "numeric" || t === "bigint" ? `${q(n)}::text as ${q(n)}` : q(n)))
    .join(", ");
  const ordem = chave.length > 0 ? chave.join(", ") : "1";
  const r = await c.query(`select row_to_json(s)::text as j from (select ${lista} from ${q(tabela)} order by ${ordem}) s`);
  return r.rows.map((x) => x.j);
}

/** Um retrato só do banco inteiro, mesmo que o site esteja gravando ao mesmo tempo. */
async function lerTudo(c) {
  await c.query("begin isolation level repeatable read read only");
  try {
    const ordem = await tabelasEmOrdem(c);
    const tabelas = {};
    for (const t of ordem) tabelas[t] = await linhas(c, t);
    return { migracoes: await migracoes(c), tabelas };
  } finally {
    await c.query("commit");
  }
}

/** Uma linha por registro e sem data de gravação: sem mudança nos dados, o arquivo fica igual e não há commit. */
function montarArquivo({ migracoes: m, tabelas }) {
  const blocos = Object.entries(tabelas).map(
    ([t, ls]) => `    ${JSON.stringify(t)}: [${ls.length > 0 ? `\n      ${ls.join(",\n      ")}\n    ` : ""}]`,
  );
  return `{\n  "formato": "${FORMATO}",\n  "versao": ${VERSAO},\n  "migracoes": ${JSON.stringify(m)},\n  "tabelas": {\n${blocos.join(",\n")}\n  }\n}\n`;
}

/** Grava num temporário e troca de nome: uma queda no meio não deixa o arquivo pela metade. */
function gravar(arquivo, texto) {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  writeFileSync(temporario, texto);
  renameSync(temporario, arquivo);
}

const resumo = (tabelas) =>
  Object.entries(tabelas)
    .map(([t, ls]) => `${t} ${ls.length}`)
    .join(" · ");

const git = (...args) => execFileSync("git", ["-C", PASTA, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString();

/** O Git da pasta dados/ (separado do Git do código, sem remoto). Cria na primeira vez. */
function garantirRepositorio() {
  if (existsSync(path.join(PASTA, ".git"))) return;
  mkdirSync(PASTA, { recursive: true });
  git("init", "-b", "main");
  git("config", "user.name", "Geleiô");
  git("config", "user.email", "geleio@local");
  writeFileSync(
    path.join(PASTA, ".gitignore"),
    "# Cópias feitas antes de restaurar e arquivos temporários ficam só no disco.\ncopias-de-seguranca/\n*.tmp\n",
  );
  writeFileSync(
    path.join(PASTA, "LEIA-ME.txt"),
    [
      "Cópias dos dados do site Geleiô (clientes, pedidos, despesas, produção).",
      "Este é um repositório Git SÓ DESTE COMPUTADOR: não envie para o GitHub nem para outro lugar (LGPD).",
      "",
      "local.json    banco deste computador (salvo pelo parar.bat e pelo salvar-dados.bat)",
      "producao.json banco do site no ar (salvo pelo salvar-dados.bat quando existe o .env.producao)",
      "",
      "Histórico: git -C dados log --oneline",
      "Restaurar: restaurar-dados.bat (ou node scripts/dados.mjs restaurar dados/local.json --confirmar)",
      "",
    ].join("\r\n"),
  );
  git("add", ".gitignore", "LEIA-ME.txt");
  git("commit", "-m", "Pasta das cópias de dados");
}

function registrarNoGit(arquivo) {
  garantirRepositorio();
  const nome = path.basename(arquivo);
  git("add", "--", nome);
  try {
    git("diff", "--cached", "--quiet", "--", nome);
    return "Nada mudou desde a última cópia: nenhum commit novo.";
  } catch {
    // diff --quiet sai com erro quando há diferença: segue para o commit.
  }
  const quando = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date());
  git("commit", "-m", `${nome === "producao.json" ? "Site no ar" : "Banco local"}: cópia de ${quando}`, "--", nome);
  return `Registrado no Git da pasta dados (commit ${git("rev-parse", "--short", "HEAD").trim()}).`;
}

async function salvar(producao, comCommit) {
  const arquivo = path.join(PASTA, producao ? "producao.json" : "local.json");
  const c = await conectar(producao);
  let dados;
  try {
    dados = await lerTudo(c);
  } finally {
    await c.end();
  }
  gravar(arquivo, montarArquivo(dados));
  console.log(`Dados salvos em dados/${path.basename(arquivo)}: ${resumo(dados.tabelas)}`);
  if (comCommit) {
    try {
      console.log(registrarNoGit(arquivo));
    } catch (e) {
      const detalhe = e.stderr?.toString().trim().split("\n")[0] || e.message;
      console.error(`O arquivo foi salvo, mas não consegui registrar no Git: ${detalhe}`);
      process.exitCode = 1;
    }
  }
}

async function restaurar(arquivo, producao) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    throw new Error(`Não consegui ler ${arquivo} como uma cópia de dados.`);
  }
  if (doc?.formato !== FORMATO || doc.versao !== VERSAO || typeof doc.tabelas !== "object" || !Array.isArray(doc.migracoes)) {
    throw new Error("Este arquivo não é uma cópia de dados do Geleiô.");
  }
  const c = await conectar(producao);
  try {
    const ordem = await tabelasEmOrdem(c);
    // Outra versão do banco (migração nova ou faltando): colunas novas viriam vazias, ou sobrariam.
    if (JSON.stringify(await migracoes(c)) !== JSON.stringify(doc.migracoes)) {
      throw new Error("A cópia é de outra versão do banco (as migrações não batem). Restaure com a versão do projeto da mesma época da cópia.");
    }
    const faltam = ordem.filter((t) => !Array.isArray(doc.tabelas[t]));
    const sobram = Object.keys(doc.tabelas).filter((t) => !ordem.includes(t));
    if (faltam.length > 0 || sobram.length > 0) {
      throw new Error(`As tabelas não batem com o banco (faltam: ${faltam.join(", ") || "-"}; sobram: ${sobram.join(", ") || "-"}).`);
    }

    // Antes de trocar, guarda o que está no banco agora (pode haver lançamentos ainda não salvos).
    const atual = await lerTudo(c);
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const seguranca = path.join(SEGURANCA, `${producao ? "producao" : "local"}-antes-de-restaurar-${carimbo}.json`);
    gravar(seguranca, montarArquivo(atual));
    console.log(`Dados atuais guardados em ${path.relative(RAIZ, seguranca)}`);

    await c.query("begin");
    try {
      await c.query(`truncate ${ordem.map(q).join(", ")} cascade`);
      for (const t of ordem) {
        if (doc.tabelas[t].length === 0) continue;
        await c.query(`insert into ${q(t)} select * from json_populate_recordset(null::${q(t)}, $1::json)`, [JSON.stringify(doc.tabelas[t])]);
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw new Error(`Nada foi alterado: a restauração falhou (${e.message}).`);
    }
    console.log(`Dados restaurados de ${path.relative(RAIZ, path.resolve(arquivo))}: ${resumo(doc.tabelas)}`);
  } finally {
    await c.end();
  }
}

const [comando, ...resto] = process.argv.slice(2);
const producao = resto.includes("--producao");
try {
  if (comando === "salvar") {
    await salvar(producao, resto.includes("--commit"));
  } else if (comando === "restaurar") {
    const arquivo = resto.find((a) => !a.startsWith("--"));
    if (!arquivo) throw new Error("Diga qual arquivo restaurar (ex.: dados/local.json).");
    if (!resto.includes("--confirmar")) {
      throw new Error("Restaurar TROCA todos os dados do banco. Rode de novo com --confirmar (ou use restaurar-dados.bat).");
    }
    await restaurar(arquivo, producao);
  } else {
    console.log("Uso: node scripts/dados.mjs salvar [--producao] [--commit] | restaurar <arquivo> [--producao] --confirmar");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exitCode = 1;
}
