/**
 * Regras puras dos itens adicionais dos mimos (florzinhas, paninho na tampa, caixinha, colherzinha), usadas no
 * servidor e no navegador e testadas em testes/adicionais.test.ts. Sem Prisma e sem relógio.
 *
 * Como funciona (v1):
 * - cada item tem um preço POR POTINHO em centavos (0 = sem custo) e vale para TODOS os potinhos da encomenda;
 * - o valor dos adicionais = (soma dos preços por potinho dos itens marcados) × (potinhos da encomenda);
 * - entra no total e é rateado como o resto (a entrada é metade de potinhos + adicionais; o restante leva o
 *   frete), veja `calcularValores` em encomendas-regras.ts;
 * - o preço e o nome são sempre os do SERVIDOR e ficam congelados na encomenda (`EncomendaAdicional`).
 */
import { z } from "zod";
import { formatarBRL } from "@/lib/dinheiro";
import { MAX_PRECO_UNITARIO_CENTAVOS, textoLivreValido } from "@/lib/vendas";

/** Os quatro itens que já vêm cadastrados (migração 20261107120000_mimos_adicionais); o id escolhe a ilustração padrão. */
export const IDS_ADICIONAIS_PADRAO = ["florzinhas", "paninho-na-tampa", "caixinha", "colherzinha"] as const;
export type IdAdicionalPadrao = (typeof IDS_ADICIONAIS_PADRAO)[number];

export const ehAdicionalPadrao = (id: string): id is IdAdicionalPadrao => (IDS_ADICIONAIS_PADRAO as readonly string[]).includes(id);

/** Legenda obrigatória perto de qualquer imagem de adicional: ela é só um exemplo do item. */
export const LEGENDA_IMAGEM_ILUSTRATIVA = "Imagem ilustrativa";
/** Aviso do painel junto do campo de preço. */
export const AVISO_PRECO_ZERO = "Preço R$ 0,00 = sem custo para a cliente (o item continua aparecendo no formulário).";

/** Quantos itens a solicitação aceita (o cadastro tem poucos; o teto só protege a API). */
export const MAX_ADICIONAIS_POR_ENCOMENDA = 12;
export const TAMANHO_MAX_NOME_ADICIONAL = 60;
export const TAMANHO_MAX_DESCRICAO_ADICIONAL = 160;
export const MAX_ORDEM_ADICIONAL = 1000;

/** Um item como a loja o vê: só os que estão ATIVOS entram no catálogo da cliente. */
export type AdicionalDoCatalogo = {
  id: string;
  nome: string;
  /** Centavos por potinho (0 = sem custo). */
  precoCentavos: number;
};

/** "sem custo" ou "+ R$ 0,50 por potinho". */
export function rotuloDoPrecoAdicional(precoCentavos: number): string {
  return precoCentavos > 0 ? `+ ${formatarBRL(precoCentavos / 100)} por potinho` : "sem custo";
}

/** Soma dos preços por potinho dos itens escolhidos (centavos). */
export function precoPorPotinhoDosAdicionais(itens: readonly { precoCentavos: number }[]): number {
  return itens.reduce((soma, i) => soma + i.precoCentavos, 0);
}

/**
 * Valor dos adicionais da encomenda, em centavos inteiros: preço por potinho de cada item × potinhos.
 * Os mesmos itens para todos os potinhos (v1, sem quantidade por item).
 */
export function totalDosAdicionais(itens: readonly { precoCentavos: number }[], potinhos: number): number {
  if (!Number.isInteger(potinhos) || potinhos < 0) throw new RangeError("Quantidade de potinhos inválida.");
  return precoPorPotinhoDosAdicionais(itens) * potinhos;
}

export type ResultadoAdicionais =
  | { ok: true; itens: AdicionalDoCatalogo[] }
  | { ok: false; motivo: "duplicado" | "indisponivel"; mensagem: string; ids: string[] };

/**
 * Confere os ids que a cliente marcou contra o catálogo ATIVO do servidor: sem repetidos, todos conhecidos e à
 * venda. O resultado traz os itens do SERVIDOR (nome e preço), na ordem do catálogo, nunca os do cliente.
 * `catalogoAtivo` está na ordem de exibição (a do painel).
 */
export function conferirAdicionais(ids: readonly string[], catalogoAtivo: readonly AdicionalDoCatalogo[]): ResultadoAdicionais {
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  for (const id of ids) {
    if (vistos.has(id) && !repetidos.includes(id)) repetidos.push(id);
    vistos.add(id);
  }
  if (repetidos.length > 0) {
    return { ok: false, motivo: "duplicado", mensagem: "Há itens adicionais repetidos. Marque cada item uma vez só.", ids: repetidos };
  }
  const noCatalogo = new Map(catalogoAtivo.map((a) => [a.id, a]));
  const indisponiveis = [...vistos].filter((id) => !noCatalogo.has(id));
  if (indisponiveis.length > 0) {
    return { ok: false, motivo: "indisponivel", mensagem: "Alguns itens adicionais não estão mais disponíveis.", ids: indisponiveis };
  }
  return { ok: true, itens: catalogoAtivo.filter((a) => vistos.has(a.id)) };
}

/** Resumo em uma frase para as telas: "Florzinhas e Colherzinha pequena". */
export function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

// --- cadastro no painel ---------------------------------------------------------------------------

const textoDoAdicional = (campo: string, max: number) =>
  z
    .string(`Informe ${campo}.`)
    .trim()
    .min(2, `Informe ${campo}.`)
    .max(max, `Use no máximo ${max} caracteres.`)
    // Uma linha só: sem tab nem quebra de linha.
    .refine((v) => textoLivreValido(v) && !/[\t\r\n]/.test(v), "Tem caracteres que não podem ser usados.");

/** Número do JSON ou do formulário multipart ("150"); vazio e booleano não viram número. */
const numeroDoCampo = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v), schema);

/** Edição de um item no painel (JSON ou multipart). O preço viaja em centavos inteiros; 0 = sem custo. */
export const adicionalAdminSchema = z.object({
  nome: textoDoAdicional("o nome", TAMANHO_MAX_NOME_ADICIONAL),
  descricao: textoDoAdicional("a descrição curta", TAMANHO_MAX_DESCRICAO_ADICIONAL),
  precoCentavos: numeroDoCampo(
    z
      .number("Informe o preço por potinho (0 = sem custo).")
      .int("Preço inválido.")
      .min(0, "O preço não pode ser negativo.")
      .max(MAX_PRECO_UNITARIO_CENTAVOS, `Preço máximo: ${formatarBRL(MAX_PRECO_UNITARIO_CENTAVOS / 100)}.`),
  ),
  ativo: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  ordem: numeroDoCampo(z.number("Informe a ordem.").int("A ordem é um número inteiro.").min(0, "A ordem não pode ser negativa.").max(MAX_ORDEM_ADICIONAL, `Ordem máxima: ${MAX_ORDEM_ADICIONAL}.`)),
  /** Voltar à ilustração padrão (apaga a foto enviada). Só vale sem foto nova. */
  removerFoto: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).optional(),
});

export type AdicionalAdminEntrada = z.output<typeof adicionalAdminSchema>;

/** Só mostrar/ocultar (o mesmo PATCH com o corpo `{ ativo }`). */
export const adicionalAtivoSchema = z.object({ ativo: z.boolean("Diga se o item está ativo.") });

/** Ids que a cliente marcou, na solicitação: sem repetidos (a API responde 400 em `adicionais`). */
export const idsDeAdicionaisSchema = z
  .array(z.string().min(1).max(100), "Itens adicionais inválidos.")
  .max(MAX_ADICIONAIS_POR_ENCOMENDA, `No máximo ${MAX_ADICIONAIS_POR_ENCOMENDA} itens adicionais.`)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Há itens adicionais repetidos. Marque cada item uma vez só." });
    }
  })
  .default([]);
