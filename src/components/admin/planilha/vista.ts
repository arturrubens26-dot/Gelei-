/**
 * O que a grade mostra: as linhas manuais (da fila de gravação) misturadas às vendas do sistema
 * agrupadas por dia e categoria ("Vendas no site · 07/11 · 3 pedidos"), na ordem escolhida e com
 * os filtros. E os totais do que está na tela. Puro; testado em testes/planilha-grade.test.ts.
 */
import type { CategoriaDTO, LinhaPlanilhaDTO, TipoLancamento } from "@/lib/planilha/tipos";
import type { LinhaGrade } from "./filaDeGravacao";
import { normalizar, type Campos } from "./modelo";

export type ColunaOrdenavel = "data" | "tipo" | "categoriaId" | "descricao" | "valorCentavos";
export type Ordem = { coluna: ColunaOrdenavel; direcao: "asc" | "desc" };
export const ORDEM_PADRAO: Ordem = { coluna: "data", direcao: "asc" };

export type Filtros = {
  tipo: TipoLancamento | null;
  /** Ids das categorias marcadas (vazio = todas). */
  categorias: readonly string[];
  /** Procura na descrição (sem acento nem maiúsculas). */
  busca: string;
  /** Mostrar as vendas do site, presenciais e mimos (as linhas automáticas). */
  automaticas: boolean;
};

export const FILTROS_PADRAO: Filtros = { tipo: null, categorias: [], busca: "", automaticas: true };

export type Grupo = {
  k: string;
  data: string;
  tipo: TipoLancamento;
  categoriaId: string;
  categoriaNome: string;
  itens: LinhaPlanilhaDTO[];
  valorCentavos: number;
  foraDoResultado: boolean;
};

export type ItemDaVista =
  | { tipo: "manual"; k: string; linha: LinhaGrade }
  | { tipo: "grupo"; k: string; grupo: Grupo; aberto: boolean }
  | { tipo: "auto"; k: string; dto: LinhaPlanilhaDTO; grupo: Grupo };

/** Vendas do sistema agrupadas por dia e categoria (ordenadas pelo código dentro do grupo). */
export function agruparAutomaticas(automaticas: readonly LinhaPlanilhaDTO[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const a of automaticas) {
    const k = `g:${a.data}:${a.categoriaId}`;
    const g = grupos.get(k) ?? {
      k,
      data: a.data,
      tipo: a.tipo,
      categoriaId: a.categoriaId,
      categoriaNome: a.categoriaNome,
      itens: [],
      valorCentavos: 0,
      foraDoResultado: a.foraDoResultado,
    };
    g.itens.push(a);
    g.valorCentavos += a.valorCentavos;
    grupos.set(k, g);
  }
  for (const g of grupos.values()) g.itens.sort((x, y) => (x.codigo ?? x.id).localeCompare(y.codigo ?? y.id));
  return [...grupos.values()];
}

type Chaveavel = { k: string; data: string; tipo: TipoLancamento | null; categoria: string; descricao: string; valor: number; criadoEm: string };

function comparar(a: Chaveavel, b: Chaveavel, ordem: Ordem): number {
  const sinal = ordem.direcao === "asc" ? 1 : -1;
  let r = 0;
  switch (ordem.coluna) {
    case "data":
      r = a.data.localeCompare(b.data);
      break;
    case "tipo":
      r = (a.tipo ?? "").localeCompare(b.tipo ?? "");
      break;
    case "categoriaId":
      r = a.categoria.localeCompare(b.categoria, "pt-BR");
      break;
    case "descricao":
      r = a.descricao.localeCompare(b.descricao, "pt-BR");
      break;
    case "valorCentavos":
      r = a.valor - b.valor;
      break;
  }
  // Empate: data e depois a ordem em que foram lançadas.
  return sinal * r || a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm);
}

const nomeDaCategoria = (categorias: readonly CategoriaDTO[], id: string | null) => categorias.find((c) => c.id === id)?.nome ?? "";

/**
 * A ordem das chaves (linhas manuais e grupos) num momento: a grade guarda essa lista e só refaz
 * ao carregar ou ao trocar a ordem. Assim a linha que ela está editando não pula de lugar no meio
 * da digitação (como no Excel, que só reordena quando se pede).
 */
export function ordenarChaves(linhas: readonly LinhaGrade[], grupos: readonly Grupo[], categorias: readonly CategoriaDTO[], ordem: Ordem): string[] {
  const itens: Chaveavel[] = [
    ...linhas
      .filter((l) => l.servidor || l.estado !== "nova")
      .map((l) => ({
        k: l.k,
        data: l.campos.data,
        tipo: l.campos.tipo,
        categoria: nomeDaCategoria(categorias, l.campos.categoriaId),
        descricao: l.campos.descricao,
        valor: l.campos.valorCentavos ?? 0,
        criadoEm: l.servidor?.criadoEm ?? "9999",
      })),
    ...grupos.map((g) => ({
      k: g.k,
      data: g.data,
      tipo: g.tipo,
      categoria: g.categoriaNome,
      descricao: "",
      valor: g.valorCentavos,
      criadoEm: "",
    })),
  ];
  return itens.sort((a, b) => comparar(a, b, ordem)).map((i) => i.k);
}

function passaManual(c: Campos, f: Filtros): boolean {
  if (f.tipo && c.tipo !== f.tipo) return false;
  if (f.categorias.length && (!c.categoriaId || !f.categorias.includes(c.categoriaId))) return false;
  if (f.busca.trim() && !normalizar(c.descricao).includes(normalizar(f.busca))) return false;
  return true;
}

function passaGrupo(g: Grupo, f: Filtros): boolean {
  if (!f.automaticas) return false;
  if (f.tipo && g.tipo !== f.tipo) return false;
  if (f.categorias.length && !f.categorias.includes(g.categoriaId)) return false;
  return true;
}

/** Itens do grupo que passam na busca (a busca olha a descrição de cada venda: "Pedido #A1B2"). */
function itensQuePassam(g: Grupo, f: Filtros) {
  return f.busca.trim() ? g.itens.filter((i) => normalizar(i.descricao).includes(normalizar(f.busca))) : g.itens;
}

/**
 * Monta a lista da tela: segue `ordem` (as chaves guardadas); o que não está nela (linhas novas
 * digitadas depois) vai para o fim, antes da linha vazia. Linha que não passa no filtro some,
 * menos a que está sendo mexida (com algo por salvar, erro ou foco): sumir no meio da edição confunde.
 */
export function montarVista(args: {
  linhas: readonly LinhaGrade[];
  grupos: readonly Grupo[];
  ordem: readonly string[];
  filtros: Filtros;
  abertos: ReadonlySet<string>;
  focada: string | null;
}): ItemDaVista[] {
  const { linhas, grupos, ordem, filtros, abertos, focada } = args;
  const porK = new Map<string, LinhaGrade>(linhas.map((l) => [l.k, l]));
  const gruposPorK = new Map(grupos.map((g) => [g.k, g]));
  const vistos = new Set<string>();
  const saida: ItemDaVista[] = [];

  const porLinha = (l: LinhaGrade) => {
    vistos.add(l.k);
    if (l.excluindo || l.estado === "nova") return;
    const mexendo = l.k === focada || l.estado !== "salva";
    if (mexendo || passaManual(l.campos, filtros)) saida.push({ tipo: "manual", k: l.k, linha: l });
  };
  const porGrupo = (g: Grupo) => {
    vistos.add(g.k);
    if (!passaGrupo(g, filtros)) return;
    const itens = itensQuePassam(g, filtros);
    if (!itens.length) return;
    const filtrado: Grupo = itens.length === g.itens.length ? g : { ...g, itens, valorCentavos: itens.reduce((s, i) => s + i.valorCentavos, 0) };
    const aberto = abertos.has(g.k);
    saida.push({ tipo: "grupo", k: g.k, grupo: filtrado, aberto });
    if (aberto) for (const dto of filtrado.itens) saida.push({ tipo: "auto", k: `a:${dto.id}`, dto, grupo: filtrado });
  };

  for (const k of ordem) {
    const l = porK.get(k);
    if (l) porLinha(l);
    else {
      const g = gruposPorK.get(k);
      if (g) porGrupo(g);
    }
  }
  for (const g of grupos) if (!vistos.has(g.k)) porGrupo(g);
  for (const l of linhas) if (!vistos.has(l.k)) porLinha(l);
  // A linha vazia do fim (para começar um lançamento novo) sempre aparece.
  const vazia = linhas.at(-1);
  if (vazia && vazia.estado === "nova") saida.push({ tipo: "manual", k: vazia.k, linha: vazia });
  return saida;
}

export type Totais = {
  entradas: number;
  saidas: number;
  resultado: number;
  foraEntradas: number;
  foraSaidas: number;
  /** Tudo o que entrou − tudo o que saiu (mexe no saldo). */
  movimento: number;
  linhas: number;
};

/**
 * Totais do que está na tela (em centavos), dentro do período: "Entradas" e "Saídas" sem aporte e
 * retirada (foraDoResultado), que aparecem à parte. Grupos fechados contam inteiros.
 */
export function totaisDaVista(itens: readonly ItemDaVista[], categorias: readonly CategoriaDTO[], periodo: { de: string; ate: string }): Totais {
  const t: Totais = { entradas: 0, saidas: 0, resultado: 0, foraEntradas: 0, foraSaidas: 0, movimento: 0, linhas: 0 };
  const fora = new Set(categorias.filter((c) => c.foraDoResultado).map((c) => c.id));
  const somar = (tipo: TipoLancamento | null, valor: number | null, categoriaId: string | null, data: string, foraDoResultado?: boolean) => {
    if (!tipo || valor === null || data < periodo.de || data > periodo.ate) return;
    const ehFora = foraDoResultado ?? (categoriaId ? fora.has(categoriaId) : false);
    t.linhas += 1;
    if (tipo === "ENTRADA") {
      t.movimento += valor;
      if (ehFora) t.foraEntradas += valor;
      else t.entradas += valor;
    } else {
      t.movimento -= valor;
      if (ehFora) t.foraSaidas += valor;
      else t.saidas += valor;
    }
  };
  for (const i of itens) {
    if (i.tipo === "manual") somar(i.linha.campos.tipo, i.linha.campos.valorCentavos, i.linha.campos.categoriaId, i.linha.campos.data);
    else if (i.tipo === "grupo") for (const a of i.grupo.itens) somar(a.tipo, a.valorCentavos, a.categoriaId, a.data, a.foraDoResultado);
  }
  t.resultado = t.entradas - t.saidas;
  return t;
}
