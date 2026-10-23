import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORMATO_HANDLE,
  classificarConferencia,
  conferenciaAmarrada,
  conferirTokenDoAviso,
  corpoDoLink,
  dataComFusoDeBrasilia,
  decisaoDoCanario,
  divergenciaDaConferencia,
  itensDoLink,
  lerAviso,
  lerConferencia,
  lerReferencia,
  lerRespostaDoLink,
  lerRetorno,
  origemDeTesteDe,
  origemPublicaDe,
  referenciaDaEncomenda,
  referenciaDoCanario,
  referenciaDoPedido,
  somaDosItens,
  tokenDoAviso,
  urlDaInfinitePay,
  urlDoRecibo,
  type Conferencia,
  type EntradaDoLink,
} from "../src/lib/infinitepay-regras";
import { PARCELAS_SEM_JUROS } from "../src/lib/pagamentos-regras";

const SEGREDO = "s".repeat(48);
const PEDIDO = "cmh1abcdefghijklmnopqrstu";

describe("referência (order_nsu)", () => {
  it("pedido: ped-<id>-<n>, lida de volta", () => {
    const ref = referenciaDoPedido(PEDIDO, 3);
    assert.equal(ref, `ped-${PEDIDO}-3`);
    assert.deepEqual(lerReferencia(ref), { tipo: "pedido", pedidoId: PEDIDO, tentativa: 3 });
  });

  it("encomenda com parcela: enc-<id>-<PARCELA>-<n>", () => {
    const ref = referenciaDaEncomenda(PEDIDO, "ENTRADA", 1);
    assert.equal(ref, `enc-${PEDIDO}-ENTRADA-1`);
    assert.deepEqual(lerReferencia(ref), { tipo: "encomenda", encomendaId: PEDIDO, parcela: "ENTRADA", tentativa: 1 });
  });

  it("recusa formatos fora do padrão", () => {
    assert.throws(() => referenciaDoPedido("ID-MAIUSCULO", 1));
    assert.throws(() => referenciaDoPedido(PEDIDO, 0));
    assert.throws(() => referenciaDoPedido(PEDIDO, 1000));
    for (const ruim of ["", "ped-", `ped-${PEDIDO}`, `ped-${PEDIDO}-01`, `enc-${PEDIDO}-OUTRA-1`, `ensaio-202610221200`, `ped-${PEDIDO}-1/../x`]) {
      assert.equal(lerReferencia(ruim), null, ruim);
    }
  });
});

describe("token do aviso", () => {
  it("confere o da própria cobrança (43 caracteres base64url)", () => {
    const ref = referenciaDoPedido(PEDIDO, 1);
    const token = tokenDoAviso(SEGREDO, ref);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(conferirTokenDoAviso(SEGREDO, ref, token), true);
  });

  it("falha com outra cobrança, token mexido, outro segredo ou segredo vazio", () => {
    const ref = referenciaDoPedido(PEDIDO, 1);
    const token = tokenDoAviso(SEGREDO, ref);
    assert.equal(conferirTokenDoAviso(SEGREDO, referenciaDoPedido(PEDIDO, 2), token), false);
    const mexido = (token[0] === "A" ? "B" : "A") + token.slice(1);
    assert.equal(conferirTokenDoAviso(SEGREDO, ref, mexido), false);
    assert.equal(conferirTokenDoAviso("t".repeat(48), ref, token), false);
    assert.equal(conferirTokenDoAviso("", ref, tokenDoAviso("", ref)), false);
    assert.equal(conferirTokenDoAviso(SEGREDO, ref, token + "A"), false);
    assert.equal(conferirTokenDoAviso(SEGREDO, ref, ""), false);
  });
});

describe("configuração", () => {
  it("handle: InfiniteTag sem $ e em minúsculas", () => {
    assert.ok(FORMATO_HANDLE.test("geleio"));
    assert.ok(!FORMATO_HANDLE.test("$geleio"));
    assert.ok(!FORMATO_HANDLE.test("Geleio"));
    assert.ok(!FORMATO_HANDLE.test("g"));
  });

  it("APP_URL: https, ou http só neste computador; sem usuário e senha", () => {
    assert.equal(origemPublicaDe("https://geleio.netlify.app/qualquer"), "https://geleio.netlify.app");
    assert.equal(origemPublicaDe("http://localhost:3100"), "http://localhost:3100");
    assert.equal(origemPublicaDe("http://geleio.netlify.app"), null);
    assert.equal(origemPublicaDe("https://u:s@geleio.netlify.app"), null);
    assert.equal(origemPublicaDe("javascript:alert(1)"), null);
    assert.equal(origemPublicaDe(undefined), null);
    assert.equal(origemPublicaDe("   "), null);
  });

  it("API de teste: só http em 127.0.0.1/localhost", () => {
    assert.equal(origemDeTesteDe("http://127.0.0.1:4010"), "http://127.0.0.1:4010");
    assert.equal(origemDeTesteDe("http://localhost:4010/x"), "http://localhost:4010");
    assert.equal(origemDeTesteDe("https://127.0.0.1:4010"), null);
    assert.equal(origemDeTesteDe("http://evil.com"), null);
    assert.equal(origemDeTesteDe("http://127.0.0.1.evil.com"), null);
    assert.equal(origemDeTesteDe(undefined), null);
  });

  it("data com o fuso de Brasília", () => {
    assert.equal(dataComFusoDeBrasilia(new Date("2026-10-21T18:30:00.000Z")), "2026-10-21T15:30:00.000-03:00");
    assert.equal(dataComFusoDeBrasilia(new Date("2026-10-22T01:00:00.000Z")), "2026-10-21T22:00:00.000-03:00");
  });
});

describe("corpo do link", () => {
  const itens = itensDoLink({
    avulsos: [
      { nome: "Pimenta, 112g", quantidade: 2, precoCentavos: 1500 },
      { nome: "Brinde", quantidade: 1, precoCentavos: 0 },
    ],
    kits: [{ nome: "Kit   Presente\n", quantidade: 1, precoCentavos: 4000 }],
    freteCentavos: 1500,
  });
  const entrada = (extra: Partial<EntradaDoLink> = {}): EntradaDoLink => ({
    handle: "geleio",
    referencia: referenciaDoPedido(PEDIDO, 1),
    itens,
    totalCentavos: 8500,
    urlRetorno: "https://geleio.netlify.app/pagamento/retorno",
    urlAviso: `https://geleio.netlify.app/api/webhooks/infinitepay/ped-${PEDIDO}-1/${tokenDoAviso(SEGREDO, `ped-${PEDIDO}-1`)}`,
    validoAte: new Date("2026-10-21T19:00:00.000Z"),
    cliente: { nome: "Maria", email: "maria@exemplo.com", telefone: "86999991234" },
    endereco: null,
    ...extra,
  });

  it("itens em centavos: linha de R$ 0 fica de fora; Entrega só com frete; descrição limpa", () => {
    assert.deepEqual(itens, [
      { description: "Pimenta, 112g", quantity: 2, price: 1500 },
      { description: "Kit Presente", quantity: 1, price: 4000 },
      { description: "Entrega", quantity: 1, price: 1500 },
    ]);
    assert.equal(somaDosItens(itens), 8500);
    assert.equal(itensDoLink({ avulsos: [], kits: [], freteCentavos: 0 }).length, 0);
    const longo = itensDoLink({ avulsos: [{ nome: "x".repeat(200), quantidade: 1, precoCentavos: 100 }], kits: [], freteCentavos: 0 });
    assert.equal(longo[0].description.length, 80);
  });

  it("monta o corpo com as opções certas e sem descontos", () => {
    const corpo = corpoDoLink(entrada());
    assert.equal(corpo.handle, "geleio");
    assert.equal(corpo.order_nsu, `ped-${PEDIDO}-1`);
    assert.equal(corpo.options.single_payment, true);
    assert.equal(corpo.options.valid_until, "2026-10-21T16:00:00.000-03:00");
    assert.equal(corpo.options.assured_installments, PARCELAS_SEM_JUROS);
    assert.equal(corpo.options.assured_installments, 0);
    assert.deepEqual(corpo.options.payment_methods_enabled, ["credit_card", "pix"]);
    assert.ok(!("discounts" in corpo.options));
    assert.ok(!JSON.stringify(corpo).includes("discount"));
    assert.ok(corpo.webhook_url.endsWith(`/ped-${PEDIDO}-1/${tokenDoAviso(SEGREDO, `ped-${PEDIDO}-1`)}`));
    assert.equal(corpo.customer.phone_number, "+5586999991234");
    assert.ok(!("address" in corpo), "retirada: sem endereço");
  });

  it("entrega leva o endereço; sem telefone, sem phone_number", () => {
    const corpo = corpoDoLink(
      entrada({
        cliente: { nome: "Maria", email: "maria@exemplo.com", telefone: null },
        endereco: { cep: "64035-420", rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Teresina", estado: "PI", complemento: null },
      }),
    );
    assert.ok(!("phone_number" in corpo.customer));
    assert.deepEqual((corpo as { address?: unknown }).address, {
      cep: "64035-420",
      street: "Rua A",
      number: "10",
      neighborhood: "Centro",
      city: "Teresina",
      state: "PI",
    });
  });

  it("recusa se a soma dos itens não fecha com o total, ou sem itens", () => {
    assert.throws(() => corpoDoLink(entrada({ totalCentavos: 8501 })), /soma/);
    assert.throws(() => corpoDoLink(entrada({ itens: [], totalCentavos: 0 })), /soma/);
  });
});

describe("URL da InfinitePay e resposta de /links", () => {
  it("allowlist: só https em infinitepay.io e subdomínios", () => {
    assert.equal(urlDaInfinitePay("https://checkout.infinitepay.io/geleio/abc"), "https://checkout.infinitepay.io/geleio/abc");
    assert.equal(urlDaInfinitePay("https://infinitepay.io/x"), "https://infinitepay.io/x");
    for (const ruim of [
      "http://checkout.infinitepay.io/x",
      "https://infinitepay.io.evil.com/x",
      "https://evilinfinitepay.io/x",
      "https://checkout.infinitepay.io:8443/x",
      "https://u:s@checkout.infinitepay.io/x",
      "javascript:alert(1)",
      "//checkout.infinitepay.io/x",
      "https://checkout.infinitepay.io/" + "x".repeat(500),
      42,
      null,
    ]) {
      assert.equal(urlDaInfinitePay(ruim), null, String(ruim));
    }
    assert.equal(urlDaInfinitePay("http://127.0.0.1:4010/pagar/a", { origemLocal: "http://127.0.0.1:4010" }), "http://127.0.0.1:4010/pagar/a");
    assert.equal(urlDaInfinitePay("http://127.0.0.1:4011/pagar/a", { origemLocal: "http://127.0.0.1:4010" }), null);
  });

  it("lê url, link ou checkout_url (no corpo ou em data) e o slug", () => {
    const u = "https://checkout.infinitepay.io/geleio/abc";
    assert.deepEqual(lerRespostaDoLink({ url: u, slug: "abc" }), { url: u, slug: "abc" });
    assert.deepEqual(lerRespostaDoLink({ link: u }), { url: u, slug: null });
    assert.deepEqual(lerRespostaDoLink({ checkout_url: u, invoice_slug: "x_1" }), { url: u, slug: "x_1" });
    assert.deepEqual(lerRespostaDoLink({ data: { url: u, slug: "abc" } }), { url: u, slug: "abc" });
    assert.deepEqual(lerRespostaDoLink({ url: u, slug: "com espaço" }), { url: u, slug: null });
  });

  it("formato real (ensaio de 2026-10-22): só { url }, sem slug", () => {
    const u = "https://checkout.infinitepay.io/geleio/aKVH6PwBdw";
    assert.deepEqual(lerRespostaDoLink({ url: u }), { url: u, slug: null });
  });

  it("recusa resposta sem URL válida", () => {
    assert.equal(lerRespostaDoLink({ url: "http://checkout.infinitepay.io/x" }), null);
    assert.equal(lerRespostaDoLink({ url: "https://evil.com/x" }), null);
    assert.equal(lerRespostaDoLink({ url: "javascript:alert(1)" }), null);
    assert.equal(lerRespostaDoLink({}), null);
    assert.equal(lerRespostaDoLink(null), null);
    assert.equal(lerRespostaDoLink([{ url: "https://checkout.infinitepay.io/x" }]), null);
  });
});

describe("payment_check", () => {
  const REF = referenciaDoPedido(PEDIDO, 1);
  const c = (extra: Record<string, unknown> = {}): Conferencia =>
    lerConferencia({ success: true, paid: true, amount: 3000, paid_amount: 3000, installments: 1, capture_method: "pix", ...extra })!;

  it("lê números e booleanos em texto; corpo em data; formato inesperado é null", () => {
    const lida = lerConferencia({ success: "true", paid: "true", amount: "3000", paid_amount: "3100", installments: "2", capture_method: "credit_card" });
    assert.deepEqual(
      { s: lida?.success, p: lida?.paid, a: lida?.amount, pa: lida?.paid_amount, i: lida?.installments },
      { s: true, p: true, a: 3000, pa: 3100, i: 2 },
    );
    assert.equal(lerConferencia({ data: { success: true, paid: false } })?.paid, false);
    assert.equal(lerConferencia({ success: true })?.paid, undefined, "paid ausente continua ausente");
    assert.equal(lerConferencia({ paid: true }), null, "sem success");
    assert.equal(lerConferencia({ success: true, amount: "30,00" }), null);
    assert.equal(lerConferencia({ success: true, amount: -1 }), null);
    assert.equal(lerConferencia({ success: true, amount: 10.5 }), null);
    assert.equal(lerConferencia("ok"), null);
    assert.equal(lerConferencia(null), null);
  });

  it("aprova com valor igual e com juros do parcelado (paid_amount maior)", () => {
    assert.deepEqual(classificarConferencia(c(), 3000, REF), { tipo: "APROVADO", metodo: "pix", parcelas: 1, valorPagoCentavos: 3000 });
    assert.deepEqual(classificarConferencia(c({ capture_method: "credit_card", installments: 3, paid_amount: 3240 }), 3000, REF), {
      tipo: "APROVADO",
      metodo: "credit_card",
      parcelas: 3,
      valorPagoCentavos: 3240,
    });
    assert.deepEqual(classificarConferencia(c({ installments: undefined }), 3000, REF), {
      tipo: "APROVADO",
      metodo: "pix",
      parcelas: 1,
      valorPagoCentavos: 3000,
    });
    assert.equal(classificarConferencia(c({ order_nsu: REF, currency: "brl" }), 3000, REF).tipo, "APROVADO");
  });

  it("divergências: valor, valor pago menor, moeda, método e parcelas", () => {
    assert.equal(divergenciaDaConferencia(c({ amount: 2999 }), 3000), "valor");
    assert.equal(divergenciaDaConferencia(c({ amount: 3001, paid_amount: 3001 }), 3000), "valor");
    assert.equal(divergenciaDaConferencia(c({ amount: undefined }), 3000), "valor");
    assert.equal(divergenciaDaConferencia(c({ paid_amount: 2990 }), 3000), "valor-pago");
    assert.equal(divergenciaDaConferencia(c({ paid_amount: undefined }), 3000), "valor-pago");
    assert.equal(divergenciaDaConferencia(c({ currency: "USD" }), 3000), "moeda");
    assert.equal(divergenciaDaConferencia(c({ capture_method: "boleto" }), 3000), "metodo");
    assert.equal(divergenciaDaConferencia(c({ capture_method: undefined }), 3000), "metodo");
    assert.equal(divergenciaDaConferencia(c({ capture_method: "credit_card", installments: 13 }), 3000), "parcelas");
    assert.equal(divergenciaDaConferencia(c({ capture_method: "credit_card", installments: 0 }), 3000), "parcelas");
    assert.equal(divergenciaDaConferencia(c({ installments: 2 }), 3000), "parcelas", "PIX não parcela");
    assert.deepEqual(classificarConferencia(c({ amount: 2999 }), 3000, REF), { tipo: "DIVERGENTE", motivo: "valor" });
  });

  it("campos nulos não quebram a leitura; no PIX, parcelas 0 ou nulas valem 1", () => {
    const nula = lerConferencia({ success: true, paid: false, amount: null, paid_amount: null, installments: null, capture_method: null });
    assert.ok(nula, "lê com nulos");
    assert.deepEqual(classificarConferencia(nula!, 3000, REF), { tipo: "NAO_PAGO" });
    assert.equal(divergenciaDaConferencia(c({ amount: null }), 3000), "valor");
    assert.equal(divergenciaDaConferencia(c({ paid_amount: null }), 3000), "valor-pago");
    assert.equal(divergenciaDaConferencia(c({ capture_method: null }), 3000), "metodo");
    for (const installments of [0, null, "0"]) {
      assert.deepEqual(classificarConferencia(c({ installments }), 3000, REF), {
        tipo: "APROVADO",
        metodo: "pix",
        parcelas: 1,
        valorPagoCentavos: 3000,
      }, String(installments));
    }
    assert.equal(divergenciaDaConferencia(c({ capture_method: "credit_card", installments: 0 }), 3000), "parcelas", "cartão com 0 parcelas não");
    assert.equal(classificarConferencia(c({ capture_method: "credit_card", installments: null }), 3000, REF).tipo, "APROVADO");
  });

  it("conferenciaAmarrada: só com o nosso order_nsu na resposta", () => {
    assert.equal(conferenciaAmarrada(c({ order_nsu: REF }), REF), true);
    assert.equal(conferenciaAmarrada(c(), REF), false);
    assert.equal(conferenciaAmarrada(c({ order_nsu: null }), REF), false);
    assert.equal(conferenciaAmarrada(c({ order_nsu: "" }), REF), false);
    assert.equal(conferenciaAmarrada(c({ order_nsu: referenciaDoPedido(PEDIDO, 2) }), REF), false);
  });

  it("success: false ou transação de outro pedido: INVALIDO; paid: false: NAO_PAGO", () => {
    assert.deepEqual(classificarConferencia(c({ success: false }), 3000, REF), { tipo: "INVALIDO" });
    assert.deepEqual(classificarConferencia(c({ order_nsu: referenciaDoPedido(PEDIDO, 2) }), 3000, REF), { tipo: "INVALIDO" });
    assert.deepEqual(classificarConferencia(c({ paid: false }), 3000, REF), { tipo: "NAO_PAGO" });
    assert.equal(classificarConferencia(c({ order_nsu: "" }), 3000, REF).tipo, "APROVADO", "order_nsu vazio não conta");
  });

  it("respostas reais (ensaio de 2026-10-22)", () => {
    // PIX de R$ 1 pago, consultado com o order_nsu certo: sem order_nsu nem moeda na resposta.
    const pix = lerConferencia({ success: true, paid: true, amount: 100, paid_amount: 100, installments: 1, capture_method: "pix" });
    assert.ok(pix);
    assert.deepEqual(classificarConferencia(pix, 100, REF), { tipo: "APROVADO", metodo: "pix", parcelas: 1, valorPagoCentavos: 100 });
    assert.equal(conferenciaAmarrada(pix, REF), false, "a API não devolve o order_nsu");
    // A mesma transação consultada com OUTRO order_nsu: "não pago", nunca divergência (sem alerta).
    const deOutroPedido = lerConferencia({ success: true, paid: false, amount: 0, paid_amount: 0, installments: null, capture_method: null });
    assert.ok(deOutroPedido);
    assert.deepEqual(classificarConferencia(deOutroPedido, 100, REF), { tipo: "NAO_PAGO" });
    assert.deepEqual(classificarConferencia(deOutroPedido, 0, REF), { tipo: "NAO_PAGO" }, "nem com valor 0");
    // O order_nsu certo com o slug errado: recusada.
    const slugErrado = lerConferencia({ success: false });
    assert.ok(slugErrado);
    assert.deepEqual(classificarConferencia(slugErrado, 100, REF), { tipo: "INVALIDO" });
  });
});

describe("aviso e retorno", () => {
  const TX1 = "0b9c6a4e-1f2d-4c3b-8a7e-5d6f7a8b9c01";
  const TX9 = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
  const receipt = `https://recibo.infinitepay.io/${TX1}`;

  it("aviso simples ou dentro de data; prefere invoice_slug; comprovante só da InfinitePay", () => {
    assert.deepEqual(lerAviso({ transaction_nsu: TX1, invoice_slug: "sl_1", order_nsu: "ped-a-1", receipt_url: receipt }), {
      transacaoNsu: TX1,
      slug: "sl_1",
      comprovanteUrl: receipt,
      referencia: "ped-a-1",
    });
    assert.equal(lerAviso({ data: { transaction_nsu: "tx-1", slug: "sl_1" } })?.slug, "sl_1");
    assert.equal(lerAviso({ transaction_nsu: TX1, slug: "sl_1", receipt_url: "https://evil.com/r" })?.comprovanteUrl, null);
    // Recibo de OUTRA transação: não grava.
    assert.equal(lerAviso({ transaction_nsu: TX9, slug: "sl_1", receipt_url: receipt })?.comprovanteUrl, null);
    assert.equal(lerAviso({ transaction_nsu: "tx-1", slug: "sl_1" })?.referencia, null);
  });

  it("aviso sem transação ou slug válidos: null", () => {
    assert.equal(lerAviso({ transaction_nsu: "tx-1" }), null);
    assert.equal(lerAviso({ invoice_slug: "sl" }), null);
    assert.equal(lerAviso({ transaction_nsu: "tx 1", slug: "sl" }), null);
    assert.equal(lerAviso({ transaction_nsu: "t".repeat(101), slug: "sl" }), null);
    assert.equal(lerAviso({ transaction_nsu: 123, slug: "sl" }), null);
    assert.equal(lerAviso("texto"), null);
    assert.equal(lerAviso(undefined), null);
  });

  it("retorno: referência e candidato da query", () => {
    const recibo9 = `https://recibo.infinitepay.io/${TX9}`;
    const q = new URLSearchParams({ order_nsu: "ped-a-1", transaction_nsu: TX9, slug: "sl-9", capture_method: "pix", receipt_url: recibo9 });
    assert.deepEqual(lerRetorno(q), {
      referencia: "ped-a-1",
      candidato: { transacaoNsu: TX9, slug: "sl-9", comprovanteUrl: recibo9, referencia: "ped-a-1" },
    });
    // O recibo de outra transação, na query, não vale (a confirmação segue, sem comprovante).
    q.set("receipt_url", receipt);
    assert.equal(lerRetorno(q).candidato?.comprovanteUrl, null);
    assert.equal(lerRetorno(new URLSearchParams({ order_nsu: "ped-a-1", transaction_nsu: "tx-9", invoice_slug: "s2" })).candidato?.slug, "s2");
  });

  it("retorno no formato real (ensaio de 2026-10-22): transação em UUID, comprovante em recibo.infinitepay.io", () => {
    const tx = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";
    const recibo = `https://recibo.infinitepay.io/${tx}`;
    const q = new URLSearchParams({
      capture_method: "pix",
      transaction_id: tx,
      transaction_nsu: tx,
      slug: "sKXhSekbqG",
      order_nsu: "ped-a-1",
      receipt_url: recibo,
    });
    assert.deepEqual(lerRetorno(q), {
      referencia: "ped-a-1",
      candidato: { transacaoNsu: tx, slug: "sKXhSekbqG", comprovanteUrl: recibo, referencia: "ped-a-1" },
    });
  });

  it("retorno sem transação: só a referência; referência longa demais: null", () => {
    assert.deepEqual(lerRetorno(new URLSearchParams({ order_nsu: "ped-a-1" })), { referencia: "ped-a-1", candidato: null });
    assert.equal(lerRetorno(new URLSearchParams({ order_nsu: "x".repeat(65) })).referencia, null);
    assert.equal(lerRetorno(new URLSearchParams()).referencia, null);
    assert.equal(lerRetorno(new URLSearchParams({ order_nsu: "ped-a-1", transaction_nsu: "<script>", slug: "s" })).candidato, null);
  });
});

describe("recibo da transação (receipt_url)", () => {
  const tx = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";
  it("só https://recibo.infinitepay.io/<uuid da própria transação>", () => {
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io/${tx}`, tx), `https://recibo.infinitepay.io/${tx}`);
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io/${tx.toUpperCase()}`, tx) !== null, true, "maiúsculas no uuid");
  });
  it("recusa outro host, outro caminho, outra transação, http, porta, query, credenciais e lixo", () => {
    const recusados = [
      `https://evil.example/${tx}`,
      `https://checkout.infinitepay.io/${tx}`,
      `https://recibo.infinitepay.io.evil.example/${tx}`,
      `https://recibo.infinitepay.io/recibo/${tx}`,
      `https://recibo.infinitepay.io/${tx}/x`,
      "https://recibo.infinitepay.io/0b9c6a4e-1f2d-4c3b-8a7e-5d6f7a8b9c01",
      `http://recibo.infinitepay.io/${tx}`,
      `https://recibo.infinitepay.io:8443/${tx}`,
      `https://recibo.infinitepay.io/${tx}?a=1`,
      `https://recibo.infinitepay.io/${tx}#x`,
      `https://user:pw@recibo.infinitepay.io/${tx}`,
      "nada",
      42,
      null,
    ];
    for (const r of recusados) assert.equal(urlDoRecibo(r, tx), null, String(r));
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io/tx_1`, "tx_1"), null, "transação que não é UUID");
  });
  it("formas da mesma URL: host em maiúsculas e :443 valem (normalizados); ponto no fim, IDN, //, /uuid/ e %-codificado não", () => {
    const canonica = `https://recibo.infinitepay.io/${tx}`;
    assert.equal(urlDoRecibo(`https://RECIBO.InfinitePay.IO/${tx}`, tx), canonica, "host em maiúsculas");
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io:443/${tx}`, tx), canonica, ":443 é a porta padrão");
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io./${tx}`, tx), null, "ponto no fim do host");
    assert.equal(urlDoRecibo(`https://recıbo.infinitepay.io/${tx}`, tx), null, "IDN: i sem ponto (recıbo)");
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io//${tx}`, tx), null, "barra dupla");
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io/${tx}/`, tx), null, "barra no fim");
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io/%33f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c`, tx), null, "uuid codificado com %");
    assert.equal(urlDoRecibo(`https://recibo.infinitepay.io/${tx}%2F`, tx), null);
    assert.equal(urlDoRecibo(` https://recibo.infinitepay.io/${tx}`, tx) === canonica, true, "espaço no começo é descartado pelo URL");
  });
  it("servidor falso dos testes: <origem>/recibo/<uuid>, só com origemLocal", () => {
    const local = "http://127.0.0.1:4030";
    assert.equal(urlDoRecibo(`${local}/recibo/${tx}`, tx, { origemLocal: local }), `${local}/recibo/${tx}`);
    assert.equal(urlDoRecibo(`${local}/recibo/${tx}`, tx), null);
    assert.equal(urlDoRecibo(`${local}/outra/${tx}`, tx, { origemLocal: local }), null);
  });
});

describe("canário de amarração do retorno", () => {
  const conferencia = (c: Record<string, unknown>) => lerConferencia(c);
  it("o canário consulta um order_nsu que não é referência nossa", () => {
    assert.equal(referenciaDoCanario("ped-abc-1"), "ped-abc-1-x");
    assert.equal(lerReferencia(referenciaDoCanario("ped-abc-1")), null);
    assert.equal(lerReferencia(referenciaDoCanario("enc-abc-ENTRADA-2")), null);
  });
  it("o formato real para um order_nsu inexistente (success=true, paid=false, zeros): AMARRA", () => {
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: false, amount: 0, paid_amount: 0, installments: null, capture_method: null })), "AMARRA");
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: false })), "AMARRA", "valores ausentes, paid explícito");
    assert.equal(decisaoDoCanario(conferencia({ data: { success: true, paid: false, amount: 0, paid_amount: 0 } })), "AMARRA", "dentro de data");
    assert.equal(decisaoDoCanario(conferencia({ success: "true", paid: "false", amount: "0" })), "AMARRA", "textos");
  });
  it("qualquer sinal de pagamento: NAO_AMARRA, não confirma pelo retorno", () => {
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: true, amount: 1500, paid_amount: 1500, installments: 1, capture_method: "pix" })), "NAO_AMARRA");
    assert.equal(decisaoDoCanario(conferencia({ success: false, paid: true })), "NAO_AMARRA", "success=false com paid=true");
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: "true" })), "NAO_AMARRA", 'paid como texto "true"');
    assert.equal(decisaoDoCanario(conferencia({ data: { success: true, paid: true } })), "NAO_AMARRA", "dentro de data");
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: false, amount: 1500 })), "NAO_AMARRA", "paid=false mas com amount");
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: false, paid_amount: 1 })), "NAO_AMARRA", "paid=false mas com paid_amount");
    assert.equal(decisaoDoCanario(conferencia({ success: true, amount: 1500 })), "NAO_AMARRA", "paid ausente mas com amount");
  });
  it("sem resposta válida ou formato estranho: FALHOU, não confirma (fail-closed)", () => {
    assert.equal(decisaoDoCanario(null), "FALHOU");
    assert.equal(decisaoDoCanario(conferencia({ formato: "estranho" })), "FALHOU");
    assert.equal(decisaoDoCanario(conferencia({ paid: false })), "FALHOU", "sem success");
    assert.equal(decisaoDoCanario(conferencia({ success: true })), "FALHOU", "paid ausente e valores ausentes");
    assert.equal(decisaoDoCanario(conferencia({ success: true, amount: 0, paid_amount: 0 })), "FALHOU", "paid ausente, valores zerados");
    assert.equal(decisaoDoCanario(conferencia({ success: false })), "FALHOU", "success=false sem pagamento");
    assert.equal(decisaoDoCanario(conferencia({ success: false, paid: false })), "FALHOU");
    assert.equal(decisaoDoCanario(conferencia({ success: true, paid: "talvez" })), "FALHOU", "paid que não é booleano");
  });
});
