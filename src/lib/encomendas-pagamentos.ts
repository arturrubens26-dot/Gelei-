import "server-only";
import { Prisma, type Pagamento } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  estadoDaConferencia,
  etapaDaParcela,
  type CobrancaParaConferencia,
  type MotivoIndisponivel,
  statusConfirmado,
  statusEfetivo,
  validadeDoLink,
  type Parcela,
  type StatusEncomenda,
} from "@/lib/encomendas-regras";
import { ErroNegocio } from "@/lib/erros";
import { codigoPedido } from "@/lib/formatacao";
import { criarLink, handleInfinitePay, infinitePayConfigurado, origemPublica } from "@/lib/infinitepay";
import { itensDaParcela, referenciaDaEncomenda } from "@/lib/infinitepay-regras";
import { MAX_LINKS_POR_PARCELA } from "@/lib/limites";
import {
  FOLGA_PARA_PAGAR_MS,
  MENSAGEM_AVISO_EM_CONFERENCIA,
  MENSAGEM_RETORNO_RECENTE,
  aprovarCobrancaSimulada,
  candidatoGravado,
  cobrancaComAviso,
  confirmarCobranca,
  gatewayAtivo,
  pagamentoOnlineDisponivel,
  paraCobrancaDTO,
  urlDoAviso,
  type CobrancaDTO,
} from "@/lib/pagamentos";
import { retornoRecente, type EtapaPagamento } from "@/lib/pagamentos-regras";

/**
 * Cobranças das encomendas de lembrancinhas: a ENTRADA e o RESTANTE, cada uma com os seus links do
 * checkout da InfinitePay (PIX ou cartão até 12x), na MESMA tabela `pagamentos` dos pedidos, com
 * `encomenda_id` e `parcela` (plano 2026-10-21, seção 2.8).
 *
 * A mesma regra de ouro dos pedidos: a parcela só conta como paga depois do payment_check feito por
 * ESTE servidor (`confirmarCobranca`, em src/lib/pagamentos.ts, a única porta), com a referência do
 * NOSSO banco (`enc-<id>-<PARCELA>-<n>`). O efeito (entradaPagaEm, restantePagoEm, ou devolução
 * pendente) fica no `switch` do alvo, lá. O aviso chega pela mesma rota dos pedidos
 * (/api/webhooks/infinitepay/<referencia>/<token>) e o retorno do navegador por /pagamento/retorno.
 *
 * A InfinitePay não tem API para cancelar link nem para devolver: encerrar um link é só no nosso banco
 * (na InfinitePay ele vale até o valid_until, no máximo 1 hora), e a devolução é 100% manual na v1 (a
 * dona devolve pelo app e marca no painel).
 */

export type { CobrancaDTO };

const centavos = (valor: Prisma.Decimal) => valor.mul(100).toNumber();

const MENSAGEM_DIVERGENCIA_PARCELA =
  "Recebemos um pagamento desta parcela que precisa ser conferido. Não pague de novo: fale com a loja no Instagram @ge.leio.";

/**
 * A cobrança está SEGURANDO a encomenda: paga com divergência ou aviso da InfinitePay ainda não conferido
 * (por no máximo `HORAS_MAX_EM_CONFERENCIA`, ver `estadoDaConferencia`), ou retorno do navegador há menos
 * de 30 min. Enquanto isso o dinheiro pode ter entrado: a encomenda não expira, a cliente não desiste e
 * a dona não registra a parcela por fora. Depois do limite, nada disso segura mais.
 */
export function cobrancaEmConferencia(c: CobrancaParaConferencia, agora: number = Date.now()): boolean {
  return estadoDaConferencia(c, agora) !== null;
}

/**
 * Encerra no NOSSO banco os links ainda abertos da encomenda (de uma parcela, ou de todas): ao
 * desistir, cancelar ou expirar. Não há cancelamento na API: na InfinitePay o link vale até vencer (no
 * máximo 1 hora). Se ele for pago, a confirmação vê a encomenda encerrada e registra devolução
 * pendente. `linkAberto`: havia link ainda valendo (o painel avisa a dona).
 */
export async function encerrarCobrancasDaEncomenda(encomendaId: string, parcela?: Parcela): Promise<{ linkAberto: boolean }> {
  const agora = new Date();
  const abertas = await db.pagamento.findMany({
    where: { encomendaId, status: "PENDENTE", ...(parcela ? { parcela } : {}) },
    select: { id: true, gateway: true, expiraEm: true },
  });
  if (abertas.length > 0) {
    await db.pagamento.updateMany({ where: { id: { in: abertas.map((p) => p.id) }, status: "PENDENTE" }, data: { status: "CANCELADO" } });
  }
  return { linkAberto: abertas.some((p) => p.gateway === "infinitepay" && p.expiraEm > agora) };
}

/**
 * "Marquei como devolvida" no painel: fecha SÓ as devoluções que a tela mostrava (`ids`), todas ou nenhuma,
 * numa transação. Se alguma já não está pendente (outra aba fechou, ou o id não é desta encomenda),
 * nada muda e devolve `false` (a ação responde 409 "devolucao-mudou"). Uma devolução nova, que apareceu
 * depois da tela, continua pendente para a dona ver e devolver à parte.
 */
export async function marcarDevolucoesFeitas(
  encomendaId: string,
  ids: readonly string[],
  adminId: string,
  observacao: string | null,
  agora: Date,
): Promise<boolean> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return false;
  return db.$transaction(async (tx) => {
    const { count } = await tx.encomendaDevolucao.updateMany({
      where: { id: { in: unicos }, encomendaId, status: "PENDENTE" },
      data: { status: "FEITA", feitaEm: agora, observacao, registradaPorId: adminId },
    });
    if (count !== unicos.length) {
      // Desfaz o que fechou: tudo ou nada.
      throw new ErroNegocio(409, "As devoluções mudaram.", { motivo: "devolucao-mudou" });
    }
    return true;
  }).catch((e) => {
    if (e instanceof ErroNegocio && e.status === 409) return false;
    throw e;
  });
}

// --- abrir o link da parcela ----------------------------------------------------------------------

/**
 * Link de pagamento da parcela para a cliente pagar (PIX ou cartão até 12x, na página da InfinitePay).
 * - Encomenda de outra conta ou inexistente: 404. ENTRADA só em AGUARDANDO_ENTRADA; RESTANTE só com a
 *   encomenda confirmada e ainda não quitada (409, com `detalhes.statusAtual`).
 * - Pagamento da parcela com divergência, aviso em conferência ou retorno recente: 409 ("não pague de
 *   novo" / "aguarde"); se a reconferência confirmar, 409 "acabou de ser confirmado".
 * - Link PENDENTE que vale por mais de 5 min: devolve o mesmo. Os outros abertos viram CANCELADO no banco.
 * - `valid_until` = min(agora + 60 min, prazo da entrada); na ENTRADA, com menos de 5 min até o prazo: 409.
 * - No máximo 10 links por parcela (429). Duas chamadas ao mesmo tempo: a segunda gravação esbarra no
 *   índice único da referência e devolve a primeira.
 * - InfinitePay fora: 502; pagamento desligado: 503.
 */
export async function abrirLinkDaParcela(encomendaId: string, userId: string, parcela: Parcela, agora: Date): Promise<CobrancaDTO> {
  if (encomendaId.length === 0 || encomendaId.length > 100) throw new ErroNegocio(404, "Encomenda não encontrada.");
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
      telefone: true,
      user: { select: { email: true, nome: true } },
      address: true,
      pagamentos: { where: { parcela }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] },
    },
  });
  if (!enc) throw new ErroNegocio(404, "Encomenda não encontrada.");
  conferirParcelaPagavel(enc, parcela);

  // Conferência recente (no máximo HORAS_MAX_EM_CONFERENCIA para o aviso e a divergência): o dinheiro pode
  // ter entrado, então NÃO abre link novo. Passado o limite, um aviso que nunca fechou deixa de bloquear
  // (a dona já teve tempo de conferir no app e agir).
  const t0 = agora.getTime();
  if (enc.pagamentos.some((p) => estadoDaConferencia(p, t0) === "DIVERGENTE")) throw new ErroNegocio(409, MENSAGEM_DIVERGENCIA_PARCELA);
  // Aviso de pagamento não resolvido (de qualquer link da parcela, de qualquer idade): reconfere, porque
  // pode confirmar; se não fechar e a conferência ainda é recente, não abre link.
  const comAviso = cobrancaComAviso(enc.pagamentos);
  if (comAviso) {
    const r = await confirmarCobranca(comAviso, candidatoGravado(comAviso)!, "gravado").catch(() => "TRANSITORIO" as const);
    if (r === "APROVADO") throw new ErroNegocio(409, "O pagamento desta parcela acabou de ser confirmado.");
    const aindaSegura = estadoDaConferencia(comAviso, t0) === "CONFIRMANDO";
    if (r === "DIVERGENTE" && aindaSegura) throw new ErroNegocio(409, MENSAGEM_DIVERGENCIA_PARCELA);
    if (r !== "INVALIDO" && r !== "DIVERGENTE" && aindaSegura) throw new ErroNegocio(409, MENSAGEM_AVISO_EM_CONFERENCIA);
  }
  if (enc.pagamentos.some((c) => (c.status === "PENDENTE" || c.status === "CANCELADO") && retornoRecente(c.retornoEm, t0))) {
    throw new ErroNegocio(409, MENSAGEM_RETORNO_RECENTE);
  }
  const gateway = gatewayAtivo();

  const t = agora.getTime();
  const abertas = enc.pagamentos.filter((p) => p.status === "PENDENTE");
  const valendo = abertas.findLast(
    (p) => p.gateway === gateway && p.expiraEm.getTime() > t + FOLGA_PARA_PAGAR_MS && (gateway === "simulado" || p.checkoutUrl),
  );
  if (valendo) return paraCobrancaDTO(valendo, t);

  // A entrada tem prazo: o link novo nunca passa dele (e com menos de 5 min, não abre).
  const validade = validadeDoLink(agora, parcela === "ENTRADA" ? enc.entradaAte : null);
  if (!validade) throw new ErroNegocio(409, "O prazo para pagar a entrada terminou.", { statusAtual: enc.status });

  if (abertas.length > 0) {
    await db.pagamento.updateMany({ where: { id: { in: abertas.map((p) => p.id) }, status: "PENDENTE" }, data: { status: "CANCELADO" } });
  }
  if (enc.pagamentos.length >= MAX_LINKS_POR_PARCELA) {
    throw new ErroNegocio(429, "Esta parcela já abriu pagamentos demais. Fale com a loja no Instagram @ge.leio.");
  }

  const referencia = referenciaDaEncomenda(enc.id, parcela, enc.pagamentos.length + 1);
  const valor = parcela === "ENTRADA" ? enc.valorEntrada : enc.valorRestante;
  let checkoutUrl: string | null = null;
  let faturaSlug: string | null = null;
  if (gateway === "infinitepay") {
    const origem = origemPublica()!;
    try {
      const link = await criarLink({
        handle: handleInfinitePay()!,
        referencia,
        itens: itensDaParcela({ codigo: codigoPedido(enc.id), parcela, valorCentavos: centavos(valor) }),
        totalCentavos: centavos(valor),
        urlRetorno: `${origem}/pagamento/retorno`,
        urlAviso: urlDoAviso(origem, referencia),
        validoAte: validade,
        cliente: { nome: enc.user.nome, email: enc.user.email, telefone: enc.telefone },
        endereco: enc.address,
      });
      checkoutUrl = link.url;
      faturaSlug = link.slug;
    } catch (e) {
      console.error(`[encomendas] não abriu o link (${parcela}) da encomenda ${enc.id}: ${e instanceof Error ? e.message : "erro"}`);
      throw new ErroNegocio(502, "Não conseguimos abrir o pagamento agora. Tente de novo em instantes.");
    }
  }

  try {
    // A criação do link levou até 10 s: a encomenda pode ter mudado (desistência, cancelamento,
    // expiração, parcela paga). A linha fica travada (FOR UPDATE) enquanto o link é gravado.
    const registro = await db.$transaction(async (tx) => {
      const [atual] = await tx.$queryRaw<{ status: StatusEncomenda; entrada_paga: boolean; restante_pago: boolean }[]>`
        SELECT "status"::text AS "status", "entrada_paga_em" IS NOT NULL AS "entrada_paga", "restante_pago_em" IS NOT NULL AS "restante_pago"
        FROM "encomendas" WHERE "id" = ${enc.id} FOR UPDATE`;
      if (!atual) throw new ErroNegocio(404, "Encomenda não encontrada.");
      conferirParcelaPagavel(
        { status: atual.status, entradaPagaEm: atual.entrada_paga ? agora : null, restantePagoEm: atual.restante_pago ? agora : null },
        parcela,
      );
      return tx.pagamento.create({
        data: {
          encomendaId: enc.id,
          parcela,
          gateway,
          referenciaExterna: referencia,
          status: "PENDENTE",
          statusGateway: "aberto",
          valor,
          checkoutUrl,
          faturaSlug,
          expiraEm: validade,
        },
      });
    });
    console.info(`[encomendas] link ${registro.id} (${parcela}) aberto para a encomenda ${enc.id} (${gateway}, ${referencia})`);
    return paraCobrancaDTO(registro);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await db.pagamento.findUnique({ where: { gateway_referenciaExterna: { gateway, referenciaExterna: referencia } } });
      if (existente) return paraCobrancaDTO(existente);
    }
    throw e;
  }
}

/** 409 se a parcela não pode ser paga agora (já paga, ou a encomenda não está no status certo). */
function conferirParcelaPagavel(
  enc: { status: StatusEncomenda; entradaPagaEm: Date | null; restantePagoEm: Date | null },
  parcela: Parcela,
): void {
  if (parcela === "ENTRADA") {
    if (enc.entradaPagaEm) throw new ErroNegocio(409, "A entrada desta encomenda já foi paga.", { statusAtual: enc.status });
    if (enc.status !== "AGUARDANDO_ENTRADA") throw new ErroNegocio(409, "Esta encomenda não está aguardando a entrada.", { statusAtual: enc.status });
  } else {
    if (enc.restantePagoEm) throw new ErroNegocio(409, "O restante desta encomenda já foi pago.", { statusAtual: enc.status });
    if (!statusConfirmado(enc.status)) {
      throw new ErroNegocio(409, "O restante só pode ser pago com a encomenda confirmada.", { statusAtual: enc.status });
    }
  }
}

// --- tela da cliente ------------------------------------------------------------------------------

export type SituacaoDaParcelaDTO = {
  /** Status efetivo da encomenda (com os prazos vencidos aplicados). */
  status: StatusEncomenda;
  entradaPaga: boolean;
  restantePaga: boolean;
  /** Etapa do pagamento DESTA parcela (`etapaDaParcela`): PAGAR, CONFIRMANDO, PAGO, EXPIRADO, CANCELADO ou INDISPONIVEL. */
  etapa: EtapaPagamento;
  /**
   * Só com `etapa` INDISPONIVEL (senão null): "NAO_LIBERADA" (a entrada antes da aprovação, o restante
   * antes da entrada paga) ou "PAGAMENTO_FORA_DO_AR" (pagamento pelo site desligado).
   */
  motivoIndisponivel: MotivoIndisponivel | null;
  /**
   * Esta parcela tem pagamento em conferência (aviso da InfinitePay ainda não conferido, retorno do
   * navegador há menos de 30 min ou divergência; no máximo 24 h): o dinheiro pode ter entrado. Mostre
   * "estamos conferindo o seu pagamento", nunca "Pagar" nem "Aprovada! Pague até…". É o mesmo sinal que
   * deixa `etapa` em CONFIRMANDO (ou o 409 do POST).
   */
  pagamentoEmConferencia: boolean;
  /** Último link desta parcela, ou `null` se ainda não houve (`checkoutUrl` só enquanto vale). */
  cobranca: CobrancaDTO | null;
};

async function lerParaSituacao(encomendaId: string, userId: string) {
  if (encomendaId.length === 0 || encomendaId.length > 100) return null;
  return db.encomenda.findFirst({
    where: { id: encomendaId, userId },
    select: {
      status: true,
      responderAte: true,
      entradaAte: true,
      entradaPagaEm: true,
      restantePagoEm: true,
      // As duas parcelas (no máximo 10 links cada): o status efetivo olha a entrada em conferência.
      pagamentos: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 2 * MAX_LINKS_POR_PARCELA + 4 },
    },
  });
}

function montarSituacao(enc: NonNullable<Awaited<ReturnType<typeof lerParaSituacao>>>, parcela: Parcela, agora: Date): SituacaoDaParcelaDTO {
  const t = agora.getTime();
  const daParcela = enc.pagamentos.filter((p) => p.parcela === parcela);
  const daEntrada = enc.pagamentos.filter((p) => p.parcela === "ENTRADA");
  const linkEntradaValidoAte = daEntrada
    .filter((p) => p.status === "PENDENTE")
    .reduce<Date | null>((max, p) => (!max || p.expiraEm > max ? p.expiraEm : max), null);
  const status = statusEfetivo(
    {
      status: enc.status,
      responderAte: enc.responderAte,
      entradaAte: enc.entradaAte,
      linkEntradaValidoAte,
      entradaEmConfirmacao: daEntrada.some((p) => cobrancaEmConferencia(p, t)),
    },
    agora,
  );
  const ultima = daParcela[0] ?? null;
  const estados = daParcela.map((p) => estadoDaConferencia(p, t));
  return {
    status,
    entradaPaga: enc.entradaPagaEm !== null,
    restantePaga: enc.restantePagoEm !== null,
    ...etapaDaParcela({
      parcela,
      status,
      paga: parcela === "ENTRADA" ? enc.entradaPagaEm !== null : enc.restantePagoEm !== null,
      gatewayAtivo: pagamentoOnlineDisponivel(),
      divergente: estados.includes("DIVERGENTE"),
      emConfirmacao: estados.includes("CONFIRMANDO"),
    }),
    pagamentoEmConferencia: estados.some((e) => e !== null),
    cobranca: ultima ? paraCobrancaDTO(ultima, t) : null,
  };
}

/**
 * Situação de uma parcela para a tela da encomenda. Com um aviso ainda não conferido, confere de novo
 * no payment_check (no máximo a cada 8 s, por cobrança): confirma mesmo se o aviso atrasar. Falha da
 * InfinitePay não derruba a tela: devolve o que o banco sabe. `null` = encomenda de outra pessoa ou
 * inexistente.
 */
export async function situacaoDaParcela(encomendaId: string, userId: string, parcela: Parcela, agora: Date): Promise<SituacaoDaParcelaDTO | null> {
  let enc = await lerParaSituacao(encomendaId, userId);
  if (!enc) return null;
  const esperada = parcela === "ENTRADA" ? enc.entradaPagaEm === null : enc.restantePagoEm === null;
  const emAndamento = cobrancaComAviso(enc.pagamentos.filter((p) => p.parcela === parcela));
  if (esperada && emAndamento && infinitePayConfigurado()) {
    try {
      await confirmarCobranca(emAndamento, candidatoGravado(emAndamento)!, "gravado");
      enc = (await lerParaSituacao(encomendaId, userId)) ?? enc;
    } catch (e) {
      console.error(`[encomendas] conferência da cobrança ${emAndamento.id} falhou: ${e instanceof Error ? e.name : "erro"}`);
    }
  }
  return montarSituacao(enc, parcela, agora);
}

/**
 * DEMONSTRAÇÃO (PAGAMENTOS_SIMULADOS=true, sem InfinitePay): abre ou reaproveita o link simulado da
 * parcela e o aprova pelo MESMO caminho de um pagamento real (confirma, quita ou vira devolução, e o
 * Financeiro conta pela data de aprovação).
 */
export async function simularPagamentoDaParcela(encomendaId: string, userId: string, parcela: Parcela, agora: Date): Promise<SituacaoDaParcelaDTO> {
  await abrirLinkDaParcela(encomendaId, userId, parcela, agora);
  const p: Pagamento | null = await db.pagamento.findFirst({
    where: { encomendaId, parcela, gateway: "simulado", status: "PENDENTE", encomenda: { userId } },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
  });
  if (!p || !(await aprovarCobrancaSimulada(p))) throw new ErroNegocio(409, "Não há pagamento simulado aberto para esta parcela.");
  const situacao = await situacaoDaParcela(encomendaId, userId, parcela, agora);
  if (!situacao) throw new ErroNegocio(404, "Encomenda não encontrada.");
  return situacao;
}
