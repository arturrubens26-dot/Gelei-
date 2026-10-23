// InfinitePay FALSA para testes neste computador (sem dinheiro de verdade).
//
// Uso sozinho:   node testes/infinitepay-falso.mjs [porta]        (padrão 4010)
// Uso no e2e:    import { iniciarInfinitePayFalsa } from "./infinitepay-falso.mjs"
//
// O site aponta para ela com INFINITEPAY_API_URL=http://127.0.0.1:4010 (o código só aceita
// 127.0.0.1/localhost). Imita a API real como o ensaio com dinheiro real (2026-10-22) a mostrou:
//   POST /links          (X-Api-Key) → { url }: sem slug, e o código no caminho do link NÃO é o slug da
//                        fatura (com o modo comSlug, devolve também o slug, como a documentação sugere)
//   POST /payment_check  (X-Api-Key) → { success, paid, amount, paid_amount, installments, capture_method },
//                        sem order_nsu nem moeda. Amarra a transação ao pedido CONSULTADO:
//                          - transação, slug e order_nsu certos → success:true, paid:true e os valores;
//                          - slug errado (ou transação inexistente) → success:false;
//                          - transação e slug certos com OUTRO order_nsu → success:true, paid:false, amount:0,
//                            paid_amount:0, installments:null, capture_method:null.
//   GET  /pagar/<código> página com botões PIX, Cartão 3x com juros, Valor errado e Aviso falso:
//                        paga, manda o aviso (webhook) e leva o navegador ao redirect_url, com
//                        capture_method, transaction_id (= transaction_nsu, UUID), transaction_nsu, slug,
//                        order_nsu e receipt_url.
// Controle dos testes (não existe na API real):
//   POST /__teste/pagar  { codigo, metodo?, parcelas?, valorErrado?, aviso? } → { transaction_nsu, slug, order_nsu, retorno, aviso }
//   POST /__teste/modo   { falharConferencia?: 0|500|"tempo", falharLinks?: 0|500, comSlug?, naoAmarraPedido?,
//                          conferencia404? }   (naoAmarraPedido: uma API hipotética que NÃO amarra a transação)
//   GET  /__teste/estado → links e transações
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const JUROS_POR_PARCELA = 0.03; // só para o "cartão com juros" ficar maior que o valor do link

export const MODO_PADRAO = Object.freeze({ falharConferencia: 0, falharLinks: 0, comSlug: false, naoAmarraPedido: false, conferencia404: false });

export function iniciarInfinitePayFalsa({ porta = 4010, host = "127.0.0.1", silencioso = false } = {}) {
  // código do link → { codigo, slug, order_nsu, amount, redirect_url, webhook_url, valid_until, single_payment, pagoPor }
  const links = new Map();
  const transacoes = new Map(); // transaction_nsu → { slug, order_nsu, amount, paid_amount, installments, capture_method }
  const modo = { ...MODO_PADRAO };
  const chamadas = { links: 0, payment_check: 0 };
  const log = (...a) => silencioso || console.log("[infinitepay-falsa]", ...a);

  const id = (prefixo) => `${prefixo}${randomBytes(6).toString("hex")}`;
  const origem = () => `http://${host}:${servidor.address().port}`;

  async function lerCorpo(req) {
    const partes = [];
    for await (const p of req) partes.push(p);
    const texto = Buffer.concat(partes).toString("utf8");
    if (!texto) return {};
    const tipo = req.headers["content-type"] ?? "";
    if (tipo.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(texto));
    try {
      return JSON.parse(texto);
    } catch {
      return null;
    }
  }

  const json = (res, status, corpo) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
  };

  /** Paga o link: cria a transação, manda o aviso (se pedido) e devolve a URL de retorno. */
  async function pagar({ codigo, metodo = "pix", parcelas, valorErrado = false, aviso = true, avisoFalso = false }) {
    const link = links.get(codigo);
    if (!link) return { erro: "link não existe", status: 404 };
    if (link.single_payment && link.pagoPor) return { erro: "link já pago", status: 409 };
    if (link.valid_until && Date.parse(link.valid_until) < Date.now()) return { erro: "link vencido", status: 410 };
    const slug = link.slug;
    const nParcelas = metodo === "credit_card" ? Number(parcelas ?? 1) : 1;
    const amount = valorErrado ? link.amount - 100 : link.amount;
    const paid_amount = nParcelas > 1 ? Math.round(amount * (1 + JUROS_POR_PARCELA * nParcelas)) : amount;
    const transaction_nsu = randomUUID(); // a real usa UUID
    if (!avisoFalso) {
      transacoes.set(transaction_nsu, { slug, order_nsu: link.order_nsu, amount, paid_amount, installments: nParcelas, capture_method: metodo });
      link.pagoPor = transaction_nsu;
    }
    const receipt_url = `${origem()}/recibo/${transaction_nsu}`;
    // O formato do aviso (webhook) ainda não foi visto no ensaio: este segue a documentação.
    const corpoAviso = {
      invoice_slug: slug,
      amount,
      paid_amount,
      installments: nParcelas,
      capture_method: metodo,
      transaction_nsu,
      order_nsu: link.order_nsu,
      receipt_url,
      items: link.items,
    };
    let resultadoAviso = null;
    if (aviso && link.webhook_url) {
      try {
        const r = await fetch(link.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpoAviso),
          signal: AbortSignal.timeout(20_000),
        });
        resultadoAviso = { status: r.status, corpo: await r.json().catch(() => null) };
      } catch (e) {
        resultadoAviso = { status: 0, erro: e.message };
      }
      log(`aviso ${link.order_nsu} → ${resultadoAviso.status}`);
    }
    const retorno = new URL(link.redirect_url);
    const parametros = { capture_method: metodo, transaction_id: transaction_nsu, transaction_nsu, slug, order_nsu: link.order_nsu, receipt_url };
    for (const [k, v] of Object.entries(parametros)) {
      retorno.searchParams.set(k, v);
    }
    return { status: 200, transaction_nsu, slug, order_nsu: link.order_nsu, retorno: retorno.toString(), aviso: resultadoAviso, corpoAviso };
  }

  function pagina(link) {
    const botao = (rotulo, campos) =>
      `<form method="post" action="/pagar/${link.codigo}">${Object.entries(campos)
        .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`)
        .join("")}<button>${rotulo}</button></form>`;
    return `<!doctype html><meta charset="utf-8"><title>InfinitePay falsa</title>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto">
<h1>InfinitePay FALSA</h1><p>Pedido <code>${link.order_nsu}</code>: R$ ${(link.amount / 100).toFixed(2).replace(".", ",")}</p>
${link.pagoPor ? "<p><b>Este link já foi pago.</b></p>" : ""}
${botao("Pagar com PIX", { metodo: "pix" })}
${botao("Cartão 3x com juros", { metodo: "credit_card", parcelas: 3 })}
${botao("Valor errado (PIX)", { metodo: "pix", valorErrado: 1 })}
${botao("Aviso falso (transação inexistente)", { metodo: "pix", avisoFalso: 1 })}
</body>`;
  }

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origem());
      const caminho = url.pathname;
      const comChave = () => typeof req.headers["x-api-key"] === "string" && req.headers["x-api-key"].length > 0;

      if (req.method === "POST" && caminho === "/links") {
        chamadas.links++;
        if (!comChave()) return json(res, 401, { message: "missing api key" });
        if (modo.falharLinks) return json(res, modo.falharLinks, { message: "falha simulada" });
        const b = await lerCorpo(req);
        if (!b || !Array.isArray(b.items) || b.items.length === 0) return json(res, 422, { message: "items is required" });
        if (b.discounts || b.options?.discounts) return json(res, 422, { message: "o teste não espera descontos" });
        const amount = b.items.reduce((s, i) => s + i.quantity * i.price, 0);
        if (!b.items.every((i) => Number.isInteger(i.price) && i.price > 0 && Number.isInteger(i.quantity) && i.quantity > 0)) {
          return json(res, 422, { message: "price/quantity inválidos" });
        }
        const codigo = id("lnk_"); // vai no caminho do link
        const slug = id("fat_"); // o slug da fatura: só aparece no retorno e no aviso
        links.set(codigo, {
          codigo,
          slug,
          order_nsu: b.order_nsu,
          amount,
          items: b.items,
          redirect_url: b.redirect_url,
          webhook_url: b.webhook_url,
          valid_until: b.options?.valid_until,
          single_payment: Boolean(b.options?.single_payment),
          handle: b.handle,
          pagoPor: null,
        });
        log(`link ${b.order_nsu} R$ ${(amount / 100).toFixed(2)} → ${codigo} (fatura ${slug})`);
        const urlPagar = `${origem()}/pagar/${codigo}`;
        return json(res, 200, modo.comSlug ? { url: urlPagar, slug } : { url: urlPagar });
      }

      if (req.method === "POST" && caminho === "/payment_check") {
        chamadas.payment_check++;
        if (!comChave()) return json(res, 401, { message: "missing api key" });
        if (modo.falharConferencia === "tempo") {
          await new Promise((r) => setTimeout(r, 12_000));
          return json(res, 504, { message: "tempo" });
        }
        if (modo.falharConferencia) return json(res, modo.falharConferencia, { message: "falha simulada" });
        const b = await lerCorpo(req);
        if (modo.conferencia404) return json(res, 404, { message: "transaction not found" });
        const t = b && transacoes.get(b.transaction_nsu);
        const pago = (t) => ({
          success: true,
          paid: true,
          amount: t.amount,
          paid_amount: t.paid_amount,
          installments: t.installments,
          capture_method: t.capture_method,
        });
        // API hipotética que não amarra: qualquer transação existente responde "pago".
        if (t && modo.naoAmarraPedido) return json(res, 200, pago(t));
        // Slug errado (ou transação inexistente): success=false (ensaio: order_nsu certo e slug errado).
        if (!t || t.slug !== b.slug) return json(res, 200, { success: false });
        // Transação e slug certos, com OUTRO order_nsu: "não pago", com tudo zerado (ensaio, passo 6).
        if (t.order_nsu !== b.order_nsu) {
          return json(res, 200, { success: true, paid: false, amount: 0, paid_amount: 0, installments: null, capture_method: null });
        }
        return json(res, 200, pago(t));
      }

      const pagarMatch = /^\/pagar\/([A-Za-z0-9_-]+)$/.exec(caminho);
      if (pagarMatch && req.method === "GET") {
        const link = links.get(pagarMatch[1]);
        if (!link) return json(res, 404, { message: "não existe" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(pagina(link));
      }
      if (pagarMatch && req.method === "POST") {
        const b = (await lerCorpo(req)) ?? {};
        const r = await pagar({
          codigo: pagarMatch[1],
          metodo: b.metodo,
          parcelas: b.parcelas,
          valorErrado: Boolean(b.valorErrado),
          avisoFalso: Boolean(b.avisoFalso),
        });
        if (r.erro) return json(res, r.status, { message: r.erro });
        res.writeHead(303, { Location: r.retorno });
        return res.end();
      }
      if (caminho.startsWith("/recibo/")) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Comprovante FALSO");
      }

      if (req.method === "POST" && caminho === "/__teste/pagar") {
        const r = await pagar((await lerCorpo(req)) ?? {});
        return json(res, r.status ?? 200, r.erro ? { message: r.erro } : r);
      }
      if (req.method === "POST" && caminho === "/__teste/modo") {
        Object.assign(modo, (await lerCorpo(req)) ?? {});
        return json(res, 200, modo);
      }
      if (req.method === "GET" && caminho === "/__teste/estado") {
        return json(res, 200, { modo, chamadas, links: [...links.values()], transacoes: Object.fromEntries(transacoes) });
      }
      json(res, 404, { message: "rota desconhecida" });
    } catch (e) {
      json(res, 500, { message: e.message });
    }
  });

  return new Promise((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(porta, host, () => {
      log(`ouvindo em ${origem()}`);
      resolver({
        origem: origem(),
        links,
        transacoes,
        modo,
        chamadas,
        pagar,
        fechar: () => new Promise((r) => servidor.close(() => r())),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await iniciarInfinitePayFalsa({ porta: Number(process.argv[2] ?? 4010) });
}
