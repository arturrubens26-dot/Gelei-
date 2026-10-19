"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import type { StatusPedidoChave } from "@/lib/formatacao";
import type { CobrancaDTO } from "@/lib/pagamentos";

const SEGUNDOS_DA_SIMULACAO = 5;
/** De quanto em quanto tempo a tela pergunta se o PIX caiu (o servidor consulta o gateway). */
const INTERVALO_CONSULTA_MS = 5_000;

const horaCurta = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Pagamento do pedido na confirmação. Com o Mercado Pago: mostra o QR Code e o "copia e cola", e
 * pergunta ao servidor a cada 5 s se o pagamento caiu (o servidor confere no Mercado Pago). PIX
 * vencido: botão para gerar outro. DEMONSTRAÇÃO (gateway simulado): conta 5 s e "paga" sozinho.
 */
export function StatusPagamento({
  pedidoId,
  statusServidor,
  cobrancaInicial,
}: {
  pedidoId: string;
  statusServidor: StatusPedidoChave;
  cobrancaInicial: CobrancaDTO | null;
}) {
  const router = useRouter();
  // O que a tela descobriu (ex.: PAGO) vale só enquanto o servidor ainda diz PENDENTE: depois do
  // refresh, vale o servidor (senão mostraria "Pago" para um pedido já enviado ou cancelado).
  const [statusCliente, setStatus] = useState<StatusPedidoChave | null>(null);
  const status: StatusPedidoChave = statusServidor === "PENDENTE" ? (statusCliente ?? statusServidor) : statusServidor;
  const [cobranca, setCobranca] = useState(cobrancaInicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const [restante, setRestante] = useState(SEGUNDOS_DA_SIMULACAO);
  const simulou = useRef(false);

  const pendente = status === "PENDENTE";
  const simulado = cobranca?.gateway === "simulado";
  const vencido = !cobranca || cobranca.status !== "PENDENTE" || new Date(cobranca.expiraEm).getTime() <= agora;

  // Relógio de minuto em minuto (para o "vence às" e para perceber o vencimento).
  useEffect(() => {
    if (!pendente) return;
    const relogio = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(relogio);
  }, [pendente]);

  // Consulta periódica enquanto o PIX está valendo e a aba está visível.
  useEffect(() => {
    if (!pendente || simulado || vencido) return;
    let ativo = true;
    const consultar = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const resposta = await fetch(`/api/orders/${pedidoId}/pagamento`, { cache: "no-store" });
        const json = await resposta.json().catch(() => null);
        if (!ativo || !resposta.ok || !json) return;
        setCobranca(json.cobranca);
        if (json.status !== "PENDENTE") {
          setStatus(json.status);
          router.refresh();
        }
      } catch {
        // Sem conexão: tenta de novo na próxima volta.
      }
    };
    const repeticao = setInterval(consultar, INTERVALO_CONSULTA_MS);
    document.addEventListener("visibilitychange", consultar);
    return () => {
      ativo = false;
      clearInterval(repeticao);
      document.removeEventListener("visibilitychange", consultar);
    };
  }, [pendente, simulado, vencido, pedidoId, router]);

  // DEMONSTRAÇÃO: contagem regressiva e "pagamento" automático.
  useEffect(() => {
    if (!pendente || !simulado || restante <= 0) return;
    const espera = setTimeout(() => setRestante((r) => r - 1), 1000);
    return () => clearTimeout(espera);
  }, [pendente, simulado, restante]);

  useEffect(() => {
    if (!pendente || !simulado || restante > 0 || simulou.current) return;
    simulou.current = true; // evita disparo duplo (StrictMode em desenvolvimento)
    fetch(`/api/orders/${pedidoId}/simular-pagamento`, { method: "POST" })
      .then((resposta) => {
        if (resposta.ok) {
          setStatus("PAGO");
          router.refresh();
        } else if (resposta.status === 409) {
          router.refresh();
        } else {
          setAviso("Não foi possível confirmar o pagamento agora. Atualize a página em instantes.");
        }
      })
      .catch(() => setAviso("Sem conexão para confirmar o pagamento. Atualize a página."));
  }, [pendente, simulado, restante, pedidoId, router]);

  const gerarPix = useCallback(async () => {
    setGerando(true);
    setAviso(null);
    try {
      const resposta = await fetch(`/api/orders/${pedidoId}/pagamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await resposta.json().catch(() => null);
      if (resposta.ok && json?.cobranca) {
        setCobranca(json.cobranca);
        setAgora(Date.now());
      } else {
        setAviso(json?.erro ?? "Não foi possível gerar o PIX agora. Tente de novo em instantes.");
        if (resposta.status === 409) router.refresh();
      }
    } catch {
      setAviso("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      setGerando(false);
    }
  }, [pedidoId, router]);

  async function copiar() {
    if (!cobranca) return;
    try {
      await navigator.clipboard.writeText(cobranca.copiaECola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 4000);
    } catch {
      // Sem permissão para a área de transferência: seleciona o código para a pessoa copiar.
      (document.getElementById("pix-copia-e-cola") as HTMLTextAreaElement | null)?.select();
      setAviso("Selecionamos o código: copie com Ctrl+C (ou toque e segure, no celular).");
    }
  }

  return (
    <div className="cartao p-5">
      <p className="sr-only" role="status" aria-live="polite">
        {status === "PAGO" ? "Pagamento confirmado." : copiado ? "Código PIX copiado." : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">Status do pagamento:</span>
        <EtiquetaStatus status={status} />
      </div>

      {pendente && cobranca && !vencido && !simulado && (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {cobranca.qrCodeBase64 && (
            // eslint-disable-next-line @next/next/no-img-element -- imagem em base64 vinda do gateway, sem otimização possível
            <img
              src={`data:image/png;base64,${cobranca.qrCodeBase64}`}
              alt="QR Code do PIX deste pedido"
              width={208}
              height={208}
              className="mx-auto shrink-0 rounded-lg border border-accent1 bg-white p-2 sm:mx-0"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
            <p>
              Abra o app do seu banco, escolha <strong>PIX</strong> e pague lendo o QR Code ou com o código abaixo
              (PIX copia e cola). Valor: <strong>{cobranca.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>.
            </p>
            <label htmlFor="pix-copia-e-cola" className="font-semibold">
              PIX copia e cola
            </label>
            <textarea
              id="pix-copia-e-cola"
              readOnly
              rows={3}
              value={cobranca.copiaECola}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-none break-all rounded-lg border border-accent1 bg-white p-2 font-mono text-xs"
            />
            <button type="button" className="btn-primario self-start" onClick={copiar}>
              {copiado ? "Código copiado!" : "Copiar código PIX"}
            </button>
            <p className="text-primaria/80">
              Vale até às {horaCurta(cobranca.expiraEm)}. Assim que o pagamento cair, esta página se atualiza sozinha.
            </p>
          </div>
        </div>
      )}

      {pendente && !simulado && vencido && (
        <div className="mt-4 flex flex-col items-start gap-3 text-sm">
          <p>
            {cobranca
              ? "Este PIX venceu sem pagamento. Gere outro para concluir a compra."
              : "Não conseguimos gerar o PIX deste pedido agora."}
          </p>
          <button type="button" className="btn-primario" onClick={gerarPix} disabled={gerando}>
            {gerando ? "Gerando PIX…" : cobranca ? "Gerar novo PIX" : "Gerar PIX"}
          </button>
        </div>
      )}

      {pendente && simulado && (
        <p className="mt-3 text-sm text-primaria/85">
          {restante > 0 ? `Aguardando o PIX (simulado)… confirmação em ${restante}s.` : "Confirmando o pagamento…"}
        </p>
      )}

      {aviso && pendente && (
        <p role="alert" className="mt-3 text-sm font-medium text-secundaria">
          {aviso}
        </p>
      )}
      {status === "PAGO" && (
        <p className="mt-3 text-sm text-primaria/85">Pagamento confirmado! Já estamos preparando sua geleia com carinho.</p>
      )}
    </div>
  );
}
