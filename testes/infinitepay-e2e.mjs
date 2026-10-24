// Teste ponta a ponta do pagamento pela InfinitePay, contra a InfinitePay FALSA (testes/infinitepay-falso.mjs).
//
// 1. Banco local ligado (npm run db:dev). NUNCA rode contra o Neon: o script recusa host que não seja local.
// 2. Suba o site com a InfinitePay falsa (PowerShell):
//      $env:PAGAMENTOS_SIMULADOS='false'; $env:INFINITEPAY_HANDLE='geleio'; $env:INFINITEPAY_API_KEY='inchk_falsa_e2e'
//      $env:INFINITEPAY_API_URL='http://127.0.0.1:4010'; $env:APP_URL='http://localhost:3100'
//      $env:IP_HEADER_CONFIAVEL='x-forwarded-for'; npx next dev -p 3100      (ou next start, depois do build)
// 3. node testes/infinitepay-e2e.mjs        (este script sobe a InfinitePay falsa na porta 4010)
//    Outras portas: E2E_BASE=http://localhost:3200 e E2E_PORTA_FALSA=4020 (com INFINITEPAY_API_URL e
//    APP_URL do site iguais a elas).
//
// Com E2E_DADOS_LEGAIS=1 no site E neste script, os casos 23 e 30 abrem as lembrancinhas por instantes e criam
// encomendas pelo POST /api/encomendas (a trava D13 só cede com a InfinitePay falsa configurada, a APP_URL em
// http://localhost e sem NETLIFY nem APP_ENV de produção); sem isso, conferem o 409/503 do D13 e pulam a criação.
// Rode as duas vezes antes de publicar.
//
// O banco do `prisma dev` é de UMA sessão só: não rode isto junto com outro servidor ou teste no mesmo banco
// (dá P2039). O mais seguro é um banco só do teste (outra instância do prisma dev, com as migrações aplicadas e
// uma cópia dos dados), passando a DATABASE_URL dele ao site e a este script. As colunas de data são TIMESTAMP
// sem fuso: o que este script grava vai como ISO em UTC (utc()).
//
// O admin vem de E2E_ADMIN_EMAIL / E2E_ADMIN_SENHA ou do ACESSO-LOCAL.txt. Tudo o que o teste cria
// (contas e-mail e2e-infinitepay-*, pedidos, encomendas e cobranças delas) é apagado no fim, mesmo se falhar.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODO_PADRAO, iniciarInfinitePayFalsa } from "./infinitepay-falso.mjs";

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
    console.log(`  FALHA ${rotulo}${extra === undefined ? "" : ` → ${JSON.stringify(extra).slice(0, 400)}`}`);
  }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// --- cliente HTTP com cookie ------------------------------------------------------------------
let ipSeq = 10;
function cliente() {
  let cookie = "";
  const ip = `10.77.0.${ipSeq++}`;
  return {
    async req(metodo, caminho, { corpo, cabecalhos = {}, seguir = false } = {}) {
      const r = await fetch(BASE + caminho, {
        method: metodo,
        redirect: seguir ? "follow" : "manual",
        headers: {
          ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          "X-Forwarded-For": ip,
          ...cabecalhos,
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
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
        // não é JSON (redirecionamento, HTML)
      }
      return { status: r.status, json, local: r.headers.get("location") };
    },
  };
}

const marca = Date.now().toString(36);
const contas = [];
const pedidos = [];
const encomendas = [];

async function novaConta(rotulo) {
  const c = cliente();
  const email = `e2e-infinitepay-${marca}-${rotulo}@teste.local`;
  const r = await c.req("POST", "/api/auth/register", { corpo: { nome: `E2E ${rotulo}`, email, senha: "Senha-E2E-123" } });
  if (r.status !== 201 && r.status !== 200) throw new Error(`cadastro ${rotulo}: ${r.status} ${JSON.stringify(r.json)}`);
  const [u] = await sql("select id from users where email = $1", [email]);
  contas.push(u.id);
  return c;
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

let produto;
async function novoPedido(c) {
  const r = await c.req("POST", "/api/orders", {
    corpo: { itens: [{ productId: produto, quantidade: 2 }], modoEntrega: "RETIRADA", telefone: "(86) 99999-1234" },
    cabecalhos: { "Idempotency-Key": `e2e-${marca}-${pedidos.length}-${Math.random().toString(36).slice(2, 8)}` },
  });
  if (r.status !== 201) throw new Error(`pedido: ${r.status} ${JSON.stringify(r.json)}`);
  pedidos.push(r.json.pedido.id);
  return r.json;
}

// O código no caminho do link (não é o slug da fatura, como na API real).
const codigoDe = (checkoutUrl) => new URL(checkoutUrl).pathname.split("/").pop();
const cobrancas = (pedidoId) => sql("select * from pagamentos where order_id = $1 order by criado_em, id", [pedidoId]);
const statusPedido = async (pedidoId) => (await sql("select status from orders where id = $1", [pedidoId]))[0]?.status;
// O site usa INFINITEPAY_WEBHOOK_SECRET (se definida) ou o SESSION_SECRET: rode este script com o
// mesmo INFINITEPAY_WEBHOOK_SECRET que o site recebeu.
const SEGREDO_AVISO = process.env.INFINITEPAY_WEBHOOK_SECRET?.trim() || process.env.SESSION_SECRET;
const tokenCom = (segredo, ref) => createHmac("sha256", segredo).update(`infinitepay-aviso:${ref}`).digest("base64url");
const tokenAviso = (ref) => tokenCom(SEGREDO_AVISO, ref);
const avisar = (url, corpo) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });

async function main() {
  await banco.connect();
  const falsa = await iniciarInfinitePayFalsa({ porta: Number(process.env.E2E_PORTA_FALSA ?? 4010), silencioso: true });
  const pagar = (corpo) => falsa.pagar(corpo);
  const modo = (m) => Object.assign(falsa.modo, MODO_PADRAO, m);

  try {
    const produtos = await cliente().req("GET", "/api/products");
    produto = (produtos.json?.produtos ?? produtos.json)?.find?.((p) => p.ativo !== false)?.id;
    if (!produto) throw new Error(`sem produto ativo: ${JSON.stringify(produtos.json).slice(0, 200)}`);

    const a = await novaConta("a");
    const b = await novaConta("b");
    const admin = cliente();
    const login = await admin.req("POST", "/api/auth/login", { corpo: credenciaisAdmin() });
    if (login.status !== 200) throw new Error(`login admin: ${login.status}`);

    console.log("1. PIX confirmado pelo aviso");
    const p1 = await novoPedido(a);
    confere(p1.pagamento?.gateway === "infinitepay" && p1.pagamento.checkoutUrl?.startsWith(falsa.origem), "pedido abre o link", p1.pagamento);
    confere(p1.pagamento?.status === "PENDENTE" && p1.pagamento.metodo === null, "cobrança pendente, sem método");
    const link1 = falsa.links.get(codigoDe(p1.pagamento.checkoutUrl));
    confere(link1.amount === Math.round(p1.pedido.total * 100) && link1.single_payment && /-03:00$/.test(link1.valid_until), "link: valor, single_payment e validade com fuso", link1);
    confere(link1.webhook_url.startsWith(`${BASE}/api/webhooks/infinitepay/ped-${p1.pedido.id}-1/`), "webhook com referência e token no caminho");
    const consultas1 = falsa.chamadas.payment_check;
    const pg1 = await pagar({ codigo: link1.codigo, metodo: "pix" });
    confere(pg1.aviso?.status === 200 && pg1.aviso.corpo?.resultado === "aprovado", "aviso → 200 aprovado", pg1.aviso);
    confere(falsa.chamadas.payment_check === consultas1 + 2, "o aviso que PAGA faz DUAS consultas (a principal e o canário)", falsa.chamadas.payment_check - consultas1);
    const s1 = await a.req("GET", `/api/orders/${p1.pedido.id}/pagamento`);
    confere(s1.json?.etapa === "PAGO" && s1.json.pedidoStatus === "PAGO", "etapa PAGO", s1.json);
    confere(s1.json?.cobranca?.metodo === "pix" && s1.json.cobranca.parcelas === 1 && s1.json.cobranca.valorPago === p1.pedido.total, "método, parcelas e valor pago");
    confere(s1.json?.cobranca?.comprovanteUrl?.startsWith(`${falsa.origem}/recibo/`) && s1.json.cobranca.checkoutUrl === null, "comprovante e sem link");
    const rep = await fetch(link1.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pg1.corpoAviso) });
    confere(rep.status === 200 && (await rep.json()).resultado === "ja-aprovada", "aviso repetido → 200 ja-aprovada");
    const [c1] = await cobrancas(p1.pedido.id);
    confere(c1.transacao_nsu === pg1.transaction_nsu && c1.aviso_transacao_nsu === null && c1.status === "APROVADO", "banco: transação gravada, candidato limpo");
    const pago = await a.req("POST", `/api/orders/${p1.pedido.id}/pagamento`, { corpo: {} });
    confere(pago.status === 409, "POST pagamento de pedido pago → 409", pago);

    console.log("2. Cartão 3x com juros confirmado pelo retorno (sem aviso)");
    const p2 = await novoPedido(a);
    const pg2 = await pagar({ codigo: codigoDe(p2.pagamento.checkoutUrl), metodo: "credit_card", parcelas: 3, aviso: false });
    const ret = new URL(pg2.retorno);
    const r2 = await a.req("GET", `/pagamento/retorno${ret.search}`);
    confere(r2.status === 303 && r2.local === `${BASE}/order-confirmation/${p2.pedido.id}?retorno=1`, "retorno → 303 para a confirmação limpa", r2);
    const s2 = await a.req("GET", `/api/orders/${p2.pedido.id}/pagamento`);
    confere(s2.json?.etapa === "PAGO" && s2.json.cobranca.parcelas === 3 && s2.json.cobranca.valorPago > s2.json.cobranca.valor, "PAGO com valor pago maior (juros)", s2.json?.cobranca);

    console.log("2b. PIX confirmado só pelo retorno (o aviso nunca chega), no formato real");
    const p2b = await novoPedido(a);
    const link2b = falsa.links.get(codigoDe(p2b.pagamento.checkoutUrl));
    confere(link2b.codigo !== link2b.slug && (await cobrancas(p2b.pedido.id))[0].fatura_slug === null, "link sem slug na criação (como a API real)");
    const pg2b = await pagar({ codigo: link2b.codigo, metodo: "pix", aviso: false });
    const q2b = new URL(pg2b.retorno).searchParams;
    confere(q2b.get("transaction_id") === pg2b.transaction_nsu && /^[0-9a-f-]{36}$/.test(pg2b.transaction_nsu), "retorno com transaction_id = transaction_nsu (UUID)", Object.fromEntries(q2b));
    const consultas2b = falsa.chamadas.payment_check;
    const r2b = await a.req("GET", `/pagamento/retorno?${q2b}`);
    confere(r2b.status === 303 && r2b.local === `${BASE}/order-confirmation/${p2b.pedido.id}?retorno=1`, "retorno → 303 sem a transação na URL", r2b);
    confere((await statusPedido(p2b.pedido.id)) === "PAGO" && falsa.chamadas.payment_check === consultas2b + 2, "o retorno sozinho marca PAGO (a consulta e o canário)");
    confere(
      (await cobrancas(p2b.pedido.id))[0].comprovante_url === `${falsa.origem}/recibo/${pg2b.transaction_nsu}`,
      "comprovante gravado: o recibo da própria transação",
    );
    const [c2b] = await cobrancas(p2b.pedido.id);
    confere(
      c2b.status === "APROVADO" && c2b.transacao_nsu === pg2b.transaction_nsu && c2b.fatura_slug === link2b.slug && c2b.metodo === "pix" && c2b.retorno_em !== null && c2b.aviso_transacao_nsu === null,
      "banco: transação, slug da fatura, método e retorno_em gravados",
      c2b,
    );
    const ficha2b = await admin.req("GET", `/api/admin/orders/${p2b.pedido.id}`);
    confere(ficha2b.json?.pedido?.status === "PAGO" && (ficha2b.json.pedido.pagamento?.alerta ?? null) === null, "painel: PAGO, sem alerta", ficha2b.json?.pedido?.pagamento);
    const avisoTarde2b = await avisar(link2b.webhook_url, pg2b.corpoAviso);
    confere(avisoTarde2b.status === 200 && (await avisoTarde2b.json()).resultado === "ja-aprovada", "o aviso que chega depois → 200 ja-aprovada");

    console.log("3. Aviso sem token, token errado e aviso falso");
    const p3 = await novoPedido(a);
    const link3 = falsa.links.get(codigoDe(p3.pagamento.checkoutUrl));
    const ref3 = `ped-${p3.pedido.id}-1`;
    const semToken = await fetch(`${BASE}/api/webhooks/infinitepay/${ref3}`, { method: "POST", body: "{}" });
    confere(semToken.status === 404 || semToken.status === 405, "sem token no caminho → rota não existe", semToken.status);
    const tokenErrado = await fetch(`${BASE}/api/webhooks/infinitepay/${ref3}/${"A".repeat(43)}`, {
      method: "POST",
      body: JSON.stringify({ transaction_nsu: "tx_x", invoice_slug: link3.slug }),
    });
    confere(tokenErrado.status === 401, "token errado → 401", tokenErrado.status);
    const outroToken = await fetch(`${BASE}/api/webhooks/infinitepay/${ref3}/${tokenAviso(`ped-${p1.pedido.id}-1`)}`, {
      method: "POST",
      body: JSON.stringify({ transaction_nsu: "tx_x", invoice_slug: link3.slug }),
    });
    confere(outroToken.status === 401, "token de outra cobrança → 401", outroToken.status);
    confere((await cobrancas(p3.pedido.id))[0].aviso_transacao_nsu === null, "banco: nada gravado");
    const consultas3 = falsa.chamadas.payment_check;
    const falso = await pagar({ codigo: link3.codigo, metodo: "pix", avisoFalso: true });
    confere(falsa.chamadas.payment_check === consultas3 + 1, "o aviso que NÃO paga faz UMA consulta (sem canário)", falsa.chamadas.payment_check - consultas3);
    confere(falso.aviso?.status === 200 && falso.aviso.corpo?.resultado === "invalido", "aviso com transação inexistente → 200 invalido", falso.aviso);
    const [c3] = await cobrancas(p3.pedido.id);
    confere((await statusPedido(p3.pedido.id)) === "PENDENTE" && c3.aviso_transacao_nsu === null && c3.status === "PENDENTE", "continua PENDENTE e o candidato foi apagado", c3);
    const desconhecida = await fetch(`${BASE}/api/webhooks/infinitepay/ped-naoexiste${marca}-1/${tokenAviso(`ped-naoexiste${marca}-1`)}`, {
      method: "POST",
      body: JSON.stringify({ transaction_nsu: "tx_x", invoice_slug: "s" }),
    });
    confere(desconhecida.status === 200 && (await desconhecida.json()).resultado === "desconhecida", "cobrança desconhecida com token certo → 200 sem efeito");

    console.log("4. Valor diferente");
    await esperar(3_100); // o aviso anterior reservou a vez desta cobrança por 3 s
    const errado = await pagar({ codigo: link3.codigo, metodo: "pix", valorErrado: true });
    confere(errado.aviso?.status === 200 && errado.aviso.corpo?.resultado === "divergente", "aviso → 200 divergente", errado.aviso);
    const [c3b] = await cobrancas(p3.pedido.id);
    confere((await statusPedido(p3.pedido.id)) === "PENDENTE" && c3b.status_gateway === "divergente:valor" && c3b.transacao_nsu === null, "NÃO vira PAGO; marca divergente:valor", c3b);
    const s3 = await a.req("GET", `/api/orders/${p3.pedido.id}/pagamento`);
    confere(s3.json?.etapa === "CONFIRMANDO", "com divergência, a cliente vê CONFIRMANDO (não PAGAR)", s3.json?.etapa);
    const outraVez = await a.req("POST", `/api/orders/${p3.pedido.id}/pagamento`, { corpo: {} });
    confere(outraVez.status === 409 && /Não pague de novo/.test(outraVez.json?.erro ?? ""), "com divergência, não abre link novo (409)", outraVez.json);
    const ficha3 = await admin.req("GET", `/api/admin/orders/${p3.pedido.id}`);
    confere(ficha3.json?.pedido?.pagamento?.alerta === "PAGO_COM_DIVERGENCIA" && ficha3.json.pedido.pagamento.metodo === null, "ficha: PAGO_COM_DIVERGENCIA", ficha3.json?.pedido?.pagamento);
    await sql("update pagamentos set avisado_em = now() - interval '2 hours' where order_id = $1", [p3.pedido.id]);
    const s3b = await a.req("GET", `/api/orders/${p3.pedido.id}/pagamento`);
    confere(s3b.json?.etapa === "CONFIRMANDO", "divergência continua CONFIRMANDO depois da janela de 30 min", s3b.json?.etapa);
    const resolve3 = await admin.req("PATCH", `/api/admin/orders/${p3.pedido.id}`, { corpo: { status: "PAGO" } });
    const ficha3b = await admin.req("GET", `/api/admin/orders/${p3.pedido.id}`);
    confere(resolve3.status === 200 && ficha3b.json?.pedido?.pagamento === null, "a dona marca PAGO: o alerta de divergência some", ficha3b.json?.pedido?.pagamento);

    console.log("5. IDOR, CSRF e retorno sem sessão");
    const idorGet = await b.req("GET", `/api/orders/${p3.pedido.id}/pagamento`);
    const idorPost = await b.req("POST", `/api/orders/${p3.pedido.id}/pagamento`, { corpo: {} });
    confere(idorGet.status === 404 && idorPost.status === 404, "outra conta → 404 no GET e no POST", [idorGet.status, idorPost.status]);
    const p5 = await novoPedido(a);
    const link5 = falsa.links.get(codigoDe(p5.pagamento.checkoutUrl));
    const q5 = new URLSearchParams({ order_nsu: link5.order_nsu, transaction_nsu: "tx_forjada", slug: link5.slug });
    const idorRet = await b.req("GET", `/pagamento/retorno?${q5}`);
    confere(idorRet.status === 303 && idorRet.local === `${BASE}/meus-pedidos`, "retorno de outra conta → /meus-pedidos", idorRet);
    const semSessao = await cliente().req("GET", `/pagamento/retorno?${q5}`);
    confere(semSessao.status === 303 && semSessao.local === `${BASE}/order-confirmation/${p5.pedido.id}?retorno=1`, "retorno sem sessão → confirmação (pede login)", semSessao);
    confere((await cobrancas(p5.pedido.id))[0].aviso_transacao_nsu === null, "banco: nenhum candidato gravado por outra conta ou sem sessão");
    const desconhecido = await a.req("GET", "/pagamento/retorno?order_nsu=ped-x-1&transaction_nsu=t&slug=s");
    confere(desconhecido.status === 303 && desconhecido.local === `${BASE}/meus-pedidos`, "retorno de referência desconhecida → /meus-pedidos");
    const csrf = await a.req("POST", `/api/orders/${p5.pedido.id}/pagamento`, { corpo: {}, cabecalhos: { Origin: "https://evil.example" } });
    const csrf2 = await a.req("POST", `/api/orders/${p5.pedido.id}/pagamento`, { corpo: {}, cabecalhos: { "Sec-Fetch-Site": "cross-site" } });
    confere(csrf.status === 403 && csrf2.status === 403, "CSRF → 403", [csrf.status, csrf2.status]);
    const mesmo = await a.req("POST", `/api/orders/${p5.pedido.id}/pagamento`, { corpo: {} });
    confere(mesmo.status === 200 && mesmo.json?.cobranca?.checkoutUrl === p5.pagamento.checkoutUrl, "POST com link valendo devolve o mesmo link", mesmo.json);

    console.log("6. InfinitePay fora do ar: 400 para repetir, tela em CONFIRMANDO até voltar");
    const p6 = await novoPedido(a);
    modo({ falharConferencia: 500 });
    const pg6 = await pagar({ codigo: codigoDe(p6.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg6.aviso?.status === 400 && pg6.aviso.corpo?.resultado === "transitorio", "aviso → 400 transitorio", pg6.aviso);
    const s6 = await a.req("GET", `/api/orders/${p6.pedido.id}/pagamento`);
    confere(s6.json?.etapa === "CONFIRMANDO", "etapa CONFIRMANDO", s6.json?.etapa);
    modo({});
    await esperar(8_300);
    const s6b = await a.req("GET", `/api/orders/${p6.pedido.id}/pagamento`);
    confere(s6b.json?.etapa === "PAGO", "a tela confirma quando a InfinitePay volta", s6b.json?.etapa);

    console.log("7. Tempo esgotado no aviso e a repetição da InfinitePay");
    const p7 = await novoPedido(a);
    modo({ falharConferencia: "tempo" });
    const inicio = Date.now();
    const pg7 = await pagar({ codigo: codigoDe(p7.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg7.aviso?.status === 400 && Date.now() - inicio < 9_000, "aviso → 400 em ~5 s", { aviso: pg7.aviso, ms: Date.now() - inicio });
    modo({});
    await esperar(3_100);
    const link7 = falsa.links.get(codigoDe(p7.pagamento.checkoutUrl));
    const repete = await fetch(link7.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pg7.corpoAviso) });
    confere(repete.status === 200 && (await statusPedido(p7.pedido.id)) === "PAGO", "repetição do aviso → PAGO", repete.status);

    console.log("8. A mesma transação para duas cobranças (API hipotética que não amarra e engana o canário: o UNIQUE é a última barreira)");
    modo({ naoAmarraPedido: true, canarioCego: true });
    const p8a = await novoPedido(a);
    const p8b = await novoPedido(a);
    const pg8 = await pagar({ codigo: codigoDe(p8a.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg8.aviso?.corpo?.resultado === "aprovado", "primeira cobrança aprovada", pg8.aviso);
    const link8b = falsa.links.get(codigoDe(p8b.pagamento.checkoutUrl));
    const reuso = await fetch(link8b.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pg8.corpoAviso, order_nsu: link8b.order_nsu }),
    });
    const reusoJson = await reuso.json();
    const [c8b] = await cobrancas(p8b.pedido.id);
    confere(reuso.status === 200 && reusoJson.resultado === "invalido", "segunda cobrança recusada (UNIQUE da transação)", reusoJson);
    confere((await statusPedido(p8b.pedido.id)) === "PENDENTE" && c8b.status_gateway === "transacao-ja-usada", "o segundo pedido continua PENDENTE", c8b);
    modo({});

    console.log("9. Cancelado pela dona e depois pago: alerta no painel");
    const p9 = await novoPedido(a);
    const cancela = await admin.req("PATCH", `/api/admin/orders/${p9.pedido.id}`, { corpo: { status: "CANCELADO" } });
    confere(cancela.status === 200 && /até 1 hora/.test(cancela.json?.aviso ?? ""), "cancelar avisa que o link ainda vale", cancela.json);
    confere((await cobrancas(p9.pedido.id))[0].status === "CANCELADO", "cobrança encerrada no banco");
    const pg9 = await pagar({ codigo: codigoDe(p9.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg9.aviso?.corpo?.resultado === "aprovado" && (await statusPedido(p9.pedido.id)) === "CANCELADO", "pago depois: cobrança aprovada, pedido continua CANCELADO", pg9.aviso);
    const ficha9 = await admin.req("GET", `/api/admin/orders/${p9.pedido.id}`);
    confere(ficha9.json?.pedido?.pagamento?.alerta === "PAGO_APOS_CANCELAMENTO", "ficha: PAGO_APOS_CANCELAMENTO", ficha9.json?.pedido?.pagamento);
    const s9 = await a.req("GET", `/api/orders/${p9.pedido.id}/pagamento`);
    confere(s9.json?.etapa === "CANCELADO", "cliente vê CANCELADO");

    console.log("10. Link quase vencendo, link novo, e os dois pagos: pago em dobro");
    const p10 = await novoPedido(a);
    await sql("update pagamentos set expira_em = now() + interval '2 minutes' where order_id = $1", [p10.pedido.id]);
    const novo = await a.req("POST", `/api/orders/${p10.pedido.id}/pagamento`, { corpo: {} });
    confere(novo.status === 200 && novo.json?.cobranca?.checkoutUrl && novo.json.cobranca.checkoutUrl !== p10.pagamento.checkoutUrl, "link vencendo dá lugar a outro", novo.json);
    const c10 = await cobrancas(p10.pedido.id);
    confere(c10.length === 2 && c10[0].status === "CANCELADO" && c10[1].referencia_externa === `ped-${p10.pedido.id}-2`, "o antigo vira CANCELADO; o novo é ped-<id>-2");
    await pagar({ codigo: codigoDe(p10.pagamento.checkoutUrl), metodo: "pix" });
    await pagar({ codigo: codigoDe(novo.json.cobranca.checkoutUrl), metodo: "credit_card", parcelas: 2 });
    const ficha10 = await admin.req("GET", `/api/admin/orders/${p10.pedido.id}`);
    confere(ficha10.json?.pedido?.pagamento?.alerta === "PAGO_EM_DOBRO" && ficha10.json.pedido.pagamento.metodo === "pix", "ficha: PAGO_EM_DOBRO com o método do primeiro", ficha10.json?.pedido?.pagamento);
    const lista = await admin.req("GET", "/api/admin/orders?status=PAGO");
    const naLista = lista.json?.pedidos?.find((p) => p.id === p10.pedido.id);
    confere(naLista?.pagamento?.alerta === "PAGO_EM_DOBRO" && naLista.expirado === false, "lista do painel: pagamento e expirado", naLista);

    console.log("11. Pedido com mais de 48 h");
    const p11 = await novoPedido(a);
    await sql("update orders set created_at = now() - interval '49 hours' where id = $1", [p11.pedido.id]);
    await sql("update pagamentos set expira_em = now() - interval '1 minute' where order_id = $1", [p11.pedido.id]);
    const exp = await a.req("POST", `/api/orders/${p11.pedido.id}/pagamento`, { corpo: {} });
    confere(exp.status === 409 && /expirou/.test(exp.json?.erro ?? ""), "POST → 409 expirou", exp.json);
    const s11 = await a.req("GET", `/api/orders/${p11.pedido.id}/pagamento`);
    confere(s11.json?.etapa === "EXPIRADO" && s11.json.cobranca.checkoutUrl === null, "etapa EXPIRADO, sem link", s11.json);
    const ficha11 = await admin.req("GET", `/api/admin/orders/${p11.pedido.id}`);
    confere(ficha11.json?.pedido?.expirado === true && ficha11.json.pedido.pagamento === null, "ficha: expirado, sem pagamento");

    console.log("12. InfinitePay falha ao criar o pedido; dois 'Pagar' ao mesmo tempo abrem um link só");
    modo({ falharLinks: 500 });
    const p12 = await novoPedido(a);
    confere(p12.pagamento === null, "pedido criado com pagamento null", p12.pagamento);
    const falhou = await a.req("POST", `/api/orders/${p12.pedido.id}/pagamento`, { corpo: {} });
    confere(falhou.status === 502, "POST pagamento com a InfinitePay fora → 502", falhou.status);
    modo({});
    const [x, y] = await Promise.all([
      a.req("POST", `/api/orders/${p12.pedido.id}/pagamento`, { corpo: {} }),
      a.req("POST", `/api/orders/${p12.pedido.id}/pagamento`, { corpo: {} }),
    ]);
    confere(x.status === 200 && y.status === 200 && x.json.cobranca.checkoutUrl === y.json.cobranca.checkoutUrl, "os dois recebem o mesmo link", [x.json, y.json]);
    confere((await cobrancas(p12.pedido.id)).length === 1, "banco: uma cobrança só");

    console.log("14. Ataque: a cliente apresenta no retorno a transação de OUTRO link da loja, de mesmo valor");
    // O servidor consulta com o order_nsu do NOSSO banco (nunca o da query), e a API amarra a transação
    // ao pedido consultado: transação de outro pedido → paid=false; slug errado → success=false.
    const alvo = await novoPedido(a); // o pedido que ela quer "pagar" de graça
    const outro = await novoPedido(b); // outro link da loja, de mesmo valor, pago de verdade
    const pgOutro = await pagar({ codigo: codigoDe(outro.pagamento.checkoutUrl), metodo: "pix", aviso: false });
    const linkAlvo = falsa.links.get(codigoDe(alvo.pagamento.checkoutUrl));
    const tentativas = [
      { slug: linkAlvo.slug, rotulo: "com o slug da fatura do pedido (success=false)" },
      { slug: pgOutro.slug, rotulo: "com o slug do outro link (paid=false)" },
    ];
    for (const t of tentativas) {
      const antes = falsa.chamadas.payment_check;
      const q = new URLSearchParams({ order_nsu: linkAlvo.order_nsu, transaction_nsu: pgOutro.transaction_nsu, slug: t.slug });
      const r = await a.req("GET", `/pagamento/retorno?${q}`);
      confere(
        r.status === 303 && (await statusPedido(alvo.pedido.id)) === "PENDENTE" && falsa.chamadas.payment_check === antes + 1,
        `retorno ${t.rotulo}: consultado e recusado, continua PENDENTE`,
        { r, consultas: falsa.chamadas.payment_check - antes },
      );
      await esperar(8_300); // passa o intervalo entre consultas, para a próxima tentativa consultar de verdade
    }
    const [cAlvo] = await cobrancas(alvo.pedido.id);
    confere(
      cAlvo.aviso_transacao_nsu === null && cAlvo.transacao_nsu === null && cAlvo.retorno_em !== null && cAlvo.status_gateway === "aberto",
      "banco: nada gravado além do retorno_em (nem marca de não pago ou divergência)",
      cAlvo,
    );
    const fichaAlvo = await admin.req("GET", `/api/admin/orders/${alvo.pedido.id}`);
    confere((fichaAlvo.json?.pedido?.pagamento?.alerta ?? null) === null, "painel: nenhum alerta falso", fichaAlvo.json?.pedido?.pagamento);
    const sAlvo = await a.req("GET", `/api/orders/${alvo.pedido.id}/pagamento`);
    confere(sAlvo.json?.etapa === "CONFIRMANDO" && sAlvo.json.pedidoStatus === "PENDENTE", "tela em CONFIRMANDO pelo retorno, sem confirmar nada", sAlvo.json);
    // A transação do outro link continua valendo para o pedido dela, e o pagamento de verdade do alvo também.
    await b.req("GET", `/pagamento/retorno${new URL(pgOutro.retorno).search}`);
    confere((await statusPedido(outro.pedido.id)) === "PAGO", "o outro pedido confirma pelo próprio retorno");
    const pgAlvo = await pagar({ codigo: linkAlvo.codigo, metodo: "pix" });
    confere(pgAlvo.aviso?.corpo?.resultado === "aprovado" && (await statusPedido(alvo.pedido.id)) === "PAGO", "o aviso de verdade confirma", pgAlvo.aviso);
    // Com o slug da fatura gravado na criação do link, o retorno com outro slug nem é consultado.
    modo({ comSlug: true });
    const alvo2 = await novoPedido(a);
    const linkAlvo2 = falsa.links.get(codigoDe(alvo2.pagamento.checkoutUrl));
    confere((await cobrancas(alvo2.pedido.id))[0].fatura_slug === linkAlvo2.slug, "com slug na resposta de /links, a fatura fica gravada");
    const pgAlvo2 = await pagar({ codigo: linkAlvo2.codigo, metodo: "pix", aviso: false });
    const q2 = new URL(pgAlvo2.retorno).searchParams;
    q2.set("slug", "fat_outra");
    const consultasAntes = falsa.chamadas.payment_check;
    await a.req("GET", `/pagamento/retorno?${q2}`);
    confere(
      (await statusPedido(alvo2.pedido.id)) === "PENDENTE" && falsa.chamadas.payment_check === consultasAntes,
      "slug diferente da fatura gravada: o retorno nem consulta",
      falsa.chamadas.payment_check - consultasAntes,
    );
    await a.req("GET", `/pagamento/retorno${new URL(pgAlvo2.retorno).search}`);
    confere((await statusPedido(alvo2.pedido.id)) === "PAGO", "com o slug da fatura, o retorno confirma");
    modo({});

    console.log("15. payment_check responde 404 logo depois do pagamento");
    const p15 = await novoPedido(a);
    modo({ conferencia404: true });
    const pg15 = await pagar({ codigo: codigoDe(p15.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg15.aviso?.status === 400 && pg15.aviso.corpo?.resultado === "transitorio", "404 na janela → aviso 400 (a InfinitePay repete)", pg15.aviso);
    confere((await cobrancas(p15.pedido.id))[0].aviso_transacao_nsu === pg15.transaction_nsu, "o candidato continua gravado");
    modo({});
    await esperar(3_100);
    const link15 = falsa.links.get(codigoDe(p15.pagamento.checkoutUrl));
    const repete15 = await fetch(link15.webhook_url, { method: "POST", body: JSON.stringify(pg15.corpoAviso) });
    confere(repete15.status === 200 && (await statusPedido(p15.pedido.id)) === "PAGO", "a repetição confirma", repete15.status);
    // Depois da janela de 30 min, o 404 descarta o candidato.
    const p15b = await novoPedido(a);
    modo({ conferencia404: true });
    const pg15b = await pagar({ codigo: codigoDe(p15b.pagamento.checkoutUrl), metodo: "pix" });
    await sql("update pagamentos set avisado_em = now() - interval '31 minutes', consultado_em = null where order_id = $1", [p15b.pedido.id]);
    const link15b = falsa.links.get(codigoDe(p15b.pagamento.checkoutUrl));
    const tarde = await fetch(link15b.webhook_url, { method: "POST", body: JSON.stringify(pg15b.corpoAviso) });
    const [c15b] = await cobrancas(p15b.pedido.id);
    confere(tarde.status === 200 && c15b.aviso_transacao_nsu === null && c15b.status_gateway === "invalido:http-404", "404 depois da janela → 200 e candidato descartado", c15b);
    modo({});

    console.log("16. CONFIRMANDO numa cobrança que não é a última");
    const p16 = await novoPedido(a);
    await sql("update pagamentos set expira_em = now() + interval '2 minutes' where order_id = $1", [p16.pedido.id]);
    const novo16 = await a.req("POST", `/api/orders/${p16.pedido.id}/pagamento`, { corpo: {} });
    confere(novo16.status === 200 && (await cobrancas(p16.pedido.id)).length === 2, "abriu um segundo link", novo16.status);
    modo({ falharConferencia: 500 });
    await pagar({ codigo: codigoDe(p16.pagamento.checkoutUrl), metodo: "pix" }); // paga o PRIMEIRO link (ainda vale na InfinitePay)
    const s16 = await a.req("GET", `/api/orders/${p16.pedido.id}/pagamento`);
    confere(s16.json?.etapa === "CONFIRMANDO", "etapa CONFIRMANDO pela cobrança mais antiga com candidato", s16.json?.etapa);
    const bloqueado16 = await a.req("POST", `/api/orders/${p16.pedido.id}/pagamento`, { corpo: {} });
    confere(bloqueado16.status === 409 && /Não pague de novo/.test(bloqueado16.json?.erro ?? ""), "com aviso em conferência, não abre link novo", bloqueado16.json);
    modo({});
    await esperar(8_300);
    const s16b = await a.req("GET", `/api/orders/${p16.pedido.id}/pagamento`);
    confere(s16b.json?.etapa === "PAGO", "a tela reconfere essa cobrança e confirma", s16b.json?.etapa);

    console.log("17. Aviso que não fecha há mais de 30 min: continua CONFIRMANDO e o painel alerta; marcar pago à mão");
    const p17 = await novoPedido(a);
    modo({ falharConferencia: 401 });
    const pg17 = await pagar({ codigo: codigoDe(p17.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg17.aviso?.status === 400, "chave recusada (401) → aviso 400", pg17.aviso);
    await sql("update pagamentos set avisado_em = now() - interval '40 minutes', consultado_em = null where order_id = $1", [p17.pedido.id]);
    const s17 = await a.req("GET", `/api/orders/${p17.pedido.id}/pagamento`);
    confere(s17.json?.etapa === "CONFIRMANDO", "depois de 30 min, continua CONFIRMANDO (não volta a PAGAR)", s17.json?.etapa);
    const pagar17 = await a.req("POST", `/api/orders/${p17.pedido.id}/pagamento`, { corpo: {} });
    confere(pagar17.status === 409, "não abre link novo", pagar17.status);
    const ficha17 = await admin.req("GET", `/api/admin/orders/${p17.pedido.id}`);
    confere(ficha17.json?.pedido?.pagamento?.alerta === "AVISO_NAO_CONFERIDO" && ficha17.json.pedido.expirado === false, "painel: AVISO_NAO_CONFERIDO", ficha17.json?.pedido?.pagamento);
    const manual = await admin.req("PATCH", `/api/admin/orders/${p17.pedido.id}`, { corpo: { status: "PAGO" } });
    confere(manual.status === 200 && /até 1 hora/.test(manual.json?.aviso ?? ""), "marcar PAGO à mão avisa do link aberto", manual.json);
    confere((await cobrancas(p17.pedido.id)).every((c) => c.status !== "PENDENTE"), "marcar PAGO à mão encerra os links abertos");
    modo({});
    await esperar(3_100); // as reconferências acima reservaram a vez desta cobrança
    const link17 = falsa.links.get(codigoDe(p17.pagamento.checkoutUrl));
    const tarde17 = await avisar(link17.webhook_url, pg17.corpoAviso);
    const ficha17b = await admin.req("GET", `/api/admin/orders/${p17.pedido.id}`);
    confere(tarde17.status === 200 && ficha17b.json?.pedido?.pagamento?.alerta === "CONFIRMADO_APOS_BAIXA_MANUAL", "confirmado depois: alerta CONFIRMADO_APOS_BAIXA_MANUAL", ficha17b.json?.pedido?.pagamento);

    console.log("18. Retorno que ainda não confirma (a InfinitePay ainda não acha a transação): segura CONFIRMANDO e o link novo por 30 min");
    const p18 = await novoPedido(a);
    const pg18 = await pagar({ codigo: codigoDe(p18.pagamento.checkoutUrl), metodo: "pix", aviso: false });
    modo({ conferencia404: true });
    const r18 = await a.req("GET", `/pagamento/retorno${new URL(pg18.retorno).search}`);
    modo({});
    const [c18] = await cobrancas(p18.pedido.id);
    confere(
      r18.status === 303 && c18.retorno_em !== null && c18.aviso_transacao_nsu === null && c18.status === "PENDENTE" && c18.status_gateway === "aberto",
      "retorno grava só retorno_em",
      c18,
    );
    const s18 = await a.req("GET", `/api/orders/${p18.pedido.id}/pagamento`);
    confere(s18.json?.etapa === "CONFIRMANDO" && s18.json.pedidoStatus === "PENDENTE", "CONFIRMANDO sem confirmar", s18.json);
    const pagar18 = await a.req("POST", `/api/orders/${p18.pedido.id}/pagamento`, { corpo: {} });
    confere(pagar18.status === 409 && /Aguarde/.test(pagar18.json?.erro ?? ""), "não abre link novo logo depois do retorno", pagar18.json);
    await sql("update pagamentos set retorno_em = now() - interval '31 minutes' where order_id = $1", [p18.pedido.id]);
    const s18b = await a.req("GET", `/api/orders/${p18.pedido.id}/pagamento`);
    confere(s18b.json?.etapa === "PAGAR", "depois de 30 min sem aviso, volta a PAGAR", s18b.json?.etapa);
    await esperar(3_100);
    const aviso18 = await avisar(falsa.links.get(codigoDe(p18.pagamento.checkoutUrl)).webhook_url, pg18.corpoAviso);
    confere(aviso18.status === 200 && (await statusPedido(p18.pedido.id)) === "PAGO", "o aviso confirma", aviso18.status);

    console.log("19. Aviso com slug de outra fatura não apaga o candidato verdadeiro (fatura com slug gravado)");
    // A API real não devolve o slug em /links: esta proteção só vale se um dia devolver (aí o token do aviso continua sendo a barreira principal).
    modo({ comSlug: true });
    const p19 = await novoPedido(a);
    const link19 = falsa.links.get(codigoDe(p19.pagamento.checkoutUrl));
    modo({ falharConferencia: 500 });
    const pg19 = await pagar({ codigo: link19.codigo, metodo: "pix" });
    const forjado = await avisar(link19.webhook_url, { transaction_nsu: "tx_forjada", invoice_slug: "fat_outra", order_nsu: link19.order_nsu });
    const forjadoJson = await forjado.json();
    const [c19] = await cobrancas(p19.pedido.id);
    confere(forjado.status === 200 && forjadoJson.resultado === "slug-diferente" && c19.aviso_transacao_nsu === pg19.transaction_nsu, "ignorado antes de gravar; o candidato verdadeiro fica", { forjadoJson, c19: c19.aviso_transacao_nsu });
    modo({});
    await esperar(3_100);
    const real19 = await avisar(link19.webhook_url, pg19.corpoAviso);
    confere(real19.status === 200 && (await statusPedido(p19.pedido.id)) === "PAGO", "o verdadeiro confirma", real19.status);

    console.log("20. Falha nossa no aviso responde 400 (a InfinitePay repete)");
    const p20 = await novoPedido(a);
    const link20 = falsa.links.get(codigoDe(p20.pagamento.checkoutUrl));
    const grande = await avisar(link20.webhook_url, JSON.stringify({ transaction_nsu: "tx", invoice_slug: link20.slug, lixo: "x".repeat(40_000) }));
    confere(grande.status === 400, "corpo grande demais → 400 (não 413/500)", grande.status);
    const ensaio = await avisar(`${BASE}/api/webhooks/infinitepay/ensaio-202610221200/ensaio`, "{}");
    const ensaioRuim = await avisar(`${BASE}/api/webhooks/infinitepay/ensaio-x/ensaio`, "{}");
    confere(ensaio.status === 400 && ensaioRuim.status === 401, "rota de ensaio: 400 só no formato ensaio-AAAAMMDDhhmm", [ensaio.status, ensaioRuim.status]);

    console.log("24. Canário de amarração no retorno, recibo de outro host e retorno sem marca");
    // Conta própria: o limite de pedidos por hora da conta "a" já foi usado pelos casos anteriores.
    const conta24 = await novaConta("c");
    const semMarca = (c) => c.status === "PENDENTE" && c.status_gateway === "aberto" && c.transacao_nsu === null && c.aviso_transacao_nsu === null;
    const semAlerta = async (pedidoId) => ((await admin.req("GET", `/api/admin/orders/${pedidoId}`)).json?.pedido?.pagamento?.alerta ?? null) === null;
    // a) API hipotética que NÃO amarra: a transação de OUTRA compra de mesmo valor, apresentada no
    //    retorno, passa na consulta principal, mas o canário também diz "pago": barrada.
    modo({ naoAmarraPedido: true });
    const alvo24 = await novoPedido(conta24);
    const outro24 = await novoPedido(b);
    const pgOutro24 = await pagar({ codigo: codigoDe(outro24.pagamento.checkoutUrl), metodo: "pix", aviso: false });
    const link24 = falsa.links.get(codigoDe(alvo24.pagamento.checkoutUrl));
    const antes24 = falsa.chamadas.payment_check;
    const q24 = new URLSearchParams({ order_nsu: link24.order_nsu, transaction_nsu: pgOutro24.transaction_nsu, slug: pgOutro24.slug });
    const r24 = await conta24.req("GET", `/pagamento/retorno?${q24}`);
    const [c24] = await cobrancas(alvo24.pedido.id);
    confere(
      r24.status === 303 && (await statusPedido(alvo24.pedido.id)) === "PENDENTE" && falsa.chamadas.payment_check === antes24 + 2 && semMarca(c24),
      "API que não amarra: o canário barra o retorno (duas consultas, nada gravado)",
      { c24, consultas: falsa.chamadas.payment_check - antes24 },
    );
    confere(await semAlerta(alvo24.pedido.id), "painel: nenhum alerta");
    // Com a API que não amarra, nem a compra de verdade confirma pelo retorno: quem confirma é o aviso.
    await b.req("GET", `/pagamento/retorno${new URL(pgOutro24.retorno).search}`);
    confere((await statusPedido(outro24.pedido.id)) === "PENDENTE", "API que não amarra: o próprio retorno também não confirma (fail-closed)");
    await esperar(3_100); // o retorno reservou a vez desta cobrança
    const avisoOutro24 = await avisar(falsa.links.get(codigoDe(outro24.pagamento.checkoutUrl)).webhook_url, pgOutro24.corpoAviso);
    // Com o canário também no aviso, uma API que não amarra nunca confirma sozinha: a dona confere no app.
    const [cOutro24] = await cobrancas(outro24.pedido.id);
    confere(
      avisoOutro24.status === 200 && (await avisoOutro24.json()).resultado === "divergente" && (await statusPedido(outro24.pedido.id)) === "PENDENTE" && cOutro24.status_gateway === "divergente:nao-amarra",
      "o aviso também não confirma: divergente:nao-amarra para a dona conferir no app",
      cOutro24,
    );
    modo({});

    // b) Canário com falha (500, 404, tempo): não confirma pelo retorno e não grava nada; depois confirma.
    for (const falha of [500, 404, "tempo"]) {
      const p = await novoPedido(conta24);
      const pg = await pagar({ codigo: codigoDe(p.pagamento.checkoutUrl), metodo: "pix", aviso: false });
      modo({ falharCanario: falha });
      await conta24.req("GET", `/pagamento/retorno${new URL(pg.retorno).search}`);
      modo({});
      const [c] = await cobrancas(p.pedido.id);
      confere((await statusPedido(p.pedido.id)) === "PENDENTE" && semMarca(c) && c.retorno_em !== null, `canário com falha (${falha}): não confirma, só retorno_em`, c);
      await conta24.req("GET", `/pagamento/retorno${new URL(pg.retorno).search}`);
      confere((await statusPedido(p.pedido.id)) === "PAGO", `canário de volta (${falha}): o retorno confirma`);
    }

    // b2) A vez reservada pelo retorno é devolvida quando o canário falha: o aviso que chega colado
    //     (sem esperar os 3 s entre consultas) confirma, com duas consultas (a principal e o canário).
    for (const [rotulo, falha] of [["canário com 500", 500], ["canário com tempo esgotado", "tempo"]]) {
      const pc = await novoPedido(conta24);
      const pgc = await pagar({ codigo: codigoDe(pc.pagamento.checkoutUrl), metodo: "pix", aviso: false });
      modo({ falharCanario: falha });
      await conta24.req("GET", `/pagamento/retorno${new URL(pgc.retorno).search}`);
      modo({});
      const [cc] = await cobrancas(pc.pedido.id);
      confere((await statusPedido(pc.pedido.id)) === "PENDENTE" && cc.consultado_em === null, `${rotulo}: a vez reservada foi devolvida (consultado_em volta ao que era)`, cc.consultado_em);
      const consultasAntes = falsa.chamadas.payment_check;
      const avisoColado = await avisar(falsa.links.get(codigoDe(pc.pagamento.checkoutUrl)).webhook_url, pgc.corpoAviso);
      confere(
        avisoColado.status === 200 && (await statusPedido(pc.pedido.id)) === "PAGO" && falsa.chamadas.payment_check === consultasAntes + 2,
        `${rotulo}: o aviso colado confirma (sem ADIADO), com a consulta e o canário`,
        { status: avisoColado.status, consultas: falsa.chamadas.payment_check - consultasAntes },
      );
    }

    // c) Consulta principal com tempo esgotado no retorno: nada gravado além do retorno_em.
    const p24c = await novoPedido(conta24);
    const pg24c = await pagar({ codigo: codigoDe(p24c.pagamento.checkoutUrl), metodo: "pix", aviso: false });
    modo({ falharConferencia: "tempo" });
    await conta24.req("GET", `/pagamento/retorno${new URL(pg24c.retorno).search}`);
    modo({});
    const [c24c] = await cobrancas(p24c.pedido.id);
    confere((await statusPedido(p24c.pedido.id)) === "PENDENTE" && semMarca(c24c), "tempo esgotado no retorno: sem marca", c24c);

    // d) Retorno reapresentando uma transação já usada (de um pedido já pago) em outro pedido de mesmo valor.
    const pago24 = await novoPedido(conta24);
    const pgPago24 = await pagar({ codigo: codigoDe(pago24.pagamento.checkoutUrl), metodo: "pix" });
    confere((await statusPedido(pago24.pedido.id)) === "PAGO", "pedido pago pelo aviso", pgPago24.aviso);
    const reuso24 = await novoPedido(conta24);
    const linkReuso24 = falsa.links.get(codigoDe(reuso24.pagamento.checkoutUrl));
    const qReuso = new URLSearchParams({ order_nsu: linkReuso24.order_nsu, transaction_nsu: pgPago24.transaction_nsu, slug: pgPago24.slug });
    await conta24.req("GET", `/pagamento/retorno?${qReuso}`);
    const [cReuso] = await cobrancas(reuso24.pedido.id);
    confere((await statusPedido(reuso24.pedido.id)) === "PENDENTE" && semMarca(cReuso) && (await semAlerta(reuso24.pedido.id)), "transação já usada no retorno: PENDENTE, sem marca e sem alerta", cReuso);

    // e) receipt_url de outro host (ou de outra transação): confirma, mas o comprovante não é gravado.
    for (const [rotulo, recibo] of [
      ["outro host", (tx) => `https://evil.example/recibo/${tx}`],
      ["outra transação", () => `${falsa.origem}/recibo/00000000-0000-4000-8000-000000000000`],
    ]) {
      const p = await novoPedido(conta24);
      const pg = await pagar({ codigo: codigoDe(p.pagamento.checkoutUrl), metodo: "pix", aviso: false });
      const q = new URL(pg.retorno).searchParams;
      q.set("receipt_url", recibo(pg.transaction_nsu));
      await conta24.req("GET", `/pagamento/retorno?${q}`);
      const [c] = await cobrancas(p.pedido.id);
      confere((await statusPedido(p.pedido.id)) === "PAGO" && c.comprovante_url === null, `recibo de ${rotulo}: confirma sem gravar o comprovante`, c.comprovante_url);
    }

    console.log("25. Canário também no aviso: a API que não amarra → divergente:nao-amarra; canário que falha → 400 sem prender a vez");
    const conta25 = await novaConta("d");
    modo({ naoAmarraPedido: true });
    const p25 = await novoPedido(conta25);
    const link25 = falsa.links.get(codigoDe(p25.pagamento.checkoutUrl));
    const consultas25 = falsa.chamadas.payment_check;
    const pg25 = await pagar({ codigo: link25.codigo, metodo: "pix" });
    confere(pg25.aviso?.status === 200 && pg25.aviso.corpo?.resultado === "divergente", "aviso com a API que não amarra → 200 divergente", pg25.aviso);
    confere(falsa.chamadas.payment_check === consultas25 + 2, "duas consultas (a principal e o canário)");
    const [c25] = await cobrancas(p25.pedido.id);
    confere(
      (await statusPedido(p25.pedido.id)) === "PENDENTE" && c25.status === "PENDENTE" && c25.status_gateway === "divergente:nao-amarra" && c25.transacao_nsu === null,
      "NÃO vira PAGO; marca divergente:nao-amarra e não grava a transação",
      c25,
    );
    const ficha25 = await admin.req("GET", `/api/admin/orders/${p25.pedido.id}`);
    confere(ficha25.json?.pedido?.pagamento?.alerta === "PAGO_COM_DIVERGENCIA", "painel: PAGO_COM_DIVERGENCIA (a dona confere no app)", ficha25.json?.pedido?.pagamento);
    const s25 = await conta25.req("GET", `/api/orders/${p25.pedido.id}/pagamento`);
    confere(s25.json?.etapa === "CONFIRMANDO", "a cliente vê CONFIRMANDO (não PAGAR)", s25.json?.etapa);
    modo({});

    // Canário que falha no aviso: 400 (a InfinitePay repete) e a vez é devolvida, então a repetição
    // colada (sem esperar os 3 s entre consultas) confirma.
    const p25b = await novoPedido(conta25);
    modo({ falharCanario: 500 });
    const pg25b = await pagar({ codigo: codigoDe(p25b.pagamento.checkoutUrl), metodo: "pix" });
    confere(pg25b.aviso?.status === 400 && pg25b.aviso.corpo?.resultado === "transitorio", "canário com 500 no aviso → 400 transitorio", pg25b.aviso);
    modo({});
    const [c25b] = await cobrancas(p25b.pedido.id);
    confere((await statusPedido(p25b.pedido.id)) === "PENDENTE" && c25b.status_gateway !== "pago", "continua PENDENTE", c25b.status_gateway);
    const repete25b = await avisar(falsa.links.get(codigoDe(p25b.pagamento.checkoutUrl)).webhook_url, pg25b.corpoAviso);
    confere(repete25b.status === 200 && (await statusPedido(p25b.pedido.id)) === "PAGO", "a repetição colada confirma (a vez foi devolvida)", repete25b.status);

    console.log("26. Aviso forjado (a cliente conhece o token): confere antes de gravar, não troca o candidato verdadeiro, NAO_PAGO que expira");
    const conta26 = await novaConta("e");
    const pagoPorFora = async (c) => {
      const pedido = await novoPedido(c);
      return { pedido, pg: await pagar({ codigo: codigoDe(pedido.pagamento.checkoutUrl), metodo: "pix", aviso: false }) };
    };
    const alerta = async (pedidoId) => (await admin.req("GET", `/api/admin/orders/${pedidoId}`)).json?.pedido?.pagamento?.alerta ?? null;

    // a) Transação de OUTRO link de mesmo valor no aviso: não confirma, fica guardada (lugar livre) e
    //    marcada "não pago"; o aviso de verdade confirma depois, mesmo com o forjado guardado.
    const alvo26 = await novoPedido(conta26);
    const { pg: pgOutro26 } = await pagoPorFora(conta26);
    const linkAlvo26 = falsa.links.get(codigoDe(alvo26.pagamento.checkoutUrl));
    const consultas26 = falsa.chamadas.payment_check;
    const forjado26 = await avisar(linkAlvo26.webhook_url, { transaction_nsu: pgOutro26.transaction_nsu, invoice_slug: pgOutro26.slug, order_nsu: linkAlvo26.order_nsu });
    confere(
      forjado26.status === 400 && (await forjado26.json()).resultado === "pendente" && (await statusPedido(alvo26.pedido.id)) === "PENDENTE",
      "aviso forjado com a transação de outro link de mesmo valor: não confirma (400 pendente)",
      forjado26.status,
    );
    confere(falsa.chamadas.payment_check === consultas26 + 1, "o forjado que dá \"não pago\" faz uma consulta só (sem canário)");
    const [cf26] = await cobrancas(alvo26.pedido.id);
    confere(cf26.aviso_transacao_nsu === pgOutro26.transaction_nsu && cf26.status_gateway === "nao-pago", "o forjado fica guardado e marcado nao-pago (o lugar estava livre)", cf26);
    confere((await alerta(alvo26.pedido.id)) === null, "painel: nenhum alerta");
    await esperar(3_100); // o aviso forjado reservou a vez desta cobrança por 3 s
    const pgAlvo26 = await pagar({ codigo: linkAlvo26.codigo, metodo: "pix" });
    const [cv26] = await cobrancas(alvo26.pedido.id);
    confere(
      pgAlvo26.aviso?.status === 200 && pgAlvo26.aviso.corpo?.resultado === "aprovado" && (await statusPedido(alvo26.pedido.id)) === "PAGO" && cv26.transacao_nsu === pgAlvo26.transaction_nsu && cv26.aviso_transacao_nsu === null,
      "o aviso de verdade aprova sem precisar gravar, e limpa o forjado",
      cv26,
    );

    // b) Candidato verdadeiro guardado (InfinitePay fora no aviso): nem um forjado "não pago" nem um
    //    "inválido" o sobrescrevem ou apagam, e a marca do verdadeiro não é pisada.
    const verd = await novoPedido(conta26);
    const { pg: pgOutro26b } = await pagoPorFora(conta26);
    modo({ falharConferencia: 500 });
    const pgVerd = await pagar({ codigo: codigoDe(verd.pagamento.checkoutUrl), metodo: "pix" });
    modo({});
    confere(pgVerd.aviso?.status === 400, "aviso verdadeiro com a InfinitePay fora → 400", pgVerd.aviso);
    const [cb0] = await cobrancas(verd.pedido.id);
    confere(cb0.aviso_transacao_nsu === pgVerd.transaction_nsu, "o candidato verdadeiro foi guardado (conferência indecisa)");
    await esperar(3_100);
    const linkVerd = falsa.links.get(codigoDe(verd.pagamento.checkoutUrl));
    const forjadoB = await avisar(linkVerd.webhook_url, { transaction_nsu: pgOutro26b.transaction_nsu, invoice_slug: pgOutro26b.slug, order_nsu: linkVerd.order_nsu });
    const [cb1] = await cobrancas(verd.pedido.id);
    confere(
      forjadoB.status === 400 && cb1.aviso_transacao_nsu === pgVerd.transaction_nsu && cb1.status_gateway !== "nao-pago",
      "forjado \"não pago\" NÃO sobrescreve o candidato verdadeiro nem grava marca",
      { aviso: cb1.aviso_transacao_nsu === pgVerd.transaction_nsu, marca: cb1.status_gateway },
    );
    await esperar(3_100);
    const inexistente = await avisar(linkVerd.webhook_url, { transaction_nsu: "00000000-0000-4000-8000-000000000001", invoice_slug: "fat_forjada_x", order_nsu: linkVerd.order_nsu });
    const [cb2] = await cobrancas(verd.pedido.id);
    confere(
      inexistente.status === 200 && (await inexistente.json()).resultado === "invalido" && cb2.aviso_transacao_nsu === pgVerd.transaction_nsu && cb2.status_gateway !== "invalido",
      "forjado com transação inexistente (inválido) NÃO apaga o candidato verdadeiro nem grava marca",
      { aviso: cb2.aviso_transacao_nsu === pgVerd.transaction_nsu, marca: cb2.status_gateway },
    );
    await esperar(3_100);
    const verdadeiro = await avisar(linkVerd.webhook_url, pgVerd.corpoAviso);
    confere(verdadeiro.status === 200 && (await statusPedido(verd.pedido.id)) === "PAGO", "o aviso verdadeiro repetido confirma", verdadeiro.status);

    // c) "Não pago" que expira: o forjado guardado passa de 30 min e a tela o descarta (sem alerta enquanto
    //    a última marca é "nao-pago"), e o pedido volta a PAGAR.
    const exp26 = await novoPedido(conta26);
    const { pg: pgOutro26c } = await pagoPorFora(conta26);
    const linkExp26 = falsa.links.get(codigoDe(exp26.pagamento.checkoutUrl));
    await avisar(linkExp26.webhook_url, { transaction_nsu: pgOutro26c.transaction_nsu, invoice_slug: pgOutro26c.slug, order_nsu: linkExp26.order_nsu });
    const [ce0] = await cobrancas(exp26.pedido.id);
    confere(ce0.aviso_transacao_nsu === pgOutro26c.transaction_nsu && ce0.status_gateway === "nao-pago", "forjado guardado e marcado nao-pago", ce0);
    const sExp26a = await conta26.req("GET", `/api/orders/${exp26.pedido.id}/pagamento`);
    confere(sExp26a.json?.etapa === "CONFIRMANDO", "dentro da janela, a tela mostra CONFIRMANDO", sExp26a.json?.etapa);
    await sql("update pagamentos set avisado_em = now() - interval '40 minutes', consultado_em = null where order_id = $1", [exp26.pedido.id]);
    confere((await alerta(exp26.pedido.id)) === null, "painel: sem AVISO_NAO_CONFERIDO enquanto a última marca é nao-pago");
    const sExp26b = await conta26.req("GET", `/api/orders/${exp26.pedido.id}/pagamento`);
    const [ce1] = await cobrancas(exp26.pedido.id);
    confere(
      ce1.aviso_transacao_nsu === null && ce1.status_gateway === "nao-pago" && sExp26b.json?.etapa === "PAGAR" && (await statusPedido(exp26.pedido.id)) === "PENDENTE",
      "passou da janela: o \"não pago\" é descartado e a cliente volta a PAGAR",
      { ce1, etapa: sExp26b.json?.etapa },
    );

    console.log("27. Abuso do aviso: adiado sem gravar, limite por cobrança e por IP");
    const conta27 = await novaConta("f");
    // a) Conferida há menos de 3 s: o segundo aviso recebe 400 "adiado" ANTES de qualquer escrita.
    const ped27 = await novoPedido(conta27);
    const linkPed27 = falsa.links.get(codigoDe(ped27.pagamento.checkoutUrl));
    const alheia = async () => {
      const o = await novoPedido(conta27);
      return pagar({ codigo: codigoDe(o.pagamento.checkoutUrl), metodo: "pix", aviso: false });
    };
    const alheiaA = await alheia();
    const alheiaB = await alheia();
    const um = await avisar(linkPed27.webhook_url, { transaction_nsu: alheiaA.transaction_nsu, invoice_slug: alheiaA.slug, order_nsu: linkPed27.order_nsu });
    const dois = await avisar(linkPed27.webhook_url, { transaction_nsu: alheiaB.transaction_nsu, invoice_slug: alheiaB.slug, order_nsu: linkPed27.order_nsu });
    const [c27] = await cobrancas(ped27.pedido.id);
    confere(
      um.status === 400 && dois.status === 400 && (await dois.json()).resultado === "adiado" && c27.aviso_transacao_nsu === alheiaA.transaction_nsu,
      "segundo aviso em menos de 3 s: 400 adiado, sem gravar (o primeiro candidato continua)",
      { um: um.status, dois: dois.status },
    );
    // b) Limite por cobrança: 30 avisos a cada 10 min; os seguintes recebem 400 "limite" sem tocar no banco.
    const ped27b = await novoPedido(conta27);
    const urlB = falsa.links.get(codigoDe(ped27b.pagamento.checkoutUrl)).webhook_url;
    const respostas = [];
    for (let i = 0; i < 33; i++) {
      const r = await avisar(urlB, {});
      respostas.push({ status: r.status, resultado: (await r.json()).resultado });
    }
    confere(
      respostas.slice(0, 30).every((r) => r.status === 200 && r.resultado === "sem-candidato") && respostas.slice(30).every((r) => r.status === 400 && r.resultado === "limite"),
      "limite por cobrança: 30 passam, do 31º em diante 400 limite",
      respostas.map((r) => r.status).join(","),
    );
    // c) Limite por IP (o site recebe o IP pelo cabeçalho confiável): 120 por minuto, depois 429.
    const ipUnico = `10.99.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
    const tokenRuim = "A".repeat(43);
    const codigos = [];
    for (let i = 0; i < 125; i++) {
      const r = await fetch(`${BASE}/api/webhooks/infinitepay/ped-naoexiste-1/${tokenRuim}`, { method: "POST", headers: { "X-Forwarded-For": ipUnico }, body: "{}" });
      codigos.push(r.status);
    }
    confere(
      codigos.slice(0, 120).every((c) => c === 401) && codigos.slice(120).every((c) => c === 429),
      "limite por IP: 120 por minuto (401 do token), depois 429",
      { primeiros: [...new Set(codigos.slice(0, 120))], ultimos: codigos.slice(120) },
    );
    const outroIp = await fetch(`${BASE}/api/webhooks/infinitepay/ped-naoexiste-1/${tokenRuim}`, { method: "POST", headers: { "X-Forwarded-For": "10.99.250.250" }, body: "{}" });
    confere(outroIp.status === 401, "outro IP não é afetado", outroIp.status);

    console.log("21. Token do aviso com segredo próprio");
    if (process.env.INFINITEPAY_WEBHOOK_SECRET?.trim() && process.env.INFINITEPAY_WEBHOOK_SECRET.trim() !== process.env.SESSION_SECRET) {
      const comSessao = await avisar(
        `${BASE}/api/webhooks/infinitepay/${link20.order_nsu}/${tokenCom(process.env.SESSION_SECRET, link20.order_nsu)}`,
        { transaction_nsu: "tx", invoice_slug: link20.slug },
      );
      confere(comSessao.status === 401, "token feito com o SESSION_SECRET → 401", comSessao.status);
      confere(link20.webhook_url.endsWith(`/${tokenAviso(link20.order_nsu)}`), "o link leva o token do INFINITEPAY_WEBHOOK_SECRET");
    } else {
      console.log("  (pulado: rode com INFINITEPAY_WEBHOOK_SECRET diferente do SESSION_SECRET)");
    }

    console.log("22. Encomenda de lembrancinhas: CHECKs, aprovação no painel, entrada e restante pelo checkout, devolução");
    // A encomenda nasce direto no banco como SOLICITADA (a solicitação pelo site fica fechada sem
    // CNPJ/CPF e e-mail da loja, D13); o resto passa pelo painel e pelo checkout falso.
    const mesAgora = (await sql("select to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM') m"))[0].m;
    const finAntes = (await admin.req("GET", `/api/admin/financial-stats?mes=${mesAgora}`)).json;
    const despAntes = (await admin.req("GET", `/api/admin/expenses?mes=${mesAgora}`)).json;
    // Cria a encomenda direto no banco (o POST do site fica fechado sem CNPJ/CPF e e-mail da loja). `o`:
    // usuario (padrão: a conta "a"), entradaAte, corteEm, percentualAceito, percentualRetido e restantePagoEm.
    // CONFIRMADA em diante já nasce com a entrada paga (a CHECK exige).
    // As colunas de data são TIMESTAMP sem fuso: o pg manda um Date na hora LOCAL deste computador (−03:00) e o banco
    // guardaria 3 h a menos que o instante pedido. Por isso as datas vão como ISO em UTC (utc()).
    const utc = (d) => (d ? new Date(d).toISOString() : null);
    const novaEncomenda = async (sufixo, status, o = {}) => {
      const id = `e2e${marca}${sufixo}`;
      encomendas.push(id);
      const aprovada = status !== "SOLICITADA";
      const confirmada = ["CONFIRMADA", "EM_PRODUCAO", "PRONTA", "ENTREGUE"].includes(status);
      const aceito = o.percentualAceito ?? 100;
      await sql(
        `insert into encomendas (id, user_id, status, data_festa, data_entrega, modo_entrega, telefone, potinhos, subtotal, frete, total,
           valor_entrada, valor_restante, peso_total_gramas, responder_ate, corte_em, entrada_ate, percentual_aceito, percentual_retido,
           politica_versao, politica_aceita_em, idempotency_key, aprovada_em, entrada_paga_em, restante_pago_em, restante_forma)
         values ($1, $2, $3, current_date + 12, current_date + 10, 'RETIRADA', '86999991234', 15, 90, 0, 90,
           45, 45, 1950, now() + interval '1 day', $7, $4, $8, $9, '2026-11-v1', now(), $5, $6, $10, $11, $12)`,
        [
          id,
          o.usuario ?? contas[0],
          status,
          aprovada ? utc(o.entradaAte ?? new Date(Date.now() + 86_400_000)) : null,
          `e2e-${marca}-${sufixo}`,
          aprovada ? utc(new Date()) : null,
          utc(o.corteEm ?? new Date(Date.now() + 7 * 86_400_000)),
          aceito,
          o.percentualRetido ?? aceito,
          confirmada ? utc(new Date()) : null,
          utc(o.restantePagoEm),
          o.restantePagoEm ? "PIX" : null,
        ],
      );
      await sql("insert into encomenda_itens (id, encomenda_id, product_id, quantidade, preco_unitario) values ($1, $2, $3, 15, 6)", [`${id}i`, id, produto]);
      return id;
    };
    const encId = await novaEncomenda("enc", "SOLICITADA");
    const acaoEnc = (id, corpo) => admin.req("PATCH", `/api/admin/encomendas/${id}`, { corpo });

    const violaCheck = async (rotulo, valores) => {
      try {
        await sql(
          `insert into pagamentos (id, order_id, encomenda_id, parcela, gateway, referencia_externa, valor, expira_em)
           values ($1, $2, $3, $4, 'simulado', $5, 10, now())`,
          valores,
        );
        await sql("delete from pagamentos where id = $1", [valores[0]]);
        confere(false, `CHECK recusa ${rotulo}`);
      } catch (e) {
        confere(e.code === "23514", `CHECK recusa ${rotulo}`, e.message);
      }
    };
    await violaCheck("cobrança com pedido E encomenda", [`${encId}x1`, pedidos[0], encId, "ENTRADA", `enc-${encId}-ENTRADA-9`]);
    await violaCheck("cobrança sem alvo", [`${encId}x2`, null, null, null, `x-${marca}-2`]);
    await violaCheck("encomenda sem parcela", [`${encId}x3`, null, encId, null, `enc-${encId}-ENTRADA-8`]);
    await violaCheck("referência de outra parcela", [`${encId}x4`, null, encId, "ENTRADA", `enc-${encId}-RESTANTE-7`]);

    const aResponder = await admin.req("GET", "/api/admin/encomendas?visao=responder");
    confere(aResponder.json?.encomendas?.some((e) => e.id === encId) && aResponder.json.contagens.responder >= 1, "painel: aba Responder lista a solicitação", aResponder.json?.contagens);
    const cliente403 = await a.req("GET", "/api/admin/encomendas");
    confere(cliente403.status === 403 || cliente403.status === 401, "cliente não acessa a API do painel", cliente403.status);
    const aprovaErrado = await acaoEnc(encId, { acao: "aprovar", statusEsperado: "AGUARDANDO_ENTRADA" });
    confere(aprovaErrado.status === 409 && aprovaErrado.json?.detalhes?.motivo === "status-mudou", "aprovar com statusEsperado errado → 409 status-mudou", aprovaErrado.json);
    const aprova = await acaoEnc(encId, { acao: "aprovar", statusEsperado: "SOLICITADA" });
    confere(
      aprova.status === 200 && aprova.json?.encomenda?.statusEfetivo === "AGUARDANDO_ENTRADA" && aprova.json.encomenda.prazos.entradaAte !== null,
      "aprovar → AGUARDANDO_ENTRADA com prazo da entrada",
      aprova.json?.encomenda?.statusEfetivo,
    );
    confere(aprova.json?.encomenda?.whatsapp?.link?.startsWith("https://wa.me/5586999991234?text="), "ficha: link do WhatsApp com o texto da aprovação");

    const cedo = await a.req("POST", `/api/encomendas/${encId}/pagamento`, { corpo: { parcela: "RESTANTE" } });
    confere(cedo.status === 409, "restante antes da entrada → 409", cedo.json);
    const idorEnc = await b.req("POST", `/api/encomendas/${encId}/pagamento`, { corpo: { parcela: "ENTRADA" } });
    confere(idorEnc.status === 404, "encomenda de outra conta → 404", idorEnc.status);
    const e1 = await a.req("POST", `/api/encomendas/${encId}/pagamento`, { corpo: { parcela: "ENTRADA" } });
    confere(e1.status === 200 && e1.json?.cobranca?.checkoutUrl?.startsWith(falsa.origem) && e1.json.cobranca.valor === 45, "entrada abre o link", e1.json);
    const linkE1 = falsa.links.get(codigoDe(e1.json.cobranca.checkoutUrl));
    confere(
      linkE1.order_nsu === `enc-${encId}-ENTRADA-1` && linkE1.amount === 4500 && linkE1.webhook_url.startsWith(`${BASE}/api/webhooks/infinitepay/enc-${encId}-ENTRADA-1/`),
      "link da entrada: order_nsu, valor e aviso da parcela",
      linkE1,
    );
    // Link vencendo: abre outro (o primeiro vira CANCELADO no banco, mas ainda vale na InfinitePay).
    await sql("update pagamentos set expira_em = now() + interval '2 minutes' where encomenda_id = $1", [encId]);
    const e2 = await a.req("POST", `/api/encomendas/${encId}/pagamento`, { corpo: { parcela: "ENTRADA" } });
    confere(e2.status === 200 && e2.json?.cobranca?.checkoutUrl !== e1.json.cobranca.checkoutUrl, "link vencendo dá lugar a enc-<id>-ENTRADA-2", e2.json);
    const pgE1 = await pagar({ codigo: linkE1.codigo, metodo: "pix" });
    confere(pgE1.aviso?.status === 200 && pgE1.aviso.corpo?.resultado === "aprovado", "aviso da entrada → 200 aprovado", pgE1.aviso);
    const [enc1] = await sql("select status, entrada_paga_em, restante_pago_em from encomendas where id = $1", [encId]);
    confere(enc1.status === "CONFIRMADA" && enc1.entrada_paga_em !== null && enc1.restante_pago_em === null, "entrada paga: CONFIRMADA (o restante não)", enc1);
    const sE = await a.req("GET", `/api/encomendas/${encId}/pagamento?parcela=ENTRADA`);
    confere(sE.json?.etapa === "PAGO" && sE.json.entradaPaga === true && sE.json.restantePaga === false, "situação da entrada: PAGO", sE.json);
    const sR = await a.req("GET", `/api/encomendas/${encId}/pagamento?parcela=RESTANTE`);
    confere(sR.json?.etapa === "PAGAR" && sR.json.cobranca === null, "situação do restante: PAGAR", sR.json);
    // O segundo link da entrada também é pago: não há o que quitar → devolução pendente.
    const pgE2 = await pagar({ codigo: codigoDe(e2.json.cobranca.checkoutUrl), metodo: "pix" });
    const devs = await sql("select motivo, valor::text, status, pagamento_id from encomenda_devolucoes where encomenda_id = $1", [encId]);
    confere(
      pgE2.aviso?.corpo?.resultado === "aprovado" && devs.length === 1 && devs[0].motivo === "PAGAMENTO_DUPLICADO" && devs[0].valor === "45.00" && devs[0].status === "PENDENTE",
      "entrada paga em dobro: devolução PAGAMENTO_DUPLICADO pendente",
      devs,
    );
    const abaDevolucoes = await admin.req("GET", "/api/admin/encomendas?visao=devolucoes");
    const naAba = abaDevolucoes.json?.encomendas?.find((e) => e.id === encId);
    confere(naAba?.alerta === "DEVOLUCAO_PENDENTE" && naAba.devolucao.pendente === 45, "painel: aba Devoluções com o alerta", naAba);
    // A mesma transação da entrada apresentada ao link do restante não quita o restante.
    const r1 = await a.req("POST", `/api/encomendas/${encId}/pagamento`, { corpo: { parcela: "RESTANTE" } });
    const linkR1 = falsa.links.get(codigoDe(r1.json.cobranca.checkoutUrl));
    confere(r1.status === 200 && linkR1.order_nsu === `enc-${encId}-RESTANTE-1` && linkR1.amount === 4500, "restante abre o link da parcela", linkR1);
    const reusoEnc = await avisar(linkR1.webhook_url, { ...pgE1.corpoAviso, order_nsu: linkR1.order_nsu, invoice_slug: linkR1.slug });
    const reusoEncJson = await reusoEnc.json();
    const [enc2] = await sql("select restante_pago_em from encomendas where id = $1", [encId]);
    confere(reusoEnc.status === 200 && reusoEncJson.resultado === "invalido" && enc2.restante_pago_em === null, "transação da entrada no aviso do restante → invalido", reusoEncJson);
    await esperar(3_100);
    const pgR = await pagar({ codigo: linkR1.codigo, metodo: "credit_card", parcelas: 2 });
    const [enc3] = await sql("select restante_pago_em, restante_forma from encomendas where id = $1", [encId]);
    confere(pgR.aviso?.corpo?.resultado === "aprovado" && enc3.restante_pago_em !== null && enc3.restante_forma === "CARTAO_CREDITO", "restante pago no cartão: quitada", enc3);
    const retEnc = await a.req("GET", `/pagamento/retorno${new URL(pgR.retorno).search}`);
    confere(retEnc.status === 303 && retEnc.local === `${BASE}/minhas-encomendas/${encId}?retorno=1`, "retorno da encomenda → /minhas-encomendas/<id>?retorno=1", retEnc);
    const retOutra = await b.req("GET", `/pagamento/retorno${new URL(pgR.retorno).search}`);
    confere(retOutra.status === 303 && retOutra.local === `${BASE}/minhas-encomendas`, "retorno da encomenda por outra conta → /minhas-encomendas", retOutra);

    // Produção, pronta e entregue pelo painel; a devolução marcada como feita.
    const prod = await acaoEnc(encId, { acao: "iniciar-producao", statusEsperado: "CONFIRMADA" });
    const pronta = await acaoEnc(encId, { acao: "marcar-pronta", statusEsperado: "EM_PRODUCAO" });
    const entregue = await acaoEnc(encId, { acao: "marcar-entregue", statusEsperado: "PRONTA" });
    confere(
      prod.status === 200 && pronta.status === 200 && entregue.status === 200 && entregue.json?.encomenda?.statusEfetivo === "ENTREGUE",
      "painel: produção → pronta → entregue",
      [prod.status, pronta.status, entregue.json?.encomenda?.statusEfetivo ?? entregue.json],
    );
    // O que a tela mostra: as devoluções pendentes da ficha, por id.
    const fichaDev = (await admin.req("GET", `/api/admin/encomendas/${encId}`)).json?.encomenda;
    const idsPendentes = (fichaDev?.devolucoes ?? []).filter((d) => d.status === "PENDENTE").map((d) => d.id);
    const semIds = await acaoEnc(encId, { acao: "devolucao-feita", statusEsperado: "ENTREGUE", observacao: "sem ids" });
    confere(semIds.status === 400 && idsPendentes.length === 1, "devolução feita sem os ids → 400", semIds.json);
    const devolvida = await acaoEnc(encId, { acao: "devolucao-feita", statusEsperado: "ENTREGUE", devolucaoIds: idsPendentes, observacao: "Devolvido pelo app (e2e)." });
    confere(devolvida.status === 200 && devolvida.json?.encomenda?.devolucao?.status === "FEITA" && devolvida.json.encomenda.alerta === null, "devolução marcada como feita", devolvida.json?.encomenda?.devolucao);
    const deNovo = await acaoEnc(encId, { acao: "devolucao-feita", statusEsperado: "ENTREGUE", devolucaoIds: idsPendentes });
    confere(deNovo.status === 409 && deNovo.json?.detalhes?.motivo === "devolucao-mudou", "devolução que já não está pendente → 409 devolucao-mudou", deNovo.json);

    // Segunda encomenda: entrada paga, restante fora do site, cancelada pela loja com devolução.
    const enc2Id = await novaEncomenda("enc2", "AGUARDANDO_ENTRADA");
    const e21 = await a.req("POST", `/api/encomendas/${enc2Id}/pagamento`, { corpo: { parcela: "ENTRADA" } });
    const pg21 = await pagar({ codigo: codigoDe(e21.json.cobranca.checkoutUrl), metodo: "pix" });
    confere(pg21.aviso?.corpo?.resultado === "aprovado", "encomenda 2: entrada paga", pg21.aviso);
    const fora = await acaoEnc(enc2Id, { acao: "registrar-restante", statusEsperado: "CONFIRMADA", formaPagamento: "DINHEIRO", observacao: "Na retirada (e2e)." });
    confere(
      fora.status === 200 && fora.json?.encomenda?.restanteForaDoSite === true && fora.json.encomenda.restanteForma === "DINHEIRO",
      "restante registrado fora do site",
      fora.json?.encomenda?.restanteForma ?? fora.json,
    );
    const pouco = await acaoEnc(enc2Id, { acao: "cancelar", statusEsperado: "CONFIRMADA", motivo: "Teste e2e de cancelamento", devolverCentavos: 100 });
    confere(pouco.status === 400 && pouco.json?.detalhes?.minimoCentavos === 9000, "cancelar devolvendo menos que o pago → 400", pouco.json);
    const cancela2 = await acaoEnc(enc2Id, { acao: "cancelar", statusEsperado: "CONFIRMADA", motivo: "Teste e2e de cancelamento", devolverCentavos: 9000 });
    confere(
      cancela2.status === 200 && cancela2.json?.encomenda?.statusEfetivo === "CANCELADA" && cancela2.json.encomenda.devolucao.pendente === 90 && /InfinitePay/.test(cancela2.json.aviso ?? ""),
      "cancelada pela loja: devolução de 90 pendente e aviso",
      cancela2.json,
    );

    // Configuração: abrir sem CNPJ/CPF e e-mail da loja é recusado (D13).
    const cfg = await admin.req("GET", "/api/admin/lembrancinhas");
    const abrir = await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: { ativo: true } });
    confere(cfg.status === 200 && Array.isArray(cfg.json?.config?.pendenciasLegais), "GET da configuração", cfg.json?.config);
    confere(
      cfg.json.config.pendenciasLegais.length === 0 ? abrir.status === 200 : abrir.status === 409 && abrir.json?.detalhes?.pendenciasLegais?.length > 0,
      "ativar sem os dados legais → 409 (D13)",
      abrir.json,
    );
    if (abrir.status === 200) await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: { ativo: cfg.json.config.ativo } });

    // Financeiro e Despesas: o que estas duas encomendas acrescentaram ao mês.
    const finDepois = (await admin.req("GET", `/api/admin/financial-stats?mes=${mesAgora}`)).json;
    const despDepois = (await admin.req("GET", `/api/admin/expenses?mes=${mesAgora}`)).json;
    const delta = (k) => Math.round((finDepois.entradas.lembrancinhas[k] - finAntes.entradas.lembrancinhas[k]) * 100) / 100;
    confere(
      delta("sinais") === 135 && delta("restantes") === 45 && delta("restantesForaDoSite") === 45 && delta("devolucoes") === 45 && delta("liquido") === 180,
      "Financeiro: sinais 135, restantes 45 + 45 fora do site, devolução feita 45, líquido 180",
      finDepois.entradas.lembrancinhas,
    );
    confere(Math.round((finDepois.resumo.entradas - finAntes.resumo.entradas) * 100) / 100 === 180 && finDepois.resumo.vendas === finAntes.resumo.vendas, "resumo soma o líquido; vendas só com os pedidos");
    const potes = (f) => f.entradas.lembrancinhas.potinhosEntregues.find((l) => l.productId === produto)?.potinhos ?? 0;
    confere(potes(finDepois) - potes(finAntes) === 15, "potinhos entregues por sabor");
    confere(finDepois.movimentacoes.some((m) => m.tipo === "devolucao"), "movimentações com a devolução");
    confere(
      Math.round((despDepois.entradas - despAntes.entradas) * 100) / 100 === 180 && Math.round((despDepois.lembrancinhas - despAntes.lembrancinhas) * 100) / 100 === 180,
      "Despesas: entradas com o mesmo líquido",
      [despAntes.entradas, despDepois.entradas, despDepois.lembrancinhas],
    );

    console.log("23. Encomenda criada pelo site (POST /api/encomendas) com o recurso aberto por instantes");
    const meA = await a.req("GET", "/api/auth/me");
    const meB = await b.req("GET", "/api/auth/me");
    confere(meA.json?.temEncomendas === true && meB.json?.temEncomendas === false, "GET /api/auth/me: temEncomendas", [meA.json?.temEncomendas, meB.json?.temEncomendas]);
    if (process.env.E2E_DADOS_LEGAIS !== "1") {
      console.log("  (pulado: rode o site e este script com E2E_DADOS_LEGAIS=1; sem isso o D13 fecha a solicitação)");
    } else {
      const cfgAntes = (await admin.req("GET", "/api/admin/lembrancinhas")).json.config;
      const [{ disponivel_em_mini: miniAntes }] = await sql("select disponivel_em_mini from products where id = $1", [produto]);
      try {
        const abre = await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: { ativo: true } });
        confere(abre.status === 200 && abre.json?.config?.ativo === true, "painel abre as lembrancinhas", abre.json);
        await sql("update products set disponivel_em_mini = true where id = $1", [produto]);
        const [{ festa, entrega }] = await sql(
          `select to_char((now() at time zone 'America/Fortaleza')::date + 12, 'YYYY-MM-DD') festa,
                  to_char((now() at time zone 'America/Fortaleza')::date + 10, 'YYYY-MM-DD') entrega`,
        );
        const corpo = {
          itens: [{ productId: produto, quantidade: 15 }],
          dataFesta: festa,
          dataEntrega: entrega,
          modoEntrega: "RETIRADA",
          telefone: "(86) 99999-1234",
          aceitePolitica: true,
          politicaVersao: "2026-11-v1",
          percentualRetido: cfgAntes.percentualRetido,
          totalEsperadoCentavos: 15 * cfgAntes.precoPotinhoCentavos,
        };
        const chave = `e2e-${marca}-criar`;
        const cria = (c, extra = {}, k = chave) => a.req("POST", "/api/encomendas", { corpo: { ...corpo, ...c }, cabecalhos: { "Idempotency-Key": k, ...extra } });
        const semChave = await a.req("POST", "/api/encomendas", { corpo });
        confere(semChave.status === 400, "sem Idempotency-Key → 400", semChave.json);
        const totalErrado = await cria({ totalEsperadoCentavos: 1 }, {}, `${chave}-t`);
        confere(totalErrado.status === 409 && totalErrado.json?.detalhes?.total === (15 * cfgAntes.precoPotinhoCentavos) / 100, "total diferente → 409 com o total atual", totalErrado.json);
        const fora = await cria(
          { modoEntrega: "ENTREGA", endereco: { cep: "01310-100", rua: "Av. Paulista", numero: "1000", bairro: "Bela Vista", cidade: "São Paulo", estado: "SP" } },
          {},
          `${chave}-f`,
        );
        confere(fora.status === 422 && fora.json?.detalhes?.foraDaArea === true, "entrega fora de Teresina → 422 foraDaArea", fora.json);
        const poucos = await cria({ itens: [{ productId: produto, quantidade: 14 }] }, {}, `${chave}-p`);
        confere(poucos.status === 400 && poucos.json?.detalhes?.itens, "14 potinhos → 400 em itens", poucos.json);
        const criada = await cria({});
        const encCriada = criada.json?.encomenda;
        if (encCriada?.id) encomendas.push(encCriada.id);
        confere(
          criada.status === 201 && encCriada?.status === "SOLICITADA" && encCriada.potinhos === 15 && encCriada.total === (15 * cfgAntes.precoPotinhoCentavos) / 100 && encCriada.telefone === "86999991234",
          "POST /api/encomendas → 201 SOLICITADA, valores do servidor",
          criada.json,
        );
        const repete = await cria({});
        confere(repete.status === 200 && repete.json?.encomenda?.id === encCriada?.id, "mesma chave e mesmo conteúdo → 200, a mesma encomenda", repete.json);
        const outra = await cria({ itens: [{ productId: produto, quantidade: 16 }], totalEsperadoCentavos: 16 * cfgAntes.precoPotinhoCentavos });
        confere(outra.status === 422, "mesma chave com outro conteúdo → 422", outra.json);
        const sEnt = await a.req("GET", `/api/encomendas/${encCriada?.id}/pagamento?parcela=ENTRADA`);
        confere(sEnt.json?.etapa === "INDISPONIVEL" && sEnt.json.motivoIndisponivel === "NAO_LIBERADA", "entrada antes da aprovação: INDISPONIVEL / NAO_LIBERADA", sEnt.json);
        const lista = await a.req("GET", "/api/encomendas");
        confere(lista.json?.encomendas?.some((e) => e.id === encCriada?.id), "GET /api/encomendas lista a nova");
        const idor = await b.req("GET", `/api/encomendas/${encCriada?.id}`);
        confere(idor.status === 404, "outra conta → 404", idor.status);
      } finally {
        await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: { ativo: cfgAntes.ativo } });
        await sql("update products set disponivel_em_mini = $2 where id = $1", [produto, miniAntes]);
      }
    }

    // --- Correções das revisões (casos 25 em diante): canário nas encomendas, conferência que não prende, folga do prazo,
    // --- devolução por id, idempotência completa, percentual aceito, segurança do PATCH, virada de mês, desistência.
    const abrirLinkEnc = async (cli, id, parcela) => {
      const r = await cli.req("POST", `/api/encomendas/${id}/pagamento`, { corpo: { parcela } });
      if (r.status !== 200) throw new Error(`link ${parcela} de ${id}: ${r.status} ${JSON.stringify(r.json)}`);
      return falsa.links.get(codigoDe(r.json.cobranca.checkoutUrl));
    };
    const cobrancasEnc = (id) => sql("select * from pagamentos where encomenda_id = $1 order by criado_em, id", [id]);
    const linhaEnc = async (id) => (await sql("select * from encomendas where id = $1", [id]))[0];
    const devolucoesEnc = (id) => sql("select id, motivo, valor::text, status from encomenda_devolucoes where encomenda_id = $1 order by criada_em, id", [id]);
    const semMarcaEnc = (c) => c.status === "PENDENTE" && c.status_gateway === "aberto" && c.transacao_nsu === null && c.aviso_transacao_nsu === null;
    const liberarVez = (id) => sql("update pagamentos set consultado_em = null where encomenda_id = $1", [id]);
    const dtoEnc = async (cli, id) => (await cli.req("GET", `/api/encomendas/${id}`)).json?.encomenda;
    const fichaEnc = async (id) => (await admin.req("GET", `/api/admin/encomendas/${id}`)).json?.encomenda;
    const idDaConta = () => contas[contas.length - 1];

    console.log("34. O canário de amarração vale também para a parcela de encomenda (entrada e restante)");
    const conta34 = await novaConta("enc-d");
    const uid34 = idDaConta();
    // a) API hipotética que NÃO amarra: a transação do link de OUTRA encomenda, de mesmo valor, apresentada no retorno.
    modo({ naoAmarraPedido: true });
    const alvo34 = await novaEncomenda("a34", "AGUARDANDO_ENTRADA", { usuario: uid34 });
    const outro34 = await novaEncomenda("o34", "AGUARDANDO_ENTRADA", { usuario: uid34 });
    const linkAlvo34 = await abrirLinkEnc(conta34, alvo34, "ENTRADA");
    const linkOutro34 = await abrirLinkEnc(conta34, outro34, "ENTRADA");
    const pgOutro34 = await pagar({ codigo: linkOutro34.codigo, metodo: "pix", aviso: false });
    const antes34 = falsa.chamadas.payment_check;
    const q34 = new URLSearchParams({ order_nsu: linkAlvo34.order_nsu, transaction_nsu: pgOutro34.transaction_nsu, slug: pgOutro34.slug });
    const r34 = await conta34.req("GET", `/pagamento/retorno?${q34}`);
    const [cAlvo34] = await cobrancasEnc(alvo34);
    confere(
      r34.status === 303 && r34.local === `${BASE}/minhas-encomendas/${alvo34}?retorno=1` && (await linhaEnc(alvo34)).status === "AGUARDANDO_ENTRADA" &&
        falsa.chamadas.payment_check === antes34 + 2 && semMarcaEnc(cAlvo34) && (await devolucoesEnc(alvo34)).length === 0,
      "encomenda, API que não amarra: o canário barra o retorno da ENTRADA (duas consultas, nada gravado)",
      { cAlvo34, consultas: falsa.chamadas.payment_check - antes34 },
    );
    await conta34.req("GET", `/pagamento/retorno${new URL(pgOutro34.retorno).search}`);
    confere((await linhaEnc(outro34)).status === "AGUARDANDO_ENTRADA", "encomenda, API que não amarra: nem a compra de verdade confirma pelo retorno (fail-closed)");
    await liberarVez(outro34);
    const avisoOutro34 = await avisar(linkOutro34.webhook_url, pgOutro34.corpoAviso);
    // O canário vale em toda origem (endurecimento do aviso): com a API que não amarra, nem o aviso confirma; marca divergência para a dona conferir.
    const [cOutro34] = await cobrancasEnc(outro34);
    confere(avisoOutro34.status === 200 && (await linhaEnc(outro34)).status === "AGUARDANDO_ENTRADA" && cOutro34.status_gateway === "divergente:nao-amarra", "API que não amarra: o aviso também não confirma a encomenda; grava divergente:nao-amarra", [avisoOutro34.status, cOutro34.status_gateway]);
    modo({});
    // b) Canário com falha (500): não confirma pelo retorno, só retorno_em; depois confirma.
    const enc25b = await novaEncomenda("b34", "AGUARDANDO_ENTRADA", { usuario: uid34 });
    const linkB34 = await abrirLinkEnc(conta34, enc25b, "ENTRADA");
    const pgB34 = await pagar({ codigo: linkB34.codigo, metodo: "pix", aviso: false });
    modo({ falharCanario: 500 });
    await conta34.req("GET", `/pagamento/retorno${new URL(pgB34.retorno).search}`);
    modo({});
    const [cB34] = await cobrancasEnc(enc25b);
    confere(
      (await linhaEnc(enc25b)).status === "AGUARDANDO_ENTRADA" && cB34.status_gateway === "aberto" && cB34.transacao_nsu === null && cB34.retorno_em !== null,
      "encomenda, canário com falha: a entrada não confirma, só retorno_em",
      cB34,
    );
    await liberarVez(enc25b);
    await conta34.req("GET", `/pagamento/retorno${new URL(pgB34.retorno).search}`);
    confere((await linhaEnc(enc25b)).status === "CONFIRMADA", "encomenda, canário de volta: o retorno confirma a entrada");
    // c) O mesmo no RESTANTE: barrado com a API que não amarra, e confirmado quando ela amarra.
    modo({ naoAmarraPedido: true });
    const alvoR34 = await novaEncomenda("r34", "CONFIRMADA", { usuario: uid34 });
    const outroR34 = await novaEncomenda("s34", "CONFIRMADA", { usuario: uid34 });
    const linkAlvoR34 = await abrirLinkEnc(conta34, alvoR34, "RESTANTE");
    const linkOutroR34 = await abrirLinkEnc(conta34, outroR34, "RESTANTE");
    const pgOutroR34 = await pagar({ codigo: linkOutroR34.codigo, metodo: "pix", aviso: false });
    const qR34 = new URLSearchParams({ order_nsu: linkAlvoR34.order_nsu, transaction_nsu: pgOutroR34.transaction_nsu, slug: pgOutroR34.slug });
    await conta34.req("GET", `/pagamento/retorno?${qR34}`);
    const [cAlvoR34] = await cobrancasEnc(alvoR34);
    confere((await linhaEnc(alvoR34)).restante_pago_em === null && semMarcaEnc(cAlvoR34), "encomenda, API que não amarra: o retorno do RESTANTE também é barrado", cAlvoR34);
    modo({});
    const pgR34 = await pagar({ codigo: linkAlvoR34.codigo, metodo: "pix", aviso: false });
    await liberarVez(alvoR34);
    await conta34.req("GET", `/pagamento/retorno${new URL(pgR34.retorno).search}`);
    const linhaR34 = await linhaEnc(alvoR34);
    confere(linhaR34.restante_pago_em !== null && linhaR34.restante_forma === "PIX", "encomenda, API que amarra: o retorno quita o restante", linhaR34);

    console.log("35. Conferência que não prende: no máximo 24 h, e a dona tem saída (cancelar; registrar a entrada)");
    const conta35 = await novaConta("enc-e");
    const uid35 = idDaConta();
    // Encomenda aguardando a entrada, com o link aberto e um aviso que a InfinitePay "não consegue conferir" (chave recusada).
    const emConferencia = async (sufixo) => {
      const id = await novaEncomenda(sufixo, "AGUARDANDO_ENTRADA", { usuario: uid35, entradaAte: new Date(Date.now() + 3 * 3_600_000) });
      const link = await abrirLinkEnc(conta35, id, "ENTRADA");
      modo({ falharConferencia: 401 });
      const pg = await pagar({ codigo: link.codigo, metodo: "pix" });
      return { id, link, pg };
    };
    // a) O aviso recente segura; com mais de 24 h depois do vencimento do link, a encomenda expira; o pagamento que
    //    ainda aparecer depois vira devolução (pagamento tardio) e a cliente a vê na encomenda.
    const c26a = await emConferencia("a35");
    confere(c26a.pg.aviso?.status === 400, "aviso sem desfecho (chave recusada) → 400", c26a.pg.aviso);
    await sql("update encomendas set entrada_ate = now() - interval '2 hours' where id = $1", [c26a.id]);
    await sql("update pagamentos set expira_em = now() - interval '2 hours' where encomenda_id = $1", [c26a.id]);
    const seg35 = await dtoEnc(conta35, c26a.id);
    confere(
      seg35?.statusEfetivo === "AGUARDANDO_ENTRADA" && seg35.pagamentoEmConferencia?.entrada === true && seg35.acoes.pagarEntrada === false &&
        seg35.acoes.desistirBloqueado === true && seg35.entradaEmFolga === false,
      "aviso recente: continua aguardando (não expira), sem 'Pagar' e com a desistência bloqueada",
      seg35,
    );
    const sit35 = await conta35.req("GET", `/api/encomendas/${c26a.id}/pagamento?parcela=ENTRADA`);
    confere(sit35.json?.etapa === "CONFIRMANDO" && sit35.json.pagamentoEmConferencia === true, "situação da parcela: CONFIRMANDO e pagamentoEmConferencia", sit35.json);
    const desiste35 = await conta35.req("POST", `/api/encomendas/${c26a.id}/desistir`, { corpo: { devolucaoEsperadaCentavos: 0 } });
    confere(desiste35.status === 409 && /conferido/.test(desiste35.json?.erro ?? ""), "desistir com pagamento em conferência → 409", desiste35.json);
    const novoLink35 = await conta35.req("POST", `/api/encomendas/${c26a.id}/pagamento`, { corpo: { parcela: "ENTRADA" } });
    confere(novoLink35.status === 409, "não abre link novo com o aviso em conferência", novoLink35.json);
    await sql("update pagamentos set expira_em = now() - interval '25 hours' where encomenda_id = $1", [c26a.id]);
    await sql("update encomendas set entrada_ate = now() - interval '25 hours' where id = $1", [c26a.id]);
    const solta35 = await dtoEnc(conta35, c26a.id);
    confere(
      solta35?.statusEfetivo === "EXPIRADA" && (await linhaEnc(c26a.id)).status === "EXPIRADA" && solta35.pagamentoEmConferencia.entrada === false,
      "mais de 24 h depois do vencimento do link: não segura mais, a encomenda expira",
      solta35,
    );
    // Avisos NOVOS (forjados) não renovam a contagem: ela parte do vencimento do link.
    const forjado35 = await avisar(c26a.link.webhook_url, { transaction_nsu: `forjado-${marca}`, invoice_slug: c26a.pg.slug });
    const aindaSolta35 = await dtoEnc(conta35, c26a.id);
    confere(aindaSolta35?.statusEfetivo === "EXPIRADA" && aindaSolta35.pagamentoEmConferencia.entrada === false, "aviso forjado depois das 24 h não segura de novo", [forjado35.status, aindaSolta35?.statusEfetivo]);
    modo({});
    await liberarVez(c26a.id);
    const tarde35 = await avisar(c26a.link.webhook_url, c26a.pg.corpoAviso);
    const dev35 = await devolucoesEnc(c26a.id);
    confere(
      tarde35.status === 200 && dev35.length === 1 && dev35[0].motivo === "PAGAMENTO_TARDIO" && dev35[0].valor === "45.00" && dev35[0].status === "PENDENTE",
      "o pagamento que aparece depois vira devolução PAGAMENTO_TARDIO pendente",
      [tarde35.status, dev35],
    );
    const eTarde35 = await dtoEnc(conta35, c26a.id);
    confere(
      eTarde35?.statusEfetivo === "EXPIRADA" && eTarde35.devolucao.status === "PENDENTE" && eTarde35.devolucao.pendente === 45,
      "contrato para a tela: EXPIRADA com devolução PENDENTE de 45 (a cliente lê 'recebemos seu pagamento depois do prazo')",
      eTarde35?.devolucao,
    );
    // b) A dona cancela com a conferência aberta (aviso de conferir no app); registrar a entrada espera.
    const c26c = await emConferencia("c35");
    const fichaC35 = await fichaEnc(c26c.id);
    const acCancelar = fichaC35?.acoes.find((a) => a.acao === "cancelar");
    const acRegistrar = fichaC35?.acoes.find((a) => a.acao === "registrar-entrada");
    confere(
      acRegistrar?.permitida === false && acCancelar?.permitida === true && /Confira no app InfinitePay antes de cancelar/.test(acCancelar.aviso ?? "") &&
        fichaC35.pagamentos[0]?.emConferencia === true && fichaC35.pagamentos[0].conferenciaAte !== null,
      "ficha: registrar-entrada desabilitado, cancelar permitido com o aviso, e o pagamento mostra até quando segura",
      fichaC35?.acoes,
    );
    const reg409 = await acaoEnc(c26c.id, { acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA", formaPagamento: "PIX" });
    confere(reg409.status === 409 && reg409.json?.detalhes?.motivo === "pagamento-em-conferencia" && reg409.json.detalhes.conferenciaAte, "registrar-entrada com a conferência aberta → 409 com conferenciaAte", reg409.json);
    const cancela35 = await acaoEnc(c26c.id, { acao: "cancelar", statusEsperado: "AGUARDANDO_ENTRADA", motivo: "Teste e2e: conferência aberta", devolverCentavos: 0 });
    confere(
      cancela35.status === 200 && cancela35.json?.encomenda?.statusEfetivo === "CANCELADA" && /Confira no app InfinitePay antes de cancelar/.test(cancela35.json.aviso ?? ""),
      "cancelar com a conferência aberta → 200, com o aviso de conferir no app",
      cancela35.json,
    );
    modo({});
    await liberarVez(c26c.id);
    const tardeC35 = await avisar(c26c.link.webhook_url, c26c.pg.corpoAviso);
    const devC35 = await devolucoesEnc(c26c.id);
    confere(tardeC35.status === 200 && devC35.length === 1 && devC35[0].motivo === "PAGAMENTO_TARDIO" && devC35[0].status === "PENDENTE", "o dinheiro que aparece depois do cancelamento vira devolução pendente", devC35);
    // c) Registrar a entrada fora do site (depois que a conferência deixa de segurar).
    const c26d = await emConferencia("d35");
    await sql("update pagamentos set expira_em = now() - interval '25 hours' where encomenda_id = $1", [c26d.id]);
    const finAntes35 = (await admin.req("GET", `/api/admin/financial-stats?mes=${mesAgora}`)).json;
    const reg35 = await acaoEnc(c26d.id, { acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA", formaPagamento: "DINHEIRO", observacao: "Conferi no app (e2e)." });
    const linhaD35 = await linhaEnc(c26d.id);
    confere(
      reg35.status === 200 && linhaD35.status === "CONFIRMADA" && linhaD35.entrada_paga_em !== null && linhaD35.entrada_forma === "DINHEIRO" &&
        linhaD35.entrada_fora_do_site === true && linhaD35.entrada_observacao === "Conferi no app (e2e)." && linhaD35.entrada_registrada_por_id !== null,
      "registrar-entrada: CONFIRMADA, com forma, observação e quem registrou",
      linhaD35,
    );
    confere(
      reg35.json?.encomenda?.entradaForma === "DINHEIRO" && reg35.json.encomenda.entradaForaDoSite === true && reg35.json.encomenda.linhaDoTempo.some((l) => /fora do site/.test(l.texto)),
      "ficha: entrada fora do site na ficha (forma, quem registrou) e na linha do tempo",
      reg35.json?.encomenda,
    );
    // Com o link da entrada ainda aberto, registrar por fora o encerra no nosso banco e avisa a dona.
    const enc26f = await novaEncomenda("f35", "AGUARDANDO_ENTRADA", { usuario: uid35, entradaAte: new Date(Date.now() + 3 * 3_600_000) });
    await abrirLinkEnc(conta35, enc26f, "ENTRADA");
    const reg26f = await acaoEnc(enc26f, { acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA", formaPagamento: "PIX" });
    const cobr26f = await cobrancasEnc(enc26f);
    confere(
      reg26f.status === 200 && /ainda aceita pagamento/.test(reg26f.json?.aviso ?? "") && cobr26f.every((c) => c.status === "CANCELADO"),
      "registrar a entrada com o link aberto: o link é encerrado no banco e a dona é avisada",
      [reg26f.status, reg26f.json?.aviso, cobr26f.map((c) => c.status)],
    );
    const finDepois35 = (await admin.req("GET", `/api/admin/financial-stats?mes=${mesAgora}`)).json;
    const deltaFin35 = (k) => Math.round((finDepois35.entradas.lembrancinhas[k] - finAntes35.entradas.lembrancinhas[k]) * 100) / 100;
    confere(deltaFin35("sinaisForaDoSite") === 90 && deltaFin35("liquido") === 90, "Financeiro: as duas entradas recebidas por fora entram no mês (sinaisForaDoSite +45 +45)", finDepois35.entradas.lembrancinhas);
    const segundaVez35 = await acaoEnc(c26d.id, { acao: "registrar-entrada", statusEsperado: "CONFIRMADA", formaPagamento: "PIX" });
    confere(segundaVez35.status === 409, "registrar a entrada de novo → 409", segundaVez35.json);
    modo({});
    await liberarVez(c26d.id);
    const dupD35 = await avisar(c26d.link.webhook_url, c26d.pg.corpoAviso);
    const devD35 = await devolucoesEnc(c26d.id);
    confere(dupD35.status === 200 && devD35.length === 1 && devD35[0].motivo === "PAGAMENTO_DUPLICADO" && devD35[0].status === "PENDENTE", "se o pagamento do site aparecer depois, é devolução por duplicidade (a dona decide)", devD35);
    // d) O retorno do navegador não renova a janela para sempre.
    const enc26e = await novaEncomenda("e35", "AGUARDANDO_ENTRADA", { usuario: uid35, entradaAte: new Date(Date.now() + 3 * 3_600_000) });
    const link26e = await abrirLinkEnc(conta35, enc26e, "ENTRADA");
    const pg26e = await pagar({ codigo: link26e.codigo, metodo: "pix", aviso: false });
    modo({ conferencia404: true });
    await conta35.req("GET", `/pagamento/retorno${new URL(pg26e.retorno).search}`);
    const [ret1] = await cobrancasEnc(enc26e);
    confere(ret1.retorno_em !== null, "retorno dentro da validade do link grava retorno_em", ret1.retorno_em);
    await sql("update pagamentos set expira_em = now() - interval '40 minutes', consultado_em = null where encomenda_id = $1", [enc26e]);
    await conta35.req("GET", `/pagamento/retorno${new URL(pg26e.retorno).search}`);
    const [ret2] = await cobrancasEnc(enc26e);
    confere(new Date(ret2.retorno_em).getTime() === new Date(ret1.retorno_em).getTime(), "retorno depois de vencimento + 30 min não renova retorno_em", [ret1.retorno_em, ret2.retorno_em]);
    modo({});

    console.log("36. Aviso forjado: o candidato verdadeiro nunca é sobrescrito nem impedido");
    const conta36 = await novaConta("enc-f");
    const uid36 = idDaConta();
    // a) O verdadeiro chega primeiro (a InfinitePay não consegue conferir), o forjado depois: o verdadeiro fica e confirma
    //    na reconferência da tela, mesmo sem o aviso se repetir.
    const enc27a = await novaEncomenda("a36", "AGUARDANDO_ENTRADA", { usuario: uid36 });
    const link27a = await abrirLinkEnc(conta36, enc27a, "ENTRADA");
    modo({ falharConferencia: 500 });
    const pg27a = await pagar({ codigo: link27a.codigo, metodo: "pix" });
    const forjado27a = await avisar(link27a.webhook_url, { transaction_nsu: `forjado-${marca}-1`, invoice_slug: pg27a.slug });
    const [c27a] = await cobrancasEnc(enc27a);
    confere(
      pg27a.aviso?.status === 400 && forjado27a.status === 400 && c27a.aviso_transacao_nsu === pg27a.transaction_nsu,
      "aviso forjado depois do verdadeiro: o candidato verdadeiro continua gravado",
      { gravado: c27a.aviso_transacao_nsu, verdadeiro: pg27a.transaction_nsu },
    );
    modo({});
    await liberarVez(enc27a);
    const sit27a = await conta36.req("GET", `/api/encomendas/${enc27a}/pagamento?parcela=ENTRADA`);
    confere(sit27a.json?.etapa === "PAGO" && (await linhaEnc(enc27a)).status === "CONFIRMADA", "a reconferência da tela confirma o verdadeiro", sit27a.json);
    // b) O forjado chega primeiro e fica gravado: o verdadeiro, ao chegar, é conferido na hora e confirma (não depende do espaço).
    const enc27b = await novaEncomenda("b36", "AGUARDANDO_ENTRADA", { usuario: uid36 });
    const link27b = await abrirLinkEnc(conta36, enc27b, "ENTRADA");
    modo({ falharConferencia: 500 });
    await avisar(link27b.webhook_url, { transaction_nsu: `forjado-${marca}-2`, invoice_slug: `slug-forjado-${marca}` });
    const [c27b0] = await cobrancasEnc(enc27b);
    confere(c27b0.aviso_transacao_nsu === `forjado-${marca}-2`, "candidato forjado gravado (a InfinitePay não respondeu)", c27b0.aviso_transacao_nsu);
    modo({});
    await liberarVez(enc27b);
    const pg27b = await pagar({ codigo: link27b.codigo, metodo: "pix" });
    confere(pg27b.aviso?.status === 200 && (await linhaEnc(enc27b)).status === "CONFIRMADA", "o aviso verdadeiro confirma mesmo com um candidato forjado gravado", pg27b.aviso);
    const [c27b] = await cobrancasEnc(enc27b);
    confere(c27b.status === "APROVADO" && c27b.transacao_nsu === pg27b.transaction_nsu && c27b.aviso_transacao_nsu === null, "cobrança aprovada com a transação verdadeira; o candidato forjado sai", c27b);
    // c) Forjado sozinho com a InfinitePay no ar: recusado e descartado, nada segura.
    const enc27c = await novaEncomenda("c36", "AGUARDANDO_ENTRADA", { usuario: uid36 });
    const link27c = await abrirLinkEnc(conta36, enc27c, "ENTRADA");
    const forjado27c = await avisar(link27c.webhook_url, { transaction_nsu: `forjado-${marca}-3`, invoice_slug: `slug-forjado-${marca}` });
    const [c27c] = await cobrancasEnc(enc27c);
    const e27c = await dtoEnc(conta36, enc27c);
    confere(
      forjado27c.status === 200 && c27c.aviso_transacao_nsu === null && e27c.pagamentoEmConferencia.entrada === false && e27c.acoes.pagarEntrada === true,
      "aviso forjado com a InfinitePay no ar: recusado e descartado, a cliente continua podendo pagar",
      { status: forjado27c.status, c27c },
    );

    console.log("28. Folga de 30 min depois do prazo da entrada: paga no último minuto confirma; depois da folga é pagamento tardio");
    const conta28 = await novaConta("enc-g");
    const uid28 = idDaConta();
    // a) Dentro da folga.
    const enc28a = await novaEncomenda("a28", "AGUARDANDO_ENTRADA", { usuario: uid28, entradaAte: new Date(Date.now() + 10 * 60_000) });
    const link28a = await abrirLinkEnc(conta28, enc28a, "ENTRADA");
    // epoch do TIMESTAMP sem fuso (lido como UTC): o pg leria a coluna na hora local e erraria por 3 h.
    const [{ ms: entradaAteMs28a }] = await sql("select (extract(epoch from entrada_ate) * 1000)::float8 ms from encomendas where id = $1", [enc28a]);
    confere(Math.abs(Date.parse(link28a.valid_until) - Number(entradaAteMs28a)) < 2_000, "o valid_until do link continua em entradaAte", [link28a.valid_until, entradaAteMs28a]);
    const pg28a = await pagar({ codigo: link28a.codigo, metodo: "pix", aviso: false });
    await sql("update encomendas set entrada_ate = now() - interval '10 minutes' where id = $1", [enc28a]);
    await sql("update pagamentos set expira_em = now() - interval '10 minutes' where encomenda_id = $1", [enc28a]);
    const dto28a = await dtoEnc(conta28, enc28a);
    confere(
      dto28a?.statusEfetivo === "AGUARDANDO_ENTRADA" && dto28a.entradaEmFolga === true && dto28a.acoes.pagarEntrada === false && (await linhaEnc(enc28a)).status === "AGUARDANDO_ENTRADA",
      "10 min depois do prazo: ainda aguardando (folga), sem 'Pagar'",
      dto28a,
    );
    const novo28a = await conta28.req("POST", `/api/encomendas/${enc28a}/pagamento`, { corpo: { parcela: "ENTRADA" } });
    confere(novo28a.status === 409, "na folga não se abre link novo (409)", novo28a.json);
    const aviso28a = await avisar(link28a.webhook_url, pg28a.corpoAviso);
    confere(aviso28a.status === 200 && (await linhaEnc(enc28a)).status === "CONFIRMADA" && (await devolucoesEnc(enc28a)).length === 0, "pagamento dentro da folga confirma normalmente, sem devolução", aviso28a.status);
    // b) Depois da folga: expirada; o pagamento que chega vira devolução (tardio).
    const enc28b = await novaEncomenda("b28", "AGUARDANDO_ENTRADA", { usuario: uid28, entradaAte: new Date(Date.now() + 10 * 60_000) });
    const link28b = await abrirLinkEnc(conta28, enc28b, "ENTRADA");
    const pg28b = await pagar({ codigo: link28b.codigo, metodo: "pix", aviso: false });
    await sql("update encomendas set entrada_ate = now() - interval '31 minutes' where id = $1", [enc28b]);
    await sql("update pagamentos set expira_em = now() - interval '31 minutes' where encomenda_id = $1", [enc28b]);
    const dto28b = await dtoEnc(conta28, enc28b);
    confere(dto28b?.statusEfetivo === "EXPIRADA" && dto28b.entradaEmFolga === false && (await linhaEnc(enc28b)).status === "EXPIRADA", "31 min depois do prazo: expirada", dto28b?.statusEfetivo);
    const aviso28b = await avisar(link28b.webhook_url, pg28b.corpoAviso);
    const dev28b = await devolucoesEnc(enc28b);
    confere(aviso28b.status === 200 && dev28b.length === 1 && dev28b[0].motivo === "PAGAMENTO_TARDIO" && (await linhaEnc(enc28b)).status === "EXPIRADA", "depois da folga o pagamento é tardio: devolução pendente e a encomenda segue expirada", dev28b);
    const dto28b2 = await dtoEnc(conta28, enc28b);
    confere(dto28b2?.devolucao.status === "PENDENTE" && dto28b2.devolucao.pendente === 45, "a cliente vê a devolução na encomenda expirada", dto28b2?.devolucao);
    // c) As horas reais para pagar a entrada (a tela não escreve "24 horas" fixo).
    const enc28c = await novaEncomenda("c28", "SOLICITADA", { usuario: uid28 });
    const antesAprovar = await dtoEnc(conta28, enc28c);
    await acaoEnc(enc28c, { acao: "aprovar", statusEsperado: "SOLICITADA" });
    const depoisAprovar = await dtoEnc(conta28, enc28c);
    confere(antesAprovar?.prazos.horasParaPagarEntrada === 24 && depoisAprovar?.prazos.horasParaPagarEntrada === 24, "horasParaPagarEntrada: 24 com o corte longe", [antesAprovar?.prazos.horasParaPagarEntrada, depoisAprovar?.prazos.horasParaPagarEntrada]);
    const enc28d = await novaEncomenda("d28", "SOLICITADA", { usuario: uid28, corteEm: new Date(Date.now() + 5 * 3_600_000) });
    await acaoEnc(enc28d, { acao: "aprovar", statusEsperado: "SOLICITADA" });
    const dto28d = await dtoEnc(conta28, enc28d);
    confere(Math.abs((dto28d?.prazos.horasParaPagarEntrada ?? 0) - 5) < 0.2, "horasParaPagarEntrada: o corte em 5 h limita o prazo a ~5 h", dto28d?.prazos.horasParaPagarEntrada);

    console.log("29. Devolução feita só das devoluções que a tela mostrou (por id)");
    const enc29 = await novaEncomenda("a29", "AGUARDANDO_ENTRADA");
    await sql("update encomendas set status = 'CANCELADA', cancelada_por = 'LOJA', encerrada_em = now(), motivo_cancelamento = 'e2e' where id = $1", [enc29]);
    const novaDev = (sufixo, valor) =>
      sql("insert into encomenda_devolucoes (id, encomenda_id, motivo, valor, status) values ($1, $2, 'CANCELAMENTO', $3, 'PENDENTE')", [`${enc29}${sufixo}`, enc29, valor]);
    await novaDev("d1", 10);
    await novaDev("d2", 20);
    const ficha29 = await fichaEnc(enc29);
    confere(ficha29?.devolucoes.length === 2 && ficha29.devolucoes.every((d) => d.id && d.status === "PENDENTE"), "a ficha lista as devoluções pendentes com id", ficha29?.devolucoes);
    const so1 = await acaoEnc(enc29, { acao: "devolucao-feita", statusEsperado: "CANCELADA", devolucaoIds: [`${enc29}d1`] });
    const estado29 = async () => Object.fromEntries((await devolucoesEnc(enc29)).map((d) => [d.id.slice(-2), d.status]));
    confere(so1.status === 200 && JSON.stringify(await estado29()) === JSON.stringify({ d1: "FEITA", d2: "PENDENTE" }), "fecha só a devolução escolhida", await estado29());
    await novaDev("d3", 5);
    const repete29 = await acaoEnc(enc29, { acao: "devolucao-feita", statusEsperado: "CANCELADA", devolucaoIds: [`${enc29}d1`, `${enc29}d2`] });
    confere(
      repete29.status === 409 && repete29.json?.detalhes?.motivo === "devolucao-mudou" && JSON.stringify(await estado29()) === JSON.stringify({ d1: "FEITA", d2: "PENDENTE", d3: "PENDENTE" }),
      "um id que já não está pendente → 409 devolucao-mudou e NADA muda (nem as outras)",
      await estado29(),
    );
    const alheio = await acaoEnc(enc29, { acao: "devolucao-feita", statusEsperado: "CANCELADA", devolucaoIds: [`${encId}-inexistente`] });
    confere(alheio.status === 409 && alheio.json?.detalhes?.motivo === "devolucao-mudou", "id que não é desta encomenda → 409", alheio.json);
    const so2 = await acaoEnc(enc29, { acao: "devolucao-feita", statusEsperado: "CANCELADA", devolucaoIds: [`${enc29}d2`], observacao: "Devolvi só esta (e2e)." });
    confere(
      so2.status === 200 && JSON.stringify(await estado29()) === JSON.stringify({ d1: "FEITA", d2: "FEITA", d3: "PENDENTE" }) && so2.json?.encomenda?.devolucao?.pendente === 5,
      "a devolução nova (que apareceu depois da tela) continua pendente",
      await estado29(),
    );

    console.log("30. Idempotência completa, limite de 3 abertas, trava de ambiente e o percentual aceito");
    const conta30 = await novaConta("enc-h");
    const uid30 = idDaConta();
    const chave30 = `e2e-${marca}-idem`;
    const cfg30 = (await admin.req("GET", "/api/admin/lembrancinhas")).json.config;
    const corpoBase30 = (festa, entrega) => ({
      itens: [{ productId: produto, quantidade: 15 }],
      dataFesta: festa,
      dataEntrega: entrega,
      modoEntrega: "RETIRADA",
      telefone: "(86) 99999-1234",
      aceitePolitica: true,
      politicaVersao: "2026-11-v1",
      percentualRetido: cfg30.percentualRetido,
      totalEsperadoCentavos: 15 * cfg30.precoPotinhoCentavos,
    });
    const [{ festa: festa30, entrega: entrega30 }] = await sql(
      `select to_char((now() at time zone 'America/Fortaleza')::date + 12, 'YYYY-MM-DD') festa, to_char((now() at time zone 'America/Fortaleza')::date + 10, 'YYYY-MM-DD') entrega`,
    );
    const postar = (corpo, chave = chave30, cli = conta30) => cli.req("POST", "/api/encomendas", { corpo, cabecalhos: { "Idempotency-Key": chave } });
    // Fechado (padrão): 503, em qualquer modo do teste (sem os dados legais ou com o recurso desativado).
    if (cfg30.ativo === false) {
      const fechado = await postar(corpoBase30(festa30, entrega30), `${chave30}-fechado`);
      confere(fechado.status === 503, "recurso fechado (ou sem CNPJ/CPF e e-mail da loja): 503 e nada gravado", fechado.json);
      confere((await sql("select count(*)::int n from encomendas where user_id = $1", [uid30]))[0].n === 0, "503 não grava nada");
    }
    if (process.env.E2E_DADOS_LEGAIS !== "1") {
      console.log("  (pulado o resto do caso 30: rode o site e este script com E2E_DADOS_LEGAIS=1)");
    } else {
      const [{ disponivel_em_mini: miniAntes30 }] = await sql("select disponivel_em_mini from products where id = $1", [produto]);
      const taxa30 = (await admin.req("GET", "/api/admin/entrega")).json?.taxaEntregaCentavos ?? 1500;
      try {
        const abre30 = await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: { ativo: true } });
        confere(abre30.status === 200, "painel abre as lembrancinhas", abre30.json);
        await sql("update products set disponivel_em_mini = true where id = $1", [produto]);
        // Observação: outro conteúdo com a mesma chave é outra solicitação.
        const primeira = await postar({ ...corpoBase30(festa30, entrega30), observacao: "Tag azul" });
        const idPrimeira = primeira.json?.encomenda?.id;
        if (idPrimeira) encomendas.push(idPrimeira);
        confere(primeira.status === 201 && primeira.json.encomenda.observacao === "Tag azul", "primeira solicitação → 201", primeira.json);
        const mesma = await postar({ ...corpoBase30(festa30, entrega30), observacao: "Tag azul" });
        confere(mesma.status === 200 && mesma.json?.encomenda?.id === idPrimeira, "mesma chave e mesmo conteúdo → 200, a mesma encomenda");
        const outraObs = await postar({ ...corpoBase30(festa30, entrega30), observacao: "Tag verde" });
        confere(outraObs.status === 422, "mesma chave com outra observação → 422 (não devolve a antiga em silêncio)", outraObs.json);
        const semObs = await postar(corpoBase30(festa30, entrega30));
        confere(semObs.status === 422, "mesma chave sem a observação → 422", semObs.json);
        // Endereço: entrega com endereço salvo; outro endereço com a mesma chave → 422.
        await sql("insert into addresses (id, user_id, cep, rua, numero, bairro, cidade, estado) values ($1, $3, '64035420', 'Rua E2E A', '10', 'Centro', 'Teresina', 'PI'), ($2, $3, '64035420', 'Rua E2E B', '20', 'Centro', 'Teresina', 'PI')", [`ad${marca}a`, `ad${marca}b`, uid30]);
        const entrega = (addressId) => ({ ...corpoBase30(festa30, entrega30), modoEntrega: "ENTREGA", addressId, totalEsperadoCentavos: 15 * cfg30.precoPotinhoCentavos + taxa30 });
        const chaveE = `${chave30}-entrega`;
        const ent1 = await postar(entrega(`ad${marca}a`), chaveE);
        if (ent1.json?.encomenda?.id) encomendas.push(ent1.json.encomenda.id);
        confere(ent1.status === 201 && ent1.json.encomenda.endereco?.rua === "Rua E2E A", "entrega com endereço salvo → 201", ent1.json);
        const ent2 = await postar(entrega(`ad${marca}b`), chaveE);
        confere(ent2.status === 422, "mesma chave com outro endereço → 422", ent2.json);
        const ent3 = await postar(entrega(`ad${marca}a`), chaveE);
        confere(ent3.status === 200 && ent3.json?.encomenda?.id === ent1.json?.encomenda?.id, "mesma chave e mesmo endereço → 200");
        // Conta nova (o limite de 10 solicitações por hora da conta "h" já foi quase todo usado acima), com 2 encomendas
        // abertas: o limite é de 3, e a corrida da mesma chave devolve a primeira, não 429.
        const contaL = await novaConta("enc-j");
        const uidL = idDaConta();
        await novaEncomenda("l1", "SOLICITADA", { usuario: uidL });
        await novaEncomenda("l2", "AGUARDANDO_ENTRADA", { usuario: uidL });
        const chaveC = `${chave30}-corrida`;
        const [x, y] = await Promise.all([postar(corpoBase30(festa30, entrega30), chaveC, contaL), postar(corpoBase30(festa30, entrega30), chaveC, contaL)]);
        for (const r of [x, y]) if (r.json?.encomenda?.id) encomendas.push(r.json.encomenda.id);
        const statuses = [x.status, y.status].sort();
        confere(
          statuses[0] === 200 && statuses[1] === 201 && x.json?.encomenda?.id === y.json?.encomenda?.id,
          "dois envios simultâneos da mesma solicitação com 2 já abertas: 201 e 200 com a mesma encomenda (não 429)",
          [x.status, y.status, x.json, y.json],
        );
        confere((await sql("select count(*)::int n from encomendas where user_id = $1 and idempotency_key = $2", [uidL, chaveC]))[0].n === 1, "uma linha só para a chave");
        // 3 abertas: outra chave → 429; a chave já usada continua devolvendo a encomenda (a chave vem antes do limite).
        const quarta = await postar(corpoBase30(festa30, entrega30), `${chave30}-quarta`, contaL);
        confere(quarta.status === 429 && /3 encomendas/.test(quarta.json?.erro ?? ""), "4ª encomenda aberta → 429", quarta.json);
        const repeteComLimite = await postar(corpoBase30(festa30, entrega30), chaveC, contaL);
        confere(repeteComLimite.status === 200 && repeteComLimite.json?.encomenda?.id === x.json?.encomenda?.id, "com 3 abertas, repetir a chave usada → 200 (a chave vem antes do limite)", repeteComLimite.json);
      } finally {
        await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: { ativo: cfg30.ativo } });
        await sql("update products set disponivel_em_mini = $2 where id = $1", [produto, miniAntes30]);
      }
    }
    // Percentual aceito x efetivo: a aprovação baixa o efetivo, o aceito (e o texto da política) ficam.
    const encP = await novaEncomenda("p30", "SOLICITADA", { usuario: uid30, percentualAceito: 100 });
    const corpoCfg = (p) => ({ ativo: cfg30.ativo, precoPotinhoCentavos: cfg30.precoPotinhoCentavos, pesoPotinhoGramas: cfg30.pesoPotinhoGramas, pesoEmbalagemGramas: cfg30.pesoEmbalagemGramas, percentualRetido: p });
    try {
      const baixa = await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: corpoCfg(50) });
      confere(baixa.status === 200 && baixa.json?.config?.percentualRetido === 50, "painel baixa o percentual para 50%", baixa.json?.config?.percentualRetido);
      await acaoEnc(encP, { acao: "aprovar", statusEsperado: "SOLICITADA" });
      const linhaP = await linhaEnc(encP);
      confere(linhaP.percentual_aceito === 100 && linhaP.percentual_retido === 50, "aprovar baixa o percentual efetivo (50) e guarda o aceito (100)", [linhaP.percentual_aceito, linhaP.percentual_retido]);
      const dtoP = await dtoEnc(conta30, encP);
      confere(
        dtoP?.politica.percentualAceito === 100 && dtoP.politica.percentualRetido === 50 && /fica com a Geleiô para cobrir/.test(dtoP.politica.textos[2] ?? "") && !/50%/.test(dtoP.politica.textos[2] ?? ""),
        "o texto da política mostra o que a cliente aceitou (100%), não o efetivo",
        dtoP?.politica,
      );
      const fichaP = await fichaEnc(encP);
      confere(fichaP?.politica.percentualAceito === 100 && fichaP.politica.percentualRetido === 50, "a ficha mostra o aceito e o efetivo", fichaP?.politica);
      // O efetivo não passa do aceito (CHECK no banco) e a prévia da desistência depois do corte usa o efetivo.
      try {
        await sql("update encomendas set percentual_retido = 100, percentual_aceito = 80 where id = $1", [encP]);
        confere(false, "CHECK recusa percentual efetivo acima do aceito");
      } catch (e) {
        confere(e.code === "23514", "CHECK recusa percentual efetivo acima do aceito", e.message);
      }
      const encPC = await novaEncomenda("pc30", "CONFIRMADA", { usuario: uid30, percentualAceito: 100, percentualRetido: 50, corteEm: new Date(Date.now() - 3_600_000) });
      const dtoPC = await dtoEnc(conta30, encPC);
      confere(dtoPC?.acoes.desistir?.devolucaoCentavos === 2250 && dtoPC.acoes.desistir.retidoCentavos === 2250, "depois do corte, a desistência retém o percentual efetivo (50% de 45 = 22,50)", dtoPC?.acoes.desistir);
    } finally {
      await admin.req("PATCH", "/api/admin/lembrancinhas", { corpo: corpoCfg(cfg30.percentualRetido) });
    }

    console.log("31. Segurança do PATCH da ficha: cliente, sem sessão e requisição de outro site");
    const enc31 = await novaEncomenda("s31", "SOLICITADA");
    const corpo31 = { acao: "aprovar", statusEsperado: "SOLICITADA" };
    const comoCliente = await a.req("PATCH", `/api/admin/encomendas/${enc31}`, { corpo: corpo31 });
    confere(comoCliente.status === 403, "PATCH da ficha como cliente → 403", comoCliente.status);
    const patchSemSessao = await cliente().req("PATCH", `/api/admin/encomendas/${enc31}`, { corpo: corpo31 });
    confere(patchSemSessao.status === 401, "PATCH da ficha sem sessão → 401", patchSemSessao.status);
    const outroSite = await admin.req("PATCH", `/api/admin/encomendas/${enc31}`, { corpo: corpo31, cabecalhos: { Origin: "https://evil.example" } });
    confere(outroSite.status === 403, "PATCH da ficha com Origin de outro site → 403", outroSite.status);
    const crossSite = await admin.req("PATCH", `/api/admin/encomendas/${enc31}`, { corpo: corpo31, cabecalhos: { "Sec-Fetch-Site": "cross-site" } });
    confere(crossSite.status === 403, "PATCH da ficha com Sec-Fetch-Site: cross-site → 403", crossSite.status);
    confere((await linhaEnc(enc31)).status === "SOLICITADA", "nenhuma dessas tentativas mudou a encomenda");
    const desistirCsrf = await a.req("POST", `/api/encomendas/${enc31}/desistir`, { corpo: { devolucaoEsperadaCentavos: 0 }, cabecalhos: { Origin: "https://evil.example" } });
    confere(desistirCsrf.status === 403, "desistir com Origin de outro site → 403", desistirCsrf.status);
    const semOrigem = await acaoEnc(enc31, corpo31);
    confere(semOrigem.status === 200, "sem Origin (cliente HTTP, não navegador) e como admin: vale", semOrigem.status);

    console.log("32. Financeiro na virada de mês e devolução no mês seguinte (set/out de 2025, sem tocar nos meses atuais)");
    const fin = async (mes) => (await admin.req("GET", `/api/admin/financial-stats?mes=${mes}`)).json?.entradas?.lembrancinhas;
    const finSet0 = await fin("2025-09");
    const finOut0 = await fin("2025-10");
    const enc32a = await novaEncomenda("a32", "CONFIRMADA");
    const enc32b = await novaEncomenda("b32", "CONFIRMADA");
    const enc32c = await novaEncomenda("c32", "CONFIRMADA");
    const pagamentoAprovado = (id, enc, parcela, instante) =>
      sql(
        `insert into pagamentos (id, encomenda_id, parcela, gateway, referencia_externa, status, valor, expira_em, aprovado_em)
         values ($1, $2, $3, 'infinitepay', $4, 'APROVADO', 45, $5, $5)`,
        [id, enc, parcela, `enc-${enc}-${parcela}-1`, utc(instante)],
      );
    await pagamentoAprovado(`${enc32a}p`, enc32a, "ENTRADA", "2025-09-30T23:59:30-03:00");
    await pagamentoAprovado(`${enc32b}p`, enc32b, "ENTRADA", "2025-10-01T00:00:05-03:00");
    await sql("update encomendas set entrada_fora_do_site = true, entrada_forma = 'DINHEIRO', entrada_paga_em = $2 where id = $1", [enc32c, utc("2025-09-30T23:59:59-03:00")]);
    await sql(
      "insert into encomenda_devolucoes (id, encomenda_id, motivo, valor, status, criada_em, feita_em) values ($1, $2, 'CANCELAMENTO', 45, 'FEITA', $3, $3)",
      [`${enc32a}d`, enc32a, utc("2025-10-01T00:00:10-03:00")],
    );
    const finSet1 = await fin("2025-09");
    const finOut1 = await fin("2025-10");
    const dif = (depois, antes, k) => Math.round((depois[k] - antes[k]) * 100) / 100;
    confere(
      dif(finSet1, finSet0, "sinais") === 45 && dif(finSet1, finSet0, "sinaisForaDoSite") === 45 && dif(finSet1, finSet0, "devolucoes") === 0 && dif(finSet1, finSet0, "liquido") === 90,
      "setembro: o sinal pago às 23:59:30 e a entrada por fora às 23:59:59 entram em setembro (a devolução feita à 00:00:10 não)",
      [finSet0, finSet1],
    );
    confere(
      dif(finOut1, finOut0, "sinais") === 45 && dif(finOut1, finOut0, "devolucoes") === 45 && dif(finOut1, finOut0, "liquido") === 0,
      "outubro: o sinal pago às 00:00:05 e a devolução feita às 00:00:10 entram em outubro (líquido 0)",
      [finOut0, finOut1],
    );
    const despSet = (await admin.req("GET", "/api/admin/expenses?mes=2025-09")).json;
    confere(typeof despSet?.lembrancinhas === "number", "Despesas também traz o líquido das lembrancinhas do mês", despSet?.lembrancinhas);

    console.log("33. Desistência: antes e depois do corte, prévia que mudou entre a tela e o clique, link aberto");
    const conta33 = await novaConta("enc-i");
    const uid33 = idDaConta();
    const desistir = (cli, id, esperado, extra = {}) => cli.req("POST", `/api/encomendas/${id}/desistir`, { corpo: { devolucaoEsperadaCentavos: esperado }, ...extra });
    // a) Antes do corte: devolve tudo (e a de outra conta não enxerga).
    const e33a = await novaEncomenda("a33", "CONFIRMADA", { usuario: uid33, corteEm: new Date(Date.now() + 3 * 86_400_000) });
    const d33a = await dtoEnc(conta33, e33a);
    confere(d33a?.acoes.desistir?.devolucaoCentavos === 4500 && d33a.acoes.desistir.retidoCentavos === 0, "antes do corte: a prévia devolve os 45 pagos", d33a?.acoes.desistir);
    confere((await desistir(b, e33a, 4500)).status === 404, "desistir de encomenda de outra conta → 404");
    const ok33a = await desistir(conta33, e33a, 4500);
    const [dev33a] = await devolucoesEnc(e33a);
    confere(
      ok33a.status === 200 && ok33a.json?.devolucao?.valor === 45 && ok33a.json.devolucao.retido === 0 && ok33a.json.encomenda.statusEfetivo === "CANCELADA" && dev33a?.motivo === "DESISTENCIA" && dev33a.valor === "45.00",
      "desistir antes do corte → CANCELADA com devolução pendente de 45",
      [ok33a.status, dev33a],
    );
    confere((await desistir(conta33, e33a, 4500)).status === 409, "desistir de novo → 409 (já encerrada)");
    // b) Depois do corte: retém a entrada; esperar o valor antigo é 409 com a prévia nova.
    const e33b = await novaEncomenda("b33", "CONFIRMADA", { usuario: uid33, corteEm: new Date(Date.now() - 3_600_000) });
    const d33b = await dtoEnc(conta33, e33b);
    confere(d33b?.acoes.desistir?.devolucaoCentavos === 0 && d33b.acoes.desistir.retidoCentavos === 4500, "depois do corte: a prévia retém a entrada (100%)", d33b?.acoes.desistir);
    const errado33b = await desistir(conta33, e33b, 4500);
    confere(errado33b.status === 409 && errado33b.json?.detalhes?.devolucaoCentavos === 0 && errado33b.json.detalhes.retidoCentavos === 4500 && (await linhaEnc(e33b)).status === "CONFIRMADA", "esperar a devolução de antes do corte → 409 com a prévia nova, nada muda", errado33b.json);
    const ok33b = await desistir(conta33, e33b, 0);
    confere(ok33b.status === 200 && ok33b.json?.devolucao?.retido === 45 && (await devolucoesEnc(e33b)).length === 0, "desistir depois do corte → CANCELADA, a entrada fica e não há devolução");
    // c) O corte passa entre a tela e o clique.
    const e33c = await novaEncomenda("c33", "CONFIRMADA", { usuario: uid33, corteEm: new Date(Date.now() + 3_600_000) });
    const d33c = await dtoEnc(conta33, e33c);
    await sql("update encomendas set corte_em = now() - interval '1 minute' where id = $1", [e33c]);
    const mudou33c = await desistir(conta33, e33c, d33c.acoes.desistir.devolucaoCentavos);
    confere(mudou33c.status === 409 && mudou33c.json?.detalhes?.devolucaoCentavos === 0, "o corte passou entre a tela e o clique: 409 com a prévia nova", mudou33c.json);
    // d) Link aberto: a desistência o encerra no nosso banco, e o pagamento que chegar depois vira devolução.
    const e33d = await novaEncomenda("d33", "AGUARDANDO_ENTRADA", { usuario: uid33, entradaAte: new Date(Date.now() + 3 * 3_600_000) });
    const link33d = await abrirLinkEnc(conta33, e33d, "ENTRADA");
    const pg33d = await pagar({ codigo: link33d.codigo, metodo: "pix", aviso: false });
    const ok33d = await desistir(conta33, e33d, 0);
    const [c33d] = await cobrancasEnc(e33d);
    confere(ok33d.status === 200 && c33d.status === "CANCELADO", "desistir com link aberto: o link vira CANCELADO no banco", [ok33d.status, c33d.status]);
    const tarde33d = await avisar(link33d.webhook_url, pg33d.corpoAviso);
    const dev33d = await devolucoesEnc(e33d);
    confere(tarde33d.status === 200 && dev33d.length === 1 && dev33d[0].motivo === "PAGAMENTO_TARDIO" && dev33d[0].status === "PENDENTE", "o pagamento do link que ficou aberto vira devolução pendente", dev33d);
    // e) Restante já pago e corte passado: o restante volta, a entrada fica.
    const e33e = await novaEncomenda("e33", "CONFIRMADA", { usuario: uid33, corteEm: new Date(Date.now() - 3_600_000), restantePagoEm: new Date() });
    const d33e = await dtoEnc(conta33, e33e);
    confere(d33e?.acoes.desistir?.devolucaoCentavos === 4500 && d33e.acoes.desistir.retidoCentavos === 4500, "depois do corte com o restante pago: volta o restante (45), a entrada (45) fica", d33e?.acoes.desistir);

    console.log("13. Meus pedidos e o teto de pendentes");
    const meus = await sql("select count(*)::int n from orders where user_id = $1 and status = 'PENDENTE' and created_at > now() - interval '48 hours'", [contas[0]]);
    confere(meus[0].n < 20, "pendentes recentes abaixo do teto (o expirado não conta)", meus[0]);
  } finally {
    await falsa.fechar();
  }
}

async function limpar() {
  if (encomendas.length > 0) {
    await sql("delete from encomenda_devolucoes where encomenda_id = any($1)", [encomendas]);
    await sql("delete from pagamentos where encomenda_id = any($1)", [encomendas]);
    await sql("delete from encomendas where id = any($1) and user_id = any($2)", [encomendas, contas]);
  }
  if (pedidos.length > 0) {
    await sql("delete from pagamentos where order_id = any($1)", [pedidos]);
    await sql("delete from orders where id = any($1) and user_id = any($2)", [pedidos, contas]);
  }
  if (contas.length > 0) {
    // Só as contas criadas aqui (e-mail com a marca deste teste).
    await sql("delete from users where id = any($1) and email like $2", [contas, `e2e-infinitepay-${marca}-%`]);
  }
}

try {
  await main();
} catch (e) {
  falhas++;
  console.log(`ERRO: ${e.stack ?? e}`);
} finally {
  try {
    await limpar();
    console.log(`limpeza: ${pedidos.length} pedidos, ${encomendas.length} encomendas e ${contas.length} contas de teste apagados`);
  } catch (e) {
    console.log(`limpeza falhou: ${e.message}`);
  }
  await banco.end();
  console.log(`\n${ok} ok, ${falhas} falhas`);
  process.exit(falhas === 0 ? 0 : 1);
}
