import { z } from "zod";
import { CATEGORIAS_DESPESA, UNIDADES_DESPESA, hojeNaLoja } from "@/lib/despesas";
import {
  MAX_TAXA_ENTREGA_CENTAVOS,
  MENSAGEM_TELEFONE_INVALIDO,
  MODOS_ENTREGA,
  normalizarTelefone,
  telefoneValido,
} from "@/lib/entrega-regras";
import { CONFERENCIAS, MAX_OBSERVACAO_LINK } from "@/lib/auth/redefinicao-regras";
import {
  MAX_BYTES_SENHA,
  MIN_CARACTERES_SENHA,
  MAX_KITS_POR_PEDIDO,
  MAX_LINHAS_DE_KIT,
  MAX_POR_PRODUTO,
  MAX_POTES_POR_KIT,
} from "@/lib/limites";
import { TODOS_STATUS } from "@/lib/status";
import {
  DIAS_RETROATIVOS,
  FORMAS_PAGAMENTO,
  LIMITE_CONFIRMACAO_CENTAVOS,
  MAX_ITENS_VENDA,
  MAX_PRECO_UNITARIO_CENTAVOS,
  STATUS_INICIAIS_PRESENCIAL,
  diaMinimoDaVenda,
  textoLivreValido,
} from "@/lib/vendas";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Aceita "01310-100" ou "01310100" e normaliza para 8 dígitos. */
export const cepSchema = z
  .string({ error: "Informe o CEP." })
  .transform((valor) => valor.replace(/\D/g, ""))
  .pipe(z.string().length(8, "O CEP deve ter 8 dígitos."));

const textoObrigatorio = (campo: string, max: number) =>
  z
    .string({ error: `Informe ${campo}.` })
    .trim()
    .min(1, `Informe ${campo}.`)
    .max(max, `${campo[0].toUpperCase()}${campo.slice(1)} é longo demais.`);

export const enderecoSchema = z.object({
  cep: cepSchema,
  rua: textoObrigatorio("a rua", 120),
  numero: textoObrigatorio("o número", 20),
  complemento: z
    .string()
    .trim()
    .max(80, "O complemento é longo demais.")
    .optional()
    .transform((valor) => (valor ? valor : null)),
  bairro: textoObrigatorio("o bairro", 80),
  cidade: textoObrigatorio("a cidade", 80),
  estado: z
    .string({ error: "Informe o estado." })
    .trim()
    .toUpperCase()
    .pipe(z.enum(UFS, { error: "Estado inválido (use a sigla, ex.: SP)." })),
});

export type EnderecoEntrada = z.infer<typeof enderecoSchema>;

/** WhatsApp com DDD: normaliza (tira máscara, +55 e o 0 da operadora) e confere. Sai só com dígitos. */
export const telefoneSchema = z
  .string({ error: MENSAGEM_TELEFONE_INVALIDO })
  .max(30, MENSAGEM_TELEFONE_INVALIDO)
  .transform(normalizarTelefone)
  .refine(telefoneValido, MENSAGEM_TELEFONE_INVALIDO);

export const calculoFreteSchema = z.object({
  cep: cepSchema,
  // A taxa é fixa (não depende do peso); o campo continua aceito para o carrinho saber se a cotação ficou velha.
  pesoTotalGramas: z
    .number({ error: "Informe o peso total do carrinho." })
    .int("O peso deve ser um número inteiro de gramas.")
    .min(0)
    .max(1_000_000)
    .default(0),
});

/** PATCH /api/admin/entrega: a taxa fixa de entrega em Teresina, em centavos. */
export const taxaEntregaSchema = z.object({
  taxaEntregaCentavos: z
    .number({ error: "Informe a taxa de entrega." })
    .int("A taxa é em centavos inteiros.")
    .min(0, "A taxa não pode ser negativa.")
    .max(MAX_TAXA_ENTREGA_CENTAVOS, `Taxa máxima: R$ ${(MAX_TAXA_ENTREGA_CENTAVOS / 100).toFixed(2).replace(".", ",")}.`),
});

export const itemPedidoSchema = z.object({
  productId: z.string().min(1).max(100),
  quantidade: z
    .number()
    .int()
    .min(1, "Quantidade mínima: 1.")
    .max(MAX_POR_PRODUTO, `Quantidade máxima: ${MAX_POR_PRODUTO}.`),
});

/** Potes de um sabor em UMA caixa do kit. */
const saborDoKitSchema = z.object({
  productId: z.string().min(1).max(100),
  quantidade: z
    .number()
    .int()
    .min(1, "Quantidade mínima: 1 pote.")
    .max(MAX_POTES_POR_KIT, `No máximo ${MAX_POTES_POR_KIT} potes por caixa.`),
});

/**
 * Uma linha de kit: N caixas com a mesma composição. Aqui só o formato e os tetos; quantos potes a
 * caixa leva (soma exata) depende do kit no banco e é conferido em criarPedido (400 em `kits.N.sabores`).
 */
export const kitPedidoSchema = z.object({
  kitId: z.string().min(1).max(100),
  quantidade: z
    .number()
    .int()
    .min(1, "Quantidade mínima: 1 caixa.")
    .max(MAX_KITS_POR_PEDIDO, `No máximo ${MAX_KITS_POR_PEDIDO} caixas por pedido.`),
  sabores: z
    .array(saborDoKitSchema)
    .min(1, "Escolha os sabores do kit.")
    .max(MAX_POTES_POR_KIT, `No máximo ${MAX_POTES_POR_KIT} potes por caixa.`)
    .refine((sabores) => sabores.reduce((soma, s) => soma + s.quantidade, 0) <= MAX_POTES_POR_KIT, {
      message: `No máximo ${MAX_POTES_POR_KIT} potes por caixa.`,
    }),
});

/**
 * Pedido: potes avulsos (`itens`) e/ou caixas de kit (`kits`) + (endereço salvo OU endereço novo).
 * Preços e composição válida vêm sempre do banco. O payload antigo, sem `kits`, continua válido.
 * `totalEsperadoCentavos` (opcional) é o total que o cliente viu na tela: se o
 * servidor calcular outro valor, o pedido NÃO é criado e responde 409.
 */
export const pedidoSchema = z
  .object({
    itens: z.array(itemPedidoSchema).max(50).default([]),
    kits: z.array(kitPedidoSchema).max(MAX_LINHAS_DE_KIT, `No máximo ${MAX_LINHAS_DE_KIT} kits diferentes por pedido.`).default([]),
    /** Entrega em Teresina (com endereço) ou retirada na loja (sem endereço e sem frete). */
    modoEntrega: z.enum(MODOS_ENTREGA, { error: "Escolha entre entregar em Teresina ou retirar na loja." }),
    /** WhatsApp da cliente: aceita com máscara ou +55; sai só com os dígitos. */
    telefone: telefoneSchema,
    addressId: z.string().min(1).max(100).optional(),
    endereco: enderecoSchema.optional(),
    totalEsperadoCentavos: z.number().int().min(0).max(100_000_000).optional(),
  })
  .refine((v) => v.itens.length + v.kits.length >= 1, { message: "O carrinho está vazio.", path: ["itens"] })
  // O teto vale para a soma das caixas: 20 linhas de 20 caixas seriam 400 caixas.
  .refine((v) => v.kits.reduce((soma, k) => soma + k.quantidade, 0) <= MAX_KITS_POR_PEDIDO, {
    message: `No máximo ${MAX_KITS_POR_PEDIDO} caixas de kit por pedido.`,
    path: ["kits"],
  })
  .refine((v) => v.modoEntrega !== "ENTREGA" || Boolean(v.addressId) !== Boolean(v.endereco), {
    message: "Informe um endereço salvo (addressId) ou os dados de um novo endereço.",
    path: ["endereco"],
  })
  // Retirada não tem endereço: mandar um seria sinal de tela desatualizada (e o banco recusaria).
  .refine((v) => v.modoEntrega !== "RETIRADA" || (!v.addressId && !v.endereco), {
    message: "Na retirada na loja não há endereço de entrega.",
    path: ["endereco"],
  });

export type PedidoEntrada = z.output<typeof pedidoSchema>;

/** Regra da senha nova (cadastro e redefinição): 8 caracteres no mínimo e 72 bytes no máximo. */
export const senhaNovaSchema = z
  .string({ error: `A senha deve ter pelo menos ${MIN_CARACTERES_SENHA} caracteres.` })
  .min(MIN_CARACTERES_SENHA, `A senha deve ter pelo menos ${MIN_CARACTERES_SENHA} caracteres.`)
  .max(200, "A senha é longa demais (máximo de 72 bytes; acentos e emojis ocupam mais de 1).")
  // O bcrypt considera só os primeiros 72 BYTES: com acentos isso é menos de 72 caracteres.
  .refine((s) => new TextEncoder().encode(s).length <= MAX_BYTES_SENHA, {
    message: "A senha é longa demais (máximo de 72 bytes; acentos e emojis ocupam mais de 1).",
  });

const emailSchema = z.email("E-mail inválido.").max(160).transform((v) => v.toLowerCase());

export const registroSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome.").max(100),
  email: emailSchema,
  senha: senhaNovaSchema,
});

/** POST /api/auth/esqueci-senha. */
export const esqueciSenhaSchema = z.object({ email: emailSchema });

/**
 * POST /api/auth/redefinir-senha. O token só tem teto aqui: formato errado responde a mesma mensagem
 * de link vencido (sem `detalhes`), conferido em redefinirComToken.
 */
export const redefinirSenhaSchema = z.object({
  // Ausente, de outro tipo ou comprido demais vira "", que redefinirComToken recusa com a mensagem única.
  token: z.string().max(200).catch(""),
  senha: senhaNovaSchema,
});

/** POST /api/admin/clientes/[id]/link-senha: o que a dona conferiu e uma observação opcional. */
export const linkSenhaSchema = z.object({
  conferencia: z
    .array(z.enum(CONFERENCIAS, { error: "Item de conferência desconhecido." }))
    .max(CONFERENCIAS.length)
    .transform((itens) => [...new Set(itens)]),
  observacao: z
    .string()
    .trim()
    .max(MAX_OBSERVACAO_LINK, `A observação pode ter no máximo ${MAX_OBSERVACAO_LINK} caracteres.`)
    .refine(textoLivreValido, "Tem caracteres inválidos.")
    .optional()
    .transform((v) => (v ? v : null)),
});

export const loginSchema = z.object({
  email: z.email("E-mail inválido.").max(160).transform((v) => v.toLowerCase()),
  senha: z.string().min(1, "Informe a senha.").max(200),
});

export const statusPedidoSchema = z.enum(TODOS_STATUS);

// Caracteres de controle (o \0, por exemplo, o Postgres recusa e viraria 500); quebra de linha e tab passam.
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const semControle = (texto: string) => !CONTROLE.test(texto);
const MSG_CONTROLE = "Tem caracteres inválidos.";

/** Texto opcional: vazio, ausente ou null viram null (a API devolve null e aceita null de volta). */
const textoOpcional = (campo: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${campo} é longo demais.`)
    .refine(semControle, MSG_CONTROLE)
    .nullish()
    .transform((valor) => (valor ? valor : null));

/**
 * Data da compra: dia real ("AAAA-MM-DD"), de 2020 até hoje (horário de Brasília). Sem data, vale
 * hoje no relógio do SERVIDOR: uma aba aberta de um dia para o outro não grava a data de ontem.
 * Data futura não entra: o Resultado do Financeiro somaria um gasto que ainda não aconteceu.
 */
const dataDespesaSchema = z
  .iso.date("Data inválida.")
  .optional()
  .transform((dia) => dia ?? hojeNaLoja())
  .refine((dia) => dia >= "2020-01-01", { message: "Use uma data de 2020 em diante." })
  .refine((dia) => dia <= hojeNaLoja(), { message: "A data da compra não pode ser depois de hoje." });

/**
 * Despesa da loja (ex.: Adesivos, 50 un, R$ 20,00). O valor viaja em CENTAVOS inteiros, para não
 * haver erro de arredondamento; a quantidade aceita até 3 casas (2,5 kg; 0,250 kg).
 */
export const despesaSchema = z.object({
  descricao: textoObrigatorio("o que foi comprado", 120).refine(semControle, MSG_CONTROLE),
  categoria: z.enum(CATEGORIAS_DESPESA, { error: "Escolha uma categoria." }),
  quantidade: z
    .number({ error: "Informe a quantidade." })
    // 0,001 é o menor valor que a coluna DECIMAL(12,3) guarda; abaixo disso viraria 0 e quebraria a CHECK.
    .min(0.001, "A quantidade deve ser maior que zero (mínimo 0,001).")
    .max(1_000_000, "Quantidade grande demais.")
    .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, { message: "Use no máximo 3 casas decimais." }),
  unidade: z.enum(UNIDADES_DESPESA, { error: "Escolha a unidade." }),
  valorCentavos: z
    .number({ error: "Informe o valor pago." })
    .int("Valor inválido.")
    .min(1, "Informe o valor pago.")
    .max(100_000_000, "Valor grande demais (máximo de R$ 1.000.000,00)."),
  data: dataDespesaSchema,
  fornecedor: textoOpcional("O fornecedor", 80),
  observacao: textoOpcional("A observação", 300),
  /** Compra de insumo (opcional): liga a despesa ao estoque da Produção. */
  insumoId: z.string().min(1).max(100).nullish().transform((v) => v ?? null),
  /**
   * Quanto entrou no estoque, na unidade do insumo (2,155 kg → 2155 g). Sem isso, o servidor converte
   * kg→g e L→mL sozinho; para pacote/caixa é preciso informar.
   */
  quantidadeBase: z
    .number()
    .min(0.001, "Informe quanto entrou no estoque.")
    .max(1_000_000_000, "Quantidade grande demais.")
    .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, { message: "Use no máximo 3 casas decimais." })
    .nullish()
    .transform((v) => v ?? null),
});

export type DespesaEntrada = z.infer<typeof despesaSchema>;

/**
 * Data da venda presencial: opcional e SEM valor padrão aqui. Ausente = hoje, resolvido no serviço
 * (registrarVendaPresencial), para um reenvio depois da meia-noite continuar sendo a mesma venda.
 * Retroativa até DIAS_RETROATIVOS dias; nada depois de hoje.
 */
const dataVendaSchema = z
  .iso.date("Data inválida.")
  .refine((dia) => dia >= diaMinimoDaVenda(), { message: `A venda pode ser de até ${DIAS_RETROATIVOS} dias atrás.` })
  .refine((dia) => dia <= hojeNaLoja(), { message: "A data da venda não pode ser depois de hoje." })
  .optional();

/** Texto opcional da venda: sem caracteres invisíveis/de controle (vão para a tela do admin). */
const textoOpcionalVenda = (max: number, mensagemLongo: string) =>
  z
    .string()
    .trim()
    .max(max, mensagemLongo)
    .refine(textoLivreValido, MSG_CONTROLE)
    .nullish()
    .transform((valor) => (valor ? valor : null));

const itemVendaSchema = z.object({
  productId: z.string().min(1).max(100),
  quantidade: z
    .number({ error: "Informe a quantidade." })
    .int("A quantidade deve ser um número inteiro.")
    .min(1, "Quantidade mínima: 1.")
    .max(MAX_POR_PRODUTO, `Quantidade máxima: ${MAX_POR_PRODUTO}.`),
  // Centavos inteiros (sem erro de arredondamento). Pode ser 0 num item (brinde dentro da venda).
  precoUnitarioCentavos: z
    .number({ error: "Informe o preço." })
    .int("Preço inválido.")
    .min(0, "O preço não pode ser negativo.")
    .max(
      MAX_PRECO_UNITARIO_CENTAVOS,
      `Preço alto demais (máximo de R$ ${(MAX_PRECO_UNITARIO_CENTAVOS / 100).toFixed(2).replace(".", ",")} por pote).`,
    ),
});

/**
 * Venda presencial (feira, balcão) lançada pelo admin: sem cliente cadastrado, endereço nem frete.
 * O preço de cada item vem do catálogo na tela, mas pode ser alterado (desconto de feira).
 */
export const vendaPresencialSchema = z
  .object({
    itens: z.array(itemVendaSchema).min(1, "Escolha pelo menos um produto.").max(MAX_ITENS_VENDA),
    formaPagamento: z.enum(FORMAS_PAGAMENTO, { error: "Escolha a forma de pagamento." }),
    status: z.enum(STATUS_INICIAIS_PRESENCIAL, { error: "A venda começa como Entregue ou Paga." }).default("ENTREGUE"),
    data: dataVendaSchema,
    clienteNome: textoOpcionalVenda(100, "O nome do cliente é longo demais."),
    observacao: textoOpcionalVenda(300, "A observação é longa demais."),
    /** Obrigatório (true) quando o total passa de LIMITE_CONFIRMACAO_CENTAVOS. */
    confirmarValorAlto: z.boolean().optional(),
  })
  // Uma linha por produto: juntar em silêncio esconderia preços diferentes para o mesmo sabor.
  .refine((v) => new Set(v.itens.map((i) => i.productId)).size === v.itens.length, {
    message: "O mesmo produto aparece mais de uma vez.",
    path: ["itens"],
  })
  // Brinde/amostra vai como despesa: uma "venda" de R$ 0 contaria como pedido pago e baixaria o ticket médio.
  .refine((v) => v.itens.some((i) => i.precoUnitarioCentavos > 0), {
    message: "A venda não pode ter total zero.",
    path: ["itens"],
  })
  // Valor alto só com confirmação: pega "99" digitado no lugar de "9" sem barrar atacado de verdade.
  .refine(
    (v) => v.confirmarValorAlto === true || v.itens.reduce((s, i) => s + i.quantidade * i.precoUnitarioCentavos, 0) <= LIMITE_CONFIRMACAO_CENTAVOS,
    {
      message: `Venda acima de R$ ${(LIMITE_CONFIRMACAO_CENTAVOS / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}: confirme o valor.`,
      path: ["confirmarValorAlto"],
    },
  );

export type VendaPresencialEntrada = z.infer<typeof vendaPresencialSchema>;
