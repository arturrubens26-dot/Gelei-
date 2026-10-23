import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JANELA_CONFIRMANDO_MS,
  MARCA_APOS_BAIXA_MANUAL,
  MARCA_NAO_PAGO,
  MARCA_DIVERGENTE,
  PRAZO_PARA_PAGAR_MS,
  alertaDoPagamento,
  cobrancaDivergente,
  cobrancaParaEtapa,
  etapaDoPagamento,
  pagamentoAdminDe,
  pagarAteDe,
  painelDoPagamento,
  pedidoExpirado,
  retornoRecente,
  rotuloDoMetodo,
  type CobrancaNoPainel,
  type EntradaEtapa,
  type EntradaPagamentoAdmin,
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

  it("candidato do aviso não resolvido: CONFIRMANDO de qualquer idade (nunca volta a PAGAR sozinho)", () => {
    const agora = criado.getTime() + 10 * 60_000;
    const cobranca = (ha: number) => ({ status: "PENDENTE" as const, avisadoEm: new Date(agora - ha) });
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(0) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(JANELA_CONFIRMANDO_MS) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobranca(5 * 24 * 3600_000) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: { status: "CANCELADO", avisadoEm: new Date(agora).toISOString() } })), "CONFIRMANDO");
  });

  it("retorno do navegador: CONFIRMANDO por 30 min, depois volta a PAGAR", () => {
    const agora = criado.getTime() + 10 * 60_000;
    const retorno = (ha: number) => ({ status: "PENDENTE" as const, avisadoEm: null, retornoEm: new Date(agora - ha) });
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: retorno(0) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: retorno(JANELA_CONFIRMANDO_MS - 1) })), "CONFIRMANDO");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: retorno(JANELA_CONFIRMANDO_MS) })), "PAGAR");
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: retorno(-60_000) })), "PAGAR", "relógio torto");
    assert.equal(retornoRecente(null, agora), false);
  });

  it("cobrança aprovada não deixa em CONFIRMANDO (o pedido manda)", () => {
    const agora = criado.getTime() + 60_000;
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: { status: "APROVADO", avisadoEm: new Date(agora), retornoEm: new Date(agora) } })), "PAGAR");
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

  it("cobrancaParaEtapa: a mais recente em confirmação (aviso de qualquer idade ou retorno recente); senão, a mais recente", () => {
    const agora = criado.getTime() + 60 * 60_000;
    const nova = { id: "nova", status: "PENDENTE" as const, avisadoEm: null };
    const antigaComAviso = { id: "antiga", status: "CANCELADO" as const, avisadoEm: new Date(agora - 3 * JANELA_CONFIRMANDO_MS) };
    const comRetorno = { id: "retorno", status: "CANCELADO" as const, avisadoEm: null, retornoEm: new Date(agora - 60_000) };
    const retornoVelho = { id: "velho", status: "CANCELADO" as const, avisadoEm: null, retornoEm: new Date(agora - JANELA_CONFIRMANDO_MS) };
    assert.equal(cobrancaParaEtapa([nova, antigaComAviso], agora)?.id, "antiga");
    assert.equal(cobrancaParaEtapa([nova, comRetorno, antigaComAviso], agora)?.id, "retorno");
    assert.equal(cobrancaParaEtapa([nova, retornoVelho], agora)?.id, "nova");
    // Cobrança aprovada não está "em confirmação": volta a valer a mais recente.
    assert.equal(cobrancaParaEtapa([nova, { ...antigaComAviso, status: "APROVADO" as const }], agora)?.id, "nova");
    assert.equal(cobrancaParaEtapa([], agora), null);
    assert.equal(etapaDoPagamento(base({ agora, ultimaCobranca: cobrancaParaEtapa([nova, antigaComAviso], agora) })), "CONFIRMANDO");
  });
});

describe("painel: alertas, pagamento e expirado", () => {
  const t = (min: number) => new Date(criado.getTime() + min * 60_000);
  const cobranca = (extra: Partial<CobrancaNoPainel> = {}): CobrancaNoPainel => ({
    status: "APROVADO",
    statusGateway: "pago",
    metodo: "pix",
    parcelas: 1,
    valorPago: 30,
    aprovadoEm: t(10),
    avisadoEm: null,
    ...extra,
  });
  const e = (extra: Partial<EntradaPagamentoAdmin> = {}): EntradaPagamentoAdmin => ({
    pedidoStatus: "PAGO",
    canceladoEm: null,
    cobrancas: [cobranca()],
    agora: t(60).getTime(),
    ...extra,
  });

  it("pago depois do cancelamento, cancelado depois de pago, pago em dobro", () => {
    assert.equal(alertaDoPagamento(e()), null);
    assert.equal(alertaDoPagamento(e({ cobrancas: [] })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(5) })), "PAGO_APOS_CANCELAMENTO");
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(20) })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: null })), "PAGO_APOS_CANCELAMENTO");
    assert.equal(
      alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(20).toISOString(), cobrancas: [cobranca({ aprovadoEm: null })] })),
      "PAGO_APOS_CANCELAMENTO",
    );
    assert.equal(alertaDoPagamento(e({ cobrancas: [cobranca(), cobranca({ aprovadoEm: t(12) })] })), "PAGO_EM_DOBRO");
    assert.equal(
      alertaDoPagamento(e({ pedidoStatus: "CANCELADO", canceladoEm: t(30), cobrancas: [cobranca(), cobranca({ aprovadoEm: t(12) })] })),
      "PAGO_EM_DOBRO",
    );
  });

  it("confirmado depois de a dona marcar pago à mão: alerta informativo", () => {
    assert.equal(alertaDoPagamento(e({ cobrancas: [cobranca({ statusGateway: MARCA_APOS_BAIXA_MANUAL })] })), "CONFIRMADO_APOS_BAIXA_MANUAL");
  });

  it("PAGO_COM_DIVERGENCIA e AVISO_NAO_CONFERIDO só com o pedido PENDENTE (somem quando a dona resolve)", () => {
    const divergente = cobranca({ status: "PENDENTE", statusGateway: `${MARCA_DIVERGENTE}valor`, metodo: null, valorPago: null, aprovadoEm: null });
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PENDENTE", cobrancas: [divergente] })), "PAGO_COM_DIVERGENCIA");
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PAGO", cobrancas: [divergente] })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "CANCELADO", cobrancas: [divergente] })), null);

    const aviso = (min: number) => cobranca({ status: "PENDENTE", statusGateway: "aberto", metodo: null, valorPago: null, aprovadoEm: null, avisadoEm: t(min) });
    // agora = t(60): aviso de t(40) tem 20 min (ainda não alerta); de t(20), 40 min (alerta).
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PENDENTE", cobrancas: [aviso(40)] })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PENDENTE", cobrancas: [aviso(20)] })), "AVISO_NAO_CONFERIDO");
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PAGO", cobrancas: [aviso(20)] })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PENDENTE", cobrancas: [aviso(20), divergente] })), "PAGO_COM_DIVERGENCIA");
    // "Não pago" é uma resposta da InfinitePay, não uma conferência parada: sem alerta.
    const naoPago = (min: number) => cobranca({ status: "PENDENTE", statusGateway: MARCA_NAO_PAGO, metodo: null, valorPago: null, aprovadoEm: null, avisadoEm: t(min) });
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PENDENTE", cobrancas: [naoPago(20)] })), null);
    assert.equal(alertaDoPagamento(e({ pedidoStatus: "PENDENTE", cobrancas: [naoPago(20), aviso(20)] })), "AVISO_NAO_CONFERIDO", "outra cobrança parada continua alertando");
  });

  it("pagamentoAdminDe: a primeira cobrança aprovada; só com alerta, campos nulos; sem nada, null", () => {
    assert.equal(pagamentoAdminDe(e({ pedidoStatus: "PENDENTE", cobrancas: [] })), null);
    assert.deepEqual(
      pagamentoAdminDe(
        e({
          cobrancas: [
            cobranca({ metodo: "pix", parcelas: 1, valorPago: 30, aprovadoEm: t(12) }),
            cobranca({ metodo: "credit_card", parcelas: 3, valorPago: 32.4, aprovadoEm: t(10) }),
          ],
        }),
      ),
      { metodo: "credit_card", parcelas: 3, valorPago: 32.4, alerta: "PAGO_EM_DOBRO" },
    );
    assert.equal(pagamentoAdminDe(e({ cobrancas: [cobranca({ metodo: "boleto" })] }))?.metodo, null);
    const divergente = cobranca({ status: "PENDENTE", statusGateway: `${MARCA_DIVERGENTE}valor`, aprovadoEm: null });
    assert.deepEqual(pagamentoAdminDe(e({ pedidoStatus: "PENDENTE", cobrancas: [divergente] })), {
      metodo: null,
      parcelas: null,
      valorPago: null,
      alerta: "PAGO_COM_DIVERGENCIA",
    });
  });

  it("expirado: online, pendente, mais de 48 h e nada em conferência", () => {
    const depois = criado.getTime() + PRAZO_PARA_PAGAR_MS + 1;
    const painel = (extra: Partial<EntradaPagamentoAdmin> = {}, canal: "ONLINE" | "PRESENCIAL" = "ONLINE") =>
      painelDoPagamento({ ...e({ pedidoStatus: "PENDENTE", cobrancas: [], agora: depois, ...extra }), canal, createdAt: criado });
    assert.equal(painel().expirado, true);
    assert.equal(painel({}, "PRESENCIAL").expirado, false);
    assert.equal(painel({ agora: criado.getTime() + 60_000 }).expirado, false);
    assert.equal(painel({ cobrancas: [cobranca({ status: "PENDENTE", aprovadoEm: null, avisadoEm: t(10) })] }).expirado, false);
    assert.equal(painel({ cobrancas: [cobranca({ status: "PENDENTE", aprovadoEm: null, statusGateway: `${MARCA_DIVERGENTE}valor` })] }).expirado, false);
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
