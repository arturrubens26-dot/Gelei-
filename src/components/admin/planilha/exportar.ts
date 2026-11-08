/**
 * Exportar a planilha: monta as abas (puro, testado em testes/planilha-grade.test.ts) e gera o
 * .xlsx no navegador com o SheetJS 0.20.3 (vendor/), carregado só no clique. Só valores, sem
 * fórmulas; texto sempre como texto (um "=HYPERLINK(…)" digitado fica texto). Sem nome de cliente,
 * a não ser que ela marque (LGPD, decisão D8).
 */
import { gerarCsv } from "@/lib/producao";
import { ROTULO_CATEGORIA } from "@/lib/despesas";
import { ROTULO_FORMA_PAGAMENTO } from "@/lib/vendas";
import { diaParaSerieExcel, nomeDiaDaSemana, resultadoDiario } from "@/lib/planilha/regras";
import type { CategoriaDTO, LancamentosDoPeriodoDTO, LinhaPlanilhaDTO, Origem } from "@/lib/planilha/tipos";
import { formatarData } from "./modelo";

export type Celula = string | number | null | { data: string } | { centavos: number } | { fracao: number };

export type AbaExportada = { nome: string; cabecalho: string[]; linhas: Celula[][]; larguras: number[]; filtro?: boolean };

export const ROTULO_ORIGEM: Record<Origem, string> = {
  "manual-saida": "Lançada à mão",
  "manual-entrada": "Lançada à mão",
  site: "Venda no site",
  presencial: "Venda presencial",
  "mimos-entrada": "Mimos (entrada)",
  "mimos-restante": "Mimos (restante)",
  "mimos-devolucao": "Devolução de mimos",
};

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-11" → "nov/2026". */
const rotuloMes = (mes: string) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;

const ehFora = (l: LinhaPlanilhaDTO) => l.foraDoResultado;

/** Monta as abas do arquivo a partir do que a API devolve para o período. */
export function montarAbas(dados: LancamentosDoPeriodoDTO, comNomes: boolean): AbaExportada[] {
  const linhas = [...dados.linhas].sort((a, b) => a.data.localeCompare(b.data) || (a.criadoEm ?? "").localeCompare(b.criadoEm ?? ""));

  // 1. Lançamentos: uma linha por lançamento, como a guia "Base" da planilha dela.
  const cabecalho = ["Data", "Tipo", "Categoria", "Descrição", "Valor", "Forma de pagamento", "Observação", "Origem", "Código", ...(comNomes ? ["Cliente"] : [])];
  const lancamentos: AbaExportada = {
    nome: "Lançamentos",
    cabecalho,
    filtro: true,
    larguras: [12, 9, 26, 40, 14, 18, 30, 20, 11, ...(comNomes ? [26] : [])],
    linhas: linhas.map((l) => [
      { data: l.data },
      l.tipo === "ENTRADA" ? "Entrada" : "Saída",
      l.categoriaNome,
      l.descricao,
      { centavos: l.valorCentavos },
      l.formaPagamento ? ROTULO_FORMA_PAGAMENTO[l.formaPagamento] : "",
      l.observacao ?? "",
      ROTULO_ORIGEM[l.origem],
      l.codigo ?? "",
      ...(comNomes ? [l.cliente ?? ""] : []),
    ]),
  };

  // 2. Resumo mensal: entradas e saídas do lucro, o que fica fora dele (aporte, retirada) e o caixa.
  const meses = new Map<string, { e: number; s: number; fe: number; fs: number }>();
  for (const l of linhas) {
    const m = meses.get(l.data.slice(0, 7)) ?? { e: 0, s: 0, fe: 0, fs: 0 };
    const fora = ehFora(l);
    if (l.tipo === "ENTRADA") {
      if (fora) m.fe += l.valorCentavos;
      else m.e += l.valorCentavos;
    } else if (fora) m.fs += l.valorCentavos;
    else m.s += l.valorCentavos;
    meses.set(l.data.slice(0, 7), m);
  }
  const linhaMes = (rotulo: string, m: { e: number; s: number; fe: number; fs: number }): Celula[] => [
    rotulo,
    { centavos: m.e },
    { centavos: m.s },
    { centavos: m.e - m.s },
    { centavos: m.fe },
    { centavos: m.fs },
    { centavos: m.e + m.fe - m.s - m.fs },
  ];
  const somaMeses = [...meses.values()].reduce((t, m) => ({ e: t.e + m.e, s: t.s + m.s, fe: t.fe + m.fe, fs: t.fs + m.fs }), { e: 0, s: 0, fe: 0, fs: 0 });
  const resumo: AbaExportada = {
    nome: "Resumo mensal",
    cabecalho: ["Mês", "Entradas", "Saídas", "Resultado (lucro)", "Aportes (fora do lucro)", "Retiradas (fora do lucro)", "Movimento do caixa"],
    larguras: [12, 15, 15, 17, 22, 24, 19],
    linhas: [...[...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, m]) => linhaMes(rotuloMes(mes), m)), linhaMes("Total", somaMeses)],
  };

  // 3. Por categoria (a tabela dinâmica do exemplo): soma, quantidade e % dentro do tipo.
  const porCategoria = new Map<string, { tipo: string; nome: string; fora: boolean; n: number; total: number }>();
  for (const l of linhas) {
    const k = `${l.tipo}|${l.categoriaId}`;
    const c = porCategoria.get(k) ?? { tipo: l.tipo, nome: l.categoriaNome, fora: l.foraDoResultado, n: 0, total: 0 };
    c.n += 1;
    c.total += l.valorCentavos;
    porCategoria.set(k, c);
  }
  const totalDoTipo = (tipo: string) => [...porCategoria.values()].filter((c) => c.tipo === tipo).reduce((s, c) => s + c.total, 0);
  const categorias: AbaExportada = {
    nome: "Por categoria",
    cabecalho: ["Tipo", "Categoria", "Lançamentos", "Total", "% do tipo", "Fora do lucro"],
    larguras: [9, 30, 13, 15, 11, 14],
    filtro: true,
    linhas: [...porCategoria.values()]
      .sort((a, b) => a.tipo.localeCompare(b.tipo) || b.total - a.total)
      .map((c) => {
        const t = totalDoTipo(c.tipo);
        return [c.tipo === "ENTRADA" ? "Entrada" : "Saída", c.nome, c.n, { centavos: c.total }, t ? { fracao: c.total / t } : null, c.fora ? "Sim" : "Não"];
      }),
  };

  // 4. Resultado diário, com o saldo em caixa acumulado (do saldo inicial, se configurado).
  const movimento = linhas.reduce((s, l) => s + (l.tipo === "ENTRADA" ? l.valorCentavos : -l.valorCentavos), 0);
  const saldoAntes = dados.saldo.noFimCentavos === null ? 0 : dados.saldo.noFimCentavos - movimento;
  const diario: AbaExportada = {
    nome: "Resultado diário",
    cabecalho: ["Dia", "Dia da semana", "Entradas", "Saídas", "Saldo do dia", dados.saldo.noFimCentavos === null ? "Acumulado no período" : "Saldo em caixa"],
    larguras: [12, 14, 15, 15, 15, 18],
    linhas: resultadoDiario(
      linhas.map((l) => ({ data: l.data, tipo: l.tipo, valorCentavos: l.valorCentavos })),
      dados.de,
      dados.ate < dados.hoje ? dados.ate : dados.hoje,
      saldoAntes,
    ).map((d) => [
      { data: d.data },
      nomeDiaDaSemana(d.data),
      { centavos: d.entradasCentavos },
      { centavos: d.saidasCentavos },
      { centavos: d.saldoDoDiaCentavos },
      { centavos: d.acumuladoCentavos },
    ]),
  };

  // 5. Categorias (a guia "Auxiliar"), para consulta.
  const lista: AbaExportada = {
    nome: "Categorias",
    cabecalho: ["Tipo", "Categoria", "Grupo do relatório", "Fora do lucro", "Situação"],
    larguras: [9, 32, 26, 14, 14],
    linhas: dados.categorias.map((c: CategoriaDTO) => [
      c.tipo === "ENTRADA" ? "Entrada" : "Saída",
      c.nome,
      c.grupo ? ROTULO_CATEGORIA[c.grupo] : c.sistema ? "Automática (vendas)" : "",
      c.foraDoResultado ? "Sim" : "Não",
      c.sistema ? "Do sistema" : c.ativo ? "Ativa" : "Desativada",
    ]),
  };

  return [lancamentos, resumo, categorias, diario, lista];
}

/** "geleio-financeiro-2026-11" (mês inteiro) ou "geleio-financeiro-2026-10-01-a-2026-11-15". */
export function nomeDoArquivo(de: string, ate: string): string {
  const mes = de.slice(0, 7);
  const ultimo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
  return de.endsWith("-01") && ate === `${mes}-${String(ultimo).padStart(2, "0")}` ? `geleio-financeiro-${mes}` : `geleio-financeiro-${de}-a-${ate}`;
}

const FORMATO_REAL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

type CelulaSheetJs = { t: "s" | "n" | "z"; v?: string | number; z?: string };

/** Uma célula no formato do SheetJS: data como data de verdade, dinheiro como número com R$. */
export function celulaSheetJs(c: Celula): CelulaSheetJs {
  if (c === null) return { t: "z" };
  if (typeof c === "string") return { t: "s", v: c };
  if (typeof c === "number") return { t: "n", v: c };
  if ("data" in c) return { t: "n", v: diaParaSerieExcel(c.data), z: "dd/mm/yyyy" };
  if ("centavos" in c) return { t: "n", v: c.centavos / 100, z: FORMATO_REAL };
  return { t: "n", v: c.fracao, z: "0.0%" };
}

type SheetJs = typeof import("xlsx");

/** Monta o arquivo .xlsx (bytes). Recebe o módulo do SheetJS (no navegador, carregado no clique). */
export function gerarXlsx(XLSX: SheetJs, abas: readonly AbaExportada[]): Uint8Array {
  const livro = XLSX.utils.book_new();
  for (const aba of abas) {
    // Célula vazia (null) não entra: o Excel a mostra em branco.
    const folha = XLSX.utils.aoa_to_sheet([
      aba.cabecalho.map((t) => ({ t: "s", v: t })),
      ...aba.linhas.map((l) => l.map((c) => (c === null ? undefined : celulaSheetJs(c)))),
    ]);
    folha["!cols"] = aba.larguras.map((wch) => ({ wch }));
    if (aba.filtro && aba.linhas.length) {
      folha["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aba.linhas.length, c: aba.cabecalho.length - 1 } }) };
    }
    XLSX.utils.book_append_sheet(livro, folha, aba.nome);
  }
  livro.Props = { Title: "Financeiro da Geleiô", Author: "Geleiô" };
  return XLSX.write(livro, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array;
}

/** CSV da aba Lançamentos (abre no Excel: ";", vírgula decimal, fórmulas neutralizadas). */
export function gerarCsvLancamentos(abas: readonly AbaExportada[]): string {
  const aba = abas[0];
  const simples = (c: Celula): string | number | null => {
    if (c === null || typeof c === "string" || typeof c === "number") return c;
    if ("data" in c) return formatarData(c.data);
    if ("centavos" in c) return c.centavos / 100;
    return Math.round(c.fracao * 1000) / 10;
  };
  return gerarCsv(aba.cabecalho, aba.linhas.map((l) => l.map(simples)));
}

/** Baixa bytes como arquivo (no navegador, em resposta a um clique). */
export function baixar(nome: string, conteudo: BlobPart, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
