/**
 * Regras puras das encomendas de lembrancinhas (potinhos mini de 40 ml), usadas no servidor e no
 * navegador e testadas em testes/encomendas.test.ts. Sem Prisma e sem relógio escondido: toda função
 * que depende de "agora" ou de "hoje" recebe esse valor (o servidor nunca confia no do cliente).
 *
 * Dinheiro em CENTAVOS inteiros e peso em GRAMAS inteiros: a página e o servidor fazem a mesma conta,
 * então o total que a cliente vê é o que o servidor cobra.
 *
 * Datas: dias "AAAA-MM-DD" no fuso da loja (Teresina, −03:00 sem horário de verão; ver FUSO_LOJA).
 */
import { z } from "zod";
import { FUSO_LOJA, formatarDia, hojeNaLoja } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import type { ModoEntrega } from "@/lib/entrega-regras";
import { normalizarComposicao, type SaborNoKit } from "@/lib/kits-regras";
import { JANELA_CONFIRMANDO_MS, cobrancaDivergente, retornoRecente, type EtapaPagamento, type StatusCobranca } from "@/lib/pagamentos-regras";
import { enderecoSchema, telefoneSchema } from "@/lib/validacao";
import { FORMAS_PAGAMENTO, MAX_PRECO_UNITARIO_CENTAVOS, somarDias, textoLivreValido } from "@/lib/vendas";

// --- status ---------------------------------------------------------------------------------------

export const STATUS_ENCOMENDA = [
  "SOLICITADA",
  "AGUARDANDO_ENTRADA",
  "CONFIRMADA",
  "EM_PRODUCAO",
  "PRONTA",
  "ENTREGUE",
  "RECUSADA",
  "EXPIRADA",
  "CANCELADA",
] as const;

export type StatusEncomenda = (typeof STATUS_ENCOMENDA)[number];
/** O mesmo tipo dos pedidos (enum ModoEntrega do banco). */
export type { ModoEntrega };
export type Parcela = "ENTRADA" | "RESTANTE";
export type Ator = "CLIENTE" | "LOJA" | "SISTEMA";

/** Nada sai destes status. */
export const STATUS_FINAIS = ["ENTREGUE", "RECUSADA", "EXPIRADA", "CANCELADA"] as const satisfies readonly StatusEncomenda[];
/** Entrada paga: a encomenda está de pé e conta na agenda de produção. */
export const STATUS_CONFIRMADOS = ["CONFIRMADA", "EM_PRODUCAO", "PRONTA"] as const satisfies readonly StatusEncomenda[];
/** "Abertas" para o limite por conta (D12): ainda não terminaram. */
export const STATUS_ABERTOS = ["SOLICITADA", "AGUARDANDO_ENTRADA", ...STATUS_CONFIRMADOS] as const satisfies readonly StatusEncomenda[];

export const statusFinal = (s: StatusEncomenda) => (STATUS_FINAIS as readonly StatusEncomenda[]).includes(s);
export const statusConfirmado = (s: StatusEncomenda) => (STATUS_CONFIRMADOS as readonly StatusEncomenda[]).includes(s);

/** Rótulos em português. `Record<StatusEncomenda, …>` obriga a cobrir todo status novo. */
export const ROTULO_STATUS_ENCOMENDA: Record<StatusEncomenda, string> = {
  SOLICITADA: "Solicitada",
  AGUARDANDO_ENTRADA: "Aguardando a entrada",
  CONFIRMADA: "Confirmada",
  EM_PRODUCAO: "Em produção",
  PRONTA: "Pronta",
  ENTREGUE: "Entregue",
  RECUSADA: "Recusada",
  EXPIRADA: "Expirada",
  CANCELADA: "Cancelada",
};

/** "retirada" ou "entrega", para as frases. */
export const palavraDoModo = (modo: ModoEntrega | undefined) =>
  modo === "RETIRADA" ? "retirada" : modo === "ENTREGA" ? "entrega" : "entrega ou retirada";

// --- limites e prazos (decisões da dona, 2026-10-21) ----------------------------------------------

export const MIN_POTINHOS = 15;
export const MAX_POTINHOS = 50;
/** Sabores diferentes numa encomenda (teto da validação de entrada). */
export const MAX_SABORES = 20;
/** A festa é de hoje+5 (D11) a hoje+90 (D9). */
export const ANTECEDENCIA_MIN_DIAS = 5;
export const ANTECEDENCIA_MAX_DIAS = 90;
/** A entrega ou retirada é de hoje+4 até a véspera da festa (D11). */
export const DIAS_MIN_ATE_ENTREGA = 4;
/** O corte da desistência é às 23h59 de 3 dias antes da entrega ou retirada (D4). */
export const DIAS_CORTE_ANTES_DA_ENTREGA = 3;
/** A cliente paga a entrada em até 24 h depois da aprovação, nunca depois do corte (D6). */
export const HORAS_PARA_PAGAR_ENTRADA = 24;
/**
 * Folga depois do prazo da entrada: o link do checkout vale só até `entradaAte` (o `valid_until`), mas a
 * encomenda só EXPIRA de fato 30 min depois. Quem paga no último minuto tem o aviso da InfinitePay (e a
 * conferência) chegando segundos ou minutos depois, e não perde a encomenda por isso. Pago dentro da folga
 * confirma normalmente; pago depois dela (já EXPIRADA) vira devolução (pagamento tardio). O prazo que a
 * cliente lê continua sendo `entradaAte`; a folga é tolerância interna (o DTO só avisa `entradaEmFolga`).
 * O restante não tem prazo de expiração: um link dele pago no último instante confirma a qualquer hora.
 */
export const FOLGA_DA_ENTRADA_MS = 30 * 60_000;
/**
 * Quanto tempo, no máximo, um candidato de aviso não conferido ou um pagamento com divergência SEGURA a
 * encomenda (ela não expira, a cliente não desiste e a dona não registra a parcela por fora), contado a
 * partir do VENCIMENTO do link da cobrança (`expira_em`, um instante que só nós definimos). Passado isso,
 * a conferência deixa de segurar: o aviso e o alerta no painel continuam, e um pagamento que ainda se
 * confirme depois vira devolução pendente se a encomenda já tiver terminado. O retorno do navegador segura
 * 30 min (`JANELA_CONFIRMANDO_MS`) e só é gravado até 30 min depois do vencimento do link.
 *
 * Por que o vencimento do link e não a hora do aviso: o aviso pode ser FORJADO pela cliente (a página de
 * pagamento da InfinitePay mostra o endereço do aviso com o token da cobrança dela), e cada aviso novo
 * renovaria uma contagem a partir dele para sempre. O vencimento do link não se renova: o pagamento só
 * pode ter entrado até ele, então o aviso e o retorno de verdade chegam antes de vencimento + algumas horas.
 */
export const HORAS_MAX_EM_CONFERENCIA = 24;
/** Validade de cada link de pagamento (`valid_until`): no máximo 1 hora, como nos pedidos. */
export const LINK_MAX_MS = 60 * 60_000;
/**
 * Um link novo precisa valer pelo menos isto: com o prazo da entrada terminando em menos tempo, a
 * cliente não teria tempo de pagar (é a mesma folga com que os pedidos reaproveitam um link).
 */
export const LINK_MIN_MS = 5 * 60_000;
export const TAMANHO_MAX_TEXTO = 300;
export const TAMANHO_MIN_MOTIVO = 5;

// --- datas no fuso da loja ------------------------------------------------------------------------

/**
 * O fuso da loja não tem horário de verão (America/Fortaleza, −03:00 desde 2019 e também no futuro
 * enquanto o Piauí não adotar): o início e o meio-dia de um dia são instantes fixos.
 */
const DESLOCAMENTO = "-03:00";

/** "AAAA-MM-DD" que existe de verdade ("2026-02-30" não existe). */
export function diaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const d = new Date(`${dia}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

/** 00:00 do dia na loja, como instante. */
export function inicioDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00.000${DESLOCAMENTO}`);
}

/** 12:00 do dia na loja, como instante. */
export function meioDia(dia: string): Date {
  return new Date(`${dia}T12:00:00.000${DESLOCAMENTO}`);
}

/** Que dia é este instante na loja: 2026-11-11T02:59:59Z ainda é 10/11 em Teresina. */
export function diaDaLoja(instante: Date): string {
  return hojeNaLoja(instante);
}

const menor = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

export type FaixaDeDatas = { festaMin: string; festaMax: string; entregaMin: string; entregaMax: string };

/**
 * Datas aceitas a partir de hoje (no fuso da loja): festa de hoje+5 a hoje+90; entrega ou retirada de
 * hoje+4 até a véspera da festa (sem festa escolhida, até a véspera da festa mais distante).
 */
export function faixaDeDatas(hoje: string, dataFesta?: string): FaixaDeDatas {
  const festaMin = somarDias(hoje, ANTECEDENCIA_MIN_DIAS);
  const festaMax = somarDias(hoje, ANTECEDENCIA_MAX_DIAS);
  const festa = dataFesta && diaValido(dataFesta) ? dataFesta : festaMax;
  return { festaMin, festaMax, entregaMin: somarDias(hoje, DIAS_MIN_ATE_ENTREGA), entregaMax: somarDias(festa, -1) };
}

export type ErrosDeDatas = Partial<Record<"dataFesta" | "dataEntrega", string[]>>;

/**
 * Confere as datas contra o "hoje" da LOJA (o do servidor, nunca o do navegador). Os erros vêm por
 * campo, com a data concreta que valeria: "A festa precisa ser a partir de 15/11/2026 (5 dias de
 * antecedência)."
 */
export function validarDatas(entrada: {
  hoje: string;
  dataFesta: string;
  dataEntrega: string;
  modo?: ModoEntrega;
}): { ok: true } | { ok: false; erros: ErrosDeDatas } {
  const { hoje, dataFesta, dataEntrega } = entrada;
  const palavra = palavraDoModo(entrada.modo);
  const Palavra = palavra[0].toUpperCase() + palavra.slice(1);
  const faixa = faixaDeDatas(hoje, dataFesta);
  const erros: ErrosDeDatas = {};

  const festaValida = diaValido(dataFesta);
  if (!festaValida) erros.dataFesta = ["Data da festa inválida."];
  else if (dataFesta < faixa.festaMin) {
    erros.dataFesta = [`A festa precisa ser a partir de ${formatarDia(faixa.festaMin)} (${ANTECEDENCIA_MIN_DIAS} dias de antecedência).`];
  } else if (dataFesta > faixa.festaMax) {
    erros.dataFesta = [
      `Aceitamos encomendas com até ${ANTECEDENCIA_MAX_DIAS} dias de antecedência: a festa pode ser até ${formatarDia(faixa.festaMax)}.`,
    ];
  }

  if (!diaValido(dataEntrega)) erros.dataEntrega = [`Data da ${palavra} inválida.`];
  else if (dataEntrega < faixa.entregaMin) {
    erros.dataEntrega = [
      `${Palavra} a partir de ${formatarDia(faixa.entregaMin)}: precisamos de ${DIAS_MIN_ATE_ENTREGA} dias para preparar os potinhos.`,
    ];
  } else if (festaValida && dataEntrega >= dataFesta) {
    erros.dataEntrega = [`A ${palavra} precisa ser antes do dia da festa (até ${formatarDia(somarDias(dataFesta, -1))}).`];
  }

  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true };
}

/** Corte da desistência: 23h59 de 3 dias antes da entrega (= 00:00 de 2 dias antes). */
export function corteDaEntrega(dataEntrega: string): Date {
  return inicioDoDia(somarDias(dataEntrega, -(DIAS_CORTE_ANTES_DA_ENTREGA - 1)));
}

/**
 * Prazos fixados na solicitação (S = dia da solicitação na loja, E = entrega ou retirada):
 * - a loja responde até o fim do dia seguinte (00:00 de S+2) ou até o meio-dia de E−3, o que vier
 *   primeiro (D5). Como E ≥ S+4, ela tem pelo menos até o meio-dia de S+1;
 * - o corte é às 23h59 de E−3 (`corteDaEntrega`). Ele vem sempre depois de `responderAte`.
 */
export function prazosDaEncomenda(criadaEm: Date, dataEntrega: string): { responderAte: Date; corteEm: Date } {
  const s = diaDaLoja(criadaEm);
  const fimDoDiaSeguinte = inicioDoDia(somarDias(s, 2));
  const meioDiaAntesDoCorte = meioDia(somarDias(dataEntrega, -DIAS_CORTE_ANTES_DA_ENTREGA));
  return { responderAte: menor(fimDoDiaSeguinte, meioDiaAntesDoCorte), corteEm: corteDaEntrega(dataEntrega) };
}

/** Até quando a cliente paga a entrada: 24 h depois da aprovação, nunca depois do corte (D6). */
export function prazoDaEntrada(aprovadaEm: Date, corteEm: Date): Date {
  return menor(new Date(aprovadaEm.getTime() + HORAS_PARA_PAGAR_ENTRADA * 60 * 60_000), corteEm);
}

/** Quando a encomenda aguardando a entrada expira de fato: `entradaAte` mais a folga. */
export function fimDaFolgaDaEntrada(entradaAte: Date): Date {
  return new Date(entradaAte.getTime() + FOLGA_DA_ENTRADA_MS);
}

/**
 * A entrada passou do prazo (`entradaAte`) e ainda está nos 30 min de folga? Só enquanto o status efetivo
 * segue AGUARDANDO_ENTRADA: depois da folga a encomenda expira (ou fica segurada por uma conferência, que
 * a tela mostra por `pagamentoEmConferencia`, não como folga).
 */
export function entradaEmFolgaAgora(statusEfetivoAgora: StatusEncomenda, entradaAte: Date | null, agora: Date): boolean {
  if (statusEfetivoAgora !== "AGUARDANDO_ENTRADA" || entradaAte === null) return false;
  const t = agora.getTime();
  return t >= entradaAte.getTime() && t < fimDaFolgaDaEntrada(entradaAte).getTime();
}

/**
 * Quantas horas a cliente tem (ou teve) para pagar a entrada, para a tela não escrever "24 horas" fixo:
 * depois da aprovação, o intervalo real entre a aprovação e `entradaAte` (24 h, ou menos se o corte vier
 * antes); antes dela, o máximo possível agora, min(24 h, até o corte). Em horas, com 1 casa decimal.
 */
export function horasParaPagarEntrada(
  e: { aprovadaEm: Date | null; entradaAte: Date | null; corteEm: Date },
  agora: Date,
): number {
  const ms =
    e.aprovadaEm && e.entradaAte
      ? e.entradaAte.getTime() - e.aprovadaEm.getTime()
      : Math.min(HORAS_PARA_PAGAR_ENTRADA * 3_600_000, e.corteEm.getTime() - agora.getTime());
  return Math.max(0, Math.round((ms / 3_600_000) * 10) / 10);
}

/**
 * `valid_until` de um link novo: min(agora + 1 hora, `limite`), onde o limite é o prazo da entrada
 * (o link nunca passa dele). Sem limite (o restante), 1 hora. `null` se faltam menos de 5 minutos
 * para o limite (ou ele já passou): não se abre link para um prazo que está acabando.
 */
export function validadeDoLink(agora: Date, limite: Date | null): Date | null {
  const t = agora.getTime();
  if (limite === null) return new Date(t + LINK_MAX_MS);
  if (limite.getTime() - t < LINK_MIN_MS) return null;
  return new Date(Math.min(t + LINK_MAX_MS, limite.getTime()));
}

// --- formatação de prazos -------------------------------------------------------------------------

const formatoPrazo = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_LOJA,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partesDoPrazo(instante: Date): Record<string, string> {
  return Object.fromEntries(formatoPrazo.formatToParts(instante).map((p) => [p.type, p.value]));
}

/**
 * "quarta-feira, 11/11/2026, às 23h59" no horário da loja. Meia-noite em ponto vira 23h59 do dia
 * anterior: o corte (00:00 de E−2) se lê como "até 23h59 de E−3", que é o que a política promete.
 */
export function formatarPrazo(instante: Date): string {
  let p = partesDoPrazo(instante);
  if (p.hour === "00" && p.minute === "00") p = partesDoPrazo(new Date(instante.getTime() - 60_000));
  return `${p.weekday}, ${p.day}/${p.month}/${p.year}, às ${p.hour}h${p.minute}`;
}

// --- potinhos e valores ---------------------------------------------------------------------------

export type MotivoPotinhos = "abaixo-do-minimo" | "acima-do-maximo" | "quantidade-invalida" | "indisponivel";

export type ResultadoPotinhos<I extends SaborNoKit> =
  | { ok: true; total: number; itens: I[] }
  | { ok: false; motivo: MotivoPotinhos; mensagem: string; total: number; indisponiveis: string[] };

/**
 * Junta o mesmo sabor repetido (a mesma regra dos kits) e confere: quantidades inteiras ≥ 1, todo
 * sabor disponível em mini (`saboresMini`: à venda E marcados "disponível em mini") e o total entre
 * 15 e 50 potinhos. A mensagem é a do 400 em `itens`: "Mínimo de 15 potinhos; você escolheu 12."
 */
export function conferirPotinhos<I extends SaborNoKit>(itens: readonly I[], saboresMini: ReadonlySet<string>): ResultadoPotinhos<I> {
  if (itens.some((i) => !Number.isInteger(i.quantidade) || i.quantidade < 1)) {
    return {
      ok: false,
      motivo: "quantidade-invalida",
      mensagem: "A quantidade de cada sabor precisa ser um número inteiro de potinhos, de 1 em diante.",
      total: 0,
      indisponiveis: [],
    };
  }
  const normalizados = normalizarComposicao(itens);
  const total = normalizados.reduce((soma, i) => soma + i.quantidade, 0);
  const indisponiveis = normalizados.filter((i) => !saboresMini.has(i.productId)).map((i) => i.productId);
  if (indisponiveis.length > 0) {
    return { ok: false, motivo: "indisponivel", mensagem: "Alguns sabores não estão disponíveis em mini.", total, indisponiveis };
  }
  if (total < MIN_POTINHOS) {
    return { ok: false, motivo: "abaixo-do-minimo", mensagem: `Mínimo de ${MIN_POTINHOS} potinhos; você escolheu ${total}.`, total, indisponiveis };
  }
  if (total > MAX_POTINHOS) {
    return { ok: false, motivo: "acima-do-maximo", mensagem: `Máximo de ${MAX_POTINHOS} potinhos; você escolheu ${total}.`, total, indisponiveis };
  }
  return { ok: true, total, itens: normalizados };
}

/** Peso para o frete: os potinhos cheios mais a embalagem da encomenda. */
export function pesoDaEncomenda(potinhos: number, pesoPotinhoGramas: number, pesoEmbalagemGramas: number): number {
  return potinhos * pesoPotinhoGramas + pesoEmbalagemGramas;
}

export type ValoresDaEncomenda = { subtotal: number; frete: number; total: number; entrada: number; restante: number };

/**
 * Em centavos. A entrada é metade do valor dos POTINHOS (sem o frete, D7), arredondada para cima no
 * centavo; o restante é o total menos a entrada, com o frete. Assim entrada + restante = total sempre.
 */
export function calcularValores(entrada: { subtotalCentavos: number; freteCentavos: number }): ValoresDaEncomenda {
  const { subtotalCentavos: subtotal, freteCentavos: frete } = entrada;
  if (!Number.isInteger(subtotal) || subtotal <= 0 || !Number.isInteger(frete) || frete < 0) {
    throw new RangeError("Valores da encomenda inválidos.");
  }
  const total = subtotal + frete;
  const valorEntrada = Math.ceil(subtotal / 2);
  return { subtotal, frete, total, entrada: valorEntrada, restante: total - valorEntrada };
}

// --- desistência e devolução ----------------------------------------------------------------------

/**
 * Quanto volta para a cliente se a encomenda for encerrada agora (centavos):
 * - a LOJA cancelou: devolve tudo o que foi pago;
 * - a CLIENTE desistiu antes do corte: tudo;
 * - a CLIENTE desistiu do corte em diante: `percentualRetido`% da entrada fica com a loja (arredondado
 *   para baixo, a favor da cliente) e o resto volta, inclusive o restante já pago.
 */
export function devolucaoNaDesistencia(entrada: {
  agora: Date;
  corteEm: Date;
  entradaPaga: number;
  restantePago: number;
  quem: "CLIENTE" | "LOJA";
  percentualRetido: number;
}): { devolucao: number; retido: number } {
  const { entradaPaga, restantePago } = entrada;
  const pago = entradaPaga + restantePago;
  if (entrada.quem === "LOJA" || entrada.agora.getTime() < entrada.corteEm.getTime()) return { devolucao: pago, retido: 0 };
  const percentual = Math.min(100, Math.max(0, Math.trunc(entrada.percentualRetido)));
  const retido = Math.floor((entradaPaga * percentual) / 100);
  return { devolucao: pago - retido, retido };
}

/** Quanto da entrada a política promete reter (para o texto): o mesmo arredondamento da devolução. */
export function valorRetidoDaEntrada(entradaCentavos: number, percentualRetido: number): number {
  return Math.floor((entradaCentavos * Math.min(100, Math.max(0, Math.trunc(percentualRetido)))) / 100);
}

// --- máquina de estados ---------------------------------------------------------------------------

export type FatosDaTransicao = {
  agora: Date;
  responderAte: Date;
  entradaAte: Date | null;
  /** Restante pago (pelo site ou registrado pela loja). */
  quitada: boolean;
};

export type MotivoTransicaoRecusada = "transicao-invalida" | "prazo-vencido" | "nao-quitada";

type Transicao = {
  para: StatusEncomenda;
  atores: readonly Ator[];
  /** Condição de tempo/dinheiro; `null` = pode. */
  condicao?: (f: FatosDaTransicao) => MotivoTransicaoRecusada | null;
};

const antesDe = (limite: (f: FatosDaTransicao) => Date | null) => (f: FatosDaTransicao) => {
  const l = limite(f);
  return l && f.agora.getTime() < l.getTime() ? null : "prazo-vencido";
};
const depoisDe = (limite: (f: FatosDaTransicao) => Date | null) => (f: FatosDaTransicao) => {
  const l = limite(f);
  return l && f.agora.getTime() >= l.getTime() ? null : "transicao-invalida";
};

/** Quem pode levar a encomenda de um status a outro, e com que condição (seção 4.3 do plano). */
export const TRANSICOES_ENCOMENDA: Record<StatusEncomenda, readonly Transicao[]> = {
  SOLICITADA: [
    { para: "AGUARDANDO_ENTRADA", atores: ["LOJA"], condicao: antesDe((f) => f.responderAte) },
    { para: "RECUSADA", atores: ["LOJA"] },
    { para: "EXPIRADA", atores: ["SISTEMA"], condicao: depoisDe((f) => f.responderAte) },
    { para: "CANCELADA", atores: ["CLIENTE"] },
  ],
  AGUARDANDO_ENTRADA: [
    // Paga por um link que ainda valia: confirma mesmo depois de `entradaAte` (dentro da folga). A loja
    // também confirma, ao registrar a entrada recebida fora do site (ou conferida no app InfinitePay).
    { para: "CONFIRMADA", atores: ["SISTEMA", "LOJA"] },
    // Só depois da folga (`fimDaFolgaDaEntrada`): quem paga no último minuto ainda confirma.
    { para: "EXPIRADA", atores: ["SISTEMA"], condicao: depoisDe((f) => (f.entradaAte ? fimDaFolgaDaEntrada(f.entradaAte) : null)) },
    { para: "CANCELADA", atores: ["CLIENTE", "LOJA"] },
  ],
  CONFIRMADA: [
    { para: "EM_PRODUCAO", atores: ["LOJA"] },
    { para: "PRONTA", atores: ["LOJA"] },
    { para: "CANCELADA", atores: ["CLIENTE", "LOJA"] },
  ],
  EM_PRODUCAO: [
    { para: "PRONTA", atores: ["LOJA"] },
    { para: "CANCELADA", atores: ["CLIENTE", "LOJA"] },
  ],
  PRONTA: [
    { para: "ENTREGUE", atores: ["LOJA"], condicao: (f) => (f.quitada ? null : "nao-quitada") },
    { para: "CANCELADA", atores: ["CLIENTE", "LOJA"] },
  ],
  ENTREGUE: [],
  RECUSADA: [],
  EXPIRADA: [],
  CANCELADA: [],
};

/** A transição pode acontecer agora, por este ator? Senão, por quê. */
export function transicaoPermitida(
  de: StatusEncomenda,
  para: StatusEncomenda,
  ator: Ator,
  fatos: FatosDaTransicao,
): { ok: true } | { ok: false; motivo: MotivoTransicaoRecusada } {
  const t = TRANSICOES_ENCOMENDA[de].find((x) => x.para === para && x.atores.includes(ator));
  if (!t) return { ok: false, motivo: "transicao-invalida" };
  const motivo = t.condicao?.(fatos) ?? null;
  return motivo ? { ok: false, motivo } : { ok: true };
}

/** O que as telas precisam saber da encomenda para status efetivo e ações (datas como Date). */
export type EncomendaParaRegras = {
  status: StatusEncomenda;
  responderAte: Date;
  entradaAte: Date | null;
  corteEm: Date;
  /** Vencimento do link da ENTRADA ainda aberto mais longo (null = nenhum aberto). */
  linkEntradaValidoAte: Date | null;
  /**
   * Algum pagamento da ENTRADA está em conferência (aviso da InfinitePay ainda não conferido, retorno
   * do navegador há menos de 30 min, ou pago com divergência; no máximo `HORAS_MAX_EM_CONFERENCIA`, ver
   * `estadoDaConferencia`): o dinheiro pode ter entrado, então a encomenda não expira por prazo
   * enquanto isso, e a cliente não abre outro link.
   */
  entradaEmConfirmacao?: boolean;
  /** O mesmo para o RESTANTE (bloqueia novo link do restante, a desistência e o registro por fora). */
  restanteEmConfirmacao?: boolean;
  entradaPagaEm: Date | null;
  restantePagoEm: Date | null;
  valorEntradaCentavos: number;
  valorRestanteCentavos: number;
  percentualRetido: number;
};

/**
 * Status como a cliente e a dona devem ver AGORA. A expiração é "preguiçosa" (gravada na próxima
 * leitura ou ação); até lá, a tela usa este status:
 * - SOLICITADA sem resposta até `responderAte` → EXPIRADA;
 * - AGUARDANDO_ENTRADA 30 min depois de `entradaAte` (a folga, `FOLGA_DA_ENTRADA_MS`) → EXPIRADA, a menos
 *   que ainda haja um link da entrada valendo (pode ser pago até o vencimento dele) ou um pagamento
 *   dela em conferência (limitada a `HORAS_MAX_EM_CONFERENCIA`).
 */
export function statusEfetivo(
  enc: Pick<EncomendaParaRegras, "status" | "responderAte" | "entradaAte" | "linkEntradaValidoAte" | "entradaEmConfirmacao">,
  agora: Date,
): StatusEncomenda {
  const t = agora.getTime();
  if (enc.status === "SOLICITADA" && t >= enc.responderAte.getTime()) return "EXPIRADA";
  if (enc.status === "AGUARDANDO_ENTRADA" && enc.entradaAte && t >= fimDaFolgaDaEntrada(enc.entradaAte).getTime()) {
    const linkValendo = enc.linkEntradaValidoAte !== null && enc.linkEntradaValidoAte.getTime() > t;
    return linkValendo || enc.entradaEmConfirmacao ? "AGUARDANDO_ENTRADA" : "EXPIRADA";
  }
  return enc.status;
}

// --- conferência de pagamento (aviso, retorno, divergência) -----------------------------------------

/** O que a conferência olha numa cobrança (as colunas de `pagamentos`). */
export type CobrancaParaConferencia = {
  status: StatusCobranca;
  statusGateway: string | null;
  avisoTransacaoNsu: string | null;
  avisoSlug: string | null;
  avisadoEm: Date | null;
  retornoEm: Date | null;
  expiraEm: Date;
};

/** DIVERGENTE: pago, mas valor/método/parcelas não conferem. CONFIRMANDO: aviso ou retorno sem desfecho. */
export type EstadoDaConferencia = "DIVERGENTE" | "CONFIRMANDO";

const MAX_EM_CONFERENCIA_MS = HORAS_MAX_EM_CONFERENCIA * 3_600_000;

/**
 * A cobrança está SEGURANDO a encomenda agora? Só enquanto o dinheiro pode estar entrando e a conferência
 * é recente: um candidato de aviso gravado (qualquer um, verdadeiro ou forjado) e a divergência seguram
 * até `HORAS_MAX_EM_CONFERENCIA` depois do VENCIMENTO do link (`expiraEm`: o que a cliente mexe nos
 * avisos não muda isso); o retorno do navegador segura 30 min. Passado isso a encomenda pode expirar, a
 * cliente pode desistir e a dona pode agir (o alerta no painel continua). Cobrança aprovada ou recusada não
 * segura nada.
 */
export function estadoDaConferencia(c: CobrancaParaConferencia, agora: number = Date.now()): EstadoDaConferencia | null {
  if (c.status !== "PENDENTE" && c.status !== "CANCELADO") return null;
  const candidato = Boolean(c.avisoTransacaoNsu && c.avisoSlug && c.avisadoEm);
  const dentroDoLimite = agora < c.expiraEm.getTime() + MAX_EM_CONFERENCIA_MS;
  if (cobrancaDivergente(c) && dentroDoLimite) return "DIVERGENTE";
  if (candidato && dentroDoLimite) return "CONFIRMANDO";
  if (retornoRecente(c.retornoEm, agora)) return "CONFIRMANDO";
  return null;
}

/** Até quando esta cobrança segura a encomenda (`null`: não está segurando). */
export function conferenciaAte(c: CobrancaParaConferencia, agora: number = Date.now()): Date | null {
  const estado = estadoDaConferencia(c, agora);
  if (estado === null) return null;
  const candidato = Boolean(c.avisoTransacaoNsu && c.avisoSlug && c.avisadoEm);
  const fins: number[] = [];
  const fimDoAviso = c.expiraEm.getTime() + MAX_EM_CONFERENCIA_MS;
  if ((cobrancaDivergente(c) || candidato) && agora < fimDoAviso) fins.push(fimDoAviso);
  if (retornoRecente(c.retornoEm, agora)) fins.push(c.retornoEm!.getTime() + JANELA_CONFIRMANDO_MS);
  return fins.length > 0 ? new Date(Math.max(...fins)) : null;
}

const pagoEmCentavos = (enc: EncomendaParaRegras) => ({
  entradaPaga: enc.entradaPagaEm ? enc.valorEntradaCentavos : 0,
  restantePago: enc.restantePagoEm ? enc.valorRestanteCentavos : 0,
});

export type AcoesDaCliente = {
  /** Pode abrir (ou pedir de novo) o link de pagamento da entrada (PIX ou cartão, na InfinitePay). */
  pagarEntrada: boolean;
  /** Pode abrir o link do restante (de CONFIRMADA até antes da entrega, se ainda não quitada). */
  pagarRestante: boolean;
  /** Prévia da desistência agora (centavos), ou `null` se não dá para desistir. */
  desistir: { devolucao: number; retido: number } | null;
  /**
   * Há pagamento em conferência (entrada ou restante): o POST de desistência responderia 409 "aguarde".
   * `desistir` ainda traz a prévia, para a tela mostrar o botão desabilitado com o motivo.
   */
  desistirBloqueado: boolean;
};

export function acoesDaCliente(enc: EncomendaParaRegras, agora: Date): AcoesDaCliente {
  const status = statusEfetivo(enc, agora);
  const aberta = (STATUS_ABERTOS as readonly StatusEncomenda[]).includes(status);
  return {
    // Só quando o POST abriria o link: com menos de 5 min até o prazo da entrada (validadeDoLink), ou com
    // pagamento em conferência, o POST responde 409 e o botão não aparece.
    pagarEntrada:
      status === "AGUARDANDO_ENTRADA" &&
      enc.entradaAte !== null &&
      validadeDoLink(agora, enc.entradaAte) !== null &&
      !enc.entradaEmConfirmacao,
    pagarRestante: statusConfirmado(status) && enc.restantePagoEm === null && !enc.restanteEmConfirmacao,
    desistir: aberta
      ? devolucaoNaDesistencia({ agora, corteEm: enc.corteEm, ...pagoEmCentavos(enc), quem: "CLIENTE", percentualRetido: enc.percentualRetido })
      : null,
    desistirBloqueado: aberta && Boolean(enc.entradaEmConfirmacao || enc.restanteEmConfirmacao),
  };
}

/**
 * Etapa do pagamento de UMA parcela, para a tela da encomenda (os mesmos valores da tela do pedido,
 * na ordem):
 * 1. parcela paga → PAGO;
 * 2. encomenda EXPIRADA → EXPIRADO; RECUSADA, CANCELADA ou ENTREGUE → CANCELADO;
 * 3. pago com divergência → CONFIRMANDO ("fale com a loja"), sem prazo;
 * 4. a parcela ainda não foi liberada (a ENTRADA antes da aprovação; o RESTANTE antes da entrada paga)
 *    → INDISPONIVEL com `motivoIndisponivel: "NAO_LIBERADA"`;
 * 5. pagamento pelo site desligado → INDISPONIVEL com `motivoIndisponivel: "PAGAMENTO_FORA_DO_AR"`;
 * 6. aviso da InfinitePay ainda não conferido, ou retorno do navegador há menos de 30 min → CONFIRMANDO
 *    (com dinheiro possivelmente entrando, a tela nunca volta a "Pagar");
 * 7. o resto → PAGAR (o botão segue `acoes.pagarEntrada` / `acoes.pagarRestante`).
 * `motivoIndisponivel` é `null` em toda etapa que não seja INDISPONIVEL.
 */
export type MotivoIndisponivel = "NAO_LIBERADA" | "PAGAMENTO_FORA_DO_AR";

export function etapaDaParcela(e: {
  parcela: Parcela;
  /** `statusEfetivo` da encomenda. */
  status: StatusEncomenda;
  paga: boolean;
  gatewayAtivo: boolean;
  divergente: boolean;
  emConfirmacao: boolean;
}): { etapa: EtapaPagamento; motivoIndisponivel: MotivoIndisponivel | null } {
  const so = (etapa: EtapaPagamento) => ({ etapa, motivoIndisponivel: null });
  if (e.paga) return so("PAGO");
  if (e.status === "EXPIRADA") return so("EXPIRADO");
  if (statusFinal(e.status)) return so("CANCELADO");
  if (e.divergente) return so("CONFIRMANDO");
  const liberada = e.parcela === "ENTRADA" ? e.status === "AGUARDANDO_ENTRADA" : statusConfirmado(e.status);
  if (!liberada) return { etapa: "INDISPONIVEL", motivoIndisponivel: "NAO_LIBERADA" };
  if (!e.gatewayAtivo) return { etapa: "INDISPONIVEL", motivoIndisponivel: "PAGAMENTO_FORA_DO_AR" };
  if (e.emConfirmacao) return so("CONFIRMANDO");
  return so("PAGAR");
}

/**
 * Alerta da encomenda no painel (um só, por prioridade):
 * - DEVOLUCAO_PENDENTE: há dinheiro a devolver (desistência, cancelamento, pago tarde ou em dobro):
 *   devolver pelo app da InfinitePay e marcar "Marquei como devolvida";
 * - PAGO_COM_DIVERGENCIA: a InfinitePay diz "pago", mas o valor, o método ou as parcelas não conferem;
 *   a parcela NÃO foi dada como paga. Conferir no app;
 * - AVISO_NAO_CONFERIDO: chegou o aviso de pagamento, mas há mais de 30 min a conferência não fecha.
 */
export type AlertaEncomenda = "DEVOLUCAO_PENDENTE" | "PAGO_COM_DIVERGENCIA" | "AVISO_NAO_CONFERIDO";

export function alertaDaEncomenda(e: { devolucaoPendente: boolean; pagamentoDivergente: boolean; avisoParadoHaMaisDe30Min: boolean }): AlertaEncomenda | null {
  if (e.devolucaoPendente) return "DEVOLUCAO_PENDENTE";
  if (e.pagamentoDivergente) return "PAGO_COM_DIVERGENCIA";
  if (e.avisoParadoHaMaisDe30Min) return "AVISO_NAO_CONFERIDO";
  return null;
}

/**
 * Quanto a loja pode devolver ao cancelar (centavos): no mínimo o que a regra manda (tudo, quando a
 * loja cancela; a regra do corte, quando a cliente pediu pelo WhatsApp), no máximo tudo o que foi pago.
 */
export function faixaDaDevolucaoNoCancelamento(enc: EncomendaParaRegras, agora: Date, aPedidoDaCliente: boolean): { minimo: number; maximo: number } {
  const v = valoresDoCancelamento(enc, agora);
  return { minimo: aPedidoDaCliente ? v.aPedidoDaCliente.devolucao : v.pelaLoja.devolucao, maximo: v.totalPago };
}

/** Valores do cancelamento pela loja (centavos): a padrão (devolve tudo) e a mínima a pedido da cliente. */
export function valoresDoCancelamento(enc: EncomendaParaRegras, agora: Date) {
  const pago = pagoEmCentavos(enc);
  const totalPago = pago.entradaPaga + pago.restantePago;
  return {
    totalPago,
    pelaLoja: devolucaoNaDesistencia({ agora, corteEm: enc.corteEm, ...pago, quem: "LOJA", percentualRetido: enc.percentualRetido }),
    aPedidoDaCliente: devolucaoNaDesistencia({ agora, corteEm: enc.corteEm, ...pago, quem: "CLIENTE", percentualRetido: enc.percentualRetido }),
  };
}

export const ACOES_ADMIN = [
  "aprovar",
  "recusar",
  "iniciar-producao",
  "marcar-pronta",
  "marcar-entregue",
  "registrar-entrada",
  "registrar-restante",
  "cancelar",
  "devolucao-feita",
  "avisada",
] as const;

export type AcaoAdmin = (typeof ACOES_ADMIN)[number];

export type AcaoDaLoja = {
  acao: AcaoAdmin;
  rotulo: string;
  /** false: o botão aparece desabilitado, com o `motivo`. */
  permitida: boolean;
  motivo: string | null;
  /** Aviso que não bloqueia (ex.: produção antes do corte). */
  aviso: string | null;
};

/** Aviso de quem cancela com pagamento em conferência (não bloqueia: é a saída da dona). */
export const AVISO_CANCELAR_EM_CONFERENCIA =
  "Há um pagamento sendo conferido. Confira no app InfinitePay antes de cancelar: se o dinheiro tiver entrado " +
  "(ou entrar depois), ele aparece como devolução pendente e você devolve pelo app.";

/**
 * Botões da ficha no painel, conforme o status efetivo. "Avisar no WhatsApp" (`avisada`) aparece
 * sempre; "Marquei como devolvida", só com devolução pendente. Registrar a entrada ou o restante por
 * fora fica desabilitado enquanto aquela parcela tem pagamento em conferência (no máximo
 * `HORAS_MAX_EM_CONFERENCIA`); cancelar continua valendo, com o aviso de conferir no app.
 */
export function acoesDaLoja(enc: EncomendaParaRegras & { devolucaoPendente: boolean; modo: ModoEntrega }, agora: Date): AcaoDaLoja[] {
  const status = statusEfetivo(enc, agora);
  const quitada = enc.restantePagoEm !== null;
  const antesDoCorte = agora.getTime() < enc.corteEm.getTime();
  const acao = (a: AcaoAdmin, rotulo: string, extra: Partial<AcaoDaLoja> = {}): AcaoDaLoja => ({
    acao: a,
    rotulo,
    permitida: true,
    motivo: null,
    aviso: null,
    ...extra,
  });
  const lista: AcaoDaLoja[] = [];
  const motivoConferencia = (parcela: string) =>
    `Há um pagamento ${parcela} sendo conferido. Confira no app InfinitePay: se o dinheiro entrou, aguarde a confirmação; ` +
    `a conferência libera esta ação sozinha em até ${HORAS_MAX_EM_CONFERENCIA} h.`;
  const entrada = () => [
    acao("registrar-entrada", "Entrada recebida fora do site", {
      ...(enc.entradaEmConfirmacao ? { permitida: false, motivo: motivoConferencia("da entrada") } : {}),
      aviso: "Use só se a cliente pagou a entrada em dinheiro ou PIX direto, ou se você conferiu no app InfinitePay que o dinheiro entrou.",
    }),
  ];
  const restante = () =>
    quitada
      ? []
      : [
          acao("registrar-restante", "Restante recebido fora do site", {
            ...(enc.restanteEmConfirmacao ? { permitida: false, motivo: motivoConferencia("do restante") } : {}),
            aviso: "Use só se a cliente pagou o restante em dinheiro ou PIX direto.",
          }),
        ];
  const cancelar = () =>
    acao("cancelar", "Cancelar encomenda", {
      aviso:
        [
          enc.entradaPagaEm || enc.restantePagoEm
            ? "O que a cliente pagou fica como devolução pendente: devolva pelo app da InfinitePay e marque aqui."
            : null,
          enc.entradaEmConfirmacao || enc.restanteEmConfirmacao ? AVISO_CANCELAR_EM_CONFERENCIA : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
    });

  switch (status) {
    case "SOLICITADA":
      lista.push(acao("aprovar", "Aprovar", { aviso: `Responda até ${formatarPrazo(enc.responderAte)}.` }), acao("recusar", "Recusar"));
      break;
    case "AGUARDANDO_ENTRADA":
      lista.push(...entrada(), cancelar());
      break;
    case "CONFIRMADA":
      lista.push(
        acao("iniciar-producao", "Iniciar produção", {
          aviso: antesDoCorte
            ? `A cliente ainda pode desistir com devolução integral até ${formatarPrazo(enc.corteEm)}.`
            : null,
        }),
        acao("marcar-pronta", "Marcar como pronta"),
        ...restante(),
        cancelar(),
      );
      break;
    case "EM_PRODUCAO":
      lista.push(acao("marcar-pronta", "Marcar como pronta"), ...restante(), cancelar());
      break;
    case "PRONTA":
      lista.push(
        acao("marcar-entregue", enc.modo === "RETIRADA" ? "Marcar como retirada" : "Marcar como entregue", {
          permitida: quitada,
          motivo: quitada ? null : "Falta o restante: a encomenda só sai quitada.",
        }),
        ...restante(),
        cancelar(),
      );
      break;
    default:
      break;
  }
  if (enc.devolucaoPendente) lista.push(acao("devolucao-feita", "Marquei como devolvida"));
  lista.push(acao("avisada", "Avisei no WhatsApp"));
  return lista;
}

// --- idempotência ---------------------------------------------------------------------------------
//
// A referência de cada cobrança (order_nsu enc-<id>-<PARCELA>-<n>) fica em src/lib/infinitepay-regras.ts
// (referenciaDaEncomenda); o telefone segue a regra dos pedidos (telefoneSchema, em src/lib/validacao.ts).

/** Os campos de um endereço, como ficam gravados (o endereço novo já passou pelo `enderecoSchema`). */
export type CamposDoEndereco = {
  cep: string;
  rua: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  estado: string;
};

export type ConteudoDaEncomenda = {
  itens: readonly SaborNoKit[];
  dataFesta: string;
  dataEntrega: string;
  modoEntrega: ModoEntrega;
  telefone: string;
  /** Texto livre da cliente (já aparado; `null` se vazio). */
  observacao: string | null;
  /** Entrega: o endereço salvo escolhido (`addressId`), se foi esse o caso. */
  addressId?: string | null;
  /** Entrega: os campos do endereço (de um endereço novo, ou os gravados na encomenda). */
  endereco?: CamposDoEndereco | null;
};

const mesmosCampos = (a: CamposDoEndereco, b: CamposDoEndereco) =>
  a.cep === b.cep &&
  a.rua === b.rua &&
  a.numero === b.numero &&
  (a.complemento ?? null) === (b.complemento ?? null) &&
  a.bairro === b.bairro &&
  a.cidade === b.cidade &&
  a.estado === b.estado;

/** Na entrega: o mesmo endereço salvo (por id) ou os mesmos campos. Na retirada não há o que comparar. */
function mesmoEndereco(a: ConteudoDaEncomenda, b: ConteudoDaEncomenda): boolean {
  if (a.modoEntrega === "RETIRADA" && b.modoEntrega === "RETIRADA") return true;
  if (a.addressId && b.addressId) return a.addressId === b.addressId;
  if (a.endereco && b.endereco) return mesmosCampos(a.endereco, b.endereco);
  return false;
}

/**
 * Idempotência: a solicitação reenviada com a mesma Idempotency-Key é a MESMA encomenda? Mesmos
 * potinhos por sabor (em qualquer ordem, linhas repetidas somadas), mesmas datas, modo, telefone,
 * observação e endereço. Qualquer diferença (a cliente corrigiu o endereço e reenviou com a mesma chave,
 * por exemplo) é outra solicitação: 422, nunca a encomenda antiga devolvida em silêncio.
 */
export function mesmaEncomenda(a: ConteudoDaEncomenda, b: ConteudoDaEncomenda): boolean {
  const mapa = (c: ConteudoDaEncomenda) => new Map(normalizarComposicao(c.itens).map((i) => [i.productId, i.quantidade]));
  const x = mapa(a);
  const y = mapa(b);
  return (
    x.size === y.size &&
    [...x].every(([k, v]) => y.get(k) === v) &&
    a.dataFesta === b.dataFesta &&
    a.dataEntrega === b.dataEntrega &&
    a.modoEntrega === b.modoEntrega &&
    a.telefone === b.telefone &&
    (a.observacao ?? null) === (b.observacao ?? null) &&
    mesmoEndereco(a, b)
  );
}

// --- schemas (entrada da API) ---------------------------------------------------------------------

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .refine(textoLivreValido, "Tem caracteres que não podem ser usados.")
    .nullish()
    .transform((v) => (v ? v : null));

const motivoSchema = z
  .string("Explique o motivo.")
  .trim()
  .min(TAMANHO_MIN_MOTIVO, `Explique o motivo (pelo menos ${TAMANHO_MIN_MOTIVO} caracteres).`)
  .max(TAMANHO_MAX_TEXTO, `Use no máximo ${TAMANHO_MAX_TEXTO} caracteres.`)
  .refine(textoLivreValido, "Tem caracteres que não podem ser usados.");

const diaSchema = (campo: string) =>
  z.string(`Informe ${campo}.`).refine(diaValido, `Data inválida (use AAAA-MM-DD).`);

const MAX_CENTAVOS = 100_000_000;

/**
 * POST /api/encomendas. Preço, peso, frete, prazos e "hoje" NÃO vêm daqui: o servidor recalcula. O
 * que a cliente viu (`totalEsperadoCentavos`, `politicaVersao` e `percentualRetido`) só serve para
 * recusar (409) se algo mudou desde a tela.
 */
export const encomendaSchema = z
  .object({
    itens: z
      .array(
        z.object({
          productId: z.string().min(1).max(100),
          quantidade: z
            .number("Informe a quantidade.")
            .int("A quantidade é um número inteiro de potinhos.")
            .min(1, "Quantidade mínima: 1 potinho.")
            .max(MAX_POTINHOS, `No máximo ${MAX_POTINHOS} potinhos.`),
        }),
      )
      .min(1, "Escolha os sabores.")
      .max(MAX_SABORES, `No máximo ${MAX_SABORES} sabores.`),
    dataFesta: diaSchema("a data da festa"),
    dataEntrega: diaSchema("a data da entrega ou retirada"),
    modoEntrega: z.enum(["RETIRADA", "ENTREGA"], "Escolha retirada na loja ou entrega."),
    addressId: z.string().min(1).max(100).optional(),
    endereco: enderecoSchema.optional(),
    telefone: telefoneSchema,
    observacao: textoOpcional(TAMANHO_MAX_TEXTO),
    aceitePolitica: z.literal(true, "Leia e aceite a política de desistência para enviar."),
    politicaVersao: z.string("Política não informada.").min(1).max(20),
    percentualRetido: z.number("Política não informada.").int().min(0).max(100),
    totalEsperadoCentavos: z.number("Informe o total que você viu.").int().min(0).max(MAX_CENTAVOS),
  })
  .superRefine((v, ctx) => {
    const temEndereco = Boolean(v.addressId) || Boolean(v.endereco);
    if (v.modoEntrega === "RETIRADA" && temEndereco) {
      ctx.addIssue({ code: "custom", path: ["endereco"], message: "Na retirada na loja não há endereço de entrega." });
    }
    if (v.modoEntrega === "ENTREGA" && !temEndereco) {
      ctx.addIssue({ code: "custom", path: ["endereco"], message: "Informe o endereço de entrega." });
    }
    if (v.addressId && v.endereco) {
      ctx.addIssue({ code: "custom", path: ["endereco"], message: "Informe um endereço salvo (addressId) ou um novo, não os dois." });
    }
  });

export type EncomendaEntrada = z.output<typeof encomendaSchema>;

/** POST /api/encomendas/[id]/desistir: a devolução que a cliente viu na tela (409 se mudou). */
export const desistenciaSchema = z.object({
  devolucaoEsperadaCentavos: z.number("Informe a devolução que você viu.").int().min(0).max(MAX_CENTAVOS),
});

const statusEsperadoSchema = z.enum(STATUS_ENCOMENDA, "Status esperado inválido.");

/** PATCH /api/admin/encomendas/[id]: uma ação por vez, sempre com o status que a tela mostrava. */
export const acaoAdminSchema = z.discriminatedUnion(
  "acao",
  [
    z.object({ acao: z.literal("aprovar"), statusEsperado: statusEsperadoSchema }),
    z.object({ acao: z.literal("recusar"), statusEsperado: statusEsperadoSchema, motivo: motivoSchema }),
    z.object({ acao: z.literal("iniciar-producao"), statusEsperado: statusEsperadoSchema }),
    z.object({ acao: z.literal("marcar-pronta"), statusEsperado: statusEsperadoSchema }),
    z.object({ acao: z.literal("marcar-entregue"), statusEsperado: statusEsperadoSchema }),
    z.object({
      acao: z.literal("registrar-entrada"),
      statusEsperado: statusEsperadoSchema,
      formaPagamento: z.enum(FORMAS_PAGAMENTO, "Escolha a forma de pagamento."),
      observacao: textoOpcional(TAMANHO_MAX_TEXTO),
    }),
    z.object({
      acao: z.literal("registrar-restante"),
      statusEsperado: statusEsperadoSchema,
      formaPagamento: z.enum(FORMAS_PAGAMENTO, "Escolha a forma de pagamento."),
      observacao: textoOpcional(TAMANHO_MAX_TEXTO),
    }),
    z.object({
      acao: z.literal("cancelar"),
      statusEsperado: statusEsperadoSchema,
      motivo: motivoSchema,
      devolverCentavos: z.number("Informe quanto devolver.").int("Valor inválido.").min(0).max(MAX_CENTAVOS),
      /** A cliente pediu (pelo WhatsApp): o mínimo a devolver é o da política, não o total. */
      aPedidoDaCliente: z.boolean().default(false),
    }),
    z.object({
      acao: z.literal("devolucao-feita"),
      statusEsperado: statusEsperadoSchema,
      /** Os ids das devoluções que a tela mostrava como pendentes (`devolucoes[].id`): só essas fecham. */
      devolucaoIds: z
        .array(z.string().min(1).max(100), "Escolha as devoluções feitas.")
        .min(1, "Escolha as devoluções feitas.")
        .max(50, "Devoluções demais de uma vez.")
        .transform((ids) => [...new Set(ids)]),
      observacao: textoOpcional(TAMANHO_MAX_TEXTO),
    }),
    z.object({ acao: z.literal("avisada"), statusEsperado: statusEsperadoSchema, status: statusEsperadoSchema }),
  ],
  "Ação inválida.",
);

export type AcaoAdminEntrada = z.output<typeof acaoAdminSchema>;

/** Número vindo do JSON como número ou como texto ("600"); booleano e null não viram número. */
const numeroDoCampo = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v), schema);

/** PATCH /api/admin/lembrancinhas: edição completa (o preço viaja em centavos inteiros). */
export const configLembrancinhasSchema = z.object({
  precoPotinhoCentavos: numeroDoCampo(
    z
      .number("Informe o preço do potinho.")
      .int("Preço inválido.")
      .min(1, "Informe o preço do potinho.")
      .max(MAX_PRECO_UNITARIO_CENTAVOS, `Preço máximo: ${formatarBRL(MAX_PRECO_UNITARIO_CENTAVOS / 100)}.`),
  ),
  pesoPotinhoGramas: numeroDoCampo(
    z.number("Informe o peso do potinho cheio.").int("Peso em gramas inteiros.").min(1, "Informe o peso.").max(1000, "Peso máximo: 1000 g."),
  ),
  pesoEmbalagemGramas: numeroDoCampo(
    z.number("Informe o peso da embalagem.").int("Peso em gramas inteiros.").min(0, "O peso não pode ser negativo.").max(5000, "Peso máximo: 5000 g."),
  ),
  percentualRetido: numeroDoCampo(
    z.number("Informe o percentual retido.").int("Use um número inteiro.").min(0, "Mínimo: 0%.").max(100, "Máximo: 100%."),
  ),
  ativo: z.boolean("Diga se as lembrancinhas estão abertas."),
});

export type ConfigLembrancinhasEntrada = z.output<typeof configLembrancinhasSchema>;

/** Só abrir/fechar (o mesmo PATCH, com o corpo `{ ativo }`). */
export const configAtivoSchema = z.object({ ativo: z.boolean("Diga se as lembrancinhas estão abertas.") });

// --- agenda, linha do tempo e WhatsApp ------------------------------------------------------------

export type EncomendaNaAgenda = {
  id: string;
  dataEntrega: string;
  status: StatusEncomenda;
  itens: readonly { productId: string; sabor: string; quantidade: number }[];
};

export type DiaDaAgenda = {
  dia: string;
  /** Encomendas com a entrada paga (confirmadas, em produção, prontas ou entregues). */
  encomendas: number;
  potinhos: number;
  /** Potinhos a produzir por sabor, do que tem mais para o que tem menos. */
  porSabor: { productId: string; sabor: string; potinhos: number }[];
  /** Aprovadas que ainda esperam a entrada (podem não se confirmar): à parte. */
  aguardandoEntrada: number;
  potinhosAguardando: number;
  ids: string[];
};

/** Agenda por dia de entrega ou retirada: potinhos por sabor para planejar a produção. */
export function agendaPorDia(encomendas: readonly EncomendaNaAgenda[]): DiaDaAgenda[] {
  const dias = new Map<string, DiaDaAgenda & { sabores: Map<string, { productId: string; sabor: string; potinhos: number }> }>();
  for (const e of encomendas) {
    const confirmada = statusConfirmado(e.status) || e.status === "ENTREGUE";
    const aguardando = e.status === "AGUARDANDO_ENTRADA";
    if (!confirmada && !aguardando) continue;
    let dia = dias.get(e.dataEntrega);
    if (!dia) {
      dia = { dia: e.dataEntrega, encomendas: 0, potinhos: 0, porSabor: [], aguardandoEntrada: 0, potinhosAguardando: 0, ids: [], sabores: new Map() };
      dias.set(e.dataEntrega, dia);
    }
    dia.ids.push(e.id);
    const potinhos = e.itens.reduce((soma, i) => soma + i.quantidade, 0);
    if (aguardando) {
      dia.aguardandoEntrada += 1;
      dia.potinhosAguardando += potinhos;
      continue;
    }
    dia.encomendas += 1;
    dia.potinhos += potinhos;
    for (const i of e.itens) {
      const s = dia.sabores.get(i.productId) ?? { productId: i.productId, sabor: i.sabor, potinhos: 0 };
      s.potinhos += i.quantidade;
      dia.sabores.set(i.productId, s);
    }
  }
  return [...dias.values()]
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
    .map(({ sabores, ...dia }) => ({
      ...dia,
      porSabor: [...sabores.values()].sort((a, b) => b.potinhos - a.potinhos || a.sabor.localeCompare(b.sabor, "pt-BR")),
    }));
}

export type FatosDaLinhaDoTempo = {
  status: StatusEncomenda;
  modo: ModoEntrega;
  criadaEm: Date;
  aprovadaEm: Date | null;
  entradaAte: Date | null;
  entradaPagaEm: Date | null;
  /** Entrada registrada pela dona (fora do site, ou conferida no app InfinitePay). */
  entradaForaDoSite: boolean;
  producaoIniciadaEm: Date | null;
  prontaEm: Date | null;
  restantePagoEm: Date | null;
  restanteForaDoSite: boolean;
  entregueEm: Date | null;
  encerradaEm: Date | null;
  motivoRecusa: string | null;
  canceladaPor: Ator | null;
  devolucoes: readonly { valorCentavos: number; criadaEm: Date; feitaEm: Date | null }[];
};

/** Linha do tempo da encomenda (comprovante da cliente e ficha do painel), da mais antiga à mais nova. */
export function linhaDoTempo(f: FatosDaLinhaDoTempo): { quando: string; texto: string }[] {
  const palavra = palavraDoModo(f.modo);
  const eventos: { quando: Date; texto: string }[] = [{ quando: f.criadaEm, texto: "Solicitação enviada." }];
  const marcar = (quando: Date | null, texto: string) => {
    if (quando) eventos.push({ quando, texto });
  };
  marcar(f.aprovadaEm, f.entradaAte ? `A Geleiô aprovou. Entrada a pagar até ${formatarPrazo(f.entradaAte)}.` : "A Geleiô aprovou.");
  marcar(f.entradaPagaEm, f.entradaForaDoSite ? "Entrada recebida pela Geleiô (fora do site): encomenda confirmada." : "Entrada paga: encomenda confirmada.");
  marcar(f.producaoIniciadaEm, "Produção iniciada.");
  marcar(f.prontaEm, `Pronta para a ${palavra}.`);
  marcar(f.restantePagoEm, f.restanteForaDoSite ? "Restante recebido pela Geleiô (fora do site)." : "Restante pago: encomenda quitada.");
  marcar(f.entregueEm, f.modo === "RETIRADA" ? "Retirada na loja." : "Entregue.");
  if (f.encerradaEm) {
    const texto =
      f.status === "RECUSADA"
        ? `A Geleiô recusou${f.motivoRecusa ? `: ${f.motivoRecusa}` : "."}`
        : f.status === "EXPIRADA"
          ? f.aprovadaEm
            ? "Expirou: a entrada não foi paga no prazo."
            : "Expirou: a Geleiô não respondeu no prazo. Nada foi cobrado."
          : f.canceladaPor === "CLIENTE"
            ? "Você desistiu da encomenda."
            : "A Geleiô cancelou a encomenda.";
    eventos.push({ quando: f.encerradaEm, texto });
  }
  for (const d of f.devolucoes) {
    eventos.push({ quando: d.criadaEm, texto: `Devolução de ${formatarBRL(d.valorCentavos / 100)} a fazer.` });
    marcar(d.feitaEm, `Devolução de ${formatarBRL(d.valorCentavos / 100)} feita.`);
  }
  return eventos
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.quando.getTime() - b.quando.getTime() || a.i - b.i)
    .map((e) => ({ quando: e.quando.toISOString(), texto: e.texto }));
}

export type DadosDaMensagem = {
  nome: string;
  codigo: string;
  potinhos: number;
  dataFesta: string;
  dataEntrega: string;
  modo: ModoEntrega;
  entradaCentavos: number;
  restanteCentavos: number;
  entradaAte: Date | null;
  motivo: string | null;
  /** Página da encomenda no site (com APP_URL); sem ela, a mensagem não leva link. */
  link: string | null;
  devolucaoCentavos: number;
};

/**
 * O primeiro nome da conta para o texto do WhatsApp. O nome é digitado pela cliente e a mensagem sai da
 * conta da dona: só LETRAS (sem links, números, símbolos nem caracteres de controle), no máximo 30. Sem
 * nenhuma letra, a saudação genérica.
 */
export function primeiroNomeSeguro(nome: string): string {
  for (const pedaco of nome.trim().split(/\s+/)) {
    const letras = pedaco.replace(/[^\p{L}]/gu, "");
    if (letras) return letras.slice(0, 30);
  }
  return "tudo bem";
}

/** Texto pronto para a dona mandar pelo WhatsApp (link "Avisar no WhatsApp" do painel). */
export function mensagemWhatsApp(status: StatusEncomenda, d: DadosDaMensagem): string {
  const primeiroNome = primeiroNomeSeguro(d.nome);
  const ola = `Oi, ${primeiroNome}! Aqui é da Geleiô.`;
  const qual = `Sua encomenda ${d.codigo} (${d.potinhos} potinhos, festa em ${formatarDia(d.dataFesta)})`;
  const palavra = palavraDoModo(d.modo);
  const veja = d.link ? ` Acompanhe por aqui: ${d.link}` : "";
  const brl = (c: number) => formatarBRL(c / 100);
  switch (status) {
    case "SOLICITADA":
      return `${ola} Recebemos ${qual.replace("Sua encomenda", "a sua solicitação")} e já vamos responder.${veja}`;
    case "AGUARDANDO_ENTRADA":
      return `${ola} ${qual} foi aprovada! Para confirmar, pague a entrada de ${brl(d.entradaCentavos)} pelo site${d.entradaAte ? ` até ${formatarPrazo(d.entradaAte)}` : ""}.${veja}`;
    case "CONFIRMADA":
      return `${ola} Recebemos a entrada: ${qual.charAt(0).toLowerCase()}${qual.slice(1)} está confirmada. Vamos combinar o horário da ${palavra} em ${formatarDia(d.dataEntrega)}?${veja}`;
    case "EM_PRODUCAO":
      return `${ola} ${qual} já está em produção.${veja}`;
    case "PRONTA":
      return `${ola} ${qual} está pronta para a ${palavra} em ${formatarDia(d.dataEntrega)}.${d.restanteCentavos > 0 ? ` Falta o restante de ${brl(d.restanteCentavos)}.` : ""}${veja}`;
    case "ENTREGUE":
      return `${ola} Obrigada pela encomenda! Esperamos que a festa seja linda.`;
    case "RECUSADA":
      return `${ola} Infelizmente não conseguimos fazer ${qual.charAt(0).toLowerCase()}${qual.slice(1)}${d.motivo ? `: ${d.motivo}` : "."} Nada foi cobrado.`;
    case "EXPIRADA":
      return `${ola} ${qual} expirou sem confirmação, e nada foi cobrado. Se ainda quiser, é só fazer uma nova solicitação.${veja}`;
    case "CANCELADA":
      return `${ola} ${qual} foi cancelada.${d.devolucaoCentavos > 0 ? ` Vamos devolver ${brl(d.devolucaoCentavos)}, pelo mesmo meio do pagamento, em até 2 dias úteis.` : ""}${veja}`;
  }
}

/** Link "Avisar no WhatsApp": wa.me com o número brasileiro e o texto codificado. */
export function linkWhatsApp(telefone: string, texto: string): string {
  return `https://wa.me/55${telefone.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}
