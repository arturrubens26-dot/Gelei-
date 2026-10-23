import { diaComSemana } from "@/components/lembrancinhas/datas";
import { formatarBRL } from "@/lib/dinheiro";
import type { EncomendaDTO } from "@/lib/encomendas";
import { PRAZO_DEVOLUCAO_DIAS_UTEIS } from "@/lib/encomendas-politica";
import { formatarPrazo, palavraDoModo, statusConfirmado } from "@/lib/encomendas-regras";

/** Só o que estas frases leem da encomenda (a lista e a página usam o mesmo DTO). */
type Encomenda = Pick<
  EncomendaDTO,
  | "statusEfetivo"
  | "modoEntrega"
  | "dataEntrega"
  | "prazos"
  | "entrada"
  | "restante"
  | "entradaPagaEm"
  | "entradaEmFolga"
  | "pagamentoEmConferencia"
  | "restantePagoEm"
  | "motivoRecusa"
  | "motivoCancelamento"
  | "canceladaPor"
  | "devolucao"
>;

const prazo = (iso: string) => formatarPrazo(new Date(iso));

/**
 * Em que pé está a encomenda e o que vem agora, em uma ou duas frases (status em texto, para a
 * cliente). `acao`: a cliente precisa fazer algo (pagar).
 */
export function situacaoDaEncomenda(e: Encomenda): { titulo: string; texto: string; acao: boolean } {
  const palavra = palavraDoModo(e.modoEntrega);
  const dia = diaComSemana(e.dataEntrega);
  const devolucao =
    e.devolucao.status === "PENDENTE"
      ? ` Vamos devolver ${formatarBRL(e.devolucao.pendente)}, pelo mesmo meio do pagamento, em até ${PRAZO_DEVOLUCAO_DIAS_UTEIS} dias úteis.`
      : e.devolucao.status === "FEITA"
        ? ` Devolvemos ${formatarBRL(e.devolucao.devolvido)}.`
        : "";
  // Fora de EXPIRADA e CANCELADA, uma devolução só existe por pagamento em duplicidade (a entrada ou o
  // restante pagos duas vezes): conta isso à cliente em vez de deixar o dinheiro sem explicação.
  const aMais = devolucao ? ` Recebemos um pagamento a mais desta encomenda.${devolucao}` : "";

  switch (e.statusEfetivo) {
    case "SOLICITADA":
      return {
        titulo: "Recebemos a sua solicitação",
        texto: `A Geleiô confere a agenda e responde até ${prazo(e.prazos.responderAte)}. Nada é cobrado antes da aprovação.`,
        acao: false,
      };
    case "AGUARDANDO_ENTRADA":
      // Pagamento em conferência: nunca "Aprovada! Pague até…" (a cliente pagaria de novo).
      if (e.pagamentoEmConferencia.entrada) {
        return {
          titulo: "Estamos confirmando o seu pagamento",
          texto: `Recebemos o aviso do pagamento da entrada de ${formatarBRL(e.entrada)} e estamos conferindo com a InfinitePay. Não pague de novo: se demorar, fale com a loja no Instagram @ge.leio.`,
          acao: false,
        };
      }
      // Depois do prazo e antes de expirar (folga de 30 min): já não se paga, mas a confirmação ainda vale.
      if (e.entradaEmFolga) {
        return {
          titulo: "O prazo da entrada terminou",
          texto: `O prazo para pagar a entrada${e.prazos.entradaAte ? ` (até ${prazo(e.prazos.entradaAte)})` : ""} terminou. Se você acabou de pagar, aguarde alguns minutos: a confirmação ainda vale. Senão, a encomenda expira em instantes e nada é cobrado.`,
          acao: false,
        };
      }
      return {
        titulo: "Aprovada! Falta a entrada",
        texto: `Pague a entrada de ${formatarBRL(e.entrada)}${e.prazos.entradaAte ? ` até ${prazo(e.prazos.entradaAte)}` : ""} para confirmar a encomenda.${aMais}`,
        acao: true,
      };
    case "CONFIRMADA":
    case "EM_PRODUCAO":
    case "PRONTA": {
      const fase =
        e.statusEfetivo === "CONFIRMADA"
          ? "Encomenda confirmada"
          : e.statusEfetivo === "EM_PRODUCAO"
            ? "Seus potinhos estão sendo preparados"
            : `Pronta para a ${palavra}`;
      const falta = e.restantePagoEm === null;
      const conferindo = falta && e.pagamentoEmConferencia.restante;
      return {
        titulo: fase,
        texto: `${palavra[0].toUpperCase()}${palavra.slice(1)} em ${dia}; o horário a gente combina no WhatsApp.${
          conferindo
            ? ` Estamos conferindo o pagamento do restante de ${formatarBRL(e.restante)}; não pague de novo.`
            : falta
              ? ` Falta o restante de ${formatarBRL(e.restante)}, até o dia da ${palavra}.`
              : " Tudo pago."
        }${aMais}`,
        acao: falta && !conferindo && statusConfirmado(e.statusEfetivo),
      };
    }
    case "ENTREGUE":
      return {
        titulo: e.modoEntrega === "RETIRADA" ? "Retirada na loja" : "Entregue",
        texto: `Obrigada pela encomenda! Esperamos que a festa seja linda.${aMais}`,
        acao: false,
      };
    case "RECUSADA":
      return {
        titulo: "A Geleiô não pôde aceitar esta encomenda",
        texto: `${e.motivoRecusa ? `${e.motivoRecusa} ` : ""}Nada foi cobrado.`,
        acao: false,
      };
    case "EXPIRADA":
      // Pagou depois do prazo: o dinheiro entrou e vai voltar. Nunca "nada foi cobrado".
      if (e.devolucao.status !== "NAO_SE_APLICA") {
        return {
          titulo: "Encomenda expirada",
          texto: `Recebemos o seu pagamento depois do prazo, quando a encomenda já tinha expirado.${devolucao} Se ainda quiser, faça uma nova solicitação.`,
          acao: false,
        };
      }
      return {
        titulo: "Encomenda expirada",
        texto: e.prazos.entradaAte
          ? "O prazo para pagar a entrada terminou, e nada foi cobrado. Se ainda quiser, faça uma nova solicitação."
          : "A Geleiô não conseguiu responder a tempo, e nada foi cobrado. Se ainda quiser, faça uma nova solicitação.",
        acao: false,
      };
    case "CANCELADA": {
      const pago = e.entradaPagaEm !== null || e.restantePagoEm !== null;
      const dinheiro = devolucao || (pago ? " O valor pago ficou com a Geleiô, como diz a política de desistência." : " Nada foi cobrado.");
      const motivo = e.canceladaPor !== "CLIENTE" && e.motivoCancelamento ? e.motivoCancelamento : "";
      return {
        titulo: e.canceladaPor === "CLIENTE" ? "Você desistiu desta encomenda" : "A Geleiô cancelou esta encomenda",
        texto: `${motivo}${dinheiro}`.trim(),
        acao: false,
      };
    }
  }
}
