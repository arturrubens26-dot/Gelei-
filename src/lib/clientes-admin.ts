import "server-only";
import {
  situacaoDoLink,
  type ClienteDetalheDTO,
  type ClienteResumoDTO,
} from "@/lib/auth/redefinicao-regras";
import { db } from "@/lib/db";
import { finalDoTelefone, normalizarTelefone } from "@/lib/entrega-regras";
import { codigoPedido, resumoDoPedido } from "@/lib/formatacao";

export type { ClienteDetalheDTO, ClienteResumoDTO } from "@/lib/auth/redefinicao-regras";

/**
 * Tela de clientes do painel (/admin/clientes): busca e ficha, para a dona conferir a identidade
 * antes de gerar um link de redefinição de senha. SÓ contas de cliente: admin nunca aparece.
 */

/** Mínimo de caracteres da busca (abaixo disso, a lista fica vazia). */
export const MIN_CARACTERES_BUSCA = 3;
const MAX_RESULTADOS = 20;
const ULTIMOS_PEDIDOS = 5;
const ULTIMOS_LINKS = 10;

const pedidosOnline = { where: { canal: "ONLINE" as const } };

/**
 * Por e-mail ou nome (`contains` sem diferenciar maiúsculas; acento conta, porque o Postgres não tem
 * `unaccent` ligado) e, com 8 dígitos ou mais, pelo telefone. Até 20, os mais recentes primeiro.
 */
export async function buscarClientes(busca: string): Promise<ClienteResumoDTO[]> {
  const termo = busca.trim();
  if (termo.length < MIN_CARACTERES_BUSCA || termo.length > 100) return [];
  const digitos = normalizarTelefone(termo);
  const usuarios = await db.user.findMany({
    where: {
      isAdmin: false,
      OR: [
        { email: { contains: termo, mode: "insensitive" } },
        { nome: { contains: termo, mode: "insensitive" } },
        ...(digitos.length >= 8 && /^[\d\s()+.-]+$/.test(termo) ? [{ telefone: { contains: digitos } }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_RESULTADOS,
    select: { id: true, nome: true, email: true, createdAt: true, _count: { select: { orders: pedidosOnline } } },
  });
  return usuarios.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    criadoEm: u.createdAt.toISOString(),
    pedidos: u._count.orders,
  }));
}

/** Ficha do cliente: dados para comparar com o que a cliente disser (a dona não os lê para ela). */
export async function fichaDoCliente(id: string): Promise<ClienteDetalheDTO | null> {
  if (id.length === 0 || id.length > 100) return null;
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      nome: true,
      email: true,
      isAdmin: true,
      createdAt: true,
      telefone: true,
      _count: { select: { orders: pedidosOnline, addresses: true } },
      orders: {
        where: { canal: "ONLINE" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ULTIMOS_PEDIDOS,
        select: {
          id: true,
          createdAt: true,
          status: true,
          total: true,
          modoEntrega: true,
          telefone: true,
          address: { select: { bairro: true, cidade: true, cep: true } },
          items: { orderBy: { productId: "asc" }, select: { quantidade: true, product: { select: { nome: true } } } },
          kits: { orderBy: { id: "asc" }, select: { quantidade: true, kit: { select: { nome: true } } } },
        },
      },
      redefinicoes: {
        orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
        take: ULTIMOS_LINKS,
        select: {
          criadoEm: true,
          origem: true,
          expiraEm: true,
          usadoEm: true,
          invalidadoEm: true,
          geradoPor: { select: { nome: true } },
        },
      },
    },
  });
  if (!u || u.isAdmin) return null;

  const agora = Date.now();
  // O telefone da conta é o do último pedido; se a conta não tiver (pedido antigo), o do pedido mais recente que tiver.
  const telefone = u.telefone ?? u.orders.find((p) => p.telefone)?.telefone ?? null;
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    criadoEm: u.createdAt.toISOString(),
    pedidos: u._count.orders,
    enderecos: u._count.addresses,
    telefoneFinal: finalDoTelefone(telefone),
    semHistorico: u._count.orders === 0 && u._count.addresses === 0,
    ultimosPedidos: u.orders.map((p) => ({
      id: p.id,
      codigo: codigoPedido(p.id),
      createdAt: p.createdAt.toISOString(),
      status: p.status,
      total: p.total.toNumber(),
      resumo: resumoDoPedido([
        ...p.items.map((i) => ({ nome: i.product.nome, quantidade: i.quantidade })),
        ...p.kits.map((k) => ({ nome: k.kit.nome, quantidade: k.quantidade })),
      ]),
      modoEntrega: p.modoEntrega ?? "ENTREGA",
      bairro: p.address?.bairro ?? null,
      cidade: p.address?.cidade ?? null,
      cepInicio: p.address ? p.address.cep.slice(0, 5) : null,
    })),
    links: u.redefinicoes.map((r) => ({
      criadoEm: r.criadoEm.toISOString(),
      origem: r.origem,
      geradoPor: r.geradoPor?.nome ?? null,
      situacao: situacaoDoLink(r, agora),
      expiraEm: r.expiraEm.toISOString(),
    })),
  };
}
