// Teste ponta a ponta da API da planilha financeira (/api/admin/planilha/*) e do contrato com o Financeiro.
//
// 1. Banco local ligado (npm run db:dev). NUNCA rode contra o Neon: o script recusa host que não seja local.
// 2. Suba o site (PowerShell), por exemplo: $env:IP_HEADER_CONFIAVEL='x-forwarded-for'; npx next dev -p 3200
//    (ou next start depois do build). E2E_BASE=http://localhost:3200 aponta o script para ele.
// 3. node testes/planilha-e2e.mjs
//
// O admin vem de E2E_ADMIN_EMAIL / E2E_ADMIN_SENHA ou do ACESSO-LOCAL.txt. O script cria um segundo admin
// (conta e2e-planilha-*, promovida por SQL só no banco local), uma cliente, pedidos e uma encomenda em
// julho/agosto de 2025 (o contrato da virada de mês) e lançamentos marcados com "E2E-planilha-<marca>". Tudo
// é apagado no fim, mesmo se falhar, e o saldo inicial volta ao que era. Não rode junto com outro teste no
// mesmo banco (o banco do `prisma dev` é de uma sessão só).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
process.loadEnvFile(path.join(RAIZ, ".env"));
const { Client } = createRequire(import.meta.url)(path.join(RAIZ, "node_modules", "pg"));

const urlBanco = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(urlBanco.hostname)) {
  console.error("Recusado: a DATABASE_URL do .env não é o banco local.");
  process.exit(2);
}
const banco = new Client({ connectionString: process.env.DATABASE_URL });
const sql = async (texto, valores = []) => (await banco.query(texto, valores)).rows;

let ok = 0;
let falhas = 0;
function confere(condicao, rotulo, extra) {
  if (condicao) {
    ok++;
    console.log(`  ok   ${rotulo}`);
  } else {
    falhas++;
    console.log(`  FALHA ${rotulo}${extra === undefined ? "" : ` → ${JSON.stringify(extra).slice(0, 500)}`}`);
  }
}

// --- cliente HTTP com cookie ------------------------------------------------------------------
let ipSeq = 10;
function cliente() {
  let cookie = "";
  const ip = `10.78.0.${ipSeq++}`;
  return {
    async req(metodo, caminho, { corpo, cabecalhos = {}, bruto } = {}) {
      const r = await fetch(BASE + caminho, {
        method: metodo,
        redirect: "manual",
        headers: {
          ...(corpo !== undefined || bruto !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          "X-Forwarded-For": ip,
          ...cabecalhos,
        },
        body: bruto !== undefined ? bruto : corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      for (const c of r.headers.getSetCookie?.() ?? []) {
        const [par] = c.split(";");
        if (par.includes("sessao")) cookie = par.endsWith("=") ? "" : par;
      }
      const texto = await r.text();
      let json = null;
      try {
        json = JSON.parse(texto);
      } catch {
        // sem corpo JSON (204)
      }
      return { status: r.status, json, cache: r.headers.get("cache-control") };
    },
  };
}

function credenciaisAdmin() {
  if (process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_SENHA) return { email: process.env.E2E_ADMIN_EMAIL, senha: process.env.E2E_ADMIN_SENHA };
  const texto = readFileSync(path.join(RAIZ, "ACESSO-LOCAL.txt"), "utf8");
  const bloco = texto.slice(texto.indexOf("LOGIN DO ADMINISTRADOR"));
  const email = /E-mail \.+\s*(\S+)/.exec(bloco)?.[1];
  const senha = /Senha \.+\s*(\S+)/.exec(bloco)?.[1];
  if (!email || !senha) throw new Error("admin: defina E2E_ADMIN_EMAIL e E2E_ADMIN_SENHA");
  return { email, senha };
}

const marca = Date.now().toString(36);
const PREFIXO = `E2E-planilha-${marca}`;
const contas = [];
const pedidos = [];
const encomendas = [];
const categoriasCriadas = [];
const insumos = [];
const utc = (d) => new Date(d).toISOString();
const hojeLoja = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const chave = () => randomUUID();
const criar = (lancamento, extra = {}) => ({ op: "criar", chave: chave(), lancamento, ...extra });
const desc = (t) => `${PREFIXO} ${t}`;

async function novaConta(rotulo) {
  const c = cliente();
  const email = `e2e-planilha-${marca}-${rotulo}@teste.local`;
  const r = await c.req("POST", "/api/auth/register", { corpo: { nome: `Planilha ${rotulo}`, email, senha: "Senha-E2E-123" } });
  if (r.status !== 201 && r.status !== 200) throw new Error(`cadastro ${rotulo}: ${r.status} ${JSON.stringify(r.json)}`);
  const [u] = await sql("select id from users where email = $1", [email]);
  contas.push(u.id);
  return { c, id: u.id, email };
}

async function main() {
  await banco.connect();
  const hoje = hojeLoja();
  const mesAtual = hoje.slice(0, 7);
  const [configAntes] = await sql("select saldo_inicial, saldo_inicial_em from config_financeiro where id = 1");

  try {
    const admin = cliente();
    const login = await admin.req("POST", "/api/auth/login", { corpo: credenciaisAdmin() });
    if (login.status !== 200) throw new Error(`login admin: ${login.status}`);
    const [{ id: adminId }] = await sql("select id from users where email = $1", [credenciaisAdmin().email]);
    const lote = (operacoes, cli = admin, extra = {}) => cli.req("POST", "/api/admin/planilha/lancamentos", { corpo: { operacoes }, ...extra });
    const grade = (de, ate, cli = admin, extra = "") => cli.req("GET", `/api/admin/planilha/lancamentos?de=${de}&ate=${ate}${extra}`);

    console.log("1. Acesso: sem login, cliente, origem de outro site, Content-Type");
    const cli = await novaConta("cliente");
    confere((await cliente().req("GET", "/api/admin/planilha/lancamentos")).status === 401, "GET sem login → 401");
    confere((await cli.c.req("GET", "/api/admin/planilha/lancamentos")).status === 403, "GET como cliente → 403");
    confere((await lote([], cli.c)).status === 403, "POST como cliente → 403");
    const cross = await lote([criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: desc("x"), valorCentavos: 100 })], admin, { cabecalhos: { "Sec-Fetch-Site": "cross-site" } });
    confere(cross.status === 403, "POST com Sec-Fetch-Site: cross-site → 403", cross.status);
    const evil = await lote([criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: desc("x"), valorCentavos: 100 })], admin, { cabecalhos: { Origin: "https://evil.example" } });
    confere(evil.status === 403, "POST com Origin de outro site → 403", evil.status);
    const textoPuro = await admin.req("POST", "/api/admin/planilha/lancamentos", { bruto: "{}", cabecalhos: { "Content-Type": "text/plain" } });
    confere(textoPuro.status === 400, "POST com text/plain → 400", textoPuro.status);
    for (const rota of ["categorias", "config", "historico"]) {
      confere((await cliente().req("GET", `/api/admin/planilha/${rota}`)).status === 401, `GET ${rota} sem login → 401`);
    }
    confere((await cliente().req("PATCH", "/api/admin/planilha/saidas/x", { corpo: { versao: 0, campos: {} } })).status === 401, "PATCH saída sem login → 401");
    confere((await cli.c.req("DELETE", "/api/admin/planilha/entradas/x?versao=0")).status === 403, "DELETE entrada como cliente → 403");

    console.log("2. GET do período");
    const g0 = await admin.req("GET", "/api/admin/planilha/lancamentos");
    confere(g0.status === 200 && g0.json.de === `${mesAtual}-01` && g0.json.ate.startsWith(mesAtual) && g0.json.hoje === hoje, "sem período = mês corrente da loja", [g0.status, g0.json?.de, g0.json?.ate]);
    confere(g0.cache === "no-store", "Cache-Control: no-store", g0.cache);
    const cats0 = g0.json.categorias;
    confere(cats0.some((c) => c.id === "sistema-site" && c.sistema) && cats0.some((c) => c.id === "saida-ingredientes" && c.padrao && c.grupo === "INGREDIENTES"), "categorias de sistema e semeadas");
    confere(Array.isArray(g0.json.descricoes) && Array.isArray(g0.json.automaticasPorDia) && typeof g0.json.totais.entradasCentavos === "number", "formato: descricoes, automaticasPorDia, totais");
    confere((await grade("2026-11-30", "2026-11-01")).status === 400, "de > ate → 400");
    confere((await grade("2024-01-01", "2026-01-01")).status === 400, "período de mais de 400 dias → 400");
    confere((await grade("2026-02-30", "2026-03-01")).status === 400, "dia que não existe → 400");

    console.log("3. Criar: saída, entrada, retry, chave repetida, validação");
    const k1 = chave();
    const k2 = chave();
    const opsCriar = [
      { op: "criar", chave: k1, lancamento: { tipo: "SAIDA", data: hoje, categoriaId: "saida-ingredientes", descricao: desc("Açúcar"), valorCentavos: 1234, formaPagamento: "PIX" } },
      { op: "criar", chave: k2, lancamento: { tipo: "ENTRADA", data: hoje, categoriaId: "entrada-outras", descricao: desc("Doação"), valorCentavos: 777, observacao: "teste" } },
    ];
    const c1 = await lote(opsCriar);
    const saida1 = c1.json?.resultados?.[0]?.linha;
    const entrada1 = c1.json?.resultados?.[1]?.linha;
    confere(c1.status === 200 && c1.json.resultados.every((r) => r.op === "criar" && r.repetida === false), "lote de 2 criações → 200", c1.json);
    confere(saida1?.origem === "manual-saida" && saida1.versao === 0 && saida1.editavel && saida1.quantidade === 1 && saida1.unidade === "UN" && saida1.formaPagamento === "PIX", "saída: versão 0, 1 UN, forma", saida1);
    confere(saida1?.criadoPor?.id === adminId && saida1.categoriaNome === "Ingredientes", "saída: quem lançou e nome da categoria", saida1?.criadoPor);
    confere(entrada1?.origem === "manual-entrada" && entrada1.valorCentavos === 777 && entrada1.observacao === "teste", "entrada gravada", entrada1);
    const [bd1] = await sql("select categoria, categoria_id, idempotency_key, valor_total, criado_por_id from expenses where id = $1", [saida1?.id]);
    confere(bd1?.categoria === "INGREDIENTES" && bd1.categoria_id === "saida-ingredientes" && bd1.idempotency_key === k1 && bd1.valor_total === "12.34", "banco: grupo antigo, categoria_id, chave e valor", bd1);
    const aud1 = await sql("select acao, admin_id from auditoria_financeira where entidade_id = any($1) order by criado_em", [[saida1?.id, entrada1?.id]]);
    confere(aud1.length === 2 && aud1.every((a) => a.acao === "CRIOU" && a.admin_id === adminId), "histórico CRIOU das duas, com o admin", aud1);
    const c1b = await lote(opsCriar);
    confere(c1b.status === 200 && c1b.json.resultados.every((r) => r.repetida) && c1b.json.resultados[0].linha.id === saida1?.id, "retry com as mesmas chaves → mesmas linhas, repetida", c1b.json);
    const [{ n: qtdK1 }] = await sql("select count(*)::int as n from expenses where idempotency_key = $1", [k1]);
    confere(qtdK1 === 1, "retry não duplicou", qtdK1);
    const outra = await lote([{ ...opsCriar[0], lancamento: { ...opsCriar[0].lancamento, valorCentavos: 9999 } }]);
    confere(outra.status === 422 && outra.json?.codigo === "chave-repetida" && outra.json.detalhes?.indice === 0, "mesma chave, outro valor → 422 chave-repetida", outra.json);
    const dupla = await lote([opsCriar[0], { ...opsCriar[1], chave: k1 }]);
    confere(dupla.status === 400 && dupla.json?.detalhes?.["operacoes.1.chave"], "chave repetida no mesmo envio → 400", dupla.json);
    const tipoErrado = await lote([criar({ tipo: "ENTRADA", categoriaId: "saida-outros", descricao: desc("x"), valorCentavos: 100 })]);
    confere(tipoErrado.status === 422 && tipoErrado.json?.codigo === "categoria", "categoria de outro tipo → 422 categoria", tipoErrado.json);
    const semCat = await lote([criar({ tipo: "SAIDA", categoriaId: "nao-existe", descricao: desc("x"), valorCentavos: 100 })]);
    confere(semCat.status === 422 && semCat.json?.codigo === "categoria", "categoria inexistente → 422", semCat.json);
    const futura = await lote([criar({ tipo: "SAIDA", data: "2099-01-01", categoriaId: "saida-outros", descricao: desc("x"), valorCentavos: 100 })]);
    confere(futura.status === 400 && futura.json?.detalhes?.["operacoes.0.lancamento.data"], "data futura → 400 no campo certo", futura.json);
    const zero = await lote([criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: desc("x"), valorCentavos: 0 })]);
    confere(zero.status === 400 && zero.json?.detalhes?.["operacoes.0.lancamento.valorCentavos"], "valor zero → 400", zero.json);
    const vazia = await lote([criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: "   ", valorCentavos: 100 })]);
    confere(vazia.status === 400 && vazia.json?.detalhes?.["operacoes.0.lancamento.descricao"], "descrição vazia → 400", vazia.json);
    const controle = await lote([criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: `${desc("x")}\u0000`, valorCentavos: 100 })]);
    confere(controle.status === 400, "caractere de controle → 400", controle.status);
    const nenhuma = await lote([]);
    confere(nenhuma.status === 400, "lote vazio → 400", nenhuma.status);
    const muitas = await lote(Array.from({ length: 201 }, () => criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: desc("x"), valorCentavos: 100 })));
    confere(muitas.status === 400 && muitas.json?.detalhes?.operacoes, "201 operações → 400", muitas.json?.detalhes);
    const enorme = await admin.req("POST", "/api/admin/planilha/lancamentos", { bruto: JSON.stringify({ operacoes: [], enchimento: "a".repeat(270 * 1024) }) });
    confere(enorme.status === 413, "corpo de 270 KB → 413", enorme.status);
    const medio = await admin.req("POST", "/api/admin/planilha/lancamentos", { bruto: JSON.stringify({ operacoes: [], enchimento: "a".repeat(100 * 1024) }) });
    confere(medio.status === 400, "corpo de 100 KB passa do teto antigo (32 KB) e chega à validação → 400", medio.status);
    const catGrande = await admin.req("POST", "/api/admin/planilha/categorias", { bruto: JSON.stringify({ tipo: "SAIDA", nome: "x", enchimento: "a".repeat(40 * 1024) }) });
    confere(catGrande.status === 413, "as outras rotas continuam com 32 KB → 413", catGrande.status);

    console.log("4. Lote de 200 linhas (criar e excluir)");
    const t0 = Date.now();
    const l200 = await lote(Array.from({ length: 200 }, (_, i) => criar({ tipo: i % 2 ? "SAIDA" : "ENTRADA", categoriaId: i % 2 ? "saida-outros" : "entrada-outras", descricao: desc(`lote ${i}`), valorCentavos: 1000 + i })));
    confere(l200.status === 200 && l200.json.resultados.length === 200 && l200.json.resultados.every((r, i) => r.indice === i && r.linha.valorCentavos === 1000 + i), `200 criações numa ida (${Date.now() - t0} ms)`, l200.status);
    const ex200 = await lote(l200.json.resultados.map((r) => ({ op: "excluir", id: r.linha.id, tipoAtual: r.linha.tipo, versao: 0 })));
    confere(ex200.status === 200 && ex200.json.resultados.every((r) => r.op === "excluir"), "200 exclusões numa ida", ex200.status);

    console.log("5. Alterar: versão, dois admins, troca de tipo");
    const p1 = await admin.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 0, campos: { valorCentavos: 1500, observacao: "corrigido" } } });
    confere(p1.status === 200 && p1.json.linha.versao === 1 && p1.json.linha.valorCentavos === 1500 && p1.json.linha.atualizadoPor?.id === adminId && p1.json.linha.descricao === saida1.descricao, "PATCH parcial → versão 1, quem alterou, resto mantido", p1.json);
    const velho = await admin.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 0, campos: { valorCentavos: 1600 } } });
    confere(velho.status === 409 && velho.json?.codigo === "versao" && velho.json.detalhes?.atual?.versao === 1 && velho.json.detalhes.atual.valorCentavos === 1500, "versão velha → 409 com a linha atual", velho.json);
    const audAlt = await sql("select antes, depois from auditoria_financeira where entidade_id = $1 and acao = 'ALTEROU'", [saida1.id]);
    confere(audAlt.length === 1 && audAlt[0].antes.valorCentavos === 1234 && audAlt[0].depois.valorCentavos === 1500, "histórico ALTEROU com antes e depois", audAlt);
    // Segundo admin (só no banco local).
    const outroAdmin = await novaConta("admin2");
    await sql("update users set is_admin = true, sessao_versao = sessao_versao + 1 where id = $1", [outroAdmin.id]);
    const admin2 = cliente();
    const login2 = await admin2.req("POST", "/api/auth/login", { corpo: { email: outroAdmin.email, senha: "Senha-E2E-123" } });
    confere(login2.status === 200, "segundo admin entra", login2.status);
    const p2 = await admin2.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 1, campos: { descricao: desc("Açúcar cristal") } } });
    confere(p2.status === 200 && p2.json.linha.atualizadoPor?.nome === "Planilha admin2" && p2.json.linha.criadoPor?.id === adminId, "o outro admin altera: quem lançou continua, quem alterou muda", p2.json?.linha);
    const p3 = await admin.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 1, campos: { valorCentavos: 1700 } } });
    confere(p3.status === 409 && /Planilha admin2/.test(p3.json?.erro ?? ""), "o primeiro, com a versão de antes → 409 dizendo quem alterou", p3.json?.erro);
    const camposRuins = await admin.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 2, campos: { valorCentavos: -5 } } });
    confere(camposRuins.status === 400 && camposRuins.json?.detalhes?.["campos.valorCentavos"], "valor negativo no PATCH → 400 em campos.valorCentavos", camposRuins.json);
    const desconhecido = await admin.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 2, campos: { criadoPorId: "x" } } });
    confere(desconhecido.status === 400, "campo desconhecido no PATCH → 400", desconhecido.status);
    const naoExiste = await lote([{ op: "alterar", id: "nao-existe", tipoAtual: "SAIDA", versao: 0, campos: { valorCentavos: 1 } }]);
    confere(naoExiste.status === 404 && naoExiste.json?.codigo === "nao-encontrada" && naoExiste.json.detalhes?.indice === 0, "alterar linha que não existe → 404 com o índice", naoExiste.json);
    const troca = await admin.req("PATCH", `/api/admin/planilha/saidas/${saida1.id}`, { corpo: { versao: 2, campos: { tipo: "ENTRADA" } } });
    const trocada = troca.json?.linha;
    confere(troca.status === 200 && troca.json.idAnterior === saida1.id && trocada?.tipo === "ENTRADA" && trocada.id !== saida1.id && trocada.categoriaId === "entrada-outras" && trocada.criadoPor?.id === adminId, "troca de tipo: vira entrada (Outras entradas), outro id, mesmo autor", troca.json);
    const [{ n: sobrou }] = await sql("select count(*)::int as n from expenses where id = $1", [saida1.id]);
    confere(sobrou === 0, "a saída saiu da tabela de despesas", sobrou);
    const volta = await admin.req("PATCH", `/api/admin/planilha/entradas/${trocada.id}`, { corpo: { versao: trocada.versao, campos: { tipo: "SAIDA", categoriaId: "saida-embalagens" } } });
    confere(volta.status === 200 && volta.json.linha.tipo === "SAIDA" && volta.json.linha.categoriaNome === "Potes e embalagens", "e volta para saída com a categoria escolhida", volta.json);

    console.log("6. Compra ligada ao estoque");
    const insumoId = `e2e-${marca}-acucar`;
    insumos.push(insumoId);
    await sql("insert into insumos (id, nome, tipo, unidade) values ($1, $2, 'INGREDIENTE', 'G')", [insumoId, `Açúcar ${PREFIXO}`]);
    const compra = await admin.req("POST", "/api/admin/expenses", {
      corpo: { descricao: desc("Açúcar 2 kg"), categoria: "INGREDIENTES", quantidade: 2, unidade: "KG", valorCentavos: 1000, insumoId },
    });
    confere(compra.status === 201 && compra.json.quantidadeBase === 2000 && compra.json.categoriaId === "saida-ingredientes" && compra.json.versao === 0, "Despesas: compra de 2 kg → 2000 g, categoria e versão", compra.json);
    const audCompra = await sql("select acao from auditoria_financeira where entidade_id = $1", [compra.json?.id]);
    confere(audCompra.length === 1 && audCompra[0].acao === "CRIOU", "a tela de Despesas também grava o histórico", audCompra);
    const qtd3 = await admin.req("PATCH", `/api/admin/planilha/saidas/${compra.json.id}`, { corpo: { versao: 0, campos: { quantidade: 3 } } });
    confere(qtd3.status === 200 && qtd3.json.linha.quantidadeBase === 3000 && qtd3.json.linha.insumo?.id === insumoId, "planilha muda a quantidade → estoque recalculado (3000 g)", qtd3.json?.linha);
    const trocaEstoque = await admin.req("PATCH", `/api/admin/planilha/saidas/${compra.json.id}`, { corpo: { versao: 1, campos: { tipo: "ENTRADA" } } });
    confere(trocaEstoque.status === 409 && trocaEstoque.json?.codigo === "ligada-ao-estoque", "trocar de tipo compra ligada ao estoque → 409", trocaEstoque.json);
    const exSem = await admin.req("DELETE", `/api/admin/planilha/saidas/${compra.json.id}?versao=1`);
    confere(exSem.status === 409 && exSem.json?.codigo === "confirmar-estoque" && /3\.000 g/.test(exSem.json.erro) && exSem.json.detalhes?.quantidadeBase === 3000, "excluir sem confirmar → 409 dizendo quanto sai do estoque", exSem.json);
    const desp409 = await admin.req("PATCH", `/api/admin/expenses/${compra.json.id}`, {
      corpo: { descricao: desc("Açúcar"), categoria: "INGREDIENTES", quantidade: 3, unidade: "KG", valorCentavos: 1000, insumoId, versao: 0 },
    });
    confere(desp409.status === 409 && desp409.json?.codigo === "versao", "Despesas com versão velha → 409 versao", desp409.json);
    const despSem = await admin.req("PATCH", `/api/admin/expenses/${compra.json.id}`, {
      corpo: { descricao: desc("Açúcar"), categoria: "INGREDIENTES", quantidade: 3, unidade: "KG", valorCentavos: 1100, insumoId },
    });
    confere(despSem.status === 200 && despSem.json.versao === 2, "Despesas sem versão (tela antiga) continua gravando e sobe a versão", despSem.json);
    const exCom = await admin.req("DELETE", `/api/admin/planilha/saidas/${compra.json.id}?versao=2&confirmarEstoque=1`);
    confere(exCom.status === 200 && exCom.json.linha.id === compra.json.id && exCom.json.linha.insumo?.id === insumoId, "com confirmação → excluída, devolve a linha para desfazer", exCom.json);
    const desfaz = await lote([criar({ tipo: "SAIDA", data: exCom.json.linha.data, categoriaId: "saida-ingredientes", descricao: exCom.json.linha.descricao, valorCentavos: 1100, quantidade: 3, unidade: "KG", insumoId, quantidadeBase: 3000 })]);
    confere(desfaz.status === 200 && desfaz.json.resultados[0].linha.quantidadeBase === 3000 && desfaz.json.resultados[0].linha.insumo?.id === insumoId, "desfazer a exclusão recria o vínculo com o estoque", desfaz.json);
    const exVersao = await admin.req("DELETE", `/api/admin/planilha/saidas/${desfaz.json.resultados[0].linha.id}`);
    confere(exVersao.status === 400, "DELETE sem versão → 400", exVersao.status);
    await lote([{ op: "excluir", id: desfaz.json.resultados[0].linha.id, tipoAtual: "SAIDA", versao: 0, confirmarEstoque: true }]);

    console.log("7. Aviso: parece venda presencial");
    const produtos = (await cliente().req("GET", "/api/products")).json;
    const produto = (produtos?.produtos ?? produtos)?.find?.((p) => p.ativo !== false)?.id;
    const venda = await admin.req("POST", "/api/admin/orders", {
      corpo: { itens: [{ productId: produto, quantidade: 1, precoUnitarioCentavos: 4321 }], formaPagamento: "PIX", status: "ENTREGUE" },
      cabecalhos: { "Idempotency-Key": `e2e-planilha-${marca}` },
    });
    const vendaId = venda.json?.venda?.id;
    if (vendaId) pedidos.push(vendaId);
    confere(venda.status === 201 && vendaId, "venda presencial de R$ 43,21 hoje", [venda.status, venda.json]);
    const parecida = criar({ tipo: "ENTRADA", data: hoje, categoriaId: "entrada-outras-vendas", descricao: desc("Feira"), valorCentavos: 4321 });
    const aviso = await lote([criar({ tipo: "SAIDA", categoriaId: "saida-outros", descricao: desc("antes"), valorCentavos: 50 }), parecida]);
    confere(
      aviso.status === 409 && aviso.json?.codigo === "parece-venda-presencial" && aviso.json.detalhes?.indice === 1 && aviso.json.detalhes.vendas?.[0]?.origem === "presencial" && aviso.json.detalhes.vendas[0].link === `/admin/orders/${vendaId}`,
      "entrada com o dia e o valor da venda → 409 com a venda",
      aviso.json,
    );
    const [{ n: nadaGravado }] = await sql("select count(*)::int as n from expenses where descricao = $1", [desc("antes")]);
    confere(nadaGravado === 0, "o lote inteiro não gravou nada (transação)", nadaGravado);
    const confirmada = await lote([{ ...parecida, confirmado: true }]);
    confere(confirmada.status === 200 && confirmada.json.resultados[0].linha.valorCentavos === 4321, "com confirmado: true → grava", confirmada.json);
    const gHoje = await grade(hoje, hoje);
    const linhaVenda = gHoje.json?.linhas?.find((l) => l.id === `presencial:${vendaId}`);
    confere(linhaVenda && !linhaVenda.editavel && linhaVenda.versao === null && linhaVenda.descricao.startsWith("Venda presencial #") && linhaVenda.cliente === undefined && linhaVenda.formaPagamento === "PIX", "a venda aparece na grade: somente leitura, sem nome de cliente", linhaVenda);
    confere(gHoje.json?.automaticasPorDia?.some((a) => a.data === hoje && a.origem === "presencial" && a.quantidade >= 1), "automaticasPorDia agrupa a venda");

    console.log("8. Categorias");
    const nomeGas = `Gás ${marca}`;
    const cat1 = await admin.req("POST", "/api/admin/planilha/categorias", { corpo: { tipo: "SAIDA", nome: nomeGas } });
    if (cat1.json?.id) categoriasCriadas.push(cat1.json.id);
    confere(cat1.status === 201 && cat1.json.grupo === "OUTROS" && cat1.json.ativo && !cat1.json.padrao && cat1.json.linhas === 0, "criar Gás → 201, grupo Outros", cat1.json);
    const repetida = await admin.req("POST", "/api/admin/planilha/categorias", { corpo: { tipo: "SAIDA", nome: nomeGas.toUpperCase() } });
    confere(repetida.status === 409 && repetida.json?.codigo === "nome-repetido", "mesmo nome em maiúsculas → 409 nome-repetido", repetida.json);
    const outroTipo = await admin.req("POST", "/api/admin/planilha/categorias", { corpo: { tipo: "ENTRADA", nome: nomeGas } });
    if (outroTipo.json?.id) categoriasCriadas.push(outroTipo.json.id);
    confere(outroTipo.status === 201 && outroTipo.json.grupo === null, "o mesmo nome em entrada é outra categoria", outroTipo.json);
    const comLinha = await lote([criar({ tipo: "SAIDA", categoriaId: cat1.json.id, descricao: desc("Botijão"), valorCentavos: 12000 })]);
    const botijao = comLinha.json?.resultados?.[0]?.linha;
    confere(comLinha.status === 200 && botijao?.categoriaNome === nomeGas, "lança na categoria nova", comLinha.json);
    const grupo = await admin.req("PATCH", `/api/admin/planilha/categorias/${cat1.json.id}`, { corpo: { grupo: "EMBALAGENS" } });
    const [bdGrupo] = await sql("select categoria from expenses where id = $1", [botijao?.id]);
    confere(grupo.status === 200 && grupo.json.grupo === "EMBALAGENS" && grupo.json.linhas === 1 && bdGrupo?.categoria === "EMBALAGENS", "mudar o grupo atualiza o grupo das despesas dela", [grupo.json, bdGrupo]);
    const foraComLinha = await admin.req("PATCH", `/api/admin/planilha/categorias/${cat1.json.id}`, { corpo: { foraDoResultado: true } });
    confere(foraComLinha.status === 409 && foraComLinha.json?.codigo === "categoria-em-uso" && /lucro dos meses passados/.test(foraComLinha.json.erro ?? foraComLinha.json.mensagem ?? JSON.stringify(foraComLinha.json)), "mudar 'fora do lucro' com lançamentos → 409", foraComLinha.json);
    const foraSemLinha = await admin.req("PATCH", `/api/admin/planilha/categorias/${outroTipo.json.id}`, { corpo: { foraDoResultado: true } });
    confere(foraSemLinha.status === 200 && foraSemLinha.json.foraDoResultado === true, "sem lançamentos, 'fora do lucro' pode mudar", foraSemLinha.json);
    const exUso = await admin.req("DELETE", `/api/admin/planilha/categorias/${cat1.json.id}`);
    confere(exUso.status === 409 && exUso.json?.codigo === "categoria-em-uso", "excluir com lançamentos → 409 categoria-em-uso", exUso.json);
    const exPadrao = await admin.req("DELETE", "/api/admin/planilha/categorias/saida-outros");
    confere(exPadrao.status === 409 && exPadrao.json?.codigo === "categoria-padrao", "excluir a padrão do grupo → 409", exPadrao.json);
    const grupoPadrao = await admin.req("PATCH", "/api/admin/planilha/categorias/saida-outros", { corpo: { grupo: "TAXAS" } });
    confere(grupoPadrao.status === 409 && grupoPadrao.json?.codigo === "categoria-padrao", "mudar o grupo da padrão → 409", grupoPadrao.json);
    confere((await admin.req("PATCH", "/api/admin/planilha/categorias/sistema-site", { corpo: { nome: "x" } })).status === 404, "categoria de sistema → 404");
    confere((await admin.req("PATCH", `/api/admin/planilha/categorias/${outroTipo.json.id}`, { corpo: { grupo: "TAXAS" } })).status === 400, "entrada com grupo → 400");
    confere((await admin.req("PATCH", `/api/admin/planilha/categorias/${cat1.json.id}`, { corpo: {} })).status === 400, "PATCH vazio → 400");
    const desativa = await admin.req("PATCH", `/api/admin/planilha/categorias/${cat1.json.id}`, { corpo: { ativo: false, nome: `${nomeGas} velho`, ordem: 5 } });
    confere(desativa.status === 200 && !desativa.json.ativo && desativa.json.nome === `${nomeGas} velho` && desativa.json.ordem === 5, "desativar, renomear e reordenar", desativa.json);
    const naInativa = await lote([criar({ tipo: "SAIDA", categoriaId: cat1.json.id, descricao: desc("x"), valorCentavos: 100 })]);
    confere(naInativa.status === 422 && naInativa.json?.codigo === "categoria", "lançar em categoria desativada → 422", naInativa.json);
    const editaNaInativa = await admin.req("PATCH", `/api/admin/planilha/saidas/${botijao.id}`, { corpo: { versao: 0, campos: { valorCentavos: 12500 } } });
    confere(editaNaInativa.status === 200, "mas a linha que já estava nela continua editável", editaNaInativa.status);
    const exLivre = await admin.req("DELETE", `/api/admin/planilha/categorias/${outroTipo.json.id}`);
    confere(exLivre.status === 204, "excluir categoria sem lançamentos → 204", exLivre.status);
    const listaCat = await admin.req("GET", "/api/admin/planilha/categorias");
    confere(listaCat.status === 200 && listaCat.json.categorias.some((c) => c.id === cat1.json.id && c.linhas === 1) && !listaCat.json.categorias.some((c) => c.id === outroTipo.json.id), "GET categorias com o uso", listaCat.status);

    console.log("9. Saldo inicial, fora do resultado e histórico");
    const cfg = await admin.req("PATCH", "/api/admin/planilha/config", { corpo: { saldoInicialCentavos: 100000, saldoInicialEm: `${mesAtual}-01` } });
    confere(cfg.status === 200 && cfg.json.saldoInicialCentavos === 100000 && cfg.json.saldoInicialEm === `${mesAtual}-01` && cfg.json.atualizadoPor?.id === adminId, "PATCH saldo inicial", cfg.json);
    confere((await admin.req("PATCH", "/api/admin/planilha/config", { corpo: { saldoInicialCentavos: 1, saldoInicialEm: "2099-01-01" } })).status === 400, "saldo com data futura → 400");
    confere((await admin.req("PATCH", "/api/admin/planilha/config", { corpo: { saldoInicialCentavos: 1.5, saldoInicialEm: null } })).status === 400, "saldo com fração de centavo → 400");
    const antesFora = (await admin.req("GET", "/api/admin/planilha/lancamentos")).json;
    const fora = await lote([
      criar({ tipo: "ENTRADA", categoriaId: "entrada-aporte", descricao: desc("Aporte"), valorCentavos: 50000 }),
      criar({ tipo: "SAIDA", categoriaId: "saida-retirada", descricao: desc("Pró-labore"), valorCentavos: 20000 }),
    ]);
    const depoisFora = (await admin.req("GET", "/api/admin/planilha/lancamentos")).json;
    const d = (k) => depoisFora.totais[k] - antesFora.totais[k];
    confere(
      fora.status === 200 && d("entradasCentavos") === 0 && d("saidasCentavos") === 0 && d("resultadoCentavos") === 0 && d("movimentoCentavos") === 30000 &&
        depoisFora.totais.foraDoResultado.entradasCentavos - antesFora.totais.foraDoResultado.entradasCentavos === 50000,
      "aporte e retirada não mexem no lucro, só no movimento",
      [antesFora.totais, depoisFora.totais],
    );
    confere(depoisFora.saldo.noFimCentavos === 100000 + depoisFora.totais.movimentoCentavos && depoisFora.saldo.inicialEm === `${mesAtual}-01`, "saldo no fim = inicial + movimento do mês", depoisFora.saldo);
    const finMes = (await admin.req("GET", `/api/admin/financial-stats?mes=${mesAtual}`)).json;
    confere(Math.round(finMes.resumo.entradas * 100) === depoisFora.totais.entradasCentavos && Math.round(finMes.resumo.saidas * 100) === depoisFora.totais.saidasCentavos, "Financeiro do mês = planilha do mês", [finMes.resumo, depoisFora.totais]);
    confere(Math.round(finMes.resumo.foraDoResultado.entradas * 100) === depoisFora.totais.foraDoResultado.entradasCentavos, "Financeiro mostra o fora do resultado", finMes.resumo.foraDoResultado);
    const hist = await admin.req("GET", `/api/admin/planilha/historico?entidade=categoria&entidadeId=${cat1.json.id}`);
    confere(hist.status === 200 && hist.json.itens.map((i) => i.acao).join(",") === "ALTEROU,ALTEROU,CRIOU" && hist.json.itens[0].admin?.id === adminId, "histórico da categoria, mais recente primeiro", hist.json?.itens?.map((i) => i.acao));
    confere((await admin.req("GET", "/api/admin/planilha/historico?entidade=senha")).status === 400, "histórico com entidade desconhecida → 400");
    confere((await admin.req("GET", "/api/admin/planilha/historico?limite=999")).status === 400, "histórico com limite fora → 400");
    const histCfg = await admin.req("GET", "/api/admin/planilha/historico?entidade=config&limite=1");
    confere(histCfg.json?.itens?.[0]?.depois?.saldoInicialCentavos === 100000, "histórico do saldo inicial", histCfg.json);

    console.log("10. Contrato: planilha = Financeiro = Despesas, na virada de julho para agosto de 2025");
    const meses = { jul: ["2025-07-01", "2025-07-31", "2025-07"], ago: ["2025-08-01", "2025-08-31", "2025-08"] };
    const ler = async () => {
      const r = {};
      for (const [k, [de, ate, mes]] of Object.entries(meses)) {
        r[k] = {
          planilha: (await grade(de, ate)).json,
          fin: (await admin.req("GET", `/api/admin/financial-stats?mes=${mes}`)).json,
          desp: (await admin.req("GET", `/api/admin/expenses?mes=${mes}`)).json,
        };
      }
      return r;
    };
    const antes = await ler();
    const cliId = cli.id;
    const pedido = async (sufixo, canal, status, total, instante, extra = {}) => {
      const id = `e2eplan${marca}${sufixo}`;
      pedidos.push(id);
      if (canal === "ONLINE") {
        await sql(
          `insert into orders (id, user_id, status, canal, total, delivery_fee, created_at, modo_entrega, telefone) values ($1, $2, $3, 'ONLINE', $4, 0, $5, 'RETIRADA', '86999991234')`,
          [id, cliId, status, total, utc(instante)],
        );
      } else {
        await sql(
          `insert into orders (id, status, canal, total, delivery_fee, created_at, forma_pagamento, lancado_em, registrado_por_id, cliente_nome)
           values ($1, $2, 'PRESENCIAL', $3, 0, $4, 'DINHEIRO', now(), $5, $6)`,
          [id, status, total, utc(instante), adminId, extra.clienteNome ?? null],
        );
      }
      return id;
    };
    const oJul = await pedido("a", "ONLINE", "PAGO", 50, "2025-07-31T23:30:00-03:00");
    const oAgo = await pedido("b", "ONLINE", "ENTREGUE", 30, "2025-08-01T00:30:00-03:00");
    const oKit = await pedido("c", "PRESENCIAL", "ENTREGUE", 40, "2025-08-10T12:00:00-03:00", { clienteNome: "Maria Feira" });
    await pedido("d", "ONLINE", "CANCELADO", 99, "2025-08-11T12:00:00-03:00");
    await pedido("e", "ONLINE", "PENDENTE", 77, "2025-08-12T12:00:00-03:00");
    const [kit] = await sql("select id from kits limit 1");
    if (kit) {
      await sql("insert into order_kits (id, order_id, kit_id, quantidade, preco_unitario) values ($1, $2, $3, 1, 40)", [`${oKit}k`, oKit, kit.id]);
      await sql("insert into order_kit_sabores (id, order_kit_id, product_id, quantidade, preco_avulso, valor_rateado) values ($1, $2, $3, 3, 15, 40)", [`${oKit}s`, `${oKit}k`, produto]);
    }
    const encId = `e2eplan${marca}enc`;
    encomendas.push(encId);
    await sql(
      `insert into encomendas (id, user_id, status, data_festa, data_entrega, modo_entrega, telefone, potinhos, subtotal, frete, total,
         valor_entrada, valor_restante, peso_total_gramas, responder_ate, corte_em, entrada_ate, percentual_aceito, percentual_retido,
         politica_versao, politica_aceita_em, idempotency_key, aprovada_em, entrada_paga_em, entrada_fora_do_site, entrada_forma)
       values ($1, $2, 'CONFIRMADA', '2025-08-30', '2025-08-29', 'RETIRADA', '86999991234', 20, 90, 0, 90,
         45, 45, 1950, '2025-08-02', '2025-08-26', '2025-08-03', 0, 0, '2026-11-v2', '2025-08-01', $3, '2025-08-01', $4, true, 'DINHEIRO')`,
      [encId, cliId, `e2e-plan-${marca}`, utc("2025-08-05T10:00:00-03:00")],
    );
    await sql(
      `insert into pagamentos (id, encomenda_id, parcela, gateway, referencia_externa, status, valor, expira_em, aprovado_em)
       values ($1, $2, 'RESTANTE', 'infinitepay', $3, 'APROVADO', 45, $4, $4)`,
      [`${encId}p`, encId, `enc-${encId}-RESTANTE-1`, utc("2025-08-06T10:00:00-03:00")],
    );
    await sql(
      "insert into encomenda_devolucoes (id, encomenda_id, motivo, valor, status, criada_em, feita_em) values ($1, $2, 'CANCELAMENTO', 20, 'FEITA', $3, $3)",
      [`${encId}d`, encId, utc("2025-08-20T10:00:00-03:00")],
    );
    const manuaisAgo = await lote([
      criar({ tipo: "ENTRADA", data: "2025-08-15", categoriaId: "entrada-outras-vendas", descricao: desc("Venda fora"), valorCentavos: 1234 }),
      criar({ tipo: "SAIDA", data: "2025-08-15", categoriaId: "saida-ingredientes", descricao: desc("Fruta"), valorCentavos: 500 }),
      criar({ tipo: "ENTRADA", data: "2025-08-16", categoriaId: "entrada-aporte", descricao: desc("Aporte agosto"), valorCentavos: 10000 }),
      criar({ tipo: "SAIDA", data: "2025-08-16", categoriaId: "saida-retirada", descricao: desc("Retirada agosto"), valorCentavos: 3000 }),
    ]);
    confere(manuaisAgo.status === 200, "lançamentos manuais de agosto/2025", manuaisAgo.json);
    const depois = await ler();
    const delta = (mes, k) => depois[mes].planilha.totais[k] - antes[mes].planilha.totais[k];
    confere(delta("jul", "entradasCentavos") === 5000, "pedido de 31/07 às 23:30 da loja conta em julho", delta("jul", "entradasCentavos"));
    confere(delta("ago", "entradasCentavos") === 3000 + 4000 + 4500 + 4500 - 2000 + 1234, "agosto: site + presencial com kit + mimos (entrada por fora, restante pelo site, menos devolução) + manual", delta("ago", "entradasCentavos"));
    confere(delta("ago", "saidasCentavos") === 500 && delta("ago", "movimentoCentavos") === 15234 - 500 + 10000 - 3000, "agosto: saídas e movimento com aporte e retirada", [delta("ago", "saidasCentavos"), delta("ago", "movimentoCentavos")]);
    for (const mes of ["jul", "ago"]) {
      const { planilha, fin, desp } = depois[mes];
      const cent = (v) => Math.round(v * 100);
      confere(cent(fin.resumo.entradas) === planilha.totais.entradasCentavos && cent(fin.resumo.saidas) === planilha.totais.saidasCentavos && cent(fin.resumo.resultado) === planilha.totais.resultadoCentavos, `${mes}: Financeiro = planilha (entradas, saídas, resultado)`, [fin.resumo, planilha.totais]);
      const somaPartes = cent(fin.entradas.site.total) + cent(fin.entradas.presencial.total) + cent(fin.entradas.lembrancinhas.liquido) + cent(fin.entradas.manuais.total);
      confere(somaPartes === planilha.totais.entradasCentavos, `${mes}: site + presencial + mimos + manuais (consultas separadas) = entradas do livro`, [somaPartes, planilha.totais.entradasCentavos]);
      confere(cent(desp.entradas) === planilha.totais.entradasCentavos && cent(desp.saldo) === planilha.totais.resultadoCentavos && cent(desp.totalDespesas) === planilha.totais.saidasCentavos, `${mes}: Despesas = planilha`, [desp.entradas, desp.saldo, desp.totalDespesas]);
      const ev = fin.evolucao.find((e) => e.mes === depois[mes].fin.mes);
      confere(cent(ev.receita) === planilha.totais.entradasCentavos && cent(ev.despesas) === planilha.totais.saidasCentavos, `${mes}: o gráfico de 12 meses bate com o mês`, ev);
    }
    const ago = depois.ago.planilha;
    const origensAgo = new Set(ago.linhas.filter((l) => l.id.includes(marca) || l.descricao.includes(PREFIXO)).map((l) => l.origem));
    confere(["site", "presencial", "mimos-entrada", "mimos-restante", "mimos-devolucao", "manual-entrada", "manual-saida"].every((o) => origensAgo.has(o)), "agosto tem todas as origens", [...origensAgo]);
    const dev = ago.linhas.find((l) => l.id === `mimos-devolucao:${encId}d`);
    confere(dev?.valorCentavos === -2000 && dev.tipo === "ENTRADA" && dev.link === `/admin/encomendas/${encId}` && dev.categoriaId === "sistema-mimos-devolucoes", "devolução de mimos: entrada negativa com link", dev);
    confere(!ago.linhas.some((l) => l.id === `site:${oJul}`) && depois.jul.planilha.linhas.some((l) => l.id === `site:${oJul}` && l.data === "2025-07-31"), "o pedido da virada aparece em julho, dia 31");
    confere(!ago.linhas.some((l) => l.id.startsWith("site:") && l.id.endsWith(`${marca}d`)) && !ago.linhas.some((l) => l.id.endsWith(`${marca}e`)), "cancelado e pendente ficam de fora (D4)");
    confere(!JSON.stringify(ago.linhas).includes("Maria Feira") && !JSON.stringify(ago.linhas).includes("Planilha cliente"), "sem nomes de clientes por padrão (D8)");
    const comNomes = (await grade("2025-08-01", "2025-08-31", admin, "&nomes=1")).json;
    confere(comNomes.linhas.find((l) => l.id === `presencial:${oKit}`)?.cliente === "Maria Feira" && comNomes.linhas.find((l) => l.id === `site:${oAgo}`)?.cliente === "Planilha cliente", "?nomes=1 traz o nome", comNomes.linhas.filter((l) => l.cliente).slice(0, 3));
    confere(Math.round(depois.ago.fin.entradas.manuais.total * 100) - Math.round(antes.ago.fin.entradas.manuais.total * 100) === 1234, "Financeiro: bloco de entradas manuais (sem o aporte)", depois.ago.fin.entradas.manuais);
    confere(depois.ago.fin.movimentacoes.some((m) => m.tipo === "entrada" && m.descricao === desc("Venda fora")), "Financeiro: entrada manual nas movimentações");
    const saidasAgoAntes = antes.ago.fin.saidas.reduce((s, c) => s + Math.round(c.total * 100), 0);
    const saidasAgo = depois.ago.fin.saidas.reduce((s, c) => s + Math.round(c.total * 100), 0);
    confere(saidasAgo - saidasAgoAntes === 500, "Financeiro: saídas por grupo sem a retirada", [saidasAgoAntes, saidasAgo]);
  } finally {
    await limpar(configAntes);
    await banco.end();
  }
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

async function limpar(configAntes) {
  try {
    const despesas = (await sql("select id from expenses where descricao like $1", [`${PREFIXO}%`])).map((r) => r.id);
    const entradas = (await sql("select id from entradas_manuais where descricao like $1", [`${PREFIXO}%`])).map((r) => r.id);
    await sql("delete from expenses where id = any($1)", [despesas]);
    await sql("delete from entradas_manuais where id = any($1)", [entradas]);
    await sql("delete from auditoria_financeira where entidade_id = any($1) or admin_id = any($2)", [[...despesas, ...entradas, ...categoriasCriadas], contas]);
    await sql("delete from categorias_financeiras where id = any($1)", [categoriasCriadas]);
    await sql("delete from insumos where id = any($1)", [insumos]);
    await sql("delete from encomenda_devolucoes where encomenda_id = any($1)", [encomendas]);
    await sql("delete from pagamentos where encomenda_id = any($1) or order_id = any($2)", [encomendas, pedidos]);
    await sql("delete from encomendas where id = any($1)", [encomendas]);
    await sql("delete from order_kit_sabores where order_kit_id in (select id from order_kits where order_id = any($1))", [pedidos]);
    await sql("delete from order_kits where order_id = any($1)", [pedidos]);
    await sql("delete from order_items where order_id = any($1)", [pedidos]);
    await sql("delete from orders where id = any($1)", [pedidos]);
    await sql("delete from auditoria_financeira where entidade = 'config' and criado_em > now() - interval '1 hour' and admin_id is not null and depois->>'saldoInicialCentavos' in ('100000')");
    await sql("update config_financeiro set saldo_inicial = $1, saldo_inicial_em = $2 where id = 1", [configAntes.saldo_inicial, configAntes.saldo_inicial_em]);
    await sql("delete from addresses where user_id = any($1)", [contas]);
    await sql("delete from users where id = any($1)", [contas]);
    console.log(`limpeza: ${despesas.length} despesas, ${entradas.length} entradas, ${pedidos.length} pedidos, ${contas.length} contas`);
  } catch (e) {
    console.log(`FALHA na limpeza: ${e.message}`);
    falhas++;
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
