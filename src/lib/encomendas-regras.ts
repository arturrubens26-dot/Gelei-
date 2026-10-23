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
import { normalizarComposicao, type SaborNoKit } from "@/lib/kits-regras";
import { enderecoSchema } from "@/lib/validacao";
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
export type ModoEntrega = "RETIRADA" | "ENTREGA";
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
/** Validade do PIX: o Mercado Pago exige no mínimo 30 minutos; a loja usa no máximo 1 hora. */
export const PIX_MIN_MS = 30 * 60_000;
export const PIX_MAX_MS = 60 * 60_000;
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

/**
 * Vencimento de um PIX novo: 1 hora, sem passar do `limite` (o prazo da entrada), mas nunca menos de
 * 30 minutos (o mínimo do Mercado Pago). Sem limite (o restante), 1 hora. `null` se o limite já passou:
 * não se abre PIX para um prazo vencido.
 */
export function validadeDoPix(agora: Date, limite: Date | null): Date | null {
  const t = agora.getTime();
  if (limite === null) return new Date(t + PIX_MAX_MS);
  if (t >= limite.getTime()) return null;
  return new Date(Math.max(t + PIX_MIN_MS, Math.min(t + PIX_MAX_MS, limite.getTime())));
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
    // Paga por um PIX que ainda valia: confirma mesmo depois de `entradaAte`.
    { para: "CONFIRMADA", atores: ["SISTEMA"] },
    { para: "EXPIRADA", atores: ["SISTEMA"], condicao: depoisDe((f) => f.entradaAte) },
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
  /** Vencimento do PIX da ENTRADA ainda aberto mais longo (null = nenhum aberto). */
  pixEntradaValidoAte: Date | null;
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
 * - AGUARDANDO_ENTRADA depois de `entradaAte` → EXPIRADA, a menos que ainda haja um PIX da entrada
 *   valendo (pode ser pago até o vencimento dele).
 */
export function statusEfetivo(
  enc: Pick<EncomendaParaRegras, "status" | "responderAte" | "entradaAte" | "pixEntradaValidoAte">,
  agora: Date,
): StatusEncomenda {
  const t = agora.getTime();
  if (enc.status === "SOLICITADA" && t >= enc.responderAte.getTime()) return "EXPIRADA";
  if (enc.status === "AGUARDANDO_ENTRADA" && enc.entradaAte && t >= enc.entradaAte.getTime()) {
    const pixValendo = enc.pixEntradaValidoAte !== null && enc.pixEntradaValidoAte.getTime() > t;
    return pixValendo ? "AGUARDANDO_ENTRADA" : "EXPIRADA";
  }
  return enc.status;
}

const pagoEmCentavos = (enc: EncomendaParaRegras) => ({
  entradaPaga: enc.entradaPagaEm ? enc.valorEntradaCentavos : 0,
  restantePago: enc.restantePagoEm ? enc.valorRestanteCentavos : 0,
});

export type AcoesDaCliente = {
  /** Pode gerar (ou pedir de novo) o PIX da entrada. */
  pagarEntrada: boolean;
  /** Pode gerar o PIX do restante (de CONFIRMADA até antes da entrega, se ainda não quitada). */
  pagarRestante: boolean;
  /** Prévia da desistência agora (centavos), ou `null` se não dá para desistir. */
  desistir: { devolucao: number; retido: number } | null;
};

export function acoesDaCliente(enc: EncomendaParaRegras, agora: Date): AcoesDaCliente {
  const status = statusEfetivo(enc, agora);
  const aberta = (STATUS_ABERTOS as readonly StatusEncomenda[]).includes(status);
  return {
    pagarEntrada: status === "AGUARDANDO_ENTRADA" && enc.entradaAte !== null && agora.getTime() < enc.entradaAte.getTime(),
    pagarRestante: statusConfirmado(status) && enc.restantePagoEm === null,
    desistir: aberta
      ? devolucaoNaDesistencia({ agora, corteEm: enc.corteEm, ...pagoEmCentavos(enc), quem: "CLIENTE", percentualRetido: enc.percentualRetido })
      : null,
  };
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

/**
 * Botões da ficha no painel, conforme o status efetivo. "Avisar no WhatsApp" (`avisada`) aparece
 * sempre; "Marquei como devolvida", só com devolução pendente.
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
  const restante = () =>
    quitada ? [] : [acao("registrar-restante", "Restante recebido fora do site", { aviso: "Use só se a cliente pagou o restante em dinheiro ou PIX direto." })];
  const cancelar = () =>
    acao("cancelar", "Cancelar encomenda", {
      aviso:
        enc.entradaPagaEm || enc.restantePagoEm
          ? "O que a cliente pagou fica como devolução pendente: devolva pelo app do Mercado Pago e marque aqui."
          : null,
    });

  switch (status) {
    case "SOLICITADA":
      lista.push(acao("aprovar", "Aprovar", { aviso: `Responda até ${formatarPrazo(enc.responderAte)}.` }), acao("recusar", "Recusar"));
      break;
    case "AGUARDANDO_ENTRADA":
      lista.push(cancelar());
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

// --- referências, telefone e idempotência ---------------------------------------------------------

/**
 * `external_reference` da cobrança no Mercado Pago. Cada parcela tem a sua: um PIX do RESTANTE com o
 * mesmo valor da ENTRADA não quita a entrada (a conferência compara a referência inteira).
 */
export function referenciaDaParcela(encomendaId: string, parcela: Parcela): string {
  return `enc-${encomendaId}-${parcela}`;
}

/** O inverso, para logs e conferência: "enc-<id>-ENTRADA" → { encomendaId, parcela }. */
export function lerReferenciaDaParcela(referencia: string | null | undefined): { encomendaId: string; parcela: Parcela } | null {
  const m = /^enc-([A-Za-z0-9_-]{1,100})-(ENTRADA|RESTANTE)$/.exec(referencia ?? "");
  return m ? { encomendaId: m[1], parcela: m[2] as Parcela } : null;
}

/**
 * "(86) 99999-1234" → "86999991234". Aceita fixo (DDD + 8) e celular (DDD + 9 + 8), com ou sem "+55"
 * escrito; DDD não começa nem termina com 0. Devolve `null` se não for um telefone brasileiro.
 */
export function normalizarTelefone(texto: string): string | null {
  const semPais = texto.trim().replace(/^\+\s*55/, "");
  if (/[^\d\s().-]/.test(semPais)) return null;
  const digitos = semPais.replace(/\D/g, "");
  if (/^[1-9][1-9][2-9]\d{7}$/.test(digitos)) return digitos;
  if (/^[1-9][1-9]9\d{8}$/.test(digitos)) return digitos;
  return null;
}

const MSG_TELEFONE = "Informe um telefone com DDD, como (86) 99999-1234.";

export const telefoneSchema = z
  .string(MSG_TELEFONE)
  .max(30, MSG_TELEFONE)
  .transform((valor, ctx) => {
    const telefone = normalizarTelefone(valor);
    if (!telefone) {
      ctx.addIssue({ code: "custom", message: MSG_TELEFONE });
      return z.NEVER;
    }
    return telefone;
  });

export type ConteudoDaEncomenda = {
  itens: readonly SaborNoKit[];
  dataFesta: string;
  dataEntrega: string;
  modoEntrega: ModoEntrega;
  telefone: string;
};

/**
 * Idempotência: a solicitação reenviada com a mesma Idempotency-Key é a MESMA encomenda? Mesmos
 * potinhos por sabor (em qualquer ordem, linhas repetidas somadas), mesmas datas, modo e telefone.
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
    a.telefone === b.telefone
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
    z.object({ acao: z.literal("devolucao-feita"), statusEsperado: statusEsperadoSchema, observacao: textoOpcional(TAMANHO_MAX_TEXTO) }),
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
  marcar(f.entradaPagaEm, "Entrada paga: encomenda confirmada.");
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

/** Texto pronto para a dona mandar pelo WhatsApp (link "Avisar no WhatsApp" do painel). */
export function mensagemWhatsApp(status: StatusEncomenda, d: DadosDaMensagem): string {
  const primeiroNome = d.nome.trim().split(/\s+/)[0] || "tudo bem";
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
      return `${ola} ${qual} foi cancelada.${d.devolucaoCentavos > 0 ? ` Vamos devolver ${brl(d.devolucaoCentavos)} por PIX em até 2 dias úteis.` : ""}${veja}`;
  }
}

/** Link "Avisar no WhatsApp": wa.me com o número brasileiro e o texto codificado. */
export function linkWhatsApp(telefone: string, texto: string): string {
  return `https://wa.me/55${telefone.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}
