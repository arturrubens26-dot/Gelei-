"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { hojeNaLoja } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import { validarPeriodo } from "@/lib/planilha/regras";
import { CATEGORIA_PADRAO, MAX_DIAS_PERIODO, type CategoriaDTO, type LancamentosDoPeriodoDTO, type TipoLancamento } from "@/lib/planilha/tipos";
import { carregarLancamentos, criarCategoria, enviarOperacoes, listarCategorias, novaChave } from "./api";
import { CartoesLancamentos } from "./CartoesLancamentos";
import { ehUmaCelula, itensParaColar, prepararColagem, type PreviaColagem } from "./colar";
import { BarraDeFiltros, chaveDaOrdem, nomeDoPeriodo, ordemDaChave, SeletorDePeriodo } from "./Controles";
import { DialogoColar } from "./DialogoColar";
import { BotaoExportar } from "./BotaoExportar";
import { FilaDeGravacao } from "./filaDeGravacao";
import { GradeLancamentos } from "./GradeLancamentos";
import { COLUNAS } from "./modelo";
import { Perguntas } from "./Perguntas";
import { agruparAutomaticas, FILTROS_PADRAO, montarVista, ORDEM_PADRAO, ordenarChaves, totaisDaVista, type ColunaOrdenavel, type Filtros, type Ordem } from "./vista";

const CONSULTA_CELULAR = "(max-width: 767px)";

function assinarTela(fn: () => void) {
  const m = window.matchMedia(CONSULTA_CELULAR);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
}

/** Muda parâmetros do endereço sem recarregar (o Next acompanha o replaceState). */
function trocarParametros(mudancas: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(mudancas)) {
    if (v === null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url);
}

type Carga = { chave: string; dados?: LancamentosDoPeriodoDTO; erro?: string };

/**
 * Aba Lançamentos: o período, os filtros, a grade (ou os cartões no celular), o quadro do que
 * precisa de atenção e os totais do que está na tela. Os dados vêm de GET /api/admin/planilha/
 * lancamentos; o que ela digita vai pela fila de gravação (salva sozinho).
 */
export function Lancamentos({ ativa }: { ativa: boolean }) {
  const params = useSearchParams();
  const deUrl = params.get("de");
  const ateUrl = params.get("ate");
  const periodoPedido = deUrl && ateUrl && validarPeriodo(deUrl, ateUrl, MAX_DIAS_PERIODO).ok ? { de: deUrl, ate: ateUrl } : null;
  const tipoUrl = params.get("tipo");
  const filtroTipo: TipoLancamento | null = tipoUrl === "ENTRADA" || tipoUrl === "SAIDA" ? tipoUrl : null;
  const filtroCategorias = useMemo(() => (params.get("cat") ?? "").split(",").filter(Boolean), [params]);

  const [recarga, setRecarga] = useState(0);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [categorias, setCategorias] = useState<CategoriaDTO[]>([]);
  const [ordem, setOrdem] = useState<Ordem>(() => ordemDaChave(params.get("ordem")) ?? ORDEM_PADRAO);
  const [ordemChaves, setOrdemChaves] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [automaticas, setAutomaticas] = useState(true);
  const [colunasDeCompra, setColunasDeCompra] = useState(false);
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const [previa, setPrevia] = useState<{ previa: PreviaColagem } | null>(null);
  const [aviso, setAviso] = useState({ texto: "", n: 0 });

  const ordemRef = useRef(ordem);
  const avisar = (texto: string) => setAviso((a) => ({ texto, n: a.n + 1 }));

  // Categorias, "hoje", avisos e numeração chegam à fila por `ajustar` (depois da carga e a cada render).
  const [fila] = useState(() => new FilaDeGravacao({ enviar: enviarOperacoes, novaChave, categorias: () => [], hoje: () => hojeNaLoja() }));
  const foto = useSyncExternalStore(fila.assinar, fila.ler, fila.ler);
  const celular = useSyncExternalStore(
    assinarTela,
    () => window.matchMedia(CONSULTA_CELULAR).matches,
    () => false,
  );

  const chave = `${periodoPedido?.de ?? ""}|${periodoPedido?.ate ?? ""}|${recarga}`;
  useEffect(() => {
    let cancelado = false;
    const [de, ate] = chave.split("|");
    carregarLancamentos(de && ate ? { de, ate } : null).then((r) => {
      if (cancelado) return;
      if (!r.ok) return setCarga({ chave, erro: r.erro });
      fila.ajustar({ categorias: () => r.dados.categorias, hoje: () => r.dados.hoje });
      fila.carregar(r.dados.linhas);
      const grupos = agruparAutomaticas(r.dados.linhas.filter((l) => !l.editavel));
      setCategorias(r.dados.categorias);
      setOrdemChaves(ordenarChaves(fila.ler().linhas, grupos, r.dados.categorias, ordemRef.current));
      setCarga({ chave, dados: r.dados });
    });
    return () => {
      cancelado = true;
    };
  }, [chave, fila]);

  // Voltou para a janela (o outro admin pode ter mexido): recarrega, se a última carga tem mais de 20 s.
  const ultimaCarga = useRef(0);
  useEffect(() => {
    ultimaCarga.current = Date.now();
  }, [carga]);
  useEffect(() => {
    if (!ativa) return;
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && Date.now() - ultimaCarga.current > 20_000) setRecarga((n) => n + 1);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [ativa]);

  // Aviso ao fechar a aba ou recarregar com linha não salva.
  useEffect(() => {
    if (!foto.naoSalvas) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [foto.naoSalvas]);

  useEffect(() => {
    ordemRef.current = ordem;
    fila.ajustar({ avisar, categorias: () => categorias });
  });

  const dados = carga?.dados;
  const carregando = carga?.chave !== chave;
  const erroCarga = !carregando ? carga?.erro : undefined;
  const de = dados?.de ?? periodoPedido?.de ?? "";
  const ate = dados?.ate ?? periodoPedido?.ate ?? "";
  const hoje = dados?.hoje ?? "";

  const filtros: Filtros = { tipo: filtroTipo, categorias: filtroCategorias, busca, automaticas };
  const grupos = useMemo(() => agruparAutomaticas(dados?.linhas.filter((l) => !l.editavel) ?? []), [dados]);
  const itens = useMemo(
    () => montarVista({ linhas: foto.linhas, grupos, ordem: ordemChaves, filtros, abertos, focada: fila.focada }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filtros` é recriado a cada render; as partes dele estão aqui.
    [foto.linhas, grupos, ordemChaves, filtroTipo, filtroCategorias, busca, automaticas, abertos, fila],
  );
  const numeros = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const i of itens) if (i.tipo === "manual" && i.linha.estado !== "nova") m.set(i.k, ++n);
    return m;
  }, [itens]);
  useEffect(() => {
    fila.ajustar({ numerar: (k) => numeros.get(k) });
  }, [numeros, fila]);

  const periodo = { de, ate };
  const totais = totaisDaVista(itens, categorias, periodo);
  const filtrado = !!(filtroTipo || filtroCategorias.length || busca.trim() || !automaticas);
  // Saldo em caixa no fim do período: o do servidor, corrigido pelo que mudou aqui e ainda não voltou dele.
  const totaisTudo = filtrado ? totaisDaVista(montarVista({ linhas: foto.linhas, grupos, ordem: ordemChaves, filtros: FILTROS_PADRAO, abertos, focada: null }), categorias, periodo) : totais;
  const saldoNoFim = dados && dados.saldo.noFimCentavos !== null && !dados.truncado ? dados.saldo.noFimCentavos + (totaisTudo.movimento - dados.totais.movimentoCentavos) : null;

  const colunas = COLUNAS.filter((c) => !c.compra || colunasDeCompra);

  function mudarPeriodo(novoDe: string, novoAte: string) {
    fila.ler().linhas.forEach((l) => fila.sairDaLinha(l.k));
    trocarParametros({ de: novoDe, ate: novoAte });
  }

  function mudarFiltros(f: Filtros) {
    setBusca(f.busca);
    setAutomaticas(f.automaticas);
    if (f.tipo !== filtroTipo || f.categorias.join(",") !== filtroCategorias.join(",")) {
      trocarParametros({ tipo: f.tipo, cat: f.categorias.join(",") || null });
    }
  }

  function mudarOrdem(o: Ordem) {
    setOrdem(o);
    ordemRef.current = o;
    trocarParametros({ ordem: chaveDaOrdem(o) === chaveDaOrdem(ORDEM_PADRAO) ? null : chaveDaOrdem(o) });
    setOrdemChaves(ordenarChaves(fila.ler().linhas, grupos, categorias, o));
  }

  function ordenarPelaColuna(coluna: ColunaOrdenavel) {
    mudarOrdem({ coluna, direcao: ordem.coluna === coluna && ordem.direcao === "asc" ? "desc" : "asc" });
  }

  function alternarGrupo(k: string) {
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(k)) novo.delete(k);
      else novo.add(k);
      return novo;
    });
  }

  function guardarCategoria(c: CategoriaDTO) {
    const lista = [...fila.categorias().filter((x) => x.id !== c.id), c];
    // Já, sem esperar o render: a colagem que criou a categoria grava em seguida.
    fila.ajustar({ categorias: () => lista });
    setCategorias(lista);
  }

  async function criarNovaCategoria(tipo: TipoLancamento, nome: string): Promise<{ ok: true; categoria: CategoriaDTO } | { ok: false; erro: string }> {
    const r = await criarCategoria({ tipo, nome });
    if (r.ok) {
      guardarCategoria(r.dados);
      avisar(`Categoria “${r.dados.nome}” criada. Mude o nome ou a ordem na aba Auxiliar.`);
      return { ok: true, categoria: r.dados };
    }
    if (r.codigo === "nome-repetido") {
      // Já existe (talvez desativada): usa a que existe.
      const lista = await listarCategorias();
      if (lista.ok) {
        fila.ajustar({ categorias: () => lista.dados.categorias });
        setCategorias(lista.dados.categorias);
        const achada = lista.dados.categorias.find((c) => c.tipo === tipo && c.nome.toLowerCase() === nome.toLowerCase());
        if (achada) return { ok: true, categoria: achada };
      }
    }
    return { ok: false, erro: r.erro };
  }

  function aoColar(texto: string, inicio: { k: string; coluna: number }) {
    const base = { texto, colunasDaGrade: colunas.map((c) => c.id), inicio, itens, categorias, hoje: hoje || hojeNaLoja() };
    if (ehUmaCelula(texto)) {
      // Uma célula: como se tivesse digitado nela.
      const p = prepararColagem({ ...base, exigirCompletas: false });
      const linha = p.linhas[0];
      const alvo = itens.find((i) => i.k === inicio.k);
      if (!linha || !alvo || alvo.tipo !== "manual") return avisar(alvo ? "Linha automática: não se cola por cima." : "Nada para colar.");
      if (p.erroGeral || linha.erros.length || linha.categoriaNova) {
        return avisar(`Não colou: ${p.erroGeral ?? (linha.categoriaNova ? `a categoria “${linha.categoriaNova.nome}” não existe` : linha.erros.join("; "))}.`);
      }
      fila.editar(alvo.k, linha.campos);
      return;
    }
    setPrevia({ previa: prepararColagem(base) });
  }

  async function confirmarColagem(p: PreviaColagem, criar: boolean): Promise<string | null> {
    const criadas = new Map<string, string>();
    if (criar) {
      for (const c of p.categoriasNovas) {
        const r = await criarNovaCategoria(c.tipo, c.nome);
        if (!r.ok) return `Não consegui criar a categoria “${c.nome}”: ${r.erro}`;
        criadas.set(`${c.tipo}|${c.nome.toLowerCase()}`, r.categoria.id);
      }
    }
    const lista = itensParaColar(p, (nome, tipo) => criadas.get(`${tipo}|${nome.toLowerCase()}`) ?? CATEGORIA_PADRAO[tipo]);
    fila.colar(lista);
    setPrevia(null);
    avisar(`${lista.length} ${lista.length === 1 ? "linha colada" : "linhas coladas"}. Ctrl+Z desfaz tudo de uma vez.`);
    return null;
  }

  async function antesDeExportar(): Promise<number> {
    await fila.gravarTudo();
    return fila.ler().naoSalvas;
  }

  const temCompra = foto.linhas.some((l) => l.campos.tipo === "SAIDA");

  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* Avisos para leitores de tela (salvou, não salvou, desfeito…). */}
      <p role="status" aria-live="polite" className="sr-only" key={aviso.n}>
        {aviso.texto}
      </p>

      {hoje && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SeletorDePeriodo key={`${de}|${ate}`} de={de} ate={ate} hoje={hoje} aoMudar={mudarPeriodo} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secundario" disabled={!foto.podeDesfazer} onClick={() => fila.desfazer() && avisar("Desfeito.")} title="Ctrl+Z">
              Desfazer
            </button>
            <button type="button" className="btn-secundario" disabled={!foto.podeRefazer} onClick={() => fila.refazer() && avisar("Refeito.")} title="Ctrl+Y">
              Refazer
            </button>
            <button
              type="button"
              className="btn-secundario aria-disabled:cursor-wait aria-disabled:opacity-60"
              aria-disabled={carregando || undefined}
              onClick={() => !carregando && setRecarga((n) => n + 1)}
            >
              {carregando ? "Atualizando…" : "Atualizar"}
            </button>
            {de && ate && <BotaoExportar de={de} ate={ate} antes={antesDeExportar} />}
          </div>
        </div>
      )}

      {hoje && !celular && (
        <BarraDeFiltros
          filtros={filtros}
          aoMudar={mudarFiltros}
          categorias={categorias}
          ordem={ordem}
          aoOrdenar={mudarOrdem}
          colunasDeCompra={colunasDeCompra}
          aoColunasDeCompra={setColunasDeCompra}
          mostrarColunasDeCompra={temCompra || colunasDeCompra}
        />
      )}

      {erroCarga && (
        <p role="alert" className="rounded-lg border-2 border-[#B3261E] bg-white p-3 font-semibold text-[#8C1D18]">
          {erroCarga}{" "}
          <button type="button" className="underline" onClick={() => setRecarga((n) => n + 1)}>
            Tentar de novo
          </button>
        </p>
      )}

      {!dados && carregando && (
        <div className="h-80 animate-pulse rounded-md bg-accent1/30" role="status">
          <span className="sr-only">Carregando a planilha…</span>
        </div>
      )}

      {dados && (
        <>
          <Perguntas linhas={foto.linhas} fila={fila} numeros={numeros} />
          {dados.truncado && (
            <p className="rounded-md border border-primaria/40 bg-white p-3 text-sm">
              Este período tem mais de 5.000 lançamentos: a lista foi cortada (os totais do servidor contam tudo). Escolha um período menor.
            </p>
          )}

          {celular ? (
            <CartoesLancamentos
              itens={itens}
              fila={fila}
              categorias={categorias}
              descricoes={dados.descricoes}
              hoje={hoje}
              numeros={numeros}
              totais={totais}
              saldoNoFim={saldoNoFim}
              filtros={filtros}
              aoMudarFiltros={mudarFiltros}
              aoAlternarGrupo={alternarGrupo}
              avisar={avisar}
              aoCriarCategoria={criarNovaCategoria}
            />
          ) : (
            <div aria-busy={carregando} className={carregando ? "opacity-70 transition-opacity" : ""}>
              <details className="mb-2 text-sm">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-secundaria underline underline-offset-2">
                  Como usar o teclado e colar do Excel
                </summary>
                <ul className="mt-1 grid max-w-4xl list-disc gap-x-8 gap-y-1 pl-5 sm:grid-cols-2">
                  <li>Clique numa célula e digite: o que estava lá é trocado.</li>
                  <li><kbd>Enter</kbd> confirma e desce; <kbd>Tab</kbd> confirma e vai para a direita.</li>
                  <li><kbd>Esc</kbd> desiste do que digitou; <kbd>F2</kbd> edita sem apagar.</li>
                  <li>Data: <strong>7/11</strong> ou <strong>07/11/2026</strong> (sempre dia/mês). Valor: <strong>12,50</strong>.</li>
                  <li>Valor com sinal de menos (−12,50) numa linha nova vira Saída.</li>
                  <li>Na Categoria, digite parte do nome; se não existir, escolha “+ Criar categoria”.</li>
                  <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz; <kbd>Ctrl</kbd>+<kbd>Y</kbd> refaz; <kbd>Ctrl</kbd>+<kbd>Delete</kbd> exclui a linha.</li>
                  <li>Copie linhas no Excel e cole aqui com <kbd>Ctrl</kbd>+<kbd>V</kbd> (mostra uma prévia antes).</li>
                  <li>A linha salva sozinha quando fica completa. Vendas do site, feira e mimos entram sozinhas (com cadeado).</li>
                  <li>Venda de geleia na feira: lance em Venda presencial (conta estoque e sabor), não aqui.</li>
                </ul>
              </details>
              <GradeLancamentos
                itens={itens}
                colunas={colunas}
                categorias={categorias}
                descricoes={dados.descricoes}
                hoje={hoje}
                fila={fila}
                numeros={numeros}
                ordem={ordem}
                aoOrdenar={ordenarPelaColuna}
                aoAlternarGrupo={alternarGrupo}
                aoColar={aoColar}
                aoCriarCategoria={criarNovaCategoria}
                avisar={avisar}
              />
              <Rodape totais={totais} saldoNoFim={saldoNoFim} filtrado={filtrado} periodo={nomeDoPeriodo(de, ate)} />
            </div>
          )}
        </>
      )}

      {previa && (
        <DialogoColar previa={previa.previa} aoConfirmar={(criar) => confirmarColagem(previa.previa, criar)} aoCancelar={() => setPrevia(null)} />
      )}
    </div>
  );
}

function Valor({ centavos, sinal }: { centavos: number; sinal?: boolean }) {
  return (
    <span className="tabular-nums">
      {sinal && centavos > 0 ? "+" : ""}
      {formatarBRL(centavos / 100)}
    </span>
  );
}

/** Totais do que está na tela, sempre visíveis embaixo da grade (como a barra de status do Excel). */
export function Rodape({ totais, saldoNoFim, filtrado, periodo }: { totais: ReturnType<typeof totaisDaVista>; saldoNoFim: number | null; filtrado: boolean; periodo: string }) {
  const negativo = totais.resultado < 0;
  return (
    <section aria-label="Totais" className="mt-2 rounded-md border-2 border-primaria/70 bg-white">
      <dl className="grid grid-cols-2 gap-px bg-primaria/15 sm:grid-cols-3 lg:grid-cols-5">
        <div className="bg-white px-4 py-2.5">
          <dt className="text-sm font-semibold text-primaria/85">Entradas</dt>
          <dd className="text-xl font-bold text-[#1F6B3A]">
            <Valor centavos={totais.entradas} />
          </dd>
        </div>
        <div className="bg-white px-4 py-2.5">
          <dt className="text-sm font-semibold text-primaria/85">Saídas</dt>
          <dd className="text-xl font-bold text-secundaria">
            <Valor centavos={totais.saidas} />
          </dd>
        </div>
        <div className="bg-white px-4 py-2.5">
          <dt className="text-sm font-semibold text-primaria/85">{negativo ? "Resultado (faltou)" : "Resultado (sobrou)"}</dt>
          <dd className={`text-xl font-bold ${negativo ? "text-secundaria" : "text-primaria"}`}>
            <Valor centavos={totais.resultado} />
          </dd>
        </div>
        <div className="bg-white px-4 py-2.5">
          <dt className="text-sm font-semibold text-primaria/85">Linhas</dt>
          <dd className="text-xl font-bold tabular-nums">{totais.linhas}</dd>
        </div>
        <div className="col-span-2 bg-white px-4 py-2.5 sm:col-span-1">
          <dt className="text-sm font-semibold text-primaria/85">Saldo em caixa no fim</dt>
          <dd className="text-xl font-bold">{saldoNoFim === null ? <span className="text-base font-semibold text-primaria/80">Informe o saldo inicial no Auxiliar</span> : <Valor centavos={saldoNoFim} />}</dd>
        </div>
      </dl>
      <p className="border-t border-primaria/15 px-4 py-2 text-sm text-primaria/85">
        {filtrado ? "Somando só o que está filtrado na tela" : `Somando tudo de: ${periodo}`}.
        {(totais.foraEntradas > 0 || totais.foraSaidas > 0) && (
          <>
            {" "}
            Fora do lucro (mexem só no caixa): aportes <Valor centavos={totais.foraEntradas} />, retiradas <Valor centavos={totais.foraSaidas} />.
          </>
        )}{" "}
        O saldo em caixa conta tudo do período, sem filtro.
      </p>
    </section>
  );
}
