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
// O admin vem de E2E_ADMIN_EMAIL / E2E_ADMIN_SENHA ou do ACESSO-LOCAL.txt. Tudo o que o teste cria
// (contas e-mail e2e-infinitepay-*, pedidos e cobranças delas) é apagado no fim, mesmo se falhar.
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
    const webhookDe = (pedido) => falsa.links.get(codigoDe(pedido.pagamento.checkoutUrl)).webhook_url;
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

    console.log("13. Meus pedidos e o teto de pendentes");
    const meus = await sql("select count(*)::int n from orders where user_id = $1 and status = 'PENDENTE' and created_at > now() - interval '48 hours'", [contas[0]]);
    confere(meus[0].n < 20, "pendentes recentes abaixo do teto (o expirado não conta)", meus[0]);
  } finally {
    await falsa.fechar();
  }
}

async function limpar() {
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
    console.log(`limpeza: ${pedidos.length} pedidos e ${contas.length} contas de teste apagados`);
  } catch (e) {
    console.log(`limpeza falhou: ${e.message}`);
  }
  await banco.end();
  console.log(`\n${ok} ok, ${falhas} falhas`);
  process.exit(falhas === 0 ? 0 : 1);
}
