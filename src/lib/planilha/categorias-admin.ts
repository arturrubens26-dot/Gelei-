import "server-only";
import { db } from "@/lib/db";
import { CATEGORIAS_DESPESA } from "@/lib/despesas";
import { CATEGORIAS_SISTEMA, categoriaDoGrupo, type CategoriaDTO } from "@/lib/planilha/tipos";

/** Ids das categorias semeadas de cada grupo antigo ("saida-ingredientes"…): não se excluem nem mudam de grupo. */
export const IDS_PADRAO = new Set<string>(CATEGORIAS_DESPESA.map(categoriaDoGrupo));

/** As categorias de sistema (vendas, mimos), como DTO somente leitura. */
const SISTEMA: CategoriaDTO[] = Object.values(CATEGORIAS_SISTEMA).map((c, i) => ({
  id: c.id,
  tipo: "ENTRADA",
  nome: c.nome,
  grupo: null,
  foraDoResultado: false,
  ativo: true,
  ordem: i,
  sistema: true,
  padrao: false,
  linhas: 0,
}));

/** Todas as categorias (inclusive inativas) + as de sistema, com quantos lançamentos usam cada uma. */
export async function listarCategorias(): Promise<CategoriaDTO[]> {
  const [categorias, porDespesa, porEntrada] = await Promise.all([
    db.categoriaFinanceira.findMany({ orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { nome: "asc" }] }),
    db.expense.groupBy({ by: ["categoriaId"], _count: { _all: true } }),
    db.entradaManual.groupBy({ by: ["categoriaId"], _count: { _all: true } }),
  ]);
  const uso = new Map<string, number>();
  for (const l of [...porDespesa, ...porEntrada]) if (l.categoriaId) uso.set(l.categoriaId, (uso.get(l.categoriaId) ?? 0) + l._count._all);
  return [
    ...SISTEMA,
    ...categorias.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      nome: c.nome,
      grupo: c.grupo,
      foraDoResultado: c.foraDoResultado,
      ativo: c.ativo,
      ordem: c.ordem,
      sistema: false,
      padrao: IDS_PADRAO.has(c.id),
      linhas: uso.get(c.id) ?? 0,
    })),
  ];
}
