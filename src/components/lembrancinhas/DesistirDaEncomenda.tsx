"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatarBRL } from "@/lib/dinheiro";
import { PRAZO_DEVOLUCAO_DIAS_UTEIS } from "@/lib/encomendas-politica";
import { DIAS_DESISTENCIA_APOS_ENTRADA, DIAS_DESISTENCIA_APOS_RECEBER } from "@/lib/encomendas-regras";

type Previa = { devolucao: number; retido: number; devolucaoCentavos: number };

type Props = {
  encomendaId: string;
  previaInicial: Previa;
  /** Política v2 (art. 49): nada é retido; desiste antes da entrega e até 7 dias depois de receber. */
  semRetencao: boolean;
  /** Política v3 (atual): desiste até 3 dias depois de pagar a entrada, com devolução de tudo. */
  tresDias: boolean;
  /**
   * "quarta-feira, 11/11/2026, às 23h59", o fim da desistência pelo site: v3 com a entrada paga (3 dias
   * depois dela) ou v2 já recebida (7 dias depois de receber).
   */
  desistirAte: string | null;
  /** v1 (antiga): "quarta-feira, 11/11/2026, às 23h59", até quando a desistência devolve tudo. */
  corte: string;
  /** v1: o corte já passou (a entrada, se paga, fica com a Geleiô no percentual da política). */
  depoisDoCorte: boolean;
  /** Algo já foi pago (entrada ou restante). */
  temPagamento: boolean;
};

/**
 * "Desistir da encomenda" (Decreto 7.962, art. 5º: pela mesma ferramenta). Mostra a prévia do que
 * volta e do que fica com a Geleiô, pede confirmação na própria página e manda a prévia que a cliente
 * viu: se o corte passou entre a tela e o clique, o servidor responde 409 com a nova prévia, a tela a
 * mostra e pede para confirmar de novo.
 */
export function DesistirDaEncomenda({ encomendaId, previaInicial, semRetencao, tresDias, desistirAte, corte, depoisDoCorte, temPagamento }: Props) {
  const router = useRouter();
  const [previa, setPrevia] = useState(previaInicial);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const abriuAgora = useRef(false);

  // Abriu a confirmação: o foco vai para ela (e volta ao botão quando a pessoa desiste de desistir).
  useEffect(() => {
    if (!abriuAgora.current) return;
    abriuAgora.current = false;
    (confirmando ? tituloRef.current : botaoRef.current)?.focus();
  }, [confirmando]);

  function alternar(abrir: boolean) {
    abriuAgora.current = true;
    setErro(null);
    setConfirmando(abrir);
  }

  async function desistir() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/encomendas/${encodeURIComponent(encomendaId)}/desistir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devolucaoEsperadaCentavos: previa.devolucaoCentavos }),
      });
      const json = await resposta.json().catch(() => null);
      if (resposta.ok) {
        // Até a página voltar atualizada, o aviso fica no lugar dos botões (sem clicar duas vezes).
        setFeito(true);
        router.refresh();
        return;
      }
      const d = json?.detalhes;
      if (resposta.status === 409 && typeof d?.devolucaoCentavos === "number") {
        setPrevia({ devolucao: d.devolucao, retido: d.retido, devolucaoCentavos: d.devolucaoCentavos });
        setErro(`${json?.erro ?? "O valor da devolução mudou."} Confira o novo valor e confirme de novo.`);
        return;
      }
      setErro(json?.erro ?? "Não foi possível desistir agora. Tente de novo em instantes.");
      // Encerrada, ou mudou enquanto isso: a página mostra como está agora.
      if (resposta.status === 409 && d?.statusAtual && !/conferid/i.test(json?.erro ?? "")) router.refresh();
    } catch {
      setErro("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const devolve = previa.devolucao > 0;
  const resultado = !temPagamento
    ? "Nada foi cobrado, então não há o que devolver."
    : semRetencao
      ? `Devolvemos ${formatarBRL(previa.devolucao)}, tudo o que você pagou, de imediato e pelo mesmo meio do pagamento (no cartão, o estorno aparece na fatura conforme o prazo do banco).${
          desistirAte && !tresDias ? " Combinamos com você a devolução dos potinhos, que devem estar lacrados e sem uso; o custo do retorno é da Geleiô." : ""
        }`
      : `Devolvemos ${formatarBRL(previa.devolucao)}, pelo mesmo meio do pagamento, em até ${PRAZO_DEVOLUCAO_DIAS_UTEIS} dias úteis.${
          previa.retido > 0 ? ` Ficam com a Geleiô ${formatarBRL(previa.retido)} da entrada, como diz a política.` : ""
        }`;

  return (
    <section aria-labelledby="titulo-desistir" className="cartao p-5 print:hidden">
      <h2 id="titulo-desistir" className="text-2xl font-bold">
        Desistir da encomenda
      </h2>
      <p className="mt-2 text-sm leading-relaxed">
        {tresDias ? (
          desistirAte ? (
            `Você pode desistir aqui até ${desistirAte} (${DIAS_DESISTENCIA_APOS_ENTRADA} dias depois de pagar a entrada), e devolvemos tudo o que pagou. Depois disso, não é mais possível desistir.`
          ) : (
            `Você ainda não pagou a entrada: pode desistir quando quiser. Depois de pagar, terá ${DIAS_DESISTENCIA_APOS_ENTRADA} dias para desistir com devolução de tudo.`
          )
        ) : semRetencao ? (
          desistirAte ? (
            `Você pode desistir aqui até ${desistirAte} (${DIAS_DESISTENCIA_APOS_RECEBER} dias depois de receber, art. 49 do Código de Defesa do Consumidor), e devolvemos tudo o que pagou, sem taxa.`
          ) : (
            `Você pode desistir aqui a qualquer momento antes de receber e até ${DIAS_DESISTENCIA_APOS_RECEBER} dias depois de receber (art. 49 do Código de Defesa do Consumidor), e devolvemos tudo o que pagou, sem taxa.`
          )
        ) : (
          <>
            {depoisDoCorte
              ? `O prazo para desistir com devolução integral terminou em ${corte}.`
              : `Até ${corte} você pode desistir aqui e devolvemos tudo o que pagou.`}{" "}
            {temPagamento && depoisDoCorte ? (devolve ? `Se desistir agora, devolvemos ${formatarBRL(previa.devolucao)}.` : "Se desistir agora, não há devolução.") : null}
          </>
        )}
      </p>

      {feito ? (
        <p role="status" className="mt-4 rounded-lg border border-accent3 bg-accent3/10 p-3 text-sm font-semibold">
          Encomenda cancelada. {temPagamento && previa.devolucao > 0 ? `${resultado} ` : ""}Atualizando a página…
        </p>
      ) : confirmando ? (
        <div className="mt-4 rounded-lg border-2 border-secundaria bg-white p-4">
          <h3 ref={tituloRef} tabIndex={-1} className="font-bold outline-offset-4">
            Confirmar a desistência?
          </h3>
          <p className="mt-1 text-sm leading-relaxed">{resultado} A encomenda é cancelada e não dá para desfazer.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primario aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              aria-disabled={enviando || undefined}
              onClick={desistir}
            >
              {enviando ? "Cancelando…" : "Sim, desistir"}
            </button>
            <button type="button" className="btn-secundario" onClick={() => alternar(false)}>
              Manter a encomenda
            </button>
          </div>
        </div>
      ) : (
        <button ref={botaoRef} type="button" className="btn-secundario mt-4" onClick={() => alternar(true)}>
          Desistir da encomenda
        </button>
      )}
      <p role="alert" className="mt-3 text-sm font-medium text-secundaria empty:hidden">
        {erro}
      </p>
    </section>
  );
}
