"use client";

import { useSyncExternalStore } from "react";
import { agruparKits, chaveDoKit, economiaDoKit, emCentavos, normalizarComposicao, somarConteudo } from "@/lib/kits-regras";
import { MAX_KITS_POR_PEDIDO, MAX_LINHAS_DE_KIT, MAX_POR_PRODUTO, MAX_POTES_POR_KIT } from "@/lib/limites";

export type ItemCarrinho = {
  productId: string;
  nome: string;
  /** Preço unitário em reais (só para exibição; o servidor recalcula). */
  preco: number;
  pesoGramas: number;
  /** Caminho interno (começa com "/"), nunca uma URL externa. */
  imagemUrl: string;
  quantidade: number;
};

export type CotacaoEntrega = {
  cep: string;
  valor: number;
  regiao: string;
  /** Peso do carrinho no momento da cotação: se mudar, a cotação fica velha. */
  pesoTotalGramas: number;
  endereco?: { rua: string; bairro: string; cidade: string; estado: string };
};

/** Potes de um sabor dentro de UMA caixa de kit (o que a tela precisa para mostrar e somar). */
export type SaborDoKitCarrinho = {
  productId: string;
  nome: string;
  quantidade: number;
  pesoGramas: number;
  /** Preço avulso do sabor em reais (só para mostrar a economia; o servidor recalcula). */
  precoAvulso: number;
  /** Caminho interno (começa com "/"), nunca uma URL externa. */
  imagemUrl: string;
};

/** N caixas iguais de um kit (mesmo kit e mesma composição = uma linha). */
export type KitCarrinho = {
  kitId: string;
  nome: string;
  /** Preço de UMA caixa em reais (só para exibição; o servidor recalcula). */
  preco: number;
  pesoCaixaGramas: number;
  /** Composição de UMA caixa, normalizada (sabores juntos e em ordem de id). */
  sabores: SaborDoKitCarrinho[];
  /** Caixas. */
  quantidade: number;
  /** Identidade da caixa (`chaveDoKit`): recalculada a cada leitura, nunca confiada do armazenamento. */
  chave: string;
};

export type EstadoCarrinho = {
  itens: ItemCarrinho[];
  /** Caixas de kit; o carrinho gravado antes dos kits não tem o campo e vira []. */
  kits: KitCarrinho[];
  /** Só dígitos (até 8). */
  cep: string;
  cotacao: CotacaoEntrega | null;
};

const CHAVE = "geleio:carrinho:v1";
/** O carrinho (e o CEP) guardados no navegador expiram: dados de localização não ficam para sempre. */
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
const VAZIO: EstadoCarrinho = { itens: [], kits: [], cep: "", cotacao: null };

// --- persistência -----------------------------------------------------------

/** Caminho interno do próprio site: "/produtos/x.svg" sim; "https://..." e "//host/..." não. */
const caminhoInterno = (valor: string) => valor.startsWith("/") && !valor.startsWith("//") && !valor.includes("\\");

function sanitizarEndereco(dado: unknown): CotacaoEntrega["endereco"] {
  if (!dado || typeof dado !== "object") return undefined;
  const e = dado as Record<string, unknown>;
  const campos = [e.rua, e.bairro, e.cidade, e.estado];
  if (!campos.every((c) => typeof c === "string")) return undefined;
  return { rua: e.rua as string, bairro: e.bairro as string, cidade: e.cidade as string, estado: e.estado as string };
}

const precoValido = (n: number) => Number.isFinite(n) && n >= 0;
const gramasValidas = (n: number) => Number.isInteger(n) && n >= 0;

function sanitizarSabor(dado: unknown): SaborDoKitCarrinho | null {
  if (!dado || typeof dado !== "object") return null;
  const s = dado as Record<string, unknown>;
  const quantidade = Number(s.quantidade);
  const pesoGramas = Number(s.pesoGramas);
  const precoAvulso = Number(s.precoAvulso);
  if (
    typeof s.productId !== "string" ||
    typeof s.nome !== "string" ||
    typeof s.imagemUrl !== "string" ||
    !caminhoInterno(s.imagemUrl) ||
    !Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_POTES_POR_KIT ||
    !gramasValidas(pesoGramas) ||
    !precoValido(precoAvulso)
  ) {
    return null;
  }
  return { productId: s.productId, nome: s.nome, quantidade, pesoGramas, precoAvulso, imagemUrl: s.imagemUrl };
}

/**
 * Caixas guardadas no navegador: descarta a linha malformada (inclusive foto que não seja caminho
 * interno), junta as caixas iguais numa linha só (`agruparKits`, que recalcula a chave) e respeita os
 * tetos do pedido. Quem confere a composição de verdade (potes certos, sabores à venda) é o servidor.
 */
function sanitizarKits(dado: unknown): KitCarrinho[] {
  const linhas = (Array.isArray(dado) ? dado : []).flatMap((k): Omit<KitCarrinho, "chave">[] => {
    if (!k || typeof k !== "object") return [];
    const x = k as Record<string, unknown>;
    const quantidade = Number(x.quantidade);
    const preco = Number(x.preco);
    const pesoCaixaGramas = Number(x.pesoCaixaGramas);
    const brutos = Array.isArray(x.sabores) ? x.sabores : [];
    const sabores = brutos.map(sanitizarSabor);
    if (
      typeof x.kitId !== "string" ||
      typeof x.nome !== "string" ||
      !Number.isInteger(quantidade) || quantidade < 1 ||
      !precoValido(preco) ||
      !gramasValidas(pesoCaixaGramas) ||
      sabores.length === 0 ||
      sabores.some((s) => s === null)
    ) {
      return [];
    }
    const validos = sabores as SaborDoKitCarrinho[];
    if (validos.reduce((soma, s) => soma + s.quantidade, 0) > MAX_POTES_POR_KIT) return [];
    return [{ kitId: x.kitId, nome: x.nome, preco, pesoCaixaGramas, sabores: validos, quantidade }];
  });
  return agruparKits(linhas)
    .slice(0, MAX_LINHAS_DE_KIT)
    .map((k) => ({ ...k, quantidade: Math.min(k.quantidade, MAX_KITS_POR_PEDIDO) }));
}

function sanitizar(dado: unknown): EstadoCarrinho {
  if (!dado || typeof dado !== "object") return VAZIO;
  const bruto = dado as Record<string, unknown>;

  // Expirado: começa do zero.
  if (typeof bruto.atualizadoEm === "number" && Date.now() - bruto.atualizadoEm > VALIDADE_MS) return VAZIO;

  const itens = (Array.isArray(bruto.itens) ? bruto.itens : []).flatMap((i): ItemCarrinho[] => {
    if (!i || typeof i !== "object") return [];
    const x = i as Record<string, unknown>;
    const quantidade = Number(x.quantidade);
    const preco = Number(x.preco);
    const peso = Number(x.pesoGramas);
    if (
      typeof x.productId !== "string" ||
      typeof x.nome !== "string" ||
      typeof x.imagemUrl !== "string" ||
      !caminhoInterno(x.imagemUrl) ||
      !Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_POR_PRODUTO ||
      !Number.isFinite(preco) || preco < 0 ||
      !Number.isInteger(peso) || peso < 0
    ) {
      return [];
    }
    return [{ productId: x.productId, nome: x.nome, imagemUrl: x.imagemUrl, quantidade, preco, pesoGramas: peso }];
  });

  const cep = typeof bruto.cep === "string" ? bruto.cep.replace(/\D/g, "").slice(0, 8) : "";

  let cotacao: CotacaoEntrega | null = null;
  const c = bruto.cotacao as Record<string, unknown> | null | undefined;
  if (
    c && typeof c === "object" &&
    typeof c.cep === "string" && typeof c.regiao === "string" &&
    Number.isFinite(Number(c.valor)) && Number.isFinite(Number(c.pesoTotalGramas))
  ) {
    cotacao = {
      cep: c.cep,
      regiao: c.regiao,
      valor: Number(c.valor),
      pesoTotalGramas: Number(c.pesoTotalGramas),
      endereco: sanitizarEndereco(c.endereco),
    };
  }

  return { itens, kits: sanitizarKits(bruto.kits), cep, cotacao };
}

// `getSnapshot` precisa devolver a MESMA referência enquanto nada mudou.
let cache: { bruto: string | null; estado: EstadoCarrinho } = { bruto: null, estado: VAZIO };
const ouvintes = new Set<() => void>();
// Se gravar no localStorage falhar (cota cheia, aba privada), o carrinho passa a valer só em memória
// nesta aba. Sem esta marca, a próxima leitura veria o armazenamento antigo e desfaria as mudanças.
let semPersistencia = false;

function ler(): EstadoCarrinho {
  if (semPersistencia) return cache.estado;

  let bruto: string | null = null;
  try {
    bruto = window.localStorage.getItem(CHAVE);
  } catch {
    // Armazenamento bloqueado (aba privada etc.): segue com o cache em memória.
    return cache.estado;
  }
  if (bruto === cache.bruto) return cache.estado;

  let estado = VAZIO;
  if (bruto) {
    try {
      estado = sanitizar(JSON.parse(bruto));
    } catch {
      estado = VAZIO;
    }
  }
  cache = { bruto, estado };
  return estado;
}

function escrever(estado: EstadoCarrinho) {
  const bruto = JSON.stringify({ ...estado, atualizadoEm: Date.now() });
  try {
    window.localStorage.setItem(CHAVE, bruto);
  } catch {
    semPersistencia = true;
  }
  cache = { bruto, estado };
  ouvintes.forEach((avisar) => avisar());
}

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  // Outra aba mudou o carrinho.
  const aoMudarEmOutraAba = (e: StorageEvent) => {
    if (e.key === CHAVE) avisar();
  };
  window.addEventListener("storage", aoMudarEmOutraAba);
  return () => {
    ouvintes.delete(avisar);
    window.removeEventListener("storage", aoMudarEmOutraAba);
  };
}

// --- ações ------------------------------------------------------------------

export const acoesCarrinho = {
  adicionar(produto: Omit<ItemCarrinho, "quantidade">) {
    const atual = ler();
    const existente = atual.itens.find((i) => i.productId === produto.productId);
    const itens = existente
      ? atual.itens.map((i) =>
          i.productId === produto.productId
            ? { ...i, quantidade: Math.min(i.quantidade + 1, MAX_POR_PRODUTO) }
            : i,
        )
      : [...atual.itens, { ...produto, quantidade: 1 }];
    escrever({ ...atual, itens });
  },

  definirQuantidade(productId: string, quantidade: number) {
    const atual = ler();
    const itens =
      quantidade < 1
        ? atual.itens.filter((i) => i.productId !== productId)
        : atual.itens.map((i) =>
            i.productId === productId ? { ...i, quantidade: Math.min(quantidade, MAX_POR_PRODUTO) } : i,
          );
    escrever({ ...atual, itens });
  },

  remover(productId: string) {
    const atual = ler();
    escrever({ ...atual, itens: atual.itens.filter((i) => i.productId !== productId) });
  },

  /**
   * Tira do carrinho o que saiu do catálogo (o servidor respondeu 422): os potes avulsos desses
   * produtos e as caixas cujo kit saiu (`kitIds`) OU que levam algum desses sabores.
   */
  removerVarios(productIds: string[], kitIds: string[] = []) {
    const atual = ler();
    const fora = new Set(productIds);
    const kitsFora = new Set(kitIds);
    escrever({
      ...atual,
      itens: atual.itens.filter((i) => !fora.has(i.productId)),
      kits: atual.kits.filter((k) => !kitsFora.has(k.kitId) && !k.sabores.some((s) => fora.has(s.productId))),
    });
  },

  /**
   * Aplica os dados atuais do catálogo (o servidor respondeu 409: algo mudou). Atualiza o preço e,
   * quando vier, também nome e peso: o peso define o frete (limite de 2 kg), então um peso velho
   * faria o servidor responder 409 de novo, indefinidamente. Nas caixas, atualiza o preço, o nome e
   * o peso da caixa (`kitsAtuais`) e o preço avulso, o nome e o peso de cada sabor.
   */
  atualizarPrecos(
    atuais: { productId: string; preco: number; nome?: string; pesoGramas?: number }[],
    kitsAtuais: { kitId: string; preco: number; nome?: string; pesoCaixaGramas?: number }[] = [],
  ) {
    const atual = ler();
    const porId = new Map(atuais.map((p) => [p.productId, p]));
    const kitPorId = new Map(kitsAtuais.map((k) => [k.kitId, k]));
    escrever({
      ...atual,
      itens: atual.itens.map((i) => {
        const novo = porId.get(i.productId);
        if (!novo) return i;
        return {
          ...i,
          preco: novo.preco,
          nome: novo.nome ?? i.nome,
          pesoGramas: Number.isInteger(novo.pesoGramas) ? novo.pesoGramas! : i.pesoGramas,
        };
      }),
      kits: atual.kits.map((k) => {
        const novo = kitPorId.get(k.kitId);
        return {
          ...k,
          preco: novo?.preco ?? k.preco,
          nome: novo?.nome ?? k.nome,
          pesoCaixaGramas: Number.isInteger(novo?.pesoCaixaGramas) ? novo!.pesoCaixaGramas! : k.pesoCaixaGramas,
          sabores: k.sabores.map((s) => {
            const sabor = porId.get(s.productId);
            if (!sabor) return s;
            return {
              ...s,
              precoAvulso: sabor.preco,
              nome: sabor.nome ?? s.nome,
              pesoGramas: Number.isInteger(sabor.pesoGramas) ? sabor.pesoGramas! : s.pesoGramas,
            };
          }),
        };
      }),
    });
  },

  /**
   * Põe uma caixa montada no carrinho. A mesma caixa (mesmo kit e mesma composição, em qualquer
   * ordem) soma na linha que já existe. Respeita os tetos do pedido e diz por que não coube.
   */
  adicionarKit(kit: Omit<KitCarrinho, "quantidade" | "chave">): { ok: true } | { ok: false; mensagem: string } {
    const atual = ler();
    const sabores = normalizarComposicao(kit.sabores);
    const chave = chaveDoKit(kit.kitId, sabores);
    const caixas = atual.kits.reduce((soma, k) => soma + k.quantidade, 0);
    if (caixas >= MAX_KITS_POR_PEDIDO) {
      return { ok: false, mensagem: `O carrinho já tem ${MAX_KITS_POR_PEDIDO} caixas, o máximo por pedido.` };
    }
    const existente = atual.kits.find((k) => k.chave === chave);
    if (!existente && atual.kits.length >= MAX_LINHAS_DE_KIT) {
      return { ok: false, mensagem: `O carrinho já tem ${MAX_LINHAS_DE_KIT} caixas diferentes, o máximo por pedido.` };
    }
    const kits = existente
      ? atual.kits.map((k) => (k.chave === chave ? { ...k, quantidade: k.quantidade + 1 } : k))
      : [...atual.kits, { ...kit, sabores, quantidade: 1, chave }];
    escrever({ ...atual, kits });
    return { ok: true };
  },

  /** Muda o número de caixas de uma linha; abaixo de 1, tira a linha. O total fica no teto do pedido. */
  definirQuantidadeKit(chave: string, quantidade: number) {
    const atual = ler();
    if (quantidade < 1) {
      escrever({ ...atual, kits: atual.kits.filter((k) => k.chave !== chave) });
      return;
    }
    const outras = atual.kits.reduce((soma, k) => soma + (k.chave === chave ? 0 : k.quantidade), 0);
    const teto = Math.max(1, MAX_KITS_POR_PEDIDO - outras);
    escrever({
      ...atual,
      kits: atual.kits.map((k) => (k.chave === chave ? { ...k, quantidade: Math.min(quantidade, teto) } : k)),
    });
  },

  removerKit(chave: string) {
    const atual = ler();
    escrever({ ...atual, kits: atual.kits.filter((k) => k.chave !== chave) });
  },

  definirCep(cep: string) {
    const atual = ler();
    const digitos = cep.replace(/\D/g, "").slice(0, 8);
    // Mudou o CEP: a cotação anterior não vale mais.
    const cotacao = atual.cotacao && atual.cotacao.cep === digitos ? atual.cotacao : null;
    escrever({ ...atual, cep: digitos, cotacao });
  },

  definirCotacao(cotacao: CotacaoEntrega | null) {
    escrever({ ...ler(), cotacao });
  },

  /** Esvazia tudo, inclusive CEP e cotação (depois de um pedido, e ao sair da conta). */
  limpar() {
    escrever(VAZIO);
  },
};

// --- hooks e derivados ------------------------------------------------------

export function useCarrinho(): EstadoCarrinho {
  return useSyncExternalStore(assinar, ler, () => VAZIO);
}

const semAssinatura = () => () => {};

/**
 * `false` no servidor e na hidratação, `true` depois. Enquanto for `false` o carrinho ainda não foi
 * lido do navegador (o snapshot do servidor é sempre "vazio"): use para mostrar um esqueleto em vez
 * de piscar "carrinho vazio".
 */
export function useHidratado(): boolean {
  return useSyncExternalStore(semAssinatura, () => true, () => false);
}

/** Quanto UMA caixa sai mais barata que os mesmos potes avulsos, e o preço desses avulsos (centavos). */
export function economiaDaCaixa(kit: Pick<KitCarrinho, "preco" | "sabores">): { economiaCentavos: number; avulsosCentavos: number } {
  const sabores = kit.sabores.map((s) => ({ quantidade: s.quantidade, precoAvulsoCentavos: emCentavos(s.precoAvulso) }));
  return {
    economiaCentavos: economiaDoKit(emCentavos(kit.preco), sabores),
    avulsosCentavos: sabores.reduce((soma, s) => soma + s.quantidade * s.precoAvulsoCentavos, 0),
  };
}

export function totaisDoCarrinho(estado: EstadoCarrinho) {
  // Uma caixa conta como 1 no número do carrinho (é o que a pessoa vê como "um item").
  const quantidadeTotal =
    estado.itens.reduce((soma, i) => soma + i.quantidade, 0) + estado.kits.reduce((soma, k) => soma + k.quantidade, 0);
  // A MESMA conta do servidor (`somarConteudo`, em centavos inteiros): se divergisse, o total da tela
  // e o cobrado nunca bateriam e o checkout cairia em 409 sem fim.
  const { subtotalCentavos, pesoTotalGramas } = somarConteudo({
    avulsos: estado.itens.map((i) => ({ quantidade: i.quantidade, precoCentavos: emCentavos(i.preco), pesoGramas: i.pesoGramas })),
    kits: estado.kits.map((k) => ({
      quantidade: k.quantidade,
      precoCentavos: emCentavos(k.preco),
      pesoCaixaGramas: k.pesoCaixaGramas,
      sabores: k.sabores,
    })),
  });
  const caixas = estado.kits.reduce((soma, k) => soma + k.quantidade, 0);
  const economiaKitsCentavos = estado.kits.reduce((soma, k) => soma + k.quantidade * economiaDaCaixa(k).economiaCentavos, 0);
  // A cotação só vale se foi feita para o mesmo CEP e o mesmo peso.
  const cotacaoValida =
    estado.cotacao && estado.cotacao.cep === estado.cep && estado.cotacao.pesoTotalGramas === pesoTotalGramas
      ? estado.cotacao
      : null;
  const entrega = cotacaoValida?.valor ?? null;
  const totalCentavos = entrega === null ? null : subtotalCentavos + Math.round(entrega * 100);
  return {
    quantidadeTotal,
    /** Nada no carrinho (nem pote avulso nem caixa). */
    vazio: estado.itens.length === 0 && estado.kits.length === 0,
    /** Caixas de kit (soma das linhas): o pedido aceita até MAX_KITS_POR_PEDIDO. */
    caixas,
    /** Quanto as caixas saem mais baratas que os mesmos potes avulsos (centavos, nunca negativo). */
    economiaKitsCentavos,
    subtotal: subtotalCentavos / 100,
    subtotalCentavos,
    pesoTotalGramas,
    cotacaoValida,
    cotacaoVelha: Boolean(estado.cotacao) && !cotacaoValida && estado.cotacao?.cep === estado.cep,
    entrega,
    total: totalCentavos === null ? null : totalCentavos / 100,
    /** Total em centavos (inteiro), enviado ao servidor como `totalEsperadoCentavos`. */
    totalCentavos,
  };
}
