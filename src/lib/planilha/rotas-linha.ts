import "server-only";
import { autenticarApi, comTratamento, erro, lerCorpo, origemInvalida } from "@/lib/api";
import { alterarLinha, excluirLinha } from "@/lib/planilha/lancamentos-admin";
import type { TipoLancamento } from "@/lib/planilha/tipos";
import { alteracaoSchema } from "@/lib/planilha/validacao";

type Contexto = { params: Promise<{ id: string }> };

/**
 * Os handlers de PATCH e DELETE de uma linha manual, iguais para `/saidas/[id]` e `/entradas/[id]` (o tipo
 * diz a tabela). PATCH `{ versao, campos }` → `{ linha, idAnterior? }`; DELETE `?versao=N[&confirmarEstoque=1]`
 * → `{ id, linha }` (a linha como era, para desfazer).
 */
export function rotasDaLinha(tipo: TipoLancamento) {
  const nome = tipo === "SAIDA" ? "saidas" : "entradas";

  const PATCH = comTratamento(`api/admin/planilha/${nome} PATCH`, async (request: Request, ctx: Contexto) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;
    const corpo = await lerCorpo(request, alteracaoSchema);
    if (!corpo.ok) return corpo.resposta;

    const { id } = await ctx.params;
    const r = await alterarLinha(tipo, id, corpo.dados.versao, corpo.dados.campos, auth.usuario.id);
    console.info(`[planilha] ${auth.usuario.id} alterou ${nome} ${id}${r.idAnterior ? ` (agora ${r.linha.id})` : ""}`);
    return Response.json(r);
  });

  const DELETE = comTratamento(`api/admin/planilha/${nome} DELETE`, async (request: Request, ctx: Contexto) => {
    const bloqueio = origemInvalida(request);
    if (bloqueio) return bloqueio;
    const auth = await autenticarApi({ admin: true });
    if (!auth.ok) return auth.resposta;

    const busca = new URL(request.url).searchParams;
    const texto = busca.get("versao") ?? "";
    if (!/^\d{1,9}$/.test(texto)) return erro(400, "Informe a versão da linha (?versao=N).");
    const { id } = await ctx.params;
    if (!id || id.length > 100) return erro(400, "Identificador inválido.");
    const linha = await excluirLinha(tipo, id, Number(texto), busca.get("confirmarEstoque") === "1", auth.usuario.id);
    console.info(`[planilha] ${auth.usuario.id} excluiu ${nome} ${id}`);
    return Response.json({ id, linha });
  });

  return { PATCH, DELETE };
}
