/**
 * Planilha financeira (/admin/planilha): tipos da API e constantes. Módulo puro (servidor e navegador).
 * Contratos completos: README, seção "Planilha financeira".
 */
import type { CategoriaDespesa, UnidadeDespesa } from "@/lib/despesas";
import type { FormaPagamento } from "@/lib/vendas";

export type TipoLancamento = "ENTRADA" | "SAIDA";
export const TIPOS_LANCAMENTO = ["ENTRADA", "SAIDA"] as const satisfies readonly TipoLancamento[];

/** De onde vem a linha: as manuais se editam; as outras são calculadas das vendas e dos mimos. */
export type Origem =
  | "manual-saida"
  | "manual-entrada"
  | "site"
  | "presencial"
  | "mimos-entrada"
  | "mimos-restante"
  | "mimos-devolucao";

export const ORIGENS_AUTOMATICAS = ["site", "presencial", "mimos-entrada", "mimos-restante", "mimos-devolucao"] as const satisfies readonly Origem[];

/** Categorias "de sistema": constantes no código, nunca linhas da tabela (não se editam nem se excluem). */
export const CATEGORIAS_SISTEMA = {
  site: { id: "sistema-site", nome: "Vendas no site" },
  presencial: { id: "sistema-presencial", nome: "Vendas presenciais" },
  mimos: { id: "sistema-mimos", nome: "Mimos" },
  devolucoes: { id: "sistema-mimos-devolucoes", nome: "Devoluções de mimos" },
} as const;

/** Categoria de cada origem automática. */
export const CATEGORIA_DA_ORIGEM: Record<(typeof ORIGENS_AUTOMATICAS)[number], { id: string; nome: string }> = {
  site: CATEGORIAS_SISTEMA.site,
  presencial: CATEGORIAS_SISTEMA.presencial,
  "mimos-entrada": CATEGORIAS_SISTEMA.mimos,
  "mimos-restante": CATEGORIAS_SISTEMA.mimos,
  "mimos-devolucao": CATEGORIAS_SISTEMA.devolucoes,
};

/** Id da categoria semeada de um grupo antigo das Despesas ("saida-ingredientes"). */
export const categoriaDoGrupo = (grupo: CategoriaDespesa) => `saida-${grupo.toLowerCase()}`;

/** Para onde vai uma linha que troca de tipo sem informar a categoria nova. */
export const CATEGORIA_PADRAO: Record<TipoLancamento, string> = { SAIDA: "saida-outros", ENTRADA: "entrada-outras" };

export type CategoriaDTO = {
  id: string;
  tipo: TipoLancamento;
  nome: string;
  /** Só SAÍDA: o grupo antigo (relatórios e tela de Despesas). */
  grupo: CategoriaDespesa | null;
  /** Aporte da dona, retirada: contam no saldo, não no lucro. */
  foraDoResultado: boolean;
  ativo: boolean;
  ordem: number;
  /** Categoria de sistema (vendas, mimos): somente leitura. */
  sistema: boolean;
  /** Semeada de um grupo (`saida-<grupo>`): não se exclui nem muda de grupo. */
  padrao: boolean;
  /** Quantos lançamentos usam (0 nas de sistema). */
  linhas: number;
};

export type PessoaDTO = { id: string; nome: string };

export type LinhaPlanilhaDTO = {
  /** Manual: id da linha. Automática: "<origem>:<id do pedido, pagamento, encomenda ou devolução>". */
  id: string;
  origem: Origem;
  tipo: TipoLancamento;
  editavel: boolean;
  /** Trava otimista das manuais (mande no PATCH/DELETE); null nas automáticas. */
  versao: number | null;
  /** "AAAA-MM-DD" (automáticas: dia da loja). */
  data: string;
  categoriaId: string;
  categoriaNome: string;
  foraDoResultado: boolean;
  descricao: string;
  /** Centavos; positivo, exceto a devolução de mimos (negativa). */
  valorCentavos: number;
  formaPagamento: FormaPagamento | null;
  observacao: string | null;
  quantidade: number | null;
  unidade: UnidadeDespesa | null;
  fornecedor: string | null;
  insumo: { id: string; nome: string; unidade: "G" | "ML" | "UN" } | null;
  quantidadeBase: number | null;
  criadoPor: PessoaDTO | null;
  criadoEm: string | null;
  atualizadoPor: PessoaDTO | null;
  atualizadoEm: string | null;
  importacaoId: string | null;
  /** Automáticas: "/admin/orders/<id>" ou "/admin/encomendas/<id>". */
  link: string | null;
  /** Automáticas: código curto do pedido ou da encomenda ("#A1B2C3"). */
  codigo: string | null;
  /** Só com `?nomes=1` (exportar com nomes, decisão D8). */
  cliente?: string | null;
};

export type TotaisDTO = {
  /** Entradas dentro do resultado (sem aporte) = resumo.entradas do Financeiro. */
  entradasCentavos: number;
  /** Saídas dentro do resultado (sem retirada) = resumo.saidas do Financeiro. */
  saidasCentavos: number;
  resultadoCentavos: number;
  foraDoResultado: { entradasCentavos: number; saidasCentavos: number };
  /** Tudo o que entrou − tudo o que saiu, inclusive aporte e retirada (o que mexe no saldo). */
  movimentoCentavos: number;
  linhas: number;
};

export type AutomaticasDoDiaDTO = { data: string; origem: Origem; quantidade: number; valorCentavos: number };

export type LancamentosDoPeriodoDTO = {
  de: string;
  ate: string;
  hoje: string;
  linhas: LinhaPlanilhaDTO[];
  truncado: boolean;
  totais: TotaisDTO;
  automaticasPorDia: AutomaticasDoDiaDTO[];
  saldo: { inicialCentavos: number; inicialEm: string | null; noFimCentavos: number | null };
  categorias: CategoriaDTO[];
  descricoes: string[];
};

export type ConfigFinanceiroDTO = {
  saldoInicialCentavos: number;
  saldoInicialEm: string | null;
  atualizadoEm: string;
  atualizadoPor: PessoaDTO | null;
};

export type AcaoAuditoria = "CRIOU" | "ALTEROU" | "EXCLUIU" | "IMPORTOU" | "DESFEZ_IMPORTACAO" | "PROMOVEU_ADMIN" | "REBAIXOU_ADMIN";

export type ItemHistoricoDTO = {
  id: string;
  entidade: string;
  entidadeId: string;
  acao: AcaoAuditoria;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  admin: PessoaDTO | null;
  criadoEm: string;
};

/** Resultado de cada operação do lote (POST /api/admin/planilha/lancamentos). */
export type ResultadoOperacao =
  | { indice: number; op: "criar"; linha: LinhaPlanilhaDTO; repetida: boolean }
  | { indice: number; op: "alterar"; linha: LinhaPlanilhaDTO; idAnterior?: string }
  | { indice: number; op: "excluir"; id: string; linha: LinhaPlanilhaDTO };

/** Limites da API da planilha. */
export const MAX_OPERACOES_POR_LOTE = 200;
export const MAX_BYTES_LOTE = 256 * 1024;
export const MAX_LINHAS_PERIODO = 5000;
export const MAX_DIAS_PERIODO = 400;
export const MAX_DESCRICOES = 300;
export const MAX_VALOR_CENTAVOS = 100_000_000;
export const MAX_SALDO_CENTAVOS = 100_000_000;
