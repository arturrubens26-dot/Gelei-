import "server-only";
import { pagamentosSimuladosPermitidos } from "@/lib/ambiente";
import { db } from "@/lib/db";

/**
 * Camada de pagamento. O restante do sistema só conhece `GatewayPagamento`;
 * para integrar um gateway real (Mercado Pago, Pagar.me, Stripe, Asaas...),
 * crie outra implementação e troque `obterGateway()`. Para confirmar o
 * pagamento de verdade, o gateway chamará um webhook nosso que atualiza o
 * pedido para PAGO (hoje essa transição é feita por `simularPagamento`).
 */

export type CobrancaPix = {
  /** Identificador da cobrança no gateway. */
  referenciaExterna: string;
  /** Código "PIX copia e cola". */
  copiaECola: string;
  expiraEm: string;
};

export interface GatewayPagamento {
  readonly nome: string;
  criarCobrancaPix(pedido: { id: string; total: number }): Promise<CobrancaPix>;
}

const gatewaySimulado: GatewayPagamento = {
  nome: "simulado",
  async criarCobrancaPix(pedido) {
    return {
      referenciaExterna: `SIM-${pedido.id}`,
      copiaECola: `00020126SIMULADO${pedido.id}5204000053039865802BR`,
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  },
};

/**
 * Pagamento simulado: PAGAMENTOS_SIMULADOS=true e, em produção, também APP_ENV=demo
 * (ver src/lib/ambiente.ts). Sem os dois sinais, o endpoint de simulação some (404).
 */
export function pagamentosSimuladosAtivos(): boolean {
  return pagamentosSimuladosPermitidos();
}

/**
 * Dá para cobrar um pedido pelo site? Sem gateway (o site no ar antes do PIX real), a loja não
 * aceita pedidos online: o checkout avisa "em breve" e a API recusa ANTES de gravar o pedido
 * (antes, o pedido ficava PENDENTE e o cliente via um erro). Ao integrar o gateway real, inclua-o aqui.
 */
export function pagamentoOnlineDisponivel(): boolean {
  return pagamentosSimuladosAtivos();
}

export function obterGateway(): GatewayPagamento {
  if (pagamentosSimuladosAtivos()) return gatewaySimulado;
  throw new Error("Nenhum gateway de pagamento configurado (defina PAGAMENTOS_SIMULADOS=true em dev).");
}

/**
 * Confirma o pagamento de um pedido PENDENTE do usuário. Atômico: só atualiza
 * se ainda estiver pendente (duas chamadas simultâneas não duplicam a ação).
 */
export async function simularPagamento(orderId: string, userId: string): Promise<boolean> {
  const { count } = await db.order.updateMany({
    where: { id: orderId, userId, status: "PENDENTE" },
    data: { status: "PAGO" },
  });
  return count === 1;
}
