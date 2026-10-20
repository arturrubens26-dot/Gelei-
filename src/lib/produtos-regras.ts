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
  permitidoEmKit: z.preprocess(
    (v) => (v === undefined || v === null ? undefined : v === true || v === "true" || v === "on"),
    z.boolean().optional(),
  ),
});

export type ProdutoEntrada = z.output<typeof produtoSchema>;
