import { z } from "zod";
import { autenticarApi, comTratamento, erro } from "@/lib/api";
import { listarEncomendasAdmin, VISOES_ENCOMENDAS } from "@/lib/encomendas-admin";
import { diaValido } from "@/lib/encomendas-regras";

const consultaSchema = z.object({
  visao: z.enum(VISOES_ENCOMENDAS).default("responder"),
  de: z.string().refine(diaValido, "Data inválida (use AAAA-MM-DD).").optional(),
  ate: z.string().refine(diaValido, "Data inválida (use AAAA-MM-DD).").optional(),
  pagina: z.coerce.number().int().min(1).max(1000).optional(),
});

/**
 * GET /api/admin/encomendas?visao=responder|agenda|aguardando-entrada|devolucoes|historico&de&ate&pagina
 * (admin) → 200 `ListaEncomendasAdminDTO` = `{ visao, encomendas: EncomendaAdminDTO[], agenda?, de?,
 * ate?, total, pagina, porPagina, contagens: { responder, aguardandoEntrada, devolucoes } }`.
 * Grava antes os prazos vencidos. A agenda vai de `de` (padrão: hoje) a `ate` (padrão: de+30), no
 * máximo 62 dias. 400 com `detalhes` por campo.
 */
export const GET = comTratamento("api/admin/encomendas GET", async (request: Request) => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  const parametros = Object.fromEntries(new URL(request.url).searchParams);
  const lido = consultaSchema.safeParse(parametros);
  if (!lido.success) return erro(400, "Parâmetros inválidos.", z.flattenError(lido.error).fieldErrors);
  return Response.json(await listarEncomendasAdmin(lido.data, new Date()));
});
