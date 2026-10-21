import "server-only";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { TAXA_ENTREGA_PADRAO_CENTAVOS, taxaDeEntregaValida } from "@/lib/entrega-regras";

/**
 * Taxa de entrega em vigor (tabela config_loja, uma linha). As regras (área, cálculo, telefone)
 * ficam em src/lib/entrega-regras.ts; aqui só a leitura e a gravação.
 */

const TAG = "config-loja";

/** Direto do banco: é o valor que vale para o pedido (criarPedido e /api/delivery/calculate). */
export async function taxaDeEntregaAtualCentavos(): Promise<number> {
  const config = await db.configLoja.findUnique({ where: { id: 1 }, select: { taxaEntregaCentavos: true } });
  return config?.taxaEntregaCentavos ?? TAXA_ENTREGA_PADRAO_CENTAVOS;
}

/**
 * Para páginas (checkout): em cache, expira na hora quando o painel muda a taxa. Se estiver velha em
 * outra instância, o pedido usa a do banco e o checkout recebe 409 com o total novo.
 */
export async function obterTaxaDeEntregaCentavos(): Promise<number> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAG);
  return taxaDeEntregaAtualCentavos();
}

export type ConfigEntregaDTO = { taxaEntregaCentavos: number; atualizadoEm: string | null };

/** Para o painel (sem cache). */
export async function obterConfigEntregaAdmin(): Promise<ConfigEntregaDTO> {
  const config = await db.configLoja.findUnique({ where: { id: 1 } });
  return {
    taxaEntregaCentavos: config?.taxaEntregaCentavos ?? TAXA_ENTREGA_PADRAO_CENTAVOS,
    atualizadoEm: config?.atualizadoEm.toISOString() ?? null,
  };
}

/** Muda a taxa (pedidos já criados não mudam: o frete fica gravado em cada um). */
export async function definirTaxaDeEntrega(centavos: number, adminId: string): Promise<ConfigEntregaDTO> {
  if (!taxaDeEntregaValida(centavos)) throw new ErroNegocio(400, "Taxa de entrega inválida.");
  const config = await db.configLoja.upsert({
    where: { id: 1 },
    create: { id: 1, taxaEntregaCentavos: centavos, atualizadoPorId: adminId },
    update: { taxaEntregaCentavos: centavos, atualizadoPorId: adminId },
  });
  revalidateTag(TAG, { expire: 0 });
  console.info(`[entrega] taxa de entrega alterada para ${centavos} centavos pelo admin ${adminId}`);
  return { taxaEntregaCentavos: config.taxaEntregaCentavos, atualizadoEm: config.atualizadoEm.toISOString() };
}
