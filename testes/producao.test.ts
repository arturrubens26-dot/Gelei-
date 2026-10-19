// Testes das contas da produção, com a Receita 1 do caderno (Geleia de Pimenta, 07/10/2026).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  centavos,
  custoDoItem,
  fatorConversao,
  formatarCustoMedio,
  formatarQtdInsumo,
  gerarCsv,
  linhaDeEstoque,
  situacaoDoEstoque,
  totaisDaProducao,
} from "@/lib/producao";
import { producaoSchema } from "@/lib/validacao-producao";

const sp = (s: string | null) => s?.replace(/ /g, " ");

// Compras do caderno: maçã 2,155 kg por R$ 15,06; açúcar 1 kg por R$ 3,39; pimenta 198 g por R$ 7,51.
const MACA = 15.06 / 2155;
const ACUCAR = 3.39 / 1000;
const PIMENTA = 7.51 / 198;

describe("Receita 1 do caderno", () => {
  it("custo de cada ingrediente usado bate com o caderno", () => {
    assert.equal(custoDoItem({ quantidade: 500, custoUnitario: MACA }), 3.49);
    assert.equal(custoDoItem({ quantidade: 350, custoUnitario: ACUCAR }), 1.19);
    assert.equal(custoDoItem({ quantidade: 27, custoUnitario: PIMENTA }), 1.02);
  });

  const itens = [
    { tipo: "INGREDIENTE" as const, quantidade: 500, custoUnitario: MACA },
    { tipo: "INGREDIENTE" as const, quantidade: 350, custoUnitario: ACUCAR },
    { tipo: "INGREDIENTE" as const, quantidade: 27, custoUnitario: PIMENTA },
    { tipo: "INGREDIENTE" as const, quantidade: 4, custoUnitario: 0 }, // limões do quintal
    { tipo: "EMBALAGEM" as const, quantidade: 7, custoUnitario: 3.98 }, // potes
  ];
  const custos = [
    { descricao: "Gás", valor: 1 },
    { descricao: "Energia", valor: 1 },
    { descricao: "Água", valor: 1 },
    { descricao: "Mão de obra", valor: 5 },
  ];
  const t = totaisDaProducao(itens, custos, 7, 24.9);

  it("totais do lote", () => {
    assert.equal(t.ingredientes, 5.7);
    assert.equal(t.extras, 8);
    assert.equal(t.embalagens, 27.86);
    assert.equal(t.total, 41.56);
  });
  it("custo por pote = (13,70 ÷ 7) + 3,98 = R$ 5,94", () => {
    assert.equal(t.geleiaPorPote, 1.96);
    assert.equal(t.embalagemPorPote, 3.98);
    assert.equal(t.porPote, 5.94);
  });
  it("margem com o preço do site (R$ 24,90)", () => {
    assert.equal(t.margemPorPote, 18.96);
    assert.ok(Math.abs((t.margemPct ?? 0) - 18.96 / 24.9) < 1e-9);
    // 7 × 24,90 − 41,56 (e não 18,96 × 7 = 132,72, que multiplica o arredondamento do custo por pote).
    assert.equal(t.lucroDoLote, 132.74);
  });
  it("geleia + embalagem por pote fecham com o custo por pote", () => {
    const x = totaisDaProducao(
      [
        { tipo: "INGREDIENTE", quantidade: 1, custoUnitario: 10 },
        { tipo: "EMBALAGEM", quantidade: 1, custoUnitario: 3.33 },
      ],
      [],
      7,
      null,
    );
    assert.equal(x.porPote, 1.9);
    assert.equal(centavos((x.geleiaPorPote ?? 0) + (x.embalagemPorPote ?? 0)), x.porPote);
  });
  it("custo do item arredonda como os totais (500 g a R$ 4,99/kg = R$ 2,50)", () => {
    assert.equal(custoDoItem({ quantidade: 500, custoUnitario: 4.99 / 1000 }), 2.5);
  });
  it("sobra de cada ingrediente depois da receita", () => {
    assert.equal(linhaDeEstoque({ comprado: 2155, totalComprado: 15.06, usado: 500, ajustado: 0 }).sobra, 1655);
    assert.equal(linhaDeEstoque({ comprado: 1000, totalComprado: 3.39, usado: 350, ajustado: 0 }).sobra, 650);
    assert.equal(linhaDeEstoque({ comprado: 198, totalComprado: 7.51, usado: 27, ajustado: 0 }).sobra, 171);
  });
  it("valor parado no estoque (sobra × custo médio)", () => {
    assert.equal(linhaDeEstoque({ comprado: 2155, totalComprado: 15.06, usado: 500, ajustado: 0 }).valorEmEstoque, 11.57);
  });
  it("insumo sem controle de estoque não tem valor parado", () => {
    assert.equal(linhaDeEstoque({ comprado: 2155, totalComprado: 15.06, usado: 500, ajustado: 0 }, false).valorEmEstoque, 0);
  });
});

describe("estoque", () => {
  it("sem potes não divide por zero", () => {
    const t = totaisDaProducao([{ tipo: "INGREDIENTE", quantidade: 1, custoUnitario: 1 }], [], 0, 20);
    assert.equal(t.porPote, null);
    assert.equal(t.margemPorPote, null);
  });
  it("ajuste de perda reduz a sobra", () => {
    assert.equal(linhaDeEstoque({ comprado: 1000, totalComprado: 10, usado: 300, ajustado: -200 }).sobra, 500);
  });
  it("sem compra não há custo médio nem valor em estoque", () => {
    const l = linhaDeEstoque({ comprado: 0, totalComprado: 0, usado: 0, ajustado: 50 });
    assert.equal(l.custoMedio, null);
    assert.equal(l.valorEmEstoque, 0);
  });
  it("situação: falta lançar compra, acabou, baixo, ok e sem controle", () => {
    const base = { estoqueMinimo: 100, controlaEstoque: true };
    assert.equal(situacaoDoEstoque({ ...base, sobra: -5 }), "negativo");
    assert.equal(situacaoDoEstoque({ ...base, sobra: 0 }), "acabou");
    assert.equal(situacaoDoEstoque({ ...base, sobra: 50 }), "baixo");
    assert.equal(situacaoDoEstoque({ ...base, sobra: 500 }), "ok");
    assert.equal(situacaoDoEstoque({ ...base, sobra: -5, controlaEstoque: false }), "sem-controle");
  });
  it("conversão da compra para a unidade do estoque", () => {
    assert.equal(fatorConversao("KG", "G"), 1000);
    assert.equal(fatorConversao("L", "ML"), 1000);
    assert.equal(fatorConversao("UN", "UN"), 1);
    assert.equal(fatorConversao("PACOTE", "G"), null);
    assert.equal(fatorConversao("KG", "UN"), null);
  });
  it("formatação", () => {
    assert.equal(formatarQtdInsumo(1655, "G"), "1,655 kg");
    assert.equal(formatarQtdInsumo(650, "G"), "650 g");
    assert.equal(formatarQtdInsumo(-20, "G"), "−20 g");
    assert.equal(formatarQtdInsumo(7, "UN"), "7 un");
    assert.equal(sp(formatarCustoMedio(MACA, "G")), "R$ 6,99/kg");
    assert.equal(sp(formatarCustoMedio(3.98, "UN")), "R$ 3,98/un");
  });
  it("CSV abre no Excel brasileiro (BOM, ponto e vírgula, vírgula decimal, aspas)", () => {
    const csv = gerarCsv(["Insumo", "Sobra"], [["Maçã; verde", 1655.5]]);
    assert.ok(csv.startsWith("﻿"));
    assert.equal(csv.slice(1), 'Insumo;Sobra\r\n"Maçã; verde";1655,5');
  });
  it("CSV: texto que o Excel leria como fórmula vira texto; número negativo segue número", () => {
    const csv = gerarCsv(["Insumo", "Sobra"], [["=HYPERLINK(1)", -2], ["+1", 0], ["-x", 1], ["@SOMA", 1], ["Açúcar", -0.5]]);
    assert.equal(csv.slice(1), "Insumo;Sobra\r\n'=HYPERLINK(1);-2\r\n'+1;0\r\n'-x;1\r\n'@SOMA;1\r\nAçúcar;-0,5");
  });
});

describe("producaoSchema", () => {
  const base = {
    nome: "Receita 1",
    potes: 7,
    itens: [{ insumoId: "a", quantidade: 500 }],
    custos: [{ descricao: "Gás", valorCentavos: 100 }],
  };
  it("aceita a receita e completa a data com hoje", () => {
    const r = producaoSchema.safeParse(base);
    assert.ok(r.success);
    assert.match(r.data.data, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.data.itens[0].custoInformadoCentavos, null);
  });
  it("custo informado zero (de casa) é válido", () => {
    assert.ok(producaoSchema.safeParse({ ...base, itens: [{ insumoId: "a", quantidade: 4, custoInformadoCentavos: 0 }] }).success);
  });
  for (const [nome, troca] of [
    ["sem potes", { potes: 0 }],
    ["potes fracionados", { potes: 6.5 }],
    ["sem ingredientes", { itens: [] }],
    ["insumo repetido", { itens: [{ insumoId: "a", quantidade: 1 }, { insumoId: "a", quantidade: 2 }] }],
    ["quantidade zero", { itens: [{ insumoId: "a", quantidade: 0 }] }],
    ["custo negativo", { custos: [{ descricao: "Gás", valorCentavos: -1 }] }],
    ["data no futuro", { data: "2999-01-01" }],
    ["nome com caractere invisível", { nome: `Receita${String.fromCharCode(0x200b)}1` }],
    ["nome com inversão de direção", { nome: `Receita ${String.fromCharCode(0x202e)}1` }],
  ] as const) {
    it(`recusa ${nome}`, () => assert.ok(!producaoSchema.safeParse({ ...base, ...troca }).success));
  }
});
