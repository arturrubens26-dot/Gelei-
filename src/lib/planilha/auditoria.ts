import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { AcaoAuditoria, ItemHistoricoDTO, LinhaPlanilhaDTO } from "@/lib/planilha/tipos";

/** Cliente do Prisma dentro (ou fora) de uma transação. */
export type ClienteDb = Prisma.TransactionClient | typeof db;

export type EntidadeAuditada = "despesa" | "entrada" | "categoria" | "config" | "importacao" | "usuario";

/**
 * Grava uma linha do histórico financeiro. Chame com o `tx` da MESMA transação da mudança: se a gravação
 * falhar, o histórico também não fica (e vice-versa). Nunca guarde senha, token ou dado de cliente aqui.
 */
export async function registrarAuditoria(
  tx: ClienteDb,
  r: { entidade: EntidadeAuditada; entidadeId: string; acao: AcaoAuditoria; antes?: object | null; depois?: object | null; adminId: string | null },
): Promise<void> {
  await tx.auditoriaFinanceira.create({
    data: {
      entidade: r.entidade,
      entidadeId: r.entidadeId,
      acao: r.acao,
      antes: r.antes ? (r.antes as Prisma.InputJsonObject) : Prisma.DbNull,
      depois: r.depois ? (r.depois as Prisma.InputJsonObject) : Prisma.DbNull,
      adminId: r.adminId,
    },
  });
}

/** O retrato de uma linha manual que vai para o histórico (sem autoria: ela já está na própria auditoria). */
export function fotoDaLinha(l: LinhaPlanilhaDTO): Record<string, unknown> {
  return {
    tipo: l.tipo,
    data: l.data,
    categoriaId: l.categoriaId,
    categoriaNome: l.categoriaNome,
    descricao: l.descricao,
    valorCentavos: l.valorCentavos,
    formaPagamento: l.formaPagamento,
    observacao: l.observacao,
    ...(l.tipo === "SAIDA"
      ? { quantidade: l.quantidade, unidade: l.unidade, fornecedor: l.fornecedor, insumoId: l.insumo?.id ?? null, quantidadeBase: l.quantidadeBase }
      : {}),
    versao: l.versao,
  };
}

/** O histórico, mais recente primeiro (aba Auxiliar e "Histórico da linha"). */
export async function listarHistorico(filtro: { entidade?: string; entidadeId?: string; limite: number }): Promise<ItemHistoricoDTO[]> {
  const itens = await db.auditoriaFinanceira.findMany({
    where: { ...(filtro.entidade ? { entidade: filtro.entidade } : {}), ...(filtro.entidadeId ? { entidadeId: filtro.entidadeId } : {}) },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: filtro.limite,
    include: { admin: { select: { id: true, nome: true } } },
  });
  return itens.map((i) => ({
    id: i.id,
    entidade: i.entidade,
    entidadeId: i.entidadeId,
    acao: i.acao,
    antes: (i.antes as Record<string, unknown> | null) ?? null,
    depois: (i.depois as Record<string, unknown> | null) ?? null,
    admin: i.admin,
    criadoEm: i.criadoEm.toISOString(),
  }));
}
