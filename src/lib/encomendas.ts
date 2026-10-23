import "server-only";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { validarEnderecoComCep } from "@/lib/cep";
import { dadosLoja } from "@/lib/dados-loja";
import { db } from "@/lib/db";
import { hojeNaLoja } from "@/lib/despesas";
import { POLITICA_VERSAO, textosDaPolitica, versaoDaPoliticaConhecida } from "@/lib/encomendas-politica";
import {
  ROTULO_STATUS_ENCOMENDA,
  STATUS_CONFIRMADOS,
  acoesDaCliente,
  calcularValores,
  conferirPotinhos,
  FOLGA_DA_ENTRADA_MS,
  devolucaoNaDesistencia,
  horasParaPagarEntrada,
  linhaDoTempo,
  mesmaEncomenda,
  pesoDaEncomenda,
  prazosDaEncomenda,
  statusEfetivo,
  validarDatas,
  type Ator,
  type EncomendaEntrada,
  type EncomendaParaRegras,
  type ModoEntrega,
  type StatusEncomenda,
} from "@/lib/encomendas-regras";
import { cobrancaEmConferencia, encerrarCobrancasDaEncomenda } from "@/lib/encomendas-pagamentos";
import { taxaDeEntregaAtualCentavos } from "@/lib/entrega";
import { MENSAGEM_FORA_DA_AREA, calcularFrete, cepAtendido } from "@/lib/entrega-regras";
import { CAMPOS_ENDERECO, obterOuCriarEndereco, type EnderecoSalvo } from "@/lib/enderecos";
import { ErroNegocio } from "@/lib/erros";
import { codigoPedido } from "@/lib/formatacao";
import { lerConfigLembrancinhas, pendenciasParaAbrir } from "@/lib/lembrancinhas";
import { MAX_ENCOMENDAS_ABERTAS } from "@/lib/limites";
import { pagamentoOnlineDisponivel } from "@/lib/pagamentos";
import { separarNome } from "@/lib/produtos-regras";

/**
 * Encomendas de lembrancinhas, lado da cliente: solicitar, listar, ver, desistir, e a expiração
 * "preguiçosa" (sem rotina agendada: os prazos vencidos são gravados com UPDATE condicional na
 * próxima leitura ou ação). Regras puras em src/lib/encomendas-regras.ts; cobranças em
 * src/lib/encomendas-pagamentos.ts; painel em src/lib/encomendas-admin.ts.
 *
 * O servidor nunca confia em preço, peso, frete, datas ou "hoje" vindos do cliente: tudo é lido do
 * banco e recalculado aqui, em centavos inteiros, com o relógio do servidor (`agora`).
 */

// --- DTOs -----------------------------------------------------------------------------------------

export type EnderecoDTO = Omit<EnderecoSalvo, "id">;

export type DevolucaoResumoDTO = {
  /** NAO_SE_APLICA: nada a devolver; PENDENTE: falta devolver algo; FEITA: tudo devolvido. */
  status: "NAO_SE_APLICA" | "PENDENTE" | "FEITA";
  /** Total a devolver (pendente + feito), em reais. */
  valor: number;
  pendente: number;
  devolvido: number;
  /** Quando a última devolução foi feita (só com status FEITA). */
  devolvidaEm: string | null;
};

/** Encomenda para a cliente (página da encomenda, lista e respostas da API). Dinheiro em reais. */
export type EncomendaDTO = {
  id: string;
  /** "#9F3K2XQP" */
  codigo: string;
  /** Como está no banco. */
  status: StatusEncomenda;
  /** Como a tela deve mostrar AGORA (prazos vencidos aplicados). Use este. */
  statusEfetivo: StatusEncomenda;
  rotulo: string;
  criadaEm: string;
  /** "AAAA-MM-DD" */
  dataFesta: string;
  dataEntrega: string;
  modoEntrega: ModoEntrega;
  endereco: EnderecoDTO | null;
  /** Endereço da loja, quando é retirada. */
  retirada: (typeof dadosLoja)["endereco"] | null;
  /** Só dígitos, com DDD. */
  telefone: string;
  observacao: string | null;
  itens: { productId: string; sabor: string; quantidade: number; precoUnitario: number; subtotal: number; imagemUrl: string }[];
  potinhos: number;
  subtotal: number;
  frete: number;
  total: number;
  entrada: number;
  restante: number;
  pesoTotalGramas: number;
  /**
   * ISO. `entradaAte` só depois da aprovação: é o prazo que a cliente lê e o `valid_until` do link
   * (depois dele não se abre link). `horasParaPagarEntrada`: as horas reais que ela tem (ou teve) para
   * pagar, min(24 h, até o corte), para a tela não escrever "24 horas" fixo; antes da aprovação, o máximo
   * possível agora.
   */
  prazos: { responderAte: string; entradaAte: string | null; corteEm: string; horasParaPagarEntrada: number };
  /**
   * A entrada passou de `prazos.entradaAte`, mas a encomenda ainda não expirou: há 30 min de folga para
   * o aviso do pagamento chegar. Não dá para pagar mais; se ela acabou de pagar, a confirmação ainda
   * vale. Mostre "o prazo terminou; se você acabou de pagar, aguarde a confirmação".
   */
  entradaEmFolga: boolean;
  /**
   * Há pagamento em conferência (aviso da InfinitePay ainda não conferido, retorno do navegador há menos
   * de 30 min ou pago com divergência; no máximo 24 h) em cada parcela. Com `true`, a tela diz "estamos
   * conferindo o seu pagamento" e NÃO mostra "Aprovada! Pague até…" nem "Pagar".
   */
  pagamentoEmConferencia: { entrada: boolean; restante: boolean };
  entradaPagaEm: string | null;
  restantePagoEm: string | null;
  /** Restante recebido pela loja fora do site (dinheiro, PIX direto). */
  restanteForaDoSite: boolean;
  motivoRecusa: string | null;
  motivoCancelamento: string | null;
  canceladaPor: Ator | null;
  devolucao: DevolucaoResumoDTO;
  acoes: {
    /** `true` só quando o POST .../pagamento abriria o link (não nos últimos 5 min do prazo, nem em conferência). */
    pagarEntrada: boolean;
    pagarRestante: boolean;
    /** Prévia da desistência AGORA; mande `devolucaoCentavos` no POST .../desistir. */
    desistir: { devolucao: number; retido: number; devolucaoCentavos: number; retidoCentavos: number } | null;
    /** Há pagamento em conferência: o POST de desistência responderia 409 "aguarde"; mostre o botão desabilitado. */
    desistirBloqueado: boolean;
  };
  /**
   * `percentualAceito`: o que a cliente aceitou ao solicitar (os `textos` são desse percentual: é o que ela
   * leu). `percentualRetido`: o que vale de fato (na aprovação, desce se o painel baixou o percentual
   * depois; nunca passa do aceito) e é o que a prévia da desistência usa.
   */
  politica: { versao: string; aceitaEm: string; percentualAceito: number; percentualRetido: number; textos: string[] };
  linhaDoTempo: { quando: string; texto: string }[];
};

const centavos = (valor: Prisma.Decimal) => valor.mul(100).toNumber();
/** Centavos inteiros → Decimal em reais, exato (sem passar por float). */
const reaisDe = (c: number) => new Prisma.Decimal(c).div(100);
/** Coluna DATE: o Prisma devolve meia-noite UTC desse dia. */
const diaDe = (d: Date) => d.toISOString().slice(0, 10);
const dateDoDia = (dia: string) => new Date(`${dia}T00:00:00Z`);

export const incluirEncomenda = {
  address: { select: CAMPOS_ENDERECO },
  itens: { orderBy: { productId: "asc" }, include: { product: { select: { nome: true, imagemUrl: true } } } },
  // Só o que as regras e o painel usam (o link de pagamento a tela lê pela rota própria).
  pagamentos: {
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: {
      id: true,
      parcela: true,
      gateway: true,
      referenciaExterna: true,
      status: true,
      statusGateway: true,
      valor: true,
      metodo: true,
      parcelas: true,
      valorPago: true,
      expiraEm: true,
      criadoEm: true,
      aprovadoEm: true,
      avisoTransacaoNsu: true,
      avisoSlug: true,
      avisadoEm: true,
      retornoEm: true,
    },
  },
  devolucoes: { orderBy: [{ criadaEm: "asc" }, { id: "asc" }] },
} satisfies Prisma.EncomendaInclude;

export type EncomendaCompleta = Prisma.EncomendaGetPayload<{ include: typeof incluirEncomenda }>;

/** O que as regras puras precisam (datas, valores em centavos, link da entrada aberto ou em conferência). */
export function paraRegras(e: EncomendaCompleta, agora: Date = new Date()): EncomendaParaRegras {
  const daEntrada = e.pagamentos.filter((p) => p.parcela === "ENTRADA");
  const t = agora.getTime();
  const linkEntradaValidoAte = daEntrada
    .filter((p) => p.status === "PENDENTE")
    .reduce<Date | null>((max, p) => (!max || p.expiraEm > max ? p.expiraEm : max), null);
  return {
    status: e.status,
    responderAte: e.responderAte,
    entradaAte: e.entradaAte,
    corteEm: e.corteEm,
    linkEntradaValidoAte,
    entradaEmConfirmacao: daEntrada.some((p) => cobrancaEmConferencia(p, t)),
    restanteEmConfirmacao: e.pagamentos.some((p) => p.parcela === "RESTANTE" && cobrancaEmConferencia(p, t)),
    entradaPagaEm: e.entradaPagaEm,
    restantePagoEm: e.restantePagoEm,
    valorEntradaCentavos: centavos(e.valorEntrada),
    valorRestanteCentavos: centavos(e.valorRestante),
    percentualRetido: e.percentualRetido,
  };
}

export function resumoDaDevolucao(e: Pick<EncomendaCompleta, "devolucoes">): DevolucaoResumoDTO {
  let pendente = 0;
  let devolvido = 0;
  let devolvidaEm: Date | null = null;
  for (const d of e.devolucoes) {
    if (d.status === "PENDENTE") pendente += centavos(d.valor);
    else {
      devolvido += centavos(d.valor);
      if (d.feitaEm && (!devolvidaEm || d.feitaEm > devolvidaEm)) devolvidaEm = d.feitaEm;
    }
  }
  const status = pendente > 0 ? "PENDENTE" : devolvido > 0 ? "FEITA" : "NAO_SE_APLICA";
  return {
    status,
    valor: (pendente + devolvido) / 100,
    pendente: pendente / 100,
    devolvido: devolvido / 100,
    devolvidaEm: status === "FEITA" && devolvidaEm ? devolvidaEm.toISOString() : null,
  };
}

export function textosDaPoliticaDe(e: EncomendaCompleta): string[] {
  // Versão antiga sem texto guardado aqui (não deve acontecer): não derruba a página.
  if (!versaoDaPoliticaConhecida(e.politicaVersao)) return [];
  return textosDaPolitica(e.politicaVersao, {
    corteEm: e.corteEm,
    entradaCentavos: centavos(e.valorEntrada),
    restanteCentavos: centavos(e.valorRestante),
    freteCentavos: centavos(e.frete),
    modo: e.modoEntrega,
    // O texto que a cliente leu e aceitou (o percentual efetivo pode ser menor, a favor dela).
    percentualRetido: e.percentualAceito,
  });
}

export function linhaDoTempoDe(e: EncomendaCompleta): { quando: string; texto: string }[] {
  return linhaDoTempo({
    status: e.status,
    modo: e.modoEntrega,
    criadaEm: e.criadaEm,
    aprovadaEm: e.aprovadaEm,
    entradaAte: e.entradaAte,
    entradaPagaEm: e.entradaPagaEm,
    entradaForaDoSite: e.entradaForaDoSite,
    producaoIniciadaEm: e.producaoIniciadaEm,
    prontaEm: e.prontaEm,
    restantePagoEm: e.restantePagoEm,
    restanteForaDoSite: e.restanteForaDoSite,
    entregueEm: e.entregueEm,
    encerradaEm: e.encerradaEm,
    motivoRecusa: e.motivoRecusa,
    canceladaPor: e.canceladaPor,
    devolucoes: e.devolucoes.map((d) => ({ valorCentavos: centavos(d.valor), criadaEm: d.criadaEm, feitaEm: d.feitaEm })),
  });
}

export function enderecoDe(e: Pick<EncomendaCompleta, "address">): EnderecoDTO | null {
  if (!e.address) return null;
  const { cep, rua, numero, complemento, bairro, cidade, estado } = e.address;
  return { cep, rua, numero, complemento, bairro, cidade, estado };
}

export function itensDe(e: Pick<EncomendaCompleta, "itens">): EncomendaDTO["itens"] {
  return e.itens.map((i) => ({
    productId: i.productId,
    sabor: separarNome(i.product.nome).sabor,
    quantidade: i.quantidade,
    precoUnitario: i.precoUnitario.toNumber(),
    subtotal: i.precoUnitario.mul(i.quantidade).toNumber(),
    imagemUrl: i.product.imagemUrl,
  }));
}

export function paraEncomendaDTO(e: EncomendaCompleta, agora: Date): EncomendaDTO {
  const regras = paraRegras(e, agora);
  const efetivo = statusEfetivo(regras, agora);
  const acoes = acoesDaCliente(regras, agora);
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
    endereco: enderecoDe(e),
    retirada: e.modoEntrega === "RETIRADA" ? dadosLoja.endereco : null,
    telefone: e.telefone,
    observacao: e.observacao,
    itens: itensDe(e),
    potinhos: e.potinhos,
    subtotal: e.subtotal.toNumber(),
    frete: e.frete.toNumber(),
    total: e.total.toNumber(),
    entrada: e.valorEntrada.toNumber(),
    restante: e.valorRestante.toNumber(),
    pesoTotalGramas: e.pesoTotalGramas,
    prazos: {
      responderAte: e.responderAte.toISOString(),
      entradaAte: e.entradaAte?.toISOString() ?? null,
      corteEm: e.corteEm.toISOString(),
      horasParaPagarEntrada: horasParaPagarEntrada(e, agora),
    },
    entradaEmFolga: efetivo === "AGUARDANDO_ENTRADA" && e.entradaAte !== null && agora.getTime() >= e.entradaAte.getTime(),
    pagamentoEmConferencia: { entrada: Boolean(regras.entradaEmConfirmacao), restante: Boolean(regras.restanteEmConfirmacao) },
    entradaPagaEm: e.entradaPagaEm?.toISOString() ?? null,
    restantePagoEm: e.restantePagoEm?.toISOString() ?? null,
    restanteForaDoSite: e.restanteForaDoSite,
    motivoRecusa: e.motivoRecusa,
    motivoCancelamento: e.motivoCancelamento,
    canceladaPor: e.canceladaPor,
    devolucao: resumoDaDevolucao(e),
    acoes: {
      pagarEntrada: acoes.pagarEntrada,
      pagarRestante: acoes.pagarRestante,
      desistir: acoes.desistir
        ? {
            devolucao: acoes.desistir.devolucao / 100,
            retido: acoes.desistir.retido / 100,
            devolucaoCentavos: acoes.desistir.devolucao,
            retidoCentavos: acoes.desistir.retido,
          }
        : null,
      desistirBloqueado: acoes.desistirBloqueado,
    },
    politica: {
      versao: e.politicaVersao,
      aceitaEm: e.politicaAceitaEm.toISOString(),
      percentualAceito: e.percentualAceito,
      percentualRetido: e.percentualRetido,
      textos: textosDaPoliticaDe(e),
    },
    linhaDoTempo: linhaDoTempoDe(e),
  };
}

// --- leitura (sempre com where { id, userId }: outra pessoa recebe "não encontrada") ----------------

const MAX_NA_LISTA = 50;

/**
 * Encomendas da cliente, da mais recente para a mais antiga (até 50). Só LEITURA: com `agora` o
 * status efetivo já sai certo, então a página de servidor não precisa gravar nada no render (grave
 * depois, com `after(() => expirarVencidas(agora, { userId }))`).
 */
export async function listarEncomendasDoUsuario(userId: string, agora: Date): Promise<EncomendaDTO[]> {
  const lista = await db.encomenda.findMany({
    where: { userId },
    orderBy: [{ criadaEm: "desc" }, { id: "desc" }],
    take: MAX_NA_LISTA,
    include: incluirEncomenda,
  });
  return lista.map((e) => paraEncomendaDTO(e, agora));
}

/**
 * A cliente já fez alguma encomenda de lembrancinhas (de qualquer status)? Consulta barata (índice
 * user_id + criada_em), para o menu mostrar "Minhas encomendas" mesmo com o recurso fechado.
 */
export async function temEncomendas(userId: string): Promise<boolean> {
  return (await db.encomenda.findFirst({ where: { userId }, select: { id: true } })) !== null;
}

/** A encomenda da cliente; `null` se não existir ou for de outra pessoa. Só leitura. */
export async function buscarEncomendaDoUsuario(id: string, userId: string, agora: Date): Promise<EncomendaDTO | null> {
  if (id.length === 0 || id.length > 100) return null;
  const e = await db.encomenda.findFirst({ where: { id, userId }, include: incluirEncomenda });
  return e ? paraEncomendaDTO(e, agora) : null;
}

// --- expiração preguiçosa -------------------------------------------------------------------------

/**
 * Grava os prazos vencidos (UPDATE condicional; seguro em paralelo com aprovação e pagamento):
 * - SOLICITADA sem resposta até `responderAte` → EXPIRADA (sem cobrança, em lote);
 * - AGUARDANDO_ENTRADA 30 min depois de `entradaAte` (a folga, `FOLGA_DA_ENTRADA_MS`) → EXPIRADA, mas só
 *   sem link da entrada ainda valendo e sem pagamento dela em conferência (aviso não conferido, retorno
 *   recente, divergência; por no máximo 24 h): o dinheiro pode ter entrado, e a confirmação ainda precisa
 *   achar a encomenda aguardando. Os links vencidos viram CANCELADO no banco; um pagamento que ainda
 *   chegue depois vira devolução pendente.
 * A aprovação só passa com `responder_ate > agora` e a expiração só com `responder_ate <= agora`: as
 * duas nunca valem juntas.
 */
export async function expirarVencidas(agora: Date, filtro: { userId?: string; encomendaId?: string } = {}): Promise<{ expiradas: number }> {
  const doFiltro = Prisma.sql`${filtro.userId ? Prisma.sql`AND "user_id" = ${filtro.userId}` : Prisma.empty} ${
    filtro.encomendaId ? Prisma.sql`AND "id" = ${filtro.encomendaId}` : Prisma.empty
  }`;
  // Expirou no próprio prazo (não na hora em que alguém olhou): a linha do tempo mostra a data certa.
  let expiradas = await db.$executeRaw`
    UPDATE "encomendas" SET "status" = 'EXPIRADA', "encerrada_em" = "responder_ate"
    WHERE "status" = 'SOLICITADA' AND "responder_ate" <= ${agora} ${doFiltro}`;
  // A entrada só expira depois da folga: quem paga no último minuto ainda confirma.
  const fimDaFolga = new Date(agora.getTime() - FOLGA_DA_ENTRADA_MS);

  const vencidas = await db.encomenda.findMany({
    where: {
      ...(filtro.userId ? { userId: filtro.userId } : {}),
      ...(filtro.encomendaId ? { id: filtro.encomendaId } : {}),
      status: "AGUARDANDO_ENTRADA",
      entradaAte: { lte: fimDaFolga },
    },
    select: {
      id: true,
      entradaAte: true,
      pagamentos: {
        where: { parcela: "ENTRADA" },
        select: { status: true, expiraEm: true, statusGateway: true, avisoTransacaoNsu: true, avisoSlug: true, avisadoEm: true, retornoEm: true },
      },
    },
    orderBy: { entradaAte: "asc" },
    take: 50,
  });
  for (const v of vencidas) {
    // Ainda há um link valendo (a cliente pode pagar até ele vencer) ou um pagamento em conferência.
    if (v.pagamentos.some((p) => (p.status === "PENDENTE" && p.expiraEm > agora) || cobrancaEmConferencia(p, agora.getTime()))) continue;
    if (v.pagamentos.some((p) => p.status === "PENDENTE")) await encerrarCobrancasDaEncomenda(v.id, "ENTRADA");
    const ultimoVencimento = v.pagamentos.reduce((max, p) => (p.expiraEm > max ? p.expiraEm : max), v.entradaAte!);
    const { count } = await db.encomenda.updateMany({
      where: {
        id: v.id,
        status: "AGUARDANDO_ENTRADA",
        entradaPagaEm: null,
        entradaAte: { lte: fimDaFolga },
        pagamentos: { none: { parcela: "ENTRADA", status: "PENDENTE" } },
      },
      data: { status: "EXPIRADA", encerradaEm: ultimoVencimento > agora ? agora : ultimoVencimento },
    });
    expiradas += count;
  }
  if (expiradas > 0) console.info(`[encomendas] ${expiradas} encomenda(s) expirada(s) por prazo`);
  return { expiradas };
}

// --- solicitar ------------------------------------------------------------------------------------

async function encomendaPorChave(userId: string, chave: string) {
  return db.encomenda.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: chave } }, include: incluirEncomenda });
}

/** Encomenda já criada com a mesma chave: devolve-a, mas só se o conteúdo for o mesmo (senão 422). */
function repeticao(existente: EncomendaCompleta, entrada: EncomendaEntrada, agora: Date): EncomendaDTO {
  const mesma = mesmaEncomenda(
    {
      itens: existente.itens.map((i) => ({ productId: i.productId, quantidade: i.quantidade })),
      dataFesta: diaDe(existente.dataFesta),
      dataEntrega: diaDe(existente.dataEntrega),
      modoEntrega: existente.modoEntrega,
      telefone: existente.telefone,
      observacao: existente.observacao,
      addressId: existente.addressId,
      endereco: existente.address
        ? {
            cep: existente.address.cep,
            rua: existente.address.rua,
            numero: existente.address.numero,
            complemento: existente.address.complemento,
            bairro: existente.address.bairro,
            cidade: existente.address.cidade,
            estado: existente.address.estado,
          }
        : null,
    },
    {
      itens: entrada.itens,
      dataFesta: entrada.dataFesta,
      dataEntrega: entrada.dataEntrega,
      modoEntrega: entrada.modoEntrega,
      telefone: entrada.telefone,
      observacao: entrada.observacao,
      addressId: entrada.addressId ?? null,
      endereco: entrada.endereco ?? null,
    },
  );
  if (!mesma) throw new ErroNegocio(422, "Esta Idempotency-Key já foi usada em outra encomenda, com dados diferentes.");
  return paraEncomendaDTO(existente, agora);
}

/** Abertas = ainda não terminaram (a SOLICITADA vencida já não conta). */
const whereAbertas = (userId: string, agora: Date): Prisma.EncomendaWhereInput => ({
  userId,
  OR: [{ status: "SOLICITADA", responderAte: { gt: agora } }, { status: { in: ["AGUARDANDO_ENTRADA", ...STATUS_CONFIRMADOS] } }],
});

/**
 * Cria a encomenda SOLICITADA. Ordem das respostas (a mesma dos pedidos):
 * - a mesma `chave` com o mesmo conteúdo devolve a já criada (`repetida`); com outro, 422;
 * - 503 recurso desativado, CNPJ/CPF ou e-mail da loja pendentes (D13) ou pagamento pelo site
 *   indisponível (nada é gravado);
 * - 400 datas (por campo, contra o "hoje" da loja no SERVIDOR); 422 sabor indisponível em mini;
 *   400 potinhos fora de 15–50 (em `itens`);
 * - 409 política mudou (`politicaVersao`/`percentualRetido` diferentes dos atuais);
 * - 404 endereço salvo de outra pessoa; 422 CEP inválido ou que não bate com a cidade (`endereco.cep`);
 * - 422 entrega fora de Teresina (`detalhes.foraDaArea`, mensagem MENSAGEM_FORA_DA_AREA);
 * - 409 total mudou (preço, peso ou frete), com os valores atuais;
 * - 429 mais de 3 encomendas abertas (conferido dentro da transação, com trava por conta; DEPOIS de
 *   conferir a chave de novo, dentro da trava: dois envios simultâneos da mesma solicitação, com 2 já
 *   abertas, devolvem a do primeiro (200), não 429).
 * A repetição só vale com o MESMO conteúdo: potinhos, datas, modo, telefone, observação e endereço.
 */
export async function criarEncomenda(
  userId: string,
  entrada: EncomendaEntrada,
  chave: string,
  agora: Date,
): Promise<{ encomenda: EncomendaDTO; repetida: boolean }> {
  const existente = await encomendaPorChave(userId, chave);
  if (existente) return { encomenda: repeticao(existente, entrada, agora), repetida: true };

  // Desativar só bloqueia solicitações NOVAS: as abertas seguem (pagamento e ações).
  const config = await lerConfigLembrancinhas();
  if (!config?.ativo) throw new ErroNegocio(503, "As encomendas de lembrancinhas não estão abertas no momento. Volte em breve.");
  // D13: sem CNPJ/CPF e e-mail de contato no site (Decreto 7.962/2013, art. 2º), nada de encomenda nova.
  if (pendenciasParaAbrir().length > 0) {
    throw new ErroNegocio(503, "As encomendas de lembrancinhas não estão abertas no momento. Volte em breve.");
  }
  if (!pagamentoOnlineDisponivel()) {
    throw new ErroNegocio(503, "As encomendas pelo site ainda não estão abertas. Em breve você poderá encomendar por aqui.");
  }

  const datas = validarDatas({ hoje: hojeNaLoja(agora), dataFesta: entrada.dataFesta, dataEntrega: entrada.dataEntrega, modo: entrada.modoEntrega });
  if (!datas.ok) throw new ErroNegocio(400, "Confira as datas.", datas.erros);

  // Sabor disponível em mini = à venda E marcado no painel (ocultar o sabor oculta o mini).
  const ids = [...new Set(entrada.itens.map((i) => i.productId))];
  const sabores = await db.product.findMany({ where: { id: { in: ids }, ativo: true, disponivelEmMini: true }, select: { id: true } });
  const potinhos = conferirPotinhos(entrada.itens, new Set(sabores.map((s) => s.id)));
  if (!potinhos.ok) {
    if (potinhos.motivo === "indisponivel") {
      throw new ErroNegocio(422, "Alguns sabores não estão mais disponíveis em mini.", { indisponiveis: potinhos.indisponiveis });
    }
    throw new ErroNegocio(400, potinhos.mensagem, { itens: [potinhos.mensagem] });
  }

  // A cliente aceitou um texto com um percentual: se mudou desde a tela, ela precisa ler de novo.
  if (entrada.politicaVersao !== POLITICA_VERSAO || entrada.percentualRetido !== config.percentualRetido) {
    throw new ErroNegocio(409, "A política de desistência mudou. Leia de novo antes de enviar.", {
      politicaVersao: POLITICA_VERSAO,
      percentualRetido: config.percentualRetido,
    });
  }

  // Endereço (só na entrega): um salvo, da própria cliente, ou um novo conferido contra o CEP.
  let cep: string | null = null;
  let enderecoSalvoId: string | null = null;
  if (entrada.modoEntrega === "ENTREGA") {
    if (entrada.addressId) {
      const salvo = await db.address.findFirst({ where: { id: entrada.addressId, userId }, select: { id: true, cep: true } });
      if (!salvo) throw new ErroNegocio(404, "Endereço não encontrado.");
      cep = salvo.cep;
      enderecoSalvoId = salvo.id;
    } else {
      // Fora da área de entrega: recusa antes de consultar o CEP (sem depender do serviço de CEP).
      if (!cepAtendido(entrada.endereco!.cep)) throw new ErroNegocio(422, MENSAGEM_FORA_DA_AREA, { foraDaArea: true });
      const validacao = await validarEnderecoComCep(entrada.endereco!);
      if (!validacao.ok) {
        throw validacao.status === 422
          ? new ErroNegocio(422, validacao.mensagem, { "endereco.cep": [validacao.mensagem] })
          : new ErroNegocio(503, validacao.mensagem);
      }
      cep = entrada.endereco!.cep;
    }
  }

  // Preço único por potinho (congelado na encomenda) e a MESMA regra de entrega dos pedidos (D3 e
  // decisão da dona de 2026-10-21): só Teresina, com a taxa fixa do painel; retirada sem frete.
  const precoPotinhoCentavos = centavos(config.precoPotinho);
  const pesoTotalGramas = pesoDaEncomenda(potinhos.total, config.pesoPotinhoGramas, config.pesoEmbalagemGramas);
  const taxaCentavos = entrada.modoEntrega === "ENTREGA" ? await taxaDeEntregaAtualCentavos() : 0;
  const frete = calcularFrete({ modo: entrada.modoEntrega, cep, taxaCentavos });
  if (!frete.ok) {
    throw frete.motivo === "FORA_DA_AREA"
      ? new ErroNegocio(422, MENSAGEM_FORA_DA_AREA, { foraDaArea: true })
      : new ErroNegocio(400, frete.mensagem, { endereco: [frete.mensagem] });
  }
  const freteCentavos = frete.freteCentavos;
  const valores = calcularValores({ subtotalCentavos: potinhos.total * precoPotinhoCentavos, freteCentavos });
  if (entrada.totalEsperadoCentavos !== valores.total) {
    throw new ErroNegocio(409, "O preço ou o frete mudaram. Confira o novo total antes de enviar.", {
      precoPotinho: precoPotinhoCentavos / 100,
      frete: valores.frete / 100,
      total: valores.total / 100,
      entrada: valores.entrada / 100,
      restante: valores.restante / 100,
      pesoTotalGramas,
    });
  }

  const prazos = prazosDaEncomenda(agora, entrada.dataEntrega);
  try {
    const resultado = await db.$transaction(async (tx) => {
      // Trava por conta: duas solicitações simultâneas não passam juntas pela contagem de abertas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`encomendas:${userId}`}))`;
      // A chave vem ANTES do limite: o outro envio da mesma solicitação pode ter acabado de gravar.
      const ja = await tx.encomenda.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: chave } },
        include: incluirEncomenda,
      });
      if (ja) return { repetida: true, encomenda: ja } as const;
      const abertas = await tx.encomenda.count({ where: whereAbertas(userId, agora) });
      if (abertas >= MAX_ENCOMENDAS_ABERTAS) {
        throw new ErroNegocio(
          429,
          `Você já tem ${MAX_ENCOMENDAS_ABERTAS} encomendas em andamento. Conclua ou desista de alguma antes de fazer outra.`,
        );
      }
      const addressId =
        entrada.modoEntrega === "ENTREGA"
          ? (enderecoSalvoId ?? (await obterOuCriarEndereco(tx, userId, entrada.endereco!, { limitar: false })).id)
          : null;
      const nova = await tx.encomenda.create({
        data: {
          userId,
          status: "SOLICITADA",
          dataFesta: dateDoDia(entrada.dataFesta),
          dataEntrega: dateDoDia(entrada.dataEntrega),
          modoEntrega: entrada.modoEntrega,
          addressId,
          telefone: entrada.telefone,
          observacao: entrada.observacao,
          potinhos: potinhos.total,
          subtotal: reaisDe(valores.subtotal),
          frete: reaisDe(valores.frete),
          total: reaisDe(valores.total),
          valorEntrada: reaisDe(valores.entrada),
          valorRestante: reaisDe(valores.restante),
          pesoTotalGramas,
          responderAte: prazos.responderAte,
          corteEm: prazos.corteEm,
          percentualRetido: config.percentualRetido,
          percentualAceito: entrada.percentualRetido,
          politicaVersao: POLITICA_VERSAO,
          politicaAceitaEm: agora,
          idempotencyKey: chave,
          criadaEm: agora,
          itens: {
            create: potinhos.itens.map((i) => ({ productId: i.productId, quantidade: i.quantidade, precoUnitario: reaisDe(precoPotinhoCentavos) })),
          },
        },
        include: incluirEncomenda,
      });
      return { repetida: false, encomenda: nova } as const;
    });
    if (resultado.repetida) return { encomenda: repeticao(resultado.encomenda, entrada, agora), repetida: true };
    const criada = resultado.encomenda;
    // O telefone nunca vai para log (LGPD).
    console.info(
      `[encomendas] encomenda ${criada.id} solicitada (potinhos=${criada.potinhos}, ${criada.modoEntrega}, total=${criada.total.toFixed(2)})`,
    );
    return { encomenda: paraEncomendaDTO(criada, agora), repetida: false };
  } catch (e) {
    unstable_rethrow(e);
    // Dois envios simultâneos com a mesma chave: o segundo cai aqui e recebe a do primeiro.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ja = await encomendaPorChave(userId, chave);
      if (ja) return { encomenda: repeticao(ja, entrada, agora), repetida: true };
    }
    throw e;
  }
}

// --- desistir -------------------------------------------------------------------------------------

/**
 * A cliente desiste (CDC/Decreto 7.962, art. 5º: pela mesma ferramenta). A devolução segue a regra do
 * corte e do percentual congelado na encomenda; se o corte passou entre a tela e o clique (a prévia
 * mudou), responde 409 com a nova prévia e não desiste. Com pagamento em conferência, 409 (aguarde).
 * Links abertos são encerrados no banco antes; um pago depois disso vira devolução pendente.
 */
export async function desistirDaEncomenda(
  id: string,
  userId: string,
  devolucaoEsperadaCentavos: number,
  agora: Date,
): Promise<{ encomenda: EncomendaDTO; devolucao: { valor: number; retido: number } }> {
  await expirarVencidas(agora, { encomendaId: id });
  const ler = () => db.encomenda.findFirst({ where: { id, userId }, include: incluirEncomenda });
  let e = await ler();
  if (!e) throw new ErroNegocio(404, "Encomenda não encontrada.");

  const desistivel: StatusEncomenda[] = ["SOLICITADA", "AGUARDANDO_ENTRADA", ...STATUS_CONFIRMADOS];
  if (!desistivel.includes(e.status)) {
    throw new ErroNegocio(409, "Esta encomenda já foi encerrada.", { statusAtual: e.status });
  }
  // Pagamento em conferência (aviso não conferido, retorno recente, divergência): o dinheiro pode ter
  // entrado e a prévia da devolução ainda não o conta. Espera a conferência.
  if (e.pagamentos.some((p) => cobrancaEmConferencia(p, agora.getTime()))) {
    throw new ErroNegocio(409, "Há um pagamento desta encomenda sendo conferido. Aguarde alguns minutos antes de desistir.", {
      statusAtual: e.status,
    });
  }
  // Links abertos: encerrados no NOSSO banco (a InfinitePay não cancela link; um pago depois disso
  // vira devolução pendente).
  if (e.pagamentos.some((p) => p.status === "PENDENTE")) {
    await encerrarCobrancasDaEncomenda(e.id);
    e = (await ler())!;
    if (!desistivel.includes(e.status)) throw new ErroNegocio(409, "Esta encomenda já foi encerrada.", { statusAtual: e.status });
  }

  const regras = paraRegras(e, agora);
  const previa = devolucaoNaDesistencia({
    agora,
    corteEm: e.corteEm,
    entradaPaga: regras.entradaPagaEm ? regras.valorEntradaCentavos : 0,
    restantePago: regras.restantePagoEm ? regras.valorRestanteCentavos : 0,
    quem: "CLIENTE",
    percentualRetido: e.percentualRetido,
  });
  if (previa.devolucao !== devolucaoEsperadaCentavos) {
    throw new ErroNegocio(409, "O valor da devolução mudou. Confira antes de desistir.", {
      statusAtual: e.status,
      devolucao: previa.devolucao / 100,
      retido: previa.retido / 100,
      devolucaoCentavos: previa.devolucao,
      retidoCentavos: previa.retido,
    });
  }

  const lido = e;
  const desistiu = await db.$transaction(async (tx) => {
    // Condicional: se a encomenda mudou (pagamento, aprovação, expiração) desde a leitura, nada muda.
    const { count } = await tx.encomenda.updateMany({
      where: {
        id: lido.id,
        userId,
        status: lido.status,
        entradaPagaEm: lido.entradaPagaEm,
        restantePagoEm: lido.restantePagoEm,
        ...(lido.status === "SOLICITADA" ? { responderAte: { gt: agora } } : {}),
      },
      data: { status: "CANCELADA", canceladaPor: "CLIENTE", motivoCancelamento: "Desistência da cliente pelo site.", encerradaEm: agora },
    });
    if (count !== 1) return false;
    if (previa.devolucao > 0) {
      await tx.encomendaDevolucao.create({ data: { encomendaId: lido.id, motivo: "DESISTENCIA", valor: reaisDe(previa.devolucao) } });
    }
    return true;
  });
  if (!desistiu) throw new ErroNegocio(409, "A encomenda mudou enquanto você desistia. Atualize a página e confira.");

  console.info(
    `[encomendas] encomenda ${id} cancelada pela cliente (devolução=${(previa.devolucao / 100).toFixed(2)}, retido=${(previa.retido / 100).toFixed(2)})`,
  );
  const final = (await ler())!;
  return { encomenda: paraEncomendaDTO(final, agora), devolucao: { valor: previa.devolucao / 100, retido: previa.retido / 100 } };
}
