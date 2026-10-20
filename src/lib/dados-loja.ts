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
    usuario: "geleio0",
    url: "https://www.instagram.com/geleio0/",
  },
} as const;
