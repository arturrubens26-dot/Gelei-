"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { siteEmLocalhost, urlDaInfinitePay } from "@/components/checkout/urlDaInfinitePay";
import { dadosLoja } from "@/lib/dados-loja";
import { FUSO_LOJA } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import { JANELA_CONFIRMANDO_MS, rotuloDoMetodo, type CobrancaDTO, type EtapaPagamento } from "@/lib/pagamentos-regras";

/** De quanto em quanto tempo a tela pergunta ao servidor (que confere na InfinitePay). */
const INTERVALO_CONSULTA_MS = 5_000;
/** Pagamento de demonstração (gateway simulado): "paga" sozinho depois desta contagem. */
const SEGUNDOS_DA_SIMULACAO = 5;

const ETAPAS: readonly EtapaPagamento[] = ["PAGAR", "CONFIRMANDO", "PAGO", "EXPIRADO", "CANCELADO", "INDISPONIVEL"];

/** O que toda situação de pagamento tem (pedido ou parcela de encomenda). */
export type SituacaoBase = { etapa: EtapaPagamento; cobranca: CobrancaDTO | null };

/** A resposta do GET tem a etapa e a cobrança? (O resto cada tela confere no seu `ehSituacao`.) */
export function temEtapaECobranca(json: unknown): json is SituacaoBase {
  if (!json || typeof json !== "object") return false;
  const s = json as Partial<SituacaoBase>;
  return ETAPAS.includes(s.etapa as EtapaPagamento) && "cobranca" in s;
}

export type PropsPagamentoPorEtapa<S extends SituacaoBase> = {
  situacaoInicial: S;
  /** GET da situação (o servidor confere na InfinitePay). */
  urlSituacao: string;
  /** POST que abre (ou reaproveita) o link de pagamento, e o corpo JSON dele. */
  urlPagar: string;
  corpoPagar: string;
  /** POST do pagamento de demonstração (gateway simulado). */
  urlSimular: string;
  corpoSimular: string;
  ehSituacao: (json: unknown) => json is S;
  /** Ainda falta pagar: a tela pergunta de novo ao voltar para a aba ou do "voltar" do navegador. */
  aberto: (s: S) => boolean;
  /** ISO: até quando dá para pagar (aparece ao lado do botão). */
  pagarAte: (s: S) => string | null;
  /** Frase do leitor de tela para cada etapa. */
  anuncio: Record<EtapaPagamento, string>;
  /** "ao seu pedido", "à sua encomenda": completa "toque em Continuar para voltar…". */
  voltarPara: string;
  rotuloDoBotao: string;
  /** Id do título (o `aria-labelledby` da seção). */
  idTitulo: string;
  /** Título e selo no alto da seção (o selo muda com a etapa). */
  cabecalho: (s: S) => ReactNode;
  /** Conteúdo das etapas que só informam: PAGO, EXPIRADO, CANCELADO e INDISPONIVEL. */
  informar: (s: S) => ReactNode;
  /** Chamado quando a etapa muda (não na primeira renderização). */
  aoMudarEtapa?: (etapa: EtapaPagamento) => void;
  className?: string;
};

const FUSO = FUSO_LOJA;
const formatoDia = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
const formatoHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
/** "24/10 às 15:40" (horário da loja, Teresina). */
export const diaEHora = (iso: string) => `${formatoDia.format(new Date(iso))} às ${formatoHora.format(new Date(iso))}`;

/**
 * Pagamento pela InfinitePay, por etapa (o miolo da página do pedido e da página da encomenda):
 * - PAGAR: botão que abre (ou reaproveita) o link e leva à página da InfinitePay (PIX ou cartão até
 *   12x). Pagamento a caminho (aviso não resolvido, retorno recente): o servidor responde 409 com
 *   "Não pague de novo…" ou "Aguarde alguns minutos…", e a tela mostra o texto e passa a confirmar;
 * - CONFIRMANDO: o servidor mantém a etapa enquanto há aviso não resolvido e por 30 min depois do
 *   retorno da InfinitePay; a tela pergunta a cada 5 s, com a aba visível, por até 30 min;
 * - PAGO, EXPIRADO, CANCELADO e INDISPONIVEL: só informam (`informar`, de cada tela).
 * DEMONSTRAÇÃO (gateway simulado): conta 5 s e "paga" sozinho. A mudança de etapa é anunciada
 * (aria-live) e, ao voltar pelo "voltar" do navegador (bfcache), a tela pergunta de novo.
 */
export function PagamentoPorEtapa<S extends SituacaoBase>(props: PropsPagamentoPorEtapa<S>) {
  const { situacaoInicial, urlSituacao, urlPagar, corpoPagar, urlSimular, corpoSimular, ehSituacao, aoMudarEtapa } = props;
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

  const { etapa, cobranca } = situacao;
  const pagarAte = props.pagarAte(situacao);
  const simulado = cobranca?.gateway === "simulado";
  const simulando = etapa === "PAGAR" && simulado && cobranca?.status === "PENDENTE";
  const demorando = etapa === "CONFIRMANDO" && esperaEsgotada;
  // Voltou a "pagar" depois de "confirmando" (a InfinitePay não confirmou), ou a espera acabou.
  const semConfirmacao = (passouPorConfirmando && etapa === "PAGAR") || demorando;

  // Avisa a tela de fora quando a etapa muda (ex.: a encomenda recarrega ao confirmar a parcela).
  const etapaAnterior = useRef(etapa);
  useEffect(() => {
    if (etapaAnterior.current === etapa) return;
    etapaAnterior.current = etapa;
    aoMudarEtapa?.(etapa);
  }, [etapa, aoMudarEtapa]);

  const consultar = useCallback(async () => {
    const numero = ++ultimaConsulta.current;
    try {
      const resposta = await fetch(urlSituacao, { cache: "no-store" });
      if (!resposta.ok) return;
      const json: unknown = await resposta.json().catch(() => null);
      if (numero === ultimaConsulta.current && ehSituacao(json)) setSituacao(json);
    } catch {
      // Sem conexão: a próxima volta tenta de novo.
    }
  }, [urlSituacao, ehSituacao]);

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
  const pendente = props.aberto(situacao);
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
    fetch(urlSimular, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpoSimular })
      .then((resposta) => {
        if (resposta.ok || resposta.status === 409) return consultar();
        setAviso("Não foi possível confirmar o pagamento agora. Atualize a página em instantes.");
      })
      .catch(() => setAviso("Sem conexão para confirmar o pagamento. Atualize a página."));
  }, [simulando, restante, urlSimular, corpoSimular, consultar]);

  async function pagar() {
    if (abrindoRef.current) return;
    abrindoRef.current = true;
    setAbrindo(true);
    setAviso(null);
    try {
      const resposta = await fetch(urlPagar, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: corpoPagar,
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
      // 409: já pago, expirou, em conferência ou não está mais aguardando pagamento. A tela se atualiza.
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
      : props.anuncio[etapa];

  return (
    <section aria-labelledby={props.idTitulo} className={props.className}>
      <p className="sr-only" role="status" aria-live="polite">
        {indoPagar ? "Levando você para a página de pagamento." : anuncio}
      </p>
      {props.cabecalho(situacao)}

      {indoPagar ? (
        <p className="mt-4 flex items-start gap-2 text-sm">
          <Rodinha />
          <span>
            Levando você para a página segura da InfinitePay… Depois de pagar, toque em “Continuar” para voltar {props.voltarPara}.
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
                      {abrindo ? "Abrindo o pagamento…" : props.rotuloDoBotao}
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

          {etapa !== "PAGAR" && etapa !== "CONFIRMANDO" && props.informar(situacao)}

          {/* Vazio, o alerta não ocupa espaço (o -mt-3 anula o gap); continua no DOM para o role="alert". */}
          <p role="alert" className="font-medium text-secundaria empty:-mt-3">
            {aviso && (etapa === "PAGAR" || etapa === "CONFIRMANDO") ? aviso : null}
          </p>
        </div>
      )}
    </section>
  );
}

/** Pagamento confirmado: a frase de cada tela, o método (com os juros do parcelado) e o comprovante. */
export function PagamentoConfirmado({ mensagem, cobranca }: { mensagem: ReactNode; cobranca: CobrancaDTO | null }) {
  const metodo = cobranca ? rotuloDoMetodo(cobranca.metodo, cobranca.parcelas) : null;
  const comJuros = cobranca?.valorPago != null && cobranca.valorPago > cobranca.valor;
  const comprovante = cobranca && urlDaInfinitePay(cobranca.comprovanteUrl) ? cobranca.comprovanteUrl : null;
  return (
    <>
      <p className="font-semibold">{mensagem}</p>
      {metodo && (
        <p>
          Forma de pagamento: <strong className="font-semibold">{metodo}</strong>
          {comJuros && cobranca?.valorPago != null && (
            <span className="text-primaria/85"> · valor pago {formatarBRL(cobranca.valorPago)}, com os juros do parcelamento</span>
          )}
        </p>
      )}
      {comprovante && (
        <p className="print:hidden">
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

export function LinkInstagram() {
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
