/**
 * Redefinição de senha: contrato e regras puras (servidor e navegador; sem rede, sem banco e sem
 * node:crypto, para poder ser importado por componentes de cliente). O token e o hash ficam em
 * src/lib/auth/redefinicao.ts (server-only). Testado em testes/redefinicao.test.ts.
 */

/** Validade do link de redefinição (painel e e-mail). */
export const VALIDADE_LINK_SENHA_MS = 60 * 60_000;

/** O que a dona conferiu antes de gerar o link no painel (`POST /api/admin/clientes/[id]/link-senha`). */
export const CONFERENCIAS = ["EMAIL", "NOME", "PEDIDO", "ENDERECO", "TELEFONE"] as const;
export type ConferenciaIdentidade = (typeof CONFERENCIAS)[number];

export const ROTULO_CONFERENCIA: Record<ConferenciaIdentidade, string> = {
  EMAIL: "Ela disse o e-mail da conta (sem eu sugerir)",
  NOME: "Ela disse o nome como está no cadastro",
  PEDIDO: "Ela disse algo de um pedido (sabores, kit, mês ou código)",
  ENDERECO: "Ela disse o bairro ou o CEP da entrega",
  TELEFONE: "Ela disse o telefone, e o final confere",
};

/** Máximo da observação opcional do painel. */
export const MAX_OBSERVACAO_LINK = 200;

export type OrigemRedefinicao = "EMAIL" | "PAINEL";
export type SituacaoLinkSenha = "VALENDO" | "USADO" | "VENCIDO" | "SUBSTITUIDO";

/** Mensagem única para token vencido, usado, substituído ou inexistente. */
export const MENSAGEM_LINK_INVALIDO = "Este link não vale mais. Peça um novo.";
/** Resposta 202 do "Esqueci minha senha" (igual com ou sem conta). */
export const MENSAGEM_PEDIDO_ENVIADO =
  "Se houver uma conta com esse e-mail, enviamos um link para criar uma senha nova. Ele vale por 1 hora. Confira também a caixa de spam.";

/** `buscarClientes` (em @/lib/clientes-admin): só contas de cliente, nunca de admin. */
export type ClienteResumoDTO = {
  id: string;
  nome: string;
  email: string;
  /** ISO. */
  criadoEm: string;
  /** Pedidos online. */
  pedidos: number;
};

/** `fichaDoCliente` (em @/lib/clientes-admin). */
export type ClienteDetalheDTO = ClienteResumoDTO & {
  enderecos: number;
  /** 4 últimos dígitos do último telefone informado num pedido (conferência); null se nunca informou. */
  telefoneFinal: string | null;
  /** Os 5 últimos pedidos online. `cepInicio`: os 5 primeiros dígitos do CEP (null na retirada). */
  ultimosPedidos: {
    id: string;
    codigo: string;
    createdAt: string;
    status: "PENDENTE" | "PAGO" | "ENVIADO" | "ENTREGUE" | "CANCELADO";
    total: number;
    resumo: string;
    modoEntrega: "ENTREGA" | "RETIRADA";
    bairro: string | null;
    cidade: string | null;
    cepInicio: string | null;
  }[];
  /** Histórico de links de redefinição (mais recente primeiro). */
  links: {
    criadoEm: string;
    origem: OrigemRedefinicao;
    /** Nome do admin que gerou (PAINEL); null no e-mail ou se a conta do admin saiu. */
    geradoPor: string | null;
    situacao: SituacaoLinkSenha;
    expiraEm: string;
  }[];
  /** Conta sem pedidos nem endereços: o painel avisa para conferir com mais cuidado. */
  semHistorico: boolean;
};

/** Resposta 201 de `POST /api/admin/clientes/[id]/link-senha` (o link aparece UMA vez). */
export type LinkSenhaGeradoDTO = {
  link: string;
  expiraEm: string;
  mensagemSugerida: string;
};

// --- regras -----------------------------------------------------------------------------------

/** Formato do token: 32 bytes aleatórios em base64url, sem "=" (43 caracteres). */
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Endereço do desenvolvimento local quando não há APP_URL. */
const BASE_LOCAL = "http://localhost:3000";

/**
 * Origem do site para montar links que saem por mensagem: SÓ a APP_URL (nunca Host ou
 * X-Forwarded-Host, que o cliente controla: envenenaria o link). Em produção, só https; sem ela,
 * `null` (os dois caminhos da redefinição ficam desligados). Fora da produção, sem APP_URL, vale o
 * localhost.
 */
export function origemDoSite(appUrl: string | undefined, producao: boolean): string | null {
  const bruto = appUrl?.trim();
  if (!bruto) return producao ? null : BASE_LOCAL;
  try {
    const url = new URL(bruto);
    if (producao ? url.protocol !== "https:" : !["https:", "http:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Link de redefinição: o token vai no FRAGMENTO (#t=...), que o navegador não manda ao servidor, aos
 * logs nem no Referer; o "preview" do Instagram e os verificadores de link não o consomem.
 */
export function linkDeRedefinicao(appUrl: string | undefined, token: string, producao: boolean): string | null {
  const origem = origemDoSite(appUrl, producao);
  if (!origem || !FORMATO_TOKEN.test(token)) return null;
  return `${origem}/redefinir-senha#t=${token}`;
}

/**
 * O que a dona precisa ter conferido: e-mail e nome sempre; se a conta tem pedido ou endereço, também
 * algo de um pedido (PEDIDO) ou da entrega (ENDERECO). TELEFONE é registro a mais, não substitui.
 */
export function conferenciaSuficiente(conferencia: readonly ConferenciaIdentidade[], temHistorico: boolean): boolean {
  const tem = (c: ConferenciaIdentidade) => conferencia.includes(c);
  if (!tem("EMAIL") || !tem("NOME")) return false;
  return !temHistorico || tem("PEDIDO") || tem("ENDERECO");
}

/** Situação de um link no histórico da ficha. */
export function situacaoDoLink(
  link: { usadoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date },
  agora: number = Date.now(),
): SituacaoLinkSenha {
  if (link.usadoEm) return "USADO";
  if (link.invalidadoEm) return "SUBSTITUIDO";
  if (link.expiraEm.getTime() <= agora) return "VENCIDO";
  return "VALENDO";
}

/** A sessão (versão gravada no JWT; sem "v" conta 0) ainda vale para a versão atual da conta? */
export function sessaoValida(versaoDoToken: number, versaoDaConta: number): boolean {
  return versaoDoToken === versaoDaConta;
}

/** "Maria Clara Souza" → "Maria". */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome.trim();
}

const BRASILIA_MS = -3 * 60 * 60_000;
const diaEm = (data: Date) => new Date(data.getTime() + BRASILIA_MS).toISOString().slice(0, 10);

/** "15:40" no horário de Brasília (UTC−3, sem horário de verão desde 2019). */
export function horaDeBrasilia(data: Date): string {
  return new Date(data.getTime() + BRASILIA_MS).toISOString().slice(11, 16);
}

/**
 * Mensagem para a dona copiar e mandar pela DM. O link fica sozinho na última linha: um ponto ou
 * uma vírgula logo depois dele poderia entrar no link e estragar o token.
 */
export function mensagemSugerida(nome: string, link: string, expiraEm: Date, agora: Date = new Date()): string {
  const quando = diaEm(expiraEm) === diaEm(agora) ? "de hoje" : "de amanhã";
  return (
    `Oi, ${primeiroNome(nome)}! Aqui está o link para você criar uma senha nova na Geleiô. ` +
    `Ele vale até as ${horaDeBrasilia(expiraEm)} ${quando} e só funciona uma vez. Se não foi você que pediu, é só ignorar.\n\n` +
    link
  );
}
