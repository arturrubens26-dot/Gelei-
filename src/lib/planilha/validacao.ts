/**
 * Planilha financeira: validação zod do que chega à API (servidor; sem `server-only` para os testes).
 * O servidor nunca confia na grade: tipos, tamanhos, datas e valores são conferidos aqui.
 */
import { z } from "zod";
import { CATEGORIAS_DESPESA, UNIDADES_DESPESA, hojeNaLoja } from "@/lib/despesas";
import { FORMAS_PAGAMENTO, textoLivreValido } from "@/lib/vendas";
import { MAX_OPERACOES_POR_LOTE, MAX_SALDO_CENTAVOS, MAX_VALOR_CENTAVOS, TIPOS_LANCAMENTO } from "@/lib/planilha/tipos";

const MSG_CONTROLE = "Tem caracteres inválidos.";

/** Texto opcional: vazio, ausente ou null viram null. */
const textoOpcional = (campo: string, max: number) =>
  z
    .string({ error: `${campo}: texto inválido.` })
    .trim()
    .max(max, `${campo} pode ter até ${max} caracteres.`)
    .refine(textoLivreValido, MSG_CONTROLE)
    .nullish()
    .transform((v) => (v ? v : null));

const tresCasas = (q: number) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6;

/** Data do lançamento: dia real, de 2020 até hoje (no relógio da loja). Ausente = hoje. */
const dataSchema = z
  .iso.date("Data inválida.")
  .optional()
  .transform((dia) => dia ?? hojeNaLoja())
  .refine((dia) => dia >= "2020-01-01", { message: "Use uma data de 2020 em diante." })
  .refine((dia) => dia <= hojeNaLoja(), { message: "A data não pode ser depois de hoje." });

const idSchema = z.string({ error: "Identificador inválido." }).min(1, "Identificador inválido.").max(100, "Identificador inválido.");

/** Um lançamento completo (criar, ou o resultado da mescla de um "alterar"). */
export const lancamentoSchema = z.object({
  tipo: z.enum(TIPOS_LANCAMENTO, { error: "Escolha Entrada ou Saída." }),
  data: dataSchema,
  categoriaId: z.string({ error: "Escolha uma categoria." }).min(1, "Escolha uma categoria.").max(100, "Categoria inválida."),
  descricao: z
    .string({ error: "Informe a descrição." })
    .trim()
    .min(1, "Informe a descrição.")
    .max(120, "A descrição pode ter até 120 caracteres.")
    .refine(textoLivreValido, MSG_CONTROLE),
  valorCentavos: z
    .number({ error: "Informe o valor." })
    .int("Valor inválido.")
    .min(1, "O valor precisa ser maior que zero.")
    .max(MAX_VALOR_CENTAVOS, "Valor grande demais (máximo de R$ 1.000.000,00)."),
  formaPagamento: z.enum(FORMAS_PAGAMENTO, { error: "Forma de pagamento inválida." }).nullish().transform((v) => v ?? null),
  observacao: textoOpcional("A observação", 300),
  // Só saída (na entrada são ignorados):
  quantidade: z
    .number({ error: "Quantidade inválida." })
    .min(0.001, "A quantidade deve ser maior que zero (mínimo 0,001).")
    .max(1_000_000, "Quantidade grande demais.")
    .refine(tresCasas, { message: "Use no máximo 3 casas decimais." })
    .optional()
    .transform((q) => q ?? 1),
  unidade: z.enum(UNIDADES_DESPESA, { error: "Unidade inválida." }).optional().transform((u) => u ?? "UN"),
  fornecedor: textoOpcional("O fornecedor", 80),
  /** Só para o "desfazer exclusão" recriar uma compra ligada ao estoque. */
  insumoId: idSchema.nullish().transform((v) => v ?? null),
  quantidadeBase: z
    .number({ error: "Quantidade inválida." })
    .min(0.001, "Informe quanto entrou no estoque.")
    .max(1_000_000_000, "Quantidade grande demais.")
    .refine(tresCasas, { message: "Use no máximo 3 casas decimais." })
    .nullish()
    .transform((v) => v ?? null),
});

export type LancamentoEntrada = z.output<typeof lancamentoSchema>;

/**
 * Campos de um "alterar" (parciais): aqui só a forma; o servidor mescla com a linha atual e valida o
 * resultado inteiro com `lancamentoSchema`.
 */
export const camposSchema = z
  .object({
    tipo: z.string(),
    data: z.string(),
    categoriaId: z.string(),
    descricao: z.string(),
    valorCentavos: z.number(),
    formaPagamento: z.string().nullable(),
    observacao: z.string().nullable(),
    quantidade: z.number(),
    unidade: z.string(),
    fornecedor: z.string().nullable(),
    quantidadeBase: z.number().nullable(),
  })
  .partial()
  .strict();

export type CamposAlteracao = z.output<typeof camposSchema>;

const versaoSchema = z.number({ error: "Informe a versão da linha." }).int("Versão inválida.").min(0, "Versão inválida.").max(2_000_000_000, "Versão inválida.");
const tipoAtualSchema = z.enum(TIPOS_LANCAMENTO, { error: "Tipo atual inválido." });

/** UUID do navegador (ou outra chave de 8 a 100 caracteres simples): a Idempotency-Key da linha nova. */
const chaveSchema = z
  .string({ error: "Informe a chave da linha." })
  .min(8, "Chave inválida.")
  .max(100, "Chave inválida.")
  .regex(/^[A-Za-z0-9_-]+$/, "Chave inválida.");

export const operacaoSchema = z.discriminatedUnion(
  "op",
  [
    z.object({ op: z.literal("criar"), chave: chaveSchema, lancamento: z.unknown(), confirmado: z.boolean().optional() }),
    z.object({ op: z.literal("alterar"), id: idSchema, tipoAtual: tipoAtualSchema, versao: versaoSchema, campos: camposSchema }),
    z.object({ op: z.literal("excluir"), id: idSchema, tipoAtual: tipoAtualSchema, versao: versaoSchema, confirmarEstoque: z.boolean().optional() }),
  ],
  { error: "Operação inválida (use criar, alterar ou excluir)." },
);

export type Operacao = z.output<typeof operacaoSchema>;

export const loteSchema = z
  .object({
    operacoes: z
      .array(operacaoSchema, { error: "Envie a lista de operações." })
      .min(1, "Envie pelo menos uma operação.")
      .max(MAX_OPERACOES_POR_LOTE, `No máximo ${MAX_OPERACOES_POR_LOTE} operações por vez.`),
  })
  .superRefine((v, ctx) => {
    const chaves = new Set<string>();
    v.operacoes.forEach((o, i) => {
      if (o.op !== "criar") return;
      if (chaves.has(o.chave)) ctx.addIssue({ code: "custom", message: "Chave repetida no mesmo envio.", path: ["operacoes", i, "chave"] });
      chaves.add(o.chave);
    });
    const ids = new Set<string>();
    v.operacoes.forEach((o, i) => {
      if (o.op === "criar") return;
      if (ids.has(o.id)) ctx.addIssue({ code: "custom", message: "A mesma linha aparece duas vezes no envio.", path: ["operacoes", i, "id"] });
      ids.add(o.id);
    });
  });

/** PATCH /saidas/[id] e /entradas/[id]. */
export const alteracaoSchema = z.object({ versao: versaoSchema, campos: camposSchema });

// --- categorias e saldo inicial --------------------------------------------------------------------------

const nomeCategoriaSchema = z
  .string({ error: "Informe o nome." })
  .trim()
  .transform((n) => n.replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Informe o nome.").max(40, "O nome pode ter até 40 caracteres."))
  .refine(textoLivreValido, MSG_CONTROLE);

export const novaCategoriaSchema = z.object({
  tipo: z.enum(TIPOS_LANCAMENTO, { error: "Escolha Entrada ou Saída." }),
  nome: nomeCategoriaSchema,
  grupo: z.enum(CATEGORIAS_DESPESA, { error: "Grupo inválido." }).nullish().transform((g) => g ?? null),
  foraDoResultado: z.boolean({ error: "Valor inválido." }).optional().transform((v) => v ?? false),
});

export const alterarCategoriaSchema = z
  .object({
    nome: nomeCategoriaSchema,
    grupo: z.enum(CATEGORIAS_DESPESA, { error: "Grupo inválido." }),
    foraDoResultado: z.boolean({ error: "Valor inválido." }),
    ativo: z.boolean({ error: "Valor inválido." }),
    ordem: z.number({ error: "Ordem inválida." }).int("Ordem inválida.").min(0, "Ordem inválida.").max(9999, "Ordem inválida."),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

export const configFinanceiroSchema = z.object({
  saldoInicialCentavos: z
    .number({ error: "Informe o saldo." })
    .int("Saldo inválido.")
    .min(-MAX_SALDO_CENTAVOS, "Saldo fora do limite.")
    .max(MAX_SALDO_CENTAVOS, "Saldo fora do limite."),
  saldoInicialEm: z
    .iso.date("Data inválida.")
    .refine((dia) => dia >= "2020-01-01", { message: "Use uma data de 2020 em diante." })
    .refine((dia) => dia <= hojeNaLoja(), { message: "A data não pode ser depois de hoje." })
    .nullable(),
});
