// Testes das regras puras da conferência de pagamento das encomendas (aviso, retorno e divergência que
// SEGURAM a encomenda por no máximo 24 h), da folga de 30 min depois do prazo da entrada e dos sinais do
// DTO que a tela usa. Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOLGA_DA_ENTRADA_MS,
  HORAS_MAX_EM_CONFERENCIA,
  acoesDaCliente,
  acoesDaLoja,
  acaoAdminSchema,
  conferenciaAte,
  entradaEmFolgaAgora,
  estadoDaConferencia,
  fimDaFolgaDaEntrada,
  horasParaPagarEntrada,
  prazoDaEntrada,
  statusEfetivo,
  transicaoPermitida,
  type CobrancaParaConferencia,
  type EncomendaParaRegras,
} from "@/lib/encomendas-regras";
import { JANELA_CONFIRMANDO_MS } from "@/lib/pagamentos-regras";

const MIN = 60_000;
const HORA = 60 * MIN;
const T0 = new Date("2026-11-11T12:00:00Z").getTime();

const cobranca = (extra: Partial<CobrancaParaConferencia> = {}): CobrancaParaConferencia => ({
  status: "PENDENTE",
  statusGateway: "aberto",
  avisoTransacaoNsu: null,
  avisoSlug: null,
  avisadoEm: null,
  retornoEm: null,
  expiraEm: new Date(T0 - 2 * HORA),
  ...extra,
});
const comAviso = (haQuanto: number, extra: Partial<CobrancaParaConferencia> = {}) =>
  cobranca({ avisoTransacaoNsu: "nsu-1", avisoSlug: "slug-1", avisadoEm: new Date(T0 - haQuanto), ...extra });

describe("conferência que segura a encomenda: no máximo 24 h", () => {
  it("o limite são 24 horas", () => {
    assert.equal(HORAS_MAX_EM_CONFERENCIA, 24);
  });

  it("candidato de aviso segura até 24 h depois do VENCIMENTO do link, não depois da hora do aviso", () => {
    const vencimento = (haQuanto: number) => ({ expiraEm: new Date(T0 - haQuanto) });
    assert.equal(estadoDaConferencia(comAviso(5 * MIN, vencimento(10 * MIN)), T0), "CONFIRMANDO");
    assert.equal(estadoDaConferencia(comAviso(5 * MIN, vencimento(24 * HORA - 1)), T0), "CONFIRMANDO");
    assert.equal(estadoDaConferencia(comAviso(5 * MIN, vencimento(24 * HORA)), T0), null, "passou das 24 h do vencimento: não segura mais");
    assert.equal(estadoDaConferencia(comAviso(5 * MIN, vencimento(3 * 24 * HORA)), T0), null);
  });

  it("avisos novos (forjados ou repetidos) NÃO renovam a contagem: só o vencimento do link conta", () => {
    // A cliente conhece o token do aviso da própria cobrança e pode mandar avisos falsos a qualquer hora.
    // Um aviso de 1 minuto atrás, com o link vencido há 25 h, não segura (a hora do aviso não conta).
    assert.equal(estadoDaConferencia(comAviso(MIN, { expiraEm: new Date(T0 - 25 * HORA) }), T0), null);
    // Nem o aviso mais novo possível: nunca passa de vencimento + 24 h.
    const fim = conferenciaAte(comAviso(0, { expiraEm: new Date(T0 - HORA) }), T0)!;
    assert.equal(fim.getTime(), T0 - HORA + 24 * HORA);
    assert.equal(estadoDaConferencia(comAviso(0, { expiraEm: new Date(T0 - HORA) }), fim.getTime()), null);
  });

  it("aviso sem candidato gravado (nsu, slug ou hora nulos) não segura", () => {
    assert.equal(estadoDaConferencia(cobranca({ avisadoEm: new Date(T0 - MIN) }), T0), null);
    assert.equal(estadoDaConferencia(cobranca({ avisoTransacaoNsu: "n", avisadoEm: new Date(T0 - MIN) }), T0), null);
    assert.equal(estadoDaConferencia(cobranca({ avisoTransacaoNsu: "n", avisoSlug: "s" }), T0), null);
  });

  it("divergência segura por 24 h depois do vencimento do link, com ou sem aviso", () => {
    const divergente = { statusGateway: "divergente:valor" };
    assert.equal(estadoDaConferencia(comAviso(HORA, { ...divergente, expiraEm: new Date(T0 - HORA) }), T0), "DIVERGENTE");
    assert.equal(estadoDaConferencia(comAviso(HORA, { ...divergente, expiraEm: new Date(T0 - 24 * HORA + 1) }), T0), "DIVERGENTE");
    assert.equal(estadoDaConferencia(comAviso(HORA, { ...divergente, expiraEm: new Date(T0 - 24 * HORA) }), T0), null);
    assert.equal(estadoDaConferencia(cobranca({ ...divergente, expiraEm: new Date(T0 - HORA) }), T0), "DIVERGENTE");
    assert.equal(estadoDaConferencia(cobranca({ ...divergente, expiraEm: new Date(T0 - 25 * HORA) }), T0), null);
  });

  it("retorno do navegador segura 30 min e só; cobrança aprovada ou recusada não segura nada", () => {
    assert.equal(estadoDaConferencia(cobranca({ retornoEm: new Date(T0 - 29 * MIN) }), T0), "CONFIRMANDO");
    assert.equal(estadoDaConferencia(cobranca({ retornoEm: new Date(T0 - JANELA_CONFIRMANDO_MS) }), T0), null);
    for (const status of ["APROVADO", "RECUSADO", "ESTORNADO"] as const) {
      assert.equal(estadoDaConferencia(comAviso(MIN, { status }), T0), null, status);
    }
    // A cobrança só cancelada no nosso banco ainda pode ser paga na InfinitePay: segura como a pendente.
    assert.equal(estadoDaConferencia(comAviso(MIN, { status: "CANCELADO" }), T0), "CONFIRMANDO");
  });

  it("conferenciaAte diz quando a cobrança solta a encomenda", () => {
    assert.equal(conferenciaAte(comAviso(HORA, { expiraEm: new Date(T0 - HORA) }), T0)?.toISOString(), new Date(T0 - HORA + 24 * HORA).toISOString());
    assert.equal(conferenciaAte(cobranca({ retornoEm: new Date(T0 - 10 * MIN) }), T0)?.toISOString(), new Date(T0 + 20 * MIN).toISOString());
    assert.equal(conferenciaAte(comAviso(MIN, { expiraEm: new Date(T0 - 25 * HORA) }), T0), null);
    assert.equal(conferenciaAte(cobranca(), T0), null);
  });
});

const entradaAte = new Date("2026-11-12T03:00:00Z");
const aguardando = (extra: Partial<EncomendaParaRegras> = {}): EncomendaParaRegras => ({
  status: "AGUARDANDO_ENTRADA",
  responderAte: new Date("2026-11-11T15:00:00Z"),
  entradaAte,
  corteEm: new Date("2026-11-12T03:00:00Z"),
  linkEntradaValidoAte: null,
  entradaPagaEm: null,
  restantePagoEm: null,
  valorEntradaCentavos: 6900,
  valorRestanteCentavos: 9900,
  percentualRetido: 100,
  ...extra,
});

describe("o beco sem saída: conferência que nunca fecha não prende a encomenda para sempre", () => {
  // O que `paraRegras` faz com as cobranças da entrada: entradaEmConfirmacao = alguma delas segura.
  const conferindo = (c: CobrancaParaConferencia, agora: number) => estadoDaConferencia(c, agora) !== null;

  it("aviso recente: a encomenda continua aguardando depois da folga (o dinheiro pode ter entrado)", () => {
    const agora = entradaAte.getTime() + 3 * HORA;
    const aviso = comAviso(2 * HORA, { expiraEm: entradaAte });
    const e = aguardando({ entradaEmConfirmacao: conferindo(aviso, agora) });
    assert.equal(statusEfetivo(e, new Date(agora)), "AGUARDANDO_ENTRADA");
  });

  it("aviso que não fechou em 24 h: a encomenda expira (e o pagamento que aparecer depois vira devolução)", () => {
    const agora = entradaAte.getTime() + 30 * HORA;
    const aviso = comAviso(26 * HORA, { expiraEm: entradaAte });
    const e = aguardando({ entradaEmConfirmacao: conferindo(aviso, agora) });
    assert.equal(statusEfetivo(e, new Date(agora)), "EXPIRADA");
  });

  it("divergência permanente: segura 24 h e solta", () => {
    const divergente = comAviso(HORA, { statusGateway: "divergente:valor", expiraEm: entradaAte });
    const e = (agora: number) => aguardando({ entradaEmConfirmacao: conferindo({ ...divergente, avisadoEm: new Date(entradaAte.getTime()) }, agora) });
    assert.equal(statusEfetivo(e(entradaAte.getTime() + 23 * HORA), new Date(entradaAte.getTime() + 23 * HORA)), "AGUARDANDO_ENTRADA");
    assert.equal(statusEfetivo(e(entradaAte.getTime() + 25 * HORA), new Date(entradaAte.getTime() + 25 * HORA)), "EXPIRADA");
  });

  it("o retorno repetido não renova a janela de 30 min depois de gravado (a gravação em si é limitada em processarRetorno)", () => {
    const retornoEm = new Date(T0 - 40 * MIN);
    assert.equal(estadoDaConferencia(cobranca({ retornoEm }), T0), null);
  });
});

describe("folga de 30 min depois do prazo da entrada", () => {
  it("fimDaFolgaDaEntrada é entradaAte + 30 min", () => {
    assert.equal(FOLGA_DA_ENTRADA_MS, 30 * MIN);
    assert.equal(fimDaFolgaDaEntrada(entradaAte).getTime() - entradaAte.getTime(), 30 * MIN);
  });

  it("pagamento no último minuto: nos 30 min seguintes a encomenda ainda está aguardando (confirma); depois, expirada (tardio)", () => {
    const e = aguardando();
    assert.equal(statusEfetivo(e, new Date(entradaAte.getTime() + 1_000)), "AGUARDANDO_ENTRADA");
    assert.equal(statusEfetivo(e, new Date(entradaAte.getTime() + 29 * MIN + 59_000)), "AGUARDANDO_ENTRADA");
    assert.equal(statusEfetivo(e, new Date(entradaAte.getTime() + 30 * MIN)), "EXPIRADA");
  });

  it("entradaEmFolgaAgora: só entre entradaAte e entradaAte + 30 min, com a encomenda ainda aguardando", () => {
    assert.equal(entradaEmFolgaAgora("AGUARDANDO_ENTRADA", entradaAte, new Date(entradaAte.getTime() - 1)), false);
    assert.equal(entradaEmFolgaAgora("AGUARDANDO_ENTRADA", entradaAte, entradaAte), true);
    assert.equal(entradaEmFolgaAgora("AGUARDANDO_ENTRADA", entradaAte, new Date(entradaAte.getTime() + 29 * MIN)), true);
    assert.equal(entradaEmFolgaAgora("AGUARDANDO_ENTRADA", entradaAte, new Date(entradaAte.getTime() + 30 * MIN)), false, "depois da folga: expirada ou segurada por conferência");
    assert.equal(entradaEmFolgaAgora("EXPIRADA", entradaAte, entradaAte), false);
    assert.equal(entradaEmFolgaAgora("AGUARDANDO_ENTRADA", null, entradaAte), false);
  });

  it("a transição EXPIRADA do sistema também só vale depois da folga", () => {
    const fatos = { agora: entradaAte, responderAte: new Date("2026-11-11T15:00:00Z"), entradaAte, quitada: false };
    assert.equal(transicaoPermitida("AGUARDANDO_ENTRADA", "EXPIRADA", "SISTEMA", fatos).ok, false);
    assert.equal(transicaoPermitida("AGUARDANDO_ENTRADA", "EXPIRADA", "SISTEMA", { ...fatos, agora: fimDaFolgaDaEntrada(entradaAte) }).ok, true);
  });

  it("o valid_until do link continua em entradaAte: nos últimos 5 min e na folga não se abre link novo", () => {
    const e = aguardando();
    assert.equal(acoesDaCliente(e, new Date(entradaAte.getTime() - 5 * MIN)).pagarEntrada, true);
    assert.equal(acoesDaCliente(e, new Date(entradaAte.getTime() - 5 * MIN + 1)).pagarEntrada, false);
    assert.equal(acoesDaCliente(e, new Date(entradaAte.getTime() + MIN)).pagarEntrada, false);
  });

  it("o prazo da entrada continua sendo min(aprovação + 24 h, corte)", () => {
    const aprovada = new Date("2026-11-11T12:00:00Z");
    assert.equal(prazoDaEntrada(aprovada, new Date("2026-11-20T03:00:00Z")).toISOString(), "2026-11-12T12:00:00.000Z");
    assert.equal(prazoDaEntrada(aprovada, new Date("2026-11-12T03:00:00Z")).toISOString(), "2026-11-12T03:00:00.000Z");
  });
});

describe("horas reais para pagar a entrada (a tela não escreve 24 horas fixo)", () => {
  const aprovadaEm = new Date("2026-11-11T12:00:00Z");
  it("aprovada com 24 h inteiras: 24", () => {
    assert.equal(horasParaPagarEntrada({ aprovadaEm, entradaAte: new Date("2026-11-12T12:00:00Z"), corteEm: new Date("2026-11-20T03:00:00Z") }, aprovadaEm), 24);
  });
  it("aprovada perto do corte: as horas que sobraram", () => {
    assert.equal(horasParaPagarEntrada({ aprovadaEm, entradaAte: new Date("2026-11-12T03:00:00Z"), corteEm: new Date("2026-11-12T03:00:00Z") }, aprovadaEm), 15);
    assert.equal(horasParaPagarEntrada({ aprovadaEm, entradaAte: new Date("2026-11-11T15:30:00Z"), corteEm: new Date("2026-11-11T15:30:00Z") }, aprovadaEm), 3.5);
  });
  it("ainda não aprovada: o máximo possível agora, min(24 h, até o corte)", () => {
    const corteEm = new Date("2026-11-12T03:00:00Z");
    assert.equal(horasParaPagarEntrada({ aprovadaEm: null, entradaAte: null, corteEm: new Date("2026-11-20T03:00:00Z") }, aprovadaEm), 24);
    assert.equal(horasParaPagarEntrada({ aprovadaEm: null, entradaAte: null, corteEm }, aprovadaEm), 15);
    assert.equal(horasParaPagarEntrada({ aprovadaEm: null, entradaAte: null, corteEm }, new Date("2026-11-13T00:00:00Z")), 0);
  });
});

describe("sinais do DTO: nada de 'Pagar' com pagamento em conferência", () => {
  it("pagarEntrada fica false com a entrada em conferência; desistirBloqueado avisa o 409", () => {
    const agora = new Date(entradaAte.getTime() - 3 * HORA);
    const normal = aguardando();
    assert.equal(acoesDaCliente(normal, agora).pagarEntrada, true);
    assert.equal(acoesDaCliente(normal, agora).desistirBloqueado, false);
    const conferindo = aguardando({ entradaEmConfirmacao: true });
    const a = acoesDaCliente(conferindo, agora);
    assert.equal(a.pagarEntrada, false);
    assert.equal(a.desistirBloqueado, true);
    assert.deepEqual(a.desistir, { devolucao: 0, retido: 0 }, "a prévia continua (nada pago ainda)");
  });

  it("pagarRestante fica false com o restante em conferência", () => {
    const confirmada = aguardando({ status: "CONFIRMADA", entradaPagaEm: new Date(T0) });
    const agora = new Date(T0 + HORA);
    assert.equal(acoesDaCliente(confirmada, agora).pagarRestante, true);
    const conferindo = acoesDaCliente({ ...confirmada, restanteEmConfirmacao: true }, agora);
    assert.equal(conferindo.pagarRestante, false);
    assert.equal(conferindo.desistirBloqueado, true);
  });

  it("encomenda encerrada nunca tem desistirBloqueado", () => {
    assert.equal(acoesDaCliente(aguardando({ status: "EXPIRADA", entradaEmConfirmacao: true }), new Date(T0)).desistirBloqueado, false);
  });
});

describe("painel: registrar a entrada por fora e cancelar com a conferência aberta", () => {
  const agora = new Date("2026-11-11T20:00:00Z");
  const lista = (extra: Partial<EncomendaParaRegras> = {}) =>
    acoesDaLoja({ ...aguardando(extra), devolucaoPendente: false, modo: "RETIRADA" }, agora);

  it("aguardando a entrada: registrar-entrada e cancelar", () => {
    const acoes = lista();
    assert.deepEqual(acoes.map((a) => a.acao), ["registrar-entrada", "cancelar", "avisada"]);
    const registrar = acoes.find((a) => a.acao === "registrar-entrada")!;
    assert.equal(registrar.permitida, true);
    assert.match(registrar.aviso ?? "", /app InfinitePay/);
  });

  it("com a entrada em conferência: registrar fica desabilitado (com o motivo), cancelar vale com o aviso de conferir no app", () => {
    const acoes = lista({ entradaEmConfirmacao: true });
    const registrar = acoes.find((a) => a.acao === "registrar-entrada")!;
    assert.equal(registrar.permitida, false);
    assert.match(registrar.motivo ?? "", /sendo conferido/);
    assert.match(registrar.motivo ?? "", /24 h/);
    const cancelar = acoes.find((a) => a.acao === "cancelar")!;
    assert.equal(cancelar.permitida, true);
    assert.match(cancelar.aviso ?? "", /Confira no app InfinitePay antes de cancelar/);
    assert.match(cancelar.aviso ?? "", /devolução pendente/);
  });

  it("com o restante em conferência: registrar-restante desabilitado; cancelar com o aviso", () => {
    const acoes = acoesDaLoja(
      { ...aguardando({ status: "CONFIRMADA", entradaPagaEm: new Date(T0), restanteEmConfirmacao: true }), devolucaoPendente: false, modo: "ENTREGA" },
      agora,
    );
    const restante = acoes.find((a) => a.acao === "registrar-restante")!;
    assert.equal(restante.permitida, false);
    assert.match(restante.motivo ?? "", /do restante/);
    assert.match(acoes.find((a) => a.acao === "cancelar")!.aviso ?? "", /Confira no app InfinitePay/);
    // E sem conferência, o cancelamento só avisa da devolução do que foi pago.
    const sem = acoesDaLoja({ ...aguardando({ status: "CONFIRMADA", entradaPagaEm: new Date(T0) }), devolucaoPendente: false, modo: "ENTREGA" }, agora);
    assert.doesNotMatch(sem.find((a) => a.acao === "cancelar")!.aviso ?? "", /conferido/);
  });

  it("a loja pode confirmar a entrada (AGUARDANDO_ENTRADA → CONFIRMADA); o sistema também", () => {
    const fatos = { agora, responderAte: new Date("2026-11-11T15:00:00Z"), entradaAte, quitada: false };
    assert.equal(transicaoPermitida("AGUARDANDO_ENTRADA", "CONFIRMADA", "LOJA", fatos).ok, true);
    assert.equal(transicaoPermitida("AGUARDANDO_ENTRADA", "CONFIRMADA", "SISTEMA", fatos).ok, true);
    assert.equal(transicaoPermitida("AGUARDANDO_ENTRADA", "CONFIRMADA", "CLIENTE", fatos).ok, false);
    assert.equal(transicaoPermitida("SOLICITADA", "CONFIRMADA", "LOJA", fatos).ok, false);
  });

  it("registrar-entrada exige a forma de pagamento (a mesma lista do restante) e aceita observação", () => {
    assert.equal(acaoAdminSchema.safeParse({ acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA" }).success, false);
    assert.equal(acaoAdminSchema.safeParse({ acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA", formaPagamento: "BITCOIN" }).success, false);
    const r = acaoAdminSchema.safeParse({ acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA", formaPagamento: "PIX", observacao: "  Conferi no app.  " });
    assert.equal(r.success && r.data.acao === "registrar-entrada" && r.data.observacao, "Conferi no app.");
    assert.equal(acaoAdminSchema.safeParse({ acao: "registrar-entrada", statusEsperado: "AGUARDANDO_ENTRADA", formaPagamento: "DINHEIRO", observacao: "x‮y" }).success, false);
  });
});
