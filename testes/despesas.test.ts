// Testes das regras puras de dinheiro, despesas e validação. Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import { PADRAO_MES, formatarCustoUnitario, hojeNaLoja, lerQuantidade, nomeDoMes, somarMeses } from "@/lib/despesas";
import { despesaSchema } from "@/lib/validacao";

describe("lerValorEmCentavos", () => {
  const aceitos: [string, number][] = [
    ["20", 2000],
    ["20,00", 2000],
    ["20,5", 2050],
    ["R$ 1.234,56", 123456],
    ["1.000", 100000],
    ["1.000,00", 100000],
    ["20.5", 2050],
    ["20.50", 2050],
    ["0,29", 29],
    [",50", 50],
    [".50", 50],
    ["  12,34 ", 1234],
  ];
  for (const [texto, esperado] of aceitos) {
    it(`"${texto}" → ${esperado}`, () => assert.equal(lerValorEmCentavos(texto), esperado));
  }

  // Malformado ou ambíguo: recusa em vez de gravar outro valor.
  for (const texto of ["", "abc", "0.299", "1.2345", "1.5.0", "12.34.5", "12.34,56", "1.2,50", "1.23,45", "20,123", "-5", "1,2,3"]) {
    it(`"${texto}" → null`, () => assert.equal(lerValorEmCentavos(texto), null));
  }

  it("valorParaCampo devolve o formato que a leitura aceita", () => {
    for (const reais of [0.29, 20, 1234.56]) assert.equal(lerValorEmCentavos(valorParaCampo(reais)), Math.round(reais * 100));
  });
});

describe("lerQuantidade", () => {
  const aceitos: [string, number][] = [
    ["50", 50],
    ["2,5", 2.5],
    ["0,250", 0.25],
    ["0.5", 0.5],
    ["0.500", 0.5],
    ["1.000", 1000],
    ["1.000,5", 1000.5],
    ["0,001", 0.001],
  ];
  for (const [texto, esperado] of aceitos) {
    it(`"${texto}" → ${esperado}`, () => assert.equal(lerQuantidade(texto), esperado));
  }
  for (const texto of ["", "0", "0,000", "0,0001", "1.2,5", "2,5,5", "x"]) {
    it(`"${texto}" → null`, () => assert.equal(lerQuantidade(texto), null));
  }
});

describe("meses", () => {
  it("somarMeses vira o ano nos dois sentidos", () => {
    assert.equal(somarMeses("2026-12", 1), "2027-01");
    assert.equal(somarMeses("2026-01", -1), "2025-12");
    assert.equal(somarMeses("2026-10", -22), "2024-12");
    assert.equal(somarMeses("2026-10", 0), "2026-10");
  });
  it("PADRAO_MES aceita 2020–2099 e recusa o resto", () => {
    for (const ok of ["2020-01", "2026-10", "2099-12"]) assert.ok(PADRAO_MES.test(ok), ok);
    for (const ruim of ["2019-12", "2100-01", "9999-12", "0000-01", "2026-13", "2026-00", "2026-1", "abc"]) {
      assert.ok(!PADRAO_MES.test(ruim), ruim);
    }
  });
  it("nomeDoMes", () => assert.equal(nomeDoMes("2026-03"), "março de 2026"));
});

describe("formatarCustoUnitario", () => {
  // O Intl usa espaço não separável depois do "R$".
  const f = (v: number, q: number) => formatarCustoUnitario(v, q)?.replace(/ /g, " ");
  it("R$ 20,00 por 50 → R$ 0,40", () => assert.equal(f(20, 50), "R$ 0,40"));
  it("R$ 7,00 por 1.000 → R$ 0,007", () => assert.equal(f(7, 1000), "R$ 0,007"));
  it("nunca mostra R$ 0,00 para custo minúsculo", () => {
    assert.notEqual(f(1, 100_000), "R$ 0,00");
    assert.notEqual(f(20, 1_000_000), "R$ 0,00");
  });
  it("quantidade zero → null", () => assert.equal(formatarCustoUnitario(10, 0), null));
});

describe("despesaSchema", () => {
  const hoje = hojeNaLoja();
  const base = { descricao: "Adesivos", categoria: "ROTULOS", quantidade: 50, unidade: "UN", valorCentavos: 2000 };

  it("sem data vale hoje (relógio do servidor)", () => {
    const r = despesaSchema.safeParse(base);
    assert.ok(r.success);
    assert.equal(r.data.data, hoje);
  });
  it("fornecedor e observação aceitam null e vazio", () => {
    const r = despesaSchema.safeParse({ ...base, fornecedor: null, observacao: "" });
    assert.ok(r.success);
    assert.equal(r.data.fornecedor, null);
    assert.equal(r.data.observacao, null);
  });

  const amanha = (() => {
    const [a, m, d] = hoje.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
  })();
  const recusados: [string, Record<string, unknown>, string][] = [
    ["data no futuro", { data: amanha }, "data"],
    ["data antes de 2020", { data: "2019-12-31" }, "data"],
    ["data que não existe", { data: "2026-02-30" }, "data"],
    ["quantidade minúscula (viraria 0 no banco)", { quantidade: 1e-10 }, "quantidade"],
    ["quantidade com 4 casas", { quantidade: 1.2345 }, "quantidade"],
    ["valor com fração de centavo", { valorCentavos: 10.5 }, "valorCentavos"],
    ["caractere nulo na descrição", { descricao: "Ades\u0000ivos" }, "descricao"],
    ["caractere de controle no fornecedor", { fornecedor: "Gr\u0007afica" }, "fornecedor"],
  ];
  for (const [nome, troca, campo] of recusados) {
    it(`recusa ${nome}`, () => {
      const r = despesaSchema.safeParse({ ...base, ...troca });
      assert.ok(!r.success, "deveria recusar");
      assert.ok(r.error.issues.some((i) => i.path[0] === campo), `erro esperado em ${campo}`);
    });
  }
  it("observação com quebra de linha passa", () => {
    assert.ok(despesaSchema.safeParse({ ...base, observacao: "linha 1\nlinha 2" }).success);
  });
});
