/**
 * Produção de geleia: insumos (ingredientes e embalagens), estoque e o custo de cada lote.
 * Módulo puro (servidor e navegador): unidades, conversões, contas e formatação.
 *
 * Como o caderno: o custo de cada ingrediente usado é proporcional ao que se pagou por ele
 * (2,155 kg de maçã por R$ 15,06 → 500 g custam R$ 3,49). Com várias compras, vale o custo médio.
 * Custo por pote = (ingredientes + custos da produção) ÷ potes + embalagem de cada pote.
 */
import { formatarBRL } from "@/lib/dinheiro";
import type { UnidadeDespesa } from "@/lib/despesas";

export const UNIDADES_INSUMO = ["G", "ML", "UN"] as const;
export type UnidadeInsumo = (typeof UNIDADES_INSUMO)[number];

export const TIPOS_INSUMO = ["INGREDIENTE", "EMBALAGEM"] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export const SIGLA_INSUMO: Record<UnidadeInsumo, string> = { G: "g", ML: "mL", UN: "un" };
export const NOME_UNIDADE_INSUMO: Record<UnidadeInsumo, string> = {
  G: "gramas (g)",
  ML: "mililitros (mL)",
  UN: "unidades",
};
export const ROTULO_TIPO_INSUMO: Record<TipoInsumo, string> = {
  INGREDIENTE: "Ingrediente",
  EMBALAGEM: "Embalagem (pote, tampa, rótulo…)",
};

/** Custos da produção que não são insumo de estoque (como no caderno). Sugeridos na 1ª produção. */
export const CUSTOS_PADRAO = ["Gás", "Energia", "Água", "Mão de obra"] as const;

/**
 * Quanto vale 1 unidade da despesa na unidade do insumo: kg → g (1000), L → mL (1000), un → un (1).
 * `null` quando não há conversão certa (pacote, caixa, metro ou unidade incompatível): aí a pessoa
 * informa quanto veio ("o pacote tinha 1.000 g").
 */
export function fatorConversao(deDespesa: UnidadeDespesa, paraInsumo: UnidadeInsumo): number | null {
  const tabela: Partial<Record<UnidadeDespesa, Partial<Record<UnidadeInsumo, number>>>> = {
    KG: { G: 1000 },
    G: { G: 1 },
    L: { ML: 1000 },
    ML: { ML: 1 },
    UN: { UN: 1 },
  };
  return tabela[deDespesa]?.[paraInsumo] ?? null;
}

// --- estoque ------------------------------------------------------------------

export type InsumoDTO = {
  id: string;
  nome: string;
  tipo: TipoInsumo;
  unidade: UnidadeInsumo;
  /** Avisar abaixo disto (unidade do insumo). */
  estoqueMinimo: number | null;
  /**
   * false = não controla estoque (limão do quintal, água da torneira): entra na produção com o custo
   * informado (pode ser zero) e nunca aparece como "falta" no estoque.
   */
  controlaEstoque: boolean;
  ativo: boolean;
  /** Somas na unidade do insumo. */
  comprado: number;
  usado: number;
  /** Ajustes manuais (perda, recontagem): positivo entra, negativo sai. */
  ajustado: number;
  /** comprado − usado + ajustado. Negativo = usou mais do que comprou (falta lançar compra). */
  sobra: number;
  /** R$ por unidade do insumo (média das compras). null = nenhuma compra lançada. */
  custoMedio: number | null;
  /** Total pago nas compras. */
  totalComprado: number;
  /** sobra × custo médio (só quando a sobra é positiva e há custo). */
  valorEmEstoque: number;
  /** Tem compra, uso ou ajuste? (Aí a unidade não pode mais mudar.) */
  temMovimento: boolean;
};

/**
 * Monta a linha do estoque a partir das somas do banco. Insumo sem controle de estoque não tem
 * valor parado (a tela mostra "—"; sem isso, uma compra antiga dele entrava no total).
 */
export function linhaDeEstoque(
  base: { comprado: number; totalComprado: number; usado: number; ajustado: number },
  controlaEstoque = true,
): Pick<InsumoDTO, "sobra" | "custoMedio" | "valorEmEstoque"> {
  const sobra = arredondarQtd(base.comprado - base.usado + base.ajustado);
  const custoMedio = base.comprado > 0 ? base.totalComprado / base.comprado : null;
  const valorEmEstoque = controlaEstoque && custoMedio !== null && sobra > 0 ? centavos(sobra * custoMedio) : 0;
  return { sobra, custoMedio, valorEmEstoque };
}

export type SituacaoEstoque = "ok" | "baixo" | "acabou" | "negativo" | "sem-controle";

export function situacaoDoEstoque(i: Pick<InsumoDTO, "sobra" | "estoqueMinimo" | "controlaEstoque">): SituacaoEstoque {
  if (!i.controlaEstoque) return "sem-controle";
  if (i.sobra < 0) return "negativo";
  if (i.sobra === 0) return "acabou";
  if (i.estoqueMinimo !== null && i.sobra < i.estoqueMinimo) return "baixo";
  return "ok";
}

// --- produção (lote) ---------------------------------------------------------------

export type ItemDeProducao = {
  insumoId: string;
  nome: string;
  tipo: TipoInsumo;
  unidade: UnidadeInsumo;
  quantidade: number;
  /** R$ por unidade do insumo, congelado no dia da produção (compras depois não mudam o lote). */
  custoUnitario: number;
};

export type CustoDeProducao = { descricao: string; valor: number };

export type TotaisDeProducao = {
  ingredientes: number;
  embalagens: number;
  extras: number;
  total: number;
  /** (ingredientes + extras) ÷ potes: a "geleia" de cada pote, como no caderno. */
  geleiaPorPote: number | null;
  /** embalagens ÷ potes. */
  embalagemPorPote: number | null;
  /** total ÷ potes: custo de cada pote pronto. */
  porPote: number | null;
  /** Preço de venda do sabor (catálogo), se houver. */
  precoVenda: number | null;
  /** precoVenda − porPote. */
  margemPorPote: number | null;
  /** margemPorPote ÷ precoVenda. */
  margemPct: number | null;
  /**
   * precoVenda × potes − total: quanto o lote rende se todos os potes forem vendidos. Não é
   * margemPorPote × potes, que multiplicaria o arredondamento do custo por pote (R$ 132,72 em vez
   * de R$ 132,74 na Receita 1).
   */
  lucroDoLote: number | null;
};

/** Custo de um item: quantidade × custo unitário, em reais (2 casas). */
export const custoDoItem = (i: Pick<ItemDeProducao, "quantidade" | "custoUnitario">) => centavos(i.quantidade * i.custoUnitario);

export function totaisDaProducao(
  itens: Pick<ItemDeProducao, "tipo" | "quantidade" | "custoUnitario">[],
  custos: CustoDeProducao[],
  potes: number,
  precoVenda: number | null,
): TotaisDeProducao {
  const soma = (tipo: TipoInsumo) => centavos(itens.filter((i) => i.tipo === tipo).reduce((s, i) => s + custoDoItem(i), 0));
  const ingredientes = soma("INGREDIENTE");
  const embalagens = soma("EMBALAGEM");
  const extras = centavos(custos.reduce((s, c) => s + c.valor, 0));
  const total = centavos(ingredientes + embalagens + extras);
  const temPotes = potes > 0;
  const porPote = temPotes ? centavos(total / potes) : null;
  const geleiaPorPote = temPotes ? centavos((ingredientes + extras) / potes) : null;
  const margemPorPote = porPote !== null && precoVenda !== null ? centavos(precoVenda - porPote) : null;
  return {
    ingredientes,
    embalagens,
    extras,
    total,
    geleiaPorPote,
    // O que falta para o custo por pote: "geleia + embalagem" sempre fecha com ele na tela.
    embalagemPorPote: porPote !== null && geleiaPorPote !== null ? centavos(porPote - geleiaPorPote) : null,
    porPote,
    precoVenda,
    margemPorPote,
    margemPct: margemPorPote !== null && precoVenda ? margemPorPote / precoVenda : null,
    lucroDoLote: temPotes && precoVenda !== null ? centavos(precoVenda * potes - total) : null,
  };
}

// --- arredondamento e formatação -----------------------------------------------------

/** Reais com 2 casas, sem o erro do float (0,1 + 0,2). */
export const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
/** Quantidades com até 3 casas (o banco guarda DECIMAL(14,3)). */
export const arredondarQtd = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** 1655, "G" → "1,655 kg"; 650 → "650 g"; 7, "UN" → "7 un"; 1500, "ML" → "1,5 L". */
export function formatarQtdInsumo(q: number, unidade: UnidadeInsumo): string {
  const negativo = q < 0;
  const abs = Math.abs(q);
  let texto: string;
  if (unidade === "G" && abs >= 1000) texto = `${numero.format(abs / 1000)} kg`;
  else if (unidade === "ML" && abs >= 1000) texto = `${numero.format(abs / 1000)} L`;
  else texto = `${numero.format(abs)} ${SIGLA_INSUMO[unidade]}`;
  return negativo ? `−${texto}` : texto;
}

/** Custo médio legível: por kg (g), por litro (mL) ou por unidade. 0,00699/g → "R$ 6,99/kg". */
export function formatarCustoMedio(custoPorUnidade: number | null, unidade: UnidadeInsumo): string {
  if (custoPorUnidade === null) return "—";
  if (unidade === "G") return `${formatarBRL(custoPorUnidade * 1000)}/kg`;
  if (unidade === "ML") return `${formatarBRL(custoPorUnidade * 1000)}/L`;
  return `${formatarBRL(custoPorUnidade)}/un`;
}

const porcentagem = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
export const formatarPorcentagem = (v: number) => porcentagem.format(v);

// --- planilha (CSV para o Excel) ------------------------------------------------------

/**
 * CSV no formato que o Excel brasileiro abre direto: separador ";", vírgula decimal, BOM UTF-8
 * (acentos certos) e aspas só quando precisa. Texto que começa com = + - @ (ou tab/CR) o Excel
 * executaria como fórmula (um nome de insumo "=HYPERLINK(…)"): ganha um apóstrofo na frente.
 * Números não, para continuarem números (a sobra negativa inclusive).
 */
export function gerarCsv(cabecalho: string[], linhas: (string | number | null)[][]): string {
  const celula = (v: string | number | null) => {
    if (v === null) return "";
    const texto = typeof v === "number" ? String(v).replace(".", ",") : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}
