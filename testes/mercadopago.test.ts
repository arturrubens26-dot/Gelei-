import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assinaturaDoAvisoValida,
  corpoDaCobrancaPix,
  dataParaMercadoPago,
  divergenciaDoPagamento,
  pagamentoMercadoPagoSchema,
  statusDoMercadoPago,
} from "../src/lib/mercadopago-regras";

const SEGREDO = "segredo-de-teste";
const assinar = (manifesto: string) => createHmac("sha256", SEGREDO).update(manifesto).digest("hex");

describe("assinatura do aviso do Mercado Pago", () => {
  it("aceita a assinatura calculada sobre id, request-id e ts", () => {
    const v1 = assinar("id:123456;request-id:abc-1;ts:1742505638683;");
    assert.equal(
      assinaturaDoAvisoValida({ cabecalho: `ts=1742505638683,v1=${v1}`, requestId: "abc-1", dataId: "123456", segredo: SEGREDO }),
      true,
    );
  });

  it("aceita espaços no cabeçalho e id alfanumérico em minúsculas", () => {
    const v1 = assinar("id:ord01abc;request-id:r;ts:1;");
    assert.equal(assinaturaDoAvisoValida({ cabecalho: ` ts=1 , v1=${v1} `, requestId: "r", dataId: "ORD01ABC", segredo: SEGREDO }), true);
  });

  it("tira do manifesto as partes que não vieram", () => {
    const v1 = assinar("id:99;ts:5;");
    assert.equal(assinaturaDoAvisoValida({ cabecalho: `ts=5,v1=${v1}`, requestId: null, dataId: "99", segredo: SEGREDO }), true);
  });

  it("recusa id trocado, segredo errado, cabeçalho ausente ou malformado", () => {
    const v1 = assinar("id:123456;request-id:abc-1;ts:1;");
    const base = { cabecalho: `ts=1,v1=${v1}`, requestId: "abc-1", dataId: "123456", segredo: SEGREDO };
    assert.equal(assinaturaDoAvisoValida({ ...base, dataId: "123457" }), false);
    assert.equal(assinaturaDoAvisoValida({ ...base, segredo: "outro" }), false);
    assert.equal(assinaturaDoAvisoValida({ ...base, cabecalho: null }), false);
    assert.equal(assinaturaDoAvisoValida({ ...base, cabecalho: `ts=1,v1=${v1.slice(0, 10)}` }), false);
    assert.equal(assinaturaDoAvisoValida({ ...base, cabecalho: `v1=${v1}` }), false);
    assert.equal(assinaturaDoAvisoValida({ ...base, segredo: "" }), false);
  });
});

describe("status do Mercado Pago", () => {
  it("traduz os status conhecidos e trata o desconhecido como pendente", () => {
    assert.equal(statusDoMercadoPago("approved"), "APROVADO");
    assert.equal(statusDoMercadoPago("in_mediation"), "APROVADO");
    assert.equal(statusDoMercadoPago("cancelled"), "CANCELADO");
    assert.equal(statusDoMercadoPago("rejected"), "RECUSADO");
    assert.equal(statusDoMercadoPago("refunded"), "ESTORNADO");
    assert.equal(statusDoMercadoPago("charged_back"), "ESTORNADO");
    assert.equal(statusDoMercadoPago("pending"), "PENDENTE");
    assert.equal(statusDoMercadoPago("in_process"), "PENDENTE");
    assert.equal(statusDoMercadoPago("algo_novo"), "PENDENTE");
  });
});

describe("cobrança PIX", () => {
  it("data de vencimento no horário de Brasília", () => {
    assert.equal(dataParaMercadoPago(new Date("2026-10-19T18:30:00.000Z")), "2026-10-19T15:30:00.000-03:00");
    assert.equal(dataParaMercadoPago(new Date("2026-10-20T01:05:09.120Z")), "2026-10-19T22:05:09.120-03:00");
  });

  it("monta o corpo com o pedido como referência e o primeiro nome do cliente", () => {
    const corpo = corpoDaCobrancaPix({
      pedidoId: "ped1",
      valor: 51.8,
      descricao: "Geleiô - pedido X",
      email: "cliente@exemplo.com",
      nome: "  Maria  da Silva ",
      expiraEm: new Date("2026-10-19T18:30:00.000Z"),
    });
    assert.deepEqual(corpo, {
      transaction_amount: 51.8,
      description: "Geleiô - pedido X",
      payment_method_id: "pix",
      external_reference: "ped1",
      date_of_expiration: "2026-10-19T15:30:00.000-03:00",
      payer: { email: "cliente@exemplo.com", first_name: "Maria" },
    });
    const comAviso = corpoDaCobrancaPix({ pedidoId: "p", valor: 1, descricao: "d", email: "e@x.com", nome: "A", expiraEm: new Date(0), urlNotificacao: "https://x/y" });
    assert.equal(comAviso.notification_url, "https://x/y");
  });

  it("só aceita o aprovado se pedido, valor, moeda e forma conferem", () => {
    const ok = { external_reference: "p1", transaction_amount: 51.8, currency_id: "BRL", payment_method_id: "pix" };
    const esperado = { pedidoId: "p1", valor: 51.8 };
    assert.equal(divergenciaDoPagamento(ok, esperado), null);
    // 0.1 + 0.2: comparação em centavos, sem erro de ponto flutuante.
    assert.equal(divergenciaDoPagamento({ ...ok, transaction_amount: 0.1 + 0.2 }, { pedidoId: "p1", valor: 0.3 }), null);
    assert.equal(divergenciaDoPagamento({ ...ok, external_reference: "p2" }, esperado), "pedido diferente");
    assert.equal(divergenciaDoPagamento({ ...ok, external_reference: null }, esperado), "pedido diferente");
    assert.equal(divergenciaDoPagamento({ ...ok, transaction_amount: 51.79 }, esperado), "valor diferente");
    assert.equal(divergenciaDoPagamento({ ...ok, currency_id: "USD" }, esperado), "moeda diferente");
    assert.equal(divergenciaDoPagamento({ ...ok, payment_method_id: "visa" }, esperado), "forma de pagamento diferente");
  });

  it("lê a resposta do Mercado Pago e recusa id fora do formato", () => {
    const lido = pagamentoMercadoPagoSchema.parse({
      id: 1234567890,
      status: "pending",
      transaction_amount: 10,
      point_of_interaction: { transaction_data: { qr_code: "000201...", qr_code_base64: "iVBOR" } },
      outro_campo: true,
    });
    assert.equal(lido.id, "1234567890");
    assert.equal(lido.point_of_interaction?.transaction_data?.qr_code, "000201...");
    assert.equal(pagamentoMercadoPagoSchema.safeParse({ id: "../x", status: "pending", transaction_amount: 1 }).success, false);
  });
});
