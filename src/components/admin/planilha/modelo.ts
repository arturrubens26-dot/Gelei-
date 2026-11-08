/**
 * Modelo das linhas da grade, sem React: os campos que aparecem, o que falta para salvar, a operação
 * que vai para a API (POST /api/admin/planilha/lancamentos) e a leitura do que ela digita numa
 * célula. Testado em testes/planilha-grade.test.ts.
 */
import { type UnidadeDespesa, UNIDADES_DESPESA, NOME_UNIDADE } from "@/lib/despesas";
import { formatarBRL, lerNumeroBrasileiro } from "@/lib/dinheiro";
import { diaDaSemana as numeroDoDiaDaSemana, lerDataPlanilha, lerValorPlanilha, normalizarTexto, somarDias } from "@/lib/planilha/regras";
import { FORMAS_PAGAMENTO, ROTULO_FORMA_PAGAMENTO, type FormaPagamento } from "@/lib/vendas";
import { MAX_VALOR_CENTAVOS, type CategoriaDTO, type LinhaPlanilhaDTO, type TipoLancamento } from "@/lib/planilha/tipos";

// --- campos e colunas --------------------------------------------------------------------------

export type Campos = {
  /** "AAAA-MM-DD"; "" = vazia. */
  data: string;
  tipo: TipoLancamento | null;
  categoriaId: string | null;
  descricao: string;
  valorCentavos: number | null;
  formaPagamento: FormaPagamento | null;
  observacao: string;
  /** Só saídas (compras): quantidade, unidade e fornecedor. */
  quantidade: number | null;
  unidade: UnidadeDespesa | null;
  fornecedor: string;
};

export type CampoId = keyof Campos;

export const CAMPOS_DE_COMPRA = ["quantidade", "unidade", "fornecedor"] as const satisfies readonly CampoId[];

export type Coluna = {
  id: CampoId;
  rotulo: string;
  /** Texto curto para leitores de tela e dicas ("Data do lançamento"). */
  descricao: string;
  /** Só aparece com "Mostrar colunas de compra". */
  compra?: boolean;
  /** Classe de largura da coluna (Tailwind). */
  largura: string;
  direita?: boolean;
};

export const COLUNAS: readonly Coluna[] = [
  { id: "data", rotulo: "Data", descricao: "Dia do lançamento, como 7/11", largura: "w-32" },
  { id: "tipo", rotulo: "Tipo", descricao: "Entrada ou Saída", largura: "w-28" },
  { id: "categoriaId", rotulo: "Categoria", descricao: "Categoria (lista do Auxiliar)", largura: "w-56" },
  { id: "descricao", rotulo: "Descrição", descricao: "O que foi", largura: "w-64" },
  { id: "valorCentavos", rotulo: "Valor", descricao: "Valor em reais", largura: "w-36", direita: true },
  { id: "formaPagamento", rotulo: "Forma", descricao: "Forma de pagamento (opcional)", largura: "w-40" },
  { id: "observacao", rotulo: "Observação", descricao: "Observação (opcional)", largura: "w-52" },
  { id: "quantidade", rotulo: "Qtd.", descricao: "Quantidade comprada", compra: true, largura: "w-24", direita: true },
  { id: "unidade", rotulo: "Unid.", descricao: "Unidade da compra", compra: true, largura: "w-32" },
  { id: "fornecedor", rotulo: "Fornecedor", descricao: "Onde comprou (opcional)", compra: true, largura: "w-44" },
];

export const camposVazios = (): Campos => ({
  data: "",
  tipo: null,
  categoriaId: null,
  descricao: "",
  valorCentavos: null,
  formaPagamento: null,
  observacao: "",
  quantidade: null,
  unidade: null,
  fornecedor: "",
});

export function camposDoServidor(l: LinhaPlanilhaDTO): Campos {
  return {
    data: l.data,
    tipo: l.tipo,
    categoriaId: l.categoriaId,
    descricao: l.descricao,
    valorCentavos: l.valorCentavos,
    formaPagamento: l.formaPagamento,
    observacao: l.observacao ?? "",
    quantidade: l.quantidade,
    unidade: l.unidade,
    fornecedor: l.fornecedor ?? "",
  };
}

/** Linha sem nada digitado (a linha nova do fim, antes de ela começar). */
export function ehVazia(c: Campos): boolean {
  return (
    !c.data &&
    !c.tipo &&
    !c.categoriaId &&
    !c.descricao.trim() &&
    c.valorCentavos === null &&
    !c.formaPagamento &&
    !c.observacao.trim() &&
    c.quantidade === null &&
    !c.unidade &&
    !c.fornecedor.trim()
  );
}

const NOME_DO_CAMPO: Record<CampoId, string> = {
  data: "data",
  tipo: "tipo",
  categoriaId: "categoria",
  descricao: "descrição",
  valorCentavos: "valor",
  formaPagamento: "forma",
  observacao: "observação",
  quantidade: "quantidade",
  unidade: "unidade",
  fornecedor: "fornecedor",
};

export const nomeDoCampo = (c: CampoId) => NOME_DO_CAMPO[c];

/** O que falta para a linha poder ser salva. A descrição vazia vira o nome da categoria (não falta). */
export function faltando(c: Campos): CampoId[] {
  const falta: CampoId[] = [];
  if (!c.data) falta.push("data");
  if (!c.tipo) falta.push("tipo");
  if (!c.categoriaId) falta.push("categoriaId");
  if (c.valorCentavos === null) falta.push("valorCentavos");
  return falta;
}

/** "categoria e valor"; "data, tipo e valor". */
export function listarFaltando(campos: CampoId[]): string {
  const nomes = campos.map(nomeDoCampo);
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

// --- operações da API --------------------------------------------------------------------------

export type LancamentoEntrada = {
  tipo: TipoLancamento;
  data?: string;
  categoriaId: string;
  descricao: string;
  valorCentavos: number;
  formaPagamento?: FormaPagamento | null;
  observacao?: string | null;
  quantidade?: number;
  unidade?: UnidadeDespesa;
  fornecedor?: string | null;
  insumoId?: string | null;
  quantidadeBase?: number | null;
};

export type Operacao =
  | { op: "criar"; chave: string; lancamento: LancamentoEntrada; confirmado?: boolean }
  | { op: "alterar"; id: string; tipoAtual: TipoLancamento; versao: number; campos: Partial<LancamentoEntrada> }
  | { op: "excluir"; id: string; tipoAtual: TipoLancamento; versao: number; confirmarEstoque?: boolean };

const textoOuNulo = (t: string) => (t.trim() ? t.trim() : null);

/** Descrição que vai para o servidor: a digitada, ou o nome da categoria (a coluna é opcional para ela). */
export function descricaoParaEnviar(c: Campos, categorias: readonly CategoriaDTO[]): string {
  const digitada = c.descricao.trim();
  if (digitada) return digitada;
  return categorias.find((k) => k.id === c.categoriaId)?.nome ?? "Lançamento";
}

/** O lançamento completo (para criar). null se faltar algo. */
export function lancamentoDosCampos(
  c: Campos,
  categorias: readonly CategoriaDTO[],
  vinculo?: { insumoId: string; quantidadeBase: number | null } | null,
): LancamentoEntrada | null {
  if (faltando(c).length || !c.tipo || !c.categoriaId || c.valorCentavos === null) return null;
  const base: LancamentoEntrada = {
    tipo: c.tipo,
    data: c.data,
    categoriaId: c.categoriaId,
    descricao: descricaoParaEnviar(c, categorias),
    valorCentavos: c.valorCentavos,
    formaPagamento: c.formaPagamento,
    observacao: textoOuNulo(c.observacao),
  };
  if (c.tipo === "ENTRADA") return base;
  return {
    ...base,
    ...(c.quantidade !== null ? { quantidade: c.quantidade } : {}),
    ...(c.unidade ? { unidade: c.unidade } : {}),
    fornecedor: textoOuNulo(c.fornecedor),
    ...(vinculo ? { insumoId: vinculo.insumoId, quantidadeBase: vinculo.quantidadeBase } : {}),
  };
}

/** Só os campos alterados, no formato da API (para o "alterar"). */
export function camposParaEnviar(c: Campos, sujos: readonly CampoId[], categorias: readonly CategoriaDTO[]): Partial<LancamentoEntrada> {
  const saida: Partial<LancamentoEntrada> = {};
  for (const campo of sujos) {
    switch (campo) {
      case "data":
        saida.data = c.data;
        break;
      case "tipo":
        if (c.tipo) saida.tipo = c.tipo;
        break;
      case "categoriaId":
        if (c.categoriaId) saida.categoriaId = c.categoriaId;
        break;
      case "descricao":
        saida.descricao = descricaoParaEnviar(c, categorias);
        break;
      case "valorCentavos":
        if (c.valorCentavos !== null) saida.valorCentavos = c.valorCentavos;
        break;
      case "formaPagamento":
        saida.formaPagamento = c.formaPagamento;
        break;
      case "observacao":
        saida.observacao = textoOuNulo(c.observacao);
        break;
      case "quantidade":
        if (c.tipo === "SAIDA") saida.quantidade = c.quantidade ?? 1;
        break;
      case "unidade":
        if (c.tipo === "SAIDA") saida.unidade = c.unidade ?? "UN";
        break;
      case "fornecedor":
        if (c.tipo === "SAIDA") saida.fornecedor = textoOuNulo(c.fornecedor);
        break;
    }
  }
  // Trocar o tipo leva a categoria junto (do tipo novo), senão o servidor põe "Outros".
  if (saida.tipo && c.categoriaId) saida.categoriaId = c.categoriaId;
  return saida;
}

/** "07/11/2026" a partir de "2026-11-07". */
export function formatarData(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return data;
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "sex" para "2026-11-06" (conta pela data pura, sem fuso). */
export function diaDaSemana(data: string): string {
  return DIAS_DA_SEMANA[numeroDoDiaDaSemana(data)] ?? "";
}

// --- leitura do que ela digita numa célula -----------------------------------------------------

export type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

const ok = <T>(valor: T): Leitura<T> => ({ ok: true, valor });
const erro = <T>(mensagem: string): Leitura<T> => ({ ok: false, erro: mensagem });

/**
 * Data digitada: a regra da planilha (sempre dia/mês: "7/11", "07/11/26", "2026-11-07"; "02/13" é
 * erro, nunca troca para mês/dia; nada no futuro nem antes de 2020), mais "hoje" e "ontem".
 */
export function lerData(texto: string, hoje: string): Leitura<string> {
  const t = texto.trim().toLowerCase();
  if (t === "hoje") return ok(hoje);
  if (t === "ontem") return lerDataPlanilha(somarDias(hoje, -1), hoje);
  const r = lerDataPlanilha(t, hoje);
  if (r.ok) return r;
  return erro(/inválida|não existe/.test(r.erro) ? `${r.erro} Escreva dia/mês, como 7/11.` : r.erro);
}

/**
 * Valor digitado ("12,5", "R$ 1.234,56", "-12,50", "(12,50)"), pela regra da planilha. O sinal volta
 * à parte: valor negativo numa linha sem tipo vira Saída.
 */
export function lerValor(texto: string): Leitura<{ centavos: number; negativo: boolean }> {
  const r = lerValorPlanilha(texto);
  if (!r.ok) return r;
  const centavos = Math.abs(r.valor);
  if (centavos === 0) return erro("O valor precisa ser maior que zero.");
  if (centavos > MAX_VALOR_CENTAVOS) return erro(`Valor alto demais (máximo ${formatarBRL(MAX_VALOR_CENTAVOS / 100)}).`);
  return ok({ centavos, negativo: r.valor < 0 });
}

/** Quantidade de compra: "2", "2,5", "0,250" (até 3 casas); zero ou malformado é erro. */
export function lerQuantidadeDigitada(texto: string): Leitura<number> {
  const partes = lerNumeroBrasileiro(texto.trim(), 3);
  if (!partes) return erro("Quantidade inválida: use números, como 2 ou 2,5.");
  const n = Number(`${partes.inteiro}.${partes.decimal || "0"}`);
  return n > 0 ? ok(n) : erro("A quantidade precisa ser maior que zero.");
}

// --- opções das colunas de escolha -------------------------------------------------------------

export type Opcao = { valor: string; rotulo: string; detalhe?: string };

/** Compara textos sem acento nem maiúsculas ("agua" acha "Água"). */
export const normalizar = (t: string) => normalizarTexto(t).trim();
const semAcento = normalizar;

export const OPCOES_TIPO: readonly Opcao[] = [
  { valor: "ENTRADA", rotulo: "Entrada", detalhe: "dinheiro que entrou" },
  { valor: "SAIDA", rotulo: "Saída", detalhe: "dinheiro que saiu" },
];

export const OPCOES_FORMA: readonly Opcao[] = FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: ROTULO_FORMA_PAGAMENTO[f] }));

export const OPCOES_UNIDADE: readonly Opcao[] = UNIDADES_DESPESA.map((u) => ({ valor: u, rotulo: NOME_UNIDADE[u] }));

/** Categorias que ela pode escolher numa linha: ativas, do tipo da linha (sem tipo: todas), sem as de sistema. */
export function opcoesDeCategoria(categorias: readonly CategoriaDTO[], tipo: TipoLancamento | null, atual?: string | null): Opcao[] {
  return categorias
    .filter((c) => !c.sistema && (c.ativo || c.id === atual) && (!tipo || c.tipo === tipo))
    .map((c) => ({
      valor: c.id,
      rotulo: c.nome,
      detalhe: [tipo ? null : c.tipo === "ENTRADA" ? "entrada" : "saída", c.foraDoResultado ? "fora do lucro" : null, c.ativo ? null : "desativada"]
        .filter(Boolean)
        .join(" · "),
    }));
}

/** Opções que combinam com o texto: começa com o texto primeiro, depois contém. */
export function filtrarOpcoes(opcoes: readonly Opcao[], texto: string): Opcao[] {
  const t = semAcento(texto);
  if (!t) return [...opcoes];
  const comeca: Opcao[] = [];
  const contem: Opcao[] = [];
  for (const o of opcoes) {
    const r = semAcento(o.rotulo);
    if (r.startsWith(t)) comeca.push(o);
    else if (r.includes(t)) contem.push(o);
  }
  return [...comeca, ...contem];
}

/** A opção cujo rótulo é exatamente o texto (sem acento nem maiúsculas), ou a única que combina. */
export function opcaoDoTexto(opcoes: readonly Opcao[], texto: string): Opcao | null {
  const t = semAcento(texto);
  if (!t) return null;
  const exata = opcoes.find((o) => semAcento(o.rotulo) === t || semAcento(o.valor) === t);
  if (exata) return exata;
  const combinam = filtrarOpcoes(opcoes, texto);
  return combinam.length === 1 ? combinam[0] : null;
}

/** Texto que aparece na célula (fora da edição). */
export function textoDaCelula(campo: CampoId, c: Campos, categorias: readonly CategoriaDTO[]): string {
  switch (campo) {
    case "data":
      return c.data ? formatarData(c.data) : "";
    case "tipo":
      return c.tipo === "ENTRADA" ? "Entrada" : c.tipo === "SAIDA" ? "Saída" : "";
    case "categoriaId":
      return c.categoriaId ? (categorias.find((k) => k.id === c.categoriaId)?.nome ?? "(categoria removida)") : "";
    case "descricao":
      return c.descricao;
    case "valorCentavos":
      return c.valorCentavos === null ? "" : formatarBRL(c.valorCentavos / 100);
    case "formaPagamento":
      return c.formaPagamento ? ROTULO_FORMA_PAGAMENTO[c.formaPagamento] : "";
    case "observacao":
      return c.observacao;
    case "quantidade":
      return c.quantidade === null ? "" : String(c.quantidade).replace(".", ",");
    case "unidade":
      return c.unidade ? NOME_UNIDADE[c.unidade] : "";
    case "fornecedor":
      return c.fornecedor;
  }
}

/** Texto que vai para o campo ao editar (F2/Enter): o valor sem "R$", a data como 07/11/2026. */
export function textoParaEditar(campo: CampoId, c: Campos, categorias: readonly CategoriaDTO[]): string {
  if (campo === "valorCentavos") return c.valorCentavos === null ? "" : (c.valorCentavos / 100).toFixed(2).replace(".", ",");
  return textoDaCelula(campo, c, categorias);
}

/** Colunas que só existem nas saídas (compras): na entrada a célula fica travada. */
export function campoValeParaTipo(campo: CampoId, tipo: TipoLancamento | null): boolean {
  return !(CAMPOS_DE_COMPRA as readonly CampoId[]).includes(campo) || tipo !== "ENTRADA";
}

/** Campos opcionais: Delete limpa. Os obrigatórios não se limpam (troque o valor). */
export function campoOpcional(campo: CampoId): boolean {
  return ["descricao", "formaPagamento", "observacao", "fornecedor"].includes(campo);
}
