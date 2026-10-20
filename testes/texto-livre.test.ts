// Testes do filtro de texto livre (`textoLivreValido`), usado nos formulários de vendas, produção,
// produtos e kits. Os caracteres invisíveis são montados por código (String.fromCodePoint), nunca
// colados no arquivo, para o teste não esconder o que testa.
// Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kitSchema } from "@/lib/kits-regras";
import { produtoSchema } from "@/lib/produtos-regras";
import { vendaPresencialSchema } from "@/lib/validacao";
import { producaoSchema } from "@/lib/validacao-producao";
import { textoLivreValido } from "@/lib/vendas";

const c = (codigo: number) => String.fromCodePoint(codigo);
const hex = (codigo: number) => `U+${codigo.toString(16).toUpperCase().padStart(4, "0")}`;

/** Recusados nesta versão (revisão de segurança dos kits). */
const NOVOS = [
  0x2028, // separador de linha
  0x2029, // separador de parágrafo
  0x061c, // marca de letra árabe (direção)
  0x2060, // word joiner
  0x2061, // aplicação de função (invisível)
  0x2062, // vezes invisível
  0x2063, // separador invisível
  0x2064, // mais invisível
  0x00ad, // hífen invisível (soft hyphen)
  0xfff9, // âncora de anotação interlinear
  0xfffa, // separador de anotação interlinear
  0xfffb, // terminador de anotação interlinear
  0xe0000, // primeira "tag" (fora do plano básico: par de substitutos)
  0xe0001, // LANGUAGE TAG
  0xe0041, // TAG LATIN CAPITAL LETTER A
  0xe007f, // CANCEL TAG (última)
];

/** Já eram recusados antes; continuam. */
const ANTIGOS = [0x0000, 0x0007, 0x001b, 0x007f, 0x0085, 0x009f, 0x200b, 0x200d, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff];

describe("textoLivreValido", () => {
  for (const codigo of [...NOVOS, ...ANTIGOS]) {
    it(`recusa ${hex(codigo)} no meio, no começo e no fim`, () => {
      assert.equal(textoLivreValido(`Geleia${c(codigo)}de morango`), false);
      assert.equal(textoLivreValido(`${c(codigo)}Geleia`), false);
      assert.equal(textoLivreValido(`Geleia${c(codigo)}`), false);
    });
  }

  it("recusa meio caractere UTF-16 solto (alto ou baixo)", () => {
    assert.equal(textoLivreValido(`Morango ${"\uD83C"}`), false);
    assert.equal(textoLivreValido(`${"\uDF53"} Morango`), false);
  });

  it("aceita texto comum: acentos, emoji, travessão, aspas, tab e quebra de linha", () => {
    for (const texto of [
      "Maracujá com pimenta-de-cheiro",
      "Geleia de morango 🍓 (112 g)",
      "Feira — sábado, “especial”",
      "linha 1\nlinha 2\r\nlinha 3",
      "coluna\tcoluna",
      "Ação Ñandú ß ø æ",
    ]) {
      assert.equal(textoLivreValido(texto), true, JSON.stringify(texto));
    }
  });

  it("os vizinhos dos intervalos recusados continuam valendo", () => {
    for (const codigo of [0x00ac, 0x00ae, 0x061b, 0x061d, 0x2027, 0x2030, 0x2065, 0xfff8, 0xfffc, 0xfffd, 0xe0080, 0x1f353]) {
      assert.equal(textoLivreValido(`a${c(codigo)}b`), true, hex(codigo));
    }
  });
});

describe("os formulários que usam textoLivreValido recusam os caracteres novos", () => {
  const SEPARADOR = c(0x2028);
  const TAG = c(0xe0041);
  const HIFEN_INVISIVEL = c(0x00ad);

  it("produto (painel): descrição e sabor", () => {
    const valido = { sabor: "Morango", pesoGramas: "112", precoCentavos: "1500", descricao: "Geleia de morango.", ativo: "true" };
    assert.ok(produtoSchema.safeParse(valido).success);
    assert.equal(produtoSchema.safeParse({ ...valido, descricao: `Geleia${SEPARADOR}de morango.` }).success, false);
    assert.equal(produtoSchema.safeParse({ ...valido, sabor: `Mor${HIFEN_INVISIVEL}ango` }).success, false);
  });

  it("kit (painel): nome e descrição", () => {
    const valido = { nome: "Kit Presente", descricao: "Três geleias à sua escolha.", precoCentavos: 4000, pesoCaixaGramas: 150, ativo: false };
    assert.ok(kitSchema.safeParse(valido).success);
    assert.equal(kitSchema.safeParse({ ...valido, nome: `Kit${TAG}Presente` }).success, false);
    assert.equal(kitSchema.safeParse({ ...valido, descricao: `Três${c(0x2063)}geleias` }).success, false);
  });

  it("venda presencial: nome do cliente e observação", () => {
    const valida = { itens: [{ productId: "pimenta-112g", quantidade: 1, precoUnitarioCentavos: 1500 }], formaPagamento: "PIX" };
    assert.ok(vendaPresencialSchema.safeParse(valida).success);
    assert.equal(vendaPresencialSchema.safeParse({ ...valida, clienteNome: `Maria${c(0x061c)}` }).success, false);
    assert.equal(vendaPresencialSchema.safeParse({ ...valida, observacao: `Pagou${c(0xfff9)}em dinheiro` }).success, false);
    assert.ok(vendaPresencialSchema.safeParse({ ...valida, observacao: "Pagou em dinheiro.\nVolta semana que vem." }).success);
  });

  it("produção: nome da receita", () => {
    const base = { nome: "Receita 1", potes: 7, itens: [{ insumoId: "a", quantidade: 500 }], custos: [] };
    assert.ok(producaoSchema.safeParse(base).success);
    assert.equal(producaoSchema.safeParse({ ...base, nome: `Receita${c(0x2060)}1` }).success, false);
    assert.equal(producaoSchema.safeParse({ ...base, nome: `Receita${c(0x2029)}1` }).success, false);
  });
});
