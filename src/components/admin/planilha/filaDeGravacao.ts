/**
 * A planilha no navegador: as linhas manuais, o que ela mudou e ainda não foi salvo, a gravação
 * automática (800 ms depois da última célula confirmada, ou ao sair da linha), as respostas da API
 * (409 de versão, "parece venda presencial", "tira do estoque") e o desfazer/refazer.
 *
 * Sem React: a grade assina com useSyncExternalStore, e os testes (testes/planilha-grade.test.ts)
 * usam uma API falsa e um relógio falso. Interface otimista: a célula muda na hora; o servidor
 * confirma depois (Netlify em Ohio → Neon em São Paulo, ~120 ms por ida).
 */
import type { CategoriaDTO, LinhaPlanilhaDTO, ResultadoOperacao } from "@/lib/planilha/tipos";
import { MAX_OPERACOES_POR_LOTE } from "@/lib/planilha/tipos";
import {
  camposDoServidor,
  camposParaEnviar,
  camposVazios,
  ehVazia,
  faltando,
  lancamentoDosCampos,
  type CampoId,
  type Campos,
  type Operacao,
} from "./modelo";

export type EstadoLinha = "nova" | "rascunho" | "pendente" | "salvando" | "salva" | "erro" | "pergunta";

/** Situação que só ela resolve (aparece no quadro "Precisa da sua resposta"). */
export type Pergunta =
  | { tipo: "versao"; atual: LinhaPlanilhaDTO; acao: "alterar" | "excluir" }
  | { tipo: "parece-venda"; vendas: LinhaPlanilhaDTO[] }
  | { tipo: "confirmar-estoque"; mensagem: string }
  | { tipo: "sumiu" };

export type Resposta =
  | "usar-a-dele"
  | "manter-a-minha"
  | "lancar-mesmo-assim"
  | "apagar-linha"
  | "excluir-mesmo-assim"
  | "nao-excluir"
  | "recriar"
  | "tirar-da-tela";

export type Vinculo = { insumoId: string; quantidadeBase: number | null };

export type LinhaGrade = {
  /** Chave da linha na tela (não muda quando a linha troca de tipo e ganha outro id no servidor). */
  k: string;
  /** Como o servidor tem a linha (null = ainda não foi criada). */
  servidor: LinhaPlanilhaDTO | null;
  campos: Campos;
  /** Campos mudados aqui e ainda não gravados. */
  sujos: CampoId[];
  estado: EstadoLinha;
  erro: { mensagem: string; campo?: CampoId } | null;
  pergunta: Pergunta | null;
  /** Idempotency-Key da criação (um retry de rede não duplica). */
  chave: string;
  /** Desfazer a exclusão de uma compra ligada ao estoque recria o vínculo. */
  vinculo: Vinculo | null;
  /** Ela mandou excluir: some da tela enquanto o servidor confirma. */
  excluindo: boolean;
  confirmarEstoque: boolean;
  /** Respondeu "lançar mesmo assim" ao aviso de venda presencial. */
  confirmado: boolean;
};

export type RespostaEnvio =
  | { ok: true; resultados: ResultadoOperacao[] }
  | { ok: false; status: number; erro: string; codigo?: string; detalhes?: Record<string, unknown> };

type Passo =
  /** `criou`: foi a primeira célula de uma linha nova; desfazer exclui a linha (o servidor pôs 1 UN etc.). */
  | { tipo: "campos"; k: string; antes: Partial<Campos>; depois: Partial<Campos>; criou: boolean }
  | { tipo: "excluir"; k: string; campos: Campos; vinculo: Vinculo | null; posicao: number }
  | { tipo: "lote"; passos: Passo[] };

export type OpcoesFila = {
  enviar: (operacoes: Operacao[]) => Promise<RespostaEnvio>;
  categorias: () => readonly CategoriaDTO[];
  hoje: () => string;
  novaChave: () => string;
  /** Avisos para a região aria-live ("Linha 12 não salvou: …"). */
  avisar?: (mensagem: string) => void;
  /** Número da linha como aparece na tela (com filtros e ordem); sem ele, a posição na lista. */
  numerar?: (k: string) => number | undefined;
  atraso?: number;
  agendar?: (fn: () => void, ms: number) => unknown;
  desagendar?: (id: unknown) => void;
};

export type FotoDaFila = {
  linhas: readonly LinhaGrade[];
  podeDesfazer: boolean;
  podeRefazer: boolean;
  /** Linhas ainda não salvas (rascunho, pendente, salvando, erro, pergunta). */
  naoSalvas: number;
};

const LIMITE_DESFAZER = 50;

const igual = (a: unknown, b: unknown) => a === b || (Number.isNaN(a) && Number.isNaN(b));

function escolher(c: Campos, chaves: readonly CampoId[]): Partial<Campos> {
  const saida: Partial<Campos> = {};
  for (const k of chaves) (saida as Record<string, unknown>)[k] = c[k];
  return saida;
}

/** O campo da grade a partir da chave do erro de validação ("operacoes.0.campos.valorCentavos"). */
function campoDoErro(chave: string): CampoId | undefined {
  const ultimo = chave.split(".").at(-1) ?? "";
  const campos: CampoId[] = ["data", "tipo", "categoriaId", "descricao", "valorCentavos", "formaPagamento", "observacao", "quantidade", "unidade", "fornecedor"];
  return campos.find((c) => c === ultimo);
}

export class FilaDeGravacao {
  private lista: LinhaGrade[] = [];
  private ouvintes = new Set<() => void>();
  private foto: FotoDaFila = { linhas: [], podeDesfazer: false, podeRefazer: false, naoSalvas: 0 };
  private timers = new Map<string, unknown>();
  private emVoo = new Set<string>();
  private depoisDoVoo = new Set<string>();
  private pilhaDesfazer: Passo[] = [];
  private pilhaRefazer: Passo[] = [];
  private contador = 0;
  /** Linha com o foco: não é tirada da tela mesmo vazia. */
  focada: string | null = null;

  constructor(private o: OpcoesFila) {
    this.normalizar();
    this.publicar();
  }

  /** Troca opções depois de criada (categorias novas, hoje do servidor, numeração da tela). */
  ajustar(opcoes: Partial<OpcoesFila>) {
    this.o = { ...this.o, ...opcoes };
  }

  /** As categorias que a fila conhece agora (as que acabaram de ser criadas inclusive). */
  categorias(): readonly CategoriaDTO[] {
    return this.o.categorias();
  }

  /** Linha com o foco (a grade avisa): não sai da tela mesmo vazia. */
  focar(k: string | null) {
    this.focada = k;
  }

  // --- assinatura (useSyncExternalStore) -------------------------------------------------------

  assinar = (fn: () => void) => {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  };

  ler = (): FotoDaFila => this.foto;

  private publicar() {
    this.foto = {
      linhas: this.lista,
      podeDesfazer: this.pilhaDesfazer.length > 0,
      podeRefazer: this.pilhaRefazer.length > 0,
      naoSalvas: this.lista.filter((l) => !["salva", "nova"].includes(l.estado)).length,
    };
    for (const fn of this.ouvintes) fn();
  }

  // --- linhas ----------------------------------------------------------------------------------

  achar(k: string): LinhaGrade | undefined {
    return this.lista.find((l) => l.k === k);
  }

  private novaK() {
    this.contador += 1;
    return `nova-${this.contador}-${this.o.novaChave().slice(0, 8)}`;
  }

  private linhaEmBranco(k = this.novaK()): LinhaGrade {
    return {
      k,
      servidor: null,
      campos: camposVazios(),
      sujos: [],
      estado: "nova",
      erro: null,
      pergunta: null,
      chave: this.o.novaChave(),
      vinculo: null,
      excluindo: false,
      confirmarEstoque: false,
      confirmado: false,
    };
  }

  private daLinhaDoServidor(dto: LinhaPlanilhaDTO, k = `s:${dto.id}`): LinhaGrade {
    return { ...this.linhaEmBranco(k), servidor: dto, campos: camposDoServidor(dto), estado: "salva" };
  }

  /** Estado a partir dos campos (quando não há erro nem pergunta em aberto). */
  private recalcular(l: LinhaGrade): LinhaGrade {
    if (l.pergunta) return { ...l, estado: "pergunta" };
    if (l.erro) return { ...l, estado: "erro" };
    if (this.emVoo.has(l.k)) return { ...l, estado: "salvando" };
    if (!l.servidor && ehVazia(l.campos)) return { ...l, estado: "nova" };
    if (faltando(l.campos).length) return { ...l, estado: "rascunho" };
    if (!l.servidor || l.sujos.length) return { ...l, estado: "pendente" };
    return { ...l, estado: "salva" };
  }

  private trocar(k: string, f: (l: LinhaGrade) => LinhaGrade) {
    this.lista = this.lista.map((l) => (l.k === k ? f(l) : l));
  }

  /** Sempre uma (e só uma) linha vazia no fim, como a próxima linha livre do Excel. */
  private normalizar() {
    const ultima = this.lista.at(-1);
    this.lista = this.lista.filter(
      (l, i) => l === ultima || l.k === this.focada || !(l.estado === "nova" && i < this.lista.length - 1),
    );
    const fim = this.lista.at(-1);
    if (!fim || fim.servidor || !ehVazia(fim.campos) || fim.excluindo) this.lista = [...this.lista, this.linhaEmBranco()];
  }

  private mudou() {
    this.normalizar();
    this.publicar();
  }

  /**
   * Põe as linhas do servidor (carga do período ou "Atualizar"). Linha com mudança não salva, erro
   * ou pergunta fica como está (o salvar dela vai dar 409 se o outro admin mexeu); as limpas são
   * trocadas pela versão do servidor; as que sumiram do servidor saem; as novas entram no fim.
   */
  carregar(dtos: readonly LinhaPlanilhaDTO[]) {
    const manuais = dtos.filter((d) => d.editavel);
    const porId = new Map(manuais.map((d) => [d.id, d]));
    const vistos = new Set<string>();
    const lista: LinhaGrade[] = [];
    for (const l of this.lista) {
      if (!l.servidor) {
        lista.push(l);
        continue;
      }
      const dto = porId.get(l.servidor.id);
      const ocupada = l.sujos.length > 0 || l.erro || l.pergunta || this.emVoo.has(l.k) || l.excluindo;
      if (dto) {
        vistos.add(dto.id);
        lista.push(ocupada ? l : { ...l, servidor: dto, campos: camposDoServidor(dto), estado: "salva" });
      } else if (ocupada) {
        lista.push(l);
      }
    }
    const novas = manuais.filter((d) => !vistos.has(d.id)).map((d) => this.daLinhaDoServidor(d));
    // As que vieram do servidor entram antes das linhas novas digitadas aqui.
    const locais = lista.filter((l) => !l.servidor);
    const comServidor = lista.filter((l) => l.servidor);
    this.lista = [...comServidor, ...novas, ...locais];
    this.mudou();
  }

  // --- edição ----------------------------------------------------------------------------------

  /**
   * Confirma o que ela digitou numa ou mais células de uma linha. Linha nova herda o tipo e a data
   * da linha de cima (ou hoje), como pede quem lança várias compras do mesmo dia seguidas.
   */
  editar(k: string, mudancas: Partial<Campos>, opcoes: { registrar?: boolean; passos?: Passo[] } = {}) {
    let l = this.achar(k);
    if (!l) {
      // Desfazer/refazer de uma linha que saiu da tela: ela volta no fim.
      l = this.linhaEmBranco(k);
      const fim = this.lista.at(-1);
      this.lista = fim && fim.estado === "nova" ? [...this.lista.slice(0, -1), l, fim] : [...this.lista, l];
    }
    const total: Partial<Campos> = { ...mudancas };
    const criou = !l.servidor && ehVazia(l.campos) && opcoes.registrar !== false;
    if (criou) {
      const i = this.lista.findIndex((x) => x.k === k);
      const acima = this.lista.slice(0, i).reverse().find((x) => !ehVazia(x.campos));
      if (!("data" in total)) total.data = acima?.campos.data || this.o.hoje();
      if (!("tipo" in total) && acima?.campos.tipo) total.tipo = acima.campos.tipo;
    }
    const tipoNovo = "tipo" in total ? total.tipo : l.campos.tipo;
    if ("tipo" in total && tipoNovo !== l.campos.tipo) {
      const categoria = this.o.categorias().find((c) => c.id === ("categoriaId" in total ? total.categoriaId : l.campos.categoriaId));
      if (categoria && tipoNovo && categoria.tipo !== tipoNovo) total.categoriaId = null;
      if (tipoNovo === "ENTRADA") Object.assign(total, { quantidade: null, unidade: null, fornecedor: "" });
    }
    const chaves = (Object.keys(total) as CampoId[]).filter((c) => !igual(total[c], l.campos[c]));
    if (!chaves.length) return;
    const antes = escolher(l.campos, chaves);
    const depois = escolher({ ...l.campos, ...total }, chaves);
    const base = l.servidor ? camposDoServidor(l.servidor) : null;
    this.trocar(k, (x) => {
      const campos = { ...x.campos, ...depois };
      const sujos = base
        ? (Object.keys(campos) as CampoId[]).filter((c) => !igual(campos[c], base[c]))
        : (Object.keys(campos) as CampoId[]).filter((c) => !igual(campos[c], camposVazios()[c]));
      const erro = x.erro && x.erro.campo && chaves.includes(x.erro.campo) ? null : x.erro;
      return this.recalcular({ ...x, campos, sujos, erro, pergunta: x.pergunta?.tipo === "parece-venda" ? null : x.pergunta });
    });
    const passo: Passo = { tipo: "campos", k, antes, depois, criou };
    if (opcoes.passos) opcoes.passos.push(passo);
    else if (opcoes.registrar !== false) this.registrar(passo);

    const atual = this.achar(k)!;
    // Desfazer a primeira edição de uma linha já criada deixa ela vazia: é excluir.
    if (ehVazia(atual.campos) && (atual.servidor || this.emVoo.has(k))) this.trocar(k, (x) => ({ ...x, excluindo: true }));
    // Em lote (colar, desfazer), quem chama grava tudo junto; sozinha, grava depois de 800 ms.
    if (!opcoes.passos) {
      if (this.achar(k)?.excluindo) void this.gravar([k]);
      else this.agendar(k);
    }
    this.mudou();
  }

  private registrar(passo: Passo) {
    this.pilhaDesfazer = [...this.pilhaDesfazer, passo].slice(-LIMITE_DESFAZER);
    this.pilhaRefazer = [];
  }

  /**
   * Colar do Excel: várias linhas de uma vez (alterações e linhas novas). Um só passo de desfazer e
   * um só POST (até 200 operações por vez, numa transação).
   */
  colar(itens: readonly { k: string | null; campos: Partial<Campos> }[]): string[] {
    const passos: Passo[] = [];
    const ks: string[] = [];
    for (const item of itens) {
      let k = item.k;
      if (!k) {
        // Linha nova: entra no lugar da linha vazia do fim (que volta a existir depois).
        const fim = this.lista.at(-1);
        const nova = this.linhaEmBranco();
        this.lista = fim && fim.estado === "nova" ? [...this.lista.slice(0, -1), nova, fim] : [...this.lista, nova];
        k = nova.k;
      }
      this.editar(k, item.campos, { passos });
      ks.push(k);
    }
    if (passos.length) this.registrar({ tipo: "lote", passos });
    this.mudou();
    void this.gravarEmLotes(ks);
    return ks;
  }

  // --- gravação --------------------------------------------------------------------------------

  private agendar(k: string) {
    const agendar = this.o.agendar ?? ((fn, ms) => setTimeout(fn, ms));
    const desagendar = this.o.desagendar ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    if (this.timers.has(k)) desagendar(this.timers.get(k));
    this.timers.set(
      k,
      agendar(() => {
        this.timers.delete(k);
        void this.gravar([k]);
      }, this.o.atraso ?? 800),
    );
  }

  private cancelarTimer(k: string) {
    if (!this.timers.has(k)) return;
    const desagendar = this.o.desagendar ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    desagendar(this.timers.get(k));
    this.timers.delete(k);
  }

  /** Ela saiu da linha: grava já, sem esperar os 800 ms. */
  sairDaLinha(k: string) {
    if (this.timers.has(k)) void this.gravar([k]);
  }

  /** Grava tudo o que está pendente (antes de exportar, por exemplo). */
  async gravarTudo() {
    const ks = this.lista.filter((l) => l.estado === "pendente").map((l) => l.k);
    await this.gravarEmLotes(ks);
  }

  private operacao(l: LinhaGrade): Operacao | null {
    const categorias = this.o.categorias();
    if (l.excluindo) {
      if (!l.servidor || l.servidor.versao === null) return null;
      return {
        op: "excluir",
        id: l.servidor.id,
        tipoAtual: l.servidor.tipo,
        versao: l.servidor.versao,
        ...(l.confirmarEstoque ? { confirmarEstoque: true } : {}),
      };
    }
    if (!l.servidor) {
      const lancamento = lancamentoDosCampos(l.campos, categorias, l.vinculo);
      return lancamento ? { op: "criar", chave: l.chave, lancamento, ...(l.confirmado ? { confirmado: true } : {}) } : null;
    }
    if (!l.sujos.length || faltando(l.campos).length || l.servidor.versao === null) return null;
    const campos = camposParaEnviar(l.campos, l.sujos, categorias);
    if (!Object.keys(campos).length) return null;
    return { op: "alterar", id: l.servidor.id, tipoAtual: l.servidor.tipo, versao: l.servidor.versao, campos };
  }

  private async gravarEmLotes(ks: readonly string[]) {
    for (let i = 0; i < ks.length; i += MAX_OPERACOES_POR_LOTE) await this.gravar(ks.slice(i, i + MAX_OPERACOES_POR_LOTE));
  }

  private async gravar(ks: readonly string[]) {
    const envios: { k: string; op: Operacao; enviado: Campos }[] = [];
    for (const k of ks) {
      this.cancelarTimer(k);
      const l = this.achar(k);
      if (!l || l.pergunta) continue;
      if (this.emVoo.has(k)) {
        this.depoisDoVoo.add(k);
        continue;
      }
      const op = this.operacao(l);
      if (op) envios.push({ k, op, enviado: { ...l.campos } });
    }
    if (!envios.length) return;
    for (const e of envios) {
      this.emVoo.add(e.k);
      this.trocar(e.k, (l) => ({ ...l, estado: "salvando", erro: null }));
    }
    this.publicar();

    const resposta = await this.chamar(envios.map((e) => e.op));
    for (const e of envios) this.emVoo.delete(e.k);

    if (resposta.ok) {
      for (const r of resposta.resultados) {
        const e = envios[r.indice];
        if (!e) continue;
        if (r.op === "excluir") this.lista = this.lista.filter((x) => x.k !== e.k);
        else this.aplicarSucesso(e.k, r.linha, e.enviado);
      }
    } else {
      const indice = typeof resposta.detalhes?.indice === "number" ? resposta.detalhes.indice : envios.length === 1 ? 0 : null;
      envios.forEach((e, i) => {
        if (indice === null || i === indice) this.aplicarErro(e.k, resposta, e.op.op === "excluir" ? "excluir" : "alterar");
        else {
          // O lote todo voltou por causa de outra linha: esta continua pendente e grava sozinha.
          this.trocar(e.k, (l) => this.recalcular(l));
          this.agendar(e.k);
        }
      });
      if (envios.length > 1 && indice !== null) {
        this.o.avisar?.(`O lote não foi gravado por causa da linha ${this.numero(envios[indice].k)}; as outras serão salvas uma a uma.`);
      }
    }
    for (const k of [...this.depoisDoVoo]) {
      this.depoisDoVoo.delete(k);
      this.agendar(k);
    }
    this.mudou();
  }

  private async chamar(ops: Operacao[]): Promise<RespostaEnvio> {
    try {
      return await this.o.enviar(ops);
    } catch {
      return { ok: false, status: 0, erro: "Sem conexão com a internet: não salvou." };
    }
  }

  /** Número da linha na lista (1 = primeira), para as mensagens. */
  numero(k: string): number {
    return this.o.numerar?.(k) ?? this.lista.findIndex((l) => l.k === k) + 1;
  }

  private aplicarSucesso(k: string, dto: LinhaPlanilhaDTO, enviado: Campos) {
    const l = this.achar(k);
    if (!l) return;
    // O que ela mudou enquanto o servidor respondia continua pendente.
    const ainda = l.sujos.filter((c) => !igual(l.campos[c], enviado[c]));
    const campos = { ...camposDoServidor(dto), ...escolher(l.campos, ainda) };
    this.trocar(k, (x) =>
      this.recalcular({ ...x, servidor: dto, campos, sujos: ainda, erro: null, pergunta: null, confirmado: false, vinculo: null }),
    );
    // Ela excluiu a linha enquanto a criação ia ao servidor: agora que existe, exclui.
    if (l.excluindo) void this.gravar([k]);
    else if (ainda.length) this.agendar(k);
  }

  private aplicarErro(k: string, r: Extract<RespostaEnvio, { ok: false }>, acao: "alterar" | "excluir") {
    const d = r.detalhes ?? {};
    let pergunta: Pergunta | null = null;
    let erro: LinhaGrade["erro"] = null;
    if (r.codigo === "versao" && d.atual) pergunta = { tipo: "versao", atual: d.atual as LinhaPlanilhaDTO, acao };
    else if (r.codigo === "parece-venda-presencial") pergunta = { tipo: "parece-venda", vendas: (d.vendas as LinhaPlanilhaDTO[]) ?? [] };
    else if (r.codigo === "confirmar-estoque") pergunta = { tipo: "confirmar-estoque", mensagem: r.erro };
    else if (r.codigo === "nao-encontrada" || r.status === 404) pergunta = { tipo: "sumiu" };
    else if (r.codigo === "categoria") erro = { mensagem: r.erro, campo: "categoriaId" };
    else if (r.codigo === "ligada-ao-estoque") erro = { mensagem: r.erro, campo: "tipo" };
    else if (r.status === 401 || r.status === 403) erro = { mensagem: "Sua sessão terminou: entre de novo para salvar." };
    else if (r.status === 400 && d && typeof d === "object") {
      const [chave, mensagens] = Object.entries(d).find(([c]) => c !== "indice") ?? [];
      erro = { mensagem: Array.isArray(mensagens) && mensagens[0] ? String(mensagens[0]) : r.erro, campo: chave ? campoDoErro(chave) : undefined };
    } else erro = { mensagem: r.erro || "Não foi possível salvar." };

    const l = this.achar(k);
    if ((l?.excluindo && !l.servidor) || (acao === "excluir" && pergunta?.tipo === "sumiu")) {
      // Excluída enquanto a criação ia ao servidor e a criação falhou, ou excluída por outra pessoa:
      // nos dois casos não há mais o que excluir.
      this.lista = this.lista.filter((x) => x.k !== k);
      return;
    }
    if (acao === "excluir" && pergunta?.tipo !== "versao" && pergunta?.tipo !== "confirmar-estoque") {
      // A exclusão não aconteceu (sem conexão, sessão…): a linha volta, e o passo de desfazer dela sai.
      this.esquecerExclusao(k);
    }
    // A linha volta à tela (com a pergunta ou o erro) até ela decidir.
    this.trocar(k, (x) => this.recalcular({ ...x, pergunta, erro, excluindo: false }));
    const n = this.numero(k);
    if (pergunta) this.o.avisar?.(`Linha ${n} precisa da sua resposta: veja o quadro acima da planilha.`);
    else if (erro) this.o.avisar?.(`Linha ${n} não salvou: ${erro.mensagem}`);
  }

  tentarDeNovo(k: string) {
    const l = this.achar(k);
    if (!l) return;
    this.trocar(k, (x) => this.recalcular({ ...x, erro: null }));
    this.mudou();
    void this.gravar([k]);
  }

  // --- exclusão --------------------------------------------------------------------------------

  /** Exclui a linha (Ctrl+Delete ou a lixeira). Volta com Ctrl+Z. */
  excluir(k: string) {
    const i = this.lista.findIndex((l) => l.k === k);
    const l = this.lista[i];
    if (!l || ehVazia(l.campos)) return;
    this.cancelarTimer(k);
    this.registrar({ tipo: "excluir", k, campos: l.campos, vinculo: l.servidor?.insumo ? { insumoId: l.servidor.insumo.id, quantidadeBase: l.servidor.quantidadeBase } : l.vinculo, posicao: i });
    if (!l.servidor && !this.emVoo.has(k)) {
      this.lista = this.lista.filter((x) => x.k !== k);
      this.mudou();
      return;
    }
    this.enviarExclusao(k);
  }

  /** Marca para excluir e grava (se a linha estiver indo ao servidor, exclui quando ela voltar). */
  private enviarExclusao(k: string) {
    this.trocar(k, (x) => ({ ...x, excluindo: true }));
    this.mudou();
    void this.gravar([k]);
  }

  // --- perguntas -------------------------------------------------------------------------------

  responder(k: string, resposta: Resposta) {
    const l = this.achar(k);
    if (!l?.pergunta) return;
    const p = l.pergunta;
    switch (resposta) {
      case "usar-a-dele":
        if (p.tipo === "versao") {
          this.trocar(k, (x) => this.recalcular({ ...x, servidor: p.atual, campos: camposDoServidor(p.atual), sujos: [], pergunta: null, excluindo: false }));
          if (p.acao === "excluir") this.esquecerExclusao(k);
        }
        break;
      case "manter-a-minha":
        if (p.tipo === "versao") {
          const base = camposDoServidor(p.atual);
          this.trocar(k, (x) =>
            this.recalcular({ ...x, servidor: p.atual, sujos: (Object.keys(x.campos) as CampoId[]).filter((c) => !igual(x.campos[c], base[c])), pergunta: null }),
          );
          if (p.acao === "excluir") this.enviarExclusao(k);
          else {
            this.mudou();
            void this.gravar([k]);
          }
          return;
        }
        break;
      case "lancar-mesmo-assim":
        this.trocar(k, (x) => this.recalcular({ ...x, confirmado: true, pergunta: null }));
        this.mudou();
        void this.gravar([k]);
        return;
      case "apagar-linha":
      case "tirar-da-tela":
        this.lista = this.lista.filter((x) => x.k !== k);
        break;
      case "excluir-mesmo-assim":
        this.trocar(k, (x) => ({ ...x, confirmarEstoque: true, pergunta: null }));
        this.enviarExclusao(k);
        return;
      case "nao-excluir":
        this.trocar(k, (x) => this.recalcular({ ...x, pergunta: null, excluindo: false }));
        this.esquecerExclusao(k);
        break;
      case "recriar":
        this.trocar(k, (x) => this.recalcular({ ...x, servidor: null, chave: this.o.novaChave(), sujos: Object.keys(x.campos) as CampoId[], pergunta: null }));
        this.mudou();
        void this.gravar([k]);
        return;
    }
    this.mudou();
  }

  // --- desfazer / refazer ----------------------------------------------------------------------

  /** A exclusão não aconteceu: o passo de desfazer dela sai da pilha (senão o Ctrl+Z duplicaria a linha). */
  private esquecerExclusao(k: string) {
    const i = this.pilhaDesfazer.findLastIndex((p) => p.tipo === "excluir" && p.k === k);
    if (i >= 0) this.pilhaDesfazer = [...this.pilhaDesfazer.slice(0, i), ...this.pilhaDesfazer.slice(i + 1)];
  }

  desfazer(): boolean {
    const passo = this.pilhaDesfazer.at(-1);
    if (!passo) return false;
    this.pilhaDesfazer = this.pilhaDesfazer.slice(0, -1);
    const ks = this.aplicarPasso(passo, "desfazer");
    this.pilhaRefazer = [...this.pilhaRefazer, passo];
    this.mudou();
    void this.gravarEmLotes(ks);
    return true;
  }

  refazer(): boolean {
    const passo = this.pilhaRefazer.at(-1);
    if (!passo) return false;
    this.pilhaRefazer = this.pilhaRefazer.slice(0, -1);
    const ks = this.aplicarPasso(passo, "refazer");
    this.pilhaDesfazer = [...this.pilhaDesfazer, passo];
    this.mudou();
    void this.gravarEmLotes(ks);
    return true;
  }

  /** Aplica (ou volta) um passo só na tela; devolve as linhas a gravar. */
  private aplicarPasso(passo: Passo, sentido: "desfazer" | "refazer"): string[] {
    if (passo.tipo === "lote") {
      const ordem = sentido === "desfazer" ? [...passo.passos].reverse() : passo.passos;
      return [...new Set(ordem.flatMap((p) => this.aplicarPasso(p, sentido)))];
    }
    if (passo.tipo === "campos" && passo.criou && sentido === "desfazer") return this.tirarLinha(passo.k);
    if (passo.tipo === "campos") {
      const l = this.achar(passo.k);
      if (passo.criou && (!l || l.excluindo)) {
        // Refazer a criação de uma linha que o desfazer excluiu: ela volta como linha nova.
        this.lista = this.lista.filter((x) => x.k !== passo.k);
      }
      this.editar(passo.k, sentido === "desfazer" ? passo.antes : passo.depois, { registrar: false, passos: [] });
      return this.achar(passo.k) ? [passo.k] : [];
    }
    // Exclusão: desfazer recria a linha (com o vínculo de estoque, se havia); refazer exclui de novo.
    if (sentido === "desfazer") {
      const nova: LinhaGrade = this.recalcular({
        ...this.linhaEmBranco(passo.k),
        campos: passo.campos,
        sujos: Object.keys(passo.campos) as CampoId[],
        vinculo: passo.vinculo,
      });
      const semEla = this.lista.filter((l) => l.k !== passo.k);
      const pos = Math.min(passo.posicao, Math.max(semEla.length - 1, 0));
      this.lista = [...semEla.slice(0, pos), nova, ...semEla.slice(pos)];
      return [passo.k];
    }
    return this.tirarLinha(passo.k);
  }

  /** Exclui (se já existe no servidor) ou só tira da tela; devolve as linhas a gravar. */
  private tirarLinha(k: string): string[] {
    const l = this.achar(k);
    if (!l) return [];
    if (l.servidor || this.emVoo.has(k)) {
      this.trocar(k, (x) => ({ ...x, excluindo: true }));
      return [k];
    }
    this.lista = this.lista.filter((x) => x.k !== k);
    return [];
  }
}
