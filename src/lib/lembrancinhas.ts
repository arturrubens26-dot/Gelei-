import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { ConfigLembrancinhas } from "@/generated/prisma/client";
import { e2eDadosLegaisAtivo } from "@/lib/ambiente";
import { pendenciasLegais } from "@/lib/dados-loja";
import { origemDaApiDeTeste } from "@/lib/infinitepay";
import { db } from "@/lib/db";
import { POLITICA_VERSAO } from "@/lib/encomendas-politica";
import { MAX_POTINHOS, MIN_POTINHOS } from "@/lib/encomendas-regras";
import { pagamentoOnlineDisponivel } from "@/lib/pagamentos";
import { separarNome } from "@/lib/produtos-regras";

/** Id da linha única de configuração (criada DESATIVADA pela migração 20261023120000_lembrancinhas). */
export const ID_CONFIG_LEMBRANCINHAS = "lembrancinhas";

/** O que a página /lembrancinhas precisa (valores em reais e em centavos, para a conta da tela). */
export type LembrancinhasDTO = {
  /** A dona abriu as encomendas no painel (o link "Lembrancinhas" do cabeçalho aparece). */
  ativo: boolean;
  /**
   * Dá para solicitar agora: aberto, com pagamento pelo site e com algum sabor mini. Sem isso a
   * página mostra `motivoFechado` no lugar do formulário (a API responderia 503).
   */
  aceitandoSolicitacoes: boolean;
  motivoFechado: string | null;
  precoPotinho: number;
  precoPotinhoCentavos: number;
  pesoPotinhoGramas: number;
  pesoEmbalagemGramas: number;
  /** Quanto da entrada fica com a loja se a cliente desistir depois do corte: vai no texto da política. */
  percentualRetido: number;
  /** Versão do texto da política que a cliente lê e aceita (volta no POST, com o percentual). */
  politicaVersao: string;
  minPotinhos: number;
  maxPotinhos: number;
  /** Sabores à venda E marcados "disponível em mini", em ordem alfabética. */
  sabores: { productId: string; sabor: string; imagemUrl: string }[];
};

/**
 * O que falta em src/lib/dados-loja.ts para as lembrancinhas poderem abrir (D13). Lista vazia = pode.
 *
 * Só para o teste ponta a ponta local: com E2E_DADOS_LEGAIS=1, a InfinitePay FALSA configurada
 * (INFINITEPAY_API_URL em 127.0.0.1/localhost, que o código recusa em outro host) E a APP_URL em
 * http://localhost ou 127.0.0.1 (sem NETLIFY nem APP_ENV publicado: `e2eDadosLegaisAtivo`), a pendência é
 * ignorada, para o e2e criar encomendas pelo site. Fora disso, nada muda. Em outro ambiente, a variável
 * nem deixa o servidor subir (`validarAmbiente`).
 */
export function pendenciasParaAbrir(): string[] {
  if (e2eDadosLegaisAtivo() && origemDaApiDeTeste() !== null) return [];
  return pendenciasLegais();
}

/** A configuração como está no banco (sem cache): quem grava ou cobra lê daqui. `null` sem a linha. */
export async function lerConfigLembrancinhas(): Promise<ConfigLembrancinhas | null> {
  return db.configLembrancinhas.findUnique({ where: { id: ID_CONFIG_LEMBRANCINHAS } });
}

/** Motivo para a página não aceitar solicitações; `null` = aberta. A mesma ordem dos 503 da API. */
export function motivoLembrancinhasFechadas(entrada: {
  ativo: boolean;
  /** CNPJ/CPF ou e-mail da loja ainda faltando em src/lib/dados-loja.ts (D13). */
  dadosLegaisPendentes?: boolean;
  pagamentoDisponivel: boolean;
  sabores: number;
}): string | null {
  if (!entrada.ativo || entrada.dadosLegaisPendentes) return "As encomendas de lembrancinhas voltam em breve.";
  if (!entrada.pagamentoDisponivel) return "As encomendas pelo site ainda não estão abertas. Em breve você poderá encomendar por aqui.";
  if (entrada.sabores === 0) return "Nenhum sabor está disponível em mini no momento. Volte em breve.";
  return null;
}

/**
 * Configuração pública e sabores mini, em cache (`use cache`) como o catálogo. O painel expira na hora
 * com a tag "lembrancinhas" (configuração) e "produtos" (preço, visibilidade e "Disponível em mini").
 * Objetos simples: Decimal vira number para poder ir para o cache.
 */
export async function obterLembrancinhas(): Promise<LembrancinhasDTO> {
  "use cache";
  cacheLife("minutes");
  cacheTag("lembrancinhas", "produtos");

  const [config, produtos] = await Promise.all([
    lerConfigLembrancinhas(),
    db.product.findMany({
      where: { ativo: true, disponivelEmMini: true },
      orderBy: [{ nome: "asc" }, { id: "asc" }],
      select: { id: true, nome: true, imagemUrl: true },
    }),
  ]);
  const ativo = config?.ativo ?? false;
  const sabores = produtos.map((p) => ({ productId: p.id, sabor: separarNome(p.nome).sabor, imagemUrl: p.imagemUrl }));
  const motivoFechado = motivoLembrancinhasFechadas({
    ativo,
    dadosLegaisPendentes: pendenciasParaAbrir().length > 0,
    pagamentoDisponivel: pagamentoOnlineDisponivel(), sabores: sabores.length });
  // Centavos inteiros a partir do Decimal (sem passar por float).
  const precoPotinhoCentavos = config ? config.precoPotinho.mul(100).toNumber() : 0;
  return {
    ativo,
    aceitandoSolicitacoes: motivoFechado === null,
    motivoFechado,
    precoPotinho: precoPotinhoCentavos / 100,
    precoPotinhoCentavos,
    pesoPotinhoGramas: config?.pesoPotinhoGramas ?? 0,
    pesoEmbalagemGramas: config?.pesoEmbalagemGramas ?? 0,
    percentualRetido: config?.percentualRetido ?? 100,
    politicaVersao: POLITICA_VERSAO,
    minPotinhos: MIN_POTINHOS,
    maxPotinhos: MAX_POTINHOS,
    sabores,
  };
}
