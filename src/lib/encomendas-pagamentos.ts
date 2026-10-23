import "server-only";
import { Prisma, type EncomendaPagamento } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  STATUS_CONFIRMADOS,
  referenciaDaParcela,
  statusConfirmado,
  statusEfetivo,
  statusFinal,
  validadeDoPix,
  type Parcela,
  type StatusEncomenda,
} from "@/lib/encomendas-regras";
import { ErroNegocio } from "@/lib/erros";
import { codigoPedido } from "@/lib/formatacao";
import { MAX_PIX_POR_PARCELA } from "@/lib/limites";
import type { StatusCobranca } from "@/lib/mercadopago-regras";
import {
  FOLGA_PARA_PAGAR_MS,
  INTERVALO_CONSULTA_AVISO_MS,
  INTERVALO_CONSULTA_TELA_MS,
  gatewayDaCobranca,
  obterGateway,
  type CobrancaDTO,
  type Esperado,
  type SituacaoNoGateway,
} from "@/lib/pagamentos";

/**
 * Cobranças PIX das encomendas de lembrancinhas: ENTRADA e RESTANTE, cada uma com o seu
 * `external_reference` ("enc-<id>-ENTRADA" / "enc-<id>-RESTANTE"). Reaproveita os gateways de
 * src/lib/pagamentos.ts (Mercado Pago e simulado) sem mudar o fluxo dos pedidos.
 *
 * A mesma regra de ouro dos pedidos: a parcela só conta como paga quando ESTE servidor consulta o
 * gateway com o próprio token e confere referência (encomenda E parcela), valor, moeda e forma. O
 * aviso (webhook) e a tela da cliente só disparam a consulta.
 */

export type { CobrancaDTO };

const centavos = (valor: Prisma.Decimal) => valor.mul(100).toNumber();

export function paraCobrancaDTO(p: EncomendaPagamento): CobrancaDTO {
  return {
    gateway: p.gateway === "mercadopago" ? "mercadopago" : "simulado",
    status: p.status,
    valor: p.valor.toNumber(),
    copiaECola: p.copiaECola,
    qrCodeBase64: p.qrCodeBase64,
    expiraEm: p.expiraEm.toISOString(),
  };
}

/** A referência inclui a PARCELA: um PIX do restante com o mesmo valor não confere com a entrada. */
const esperadoDe = (p: EncomendaPagamento): Esperado => ({
  pedidoId: referenciaDaParcela(p.encomendaId, p.parcela),
  valor: p.valor.toNumber(),
});

// --- devoluções -----------------------------------------------------------------------------------

/**
 * O Mercado Pago avisou que um PIX foi devolvido (ESTORNADO): fecha as devoluções pendentes que o
 * total estornado já cobre, da mais antiga para a mais nova. Devolução parcial (só parte de um PIX)
 * não muda o status no Mercado Pago: essa a dona marca no painel.
 */
export async function fecharDevolucoesPorEstorno(encomendaId: string, agora: Date): Promise<number> {
  const [pagamentos, devolucoes] = await Promise.all([
    db.encomendaPagamento.findMany({ where: { encomendaId, status: "ESTORNADO" }, select: { valor: true } }),
    db.encomendaDevolucao.findMany({ where: { encomendaId }, orderBy: [{ criadaEm: "asc" }, { id: "asc" }] }),
  ]);
  const estornado = pagamentos.reduce((s, p) => s + centavos(p.valor), 0);
  let coberto = devolucoes.filter((d) => d.status === "FEITA").reduce((s, d) => s + centavos(d.valor), 0);
  let fechadas = 0;
  for (const d of devolucoes) {
    if (d.status !== "PENDENTE" || coberto + centavos(d.valor) > estornado) continue;
    const { count } = await db.encomendaDevolucao.updateMany({
      where: { id: d.id, status: "PENDENTE" },
      data: { status: "FEITA", feitaEm: agora, observacao: "Estorno confirmado pelo Mercado Pago." },
    });
    if (count === 1) {
      coberto += centavos(d.valor);
      fechadas += 1;
    }
  }
  if (fechadas > 0) console.info(`[encomendas] ${fechadas} devolução(ões) da encomenda ${encomendaId} fechada(s) pelo estorno do Mercado Pago`);
  return fechadas;
}

/** "Marquei como devolvida" no painel: fecha TODAS as devoluções pendentes da encomenda. */
export async function marcarDevolucoesFeitas(encomendaId: string, adminId: string, observacao: string | null, agora: Date): Promise<number> {
  const { count } = await db.encomendaDevolucao.updateMany({
    where: { encomendaId, status: "PENDENTE" },
    data: { status: "FEITA", feitaEm: agora, observacao, registradaPorId: adminId },
  });
  return count;
}

// --- aplicar o que o gateway disse ----------------------------------------------------------------

type Efeito = "ja-aplicado" | "confirmou" | "quitou" | "PAGAMENTO_TARDIO" | "PAGAMENTO_DUPLICADO";

/**
 * Grava o que o gateway disse sobre a cobrança e aplica o efeito na encomenda:
 * - ENTRADA paga: AGUARDANDO_ENTRADA → CONFIRMADA (`entradaPagaEm` = data do pagamento);
 * - RESTANTE pago: quita (`restantePagoEm`, forma PIX);
 * - pago sem ter o que quitar (encomenda encerrada, parcela já paga): devolução PENDENTE e log;
 * - ESTORNADO: fecha as devoluções que o estorno cobre.
 * Idempotente e à prova de corrida: a passagem para "pago" é um UPDATE condicional (`aprovadoEm` nulo)
 * na MESMA transação do efeito; duas consultas simultâneas aplicam o efeito uma vez só.
 */
async function aplicarSituacao(p: EncomendaPagamento, s: SituacaoNoGateway, agora = new Date()): Promise<StatusCobranca> {
  let status = s.status;
  if (status === "APROVADO" && s.divergencia) {
    // Não acontece num fluxo normal (a cobrança foi criada por nós, com o valor da parcela). Se
    // acontecer, nada é quitado e o caso vai para conferência manual.
    if (p.statusGateway !== s.statusGateway) {
      console.error(
        `[encomendas] PIX ${p.id} (${p.parcela}) da encomenda ${p.encomendaId} aprovado no gateway com ${s.divergencia}: ` +
          "a parcela NÃO foi marcada como paga. Confira no painel do Mercado Pago.",
      );
    }
    status = "PENDENTE";
  }
  const statusGateway = s.statusGateway.slice(0, 40);

  // Um PIX já aprovado não "desaprova" (o Mercado Pago só o leva a devolvido/contestado).
  if (p.status === "APROVADO" && status !== "APROVADO" && status !== "ESTORNADO") {
    await db.encomendaPagamento.update({ where: { id: p.id }, data: { statusGateway, consultadoEm: agora } });
    return p.status;
  }

  if (status === "APROVADO" && p.aprovadoEm === null) {
    const aprovadoEm = s.aprovadoEm ?? agora;
    const efeito = await db.$transaction(async (tx): Promise<Efeito> => {
      const marcou = await tx.encomendaPagamento.updateMany({
        where: { id: p.id, aprovadoEm: null },
        data: { status: "APROVADO", statusGateway, consultadoEm: agora, aprovadoEm },
      });
      if (marcou.count === 0) return "ja-aplicado";
      if (p.parcela === "ENTRADA") {
        const r = await tx.encomenda.updateMany({
          where: { id: p.encomendaId, status: "AGUARDANDO_ENTRADA", entradaPagaEm: null },
          data: { status: "CONFIRMADA", entradaPagaEm: aprovadoEm },
        });
        if (r.count === 1) return "confirmou";
      } else {
        const r = await tx.encomenda.updateMany({
          where: { id: p.encomendaId, status: { in: [...STATUS_CONFIRMADOS] }, restantePagoEm: null },
          data: { restantePagoEm: aprovadoEm, restanteForma: "PIX", restanteForaDoSite: false },
        });
        if (r.count === 1) return "quitou";
      }
      // Pago, mas não havia o que quitar: encerrada antes do PIX cair (tardio) ou parcela já paga
      // por outro PIX ou fora do site (duplicado). O dinheiro volta para a cliente.
      const atual = await tx.encomenda.findUnique({ where: { id: p.encomendaId }, select: { status: true } });
      const motivo = atual && statusFinal(atual.status) && atual.status !== "ENTREGUE" ? "PAGAMENTO_TARDIO" : "PAGAMENTO_DUPLICADO";
      await tx.encomendaDevolucao.create({ data: { encomendaId: p.encomendaId, pagamentoId: p.id, motivo, valor: p.valor } });
      return motivo;
    });

    if (efeito === "confirmou" || efeito === "quitou") {
      console.info(`[encomendas] ${p.parcela === "ENTRADA" ? "entrada" : "restante"} da encomenda ${p.encomendaId} paga por PIX (${p.gateway})`);
      // A parcela foi paga: os outros PIX dela ainda abertos são cancelados (não dá para pagar duas vezes).
      const abertas = await db.encomendaPagamento.findMany({
        where: { encomendaId: p.encomendaId, parcela: p.parcela, status: "PENDENTE", NOT: { id: p.id } },
      });
      for (const outra of abertas) {
        await encerrarCobranca(outra).catch((e) =>
          console.error(`[encomendas] não cancelou o PIX ${outra.id}: ${e instanceof Error ? e.message : "erro"}`),
        );
      }
    } else if (efeito !== "ja-aplicado") {
      console.error(
        `[encomendas] PIX ${p.id} (${p.parcela}) pago na encomenda ${p.encomendaId} sem ter o que quitar (${efeito}): ` +
          `devolução de ${p.valor.toFixed(2)} pendente no painel.`,
      );
    }
    return "APROVADO";
  }

  const aprovadoEm = status === "APROVADO" || status === "ESTORNADO" ? (s.aprovadoEm ?? p.aprovadoEm ?? agora) : null;
  await db.encomendaPagamento.update({ where: { id: p.id }, data: { status, statusGateway, consultadoEm: agora, aprovadoEm } });
  if (status === "ESTORNADO" && p.status !== "ESTORNADO") {
    console.warn(`[encomendas] PIX ${p.id} (${p.parcela}) da encomenda ${p.encomendaId} foi devolvido à cliente (${s.statusGateway}).`);
    await fecharDevolucoesPorEstorno(p.encomendaId, agora);
  }
  return status;
}

/** Cancela um PIX aberto no gateway (ou descobre que ele foi pago no último instante). */
async function encerrarCobranca(p: EncomendaPagamento): Promise<StatusCobranca> {
  const situacao = await gatewayDaCobranca(p).cancelar(p.referenciaExterna, esperadoDe(p));
  if (!situacao) return p.status;
  return aplicarSituacao(p, situacao);
}

/** Pergunta ao gateway como está a cobrança (no máximo uma vez a cada `intervaloMinimoMs`). */
async function sincronizarCobranca(p: EncomendaPagamento, intervaloMinimoMs = 0): Promise<StatusCobranca> {
  if (intervaloMinimoMs > 0 && p.consultadoEm && Date.now() - p.consultadoEm.getTime() < intervaloMinimoMs) return p.status;
  const situacao = await gatewayDaCobranca(p).consultar(p.referenciaExterna, esperadoDe(p));
  return situacao ? aplicarSituacao(p, situacao) : p.status;
}

/**
 * Aviso do Mercado Pago que não era de um pedido (o webhook tenta os pedidos primeiro): só cobranças
 * de encomenda que NÓS criamos são consultadas; id desconhecido é ignorado sem consulta.
 */
export async function processarAvisoDeEncomenda(pagamentoId: string): Promise<"consultado" | "desconhecido"> {
  const p = await db.encomendaPagamento.findUnique({
    where: { gateway_referenciaExterna: { gateway: "mercadopago", referenciaExterna: pagamentoId } },
  });
  if (!p) return "desconhecido";
  await sincronizarCobranca(p, INTERVALO_CONSULTA_AVISO_MS);
  return "consultado";
}

/**
 * Encerra no gateway os PIX ainda abertos da encomenda (de uma parcela, ou de todas): antes de
 * cancelar, expirar ou registrar o restante fora do site. Um que tenha sido pago no último instante
 * é aplicado (confirma, quita ou vira devolução). Falha do gateway não para quem chamou: `falhou`
 * avisa, e um pagamento que ainda cair depois vira devolução pendente pelo caminho normal.
 */
export async function encerrarCobrancasDaEncomenda(
  encomendaId: string,
  parcela?: Parcela,
): Promise<{ algumPago: boolean; falhou: boolean }> {
  const abertas = await db.encomendaPagamento.findMany({ where: { encomendaId, status: "PENDENTE", ...(parcela ? { parcela } : {}) } });
  let algumPago = false;
  let falhou = false;
  for (const p of abertas) {
    try {
      if ((await encerrarCobranca(p)) === "APROVADO") algumPago = true;
    } catch (e) {
      falhou = true;
      console.error(`[encomendas] não cancelou o PIX ${p.id} da encomenda ${encomendaId}: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  return { algumPago, falhou };
}

// --- tela da cliente ------------------------------------------------------------------------------

const ROTULO_PARCELA: Record<Parcela, string> = { ENTRADA: "entrada", RESTANTE: "restante" };

/**
 * PIX da parcela para a cliente pagar. Reaproveita o que ainda vale; senão, encerra os antigos no
 * gateway (e descobre se algum foi pago) e abre um novo, com a validade limitada ao prazo da entrada.
 * Duas chamadas ao mesmo tempo não abrem dois PIX: a mesma X-Idempotency-Key
 * ("geleio-enc-<id>-<parcela>-<n>") devolve o mesmo pagamento no Mercado Pago e a segunda gravação
 * esbarra no índice único.
 */
export async function abrirCobrancaDaParcela(encomendaId: string, userId: string, parcela: Parcela, agora: Date): Promise<CobrancaDTO> {
  const enc = await db.encomenda.findFirst({
    where: { id: encomendaId, userId },
    select: {
      id: true,
      status: true,
      entradaAte: true,
      entradaPagaEm: true,
      restantePagoEm: true,
      valorEntrada: true,
      valorRestante: true,
      user: { select: { email: true, nome: true } },
      pagamentos: { where: { parcela }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] },
    },
  });
  if (!enc) throw new ErroNegocio(404, "Encomenda não encontrada.");
  if (parcela === "ENTRADA") {
    if (enc.entradaPagaEm) throw new ErroNegocio(409, "A entrada desta encomenda já foi paga.", { statusAtual: enc.status });
    if (enc.status !== "AGUARDANDO_ENTRADA") throw new ErroNegocio(409, "Esta encomenda não está aguardando a entrada.", { statusAtual: enc.status });
  } else {
    if (enc.restantePagoEm) throw new ErroNegocio(409, "O restante desta encomenda já foi pago.", { statusAtual: enc.status });
    if (!statusConfirmado(enc.status)) {
      throw new ErroNegocio(409, "O restante só pode ser pago com a encomenda confirmada.", { statusAtual: enc.status });
    }
  }

  const t = agora.getTime();
  const abertas = enc.pagamentos.filter((p) => p.status === "PENDENTE");
  const valendo = abertas.findLast((p) => p.expiraEm.getTime() > t + FOLGA_PARA_PAGAR_MS);
  if (valendo) return paraCobrancaDTO(valendo);

  // A entrada tem prazo; o PIX novo vence no máximo nele (mas nunca em menos de 30 minutos).
  const validade = validadeDoPix(agora, parcela === "ENTRADA" ? enc.entradaAte : null);
  if (!validade) {
    const ultimoValendo = abertas.findLast((p) => p.expiraEm.getTime() > t);
    if (ultimoValendo) return paraCobrancaDTO(ultimoValendo);
    throw new ErroNegocio(409, "O prazo para pagar a entrada terminou.", { statusAtual: enc.status });
  }

  // PIX antigos ainda abertos: cancela no gateway antes de abrir outro (e descobre se algum foi pago).
  for (const antiga of abertas) {
    if ((await encerrarCobranca(antiga)) === "APROVADO") {
      throw new ErroNegocio(409, "O pagamento acabou de ser confirmado.");
    }
  }
  if (enc.pagamentos.length >= MAX_PIX_POR_PARCELA) {
    throw new ErroNegocio(429, "Esta parcela já gerou PIX demais. Fale com a loja pelo WhatsApp.");
  }

  const valor = parcela === "ENTRADA" ? enc.valorEntrada : enc.valorRestante;
  const gateway = obterGateway();
  const criada = await gateway.criarCobrancaPix(
    {
      pedidoId: referenciaDaParcela(enc.id, parcela),
      valor: valor.toNumber(),
      descricao: `Geleiô - encomenda ${codigoPedido(enc.id)} (${ROTULO_PARCELA[parcela]})`,
      email: enc.user.email,
      nome: enc.user.nome,
      expiraEm: validade,
    },
    `geleio-enc-${enc.id}-${parcela}-${enc.pagamentos.length + 1}`,
  );

  try {
    const registro = await db.encomendaPagamento.create({
      data: {
        encomendaId: enc.id,
        parcela,
        gateway: gateway.nome,
        referenciaExterna: criada.referenciaExterna,
        status: criada.status,
        statusGateway: criada.statusGateway.slice(0, 40),
        valor,
        copiaECola: criada.copiaECola,
        qrCodeBase64: criada.qrCodeBase64,
        expiraEm: criada.expiraEm,
      },
    });
    console.info(`[encomendas] PIX ${registro.id} (${parcela}) aberto para a encomenda ${enc.id} (${gateway.nome})`);
    return paraCobrancaDTO(registro);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await db.encomendaPagamento.findUnique({
        where: { gateway_referenciaExterna: { gateway: gateway.nome, referenciaExterna: criada.referenciaExterna } },
      });
      if (existente) return paraCobrancaDTO(existente);
    }
    throw e;
  }
}

export type SituacaoDaParcelaDTO = {
  /** Status efetivo da encomenda (com os prazos vencidos aplicados). */
  status: StatusEncomenda;
  entradaPaga: boolean;
  restantePaga: boolean;
  /** Último PIX desta parcela, ou `null` se ainda não houve. */
  cobranca: CobrancaDTO | null;
};

/**
 * Situação de uma parcela para a tela da encomenda. Se o PIX dela ainda está aberto e a parcela é
 * esperada, pergunta ao gateway (no máximo a cada 8 s): confirma mesmo se o aviso atrasar. Falha do
 * gateway não derruba a tela: devolve o que o banco sabe. `null` = encomenda de outra pessoa ou inexistente.
 */
export async function situacaoDaParcela(encomendaId: string, userId: string, parcela: Parcela, agora: Date): Promise<SituacaoDaParcelaDTO | null> {
  const ler = () =>
    db.encomenda.findFirst({
      where: { id: encomendaId, userId },
      select: {
        status: true,
        responderAte: true,
        entradaAte: true,
        entradaPagaEm: true,
        restantePagoEm: true,
        pagamentos: { where: { parcela }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }] },
      },
    });
  let enc = await ler();
  if (!enc) return null;

  const ultima = enc.pagamentos[0];
  const esperada = parcela === "ENTRADA" ? enc.status === "AGUARDANDO_ENTRADA" : statusConfirmado(enc.status) && !enc.restantePagoEm;
  if (esperada && ultima?.status === "PENDENTE") {
    try {
      await sincronizarCobranca(ultima, INTERVALO_CONSULTA_TELA_MS);
      enc = (await ler()) ?? enc;
    } catch (e) {
      console.error(`[encomendas] consulta do PIX ${ultima.id} falhou: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  const abertasDaEntrada = parcela === "ENTRADA" ? enc.pagamentos.filter((p) => p.status === "PENDENTE") : [];
  const pixEntradaValidoAte = abertasDaEntrada.reduce<Date | null>((max, p) => (!max || p.expiraEm > max ? p.expiraEm : max), null);
  const atual = enc.pagamentos[0];
  return {
    status: statusEfetivo({ status: enc.status, responderAte: enc.responderAte, entradaAte: enc.entradaAte, pixEntradaValidoAte }, agora),
    entradaPaga: enc.entradaPagaEm !== null,
    restantePaga: enc.restantePagoEm !== null,
    cobranca: atual ? paraCobrancaDTO(atual) : null,
  };
}

/**
 * DEMONSTRAÇÃO (PAGAMENTOS_SIMULADOS=true, sem Mercado Pago): abre ou reaproveita o PIX simulado da
 * parcela e o aprova pelo MESMO caminho de um pagamento real (confirma, quita ou vira devolução, e o
 * Financeiro conta pela data de aprovação).
 */
export async function simularPagamentoDaParcela(encomendaId: string, userId: string, parcela: Parcela, agora: Date): Promise<SituacaoDaParcelaDTO> {
  await abrirCobrancaDaParcela(encomendaId, userId, parcela, agora);
  const p = await db.encomendaPagamento.findFirst({
    where: { encomendaId, parcela, gateway: "simulado", status: "PENDENTE", encomenda: { userId } },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
  });
  if (!p) throw new ErroNegocio(409, "Não há PIX simulado aberto para esta parcela.");
  await aplicarSituacao(p, { status: "APROVADO", statusGateway: "approved", aprovadoEm: agora, divergencia: null }, agora);
  const situacao = await situacaoDaParcela(encomendaId, userId, parcela, agora);
  if (!situacao) throw new ErroNegocio(404, "Encomenda não encontrada.");
  return situacao;
}
