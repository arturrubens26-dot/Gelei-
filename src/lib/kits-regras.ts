/**
 * Regras puras do "Monte seu kit" (servidor e navegador), testadas em testes/kits.test.ts.
 *
 * Dinheiro em CENTAVOS inteiros e peso em GRAMAS inteiros: o carrinho e o servidor fazem a mesma
 * conta (`somarConteudo`), então o total que a cliente vê é o que o servidor cobra.
 */
import { z } from "zod";
import { formatarBRL } from "@/lib/dinheiro";
import { ROTULO_PERMITIDO_EM_KIT, separarNome } from "@/lib/produtos-regras";
import { MAX_PRECO_UNITARIO_CENTAVOS, textoLivreValido } from "@/lib/vendas";

/** A cliente pode repetir sabor na caixa (ex.: 3× Pimenta). Decisão da dona. */
export const PERMITIR_SABOR_REPETIDO = true;

/** Potes de um sabor numa caixa. */
export type SaborNoKit = { productId: string; quantidade: number };

/** Uma linha de kit: N caixas iguais, com a composição de UMA caixa. */
export type LinhaDeKit<S extends SaborNoKit = SaborNoKit> = { kitId: string; quantidade: number; sabores: readonly S[] };

/** Reais (como vêm do catálogo e do carrinho) → centavos inteiros. 24.9 * 100 dá 2489,99…: arredonda. */
export function emCentavos(reais: number): number {
  return Math.round(reais * 100);
}

/** Ordem por id com comparação simples (não `localeCompare`): igual em qualquer navegador e no servidor. */
const porProductId = (a: { productId: string }, b: { productId: string }) =>
  a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;

/**
 * Junta o mesmo sabor repetido em várias linhas (somando os potes) e ordena por `productId`, para
 * que [Pimenta, Morango, Pimenta] e [Morango, Pimenta, Pimenta] sejam a mesma caixa. Os demais
 * campos (nome, foto, preço) vêm da primeira ocorrência.
 */
export function normalizarComposicao<S extends SaborNoKit>(sabores: readonly S[]): S[] {
  const porId = new Map<string, S>();
  for (const s of sabores) {
    const atual = porId.get(s.productId);
    porId.set(s.productId, atual ? { ...atual, quantidade: atual.quantidade + s.quantidade } : { ...s });
  }
  return [...porId.values()].sort(porProductId);
}

/** Vagas da caixa na tela (`null` = vaga livre) → composição normalizada. */
export function composicaoDasVagas(vagas: readonly (string | null)[]): SaborNoKit[] {
  return normalizarComposicao(vagas.filter((v): v is string => v !== null).map((productId) => ({ productId, quantidade: 1 })));
}

/**
 * Identidade de uma caixa: o kit e a composição normalizada. JSON (e não "id:qtd,id:qtd") para que
 * um id com "," ou ":" nunca colida com outra composição.
 */
export function chaveDoKit(kitId: string, sabores: readonly SaborNoKit[]): string {
  return JSON.stringify([kitId, normalizarComposicao(sabores).map((s) => [s.productId, s.quantidade])]);
}

export type MotivoComposicaoInvalida = "incompleta" | "excede" | "quantidade-invalida" | "repetido";

export type ResultadoComposicao<S extends SaborNoKit = SaborNoKit> =
  | { ok: true; composicao: S[] }
  | { ok: false; motivo: MotivoComposicaoInvalida; mensagem: string };

const potesNoPlural = (n: number) => `${n} ${n === 1 ? "pote" : "potes"}`;

/**
 * A caixa tem exatamente `potes` potes? Quantidades inteiras ≥ 1 e, sem repetição permitida, um pote
 * de cada sabor. `nomeDoKit` só entra na mensagem ("Kit Presente: a caixa leva 3 potes; vieram 4.").
 */
export function conferirComposicao<S extends SaborNoKit>(
  sabores: readonly S[],
  potes: number,
  opcoes: { permitirRepetir?: boolean; nomeDoKit?: string } = {},
): ResultadoComposicao<S> {
  const permitirRepetir = opcoes.permitirRepetir ?? PERMITIR_SABOR_REPETIDO;
  const prefixo = opcoes.nomeDoKit ? `${opcoes.nomeDoKit}: a caixa` : "A caixa";

  if (sabores.some((s) => !Number.isInteger(s.quantidade) || s.quantidade < 1)) {
    return { ok: false, motivo: "quantidade-invalida", mensagem: "A quantidade de cada sabor precisa ser um número inteiro de potes, de 1 em diante." };
  }
  const composicao = normalizarComposicao(sabores);
  if (!permitirRepetir && composicao.some((s) => s.quantidade > 1)) {
    return { ok: false, motivo: "repetido", mensagem: "Cada sabor só pode entrar uma vez na caixa." };
  }
  const total = composicao.reduce((soma, s) => soma + s.quantidade, 0);
  if (total > potes) {
    return { ok: false, motivo: "excede", mensagem: `${prefixo} leva ${potesNoPlural(potes)}; vieram ${total}.` };
  }
  if (total < potes) {
    return { ok: false, motivo: "incompleta", mensagem: `${prefixo} leva ${potesNoPlural(potes)}; vieram ${total}.` };
  }
  return { ok: true, composicao };
}

/** "Morango, 250g" → "Morango 250g" (o nome do rótulo sem a vírgula, para caber numa frase). */
const nomeNaFrase = (nome: string) => {
  const { sabor, peso } = separarNome(nome);
  return peso ? `${sabor} ${peso}` : sabor;
};

/**
 * Sabores da caixa que não podem entrar no kit ("Pode entrar no Kit Presente" desligado no painel:
 * um pote maior ou mais caro dentro da caixa sairia com desconto grande demais). Devolve a mensagem
 * do 400 ("Kit Presente: Morango 250g não entra no kit."), ou `null` se todos podem. Cada sabor
 * aparece uma vez, na ordem em que veio.
 */
export function conferirSaboresPermitidos(
  sabores: readonly { productId: string; nome: string; permitidoEmKit: boolean }[],
  nomeDoKit: string,
): string | null {
  const vistos = new Set<string>();
  const fora: string[] = [];
  for (const s of sabores) {
    if (s.permitidoEmKit || vistos.has(s.productId)) continue;
    vistos.add(s.productId);
    fora.push(nomeNaFrase(s.nome));
  }
  if (fora.length === 0) return null;
  const lista = fora.length === 1 ? fora[0] : `${fora.slice(0, -1).join(", ")} e ${fora[fora.length - 1]}`;
  return `${nomeDoKit}: ${lista} ${fora.length === 1 ? "não entra" : "não entram"} no kit.`;
}

/**
 * Junta as linhas com a mesma caixa (mesmo kit e mesma composição), somando as caixas. Devolve as
 * composições normalizadas e a `chave` de cada linha, na ordem em que a caixa apareceu primeiro.
 */
export function agruparKits<L extends LinhaDeKit>(linhas: readonly L[]): KitAgrupado<L>[] {
  const porChave = new Map<string, { linha: L; quantidade: number }>();
  for (const linha of linhas) {
    const chave = chaveDoKit(linha.kitId, linha.sabores);
    const atual = porChave.get(chave);
    if (atual) atual.quantidade += linha.quantidade;
    else porChave.set(chave, { linha, quantidade: linha.quantidade });
  }
  return [...porChave].map(([chave, { linha, quantidade }]) => ({
    ...linha,
    quantidade,
    sabores: normalizarComposicao<SaborDaLinha<L>>(linha.sabores),
    chave,
  }));
}

type SaborDaLinha<L extends LinhaDeKit> = L["sabores"][number];

/** Linha agrupada: os mesmos campos da primeira linha, com as caixas somadas e a composição normalizada. */
export type KitAgrupado<L extends LinhaDeKit> = Omit<L, "quantidade" | "sabores"> & {
  kitId: string;
  quantidade: number;
  sabores: SaborDaLinha<L>[];
  chave: string;
};

/**
 * Divide o preço de UMA caixa entre os sabores, proporcional ao preço avulso × potes de cada um
 * (método dos maiores restos, só com inteiros). O Financeiro "por sabor" usa este valor: assim a
 * soma por sabor bate com o que entrou de verdade.
 * - Empate no resto: vence o menor `productId` (o resultado não depende da ordem de entrada).
 * - Todos os preços avulsos zerados: divide pelos potes.
 * - A soma devolvida é SEMPRE igual a `precoCentavos`, e nenhum valor é negativo.
 */
export function ratearPrecoDoKit(
  precoCentavos: number,
  sabores: readonly (SaborNoKit & { precoAvulsoCentavos: number })[],
): Map<string, number> {
  if (!Number.isInteger(precoCentavos) || precoCentavos < 0) throw new RangeError("Preço do kit inválido para o rateio.");
  if (sabores.some((s) => !Number.isInteger(s.quantidade) || s.quantidade < 1 || !Number.isInteger(s.precoAvulsoCentavos) || s.precoAvulsoCentavos < 0)) {
    throw new RangeError("Sabor do kit inválido para o rateio.");
  }
  const composicao = normalizarComposicao(sabores);
  if (composicao.length === 0) throw new RangeError("Kit sem sabores para o rateio.");

  let pesos = composicao.map((s) => s.precoAvulsoCentavos * s.quantidade);
  let somaPesos = pesos.reduce((a, b) => a + b, 0);
  if (somaPesos === 0) {
    pesos = composicao.map((s) => s.quantidade);
    somaPesos = pesos.reduce((a, b) => a + b, 0);
  }

  // Parte inteira e resto de preço × peso ÷ soma, em inteiros (os produtos ficam muito abaixo de 2^53).
  const partes = composicao.map((s, i) => {
    const numerador = precoCentavos * pesos[i];
    const base = Math.floor(numerador / somaPesos);
    return { productId: s.productId, valor: base, resto: numerador - base * somaPesos };
  });
  let sobra = precoCentavos - partes.reduce((soma, p) => soma + p.valor, 0);
  const porResto = [...partes].sort((a, b) => b.resto - a.resto || porProductId(a, b));
  for (let i = 0; sobra > 0; i = (i + 1) % porResto.length, sobra--) porResto[i].valor += 1;

  return new Map(partes.map((p) => [p.productId, p.valor]));
}

/** Quanto a caixa sai mais barata que os mesmos potes avulsos (nunca negativo). */
export function economiaDoKit(precoKitCentavos: number, sabores: readonly { quantidade: number; precoAvulsoCentavos: number }[]): number {
  const avulsos = sabores.reduce((soma, s) => soma + s.quantidade * s.precoAvulsoCentavos, 0);
  return Math.max(0, avulsos - precoKitCentavos);
}

/** Economia (bruta, pode ser negativa) da caixa mais barata e da mais cara que dá para montar. */
function extremosDeEconomia(
  precoKitCentavos: number,
  potes: number,
  precosAvulsosCentavos: readonly number[],
  permitirRepetir: boolean,
): { minima: number; maxima: number } | null {
  if (precosAvulsosCentavos.length === 0 || potes < 1) return null;
  const ordenados = [...precosAvulsosCentavos].sort((a, b) => a - b);
  if (permitirRepetir) {
    return { minima: potes * ordenados[0] - precoKitCentavos, maxima: potes * ordenados[ordenados.length - 1] - precoKitCentavos };
  }
  if (ordenados.length < potes) return null;
  const soma = (lista: number[]) => lista.reduce((a, b) => a + b, 0);
  return { minima: soma(ordenados.slice(0, potes)) - precoKitCentavos, maxima: soma(ordenados.slice(-potes)) - precoKitCentavos };
}

/**
 * Faixa de economia enquanto a caixa ainda não está completa ("Economize até R$ 14,00"), a partir
 * dos preços avulsos dos sabores que a cliente pode escolher: passe SÓ os que estão à venda e podem
 * entrar no kit (`ativo` e `permitidoEmKit`); um pote grande desmarcado inflaria a "economia".
 * `null` sem sabores. Os valores nunca são negativos.
 */
export function faixaDeEconomia(
  precoKitCentavos: number,
  potes: number,
  precosAvulsosCentavos: readonly number[],
  opcoes: { permitirRepetir?: boolean } = {},
): { minima: number; maxima: number } | null {
  const extremos = extremosDeEconomia(precoKitCentavos, potes, precosAvulsosCentavos, opcoes.permitirRepetir ?? PERMITIR_SABOR_REPETIDO);
  return extremos ? { minima: Math.max(0, extremos.minima), maxima: Math.max(0, extremos.maxima) } : null;
}

/**
 * Aviso para o painel quando o kit não sai mais barato que os avulsos (não bloqueia: a dona pode
 * querer assim; a loja só esconde o "Economize"). `null` quando toda caixa possível sai mais barata.
 */
export function avisoDePrecoDoKit(precoKitCentavos: number, potes: number, precosAvulsosCentavos: readonly number[]): string | null {
  const extremos = extremosDeEconomia(precoKitCentavos, potes, precosAvulsosCentavos, PERMITIR_SABOR_REPETIDO);
  if (!extremos || extremos.minima > 0) return null;
  const preco = formatarBRL(precoKitCentavos / 100);
  if (extremos.maxima <= 0) {
    return `O kit (${preco}) não sai mais barato que ${potes} potes avulsos, com nenhum sabor. A loja não vai mostrar "Economize".`;
  }
  const maisBaratos = formatarBRL((extremos.minima + precoKitCentavos) / 100);
  return `Com os sabores mais baratos, o kit (${preco}) não sai mais barato que ${potes} potes avulsos (${maisBaratos}). Nessas caixas a loja não mostra "Economize".`;
}

/** Economia máxima, em % do preço do kit, acima da qual o painel avisa (desconto grande demais). */
export const DESCONTO_MAXIMO_SEM_AVISO_PERCENTUAL = 30;

/**
 * O aviso inverso: com os sabores mais caros, a cliente economiza mais de 30% do preço do kit.
 * Sinal de pote grande ou caro marcado como "Pode entrar no Kit Presente", ou de preço do kit baixo
 * demais: cada caixa assim pode dar prejuízo. Não bloqueia; `null` quando o desconto é razoável.
 */
export function avisoDeDescontoDoKit(precoKitCentavos: number, potes: number, precosAvulsosCentavos: readonly number[]): string | null {
  const extremos = extremosDeEconomia(precoKitCentavos, potes, precosAvulsosCentavos, PERMITIR_SABOR_REPETIDO);
  if (!extremos || precoKitCentavos <= 0) return null;
  // Em inteiros: maxima / preco > 30% ⇔ maxima × 100 > 30 × preco.
  if (extremos.maxima * 100 <= DESCONTO_MAXIMO_SEM_AVISO_PERCENTUAL * precoKitCentavos) return null;
  const preco = formatarBRL(precoKitCentavos / 100);
  const maisCaros = formatarBRL((extremos.maxima + precoKitCentavos) / 100);
  const economia = formatarBRL(extremos.maxima / 100);
  const percentual = Math.round((extremos.maxima * 100) / precoKitCentavos);
  return (
    `Com os sabores mais caros, ${potes} potes avulsos custam ${maisCaros} e no kit saem por ${preco}: a cliente economiza ${economia} ` +
    `(${percentual}% do preço do kit). Um desconto tão grande pode dar prejuízo em cada caixa: confira o preço do kit e deixe ` +
    `"${ROTULO_PERMITIDO_EM_KIT}" marcado só nos potes do tamanho padrão.`
  );
}

/**
 * Os avisos do painel para o kit num texto só, ou `null`: nenhum sabor pode entrar, o kit não sai
 * mais barato que os avulsos (`avisoDePrecoDoKit`) ou sai barato demais (`avisoDeDescontoDoKit`).
 * Nenhum bloqueia. `precosAvulsosCentavos`: só os sabores à venda que podem entrar no kit.
 */
export function avisosDoKit(precoKitCentavos: number, potes: number, precosAvulsosCentavos: readonly number[]): string | null {
  if (precosAvulsosCentavos.length === 0) {
    return `Nenhum sabor à venda está marcado como "${ROTULO_PERMITIDO_EM_KIT}": a cliente não tem o que escolher.`;
  }
  const avisos = [
    avisoDePrecoDoKit(precoKitCentavos, potes, precosAvulsosCentavos),
    avisoDeDescontoDoKit(precoKitCentavos, potes, precosAvulsosCentavos),
  ].filter((aviso): aviso is string => aviso !== null);
  return avisos.length > 0 ? avisos.join(" ") : null;
}

/** Peso da caixa montada: caixa vazia + potes (entra no frete). */
export function pesoDoKit(pesoCaixaGramas: number, sabores: readonly { quantidade: number; pesoGramas: number }[]): number {
  return pesoCaixaGramas + sabores.reduce((soma, s) => soma + s.quantidade * s.pesoGramas, 0);
}

export type AvulsoParaSomar = { quantidade: number; precoCentavos: number; pesoGramas: number };
export type KitParaSomar = {
  /** Caixas. */
  quantidade: number;
  /** Preço de UMA caixa. */
  precoCentavos: number;
  pesoCaixaGramas: number;
  /** Composição de UMA caixa. */
  sabores: readonly { quantidade: number; pesoGramas: number }[];
};

/**
 * Subtotal, peso (para o frete) e potes do carrinho inteiro. A MESMA conta no carrinho e no
 * servidor: se divergissem, o total da tela e o cobrado nunca bateriam (409 sem fim).
 */
export function somarConteudo(conteudo: { avulsos: readonly AvulsoParaSomar[]; kits: readonly KitParaSomar[] }): {
  subtotalCentavos: number;
  pesoTotalGramas: number;
  potes: number;
} {
  let subtotalCentavos = 0;
  let pesoTotalGramas = 0;
  let potes = 0;
  for (const a of conteudo.avulsos) {
    subtotalCentavos += a.quantidade * a.precoCentavos;
    pesoTotalGramas += a.quantidade * a.pesoGramas;
    potes += a.quantidade;
  }
  for (const k of conteudo.kits) {
    subtotalCentavos += k.quantidade * k.precoCentavos;
    pesoTotalGramas += k.quantidade * pesoDoKit(k.pesoCaixaGramas, k.sabores);
    potes += k.quantidade * k.sabores.reduce((soma, s) => soma + s.quantidade, 0);
  }
  return { subtotalCentavos, pesoTotalGramas, potes };
}

export type ConteudoComparavel = {
  avulsos: readonly SaborNoKit[];
  kits: readonly LinhaDeKit[];
};

/**
 * Idempotência do pedido: o carrinho reenviado com a mesma Idempotency-Key é o MESMO conteúdo do
 * pedido já criado? Avulsos e caixas iguais, sem importar a ordem nem como as linhas foram
 * divididas. O mesmo sabor avulso de um lado e dentro de uma caixa do outro é conteúdo diferente.
 */
export function mesmoConteudo(a: ConteudoComparavel, b: ConteudoComparavel): boolean {
  const avulsos = (c: ConteudoComparavel) => new Map(normalizarComposicao(c.avulsos).map((s) => [s.productId, s.quantidade]));
  const caixas = (c: ConteudoComparavel) => new Map(agruparKits(c.kits).map((k) => [k.chave, k.quantidade]));
  const iguais = (x: Map<string, number>, y: Map<string, number>) => x.size === y.size && [...x].every(([k, v]) => y.get(k) === v);
  return iguais(avulsos(a), avulsos(b)) && iguais(caixas(a), caixas(b));
}

type SaborComNome = SaborNoKit & { nome: string };

export type PoteParaSeparar = { productId: string; nome: string; avulsos: number; emKits: number; total: number };

/** "Separar…" da ficha do pedido: quantas caixas montar e quantos potes de cada sabor pegar. */
export function potesParaSeparar(conteudo: {
  avulsos: readonly SaborComNome[];
  kits: readonly { quantidade: number; sabores: readonly SaborComNome[] }[];
}): { caixas: number; potes: PoteParaSeparar[] } {
  const porId = new Map<string, PoteParaSeparar>();
  const linha = (s: SaborComNome): PoteParaSeparar => {
    const atual = porId.get(s.productId);
    if (atual) return atual;
    const nova = { productId: s.productId, nome: s.nome, avulsos: 0, emKits: 0, total: 0 };
    porId.set(s.productId, nova);
    return nova;
  };
  for (const a of conteudo.avulsos) {
    const l = linha(a);
    l.avulsos += a.quantidade;
    l.total += a.quantidade;
  }
  let caixas = 0;
  for (const k of conteudo.kits) {
    caixas += k.quantidade;
    for (const s of k.sabores) {
      const l = linha(s);
      l.emKits += k.quantidade * s.quantidade;
      l.total += k.quantidade * s.quantidade;
    }
  }
  const potes = [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || porProductId(a, b));
  return { caixas, potes };
}

/**
 * "Pimenta ×2 · Morango": a composição em uma linha, com o sabor sem o peso do rótulo. O sabor com
 * mais potes vem primeiro; empate, em ordem alfabética.
 */
export function textoDaComposicao(sabores: readonly SaborComNome[]): string {
  return normalizarComposicao(sabores)
    .map((s) => ({ sabor: separarNome(s.nome).sabor, quantidade: s.quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.sabor.localeCompare(b.sabor, "pt-BR"))
    .map((s) => `${s.sabor}${s.quantidade > 1 ? ` ×${s.quantidade}` : ""}`)
    .join(" · ");
}

// --- painel -----------------------------------------------------------------

/** Número vindo do JSON como número ou como texto ("4000"); booleano e null não viram número. */
const numeroDoCampo = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v), schema);

const textoDoKit = (campo: string, max: number) =>
  z
    .string(`Informe ${campo}.`)
    .trim()
    .min(2, `Informe ${campo}.`)
    .max(max, `Use no máximo ${max} caracteres.`)
    .refine(textoLivreValido, "Tem caracteres que não podem ser usados.");

/** Edição do kit pelo painel (PATCH /api/admin/kits/[id]). O preço viaja em centavos inteiros. */
export const kitSchema = z.object({
  // O nome vai em títulos, no carrinho e no pedido: uma linha só.
  nome: textoDoKit("o nome do kit", 80).refine((v) => !/[\t\n\r]/.test(v), "O nome fica numa linha só: sem quebra de linha nem tabulação."),
  descricao: textoDoKit("a descrição", 300),
  precoCentavos: numeroDoCampo(
    z
      .number("Informe o preço.")
      .int("Preço inválido.")
      .min(1, "Informe o preço.")
      .max(MAX_PRECO_UNITARIO_CENTAVOS, `Preço máximo: ${formatarBRL(MAX_PRECO_UNITARIO_CENTAVOS / 100)}.`),
  ),
  pesoCaixaGramas: numeroDoCampo(
    z
      .number("Informe o peso da caixa em gramas.")
      .int("O peso é em gramas inteiros.")
      .min(0, "O peso não pode ser negativo.")
      .max(5000, "Peso máximo: 5000 g."),
  ),
  ativo: z.boolean("Diga se o kit aparece na loja."),
});

export type KitEntrada = z.output<typeof kitSchema>;

/** Só mostrar/ocultar na loja (o mesmo PATCH, com o corpo `{ ativo }`). */
export const kitVisibilidadeSchema = z.object({ ativo: z.boolean("Diga se o kit aparece na loja.") });
