/**
 * Regras puras da entrega e do telefone (servidor e navegador; sem rede e sem banco), testadas em
 * testes/entrega.test.ts. A taxa em vigor fica no banco (config_loja), editável no painel; aqui fica
 * o padrão e a conta.
 *
 * Decisão da dona (2026-10-21): entrega só em Teresina (CEP 64000-000 a 64099-999, prefixo 640) com
 * taxa fixa, ou retirada grátis na loja (endereço de src/lib/dados-loja.ts).
 */
import { dadosLoja } from "@/lib/dados-loja";

export const MODOS_ENTREGA = ["ENTREGA", "RETIRADA"] as const;
export type ModoEntrega = (typeof MODOS_ENTREGA)[number];

/** Taxa de entrega em Teresina quando o painel ainda não definiu outra (R$ 15,00). */
export const TAXA_ENTREGA_PADRAO_CENTAVOS = 1500;
/** Teto da taxa editável no painel (pega "1500" digitado como reais: R$ 1.500). */
export const MAX_TAXA_ENTREGA_CENTAVOS = 10_000;

/** Área de entrega: CEPs de Teresina começam com 640. */
export const PREFIXO_CEP_ATENDIDO = "640";
export const CIDADE_ATENDIDA = "Teresina";
export const UF_ATENDIDA = "PI";

export const ROTULO_MODO_ENTREGA: Record<ModoEntrega, string> = {
  ENTREGA: `Entrega em ${CIDADE_ATENDIDA}`,
  RETIRADA: "Retirada na loja",
};

export const MENSAGEM_FORA_DA_AREA =
  "Ainda não entregamos na sua região. Você pode retirar o pedido na loja, sem custo.";

/** Endereço de retirada em uma linha: "Rua Paulo Veloso do Vale, 6935 · Brasilar · Teresina/PI · CEP 64035-420". */
export function enderecoDeRetirada(): string {
  const e = dadosLoja.endereco;
  return `${e.logradouro} · ${e.bairro} · ${e.cidade}/${e.uf} · CEP ${e.cep}`;
}

/** Só os dígitos do CEP ("64035-420" → "64035420"). */
export function normalizarCep(cep: string): string {
  return cep.replace(/\D/g, "");
}

/** Entregamos neste CEP? (8 dígitos começando com 640.) */
export function cepAtendido(cep: string): boolean {
  const d = normalizarCep(cep);
  return d.length === 8 && d.startsWith(PREFIXO_CEP_ATENDIDO);
}

export type CalculoEntrega =
  | { ok: true; modo: ModoEntrega; freteCentavos: number }
  | { ok: false; motivo: "FORA_DA_AREA" | "SEM_CEP"; mensagem: string };

/**
 * Frete do pedido, em centavos. Retirada: 0, sem endereço. Entrega: a taxa do painel, só em
 * Teresina; fora dela, recusa (o servidor responde 422 e o checkout sugere a retirada).
 */
export function calcularFrete(entrada: { modo: ModoEntrega; cep?: string | null; taxaCentavos: number }): CalculoEntrega {
  if (entrada.modo === "RETIRADA") return { ok: true, modo: "RETIRADA", freteCentavos: 0 };
  if (!entrada.cep) return { ok: false, motivo: "SEM_CEP", mensagem: "Informe o CEP da entrega." };
  if (!cepAtendido(entrada.cep)) return { ok: false, motivo: "FORA_DA_AREA", mensagem: MENSAGEM_FORA_DA_AREA };
  return { ok: true, modo: "ENTREGA", freteCentavos: entrada.taxaCentavos };
}

/** A taxa que o painel pode gravar: centavos inteiros de 0 (entrega grátis) a R$ 100,00. */
export function taxaDeEntregaValida(centavos: number): boolean {
  return Number.isInteger(centavos) && centavos >= 0 && centavos <= MAX_TAXA_ENTREGA_CENTAVOS;
}

// --- telefone (WhatsApp da cliente) -----------------------------------------------------------

export const MENSAGEM_TELEFONE_INVALIDO = "Informe um WhatsApp com DDD, como (86) 99999-9999.";

/**
 * Só os dígitos, sem o +55 e sem o 0 da operadora: "+55 (86) 99999-9999" → "86999999999";
 * "086 3222-1234" → "8632221234". Não valida (ver `telefoneValido`).
 */
export function normalizarTelefone(texto: string): string {
  let d = texto.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * Telefone brasileiro com DDD, já normalizado: 11 dígitos (celular: DDD + 9 + 8 dígitos) ou 10
 * (fixo: DDD + 2 a 5 + 7 dígitos). DDD sem zero (11 a 99). Recusa todos os dígitos iguais.
 */
export function telefoneValido(digitos: string): boolean {
  if (!/^\d{10,11}$/.test(digitos)) return false;
  if (!/^[1-9][1-9]/.test(digitos)) return false;
  if (/^(\d)\1+$/.test(digitos)) return false;
  return digitos.length === 11 ? digitos[2] === "9" : /[2-5]/.test(digitos[2]);
}

/** "86999999999" → "(86) 99999-9999"; "8632221234" → "(86) 3222-1234". Outro formato: como veio. */
export function formatarTelefone(digitos: string): string {
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return digitos;
}

/** Máscara enquanto digita: "8699" → "(86) 99"; "86999999999" → "(86) 99999-9999". */
export function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return formatarTelefone(d);
}

/** Link para conversar no WhatsApp (painel): https://wa.me/5586999999999. */
export function linkWhatsApp(digitos: string): string {
  return `https://wa.me/55${digitos}`;
}

/** Os 4 últimos dígitos (conferência de identidade no painel, sem mostrar o número inteiro). */
export function finalDoTelefone(digitos: string | null | undefined): string | null {
  return digitos && digitos.length >= 4 ? digitos.slice(-4) : null;
}
