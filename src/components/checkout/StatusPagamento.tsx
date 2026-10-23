"use client";

import Link from "next/link";
import { LinkInstagram, PagamentoConfirmado, PagamentoPorEtapa, diaEHora, temEtapaECobranca } from "@/components/checkout/PagamentoPorEtapa";
import { SeloDoPagamento } from "@/components/checkout/SeloDoPagamento";
import type { EtapaPagamento, SituacaoPagamentoDTO } from "@/lib/pagamentos-regras";

/** Frase curta lida pelo leitor de tela quando a etapa muda. */
const ANUNCIO: Record<EtapaPagamento, string> = {
  PAGAR: "Falta pagar este pedido.",
  CONFIRMANDO: "Estamos confirmando o seu pagamento com a InfinitePay.",
  PAGO: "Pagamento confirmado.",
  EXPIRADO: "O prazo para pagar este pedido terminou.",
  CANCELADO: "Pedido cancelado.",
  INDISPONIVEL: "O pagamento pelo site está indisponível agora.",
};

/** A resposta do GET tem o formato esperado? (Senão, a tela fica com o que já sabia.) */
function ehSituacao(json: unknown): json is SituacaoPagamentoDTO {
  return temEtapaECobranca(json) && typeof (json as Partial<SituacaoPagamentoDTO>).pedidoStatus === "string";
}

const aberto = (s: SituacaoPagamentoDTO) => s.pedidoStatus === "PENDENTE";
const pagarAte = (s: SituacaoPagamentoDTO) => s.pagarAte;

function Cabecalho(s: SituacaoPagamentoDTO) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="titulo-pagamento" className="text-2xl font-bold">
        Pagamento
      </h2>
      <SeloDoPagamento status={s.pedidoStatus} etapa={s.etapa} />
    </div>
  );
}

function Informar({ etapa, pedidoStatus, pagarAte, cobranca }: SituacaoPagamentoDTO) {
  switch (etapa) {
    case "PAGO":
      return (
        <PagamentoConfirmado
          cobranca={cobranca}
          mensagem={`Pagamento confirmado!${pedidoStatus === "PAGO" ? " Já estamos preparando sua geleia com carinho." : ""}`}
        />
      );
    case "EXPIRADO":
      return (
        <div className="flex flex-col items-start gap-3">
          <p>O prazo para pagar este pedido terminou. Faça um novo pedido.</p>
          <Link href="/products" className="btn-primario">
            Fazer um novo pedido
          </Link>
        </div>
      );
    case "CANCELADO":
      return <p>Pedido cancelado.</p>;
    case "INDISPONIVEL":
      return (
        <p>
          O pagamento pelo site está indisponível agora. Tente de novo mais tarde
          {pagarAte ? ` (você pode pagar até ${diaEHora(pagarAte)})` : ""} ou fale com a gente no Instagram <LinkInstagram />.
        </p>
      );
    default:
      return null;
  }
}

/**
 * Pagamento do pedido (página de confirmação), por etapa: o miolo é o `PagamentoPorEtapa` (o mesmo
 * da encomenda de lembrancinhas); aqui ficam as rotas, os textos e o selo do pedido.
 */
export function StatusPagamento({ pedidoId, situacaoInicial }: { pedidoId: string; situacaoInicial: SituacaoPagamentoDTO }) {
  const base = `/api/orders/${encodeURIComponent(pedidoId)}`;
  return (
    <PagamentoPorEtapa
      situacaoInicial={situacaoInicial}
      urlSituacao={`${base}/pagamento`}
      urlPagar={`${base}/pagamento`}
      corpoPagar="{}"
      urlSimular={`${base}/simular-pagamento`}
      corpoSimular="{}"
      ehSituacao={ehSituacao}
      aberto={aberto}
      pagarAte={pagarAte}
      anuncio={ANUNCIO}
      voltarPara="ao seu pedido"
      rotuloDoBotao="Pagar com PIX ou cartão"
      idTitulo="titulo-pagamento"
      cabecalho={Cabecalho}
      informar={Informar}
      className="cartao p-5"
    />
  );
}
