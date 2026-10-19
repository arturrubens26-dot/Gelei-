import "server-only";
import { Prisma, type Pagamento } from "@/generated/prisma/client";
import { pagamentosSimuladosPermitidos } from "@/lib/ambiente";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { codigoPedido } from "@/lib/formatacao";
import {
  cancelarPagamentoNoMercadoPago,
  consultarPagamentoNoMercadoPago,
  criarPixNoMercadoPago,
  ErroMercadoPago,
  mercadoPagoConfigurado,
} from "@/lib/mercadopago";
import {
  divergenciaDoPagamento,
  statusDoMercadoPago,
  type PagamentoMercadoPago,
  type StatusCobranca,
} from "@/lib/mercadopago-regras";
import type { StatusPedido } from "@/lib/status";

/**
 * Camada de pagamento. O resto do sistema só conhece as funções deste arquivo; quem fala com o
 * Mercado Pago é src/lib/mercadopago.ts.
 *
 * Regra de ouro: o pedido só vira PAGO quando ESTE servidor consulta o gateway com o próprio token
 * e confere pedido, valor, moeda e forma de pagamento. O aviso (webhook) e a tela do cliente só
 * disparam a consulta; nada do que chega neles é usado como prova de pagamento.
 */

export type NomeGateway = "mercadopago" | "simulado";

/** O que o cliente vê de uma cobrança (sem ids internos). */
export type CobrancaDTO = {
  gateway: NomeGateway;
  status: StatusCobranca;
  valor: number;
  copiaECola: string;
  /** PNG em base64 (sem o prefixo data:), quando o gateway manda a imagem. */
  qrCodeBase64: string | null;
  expiraEm: string;
};

type CobrancaCriada = {
  referenciaExterna: string;
  status: StatusCobranca;
  statusGateway: string;
  copiaECola: string;
  qrCodeBase64: string | null;
  expiraEm: Date;
};

type SituacaoNoGateway = {
  status: StatusCobranca;
  statusGateway: string;
  aprovadoEm: Date | null;
  /** Motivo para NÃO aceitar um "aprovado" (pedido, valor, moeda ou forma diferentes). */
  divergencia: string | null;
};

type Esperado = { pedidoId: string; valor: number };

type EntradaCriacao = Esperado & { descricao: string; email: string; nome: string; expiraEm: Date };

interface GatewayPagamento {
  readonly nome: NomeGateway;
  criarCobrancaPix(entrada: EntradaCriacao, chaveIdempotencia: string): Promise<CobrancaCriada>;
  /** `null`: este gateway não tem onde consultar (simulado). */
  consultar(referencia: string, esperado: Esperado): Promise<SituacaoNoGateway | null>;
  /** Cancela um PIX ainda não pago; devolve a situação depois da tentativa. */
  cancelar(referencia: string, esperado: Esperado): Promise<SituacaoNoGateway | null>;
}

/** Quanto tempo o cliente tem para pagar (o Mercado Pago aceita de 30 minutos a 30 dias). */
const VALIDADE_DO_PIX_MS = 60 * 60_000;
/** Um PIX que vence em menos que isto não é reaproveitado: o cliente não teria tempo de pagar. */
const FOLGA_PARA_PAGAR_MS = 3 * 60_000;
/** PIX gerados por pedido (cada "Gerar novo PIX" conta um). */
const MAX_COBRANCAS_POR_PEDIDO = 10;
/** A tela do cliente pergunta sempre; o gateway, no máximo uma vez nesse intervalo por cobrança. */
const INTERVALO_CONSULTA_TELA_MS = 8_000;
/** Avisos repetidos do gateway em rajada não viram uma consulta cada. */
const INTERVALO_CONSULTA_AVISO_MS = 3_000;

// --- gateways ---------------------------------------------------------------------------------

/** Só aceita o QR Code se for base64 de verdade (vai parar num `src="data:..."`). */
function base64Seguro(valor: string | null | undefined): string | null {
  return valor && valor.length <= 200_000 && /^[A-Za-z0-9+/]+=*$/.test(valor) ? valor : null;
}

function dataValida(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function situacaoDoMercadoPago(p: PagamentoMercadoPago, esperado: Esperado): SituacaoNoGateway {
  const status = statusDoMercadoPago(p.status);
  return {
    status,
    statusGateway: p.status,
    aprovadoEm: dataValida(p.date_approved) ?? (status === "APROVADO" ? new Date() : null),
    divergencia: divergenciaDoPagamento(p, esperado),
  };
}

/**
 * Sem a assinatura secreta, pedimos o aviso em cada pagamento (`notification_url`). Com ela, o aviso
 * vem da URL cadastrada no painel do Mercado Pago (é lá que a assinatura é gerada) e não mandamos a
 * nossa: a do pagamento teria prioridade sobre a do painel e poderia chegar sem assinatura.
 */
function urlDoAviso(): string | undefined {
  if (process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim()) return undefined;
  const base = process.env.APP_URL;
  if (!base) return undefined;
  try {
    const url = new URL("/api/webhooks/mercadopago", base);
    url.searchParams.set("source_news", "webhooks");
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const gatewayMercadoPago: GatewayPagamento = {
  nome: "mercadopago",
  async criarCobrancaPix(entrada, chaveIdempotencia) {
    const p = await criarPixNoMercadoPago({ ...entrada, urlNotificacao: urlDoAviso() }, chaveIdempotencia);
    const dados = p.point_of_interaction?.transaction_data;
    if (!dados?.qr_code) throw new ErroMercadoPago(502, "o Mercado Pago não devolveu o código PIX");
    const divergencia = divergenciaDoPagamento(p, entrada);
    if (divergencia) throw new ErroMercadoPago(502, `cobrança criada com ${divergencia}`);
    return {
      referenciaExterna: p.id,
      status: statusDoMercadoPago(p.status),
      statusGateway: p.status,
      copiaECola: dados.qr_code,
      qrCodeBase64: base64Seguro(dados.qr_code_base64),
      expiraEm: dataValida(p.date_of_expiration) ?? entrada.expiraEm,
    };
  },
  async consultar(referencia, esperado) {
    return situacaoDoMercadoPago(await consultarPagamentoNoMercadoPago(referencia), esperado);
  },
  async cancelar(referencia, esperado) {
    try {
      return situacaoDoMercadoPago(await cancelarPagamentoNoMercadoPago(referencia), esperado);
    } catch (e) {
      // 4xx: o PIX já não pode ser cancelado (foi pago, já expirou). Vale o que o Mercado Pago disser.
      if (e instanceof ErroMercadoPago && e.status >= 400 && e.status < 500) return this.consultar(referencia, esperado);
      throw e;
    }
  },
};

/** Demonstração local: um "PIX" sem banco por trás, pago pela rota de simulação. */
const gatewaySimulado: GatewayPagamento = {
  nome: "simulado",
  async criarCobrancaPix(entrada, chaveIdempotencia) {
    return {
      referenciaExterna: `SIM-${chaveIdempotencia}`,
      status: "PENDENTE",
      statusGateway: "pending",
      copiaECola: `00020126SIMULADO${entrada.pedidoId}5204000053039865802BR`,
      qrCodeBase64: null,
      expiraEm: entrada.expiraEm,
    };
  },
  async consultar() {
    return null;
  },
  async cancelar() {
    return { status: "CANCELADO", statusGateway: "cancelled", aprovadoEm: null, divergencia: null };
  },
};

/**
 * Pagamento simulado: PAGAMENTOS_SIMULADOS=true e, em produção, também APP_ENV=demo
 * (ver src/lib/ambiente.ts). Sem os dois sinais, o endpoint de simulação some (404).
 * Com o Mercado Pago configurado, a simulação fica desligada mesmo com a flag.
 */
export function pagamentosSimuladosAtivos(): boolean {
  return !mercadoPagoConfigurado() && pagamentosSimuladosPermitidos();
}

/**
 * Dá para cobrar um pedido pelo site? Sem gateway, a loja não aceita pedidos online: o checkout
 * avisa "em breve" e a API recusa ANTES de gravar o pedido.
 */
export function pagamentoOnlineDisponivel(): boolean {
  return mercadoPagoConfigurado() || pagamentosSimuladosAtivos();
}

function obterGateway(): GatewayPagamento {
  if (mercadoPagoConfigurado()) return gatewayMercadoPago;
  if (pagamentosSimuladosAtivos()) return gatewaySimulado;
  throw new ErroNegocio(503, "O pagamento pelo site está indisponível no momento.");
}

/** O gateway que criou a cobrança (a consulta vai sempre para ele). */
function gatewayDaCobranca(p: Pick<Pagamento, "gateway">): GatewayPagamento {
  return p.gateway === "mercadopago" ? gatewayMercadoPago : gatewaySimulado;
}

// --- cobranças --------------------------------------------------------------------------------

function paraCobrancaDTO(p: Pagamento): CobrancaDTO {
  return {
    gateway: p.gateway === "mercadopago" ? "mercadopago" : "simulado",
    status: p.status,
    valor: p.valor.toNumber(),
    copiaECola: p.copiaECola,
    qrCodeBase64: p.qrCodeBase64,
    expiraEm: p.expiraEm.toISOString(),
  };
}

const esperadoDe = (p: Pagamento): Esperado => ({ pedidoId: p.orderId, valor: p.valor.toNumber() });

/**
 * Grava o que o gateway disse sobre a cobrança e, se ela foi paga e confere, marca o pedido como
 * PAGO (só a partir de PENDENTE: um pedido já enviado ou cancelado não volta). Idempotente: o mesmo
 * aviso duas vezes não muda nada na segunda.
 */
async function aplicarSituacao(
  p: Pagamento,
  s: SituacaoNoGateway,
  opcoes: { encerrarOutras: boolean } = { encerrarOutras: true },
): Promise<StatusCobranca> {
  let status = s.status;
  if (status === "APROVADO" && s.divergencia) {
    // Não acontece num fluxo normal (a cobrança foi criada por nós, com o total do pedido). Se
    // acontecer, o pedido fica como está e o caso vai para conferência manual.
    if (p.statusGateway !== s.statusGateway) {
      console.error(
        `[pagamentos] cobrança ${p.id} do pedido ${p.orderId} aprovada no gateway com ${s.divergencia}: ` +
          "o pedido NÃO foi marcado como pago. Confira no painel do Mercado Pago.",
      );
    }
    status = "PENDENTE";
  }

  const agora = new Date();
  const pago = status === "APROVADO";
  const aprovadoEm = pago || status === "ESTORNADO" ? (s.aprovadoEm ?? p.aprovadoEm ?? agora) : null;
  const operacoes = [
    db.pagamento.update({
      where: { id: p.id },
      data: { status, statusGateway: s.statusGateway.slice(0, 40), consultadoEm: agora, aprovadoEm },
    }),
    ...(pago ? [db.order.updateMany({ where: { id: p.orderId, status: "PENDENTE" }, data: { status: "PAGO" } })] : []),
  ];
  const resultados = await db.$transaction(operacoes);
  const pedidoMudou = pago && (resultados[1] as Prisma.BatchPayload).count === 1;

  if (pedidoMudou) {
    console.info(`[pagamentos] pedido ${p.orderId} pago por PIX (${p.gateway})`);
  } else if (pago && p.status !== "APROVADO") {
    // Pago agora, mas o pedido já não estava aguardando: cancelado antes do PIX cair, ou pago duas vezes.
    const pedido = await db.order.findUnique({ where: { id: p.orderId }, select: { status: true } });
    console.error(
      `[pagamentos] PIX ${p.id} pago com o pedido ${p.orderId} em ${pedido?.status ?? "?"}: ` +
        "confira e, se for o caso, devolva o valor pelo painel do Mercado Pago.",
    );
  }
  if (status === "ESTORNADO" && p.status !== "ESTORNADO") {
    console.warn(`[pagamentos] PIX ${p.id} do pedido ${p.orderId} foi devolvido ao cliente (${s.statusGateway}).`);
  }

  // Pedido pago: os outros PIX dele que ainda estiverem abertos são cancelados (não dá para pagar duas vezes).
  if (pedidoMudou && opcoes.encerrarOutras) {
    const abertas = await db.pagamento.findMany({ where: { orderId: p.orderId, status: "PENDENTE", NOT: { id: p.id } } });
    for (const outra of abertas) {
      await encerrarCobranca(outra).catch((e) => console.error(`[pagamentos] não cancelou o PIX ${outra.id}: ${(e as Error).message}`));
    }
  }
  return status;
}

/** Cancela um PIX aberto no gateway (ou descobre que ele foi pago no último instante). */
async function encerrarCobranca(p: Pagamento): Promise<StatusCobranca> {
  const situacao = await gatewayDaCobranca(p).cancelar(p.referenciaExterna, esperadoDe(p));
  if (!situacao) return p.status;
  return aplicarSituacao(p, situacao, { encerrarOutras: false });
}

/**
 * Pergunta ao gateway como está a cobrança e grava o resultado. `intervaloMinimoMs` evita consultar
 * de novo uma cobrança consultada há instantes (a tela do cliente pergunta a cada poucos segundos).
 */
export async function sincronizarCobranca(p: Pagamento, intervaloMinimoMs = 0): Promise<StatusCobranca> {
  if (intervaloMinimoMs > 0 && p.consultadoEm && Date.now() - p.consultadoEm.getTime() < intervaloMinimoMs) {
    return p.status;
  }
  const situacao = await gatewayDaCobranca(p).consultar(p.referenciaExterna, esperadoDe(p));
  return situacao ? aplicarSituacao(p, situacao) : p.status;
}

/** Aviso do Mercado Pago: só cobranças que NÓS criamos são consultadas (id desconhecido é ignorado). */
export async function processarAvisoDoMercadoPago(pagamentoId: string): Promise<"consultado" | "desconhecido"> {
  const p = await db.pagamento.findUnique({
    where: { gateway_referenciaExterna: { gateway: "mercadopago", referenciaExterna: pagamentoId } },
  });
  if (!p) return "desconhecido";
  await sincronizarCobranca(p, INTERVALO_CONSULTA_AVISO_MS);
  return "consultado";
}

/**
 * PIX do pedido para o cliente pagar. Reaproveita o que ainda está valendo; se não houver (primeira
 * vez, ou o anterior venceu), confere os antigos no gateway e abre um novo.
 *
 * Duas chamadas ao mesmo tempo não abrem dois PIX: as duas leem a mesma lista, mandam a mesma
 * `X-Idempotency-Key` (o Mercado Pago devolve o mesmo pagamento) e a segunda gravação esbarra no
 * índice único e devolve a primeira.
 */
export async function abrirCobranca(pedidoId: string, userId: string): Promise<CobrancaDTO> {
  const pedido = await db.order.findFirst({
    where: { id: pedidoId, userId, canal: "ONLINE" },
    select: {
      id: true,
      status: true,
      total: true,
      user: { select: { email: true, nome: true } },
      pagamentos: { orderBy: [{ criadoEm: "asc" }, { id: "asc" }] },
    },
  });
  if (!pedido?.user) throw new ErroNegocio(404, "Pedido não encontrado.");
  if (pedido.status !== "PENDENTE") throw new ErroNegocio(409, "Este pedido não está aguardando pagamento.");

  const agora = Date.now();
  const abertas = pedido.pagamentos.filter((p) => p.status === "PENDENTE");
  const valendo = abertas.findLast((p) => p.expiraEm.getTime() > agora + FOLGA_PARA_PAGAR_MS);
  if (valendo) return paraCobrancaDTO(valendo);

  // PIX antigos ainda abertos: cancela no gateway antes de abrir outro (e descobre se algum foi pago).
  for (const antiga of abertas) {
    if ((await encerrarCobranca(antiga)) === "APROVADO") {
      throw new ErroNegocio(409, "O pagamento deste pedido acabou de ser confirmado.");
    }
  }
  if (pedido.pagamentos.length >= MAX_COBRANCAS_POR_PEDIDO) {
    throw new ErroNegocio(429, "Este pedido já gerou PIX demais. Faça um novo pedido ou fale com a loja.");
  }

  const gateway = obterGateway();
  const criada = await gateway.criarCobrancaPix(
    {
      pedidoId: pedido.id,
      valor: pedido.total.toNumber(),
      descricao: `Geleiô - pedido ${codigoPedido(pedido.id)}`,
      email: pedido.user.email,
      nome: pedido.user.nome,
      expiraEm: new Date(agora + VALIDADE_DO_PIX_MS),
    },
    `geleio-${pedido.id}-${pedido.pagamentos.length + 1}`,
  );

  try {
    const registro = await db.pagamento.create({
      data: {
        orderId: pedido.id,
        gateway: gateway.nome,
        referenciaExterna: criada.referenciaExterna,
        status: criada.status,
        statusGateway: criada.statusGateway.slice(0, 40),
        valor: pedido.total,
        copiaECola: criada.copiaECola,
        qrCodeBase64: criada.qrCodeBase64,
        expiraEm: criada.expiraEm,
      },
    });
    console.info(`[pagamentos] PIX ${registro.id} aberto para o pedido ${pedido.id} (${gateway.nome})`);
    return paraCobrancaDTO(registro);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await db.pagamento.findUnique({
        where: { gateway_referenciaExterna: { gateway: gateway.nome, referenciaExterna: criada.referenciaExterna } },
      });
      if (existente) return paraCobrancaDTO(existente);
    }
    throw e;
  }
}

/** Última cobrança do pedido, como está no banco (sem consultar o gateway). */
export async function ultimaCobranca(pedidoId: string): Promise<CobrancaDTO | null> {
  const p = await db.pagamento.findFirst({ where: { orderId: pedidoId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }] });
  return p ? paraCobrancaDTO(p) : null;
}

/**
 * Situação do pagamento para a tela do pedido. Se o PIX ainda está aberto, pergunta ao gateway
 * (no máximo a cada 8 s): assim o pedido é confirmado mesmo se o aviso do Mercado Pago atrasar.
 * Falha do gateway não derruba a tela: devolve o que o banco sabe.
 */
export async function situacaoDoPagamento(
  pedidoId: string,
  userId: string,
): Promise<{ status: StatusPedido; cobranca: CobrancaDTO | null } | null> {
  const ler = () =>
    db.order.findFirst({
      where: { id: pedidoId, userId, canal: "ONLINE" },
      select: { status: true, pagamentos: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 1 } },
    });
  let pedido = await ler();
  if (!pedido) return null;

  const ultima = pedido.pagamentos[0];
  if (pedido.status === "PENDENTE" && ultima?.status === "PENDENTE") {
    try {
      await sincronizarCobranca(ultima, INTERVALO_CONSULTA_TELA_MS);
      pedido = (await ler()) ?? pedido;
    } catch (e) {
      console.error(`[pagamentos] consulta do PIX ${ultima.id} falhou: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  const atual = pedido.pagamentos[0];
  return { status: pedido.status, cobranca: atual ? paraCobrancaDTO(atual) : null };
}

/**
 * Pedido cancelado pelo admin: cancela no gateway os PIX que ainda estavam abertos. Devolve `true`
 * se algum já tinha sido pago (o valor precisa ser devolvido ao cliente pelo painel do gateway).
 */
export async function encerrarCobrancasDoPedido(pedidoId: string): Promise<{ algumPago: boolean }> {
  const abertas = await db.pagamento.findMany({ where: { orderId: pedidoId, status: "PENDENTE" } });
  let algumPago = false;
  for (const p of abertas) {
    if ((await encerrarCobranca(p)) === "APROVADO") algumPago = true;
  }
  return { algumPago };
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
      data: { status: "APROVADO", statusGateway: "approved", aprovadoEm: new Date() },
    });
  }
  return count === 1;
}
