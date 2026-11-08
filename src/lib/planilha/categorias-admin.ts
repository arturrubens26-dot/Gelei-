import "server-only";
import type { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { CATEGORIAS_DESPESA } from "@/lib/despesas";
import { ErroNegocio } from "@/lib/erros";
import { registrarAuditoria } from "@/lib/planilha/auditoria";
import { CATEGORIAS_SISTEMA, categoriaDoGrupo, type CategoriaDTO, type ConfigFinanceiroDTO } from "@/lib/planilha/tipos";
import type { alterarCategoriaSchema, configFinanceiroSchema, novaCategoriaSchema } from "@/lib/planilha/validacao";

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

type CategoriaDoBanco = Prisma.CategoriaFinanceiraGetPayload<object>;

const fotoCategoria = (c: CategoriaDoBanco) => ({ tipo: c.tipo, nome: c.nome, grupo: c.grupo, foraDoResultado: c.foraDoResultado, ativo: c.ativo, ordem: c.ordem });

async function paraDTO(tx: Prisma.TransactionClient, c: CategoriaDoBanco): Promise<CategoriaDTO> {
  const [despesas, entradas] = await Promise.all([tx.expense.count({ where: { categoriaId: c.id } }), tx.entradaManual.count({ where: { categoriaId: c.id } })]);
  return { id: c.id, tipo: c.tipo, nome: c.nome, grupo: c.grupo, foraDoResultado: c.foraDoResultado, ativo: c.ativo, ordem: c.ordem, sistema: false, padrao: IDS_PADRAO.has(c.id), linhas: despesas + entradas };
}

const nomeRepetido = (nome: string) => new ErroNegocio(409, `Já existe uma categoria "${nome}" deste tipo.`, { nome: [`Já existe uma categoria "${nome}".`] }, "nome-repetido");

/** O UNIQUE (tipo, lower(nome)) do banco também barra a corrida entre dois admins criando o mesmo nome. */
function traduzirNomeRepetido(e: unknown, nome: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw nomeRepetido(nome);
  throw e;
}

async function conferirNomeLivre(tx: Prisma.TransactionClient, tipo: CategoriaDTO["tipo"], nome: string, menosId?: string) {
  const [igual] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM categorias_financeiras WHERE tipo = ${tipo}::"TipoLancamento" AND lower(nome) = lower(${nome}) AND id <> ${menosId ?? ""} LIMIT 1`;
  if (igual) throw nomeRepetido(nome);
}

/** Nova categoria (aba Auxiliar). Saída sem grupo vai para "Outros"; entrada nunca tem grupo. */
export async function criarCategoria(e: z.output<typeof novaCategoriaSchema>, adminId: string): Promise<CategoriaDTO> {
  try {
    return await db.$transaction(async (tx) => {
      await conferirNomeLivre(tx, e.tipo, e.nome);
      const ultima = await tx.categoriaFinanceira.aggregate({ where: { tipo: e.tipo }, _max: { ordem: true } });
      const criada = await tx.categoriaFinanceira.create({
        data: {
          tipo: e.tipo,
          nome: e.nome,
          grupo: e.tipo === "SAIDA" ? (e.grupo ?? "OUTROS") : null,
          foraDoResultado: e.foraDoResultado,
          ordem: Math.min((ultima._max.ordem ?? 0) + 10, 9999),
          atualizadoPorId: adminId,
        },
      });
      await registrarAuditoria(tx, { entidade: "categoria", entidadeId: criada.id, acao: "CRIOU", depois: fotoCategoria(criada), adminId });
      return paraDTO(tx, criada);
    });
  } catch (e2) {
    traduzirNomeRepetido(e2, e.nome);
  }
}

const SISTEMA_IDS = new Set<string>(Object.values(CATEGORIAS_SISTEMA).map((c) => c.id));
const naoEncontrada = () => new ErroNegocio(404, "Categoria não encontrada.", undefined, "nao-encontrada");

/**
 * Renomeia, muda o grupo, "fora do resultado", ativa/desativa ou reordena. Mudar o grupo de uma categoria de
 * saída atualiza também o grupo antigo (`expenses.categoria`) das despesas dela, para os relatórios por grupo
 * continuarem certos. As semeadas de cada grupo (`padrao`) não mudam de grupo.
 */
export async function alterarCategoria(id: string, e: z.output<typeof alterarCategoriaSchema>, adminId: string): Promise<CategoriaDTO> {
  if (SISTEMA_IDS.has(id)) throw naoEncontrada();
  try {
    return await db.$transaction(async (tx) => {
      const atual = await tx.categoriaFinanceira.findUnique({ where: { id } });
      if (!atual) throw naoEncontrada();
      if (e.grupo !== undefined && atual.tipo === "ENTRADA") throw new ErroNegocio(400, "Categoria de entrada não tem grupo.", { grupo: ["Categoria de entrada não tem grupo."] });
      if (e.grupo !== undefined && e.grupo !== atual.grupo && IDS_PADRAO.has(id)) {
        throw new ErroNegocio(409, "Esta categoria é a padrão do grupo e não muda de grupo. Crie outra categoria.", undefined, "categoria-padrao");
      }
      if (e.nome !== undefined && e.nome.toLowerCase() !== atual.nome.toLowerCase()) await conferirNomeLivre(tx, atual.tipo, e.nome, id);
      const gravada = await tx.categoriaFinanceira.update({
        where: { id },
        data: {
          ...(e.nome !== undefined ? { nome: e.nome } : {}),
          ...(e.grupo !== undefined ? { grupo: e.grupo } : {}),
          ...(e.foraDoResultado !== undefined ? { foraDoResultado: e.foraDoResultado } : {}),
          ...(e.ativo !== undefined ? { ativo: e.ativo } : {}),
          ...(e.ordem !== undefined ? { ordem: e.ordem } : {}),
          atualizadoPorId: adminId,
        },
      });
      if (e.grupo !== undefined && e.grupo !== atual.grupo) {
        await tx.expense.updateMany({ where: { categoriaId: id }, data: { categoria: e.grupo } });
      }
      await registrarAuditoria(tx, { entidade: "categoria", entidadeId: id, acao: "ALTEROU", antes: fotoCategoria(atual), depois: fotoCategoria(gravada), adminId });
      return paraDTO(tx, gravada);
    });
  } catch (e2) {
    traduzirNomeRepetido(e2, e.nome ?? "");
  }
}

/** Exclui só categoria sem lançamentos (com lançamentos: desative) e que não seja a padrão de um grupo. */
export async function excluirCategoria(id: string, adminId: string): Promise<void> {
  if (SISTEMA_IDS.has(id)) throw naoEncontrada();
  if (IDS_PADRAO.has(id)) throw new ErroNegocio(409, "Esta categoria é a padrão do grupo e não pode ser excluída (a tela de Despesas grava nela). Desative-a.", undefined, "categoria-padrao");
  try {
    await db.$transaction(async (tx) => {
      const atual = await tx.categoriaFinanceira.findUnique({ where: { id } });
      if (!atual) throw naoEncontrada();
      const dto = await paraDTO(tx, atual);
      if (dto.linhas > 0) {
        throw new ErroNegocio(409, `Esta categoria tem ${dto.linhas} lançamento(s): desative em vez de excluir.`, { linhas: dto.linhas }, "categoria-em-uso");
      }
      await tx.categoriaFinanceira.delete({ where: { id } });
      await registrarAuditoria(tx, { entidade: "categoria", entidadeId: id, acao: "EXCLUIU", antes: fotoCategoria(atual), adminId });
    });
  } catch (e) {
    // Um lançamento gravado no meio do caminho: a FK Restrict recusa (P2003).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new ErroNegocio(409, "Esta categoria passou a ter lançamentos: desative em vez de excluir.", undefined, "categoria-em-uso");
    }
    throw e;
  }
}

// --- saldo inicial -------------------------------------------------------------------------------------------

async function lerConfig(cliente: Prisma.TransactionClient | typeof db) {
  return cliente.configFinanceiro.findUnique({ where: { id: 1 }, include: { atualizadoPor: { select: { id: true, nome: true } } } });
}

type ConfigDoBanco = NonNullable<Awaited<ReturnType<typeof lerConfig>>>;

const configParaDTO = (c: ConfigDoBanco | null): ConfigFinanceiroDTO => ({
  saldoInicialCentavos: c ? c.saldoInicial.mul(100).toDecimalPlaces(0).toNumber() : 0,
  saldoInicialEm: c?.saldoInicialEm ? c.saldoInicialEm.toISOString().slice(0, 10) : null,
  atualizadoEm: (c?.atualizadoEm ?? new Date(0)).toISOString(),
  atualizadoPor: c?.atualizadoPor ?? null,
});

export async function obterConfigFinanceiro(): Promise<ConfigFinanceiroDTO> {
  return configParaDTO(await lerConfig(db));
}

/** Saldo da conta da loja num dia (decisão D7: o dia 1º do mês em que ela começar a usar). */
export async function salvarConfigFinanceiro(e: z.output<typeof configFinanceiroSchema>, adminId: string): Promise<ConfigFinanceiroDTO> {
  return db.$transaction(async (tx) => {
    const antes = await lerConfig(tx);
    const dados = {
      saldoInicial: new Prisma.Decimal(e.saldoInicialCentavos).div(100),
      saldoInicialEm: e.saldoInicialEm ? new Date(`${e.saldoInicialEm}T00:00:00Z`) : null,
      atualizadoPorId: adminId,
    };
    await tx.configFinanceiro.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
    const depois = await lerConfig(tx);
    const foto = (c: ConfigFinanceiroDTO) => ({ saldoInicialCentavos: c.saldoInicialCentavos, saldoInicialEm: c.saldoInicialEm });
    await registrarAuditoria(tx, { entidade: "config", entidadeId: "1", acao: "ALTEROU", antes: foto(configParaDTO(antes)), depois: foto(configParaDTO(depois)), adminId });
    return configParaDTO(depois);
  });
}
