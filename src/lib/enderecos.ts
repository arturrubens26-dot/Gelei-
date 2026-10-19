import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { MAX_ENDERECOS_POR_USUARIO } from "@/lib/limites";
import type { EnderecoEntrada } from "@/lib/validacao";

export type EnderecoSalvo = {
  id: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  estado: string;
};

export const CAMPOS_ENDERECO = {
  id: true,
  cep: true,
  rua: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  estado: true,
} as const;

/** Endereços salvos do usuário, do mais recente para o mais antigo. */
export async function listarEnderecos(userId: string): Promise<EnderecoSalvo[]> {
  return db.address.findMany({
    where: { userId },
    select: CAMPOS_ENDERECO,
    orderBy: { id: "desc" },
  });
}

/**
 * Devolve o endereço igual já salvo ou cria um novo. Precisa rodar dentro de uma
 * transação: o lock por usuário impede que duas requisições simultâneas passem juntas
 * pela contagem (ou dupliquem o endereço).
 *
 * `limitar`: aplica o teto de endereços por usuário. Só o cadastro manual (POST
 * /api/addresses) limita; o endereço novo de um pedido não, senão quem já tem 10
 * endereços ficaria sem conseguir comprar para um endereço novo (o excesso já é contido
 * pelo limite de pedidos por hora e de pedidos pendentes).
 */
export async function obterOuCriarEndereco(
  tx: Prisma.TransactionClient,
  userId: string,
  dados: EnderecoEntrada,
  opcoes: { limitar: boolean },
): Promise<EnderecoSalvo> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

  const existente = await tx.address.findFirst({ where: { userId, ...dados }, select: CAMPOS_ENDERECO });
  if (existente) return existente;

  if (opcoes.limitar) {
    const total = await tx.address.count({ where: { userId } });
    if (total >= MAX_ENDERECOS_POR_USUARIO) {
      throw new ErroNegocio(422, `Limite de ${MAX_ENDERECOS_POR_USUARIO} endereços salvos atingido.`);
    }
  }
  return tx.address.create({ data: { userId, ...dados }, select: CAMPOS_ENDERECO });
}
