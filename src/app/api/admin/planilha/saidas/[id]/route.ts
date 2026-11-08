import { rotasDaLinha } from "@/lib/planilha/rotas-linha";

/** PATCH e DELETE /api/admin/planilha/saidas/[id]: uma saída manual (tabela `expenses`). */
const rotas = rotasDaLinha("SAIDA");
export const PATCH = rotas.PATCH;
export const DELETE = rotas.DELETE;
