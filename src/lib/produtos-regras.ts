/**
 * Regras puras do cadastro de produtos (servidor e navegador), testadas em testes/produtos.test.ts.
 */
import { z } from "zod";
import { MAX_PRECO_UNITARIO_CENTAVOS, textoLivreValido } from "@/lib/vendas";

/** Foto até 2 MB (o navegador já reduz para 800×800 em JPEG antes de enviar, ~100 KB). */
export const MAX_BYTES_FOTO = 2 * 1024 * 1024;
/** Lado da foto quadrada que o navegador envia. */
export const LADO_FOTO = 800;

/** Rótulo da caixinha do painel (e citado nos avisos do kit): o mesmo texto nos dois lugares. */
export const ROTULO_PERMITIDO_EM_KIT = "Pode entrar no Kit Presente";

// --- verso da foto (harmonizações e destaques) -------------------------------------------------
// Os limites fazem o texto caber no quadrado da foto (de ~330 px no celular a ~368 px no desktop):
// 2 títulos, 4 linhas e 3 itens de até 2 linhas cada, em text-sm.

/** Título público da lista de harmonizações (no verso e no painel). */
export const TITULO_HARMONIZACOES = "Harmoniza com";
/**
 * Título público da lista `destaques`. Não é "Benefícios": em alimento, a palavra sugere alegação de
 * saúde. Fica em constante para a dona trocar sem migração.
 */
export const TITULO_DESTAQUES = "Por que você vai gostar";
export const MAX_HARMONIZACOES = 4;
export const MAX_CARACTERES_HARMONIZACAO = 40;
export const MAX_DESTAQUES = 3;
export const MAX_CARACTERES_DESTAQUE = 70;
/** Cada item do verso tem pelo menos isto (depois de aparar). */
export const MIN_CARACTERES_ITEM_VERSO = 2;

/** Aviso do painel quando `avisosDeAlegacao` acha algo (não bloqueia o salvar). */
export const AVISO_ALEGACAO = "Evite promessas de saúde (ANVISA).";

/**
 * Termos de saúde, função ou composição que pedem cuidado no verso. `prefixo`: vale também com o
 * que vier depois ("digest" pega "digestivo"); senão, só a palavra inteira ("leve" não pega
 * "relevo"). Comparação sem acento e sem diferenciar maiúsculas. "Sem conservantes" não entra: a dona
 * confirmou que vale para todos os sabores (2026-10-21).
 */
const TERMOS_DE_ALEGACAO: readonly { termo: string; prefixo: boolean }[] = [
  { termo: "saudável", prefixo: false },
  { termo: "saudáveis", prefixo: false },
  { termo: "saúde", prefixo: false },
  { termo: "natural", prefixo: true },
  { termo: "sem açúcar", prefixo: false },
  { termo: "zero", prefixo: false },
  { termo: "diet", prefixo: false },
  { termo: "light", prefixo: false },
  { termo: "leve", prefixo: false },
  { termo: "fit", prefixo: false },
  { termo: "vitamina", prefixo: true },
  { termo: "fibra", prefixo: true },
  { termo: "proteína", prefixo: true },
  { termo: "antioxidante", prefixo: true },
  { termo: "imunidade", prefixo: true },
  { termo: "imunológic", prefixo: true },
  { termo: "digest", prefixo: true },
  { termo: "calmante", prefixo: true },
  { termo: "termogên", prefixo: true },
  { termo: "emagrec", prefixo: true },
  { termo: "detox", prefixo: true },
  { termo: "funcional", prefixo: true },
  { termo: "nutritiv", prefixo: true },
  { termo: "cura", prefixo: false },
  { termo: "curar", prefixo: false },
  { termo: "curativ", prefixo: true },
  { termo: "previne", prefixo: true },
  { termo: "prevenir", prefixo: false },
  { termo: "prevenção", prefixo: false },
];

/** Sem acento e em minúsculas, para comparar ("Saúde" e "saude" são a mesma coisa). */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const PADROES_DE_ALEGACAO = TERMOS_DE_ALEGACAO.map(({ termo, prefixo }) => ({
  termo,
  padrao: new RegExp(`(?:^|[^a-z0-9])${semAcento(termo).replace(/ /g, "\\s+")}${prefixo ? "" : "(?![a-z0-9])"}`),
}));

/**
 * Termos do texto que soam como alegação de saúde ou de composição (como estão na lista, com acento),
 * sem repetir. Lista vazia: nada a avisar. Serve para o painel avisar; o servidor não bloqueia.
 */
export function avisosDeAlegacao(texto: string): string[] {
  const normal = semAcento(texto);
  return PADROES_DE_ALEGACAO.filter((p) => p.padrao.test(normal)).map((p) => p.termo);
}
/** Rótulo da caixinha das lembrancinhas (e citado nos avisos da configuração). */
export const ROTULO_DISPONIVEL_EM_MINI = "Disponível em mini (lembrancinhas)";

/** "true"/"on"/true → true; "false"/false → false; ausente → undefined (fica como estava). */
const caixinhaOpcional = z.preprocess(
  (v) => (v === undefined || v === null ? undefined : v === true || v === "true" || v === "on"),
  z.boolean().optional(),
);

/** "Morango com Pedaços, 250g" → sabor "Morango com Pedaços" e peso "250g" (como no rótulo). */
export function separarNome(nome: string): { sabor: string; peso: string | null } {
  const i = nome.lastIndexOf(",");
  return i > 0 ? { sabor: nome.slice(0, i).trim(), peso: nome.slice(i + 1).trim() } : { sabor: nome, peso: null };
}

/** Nome na loja, no formato do rótulo: "Sabor, 112g". */
export function montarNome(sabor: string, pesoGramas: number): string {
  return `${sabor.trim()}, ${pesoGramas}g`;
}

/** Identificador legível, como os atuais ("abacaxi-com-pimenta-125g"). */
export function idParaProduto(sabor: string, pesoGramas: number): string {
  const base = sabor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return `${base || "produto"}-${pesoGramas}g`;
}

/** Foto enviada pelo painel (servida pela rota /fotos/<id>), e não um arquivo da pasta public. */
export function ehFotoEnviada(url: string): boolean {
  return url.startsWith("/fotos/");
}

export type TipoFoto = "image/jpeg" | "image/png" | "image/webp";

/** Tipo da imagem pelos primeiros bytes (o nome e o tipo declarados pelo navegador não são confiáveis). */
export function tipoDaImagem(bytes: Uint8Array): TipoFoto | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v)) return "image/png";
  const ascii = (inicio: number, fim: number) => String.fromCharCode(...bytes.slice(inicio, fim));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const textoDoProduto = (campo: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Informe ${campo}.`)
    .max(max, `Use no máximo ${max} caracteres.`)
    .refine(textoLivreValido, "Tem caracteres que não podem ser usados.");

/**
 * Lista do verso no formulário: um item por linha ("Queijo coalho\nTorradas"). Apara cada linha e
 * descarta as vazias. Campo ausente (ou null) é `undefined`: ao editar, a lista fica como estava;
 * `""` é a lista vazia (esvazia). Uma lista já pronta (array) passa direto para a validação.
 */
export function linhasDaLista(valor: unknown): unknown {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== "string") return valor;
  return valor
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
}

const chaveSemCaixa = (texto: string) => texto.toLocaleLowerCase("pt-BR");

/** Índice do primeiro item repetido (sem diferenciar maiúsculas), ou -1. */
function primeiroRepetido(itens: readonly string[]): number {
  const vistos = new Set<string>();
  for (const [i, item] of itens.entries()) {
    const chave = chaveSemCaixa(item);
    if (vistos.has(chave)) return i;
    vistos.add(chave);
  }
  return -1;
}

const listaDoVerso = (o: { nome: string; maxItens: number; maxCaracteres: number }) =>
  z.preprocess(
    linhasDaLista,
    z
      .array(
        z
          .string()
          .min(MIN_CARACTERES_ITEM_VERSO, `Cada linha precisa de pelo menos ${MIN_CARACTERES_ITEM_VERSO} caracteres.`)
          .max(o.maxCaracteres, `Cada linha pode ter no máximo ${o.maxCaracteres} caracteres.`)
          // textoLivreValido aceita tab e quebra de linha (descrição); num item de uma linha, não.
          .refine((v) => textoLivreValido(v) && !/[\t\r\n]/.test(v), "Tem caracteres que não podem ser usados."),
        { error: `Escreva ${o.nome} um por linha.` },
      )
      .max(o.maxItens, `No máximo ${o.maxItens} linhas em "${o.nome}".`)
      .superRefine((itens, ctx) => {
        const i = primeiroRepetido(itens);
        if (i >= 0) ctx.addIssue({ code: "custom", message: "Esta linha está repetida.", path: [i] });
      })
      .optional(),
  );

/** Campos do produto. O preço vem em centavos (inteiro), como na venda presencial. */
export const produtoSchema = z.object({
  sabor: textoDoProduto("o sabor", 2, 60).refine((v) => !v.includes(","), "Não use vírgula no sabor (ela separa o peso no rótulo)."),
  pesoGramas: z.coerce
    .number("Informe o peso em gramas.")
    .int("O peso é em gramas inteiros.")
    .min(1, "Informe o peso em gramas.")
    .max(5000, "Peso máximo: 5000 g."),
  precoCentavos: z.coerce
    .number("Informe o preço.")
    .int("Preço inválido.")
    .min(1, "Informe o preço.")
    .max(MAX_PRECO_UNITARIO_CENTAVOS, "Preço máximo: R$ 999,99."),
  descricao: textoDoProduto("a descrição", 2, 300),
  ativo: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  /**
   * "Pode entrar no Kit Presente". Sem o campo (formulário de antes desta versão), `undefined`: ao
   * editar, fica como estava; ao criar, nasce fora do kit (default do banco).
   */
  permitidoEmKit: caixinhaOpcional,
  /** Verso da foto: "Harmoniza com" (até 4 linhas de 40). Ausente: não mexe; "": esvazia. */
  harmonizacoes: listaDoVerso({ nome: TITULO_HARMONIZACOES, maxItens: MAX_HARMONIZACOES, maxCaracteres: MAX_CARACTERES_HARMONIZACAO }),
  /** Verso da foto: "Por que você vai gostar" (até 3 linhas de 70). Ausente: não mexe; "": esvazia. */
  destaques: listaDoVerso({ nome: TITULO_DESTAQUES, maxItens: MAX_DESTAQUES, maxCaracteres: MAX_CARACTERES_DESTAQUE }),
  /**
   * "Disponível em mini (lembrancinhas)". Sem o campo (formulário de antes desta versão), `undefined`:
   * ao editar, fica como estava; ao criar, nasce desmarcado (default do banco).
   */
  disponivelEmMini: caixinhaOpcional,
});

export type ProdutoEntrada = z.output<typeof produtoSchema>;
