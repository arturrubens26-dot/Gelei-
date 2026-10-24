import { FUSO_LOJA, formatarDia } from "@/lib/despesas";

/**
 * Datas das encomendas para as telas (servidor e navegador), sempre no horário da loja.
 * "AAAA-MM-DD" vira um instante ao meio-dia de Teresina, então o dia da semana nunca escorrega.
 */

const semana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_LOJA, weekday: "long" });

/** "2026-11-07" → "sábado, 07/11/2026". */
export function diaComSemana(dia: string): string {
  return `${semana.format(new Date(`${dia}T12:00:00-03:00`))}, ${formatarDia(dia)}`;
}

/** "2026-11-07" → "07/11". */
export const diaCurto = (dia: string) => formatarDia(dia).slice(0, 5);

/** 24 → "24 horas"; 1 → "1 hora"; 0,5 → "30 minutos"; 3,5 → "3,5 horas". */
export function textoDeHoras(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)} minutos`;
  const texto = Number.isInteger(horas) ? String(horas) : horas.toFixed(1).replace(".", ",");
  return `${texto} ${horas === 1 ? "hora" : "horas"}`;
}
