/**
 * Política de desistência das encomendas de mimos (texto puro, servidor e navegador). A cliente aceita
 * uma VERSÃO deste texto ao solicitar (`politicaVersao`, gravada na encomenda), com os valores
 * daquela encomenda. Mudou o texto: crie outra versão e mantenha a antiga aqui, para o comprovante das
 * encomendas antigas continuar mostrando o que foi aceito.
 *
 * - v1 ("2026-11-v1", antiga): devolução integral até o corte e, depois, retinha parte da entrada.
 *   Não vale mais para encomendas novas (retenção não cabe em compra pela internet).
 * - v2 ("2026-11-v2", atual): direito de arrependimento do art. 49 do CDC por inteiro: desistir antes da
 *   entrega e até 7 dias depois de receber, com devolução de TUDO o que foi pago, sem retenção nem taxa.
 *
 * Não é parecer jurídico: a dona valida o texto com um advogado ou com o Procon-PI antes de ativar.
 */
import { formatarBRL } from "@/lib/dinheiro";
import {
  DIAS_CORTE_ANTES_DA_ENTREGA,
  DIAS_DESISTENCIA_APOS_RECEBER,
  VERSAO_POLITICA_COM_RETENCAO,
  formatarPrazo,
  palavraDoModo,
  valorRetidoDaEntrada,
  type ModoEntrega,
} from "@/lib/encomendas-regras";
import { AVISO_SO_TERESINA } from "@/lib/entrega-regras";

export const POLITICA_VERSAO = "2026-11-v2";

/** Prazo prometido para devolver o dinheiro na política v1 (D16). A v2 promete devolução imediata. */
export const PRAZO_DEVOLUCAO_DIAS_UTEIS = 2;

/** Aviso do painel (não bloqueia): o texto da política precisa de validação jurídica. */
export const AVISO_JURIDICO =
  "A política segue o direito de arrependimento do Código de Defesa do Consumidor (art. 49): a cliente pode desistir até 7 dias depois de receber, " +
  "com devolução integral e sem retenção. Isso significa que a Geleiô arca com as desistências, inclusive depois de produzir os potinhos. " +
  "Valide o texto da política com um advogado ou com o Procon-PI antes de abrir as encomendas.";

export type DadosDaPolitica = {
  /** Corte da desistência na v1 (00:00 de E−2, mostrado como 23h59 de E−3). A v2 não usa. */
  corteEm: Date;
  entradaCentavos: number;
  restanteCentavos: number;
  freteCentavos: number;
  modo: ModoEntrega;
  /** 0 a 100: v1, quanto da entrada fica com a loja se a cliente desistir depois do corte (D4). A v2 IGNORA. */
  percentualRetido: number;
};

const VERSOES = new Set([VERSAO_POLITICA_COM_RETENCAO, POLITICA_VERSAO]);

export function versaoDaPoliticaConhecida(versao: string): boolean {
  return VERSOES.has(versao);
}

const brl = (centavos: number) => formatarBRL(centavos / 100);

/**
 * Os parágrafos da política, com as datas e os valores concretos desta encomenda (seção 4.7 do
 * plano). Na v1 o terceiro muda com o percentual retido; na v2 não há retenção.
 */
export function textosDaPolitica(versao: string, d: DadosDaPolitica): string[] {
  if (!versaoDaPoliticaConhecida(versao)) throw new RangeError(`Versão de política desconhecida: ${versao}`);
  return versao === VERSAO_POLITICA_COM_RETENCAO ? textosDaPoliticaV1(d) : textosDaPoliticaV2(d);
}

function textosDaPoliticaV2(d: DadosDaPolitica): string[] {
  const palavra = palavraDoModo(d.modo);
  const total = d.entradaCentavos + d.restanteCentavos;
  return [
    "Sua solicitação só vira encomenda quando a Geleiô aprova e você paga a entrada (50% do valor dos potinhos e dos itens adicionais, se você escolher algum). Antes disso nada é cobrado e você pode desistir quando quiser.",
    `Como você compra pelo site, vale o direito de arrependimento (art. 49 do Código de Defesa do Consumidor): você pode desistir aqui no site, em Minhas encomendas, a qualquer momento antes da ${palavra} e até ${DIAS_DESISTENCIA_APOS_RECEBER} dias depois de receber os potinhos.`,
    `Se desistir, devolvemos 100% de tudo o que você pagou (a entrada de ${brl(d.entradaCentavos)}, o restante de ${brl(d.restanteCentavos)}${d.freteCentavos > 0 ? " e o frete" : ""}: ${brl(total)} no total), de imediato, pelo mesmo meio do pagamento e com correção monetária quando for o caso. Sem taxa e sem desconto.`,
    "Depois de receber, os potinhos devem estar lacrados e sem uso. A devolução deles a gente combina com você, e o custo do retorno é da Geleiô.",
    "Se a Geleiô não puder fazer a encomenda, devolvemos tudo.",
    `O restante (${brl(d.restanteCentavos)}${d.freteCentavos > 0 ? ", com o frete" : ""}) é pago até a ${palavra}, aqui no site (PIX ou cartão) ou combinado direto com a Geleiô; a encomenda só sai quitada. ${AVISO_SO_TERESINA} Para outros lugares, a opção é a retirada na loja, sem custo.`,
    "Esta política não exclui nem limita os direitos previstos no Código de Defesa do Consumidor.",
  ];
}

/** Texto da v1, mantido como foi aceito pelas encomendas antigas. */
function textosDaPoliticaV1(d: DadosDaPolitica): string[] {
  const palavra = palavraDoModo(d.modo);
  const corte = `${formatarPrazo(d.corteEm)} (horário de Teresina)`;
  const percentual = Math.min(100, Math.max(0, Math.trunc(d.percentualRetido)));
  const retido = valorRetidoDaEntrada(d.entradaCentavos, percentual);

  const depoisDoCorte =
    percentual === 0
      ? "Depois disso, se desistir, também devolvemos 100% do valor da encomenda que você pagou."
      : percentual === 100
        ? `Depois disso, os potinhos já estão sendo preparados especialmente para você: se desistir, a entrada (${brl(d.entradaCentavos)}) fica com a Geleiô para cobrir ingredientes, potes e trabalho. O restante, se já pago, é devolvido integralmente.`
        : `Depois disso, os potinhos já estão sendo preparados especialmente para você: se desistir, ${percentual}% da entrada (${brl(retido)}) fica com a Geleiô para cobrir ingredientes, potes e trabalho, e devolvemos o resto. O restante, se já pago, é devolvido integralmente.`;

  return [
    "Sua solicitação só vira encomenda quando a Geleiô aprova e você paga a entrada (50% do valor dos potinhos). Antes disso nada é cobrado e você pode desistir quando quiser.",
    `Até ${corte}, ${DIAS_CORTE_ANTES_DA_ENTREGA} dias antes da ${palavra}, você pode desistir aqui no site, em Minhas encomendas, e devolvemos 100% do valor da encomenda que você pagou, pelo mesmo meio do pagamento, em até ${PRAZO_DEVOLUCAO_DIAS_UTEIS} dias úteis.`,
    depoisDoCorte,
    "Se a Geleiô não puder fazer a encomenda, devolvemos tudo.",
    `O restante (${brl(d.restanteCentavos)}${d.freteCentavos > 0 ? ", com o frete" : ""}) é pago até a ${palavra}, aqui no site (PIX ou cartão) ou combinado direto com a Geleiô; a encomenda só sai quitada.`,
    "Esta política não exclui nem limita os direitos previstos no Código de Defesa do Consumidor.",
  ];
}
