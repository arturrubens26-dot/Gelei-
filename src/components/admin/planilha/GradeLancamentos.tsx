"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import type { CategoriaDTO, TipoLancamento } from "@/lib/planilha/tipos";
import { formatarBRL } from "@/lib/dinheiro";
import { EditorCelula } from "./EditorCelula";
import type { FilaDeGravacao, LinhaGrade } from "./filaDeGravacao";
import {
  campoOpcional,
  campoValeParaTipo,
  camposVazios,
  diaDaSemana,
  faltando,
  formatarData,
  listarFaltando,
  textoDaCelula,
  textoParaEditar,
  type Campos,
  type Coluna,
} from "./modelo";
import { acaoDaTecla, destinoDepoisDeConfirmar, type Direcao } from "./teclado";
import type { ColunaOrdenavel, ItemDaVista, Ordem } from "./vista";

/** Cores de texto das entradas e saídas: verde ≈ 6,5:1 e carmesim ≈ 6,3:1 sobre branco (WCAG AA). */
export const COR_ENTRADA = "text-[#1F6B3A]";
export const COR_SAIDA = "text-secundaria";

type Edicao = { k: string; coluna: number; texto: string; substituir: boolean };

export type PropsGrade = {
  itens: readonly ItemDaVista[];
  colunas: readonly Coluna[];
  categorias: readonly CategoriaDTO[];
  descricoes: readonly string[];
  hoje: string;
  fila: FilaDeGravacao;
  numeros: ReadonlyMap<string, number>;
  ordem: Ordem;
  aoOrdenar: (coluna: ColunaOrdenavel) => void;
  aoAlternarGrupo: (k: string) => void;
  /** Texto colado (do Excel) a partir de uma célula: abre a prévia. */
  aoColar: (texto: string, inicio: { k: string; coluna: number }) => void;
  aoCriarCategoria: PropsEditorCriar;
  avisar: (mensagem: string) => void;
};

type PropsEditorCriar = (tipo: TipoLancamento, nome: string) => Promise<{ ok: true; categoria: CategoriaDTO } | { ok: false; erro: string }>;

const FIM = "__fim__";

const ORDENAVEIS: readonly string[] =["data", "tipo", "categoriaId", "descricao", "valorCentavos"];

/**
 * A grade de lançamentos (computador e tablet): uma tabela com o padrão ARIA "grid". Só uma célula
 * recebe Tab (foco itinerante); setas, Enter, Tab, Esc, F2, Delete e Ctrl+Z funcionam como no Excel
 * (regras em teclado.ts). A coluna "Situação" diz se a linha salvou.
 */
export function GradeLancamentos(p: PropsGrade) {
  const router = useRouter();
  const ajudaId = useId();
  const celulas = useRef(new Map<string, HTMLTableCellElement>());
  const [ativa, setAtiva] = useState<{ k: string; coluna: number } | null>(null);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  /** Só puxa o foco para a célula quando a ação veio da própria grade (nunca ao carregar a página). */
  const focar = useRef(false);

  const nColunas = p.colunas.length + 1; // + Situação
  const tamanho = { linhas: p.itens.length, colunas: nColunas };

  // Posição da célula ativa (pela chave: a linha pode mudar de lugar ao salvar ou filtrar).
  // FIM = a última linha (a vazia, que pode ter acabado de aparecer embaixo da que foi preenchida).
  const indiceAtivo = ativa ? (ativa.k === FIM ? p.itens.length - 1 : p.itens.findIndex((i) => i.k === ativa.k)) : -1;
  const pos = indiceAtivo >= 0 && ativa ? { linha: indiceAtivo, coluna: Math.min(ativa.coluna, nColunas - 1) } : { linha: 0, coluna: 0 };
  const kAtivo = p.itens[pos.linha]?.k ?? null;

  useEffect(() => {
    if (!focar.current || edicao || !kAtivo) return;
    focar.current = false;
    celulas.current.get(`${kAtivo}|${pos.coluna}`)?.focus({ preventScroll: false });
  });

  // A fila não tira da tela a linha com foco (mesmo vazia).
  const fila = p.fila;
  useEffect(() => {
    fila.focar(edicao?.k ?? null);
  }, [edicao, fila]);

  function irPara(linha: number, coluna: number) {
    const item = p.itens[Math.max(0, Math.min(linha, p.itens.length - 1))];
    if (!item) return;
    // Saiu da linha: grava já (sem esperar os 800 ms).
    if (kAtivo && item.k !== kAtivo) p.fila.sairDaLinha(kAtivo);
    focar.current = true;
    setAtiva({ k: item.k, coluna });
  }

  function linhaManual(i: number): LinhaGrade | null {
    const item = p.itens[i];
    return item?.tipo === "manual" ? item.linha : null;
  }

  function comecarEdicao(linha: number, coluna: number, texto: string, substituir: boolean) {
    const item = p.itens[linha];
    if (!item) return;
    if (item.tipo === "grupo") return p.aoAlternarGrupo(item.k);
    if (item.tipo === "auto") {
      if (item.dto.link) router.push(item.dto.link);
      return;
    }
    if (coluna >= p.colunas.length) {
      // Situação: Enter tenta de novo quando a linha não salvou.
      if (item.linha.estado === "erro") p.fila.tentarDeNovo(item.k);
      return;
    }
    const col = p.colunas[coluna];
    if (!campoValeParaTipo(col.id, item.linha.campos.tipo)) {
      p.avisar(`${col.rotulo} é só para saídas (compras).`);
      return;
    }
    const inicial = substituir ? texto : textoParaEditar(col.id, item.linha.campos, p.categorias);
    setEdicao({ k: item.k, coluna, texto: inicial, substituir });
  }

  function confirmar(e: Edicao, mudancas: Partial<Campos>, depois: Direcao | null) {
    p.fila.editar(e.k, mudancas);
    setEdicao(null);
    focar.current = true;
    if (depois) {
      const linha = p.itens.findIndex((i) => i.k === e.k);
      // Preencher a linha vazia do fim faz outra aparecer embaixo: Enter desce para ela.
      const naUltima = linha === p.itens.length - 1 && depois === "baixo";
      const destino = destinoDepoisDeConfirmar({ linha, coluna: e.coluna }, tamanho, depois);
      const item = p.itens[destino.linha];
      if (naUltima || (item && item.k !== e.k)) p.fila.sairDaLinha(e.k);
      setAtiva({ k: naUltima ? FIM : (item?.k ?? e.k), coluna: destino.coluna });
    } else setAtiva({ k: e.k, coluna: e.coluna });
  }

  function teclaNaGrade(e: KeyboardEvent<HTMLTableElement>) {
    if (edicao) return;
    const acao = acaoDaTecla(e.nativeEvent, false, pos, tamanho);
    switch (acao.tipo) {
      case "nada":
        return;
      case "mover":
        e.preventDefault();
        irPara(acao.para.linha, acao.para.coluna);
        return;
      case "editar":
        e.preventDefault();
        comecarEdicao(pos.linha, pos.coluna, acao.texto, acao.modo === "substituir");
        return;
      case "limpar": {
        e.preventDefault();
        const l = linhaManual(pos.linha);
        const col = p.colunas[pos.coluna];
        if (!l || !col) return;
        if (campoOpcional(col.id)) p.fila.editar(l.k, { [col.id]: camposVazios()[col.id] } as Partial<Campos>);
        else p.avisar(`${col.rotulo} é obrigatório: digite outro valor por cima.`);
        return;
      }
      case "desfazer":
        e.preventDefault();
        if (!p.fila.desfazer()) p.avisar("Nada para desfazer.");
        else p.avisar("Desfeito.");
        return;
      case "refazer":
        e.preventDefault();
        if (!p.fila.refazer()) p.avisar("Nada para refazer.");
        else p.avisar("Refeito.");
        return;
      case "excluirLinha": {
        e.preventDefault();
        const l = linhaManual(pos.linha);
        if (l && l.estado !== "nova") {
          p.fila.excluir(l.k);
          p.avisar(`Linha ${p.numeros.get(l.k) ?? ""} excluída. Ctrl+Z desfaz.`);
          focar.current = true;
        }
        return;
      }
      default:
        return;
    }
  }

  function colar(e: ClipboardEvent<HTMLTableElement>) {
    if (edicao || !kAtivo) return;
    const texto = e.clipboardData.getData("text/plain");
    if (!texto) return;
    e.preventDefault();
    p.aoColar(texto, { k: kAtivo, coluna: Math.min(pos.coluna, p.colunas.length - 1) });
  }

  function copiar(e: ClipboardEvent<HTMLTableElement>) {
    if (edicao) return;
    const item = p.itens[pos.linha];
    const col = p.colunas[pos.coluna];
    if (!item || !col) return;
    let texto = "";
    if (item.tipo === "manual") {
      texto = col.id === "valorCentavos" ? textoParaEditar(col.id, item.linha.campos, p.categorias) : textoDaCelula(col.id, item.linha.campos, p.categorias);
    } else if (item.tipo === "auto") texto = col.id === "descricao" ? item.dto.descricao : "";
    e.clipboardData.setData("text/plain", texto);
    e.preventDefault();
  }

  const registrar = (k: string, coluna: number) => (el: HTMLTableCellElement | null) => {
    const chave = `${k}|${coluna}`;
    if (el) celulas.current.set(chave, el);
    else celulas.current.delete(chave);
  };

  /** Propriedades comuns de toda célula navegável. */
  const celula = (linha: number, coluna: number, k: string) => ({
    ref: registrar(k, coluna),
    role: "gridcell" as const,
    "aria-colindex": coluna + 2,
    tabIndex: linha === pos.linha && coluna === pos.coluna ? 0 : -1,
    onClick: () => {
      if (edicao?.k === k && edicao.coluna === coluna) return;
      irPara(linha, coluna);
    },
    onDoubleClick: () => comecarEdicao(linha, coluna, "", false),
    onFocus: () => {
      if (kAtivo !== k || pos.coluna !== coluna) setAtiva({ k, coluna });
    },
  });

  const contornoAtivo = "focus:outline-[3px] focus:outline-offset-[-3px] focus:outline-secundaria";

  return (
    <div className="flex flex-col gap-2">
      <p id={ajudaId} className="sr-only">
        Planilha editável. Setas andam; Enter ou F2 editam; digitar uma letra troca o conteúdo; Enter confirma e desce; Tab
        confirma e vai para a direita; Esc desiste; Delete limpa a célula; Ctrl+Z desfaz; Ctrl+Delete exclui a linha; Ctrl+V
        cola do Excel. Para sair da planilha, Tab na última coluna.
      </p>
      <div
        data-rolagem
        role="region"
        aria-label="Planilha de lançamentos (role para ver mais)"
        className="relative max-h-[calc(100dvh-19rem)] min-h-80 overflow-auto rounded-md border-2 border-primaria/70 bg-white"
      >
        <table
          role="grid"
          aria-label="Lançamentos"
          aria-describedby={ajudaId}
          aria-rowcount={p.itens.length + 1}
          aria-colcount={nColunas + 1}
          onKeyDown={teclaNaGrade}
          onPaste={colar}
          onCopy={copiar}
          className="w-full min-w-[60rem] table-fixed border-collapse text-base"
        >
          <colgroup>
            <col className="w-12" />
            {p.colunas.map((c) => (
              <col key={c.id} className={c.largura} />
            ))}
            <col className="w-44" />
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr role="row" aria-rowindex={1}>
              <th scope="col" className="border-r border-destaque/30 bg-primaria px-2 py-2.5 text-center text-sm font-semibold text-destaque">
                <span aria-hidden="true">nº</span>
                <span className="sr-only">Número da linha</span>
              </th>
              {p.colunas.map((c) => {
                const ordenavel = ORDENAVEIS.includes(c.id);
                const ordenada = p.ordem.coluna === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    role="columnheader"
                    aria-sort={ordenada ? (p.ordem.direcao === "asc" ? "ascending" : "descending") : undefined}
                    className={`border-r border-destaque/30 bg-primaria px-2 py-2.5 text-sm font-semibold text-destaque ${c.direita ? "text-right" : "text-left"}`}
                  >
                    {ordenavel ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => p.aoOrdenar(c.id as ColunaOrdenavel)}
                        title={`Ordenar por ${c.rotulo.toLowerCase()}`}
                        className={`inline-flex items-center gap-1 hover:underline ${c.direita ? "flex-row-reverse" : ""}`}
                      >
                        {c.rotulo}
                        <span aria-hidden="true" className="text-xs">
                          {ordenada ? (p.ordem.direcao === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    ) : (
                      c.rotulo
                    )}
                  </th>
                );
              })}
              <th scope="col" className="bg-primaria px-2 py-2.5 text-left text-sm font-semibold text-destaque">
                Situação
              </th>
            </tr>
          </thead>
          <tbody>
            {p.itens.map((item, linha) => {
              const zebra = linha % 2 === 1 ? "bg-destaque/60" : "bg-white";
              if (item.tipo === "grupo") {
                const g = item.grupo;
                const n = g.itens.length;
                const palavra = g.categoriaId === "sistema-site" ? (n === 1 ? "pedido" : "pedidos") : g.categoriaId === "sistema-presencial" ? (n === 1 ? "venda" : "vendas") : n === 1 ? "lançamento" : "lançamentos";
                return (
                  <tr key={item.k} role="row" aria-rowindex={linha + 2} className="bg-[#F3EEE8]">
                    <td className="border-b border-r border-primaria/15 px-2 text-center text-primaria/80" aria-hidden="true">
                      <Cadeado />
                    </td>
                    {p.colunas.map((c, coluna) => (
                      <td
                        key={c.id}
                        {...celula(linha, coluna, item.k)}
                        aria-readonly="true"
                        className={`h-11 truncate border-b border-r border-primaria/15 px-2 text-primaria ${c.direita ? "text-right tabular-nums" : ""} ${contornoAtivo}`}
                      >
                        {c.id === "data" ? (
                          <DataComDia data={g.data} />
                        ) : c.id === "tipo" ? (
                          <span className={`font-semibold ${g.tipo === "ENTRADA" ? COR_ENTRADA : COR_SAIDA}`}>{g.tipo === "ENTRADA" ? "Entrada" : "Saída"}</span>
                        ) : c.id === "categoriaId" ? (
                          g.categoriaNome
                        ) : c.id === "descricao" ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-expanded={item.aberto}
                            onClick={(e) => {
                              e.stopPropagation();
                              irPara(linha, coluna);
                              p.aoAlternarGrupo(item.k);
                            }}
                            className="inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline"
                          >
                            <span aria-hidden="true">{item.aberto ? "▾" : "▸"}</span>
                            {n} {palavra} <span className="font-normal text-primaria/80">(automático)</span>
                          </button>
                        ) : c.id === "valorCentavos" ? (
                          <span className={`font-semibold ${g.tipo === "ENTRADA" && g.valorCentavos >= 0 ? COR_ENTRADA : COR_SAIDA}`}>{formatarBRL(g.valorCentavos / 100)}</span>
                        ) : (
                          ""
                        )}
                      </td>
                    ))}
                    <td {...celula(linha, p.colunas.length, item.k)} aria-readonly="true" className={`border-b border-primaria/15 px-2 text-sm text-primaria/85 ${contornoAtivo}`}>
                      Vem do sistema
                    </td>
                  </tr>
                );
              }

              if (item.tipo === "auto") {
                const a = item.dto;
                return (
                  <tr key={item.k} role="row" aria-rowindex={linha + 2} className="bg-[#FAF7F3]">
                    <td className="border-b border-r border-primaria/15" aria-hidden="true" />
                    {p.colunas.map((c, coluna) => (
                      <td
                        key={c.id}
                        {...celula(linha, coluna, item.k)}
                        aria-readonly="true"
                        className={`h-11 truncate border-b border-r border-primaria/15 px-2 text-primaria/90 ${c.direita ? "text-right tabular-nums" : ""} ${contornoAtivo}`}
                      >
                        {c.id === "data" ? (
                          <span className="pl-4">{formatarData(a.data)}</span>
                        ) : c.id === "descricao" ? (
                          a.link ? (
                            <Link href={a.link} tabIndex={-1} className="text-secundaria underline underline-offset-2 hover:text-primaria">
                              {a.descricao}
                              <span className="sr-only"> (abre o pedido)</span>
                            </Link>
                          ) : (
                            a.descricao
                          )
                        ) : c.id === "valorCentavos" ? (
                          <span className={a.valorCentavos < 0 ? COR_SAIDA : COR_ENTRADA}>{formatarBRL(a.valorCentavos / 100)}</span>
                        ) : c.id === "formaPagamento" ? (
                          textoDaCelula("formaPagamento", { ...camposVazios(), formaPagamento: a.formaPagamento }, p.categorias)
                        ) : c.id === "tipo" ? (
                          a.tipo === "ENTRADA" ? "Entrada" : "Saída"
                        ) : c.id === "categoriaId" ? (
                          a.categoriaNome
                        ) : (
                          ""
                        )}
                      </td>
                    ))}
                    <td {...celula(linha, p.colunas.length, item.k)} aria-readonly="true" className={`border-b border-primaria/15 px-2 text-sm text-primaria/85 ${contornoAtivo}`}>
                      {a.link ? "Enter abre" : "Vem do sistema"}
                    </td>
                  </tr>
                );
              }

              const l = item.linha;
              const numero = p.numeros.get(l.k);
              const nova = l.estado === "nova";
              return (
                <tr key={item.k} role="row" aria-rowindex={linha + 2} className={`${nova ? "bg-white" : zebra} ${l.estado === "erro" || l.estado === "pergunta" ? "bg-[#FDECEA]" : ""}`}>
                  <th scope="row" role="rowheader" className="border-b border-r border-primaria/15 bg-[#F3EEE8] px-1 text-center text-sm font-semibold text-primaria/85">
                    {nova ? <span aria-label="Linha nova">＋</span> : numero}
                  </th>
                  {p.colunas.map((c, coluna) => {
                    const editando = edicao?.k === l.k && edicao.coluna === coluna;
                    const vale = campoValeParaTipo(c.id, l.campos.tipo);
                    const comErro = l.erro?.campo === c.id;
                    const texto = textoDaCelula(c.id, l.campos, p.categorias);
                    return (
                      <td
                        key={c.id}
                        {...celula(linha, coluna, l.k)}
                        aria-readonly={!vale || undefined}
                        aria-invalid={comErro || undefined}
                        aria-label={nova && coluna === 0 && !editando ? "Linha nova: digite a data ou comece por qualquer coluna" : undefined}
                        className={`relative h-11 border-b border-r border-primaria/15 ${editando ? "p-0" : "truncate px-2"} ${c.direita ? "text-right tabular-nums" : ""} ${
                          comErro ? "outline-[3px] -outline-offset-[3px] outline-[#B3261E]" : ""
                        } ${!vale ? "bg-[#F3EEE8] text-primaria/70" : ""} ${contornoAtivo}`}
                        title={!editando && texto.length > 24 ? texto : undefined}
                      >
                        {editando ? (
                          <EditorCelula
                            campo={c.id}
                            textoInicial={edicao.texto}
                            substituir={edicao.substituir}
                            campos={l.campos}
                            categorias={p.categorias}
                            descricoes={p.descricoes}
                            hoje={p.hoje}
                            rotulo={`${c.rotulo}${numero ? `, linha ${numero}` : ", linha nova"}`}
                            aoConfirmar={(m, depois) => confirmar(edicao, m, depois)}
                            aoCancelar={(motivo) => {
                              setEdicao(null);
                              focar.current = true;
                              if (motivo) p.avisar(`Não guardou: ${motivo}`);
                            }}
                            aoCriarCategoria={p.aoCriarCategoria}
                            aoColarVarias={(colado) => {
                              setEdicao(null);
                              p.aoColar(colado, { k: l.k, coluna });
                            }}
                          />
                        ) : !vale ? (
                          <span aria-label="Só nas saídas">—</span>
                        ) : (
                          <ConteudoCelula coluna={c} campos={l.campos} texto={texto} nova={nova && coluna === 0} />
                        )}
                      </td>
                    );
                  })}
                  <td
                    {...celula(linha, p.colunas.length, l.k)}
                    className={`border-b border-primaria/15 px-2 text-sm ${contornoAtivo}`}
                  >
                    <Situacao linha={l} aoTentar={() => p.fila.tentarDeNovo(l.k)} aoExcluir={() => {
                      p.fila.excluir(l.k);
                      p.avisar(`Linha ${numero ?? ""} excluída. Ctrl+Z desfaz.`);
                    }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConteudoCelula({ coluna, campos, texto, nova }: { coluna: Coluna; campos: Campos; texto: string; nova: boolean }) {
  if (nova && !texto) return <span className="text-primaria/70">Nova linha…</span>;
  if (coluna.id === "data" && campos.data) return <DataComDia data={campos.data} />;
  if (coluna.id === "tipo" && campos.tipo)
    return <span className={`font-semibold ${campos.tipo === "ENTRADA" ? COR_ENTRADA : COR_SAIDA}`}>{texto}</span>;
  if (coluna.id === "valorCentavos" && campos.valorCentavos !== null)
    return <span className={`font-semibold ${campos.tipo === "ENTRADA" ? COR_ENTRADA : campos.tipo === "SAIDA" ? COR_SAIDA : ""}`}>{texto}</span>;
  return <>{texto}</>;
}

function DataComDia({ data }: { data: string }) {
  return (
    <>
      <span className="mr-1.5 text-sm text-primaria/80">{diaDaSemana(data)}</span>
      {formatarData(data)}
    </>
  );
}

function Cadeado() {
  return (
    <svg viewBox="0 0 24 24" className="mx-auto size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Lixeira() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

const horario = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });

/** "lançada por Ana em 07/11 14:32 · alterada por Artur em 07/11 15:01". */
export function autoria(l: LinhaGrade): string {
  const s = l.servidor;
  if (!s) return "";
  const partes: string[] = [];
  if (s.criadoPor) partes.push(`lançada por ${s.criadoPor.nome.split(" ")[0]}${s.criadoEm ? ` em ${horario.format(new Date(s.criadoEm))}` : ""}`);
  if (s.atualizadoPor && s.atualizadoEm) partes.push(`alterada por ${s.atualizadoPor.nome.split(" ")[0]} em ${horario.format(new Date(s.atualizadoEm))}`);
  if (s.insumo) partes.push(`compra ligada ao estoque (${s.insumo.nome})`);
  return partes.join(" · ");
}

function Situacao({ linha: l, aoTentar, aoExcluir }: { linha: LinhaGrade; aoTentar: () => void; aoExcluir: () => void }) {
  let conteudo: ReactNode;
  switch (l.estado) {
    case "nova":
      return null;
    case "rascunho":
      conteudo = <span className="font-semibold">Falta {listarFaltando(faltando(l.campos))}</span>;
      break;
    case "pendente":
      conteudo = <span>Vai salvar…</span>;
      break;
    case "salvando":
      conteudo = <span>Salvando…</span>;
      break;
    case "salva":
      conteudo = (
        <span className="inline-flex items-center gap-1 text-primaria/80" title={autoria(l)}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
            <path d="m5 12 5 5 9-10" />
          </svg>
          Salva
          {autoria(l) && <span className="sr-only">, {autoria(l)}</span>}
        </span>
      );
      break;
    case "erro":
      conteudo = (
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-[#8C1D18]">Não salvou</span>
          <button type="button" tabIndex={-1} onClick={aoTentar} className="rounded border border-secundaria px-1.5 py-0.5 text-xs font-semibold text-secundaria hover:bg-secundaria hover:text-destaque">
            Tentar de novo
          </button>
          {l.erro && <span className="sr-only">: {l.erro.mensagem}</span>}
        </span>
      );
      break;
    case "pergunta":
      conteudo = <span className="font-semibold text-[#8C1D18]">Responda no quadro acima ↑</span>;
      break;
  }
  return (
    <div className="flex items-center justify-between gap-1" title={l.erro?.mensagem}>
      <span className="truncate">{conteudo}</span>
      <button
        type="button"
        tabIndex={-1}
        onClick={aoExcluir}
        className="shrink-0 rounded p-1 text-primaria/70 hover:bg-accent1/50 hover:text-secundaria"
        title="Excluir linha (Ctrl+Delete)"
        aria-label="Excluir linha"
      >
        <Lixeira />
      </button>
    </div>
  );
}
