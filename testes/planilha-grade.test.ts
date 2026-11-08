/**
 * Planilha (front-end): teclado da grade, leitura do que se digita nas células e a fila de gravação
 * (salvar automático, 409, desfazer), com uma API falsa e um relógio falso.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CategoriaDTO, LinhaPlanilhaDTO } from "@/lib/planilha/tipos";
import { acaoDaTecla, destinoDepoisDeConfirmar } from "@/components/admin/planilha/teclado";
import { lerData, lerValor, filtrarOpcoes, opcaoDoTexto, opcoesDeCategoria, lancamentoDosCampos, camposVazios } from "@/components/admin/planilha/modelo";
import { FilaDeGravacao, type RespostaEnvio } from "@/components/admin/planilha/filaDeGravacao";
import type { Operacao } from "@/components/admin/planilha/modelo";
import type { LancamentosDoPeriodoDTO } from "@/lib/planilha/tipos";
import { agruparAutomaticas, FILTROS_PADRAO, montarVista, ORDEM_PADRAO, ordenarChaves, totaisDaVista } from "@/components/admin/planilha/vista";
import { ehUmaCelula, itensParaColar, prepararColagem } from "@/components/admin/planilha/colar";
import { gerarCsvLancamentos, gerarXlsx, montarAbas, nomeDoArquivo } from "@/components/admin/planilha/exportar";

const T = { linhas: 5, colunas: 4 };

describe("teclado da grade", () => {
  it("setas andam e param na borda", () => {
    assert.deepEqual(acaoDaTecla({ key: "ArrowDown" }, false, { linha: 0, coluna: 0 }, T), { tipo: "mover", para: { linha: 1, coluna: 0 } });
    assert.deepEqual(acaoDaTecla({ key: "ArrowUp" }, false, { linha: 0, coluna: 2 }, T), { tipo: "mover", para: { linha: 0, coluna: 2 } });
    assert.deepEqual(acaoDaTecla({ key: "ArrowRight" }, false, { linha: 2, coluna: 3 }, T), { tipo: "mover", para: { linha: 2, coluna: 3 } });
    assert.deepEqual(acaoDaTecla({ key: "End", ctrlKey: true }, false, { linha: 0, coluna: 0 }, T), { tipo: "mover", para: { linha: 4, coluna: 3 } });
  });
  it("Enter e F2 editam; letra edita trocando o conteúdo; AltGr conta como letra", () => {
    assert.deepEqual(acaoDaTecla({ key: "Enter" }, false, { linha: 0, coluna: 0 }, T), { tipo: "editar", modo: "manter", texto: "" });
    assert.deepEqual(acaoDaTecla({ key: "F2" }, false, { linha: 0, coluna: 0 }, T), { tipo: "editar", modo: "manter", texto: "" });
    assert.deepEqual(acaoDaTecla({ key: "a" }, false, { linha: 0, coluna: 0 }, T), { tipo: "editar", modo: "substituir", texto: "a" });
    assert.deepEqual(acaoDaTecla({ key: "@", ctrlKey: true, altKey: true }, false, { linha: 0, coluna: 0 }, T), { tipo: "editar", modo: "substituir", texto: "@" });
    assert.deepEqual(acaoDaTecla({ key: "c", ctrlKey: true }, false, { linha: 0, coluna: 0 }, T), { tipo: "nada" });
  });
  it("editando: Enter confirma e desce, Tab vai à direita, Esc cancela, setas ficam no campo", () => {
    assert.deepEqual(acaoDaTecla({ key: "Enter" }, true, { linha: 0, coluna: 0 }, T), { tipo: "confirmar", depois: "baixo" });
    assert.deepEqual(acaoDaTecla({ key: "Tab", shiftKey: true }, true, { linha: 0, coluna: 0 }, T), { tipo: "confirmar", depois: "esquerda" });
    assert.deepEqual(acaoDaTecla({ key: "Escape" }, true, { linha: 0, coluna: 0 }, T), { tipo: "cancelar" });
    assert.deepEqual(acaoDaTecla({ key: "ArrowLeft" }, true, { linha: 0, coluna: 0 }, T), { tipo: "nada" });
  });
  it("Tab fora da edição anda na linha e sai da planilha na última coluna", () => {
    assert.deepEqual(acaoDaTecla({ key: "Tab" }, false, { linha: 1, coluna: 2 }, T), { tipo: "mover", para: { linha: 1, coluna: 3 } });
    assert.deepEqual(acaoDaTecla({ key: "Tab" }, false, { linha: 1, coluna: 3 }, T), { tipo: "nada" });
    assert.deepEqual(acaoDaTecla({ key: "Tab", shiftKey: true }, false, { linha: 1, coluna: 0 }, T), { tipo: "nada" });
  });
  it("Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Delete e Ctrl+Delete", () => {
    assert.equal(acaoDaTecla({ key: "z", ctrlKey: true }, false, { linha: 0, coluna: 0 }, T).tipo, "desfazer");
    assert.equal(acaoDaTecla({ key: "Z", ctrlKey: true, shiftKey: true }, false, { linha: 0, coluna: 0 }, T).tipo, "refazer");
    assert.equal(acaoDaTecla({ key: "y", ctrlKey: true }, false, { linha: 0, coluna: 0 }, T).tipo, "refazer");
    assert.equal(acaoDaTecla({ key: "Delete" }, false, { linha: 0, coluna: 0 }, T).tipo, "limpar");
    assert.equal(acaoDaTecla({ key: "Delete", ctrlKey: true }, false, { linha: 0, coluna: 0 }, T).tipo, "excluirLinha");
  });
  it("depois de confirmar com Tab na última coluna, passa para a linha de baixo", () => {
    assert.deepEqual(destinoDepoisDeConfirmar({ linha: 1, coluna: 3 }, T, "direita"), { linha: 2, coluna: 0 });
    assert.deepEqual(destinoDepoisDeConfirmar({ linha: 4, coluna: 1 }, T, "baixo"), { linha: 4, coluna: 1 });
  });
});

describe("células: data e valor digitados", () => {
  const hoje = "2026-11-07";
  it("datas no formato brasileiro", () => {
    assert.deepEqual(lerData("7/11", hoje), { ok: true, valor: "2026-11-07" });
    assert.deepEqual(lerData("07/11/26", hoje), { ok: true, valor: "2026-11-07" });
    assert.deepEqual(lerData("1.10.2026", hoje), { ok: true, valor: "2026-10-01" });
    assert.deepEqual(lerData("2026-10-31", hoje), { ok: true, valor: "2026-10-31" });
    assert.deepEqual(lerData("ontem", "2026-11-01"), { ok: true, valor: "2026-10-31" });
    assert.deepEqual(lerData("29/02/2024", hoje), { ok: true, valor: "2024-02-29" });
  });
  it("recusa mês 13, dia que não existe, futuro e antes de 2020", () => {
    assert.equal(lerData("02/13/2026", hoje).ok, false);
    assert.equal(lerData("31/11", hoje).ok, false);
    assert.equal(lerData("29/02/2025", hoje).ok, false);
    assert.equal(lerData("8/11", hoje).ok, false);
    assert.equal(lerData("31/12/2019", hoje).ok, false);
    assert.equal(lerData("amanhã", hoje).ok, false);
  });
  it("valores com R$, milhar, sinal e parênteses", () => {
    assert.deepEqual(lerValor("12,5"), { ok: true, valor: { centavos: 1250, negativo: false } });
    assert.deepEqual(lerValor("R$ 1.234,56"), { ok: true, valor: { centavos: 123456, negativo: false } });
    assert.deepEqual(lerValor("-12,50"), { ok: true, valor: { centavos: 1250, negativo: true } });
    assert.deepEqual(lerValor("−R$ 3,00"), { ok: true, valor: { centavos: 300, negativo: true } });
    assert.deepEqual(lerValor("(7,00)"), { ok: true, valor: { centavos: 700, negativo: true } });
    assert.equal(lerValor("0").ok, false);
    assert.equal(lerValor("1.2,50").ok, false);
    assert.equal(lerValor("abc").ok, false);
  });
});

const CATS: CategoriaDTO[] = [
  { id: "saida-ingredientes", tipo: "SAIDA", nome: "Ingredientes", grupo: "INGREDIENTES", foraDoResultado: false, ativo: true, ordem: 0, sistema: false, padrao: true, linhas: 3 },
  { id: "saida-gas", tipo: "SAIDA", nome: "Gás", grupo: "OUTROS", foraDoResultado: false, ativo: false, ordem: 1, sistema: false, padrao: false, linhas: 0 },
  { id: "entrada-outras", tipo: "ENTRADA", nome: "Outras entradas", grupo: null, foraDoResultado: false, ativo: true, ordem: 0, sistema: false, padrao: false, linhas: 0 },
  { id: "entrada-aporte", tipo: "ENTRADA", nome: "Aporte da dona", grupo: null, foraDoResultado: true, ativo: true, ordem: 1, sistema: false, padrao: false, linhas: 0 },
  { id: "sistema-site", tipo: "ENTRADA", nome: "Vendas no site", grupo: null, foraDoResultado: false, ativo: true, ordem: 0, sistema: true, padrao: false, linhas: 0 },
];

describe("opções das listas", () => {
  it("categorias do tipo, ativas, sem as de sistema; a desativada só se já é a da linha", () => {
    assert.deepEqual(opcoesDeCategoria(CATS, "SAIDA").map((o) => o.valor), ["saida-ingredientes"]);
    assert.deepEqual(opcoesDeCategoria(CATS, "SAIDA", "saida-gas").map((o) => o.valor), ["saida-ingredientes", "saida-gas"]);
    assert.deepEqual(opcoesDeCategoria(CATS, "ENTRADA").map((o) => o.valor), ["entrada-outras", "entrada-aporte"]);
  });
  it("busca sem acento: começa com primeiro, depois contém; texto único escolhe", () => {
    const ops = opcoesDeCategoria(CATS, null, "saida-gas");
    assert.deepEqual(filtrarOpcoes(ops, "gas").map((o) => o.valor), ["saida-gas"]);
    assert.deepEqual(filtrarOpcoes(ops, "en").map((o) => o.rotulo), ["Ingredientes", "Outras entradas"]);
    assert.equal(opcaoDoTexto(ops, "aporte")?.valor, "entrada-aporte");
    assert.equal(opcaoDoTexto(ops, "zzz"), null);
  });
  it("descrição vazia vai como o nome da categoria", () => {
    const l = lancamentoDosCampos({ ...camposVazios(), data: "2026-11-07", tipo: "SAIDA", categoriaId: "saida-ingredientes", valorCentavos: 500 }, CATS);
    assert.equal(l?.descricao, "Ingredientes");
    assert.equal(lancamentoDosCampos({ ...camposVazios(), tipo: "SAIDA" }, CATS), null);
  });
});

// --- fila de gravação com API e relógio falsos -------------------------------------------------

function dto(p: Partial<LinhaPlanilhaDTO> & { id: string }): LinhaPlanilhaDTO {
  return {
    origem: "manual-saida",
    tipo: "SAIDA",
    editavel: true,
    versao: 0,
    data: "2026-11-05",
    categoriaId: "saida-ingredientes",
    categoriaNome: "Ingredientes",
    foraDoResultado: false,
    descricao: "Açúcar",
    valorCentavos: 1000,
    formaPagamento: null,
    observacao: null,
    quantidade: 1,
    unidade: "UN",
    fornecedor: null,
    insumo: null,
    quantidadeBase: null,
    criadoPor: null,
    criadoEm: null,
    atualizadoPor: null,
    atualizadoEm: null,
    importacaoId: null,
    link: null,
    codigo: null,
    ...p,
  };
}

function montar(responder: (ops: Operacao[]) => RespostaEnvio | Promise<RespostaEnvio>) {
  const enviados: Operacao[][] = [];
  const timers: (() => void)[] = [];
  let n = 0;
  const fila = new FilaDeGravacao({
    enviar: async (ops) => {
      enviados.push(ops);
      return responder(ops);
    },
    categorias: () => CATS,
    hoje: () => "2026-11-07",
    novaChave: () => `chave-${++n}-xxxxxxxx`,
    agendar: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    desagendar: () => {},
  });
  /** Dispara os timers pendentes (os 800 ms) e espera as promessas. */
  const passarTempo = async () => {
    const lista = timers.splice(0);
    for (const fn of lista) fn();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  return { fila, enviados, passarTempo };
}

let seq = 0;
const sucesso = (ops: Operacao[]): RespostaEnvio => ({
  ok: true,
  resultados: ops.map((op, indice) => {
    if (op.op === "criar") return { indice, op: "criar" as const, repetida: false, linha: dto({ id: `novo-${++seq}`, ...op.lancamento, versao: 0, descricao: op.lancamento.descricao, tipo: op.lancamento.tipo, data: op.lancamento.data ?? "2026-11-07" } as LinhaPlanilhaDTO) };
    if (op.op === "alterar") return { indice, op: "alterar" as const, linha: dto({ id: op.id, versao: op.versao + 1, ...(op.campos as Partial<LinhaPlanilhaDTO>) }) };
    return { indice, op: "excluir" as const, id: op.id, linha: dto({ id: op.id }) };
  }),
});

describe("fila de gravação", () => {
  it("sempre há uma linha vazia no fim; a linha nova herda data de hoje e só salva completa", async () => {
    const { fila, enviados, passarTempo } = montar(sucesso);
    assert.equal(fila.ler().linhas.length, 1);
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { tipo: "SAIDA" });
    assert.equal(fila.ler().linhas.length, 2, "apareceu outra linha vazia");
    assert.equal(fila.achar(k)?.campos.data, "2026-11-07");
    assert.equal(fila.achar(k)?.estado, "rascunho");
    await passarTempo();
    assert.equal(enviados.length, 0, "incompleta não vai ao servidor");
    fila.editar(k, { categoriaId: "saida-ingredientes", valorCentavos: 1250 });
    assert.equal(fila.achar(k)?.estado, "pendente");
    await passarTempo();
    assert.equal(enviados.length, 1);
    const op = enviados[0][0];
    assert.equal(op.op, "criar");
    assert.equal(op.op === "criar" && op.lancamento.descricao, "Ingredientes");
    assert.equal(fila.achar(k)?.estado, "salva");
    assert.ok(fila.achar(k)?.servidor?.id.startsWith("novo-"));
  });

  it("alterar manda só os campos mudados com a versão; 409 vira pergunta e 'manter a minha' regrava", async () => {
    let conflito = true;
    const { fila, enviados, passarTempo } = montar((ops) => {
      const op = ops[0];
      if (conflito && op.op === "alterar") {
        conflito = false;
        return { ok: false, status: 409, erro: "Mudou", codigo: "versao", detalhes: { indice: 0, atual: dto({ id: "d1", versao: 3, descricao: "Açúcar cristal", atualizadoPor: { id: "a2", nome: "Ana" } }) } };
      }
      return sucesso(ops);
    });
    fila.carregar([dto({ id: "d1", versao: 2 })]);
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { valorCentavos: 2000 });
    await passarTempo();
    const op = enviados[0][0];
    assert.deepEqual(op, { op: "alterar", id: "d1", tipoAtual: "SAIDA", versao: 2, campos: { valorCentavos: 2000 } });
    assert.equal(fila.achar(k)?.estado, "pergunta");
    assert.equal(fila.achar(k)?.pergunta?.tipo, "versao");
    fila.responder(k, "manter-a-minha");
    assert.equal(fila.achar(k)?.campos.descricao, "Açúcar cristal", "a mudança do outro admin fica");
    await passarTempo();
    const reenvio = enviados[1][0];
    assert.equal(reenvio.op === "alterar" && reenvio.versao, 3);
    assert.deepEqual(reenvio.op === "alterar" && reenvio.campos, { valorCentavos: 2000 }, "só o campo que ela mudou");
    assert.equal(fila.achar(k)?.estado, "salva");
  });

  it("desfazer volta o valor e grava; refazer refaz", async () => {
    const { fila, enviados, passarTempo } = montar(sucesso);
    fila.carregar([dto({ id: "d1", versao: 0, valorCentavos: 1000 })]);
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { valorCentavos: 1500 });
    await passarTempo();
    assert.equal(fila.ler().podeDesfazer, true);
    fila.desfazer();
    await passarTempo();
    assert.equal(fila.achar(k)?.campos.valorCentavos, 1000);
    const ultimo = enviados.at(-1)![0];
    assert.equal(ultimo.op === "alterar" && ultimo.versao, 1);
    fila.refazer();
    await passarTempo();
    assert.equal(fila.achar(k)?.campos.valorCentavos, 1500);
  });

  it("excluir some na hora; 'tira do estoque' pergunta; desfazer recria com o vínculo", async () => {
    let primeira = true;
    const { fila, enviados, passarTempo } = montar((ops) => {
      if (ops[0].op === "excluir" && primeira) {
        primeira = false;
        return { ok: false, status: 409, erro: "Excluir tira 2.155 g de Açúcar do estoque.", codigo: "confirmar-estoque", detalhes: { indice: 0 } };
      }
      return sucesso(ops);
    });
    fila.carregar([dto({ id: "d1", insumo: { id: "ins1", nome: "Açúcar", unidade: "G" }, quantidadeBase: 2155 })]);
    const k = fila.ler().linhas[0].k;
    fila.excluir(k);
    assert.equal(fila.achar(k)?.excluindo, true);
    await passarTempo();
    assert.equal(fila.achar(k)?.pergunta?.tipo, "confirmar-estoque");
    fila.responder(k, "excluir-mesmo-assim");
    await passarTempo();
    const op = enviados.at(-1)![0];
    assert.equal(op.op === "excluir" && op.confirmarEstoque, true);
    assert.equal(fila.achar(k), undefined);
    fila.desfazer();
    await passarTempo();
    const recria = enviados.at(-1)![0];
    assert.equal(recria.op, "criar");
    assert.equal(recria.op === "criar" && recria.lancamento.insumoId, "ins1");
    assert.equal(recria.op === "criar" && recria.lancamento.quantidadeBase, 2155);
  });

  it("colar: um POST com as linhas novas e as alteradas; um Ctrl+Z desfaz o lote inteiro", async () => {
    const { fila, enviados, passarTempo } = montar(sucesso);
    fila.carregar([dto({ id: "d1", versao: 0 })]);
    const k1 = fila.ler().linhas[0].k;
    fila.colar([
      { k: k1, campos: { valorCentavos: 999 } },
      { k: null, campos: { data: "2026-11-06", tipo: "ENTRADA", categoriaId: "entrada-outras", descricao: "Feira", valorCentavos: 3000 } },
      { k: null, campos: { data: "2026-11-06", tipo: "SAIDA", categoriaId: "saida-ingredientes", descricao: "Limão", valorCentavos: 450 } },
    ]);
    await passarTempo();
    assert.equal(enviados.length, 1, "um POST só");
    assert.deepEqual(enviados[0].map((o) => o.op), ["alterar", "criar", "criar"]);
    assert.equal(fila.ler().linhas.filter((l) => l.estado === "salva").length, 3);
    fila.desfazer();
    await passarTempo();
    assert.equal(enviados.length, 2, "o desfazer do lote também é um POST só");
    assert.deepEqual(enviados[1].map((o) => o.op).sort(), ["alterar", "excluir", "excluir"]);
    assert.equal(fila.achar(k1)?.campos.valorCentavos, 1000);
    assert.equal(fila.ler().linhas.filter((l) => l.servidor).length, 1, "as duas coladas saíram");
  });

  it("desfazer a criação de uma linha exclui no servidor; refazer cria de novo", async () => {
    const { fila, enviados, passarTempo } = montar(sucesso);
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { tipo: "SAIDA", categoriaId: "saida-ingredientes", valorCentavos: 700 });
    await passarTempo();
    assert.equal(fila.achar(k)?.estado, "salva");
    fila.desfazer();
    await passarTempo();
    assert.equal(enviados.at(-1)![0].op, "excluir");
    assert.equal(fila.achar(k), undefined);
    fila.refazer();
    await passarTempo();
    assert.equal(enviados.at(-1)![0].op, "criar");
    assert.equal(fila.achar(k)?.estado, "salva");
  });

  it("parece venda presencial: pergunta e 'lançar mesmo assim' reenvia com confirmado", async () => {
    let primeira = true;
    const { fila, enviados, passarTempo } = montar((ops) => {
      if (primeira) {
        primeira = false;
        return { ok: false, status: 409, erro: "Parece venda", codigo: "parece-venda-presencial", detalhes: { indice: 0, vendas: [] } };
      }
      return sucesso(ops);
    });
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { tipo: "ENTRADA", categoriaId: "entrada-outras", valorCentavos: 3000 });
    await passarTempo();
    assert.equal(fila.achar(k)?.pergunta?.tipo, "parece-venda");
    fila.responder(k, "lancar-mesmo-assim");
    await passarTempo();
    const op = enviados.at(-1)![0];
    assert.equal(op.op === "criar" && op.confirmado, true);
    assert.equal(fila.achar(k)?.estado, "salva");
  });

  it("sem conexão: erro na linha e 'Tentar de novo' grava", async () => {
    let falhar = true;
    const { fila, passarTempo } = montar((ops) => {
      if (falhar) throw new Error("rede");
      return sucesso(ops);
    });
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { tipo: "SAIDA", categoriaId: "saida-ingredientes", valorCentavos: 100 });
    await passarTempo();
    assert.equal(fila.achar(k)?.estado, "erro");
    assert.match(fila.achar(k)?.erro?.mensagem ?? "", /conexão/);
    falhar = false;
    fila.tentarDeNovo(k);
    await passarTempo();
    assert.equal(fila.achar(k)?.estado, "salva");
  });

  it("trocar o tipo limpa a categoria do outro tipo e as colunas de compra", () => {
    const { fila } = montar(sucesso);
    fila.carregar([dto({ id: "d1", quantidade: 2, unidade: "KG" })]);
    const k = fila.ler().linhas[0].k;
    fila.editar(k, { tipo: "ENTRADA" });
    const l = fila.achar(k)!;
    assert.equal(l.campos.categoriaId, null);
    assert.equal(l.campos.quantidade, null);
    assert.equal(l.estado, "rascunho");
  });

  it("carregar de novo troca as linhas limpas e preserva as que têm mudança não salva", () => {
    const { fila } = montar(sucesso);
    fila.carregar([dto({ id: "d1" }), dto({ id: "d2" })]);
    const [k1, k2] = fila.ler().linhas.map((l) => l.k);
    fila.editar(k1, { descricao: "minha mudança" });
    fila.carregar([dto({ id: "d1", descricao: "do outro", versao: 1 }), dto({ id: "d2", descricao: "nova versão", versao: 1 }), dto({ id: "d3" })]);
    assert.equal(fila.achar(k1)?.campos.descricao, "minha mudança");
    assert.equal(fila.achar(k2)?.campos.descricao, "nova versão");
    assert.equal(fila.ler().linhas.filter((l) => l.servidor).length, 3);
  });
});

// --- vista (agrupar, ordenar, filtrar, somar) --------------------------------------------------

describe("vista da grade", () => {
  const auto = (id: string, data: string, origem: "site" | "presencial" | "mimos-devolucao", valor: number) =>
    dto({
      id: `${origem}:${id}`,
      origem,
      editavel: false,
      versao: null,
      tipo: "ENTRADA",
      data,
      categoriaId: origem === "site" ? "sistema-site" : origem === "presencial" ? "sistema-presencial" : "sistema-mimos-devolucoes",
      categoriaNome: origem === "site" ? "Vendas no site" : origem === "presencial" ? "Vendas presenciais" : "Devoluções de mimos",
      descricao: `Pedido #${id}`,
      valorCentavos: valor,
      codigo: `#${id}`,
      link: `/admin/orders/${id}`,
    });

  it("agrupa as vendas por dia e categoria, soma o grupo (devolução negativa conta)", () => {
    const grupos = agruparAutomaticas([auto("B", "2026-11-05", "site", 3000), auto("A", "2026-11-05", "site", 1500), auto("C", "2026-11-06", "presencial", 4000), auto("D", "2026-11-06", "mimos-devolucao", -500)]);
    assert.equal(grupos.length, 3);
    const site = grupos.find((g) => g.categoriaId === "sistema-site")!;
    assert.equal(site.valorCentavos, 4500);
    assert.deepEqual(site.itens.map((i) => i.codigo), ["#A", "#B"]);
  });

  it("ordem guardada não muda ao editar; linha nova entra no fim, antes da vazia; filtro esconde, menos a linha mexida", () => {
    const { fila } = montar(sucesso);
    fila.carregar([dto({ id: "d1", data: "2026-11-06", valorCentavos: 500 }), dto({ id: "d2", data: "2026-11-02", tipo: "ENTRADA", categoriaId: "entrada-outras", valorCentavos: 900 })]);
    const grupos = agruparAutomaticas([auto("A", "2026-11-04", "site", 1000)]);
    const ordem = ordenarChaves(fila.ler().linhas, grupos, CATS, ORDEM_PADRAO);
    const [k1, k2] = fila.ler().linhas.map((l) => l.k);
    assert.deepEqual(ordem, [k2, "g:2026-11-04:sistema-site", k1]);
    const base = { linhas: fila.ler().linhas, grupos, ordem, abertos: new Set<string>(), focada: null };
    let vista = montarVista({ ...base, filtros: FILTROS_PADRAO });
    assert.deepEqual(vista.map((i) => i.tipo), ["manual", "grupo", "manual", "manual"]);
    assert.equal(vista.at(-1)?.tipo === "manual" && vista.at(-1)?.tipo === "manual" ? (vista.at(-1) as { linha: { estado: string } }).linha.estado : "", "nova");
    vista = montarVista({ ...base, filtros: { ...FILTROS_PADRAO, tipo: "SAIDA" } });
    assert.deepEqual(vista.filter((i) => i.tipo !== "manual" || i.linha.estado !== "nova").map((i) => i.k), [k1]);
    vista = montarVista({ ...base, abertos: new Set(["g:2026-11-04:sistema-site"]), filtros: FILTROS_PADRAO });
    assert.deepEqual(vista.map((i) => i.tipo), ["manual", "grupo", "auto", "manual", "manual"]);
    // Edita a linha de saída para entrada com o filtro "Saídas": ela continua na tela até salvar.
    fila.editar(k1, { tipo: "ENTRADA", categoriaId: "entrada-outras" });
    vista = montarVista({ ...base, linhas: fila.ler().linhas, filtros: { ...FILTROS_PADRAO, tipo: "SAIDA" } });
    assert.ok(vista.some((i) => i.k === k1));
  });

  it("totais do que está na tela: aporte fora do lucro, devolução reduz entradas, fora do período não conta", () => {
    const { fila } = montar(sucesso);
    fila.carregar([
      dto({ id: "d1", valorCentavos: 1000 }),
      dto({ id: "d2", tipo: "ENTRADA", categoriaId: "entrada-aporte", foraDoResultado: true, valorCentavos: 50000 }),
      dto({ id: "d3", data: "2026-10-31", valorCentavos: 777 }),
    ]);
    const grupos = agruparAutomaticas([auto("A", "2026-11-04", "site", 3000), auto("D", "2026-11-04", "mimos-devolucao", -500)]);
    const ordem = ordenarChaves(fila.ler().linhas, grupos, CATS, ORDEM_PADRAO);
    const vista = montarVista({ linhas: fila.ler().linhas, grupos, ordem, filtros: FILTROS_PADRAO, abertos: new Set(), focada: null });
    const t = totaisDaVista(vista, CATS, { de: "2026-11-01", ate: "2026-11-30" });
    assert.equal(t.entradas, 2500);
    assert.equal(t.saidas, 1000);
    assert.equal(t.resultado, 1500);
    assert.equal(t.foraEntradas, 50000);
    assert.equal(t.movimento, 51500);
    assert.equal(t.linhas, 4);
  });
});

// --- colar do Excel ----------------------------------------------------------------------------

describe("colar do Excel", () => {
  const colunas = ["data", "tipo", "categoriaId", "descricao", "valorCentavos", "formaPagamento", "observacao"] as const;
  function cenario() {
    const { fila } = montar(sucesso);
    fila.carregar([dto({ id: "d1", data: "2026-11-02" })]);
    const ordem = ordenarChaves(fila.ler().linhas, [], CATS, ORDEM_PADRAO);
    const itens = montarVista({ linhas: fila.ler().linhas, grupos: [], ordem, filtros: FILTROS_PADRAO, abertos: new Set(), focada: null });
    return { fila, itens };
  }

  it("3 linhas copiadas do Excel (com a quebra final) a partir da linha vazia viram 3 linhas novas", () => {
    const { itens } = cenario();
    const vazia = itens.at(-1)!;
    const texto = "05/11/2026\tSaída\tIngredientes\tAçúcar\t12,50\r\n06/11\tEntrada\tOutras entradas\tFeira do bairro\tR$ 1.234,56\r\n6/11\tsaida\tCombustível\tGasolina\t-120\r\n";
    const p = prepararColagem({ texto, colunasDaGrade: colunas, inicio: { k: vazia.k, coluna: 0 }, itens, categorias: CATS, hoje: "2026-11-07" });
    assert.equal(p.cabecalho, false);
    assert.equal(p.novas, 3);
    assert.equal(p.comErro, 0);
    assert.deepEqual(p.linhas[0].campos, { tipo: "SAIDA", valorCentavos: 1250, data: "2026-11-05", categoriaId: "saida-ingredientes", descricao: "Açúcar" });
    assert.equal(p.linhas[1].campos.valorCentavos, 123456);
    assert.deepEqual(p.categoriasNovas, [{ nome: "Combustível", tipo: "SAIDA" }]);
    const itensParaFila = itensParaColar(p, (nome, tipo) => (nome === "Combustível" && tipo === "SAIDA" ? "saida-combustivel" : null));
    assert.equal(itensParaFila[2].campos.categoriaId, "saida-combustivel");
    // Categoria desativada não entra calada: vira erro na linha.
    const comGas = prepararColagem({ texto: "6/11\tSaída\tGás\tBotijão\t120\n7/11\tSaída\tIngredientes\tLimão\t5\n", colunasDaGrade: colunas, inicio: { k: vazia.k, coluna: 0 }, itens, categorias: CATS, hoje: "2026-11-07" });
    assert.equal(comGas.comErro, 1);
    assert.match(comGas.linhas[0].erros[0], /desativada/);
  });

  it("com cabeçalho casa as colunas pelo nome; erros por linha não travam as outras", () => {
    const { itens } = cenario();
    const texto = "Valor\tDescrição\tData\tCategoria\tTipo\n10\tLimão\t02/13/2026\tIngredientes\tSaída\n20\tPote\t03/11\tIngredientes\tSaída\n";
    const p = prepararColagem({ texto, colunasDaGrade: colunas, inicio: { k: itens[0].k, coluna: 0 }, itens, categorias: CATS, hoje: "2026-11-07" });
    assert.equal(p.cabecalho, true);
    assert.equal(p.novas, 1);
    assert.equal(p.comErro, 1);
    assert.match(p.linhas[0].erros[0], /data/);
    assert.equal(p.linhas[1].campos.data, "2026-11-03");
  });

  it("sem cabeçalho, a partir da coluna Valor de uma linha existente, altera só o valor", () => {
    const { itens } = cenario();
    const p = prepararColagem({ texto: "99,90\n", colunasDaGrade: colunas, inicio: { k: itens[0].k, coluna: 4 }, itens, categorias: CATS, hoje: "2026-11-07", exigirCompletas: false });
    assert.equal(p.linhas[0].k, itens[0].k);
    assert.deepEqual(p.linhas[0].campos, { valorCentavos: 9990 });
  });

  it("uma célula só não abre a prévia", () => {
    assert.equal(ehUmaCelula("12,50\r\n"), true);
    assert.equal(ehUmaCelula("12,50\t3"), false);
    assert.equal(ehUmaCelula("a\nb"), false);
  });
});

// --- exportar (.xlsx de verdade, lido de volta) -------------------------------------------------

describe("exportar para o Excel", () => {
  const dados: LancamentosDoPeriodoDTO = {
    de: "2026-11-01",
    ate: "2026-11-30",
    hoje: "2026-11-07",
    linhas: [
      dto({ id: "d1", data: "2026-11-03", descricao: "=HYPERLINK(\"http://x\")", valorCentavos: 1250 }),
      dto({ id: "e1", origem: "manual-entrada", tipo: "ENTRADA", categoriaId: "entrada-aporte", categoriaNome: "Aporte da dona", foraDoResultado: true, data: "2026-11-01", descricao: "Aporte", valorCentavos: 50000, formaPagamento: "PIX" }),
      dto({ id: "site:p1", origem: "site", editavel: false, versao: null, tipo: "ENTRADA", categoriaId: "sistema-site", categoriaNome: "Vendas no site", data: "2026-11-05", descricao: "Pedido #A1B2C3", valorCentavos: 3000, codigo: "#A1B2C3", cliente: "Maria Cliente" }),
    ],
    truncado: false,
    totais: { entradasCentavos: 3000, saidasCentavos: 1250, resultadoCentavos: 1750, foraDoResultado: { entradasCentavos: 50000, saidasCentavos: 0 }, movimentoCentavos: 51750, linhas: 3 },
    automaticasPorDia: [],
    saldo: { inicialCentavos: 10000, inicialEm: "2026-11-01", noFimCentavos: 61750 },
    categorias: CATS,
    descricoes: [],
  };

  it("monta as 5 abas, sem nome de cliente por padrão", () => {
    const abas = montarAbas(dados, false);
    assert.deepEqual(abas.map((a) => a.nome), ["Lançamentos", "Resumo mensal", "Por categoria", "Resultado diário", "Categorias"]);
    assert.ok(!abas[0].cabecalho.includes("Cliente"));
    assert.ok(!JSON.stringify(abas).includes("Maria"));
    assert.ok(montarAbas(dados, true)[0].cabecalho.includes("Cliente"));
    const resumo = abas[1].linhas[0];
    assert.deepEqual(resumo, ["nov/2026", { centavos: 3000 }, { centavos: 1250 }, { centavos: 1750 }, { centavos: 50000 }, { centavos: 0 }, { centavos: 51750 }]);
    // Resultado diário: do dia 1 até hoje (7), começando do saldo de antes do período (o inicial).
    const diario = abas[3].linhas;
    assert.equal(diario.length, 7);
    assert.deepEqual(diario[0][5], { centavos: 10000 + 50000 });
    assert.deepEqual(diario[6][5], { centavos: 61750 });
    assert.equal(nomeDoArquivo("2026-11-01", "2026-11-30"), "geleio-financeiro-2026-11");
  });

  it("gera um .xlsx que o SheetJS lê de volta: datas como data, valores como número, fórmula vira texto", async () => {
    const XLSX = await import("xlsx");
    const bytes = gerarXlsx(XLSX, montarAbas(dados, false));
    const livro = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true });
    assert.deepEqual(livro.SheetNames, ["Lançamentos", "Resumo mensal", "Por categoria", "Resultado diário", "Categorias"]);
    const folha = livro.Sheets["Lançamentos"];
    assert.equal(folha["A1"].v, "Data");
    assert.equal(folha["A2"].t, "n");
    assert.equal(folha["A2"].z, "dd/mm/yyyy");
    assert.equal(XLSX.SSF.format("dd/mm/yyyy", folha["A2"].v), "01/11/2026");
    assert.equal(folha["E3"].t, "n");
    assert.equal(folha["E3"].v, 12.5);
    assert.equal(folha["D3"].t, "s");
    assert.equal(folha["D3"].f, undefined, "texto que começa com = não vira fórmula");
    assert.equal(folha["!autofilter"]?.ref, "A1:I4");
    const csv = gerarCsvLancamentos(montarAbas(dados, false));
    assert.match(csv, /'=HYPERLINK/);
    assert.match(csv, /03\/11\/2026;Saída;Ingredientes/);
  });
});