/** Validação da produção (insumos, ajustes de estoque e lotes). Arquivo à parte do validacao.ts. */
import { z } from "zod";
import { hojeNaLoja } from "@/lib/despesas";
import { TIPOS_INSUMO, UNIDADES_INSUMO } from "@/lib/producao";
// O mesmo filtro da venda presencial: controles (o \0 o Postgres recusa e viraria 500), marcas
// invisíveis e de direção ("Açú​car" escaparia do aviso de nome repetido) e meio caractere
// UTF-16. Quebra de linha e tab passam.
import { textoLivreValido as semControle } from "@/lib/vendas";

const texto = (campo: string, max: number) =>
  z
    .string({ error: `Informe ${campo}.` })
    .trim()
    .min(1, `Informe ${campo}.`)
    .max(max, `${campo[0].toUpperCase()}${campo.slice(1)} é longo demais.`)
    .refine(semControle, "Tem caracteres inválidos.");

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Texto longo demais.")
    .refine(semControle, "Tem caracteres inválidos.")
    .nullish()
    .transform((v) => (v ? v : null));

/** Dia da produção/ajuste: de 2020 até hoje (Brasília). Sem data, vale hoje no relógio do servidor. */
const diaAteHoje = z
  .iso.date("Data inválida.")
  .optional()
  .transform((dia) => dia ?? hojeNaLoja())
  .refine((dia) => dia >= "2020-01-01", { message: "Use uma data de 2020 em diante." })
  .refine((dia) => dia <= hojeNaLoja(), { message: "A data não pode ser depois de hoje." });

/** Quantidade com até 3 casas (o banco guarda DECIMAL(14,3)). */
const tresCasas = (q: number) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6;

const quantidadePositiva = z
  .number({ error: "Informe a quantidade." })
  .min(0.001, "A quantidade deve ser maior que zero.")
  .max(1_000_000_000, "Quantidade grande demais.")
  .refine(tresCasas, { message: "Use no máximo 3 casas decimais." });

const centavos = z.number().int("Valor inválido.").min(0, "Valor inválido.").max(100_000_000, "Valor grande demais.");

export const insumoSchema = z.object({
  nome: texto("o nome", 80),
  tipo: z.enum(TIPOS_INSUMO, { error: "Escolha o tipo." }),
  unidade: z.enum(UNIDADES_INSUMO, { error: "Escolha a unidade." }),
  estoqueMinimo: z
    .number()
    .min(0, "O estoque mínimo não pode ser negativo.")
    .max(1_000_000_000)
    .refine(tresCasas, { message: "Use no máximo 3 casas decimais." })
    .nullish()
    .transform((v) => v ?? null),
  controlaEstoque: z.boolean().default(true),
  ativo: z.boolean().default(true),
});
export type InsumoEntrada = z.infer<typeof insumoSchema>;

/**
 * Edição (PATCH, envia todos os campos): sem os padrões do cadastro, senão um PATCH sem `ativo`
 * reativaria um insumo desativado (e sem `controlaEstoque`, voltaria a controlar o estoque).
 */
export const insumoEdicaoSchema = insumoSchema.extend({
  controlaEstoque: z.boolean({ error: "Diga se controla o estoque." }),
  ativo: z.boolean({ error: "Diga se o insumo está ativo." }),
});

export const ajusteEstoqueSchema = z.object({
  /** Positivo entra (achou mais na recontagem), negativo sai (estragou, perdeu). */
  quantidade: z
    .number({ error: "Informe a quantidade." })
    // ≥ 0,001 (e não só ≠ 0): 0,0000001 passaria e viraria 0,000 no banco, que a CHECK recusa (500).
    .refine((q) => Math.abs(q) >= 0.001, { message: "Informe quanto entra (+) ou sai (−), a partir de 0,001." })
    .refine((q) => Math.abs(q) <= 1_000_000_000, { message: "Quantidade grande demais." })
    .refine(tresCasas, { message: "Use no máximo 3 casas decimais." }),
  motivo: texto("o motivo", 120),
  data: diaAteHoje,
});
export type AjusteEntrada = z.infer<typeof ajusteEstoqueSchema>;

export const producaoSchema = z
  .object({
    data: diaAteHoje,
    /** Sabor do catálogo (opcional: teste de receita nova). */
    productId: z.string().min(1).max(100).nullish().transform((v) => v ?? null),
    nome: texto("o nome da receita", 80),
    potes: z
      .number({ error: "Informe quantos potes renderam." })
      .int("Potes: use um número inteiro.")
      .min(1, "Informe quantos potes renderam.")
      .max(100_000, "Quantidade de potes grande demais."),
    itens: z
      .array(
        z.object({
          insumoId: z.string().min(1, "Escolha o insumo.").max(100),
          quantidade: quantidadePositiva,
          /**
           * Custo do item inteiro, em centavos, quando a pessoa informa (0 = de casa ou doado).
           * Sem isso, vale o custo médio das compras; sem compra, é obrigatório informar.
           */
          custoInformadoCentavos: centavos.nullish().transform((v) => v ?? null),
        }),
      )
      .min(1, "Informe pelo menos um ingrediente.")
      .max(60, "Itens demais."),
    /** Gás, energia, água, mão de obra… (não são insumos de estoque). */
    custos: z
      .array(z.object({ descricao: texto("a descrição do custo", 60), valorCentavos: centavos }))
      .max(20, "Custos demais."),
    observacao: textoOpcional(500),
  })
  .superRefine((p, ctx) => {
    const vistos = new Set<string>();
    p.itens.forEach((item, i) => {
      if (vistos.has(item.insumoId)) {
        ctx.addIssue({ code: "custom", path: ["itens", i, "insumoId"], message: "Este insumo já está na lista: some as quantidades numa linha só." });
      }
      vistos.add(item.insumoId);
    });
  });
export type ProducaoEntrada = z.infer<typeof producaoSchema>;
