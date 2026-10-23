/**
 * Dados públicos da loja (rodapé, contato e, no futuro, os dados estruturados do Google).
 * O Decreto 7.962/2013 pede no site o nome, o CNPJ (ou CPF), o endereço e um contato do
 * fornecedor. Pendentes (2026-10-19): o CNPJ (a dona vai abrir um MEI) e o e-mail de contato.
 */
export const dadosLoja = {
  endereco: {
    logradouro: "Rua Paulo Veloso do Vale, 6935",
    bairro: "Brasilar",
    cidade: "Teresina",
    uf: "PI",
    cep: "64035-420",
  },
  instagram: {
    usuario: "ge.leio",
    url: "https://www.instagram.com/ge.leio/",
  },
} as const;

export type DadosLegais = {
  /** CNPJ (do MEI) ou CPF, como deve aparecer no site. */
  documento: string | null;
  /** E-mail de contato da loja. */
  email: string | null;
};

/**
 * CNPJ/CPF e e-mail de contato: o Decreto 7.962/2013 (art. 2º) pede os dois no site de quem vende pela
 * internet. PENDENTES: preencha aqui quando a dona informar. Enquanto faltarem, o painel avisa e NÃO
 * deixa abrir as encomendas de lembrancinhas (decisão D13).
 */
export const dadosLegais: DadosLegais = {
  documento: null,
  email: null,
};

/** O que falta para cumprir o art. 2º do Decreto 7.962/2013; lista vazia = completo. */
export function pendenciasLegais(dados: DadosLegais = dadosLegais): string[] {
  const faltam: string[] = [];
  if (!dados.documento?.trim()) faltam.push("o CNPJ (ou CPF) da loja");
  if (!dados.email?.trim()) faltam.push("o e-mail de contato");
  return faltam;
}
