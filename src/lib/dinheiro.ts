const formatadorBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata um valor em reais: 24.9 → "R$ 24,90". */
export function formatarBRL(valor: number): string {
  return formatadorBRL.format(valor);
}

/** Arredonda para 2 casas evitando erros de ponto flutuante (0.1 + 0.2). */
export function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

// --- leitura do que a pessoa digita ------------------------------------------

/**
 * Lê um número digitado no formato brasileiro, com até `casas` decimais, e devolve as partes em
 * texto (sem passar por float). Aceita "20", "20,5", "1.234,56" (ponto de milhar só em grupos de
 * 3), ",50" (= 0,50) e, por costume de teclado, ponto decimal sem milhar ("20.5").
 * Recusa o malformado ou ambíguo, em vez de adivinhar: "1.2345", "12.34,56", "1.5.0".
 */
export function lerNumeroBrasileiro(texto: string, casas: number): { inteiro: string; decimal: string } | null {
  let t = texto.replace(/R\$/gi, "").replace(/\s/g, "");
  if (/^[.,]\d/.test(t)) t = `0${t}`;
  const brasileiro = new RegExp(`^([1-9]\\d{0,2}(?:\\.\\d{3})+|\\d+)(?:,(\\d{1,${casas}}))?$`).exec(t);
  if (brasileiro) return { inteiro: brasileiro[1].replace(/\./g, ""), decimal: brasileiro[2] ?? "" };
  const pontoDecimal = new RegExp(`^(\\d+)\\.(\\d{1,${casas}})$`).exec(t);
  if (pontoDecimal) return { inteiro: pontoDecimal[1], decimal: pontoDecimal[2] };
  return null;
}

/**
 * "20" | "20,00" | "R$ 1.234,56" | "20.5" | ",50" → centavos (2000, 2000, 123456, 2050, 50).
 * Malformado ("0.299", "1.2,50", "12.34.56") → null: melhor recusar que gravar outro valor.
 */
export function lerValorEmCentavos(texto: string): number | null {
  const partes = lerNumeroBrasileiro(texto, 2);
  if (!partes) return null;
  // Inteiros, sem multiplicar float: "0.29" * 100 daria 28,999….
  return Number(partes.inteiro) * 100 + Number(partes.decimal.padEnd(2, "0"));
}

/** Valor em reais para pôr de volta num campo: 20 → "20,00". */
export function valorParaCampo(reais: number): string {
  return reais.toFixed(2).replace(".", ",");
}
