// Testes das regras puras do "Monte seu kit" (composição, rateio, economia, conteúdo e schemas).
// Rode com: npm run test:unit
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESCONTO_MAXIMO_SEM_AVISO_PERCENTUAL,
  PERMITIR_SABOR_REPETIDO,
  agruparKits,
  avisoDeDescontoDoKit,
  avisoDePrecoDoKit,
  avisosDoKit,
  chaveDoKit,
  composicaoDasVagas,
  conferirComposicao,
  conferirSaboresPermitidos,
  economiaDoKit,
  emCentavos,
  faixaDeEconomia,
  kitSchema,
  kitVisibilidadeSchema,
  mesmoConteudo,
  normalizarComposicao,
  pesoDoKit,
  potesParaSeparar,
  ratearPrecoDoKit,
  somarConteudo,
  textoDaComposicao,
} from "@/lib/kits-regras";
import { MAX_KITS_POR_PEDIDO } from "@/lib/limites";
import { pedidoSchema } from "@/lib/validacao";

const P = "pimenta-112g";
const M = "morango-112g";
const A = "abacaxi-125g";

const soma = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("composição e chave", () => {
  it("[P,M,P] e [M,P,P] normalizam para [{M,1},{P,2}]", () => {
    const esperado = [
      { productId: M, quantidade: 1 },
      { productId: P, quantidade: 2 },
    ];
    const pmp = [P, M, P].map((productId) => ({ productId, quantidade: 1 }));
    const mpp = [M, P, P].map((productId) => ({ productId, quantidade: 1 }));
    assert.deepEqual(normalizarComposicao(pmp), esperado);
    assert.deepEqual(normalizarComposicao(mpp), esperado);
  });

  it("normalizar mantém os outros campos da primeira ocorrência e não altera a entrada", () => {
    const entrada = [
      { productId: P, quantidade: 1, nome: "Pimenta, 112g" },
      { productId: P, quantidade: 2, nome: "outro" },
    ];
    assert.deepEqual(normalizarComposicao(entrada), [{ productId: P, quantidade: 3, nome: "Pimenta, 112g" }]);
    assert.equal(entrada[0].quantidade, 1);
  });

  it("vagas da caixa viram composição (vaga livre não conta)", () => {
    assert.deepEqual(composicaoDasVagas([P, null, P]), [{ productId: P, quantidade: 2 }]);
    assert.deepEqual(composicaoDasVagas([null, null, null]), []);
    assert.deepEqual(composicaoDasVagas([P, M, A]), [
      { productId: A, quantidade: 1 },
      { productId: M, quantidade: 1 },
      { productId: P, quantidade: 1 },
    ]);
  });

  it("a chave é igual em outra ordem e muda com o kit", () => {
    const k1 = chaveDoKit("kit-presente", [
      { productId: P, quantidade: 2 },
      { productId: M, quantidade: 1 },
    ]);
    const k2 = chaveDoKit("kit-presente", [
      { productId: M, quantidade: 1 },
      { productId: P, quantidade: 1 },
      { productId: P, quantidade: 1 },
    ]);
    assert.equal(k1, k2);
    assert.notEqual(k1, chaveDoKit("kit-outro", [{ productId: P, quantidade: 2 }, { productId: M, quantidade: 1 }]));
    assert.notEqual(k1, chaveDoKit("kit-presente", [{ productId: P, quantidade: 3 }]));
  });

  it("ids com ',' ou ':' não colidem", () => {
    // Com um separador ingênuo ("id:q,id:q") estas duas caixas dariam a mesma chave.
    const a = chaveDoKit("k", [{ productId: "a:1,b", quantidade: 1 }]);
    const b = chaveDoKit("k", [
      { productId: "a", quantidade: 1 },
      { productId: "b", quantidade: 1 },
    ]);
    assert.notEqual(a, b);
    assert.notEqual(chaveDoKit("k,", [{ productId: "x", quantidade: 1 }]), chaveDoKit("k", [{ productId: ",x", quantidade: 1 }]));
  });

  describe("conferirComposicao(…, 3)", () => {
    it("passa: {P,M,A} e {P×3}", () => {
      const r1 = conferirComposicao(
        [
          { productId: P, quantidade: 1 },
          { productId: M, quantidade: 1 },
          { productId: A, quantidade: 1 },
        ],
        3,
      );
      assert.equal(r1.ok, true);
      const r2 = conferirComposicao([{ productId: P, quantidade: 3 }], 3);
      assert.deepEqual(r2, { ok: true, composicao: [{ productId: P, quantidade: 3 }] });
    });

    it("devolve a composição normalizada", () => {
      const r = conferirComposicao(
        [
          { productId: P, quantidade: 1 },
          { productId: M, quantidade: 1 },
          { productId: P, quantidade: 1 },
        ],
        3,
      );
      assert.deepEqual(r, {
        ok: true,
        composicao: [
          { productId: M, quantidade: 1 },
          { productId: P, quantidade: 2 },
        ],
      });
    });

    const motivo = (r: ReturnType<typeof conferirComposicao>) => (r.ok ? "ok" : r.motivo);

    it("incompleta: {P×2} e lista vazia", () => {
      assert.equal(motivo(conferirComposicao([{ productId: P, quantidade: 2 }], 3)), "incompleta");
      assert.equal(motivo(conferirComposicao([], 3)), "incompleta");
    });

    it("excede: {P×2, M×2}, com a mensagem do kit", () => {
      const r = conferirComposicao(
        [
          { productId: P, quantidade: 2 },
          { productId: M, quantidade: 2 },
        ],
        3,
        { nomeDoKit: "Kit Presente" },
      );
      assert.equal(motivo(r), "excede");
      assert.equal(!r.ok && r.mensagem, "Kit Presente: a caixa leva 3 potes; vieram 4.");
    });

    it("quantidade-invalida: 0 ou 1,5", () => {
      assert.equal(
        motivo(conferirComposicao([{ productId: P, quantidade: 0 }, { productId: M, quantidade: 3 }], 3)),
        "quantidade-invalida",
      );
      assert.equal(
        motivo(conferirComposicao([{ productId: P, quantidade: 1.5 }, { productId: M, quantidade: 1.5 }], 3)),
        "quantidade-invalida",
      );
      assert.equal(motivo(conferirComposicao([{ productId: P, quantidade: -1 }, { productId: M, quantidade: 4 }], 3)), "quantidade-invalida");
    });

    it("repetido: {P×2, M} sem repetição permitida; com repetição (padrão), passa", () => {
      const caixa = [
        { productId: P, quantidade: 2 },
        { productId: M, quantidade: 1 },
      ];
      assert.equal(motivo(conferirComposicao(caixa, 3, { permitirRepetir: false })), "repetido");
      // O mesmo sabor em duas linhas também é repetição.
      assert.equal(
        motivo(conferirComposicao([{ productId: P, quantidade: 1 }, { productId: P, quantidade: 1 }, { productId: M, quantidade: 1 }], 3, { permitirRepetir: false })),
        "repetido",
      );
      assert.equal(PERMITIR_SABOR_REPETIDO, true);
      assert.equal(motivo(conferirComposicao(caixa, 3)), "ok");
    });
  });

  it("agruparKits: duas linhas iguais viram uma com q=2", () => {
    const linhas = [
      { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: P, quantidade: 2 }, { productId: M, quantidade: 1 }] },
      { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: M, quantidade: 1 }, { productId: P, quantidade: 2 }] },
    ];
    const grupos = agruparKits(linhas);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].quantidade, 2);
    assert.deepEqual(grupos[0].sabores, [
      { productId: M, quantidade: 1 },
      { productId: P, quantidade: 2 },
    ]);
    assert.equal(grupos[0].chave, chaveDoKit("kit-presente", linhas[0].sabores));
    // A entrada não é alterada.
    assert.equal(linhas[0].quantidade, 1);
  });

  it("agruparKits: composições diferentes ficam separadas, na ordem de chegada", () => {
    const grupos = agruparKits([
      { kitId: "kit-presente", quantidade: 2, sabores: [{ productId: P, quantidade: 3 }] },
      { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: M, quantidade: 3 }] },
      { kitId: "kit-presente", quantidade: 3, sabores: [{ productId: P, quantidade: 3 }] },
    ]);
    assert.deepEqual(
      grupos.map((g) => [g.sabores[0].productId, g.quantidade]),
      [
        [P, 5],
        [M, 1],
      ],
    );
  });
});

describe("sabores permitidos no kit", () => {
  const pimenta = { productId: P, nome: "Pimenta, 112g", permitidoEmKit: true };
  const morango = { productId: M, nome: "Morango, 112g", permitidoEmKit: true };
  const morango250 = { productId: "morango-250g", nome: "Morango, 250g", permitidoEmKit: false };
  const pimenta500 = { productId: "pimenta-500g", nome: "Pimenta, 500g", permitidoEmKit: false };

  it("todos permitidos: null", () => {
    assert.equal(conferirSaboresPermitidos([pimenta, morango, pimenta], "Kit Presente"), null);
    assert.equal(conferirSaboresPermitidos([], "Kit Presente"), null);
  });

  it("um sabor fora: mensagem com o nome do kit e o sabor sem a vírgula do rótulo", () => {
    assert.equal(conferirSaboresPermitidos([pimenta, morango250, morango], "Kit Presente"), "Kit Presente: Morango 250g não entra no kit.");
  });

  it("repetido conta uma vez; vários entram juntos, no plural e na ordem em que vieram", () => {
    assert.equal(conferirSaboresPermitidos([morango250, morango250, pimenta], "Kit Presente"), "Kit Presente: Morango 250g não entra no kit.");
    assert.equal(
      conferirSaboresPermitidos([pimenta500, pimenta, morango250], "Caixa"),
      "Caixa: Pimenta 500g e Morango 250g não entram no kit.",
    );
    const tres = conferirSaboresPermitidos([morango250, pimenta500, { productId: "x", nome: "Abacaxi", permitidoEmKit: false }], "Kit Presente");
    assert.equal(tres, "Kit Presente: Morango 250g, Pimenta 500g e Abacaxi não entram no kit.");
  });
});

describe("rateio do preço do kit", () => {
  const sabor = (productId: string, quantidade: number, precoAvulsoCentavos: number) => ({ productId, quantidade, precoAvulsoCentavos });

  it("4000 sobre {A,M,P} a 1500 cada: 1334/1333/1333", () => {
    const r = ratearPrecoDoKit(4000, [sabor(P, 1, 1500), sabor(M, 1, 1500), sabor(A, 1, 1500)]);
    assert.deepEqual(Object.fromEntries(r), { [A]: 1334, [M]: 1333, [P]: 1333 });
  });

  it("4000 sobre {M×1,P×2}: M 1333, P 2667", () => {
    const r = ratearPrecoDoKit(4000, [sabor(M, 1, 1500), sabor(P, 2, 1500)]);
    assert.deepEqual(Object.fromEntries(r), { [M]: 1333, [P]: 2667 });
  });

  it("4000 sobre {P×3}: 4000", () => {
    assert.deepEqual(Object.fromEntries(ratearPrecoDoKit(4000, [sabor(P, 3, 1500)])), { [P]: 4000 });
  });

  it("preços 1500/1800/1500: 1250/1500/1250", () => {
    const r = ratearPrecoDoKit(4000, [sabor(A, 1, 1500), sabor(M, 1, 1800), sabor(P, 1, 1500)]);
    assert.deepEqual(Object.fromEntries(r), { [A]: 1250, [M]: 1500, [P]: 1250 });
  });

  it("preços avulsos 0: divide pelos potes", () => {
    const r = ratearPrecoDoKit(4000, [sabor(M, 1, 0), sabor(P, 2, 0)]);
    assert.deepEqual(Object.fromEntries(r), { [M]: 1333, [P]: 2667 });
  });

  it("não depende da ordem de entrada nem de linhas repetidas", () => {
    const a = ratearPrecoDoKit(4000, [sabor(P, 1, 1500), sabor(A, 1, 1500), sabor(M, 1, 1500)]);
    const b = ratearPrecoDoKit(4000, [sabor(M, 1, 1500), sabor(P, 1, 1500), sabor(A, 1, 1500)]);
    assert.deepEqual(Object.fromEntries(a), Object.fromEntries(b));
    const c = ratearPrecoDoKit(4000, [sabor(P, 1, 1500), sabor(M, 1, 1500), sabor(P, 1, 1500)]);
    assert.deepEqual(Object.fromEntries(c), { [M]: 1333, [P]: 2667 });
  });

  it("preço 0 dá 0 para todos", () => {
    assert.deepEqual(Object.fromEntries(ratearPrecoDoKit(0, [sabor(M, 1, 1500), sabor(P, 2, 1500)])), { [M]: 0, [P]: 0 });
  });

  it("recusa entrada impossível (sem sabores, preço quebrado ou negativo)", () => {
    assert.throws(() => ratearPrecoDoKit(4000, []), RangeError);
    assert.throws(() => ratearPrecoDoKit(40.5, [sabor(P, 3, 1500)]), RangeError);
    assert.throws(() => ratearPrecoDoKit(-1, [sabor(P, 3, 1500)]), RangeError);
    assert.throws(() => ratearPrecoDoKit(4000, [sabor(P, 0, 1500)]), RangeError);
    assert.throws(() => ratearPrecoDoKit(4000, [sabor(P, 3, -1)]), RangeError);
  });

  it("propriedade (200 entradas aleatórias): a soma é sempre o preço e nada é negativo", () => {
    // Gerador determinístico (LCG), para uma falha poder ser reproduzida.
    let semente = 20261020;
    const aleatorio = (max: number) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente % max;
    };
    for (let rodada = 0; rodada < 200; rodada++) {
      const preco = aleatorio(99_999) + 1;
      const n = aleatorio(6) + 1;
      const sabores = Array.from({ length: n }, (_, i) => sabor(`sabor-${aleatorio(4)}-${i}`, aleatorio(6) + 1, rodada % 10 === 0 ? 0 : aleatorio(99_999)));
      const r = ratearPrecoDoKit(preco, sabores);
      assert.equal(soma(r), preco, `rodada ${rodada}: soma ${soma(r)} ≠ ${preco}`);
      for (const valor of r.values()) {
        assert.ok(Number.isInteger(valor) && valor >= 0, `rodada ${rodada}: valor ${valor}`);
      }
      assert.equal(r.size, new Set(sabores.map((s) => s.productId)).size);
    }
  });
});

describe("economia, peso e conteúdo", () => {
  it("economiaDoKit: 3×1500 contra 4000 dá 500; kit de 5000 dá 0", () => {
    const sabores = [{ quantidade: 3, precoAvulsoCentavos: 1500 }];
    assert.equal(economiaDoKit(4000, sabores), 500);
    assert.equal(economiaDoKit(5000, sabores), 0);
  });

  it("faixaDeEconomia(4000, 3, [1500,1500,1800]) dá {500,1400}; lista vazia dá null", () => {
    assert.deepEqual(faixaDeEconomia(4000, 3, [1500, 1500, 1800]), { minima: 500, maxima: 1400 });
    assert.equal(faixaDeEconomia(4000, 3, []), null);
  });

  it("faixaDeEconomia nunca é negativa; sem repetição usa os N mais baratos e os N mais caros", () => {
    assert.deepEqual(faixaDeEconomia(5000, 3, [1500, 1800]), { minima: 0, maxima: 400 });
    assert.deepEqual(faixaDeEconomia(4000, 3, [1500, 1500, 1800, 2000], { permitirRepetir: false }), { minima: 800, maxima: 1300 });
    assert.equal(faixaDeEconomia(4000, 3, [1500, 1800], { permitirRepetir: false }), null);
  });

  it("avisoDePrecoDoKit: null se toda caixa sai mais barata; texto se alguma não sai", () => {
    assert.equal(avisoDePrecoDoKit(4000, 3, [1500, 1800]), null);
    assert.equal(avisoDePrecoDoKit(4000, 3, []), null);
    const parcial = avisoDePrecoDoKit(4500, 3, [1500, 1800]);
    assert.ok(parcial && parcial.includes("mais baratos"), String(parcial));
    const sempre = avisoDePrecoDoKit(6000, 3, [1500, 1800]);
    assert.ok(sempre && sempre.includes("nenhum sabor"), String(sempre));
  });

  it("avisoDeDescontoDoKit: avisa só acima de 30% do preço do kit (conta em inteiros, sem arredondar)", () => {
    // 3 × R$ 15 contra R$ 40: economia R$ 5 (12,5%).
    assert.equal(avisoDeDescontoDoKit(4000, 3, [1500]), null);
    // Exatamente 30% não avisa; um centavo a mais avisa.
    assert.equal(avisoDeDescontoDoKit(1000, 1, [1300]), null);
    assert.ok(avisoDeDescontoDoKit(1000, 1, [1301]));
    assert.equal(avisoDeDescontoDoKit(4000, 3, []), null);
    assert.equal(DESCONTO_MAXIMO_SEM_AVISO_PERCENTUAL, 30);
  });

  it("avisoDeDescontoDoKit explica o risco: valores, percentual e o que conferir", () => {
    // Com um sabor de R$ 18: 3 × R$ 18 = R$ 54 por R$ 40 → economia R$ 14 (35%).
    // formatarBRL separa "R$" do valor com espaço inseparável (U+00A0).
    const aviso = (avisoDeDescontoDoKit(4000, 3, [1500, 1500, 1800]) ?? "").replace(/ /g, " ");
    for (const trecho of ["R$ 54,00", "R$ 40,00", "R$ 14,00", "35%", "prejuízo", "Pode entrar no Kit Presente"]) {
      assert.ok(aviso.includes(trecho), `"${trecho}" em: ${aviso}`);
    }
  });

  it("pote de 250 g a R$ 28 marcado por engano: a faixa dispara e o aviso aparece; desmarcado, volta ao normal", () => {
    const padrao = [1500, 1500, 1500];
    const comPoteGrande = [...padrao, 2800];
    // Só os permitidos (o que o painel e o montador passam): economia de R$ 5, sem aviso.
    assert.deepEqual(faixaDeEconomia(4000, 3, padrao), { minima: 500, maxima: 500 });
    assert.equal(avisosDoKit(4000, 3, padrao), null);
    // Com o pote grande na conta: 3 × R$ 28 = R$ 84 por R$ 40 (110% do preço do kit).
    assert.deepEqual(faixaDeEconomia(4000, 3, comPoteGrande), { minima: 500, maxima: 4400 });
    assert.ok(avisosDoKit(4000, 3, comPoteGrande)?.includes("110%"));
  });

  it("avisosDoKit: nenhum sabor permitido, os dois avisos juntos, ou null", () => {
    assert.ok(avisosDoKit(4000, 3, [])?.includes("Nenhum sabor"));
    assert.equal(avisosDoKit(4000, 3, [1500, 1800].slice(0, 1)), null);
    // Preços muito diferentes: a caixa mais barata não compensa e a mais cara dá desconto demais.
    const ambos = avisosDoKit(3500, 3, [1000, 3000]) ?? "";
    assert.ok(ambos.includes("mais baratos") && ambos.includes("mais caros"), ambos);
    // Só o aviso de preço (o mesmo texto de avisoDePrecoDoKit).
    assert.equal(avisosDoKit(4500, 3, [1500, 1800]), avisoDePrecoDoKit(4500, 3, [1500, 1800]));
  });

  it("pesoDoKit(150, {P112×2, M125}) dá 499", () => {
    assert.equal(
      pesoDoKit(150, [
        { quantidade: 2, pesoGramas: 112 },
        { quantidade: 1, pesoGramas: 125 },
      ]),
      499,
    );
  });

  it("somarConteudo: avulso 1500/125g ×2 + kit 4000 (499 g) dá 7000, 749 g e 5 potes", () => {
    const r = somarConteudo({
      avulsos: [{ quantidade: 2, precoCentavos: 1500, pesoGramas: 125 }],
      kits: [
        {
          quantidade: 1,
          precoCentavos: 4000,
          pesoCaixaGramas: 150,
          sabores: [
            { quantidade: 2, pesoGramas: 112 },
            { quantidade: 1, pesoGramas: 125 },
          ],
        },
      ],
    });
    assert.deepEqual(r, { subtotalCentavos: 7000, pesoTotalGramas: 749, potes: 5 });
  });

  it("somarConteudo multiplica pelas caixas e aceita carrinho vazio", () => {
    const kit = { quantidade: 3, precoCentavos: 4000, pesoCaixaGramas: 150, sabores: [{ quantidade: 3, pesoGramas: 112 }] };
    assert.deepEqual(somarConteudo({ avulsos: [], kits: [kit] }), { subtotalCentavos: 12000, pesoTotalGramas: 3 * 486, potes: 9 });
    assert.deepEqual(somarConteudo({ avulsos: [], kits: [] }), { subtotalCentavos: 0, pesoTotalGramas: 0, potes: 0 });
  });

  it("emCentavos arredonda o erro do ponto flutuante", () => {
    assert.equal(emCentavos(24.9), 2490);
    assert.equal(emCentavos(15), 1500);
    assert.equal(emCentavos(0.29), 29);
  });

  describe("mesmoConteudo", () => {
    const base = {
      avulsos: [
        { productId: A, quantidade: 2 },
        { productId: M, quantidade: 1 },
      ],
      kits: [
        { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: P, quantidade: 2 }, { productId: M, quantidade: 1 }] },
        { kitId: "kit-presente", quantidade: 2, sabores: [{ productId: A, quantidade: 3 }] },
      ],
    };

    it("ordem trocada: true", () => {
      const trocado = {
        avulsos: [...base.avulsos].reverse(),
        kits: [
          { kitId: "kit-presente", quantidade: 2, sabores: [{ productId: A, quantidade: 3 }] },
          { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: M, quantidade: 1 }, { productId: P, quantidade: 2 }] },
        ],
      };
      assert.equal(mesmoConteudo(base, trocado), true);
    });

    it("linhas divididas de outro jeito (mesmo total): true", () => {
      const dividido = {
        avulsos: [{ productId: A, quantidade: 1 }, { productId: M, quantidade: 1 }, { productId: A, quantidade: 1 }],
        kits: [
          { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: P, quantidade: 2 }, { productId: M, quantidade: 1 }] },
          { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: A, quantidade: 3 }] },
          { kitId: "kit-presente", quantidade: 1, sabores: [{ productId: A, quantidade: 3 }] },
        ],
      };
      assert.equal(mesmoConteudo(base, dividido), true);
    });

    it("composição diferente: false", () => {
      const outro = { ...base, kits: [{ ...base.kits[0], sabores: [{ productId: P, quantidade: 3 }] }, base.kits[1]] };
      assert.equal(mesmoConteudo(base, outro), false);
    });

    it("quantidade diferente: false (de caixas ou de avulsos)", () => {
      assert.equal(mesmoConteudo(base, { ...base, kits: [base.kits[0], { ...base.kits[1], quantidade: 3 }] }), false);
      assert.equal(mesmoConteudo(base, { ...base, avulsos: [{ productId: A, quantidade: 3 }, base.avulsos[1]] }), false);
      assert.equal(mesmoConteudo(base, { ...base, kits: [base.kits[0]] }), false);
    });

    it("os mesmos sabores, avulsos de um lado e em kit do outro: false", () => {
      const avulso = { avulsos: [{ productId: P, quantidade: 3 }], kits: [] };
      const emKit = { avulsos: [], kits: [{ kitId: "kit-presente", quantidade: 1, sabores: [{ productId: P, quantidade: 3 }] }] };
      assert.equal(mesmoConteudo(avulso, emKit), false);
    });

    it("pedido antigo sem kits contra o mesmo carrinho sem kits: true", () => {
      assert.equal(mesmoConteudo({ avulsos: base.avulsos, kits: [] }, { avulsos: [...base.avulsos].reverse(), kits: [] }), true);
    });
  });

  it("potesParaSeparar: avulso {P×2} + 2 caixas {P×1,M×2} dá 2 caixas, P 4, M 4", () => {
    const r = potesParaSeparar({
      avulsos: [{ productId: P, nome: "Pimenta, 112g", quantidade: 2 }],
      kits: [
        {
          quantidade: 2,
          sabores: [
            { productId: P, nome: "Pimenta, 112g", quantidade: 1 },
            { productId: M, nome: "Morango, 112g", quantidade: 2 },
          ],
        },
      ],
    });
    assert.deepEqual(r, {
      caixas: 2,
      potes: [
        { productId: M, nome: "Morango, 112g", avulsos: 0, emKits: 4, total: 4 },
        { productId: P, nome: "Pimenta, 112g", avulsos: 2, emKits: 2, total: 4 },
      ],
    });
  });

  it("textoDaComposicao: sabor sem o peso, o de mais potes primeiro", () => {
    assert.equal(
      textoDaComposicao([
        { productId: M, nome: "Morango, 112g", quantidade: 1 },
        { productId: P, nome: "Pimenta, 112g", quantidade: 2 },
      ]),
      "Pimenta ×2 · Morango",
    );
  });
});

describe("schemas", () => {
  const kitValido = { nome: "Kit Presente", descricao: "Três geleias à sua escolha.", precoCentavos: 4000, pesoCaixaGramas: 150, ativo: false };

  it("kitSchema aceita o preço como texto (\"4000\") e número", () => {
    assert.equal(kitSchema.parse({ ...kitValido, precoCentavos: "4000" }).precoCentavos, 4000);
    assert.equal(kitSchema.parse({ ...kitValido, pesoCaixaGramas: "0" }).pesoCaixaGramas, 0);
    assert.deepEqual(kitSchema.parse({ ...kitValido, nome: "  Kit Presente  " }).nome, "Kit Presente");
  });

  it("kitSchema recusa preço 0 ou 100000, peso −1 ou 1,5, e texto com U+202E", () => {
    for (const invalido of [
      { precoCentavos: 0 },
      { precoCentavos: "0" },
      { precoCentavos: 100000 },
      { precoCentavos: 40.5 },
      { precoCentavos: true },
      { precoCentavos: null },
      { pesoCaixaGramas: -1 },
      { pesoCaixaGramas: 1.5 },
      { pesoCaixaGramas: "1,5" },
      { pesoCaixaGramas: 5001 },
      { nome: "Kit ‮Presente" },
      { descricao: "Três ‮geleias" },
      { nome: "K" },
      { descricao: "x".repeat(301) },
      { ativo: "true" },
    ]) {
      assert.equal(kitSchema.safeParse({ ...kitValido, ...invalido }).success, false, JSON.stringify(invalido));
    }
  });

  it("kitSchema: o nome fica numa linha só (recusa \\n, \\r e \\t no meio); a descrição aceita quebra de linha", () => {
    for (const nome of ["Kit\nPresente", "Kit\rPresente", "Kit\tPresente", "Kit\r\nPresente"]) {
      const r = kitSchema.safeParse({ ...kitValido, nome });
      assert.equal(r.success, false, JSON.stringify(nome));
      assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "nome" && i.message.includes("uma linha só")), JSON.stringify(nome));
    }
    // Nas pontas, o trim tira antes de conferir: o nome salvo não tem quebra.
    assert.equal(kitSchema.parse({ ...kitValido, nome: "\tKit Presente\n" }).nome, "Kit Presente");
    assert.ok(kitSchema.safeParse({ ...kitValido, descricao: "Três geleias.\nNuma caixa de presente." }).success);
  });

  it("kitVisibilidadeSchema aceita só { ativo: boolean }", () => {
    assert.deepEqual(kitVisibilidadeSchema.parse({ ativo: true }), { ativo: true });
    assert.equal(kitVisibilidadeSchema.safeParse({ ativo: "sim" }).success, false);
  });

  describe("pedidoSchema", () => {
    const kit = {
      kitId: "kit-presente",
      quantidade: 1,
      sabores: [
        { productId: P, quantidade: 2 },
        { productId: M, quantidade: 1 },
      ],
    };
    // Desde a B6, todo pedido online diz o modo de entrega e o WhatsApp.
    const comEndereco = { modoEntrega: "ENTREGA", telefone: "(86) 99999-1234", addressId: "endereco-1" };

    it("{ itens: [], kits: [k] } passa", () => {
      const r = pedidoSchema.safeParse({ ...comEndereco, itens: [], kits: [kit] });
      assert.equal(r.success, true);
    });

    it("{} dá \"O carrinho está vazio.\"", () => {
      // {} falha já pelo modo de entrega e pelo telefone (obrigatórios desde a B6); o carrinho vazio
      // aparece quando o resto está certo.
      assert.equal(pedidoSchema.safeParse({}).success, false);
      const soEndereco = pedidoSchema.safeParse(comEndereco);
      assert.ok(!soEndereco.success && soEndereco.error.issues.some((i) => i.message === "O carrinho está vazio."));
    });

    it("payload antigo (sem kits) passa e ganha kits: []", () => {
      const r = pedidoSchema.parse({ ...comEndereco, itens: [{ productId: A, quantidade: 2 }], totalEsperadoCentavos: 6000 });
      assert.deepEqual(r.kits, []);
      assert.deepEqual(r.itens, [{ productId: A, quantidade: 2 }]);
    });

    it("recusa kit com quantidade 0, 7 sabores, ou sabor com quantidade 0", () => {
      assert.equal(pedidoSchema.safeParse({ ...comEndereco, kits: [{ ...kit, quantidade: 0 }] }).success, false);
      const seteSabores = Array.from({ length: 7 }, (_, i) => ({ productId: `sabor-${i}`, quantidade: 1 }));
      assert.equal(pedidoSchema.safeParse({ ...comEndereco, kits: [{ ...kit, sabores: seteSabores }] }).success, false);
      assert.equal(pedidoSchema.safeParse({ ...comEndereco, kits: [{ ...kit, sabores: [{ productId: P, quantidade: 0 }] }] }).success, false);
    });

    it("recusa mais caixas que o teto (somando as linhas), mais de 6 potes numa caixa e kit sem sabores", () => {
      const linhas = [
        { ...kit, quantidade: MAX_KITS_POR_PEDIDO },
        { ...kit, quantidade: 1, sabores: [{ productId: A, quantidade: 3 }] },
      ];
      const r = pedidoSchema.safeParse({ ...comEndereco, kits: linhas });
      assert.ok(!r.success && r.error.issues.some((i) => i.path.join(".") === "kits"));
      assert.equal(pedidoSchema.safeParse({ ...comEndereco, kits: [{ ...kit, quantidade: MAX_KITS_POR_PEDIDO }] }).success, true);
      const muitosPotes = [{ productId: P, quantidade: 4 }, { productId: M, quantidade: 3 }];
      assert.equal(pedidoSchema.safeParse({ ...comEndereco, kits: [{ ...kit, sabores: muitosPotes }] }).success, false);
      assert.equal(pedidoSchema.safeParse({ ...comEndereco, kits: [{ ...kit, sabores: [] }] }).success, false);
    });
  });
});
