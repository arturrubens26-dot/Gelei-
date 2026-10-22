/**
 * Regras puras da integração com o checkout da InfinitePay (sem rede e sem banco), testadas em
 * testes/infinitepay.test.ts. As chamadas HTTP ficam em src/lib/infinitepay.ts.
 *
 * O que a documentação não fixa (o nome do campo da URL na resposta de /links, se vem o slug, o
 * formato exato do aviso) é lido de forma tolerante aqui; o ensaio com dinheiro real
 * (scripts/ensaio-infinitepay.ts) confirma o formato e o README registra.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MAX_PARCELAS, PARCELAS_SEM_JUROS, type MetodoPagamento } from "@/lib/pagamentos-regras";

// --- referência (order_nsu) e token do aviso --------------------------------------------------

/** Ids do banco são cuid (minúsculas e dígitos). */
const ID = "[a-z0-9]{1,40}";
const FORMATO_REFERENCIA_PEDIDO = new RegExp(`^ped-(${ID})-([1-9][0-9]{0,2})$`);
const FORMATO_REFERENCIA_ENCOMENDA = new RegExp(`^enc-(${ID})-(ENTRADA|RESTANTE)-([1-9][0-9]{0,2})$`);

/** order_nsu de uma tentativa de pagamento do pedido: ped-<pedidoId>-<n> (n = 1, 2, ...). */
export function referenciaDoPedido(pedidoId: string, tentativa: number): string {
  const ref = `ped-${pedidoId}-${tentativa}`;
  if (!FORMATO_REFERENCIA_PEDIDO.test(ref)) throw new Error("referência de pedido inválida");
  return ref;
}

/** order_nsu de uma parcela de encomenda (lembrancinhas, rodada seguinte): enc-<id>-<parcela>-<n>. */
export function referenciaDaEncomenda(encomendaId: string, parcela: "ENTRADA" | "RESTANTE", tentativa: number): string {
  const ref = `enc-${encomendaId}-${parcela}-${tentativa}`;
  if (!FORMATO_REFERENCIA_ENCOMENDA.test(ref)) throw new Error("referência de encomenda inválida");
  return ref;
}

export type ReferenciaLida =
  | { tipo: "pedido"; pedidoId: string; tentativa: number }
  | { tipo: "encomenda"; encomendaId: string; parcela: "ENTRADA" | "RESTANTE"; tentativa: number };

/** Lê um order_nsu nosso; qualquer outra coisa é `null`. */
export function lerReferencia(ref: string): ReferenciaLida | null {
  const p = FORMATO_REFERENCIA_PEDIDO.exec(ref);
  if (p) return { tipo: "pedido", pedidoId: p[1], tentativa: Number(p[2]) };
  const e = FORMATO_REFERENCIA_ENCOMENDA.exec(ref);
  if (e) return { tipo: "encomenda", encomendaId: e[1], parcela: e[2] as "ENTRADA" | "RESTANTE", tentativa: Number(e[3]) };
  return null;
}

/**
 * Token do aviso, por cobrança: HMAC-SHA256(SESSION_SECRET, "infinitepay-aviso:" + order_nsu), em
 * base64url. Vai no CAMINHO do webhook_url (não se sabe se a InfinitePay preserva a query). O aviso
 * não é assinado: sem a URL certa, ninguém consegue nem gravar um candidato.
 */
export function tokenDoAviso(segredo: string, referencia: string): string {
  return createHmac("sha256", segredo).update(`infinitepay-aviso:${referencia}`).digest("base64url");
}

export function conferirTokenDoAviso(segredo: string, referencia: string, token: string): boolean {
  if (!segredo || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const esperado = Buffer.from(tokenDoAviso(segredo, referencia));
  const recebido = Buffer.from(token);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/**
 * Data ISO 8601 com o fuso de Brasília explícito (UTC−3, sem horário de verão desde 2019), como o
 * `valid_until` pede: 2026-10-21T15:30:00.000-03:00.
 */
export function dataComFusoDeBrasilia(data: Date): string {
  const brasilia = new Date(data.getTime() - 3 * 60 * 60_000);
  return `${brasilia.toISOString().slice(0, 23)}-03:00`;
}

// --- configuração (puro: também usado por src/lib/ambiente.ts na subida) -----------------------

/** InfiniteTag sem o "$" (ex.: "geleio"). */
export const FORMATO_HANDLE = /^[a-z0-9._-]{2,40}$/;

const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

/**
 * Origem pública do site a partir da APP_URL (de onde saem o retorno e o aviso): https; http só para
 * este computador (teste local com `next start`). Qualquer outra coisa: `null` (pagamento desligado).
 */
export function origemPublicaDe(bruto: string | undefined): string | null {
  const valor = bruto?.trim();
  if (!valor) return null;
  try {
    const url = new URL(valor);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/**
 * Servidor falso dos testes (INFINITEPAY_API_URL): só http em 127.0.0.1/localhost, então a chave
 * nunca é desviada para outro computador por variável. `null`: usa a API oficial.
 */
export function origemDeTesteDe(bruto: string | undefined): string | null {
  const valor = bruto?.trim();
  if (!valor) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" && LOOPBACK.has(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

// --- URLs da InfinitePay ----------------------------------------------------------------------

/**
 * Só aceitamos para a cliente (e para o comprovante) links https da InfinitePay. `origemLocal`
 * (testes com o servidor falso em 127.0.0.1) aceita também aquela origem exata.
 */
export function urlDaInfinitePay(valor: unknown, opcoes: { origemLocal?: string | null } = {}): string | null {
  if (typeof valor !== "string" || valor.length > 500) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:" && (host === "infinitepay.io" || host.endsWith(".infinitepay.io")) && !url.port) return url.toString();
  if (opcoes.origemLocal && url.origin === opcoes.origemLocal) return url.toString();
  return null;
}

// --- corpo do POST /links ---------------------------------------------------------------------

export type ItemDoLink = { description: string; quantity: number; price: number };

/** Linhas do pedido, em centavos. Linha de R$ 0 não vai; "Entrega" só quando há frete. */
export function itensDoLink(entrada: {
  avulsos: { nome: string; quantidade: number; precoCentavos: number }[];
  kits: { nome: string; quantidade: number; precoCentavos: number }[];
  freteCentavos: number;
}): ItemDoLink[] {
  const linha = (nome: string, quantidade: number, price: number): ItemDoLink => ({
    description: nome.replace(/\s+/g, " ").trim().slice(0, 80),
    quantity: quantidade,
    price,
  });
  return [
    ...entrada.avulsos.filter((a) => a.precoCentavos > 0).map((a) => linha(a.nome, a.quantidade, a.precoCentavos)),
    ...entrada.kits.filter((k) => k.precoCentavos > 0).map((k) => linha(k.nome, k.quantidade, k.precoCentavos)),
    ...(entrada.freteCentavos > 0 ? [linha("Entrega", 1, entrada.freteCentavos)] : []),
  ];
}

export const somaDosItens = (itens: readonly ItemDoLink[]) => itens.reduce((soma, i) => soma + i.quantity * i.price, 0);

export type EntradaDoLink = {
  handle: string;
  referencia: string;
  itens: ItemDoLink[];
  /** Total do pedido em centavos: a soma dos itens precisa ser exatamente isto. */
  totalCentavos: number;
  urlRetorno: string;
  urlAviso: string;
  validoAte: Date;
  cliente: { nome: string; email: string; telefone: string | null };
  endereco: { cep: string; rua: string; numero: string; bairro: string; cidade: string; estado: string; complemento: string | null } | null;
};

/**
 * Corpo do POST /links. Nunca manda `discounts`: um desconto no PIX faria o valor pago ficar abaixo
 * do total e a conferência recusaria. `single_payment` + `valid_until` impedem pagar o mesmo link
 * duas vezes ou depois de vencido. Lança se a soma dos itens não fechar com o total.
 */
export function corpoDoLink(e: EntradaDoLink) {
  if (e.itens.length === 0 || somaDosItens(e.itens) !== e.totalCentavos) {
    throw new Error("a soma dos itens do link não é o total do pedido");
  }
  return {
    handle: e.handle,
    order_nsu: e.referencia,
    items: e.itens,
    redirect_url: e.urlRetorno,
    webhook_url: e.urlAviso,
    customer: {
      name: e.cliente.nome.slice(0, 100),
      email: e.cliente.email,
      ...(e.cliente.telefone ? { phone_number: `+55${e.cliente.telefone}` } : {}),
    },
    ...(e.endereco
      ? {
          address: {
            cep: e.endereco.cep,
            street: e.endereco.rua,
            number: e.endereco.numero,
            neighborhood: e.endereco.bairro,
            city: e.endereco.cidade,
            state: e.endereco.estado,
            ...(e.endereco.complemento ? { complement: e.endereco.complemento } : {}),
          },
        }
      : {}),
    options: {
      single_payment: true,
      valid_until: dataComFusoDeBrasilia(e.validoAte),
      assured_installments: PARCELAS_SEM_JUROS,
      require_delivery_address: false,
      payment_methods_enabled: ["credit_card", "pix"],
    },
  };
}

// --- respostas e avisos -----------------------------------------------------------------------

const FORMATO_ID_EXTERNO = /^[A-Za-z0-9_-]{1,100}$/;
const idExterno = (v: unknown): string | null => (typeof v === "string" && FORMATO_ID_EXTERNO.test(v) ? v : null);

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Resposta do POST /links: a URL vem em `url`, `link` ou `checkout_url` (no corpo ou em `data`), e o
 * slug, se vier, em `slug` ou `invoice_slug`. URL fora da InfinitePay (ou http) é recusada: `null`.
 */
export function lerRespostaDoLink(json: unknown, opcoes: { origemLocal?: string | null } = {}): { url: string; slug: string | null } | null {
  const raiz = objeto(json);
  if (!raiz) return null;
  for (const fonte of [raiz, objeto(raiz.data)]) {
    if (!fonte) continue;
    const url = urlDaInfinitePay(fonte.url ?? fonte.link ?? fonte.checkout_url, opcoes);
    if (url) return { url, slug: idExterno(fonte.slug) ?? idExterno(fonte.invoice_slug) };
  }
  return null;
}

/** Número inteiro de centavos: aceita número ou texto numérico ("1500"). */
const centavos = z.union([z.number(), z.string().regex(/^\d{1,9}$/).transform(Number)]).pipe(z.number().int().nonnegative());
const booleano = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);

const conferenciaSchema = z.object({
  success: booleano,
  paid: booleano.optional().default(false),
  // nullish: "não veio" e null valem o mesmo (a conferência recusa o que faltar, sem quebrar a leitura).
  amount: centavos.nullish(),
  paid_amount: centavos.nullish(),
  installments: z.union([z.number(), z.string().regex(/^\d{1,2}$/).transform(Number)]).pipe(z.number().int()).nullish(),
  capture_method: z.string().max(40).nullish(),
  // A documentação não traz estes dois; se a resposta trouxer, eles também são conferidos.
  order_nsu: z.string().max(200).nullish(),
  currency: z.string().max(10).nullish(),
});

export type Conferencia = z.output<typeof conferenciaSchema>;

/** Resposta do payment_check. Formato inesperado: `null` (o servidor trata como falha passageira). */
export function lerConferencia(json: unknown): Conferencia | null {
  const raiz = objeto(json);
  if (!raiz) return null;
  const lido = conferenciaSchema.safeParse(objeto(raiz.data) && raiz.success === undefined ? raiz.data : raiz);
  return lido.success ? lido.data : null;
}

export type Classificacao =
  | { tipo: "APROVADO"; metodo: MetodoPagamento; parcelas: number; valorPagoCentavos: number }
  | { tipo: "DIVERGENTE"; motivo: string }
  | { tipo: "NAO_PAGO" }
  | { tipo: "INVALIDO" };

/**
 * Motivo para NÃO aceitar um "pago": valor do link diferente do total (sem tolerância), valor pago
 * menor que o do link, moeda diferente de BRL (se vier), método desconhecido ou parcelas fora de 1 a
 * 12. `null`: confere. Os juros do parcelado pagos pela cliente deixam `paid_amount` maior que
 * `amount`, e isso é aceito.
 */
export function divergenciaDaConferencia(c: Conferencia, valorCentavos: number): string | null {
  if (c.amount == null || c.amount !== valorCentavos) return "valor";
  if (c.paid_amount == null || c.paid_amount < c.amount) return "valor-pago";
  if (c.currency && c.currency.trim().toUpperCase() !== "BRL") return "moeda";
  if (c.capture_method !== "pix" && c.capture_method !== "credit_card") return "metodo";
  const parcelas = parcelasDe(c);
  if (parcelas < 1 || parcelas > MAX_PARCELAS || (c.capture_method === "pix" && parcelas !== 1)) return "parcelas";
  return null;
}

/**
 * A resposta do payment_check AMARRA a transação a esta cobrança? Só se trouxer o nosso order_nsu.
 * Sem isso (a documentação não garante), uma transação apresentada pela própria cliente (retorno do
 * navegador) não basta para confirmar: ela pode ser de outro link da loja de mesmo valor.
 */
export function conferenciaAmarrada(c: Conferencia, referencia: string): boolean {
  return typeof c.order_nsu === "string" && c.order_nsu === referencia;
}

/** Parcelas informadas; ausente vale 1, e no PIX 0 também vale 1 (à vista). */
function parcelasDe(c: Conferencia): number {
  if (c.installments == null) return 1;
  if (c.capture_method === "pix" && c.installments === 0) return 1;
  return c.installments;
}

/**
 * O que fazer com a resposta do payment_check (ver confirmarCobranca em src/lib/pagamentos.ts).
 * `referencia` é o order_nsu da cobrança no NOSSO banco: se a resposta disser que a transação é de
 * outro pedido, o candidato é recusado de vez.
 */
export function classificarConferencia(c: Conferencia, valorCentavos: number, referencia: string): Classificacao {
  if (!c.success) return { tipo: "INVALIDO" };
  if (c.order_nsu && c.order_nsu !== referencia) return { tipo: "INVALIDO" };
  if (!c.paid) return { tipo: "NAO_PAGO" };
  const motivo = divergenciaDaConferencia(c, valorCentavos);
  if (motivo) return { tipo: "DIVERGENTE", motivo };
  return {
    tipo: "APROVADO",
    metodo: c.capture_method as MetodoPagamento,
    parcelas: parcelasDe(c),
    valorPagoCentavos: c.paid_amount!,
  };
}

/** Transação que alguém diz ter pago esta cobrança (ainda NÃO conferida). */
export type Candidato = { transacaoNsu: string; slug: string; comprovanteUrl: string | null };

function candidatoDe(fonte: Record<string, unknown>, opcoes: { origemLocal?: string | null }): (Candidato & { referencia: string | null }) | null {
  const transacaoNsu = idExterno(fonte.transaction_nsu);
  const slug = idExterno(fonte.invoice_slug) ?? idExterno(fonte.slug);
  if (!transacaoNsu || !slug) return null;
  const referencia = typeof fonte.order_nsu === "string" ? fonte.order_nsu.slice(0, 64) : null;
  return { transacaoNsu, slug, comprovanteUrl: urlDaInfinitePay(fonte.receipt_url, opcoes), referencia };
}

/** Corpo do aviso (webhook): simples ou dentro de `data`. Sem transação ou slug válidos: `null`. */
export function lerAviso(json: unknown, opcoes: { origemLocal?: string | null } = {}) {
  const raiz = objeto(json);
  if (!raiz) return null;
  return candidatoDe(raiz, opcoes) ?? (objeto(raiz.data) ? candidatoDe(objeto(raiz.data)!, opcoes) : null);
}

/** Query do retorno (`redirect_url?order_nsu=...&transaction_nsu=...&slug=...&receipt_url=...`). */
export function lerRetorno(parametros: URLSearchParams, opcoes: { origemLocal?: string | null } = {}) {
  const pegar = (nome: string) => parametros.get(nome) ?? undefined;
  const referencia = pegar("order_nsu");
  const candidato = candidatoDe(
    {
      transaction_nsu: pegar("transaction_nsu"),
      slug: pegar("slug") ?? pegar("invoice_slug"),
      receipt_url: pegar("receipt_url"),
      order_nsu: referencia,
    },
    opcoes,
  );
  return { referencia: referencia && referencia.length <= 64 ? referencia : null, candidato };
}
