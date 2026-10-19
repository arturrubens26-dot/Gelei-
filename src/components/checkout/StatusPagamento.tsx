"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import type { StatusPedidoChave } from "@/lib/formatacao";

const SEGUNDOS_DA_SIMULACAO = 5;

/**
 * Status do pedido na confirmação. DEMONSTRAÇÃO: enquanto o pedido está
 * PENDENTE, conta 5 segundos e chama a rota de simulação, que marca como PAGO.
 * Com um gateway real, o PAGO viria do webhook do gateway e este componente
 * apenas atualizaria a tela.
 */
export function StatusPagamento({ pedidoId, statusServidor }: { pedidoId: string; statusServidor: StatusPedidoChave }) {
  const router = useRouter();
  const [restante, setRestante] = useState(SEGUNDOS_DA_SIMULACAO);
  const [pagoAgora, setPagoAgora] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const disparou = useRef(false);

  // "Pago agora" só vale enquanto o servidor ainda diz PENDENTE: depois do refresh, se o pedido já
  // foi enviado ou cancelado, vale o que o servidor diz (senão mostraria "Pago" para um pedido enviado).
  const status: StatusPedidoChave = pagoAgora && statusServidor === "PENDENTE" ? "PAGO" : statusServidor;
  const pendente = status === "PENDENTE";

  useEffect(() => {
    if (!pendente || restante <= 0) return;
    const espera = setTimeout(() => setRestante((r) => r - 1), 1000);
    return () => clearTimeout(espera);
  }, [pendente, restante]);

  useEffect(() => {
    if (!pendente || restante > 0 || disparou.current) return;
    disparou.current = true; // evita disparo duplo (StrictMode em desenvolvimento)
    fetch(`/api/orders/${pedidoId}/simular-pagamento`, { method: "POST" })
      .then((resposta) => {
        if (resposta.ok) {
          setPagoAgora(true);
          router.refresh();
        } else if (resposta.status === 404) {
          setAviso("Aguardando a confirmação do pagamento pelo banco.");
        } else if (resposta.status === 409) {
          router.refresh(); // outro lugar já mudou o status: relê do servidor
        } else {
          setAviso("Não foi possível confirmar o pagamento agora. Atualize a página em instantes.");
        }
      })
      .catch(() => setAviso("Sem conexão para confirmar o pagamento. Atualize a página."));
  }, [pendente, restante, pedidoId, router]);

  return (
    <div className="cartao p-5">
      {/* Anuncia só as mudanças de estado; a contagem regressiva não é lida a cada segundo. */}
      <p className="sr-only" role="status" aria-live="polite">
        {pendente ? "Aguardando a confirmação do pagamento." : status === "PAGO" ? "Pagamento confirmado." : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">Status do pagamento:</span>
        <EtiquetaStatus status={status} />
      </div>
      {pendente && (
        <p className="mt-3 text-sm text-primaria/85">
          {aviso ??
            (restante > 0
              ? `Aguardando o PIX (simulado)… confirmação em ${restante}s.`
              : "Confirmando o pagamento…")}
        </p>
      )}
      {status === "PAGO" && (
        <p className="mt-3 text-sm text-primaria/85">Pagamento confirmado! Já estamos preparando sua geleia com carinho.</p>
      )}
    </div>
  );
}
