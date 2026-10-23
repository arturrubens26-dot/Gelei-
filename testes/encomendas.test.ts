// Testes das regras puras das encomendas de lembrancinhas (datas no fuso da loja, prazos, potinhos,
// valores, devolução, transições, schemas, agenda, WhatsApp e política). Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AVISO_JURIDICO,
  POLITICA_VERSAO,
  textosDaPolitica,
  versaoDaPoliticaConhecida,
} from "@/lib/encomendas-politica";
import {
  MAX_POTINHOS,
  MIN_POTINHOS,
  ROTULO_STATUS_ENCOMENDA,
  STATUS_ENCOMENDA,
  STATUS_FINAIS,
  acaoAdminSchema,
  acoesDaCliente,
  acoesDaLoja,
  agendaPorDia,
  alertaDaEncomenda,
  calcularValores,
  configLembrancinhasSchema,
  conferirPotinhos,
  corteDaEntrega,
  desistenciaSchema,
  devolucaoNaDesistencia,
  diaDaLoja,
  diaValido,
  encomendaSchema,
  etapaDaParcela,
  faixaDaDevolucaoNoCancelamento,
  faixaDeDatas,
  formatarPrazo,
  inicioDoDia,
  linhaDoTempo,
  linkWhatsApp,
  meioDia,
  mensagemWhatsApp,
  mesmaEncomenda,
  pesoDaEncomenda,
  prazoDaEntrada,
  prazosDaEncomenda,
  statusEfetivo,
  transicaoPermitida,
  validadeDoLink,
  validarDatas,
  valoresDoCancelamento,
  type EncomendaParaRegras,
  type StatusEncomenda,
} from "@/lib/encomendas-regras";
import { alvoDaCobranca, classificarConferencia, lerConferencia, referenciaDaEncomenda } from "@/lib/infinitepay-regras";
import { telefoneSchema } from "@/lib/validacao";

const iso = (d: Date | null) => d?.toISOString() ?? null;
const MIN = 60_000;
const HORA = 60 * MIN;

describe("datas no fuso da loja (Teresina, −03:00)", () => {
  it("02:59:59Z ainda é o dia anterior; 03:00Z já é o dia seguinte", () => {
    assert.equal(diaDaLoja(new Date("2026-11-11T02:59:59Z")), "2026-11-10");
    assert.equal(diaDaLoja(new Date("2026-11-11T03:00:00Z")), "2026-11-11");
  });

  it("às 23:59:59 de 10/11 a festa em 15/11 passa; à meia-noite de 11/11, não", () => {
    const antes = diaDaLoja(new Date("2026-11-11T02:59:59Z"));
    const depois = diaDaLoja(new Date("2026-11-11T03:00:00Z"));
    assert.deepEqual(validarDatas({ hoje: antes, dataFesta: "2026-11-15", dataEntrega: "2026-11-14" }), { ok: true });
    const r = validarDatas({ hoje: depois, dataFesta: "2026-11-15", dataEntrega: "2026-11-15" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.ok ? null : r.erros.dataFesta, ["A festa precisa ser a partir de 16/11/2026 (5 dias de antecedência)."]);
  });

  it("início do dia e meio-dia são instantes fixos em −03:00", () => {
    assert.equal(iso(inicioDoDia("2026-11-12")), "2026-11-12T03:00:00.000Z");
    assert.equal(iso(meioDia("2026-11-11")), "2026-11-11T15:00:00.000Z");
    // Virada de ano e fevereiro de ano bissexto.
    assert.equal(iso(inicioDoDia("2027-01-01")), "2027-01-01T03:00:00.000Z");
    assert.equal(iso(inicioDoDia("2028-02-29")), "2028-02-29T03:00:00.000Z");
  });

  it("diaValido recusa datas que não existem e formatos errados", () => {
    assert.equal(diaValido("2026-11-15"), true);
    assert.equal(diaValido("2028-02-29"), true);
    assert.equal(diaValido("2026-02-30"), false);
    assert.equal(diaValido("2026-02-29"), false);
    assert.equal(diaValido("2026-13-01"), false);
    assert.equal(diaValido("15/11/2026"), false);
    assert.equal(diaValido("2026-11-15T00:00"), false);
    assert.equal(diaValido(""), false);
  });

  it("formatarPrazo mostra a meia-noite como 23h59 do dia anterior", () => {
    assert.equal(formatarPrazo(new Date("2026-11-12T03:00:00Z")), "quarta-feira, 11/11/2026, às 23h59");
    assert.equal(formatarPrazo(new Date("2026-11-11T15:00:00Z")), "quarta-feira, 11/11/2026, às 12h00");
  });
});

describe("antecedência e datas de entrega", () => {
  const hoje = "2026-11-10";

  it("festa: 14/11 recusada, 15/11 aceita", () => {
    const r = validarDatas({ hoje, dataFesta: "2026-11-14", dataEntrega: "2026-11-13" });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.erros.dataFesta![0], /a partir de 15\/11\/2026 \(5 dias de antecedência\)/);
    assert.deepEqual(validarDatas({ hoje, dataFesta: "2026-11-15", dataEntrega: "2026-11-14" }), { ok: true });
  });

  it("festa: hoje+90 aceita, hoje+91 recusada", () => {
    assert.deepEqual(validarDatas({ hoje, dataFesta: "2027-02-08", dataEntrega: "2027-02-07" }), { ok: true });
    const r = validarDatas({ hoje, dataFesta: "2027-02-09", dataEntrega: "2027-02-07" });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.erros.dataFesta![0], /até 90 dias de antecedência: a festa pode ser até 08\/02\/2027/);
  });

  it("2026-02-30 é data inválida (festa e entrega)", () => {
    const r = validarDatas({ hoje, dataFesta: "2026-02-30", dataEntrega: "2026-02-30", modo: "RETIRADA" });
    assert.equal(r.ok, false);
    assert.deepEqual(r.ok ? null : r.erros, { dataFesta: ["Data da festa inválida."], dataEntrega: ["Data da retirada inválida."] });
  });

  it("festa em 15/11: entrega em 14/11 aceita; 15/11 (dia da festa) e 13/11 (antes de hoje+4) recusadas", () => {
    assert.deepEqual(validarDatas({ hoje, dataFesta: "2026-11-15", dataEntrega: "2026-11-14" }), { ok: true });
    const noDia = validarDatas({ hoje, dataFesta: "2026-11-15", dataEntrega: "2026-11-15", modo: "ENTREGA" });
    assert.deepEqual(noDia.ok ? null : noDia.erros.dataEntrega, ["A entrega precisa ser antes do dia da festa (até 14/11/2026)."]);
    const cedo = validarDatas({ hoje, dataFesta: "2026-11-15", dataEntrega: "2026-11-13", modo: "RETIRADA" });
    assert.deepEqual(cedo.ok ? null : cedo.erros.dataEntrega, [
      "Retirada a partir de 14/11/2026: precisamos de 4 dias para preparar os potinhos.",
    ]);
  });

  it("festa em 30/11: entrega em 14/11 e em 29/11 aceitas", () => {
    assert.deepEqual(validarDatas({ hoje, dataFesta: "2026-11-30", dataEntrega: "2026-11-14" }), { ok: true });
    assert.deepEqual(validarDatas({ hoje, dataFesta: "2026-11-30", dataEntrega: "2026-11-29" }), { ok: true });
  });

  it("faixaDeDatas dá os limites concretos para o calendário", () => {
    assert.deepEqual(faixaDeDatas(hoje), { festaMin: "2026-11-15", festaMax: "2027-02-08", entregaMin: "2026-11-14", entregaMax: "2027-02-07" });
    assert.deepEqual(faixaDeDatas(hoje, "2026-11-30"), { festaMin: "2026-11-15", festaMax: "2027-02-08", entregaMin: "2026-11-14", entregaMax: "2026-11-29" });
    // Festa inválida: a entrega vai até a véspera da festa mais distante.
    assert.equal(faixaDeDatas(hoje, "2026-02-30").entregaMax, "2027-02-07");
  });

  it("virada de mês e de ano", () => {
    assert.deepEqual(validarDatas({ hoje: "2026-12-28", dataFesta: "2027-01-02", dataEntrega: "2027-01-01" }), { ok: true });
    assert.equal(validarDatas({ hoje: "2026-12-28", dataFesta: "2027-01-01", dataEntrega: "2026-12-31" }).ok, false);
  });
});

describe("prazos", () => {
  it("solicitação 10/11 15:00Z, entrega 14/11: responde até 11/11 12:00 local; corte 11/11 23h59", () => {
    const p = prazosDaEncomenda(new Date("2026-11-10T15:00:00Z"), "2026-11-14");
    assert.equal(iso(p.responderAte), "2026-11-11T15:00:00.000Z");
    assert.equal(iso(p.corteEm), "2026-11-12T03:00:00.000Z");
  });

  it("entrega em 30/11: responde até o fim do dia seguinte; corte em 27/11 23h59", () => {
    const p = prazosDaEncomenda(new Date("2026-11-10T15:00:00Z"), "2026-11-30");
    assert.equal(iso(p.responderAte), "2026-11-12T03:00:00.000Z");
    assert.equal(iso(p.corteEm), "2026-11-28T03:00:00.000Z");
    assert.equal(iso(corteDaEntrega("2026-11-30")), "2026-11-28T03:00:00.000Z");
  });

  it("solicitação às 23:59:59 local conta como o dia; à meia-noite, já é o dia seguinte", () => {
    const antes = prazosDaEncomenda(new Date("2026-11-11T02:59:59Z"), "2026-11-30");
    const depois = prazosDaEncomenda(new Date("2026-11-11T03:00:00Z"), "2026-11-30");
    assert.equal(iso(antes.responderAte), "2026-11-12T03:00:00.000Z");
    assert.equal(iso(depois.responderAte), "2026-11-13T03:00:00.000Z");
  });

  it("com a entrega no limite (S+4), a loja tem pelo menos até o meio-dia de S+1 e o corte vem depois", () => {
    for (const hora of ["03:00:00", "12:00:00", "23:00:00", "02:59:59"]) {
      const criada = new Date(`2026-11-10T${hora}Z`);
      const s = diaDaLoja(criada);
      const e = new Date(`${s}T12:00:00Z`);
      e.setUTCDate(e.getUTCDate() + 4);
      const p = prazosDaEncomenda(criada, e.toISOString().slice(0, 10));
      const meioDiaS1 = new Date(meioDia(s).getTime() + 24 * HORA);
      assert.ok(p.responderAte.getTime() >= meioDiaS1.getTime(), hora);
      assert.ok(p.corteEm.getTime() > p.responderAte.getTime(), hora);
    }
  });

  it("entradaAte: o corte quando ele vem antes de 24 h; senão, 24 h", () => {
    const corte = new Date("2026-11-12T03:00:00Z");
    assert.equal(iso(prazoDaEntrada(new Date("2026-11-11T12:00:00Z"), corte)), "2026-11-12T03:00:00.000Z");
    assert.equal(iso(prazoDaEntrada(new Date("2026-11-10T12:00:00Z"), new Date("2026-11-28T03:00:00Z"))), "2026-11-11T12:00:00.000Z");
  });

  it("exemplo do plano: aprovada qua 09:00, a entrada vence qua 23h59", () => {
    const p = prazosDaEncomenda(new Date("2026-11-10T18:00:00Z"), "2026-11-14");
    const entradaAte = prazoDaEntrada(new Date("2026-11-11T12:00:00Z"), p.corteEm);
    assert.equal(formatarPrazo(entradaAte), "quarta-feira, 11/11/2026, às 23h59");
  });
});

describe("validade do link (valid_until)", () => {
  const agora = new Date("2026-11-11T12:00:00Z");
  it("limite em 2 h: vence em 60 min", () => {
    assert.equal(validadeDoLink(agora, new Date(agora.getTime() + 2 * HORA))!.getTime(), agora.getTime() + 60 * MIN);
  });
  it("limite em 40 min: vence no limite (nunca passa do prazo da entrada)", () => {
    assert.equal(validadeDoLink(agora, new Date(agora.getTime() + 40 * MIN))!.getTime(), agora.getTime() + 40 * MIN);
  });
  it("limite em 10 min: vence em 10 min (sem o mínimo de 30 min do Mercado Pago)", () => {
    assert.equal(validadeDoLink(agora, new Date(agora.getTime() + 10 * MIN))!.getTime(), agora.getTime() + 10 * MIN);
  });
  it("menos de 5 min até o limite, ou já passou: null", () => {
    assert.equal(validadeDoLink(agora, new Date(agora.getTime() + 5 * MIN))!.getTime(), agora.getTime() + 5 * MIN);
    assert.equal(validadeDoLink(agora, new Date(agora.getTime() + 5 * MIN - 1)), null);
    assert.equal(validadeDoLink(agora, new Date(agora.getTime() - 1)), null);
    assert.equal(validadeDoLink(agora, agora), null);
  });
  it("sem limite (restante): 60 min", () => {
    assert.equal(validadeDoLink(agora, null)!.getTime(), agora.getTime() + 60 * MIN);
  });
});

describe("potinhos", () => {
  const mini = new Set(["morango", "maracuja", "pimenta"]);
  it("14 abaixo do mínimo; 15 e 50 passam; 51 acima", () => {
    const abaixo = conferirPotinhos([{ productId: "morango", quantidade: 14 }], mini);
    assert.deepEqual(abaixo.ok ? null : [abaixo.motivo, abaixo.mensagem], ["abaixo-do-minimo", "Mínimo de 15 potinhos; você escolheu 14."]);
    assert.equal(conferirPotinhos([{ productId: "morango", quantidade: MIN_POTINHOS }], mini).ok, true);
    assert.equal(conferirPotinhos([{ productId: "morango", quantidade: MAX_POTINHOS }], mini).ok, true);
    const acima = conferirPotinhos([{ productId: "morango", quantidade: 51 }], mini);
    assert.deepEqual(acima.ok ? null : [acima.motivo, acima.mensagem], ["acima-do-maximo", "Máximo de 50 potinhos; você escolheu 51."]);
  });
  it("Morango ×13 + Maracujá ×10 = 23", () => {
    const r = conferirPotinhos([{ productId: "morango", quantidade: 13 }, { productId: "maracuja", quantidade: 10 }], mini);
    assert.equal(r.ok && r.total, 23);
  });
  it("Morango ×5 + Morango ×10 vira Morango ×15", () => {
    const r = conferirPotinhos([{ productId: "morango", quantidade: 5 }, { productId: "morango", quantidade: 10 }], mini);
    assert.deepEqual(r.ok ? r.itens : null, [{ productId: "morango", quantidade: 15 }]);
  });
  it("quantidade 0 ou 1,5 é inválida", () => {
    for (const q of [0, 1.5, -2]) {
      const r = conferirPotinhos([{ productId: "morango", quantidade: 15 }, { productId: "pimenta", quantidade: q }], mini);
      assert.equal(r.ok ? null : r.motivo, "quantidade-invalida", String(q));
    }
  });
  it("sabor sem mini é indisponível (com a lista)", () => {
    const r = conferirPotinhos([{ productId: "morango", quantidade: 10 }, { productId: "abacaxi", quantidade: 10 }], mini);
    assert.deepEqual(r.ok ? null : [r.motivo, r.indisponiveis], ["indisponivel", ["abacaxi"]]);
  });
  it("peso: 23 × 110 g + 300 g = 2830 g", () => {
    assert.equal(pesoDaEncomenda(23, 110, 300), 2830);
  });
});

describe("valores (centavos)", () => {
  it("23 × R$ 6,00 + frete R$ 30,00: total 16800, entrada 6900, restante 9900", () => {
    assert.deepEqual(calcularValores({ subtotalCentavos: 23 * 600, freteCentavos: 3000 }), {
      subtotal: 13800,
      frete: 3000,
      total: 16800,
      entrada: 6900,
      restante: 9900,
    });
  });
  it("15 × R$ 5,99 sem frete: entrada 4493 (para cima), restante 4492", () => {
    const v = calcularValores({ subtotalCentavos: 15 * 599, freteCentavos: 0 });
    assert.equal(v.entrada, 4493);
    assert.equal(v.restante, 4492);
  });
  it("propriedade (500 casos): entrada + restante = total, entrada > 0, entrada ≥ restante − frete", () => {
    let semente = 20261021;
    const aleatorio = (max: number) => {
      semente = (semente * 1103515245 + 12345) % 2 ** 31;
      return semente % max;
    };
    for (let i = 0; i < 500; i++) {
      const potinhos = MIN_POTINHOS + aleatorio(MAX_POTINHOS - MIN_POTINHOS + 1);
      const preco = 1 + aleatorio(99_999);
      const frete = aleatorio(2) === 0 ? 0 : aleatorio(10_000);
      const v = calcularValores({ subtotalCentavos: potinhos * preco, freteCentavos: frete });
      assert.equal(v.entrada + v.restante, v.total);
      assert.ok(v.entrada > 0);
      assert.ok(v.entrada >= v.restante - frete);
      assert.ok(Number.isInteger(v.entrada) && Number.isInteger(v.restante));
    }
  });
  it("recusa valores que não são centavos inteiros", () => {
    assert.throws(() => calcularValores({ subtotalCentavos: 10.5, freteCentavos: 0 }), RangeError);
    assert.throws(() => calcularValores({ subtotalCentavos: 0, freteCentavos: 0 }), RangeError);
    assert.throws(() => calcularValores({ subtotalCentavos: 100, freteCentavos: -1 }), RangeError);
  });
});

describe("devolução na desistência", () => {
  const corteEm = new Date("2026-11-12T03:00:00Z");
  const base = { corteEm, entradaPaga: 6900, restantePago: 9900, percentualRetido: 100 };
  it("cliente 1 ms antes do corte: devolve tudo", () => {
    assert.deepEqual(devolucaoNaDesistencia({ ...base, agora: new Date(corteEm.getTime() - 1), quem: "CLIENTE" }), { devolucao: 16800, retido: 0 });
  });
  it("cliente no corte: a entrada fica, o restante pago volta", () => {
    assert.deepEqual(devolucaoNaDesistencia({ ...base, agora: corteEm, quem: "CLIENTE" }), { devolucao: 9900, retido: 6900 });
  });
  it("loja cancelando: devolve tudo, mesmo depois do corte", () => {
    assert.deepEqual(devolucaoNaDesistencia({ ...base, agora: new Date(corteEm.getTime() + HORA), quem: "LOJA" }), { devolucao: 16800, retido: 0 });
  });
  it("sem nada pago: devolução 0", () => {
    assert.deepEqual(devolucaoNaDesistencia({ ...base, entradaPaga: 0, restantePago: 0, agora: corteEm, quem: "CLIENTE" }), { devolucao: 0, retido: 0 });
  });
  it("percentual configurável (D4): 50% retém metade da entrada; 0% devolve tudo; arredonda a favor da cliente", () => {
    assert.deepEqual(devolucaoNaDesistencia({ ...base, percentualRetido: 50, agora: corteEm, quem: "CLIENTE" }), { devolucao: 13350, retido: 3450 });
    assert.deepEqual(devolucaoNaDesistencia({ ...base, percentualRetido: 0, agora: corteEm, quem: "CLIENTE" }), { devolucao: 16800, retido: 0 });
    // 33% de 4493 = 1482,69 → retém 1482.
    assert.deepEqual(
      devolucaoNaDesistencia({ corteEm, entradaPaga: 4493, restantePago: 0, percentualRetido: 33, agora: corteEm, quem: "CLIENTE" }),
      { devolucao: 3011, retido: 1482 },
    );
  });
  it("só a entrada paga, depois do corte com 100%: nada volta", () => {
    assert.deepEqual(devolucaoNaDesistencia({ ...base, restantePago: 0, agora: corteEm, quem: "CLIENTE" }), { devolucao: 0, retido: 6900 });
  });
});

describe("transições", () => {
  const fatos = {
    agora: new Date("2026-11-11T12:00:00Z"),
    responderAte: new Date("2026-11-11T15:00:00Z"),
    entradaAte: new Date("2026-11-12T03:00:00Z"),
    quitada: false,
  };
  it("aprovar só como LOJA, só de SOLICITADA e antes de responderAte", () => {
    assert.deepEqual(transicaoPermitida("SOLICITADA", "AGUARDANDO_ENTRADA", "LOJA", fatos), { ok: true });
    assert.deepEqual(transicaoPermitida("SOLICITADA", "AGUARDANDO_ENTRADA", "CLIENTE", fatos), { ok: false, motivo: "transicao-invalida" });
    assert.deepEqual(transicaoPermitida("CONFIRMADA", "AGUARDANDO_ENTRADA", "LOJA", fatos), { ok: false, motivo: "transicao-invalida" });
    assert.deepEqual(
      transicaoPermitida("SOLICITADA", "AGUARDANDO_ENTRADA", "LOJA", { ...fatos, agora: fatos.responderAte }),
      { ok: false, motivo: "prazo-vencido" },
    );
  });
  it("expirar só pelo SISTEMA e só depois do prazo", () => {
    assert.deepEqual(transicaoPermitida("SOLICITADA", "EXPIRADA", "SISTEMA", fatos), { ok: false, motivo: "transicao-invalida" });
    assert.deepEqual(transicaoPermitida("SOLICITADA", "EXPIRADA", "SISTEMA", { ...fatos, agora: fatos.responderAte }), { ok: true });
    assert.deepEqual(transicaoPermitida("AGUARDANDO_ENTRADA", "EXPIRADA", "SISTEMA", { ...fatos, agora: fatos.entradaAte }), { ok: true });
    assert.deepEqual(transicaoPermitida("SOLICITADA", "EXPIRADA", "LOJA", { ...fatos, agora: fatos.responderAte }), { ok: false, motivo: "transicao-invalida" });
  });
  it("ENTREGUE sem quitação é recusado; quitada, passa", () => {
    assert.deepEqual(transicaoPermitida("PRONTA", "ENTREGUE", "LOJA", fatos), { ok: false, motivo: "nao-quitada" });
    assert.deepEqual(transicaoPermitida("PRONTA", "ENTREGUE", "LOJA", { ...fatos, quitada: true }), { ok: true });
    assert.deepEqual(transicaoPermitida("CONFIRMADA", "ENTREGUE", "LOJA", { ...fatos, quitada: true }), { ok: false, motivo: "transicao-invalida" });
  });
  it("nada sai de ENTREGUE, RECUSADA, EXPIRADA ou CANCELADA", () => {
    for (const de of STATUS_FINAIS) {
      for (const para of STATUS_ENCOMENDA) {
        for (const ator of ["CLIENTE", "LOJA", "SISTEMA"] as const) {
          assert.equal(transicaoPermitida(de, para, ator, { ...fatos, quitada: true }).ok, false, `${de}→${para} (${ator})`);
        }
      }
    }
  });
  it("desistir: cliente de SOLICITADA até PRONTA; a loja não 'cancela' uma solicitação (ela recusa)", () => {
    for (const de of ["SOLICITADA", "AGUARDANDO_ENTRADA", "CONFIRMADA", "EM_PRODUCAO", "PRONTA"] as const) {
      assert.equal(transicaoPermitida(de, "CANCELADA", "CLIENTE", fatos).ok, true, de);
    }
    assert.equal(transicaoPermitida("SOLICITADA", "CANCELADA", "LOJA", fatos).ok, false);
    assert.equal(transicaoPermitida("SOLICITADA", "RECUSADA", "LOJA", fatos).ok, true);
  });
  it("todo status tem rótulo", () => {
    for (const s of STATUS_ENCOMENDA) assert.ok(ROTULO_STATUS_ENCOMENDA[s].length > 0);
  });
});

const encomenda = (extra: Partial<EncomendaParaRegras> = {}): EncomendaParaRegras => ({
  status: "SOLICITADA",
  responderAte: new Date("2026-11-11T15:00:00Z"),
  entradaAte: null,
  corteEm: new Date("2026-11-12T03:00:00Z"),
  linkEntradaValidoAte: null,
  entradaPagaEm: null,
  restantePagoEm: null,
  valorEntradaCentavos: 6900,
  valorRestanteCentavos: 9900,
  percentualRetido: 100,
  ...extra,
});

describe("status efetivo e ações", () => {
  it("SOLICITADA com prazo vencido aparece EXPIRADA (e 1 ms antes, não)", () => {
    const e = encomenda();
    assert.equal(statusEfetivo(e, new Date(e.responderAte.getTime() - 1)), "SOLICITADA");
    assert.equal(statusEfetivo(e, e.responderAte), "EXPIRADA");
  });
  it("AGUARDANDO_ENTRADA vencida mas com link ainda valendo continua aguardando", () => {
    const entradaAte = new Date("2026-11-12T03:00:00Z");
    const agora = new Date(entradaAte.getTime() + 5 * MIN);
    const comLink = encomenda({ status: "AGUARDANDO_ENTRADA", entradaAte, linkEntradaValidoAte: new Date(entradaAte.getTime() + 20 * MIN) });
    assert.equal(statusEfetivo(comLink, agora), "AGUARDANDO_ENTRADA");
    assert.equal(statusEfetivo({ ...comLink, linkEntradaValidoAte: null }, agora), "EXPIRADA");
    assert.equal(statusEfetivo(comLink, new Date(entradaAte.getTime() + 20 * MIN)), "EXPIRADA");
  });
  it("AGUARDANDO_ENTRADA vencida com pagamento da entrada em conferência NÃO expira", () => {
    const entradaAte = new Date("2026-11-12T03:00:00Z");
    const depois = new Date(entradaAte.getTime() + 3 * HORA);
    const conferindo = encomenda({ status: "AGUARDANDO_ENTRADA", entradaAte, entradaEmConfirmacao: true });
    assert.equal(statusEfetivo(conferindo, depois), "AGUARDANDO_ENTRADA");
    assert.equal(statusEfetivo({ ...conferindo, entradaEmConfirmacao: false }, depois), "EXPIRADA");
  });
  it("cliente: pagar a entrada até 5 min antes de entradaAte; o restante de CONFIRMADA em diante, até quitar", () => {
    const entradaAte = new Date("2026-11-12T03:00:00Z");
    const aguardando = encomenda({ status: "AGUARDANDO_ENTRADA", entradaAte });
    assert.equal(acoesDaCliente(aguardando, new Date(entradaAte.getTime() - 5 * MIN)).pagarEntrada, true);
    assert.equal(acoesDaCliente(aguardando, new Date(entradaAte.getTime() - 5 * MIN + 1)).pagarEntrada, false);
    assert.equal(acoesDaCliente(aguardando, entradaAte).pagarEntrada, false);
    const confirmada = encomenda({ status: "CONFIRMADA", entradaAte, entradaPagaEm: new Date("2026-11-11T13:00:00Z") });
    assert.deepEqual(acoesDaCliente(confirmada, new Date("2026-11-11T14:00:00Z")), {
      pagarEntrada: false,
      pagarRestante: true,
      desistir: { devolucao: 6900, retido: 0 },
    });
    // Depois do corte, a mesma desistência retém a entrada.
    assert.deepEqual(acoesDaCliente(confirmada, entradaAte).desistir, { devolucao: 0, retido: 6900 });
    const quitada = { ...confirmada, restantePagoEm: new Date("2026-11-11T13:30:00Z") };
    assert.equal(acoesDaCliente(quitada, entradaAte).pagarRestante, false);
    assert.equal(acoesDaCliente(encomenda({ status: "ENTREGUE" }), entradaAte).desistir, null);
  });
  it("loja: aprovar na SOLICITADA; produção antes do corte avisa; entregar sem quitação fica bloqueado", () => {
    const agora = new Date("2026-11-11T12:00:00Z");
    const solicitada = acoesDaLoja({ ...encomenda(), devolucaoPendente: false, modo: "RETIRADA" }, agora);
    assert.deepEqual(solicitada.map((a) => a.acao), ["aprovar", "recusar", "avisada"]);
    const confirmada = acoesDaLoja(
      { ...encomenda({ status: "CONFIRMADA", entradaPagaEm: agora }), devolucaoPendente: true, modo: "ENTREGA" },
      agora,
    );
    assert.match(confirmada.find((a) => a.acao === "iniciar-producao")!.aviso ?? "", /ainda pode desistir com devolução integral até quarta-feira, 11\/11\/2026, às 23h59/);
    assert.ok(confirmada.some((a) => a.acao === "devolucao-feita"));
    const pronta = acoesDaLoja({ ...encomenda({ status: "PRONTA", entradaPagaEm: agora }), devolucaoPendente: false, modo: "RETIRADA" }, agora);
    const entregar = pronta.find((a) => a.acao === "marcar-entregue")!;
    assert.deepEqual([entregar.rotulo, entregar.permitida], ["Marcar como retirada", false]);
    assert.ok(pronta.some((a) => a.acao === "registrar-restante"));
  });
  it("cancelamento pela loja: padrão devolve tudo; a pedido da cliente, o mínimo da política", () => {
    const e = encomenda({ status: "CONFIRMADA", entradaPagaEm: new Date(), restantePagoEm: new Date() });
    assert.deepEqual(valoresDoCancelamento(e, e.corteEm), {
      totalPago: 16800,
      pelaLoja: { devolucao: 16800, retido: 0 },
      aPedidoDaCliente: { devolucao: 9900, retido: 6900 },
    });
  });
});

describe("referência da parcela e conferência do pagamento (InfinitePay)", () => {
  const linha = (extra: Partial<Parameters<typeof alvoDaCobranca>[0]>) => ({
    orderId: null,
    encomendaId: "cm123",
    parcela: "ENTRADA" as "ENTRADA" | "RESTANTE" | null,
    referenciaExterna: referenciaDaEncomenda("cm123", "ENTRADA", 1),
    ...extra,
  });
  it("cada parcela tem a sua referência por tentativa: enc-<id>-<PARCELA>-<n>", () => {
    assert.equal(referenciaDaEncomenda("cm123", "ENTRADA", 1), "enc-cm123-ENTRADA-1");
    assert.equal(referenciaDaEncomenda("cm123", "RESTANTE", 2), "enc-cm123-RESTANTE-2");
  });
  it("o alvo sai da linha conferida contra a referência gravada", () => {
    assert.deepEqual(alvoDaCobranca(linha({})), { tipo: "encomenda", encomendaId: "cm123", parcela: "ENTRADA" });
    assert.deepEqual(alvoDaCobranca(linha({ parcela: "RESTANTE", referenciaExterna: "enc-cm123-RESTANTE-3" })), {
      tipo: "encomenda",
      encomendaId: "cm123",
      parcela: "RESTANTE",
    });
    assert.deepEqual(alvoDaCobranca({ orderId: "pd9", encomendaId: null, parcela: null, referenciaExterna: "ped-pd9-1" }), { tipo: "pedido", orderId: "pd9" });
  });
  it("linha da ENTRADA com a referência do RESTANTE (ou de outra encomenda) não quita nada", () => {
    assert.equal(alvoDaCobranca(linha({ referenciaExterna: "enc-cm123-RESTANTE-1" })), null);
    assert.equal(alvoDaCobranca(linha({ parcela: "RESTANTE" })), null);
    assert.equal(alvoDaCobranca(linha({ referenciaExterna: "enc-outra-ENTRADA-1" })), null);
    assert.equal(alvoDaCobranca(linha({ referenciaExterna: "ped-cm123-1" })), null);
  });
  it("alvo incoerente (o que a CHECK pagamentos_alvo recusa no banco): null", () => {
    assert.equal(alvoDaCobranca(linha({ orderId: "pd9" })), null, "os dois alvos");
    assert.equal(alvoDaCobranca(linha({ encomendaId: null, parcela: null, referenciaExterna: "ped-x-1" })), null, "nenhum alvo");
    assert.equal(alvoDaCobranca(linha({ parcela: null })), null, "encomenda sem parcela");
    assert.equal(alvoDaCobranca({ orderId: "pd9", encomendaId: null, parcela: "ENTRADA", referenciaExterna: "ped-pd9-1" }), null, "pedido com parcela");
    assert.equal(alvoDaCobranca({ orderId: "pd9", encomendaId: null, parcela: null, referenciaExterna: "ped-outro-1" }), null, "pedido com referência de outro");
  });
  it("o RESTANTE NÃO quita a ENTRADA: transação do link do restante, conferida com a referência da entrada, é recusada", () => {
    const conferencia = lerConferencia({ success: true, paid: true, amount: 6900, paid_amount: 6900, installments: 1, capture_method: "pix", order_nsu: "enc-cm123-RESTANTE-1" })!;
    assert.deepEqual(classificarConferencia(conferencia, 6900, "enc-cm123-ENTRADA-1"), { tipo: "INVALIDO" });
    assert.equal(classificarConferencia(conferencia, 6900, "enc-cm123-RESTANTE-1").tipo, "APROVADO");
    // Nem quita um pedido comum.
    assert.deepEqual(classificarConferencia(conferencia, 6900, "ped-cm123-1"), { tipo: "INVALIDO" });
  });
});

describe("etapa do pagamento da parcela", () => {
  const base = { parcela: "ENTRADA" as const, status: "AGUARDANDO_ENTRADA" as StatusEncomenda, paga: false, gatewayAtivo: true, divergente: false, emConfirmacao: false };
  const etapa = (e: typeof base | (Omit<typeof base, "parcela" | "status"> & { parcela: "ENTRADA" | "RESTANTE"; status: StatusEncomenda })) => {
    const r = etapaDaParcela(e);
    return r.motivoIndisponivel ? `${r.etapa}:${r.motivoIndisponivel}` : r.etapa;
  };
  it("na ordem: paga, encerrada, divergente, não liberada, desligado, em conferência, pagar", () => {
    assert.equal(etapa({ ...base, paga: true, status: "CANCELADA" }), "PAGO");
    assert.equal(etapa({ ...base, status: "EXPIRADA" }), "EXPIRADO");
    assert.equal(etapa({ ...base, status: "RECUSADA" }), "CANCELADO");
    assert.equal(etapa({ ...base, divergente: true, gatewayAtivo: false }), "CONFIRMANDO");
    assert.equal(etapa({ ...base, gatewayAtivo: false, emConfirmacao: true }), "INDISPONIVEL:PAGAMENTO_FORA_DO_AR");
    assert.equal(etapa({ ...base, emConfirmacao: true }), "CONFIRMANDO");
    assert.equal(etapa({ ...base, status: "SOLICITADA" }), "INDISPONIVEL:NAO_LIBERADA");
    assert.equal(etapa({ ...base, status: "SOLICITADA", gatewayAtivo: false }), "INDISPONIVEL:NAO_LIBERADA");
    assert.equal(etapa(base), "PAGAR");
  });
  it("o restante só é liberado com a encomenda confirmada", () => {
    const restante = { ...base, parcela: "RESTANTE" as const };
    assert.equal(etapa(restante), "INDISPONIVEL:NAO_LIBERADA");
    for (const status of ["CONFIRMADA", "EM_PRODUCAO", "PRONTA"] as const) assert.equal(etapa({ ...restante, status }), "PAGAR");
  });
});

describe("painel: alerta e faixa da devolução no cancelamento", () => {
  it("alerta por prioridade: devolução pendente, divergência, aviso parado", () => {
    const nada = { devolucaoPendente: false, pagamentoDivergente: false, avisoParadoHaMaisDe30Min: false };
    assert.equal(alertaDaEncomenda(nada), null);
    assert.equal(alertaDaEncomenda({ ...nada, avisoParadoHaMaisDe30Min: true }), "AVISO_NAO_CONFERIDO");
    assert.equal(alertaDaEncomenda({ ...nada, avisoParadoHaMaisDe30Min: true, pagamentoDivergente: true }), "PAGO_COM_DIVERGENCIA");
    assert.equal(alertaDaEncomenda({ devolucaoPendente: true, pagamentoDivergente: true, avisoParadoHaMaisDe30Min: true }), "DEVOLUCAO_PENDENTE");
  });
  it("a loja devolve no mínimo tudo; a pedido da cliente, depois do corte, no mínimo o que a regra manda", () => {
    const e = encomenda({ status: "CONFIRMADA", entradaPagaEm: new Date("2026-11-11T13:00:00Z") });
    const antes = new Date(e.corteEm.getTime() - 1);
    assert.deepEqual(faixaDaDevolucaoNoCancelamento(e, antes, false), { minimo: 6900, maximo: 6900 });
    assert.deepEqual(faixaDaDevolucaoNoCancelamento(e, antes, true), { minimo: 6900, maximo: 6900 });
    assert.deepEqual(faixaDaDevolucaoNoCancelamento(e, e.corteEm, true), { minimo: 0, maximo: 6900 });
    const metade = { ...e, percentualRetido: 50 };
    assert.deepEqual(faixaDaDevolucaoNoCancelamento(metade, e.corteEm, true), { minimo: 3450, maximo: 6900 });
    assert.deepEqual(faixaDaDevolucaoNoCancelamento(encomenda({ status: "AGUARDANDO_ENTRADA" }), e.corteEm, false), { minimo: 0, maximo: 0 });
  });
});

describe("telefone (a mesma regra dos pedidos)", () => {
  it("o schema devolve só os dígitos, celular ou fixo com DDD", () => {
    assert.equal(telefoneSchema.parse("(86) 99999-1234"), "86999991234");
    assert.equal(telefoneSchema.parse("86 3222-1234"), "8632221234");
    assert.equal(telefoneSchema.parse("+55 86 99999-1234"), "86999991234");
  });
  it("recusa DDD com zero, 12 dígitos e celular sem o 9", () => {
    for (const t of ["00999991234", "(86) 99999-12345", "86899991234", ""]) assert.equal(telefoneSchema.safeParse(t).success, false, t);
  });
});

describe("schemas", () => {
  const valido = {
    itens: [{ productId: "morango-112g", quantidade: 15 }],
    dataFesta: "2026-11-15",
    dataEntrega: "2026-11-14",
    modoEntrega: "RETIRADA",
    telefone: "(86) 99999-1234",
    aceitePolitica: true,
    politicaVersao: POLITICA_VERSAO,
    percentualRetido: 100,
    totalEsperadoCentavos: 9000,
  };
  const caminhos = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

  it("aceita a retirada sem endereço e normaliza o telefone", () => {
    const r = encomendaSchema.safeParse(valido);
    assert.equal(r.success, true);
    assert.equal(r.success && r.data.telefone, "86999991234");
    assert.equal(r.success && r.data.observacao, null);
  });
  it("retirada com endereço e entrega sem endereço são recusadas", () => {
    assert.deepEqual(caminhos(encomendaSchema.safeParse({ ...valido, addressId: "end1" })), ["endereco"]);
    assert.deepEqual(caminhos(encomendaSchema.safeParse({ ...valido, modoEntrega: "ENTREGA" })), ["endereco"]);
    assert.equal(encomendaSchema.safeParse({ ...valido, modoEntrega: "ENTREGA", addressId: "end1" }).success, true);
  });
  it("aceitePolitica: false é recusado", () => {
    assert.deepEqual(caminhos(encomendaSchema.safeParse({ ...valido, aceitePolitica: false })), ["aceitePolitica"]);
  });
  it("observação com U+202E (inverte o texto) é recusada", () => {
    assert.deepEqual(caminhos(encomendaSchema.safeParse({ ...valido, observacao: "tag ‮azul" })), ["observacao"]);
  });
  it("datas que não existem e quantidade fracionária são recusadas", () => {
    assert.deepEqual(caminhos(encomendaSchema.safeParse({ ...valido, dataFesta: "2026-02-30" })), ["dataFesta"]);
    assert.deepEqual(caminhos(encomendaSchema.safeParse({ ...valido, itens: [{ productId: "x", quantidade: 1.5 }] })), ["itens.0.quantidade"]);
  });
  it("motivo de recusa com menos de 5 caracteres é recusado", () => {
    assert.equal(acaoAdminSchema.safeParse({ acao: "recusar", statusEsperado: "SOLICITADA", motivo: "não" }).success, false);
    assert.equal(acaoAdminSchema.safeParse({ acao: "recusar", statusEsperado: "SOLICITADA", motivo: "Sem agenda nesse dia." }).success, true);
  });
  it("ação admin exige statusEsperado; cancelar exige devolverCentavos; avisada exige status", () => {
    assert.equal(acaoAdminSchema.safeParse({ acao: "aprovar" }).success, false);
    assert.equal(acaoAdminSchema.safeParse({ acao: "cancelar", statusEsperado: "CONFIRMADA", motivo: "Fogão quebrou." }).success, false);
    const c = acaoAdminSchema.safeParse({ acao: "cancelar", statusEsperado: "CONFIRMADA", motivo: "Fogão quebrou.", devolverCentavos: 6900 });
    assert.equal(c.success && c.data.acao === "cancelar" && c.data.aPedidoDaCliente, false);
    assert.equal(acaoAdminSchema.safeParse({ acao: "avisada", statusEsperado: "CONFIRMADA" }).success, false);
    assert.equal(acaoAdminSchema.safeParse({ acao: "registrar-restante", statusEsperado: "PRONTA", formaPagamento: "DINHEIRO" }).success, true);
    assert.equal(acaoAdminSchema.safeParse({ acao: "explodir", statusEsperado: "PRONTA" }).success, false);
  });
  it("desistência e configuração", () => {
    assert.equal(desistenciaSchema.safeParse({ devolucaoEsperadaCentavos: 6900 }).success, true);
    assert.equal(desistenciaSchema.safeParse({ devolucaoEsperadaCentavos: 69.5 }).success, false);
    const cfg = { precoPotinhoCentavos: "600", pesoPotinhoGramas: 110, pesoEmbalagemGramas: 300, percentualRetido: 100, ativo: false };
    assert.equal(configLembrancinhasSchema.parse(cfg).precoPotinhoCentavos, 600);
    assert.equal(configLembrancinhasSchema.safeParse({ ...cfg, percentualRetido: 101 }).success, false);
    assert.equal(configLembrancinhasSchema.safeParse({ ...cfg, precoPotinhoCentavos: 0 }).success, false);
  });
});

describe("idempotência, agenda, linha do tempo e WhatsApp", () => {
  const conteudo = {
    itens: [{ productId: "a", quantidade: 10 }, { productId: "b", quantidade: 5 }],
    dataFesta: "2026-11-15",
    dataEntrega: "2026-11-14",
    modoEntrega: "RETIRADA" as const,
    telefone: "86999991234",
  };
  it("mesmaEncomenda ignora a ordem e as linhas repetidas; muda com data, modo, quantidade ou telefone", () => {
    assert.equal(mesmaEncomenda(conteudo, { ...conteudo, itens: [{ productId: "b", quantidade: 5 }, { productId: "a", quantidade: 4 }, { productId: "a", quantidade: 6 }] }), true);
    assert.equal(mesmaEncomenda(conteudo, { ...conteudo, dataFesta: "2026-11-16" }), false);
    assert.equal(mesmaEncomenda(conteudo, { ...conteudo, dataEntrega: "2026-11-13" }), false);
    assert.equal(mesmaEncomenda(conteudo, { ...conteudo, modoEntrega: "ENTREGA" }), false);
    assert.equal(mesmaEncomenda(conteudo, { ...conteudo, itens: [{ productId: "a", quantidade: 11 }, { productId: "b", quantidade: 5 }] }), false);
    assert.equal(mesmaEncomenda(conteudo, { ...conteudo, telefone: "86999990000" }), false);
  });

  it("agendaPorDia soma por dia e por sabor; aguardando entrada fica à parte; encerradas não entram", () => {
    const item = (productId: string, sabor: string, quantidade: number) => ({ productId, sabor, quantidade });
    const agenda = agendaPorDia([
      { id: "1", dataEntrega: "2026-11-14", status: "CONFIRMADA", itens: [item("m", "Morango", 10), item("p", "Pimenta", 5)] },
      { id: "2", dataEntrega: "2026-11-14", status: "PRONTA", itens: [item("p", "Pimenta", 20)] },
      { id: "3", dataEntrega: "2026-11-14", status: "AGUARDANDO_ENTRADA", itens: [item("m", "Morango", 15)] },
      { id: "4", dataEntrega: "2026-11-13", status: "EM_PRODUCAO", itens: [item("m", "Morango", 15)] },
      { id: "5", dataEntrega: "2026-11-13", status: "CANCELADA", itens: [item("m", "Morango", 50)] },
      { id: "6", dataEntrega: "2026-11-13", status: "SOLICITADA", itens: [item("m", "Morango", 50)] },
    ]);
    assert.deepEqual(
      agenda.map((d) => [d.dia, d.encomendas, d.potinhos, d.aguardandoEntrada, d.potinhosAguardando, d.porSabor.map((s) => `${s.sabor}:${s.potinhos}`)]),
      [
        ["2026-11-13", 1, 15, 0, 0, ["Morango:15"]],
        ["2026-11-14", 2, 35, 1, 15, ["Pimenta:25", "Morango:10"]],
      ],
    );
  });

  it("linha do tempo em ordem, com as devoluções", () => {
    const linha = linhaDoTempo({
      status: "CANCELADA",
      modo: "RETIRADA",
      criadaEm: new Date("2026-11-10T15:00:00Z"),
      aprovadaEm: new Date("2026-11-11T12:00:00Z"),
      entradaAte: new Date("2026-11-12T03:00:00Z"),
      entradaPagaEm: new Date("2026-11-11T13:00:00Z"),
      producaoIniciadaEm: null,
      prontaEm: null,
      restantePagoEm: null,
      restanteForaDoSite: false,
      entregueEm: null,
      encerradaEm: new Date("2026-11-11T20:00:00Z"),
      motivoRecusa: null,
      canceladaPor: "CLIENTE",
      devolucoes: [{ valorCentavos: 6900, criadaEm: new Date("2026-11-11T20:00:00Z"), feitaEm: new Date("2026-11-12T10:00:00Z") }],
    });
    // O Intl separa "R$" do valor com espaço não separável (U+00A0).
    assert.deepEqual(linha.map((l) => l.texto.replace(/ /g, " ")), [
      "Solicitação enviada.",
      "A Geleiô aprovou. Entrada a pagar até quarta-feira, 11/11/2026, às 23h59.",
      "Entrada paga: encomenda confirmada.",
      "Você desistiu da encomenda.",
      "Devolução de R$ 69,00 a fazer.",
      "Devolução de R$ 69,00 feita.",
    ]);
  });

  it("linkWhatsApp gera wa.me/55… com o texto codificado", () => {
    assert.equal(linkWhatsApp("86999991234", "Oi, Ana! R$ 69,00 & tal"), "https://wa.me/5586999991234?text=Oi%2C%20Ana!%20R%24%2069%2C00%20%26%20tal");
  });

  it("mensagem da aprovação traz a entrada, o prazo e o link", () => {
    const texto = mensagemWhatsApp("AGUARDANDO_ENTRADA", {
      nome: "Ana Maria",
      codigo: "#ABC12345",
      potinhos: 23,
      dataFesta: "2026-11-15",
      dataEntrega: "2026-11-14",
      modo: "RETIRADA",
      entradaCentavos: 6900,
      restanteCentavos: 9900,
      entradaAte: new Date("2026-11-12T03:00:00Z"),
      motivo: null,
      link: "https://geleio.example/minhas-encomendas/x",
      devolucaoCentavos: 0,
    });
    assert.match(texto, /^Oi, Ana! Aqui é da Geleiô\. Sua encomenda #ABC12345 \(23 potinhos, festa em 15\/11\/2026\) foi aprovada!/);
    assert.match(texto, /entrada de R\$\s69,00 pelo site até quarta-feira, 11\/11\/2026, às 23h59/);
    assert.match(texto, /https:\/\/geleio\.example\/minhas-encomendas\/x$/);
    for (const s of STATUS_ENCOMENDA as readonly StatusEncomenda[]) {
      assert.ok(mensagemWhatsApp(s, { nome: "", codigo: "#X", potinhos: 15, dataFesta: "2026-11-15", dataEntrega: "2026-11-14", modo: "ENTREGA", entradaCentavos: 1, restanteCentavos: 1, entradaAte: null, motivo: null, link: null, devolucaoCentavos: 0 }).length > 10, s);
    }
  });
});

describe("política de desistência", () => {
  const dados = {
    corteEm: new Date("2026-11-12T03:00:00Z"),
    entradaCentavos: 6900,
    restanteCentavos: 9900,
    freteCentavos: 3000,
    modo: "RETIRADA" as const,
    percentualRetido: 100,
  };
  it("100%: a entrada fica com a Geleiô; datas e valores concretos", () => {
    const textos = textosDaPolitica(POLITICA_VERSAO, dados);
    assert.equal(textos.length, 6);
    assert.match(textos[1], /^Até quarta-feira, 11\/11\/2026, às 23h59 \(horário de Teresina\), 3 dias antes da retirada/);
    assert.match(textos[1], /em até 2 dias úteis/);
    assert.match(textos[2], /a entrada \(R\$\s69,00\) fica com a Geleiô/);
    assert.match(textos[4], /O restante \(R\$\s99,00, com o frete\)/);
    assert.match(textos[5], /Código de Defesa do Consumidor/);
  });
  it("menos de 100%: X% da entrada (R$ Y) fica e devolvemos o resto", () => {
    const textos = textosDaPolitica(POLITICA_VERSAO, { ...dados, percentualRetido: 50 });
    assert.match(textos[2], /50% da entrada \(R\$\s34,50\) fica com a Geleiô .* e devolvemos o resto/);
  });
  it("0%: devolve tudo também depois do corte; sem frete, sem 'com o frete'", () => {
    const textos = textosDaPolitica(POLITICA_VERSAO, { ...dados, percentualRetido: 0, freteCentavos: 0 });
    assert.match(textos[2], /também devolvemos 100%/);
    assert.doesNotMatch(textos[4], /frete/);
  });
  it("versão desconhecida é recusada", () => {
    assert.equal(versaoDaPoliticaConhecida(POLITICA_VERSAO), true);
    assert.equal(versaoDaPoliticaConhecida("2020-01-v0"), false);
    assert.throws(() => textosDaPolitica("2020-01-v0", dados), RangeError);
    assert.match(AVISO_JURIDICO, /Procon-PI/);
  });
});
