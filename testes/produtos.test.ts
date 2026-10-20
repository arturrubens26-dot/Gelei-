import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ehFotoEnviada, idParaProduto, montarNome, produtoSchema, separarNome, tipoDaImagem } from "../src/lib/produtos-regras";

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

  it("recusa vírgula no sabor, preço zero ou acima do teto, peso quebrado e texto invisível", () => {
    assert.equal(produtoSchema.safeParse({ ...valido, sabor: "Morango, 112g" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, precoCentavos: "0" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, precoCentavos: "100000" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, pesoGramas: "112.5" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, pesoGramas: "" }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, descricao: "a​b‮c" }).success, false);
  });
});
