import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avisosDeAlegacao, ehFotoEnviada, idParaProduto, montarNome, produtoSchema, separarNome, tipoDaImagem } from "../src/lib/produtos-regras";

describe("nome e id do produto", () => {
  it("monta e separa o nome no formato do rótulo", () => {
    assert.equal(montarNome(" Morango ", 112), "Morango, 112g");
    assert.deepEqual(separarNome("Abacaxi com Pimenta, 125g"), { sabor: "Abacaxi com Pimenta", peso: "125g" });
    assert.deepEqual(separarNome("Sem peso"), { sabor: "Sem peso", peso: null });
  });

  it("gera id legível, sem acento, como os atuais", () => {
    assert.equal(idParaProduto("Abacaxi com Pimenta", 125), "abacaxi-com-pimenta-125g");
    assert.equal(idParaProduto("Maracujá & Limão!", 200), "maracuja-limao-200g");
    assert.equal(idParaProduto("!!!", 100), "produto-100g");
  });

  it("reconhece foto enviada pelo painel", () => {
    assert.equal(ehFotoEnviada("/fotos/abc"), true);
    assert.equal(ehFotoEnviada("/produtos/pimenta.jpg"), false);
  });
});

describe("tipo da foto pelos bytes", () => {
  it("JPEG, PNG e WebP; recusa o resto", () => {
    assert.equal(tipoDaImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(tipoDaImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
    assert.equal(tipoDaImagem(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.equal(tipoDaImagem(new TextEncoder().encode("<svg onload=alert(1)>")), null);
    assert.equal(tipoDaImagem(new Uint8Array([0xff, 0xd8])), null);
  });
});

describe("validação do produto", () => {
  const valido = { sabor: "Morango", pesoGramas: "112", precoCentavos: "1500", descricao: "Geleia de morango.", ativo: "true" };

  it("aceita os campos do formulário (texto) e converte números e o ativo", () => {
    const r = produtoSchema.parse(valido);
    assert.deepEqual(r, { sabor: "Morango", pesoGramas: 112, precoCentavos: 1500, descricao: "Geleia de morango.", ativo: true });
    assert.equal(produtoSchema.parse({ ...valido, ativo: undefined }).ativo, false);
  });

  it("\"Pode entrar no Kit Presente\": \"true\"/\"on\" liga, \"false\" desliga, sem o campo fica indefinido", () => {
    assert.equal(produtoSchema.parse({ ...valido, permitidoEmKit: "true" }).permitidoEmKit, true);
    assert.equal(produtoSchema.parse({ ...valido, permitidoEmKit: "on" }).permitidoEmKit, true);
    assert.equal(produtoSchema.parse({ ...valido, permitidoEmKit: "false" }).permitidoEmKit, false);
    assert.equal(produtoSchema.parse({ ...valido, permitidoEmKit: "qualquer" }).permitidoEmKit, false);
    // Formulário antigo, sem o campo: a edição mantém o valor do banco e a criação usa o default (fora).
    const semCampo = produtoSchema.parse(valido);
    assert.equal("permitidoEmKit" in semCampo, false);
  });

  it("recusa vírgula no sabor, preço zero ou acima do teto, peso quebrado e texto invisível", () => {
    assert.equal(produtoSchema.safeParse({ ...valido, sabor: "Morango, 112g" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, precoCentavos: "0" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, precoCentavos: "100000" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, pesoGramas: "112.5" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, pesoGramas: "" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, descricao: "a​b‮c" }).success, false);
  });
});

describe("avisos de alegação no verso", () => {
  it("acha termos de saúde sem acento, sem diferenciar maiúsculas e por palavra", () => {
    assert.deepEqual(avisosDeAlegacao("Ótima para a SAUDE"), ["saúde"]);
    assert.deepEqual(avisosDeAlegacao("Rica em vitaminas e fibras"), ["vitamina", "fibra"]);
    assert.deepEqual(avisosDeAlegacao("Ajuda na digestão"), ["digest"]);
    assert.deepEqual(avisosDeAlegacao("Termogênica e detox"), ["termogên", "detox"]);
    assert.deepEqual(avisosDeAlegacao("Versão light, sem açúcar"), ["sem açúcar", "light"]);
    assert.deepEqual(avisosDeAlegacao("Previne gripes"), ["previne"]);
  });

  it("não acusa pedaço de outra palavra nem o rascunho aprovado", () => {
    assert.deepEqual(avisosDeAlegacao("Queijo coalho com relevo"), []);
    assert.deepEqual(avisosDeAlegacao("Queijo curado na tábua"), []);
    assert.deepEqual(avisosDeAlegacao("Fitas e confeitos"), []);
    assert.deepEqual(avisosDeAlegacao("Sem conservantes"), []);
    const rascunho = [
      "Cream cheese com torradas", "Queijo coalho na chapa", "Costelinha e carnes assadas", "Tábua de frios",
      "Doce e picante na mesma colherada", "Vermelho intenso que deixa a tábua de frios bonita",
      "Transforma um petisco simples em entrada de festa", "Cream cheese com biscoito salgado",
      "Pedacinhos de fruta e de pimenta à vista no pote", "Iogurte com frutas", "Iogurte com granola",
      "Azedinha e perfumada, como a fruta", "Com as sementes, que dão crocância", "Cobertura pronta para sobremesas",
    ];
    for (const texto of rascunho) assert.deepEqual(avisosDeAlegacao(texto), [], texto);
  });
});

describe("listas do verso no formulário", () => {
  const base = { sabor: "Pimenta", pesoGramas: "112", precoCentavos: "1500", descricao: "Geleia de pimenta.", ativo: "true" };
  const erros = (campos: Record<string, unknown>) => {
    const r = produtoSchema.safeParse({ ...base, ...campos });
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.map(String).join("."), i.message]));
  };

  it("divide por linha, apara e descarta as vazias", () => {
    const r = produtoSchema.parse({ ...base, harmonizacoes: " Queijo coalho \r\n\n Torradas \n", destaques: "Doce e picante" });
    assert.deepEqual(r.harmonizacoes, ["Queijo coalho", "Torradas"]);
    assert.deepEqual(r.destaques, ["Doce e picante"]);
  });

  it("ausente vira undefined (não mexe) e \"\" vira lista vazia (esvazia)", () => {
    const semCampo = produtoSchema.parse(base);
    assert.equal(semCampo.harmonizacoes, undefined);
    assert.equal(semCampo.destaques, undefined);
    const vazio = produtoSchema.parse({ ...base, harmonizacoes: "", destaques: "  \n " });
    assert.deepEqual(vazio.harmonizacoes, []);
    assert.deepEqual(vazio.destaques, []);
  });

  it("limites de linhas e de caracteres, com o erro na linha certa", () => {
    assert.deepEqual(Object.keys(erros({ harmonizacoes: "a1\nb2\nc3\nd4\ne5" })), ["harmonizacoes"]);
    assert.deepEqual(Object.keys(erros({ destaques: "um\ndois\ntrês\nquatro" })), ["destaques"]);
    assert.deepEqual(Object.keys(erros({ harmonizacoes: `ok\n${"x".repeat(41)}` })), ["harmonizacoes.1"]);
    assert.deepEqual(erros({ harmonizacoes: "x".repeat(40), destaques: "y".repeat(70) }), {});
    assert.deepEqual(Object.keys(erros({ destaques: "y".repeat(71) })), ["destaques.0"]);
    assert.deepEqual(Object.keys(erros({ harmonizacoes: "Queijo\nx" })), ["harmonizacoes.1"]);
  });

  it("recusa repetidos (sem diferenciar maiúsculas) e caracteres invisíveis ou de controle", () => {
    assert.deepEqual(Object.keys(erros({ harmonizacoes: "Torradas\nQueijo\ntorradas" })), ["harmonizacoes.2"]);
    assert.deepEqual(Object.keys(erros({ destaques: "Doce​picante" })), ["destaques.0"]);
    assert.deepEqual(Object.keys(erros({ destaques: "Doce\u0007picante" })), ["destaques.0"]);
    assert.deepEqual(Object.keys(erros({ destaques: "Doce\rpicante" })), ["destaques.0"]);
  });

  it("o rascunho aprovado cabe nos limites", () => {
    const r = produtoSchema.safeParse({
      ...base,
      harmonizacoes: "Queijo coalho na brasa\nLombo ou pernil assado\nFrango grelhado\nCream cheese com biscoito salgado",
      destaques: "O doce do abacaxi com um toque picante\nPedacinhos de fruta e de pimenta à vista no pote\nVai do aperitivo ao prato principal",
    });
    assert.equal(r.success, true);
  });
});
