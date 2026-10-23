"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { LinkInstagram, PagamentoConfirmado, PagamentoPorEtapa, temEtapaECobranca } from "@/components/checkout/PagamentoPorEtapa";
import { SeloDaEtapa } from "@/components/checkout/SeloDoPagamento";
import { formatarBRL } from "@/lib/dinheiro";
import type { SituacaoDaParcelaDTO } from "@/lib/encomendas-pagamentos";
import { statusConfirmado, statusFinal, type Parcela, type StatusEncomenda } from "@/lib/encomendas-regras";
import type { EtapaPagamento } from "@/lib/pagamentos-regras";

const ROTULO: Record<Parcela, string> = { ENTRADA: "Entrada", RESTANTE: "Restante" };

const SELO: Record<Parcela, Record<EtapaPagamento, string>> = {
  ENTRADA: {
    PAGAR: "Falta pagar",
    CONFIRMANDO: "Confirmando o pagamento",
    PAGO: "Paga",
    EXPIRADO: "Prazo terminou",
    CANCELADO: "Encerrada",
    INDISPONIVEL: "Ainda não liberada",
  },
  RESTANTE: {
    PAGAR: "Falta pagar",
    CONFIRMANDO: "Confirmando o pagamento",
    PAGO: "Pago",
    EXPIRADO: "Encerrado",
    CANCELADO: "Encerrado",
    INDISPONIVEL: "Ainda não liberado",
  },
};

const ANUNCIO: Record<Parcela, Record<EtapaPagamento, string>> = {
  ENTRADA: {
    PAGAR: "Falta pagar a entrada.",
    CONFIRMANDO: "Estamos confirmando o pagamento da entrada com a InfinitePay.",
    PAGO: "Entrada paga. Encomenda confirmada.",
    EXPIRADO: "O prazo para pagar a entrada terminou.",
    CANCELADO: "Encomenda encerrada.",
    INDISPONIVEL: "A entrada ainda não pode ser paga.",
  },
  RESTANTE: {
    PAGAR: "Falta pagar o restante.",
    CONFIRMANDO: "Estamos confirmando o pagamento do restante com a InfinitePay.",
    PAGO: "Restante pago. Encomenda quitada.",
    EXPIRADO: "Encomenda encerrada.",
    CANCELADO: "Encomenda encerrada.",
    INDISPONIVEL: "O restante ainda não pode ser pago.",
  },
};

/** A resposta do GET tem o formato esperado? (Senão, a tela fica com o que já sabia.) */
function ehSituacao(json: unknown): json is SituacaoDaParcelaDTO {
  if (!temEtapaECobranca(json)) return false;
  const s = json as Partial<SituacaoDaParcelaDTO>;
  return typeof s.status === "string" && typeof s.entradaPaga === "boolean" && typeof s.restantePaga === "boolean";
}

const aberto = (s: SituacaoDaParcelaDTO) =>
  !statusFinal(s.status) && (s.etapa === "PAGAR" || s.etapa === "CONFIRMANDO" || s.etapa === "INDISPONIVEL");

/** A parcela ainda não pode ser paga por causa do andamento (e não porque o pagamento está fora do ar). */
function aindaNaoLiberada(parcela: Parcela, status: StatusEncomenda): boolean {
  return parcela === "ENTRADA" ? status === "SOLICITADA" : status === "SOLICITADA" || status === "AGUARDANDO_ENTRADA";
}

type Props = {
  encomendaId: string;
  parcela: Parcela;
  /** Reais. */
  valor: number;
  situacaoInicial: SituacaoDaParcelaDTO;
  /** ISO: prazo da entrada (só na ENTRADA, depois da aprovação). */
  pagarAte: string | null;
  /** Frase sob o título: o que a parcela cobre e até quando (ex.: "Inclui a entrega. Até o dia da entrega (07/11)."). */
  descricao: string;
  /** O restante foi recebido pela Geleiô fora do site (dinheiro, PIX direto). */
  restanteForaDoSite: boolean;
};

/**
 * Uma parcela da encomenda (entrada ou restante), com o mesmo miolo de pagamento da página do pedido
 * (`PagamentoPorEtapa`): botão para a InfinitePay, "Confirmando" com consulta a cada 5 s (inclusive
 * na volta, `?retorno=1`), pago com método e comprovante. Ao mudar de etapa para paga ou encerrada,
 * a página inteira se atualiza (status, prazos, a outra parcela e a desistência mudam juntos).
 */
export function PagamentoDaParcela({ encomendaId, parcela, valor, situacaoInicial, pagarAte, descricao, restanteForaDoSite }: Props) {
  const router = useRouter();
  const base = `/api/encomendas/${encodeURIComponent(encomendaId)}`;
  const corpo = JSON.stringify({ parcela });
  const idTitulo = `titulo-parcela-${parcela.toLowerCase()}`;

  const aoMudarEtapa = useCallback(
    (etapa: EtapaPagamento) => {
      if (etapa === "PAGO" || etapa === "EXPIRADO" || etapa === "CANCELADO") router.refresh();
    },
    [router],
  );

  const cabecalho = (s: SituacaoDaParcelaDTO) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 id={idTitulo} className="text-lg font-bold">
        {ROTULO[parcela]} <span className="tabular-nums">{formatarBRL(valor)}</span>
      </h3>
      <SeloDaEtapa etapa={s.etapa} rotulo={SELO[parcela][s.etapa]} />
      <p className="w-full text-sm text-primaria/80">{descricao}</p>
    </div>
  );

  const informar = (s: SituacaoDaParcelaDTO) => {
    switch (s.etapa) {
      case "PAGO":
        return (
          <PagamentoConfirmado
            cobranca={parcela === "RESTANTE" && restanteForaDoSite ? null : s.cobranca}
            mensagem={
              parcela === "ENTRADA"
                ? statusConfirmado(s.status)
                  ? "Entrada paga! Sua encomenda está confirmada."
                  : "Entrada paga."
                : restanteForaDoSite
                  ? "Restante recebido pela Geleiô. Encomenda quitada."
                  : "Restante pago! Encomenda quitada."
            }
          />
        );
      case "EXPIRADO":
        return parcela === "ENTRADA" ? (
          <div className="flex flex-col items-start gap-3">
            <p>O prazo para pagar a entrada terminou e nada foi cobrado. Se ainda quiser, faça uma nova solicitação.</p>
            <Link href="/lembrancinhas" className="btn-secundario">
              Nova solicitação
            </Link>
          </div>
        ) : (
          <p>Encomenda encerrada: não há o que pagar.</p>
        );
      case "CANCELADO":
        return <p>Encomenda encerrada: não há o que pagar.</p>;
      case "INDISPONIVEL":
        return aindaNaoLiberada(parcela, s.status) ? (
          <p className="text-primaria/85">
            {parcela === "ENTRADA"
              ? "Liberada quando a Geleiô aprovar a encomenda. Você terá 24 horas para pagar."
              : "Liberado depois que a entrada for paga."}
          </p>
        ) : (
          <p>
            O pagamento pelo site está indisponível agora. Tente de novo mais tarde ou fale com a gente no Instagram <LinkInstagram />.
          </p>
        );
      default:
        return null;
    }
  };

  return (
    <PagamentoPorEtapa
      situacaoInicial={situacaoInicial}
      urlSituacao={`${base}/pagamento?parcela=${parcela}`}
      urlPagar={`${base}/pagamento`}
      corpoPagar={corpo}
      urlSimular={`${base}/simular-pagamento`}
      corpoSimular={corpo}
      ehSituacao={ehSituacao}
      aberto={aberto}
      pagarAte={() => (parcela === "ENTRADA" ? pagarAte : null)}
      anuncio={ANUNCIO[parcela]}
      voltarPara="à sua encomenda"
      rotuloDoBotao={parcela === "ENTRADA" ? "Pagar a entrada" : "Pagar o restante"}
      idTitulo={idTitulo}
      cabecalho={cabecalho}
      informar={informar}
      aoMudarEtapa={aoMudarEtapa}
    />
  );
}
