import { autenticarApi, comTratamento } from "@/lib/api";
import { hojeNaLoja } from "@/lib/despesas";
import { dadosDoFormulario } from "@/lib/producao-admin";

/** GET /api/admin/production/form-data — insumos com estoque e custo, sabores e custos sugeridos (gás, energia…). */
export const GET = comTratamento("api/admin/production/form-data GET", async () => {
  const auth = await autenticarApi({ admin: true });
  if (!auth.ok) return auth.resposta;
  return Response.json(await dadosDoFormulario(hojeNaLoja()));
});
