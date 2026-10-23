/**
 * Despesas da loja (tudo o que se gasta: frutas, potes, adesivos, frete…). Categorias, unidades,
 * leitura dos valores digitados e contas de mês. Módulo puro: usado no servidor e no navegador.
 */
import { formatarBRL, lerNumeroBrasileiro } from "@/lib/dinheiro";
import type { UnidadeInsumo } from "@/lib/producao";

export const CATEGORIAS_DESPESA = [
  "INGREDIENTES",
  "EMBALAGENS",
  "ROTULOS",
  "ENTREGA",
  "MARKETING",
  "EQUIPAMENTOS",
  "TAXAS",
  "OUTROS",
] as const;

export type CategoriaDespesa = (typeof CATEGORIAS_DESPESA)[number];

/** `Record<CategoriaDespesa, …>` obriga a cobrir toda categoria nova. */
export const ROTULO_CATEGORIA: Record<CategoriaDespesa, string> = {
  INGREDIENTES: "Ingredientes",
  EMBALAGENS: "Potes e embalagens",
  ROTULOS: "Rótulos e adesivos",
  ENTREGA: "Entrega e frete",
  MARKETING: "Divulgação",
  EQUIPAMENTOS: "Equipamentos e utensílios",
  TAXAS: "Taxas e impostos",
  OUTROS: "Outros",
};

/** Exemplos mostrados no formulário, para ajudar a escolher a categoria. */
export const EXEMPLOS_CATEGORIA: Record<CategoriaDespesa, string> = {
  INGREDIENTES: "frutas, açúcar, pectina, pimenta",
  EMBALAGENS: "potes, tampas, caixas, sacolas",
  ROTULOS: "rótulos, adesivos, lacres",
  ENTREGA: "frete, motoboy, combustível",
  MARKETING: "anúncios, panfletos, amostras",
  EQUIPAMENTOS: "panelas, termômetro, utensílios",
  TAXAS: "taxas do PIX e do cartão, DAS do MEI, impostos",
  OUTROS: "o que não se encaixa nas outras",
};

export const UNIDADES_DESPESA = ["UN", "KG", "G", "L", "ML", "PACOTE", "CAIXA", "METRO"] as const;

export type UnidadeDespesa = (typeof UNIDADES_DESPESA)[number];

/** Abreviação usada nas listas: "50 un", "2,5 kg". */
export const SIGLA_UNIDADE: Record<UnidadeDespesa, string> = {
  UN: "un",
  KG: "kg",
  G: "g",
  L: "L",
  ML: "mL",
  PACOTE: "pct",
  CAIXA: "cx",
  METRO: "m",
};

/** Nome por extenso, para a lista de escolha do formulário. */
export const NOME_UNIDADE: Record<UnidadeDespesa, string> = {
  UN: "unidades",
  KG: "quilos (kg)",
  G: "gramas (g)",
  L: "litros (L)",
  ML: "mililitros (mL)",
  PACOTE: "pacotes",
  CAIXA: "caixas",
  METRO: "metros",
};

export type DespesaDTO = {
  id: string;
  descricao: string;
  categoria: CategoriaDespesa;
  quantidade: number;
  unidade: UnidadeDespesa;
  /** Quanto foi pago no total, em reais (ex.: 20). */
  valorTotal: number;
  /** Dia da compra, "AAAA-MM-DD". */
  data: string;
  fornecedor: string | null;
  observacao: string | null;
  /** Compra de insumo: o que entrou no estoque da Produção (null = despesa comum). */
  insumo: { id: string; nome: string; unidade: UnidadeInsumo } | null;
  /** Quantidade que entrou no estoque, na unidade do insumo (2,155 kg → 2155 g). */
  quantidadeBase: number | null;
};

/** Visão de um mês no painel de despesas: o que entrou (vendas pagas), o que saiu e o saldo. */
export type PlannerMes = {
  /** "AAAA-MM" */
  mes: string;
  /** Hoje no horário de Brasília ("AAAA-MM-DD"): data padrão do formulário. */
  hoje: string;
  despesas: DespesaDTO[];
  /** true quando o mês tem mais lançamentos do que a lista traz. Os totais contam todos. */
  truncado: boolean;
  totalDespesas: number;
  lancamentos: number;
  /** Vendas pagas (Pago, Enviado, Entregue) criadas no mês, com frete. */
  entradas: number;
  pedidosPagos: number;
  saldo: number;
  /** Do maior gasto para o menor. */
  porCategoria: { categoria: CategoriaDespesa; total: number; lancamentos: number }[];
};

// --- leitura do que a pessoa digita ------------------------------------------

/**
 * "50" | "2,5" | "0,250" | "0.5" | "1.000" → 50 | 2.5 | 0.25 | 0.5 | 1000; inválido ou zero → null.
 * Até 3 casas decimais (gramas em quilos). "1.000" é mil, como se escreve no Brasil. A mesma regra
 * do valor (lerNumeroBrasileiro): o malformado ("1.2,5") é recusado, não adivinhado.
 */
export function lerQuantidade(texto: string): number | null {
  const partes = lerNumeroBrasileiro(texto, 3);
  if (!partes) return null;
  const n = Number(`${partes.inteiro}.${partes.decimal || "0"}`);
  return n > 0 ? n : null;
}

/** Quantidade no formato brasileiro, para pôr de volta no campo ao editar: 2.5 → "2,5". */
export function quantidadeParaCampo(q: number): string {
  return String(q).replace(".", ",");
}

// --- exibição ----------------------------------------------------------------

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** 50, "UN" → "50 un"; 2.5, "KG" → "2,5 kg". */
export function formatarQuantidade(q: number, unidade: UnidadeDespesa): string {
  return `${formatoQuantidade.format(q)} ${SIGLA_UNIDADE[unidade]}`;
}

const brlFino = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
// Para valores minúsculos (menos de 1 centavo): 2 algarismos significativos, nunca "R$ 0,00".
const brlMinimo = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumSignificantDigits: 2 });

/**
 * Quanto custou cada unidade: R$ 20,00 por 50 un → "R$ 0,40". Abaixo de R$ 1 mostra mais casas,
 * para não virar "R$ 0,00": R$ 7,00 por 1.000 g → "R$ 0,007"; R$ 1,00 por 100.000 → "R$ 0,00001".
 */
export function formatarCustoUnitario(valorTotal: number, quantidade: number): string | null {
  if (!(quantidade > 0) || !Number.isFinite(valorTotal)) return null;
  const unitario = valorTotal / quantidade;
  if (unitario >= 1 || unitario === 0) return formatarBRL(unitario);
  return unitario >= 0.01 ? brlFino.format(unitario) : brlMinimo.format(unitario);
}

/** "2026-10-16" → "16/10/2026". */
export function formatarDia(dia: string): string {
  const [ano, mes, d] = dia.split("-");
  return `${d}/${mes}/${ano}`;
}

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-10" → "outubro de 2026". */
export function nomeDoMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  return `${NOMES_MES[Number(numero) - 1]} de ${ano}`;
}

// --- contas de data (horário da loja, Teresina) ------------------------------

/**
 * Fuso da loja (Teresina-PI). Fortaleza e São Paulo dão o mesmo resultado em toda data desde 2019
 * (−03:00, sem horário de verão), mas se o horário de verão voltar ele vale só para o Sudeste:
 * Fortaleza segue o relógio do Piauí. Decisão da dona (D14, 2026-10-21).
 */
export const FUSO_LOJA = "America/Fortaleza";

/** Hoje no horário da loja, "AAAA-MM-DD". */
export function hojeNaLoja(agora = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_LOJA, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** "2026-10" + 3 → "2027-01"; "2026-01" − 1 → "2025-12". */
export function somarMeses(mes: string, delta: number): string {
  const [ano, numero] = mes.split("-").map(Number);
  const indice = ano * 12 + (numero - 1) + delta;
  const mesNovo = ((indice % 12) + 12) % 12;
  return `${String(Math.floor(indice / 12)).padStart(4, "0")}-${String(mesNovo + 1).padStart(2, "0")}`;
}

/** Primeiro mês com despesas aceitas (as datas valem de 2020 em diante). */
export const PRIMEIRO_MES = "2020-01";

/** Formato aceito para mês na API e na tela: "AAAA-MM", de 2020 a 2099 (fora disso é 400, não 500). */
export const PADRAO_MES = /^20[2-9]\d-(0[1-9]|1[0-2])$/;
