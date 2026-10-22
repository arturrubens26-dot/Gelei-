import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { COBRANCAS_DO_PAINEL, situacaoDoPagamentoNoPainel } from "@/lib/admin";
import { db } from "@/lib/db";
import type { ModoEntrega } from "@/lib/entrega-regras";
import type { PagamentoAdminDTO } from "@/lib/pagamentos-regras";
import { potesParaSeparar, type PoteParaSeparar } from "@/lib/kits-regras";
import type { StatusPedido } from "@/lib/status";
import { nomeDoCliente, type CanalPedido, type FormaPagamento } from "@/lib/vendas";

/** Ficha de um pedido no painel (/admin/orders/[id]): o que separar, para onde mandar e quanto custou. */

export type PedidoAdminDetalheDTO = {
  id: string;
  canal: CanalPedido;
  status: StatusPedido;
  createdAt: string;
  /** Online: nome e e-mail do cadastro. Presencial: "Venda presencial · nome digitado" e e-mail nulo. */
  cliente: { nome: string; email: string | null };
  /** Pedido online: entrega ou retirada na loja. Venda presencial: null. */
  modoEntrega: ModoEntrega | null;
  /** WhatsApp da cliente (só dígitos; linkWhatsApp e formatarTelefone). Null na presencial e nos antigos. */
  telefone: string | null;
  /** Endereço de entrega. A retirada e a venda presencial não têm: `null`. */
  endereco: {
    cep: string;
    rua: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    cidade: string;
    estado: string;
  } | null;
  /** Venda presencial; no pedido online (pago pelo site, ver `pagamento`) é `null`. */
  formaPagamento: FormaPagamento | null;
  observacao: string | null;
  /** Potes avulsos. Valores em reais. */
  itens: { productId: string; nome: string; quantidade: number; precoUnitario: number; subtotal: number; imagemUrl: string }[];
  /** Caixas de kit, com a composição de UMA caixa e a foto real de cada sabor (miniatura). */
  kits: {
    id: string;
    kitId: string;
    nome: string;
    quantidade: number;
    precoUnitario: number;
    subtotal: number;
    sabores: { productId: string; nome: string; quantidade: number; imagemUrl: string }[];
  }[];
  /** "Separar…": caixas a montar e potes de cada sabor (avulsos + dentro das caixas). */
  separar: { caixas: number; potes: PoteParaSeparar[] };
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** Pedido online PENDENTE com mais de 48 h: não abre mais link de pagamento (selo "Expirado"). */
  expirado: boolean;
  /** Pagamento pelo site já confirmado (método, parcelas, valor pago e alerta). Null sem cobrança aprovada. */
  pagamento: PagamentoAdminDTO | null;
};

const incluirFicha = {
  user: { select: { nome: true, email: true } },
  address: true,
  pagamentos: COBRANCAS_DO_PAINEL,
  items: { orderBy: { productId: "asc" }, include: { product: { select: { nome: true, imagemUrl: true } } } },
  kits: {
    orderBy: { id: "asc" },
    include: {
      kit: { select: { nome: true } },
      sabores: { orderBy: { productId: "asc" }, include: { product: { select: { nome: true, imagemUrl: true } } } },
    },
  },
} satisfies Prisma.OrderInclude;

/** Ficha do pedido (online ou presencial); `null` se não existir. */
export async function detalhePedidoAdmin(id: string): Promise<PedidoAdminDetalheDTO | null> {
  // Ids são cuid (~25 caracteres): um id absurdo nem vai ao banco.
  if (id.length === 0 || id.length > 100) return null;
  const p = await db.order.findUnique({ where: { id }, include: incluirFicha });
  if (!p) return null;

  const itens = p.items.map((i) => ({
    productId: i.productId,
    nome: i.product.nome,
    quantidade: i.quantidade,
    precoUnitario: i.precoUnitario.toNumber(),
    subtotal: i.precoUnitario.mul(i.quantidade).toNumber(),
    imagemUrl: i.product.imagemUrl,
  }));
  const kits = p.kits.map((k) => ({
    id: k.id,
    kitId: k.kitId,
    nome: k.kit.nome,
    quantidade: k.quantidade,
    precoUnitario: k.precoUnitario.toNumber(),
    subtotal: k.precoUnitario.mul(k.quantidade).toNumber(),
    sabores: k.sabores.map((s) => ({
      productId: s.productId,
      nome: s.product.nome,
      quantidade: s.quantidade,
      imagemUrl: s.product.imagemUrl,
    })),
  }));

  return {
    id: p.id,
    canal: p.canal,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    cliente: { nome: nomeDoCliente(p), email: p.user?.email ?? null },
    modoEntrega: p.modoEntrega,
    telefone: p.telefone,
    endereco: p.address
      ? {
          cep: p.address.cep,
          rua: p.address.rua,
          numero: p.address.numero,
          complemento: p.address.complemento,
          bairro: p.address.bairro,
          cidade: p.address.cidade,
          estado: p.address.estado,
        }
      : null,
    formaPagamento: p.formaPagamento,
    observacao: p.observacao,
    itens,
    kits,
    separar: potesParaSeparar({ avulsos: itens, kits }),
    subtotal: p.total.sub(p.deliveryFee).toNumber(),
    deliveryFee: p.deliveryFee.toNumber(),
    total: p.total.toNumber(),
    ...situacaoDoPagamentoNoPainel(p),
  };
}
