/**
 * Colar do Excel (Ctrl+V na grade): o texto TSV vira alterações nas linhas a partir da célula
 * focada e linhas novas além do fim. Se a 1ª linha parece cabeçalho (Data, Valor, Categoria…), as
 * colunas são casadas pelo nome; senão, pela posição a partir da coluna focada. Puro; testado em
 * testes/planilha-grade.test.ts. As regras de leitura (datas dia/mês, valores, TSV) são as da API.
 */
import {
  casarCategoria,
  lerFormaPagamento,
  lerTipo,
  lerTsv,
  mapearColunas,
  mapearPorPosicao,
  pareceCabecalho,
  type CampoPlanilha,
} from "@/lib/planilha/regras";
import type { CategoriaDTO, TipoLancamento } from "@/lib/planilha/tipos";
import { faltando, lerData, lerValor, listarFaltando, type CampoId, type Campos } from "./modelo";
import type { ItemDaVista } from "./vista";

/** Mais que isso não é colagem, é importação (fase 3). */
export const MAX_LINHAS_COLADAS = 1000;

const CAMPO_DA_COLUNA: Partial<Record<CampoId, CampoPlanilha>> = {
  data: "data",
  tipo: "tipo",
  categoriaId: "categoria",
  descricao: "descricao",
  valorCentavos: "valor",
  formaPagamento: "forma",
  observacao: "observacao",
};

export type LinhaColada = {
  /** Número da linha no texto colado (1 = primeira de dados). */
  origem: number;
  /** Linha da grade que muda (null = linha nova). */
  k: string | null;
  campos: Partial<Campos>;
  /** Categorias digitadas que não existem (criar ou trocar por "Outros"). */
  categoriaNova: { nome: string; tipo: TipoLancamento } | null;
  erros: string[];
};

export type PreviaColagem = {
  linhas: LinhaColada[];
  novas: number;
  alteradas: number;
  comErro: number;
  /** Linhas automáticas (vendas) no caminho: não se colam por cima delas. */
  puladas: number;
  cabecalho: boolean;
  /** Nomes de categoria que não existem, por tipo. */
  categoriasNovas: { nome: string; tipo: TipoLancamento }[];
  erroGeral: string | null;
};

const vazia = (t: string) => !t.trim();

/**
 * Lê o texto colado e diz o que vai acontecer (sem mudar nada).
 * `colunasDaGrade`: ids das colunas visíveis, na ordem; `inicio`: célula focada.
 */
export function prepararColagem(args: {
  texto: string;
  colunasDaGrade: readonly CampoId[];
  inicio: { k: string; coluna: number };
  itens: readonly ItemDaVista[];
  categorias: readonly CategoriaDTO[];
  hoje: string;
  /** Linha nova precisa vir completa (colagem de várias linhas). Uma célula só: não. */
  exigirCompletas?: boolean;
}): PreviaColagem {
  const { texto, colunasDaGrade, inicio, itens, categorias, hoje, exigirCompletas = true } = args;
  const base: PreviaColagem = { linhas: [], novas: 0, alteradas: 0, comErro: 0, puladas: 0, cabecalho: false, categoriasNovas: [], erroGeral: null };
  const tabela = lerTsv(texto);
  if (!tabela.length) return { ...base, erroGeral: "Não havia nada para colar." };

  const cabecalho = pareceCabecalho(tabela[0]);
  const dados = cabecalho ? tabela.slice(1) : tabela;
  if (dados.length > MAX_LINHAS_COLADAS) {
    return { ...base, cabecalho, erroGeral: `São ${dados.length} linhas: cole no máximo ${MAX_LINHAS_COLADAS} de cada vez.` };
  }
  const largura = Math.max(...tabela.map((l) => l.length));
  let mapa: Partial<Record<CampoPlanilha, number>>;
  if (cabecalho) mapa = mapearColunas(tabela[0]);
  else {
    // Pela posição: as colunas visíveis que existem no Excel, a partir da focada.
    const ordem = colunasDaGrade.map((c) => CAMPO_DA_COLUNA[c]).filter((c): c is CampoPlanilha => !!c);
    const focada = CAMPO_DA_COLUNA[colunasDaGrade[inicio.coluna]];
    const posicao = focada ? ordem.indexOf(focada) : 0;
    mapa = mapearPorPosicao(ordem, Math.max(posicao, 0), largura);
  }
  if (!Object.keys(mapa).length) return { ...base, cabecalho, erroGeral: "Não reconheci as colunas do que foi colado." };

  // Linhas da grade que recebem a colagem: as manuais a partir da focada, pulando as automáticas.
  const indiceInicio = Math.max(0, itens.findIndex((i) => i.k === inicio.k));
  const alvos: (string | null)[] = [];
  let puladas = 0;
  let j = indiceInicio;
  // Com cabeçalho, as linhas sempre entram como novas (é uma lista vinda de fora).
  for (let n = 0; n < dados.length; n++) {
    if (cabecalho) {
      alvos.push(null);
      continue;
    }
    while (j < itens.length && itens[j].tipo !== "manual") {
      puladas++;
      j++;
    }
    const item = itens[j];
    if (!item || item.tipo !== "manual" || item.linha.estado === "nova") alvos.push(null);
    else {
      alvos.push(item.k);
      j++;
    }
  }

  const novasCategorias = new Map<string, { nome: string; tipo: TipoLancamento }>();
  const linhas: LinhaColada[] = dados.map((celulas, i) => {
    const k = alvos[i];
    const atual = k ? itens.find((x) => x.k === k && x.tipo === "manual") : null;
    const camposAtuais = atual && atual.tipo === "manual" ? atual.linha.campos : null;
    const campos: Partial<Campos> = {};
    const erros: string[] = [];
    const pegar = (campo: CampoPlanilha) => {
      const indice = mapa[campo];
      return indice === undefined ? null : (celulas[indice] ?? "");
    };

    const tTipo = pegar("tipo");
    if (tTipo !== null && !vazia(tTipo)) {
      const tipo = lerTipo(tTipo);
      if (tipo) campos.tipo = tipo;
      else erros.push(`tipo “${tTipo.trim()}” (use Entrada ou Saída)`);
    }
    const tValor = pegar("valor");
    if (tValor !== null && !vazia(tValor)) {
      const r = lerValor(tValor);
      if (!r.ok) erros.push(`valor “${tValor.trim()}”`);
      else {
        campos.valorCentavos = r.valor.centavos;
        if (r.valor.negativo && !campos.tipo) {
          if ((camposAtuais?.tipo ?? null) === "ENTRADA") erros.push("valor negativo numa entrada");
          else campos.tipo = "SAIDA";
        }
      }
    }
    const tData = pegar("data");
    if (tData !== null && !vazia(tData)) {
      const r = lerData(tData, hoje);
      if (r.ok) campos.data = r.valor;
      else erros.push(`data “${tData.trim()}”: ${r.erro}`);
    }
    let categoriaNova: LinhaColada["categoriaNova"] = null;
    const tCategoria = pegar("categoria");
    if (tCategoria !== null && !vazia(tCategoria)) {
      const tipo = campos.tipo ?? camposAtuais?.tipo ?? null;
      const nome = tCategoria.replace(/\s+/g, " ").trim();
      const achada = tipo
        ? casarCategoria(nome, tipo, categorias.filter((c) => !c.sistema))
        : (casarCategoria(nome, "SAIDA", categorias.filter((c) => !c.sistema)) ?? casarCategoria(nome, "ENTRADA", categorias.filter((c) => !c.sistema)));
      if (achada && !achada.ativo) {
        erros.push(`a categoria “${achada.nome}” está desativada (ative na aba Auxiliar)`);
      } else if (achada) {
        campos.categoriaId = achada.id;
        if (!tipo) campos.tipo = achada.tipo;
      } else if (tipo) {
        categoriaNova = { nome: nome.slice(0, 40), tipo };
        novasCategorias.set(`${tipo}|${nome.toLowerCase()}`, categoriaNova);
      } else erros.push(`categoria “${nome}” sem tipo (informe Entrada ou Saída)`);
    }
    const tDescricao = pegar("descricao");
    if (tDescricao !== null) {
      const d = tDescricao.replace(/\s+/g, " ").trim();
      if (d.length > 120) erros.push("descrição com mais de 120 letras");
      else if (d || k) campos.descricao = d;
    }
    const tObs = pegar("observacao");
    if (tObs !== null) {
      const o = tObs.trim();
      if (o.length > 300) erros.push("observação com mais de 300 letras");
      else campos.observacao = o;
    }
    const tForma = pegar("forma");
    if (tForma !== null) {
      if (vazia(tForma)) campos.formaPagamento = null;
      else {
        const f = lerFormaPagamento(tForma);
        if (f) campos.formaPagamento = f;
        else erros.push(`forma “${tForma.trim()}”`);
      }
    }

    // Linha nova precisa ficar completa (a data, se faltar, é herdada da linha de cima ao colar).
    if (!k && !erros.length && exigirCompletas) {
      const juntos = { data: "herdada", tipo: null, categoriaId: null, valorCentavos: null, ...campos } as Campos;
      const falta = faltando({ ...juntos, categoriaId: juntos.categoriaId ?? (categoriaNova ? "nova" : null) }).filter((c) => c !== "data");
      if (falta.length) erros.push(`falta ${listarFaltando(falta)}`);
    }
    return { origem: i + 1, k, campos, categoriaNova, erros };
  });

  return {
    linhas,
    novas: linhas.filter((l) => !l.k && !l.erros.length).length,
    alteradas: linhas.filter((l) => l.k && !l.erros.length).length,
    comErro: linhas.filter((l) => l.erros.length).length,
    puladas,
    cabecalho,
    categoriasNovas: [...novasCategorias.values()],
    erroGeral: null,
  };
}

/** Uma célula só (sem Tab nem quebra de linha): cola como se tivesse digitado na célula. */
export function ehUmaCelula(texto: string): boolean {
  return !/[\t\n\r]/.test(texto.replace(/\r?\n$/, ""));
}

/**
 * Os itens para a fila (só as linhas sem erro), com o id das categorias criadas (ou "Outros" se ela
 * escolheu não criar).
 */
export function itensParaColar(
  previa: PreviaColagem,
  categoriaCriada: (nome: string, tipo: TipoLancamento) => string | null,
): { k: string | null; campos: Partial<Campos> }[] {
  return previa.linhas
    .filter((l) => !l.erros.length)
    .map((l) => {
      if (!l.categoriaNova) return { k: l.k, campos: l.campos };
      const id = categoriaCriada(l.categoriaNova.nome, l.categoriaNova.tipo);
      return { k: l.k, campos: { ...l.campos, ...(id ? { categoriaId: id } : {}) } };
    });
}
