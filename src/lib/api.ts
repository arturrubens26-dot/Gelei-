import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getUsuarioAtual, type UsuarioAtual } from "@/lib/auth/dal";
import { ErroNegocio } from "@/lib/erros";

/** Resposta de erro padronizada: `{ erro: string, detalhes?: ... }`. */
export function erro(status: number, mensagem: string, detalhes?: unknown): Response {
  return Response.json(detalhes === undefined ? { erro: mensagem } : { erro: mensagem, detalhes }, {
    status,
  });
}

/**
 * 400 com os erros por campo, usando o caminho completo como chave:
 * `{ erro, detalhes: { "endereco.cep": ["mensagem"], "itens.0.quantidade": [...] } }`.
 */
export function erroDeValidacao(falha: z.ZodError): Response {
  const detalhes: Record<string, string[]> = {};
  for (const problema of falha.issues) {
    const campo = problema.path.length ? problema.path.map(String).join(".") : "_";
    (detalhes[campo] ??= []).push(problema.message);
  }
  return erro(400, "Dados inválidos.", detalhes);
}

/** Nenhuma rota recebe JSON maior que isto (o maior payload real é um pedido de ~2 KB). */
const MAX_BYTES_CORPO = 32 * 1024;

/**
 * Lê o corpo JSON; devolve `undefined` se não for JSON válido. O tipo MIME precisa ser
 * exatamente `application/json` (`text/plain` é "simples" e dispensa preflight no CORS) e
 * o corpo é lido com teto de tamanho: acima disso responde 413 sem carregar tudo na memória.
 */
export async function lerJson(request: Request): Promise<unknown> {
  const tipo = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (tipo !== "application/json") return undefined;

  const corpo = await lerBytes(request, MAX_BYTES_CORPO, "Corpo da requisição grande demais.");
  if (!corpo) return undefined;
  try {
    return JSON.parse(corpo.toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Corpo JSON de um aviso servidor a servidor (webhook), com o mesmo teto de tamanho, mas sem exigir o
 * `Content-Type` exato: não há navegador nem CSRF aqui, e um tipo diferente do esperado não pode
 * fazer o aviso ser perdido. `undefined` se não for JSON.
 */
export async function lerJsonDoAviso(request: Request): Promise<unknown> {
  const corpo = await lerBytes(request, MAX_BYTES_CORPO, "Corpo da requisição grande demais.");
  if (!corpo) return undefined;
  try {
    return JSON.parse(corpo.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Lê o corpo inteiro com teto de tamanho (413 acima dele, sem carregar o resto na memória). */
async function lerBytes(request: Request, maxBytes: number, mensagem413: string): Promise<Buffer | undefined> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) throw new ErroNegocio(413, mensagem413);

  const leitor = request.body?.getReader();
  if (!leitor) return undefined;
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel();
      throw new ErroNegocio(413, mensagem413);
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/**
 * Lê um formulário multipart (cadastro de produto com foto), com teto de tamanho. Devolve
 * `undefined` se não for multipart ou se não der para ler.
 */
export async function lerFormulario(request: Request, maxBytes: number): Promise<FormData | undefined> {
  const tipo = request.headers.get("content-type") ?? "";
  if (tipo.split(";")[0]?.trim().toLowerCase() !== "multipart/form-data") return undefined;
  const corpo = await lerBytes(request, maxBytes, "Arquivo grande demais (a foto pode ter no máximo 2 MB).");
  if (!corpo) return undefined;
  try {
    return await new Response(new Uint8Array(corpo), { headers: { "content-type": tipo } }).formData();
  } catch {
    return undefined;
  }
}

type CorpoLido<S extends z.ZodType> =
  | { ok: true; dados: z.output<S> }
  | { ok: false; resposta: Response };

/** Lê o JSON e valida com zod; em caso de erro já devolve a resposta 400 pronta. */
export async function lerCorpo<S extends z.ZodType>(request: Request, schema: S): Promise<CorpoLido<S>> {
  const bruto = await lerJson(request);
  if (bruto === undefined) {
    return { ok: false, resposta: erro(400, "Envie um corpo JSON (Content-Type: application/json).") };
  }
  const resultado = schema.safeParse(bruto);
  return resultado.success
    ? { ok: true, dados: resultado.data }
    : { ok: false, resposta: erroDeValidacao(resultado.error) };
}

/**
 * Defesa contra CSRF para rotas que mudam estado. O cookie já é SameSite=Lax;
 * aqui rejeitamos também requisições cross-site declaradas pelo navegador.
 */
export function origemInvalida(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return erro(403, "Origem da requisição não permitida.");
  }
  const origem = request.headers.get("origin");
  if (origem) {
    // Com APP_URL definida comparamos com o endereço oficial do site; sem ela, caímos nos
    // cabeçalhos de host (menos confiáveis atrás de proxy mal configurado).
    const host = process.env.APP_URL
      ? new URL(process.env.APP_URL).host
      : (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    try {
      if (new URL(origem).host !== host) return erro(403, "Origem da requisição não permitida.");
    } catch {
      return erro(403, "Origem da requisição não permitida.");
    }
  }
  return null;
}

type ResultadoAuth = { ok: true; usuario: UsuarioAtual } | { ok: false; resposta: Response };

/**
 * Autentica uma chamada de API. Com `{ admin: true }` exige também `is_admin`,
 * lido do banco a cada chamada (nunca do token).
 */
export async function autenticarApi(opcoes: { admin?: boolean } = {}): Promise<ResultadoAuth> {
  const usuario = await getUsuarioAtual();
  if (!usuario) return { ok: false, resposta: erro(401, "Faça login para continuar.") };
  if (opcoes.admin && !usuario.isAdmin) {
    return { ok: false, resposta: erro(403, "Acesso restrito a administradores.") };
  }
  return { ok: true, usuario };
}

// --- tratamento de erros ----------------------------------------------------

/**
 * Registra o erro SEM despejar o objeto inteiro: erros do Prisma podem carregar
 * os argumentos da consulta (e-mail, hash de senha, endereço). Só vão nome,
 * código e a primeira linha da mensagem.
 */
export function registrarErro(contexto: string, e: unknown): void {
  if (!(e instanceof Error)) {
    console.error(`[${contexto}] erro desconhecido`);
    return;
  }
  const codigo = (e as { code?: string }).code;
  const primeiraLinha = e.message.split("\n").find((linha) => linha.trim()) ?? "";
  console.error(`[${contexto}] ${e.name}${codigo ? ` (${codigo})` : ""}: ${primeiraLinha.slice(0, 200)}`);
}

// Conexão caiu/esgotou, ou a transação não conseguiu vez (P2028 = tempo esgotado, P2034 = conflito de escrita).
// São falhas passageiras: 503 (tente de novo), não 500.
const CODIGOS_BANCO_INDISPONIVEL = new Set([
  "P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034", "P2036", "P2037",
]);

function bancoIndisponivel(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && CODIGOS_BANCO_INDISPONIVEL.has(e.code)) return true;
  const texto = e instanceof Error ? `${e.name} ${e.message}` : "";
  return /ConnectionClosed|Connection terminated|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout exceeded when trying to connect/i.test(
    texto,
  );
}

/**
 * Embrulha um Route Handler: erros de negócio viram a resposta certa; falhas do
 * banco viram 503 (e não 500 sem corpo); o resto vira 500 genérico, sem vazar
 * detalhes internos, e é registrado de forma segura.
 */
export function comTratamento<A extends unknown[]>(
  rotulo: string,
  handler: (...args: A) => Promise<Response>,
  opcoes: { publico?: boolean } = {},
): (...args: A) => Promise<Response> {
  // Respostas com dados de sessão/conta/pedidos nunca devem ser guardadas por navegador ou proxy.
  const marcar = (resposta: Response): Response => {
    if (!opcoes.publico) resposta.headers.set("Cache-Control", "no-store");
    return resposta;
  };

  return async (...args: A) => {
    try {
      return marcar(await handler(...args));
    } catch (e) {
      // Sinais internos do Next (rota dinâmica por usar cookies(), redirect, notFound) NÃO são
      // falhas: se forem engolidos aqui, o build imprime erros e a rota pode ser mal classificada.
      unstable_rethrow(e);
      if (e instanceof ErroNegocio) return marcar(erro(e.status, e.message, e.detalhes));
      registrarErro(rotulo, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2002" || e.code === "P2003")) {
        return marcar(erro(409, "Conflito com dados existentes. Atualize a página e tente de novo."));
      }
      if (bancoIndisponivel(e)) {
        return marcar(erro(503, "Serviço temporariamente indisponível. Tente novamente em instantes."));
      }
      return marcar(erro(500, "Erro interno. Tente novamente em instantes."));
    }
  };
}
