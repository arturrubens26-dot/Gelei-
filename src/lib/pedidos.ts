import "server-only";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { validarEnderecoComCep } from "@/lib/cep";
import { db } from "@/lib/db";
import { obterOuCriarEndereco } from "@/lib/enderecos";
import { ErroNegocio } from "@/lib/erros";
import { calcularFrete } from "@/lib/frete";
import { MAX_PEDIDOS_PENDENTES, MAX_POR_PRODUTO } from "@/lib/limites";
import type { StatusPedido } from "@/lib/status";
import type { EnderecoEntrada } from "@/lib/validacao";

export type PedidoDTO = {
  id: string;
  status: StatusPedido;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  endereco: {
    cep: string;
    rua: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    cidade: string;
    estado: string;
  };
  itens: {
    productId: string;
    nome: string;
    quantidade: number;
    precoUnitario: number;
    subtotal: number;
  }[];
};

export const incluirPedido = {
  address: true,
  items: { include: { product: { select: { nome: true } } } },
} satisfies Prisma.OrderInclude;

type PedidoComRelacoes = Prisma.OrderGetPayload<{ include: typeof incluirPedido }>;

export function paraPedidoDTO(p: PedidoComRelacoes): PedidoDTO {
  // Pedido online sempre tem endereço (CHECK orders_canal_coerente); a venda presencial não passa por aqui.
  if (!p.address) throw new Error(`Pedido ${p.id} sem endereço: só pedidos online viram PedidoDTO.`);
  const itens = p.items.map((i) => ({
    productId: i.productId,
    nome: i.product.nome,
    quantidade: i.quantidade,
    precoUnitario: i.precoUnitario.toNumber(),
    subtotal: i.precoUnitario.mul(i.quantidade).toNumber(),
  }));
  return {
    id: p.id,
    status: p.status,
    subtotal: p.total.sub(p.deliveryFee).toNumber(),
    deliveryFee: p.deliveryFee.toNumber(),
    total: p.total.toNumber(),
    createdAt: p.createdAt.toISOString(),
    endereco: {
      cep: p.address.cep,
      rua: p.address.rua,
      numero: p.address.numero,
      complemento: p.address.complemento,
      bairro: p.address.bairro,
      cidade: p.address.cidade,
      estado: p.address.estado,
    },
    itens,
  };
}

/** Pedido online do usuário; `null` se não existir, for de outra pessoa ou for venda presencial. */
export async function buscarPedidoDoUsuario(id: string, userId: string): Promise<PedidoDTO | null> {
  const pedido = await db.order.findFirst({
    where: { id, userId, canal: "ONLINE" },
    include: incluirPedido,
  });
  return pedido ? paraPedidoDTO(pedido) : null;
}

type EntradaPedido = {
  itens: { productId: string; quantidade: number }[];
  addressId?: string;
  endereco?: EnderecoEntrada;
  /** Total (em centavos) que o cliente viu na tela; se não bater, devolve 409. */
  totalEsperadoCentavos?: number;
  /** Cabeçalho Idempotency-Key: mesma chave = mesmo pedido. */
  chaveIdempotencia?: string;
};

async function pedidoPorChave(userId: string, chave: string) {
  return db.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: chave } },
    include: incluirPedido,
  });
}

/** Pedido já criado para a mesma Idempotency-Key; recusa se o carrinho enviado agora for outro. */
function repeticao(existente: PedidoComRelacoes, quantidades: Map<string, number>): PedidoDTO {
  const mesmosItens =
    existente.items.length === quantidades.size &&
    existente.items.every((i) => quantidades.get(i.productId) === i.quantidade);
  if (!mesmosItens) {
    throw new ErroNegocio(422, "Esta Idempotency-Key já foi usada em outro pedido, com itens diferentes.");
  }
  return paraPedidoDTO(existente);
}

/**
 * Cria o pedido PENDENTE com seus itens. Nada que o cliente mande sobre preço,
 * peso ou frete é usado: tudo é recalculado aqui a partir do banco.
 *
 * - Repetir a mesma `chaveIdempotencia` devolve o pedido já criado (`repetido`).
 * - Endereço novo é conferido contra o CEP (existência, cidade e UF), senão
 *   daria para pagar o frete de uma capital entregando em outro estado.
 */
export async function criarPedido(
  userId: string,
  entrada: EntradaPedido,
): Promise<{ pedido: PedidoDTO; repetido: boolean }> {
  // Junta linhas repetidas do mesmo produto.
  const quantidades = new Map<string, number>();
  for (const item of entrada.itens) {
    quantidades.set(item.productId, (quantidades.get(item.productId) ?? 0) + item.quantidade);
  }
  if ([...quantidades.values()].some((q) => q > MAX_POR_PRODUTO)) {
    throw new ErroNegocio(400, `Quantidade máxima por produto: ${MAX_POR_PRODUTO}.`);
  }

  // Repetição da mesma chave: devolve o pedido já criado, mas só se o conteúdo for o mesmo.
  // Reaproveitar a chave com outro carrinho não pode "engolir" a compra nova em silêncio.
  const chave = entrada.chaveIdempotencia;
  if (chave) {
    const existente = await pedidoPorChave(userId, chave);
    if (existente) return { pedido: repeticao(existente, quantidades), repetido: true };
  }

  // Teto de pedidos aguardando pagamento por conta (pedidos abandonados não enchem o banco).
  const pendentes = await db.order.count({ where: { userId, status: "PENDENTE" } });
  if (pendentes >= MAX_PEDIDOS_PENDENTES) {
    throw new ErroNegocio(
      429,
      "Você já tem muitos pedidos aguardando pagamento. Conclua ou cancele algum antes de fazer outro.",
    );
  }

  const ids = [...quantidades.keys()];
  const produtos = await db.product.findMany({ where: { id: { in: ids } } });
  if (produtos.length !== ids.length) {
    const achados = new Set(produtos.map((p) => p.id));
    throw new ErroNegocio(422, "Alguns produtos do carrinho não estão mais disponíveis.", {
      indisponiveis: ids.filter((id) => !achados.has(id)),
    });
  }

  let subtotal = new Prisma.Decimal(0);
  let pesoTotalGramas = 0;
  for (const produto of produtos) {
    const quantidade = quantidades.get(produto.id)!;
    subtotal = subtotal.add(produto.preco.mul(quantidade));
    pesoTotalGramas += produto.pesoGramas * quantidade;
  }

  // Endereço: um salvo (precisa ser do usuário) ou um novo (já validado pelo zod).
  const salvo = entrada.addressId
    ? await db.address.findFirst({ where: { id: entrada.addressId, userId } })
    : null;
  if (entrada.addressId && !salvo) throw new ErroNegocio(404, "Endereço não encontrado.");
  const novo = entrada.endereco;
  if (!salvo && !novo) throw new ErroNegocio(400, "Informe o endereço de entrega.");

  // Endereço salvo já foi conferido ao ser criado. O novo é conferido agora (rede, fora da transação).
  if (novo) {
    const validacao = await validarEnderecoComCep(novo);
    if (!validacao.ok) throw new ErroNegocio(validacao.status, validacao.mensagem);
  }

  const cep = salvo ? salvo.cep : novo!.cep;
  const deliveryFee = new Prisma.Decimal(calcularFrete(cep, pesoTotalGramas).valor);
  const total = subtotal.add(deliveryFee);

  // O cliente confirmou um total na tela; se preço ou frete mudaram desde então, não cobra às escondidas.
  if (
    entrada.totalEsperadoCentavos !== undefined &&
    entrada.totalEsperadoCentavos !== total.mul(100).toNumber()
  ) {
    throw new ErroNegocio(409, "Os preços ou a entrega mudaram. Confira o novo total antes de finalizar.", {
      total: total.toNumber(),
      deliveryFee: deliveryFee.toNumber(),
      // Preço e peso atuais: o peso também muda o frete (limite de 2 kg), então o cliente precisa dele.
      itens: produtos.map((p) => ({
        productId: p.id,
        nome: p.nome,
        preco: p.preco.toNumber(),
        pesoGramas: p.pesoGramas,
      })),
    });
  }

  try {
    const pedido = await db.$transaction(async (tx) => {
      const endereco = salvo ?? (await obterOuCriarEndereco(tx, userId, novo!, { limitar: false }));
      return tx.order.create({
        data: {
          userId,
          addressId: endereco.id,
          status: "PENDENTE",
          total,
          deliveryFee,
          idempotencyKey: chave ?? null,
          items: {
            create: produtos.map((p) => ({
              productId: p.id,
              quantidade: quantidades.get(p.id)!,
              precoUnitario: p.preco,
            })),
          },
        },
        include: incluirPedido,
      });
    });

    console.info(`[pedidos] pedido ${pedido.id} criado (itens=${produtos.length}, total=${total})`);
    return { pedido: paraPedidoDTO(pedido), repetido: false };
  } catch (e) {
    unstable_rethrow(e);
    // Dois envios simultâneos com a mesma chave: o segundo cai aqui e recebe o pedido do primeiro.
    if (chave && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await pedidoPorChave(userId, chave);
      if (existente) return { pedido: repeticao(existente, quantidades), repetido: true };
    }
    throw e;
  }
}
