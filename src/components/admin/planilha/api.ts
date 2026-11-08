/**
 * Chamadas da planilha às rotas /api/admin/planilha/* (contratos no README, seção "Planilha
 * financeira"). Dinheiro em centavos; datas "AAAA-MM-DD". As mutações mandam Content-Type exato.
 */
import type { CategoriaDespesa } from "@/lib/despesas";
import type { CategoriaDTO, ConfigFinanceiroDTO, ItemHistoricoDTO, LancamentosDoPeriodoDTO, TipoLancamento } from "@/lib/planilha/tipos";
import type { RespostaEnvio } from "./filaDeGravacao";
import type { Operacao } from "./modelo";

export type Falha = { ok: false; status: number; erro: string; codigo?: string; detalhes?: Record<string, unknown> };
export type Resultado<T> = { ok: true; dados: T } | Falha;

const SEM_CONEXAO: Falha = { ok: false, status: 0, erro: "Sem conexão com a internet. Tente de novo." };

async function pedir<T>(url: string, init?: RequestInit): Promise<Resultado<T>> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body !== undefined ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    return SEM_CONEXAO;
  }
  if (resposta.status === 204) return { ok: true, dados: undefined as T };
  const json = await resposta.json().catch(() => null);
  if (resposta.ok) return { ok: true, dados: json as T };
  return {
    ok: false,
    status: resposta.status,
    erro: typeof json?.erro === "string" ? json.erro : resposta.status === 401 ? "Entre de novo para continuar." : "Não foi possível concluir.",
    codigo: typeof json?.codigo === "string" ? json.codigo : undefined,
    detalhes: json?.detalhes && typeof json.detalhes === "object" ? json.detalhes : undefined,
  };
}

const corpo = (dados: unknown): RequestInit => ({ body: JSON.stringify(dados) });

export function carregarLancamentos(periodo: { de: string; ate: string } | null, comNomes = false) {
  const p = new URLSearchParams();
  if (periodo) {
    p.set("de", periodo.de);
    p.set("ate", periodo.ate);
  }
  if (comNomes) p.set("nomes", "1");
  const consulta = p.toString();
  return pedir<LancamentosDoPeriodoDTO>(`/api/admin/planilha/lancamentos${consulta ? `?${consulta}` : ""}`);
}

/** O lote (também para uma linha só): tudo numa transação no servidor. */
export async function enviarOperacoes(operacoes: Operacao[]): Promise<RespostaEnvio> {
  const r = await pedir<{ resultados: Extract<RespostaEnvio, { ok: true }>["resultados"] }>("/api/admin/planilha/lancamentos", {
    method: "POST",
    ...corpo({ operacoes }),
  });
  return r.ok ? { ok: true, resultados: r.dados.resultados } : r;
}

export const listarCategorias = () => pedir<{ categorias: CategoriaDTO[] }>("/api/admin/planilha/categorias");

export const criarCategoria = (dados: { tipo: TipoLancamento; nome: string; grupo?: CategoriaDespesa; foraDoResultado?: boolean }) =>
  pedir<CategoriaDTO>("/api/admin/planilha/categorias", { method: "POST", ...corpo(dados) });

export const alterarCategoria = (
  id: string,
  dados: Partial<{ nome: string; grupo: CategoriaDespesa; foraDoResultado: boolean; ativo: boolean; ordem: number }>,
) => pedir<CategoriaDTO>(`/api/admin/planilha/categorias/${encodeURIComponent(id)}`, { method: "PATCH", ...corpo(dados) });

export const excluirCategoria = (id: string) =>
  pedir<void>(`/api/admin/planilha/categorias/${encodeURIComponent(id)}`, { method: "DELETE" });

export const lerConfig = () => pedir<ConfigFinanceiroDTO>("/api/admin/planilha/config");

export const salvarConfig = (dados: { saldoInicialCentavos: number; saldoInicialEm: string | null }) =>
  pedir<ConfigFinanceiroDTO>("/api/admin/planilha/config", { method: "PATCH", ...corpo(dados) });

export function lerHistorico(filtro: { entidade?: string; entidadeId?: string; limite?: number } = {}) {
  const p = new URLSearchParams();
  if (filtro.entidade) p.set("entidade", filtro.entidade);
  if (filtro.entidadeId) p.set("entidadeId", filtro.entidadeId);
  p.set("limite", String(filtro.limite ?? 50));
  return pedir<{ itens: ItemHistoricoDTO[] }>(`/api/admin/planilha/historico?${p}`);
}

/** Chave única por linha nova (Idempotency-Key). `randomUUID` só existe em contexto seguro (HTTPS/localhost). */
export function novaChave(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  );
}
