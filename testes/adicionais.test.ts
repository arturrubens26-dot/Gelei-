// Testes das regras puras dos itens adicionais dos mimos (preço do servidor, total, rateio da entrada, validação
// dos ids, cadastro do painel) e das novas regras de quantidade (20 a 50) e antecedência (10 dias).
// Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AVISO_PRECO_ZERO,
  IDS_ADICIONAIS_PADRAO,
  LEGENDA_IMAGEM_ILUSTRATIVA,
  MAX_ADICIONAIS_POR_ENCOMENDA,
  adicionalAdminSchema,
  adicionalAtivoSchema,
  conferirAdicionais,
  ehAdicionalPadrao,
  idsDeAdicionaisSchema,
  listaDeNomes,
  precoPorPotinhoDosAdicionais,
  rotuloDoPrecoAdicional,
  totalDosAdicionais,
  type AdicionalDoCatalogo,
} from "@/lib/adicionais-regras";
import {
  ANTECEDENCIA_MIN_DIAS,
  MAX_POTINHOS,
  MIN_POTINHOS,
  calcularValores,
  conferirPotinhos,
  encomendaSchema,
  faixaDeDatas,
  validarDatas,
} from "@/lib/encomendas-regras";

// O catálogo ATIVO como o servidor o lê do banco (ordem do painel). Preços em centavos por potinho.
const catalogo: AdicionalDoCatalogo[] = [
  { id: "florzinhas", nome: "Florzinhas", precoCentavos: 50 },
  { id: "paninho-na-tampa", nome: "Paninho na tampa", precoCentavos: 120 },
  { id: "caixinha", nome: "Caixinha confeccionada para o pote", precoCentavos: 0 },
  { id: "colherzinha", nome: "Colherzinha pequena", precoCentavos: 30 },
];

describe("limites da encomenda: de 20 a 50 potinhos, 10 dias de antecedência", () => {
  const mini = new Set(["morango"]);
  it("as constantes", () => {
    assert.equal(MIN_POTINHOS, 20);
    assert.equal(MAX_POTINHOS, 50);
    assert.equal(ANTECEDENCIA_MIN_DIAS, 10);
  });
  it("19 recusado (com a mensagem); 20 e 50 aceitos; 51 recusado", () => {
    const poucos = conferirPotinhos([{ productId: "morango", quantidade: 19 }], mini);
    assert.equal(!poucos.ok && poucos.mensagem, "Mínimo de 20 potinhos; você escolheu 19.");
    assert.equal(conferirPotinhos([{ productId: "morango", quantidade: 20 }], mini).ok, true);
    assert.equal(conferirPotinhos([{ productId: "morango", quantidade: 50 }], mini).ok, true);
    const muitos = conferirPotinhos([{ productId: "morango", quantidade: 51 }], mini);
    assert.equal(!muitos.ok && muitos.mensagem, "Máximo de 50 potinhos; você escolheu 51.");
  });
  it("o schema da API aceita até 50 por sabor (o mínimo do total é conferido no servidor)", () => {
    const base = {
      itens: [{ productId: "m", quantidade: 50 }],
      dataFesta: "2026-12-20",
      dataEntrega: "2026-12-19",
      modoEntrega: "RETIRADA",
      telefone: "(86) 99999-1234",
      aceitePolitica: true,
      politicaVersao: "2026-11-v2",
      percentualRetido: 0,
      totalEsperadoCentavos: 1,
    };
    assert.equal(encomendaSchema.safeParse(base).success, true);
    assert.equal(encomendaSchema.safeParse({ ...base, itens: [{ productId: "m", quantidade: 51 }] }).success, false);
  });
  it("festa a partir de hoje+10; entrega ou retirada de hoje+9; a contagem não inclui o dia do pedido", () => {
    assert.deepEqual(faixaDeDatas("2026-11-07"), { festaMin: "2026-11-17", festaMax: "2027-02-05", entregaMin: "2026-11-16", entregaMax: "2027-02-04" });
    assert.equal(validarDatas({ hoje: "2026-11-07", dataFesta: "2026-11-17", dataEntrega: "2026-11-16" }).ok, true);
    const cedo = validarDatas({ hoje: "2026-11-07", dataFesta: "2026-11-16", dataEntrega: "2026-11-15" });
    assert.equal(cedo.ok, false);
    assert.equal(!cedo.ok && cedo.erros.dataFesta?.[0], "A festa precisa ser a partir de 17/11/2026 (10 dias de antecedência).");
  });
});

describe("itens adicionais: preço do servidor e conferência dos ids", () => {
  it("sem nenhum item marcado: tudo certo e total zero", () => {
    const r = conferirAdicionais([], catalogo);
    assert.deepEqual(r, { ok: true, itens: [] });
    assert.equal(totalDosAdicionais([], 25), 0);
  });

  it("devolve os itens do SERVIDOR (nome e preço), na ordem do catálogo, qualquer que seja a ordem marcada", () => {
    const r = conferirAdicionais(["colherzinha", "florzinhas"], catalogo);
    assert.deepEqual(r.ok && r.itens, [catalogo[0], catalogo[3]]);
  });

  it("id desconhecido ou item desativado (fora do catálogo ativo): recusa e diz quais", () => {
    const ativos = catalogo.filter((a) => a.id !== "caixinha"); // a dona desativou a caixinha
    const r = conferirAdicionais(["florzinhas", "caixinha", "inventado"], ativos);
    assert.deepEqual(r.ok ? null : [r.motivo, r.ids], ["indisponivel", ["caixinha", "inventado"]]);
    assert.match(r.ok ? "" : r.mensagem, /não estão mais disponíveis/);
  });

  it("repetidos: recusa e diz quais, mesmo que o resto seja válido", () => {
    const r = conferirAdicionais(["florzinhas", "florzinhas", "caixinha", "caixinha", "caixinha"], catalogo);
    assert.deepEqual(r.ok ? null : [r.motivo, r.ids], ["duplicado", ["florzinhas", "caixinha"]]);
  });

  it("o schema da API: sem o campo = nenhum; repetidos e excesso viram erro em `adicionais`", () => {
    assert.deepEqual(idsDeAdicionaisSchema.parse(undefined), []);
    assert.deepEqual(idsDeAdicionaisSchema.parse(["florzinhas", "caixinha"]), ["florzinhas", "caixinha"]);
    assert.equal(idsDeAdicionaisSchema.safeParse(["florzinhas", "florzinhas"]).success, false);
    assert.equal(idsDeAdicionaisSchema.safeParse([""]).success, false);
    assert.equal(idsDeAdicionaisSchema.safeParse(Array.from({ length: MAX_ADICIONAIS_POR_ENCOMENDA + 1 }, (_, i) => `i${i}`)).success, false);
    const base = {
      itens: [{ productId: "m", quantidade: 20 }],
      dataFesta: "2026-12-20",
      dataEntrega: "2026-12-19",
      modoEntrega: "RETIRADA",
      telefone: "(86) 99999-1234",
      aceitePolitica: true,
      politicaVersao: "2026-11-v2",
      percentualRetido: 0,
      totalEsperadoCentavos: 1,
    };
    const ok = encomendaSchema.safeParse({ ...base, adicionais: ["florzinhas"] });
    assert.equal(ok.success && ok.data.adicionais[0], "florzinhas");
    assert.deepEqual(encomendaSchema.safeParse(base).success && encomendaSchema.parse(base).adicionais, []);
    const repetido = encomendaSchema.safeParse({ ...base, adicionais: ["florzinhas", "florzinhas"] });
    assert.equal(repetido.success ? null : repetido.error.issues[0].path.join("."), "adicionais");
  });

  it("o cliente não manda preço: um campo `precoCentavos` no corpo é ignorado pelo schema", () => {
    const base = {
      itens: [{ productId: "m", quantidade: 20 }],
      dataFesta: "2026-12-20",
      dataEntrega: "2026-12-19",
      modoEntrega: "RETIRADA",
      telefone: "(86) 99999-1234",
      aceitePolitica: true,
      politicaVersao: "2026-11-v2",
      percentualRetido: 0,
      totalEsperadoCentavos: 1,
      adicionais: ["florzinhas"],
      adicionaisPrecos: { florzinhas: 0 },
    };
    const lido = encomendaSchema.safeParse(base);
    assert.equal(lido.success, true);
    assert.equal(lido.success && "adicionaisPrecos" in lido.data, false);
  });
});

describe("itens adicionais: valor, total e rateio entre entrada e restante", () => {
  const marcados = [catalogo[0], catalogo[1], catalogo[3]]; // 50 + 120 + 30 = 200 centavos por potinho

  it("preço por potinho somado; valor = soma × potinhos (todos os potinhos levam todos os itens)", () => {
    assert.equal(precoPorPotinhoDosAdicionais(marcados), 200);
    assert.equal(totalDosAdicionais(marcados, 25), 5000);
    assert.equal(totalDosAdicionais([catalogo[2]], 25), 0); // preço 0 = sem custo
  });

  it("potinhos inválidos (negativo, quebrado) levantam erro", () => {
    assert.throws(() => totalDosAdicionais(marcados, -1), RangeError);
    assert.throws(() => totalDosAdicionais(marcados, 2.5), RangeError);
  });

  it("25 potinhos × R$ 6,00 + adicionais R$ 50,00 + frete R$ 15,00: total 21500, entrada 10000, restante 11500", () => {
    const v = calcularValores({ subtotalCentavos: 25 * 600, adicionaisCentavos: totalDosAdicionais(marcados, 25), freteCentavos: 1500 });
    assert.deepEqual(v, { subtotal: 15000, adicionais: 5000, frete: 1500, total: 21500, entrada: 10000, restante: 11500 });
  });

  it("a entrada é 50% de (potinhos + adicionais), sem o frete, arredondada para cima; o restante leva o frete", () => {
    const v = calcularValores({ subtotalCentavos: 20 * 599, adicionaisCentavos: 20 * 55, freteCentavos: 1500 }); // 11980 + 1100 = 13080
    assert.equal(v.entrada, 6540);
    assert.equal(v.restante, 13080 + 1500 - 6540);
    const impar = calcularValores({ subtotalCentavos: 20 * 599, adicionaisCentavos: 21, freteCentavos: 0 }); // 11980 + 21 = 12001
    assert.equal(impar.entrada, 6001); // ceil(12001 / 2)
    assert.equal(impar.restante, 6000);
  });

  it("sem adicionais, nada muda em relação a antes (adicionais = 0)", () => {
    const a = calcularValores({ subtotalCentavos: 23 * 600, freteCentavos: 3000 });
    const b = calcularValores({ subtotalCentavos: 23 * 600, adicionaisCentavos: 0, freteCentavos: 3000 });
    assert.deepEqual(a, b);
    assert.equal(a.adicionais, 0);
    assert.equal(a.entrada, 6900);
    assert.equal(a.restante, 9900);
  });

  it("propriedade (500 casos): entrada + restante = total = potinhos + adicionais + frete", () => {
    let semente = 20261107;
    const aleatorio = (max: number) => {
      semente = (semente * 1103515245 + 12345) % 2 ** 31;
      return semente % max;
    };
    for (let i = 0; i < 500; i++) {
      const potinhos = MIN_POTINHOS + aleatorio(MAX_POTINHOS - MIN_POTINHOS + 1);
      const preco = 1 + aleatorio(99_999);
      const itens = catalogo.filter(() => aleatorio(2) === 0).map((a) => ({ ...a, precoCentavos: aleatorio(2000) }));
      const adicionais = totalDosAdicionais(itens, potinhos);
      const frete = aleatorio(2) === 0 ? 0 : aleatorio(10_000);
      const v = calcularValores({ subtotalCentavos: potinhos * preco, adicionaisCentavos: adicionais, freteCentavos: frete });
      assert.equal(v.total, potinhos * preco + adicionais + frete);
      assert.equal(v.entrada + v.restante, v.total);
      assert.ok(v.entrada > 0 && v.restante >= frete);
      assert.equal(v.entrada, Math.ceil((potinhos * preco + adicionais) / 2));
    }
  });

  it("snapshot: o valor da encomenda sai do preço congelado, não do cadastro de agora", () => {
    // Na solicitação a florzinha custava 50 centavos por potinho; depois a dona subiu para 90.
    const congelado = [{ precoCentavos: 50 }];
    const cadastroDeHoje = [{ precoCentavos: 90 }];
    assert.equal(totalDosAdicionais(congelado, 30), 1500);
    assert.notEqual(totalDosAdicionais(cadastroDeHoje, 30), totalDosAdicionais(congelado, 30));
  });
});

describe("itens adicionais: textos e cadastro do painel", () => {
  it("rótulo do preço: sem custo ou por potinho", () => {
    assert.equal(rotuloDoPrecoAdicional(0), "sem custo");
    assert.match(rotuloDoPrecoAdicional(50).replace(/ /g, " "), /^\+ R\$ 0,50 por potinho$/);
  });

  it("lista de nomes em português", () => {
    assert.equal(listaDeNomes([]), "");
    assert.equal(listaDeNomes(["Florzinhas"]), "Florzinhas");
    assert.equal(listaDeNomes(["Florzinhas", "Caixinha"]), "Florzinhas e Caixinha");
    assert.equal(listaDeNomes(["A", "B", "C"]), "A, B e C");
  });

  it("os quatro itens padrão e as frases fixas", () => {
    assert.deepEqual([...IDS_ADICIONAIS_PADRAO], ["florzinhas", "paninho-na-tampa", "caixinha", "colherzinha"]);
    assert.equal(ehAdicionalPadrao("caixinha"), true);
    assert.equal(ehAdicionalPadrao("outro"), false);
    assert.equal(LEGENDA_IMAGEM_ILUSTRATIVA, "Imagem ilustrativa");
    assert.match(AVISO_PRECO_ZERO, /R\$ 0,00 = sem custo/);
  });

  it("edição no painel: preço 0 vale; negativo, quebrado e texto vazio não", () => {
    const base = { nome: "Florzinhas", descricao: "Florzinhas para enfeitar.", precoCentavos: "0", ativo: "true", ordem: "1" };
    const ok = adicionalAdminSchema.safeParse(base);
    assert.equal(ok.success && ok.data.precoCentavos, 0);
    assert.equal(ok.success && ok.data.ativo, true);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, precoCentavos: "150" }).success, true);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, precoCentavos: "-1" }).success, false);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, precoCentavos: "1,5" }).success, false);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, precoCentavos: "100000" }).success, false); // acima de R$ 999,99
    assert.equal(adicionalAdminSchema.safeParse({ ...base, precoCentavos: "" }).success, false);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, nome: "  " }).success, false);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, descricao: "x".repeat(161) }).success, false);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, ordem: "-1" }).success, false);
    assert.equal(adicionalAdminSchema.safeParse({ ...base, ativo: "false" }).success && adicionalAdminSchema.parse({ ...base, ativo: "false" }).ativo, false);
  });

  it("só mostrar/ocultar exige um booleano de verdade", () => {
    assert.equal(adicionalAtivoSchema.safeParse({ ativo: false }).success, true);
    assert.equal(adicionalAtivoSchema.safeParse({ ativo: "false" }).success, false);
    assert.equal(adicionalAtivoSchema.safeParse({}).success, false);
  });
});
