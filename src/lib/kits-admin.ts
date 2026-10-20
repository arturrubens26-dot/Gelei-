import "server-only";
import { revalidateTag } from "next/cache";
import { Prisma, type Kit } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { avisosDoKit, faixaDeEconomia, type KitEntrada } from "@/lib/kits-regras";
import { STATUS_PAGOS } from "@/lib/status";

/** Kits no painel (/admin/products, seção Kits): editar e mostrar/ocultar. Sem criar nem excluir na v1. */

export type KitAdminDTO = {
  id: string;
  nome: string;
  descricao: string;
  /** Preço de UMA caixa, em reais. */
  preco: number;
  potes: number;
  pesoCaixaGramas: number;
  ativo: boolean;
  /** Caixas em pedidos pagos (Pago, Enviado, Entregue). */
  caixasVendidas: number;
  /**
   * Economia, em reais, da caixa mais barata e da mais cara que dá para montar com os sabores que a
   * cliente pode escolher hoje (à venda e marcados "Pode entrar no Kit Presente"; nunca negativa).
   * `null` sem nenhum desses sabores.
   */
  economia: { minima: number; maxima: number } | null;
  /**
   * Avisos (não bloqueiam), num texto só, ou `null`: nenhum sabor pode entrar no kit; alguma caixa
   * não sai mais barata que os avulsos; ou a economia máxima passa de 30% do preço do kit.
   */
  aviso: string | null;
};

/**
 * Monta os DTOs com as caixas vendidas e a economia (preços avulsos, agora, dos sabores que podem
 * entrar no kit: à venda e com `permitidoEmKit`; os mesmos que o servidor aceita no pedido).
 */
async function paraDTOs(kits: Kit[]): Promise<KitAdminDTO[]> {
  if (kits.length === 0) return [];
  const [vendidas, produtos] = await Promise.all([
    db.orderKit.groupBy({
      by: ["kitId"],
      where: { kitId: { in: kits.map((k) => k.id) }, order: { status: { in: [...STATUS_PAGOS] } } },
      _sum: { quantidade: true },
    }),
    db.product.findMany({ where: { ativo: true, permitidoEmKit: true }, select: { preco: true } }),
  ]);
  const caixasPorKit = new Map(vendidas.map((v) => [v.kitId, v._sum.quantidade ?? 0]));
  // Centavos inteiros, sem passar por float (Decimal × 100).
  const precosAvulsos = produtos.map((p) => p.preco.mul(100).toNumber());

  return kits.map((k) => {
    const precoCentavos = k.preco.mul(100).toNumber();
    const faixa = faixaDeEconomia(precoCentavos, k.potes, precosAvulsos);
    return {
      id: k.id,
      nome: k.nome,
      descricao: k.descricao,
      preco: k.preco.toNumber(),
      potes: k.potes,
      pesoCaixaGramas: k.pesoCaixaGramas,
      ativo: k.ativo,
      caixasVendidas: caixasPorKit.get(k.id) ?? 0,
      economia: faixa ? { minima: faixa.minima / 100, maxima: faixa.maxima / 100 } : null,
      aviso: avisosDoKit(precoCentavos, k.potes, precosAvulsos),
    };
  });
}

/** A loja (página /kits, link do cabeçalho) lê os kits em cache: depois de mudar, expira na hora. */
function atualizarLoja(): void {
  revalidateTag("kits", { expire: 0 });
}

export async function listarKitsAdmin(): Promise<KitAdminDTO[]> {
  return paraDTOs(await db.kit.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }, { id: "asc" }] }));
}

async function atualizar(id: string, data: Prisma.KitUpdateInput): Promise<KitAdminDTO> {
  try {
    const kit = await db.kit.update({ where: { id }, data });
    atualizarLoja();
    return (await paraDTOs([kit]))[0];
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw new ErroNegocio(404, "Kit não encontrado.");
    throw e;
  }
}

/**
 * Edita nome, descrição, preço, peso da caixa e visibilidade. O preço novo vale para os pedidos
 * seguintes: cada pedido guarda o preço da caixa do dia (order_kits.preco_unitario).
 */
export async function atualizarKit(id: string, entrada: KitEntrada): Promise<KitAdminDTO> {
  return atualizar(id, {
    nome: entrada.nome,
    descricao: entrada.descricao,
    // Centavos inteiros → Decimal exato (sem passar por float).
    preco: new Prisma.Decimal(entrada.precoCentavos).div(100),
    pesoCaixaGramas: entrada.pesoCaixaGramas,
    ativo: entrada.ativo,
  });
}

/** Mostra ou oculta o kit na loja (os pedidos com ele continuam certos). */
export async function definirVisibilidadeKit(id: string, ativo: boolean): Promise<KitAdminDTO> {
  return atualizar(id, { ativo });
}
