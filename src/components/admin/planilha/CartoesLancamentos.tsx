"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { formatarBRL } from "@/lib/dinheiro";
import type { CategoriaDTO, TipoLancamento } from "@/lib/planilha/tipos";
import type { FilaDeGravacao, LinhaGrade } from "./filaDeGravacao";
import { FormLancamento } from "./FormLancamento";
import { COR_ENTRADA, COR_SAIDA } from "./GradeLancamentos";
import { diaDaSemana, faltando, formatarData, listarFaltando, type Campos } from "./modelo";
import type { Filtros, ItemDaVista, Totais } from "./vista";

type Props = {
  itens: readonly ItemDaVista[];
  fila: FilaDeGravacao;
  categorias: readonly CategoriaDTO[];
  descricoes: readonly string[];
  hoje: string;
  numeros: ReadonlyMap<string, number>;
  totais: Totais;
  saldoNoFim: number | null;
  filtros: Filtros;
  aoMudarFiltros: (f: Filtros) => void;
  aoAlternarGrupo: (k: string) => void;
  avisar: (m: string) => void;
  aoCriarCategoria: (tipo: TipoLancamento, nome: string) => Promise<{ ok: true; categoria: CategoriaDTO } | { ok: false; erro: string }>;
};

type Dia = { data: string; itens: ItemDaVista[] };

/**
 * Celular (menos de 768 px): sem grade. Os totais no topo, os lançamentos em cartões por dia (do
 * mais recente para o mais antigo), as vendas do sistema agrupadas, e um botão "+ Lançamento" que
 * abre o formulário. Colar do Excel não existe aqui.
 */
export function CartoesLancamentos(p: Props) {
  const [form, setForm] = useState<{ k: string | null } | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const categoria = (id: string | null) => p.categorias.find((c) => c.id === id)?.nome ?? "";

  // Por dia, do mais recente para o mais antigo (no celular se olha "o que lancei agora").
  const dias: Dia[] = [];
  const porData = new Map<string, Dia>();
  for (const i of p.itens) {
    if (i.tipo === "auto") continue;
    if (i.tipo === "manual" && i.linha.estado === "nova") continue;
    const data = i.tipo === "manual" ? i.linha.campos.data || p.hoje : i.grupo.data;
    let dia = porData.get(data);
    if (!dia) {
      dia = { data, itens: [] };
      porData.set(data, dia);
      dias.push(dia);
    }
    dia.itens.push(i);
  }
  dias.sort((a, b) => b.data.localeCompare(a.data));

  const emEdicao = form?.k ? (p.fila.achar(form.k) ?? null) : null;


  function salvar(campos: Partial<Campos>) {
    if (form?.k) {
      p.fila.editar(form.k, campos);
      p.fila.sairDaLinha(form.k);
    } else {
      p.fila.colar([{ k: null, campos }]);
    }
    setForm(null);
    p.avisar("Lançamento guardado. Salvando…");
  }

  const negativo = p.totais.resultado < 0;
  const nFiltros = (p.filtros.tipo ? 1 : 0) + (p.filtros.categorias.length ? 1 : 0) + (p.filtros.busca.trim() ? 1 : 0) + (p.filtros.automaticas ? 0 : 1);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <section aria-label="Totais do período" className="grid grid-cols-2 gap-2">
        <div className="cartao p-3">
          <p className="text-sm font-semibold">Entradas</p>
          <p className={`text-xl font-bold tabular-nums ${COR_ENTRADA}`}>{formatarBRL(p.totais.entradas / 100)}</p>
        </div>
        <div className="cartao p-3">
          <p className="text-sm font-semibold">Saídas</p>
          <p className={`text-xl font-bold tabular-nums ${COR_SAIDA}`}>{formatarBRL(p.totais.saidas / 100)}</p>
        </div>
        <div className="cartao p-3">
          <p className="text-sm font-semibold">{negativo ? "Faltou" : "Sobrou"}</p>
          <p className={`text-xl font-bold tabular-nums ${negativo ? COR_SAIDA : ""}`}>{formatarBRL(p.totais.resultado / 100)}</p>
        </div>
        <div className="cartao p-3">
          <p className="text-sm font-semibold">Caixa no fim</p>
          <p className="text-xl font-bold tabular-nums">{p.saldoNoFim === null ? "—" : formatarBRL(p.saldoNoFim / 100)}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secundario" onClick={() => setFiltrosAbertos(true)}>
          Filtrar{nFiltros ? ` (${nFiltros})` : ""}
        </button>
        <button type="button" className="btn-secundario" disabled={!p.fila.ler().podeDesfazer} onClick={() => p.fila.desfazer() && p.avisar("Desfeito.")}>
          Desfazer
        </button>
      </div>

      {dias.length === 0 && <p className="py-10 text-center text-base">Nenhum lançamento neste período. Toque em “+ Lançamento” para começar.</p>}

      {dias.map((dia) => (
        <section key={dia.data} aria-labelledby={`dia-${dia.data}`}>
          <h2 id={`dia-${dia.data}`} className="mb-2 font-textos text-base font-bold">
            <span className="capitalize">{diaDaSemana(dia.data)}</span>, {formatarData(dia.data)}
          </h2>
          <ul className="flex flex-col gap-2">
            {dia.itens.map((i) =>
              i.tipo === "manual" ? (
                <li key={i.k}>
                  <Cartao linha={i.linha} categoria={categoria(i.linha.campos.categoriaId)} numero={p.numeros.get(i.k)} aoAbrir={() => setForm({ k: i.k })} />
                </li>
              ) : i.tipo === "grupo" ? (
                <li key={i.k}>
                  <CartaoGrupo item={i} aoAlternar={() => p.aoAlternarGrupo(i.k)} />
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ))}

      <button
        type="button"
        onClick={() => setForm({ k: null })}
        className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 inline-flex min-h-14 items-center gap-2 rounded-full border-2 border-transparent bg-secundaria px-6 text-lg font-bold text-destaque shadow-lg hover:bg-primaria"
      >
        <span aria-hidden="true" className="text-2xl leading-none">
          +
        </span>
        Lançamento
      </button>

      {form && (
        <FormLancamento
          key={form.k ?? "novo"}
          linha={emEdicao}
          categorias={p.categorias}
          descricoes={p.descricoes}
          hoje={p.hoje}
          aoSalvar={salvar}
          aoFechar={() => setForm(null)}
          aoCriarCategoria={p.aoCriarCategoria}
          aoExcluir={
            emEdicao
              ? () => {
                  p.fila.excluir(emEdicao.k);
                  setForm(null);
                  p.avisar("Lançamento excluído. “Desfazer” traz de volta.");
                }
              : undefined
          }
        />
      )}

      {filtrosAbertos && (
        <GavetaFiltros filtros={p.filtros} categorias={p.categorias} aoMudar={p.aoMudarFiltros} aoFechar={() => setFiltrosAbertos(false)} />
      )}
    </div>
  );
}

function situacao(l: LinhaGrade): string | null {
  switch (l.estado) {
    case "salva":
    case "nova":
      return null;
    case "rascunho":
      return `Falta ${listarFaltando(faltando(l.campos))}`;
    case "pendente":
    case "salvando":
      return "Salvando…";
    case "erro":
      return `Não salvou: ${l.erro?.mensagem ?? ""}`;
    case "pergunta":
      return "Precisa da sua resposta (veja acima)";
  }
}

function Cartao({ linha: l, categoria, numero, aoAbrir }: { linha: LinhaGrade; categoria: string; numero?: number; aoAbrir: () => void }) {
  const entrada = l.campos.tipo === "ENTRADA";
  const valor = l.campos.valorCentavos;
  const aviso = situacao(l);
  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`${numero ? `Linha ${numero}: ` : ""}${entrada ? "entrada" : "saída"} de ${valor === null ? "valor em branco" : formatarBRL(valor / 100)}, ${categoria}${
        l.campos.descricao ? `, ${l.campos.descricao}` : ""
      }${aviso ? `. ${aviso}` : ""}. Toque para editar.`}
      className={`cartao flex w-full items-start justify-between gap-3 p-3 text-left ${l.estado === "erro" || l.estado === "pergunta" ? "border-[#B3261E] bg-[#FDECEA]" : ""}`}
    >
      <span className="min-w-0">
        <span className="block font-semibold">{categoria || "Sem categoria"}</span>
        {l.campos.descricao && <span className="block truncate text-sm">{l.campos.descricao}</span>}
        {aviso && <span className={`mt-1 block text-sm font-semibold ${l.estado === "erro" || l.estado === "pergunta" ? "text-[#8C1D18]" : ""}`}>{aviso}</span>}
      </span>
      <span className={`shrink-0 text-lg font-bold tabular-nums ${entrada ? COR_ENTRADA : COR_SAIDA}`}>
        {valor === null ? "—" : `${entrada ? "+" : "−"} ${formatarBRL(valor / 100)}`}
      </span>
    </button>
  );
}

function CartaoGrupo({ item, aoAlternar }: { item: Extract<ItemDaVista, { tipo: "grupo" }>; aoAlternar: () => void }) {
  const id = useId();
  const g = item.grupo;
  return (
    <div className="rounded-md border border-primaria/25 bg-[#F3EEE8]">
      <button type="button" aria-expanded={item.aberto} aria-controls={id} onClick={aoAlternar} className="flex w-full items-start justify-between gap-3 p-3 text-left">
        <span>
          <span className="block font-semibold">
            <span aria-hidden="true">{item.aberto ? "▾ " : "▸ "}</span>
            {g.categoriaNome}
          </span>
          <span className="block text-sm">
            {g.itens.length} {g.itens.length === 1 ? "lançamento" : "lançamentos"} · automático
          </span>
        </span>
        <span className={`shrink-0 text-lg font-bold tabular-nums ${g.valorCentavos < 0 ? COR_SAIDA : COR_ENTRADA}`}>
          {g.valorCentavos < 0 ? "−" : "+"} {formatarBRL(Math.abs(g.valorCentavos) / 100)}
        </span>
      </button>
      {item.aberto && (
        <ul id={id} className="flex flex-col divide-y divide-primaria/15 border-t border-primaria/15 px-3">
          {g.itens.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              {a.link ? (
                <Link href={a.link} className="font-semibold text-secundaria underline underline-offset-2">
                  {a.descricao}
                </Link>
              ) : (
                <span>{a.descricao}</span>
              )}
              <span className="tabular-nums">{formatarBRL(a.valorCentavos / 100)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GavetaFiltros({ filtros, categorias, aoMudar, aoFechar }: { filtros: Filtros; categorias: readonly CategoriaDTO[]; aoMudar: (f: Filtros) => void; aoFechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const f = filtros;
  const visiveis = categorias.filter((c) => (!f.tipo || c.tipo === f.tipo) && (c.ativo || c.linhas > 0 || c.sistema));
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
      className="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-2xl border-t-4 border-primaria bg-white p-0 text-primaria backdrop:bg-primaria/40"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 id={`${id}-t`} className="text-2xl font-bold">
            Filtrar
          </h2>
          <button type="button" className="btn-primario" onClick={aoFechar}>
            Pronto
          </button>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Tipo</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {([null, "ENTRADA", "SAIDA"] as const).map((t) => (
              <button
                key={t ?? "tudo"}
                type="button"
                aria-pressed={f.tipo === t}
                onClick={() => aoMudar({ ...f, tipo: t })}
                className={`min-h-11 rounded-full border-2 text-sm font-semibold ${f.tipo === t ? "border-secundaria bg-secundaria text-destaque" : "border-primaria/40"}`}
              >
                {t === null ? "Tudo" : t === "ENTRADA" ? "Entradas" : "Saídas"}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col text-sm font-semibold">
          Procurar na descrição
          <input type="search" className="campo mt-1" value={f.busca} onChange={(e) => aoMudar({ ...f, busca: e.target.value })} />
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-secundaria" checked={f.automaticas} onChange={(e) => aoMudar({ ...f, automaticas: e.target.checked })} />
          Mostrar vendas do site, feira e mimos
        </label>
        <fieldset>
          <legend className="text-sm font-semibold">Categorias {f.categorias.length ? `(${f.categorias.length})` : "(todas)"}</legend>
          <div className="mt-1 max-h-60 overflow-y-auto">
            {visiveis.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-secundaria"
                  checked={f.categorias.includes(c.id)}
                  onChange={(e) => aoMudar({ ...f, categorias: e.target.checked ? [...f.categorias, c.id] : f.categorias.filter((x) => x !== c.id) })}
                />
                {c.nome}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </dialog>
  );
}
