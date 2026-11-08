// Testes das regras puras da planilha financeira (src/lib/planilha/regras.ts). Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agruparPorDiaEOrigem,
  campoDoCabecalho,
  casarCategoria,
  centavosParaTexto,
  diaDaSemana,
  diaParaSerieExcel,
  diaValido,
  diasEntre,
  fimDoMes,
  impressaoDigital,
  interpretarLinha,
  lerDataPlanilha,
  lerFormaPagamento,
  lerTipo,
  lerTsv,
  lerValorPlanilha,
  mapearColunas,
  mapearPorPosicao,
  margem,
  mesmoDiaAnoAnterior,
  normalizarTexto,
  pareceCabecalho,
  percentual,
  periodoDoMes,
  resultadoDiario,
  serieExcelParaDia,
  somarDias,
  topNComOutros,
  validarPeriodo,
  variacao,
} from "@/lib/planilha/regras";
import { categoriaDoGrupo } from "@/lib/planilha/tipos";

const HOJE = "2026-11-07";

describe("datas puras", () => {
  it("dia válido e inválido", () => {
    assert.equal(diaValido("2026-11-07"), true);
    assert.equal(diaValido("2026-02-29"), false);
    assert.equal(diaValido("2028-02-29"), true);
    assert.equal(diaValido("2026-13-01"), false);
    assert.equal(diaValido("2026-04-31"), false);
    assert.equal(diaValido("07/11/2026"), false);
  });
  it("somarDias atravessa mês e ano", () => {
    assert.equal(somarDias("2026-10-31", 1), "2026-11-01");
    assert.equal(somarDias("2026-12-31", 1), "2027-01-01");
    assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
  });
  it("diasEntre", () => {
    assert.equal(diasEntre("2026-11-01", "2026-11-30"), 29);
    assert.equal(diasEntre("2026-11-07", "2026-11-07"), 0);
    assert.equal(diasEntre("2026-11-08", "2026-11-07"), -1);
  });
  it("dia da semana (07/11/2026 é sábado)", () => assert.equal(diaDaSemana("2026-11-07"), 6));
  it("fim do mês, inclusive fevereiro bissexto", () => {
    assert.equal(fimDoMes("2026-02"), "2026-02-28");
    assert.equal(fimDoMes("2028-02"), "2028-02-29");
    assert.equal(fimDoMes("2026-11"), "2026-11-30");
  });
  it("período do mês", () => assert.deepEqual(periodoDoMes(HOJE), { de: "2026-11-01", ate: "2026-11-30" }));
  it("mesmo dia no ano anterior (29/02 → 28/02)", () => {
    assert.equal(mesmoDiaAnoAnterior("2026-11-07"), "2025-11-07");
    assert.equal(mesmoDiaAnoAnterior("2028-02-29"), "2027-02-28");
  });
});

describe("validarPeriodo", () => {
  it("aceita o mês", () => assert.deepEqual(validarPeriodo("2026-11-01", "2026-11-30", 400), { ok: true, valor: { de: "2026-11-01", ate: "2026-11-30" } }));
  it("aceita o ano inteiro", () => assert.equal(validarPeriodo("2026-01-01", "2026-12-31", 400).ok, true));
  it("recusa de > ate", () => assert.equal(validarPeriodo("2026-11-30", "2026-11-01", 400).ok, false));
  it("recusa antes de 2020", () => assert.equal(validarPeriodo("2019-12-31", "2020-01-31", 400).ok, false));
  it("recusa período longo demais", () => assert.equal(validarPeriodo("2025-01-01", "2026-12-31", 400).ok, false));
  it("recusa dia que não existe", () => assert.equal(validarPeriodo("2026-02-30", "2026-03-01", 400).ok, false));
});

describe("lerDataPlanilha (sempre dia/mês)", () => {
  const aceitos: [string, string][] = [
    ["7/11", "2026-11-07"],
    ["07/11", "2026-11-07"],
    ["07/11/26", "2026-11-07"],
    ["07/11/2026", "2026-11-07"],
    ["1/1/2025", "2025-01-01"],
    ["7-11-2026", "2026-11-07"],
    ["7.11.2026", "2026-11-07"],
    ["2026-11-07", "2026-11-07"],
    [" 05/10/2026 ", "2026-10-05"],
    ["29/02/2024", "2024-02-29"],
  ];
  for (const [texto, esperado] of aceitos) it(`"${texto}" → ${esperado}`, () => assert.deepEqual(lerDataPlanilha(texto, HOJE), { ok: true, valor: esperado }));
  const recusados = ["", "02/13/2026", "31/04/2026", "29/02/2026", "08/11/2026", "01/01/2019", "ontem", "7/11/202", "11-2026"];
  for (const texto of recusados) it(`"${texto}" é recusado`, () => assert.equal(lerDataPlanilha(texto, HOJE).ok, false));
  it("12/01 é 12 de janeiro, nunca 1º de dezembro", () => assert.deepEqual(lerDataPlanilha("12/01/2026", HOJE), { ok: true, valor: "2026-01-12" }));
});

describe("série de data do Excel", () => {
  const casos: [number, string][] = [
    [1, "1900-01-01"],
    [59, "1900-02-28"],
    [61, "1900-03-01"],
    [44927, "2023-01-01"],
    [45000, "2023-03-15"],
    [46333, "2026-11-07"],
    [46333.75, "2026-11-07"],
  ];
  for (const [serie, dia] of casos) it(`${serie} → ${dia}`, () => assert.equal(serieExcelParaDia(serie), dia));
  it("o 29/02/1900 que não existiu (60) é recusado", () => assert.equal(serieExcelParaDia(60), null));
  it("fora do intervalo é null", () => {
    assert.equal(serieExcelParaDia(0), null);
    assert.equal(serieExcelParaDia(-5), null);
    assert.equal(serieExcelParaDia(Number.NaN), null);
    assert.equal(serieExcelParaDia(3_000_000), null);
  });
  it("ida e volta (dia → série → dia)", () => {
    for (const dia of ["1900-01-01", "1900-02-28", "1900-03-01", "2020-02-29", "2026-11-07"]) assert.equal(serieExcelParaDia(diaParaSerieExcel(dia)), dia);
  });
});

describe("lerValorPlanilha", () => {
  const aceitos: [string | number, number][] = [
    ["12,5", 1250],
    ["R$ 1.234,56", 123456],
    ["-12,50", -1250],
    ["R$ -5", -500],
    ["-R$ 5,00", -500],
    ["(12,50)", -1250],
    ["+3,00", 300],
    ["1.000", 100000],
    ["0", 0],
    [12.5, 1250],
    [-7, -700],
    [0.1 + 0.2, 30],
    ["R$ 10,00", 1000],
  ];
  for (const [entrada, esperado] of aceitos) it(`${JSON.stringify(entrada)} → ${esperado}`, () => assert.deepEqual(lerValorPlanilha(entrada), { ok: true, valor: esperado }));
  const recusados: (string | number)[] = ["", "abc", "1.2,5", "12,345", "--5", "(-5)", 12.345, Number.POSITIVE_INFINITY];
  for (const entrada of recusados) it(`${JSON.stringify(entrada)} é recusado`, () => assert.equal(lerValorPlanilha(entrada).ok, false));
  it("centavos para texto", () => {
    assert.equal(centavosParaTexto(123456), "1234,56");
    assert.equal(centavosParaTexto(-5), "-0,05");
    assert.equal(centavosParaTexto(0), "0,00");
  });
});

describe("percentual, margem e variação", () => {
  it("percentual com 1 casa", () => assert.equal(percentual(1, 3), 33.3));
  it("percentual sem base é null", () => assert.equal(percentual(5, 0), null));
  it("margem", () => assert.equal(margem(2500, 10000), 25));
  it("margem negativa", () => assert.equal(margem(-500, 10000), -5));
  it("margem sem entradas é null", () => assert.equal(margem(-500, 0), null));
  it("variação contra o ano anterior", () => assert.equal(variacao(150, 100), 50));
  it("variação de base negativa usa o módulo", () => assert.equal(variacao(-50, -100), 50));
  it("variação sem ano anterior é null", () => {
    assert.equal(variacao(100, 0), null);
    assert.equal(variacao(100, null), null);
  });
});

describe("textos, tipo e forma", () => {
  it("normaliza acento, maiúsculas e espaços", () => assert.equal(normalizarTexto("  Açúcar   CRISTAL "), "acucar cristal"));
  it("impressão digital ignora acento e espaços", () => {
    const a = impressaoDigital({ tipo: "SAIDA", data: "2026-11-07", valorCentavos: 2000, descricao: "Açúcar  cristal" });
    const b = impressaoDigital({ tipo: "SAIDA", data: "2026-11-07", valorCentavos: 2000, descricao: "acucar cristal" });
    assert.equal(a, b);
    assert.equal(a, "SAIDA|2026-11-07|2000|acucar cristal");
  });
  it("impressão digital muda com o valor", () =>
    assert.notEqual(
      impressaoDigital({ tipo: "SAIDA", data: "2026-11-07", valorCentavos: 2000, descricao: "x" }),
      impressaoDigital({ tipo: "SAIDA", data: "2026-11-07", valorCentavos: 2001, descricao: "x" }),
    ));
  const tipos: [string, "ENTRADA" | "SAIDA" | null][] = [
    ["Entrada", "ENTRADA"],
    ["E", "ENTRADA"],
    ["receita", "ENTRADA"],
    ["Saída", "SAIDA"],
    ["saida", "SAIDA"],
    ["Despesa", "SAIDA"],
    ["S", "SAIDA"],
    ["talvez", null],
  ];
  for (const [t, esperado] of tipos) it(`tipo "${t}" → ${esperado}`, () => assert.equal(lerTipo(t), esperado));
  const formas: [string, string | null][] = [
    ["Pix", "PIX"],
    ["dinheiro", "DINHEIRO"],
    ["Espécie", "DINHEIRO"],
    ["Cartão de débito", "CARTAO_DEBITO"],
    ["Crédito", "CARTAO_CREDITO"],
    ["Cartão", "CARTAO_CREDITO"],
    ["Outro", "OUTRO"],
    ["", null],
    ["boleto", null],
  ];
  for (const [t, esperado] of formas) it(`forma "${t}" → ${esperado}`, () => assert.equal(lerFormaPagamento(t), esperado));
  it("categoria semeada do grupo", () => assert.equal(categoriaDoGrupo("INGREDIENTES"), "saida-ingredientes"));
});

describe("lerTsv (colar do Excel)", () => {
  it("células e linhas, sem a linha vazia final", () => assert.deepEqual(lerTsv("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]));
  it("só \\n também funciona", () => assert.deepEqual(lerTsv("a\tb\nc\td\n"), [["a", "b"], ["c", "d"]]));
  it("célula entre aspas com quebra de linha e aspas", () =>
    assert.deepEqual(lerTsv('"linha 1\nlinha 2"\t"diz ""oi"""\nx\ty'), [["linha 1\nlinha 2", 'diz "oi"'], ["x", "y"]]));
  it("célula vazia no meio e no fim", () => assert.deepEqual(lerTsv("a\t\tc\t\n"), [["a", "", "c", ""]]));
  it("aspas no meio do texto ficam como texto", () => assert.deepEqual(lerTsv('Pote 5" grande\t10'), [['Pote 5" grande', "10"]]));
  it("aspas que não fecham ficam como texto", () => assert.deepEqual(lerTsv('"abc\tdef'), [['"abc', "def"]]));
  it("texto vazio", () => assert.deepEqual(lerTsv(""), []));
  it("várias linhas vazias no fim saem", () => assert.deepEqual(lerTsv("a\n\n\t\n"), [["a"]]));
});

describe("cabeçalho e mapeamento de colunas", () => {
  it("reconhece nomes com acento e variações", () => {
    assert.equal(campoDoCabecalho("Descrição"), "descricao");
    assert.equal(campoDoCabecalho("Valor (R$)"), "valor");
    assert.equal(campoDoCabecalho("Forma de pagamento"), "forma");
    assert.equal(campoDoCabecalho("Obs."), "observacao");
    assert.equal(campoDoCabecalho("Entrada/Saída"), "tipo");
    assert.equal(campoDoCabecalho("Qualquer"), null);
  });
  it("linha de cabeçalho", () => assert.equal(pareceCabecalho(["Data", "Tipo", "Categoria", "Descrição", "Valor"]), true));
  it("linha de dados não é cabeçalho", () => assert.equal(pareceCabecalho(["07/11", "Saída", "Ingredientes", "Açúcar", "20"]), false));
  it("um nome só não basta", () => assert.equal(pareceCabecalho(["Data", "07/11"]), false));
  it("mapeia por nome (layout da guia Base)", () =>
    assert.deepEqual(mapearColunas(["Data", "Tipo", "Categoria", "Descrição", "Valor", "Valor"]), { data: 0, tipo: 1, categoria: 2, descricao: 3, valor: 4 }));
  it("mapeia por posição a partir da coluna focada", () =>
    assert.deepEqual(mapearPorPosicao(["data", "tipo", "categoria", "descricao", "valor"], 3, 4), { descricao: 0, valor: 1 }));
});

describe("casarCategoria", () => {
  const categorias = [
    { id: "a", tipo: "SAIDA" as const, nome: "Ingredientes", ativo: true },
    { id: "b", tipo: "SAIDA" as const, nome: "Gás", ativo: false },
    { id: "c", tipo: "ENTRADA" as const, nome: "Gás", ativo: true },
  ];
  it("sem acento e maiúsculas", () => assert.equal(casarCategoria("INGREDIENTES", "SAIDA", categorias)?.id, "a"));
  it("respeita o tipo", () => assert.equal(casarCategoria("gas", "ENTRADA", categorias)?.id, "c"));
  it("aceita inativa se for a única", () => assert.equal(casarCategoria("gás", "SAIDA", categorias)?.id, "b"));
  it("desconhecida é null", () => assert.equal(casarCategoria("Aluguel", "SAIDA", categorias), null));
});

describe("interpretarLinha", () => {
  const categorias = [
    { id: "saida-ingredientes", tipo: "SAIDA" as const, nome: "Ingredientes", ativo: true },
    { id: "entrada-outras", tipo: "ENTRADA" as const, nome: "Outras entradas", ativo: true },
  ];
  const mapa = { data: 0, tipo: 1, categoria: 2, descricao: 3, valor: 4 };
  it("linha completa", () => {
    const l = interpretarLinha(["07/11", "Saída", "ingredientes", "Açúcar", "R$ 20,00"], mapa, { hoje: HOJE, categorias });
    assert.deepEqual(l.erros, {});
    assert.equal(l.tipo, "SAIDA");
    assert.equal(l.data, "2026-11-07");
    assert.equal(l.categoriaId, "saida-ingredientes");
    assert.equal(l.valorCentavos, 2000);
  });
  it("sem coluna Tipo, valor negativo é saída", () => {
    const l = interpretarLinha(["07/11", "Ingredientes", "Açúcar", "-20"], { data: 0, categoria: 1, descricao: 2, valor: 3 }, { hoje: HOJE, categorias });
    assert.equal(l.tipo, "SAIDA");
    assert.equal(l.valorCentavos, 2000);
  });
  it("sem Tipo e valor positivo usa o tipo padrão", () => {
    const l = interpretarLinha(["07/11", "Outras entradas", "Doação", "50"], { data: 0, categoria: 1, descricao: 2, valor: 3 }, { hoje: HOJE, categorias, tipoPadrao: "ENTRADA" });
    assert.equal(l.tipo, "ENTRADA");
    assert.deepEqual(l.erros, {});
  });
  it("sem Tipo, positivo e sem padrão: pede o tipo", () => {
    const l = interpretarLinha(["07/11", "x", "y", "50"], { data: 0, categoria: 1, descricao: 2, valor: 3 }, { hoje: HOJE, categorias });
    assert.ok(l.erros.tipo);
  });
  it("data em série do Excel", () => {
    const l = interpretarLinha([46333, "Saída", "Ingredientes", "Açúcar", 20], mapa, { hoje: HOJE, categorias });
    assert.equal(l.data, "2026-11-07");
    assert.equal(l.valorCentavos, 2000);
  });
  it("categoria nova vira sugestão de criar", () => {
    const l = interpretarLinha(["07/11", "Saída", "Gás", "Botijão", "120"], mapa, { hoje: HOJE, categorias });
    assert.equal(l.categoriaId, null);
    assert.equal(l.categoriaNova, "Gás");
    assert.equal(l.erros.categoria, undefined);
  });
  it("erros por campo", () => {
    const l = interpretarLinha(["31/02", "Talvez", "", "", "0"], mapa, { hoje: HOJE, categorias });
    assert.ok(l.erros.data);
    assert.ok(l.erros.tipo);
    assert.ok(l.erros.categoria);
    assert.ok(l.erros.descricao);
    assert.ok(l.erros.valor);
  });
  it("data futura pela série é recusada", () => {
    const l = interpretarLinha([46400, "Saída", "Ingredientes", "x", 1], mapa, { hoje: HOJE, categorias });
    assert.ok(l.erros.data);
  });
});

describe("topNComOutros", () => {
  const fatias = (n: number) => Array.from({ length: n }, (_, i) => ({ chave: `c${i}`, nome: `Cat ${i}`, valor: (n - i) * 100 }));
  it("até n+1 fatias: todas com o próprio nome", () => {
    const r = topNComOutros(fatias(7), 6);
    assert.equal(r.length, 7);
    assert.ok(!r.some((f) => f.chave === "outros"));
  });
  it("mais que isso: n fatias + Outros com a soma do resto", () => {
    const r = topNComOutros(fatias(9), 6);
    assert.equal(r.length, 7);
    assert.deepEqual(r[6], { chave: "outros", nome: "Outros", valor: 300 + 200 + 100, percentual: percentual(600, 4500) });
  });
  it("zeros e negativos ficam de fora", () =>
    assert.deepEqual(topNComOutros([{ chave: "a", nome: "A", valor: 100 }, { chave: "b", nome: "B", valor: 0 }, { chave: "c", nome: "C", valor: -5 }]).map((f) => f.chave), ["a"]));
  it("percentuais somam ~100", () => {
    const soma = topNComOutros(fatias(9)).reduce((s, f) => s + (f.percentual ?? 0), 0);
    assert.ok(Math.abs(soma - 100) < 0.5);
  });
  it("empate pelo nome", () =>
    assert.deepEqual(topNComOutros([{ chave: "b", nome: "Banana", valor: 5 }, { chave: "a", nome: "Abacaxi", valor: 5 }]).map((f) => f.chave), ["a", "b"]));
});

describe("resultadoDiario", () => {
  const movimentos = [
    { data: "2026-11-01", tipo: "ENTRADA" as const, valorCentavos: 5000 },
    { data: "2026-11-01", tipo: "SAIDA" as const, valorCentavos: 2000 },
    { data: "2026-11-03", tipo: "ENTRADA" as const, valorCentavos: -1000 },
    { data: "2026-10-31", tipo: "ENTRADA" as const, valorCentavos: 99999 },
  ];
  const r = resultadoDiario(movimentos, "2026-11-01", "2026-11-03", 10000);
  it("um dia por linha, inclusive sem movimento", () => assert.deepEqual(r.map((l) => l.data), ["2026-11-01", "2026-11-02", "2026-11-03"]));
  it("saldo do dia e acumulado a partir do saldo anterior", () => {
    assert.equal(r[0].saldoDoDiaCentavos, 3000);
    assert.equal(r[0].acumuladoCentavos, 13000);
    assert.equal(r[1].acumuladoCentavos, 13000);
    assert.equal(r[2].entradasCentavos, -1000);
    assert.equal(r[2].acumuladoCentavos, 12000);
  });
  it("movimento fora do período é ignorado", () => assert.equal(r.reduce((s, l) => s + l.entradasCentavos, 0), 4000));
  it("dia da semana por extenso", () => assert.equal(r[0].diaDaSemana, "domingo"));
});

describe("agruparPorDiaEOrigem", () => {
  it("soma por dia e origem, mais recente primeiro", () => {
    const g = agruparPorDiaEOrigem([
      { data: "2026-11-01", origem: "site", valorCentavos: 1000 },
      { data: "2026-11-02", origem: "site", valorCentavos: 500 },
      { data: "2026-11-01", origem: "site", valorCentavos: 2000 },
      { data: "2026-11-01", origem: "presencial", valorCentavos: 300 },
    ]);
    assert.deepEqual(g, [
      { data: "2026-11-02", origem: "site", quantidade: 1, valorCentavos: 500 },
      { data: "2026-11-01", origem: "presencial", quantidade: 1, valorCentavos: 300 },
      { data: "2026-11-01", origem: "site", quantidade: 2, valorCentavos: 3000 },
    ]);
  });
});
