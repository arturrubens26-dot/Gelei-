/**
 * Cálculo de frete SIMULADO. Regras de negócio puras, sem framework: a rota
 * `/api/delivery/calculate` e a criação de pedidos usam esta mesma função, de
 * modo que o valor cobrado no pedido é sempre o calculado no servidor.
 *
 * Futuramente trocar por uma integração real (Correios, Loggi) mantendo a
 * assinatura de `calcularFrete`.
 */

export const REGRAS_FRETE = {
  /** Prefixos de CEP com taxa própria (valores em centavos). */
  porPrefixo: [
    { prefixo: "01", rotulo: "São Paulo (capital)", centavos: 1500 },
    { prefixo: "20", rotulo: "Rio de Janeiro (capital)", centavos: 2500 },
  ],
  /** Taxa para qualquer outro CEP (valor provisório da simulação). */
  padraoCentavos: 3000,
  /** Acima deste peso total (em gramas) soma-se o adicional abaixo. */
  limitePesoGramas: 2000,
  adicionalPesoCentavos: 500,
} as const;

export type CotacaoFrete = {
  /** Valor total do frete, em reais. */
  valor: number;
  taxaBase: number;
  adicionalPeso: number;
  regiao: string;
  pesoTotalGramas: number;
};

export function calcularFrete(cep: string, pesoTotalGramas: number): CotacaoFrete {
  const regra = REGRAS_FRETE.porPrefixo.find((r) => cep.startsWith(r.prefixo));
  const baseCentavos = regra?.centavos ?? REGRAS_FRETE.padraoCentavos;
  const extraCentavos =
    pesoTotalGramas > REGRAS_FRETE.limitePesoGramas ? REGRAS_FRETE.adicionalPesoCentavos : 0;

  return {
    valor: (baseCentavos + extraCentavos) / 100,
    taxaBase: baseCentavos / 100,
    adicionalPeso: extraCentavos / 100,
    regiao: regra?.rotulo ?? "Demais regiões",
    pesoTotalGramas,
  };
}
