/**
 * Política de desistência das encomendas de lembrancinhas (texto puro, servidor e navegador). A
 * cliente aceita uma VERSÃO deste texto ao solicitar (`politicaVersao`, gravada na encomenda), com os
 * valores e o percentual retido daquela encomenda. Mudou o texto: crie outra versão e mantenha a
 * antiga aqui, para o comprovante das encomendas antigas continuar mostrando o que foi aceito.
 *
 * Não é parecer jurídico: reter a entrada pode ser contestado (CDC, arts. 49 e 51). A dona valida o
 * texto com um advogado ou com o Procon-PI antes de ativar (o painel avisa).
 */
import { formatarBRL } from "@/lib/dinheiro";
import { DIAS_CORTE_ANTES_DA_ENTREGA, formatarPrazo, palavraDoModo, valorRetidoDaEntrada, type ModoEntrega } from "@/lib/encomendas-regras";

export const POLITICA_VERSAO = "2026-11-v1";

/** Prazo prometido para devolver o dinheiro (D16). */
export const PRAZO_DEVOLUCAO_DIAS_UTEIS = 2;

/** Aviso do painel (não bloqueia): o texto da política precisa de validação jurídica. */
export const AVISO_JURIDICO =
  "Reter parte da entrada na desistência pode ser contestado (Código de Defesa do Consumidor, arts. 49 e 51). " +
  "Valide o texto da política com um advogado ou com o Procon-PI antes de abrir as encomendas.";

export type DadosDaPolitica = {
  /** Corte da desistência (00:00 de E−2, mostrado como 23h59 de E−3). */
  corteEm: Date;
  entradaCentavos: number;
  restanteCentavos: number;
  freteCentavos: number;
  modo: ModoEntrega;
  /** 0 a 100: quanto da entrada fica com a loja se a cliente desistir depois do corte (D4). */
  percentualRetido: number;
};

const VERSOES = new Set([POLITICA_VERSAO]);

export function versaoDaPoliticaConhecida(versao: string): boolean {
  return VERSOES.has(versao);
}

const brl = (centavos: number) => formatarBRL(centavos / 100);

/**
 * Os parágrafos da política, com as datas e os valores concretos desta encomenda (seção 4.7 do
 * plano). O terceiro muda com o percentual retido: 100% ("a entrada fica"), parte ("X% da entrada
 * fica e devolvemos o resto") ou 0% ("devolvemos tudo também depois do corte").
 */
export function textosDaPolitica(versao: string, d: DadosDaPolitica): string[] {
  if (!versaoDaPoliticaConhecida(versao)) throw new RangeError(`Versão de política desconhecida: ${versao}`);
  const palavra = palavraDoModo(d.modo);
  const corte = `${formatarPrazo(d.corteEm)} (horário de Teresina)`;
  const percentual = Math.min(100, Math.max(0, Math.trunc(d.percentualRetido)));
  const retido = valorRetidoDaEntrada(d.entradaCentavos, percentual);

  const depoisDoCorte =
    percentual === 0
      ? "Depois disso, se desistir, também devolvemos 100% do que você pagou."
      : percentual === 100
        ? `Depois disso, os potinhos já estão sendo preparados especialmente para você: se desistir, a entrada (${brl(d.entradaCentavos)}) fica com a Geleiô para cobrir ingredientes, potes e trabalho. O restante, se já pago, é devolvido integralmente.`
        : `Depois disso, os potinhos já estão sendo preparados especialmente para você: se desistir, ${percentual}% da entrada (${brl(retido)}) fica com a Geleiô para cobrir ingredientes, potes e trabalho, e devolvemos o resto. O restante, se já pago, é devolvido integralmente.`;

  return [
    "Sua solicitação só vira encomenda quando a Geleiô aprova e você paga a entrada (50% do valor dos potinhos). Antes disso nada é cobrado e você pode desistir quando quiser.",
    `Até ${corte}, ${DIAS_CORTE_ANTES_DA_ENTREGA} dias antes da ${palavra}, você pode desistir aqui no site, em Minhas encomendas, e devolvemos 100% do que você pagou, pelo mesmo meio do pagamento, em até ${PRAZO_DEVOLUCAO_DIAS_UTEIS} dias úteis.`,
    depoisDoCorte,
    "Se a Geleiô não puder fazer a encomenda, devolvemos tudo.",
    `O restante (${brl(d.restanteCentavos)}${d.freteCentavos > 0 ? ", com o frete" : ""}) é pago até a ${palavra}, aqui no site (PIX ou cartão) ou combinado direto com a Geleiô; a encomenda só sai quitada.`,
    "Esta política não exclui nem limita os direitos previstos no Código de Defesa do Consumidor.",
  ];
}
