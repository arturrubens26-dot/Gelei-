import "server-only";
import { Prisma, type Pagamento } from "@/generated/prisma/client";
import { pagamentosSimuladosPermitidos } from "@/lib/ambiente";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import {
  ErroInfinitePay,
  conferirPagamento,
  criarLink,
  handleInfinitePay,
  infinitePayConfigurado,
  origemDaApiDeTeste,
  origemPublica,
} from "@/lib/infinitepay";
import {
  classificarConferencia,
  conferenciaAmarrada,
  conferirTokenDoAviso,
  decisaoDoCanario,
  referenciaDoCanario,
  itensDoLink,
  lerAviso,
  lerRetorno,
  referenciaDoPedido,
  tokenDoAviso,
  type Candidato,
} from "@/lib/infinitepay-regras";
import {
  JANELA_CONFIRMANDO_MS,
  MARCA_DIVERGENTE,
  MARCA_NAO_PAGO,
  VALIDADE_DO_LINK_MS,
  MARCA_APOS_BAIXA_MANUAL,
  cobrancaDivergente,
  cobrancaParaEtapa,
  etapaDoPagamento,
  retornoRecente,
  pagarAteDe,
  pedidoExpirado,
  type CobrancaDTO,
  type MetodoPagamento,
  type SituacaoPagamentoDTO,
  type StatusCobranca,
} from "@/lib/pagamentos-regras";

export type { CobrancaDTO, SituacaoPagamentoDTO } from "@/lib/pagamentos-regras";

/**
 * Camada de pagamento. O resto do sistema só conhece as funções deste arquivo; quem fala com a
 * InfinitePay é src/lib/infinitepay.ts.
 *
 * Regra de ouro: o pedido só vira PAGO depois do payment_check feito por ESTE servidor com a própria
 * chave, com a referência do NOSSO banco e o valor conferido (`confirmarCobranca`, a única porta
 * para PAGO). O aviso (webhook, que não é assinado) e o retorno do navegador só trazem um
 * "candidato" (transação e slug) e disparam a conferência. A mesma transação nunca quita duas
 * cobranças: UNIQUE(gateway, transacao_nsu), gravada só depois de confirmada.
 */

type NomeGateway = "infinitepay" | "simulado";

/** Um link que vence em menos que isto não é reaproveitado: a cliente não teria tempo de pagar. */
const FOLGA_PARA_PAGAR_MS = 5 * 60_000;
/** Links por pedido (cada "Pagar" depois de um link vencido conta um). */
const MAX_COBRANCAS_POR_PEDIDO = 10;
/** A tela pergunta a cada 5 s; a InfinitePay, no máximo uma vez nesse intervalo por cobrança. */
const INTERVALO_CONSULTA_TELA_MS = 8_000;
/** Avisos repetidos em rajada não viram uma consulta cada. */
const INTERVALO_CONSULTA_AVISO_MS = 3_000;
/**
 * Toda conferência (aviso, tela e retorno) faz até duas consultas dentro de um orçamento só, para a
 * função não estourar o limite da Netlify: a principal usa no máximo 5 s e, SÓ quando ela deu "pago"
 * e confere, o canário usa o que sobrar. Sem pelo menos 1 s de sobra, não consulta.
 */
const ORCAMENTO_CONFERENCIA_MS = 8_000;
const TEMPO_CONSULTA_PRINCIPAL_MS = 5_000;
const TEMPO_MINIMO_CONSULTA_MS = 1_000;

// --- configuração -----------------------------------------------------------------------------

/**
 * Pagamento simulado: PAGAMENTOS_SIMULADOS=true e, em produção, também APP_ENV=demo (ver
 * src/lib/ambiente.ts). Com a InfinitePay configurada, a simulação fica desligada mesmo com a flag.
 */
export function pagamentosSimuladosAtivos(): boolean {
  return !infinitePayConfigurado() && pagamentosSimuladosPermitidos();
}

/**
 * Dá para cobrar um pedido pelo site? Sem gateway, a loja não aceita pedidos online: o checkout
 * avisa "em breve" e a API recusa ANTES de gravar o pedido.
 */
export function pagamentoOnlineDisponivel(): boolean {
  return infinitePayConfigurado() || pagamentosSimuladosAtivos();
}

function gatewayAtivo(): NomeGateway {
  if (infinitePayConfigurado()) return "infinitepay";
  if (pagamentosSimuladosAtivos()) return "simulado";
  throw new ErroNegocio(503, "O pagamento pelo site está indisponível no momento.");
}

// --- DTOs -------------------------------------------------------------------------------------

const centavosDe = (valor: Prisma.Decimal) => valor.mul(100).toNumber();
const reaisDe = (centavos: number) => new Prisma.Decimal(centavos).div(100);
const metodoDe = (v: string | null): MetodoPagamento | null => (v === "pix" || v === "credit_card" ? v : null);

function paraCobrancaDTO(p: Pagamento, agora = Date.now()): CobrancaDTO {
  const valendo = p.status === "PENDENTE" && p.expiraEm.getTime() > agora;
  const aprovada = p.status === "APROVADO" || p.status === "ESTORNADO";
  return {
    gateway: p.gateway === "infinitepay" ? "infinitepay" : "simulado",
    status: p.status,
    valor: p.valor.toNumber(),
    expiraEm: p.expiraEm.toISOString(),
    checkoutUrl: valendo && p.gateway === "infinitepay" ? p.checkoutUrl : null,
    metodo: aprovada ? metodoDe(p.metodo) : null,
    parcelas: aprovada ? p.parcelas : null,
    valorPago: aprovada && p.valorPago ? p.valorPago.toNumber() : null,
    // O comprovante só aparece depois de conferido (antes, veio de um candidato não confirmado).
    comprovanteUrl: aprovada ? p.comprovanteUrl : null,
  };
}

/** Candidato gravado (aviso com token ou retorno da dona do pedido), se houver. */
function candidatoGravado(p: Pagamento): Candidato | null {
  return p.avisoTransacaoNsu && p.avisoSlug
    ? { transacaoNsu: p.avisoTransacaoNsu, slug: p.avisoSlug, comprovanteUrl: p.comprovanteUrl }
    : null;
}

/** Para `cobrancaParaEtapa`: `avisadoEm` só conta com um candidato gravado. */
const paraEtapa = (p: Pagamento) => ({ ...p, avisadoEm: candidatoGravado(p) ? p.avisadoEm : null });

const maisNovasPrimeiro = (cobrancas: readonly Pagamento[]) =>
  [...cobrancas].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime() || (a.id < b.id ? 1 : -1));

/**
 * A cobrança mais recente com candidato do aviso ainda não resolvido, de qualquer idade (não
 * necessariamente a última criada: a cliente pode ter aberto outro link depois de pagar). É a que
 * a tela, o retorno e o "Pagar" reconferem. `null` se nenhuma.
 */
function cobrancaComAviso(cobrancas: readonly Pagamento[]): Pagamento | null {
  return maisNovasPrimeiro(cobrancas).find((c) => (c.status === "PENDENTE" || c.status === "CANCELADO") && candidatoGravado(c)) ?? null;
}

/**
 * Exigir que a resposta do payment_check traga o NOSSO order_nsu. Fica DESLIGADA: o ensaio com
 * dinheiro real (2026-10-22, README) mostrou que a resposta NÃO traz `order_nsu`, mas que a API
 * amarra a transação ao pedido ENVIADO na consulta (com outro order_nsu, a mesma transação responde
 * `paid=false, amount=0`; com o slug errado, `success=false`). Como o servidor sempre consulta com o
 * order_nsu do NOSSO banco, a amarração já está garantida. Ligada, todo "pago" viraria divergência.
 * Só ligue se a InfinitePay passar a devolver o `order_nsu` na resposta.
 */
export const EXIGIR_ORDER_NSU_NA_CONFERENCIA = false;

/**
 * Segredo do token do aviso: INFINITEPAY_WEBHOOK_SECRET (próprio, para poder trocar sem derrubar as
 * sessões) ou, se ausente, o SESSION_SECRET. Trocar o segredo invalida o aviso dos links abertos (até
 * 60 min); eles continuam pelo retorno, pela tela e pela confirmação manual.
 */
function segredoDoAviso(): string {
  return process.env.INFINITEPAY_WEBHOOK_SECRET?.trim() || process.env.SESSION_SECRET || "";
}

const MENSAGEM_DIVERGENCIA =
  "Recebemos um pagamento deste pedido que precisa ser conferido. Não pague de novo: fale com a loja no Instagram @ge.leio.";
const MENSAGEM_AVISO_EM_CONFERENCIA =
  "Recebemos o aviso do seu pagamento e estamos conferindo com a InfinitePay. Não pague de novo: se demorar, fale com a loja no Instagram @ge.leio.";
const MENSAGEM_RETORNO_RECENTE =
  "Você acabou de voltar da página de pagamento: estamos confirmando. Aguarde alguns minutos antes de tentar pagar de novo.";

// --- confirmação (a única porta para PAGO) ----------------------------------------------------

/**
 * - APROVADO: conferido e gravado (ou já estava);
 * - PENDENTE: a InfinitePay diz que não foi pago ainda (pode cair depois);
 * - DIVERGENTE: pago, mas o valor, a moeda, o método ou as parcelas não conferem: o pedido NÃO vira
 *   PAGO e a dona confere no app InfinitePay (repetir a consulta não muda nada);
 *   Inclui `paid=false`: "ainda não pago" OU transação de outro pedido (a API responde assim quando o
 *   order_nsu consultado não é o da transação). Nunca é divergência nem alerta;
 * - INVALIDO: candidato recusado de vez (`success=false`: slug errado ou transação inexistente;
 *   transação de outro pedido na resposta; slug diferente da fatura; já usada);
 * - TRANSITORIO: a InfinitePay não respondeu direito (nem na consulta principal nem no canário), ou
 *   ainda não acha a transação (HTTP 4xx logo depois do pagamento): o webhook responde 400 para ela repetir;
 * - ADIADO: conferida há instantes (a próxima tentativa confere).
 */
export type ResultadoConfirmacao = "APROVADO" | "PENDENTE" | "DIVERGENTE" | "INVALIDO" | "TRANSITORIO" | "ADIADO";

/**
 * De onde veio o candidato:
 * - "aviso": corpo do webhook, que só chega pela URL com o token desta cobrança;
 * - "gravado": o candidato guardado no banco (só o aviso grava), reconferido pela tela ou pelo retorno;
 * - "retorno": a query do redirect_url, ou seja, dado da CLIENTE (já conferido que a sessão é a dona
 *   do pedido). Confirma como os outros: quem amarra a transação a esta cobrança é o payment_check,
 *   consultado com o order_nsu do NOSSO banco (nunca o da query). Transação de outro link responde
 *   `paid=false` (ou `success=false`) e não confirma. O candidato do retorno nunca é gravado como
 *   candidato, e nenhuma recusa dele (não pago, divergência, transação já usada, canário) grava marca:
 *   é dado da cliente. O comprovante só é gravado se for o recibo da própria transação (urlDoRecibo).
 *
 * Em TODA origem, antes de confirmar, vale o CANÁRIO: a mesma transação e slug consultados com um
 * order_nsu que nunca existe precisam responder "não pago". Se responder "pago" (a API não amarrou a
 * transação ao pedido): do retorno, não confirma e o aviso decide; do aviso ou da tela, grava
 * `divergente:nao-amarra` para a dona conferir no app. Se não responder (tempo, 5xx, 4xx, formato
 * estranho), não confirma (fail-closed): do aviso ou da tela, TRANSITORIO (a InfinitePay repete).
 */
type OrigemCandidato = "aviso" | "gravado" | "retorno";

/** Não apaga a marca de divergência: ela segura a etapa em "confirmando" até a dona resolver. */
const SEM_DIVERGENCIA = { NOT: { statusGateway: { startsWith: MARCA_DIVERGENTE } } } satisfies Prisma.PagamentoWhereInput;

/**
 * Guarda o candidato do AVISO para a tela e o "Pagar" reconferirem, DEPOIS de conferi-lo e só quando
 * a conferência não decidiu (InfinitePay fora, 4xx logo depois do pagamento, "não pago"). Um aviso
 * que dá "pago" aprova sem precisar gravar nada, e um que dá "inválido" nem chega aqui.
 *
 * Nunca troca um candidato DIFERENTE ainda dentro da janela de 30 min (o token do aviso é conhecido
 * da cliente: um forjado não pode tomar o lugar do verdadeiro); só entra no lugar vazio ou de um que
 * já passou da janela. O mesmo candidato repetido (a InfinitePay reenvia o aviso) só atualiza o
 * recibo: a janela conta do primeiro. Devolve se o candidato gravado agora é este.
 */
async function guardarCandidato(p: Pagamento, c: Candidato): Promise<boolean> {
  const aberta = { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } } satisfies Prisma.PagamentoWhereInput;
  if (c.comprovanteUrl) {
    await db.pagamento.updateMany({
      where: { ...aberta, avisoTransacaoNsu: c.transacaoNsu, avisoSlug: c.slug },
      data: { comprovanteUrl: c.comprovanteUrl },
    });
  }
  const limite = new Date(Date.now() - JANELA_CONFIRMANDO_MS);
  await db.pagamento.updateMany({
    where: {
      ...aberta,
      OR: [
        { avisoTransacaoNsu: null },
        { avisoSlug: null },
        { avisadoEm: null },
        { avisadoEm: { lt: limite }, OR: [{ avisoTransacaoNsu: { not: c.transacaoNsu } }, { avisoSlug: { not: c.slug } }] },
      ],
    },
    data: { avisoTransacaoNsu: c.transacaoNsu, avisoSlug: c.slug, avisadoEm: new Date(), comprovanteUrl: c.comprovanteUrl },
  });
  const atual = await db.pagamento.findUnique({ where: { id: p.id }, select: { avisoTransacaoNsu: true, avisoSlug: true } });
  return atual?.avisoTransacaoNsu === c.transacaoNsu && atual.avisoSlug === c.slug;
}

/**
 * Apaga o candidato recusado, mas só se ele ainda for o gravado: um candidato novo (o aviso de
 * verdade, por exemplo) não é perdido por causa de outro. A marca só é gravada quando o candidato
 * foi apagado, ou quando não havia nenhum: um aviso forjado e recusado não escreve por cima da
 * marca do verdadeiro.
 */
async function descartarCandidato(p: Pagamento, c: Candidato, motivo: string): Promise<void> {
  const { count } = await db.pagamento.updateMany({
    where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] }, avisoTransacaoNsu: c.transacaoNsu, avisoSlug: c.slug },
    data: { avisoTransacaoNsu: null, avisoSlug: null, avisadoEm: null, comprovanteUrl: null },
  });
  if (count === 1 || !p.avisoTransacaoNsu) await marcar(p, motivo);
}

/** Grava o que a última conferência disse, sem apagar uma divergência pendente. */
async function marcar(p: Pagamento, marca: string): Promise<void> {
  await db.pagamento.updateMany({
    where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] }, ...SEM_DIVERGENCIA },
    data: { statusGateway: marca.slice(0, 40) },
  });
}

/**
 * Devolve a vez reservada em `consultadoEm` ao valor de antes, mas só se ninguém reservou depois
 * (o filtro é o instante que NÓS gravamos). Falha aqui só deixa a vez presa por poucos segundos.
 */
async function devolverReserva(p: Pagamento, reservadoEm: Date): Promise<void> {
  await db.pagamento
    .updateMany({ where: { id: p.id, consultadoEm: reservadoEm }, data: { consultadoEm: p.consultadoEm } })
    .catch((e) => console.error(`[pagamentos] cobrança ${p.id}: não devolveu a vez reservada (${e instanceof Error ? e.name : "erro"})`));
}

/** O candidato `c` é o gravado e chegou há menos de 30 min? (Janela para a InfinitePay "achar" a transação.) */
function dentroDaJanela(p: Pagamento, c: Candidato, agora = Date.now()): boolean {
  if (p.avisoTransacaoNsu !== c.transacaoNsu || p.avisoSlug !== c.slug || !p.avisadoEm) return true; // recém-chegado
  return agora - p.avisadoEm.getTime() < JANELA_CONFIRMANDO_MS;
}

/**
 * Confere o candidato no payment_check e, se o dinheiro entrou e confere, marca a cobrança APROVADO
 * e o pedido PAGO (só a partir de PENDENTE), numa transação curta e sem rede dentro.
 *
 * Vale para cobrança PENDENTE ou CANCELADO: a cancelada só no nosso banco ainda pode ser paga na
 * InfinitePay até o valid_until. Pedido "expirado" (mais de 48 h) que recebe pagamento vira PAGO: o
 * dinheiro entrou. Pago com o pedido já cancelado, ou com outra cobrança dele já aprovada: a cobrança
 * fica APROVADO e o pedido não muda (o painel mostra o alerta para devolver pelo app InfinitePay).
 */
export async function confirmarCobranca(
  p: Pagamento,
  c: Candidato,
  origem: OrigemCandidato,
  /** Instante (ms) até o qual esta chamada pode gastar com a InfinitePay (padrão: 8 s a partir de agora). */
  prazoFinal?: number,
): Promise<ResultadoConfirmacao> {
  if (p.status === "APROVADO" || p.status === "ESTORNADO") return "APROVADO";
  if (p.gateway !== "infinitepay" || (p.status !== "PENDENTE" && p.status !== "CANCELADO")) return "INVALIDO";
  const daCliente = origem === "retorno";
  // Se a criação do link trouxe o slug da fatura, ele amarra a fatura: outro slug é de outra fatura e
  // nem é consultado. (A API real não devolve o slug em /links: aí quem amarra é o payment_check.)
  if (p.faturaSlug && p.faturaSlug !== c.slug) {
    if (daCliente) {
      console.info(`[pagamentos] cobrança ${p.id}: retorno com slug de outra fatura, ignorado`);
      return "INVALIDO";
    }
    await descartarCandidato(p, c, "slug-diferente");
    console.warn(`[pagamentos] cobrança ${p.id}: candidato com slug de outra fatura, descartado`);
    return "INVALIDO";
  }

  // Do aviso, o candidato só é guardado (para a tela reconferir) quando a conferência não decide.
  const guardar = () => (origem === "aviso" ? guardarCandidato(p, c) : Promise.resolve(false));
  const prazo = prazoFinal ?? Date.now() + ORCAMENTO_CONFERENCIA_MS;
  const tempoAte = (max: number) => Math.min(max, prazo - Date.now());
  // Sem tempo no orçamento: nem reserva a vez (a tela confere de novo daqui a pouco).
  if (prazo - Date.now() < TEMPO_MINIMO_CONSULTA_MS) return "ADIADO";

  // Reserva a vez (atômico): duas conferências da mesma cobrança não correm juntas.
  const intervalo = origem === "aviso" ? INTERVALO_CONSULTA_AVISO_MS : INTERVALO_CONSULTA_TELA_MS;
  const agora = new Date();
  const { count: reservou } = await db.pagamento.updateMany({
    where: {
      id: p.id,
      OR: [{ consultadoEm: null }, { consultadoEm: { lt: new Date(agora.getTime() - intervalo) } }],
    },
    data: { consultadoEm: agora },
  });
  if (reservou !== 1) return "ADIADO";

  let conferencia;
  try {
    conferencia = await conferirPagamento(
      { referencia: p.referenciaExterna, transacaoNsu: c.transacaoNsu, slug: c.slug },
      tempoAte(TEMPO_CONSULTA_PRINCIPAL_MS),
    );
  } catch (e) {
    const status = e instanceof ErroInfinitePay ? e.status : 0;
    // 401/403: a NOSSA chave foi recusada; 429: limite. Nada disso é culpa do candidato.
    if (status === 0 || status >= 500 || status === 401 || status === 403 || status === 429) {
      console.error(`[pagamentos] payment_check da cobrança ${p.id} falhou (${(e as Error).message})`);
      await guardar();
      return "TRANSITORIO";
    }
    // Outro 4xx ("transação não encontrada"): logo depois do pagamento a InfinitePay pode ainda não
    // ter a transação. Dentro da janela de 30 min é passageiro (o aviso volta com 400 e ela repete);
    // depois disso, o candidato é recusado de vez. O da cliente nunca é gravado: só não confirma.
    if (daCliente) return "PENDENTE";
    if (dentroDaJanela(p, c)) {
      console.warn(`[pagamentos] cobrança ${p.id}: payment_check ainda não acha a transação (HTTP ${status}); tenta de novo`);
      await guardar();
      return "TRANSITORIO";
    }
    await descartarCandidato(p, c, `invalido:http-${status}`);
    console.warn(`[pagamentos] cobrança ${p.id}: payment_check recusou o candidato (HTTP ${status}) depois da janela`);
    return "INVALIDO";
  }

  const valorCentavos = centavosDe(p.valor);
  // A consulta foi feita com o order_nsu do NOSSO banco: a API só responde "pago" se a transação for
  // deste pedido (ensaio de 2026-10-22). Transação de outro link da loja responde paid=false (NAO_PAGO)
  // ou success=false (INVALIDO), em qualquer origem.
  const resultado = classificarConferencia(conferencia, valorCentavos, p.referenciaExterna);
  // Com a exigência ligada, nada confirma sem o order_nsu na resposta: vira divergência (conferir no app).
  if (EXIGIR_ORDER_NSU_NA_CONFERENCIA && !conferenciaAmarrada(conferencia, p.referenciaExterna) && resultado.tipo === "APROVADO") {
    // Do retorno (dado da cliente): só não confirma, sem marca. O aviso decide.
    if (daCliente) {
      console.warn(`[pagamentos] cobrança ${p.id}: retorno "pago" sem order_nsu na conferência; não confirma, aguarda o aviso`);
      return "PENDENTE";
    }
    console.error(`[pagamentos] cobrança ${p.id}: "pago" sem order_nsu na conferência; confira no app InfinitePay`);
    await db.pagamento.updateMany({
      where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } },
      data: { statusGateway: `${MARCA_DIVERGENTE}sem-order-nsu` },
    });
    return "DIVERGENTE";
  }
  if (resultado.tipo === "INVALIDO") {
    if (daCliente) return "INVALIDO";
    await descartarCandidato(p, c, "invalido");
    console.warn(`[pagamentos] cobrança ${p.id}: payment_check não reconheceu a transação para este pedido`);
    return "INVALIDO";
  }
  if (resultado.tipo === "NAO_PAGO") {
    // Do retorno, paid=false pode ser uma transação de outro pedido: não marca nada (dado da cliente).
    if (daCliente) return "PENDENTE";
    // Passou da janela de 30 min e ainda "não pago": o candidato é descartado (como no 4xx), não fica
    // "confirmando" para sempre. Dentro da janela, guarda-o (se o lugar estiver livre) e marca.
    if (!dentroDaJanela(p, c)) {
      await descartarCandidato(p, c, MARCA_NAO_PAGO);
      console.warn(`[pagamentos] cobrança ${p.id}: candidato ainda "não pago" depois da janela, descartado`);
      return "PENDENTE";
    }
    const eEste = origem === "gravado" ? true : await guardar();
    if (eEste) await marcar(p, MARCA_NAO_PAGO);
    return "PENDENTE";
  }
  if (resultado.tipo === "DIVERGENTE") {
    // Do retorno, uma transação de outro valor é dado da cliente: só loga. Gravar a marca travaria o
    // pedido em "confirmando" com um alerta falso. Se o dinheiro entrou mesmo, o aviso marca.
    if (daCliente) {
      console.warn(`[pagamentos] cobrança ${p.id}: retorno com pagamento divergente (${resultado.motivo}); nada gravado, aguarda o aviso`);
      return "PENDENTE";
    }
    const marca = `${MARCA_DIVERGENTE}${resultado.motivo}`.slice(0, 40);
    if (p.statusGateway !== marca) {
      console.error(
        `[pagamentos] cobrança ${p.id} do pedido ${p.orderId} paga com divergência (${resultado.motivo}): ` +
          "o pedido NÃO foi marcado como pago. Confira no app InfinitePay.",
      );
    }
    await db.pagamento.updateMany({ where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } }, data: { statusGateway: marca } });
    return "DIVERGENTE";
  }

  // O canário, em TODA origem (aviso, tela e retorno), SÓ quando a consulta principal já deu "pago" e
  // confere (uma consulta a mais por pagamento real): a mesma transação e slug com um order_nsu que
  // nunca existe precisam responder "não pago". O token do aviso e o slug do recibo são conhecidos da
  // cliente, então o aviso é dado dela como o retorno: quem amarra a transação a ESTA cobrança é a
  // InfinitePay, e o canário confere que ela de fato amarra.
  let canario = null;
  let causa = "sem tempo no orçamento";
  const tempoCanario = tempoAte(ORCAMENTO_CONFERENCIA_MS);
  if (tempoCanario >= TEMPO_MINIMO_CONSULTA_MS) {
    try {
      canario = await conferirPagamento(
        { referencia: referenciaDoCanario(p.referenciaExterna), transacaoNsu: c.transacaoNsu, slug: c.slug },
        tempoCanario,
      );
      causa = "resposta em formato inesperado";
    } catch (e) {
      // Só o status (ou "sem resposta"): nunca o corpo nem dado da cliente.
      causa = e instanceof ErroInfinitePay ? (e.status === 0 ? e.message : `HTTP ${e.status}`) : "erro";
    }
  }
  const decisao = decisaoDoCanario(canario);
  if (decisao === "NAO_AMARRA" && !daCliente) {
    // Do aviso ou da tela: a dona confere no app (a transação pode ser de outra compra).
    const marca = `${MARCA_DIVERGENTE}nao-amarra`;
    if (p.statusGateway !== marca) {
      console.error(
        `[pagamentos] cobrança ${p.id} do pedido ${p.orderId}: o canário respondeu "pago" (a API não amarrou a transação); ` +
          "o pedido NÃO foi marcado como pago. Confira no app InfinitePay.",
      );
    }
    await db.pagamento.updateMany({ where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } }, data: { statusGateway: marca } });
    return "DIVERGENTE";
  }
  if (decisao !== "AMARRA") {
    console.error(
      `[pagamentos] cobrança ${p.id}: ${daCliente ? "retorno" : "conferência"} NÃO confirmada (canário ${
        decisao === "NAO_AMARRA" ? "com sinal de pagamento: a API não amarrou a transação" : `sem decisão: ${causa}`
      }); aguarda o aviso`,
    );
    // Nada foi decidido: devolve a vez reservada, para o aviso que chega logo em seguida não receber ADIADO.
    await devolverReserva(p, agora);
    if (!daCliente) await guardar();
    return daCliente ? "PENDENTE" : "TRANSITORIO";
  }

  // Aprovado: grava a transação (UNIQUE) e o pedido, juntos.
  let pedidoMudou = false;
  try {
    const [cobranca, pedido] = await db.$transaction([
      db.pagamento.updateMany({
        where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } },
        data: {
          status: "APROVADO",
          statusGateway: "pago",
          transacaoNsu: c.transacaoNsu,
          faturaSlug: c.slug,
          metodo: resultado.metodo,
          parcelas: resultado.parcelas,
          valorPago: reaisDe(resultado.valorPagoCentavos),
          comprovanteUrl: c.comprovanteUrl,
          aprovadoEm: new Date(),
          avisoTransacaoNsu: null,
          avisoSlug: null,
        },
      }),
      db.order.updateMany({ where: { id: p.orderId, status: "PENDENTE" }, data: { status: "PAGO" } }),
    ]);
    // Outra conferência aprovou esta cobrança no meio do caminho: ela já cuidou do pedido.
    if (cobranca.count !== 1) return "APROVADO";
    pedidoMudou = pedido.count === 1;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Esta transação já quitou outra cobrança: não paga duas. Do retorno (dado da cliente), não grava marca.
      if (!daCliente) await descartarCandidato(p, c, "transacao-ja-usada");
      console.error(`[pagamentos] cobrança ${p.id}: a transação informada já quitou outra cobrança; recusada`);
      return "INVALIDO";
    }
    throw e;
  }

  if (pedidoMudou) {
    console.info(`[pagamentos] pedido ${p.orderId} pago (${resultado.metodo}, ${resultado.parcelas}x, cobrança ${p.id}, via ${origem})`);
    // Os outros links ainda abertos do pedido são encerrados no nosso banco (não há cancelamento na API).
    await db.pagamento.updateMany({ where: { orderId: p.orderId, status: "PENDENTE", NOT: { id: p.id } }, data: { status: "CANCELADO" } });
    return "APROVADO";
  }

  // O pedido não estava PENDENTE: cancelado, pago por outra cobrança, ou marcado como pago à mão pela
  // dona (plano C, com ESTE dinheiro). O painel mostra o alerta só nos dois primeiros casos.
  const [pedido, outrasAprovadas] = await Promise.all([
    db.order.findUnique({ where: { id: p.orderId }, select: { status: true } }),
    db.pagamento.count({ where: { orderId: p.orderId, status: "APROVADO", NOT: { id: p.id } } }),
  ]);
  if (pedido?.status === "CANCELADO" || outrasAprovadas > 0) {
    console.error(
      `[pagamentos] cobrança ${p.id} paga com o pedido ${p.orderId} em ${pedido?.status ?? "?"}` +
        `${outrasAprovadas > 0 ? " e já pago por outra cobrança" : ""}: devolva o valor pelo app InfinitePay (o painel mostra o alerta).`,
    );
  } else {
    // A dona marcou PAGO à mão antes: o painel mostra CONFIRMADO_APOS_BAIXA_MANUAL para ela conferir
    // no app se a cliente não pagou duas vezes (por fora e pelo site).
    await db.pagamento.updateMany({ where: { id: p.id, status: "APROVADO" }, data: { statusGateway: MARCA_APOS_BAIXA_MANUAL } });
    console.warn(`[pagamentos] cobrança ${p.id} confirmada depois de o pedido ${p.orderId} ser marcado ${pedido?.status ?? "?"} à mão`);
  }
  return "APROVADO";
}

// --- abrir o link -----------------------------------------------------------------------------

const PEDIDO_PARA_COBRAR = {
  id: true,
  status: true,
  total: true,
  deliveryFee: true,
  createdAt: true,
  telefone: true,
  user: { select: { email: true, nome: true } },
  address: true,
  items: { orderBy: { productId: "asc" }, select: { quantidade: true, precoUnitario: true, product: { select: { nome: true } } } },
  kits: { orderBy: { id: "asc" }, select: { quantidade: true, precoUnitario: true, kit: { select: { nome: true } } } },
  pagamentos: { orderBy: [{ criadoEm: "asc" }, { id: "asc" }] },
} satisfies Prisma.OrderSelect;

/** URL do aviso com o token da cobrança no caminho. */
function urlDoAviso(origem: string, referencia: string): string {
  return `${origem}/api/webhooks/infinitepay/${referencia}/${tokenDoAviso(segredoDoAviso(), referencia)}`;
}

/**
 * Link de pagamento do pedido para a cliente pagar (PIX ou cartão até 12x, na página da InfinitePay).
 * - Pedido de outra conta, presencial ou inexistente: 404; não está PENDENTE: 409; mais de 48 h: 409.
 * - Retorno ou aviso ainda em conferência: confere antes (se confirmar, 409 "já confirmado").
 * - Link PENDENTE que vale por mais de 5 min: devolve o mesmo. O vencido vira CANCELADO no banco (na
 *   InfinitePay ele já não aceita pagamento: valid_until).
 * - No máximo 10 links por pedido (429). Duas chamadas ao mesmo tempo calculam a mesma referência:
 *   a segunda gravação esbarra no índice único e devolve a primeira (o link "órfão" nunca é mostrado).
 * - InfinitePay fora: 502.
 */
export async function abrirLinkDePagamento(pedidoId: string, userId: string): Promise<CobrancaDTO> {
  if (pedidoId.length === 0 || pedidoId.length > 100) throw new ErroNegocio(404, "Pedido não encontrado.");
  const pedido = await db.order.findFirst({ where: { id: pedidoId, userId, canal: "ONLINE" }, select: PEDIDO_PARA_COBRAR });
  if (!pedido?.user) throw new ErroNegocio(404, "Pedido não encontrado.");
  if (pedido.status === "PAGO" || pedido.status === "ENVIADO" || pedido.status === "ENTREGUE") {
    throw new ErroNegocio(409, "Este pedido já foi pago.");
  }
  if (pedido.status !== "PENDENTE") throw new ErroNegocio(409, "Este pedido não está aguardando pagamento.");
  // Já entrou dinheiro com divergência: um link novo só faria a cliente pagar de novo.
  if (pedido.pagamentos.some(cobrancaDivergente)) throw new ErroNegocio(409, MENSAGEM_DIVERGENCIA);
  // Um aviso de pagamento não resolvido (em qualquer cobrança, de qualquer idade): reconfere; se não
  // fechar, NÃO abre link novo (o dinheiro pode ter entrado). Só sai disso com o candidato recusado de
  // vez, ou com a dona marcando pago ou cancelando.
  const comAviso = cobrancaComAviso(pedido.pagamentos);
  if (comAviso) {
    const r = await confirmarCobranca(comAviso, candidatoGravado(comAviso)!, "gravado").catch(() => "TRANSITORIO" as const);
    if (r === "APROVADO") throw new ErroNegocio(409, "O pagamento deste pedido acabou de ser confirmado.");
    if (r === "DIVERGENTE") throw new ErroNegocio(409, MENSAGEM_DIVERGENCIA);
    if (r !== "INVALIDO") throw new ErroNegocio(409, MENSAGEM_AVISO_EM_CONFERENCIA);
  }
  // Voltou da InfinitePay há pouco: espera o aviso antes de abrir outro link.
  if (pedido.pagamentos.some((c) => (c.status === "PENDENTE" || c.status === "CANCELADO") && retornoRecente(c.retornoEm))) {
    throw new ErroNegocio(409, MENSAGEM_RETORNO_RECENTE);
  }
  if (pedidoExpirado(pedido.createdAt)) throw new ErroNegocio(409, "Este pedido expirou. Faça um novo pedido.");
  const gateway = gatewayAtivo();

  const agora = Date.now();
  const abertas = pedido.pagamentos.filter((p) => p.status === "PENDENTE");
  const valendo = abertas.findLast(
    (p) => p.gateway === gateway && p.expiraEm.getTime() > agora + FOLGA_PARA_PAGAR_MS && (gateway === "simulado" || p.checkoutUrl),
  );
  if (valendo) return paraCobrancaDTO(valendo, agora);

  // Os abertos que não servem mais (vencendo, ou de outro gateway) são encerrados no nosso banco.
  if (abertas.length > 0) {
    await db.pagamento.updateMany({ where: { id: { in: abertas.map((p) => p.id) }, status: "PENDENTE" }, data: { status: "CANCELADO" } });
  }
  if (pedido.pagamentos.length >= MAX_COBRANCAS_POR_PEDIDO) {
    throw new ErroNegocio(429, "Este pedido já abriu pagamentos demais. Faça um novo pedido ou fale com a loja.");
  }

  const referencia = referenciaDoPedido(pedido.id, pedido.pagamentos.length + 1);
  const expiraEm = new Date(agora + VALIDADE_DO_LINK_MS);
  let checkoutUrl: string | null = null;
  let faturaSlug: string | null = null;
  if (gateway === "infinitepay") {
    const origem = origemPublica()!;
    try {
      const link = await criarLink({
        handle: handleInfinitePay()!,
        referencia,
        itens: itensDoLink({
          avulsos: pedido.items.map((i) => ({ nome: i.product.nome, quantidade: i.quantidade, precoCentavos: centavosDe(i.precoUnitario) })),
          kits: pedido.kits.map((k) => ({ nome: k.kit.nome, quantidade: k.quantidade, precoCentavos: centavosDe(k.precoUnitario) })),
          freteCentavos: centavosDe(pedido.deliveryFee),
        }),
        totalCentavos: centavosDe(pedido.total),
        urlRetorno: `${origem}/pagamento/retorno`,
        urlAviso: urlDoAviso(origem, referencia),
        validoAte: expiraEm,
        cliente: { nome: pedido.user.nome, email: pedido.user.email, telefone: pedido.telefone },
        endereco: pedido.address,
      });
      checkoutUrl = link.url;
      faturaSlug = link.slug;
    } catch (e) {
      console.error(`[pagamentos] não abriu o link do pedido ${pedido.id}: ${e instanceof Error ? e.message : "erro"}`);
      throw new ErroNegocio(502, "Não conseguimos abrir o pagamento agora. Tente de novo em instantes.");
    }
  }

  try {
    // A criação do link levou até 10 s: o pedido pode ter sido cancelado ou marcado pago nesse meio
    // tempo. A linha do pedido fica travada (FOR UPDATE) enquanto o link é gravado, então o
    // cancelamento ou espera e encerra este link, ou já aconteceu e o link não é gravado.
    const registro = await db.$transaction(async (tx) => {
      const [atual] = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "orders" WHERE "id" = ${pedido.id} FOR UPDATE`;
      if (atual?.status !== "PENDENTE") {
        throw new ErroNegocio(409, atual?.status === "CANCELADO" ? "Este pedido foi cancelado." : "Este pedido não está mais aguardando pagamento.");
      }
      return tx.pagamento.create({
        data: {
          orderId: pedido.id,
          gateway,
          referenciaExterna: referencia,
          status: "PENDENTE",
          statusGateway: "aberto",
          valor: pedido.total,
          checkoutUrl,
          faturaSlug,
          expiraEm,
        },
      });
    });
    console.info(`[pagamentos] link ${registro.id} aberto para o pedido ${pedido.id} (${gateway}, ${referencia})`);
    return paraCobrancaDTO(registro);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await db.pagamento.findUnique({
        where: { gateway_referenciaExterna: { gateway, referenciaExterna: referencia } },
      });
      if (existente) return paraCobrancaDTO(existente);
    }
    throw e;
  }
}

// --- aviso (webhook) e retorno ----------------------------------------------------------------

export type RespostaDoAviso = { status: 200 | 400 | 401; resultado: string };

/** O token do caminho é o desta referência? (HMAC com o SESSION_SECRET; comparação em tempo constante.) */
export function avisoAutentico(referencia: string, token: string): boolean {
  return referencia.length <= 64 && conferirTokenDoAviso(segredoDoAviso(), referencia, token);
}

/**
 * Aviso da InfinitePay em /api/webhooks/infinitepay/<referencia>/<token>. Sem o token certo: 401 e
 * nada muda. Cobrança desconhecida ou corpo sem transação: 200 sem efeito. Com candidato: confere na
 * hora e SÓ DEPOIS guarda o candidato, se a conferência não decidiu (e sem trocar um candidato
 * diferente dentro da janela). 200 quando confirmado, divergente (a dona confere no app) ou recusado
 * de vez; 400 quando a InfinitePay falhou, ainda não marca como pago ou a cobrança acabou de ser
 * conferida (ela repete o aviso: no ensaio real, 5 chamadas em ~3 min).
 */
export async function processarAvisoDaInfinitePay(referencia: string, token: string, corpo: unknown): Promise<RespostaDoAviso> {
  if (!avisoAutentico(referencia, token)) return { status: 401, resultado: "token-invalido" };
  const p = await db.pagamento.findUnique({ where: { gateway_referenciaExterna: { gateway: "infinitepay", referenciaExterna: referencia } } });
  if (!p) return { status: 200, resultado: "desconhecida" };
  if (p.status === "APROVADO" || p.status === "ESTORNADO") return { status: 200, resultado: "ja-aprovada" };
  const aviso = lerAviso(corpo, { origemLocal: origemDaApiDeTeste() });
  if (!aviso) return { status: 200, resultado: "sem-candidato" };
  if (aviso.referencia && aviso.referencia !== referencia) return { status: 200, resultado: "referencia-diferente" };
  // Slug de outra fatura: recusado ANTES de gravar, para um aviso falso não tomar o lugar do verdadeiro.
  if (p.faturaSlug && p.faturaSlug !== aviso.slug) {
    console.warn(`[pagamentos] cobrança ${p.id}: aviso com slug de outra fatura, ignorado`);
    return { status: 200, resultado: "slug-diferente" };
  }

  // Conferida há menos de 3 s: 400 ANTES de qualquer escrita (a InfinitePay repete). Um laço de avisos
  // não vira um laço de gravações nem de consultas. (As checagens acima só leem.)
  if (p.consultadoEm && Date.now() - p.consultadoEm.getTime() < INTERVALO_CONSULTA_AVISO_MS) {
    return { status: 400, resultado: "adiado" };
  }

  // Confere ANTES de gravar: o candidato só é guardado se a conferência não decidir (guardarCandidato).
  const r = await confirmarCobranca(p, aviso, "aviso");
  const status = r === "APROVADO" || r === "INVALIDO" || r === "DIVERGENTE" ? 200 : 400;
  return { status, resultado: r.toLowerCase() };
}

/**
 * Retorno do navegador (redirect_url): acha a cobrança pela referência e, se a sessão é da dona do
 * pedido, reconfere o candidato que o aviso gravou e confere a transação da query no payment_check,
 * com o order_nsu do NOSSO banco (a referência da query só localiza a cobrança). Se a InfinitePay
 * disser que essa transação pagou ESTE pedido, com as regras de sempre, o pedido vira PAGO aqui
 * mesmo, sem esperar o aviso. A transação da query só é gravada ao confirmar; recusada, não deixa
 * rastro além do `retorno_em`. Erro não derruba (a tela confere de novo). Devolve o caminho para onde
 * redirecionar: nunca uma URL vinda da query.
 */
export async function processarRetorno(parametros: URLSearchParams, usuarioId: string | null): Promise<string> {
  const { referencia, candidato } = lerRetorno(parametros, { origemLocal: origemDaApiDeTeste() });
  if (!referencia) return usuarioId ? "/meus-pedidos" : "/";
  const p = await db.pagamento.findUnique({
    where: { gateway_referenciaExterna: { gateway: "infinitepay", referenciaExterna: referencia } },
    include: { order: { select: { userId: true } } },
  });
  if (!p) return usuarioId ? "/meus-pedidos" : "/";
  // Sem sessão: a página do pedido pede login; sem gravar nada (o aviso cobre esse caso).
  if (!usuarioId) return `/order-confirmation/${p.orderId}?retorno=1`;
  // De outra conta: não revela nem grava nada.
  if (p.order.userId !== usuarioId) return "/meus-pedidos";

  if (p.status === "PENDENTE" || p.status === "CANCELADO") {
    try {
      // A cliente diz que pagou: segura a tela em "confirmando" e o link novo por 30 min, mesmo que a
      // conferência abaixo ainda não confirme (a InfinitePay pode demorar a achar a transação).
      if (candidato) {
        await db.pagamento.updateMany({ where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } }, data: { retornoEm: new Date() } });
      }
      // As consultas do retorno (a do aviso gravado, a principal e o canário) dividem um orçamento só.
      const prazo = Date.now() + ORCAMENTO_CONFERENCIA_MS;
      const gravado = candidatoGravado(p);
      const r = gravado ? await confirmarCobranca(p, gravado, "gravado", prazo) : null;
      const mesmoDoAviso = gravado && candidato && gravado.transacaoNsu === candidato.transacaoNsu && gravado.slug === candidato.slug;
      if (r !== "APROVADO" && r !== "DIVERGENTE" && candidato && !mesmoDoAviso) {
        const atual = (await db.pagamento.findUnique({ where: { id: p.id } })) ?? p;
        await confirmarCobranca(atual, candidato, "retorno", prazo);
      }
    } catch (e) {
      console.error(`[pagamentos] conferência no retorno da cobrança ${p.id} falhou: ${e instanceof Error ? e.name : "erro"}`);
    }
  }
  return `/order-confirmation/${p.orderId}?retorno=1`;
}

// --- leitura para as telas --------------------------------------------------------------------

async function lerSituacao(pedidoId: string, userId: string) {
  if (pedidoId.length === 0 || pedidoId.length > 100) return null;
  return db.order.findFirst({
    where: { id: pedidoId, userId, canal: "ONLINE" },
    // Todas (no máximo 10 por pedido): a etapa olha a mais recente COM candidato, não só a última.
    select: {
      status: true,
      createdAt: true,
      pagamentos: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: MAX_COBRANCAS_POR_PEDIDO + 2 },
    },
  });
}

function montarSituacao(pedido: NonNullable<Awaited<ReturnType<typeof lerSituacao>>>): SituacaoPagamentoDTO {
  const agora = Date.now();
  const ultima = pedido.pagamentos[0] ?? null;
  const decide = cobrancaParaEtapa(pedido.pagamentos.map(paraEtapa), agora);
  return {
    pedidoStatus: pedido.status,
    etapa: etapaDoPagamento({
      gatewayAtivo: pagamentoOnlineDisponivel(),
      pedidoStatus: pedido.status,
      pedidoCriadoEm: pedido.createdAt,
      ultimaCobranca: decide ? { status: decide.status, avisadoEm: decide.avisadoEm, retornoEm: decide.retornoEm } : null,
      pagamentoDivergente: pedido.pagamentos.some(cobrancaDivergente),
      agora,
    }),
    pagarAte: pedido.status === "PENDENTE" ? pagarAteDe(pedido.createdAt).toISOString() : null,
    cobranca: ultima ? paraCobrancaDTO(ultima, agora) : null,
  };
}

/** Situação do pagamento do pedido, só lendo o banco (páginas de servidor). `null`: não é da conta. */
export async function obterSituacaoPagamento(pedidoId: string, userId: string): Promise<SituacaoPagamentoDTO | null> {
  const pedido = await lerSituacao(pedidoId, userId);
  return pedido ? montarSituacao(pedido) : null;
}

/**
 * GET /api/orders/[id]/pagamento: na etapa CONFIRMANDO, confere de novo com o candidato guardado (no
 * máximo a cada 8 s, por até 30 min). Falha da InfinitePay não derruba a tela: devolve o que o banco sabe.
 */
export async function situacaoComConferencia(pedidoId: string, userId: string): Promise<SituacaoPagamentoDTO | null> {
  let pedido = await lerSituacao(pedidoId, userId);
  if (!pedido) return null;
  const emAndamento = cobrancaComAviso(pedido.pagamentos);
  if (pedido.status === "PENDENTE" && emAndamento && infinitePayConfigurado()) {
    try {
      await confirmarCobranca(emAndamento, candidatoGravado(emAndamento)!, "gravado");
      pedido = (await lerSituacao(pedidoId, userId)) ?? pedido;
    } catch (e) {
      console.error(`[pagamentos] conferência da cobrança ${emAndamento.id} falhou: ${e instanceof Error ? e.name : "erro"}`);
    }
  }
  return montarSituacao(pedido);
}

/**
 * Pedido cancelado pela dona: os links abertos viram CANCELADO no nosso banco (a API não cancela
 * link; na InfinitePay ele ainda aceita pagamento até vencer, em até 1 hora). `algumPago`: alguma
 * cobrança já tinha sido paga (devolver pelo app). `linkAberto`: havia link valendo.
 */
export async function encerrarCobrancasDoPedido(pedidoId: string): Promise<{ algumPago: boolean; linkAberto: boolean }> {
  const agora = new Date();
  const [abertas, pagas] = await Promise.all([
    db.pagamento.findMany({ where: { orderId: pedidoId, status: "PENDENTE" }, select: { id: true, expiraEm: true, gateway: true } }),
    db.pagamento.count({ where: { orderId: pedidoId, status: "APROVADO" } }),
  ]);
  if (abertas.length > 0) {
    await db.pagamento.updateMany({ where: { id: { in: abertas.map((p) => p.id) }, status: "PENDENTE" }, data: { status: "CANCELADO" } });
  }
  const linkAberto = abertas.some((p) => p.gateway === "infinitepay" && p.expiraEm > agora);
  return { algumPago: pagas > 0, linkAberto };
}

/**
 * DEMONSTRAÇÃO: confirma o pagamento de um pedido PENDENTE do usuário. Atômico: só atualiza se
 * ainda estiver pendente (duas chamadas simultâneas não duplicam a ação).
 */
export async function simularPagamento(orderId: string, userId: string): Promise<boolean> {
  const { count } = await db.order.updateMany({
    where: { id: orderId, userId, status: "PENDENTE" },
    data: { status: "PAGO" },
  });
  if (count === 1) {
    await db.pagamento.updateMany({
      where: { orderId, gateway: "simulado", status: "PENDENTE" },
      data: { status: "APROVADO", statusGateway: "simulado", aprovadoEm: new Date() },
    });
  }
  return count === 1;
}

/** Status de uma cobrança (para quem só precisa do tipo). */
export type { StatusCobranca };
