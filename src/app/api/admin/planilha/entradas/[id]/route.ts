import { rotasDaLinha } from "@/lib/planilha/rotas-linha";

/** PATCH e DELETE /api/admin/planilha/entradas/[id]: uma entrada manual (tabela `entradas_manuais`). */
const rotas = rotasDaLinha("ENTRADA");
export const PATCH = rotas.PATCH;
export const DELETE = rotas.DELETE;
