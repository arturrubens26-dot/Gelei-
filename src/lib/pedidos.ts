import "server-only";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { validarEnderecoComCep } from "@/lib/cep";
import { db } from "@/lib/db";
import { obterOuCriarEndereco } from "@/lib/enderecos";
import { ErroNegocio } from "@/lib/erros";
import { calcularFrete } from "@/lib/frete";
import {
  agruparKits,
  conferirComposicao,
  emCentavos,
  mesmoConteudo,
  normalizarComposicao,
  ratearPrecoDoKit,
  somarConteudo,
  type ConteudoComparavel,
  type LinhaDeKit,
} from "@/lib/kits-regras";
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
  /** Potes avulsos. */
  itens: {
    productId: string;
    nome: string;
    quantidade: number;
    precoUnitario: number;
    subtotal: number;
  }[];
  /** Caixas de kit (pedido sem kit, inclusive os antigos: lista vazia). Valores em reais. */
  kits: {
    /** Id da linha no pedido (estável: serve de `key` na tela). */
    id: string;
    kitId: string;
    nome: string;
    /** Caixas com esta composição. */
    quantidade: number;
    /** Preço de UMA caixa no dia da compra. */
    precoUnitario: number;
    subtotal: number;
    /** Composição de UMA caixa, com a foto real de cada sabor (para desenhar a miniatura). */
    sabores: { productId: string; nome: string; quantidade: number; imagemUrl: string }[];
  }[];
};

export const incluirPedido = {
  address: true,
  items: { include: { product: { select: { nome: true } } } },
  kits: {
    // cuid cresce com o tempo: a ordem das linhas é a da criação.
    orderBy: { id: "asc" },
    include: {
      kit: { select: { nome: true } },
      sabores: { orderBy: { productId: "asc" }, include: { product: { select: { nome: true, imagemUrl: true } } } },
    },
  },
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
    kits,
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
  /** Caixas de kit; sem o campo (carrinho antigo), nenhuma. */
  kits?: LinhaDeKit[];
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

/** O que foi comprado (avulsos e caixas), no formato que `mesmoConteudo` compara. */
function conteudoDoPedido(p: PedidoComRelacoes): ConteudoComparavel {
  return {
    avulsos: p.items.map((i) => ({ productId: i.productId, quantidade: i.quantidade })),
    kits: p.kits.map((k) => ({
      kitId: k.kitId,
      quantidade: k.quantidade,
      sabores: k.sabores.map((s) => ({ productId: s.productId, quantidade: s.quantidade })),
    })),
  };
}

/** Pedido já criado para a mesma Idempotency-Key; recusa se o carrinho enviado agora for outro. */
function repeticao(existente: PedidoComRelacoes, conteudo: ConteudoComparavel): PedidoDTO {
  if (!mesmoConteudo(conteudoDoPedido(existente), conteudo)) {
    throw new ErroNegocio(422, "Esta Idempotency-Key já foi usada em outro pedido, com itens diferentes.");
  }
  return paraPedidoDTO(existente);
}

/** Decimal do banco (reais, 2 casas) → centavos inteiros, sem passar por float. */
const centavosDe = (valor: Prisma.Decimal) => valor.mul(100).toNumber();
/** Centavos inteiros → Decimal em reais, exato. */
const reaisDe = (centavos: number) => new Prisma.Decimal(centavos).div(100);

/**
 * Cria o pedido PENDENTE com seus potes avulsos e caixas de kit. Nada que o cliente mande sobre
 * preço, peso, frete ou composição válida é usado: tudo é lido do banco e recalculado aqui, em
 * centavos inteiros e com a mesma conta do carrinho (`somarConteudo`).
 *
 * - Repetir a mesma `chaveIdempotencia` devolve o pedido já criado (`repetido`), se o conteúdo
 *   (avulsos e caixas, em qualquer ordem) for o mesmo; senão, 422.
 * - Produto ou kit oculto/inexistente: 422 com `indisponiveis` (produtos, avulsos ou dentro de
 *   caixas) e `kitsIndisponiveis`.
 * - Caixa com potes a mais ou a menos que o kit leva: 400 em `kits.N.sabores` (N = posição enviada).
 * - Endereço novo é conferido contra o CEP (existência, cidade e UF), senão
 *   daria para pagar o frete de uma capital entregando em outro estado.
 */
export async function criarPedido(
  userId: string,
  entrada: EntradaPedido,
): Promise<{ pedido: PedidoDTO; repetido: boolean }> {
  const linhasDeKit = entrada.kits ?? [];
  // Junta linhas repetidas do mesmo produto (a mesma regra que junta os sabores de uma caixa).
  const avulsos = normalizarComposicao(entrada.itens);
  if (avulsos.some((a) => a.quantidade > MAX_POR_PRODUTO)) {
    throw new ErroNegocio(400, `Quantidade máxima por produto: ${MAX_POR_PRODUTO}.`);
  }
  // Mesma caixa (kit + composição) em várias linhas vira uma linha com mais caixas.
  const caixas = agruparKits(linhasDeKit);
  if (avulsos.length === 0 && caixas.length === 0) throw new ErroNegocio(400, "O carrinho está vazio.");

  // Repetição da mesma chave: devolve o pedido já criado, mas só se o conteúdo for o mesmo.
  // Reaproveitar a chave com outro carrinho não pode "engolir" a compra nova em silêncio.
  const conteudo: ConteudoComparavel = { avulsos, kits: caixas };
  const chave = entrada.chaveIdempotencia;
  if (chave) {
    const existente = await pedidoPorChave(userId, chave);
    if (existente) return { pedido: repeticao(existente, conteudo), repetido: true };
  }

  // Teto de pedidos aguardando pagamento por conta (pedidos abandonados não enchem o banco).
  const pendentes = await db.order.count({ where: { userId, status: "PENDENTE" } });
  if (pendentes >= MAX_PEDIDOS_PENDENTES) {
    throw new ErroNegocio(
      429,
      "Você já tem muitos pedidos aguardando pagamento. Conclua ou cancele algum antes de fazer outro.",
    );
  }

  // Todo produto citado (avulso ou dentro de uma caixa) e todo kit, numa consulta cada.
  const idsProdutos = [...new Set([...avulsos.map((a) => a.productId), ...caixas.flatMap((c) => c.sabores.map((s) => s.productId))])];
  const idsKits = [...new Set(caixas.map((c) => c.kitId))];
  // Produto ou kit oculto da loja conta como indisponível (o carrinho do cliente pode ser de antes).
  const produtos = await db.product.findMany({ where: { id: { in: idsProdutos }, ativo: true } });
  const kits = idsKits.length > 0 ? await db.kit.findMany({ where: { id: { in: idsKits }, ativo: true } }) : [];
  const produtoPorId = new Map(produtos.map((p) => [p.id, p]));
  const kitPorId = new Map(kits.map((k) => [k.id, k]));

  const indisponiveis = idsProdutos.filter((id) => !produtoPorId.has(id));
  const kitsIndisponiveis = idsKits.filter((id) => !kitPorId.has(id));
  if (indisponiveis.length > 0 || kitsIndisponiveis.length > 0) {
    throw new ErroNegocio(
      422,
      caixas.length > 0
        ? "Alguns itens do carrinho não estão mais disponíveis."
        : "Alguns produtos do carrinho não estão mais disponíveis.",
      { indisponiveis, kitsIndisponiveis },
    );
  }

  // Quantos potes a caixa leva vem do kit no banco: confere cada linha como foi enviada.
  const composicaoErrada: Record<string, string[]> = {};
  linhasDeKit.forEach((linha, i) => {
    const kit = kitPorId.get(linha.kitId)!;
    const conferida = conferirComposicao(linha.sabores, kit.potes, { nomeDoKit: kit.nome });
    if (!conferida.ok) composicaoErrada[`kits.${i}.sabores`] = [conferida.mensagem];
  });
  if (Object.keys(composicaoErrada).length > 0) {
    throw new ErroNegocio(400, "Confira os potes do kit.", composicaoErrada);
  }

  // Preços do banco, em centavos. O preço da caixa é rateado entre os sabores pelo preço avulso
  // (o Financeiro por sabor usa esse valor; a soma do rateio é sempre o preço da caixa).
  const avulsosCalculados = avulsos.map((a) => {
    const produto = produtoPorId.get(a.productId)!;
    return { ...a, precoCentavos: centavosDe(produto.preco), pesoGramas: produto.pesoGramas };
  });
  const caixasCalculadas = caixas.map((c) => {
    const kit = kitPorId.get(c.kitId)!;
    const precoCentavos = centavosDe(kit.preco);
    const sabores = c.sabores.map((s) => {
      const produto = produtoPorId.get(s.productId)!;
      return { ...s, precoAvulsoCentavos: centavosDe(produto.preco), pesoGramas: produto.pesoGramas };
    });
    const rateio = ratearPrecoDoKit(precoCentavos, sabores);
    return {
      kitId: c.kitId,
      quantidade: c.quantidade,
      precoCentavos,
      pesoCaixaGramas: kit.pesoCaixaGramas,
      sabores: sabores.map((s) => ({ ...s, valorRateadoCentavos: rateio.get(s.productId)! })),
    };
  });
  const { subtotalCentavos, pesoTotalGramas } = somarConteudo({ avulsos: avulsosCalculados, kits: caixasCalculadas });

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
  const freteCentavos = emCentavos(calcularFrete(cep, pesoTotalGramas).valor);
  const totalCentavos = subtotalCentavos + freteCentavos;
  const total = reaisDe(totalCentavos);
  const deliveryFee = reaisDe(freteCentavos);

  // O cliente confirmou um total na tela; se preço ou frete mudaram desde então, não cobra às escondidas.
  if (entrada.totalEsperadoCentavos !== undefined && entrada.totalEsperadoCentavos !== totalCentavos) {
    throw new ErroNegocio(409, "Os preços ou a entrega mudaram. Confira o novo total antes de finalizar.", {
      total: total.toNumber(),
      deliveryFee: deliveryFee.toNumber(),
      // Preço e peso atuais de todo produto citado (avulso ou dentro de caixa): o peso também muda
      // o frete (limite de 2 kg), e o preço avulso muda a economia mostrada no kit.
      itens: produtos.map((p) => ({
        productId: p.id,
        nome: p.nome,
        preco: p.preco.toNumber(),
        pesoGramas: p.pesoGramas,
      })),
      kits: kits.map((k) => ({
        kitId: k.id,
        nome: k.nome,
        preco: k.preco.toNumber(),
        pesoCaixaGramas: k.pesoCaixaGramas,
        potes: k.potes,
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
            create: avulsosCalculados.map((a) => ({
              productId: a.productId,
              quantidade: a.quantidade,
              precoUnitario: reaisDe(a.precoCentavos),
            })),
          },
          kits: {
            create: caixasCalculadas.map((c) => ({
              kitId: c.kitId,
              quantidade: c.quantidade,
              precoUnitario: reaisDe(c.precoCentavos),
              sabores: {
                create: c.sabores.map((s) => ({
                  productId: s.productId,
                  quantidade: s.quantidade,
                  precoAvulso: reaisDe(s.precoAvulsoCentavos),
                  valorRateado: reaisDe(s.valorRateadoCentavos),
                })),
              },
            })),
          },
        },
        include: incluirPedido,
      });
    });

    const totalDeCaixas = caixasCalculadas.reduce((soma, c) => soma + c.quantidade, 0);
    console.info(
      `[pedidos] pedido ${pedido.id} criado (itens=${avulsosCalculados.length}, caixas=${totalDeCaixas}, total=${total.toFixed(2)})`,
    );
    return { pedido: paraPedidoDTO(pedido), repetido: false };
  } catch (e) {
    unstable_rethrow(e);
    // Dois envios simultâneos com a mesma chave: o segundo cai aqui e recebe o pedido do primeiro.
    if (chave && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await pedidoPorChave(userId, chave);
      if (existente) return { pedido: repeticao(existente, conteudo), repetido: true };
    }
    throw e;
  }
}
