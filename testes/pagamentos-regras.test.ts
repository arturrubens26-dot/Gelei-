import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JANELA_CONFIRMANDO_MS,
  PRAZO_PARA_PAGAR_MS,
  etapaDoPagamento,
  pagarAteDe,
  pedidoExpirado,
  rotuloDoMetodo,
  type EntradaEtapa,
} from "../src/lib/pagamentos-regras";

const criado = new Date("2026-10-21T12:00:00.000Z");
const base = (extra: Partial<EntradaEtapa> = {}): EntradaEtapa => ({
  gatewayAtivo: true,
  pedidoStatus: "PENDENTE",
  pedidoCriadoEm: criado,
  ultimaCobranca: null,
  agora: criado.getTime() + 60_000,
  ...extra,
});

describe("etapaDoPagamento", () => {
  it("pedido pago, enviado ou entregue: PAGO (mesmo com o gateway desligado)", () => {
    for (const pedidoStatus of ["PAGO", "ENVIADO", "ENTREGUE"] as const) {
      assert.equal(etapaDoPagamento(base({ pedidoStatus, gatewayAtivo: false })), "PAGO");
    }
  });

  it("pedido cancelado: CANCELADO", () => {
    assert.equal(etapaDoPagamento(base({ pedidoStatus: "CANCELADO" })), "CANCELADO");
  });

  it("pendente com o gateway desligado: INDISPONIVEL", () => {
    assert.equal(etapaDoPagamento(base({ gatewayAtivo: false })), "INDISPONIVEL");
  });

  it("pendente sem cobrança ou com cobrança sem candidato: PAGAR", () => {
    assert.equal(etapaDoPagamento(base()), "PAGAR");
    assert.equal(etapaDoPagamento(base({ ultimaCobranca: { status: "PENDENTE", avisadoEm: null } })), "PAGAR");
  });

  it("candidato gravado há menos de 30 min: CONFIRMANDO; no limite, volta a PAGAR", () => {
    const agora = criado.getTime() + 10 * 60_000;
    const cobranca = (ha: number) => ({ status: "PENDENTE" as const, avisadoEm: new Date(agora - ha) });
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(0) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(JANELA_CONFIRMANDO_MS - 1) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(JANELA_CONFIRMANDO_MS) })), "PAGAR");
    // Data no futuro (relógio torto): não fica "confirmando" para sempre.
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(-60_000) })), "PAGAR");
    // Aceita ISO em texto (vem do JSON).
    assert.equal(
      etapaDoPagamento(base({ agora, ultimaCobranca: { status: "PENDENTE", avisadoEm: new Date(agora).toISOString() } })),
      "CONFIRMANDO",
    );
  });

  it("cobrança aprovada não deixa em CONFIRMANDO (o pedido manda)", () => {
    const agora = criado.getTime() + 60_000;
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: { status: "APROVADO", avisadoEm: new Date(agora) } })), "PAGAR");
  });

  it("48 h: até o limite PAGAR, depois EXPIRADO; CONFIRMANDO vem antes do prazo", () => {
    const limite = criado.getTime() + PRAZO_PARA_PAGAR_MS;
    assert.equal(etapaDoPagamento(base({ agora: limite })), "PAGAR");
    assert.equal(etapaDoPagamento(base({ agora: limite + 1 })), "EXPIRADO");
    assert.equal(
      etapaDoPagamento(base({ agora: limite + 1, ultimaCobranca: { status: "PENDENTE", avisadoEm: new Date(limite - 60_000) } })),
      "CONFIRMANDO",
    );
    assert.equal(etapaDoPagamento(base({ agora: limite + 1, gatewayAtivo: false })), "INDISPONIVEL");
  });
});

describe("prazo e rótulos", () => {
  it("pagarAte = criado + 48 h; pedidoExpirado só depois disso", () => {
    assert.equal(pagarAteDe(criado).toISOString(), "2026-10-23T12:00:00.000Z");
    assert.equal(pagarAteDe(criado.toISOString()).getTime(), criado.getTime() + PRAZO_PARA_PAGAR_MS);
    assert.equal(pedidoExpirado(criado, criado.getTime() + PRAZO_PARA_PAGAR_MS), false);
    assert.equal(pedidoExpirado(criado, criado.getTime() + PRAZO_PARA_PAGAR_MS + 1), true);
  });

  it("rótulo do método", () => {
    assert.equal(rotuloDoMetodo("pix", null), "PIX");
    assert.equal(rotuloDoMetodo("credit_card", 1), "Cartão à vista");
    assert.equal(rotuloDoMetodo("credit_card", 3), "Cartão em 3x");
    assert.equal(rotuloDoMetodo(null, null), null);
  });
});
