import "server-only";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { dadosLoja } from "@/lib/dados-loja";
import { db } from "@/lib/db";
import { hojeNaLoja } from "@/lib/despesas";
import { AVISO_JURIDICO } from "@/lib/encomendas-politica";
import {
  abrirDevolucoesDeDivergencias,
  cobrancaEmConferencia,
  encerrarCobrancasDaEncomenda,
  marcarDevolucoesFeitas,
} from "@/lib/encomendas-pagamentos";
import {
  AVISO_CANCELAR_EM_CONFERENCIA,
  ROTULO_STATUS_ENCOMENDA,
  STATUS_CONFIRMADOS,
  acoesDaLoja,
  agendaPorDia,
  alertaDaEncomenda,
  avisoParadoHaMaisDe30Min,
  conferenciaAte,
  entradaEmFolgaAgora,
  faixaDaDevolucaoNoCancelamento,
  linkWhatsApp,
  mensagemWhatsApp,
  pagamentoDivergenteAberto,
  prazoDaEntrada,
  statusEfetivo,
  transicaoPermitida,
  valoresDoCancelamento,
  type AcaoAdminEntrada,
  type AcaoDaLoja,
  type AlertaEncomenda,
  type Ator,
  type ConfigLembrancinhasEntrada,
  type DiaDaAgenda,
  type ModoEntrega,
  type MotivoTransicaoRecusada,
  type Parcela,
  type StatusEncomenda,
} from "@/lib/encomendas-regras";
import {
  enderecoDe,
  expirarVencidas,
  incluirEncomenda,
  itensDe,
  linhaDoTempoDe,
  paraRegras,
  resumoDaDevolucao,
  textosDaPoliticaDe,
  type DevolucaoResumoDTO,
  type EncomendaCompleta,
  type EnderecoDTO,
} from "@/lib/encomendas";
import { ErroNegocio } from "@/lib/erros";
import { codigoPedido } from "@/lib/formatacao";
import { origemPublica } from "@/lib/infinitepay";
import { ID_CONFIG_LEMBRANCINHAS, lerConfigLembrancinhas, pendenciasParaAbrir } from "@/lib/lembrancinhas";
import { pagamentoOnlineDisponivel } from "@/lib/pagamentos";
import { cobrancaDivergente, rotuloDoMetodo, type MetodoPagamento } from "@/lib/pagamentos-regras";
import { separarNome } from "@/lib/produtos-regras";
import { somarDias, type FormaPagamento } from "@/lib/vendas";

/**
 * Encomendas de lembrancinhas no painel (admin): listas por aba, agenda de produção, ficha com as
 * ações da dona, e a configuração (preço, pesos, percentual retido, abrir/fechar). Toda ação usa
 * `statusEsperado` e UPDATE condicional: se a encomenda mudou desde a tela (pagamento, expiração,
 * desistência), responde 409 com o status atual e nada muda.
 *
 * Dinheiro sai em reais nos DTOs (e em centavos onde a tela precisa mandar de volta).
 */

// --- DTOs -----------------------------------------------------------------------------------------

/** Uma linha das listas do painel. */
export type EncomendaAdminDTO = {
  id: string;
  /** "#9F3K2XQP" */
  codigo: string;
  status: StatusEncomenda;
  /** Use este: os prazos vencidos já aplicados. */
  statusEfetivo: StatusEncomenda;
  rotulo: string;
  criadaEm: string;
  /** "AAAA-MM-DD" */
  dataFesta: string;
  dataEntrega: string;
  modoEntrega: ModoEntrega;
  cliente: { nome: string };
  potinhos: number;
  /** Reais. */
  total: number;
  entrada: number;
  restante: number;
  /** ISO. */
  prazos: { responderAte: string; entradaAte: string | null; corteEm: string };
  entradaPagaEm: string | null;
  restantePagoEm: string | null;
  restanteForaDoSite: boolean;
  /** Entrada registrada pela dona (fora do site, ou conferida no app InfinitePay). */
  entradaForaDoSite: boolean;
  /** A entrada passou de `prazos.entradaAte` e ainda está nos 30 min de folga (ainda pode confirmar). */
  entradaEmFolga: boolean;
  /** Pagamento em conferência por parcela (aviso, retorno ou divergência; no máximo 24 h). */
  pagamentoEmConferencia: { entrada: boolean; restante: boolean };
  devolucao: DevolucaoResumoDTO;
  alerta: AlertaEncomenda | null;
  /** Último status avisado à cliente pelo WhatsApp (botão "Avisei no WhatsApp"). */
  avisadaStatus: StatusEncomenda | null;
  avisadaEm: string | null;
};

/** Uma cobrança (link da InfinitePay) da encomenda, na ficha. */
export type PagamentoDaEncomendaDTO = {
  id: string;
  parcela: Parcela;
  /** "infinitepay" | "simulado". */
  gateway: string;
  /** order_nsu (enc-<id>-<PARCELA>-<n>): é por ele que a dona acha a venda no app InfinitePay. */
  referencia: string;
  status: "PENDENTE" | "APROVADO" | "CANCELADO" | "RECUSADO" | "ESTORNADO";
  /** Reais: o valor da parcela. */
  valor: number;
  /** Reais, com os juros do parcelado (só aprovada). */
  valorPago: number | null;
  metodo: MetodoPagamento | null;
  parcelas: number | null;
  /** "PIX", "Cartão em 3x"… */
  rotuloMetodo: string | null;
  criadoEm: string;
  expiraEm: string;
  aprovadoEm: string | null;
  /** Aviso/retorno ainda sendo conferido, ou pago com divergência, e dentro do limite de 24 h. */
  emConferencia: boolean;
  /** Até quando esta cobrança segura a encomenda (ISO); null se não está segurando. */
  conferenciaAte: string | null;
  divergente: boolean;
};

export type DevolucaoDaEncomendaDTO = {
  id: string;
  motivo: "DESISTENCIA" | "CANCELAMENTO" | "PAGAMENTO_TARDIO" | "PAGAMENTO_DUPLICADO";
  /** Reais. */
  valor: number;
  status: "PENDENTE" | "FEITA";
  criadaEm: string;
  feitaEm: string | null;
  observacao: string | null;
  /** A cobrança que originou (pago tarde ou em dobro); null na desistência e no cancelamento. */
  pagamentoId: string | null;
};

/** Ficha da encomenda (/admin/encomendas/[id]). */
export type EncomendaAdminDetalheDTO = Omit<EncomendaAdminDTO, "cliente"> & {
  cliente: { id: string; nome: string; email: string };
  /** Só dígitos, com DDD (formatarTelefone para mostrar). */
  telefone: string;
  observacao: string | null;
  endereco: EnderecoDTO | null;
  retirada: (typeof dadosLoja)["endereco"] | null;
  itens: { productId: string; sabor: string; quantidade: number; precoUnitario: number; subtotal: number; imagemUrl: string }[];
  subtotal: number;
  frete: number;
  pesoTotalGramas: number;
  aprovadaEm: string | null;
  producaoIniciadaEm: string | null;
  prontaEm: string | null;
  entregueEm: string | null;
  encerradaEm: string | null;
  motivoRecusa: string | null;
  motivoCancelamento: string | null;
  canceladaPor: Ator | null;
  /** Restante registrado fora do site (D8): forma, observação e quem registrou. */
  restanteForma: FormaPagamento | null;
  restanteObservacao: string | null;
  restanteRegistradoPor: string | null;
  /** Entrada registrada pela dona (`registrar-entrada`): forma, observação e quem registrou. */
  entradaForma: FormaPagamento | null;
  entradaObservacao: string | null;
  entradaRegistradaPor: string | null;
  /** `textos`: a política que a cliente aceitou (`percentualAceito`); `percentualRetido` é o que vale de fato. */
  politica: { versao: string; aceitaEm: string; percentualAceito: number; percentualRetido: number; textos: string[] };
  linhaDoTempo: { quando: string; texto: string }[];
  pagamentos: PagamentoDaEncomendaDTO[];
  devolucoes: DevolucaoDaEncomendaDTO[];
  /** Botões da ficha (permitida=false: desabilitado, com `motivo`; `aviso` não bloqueia). */
  acoes: AcaoDaLoja[];
  /**
   * Para o "Cancelar encomenda" (centavos): quanto já foi pago e a faixa da devolução. `pelaLoja`: a
   * loja cancela (devolve tudo). `aPedidoDaCliente`: a cliente pediu pelo WhatsApp (regra do corte).
   */
  cancelamento: {
    totalPagoCentavos: number;
    pelaLoja: { minimoCentavos: number; maximoCentavos: number };
    aPedidoDaCliente: { minimoCentavos: number; maximoCentavos: number };
  };
  /** "Avisar no WhatsApp": texto pronto do status atual e o link wa.me. */
  whatsapp: { texto: string; link: string };
  /** Agenda de produção de E−3 a E+3 (E = dia da entrega ou retirada). */
  agendaProxima: DiaDaAgenda[];
};

const centavos = (valor: Prisma.Decimal) => valor.mul(100).toNumber();
const reaisDe = (c: number) => new Prisma.Decimal(c).div(100);
const diaDe = (d: Date) => d.toISOString().slice(0, 10);
const dateDoDia = (dia: string) => new Date(`${dia}T00:00:00Z`);

const incluirAdmin = {
  ...incluirEncomenda,
  user: { select: { id: true, nome: true, email: true } },
  restanteRegistradoPor: { select: { nome: true } },
  entradaRegistradaPor: { select: { nome: true } },
} satisfies Prisma.EncomendaInclude;

type EncomendaAdminCompleta = Prisma.EncomendaGetPayload<{ include: typeof incluirAdmin }>;

function alertaDe(e: EncomendaCompleta, agora: Date): AlertaEncomenda | null {
  return alertaDaEncomenda({
    devolucaoPendente: e.devolucoes.some((d) => d.status === "PENDENTE"),
    // A divergência segue visível até a dona decidir: com a encomenda cancelada, expirada ou a parcela registrada
    // por fora, a ação abre uma devolução (ver `pagamentoDivergenteAberto`) e o alerta passa a ser ela.
    pagamentoDivergente: pagamentoDivergenteAberto(e),
    // Sem o "não pago" da última conferência (como nos pedidos): é uma resposta, não conferência parada.
    avisoParadoHaMaisDe30Min: avisoParadoHaMaisDe30Min(e.pagamentos, agora),
  });
}

function paraAdminDTO(e: EncomendaCompleta & { user: { nome: string } }, agora: Date): EncomendaAdminDTO {
  const regras = paraRegras(e, agora);
  const efetivo = statusEfetivo(regras, agora);
  return {
    id: e.id,
    codigo: codigoPedido(e.id),
    status: e.status,
    statusEfetivo: efetivo,
    rotulo: ROTULO_STATUS_ENCOMENDA[efetivo],
    criadaEm: e.criadaEm.toISOString(),
    dataFesta: diaDe(e.dataFesta),
    dataEntrega: diaDe(e.dataEntrega),
    modoEntrega: e.modoEntrega,
    cliente: { nome: e.user.nome },
    potinhos: e.potinhos,
    total: e.total.toNumber(),
    entrada: e.valorEntrada.toNumber(),
    restante: e.valorRestante.toNumber(),
    prazos: { responderAte: e.responderAte.toISOString(), entradaAte: e.entradaAte?.toISOString() ?? null, corteEm: e.corteEm.toISOString() },
    entradaPagaEm: e.entradaPagaEm?.toISOString() ?? null,
    restantePagoEm: e.restantePagoEm?.toISOString() ?? null,
    restanteForaDoSite: e.restanteForaDoSite,
    entradaForaDoSite: e.entradaForaDoSite,
    entradaEmFolga: entradaEmFolgaAgora(efetivo, e.entradaAte, agora),
    pagamentoEmConferencia: { entrada: Boolean(regras.entradaEmConfirmacao), restante: Boolean(regras.restanteEmConfirmacao) },
    devolucao: resumoDaDevolucao(e),
    alerta: alertaDe(e, agora),
    avisadaStatus: e.avisadaStatus,
    avisadaEm: e.avisadaEm?.toISOString() ?? null,
  };
}

const metodoDe = (v: string | null): MetodoPagamento | null => (v === "pix" || v === "credit_card" ? v : null);

/** Página da encomenda no site, para a mensagem do WhatsApp (sem APP_URL, a mensagem vai sem link). */
function linkDaEncomenda(id: string): string | null {
  const origem = origemPublica();
  return origem ? `${origem}/minhas-encomendas/${id}` : null;
}

async function paraDetalheDTO(e: EncomendaAdminCompleta, agora: Date): Promise<EncomendaAdminDetalheDTO> {
  const regras = paraRegras(e, agora);
  const efetivo = statusEfetivo(regras, agora);
  const resumo = resumoDaDevolucao(e);
  const t = agora.getTime();
  const pelaLoja = faixaDaDevolucaoNoCancelamento(regras, agora, false);
  const aPedido = faixaDaDevolucaoNoCancelamento(regras, agora, true);
  const texto = mensagemWhatsApp(efetivo, {
    nome: e.user.nome,
    codigo: codigoPedido(e.id),
    potinhos: e.potinhos,
    dataFesta: diaDe(e.dataFesta),
    dataEntrega: diaDe(e.dataEntrega),
    modo: e.modoEntrega,
    entradaCentavos: centavos(e.valorEntrada),
    restanteCentavos: e.restantePagoEm ? 0 : centavos(e.valorRestante),
    entradaAte: e.entradaAte,
    motivo: e.motivoRecusa ?? e.motivoCancelamento,
    link: linkDaEncomenda(e.id),
    devolucaoCentavos: Math.round((resumo.pendente + resumo.devolvido) * 100),
  });
  const dataEntrega = diaDe(e.dataEntrega);
  return {
    ...paraAdminDTO(e, agora),
    cliente: { id: e.user.id, nome: e.user.nome, email: e.user.email },
    telefone: e.telefone,
    observacao: e.observacao,
    endereco: enderecoDe(e),
    retirada: e.modoEntrega === "RETIRADA" ? dadosLoja.endereco : null,
    itens: itensDe(e),
    subtotal: e.subtotal.toNumber(),
    frete: e.frete.toNumber(),
    pesoTotalGramas: e.pesoTotalGramas,
    aprovadaEm: e.aprovadaEm?.toISOString() ?? null,
    producaoIniciadaEm: e.producaoIniciadaEm?.toISOString() ?? null,
    prontaEm: e.prontaEm?.toISOString() ?? null,
    entregueEm: e.entregueEm?.toISOString() ?? null,
    encerradaEm: e.encerradaEm?.toISOString() ?? null,
    motivoRecusa: e.motivoRecusa,
    motivoCancelamento: e.motivoCancelamento,
    canceladaPor: e.canceladaPor,
    restanteForma: e.restanteForaDoSite ? e.restanteForma : null,
    restanteObservacao: e.restanteObservacao,
    restanteRegistradoPor: e.restanteRegistradoPor?.nome ?? null,
    entradaForma: e.entradaForaDoSite ? e.entradaForma : null,
    entradaObservacao: e.entradaObservacao,
    entradaRegistradaPor: e.entradaRegistradaPor?.nome ?? null,
    politica: {
      versao: e.politicaVersao,
      aceitaEm: e.politicaAceitaEm.toISOString(),
      percentualAceito: e.percentualAceito,
      percentualRetido: e.percentualRetido,
      textos: textosDaPoliticaDe(e),
    },
    linhaDoTempo: linhaDoTempoDe(e),
    pagamentos: e.pagamentos.map((p) => {
      const aprovada = p.status === "APROVADO" || p.status === "ESTORNADO";
      const metodo = aprovada ? metodoDe(p.metodo) : null;
      return {
        id: p.id,
        parcela: p.parcela!,
        gateway: p.gateway,
        referencia: p.referenciaExterna,
        status: p.status,
        valor: p.valor.toNumber(),
        valorPago: aprovada && p.valorPago ? p.valorPago.toNumber() : null,
        metodo,
        parcelas: aprovada ? p.parcelas : null,
        rotuloMetodo: rotuloDoMetodo(metodo, aprovada ? p.parcelas : null),
        criadoEm: p.criadoEm.toISOString(),
        expiraEm: p.expiraEm.toISOString(),
        aprovadoEm: p.aprovadoEm?.toISOString() ?? null,
        emConferencia: cobrancaEmConferencia(p, t),
        conferenciaAte: conferenciaAte(p, t)?.toISOString() ?? null,
        divergente: cobrancaDivergente(p),
      };
    }),
    devolucoes: e.devolucoes.map((d) => ({
      id: d.id,
      motivo: d.motivo,
      valor: d.valor.toNumber(),
      status: d.status,
      criadaEm: d.criadaEm.toISOString(),
      feitaEm: d.feitaEm?.toISOString() ?? null,
      observacao: d.observacao,
      pagamentoId: d.pagamentoId,
    })),
    acoes: acoesDaLoja({ ...regras, devolucaoPendente: resumo.status === "PENDENTE", modo: e.modoEntrega }, agora),
    cancelamento: {
      totalPagoCentavos: valoresDoCancelamento(regras, agora).totalPago,
      pelaLoja: { minimoCentavos: pelaLoja.minimo, maximoCentavos: pelaLoja.maximo },
      aPedidoDaCliente: { minimoCentavos: aPedido.minimo, maximoCentavos: aPedido.maximo },
    },
    whatsapp: { texto, link: linkWhatsApp(e.telefone, texto) },
    agendaProxima: await agendaEntre(somarDias(dataEntrega, -3), somarDias(dataEntrega, 3)),
  };
}

// --- listas e agenda ------------------------------------------------------------------------------

export const VISOES_ENCOMENDAS = ["responder", "agenda", "aguardando-entrada", "devolucoes", "historico"] as const;
export type VisaoEncomendas = (typeof VISOES_ENCOMENDAS)[number];

const POR_PAGINA = 20;
/** A agenda cobre no máximo 62 dias por consulta. */
export const MAX_DIAS_AGENDA = 62;

export type ListaEncomendasAdminDTO = {
  visao: VisaoEncomendas;
  encomendas: EncomendaAdminDTO[];
  /** Só na visão "agenda": potinhos por dia e por sabor, de `de` a `ate`. */
  agenda?: DiaDaAgenda[];
  /** Na agenda: o período usado ("AAAA-MM-DD"). */
  de?: string;
  ate?: string;
  total: number;
  pagina: number;
  porPagina: number;
  /** Contagens para os selos das abas. */
  contagens: { responder: number; aguardandoEntrada: number; devolucoes: number };
};

const ABERTAS_PARA_AGENDA: StatusEncomenda[] = ["AGUARDANDO_ENTRADA", ...STATUS_CONFIRMADOS, "ENTREGUE"];

async function agendaEntre(de: string, ate: string): Promise<DiaDaAgenda[]> {
  const lista = await db.encomenda.findMany({
    where: { status: { in: ABERTAS_PARA_AGENDA }, dataEntrega: { gte: dateDoDia(de), lte: dateDoDia(ate) } },
    select: { id: true, status: true, dataEntrega: true, itens: { select: { productId: true, quantidade: true, product: { select: { nome: true } } } } },
    orderBy: [{ dataEntrega: "asc" }, { id: "asc" }],
    take: 500,
  });
  return agendaPorDia(
    lista.map((e) => ({
      id: e.id,
      status: e.status,
      dataEntrega: diaDe(e.dataEntrega),
      itens: e.itens.map((i) => ({ productId: i.productId, sabor: separarNome(i.product.nome).sabor, quantidade: i.quantidade })),
    })),
  );
}

/**
 * GET /api/admin/encomendas. Grava antes os prazos vencidos (expiração preguiçosa). Visões:
 * - responder: SOLICITADA, do prazo mais curto para o mais longo;
 * - agenda: aguardando entrada, confirmadas, em produção, prontas e entregues com entrega de `de` a
 *   `ate` (padrão: hoje a hoje+30; no máximo 62 dias), mais a agenda por dia e sabor;
 * - aguardando-entrada: aprovadas esperando a entrada, do prazo mais curto;
 * - devolucoes: com devolução pendente;
 * - historico: todas, da mais nova para a mais antiga (20 por página).
 */
export async function listarEncomendasAdmin(
  opcoes: { visao: VisaoEncomendas; de?: string; ate?: string; pagina?: number },
  agora: Date,
): Promise<ListaEncomendasAdminDTO> {
  await expirarVencidas(agora);
  const pagina = Math.max(1, opcoes.pagina ?? 1);
  let where: Prisma.EncomendaWhereInput;
  let orderBy: Prisma.EncomendaOrderByWithRelationInput[];
  let de: string | undefined;
  let ate: string | undefined;
  switch (opcoes.visao) {
    case "responder":
      where = { status: "SOLICITADA" };
      orderBy = [{ responderAte: "asc" }, { id: "asc" }];
      break;
    case "aguardando-entrada":
      where = { status: "AGUARDANDO_ENTRADA" };
      orderBy = [{ entradaAte: "asc" }, { id: "asc" }];
      break;
    case "devolucoes":
      where = { devolucoes: { some: { status: "PENDENTE" } } };
      orderBy = [{ encerradaEm: "asc" }, { criadaEm: "asc" }, { id: "asc" }];
      break;
    case "agenda": {
      de = opcoes.de ?? hojeNaLoja(agora);
      ate = opcoes.ate ?? somarDias(de, 30);
      if (ate < de || somarDias(de, MAX_DIAS_AGENDA - 1) < ate) {
        throw new ErroNegocio(400, `A agenda cobre no máximo ${MAX_DIAS_AGENDA} dias.`, { ate: [`Escolha até ${MAX_DIAS_AGENDA} dias a partir de "de".`] });
      }
      where = { status: { in: ABERTAS_PARA_AGENDA }, dataEntrega: { gte: dateDoDia(de), lte: dateDoDia(ate) } };
      orderBy = [{ dataEntrega: "asc" }, { id: "asc" }];
      break;
    }
    default:
      where = {};
      orderBy = [{ criadaEm: "desc" }, { id: "desc" }];
  }
  const paginada = opcoes.visao === "historico";
  const [lista, total, responder, aguardandoEntrada, devolucoes, agenda] = await Promise.all([
    db.encomenda.findMany({
      where,
      orderBy,
      include: { ...incluirEncomenda, user: { select: { nome: true } } },
      skip: paginada ? (pagina - 1) * POR_PAGINA : 0,
      take: paginada ? POR_PAGINA : 200,
    }),
    db.encomenda.count({ where }),
    db.encomenda.count({ where: { status: "SOLICITADA" } }),
    db.encomenda.count({ where: { status: "AGUARDANDO_ENTRADA" } }),
    db.encomenda.count({ where: { devolucoes: { some: { status: "PENDENTE" } } } }),
    opcoes.visao === "agenda" ? agendaEntre(de!, ate!) : Promise.resolve(undefined),
  ]);
  return {
    visao: opcoes.visao,
    encomendas: lista.map((e) => paraAdminDTO(e, agora)),
    ...(agenda ? { agenda, de, ate } : {}),
    total,
    pagina: paginada ? pagina : 1,
    porPagina: paginada ? POR_PAGINA : Math.max(total, 1),
    contagens: { responder, aguardandoEntrada, devolucoes },
  };
}

/** Ficha da encomenda; `null` se não existir. Grava antes os prazos vencidos dela. */
export async function detalheEncomendaAdmin(id: string, agora: Date): Promise<EncomendaAdminDetalheDTO | null> {
  if (id.length === 0 || id.length > 100) return null;
  await expirarVencidas(agora, { encomendaId: id });
  const e = await db.encomenda.findUnique({ where: { id }, include: incluirAdmin });
  return e ? paraDetalheDTO(e, agora) : null;
}

// --- ações da dona --------------------------------------------------------------------------------

export type MotivoConflito = "status-mudou" | MotivoTransicaoRecusada | "pagamento-em-conferencia" | "devolucao-mudou";

function conflito(mensagem: string, statusAtual: StatusEncomenda, motivo: MotivoConflito, extra: Record<string, unknown> = {}): ErroNegocio {
  return new ErroNegocio(409, mensagem, { statusAtual, motivo, ...extra });
}

const MENSAGEM_MUDOU = "A encomenda mudou enquanto você agia. Atualize a ficha e confira.";

/**
 * PATCH /api/admin/encomendas/[id]: uma ação (`acaoAdminSchema`) com o status que a tela mostrava.
 * 404 se não existir; 409 `{ statusAtual, motivo }` se o status mudou, a transição não vale agora
 * (prazo, quitação) ou há pagamento em conferência. Devolve a ficha atualizada e, às vezes, um aviso.
 */
export async function executarAcaoAdmin(
  id: string,
  acao: AcaoAdminEntrada,
  adminId: string,
  agora: Date,
): Promise<{ encomenda: EncomendaAdminDetalheDTO; aviso?: string }> {
  if (id.length === 0 || id.length > 100) throw new ErroNegocio(404, "Encomenda não encontrada.");
  await expirarVencidas(agora, { encomendaId: id });
  const e = await db.encomenda.findUnique({ where: { id }, include: incluirAdmin });
  if (!e) throw new ErroNegocio(404, "Encomenda não encontrada.");
  const regras = paraRegras(e, agora);
  const efetivo = statusEfetivo(regras, agora);
  if (acao.statusEsperado !== efetivo) throw conflito(MENSAGEM_MUDOU, efetivo, "status-mudou");

  const fatos = { agora, responderAte: e.responderAte, entradaAte: e.entradaAte, quitada: e.restantePagoEm !== null };
  const exigirTransicao = (para: StatusEncomenda, ator: Ator = "LOJA") => {
    const t = transicaoPermitida(e.status, para, ator, fatos);
    if (!t.ok) {
      const msg =
        t.motivo === "nao-quitada"
          ? "Falta o restante: a encomenda só sai quitada."
          : t.motivo === "prazo-vencido"
            ? "O prazo desta ação já passou."
            : `Não dá para passar de "${ROTULO_STATUS_ENCOMENDA[e.status]}" para "${ROTULO_STATUS_ENCOMENDA[para]}".`;
      throw conflito(msg, e.status, t.motivo);
    }
  };
  // UPDATE condicional: o status e o dinheiro precisam estar como foram lidos.
  const comoLida = { id, status: e.status, entradaPagaEm: e.entradaPagaEm, restantePagoEm: e.restantePagoEm } satisfies Prisma.EncomendaWhereInput;
  const atualizar = async (data: Prisma.EncomendaUncheckedUpdateManyInput, extra: Prisma.EncomendaWhereInput = {}) => {
    const { count } = await db.encomenda.updateMany({ where: { ...comoLida, ...extra }, data });
    if (count !== 1) throw conflito(MENSAGEM_MUDOU, e.status, "status-mudou");
  };
  // Registrar a parcela por fora: junto, abre a devolução do dinheiro que entrou pelo site com divergência
  // (a cobrança nunca foi dada como paga; com a parcela quitada por fora, aquele dinheiro é a segunda entrada).
  const registrarParcela = async (data: Prisma.EncomendaUncheckedUpdateManyInput, parcela: Parcela): Promise<number> => {
    const abertas = await db.$transaction(async (tx) => {
      const { count } = await tx.encomenda.updateMany({ where: comoLida, data });
      if (count !== 1) return null;
      return abrirDevolucoesDeDivergencias(tx, id, "PAGAMENTO_DUPLICADO", parcela);
    });
    if (abertas === null) throw conflito(MENSAGEM_MUDOU, e.status, "status-mudou");
    return abertas;
  };
  const AVISO_DIVERGENCIA_REGISTRADA =
    "Havia um pagamento do site com divergência nesta parcela: abrimos uma devolução pendente. Confira no app InfinitePay quanto entrou: " +
    "se aquele dinheiro for a própria parcela que você registrou, não devolva em duplicidade.";
  const emConferencia = (parcela?: Parcela) =>
    e.pagamentos.some((p) => (!parcela || p.parcela === parcela) && cobrancaEmConferencia(p, agora.getTime()));
  let aviso: string | undefined;

  switch (acao.acao) {
    case "aprovar": {
      exigirTransicao("AGUARDANDO_ENTRADA");
      // O percentual que vale de fato nunca passa do que a cliente aceitou (`percentualAceito`, que NÃO muda):
      // se o painel o baixou depois da solicitação, vale o menor (congelado aqui, na aprovação).
      const config = await lerConfigLembrancinhas();
      const percentualRetido = Math.min(e.percentualAceito, config?.percentualRetido ?? e.percentualAceito);
      await atualizar(
        { status: "AGUARDANDO_ENTRADA", aprovadaEm: agora, entradaAte: prazoDaEntrada(agora, e.corteEm), percentualRetido },
        { responderAte: { gt: agora } },
      );
      break;
    }
    case "recusar":
      exigirTransicao("RECUSADA");
      await atualizar({ status: "RECUSADA", motivoRecusa: acao.motivo, encerradaEm: agora });
      break;
    case "iniciar-producao":
      exigirTransicao("EM_PRODUCAO");
      await atualizar({ status: "EM_PRODUCAO", producaoIniciadaEm: agora });
      break;
    case "marcar-pronta":
      exigirTransicao("PRONTA");
      await atualizar({ status: "PRONTA", prontaEm: agora, producaoIniciadaEm: e.producaoIniciadaEm ?? agora });
      break;
    case "marcar-entregue":
      exigirTransicao("ENTREGUE");
      await atualizar({ status: "ENTREGUE", entregueEm: agora }, { restantePagoEm: { not: null } });
      break;
    case "registrar-entrada": {
      // Saída da dona quando a conferência do pagamento não fecha, ou quando a cliente pagou por fora:
      // dá a entrada como recebida (CONFIRMADA), com a forma e quem registrou. Com pagamento da entrada em
      // conferência recente, espera (ou cancela): senão o mesmo dinheiro poderia entrar duas vezes.
      exigirTransicao("CONFIRMADA");
      if (e.entradaPagaEm) throw conflito("A entrada já foi paga.", e.status, "transicao-invalida");
      if (emConferencia("ENTRADA")) {
        const ate = e.pagamentos
          .filter((p) => p.parcela === "ENTRADA")
          .map((p) => conferenciaAte(p, agora.getTime()))
          .reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);
        throw conflito(
          "Há um pagamento da entrada sendo conferido. Confira no app InfinitePay: se o dinheiro entrou, aguarde a confirmação; " +
            "se não, cancele a encomenda ou tente de novo quando a conferência terminar.",
          e.status,
          "pagamento-em-conferencia",
          { conferenciaAte: ate?.toISOString() ?? null },
        );
      }
      const { linkAberto } = await encerrarCobrancasDaEncomenda(id, "ENTRADA");
      const divergencias = await registrarParcela(
        {
          status: "CONFIRMADA",
          entradaPagaEm: agora,
          entradaForma: acao.formaPagamento,
          entradaForaDoSite: true,
          entradaObservacao: acao.observacao,
          entradaRegistradaPorId: adminId,
        },
        "ENTRADA",
      );
      const partes: string[] = [];
      if (linkAberto) {
        partes.push(
          "O link da entrada que estava aberto foi encerrado no site, mas ainda aceita pagamento na InfinitePay por até 1 hora. " +
            "Se a cliente pagar, aparecerá uma devolução pendente por pagamento em duplicidade: devolva pelo app InfinitePay.",
        );
      }
      if (divergencias > 0) partes.push(AVISO_DIVERGENCIA_REGISTRADA);
      aviso = partes.length > 0 ? partes.join(" ") : undefined;
      break;
    }
    case "registrar-restante": {
      if (!STATUS_CONFIRMADOS.some((s) => s === e.status)) {
        throw conflito("O restante só pode ser registrado com a encomenda confirmada.", e.status, "transicao-invalida");
      }
      if (e.restantePagoEm) throw conflito("O restante já foi pago.", e.status, "transicao-invalida");
      if (emConferencia("RESTANTE")) {
        throw conflito("Há um pagamento do restante sendo conferido. Confira no app InfinitePay antes de registrar.", e.status, "pagamento-em-conferencia");
      }
      const { linkAberto } = await encerrarCobrancasDaEncomenda(id, "RESTANTE");
      const divergencias = await registrarParcela(
        {
          restantePagoEm: agora,
          restanteForma: acao.formaPagamento,
          restanteForaDoSite: true,
          restanteObservacao: acao.observacao,
          restanteRegistradoPorId: adminId,
        },
        "RESTANTE",
      );
      const partes: string[] = [];
      if (linkAberto) {
        partes.push(
          "O link do restante que estava aberto foi encerrado no site, mas ainda aceita pagamento na InfinitePay por até 1 hora. " +
            "Se a cliente pagar, aparecerá uma devolução pendente: devolva pelo app InfinitePay.",
        );
      }
      if (divergencias > 0) partes.push(AVISO_DIVERGENCIA_REGISTRADA);
      aviso = partes.length > 0 ? partes.join(" ") : undefined;
      break;
    }
    case "cancelar": {
      // A pedido da cliente (pelo WhatsApp) vale a regra dela; a loja cancelando, a da loja.
      exigirTransicao("CANCELADA", acao.aPedidoDaCliente ? "CLIENTE" : "LOJA");
      // Com pagamento em conferência, cancelar vale (é a saída da dona), com o aviso de conferir no app: se o
      // dinheiro entrar depois, a confirmação vê a encomenda cancelada e registra a devolução pendente.
      const emConferenciaAgora = emConferencia();
      const faixa = faixaDaDevolucaoNoCancelamento(regras, agora, acao.aPedidoDaCliente);
      if (acao.devolverCentavos < faixa.minimo || acao.devolverCentavos > faixa.maximo) {
        throw new ErroNegocio(400, "Valor da devolução fora da faixa.", {
          devolverCentavos: [`Entre ${(faixa.minimo / 100).toFixed(2)} e ${(faixa.maximo / 100).toFixed(2)} reais.`],
          minimoCentavos: faixa.minimo,
          maximoCentavos: faixa.maximo,
        });
      }
      const { linkAberto } = await encerrarCobrancasDaEncomenda(id);
      const cancelou = await db.$transaction(async (tx) => {
        const { count } = await tx.encomenda.updateMany({
          where: comoLida,
          data: {
            status: "CANCELADA",
            canceladaPor: acao.aPedidoDaCliente ? "CLIENTE" : "LOJA",
            motivoCancelamento: acao.motivo,
            encerradaEm: agora,
          },
        });
        if (count !== 1) return null;
        if (acao.devolverCentavos > 0) {
          await tx.encomendaDevolucao.create({
            data: { encomendaId: id, motivo: acao.aPedidoDaCliente ? "DESISTENCIA" : "CANCELAMENTO", valor: reaisDe(acao.devolverCentavos) },
          });
        }
        // Dinheiro que entrou com divergência e nunca foi dado como pago: também é devolução (ou o alerta sumiria com a ficha encerrada).
        return abrirDevolucoesDeDivergencias(tx, id, "PAGAMENTO_TARDIO");
      });
      if (cancelou === null) throw conflito(MENSAGEM_MUDOU, e.status, "status-mudou");
      const partes: string[] = [];
      if (cancelou > 0) {
        partes.push(
          "Havia pagamento do site com divergência: abrimos uma devolução pendente. Confira no app InfinitePay quanto entrou e devolva.",
        );
      }
      if (acao.devolverCentavos > 0) {
        partes.push(`Devolva ${(acao.devolverCentavos / 100).toFixed(2).replace(".", ",")} reais pelo app InfinitePay e marque "Marquei como devolvida".`);
      }
      if (linkAberto) {
        partes.push("Um link de pagamento ainda aceita pagamento por até 1 hora; se a cliente pagar, aparecerá outra devolução pendente.");
      }
      if (emConferenciaAgora) partes.push(AVISO_CANCELAR_EM_CONFERENCIA);
      aviso = partes.length > 0 ? partes.join(" ") : undefined;
      break;
    }
    case "devolucao-feita": {
      // Só as devoluções que a tela mostrava (ids), todas ou nenhuma: uma nova, que apareceu depois, segue pendente.
      const fechou = await marcarDevolucoesFeitas(id, acao.devolucaoIds, adminId, acao.observacao, agora);
      if (!fechou) {
        throw conflito("As devoluções pendentes mudaram desde que você abriu a ficha. Atualize e confira antes de marcar.", e.status, "devolucao-mudou");
      }
      break;
    }
    case "avisada":
      await db.encomenda.update({ where: { id }, data: { avisadaStatus: acao.status, avisadaEm: agora } });
      break;
  }
  console.info(`[encomendas] admin ${adminId}: ${acao.acao} na encomenda ${id}`);
  const atual = await db.encomenda.findUnique({ where: { id }, include: incluirAdmin });
  return { encomenda: await paraDetalheDTO(atual!, agora), ...(aviso ? { aviso } : {}) };
}

// --- configuração ---------------------------------------------------------------------------------

export type ConfigLembrancinhasAdminDTO = {
  ativo: boolean;
  precoPotinhoCentavos: number;
  pesoPotinhoGramas: number;
  pesoEmbalagemGramas: number;
  /** 0 a 100: quanto da entrada fica com a loja se a cliente desistir depois do corte (D4). */
  percentualRetido: number;
  atualizadoEm: string | null;
  /** Sabores do catálogo e se estão à venda / marcados "disponível em mini" (a marcação é em Produtos). */
  sabores: { productId: string; sabor: string; ativo: boolean; disponivelEmMini: boolean }[];
  /** O que falta em src/lib/dados-loja.ts para poder abrir (D13). Com algo aqui, ativar dá 409. */
  pendenciasLegais: string[];
  /** Avisos que não bloqueiam (nenhum sabor mini, pagamento desligado). */
  avisos: string[];
  /** Texto fixo do painel ao mexer no percentual. */
  avisoJuridico: string;
};

export async function obterConfigLembrancinhasAdmin(): Promise<ConfigLembrancinhasAdminDTO> {
  const [config, produtos] = await Promise.all([
    lerConfigLembrancinhas(),
    db.product.findMany({ orderBy: [{ nome: "asc" }, { id: "asc" }], select: { id: true, nome: true, ativo: true, disponivelEmMini: true } }),
  ]);
  const sabores = produtos.map((p) => ({ productId: p.id, sabor: separarNome(p.nome).sabor, ativo: p.ativo, disponivelEmMini: p.disponivelEmMini }));
  const avisos: string[] = [];
  if (!sabores.some((s) => s.ativo && s.disponivelEmMini)) avisos.push('Nenhum sabor à venda está marcado como "disponível em mini" (em Produtos).');
  if (!pagamentoOnlineDisponivel()) avisos.push("O pagamento pelo site está desligado: a página fica fechada mesmo aberta aqui.");
  return {
    ativo: config?.ativo ?? false,
    precoPotinhoCentavos: config ? centavos(config.precoPotinho) : 600,
    pesoPotinhoGramas: config?.pesoPotinhoGramas ?? 110,
    pesoEmbalagemGramas: config?.pesoEmbalagemGramas ?? 300,
    percentualRetido: config?.percentualRetido ?? 100,
    atualizadoEm: config?.atualizadoEm.toISOString() ?? null,
    sabores,
    pendenciasLegais: pendenciasParaAbrir(),
    avisos,
    avisoJuridico: AVISO_JURIDICO,
  };
}

/**
 * PATCH /api/admin/lembrancinhas: edição completa ou só `{ ativo }`. Ativar com CNPJ/CPF ou e-mail
 * pendentes em dados-loja.ts: 409 (D13). Expira o cache da página /lembrancinhas na hora. As
 * encomendas já feitas não mudam (preço e percentual ficam congelados nelas).
 */
export async function salvarConfigLembrancinhas(
  entrada: ConfigLembrancinhasEntrada | { ativo: boolean },
): Promise<ConfigLembrancinhasAdminDTO> {
  const pendencias = pendenciasParaAbrir();
  if (entrada.ativo && pendencias.length > 0) {
    throw new ErroNegocio(409, `Para abrir as lembrancinhas, falta preencher ${pendencias.join(" e ")} da loja.`, { pendenciasLegais: pendencias });
  }
  const valores =
    "precoPotinhoCentavos" in entrada
      ? {
          precoPotinho: reaisDe(entrada.precoPotinhoCentavos),
          pesoPotinhoGramas: entrada.pesoPotinhoGramas,
          pesoEmbalagemGramas: entrada.pesoEmbalagemGramas,
          percentualRetido: entrada.percentualRetido,
        }
      : {};
  await db.configLembrancinhas.upsert({
    where: { id: ID_CONFIG_LEMBRANCINHAS },
    update: { ativo: entrada.ativo, ...valores },
    create: {
      id: ID_CONFIG_LEMBRANCINHAS,
      ativo: entrada.ativo,
      precoPotinho: reaisDe(600),
      pesoPotinhoGramas: 110,
      pesoEmbalagemGramas: 300,
      percentualRetido: 100,
      ...valores,
    },
  });
  revalidateTag("lembrancinhas", { expire: 0 });
  return obterConfigLembrancinhasAdmin();
}

// --- painel inicial -------------------------------------------------------------------------------

export type ResumoEncomendasDashboard = {
  /** SOLICITADA dentro do prazo: a dona precisa responder. */
  aguardandoResposta: number;
  /** O prazo de resposta mais próximo (ISO), ou null. */
  proximoPrazo: string | null;
  /** Entregas ou retiradas marcadas para hoje (aguardando entrada ou confirmadas). */
  entregasHoje: number;
  devolucoesPendentes: number;
};

export async function resumoEncomendasDashboard(agora: Date): Promise<ResumoEncomendasDashboard> {
  const hoje = dateDoDia(hojeNaLoja(agora));
  const [aguardandoResposta, proxima, entregasHoje, devolucoesPendentes] = await Promise.all([
    db.encomenda.count({ where: { status: "SOLICITADA", responderAte: { gt: agora } } }),
    db.encomenda.findFirst({ where: { status: "SOLICITADA", responderAte: { gt: agora } }, orderBy: { responderAte: "asc" }, select: { responderAte: true } }),
    db.encomenda.count({ where: { dataEntrega: hoje, status: { in: ["AGUARDANDO_ENTRADA", ...STATUS_CONFIRMADOS] } } }),
    db.encomenda.count({ where: { devolucoes: { some: { status: "PENDENTE" } } } }),
  ]);
  return { aguardandoResposta, proximoPrazo: proxima?.responderAte.toISOString() ?? null, entregasHoje, devolucoesPendentes };
}
