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

const soDigitos = (valor: string) => valor.replace(/\D/g, "");

/** CNPJ com os 14 dígitos e os dois dígitos verificadores certos (com ou sem máscara). */
export function cnpjValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) {
      soma += Number(c) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(d.slice(0, 12)) === Number(d[12]) && digito(d.slice(0, 13)) === Number(d[13]);
}

/** CPF com os 11 dígitos e os dois dígitos verificadores certos (com ou sem máscara). */
export function cpfValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** O documento da loja é um CNPJ ou um CPF válido? */
export const documentoValido = (valor: string) => cnpjValido(valor) || cpfValido(valor);

/** Formato de e-mail (um @, domínio com ponto e TLD de letras, sem pontos repetidos): não prova que a caixa existe. */
export function emailValido(valor: string): boolean {
  const email = valor.trim();
  if (email.length > 254 || /\s/.test(email) || (email.match(/@/g) ?? []).length !== 1) return false;
  const [local, dominio] = email.split("@");
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const partes = dominio.split(".");
  return (
    partes.length >= 2 &&
    partes.every((p) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(p)) &&
    /^[A-Za-z]{2,}$/.test(partes[partes.length - 1])
  );
}

/**
 * O que falta para cumprir o art. 2º do Decreto 7.962/2013; lista vazia = completo. Vazio bloqueia (a
 * constante nasce vazia); preenchido, precisa ter o FORMATO certo: CNPJ ou CPF com os dígitos
 * verificadores e e-mail de verdade. Assim um "123" ou "contato@" digitado às pressas não abre a loja.
 */
export function pendenciasLegais(dados: DadosLegais = dadosLegais): string[] {
  const faltam: string[] = [];
  const documento = dados.documento?.trim();
  if (!documento) faltam.push("o CNPJ (ou CPF) da loja");
  else if (!documentoValido(documento)) faltam.push("um CNPJ (ou CPF) válido da loja");
  const email = dados.email?.trim();
  if (!email) faltam.push("o e-mail de contato");
  else if (!emailValido(email)) faltam.push("um e-mail de contato válido");
  return faltam;
}
