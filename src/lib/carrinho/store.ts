"use client";

import { useSyncExternalStore } from "react";
import { MAX_POR_PRODUTO } from "@/lib/limites";

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

export type EstadoCarrinho = {
  itens: ItemCarrinho[];
  /** Só dígitos (até 8). */
  cep: string;
  cotacao: CotacaoEntrega | null;
};

const CHAVE = "geleio:carrinho:v1";
/** O carrinho (e o CEP) guardados no navegador expiram: dados de localização não ficam para sempre. */
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
const VAZIO: EstadoCarrinho = { itens: [], cep: "", cotacao: null };

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

  return { itens, cep, cotacao };
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

  /** Tira do carrinho produtos que saíram do catálogo (o servidor respondeu 422). */
  removerVarios(productIds: string[]) {
    const atual = ler();
    const fora = new Set(productIds);
    escrever({ ...atual, itens: atual.itens.filter((i) => !fora.has(i.productId)) });
  },

  /**
   * Aplica os dados atuais do catálogo (o servidor respondeu 409: algo mudou). Atualiza o preço e,
   * quando vier, também nome e peso: o peso define o frete (limite de 2 kg), então um peso velho
   * faria o servidor responder 409 de novo, indefinidamente.
   */
  atualizarPrecos(atuais: { productId: string; preco: number; nome?: string; pesoGramas?: number }[]) {
    const atual = ler();
    const porId = new Map(atuais.map((p) => [p.productId, p]));
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
    });
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

export function totaisDoCarrinho(estado: EstadoCarrinho) {
  const quantidadeTotal = estado.itens.reduce((soma, i) => soma + i.quantidade, 0);
  const subtotalCentavos = estado.itens.reduce((soma, i) => soma + Math.round(i.preco * 100) * i.quantidade, 0);
  const pesoTotalGramas = estado.itens.reduce((soma, i) => soma + i.pesoGramas * i.quantidade, 0);
  // A cotação só vale se foi feita para o mesmo CEP e o mesmo peso.
  const cotacaoValida =
    estado.cotacao && estado.cotacao.cep === estado.cep && estado.cotacao.pesoTotalGramas === pesoTotalGramas
      ? estado.cotacao
      : null;
  const entrega = cotacaoValida?.valor ?? null;
  const totalCentavos = entrega === null ? null : subtotalCentavos + Math.round(entrega * 100);
  return {
    quantidadeTotal,
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
