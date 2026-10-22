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
  conferirTokenDoAviso,
  itensDoLink,
  lerAviso,
  lerRetorno,
  referenciaDoPedido,
  tokenDoAviso,
  type Candidato,
} from "@/lib/infinitepay-regras";
import {
  JANELA_CONFIRMANDO_MS,
  VALIDADE_DO_LINK_MS,
  etapaDoPagamento,
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
/** O webhook responde logo (a InfinitePay prefere menos de 1 s); o retorno e a tela esperam mais. */
const TEMPO_CONFERENCIA_AVISO_MS = 5_000;
const TEMPO_CONFERENCIA_TELA_MS = 8_000;

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

/** Ainda na janela de "confirmando" (30 min desde o candidato) e não aprovada. */
function emConfirmacao(p: Pagamento, agora = Date.now()): boolean {
  return (
    (p.status === "PENDENTE" || p.status === "CANCELADO") &&
    Boolean(candidatoGravado(p)) &&
    p.avisadoEm !== null &&
    agora - p.avisadoEm.getTime() < JANELA_CONFIRMANDO_MS
  );
}

// --- confirmação (a única porta para PAGO) ----------------------------------------------------

/**
 * - APROVADO: conferido e gravado (ou já estava);
 * - PENDENTE: a InfinitePay diz que não foi pago ainda (pode cair depois);
 * - DIVERGENTE: pago, mas o valor, a moeda, o método ou as parcelas não conferem: o pedido NÃO vira
 *   PAGO e a dona confere no app InfinitePay (repetir a consulta não muda nada);
 * - INVALIDO: candidato recusado de vez (transação de outro link ou pedido, slug diferente, já usada);
 * - TRANSITORIO: a InfinitePay não respondeu direito (o webhook responde 400 para ela repetir);
 * - ADIADO: conferida há instantes (a próxima tentativa confere).
 */
export type ResultadoConfirmacao = "APROVADO" | "PENDENTE" | "DIVERGENTE" | "INVALIDO" | "TRANSITORIO" | "ADIADO";

/** Grava o candidato (ainda não conferido). Não mexe em cobrança aprovada. */
async function registrarCandidato(p: Pagamento, c: Candidato): Promise<Pagamento> {
  if (p.status !== "PENDENTE" && p.status !== "CANCELADO") return p;
  // updateMany com o status no filtro: se outra conferência aprovou no meio do caminho, nada muda.
  await db.pagamento.updateMany({
    where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } },
    data: { avisoTransacaoNsu: c.transacaoNsu, avisoSlug: c.slug, avisadoEm: new Date(), comprovanteUrl: c.comprovanteUrl },
  });
  return (await db.pagamento.findUnique({ where: { id: p.id } })) ?? p;
}

/**
 * Apaga o candidato recusado, mas só se ele ainda for o gravado: um candidato novo que chegou durante
 * a conferência (o aviso de verdade, por exemplo) não é perdido por causa de outro.
 */
async function descartarCandidato(p: Pagamento, c: Candidato, motivo: string): Promise<void> {
  await db.pagamento.updateMany({
    where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] }, avisoTransacaoNsu: c.transacaoNsu, avisoSlug: c.slug },
    data: { avisoTransacaoNsu: null, avisoSlug: null, avisadoEm: null, comprovanteUrl: null },
  });
  await db.pagamento.updateMany({
    where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } },
    data: { statusGateway: motivo.slice(0, 40) },
  });
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
  origem: "aviso" | "retorno" | "tela",
): Promise<ResultadoConfirmacao> {
  if (p.status === "APROVADO" || p.status === "ESTORNADO") return "APROVADO";
  if (p.gateway !== "infinitepay" || (p.status !== "PENDENTE" && p.status !== "CANCELADO")) return "INVALIDO";
  // O slug que veio na criação do link amarra a fatura: outro slug é de outra fatura.
  if (p.faturaSlug && p.faturaSlug !== c.slug) {
    await descartarCandidato(p, c, "slug-diferente");
    console.warn(`[pagamentos] cobrança ${p.id}: candidato com slug de outra fatura, descartado`);
    return "INVALIDO";
  }

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
      origem === "aviso" ? TEMPO_CONFERENCIA_AVISO_MS : TEMPO_CONFERENCIA_TELA_MS,
    );
  } catch (e) {
    const status = e instanceof ErroInfinitePay ? e.status : 0;
    // 401/403: a NOSSA chave foi recusada; 429: limite. Nada disso é culpa do candidato.
    if (status === 0 || status >= 500 || status === 401 || status === 403 || status === 429) {
      console.error(`[pagamentos] payment_check da cobrança ${p.id} falhou (${(e as Error).message})`);
      return "TRANSITORIO";
    }
    await descartarCandidato(p, c, `invalido:http-${status}`);
    console.warn(`[pagamentos] cobrança ${p.id}: payment_check recusou o candidato (HTTP ${status})`);
    return "INVALIDO";
  }

  const valorCentavos = centavosDe(p.valor);
  const resultado = classificarConferencia(conferencia, valorCentavos, p.referenciaExterna);
  if (resultado.tipo === "INVALIDO") {
    await descartarCandidato(p, c, "invalido");
    console.warn(`[pagamentos] cobrança ${p.id}: payment_check não reconheceu a transação para este pedido`);
    return "INVALIDO";
  }
  if (resultado.tipo === "NAO_PAGO") {
    await db.pagamento.updateMany({ where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } }, data: { statusGateway: "nao-pago" } });
    return "PENDENTE";
  }
  if (resultado.tipo === "DIVERGENTE") {
    const marca = `divergente:${resultado.motivo}`.slice(0, 40);
    if (p.statusGateway !== marca) {
      console.error(
        `[pagamentos] cobrança ${p.id} do pedido ${p.orderId} paga com divergência (${resultado.motivo}): ` +
          "o pedido NÃO foi marcado como pago. Confira no app InfinitePay.",
      );
    }
    await db.pagamento.updateMany({ where: { id: p.id, status: { in: ["PENDENTE", "CANCELADO"] } }, data: { statusGateway: marca } });
    return "DIVERGENTE";
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
      // Esta transação já quitou outra cobrança: não paga duas.
      await descartarCandidato(p, c, "transacao-ja-usada");
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
    console.info(`[pagamentos] cobrança ${p.id} confirmada; o pedido ${p.orderId} já estava ${pedido?.status ?? "?"} (marcado à mão?)`);
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
  const segredo = process.env.SESSION_SECRET ?? "";
  return `${origem}/api/webhooks/infinitepay/${referencia}/${tokenDoAviso(segredo, referencia)}`;
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
  if (pedidoExpirado(pedido.createdAt)) throw new ErroNegocio(409, "Este pedido expirou. Faça um novo pedido.");
  const gateway = gatewayAtivo();

  // Um retorno ou aviso em conferência: pode ser que já tenha sido pago.
  const ultima = pedido.pagamentos.at(-1);
  const candidato = ultima ? candidatoGravado(ultima) : null;
  if (ultima && candidato && emConfirmacao(ultima)) {
    const r = await confirmarCobranca(ultima, candidato, "tela").catch(() => "TRANSITORIO" as const);
    if (r === "APROVADO") throw new ErroNegocio(409, "O pagamento deste pedido acabou de ser confirmado.");
  }

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
    const registro = await db.pagamento.create({
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
  return referencia.length <= 64 && conferirTokenDoAviso(process.env.SESSION_SECRET ?? "", referencia, token);
}

/**
 * Aviso da InfinitePay em /api/webhooks/infinitepay/<referencia>/<token>. Sem o token certo: 401 e
 * nada muda. Cobrança desconhecida ou corpo sem transação: 200 sem efeito. Com candidato: grava e
 * confere na hora. 200 quando confirmado, divergente (a dona confere no app) ou recusado de vez; 400
 * quando a InfinitePay falhou, ainda não marca como pago ou a cobrança acabou de ser conferida (ela
 * repete o aviso).
 */
export async function processarAvisoDaInfinitePay(referencia: string, token: string, corpo: unknown): Promise<RespostaDoAviso> {
  if (!avisoAutentico(referencia, token)) return { status: 401, resultado: "token-invalido" };
  let p = await db.pagamento.findUnique({ where: { gateway_referenciaExterna: { gateway: "infinitepay", referenciaExterna: referencia } } });
  if (!p) return { status: 200, resultado: "desconhecida" };
  if (p.status === "APROVADO" || p.status === "ESTORNADO") return { status: 200, resultado: "ja-aprovada" };

  const aviso = lerAviso(corpo, { origemLocal: origemDaApiDeTeste() });
  if (!aviso) return { status: 200, resultado: "sem-candidato" };
  if (aviso.referencia && aviso.referencia !== referencia) return { status: 200, resultado: "referencia-diferente" };

  p = await registrarCandidato(p, aviso);
  const r = await confirmarCobranca(p, aviso, "aviso");
  const status = r === "APROVADO" || r === "INVALIDO" || r === "DIVERGENTE" ? 200 : 400;
  return { status, resultado: r.toLowerCase() };
}

/**
 * Retorno do navegador (redirect_url): acha a cobrança pela referência e, se a sessão é da dona do
 * pedido, grava o candidato e confere (erro não derruba: a tela confere de novo). Devolve o caminho
 * para onde redirecionar: nunca uma URL vinda da query.
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

  if (candidato && (p.status === "PENDENTE" || p.status === "CANCELADO")) {
    try {
      const atual = await registrarCandidato(p, candidato);
      await confirmarCobranca(atual, candidato, "retorno");
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
    select: { status: true, createdAt: true, pagamentos: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 1 } },
  });
}

function montarSituacao(pedido: NonNullable<Awaited<ReturnType<typeof lerSituacao>>>): SituacaoPagamentoDTO {
  const agora = Date.now();
  const ultima = pedido.pagamentos[0] ?? null;
  return {
    pedidoStatus: pedido.status,
    etapa: etapaDoPagamento({
      gatewayAtivo: pagamentoOnlineDisponivel(),
      pedidoStatus: pedido.status,
      pedidoCriadoEm: pedido.createdAt,
      ultimaCobranca: ultima ? { status: ultima.status, avisadoEm: candidatoGravado(ultima) ? ultima.avisadoEm : null } : null,
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
  const ultima = pedido.pagamentos[0];
  const candidato = ultima ? candidatoGravado(ultima) : null;
  if (pedido.status === "PENDENTE" && ultima && candidato && emConfirmacao(ultima) && infinitePayConfigurado()) {
    try {
      await confirmarCobranca(ultima, candidato, "tela");
      pedido = (await lerSituacao(pedidoId, userId)) ?? pedido;
    } catch (e) {
      console.error(`[pagamentos] conferência da cobrança ${ultima.id} falhou: ${e instanceof Error ? e.name : "erro"}`);
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
