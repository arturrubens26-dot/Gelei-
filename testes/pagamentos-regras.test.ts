import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JANELA_CONFIRMANDO_MS,
  MARCA_DIVERGENTE,
  PRAZO_PARA_PAGAR_MS,
  alertaDoPagamento,
  cobrancaDivergente,
  cobrancaParaEtapa,
  etapaDoPagamento,
  pagamentoAdminDe,
  type EntradaPagamentoAdmin,
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

describe("divergência e cobrança que decide a etapa", () => {
  it("pago com divergência: CONFIRMANDO sem prazo, mesmo expirado ou com o gateway desligado; pago e cancelado mandam", () => {
    const limite = criado.getTime() + PRAZO_PARA_PAGAR_MS;
    assert.equal(etapaDoPagamento(base({ pagamentoDivergente: true })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ pagamentoDivergente: true, agora: limite + 10 * 24 * 3600_000 })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ pagamentoDivergente: true, gatewayAtivo: false })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ pagamentoDivergente: true, pedidoStatus: "PAGO" })), "PAGO");
    assert.equal(etapaDoPagamento(base({ pagamentoDivergente: true, pedidoStatus: "CANCELADO" })), "CANCELADO");
  });

  it("cobrancaDivergente: marca divergente:* e ainda não aprovada", () => {
    assert.equal(cobrancaDivergente({ status: "PENDENTE", statusGateway: `${MARCA_DIVERGENTE}valor` }), true);
    assert.equal(cobrancaDivergente({ status: "CANCELADO", statusGateway: `${MARCA_DIVERGENTE}parcelas` }), true);
    assert.equal(cobrancaDivergente({ status: "APROVADO", statusGateway: `${MARCA_DIVERGENTE}valor` }), false);
    assert.equal(cobrancaDivergente({ status: "PENDENTE", statusGateway: "nao-pago" }), false);
    assert.equal(cobrancaDivergente({ status: "PENDENTE", statusGateway: null }), false);
  });

  it("cobrancaParaEtapa: a mais recente COM candidato na janela; senão, a mais recente", () => {
    const agora = criado.getTime() + 60 * 60_000;
    const nova = { id: "nova", status: "PENDENTE" as const, avisadoEm: null };
    const antigaComCandidato = { id: "antiga", status: "CANCELADO" as const, avisadoEm: new Date(agora - 60_000) };
    const velhaForaDaJanela = { id: "velha", status: "CANCELADO" as const, avisadoEm: new Date(agora - JANELA_CONFIRMANDO_MS - 1) };
    assert.equal(cobrancaParaEtapa([nova, antigaComCandidato, velhaForaDaJanela], agora)?.id, "antiga");
    assert.equal(cobrancaParaEtapa([nova, velhaForaDaJanela], agora)?.id, "nova");
    // Cobrança aprovada não está "em confirmação": volta a valer a mais recente.
    assert.equal(cobrancaParaEtapa([nova, { ...antigaComCandidato, status: "APROVADO" as const }], agora)?.id, "nova");
    assert.equal(cobrancaParaEtapa([], agora), null);
    const etapa = etapaDoPagamento(base({ agora, ultimaCobranca: cobrancaParaEtapa([nova, antigaComCandidato], agora) }));
    assert.equal(etapa, "CONFIRMANDO");
  });

  it("alerta PAGO_COM_DIVERGENCIA: sozinho, ou depois dos de devolução", () => {
    assert.deepEqual(pagamentoAdminDe({ pedidoStatus: "PENDENTE", canceladoEm: null, aprovadas: [], divergente: true }), {
      metodo: null,
      parcelas: null,
      valorPago: null,
      alerta: "PAGO_COM_DIVERGENCIA",
    });
    const aprovada = { metodo: "pix", parcelas: 1, valorPago: 30, aprovadoEm: criado };
    assert.equal(alertaDoPagamento({ pedidoStatus: "PAGO", canceladoEm: null, aprovadas: [aprovada], divergente: true }), "PAGO_COM_DIVERGENCIA");
    assert.equal(alertaDoPagamento({ pedidoStatus: "PAGO", canceladoEm: null, aprovadas: [aprovada, aprovada], divergente: true }), "PAGO_EM_DOBRO");
    assert.equal(alertaDoPagamento({ pedidoStatus: "PAGO", canceladoEm: null, aprovadas: [aprovada], divergente: false }), null);
  });
});

describe("prazo e rótulos", () => {
  it("pagarAte = criado + 48 h; pedidoExpirado só depois disso", () => {
    assert.equal(pagarAteDe(criado).toISOString(), "2026-10-23T12:00:00.000Z");
    assert.equal(pagarAteDe(criado.toISOString()).getTime(), criado.getTime() + PRAZO_PARA_PAGAR_MS);
    assert.equal(pedidoExpirado(criado, criado.getTime() + PRAZO_PARA_PAGAR_MS), false);
    assert.equal(pedidoExpirado(criado, criado.getTime() + PRAZO_PARA_PAGAR_MS + 1), true);
  });

  it("alerta do painel: pago depois do cancelamento, cancelado depois de pago, pago em dobro", () => {
    const t = (min: number) => new Date(criado.getTime() + min * 60_000);
    const aprovada = (min: number | null) => ({ metodo: "pix", parcelas: 1, valorPago: 30, aprovadoEm: min === null ? null : t(min) });
    const e = (extra: Partial<EntradaPagamentoAdmin>): EntradaPagamentoAdmin => ({
      pedidoStatus: "PAGO",
      canceladoEm: null,
      aprovadas: [aprovada(10)],
      ...extra,
    });
    assert.equal(alertaDoPagamento(e({})), null);
    assert.equal(alertaDoPagamento(e({ aprovadas: [] })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(5) })), "PAGO_APOS_CANCELAMENTO");
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(20) })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: null })), "PAGO_APOS_CANCELAMENTO");
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(20).toISOString(), aprovadas: [aprovada(null)] })), "PAGO_APOS_CANCELAMENTO");
    assert.equal(alertaDoPagamento(e({ aprovadas: [aprovada(10), aprovada(12)] })), "PAGO_EM_DOBRO");
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(30), aprovadas: [aprovada(10), aprovada(12)] })), "PAGO_EM_DOBRO");
  });

  it("pagamentoAdminDe: a primeira cobrança aprovada; sem aprovada, null", () => {
    assert.equal(pagamentoAdminDe({ pedidoStatus: "PENDENTE", canceladoEm: null, aprovadas: [] }), null);
    assert.deepEqual(
      pagamentoAdminDe({
        pedidoStatus: "PAGO",
        canceladoEm: null,
        aprovadas: [
          { metodo: "credit_card", parcelas: 3, valorPago: 32.4, aprovadoEm: criado },
          { metodo: "pix", parcelas: 1, valorPago: 30, aprovadoEm: criado },
        ],
      }),
      { metodo: "credit_card", parcelas: 3, valorPago: 32.4, alerta: "PAGO_EM_DOBRO" },
    );
    assert.equal(pagamentoAdminDe({ pedidoStatus: "PAGO", canceladoEm: null, aprovadas: [{ metodo: "boleto", parcelas: null, valorPago: null, aprovadoEm: null }] })?.metodo, null);
  });

  it("rótulo do método", () => {
    assert.equal(rotuloDoMetodo("pix", null), "PIX");
    assert.equal(rotuloDoMetodo("credit_card", 1), "Cartão à vista");
    assert.equal(rotuloDoMetodo("credit_card", 3), "Cartão em 3x");
    assert.equal(rotuloDoMetodo(null, null), null);
  });
});
