import "server-only";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { hojeNaLoja } from "@/lib/despesas";
import { ErroNegocio } from "@/lib/erros";
import type { StatusPedido } from "@/lib/status";
import type { VendaPresencialEntrada } from "@/lib/validacao";
import { dataDaVenda, mesmaVenda, type FormaPagamento } from "@/lib/vendas";

export type VendaPresencialDTO = {
  id: string;
  status: StatusPedido;
  total: number;
  /** Data da venda (o dia informado; meio-dia de Brasília se for retroativa). */
  createdAt: string;
  /** Quando foi lançada no painel. */
  lancadoEm: string;
  formaPagamento: FormaPagamento;
  clienteNome: string | null;
  observacao: string | null;
  itens: { productId: string; nome: string; quantidade: number; precoUnitario: number; subtotal: number }[];
};

const incluirVenda = { items: { include: { product: { select: { nome: true } } } } } satisfies Prisma.OrderInclude;

type VendaComItens = Prisma.OrderGetPayload<{ include: typeof incluirVenda }>;

function paraVendaDTO(p: VendaComItens): VendaPresencialDTO {
  return {
    id: p.id,
    status: p.status,
    total: p.total.toNumber(),
    createdAt: p.createdAt.toISOString(),
    lancadoEm: (p.lancadoEm ?? p.createdAt).toISOString(),
    // O banco garante forma de pagamento na venda presencial (CHECK orders_canal_coerente).
    formaPagamento: p.formaPagamento!,
    clienteNome: p.clienteNome,
    observacao: p.observacao,
    itens: p.items.map((i) => ({
      productId: i.productId,
      nome: i.product.nome,
      quantidade: i.quantidade,
      precoUnitario: i.precoUnitario.toNumber(),
      subtotal: i.precoUnitario.mul(i.quantidade).toNumber(),
    })),
  };
}

function porChave(adminId: string, chave: string) {
  return db.order.findUnique({
    where: { registradoPorId_idempotencyKey: { registradoPorId: adminId, idempotencyKey: chave } },
    include: incluirVenda,
  });
}

/**
 * Mesma Idempotency-Key = mesma venda (duplo clique, rede que caiu e o admin tentou de novo), mas só
 * se o conteúdo for igual: reaproveitar a chave com outra venda não pode engolir a venda nova.
 */
function repeticao(existente: VendaComItens, entrada: VendaPresencialEntrada): VendaPresencialDTO {
  const igual = mesmaVenda(
    {
      itens: existente.items.map((e) => ({
        productId: e.productId,
        quantidade: e.quantidade,
        precoUnitarioCentavos: e.precoUnitario.mul(100).toNumber(),
      })),
      formaPagamento: existente.formaPagamento,
      clienteNome: existente.clienteNome,
      observacao: existente.observacao,
      diaDaVenda: hojeNaLoja(existente.createdAt),
      status: existente.status,
    },
    entrada,
  );
  if (!igual) throw new ErroNegocio(422, "Esta Idempotency-Key já foi usada em outra venda, com dados diferentes.");
  return paraVendaDTO(existente);
}

/**
 * Lança uma venda presencial (feira, balcão): canal PRESENCIAL, sem cliente cadastrado, endereço nem
 * frete; o total é a soma dos itens com o preço informado (em centavos inteiros). Fica registrado qual
 * admin lançou e quando (`lancadoEm`), mesmo que a venda seja de outro dia.
 */
export async function registrarVendaPresencial(
  adminId: string,
  entrada: VendaPresencialEntrada,
  chave: string,
): Promise<{ venda: VendaPresencialDTO; repetida: boolean }> {
  const existente = await porChave(adminId, chave);
  if (existente) return { venda: repeticao(existente, entrada), repetida: true };

  const ids = entrada.itens.map((i) => i.productId);
  const produtos = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (produtos.length !== ids.length) {
    const achados = new Set(produtos.map((p) => p.id));
    throw new ErroNegocio(422, "Alguns produtos não existem mais no catálogo.", {
      indisponiveis: ids.filter((id) => !achados.has(id)),
    });
  }

  // Soma em centavos inteiros e converte uma vez só (sem erro de arredondamento de float).
  const totalCentavos = entrada.itens.reduce((soma, i) => soma + i.precoUnitarioCentavos * i.quantidade, 0);
  const total = new Prisma.Decimal(totalCentavos).div(100);
  const agora = new Date();

  try {
    const venda = await db.order.create({
      data: {
        canal: "PRESENCIAL",
        status: entrada.status,
        total,
        deliveryFee: 0,
        // Sem data = hoje no relógio deste servidor, resolvido só agora (não na validação).
        createdAt: dataDaVenda(entrada.data, agora),
        lancadoEm: agora,
        formaPagamento: entrada.formaPagamento,
        clienteNome: entrada.clienteNome,
        observacao: entrada.observacao,
        registradoPorId: adminId,
        idempotencyKey: chave,
        items: {
          create: entrada.itens.map((i) => ({
            productId: i.productId,
            quantidade: i.quantidade,
            precoUnitario: new Prisma.Decimal(i.precoUnitarioCentavos).div(100),
          })),
        },
      },
      include: incluirVenda,
    });
    console.info(`[admin] ${adminId} registrou a venda presencial ${venda.id} (total=${total}, data=${hojeNaLoja(venda.createdAt)})`);
    return { venda: paraVendaDTO(venda), repetida: false };
  } catch (e) {
    unstable_rethrow(e);
    // Dois envios simultâneos com a mesma chave: o segundo cai aqui e recebe a venda do primeiro.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const repetida = await porChave(adminId, chave);
      if (repetida) return { venda: repeticao(repetida, entrada), repetida: true };
    }
    throw e;
  }
}
