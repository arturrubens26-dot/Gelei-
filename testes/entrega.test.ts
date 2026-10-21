import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_TAXA_ENTREGA_CENTAVOS,
  MENSAGEM_FORA_DA_AREA,
  TAXA_ENTREGA_PADRAO_CENTAVOS,
  calcularFrete,
  cepAtendido,
  enderecoDeRetirada,
  finalDoTelefone,
  formatarTelefone,
  linkWhatsApp,
  mascararTelefone,
  normalizarTelefone,
  taxaDeEntregaValida,
  telefoneValido,
} from "../src/lib/entrega-regras";

describe("área de entrega", () => {
  it("só CEPs de Teresina (64000-000 a 64099-999)", () => {
    assert.equal(cepAtendido("64035-420"), true);
    assert.equal(cepAtendido("64000000"), true);
    assert.equal(cepAtendido("64099999"), true);
    assert.equal(cepAtendido("64100000"), false); // outro município do PI
    assert.equal(cepAtendido("63999999"), false);
    assert.equal(cepAtendido("01310100"), false);
    assert.equal(cepAtendido("640"), false);
    assert.equal(cepAtendido(""), false);
  });

  it("calcula: retirada grátis; entrega com a taxa; fora da área recusa", () => {
    assert.deepEqual(calcularFrete({ modo: "RETIRADA", taxaCentavos: 1500 }), { ok: true, modo: "RETIRADA", freteCentavos: 0 });
    assert.deepEqual(calcularFrete({ modo: "RETIRADA", cep: "01310100", taxaCentavos: 1500 }), {
      ok: true,
      modo: "RETIRADA",
      freteCentavos: 0,
    });
    assert.deepEqual(calcularFrete({ modo: "ENTREGA", cep: "64035-420", taxaCentavos: 1750 }), {
      ok: true,
      modo: "ENTREGA",
      freteCentavos: 1750,
    });
    const fora = calcularFrete({ modo: "ENTREGA", cep: "01310100", taxaCentavos: 1500 });
    assert.equal(fora.ok, false);
    assert.equal(!fora.ok && fora.motivo, "FORA_DA_AREA");
    assert.equal(!fora.ok && fora.mensagem, MENSAGEM_FORA_DA_AREA);
    const semCep = calcularFrete({ modo: "ENTREGA", cep: null, taxaCentavos: 1500 });
    assert.equal(!semCep.ok && semCep.motivo, "SEM_CEP");
  });

  it("taxa padrão e limites da taxa do painel", () => {
    assert.equal(TAXA_ENTREGA_PADRAO_CENTAVOS, 1500);
    assert.equal(taxaDeEntregaValida(0), true);
    assert.equal(taxaDeEntregaValida(1500), true);
    assert.equal(taxaDeEntregaValida(MAX_TAXA_ENTREGA_CENTAVOS), true);
    assert.equal(taxaDeEntregaValida(MAX_TAXA_ENTREGA_CENTAVOS + 1), false);
    assert.equal(taxaDeEntregaValida(-1), false);
    assert.equal(taxaDeEntregaValida(15.5), false);
  });

  it("endereço de retirada em uma linha", () => {
    assert.match(enderecoDeRetirada(), /Teresina\/PI · CEP 64035-420$/);
  });
});

describe("telefone", () => {
  it("normaliza: tira máscara, +55 e o 0 da operadora", () => {
    assert.equal(normalizarTelefone("(86) 99999-1234"), "86999991234");
    assert.equal(normalizarTelefone("+55 86 99999-1234"), "86999991234");
    assert.equal(normalizarTelefone("5586999991234"), "86999991234");
    assert.equal(normalizarTelefone("086 3222-1234"), "8632221234");
    assert.equal(normalizarTelefone("558632221234"), "8632221234");
    assert.equal(normalizarTelefone("abc"), "");
  });

  it("valida celular (11) e fixo (10) com DDD", () => {
    assert.equal(telefoneValido("86999991234"), true);
    assert.equal(telefoneValido("8632221234"), true);
    assert.equal(telefoneValido("11987654321"), true);
    assert.equal(telefoneValido("86899991234"), false); // celular sem o 9
    assert.equal(telefoneValido("8692221234"), false); // fixo começando com 9
    assert.equal(telefoneValido("0699999123"), false); // DDD com zero
    assert.equal(telefoneValido("8099999123"), false);
    assert.equal(telefoneValido("99999999999"), false); // todos iguais
    assert.equal(telefoneValido("999991234"), false); // sem DDD
    assert.equal(telefoneValido("869999912345"), false);
    assert.equal(telefoneValido("8699999123a"), false);
  });

  it("formata, mascara, link do WhatsApp e final", () => {
    assert.equal(formatarTelefone("86999991234"), "(86) 99999-1234");
    assert.equal(formatarTelefone("8632221234"), "(86) 3222-1234");
    assert.equal(mascararTelefone(""), "");
    assert.equal(mascararTelefone("8"), "(8");
    assert.equal(mascararTelefone("8699"), "(86) 99");
    assert.equal(mascararTelefone("8632221234"), "(86) 3222-1234");
    assert.equal(mascararTelefone("86999991234999"), "(86) 99999-1234");
    assert.equal(linkWhatsApp("86999991234"), "https://wa.me/5586999991234");
    assert.equal(finalDoTelefone("86999991234"), "1234");
    assert.equal(finalDoTelefone(null), null);
  });
});
