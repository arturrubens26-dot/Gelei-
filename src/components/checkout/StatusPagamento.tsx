"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SeloDoPagamento } from "@/components/checkout/SeloDoPagamento";
import { siteEmLocalhost, urlDaInfinitePay } from "@/components/checkout/urlDaInfinitePay";
import { dadosLoja } from "@/lib/dados-loja";
import { formatarBRL } from "@/lib/dinheiro";
import {
  JANELA_CONFIRMANDO_MS,
  rotuloDoMetodo,
  type CobrancaDTO,
  type EtapaPagamento,
  type SituacaoPagamentoDTO,
} from "@/lib/pagamentos-regras";

/** De quanto em quanto tempo a tela pergunta ao servidor (que confere na InfinitePay). */
const INTERVALO_CONSULTA_MS = 5_000;
/** Pagamento de demonstração (gateway simulado): "paga" sozinho depois desta contagem. */
const SEGUNDOS_DA_SIMULACAO = 5;

const FUSO = "America/Sao_Paulo";
const formatoDia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
const formatoHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
/** "24/10 às 15:40" (horário de Brasília). */
const diaEHora = (iso: string) => `${formatoDia.format(new Date(iso))} às ${formatoHora.format(new Date(iso))}`;

/** Frase curta lida pelo leitor de tela quando a etapa muda. */
const ANUNCIO: Record<EtapaPagamento, string> = {
  PAGAR: "Falta pagar este pedido.",
  CONFIRMANDO: "Estamos confirmando o seu pagamento com a InfinitePay.",
  PAGO: "Pagamento confirmado.",
  EXPIRADO: "O prazo para pagar este pedido terminou.",
  CANCELADO: "Pedido cancelado.",
  INDISPONIVEL: "O pagamento pelo site está indisponível agora.",
};

const ETAPAS: readonly EtapaPagamento[] = ["PAGAR", "CONFIRMANDO", "PAGO", "EXPIRADO", "CANCELADO", "INDISPONIVEL"];

/** A resposta do GET tem o formato esperado? (Senão, a tela fica com o que já sabia.) */
function ehSituacao(json: unknown): json is SituacaoPagamentoDTO {
  if (!json || typeof json !== "object") return false;
  const s = json as Partial<SituacaoPagamentoDTO>;
  return typeof s.pedidoStatus === "string" && ETAPAS.includes(s.etapa as EtapaPagamento) && "cobranca" in s;
}

type Props = {
  pedidoId: string;
  situacaoInicial: SituacaoPagamentoDTO;
};

/**
 * Pagamento do pedido (página de confirmação), por etapa:
 * - PAGAR: botão que abre (ou reaproveita) o link e leva à página da InfinitePay (PIX ou cartão até
 *   12x). Pagamento a caminho (aviso não resolvido, retorno recente): o servidor responde 409 com
 *   "Não pague de novo…" ou "Aguarde alguns minutos…", e a tela mostra o texto e passa a confirmar;
 * - CONFIRMANDO: o servidor mantém a etapa enquanto há aviso não resolvido e por 30 min depois do
 *   retorno da InfinitePay; a tela pergunta a cada 5 s, com a aba visível, por até 30 min;
 * - PAGO (com o método e o comprovante), EXPIRADO, CANCELADO e INDISPONIVEL: só informam.
 * DEMONSTRAÇÃO (gateway simulado): conta 5 s e "paga" sozinho. A mudança de etapa é anunciada
 * (aria-live) e a voltar pelo "voltar" do navegador (bfcache) a tela pergunta de novo.
 */
export function StatusPagamento({ pedidoId, situacaoInicial }: Props) {
  const [situacao, setSituacao] = useState(situacaoInicial);
  // A página do servidor foi renderizada de novo (navegação, refresh): os dados dela são os mais novos.
  const [inicialAnterior, setInicialAnterior] = useState(situacaoInicial);
  if (situacaoInicial !== inicialAnterior) {
    setInicialAnterior(situacaoInicial);
    setSituacao(situacaoInicial);
  }
  const [passouPorConfirmando, setPassouPorConfirmando] = useState(situacaoInicial.etapa === "CONFIRMANDO");
  if (situacao.etapa === "CONFIRMANDO" && !passouPorConfirmando) setPassouPorConfirmando(true);

  const [abrindo, setAbrindo] = useState(false);
  const [indoPagar, setIndoPagar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // "Confirmando" há mais de 30 min nesta tela: para de perguntar e orienta falar com a loja.
  const [esperaEsgotada, setEsperaEsgotada] = useState(false);
  const [restante, setRestante] = useState(SEGUNDOS_DA_SIMULACAO);
  const simulou = useRef(false);
  const abrindoRef = useRef(false);
  // Só a resposta da consulta mais recente vale (uma lenta não desfaz uma mais nova).
  const ultimaConsulta = useRef(0);

  const { etapa, cobranca, pagarAte, pedidoStatus } = situacao;
  const simulado = cobranca?.gateway === "simulado";
  const simulando = etapa === "PAGAR" && simulado && cobranca?.status === "PENDENTE";
  const demorando = etapa === "CONFIRMANDO" && esperaEsgotada;
  // Voltou a "pagar" depois de "confirmando" (a InfinitePay não confirmou), ou a espera acabou.
  const semConfirmacao = (passouPorConfirmando && etapa === "PAGAR") || demorando;

  const consultar = useCallback(async () => {
    const numero = ++ultimaConsulta.current;
    try {
      const resposta = await fetch(`/api/orders/${encodeURIComponent(pedidoId)}/pagamento`, { cache: "no-store" });
      if (!resposta.ok) return;
      const json: unknown = await resposta.json().catch(() => null);
      if (numero === ultimaConsulta.current && ehSituacao(json)) setSituacao(json);
    } catch {
      // Sem conexão: a próxima volta tenta de novo.
    }
  }, [pedidoId]);

  // Consulta periódica enquanto "confirmando" (até 30 min nesta tela).
  const consultando = etapa === "CONFIRMANDO" && !esperaEsgotada;
  useEffect(() => {
    if (!consultando) return;
    const fim = Date.now() + JANELA_CONFIRMANDO_MS;
    const repeticao = setInterval(() => {
      if (Date.now() >= fim) {
        clearInterval(repeticao);
        setEsperaEsgotada(true);
        return;
      }
      if (document.visibilityState === "visible") void consultar();
    }, INTERVALO_CONSULTA_MS);
    return () => clearInterval(repeticao);
  }, [consultando, consultar]);

  // Voltou para a aba, ou voltou da InfinitePay pelo "voltar" do navegador (página restaurada do
  // bfcache, ainda com "Levando você para o pagamento…"): pergunta de novo.
  const pendente = pedidoStatus === "PENDENTE";
  useEffect(() => {
    if (!pendente) return;
    const aoVoltar = (evento: Event) => {
      if (evento.type === "pageshow") {
        if (!(evento as PageTransitionEvent).persisted) return;
        setIndoPagar(false);
      }
      if (document.visibilityState === "visible") void consultar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("pageshow", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("pageshow", aoVoltar);
    };
  }, [pendente, consultar]);

  // DEMONSTRAÇÃO: contagem regressiva e "pagamento" automático.
  useEffect(() => {
    if (!simulando || restante <= 0) return;
    const espera = setTimeout(() => setRestante((r) => r - 1), 1000);
    return () => clearTimeout(espera);
  }, [simulando, restante]);

  useEffect(() => {
    if (!simulando || restante > 0 || simulou.current) return;
    simulou.current = true; // evita disparo duplo (StrictMode em desenvolvimento)
    fetch(`/api/orders/${encodeURIComponent(pedidoId)}/simular-pagamento`, { method: "POST" })
      .then((resposta) => {
        if (resposta.ok || resposta.status === 409) return consultar();
        setAviso("Não foi possível confirmar o pagamento agora. Atualize a página em instantes.");
      })
      .catch(() => setAviso("Sem conexão para confirmar o pagamento. Atualize a página."));
  }, [simulando, restante, pedidoId, consultar]);

  async function pagar() {
    if (abrindoRef.current) return;
    abrindoRef.current = true;
    setAbrindo(true);
    setAviso(null);
    try {
      const resposta = await fetch(`/api/orders/${encodeURIComponent(pedidoId)}/pagamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await resposta.json().catch(() => null);
      const nova: CobrancaDTO | undefined = resposta.ok ? json?.cobranca : undefined;
      if (nova?.gateway === "simulado") {
        simulou.current = false;
        setRestante(SEGUNDOS_DA_SIMULACAO);
        setSituacao((s) => ({ ...s, cobranca: nova }));
        return;
      }
      if (nova && urlDaInfinitePay(nova.checkoutUrl, siteEmLocalhost())) {
        setIndoPagar(true);
        window.location.assign(nova.checkoutUrl);
        return;
      }
      setAviso(json?.erro ?? "Não conseguimos abrir o pagamento agora. Tente de novo em instantes.");
      // 409: já pago, expirou ou não está mais aguardando pagamento. A tela se atualiza.
      if (resposta.status === 409) void consultar();
    } catch {
      setAviso("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      abrindoRef.current = false;
      setAbrindo(false);
    }
  }

  const anuncio = demorando
      ? "A confirmação do pagamento está demorando. Não pague de novo."
      : semConfirmacao
        ? "Ainda não recebemos a confirmação do pagamento."
        : ANUNCIO[etapa];

  return (
    <section aria-labelledby="titulo-pagamento" className="cartao p-5">
      <p className="sr-only" role="status" aria-live="polite">
        {indoPagar ? "Levando você para a página de pagamento." : anuncio}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-pagamento" className="text-2xl font-bold">
          Pagamento
        </h2>
        <SeloDoPagamento status={pedidoStatus} etapa={etapa} />
      </div>

      {indoPagar ? (
        <p className="mt-4 flex items-start gap-2 text-sm">
          <Rodinha />
          <span>
            Levando você para a página segura da InfinitePay… Depois de pagar, toque em “Continuar” para voltar ao seu pedido.
          </span>
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 text-sm leading-relaxed">
          {etapa === "PAGAR" && (
            <>
              {semConfirmacao && <SemConfirmacao />}
              {simulando ? (
                <p className="flex items-start gap-2 text-primaria/85">
                  <Rodinha />
                  <span>
                    {restante > 0
                      ? `Pagamento de demonstração: confirmação em ${restante}s.`
                      : "Pagamento de demonstração: confirmando…"}
                  </span>
                </p>
              ) : (
                <>
                  <p>
                    Você paga com <strong className="font-semibold">PIX ou cartão (até 12x)</strong> na página segura da InfinitePay e volta
                    para cá. No parcelado, os juros aparecem antes de você confirmar.
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* aria-disabled (e não disabled) enquanto abre: o botão não perde o foco. */}
                    <button
                      type="button"
                      onClick={pagar}
                      aria-disabled={abrindo || undefined}
                      className="btn-primario aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                    >
                      {abrindo ? "Abrindo o pagamento…" : "Pagar com PIX ou cartão"}
                    </button>
                    {pagarAte && <span className="text-primaria/80">Você pode pagar até {diaEHora(pagarAte)}.</span>}
                  </div>
                </>
              )}
            </>
          )}

          {etapa === "CONFIRMANDO" &&
            (demorando ? (
              <SemConfirmacao demorando />
            ) : (
              <Quadro>
                <Rodinha />
                <span>
                  Recebemos o retorno do pagamento e estamos confirmando com a InfinitePay. Esta página se atualiza sozinha; pode levar
                  alguns minutos.
                </span>
              </Quadro>
            ))}

          {etapa === "PAGO" && <Pago pedidoStatus={pedidoStatus} cobranca={cobranca} />}

          {etapa === "EXPIRADO" && (
            <div className="flex flex-col items-start gap-3">
              <p>O prazo para pagar este pedido terminou. Faça um novo pedido.</p>
              <Link href="/products" className="btn-primario">
                Fazer um novo pedido
              </Link>
            </div>
          )}

          {etapa === "CANCELADO" && <p>Pedido cancelado.</p>}

          {etapa === "INDISPONIVEL" && (
            <p>
              O pagamento pelo site está indisponível agora. Tente de novo mais tarde
              {pagarAte ? ` (você pode pagar até ${diaEHora(pagarAte)})` : ""} ou fale com a gente no Instagram <LinkInstagram />.
            </p>
          )}

          {/* Vazio, o alerta não ocupa espaço (o -mt-3 anula o gap); continua no DOM para o role="alert". */}
          <p role="alert" className="font-medium text-secundaria empty:-mt-3">
            {aviso && (etapa === "PAGAR" || etapa === "CONFIRMANDO") ? aviso : null}
          </p>
        </div>
      )}
    </section>
  );
}

function Pago({ pedidoStatus, cobranca }: { pedidoStatus: SituacaoPagamentoDTO["pedidoStatus"]; cobranca: CobrancaDTO | null }) {
  const metodo = cobranca ? rotuloDoMetodo(cobranca.metodo, cobranca.parcelas) : null;
  const comJuros = cobranca?.valorPago != null && cobranca.valorPago > cobranca.valor;
  const comprovante = cobranca && urlDaInfinitePay(cobranca.comprovanteUrl) ? cobranca.comprovanteUrl : null;
  return (
    <>
      <p className="font-semibold">
        Pagamento confirmado!{pedidoStatus === "PAGO" ? " Já estamos preparando sua geleia com carinho." : ""}
      </p>
      {metodo && (
        <p>
          Forma de pagamento: <strong className="font-semibold">{metodo}</strong>
          {comJuros && cobranca?.valorPago != null && (
            <span className="text-primaria/85"> · valor pago {formatarBRL(cobranca.valorPago)}, com os juros do parcelamento</span>
          )}
        </p>
      )}
      {comprovante && (
        <p>
          <a
            href={comprovante}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
          >
            Ver comprovante
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        </p>
      )}
    </>
  );
}

/**
 * `demorando`: ainda em "confirmando" depois de 30 min (inclusive pagamento que a loja precisa
 * conferir à mão): não pagar de novo. Sem ele: voltou a "pagar" sem a InfinitePay confirmar.
 */
function SemConfirmacao({ demorando = false }: { demorando?: boolean }) {
  return (
    <p className="rounded-lg border-2 border-secundaria bg-white p-3 font-medium">
      {demorando
        ? "A confirmação está demorando mais que o normal. Não pague de novo: fale com a gente no Instagram "
        : "Ainda não recebemos a confirmação. Se você pagou, fale com a gente no Instagram "}
      <LinkInstagram />.
    </p>
  );
}

function LinkInstagram() {
  return (
    <a
      href={dadosLoja.instagram.url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
    >
      @{dadosLoja.instagram.usuario}
      <span className="sr-only"> (abre em nova aba)</span>
    </a>
  );
}

function Quadro({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 rounded-lg border border-accent3 bg-accent3/10 p-3">{children}</p>;
}

/** Indicador de espera: gira só sem `prefers-reduced-motion` (parado, continua um anel). */
function Rodinha() {
  return <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-secundaria/30 border-t-secundaria motion-safe:animate-spin" />;
}
