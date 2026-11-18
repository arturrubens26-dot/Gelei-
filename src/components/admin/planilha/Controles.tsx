"use client";

import { useId, useState } from "react";
import { nomeDoMes, somarMeses } from "@/lib/despesas";
import { fimDoMes, periodoDoMes, validarPeriodo } from "@/lib/planilha/regras";
import { MAX_DIAS_PERIODO, type CategoriaDTO, type TipoLancamento } from "@/lib/planilha/tipos";
import { formatarData } from "./modelo";
import type { Filtros, Ordem } from "./vista";

const primeiraMaiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** O período é um mês inteiro? Devolve "AAAA-MM". */
export function mesInteiro(de: string, ate: string): string | null {
  const mes = de.slice(0, 7);
  return de.endsWith("-01") && ate === fimDoMes(mes) ? mes : null;
}

/** "novembro de 2026" ou "01/10/2026 a 15/11/2026". */
export function nomeDoPeriodo(de: string, ate: string): string {
  const mes = mesInteiro(de, ate);
  if (mes) return primeiraMaiuscula(nomeDoMes(mes));
  if (de.endsWith("-01-01") && ate === `${de.slice(0, 4)}-12-31`) return `Ano de ${de.slice(0, 4)}`;
  return `${formatarData(de)} a ${formatarData(ate)}`;
}

const botaoSegmento = (ativo: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors ${
    ativo ? "border-secundaria bg-secundaria text-destaque" : "border-primaria/40 bg-white text-primaria hover:bg-accent1/40"
  }`;

/** Escolha do período: setas de mês, atalhos (este mês, mês passado, este ano) e datas livres. */
export function SeletorDePeriodo({ de, ate, hoje, aoMudar }: { de: string; ate: string; hoje: string; aoMudar: (de: string, ate: string) => void }) {
  const id = useId();
  const [livre, setLivre] = useState(false);
  const [rascunho, setRascunho] = useState({ de, ate });
  const [erro, setErro] = useState<string | null>(null);
  const mes = mesInteiro(de, ate);
  const atual = periodoDoMes(hoje);
  const anterior = periodoDoMes(`${somarMeses(hoje.slice(0, 7), -1)}-01`);
  const ano = { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` };
  const igual = (p: { de: string; ate: string }) => p.de === de && p.ate === ate;

  function aplicar() {
    const r = validarPeriodo(rascunho.de, rascunho.ate, MAX_DIAS_PERIODO);
    if (!r.ok) return setErro(r.erro);
    setErro(null);
    aoMudar(r.valor.de, r.valor.ate);
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Período</legend>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full border-2 border-primaria/40 bg-white text-lg font-bold hover:bg-accent1/40 disabled:opacity-50"
          disabled={!mes}
          onClick={() => {
            if (!mes) return;
            const m = somarMeses(mes, -1);
            aoMudar(`${m}-01`, fimDoMes(m));
          }}
          aria-label={mes ? `Mês anterior: ${nomeDoMes(somarMeses(mes, -1))}` : "Mês anterior"}
        >
          ‹
        </button>
        <p className="min-w-44 text-center font-titulos text-xl font-bold" aria-live="polite">
          {nomeDoPeriodo(de, ate)}
        </p>
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full border-2 border-primaria/40 bg-white text-lg font-bold hover:bg-accent1/40 disabled:opacity-50"
          disabled={!mes || mes >= hoje.slice(0, 7)}
          onClick={() => {
            if (!mes) return;
            const m = somarMeses(mes, 1);
            aoMudar(`${m}-01`, fimDoMes(m));
          }}
          aria-label={mes ? `Próximo mês: ${nomeDoMes(somarMeses(mes, 1))}` : "Próximo mês"}
        >
          ›
        </button>
      </div>
      <div role="group" aria-label="Atalhos de período" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={igual(atual)} className={botaoSegmento(igual(atual))} onClick={() => aoMudar(atual.de, atual.ate)}>
          Este mês
        </button>
        <button type="button" aria-pressed={igual(anterior)} className={botaoSegmento(igual(anterior))} onClick={() => aoMudar(anterior.de, anterior.ate)}>
          Mês passado
        </button>
        <button type="button" aria-pressed={igual(ano)} className={botaoSegmento(igual(ano))} onClick={() => aoMudar(ano.de, ano.ate)}>
          Este ano
        </button>
        <button
          type="button"
          aria-expanded={livre}
          aria-controls={`${id}-livre`}
          className={botaoSegmento(livre)}
          onClick={() => {
            setRascunho({ de, ate });
            setLivre((v) => !v);
          }}
        >
          Escolher datas
        </button>
      </div>
      {livre && (
        <div id={`${id}-livre`} className="flex w-full flex-wrap items-end gap-3 rounded-md border border-primaria/30 bg-white p-3">
          <label className="flex flex-col text-sm font-semibold">
            De
            <input type="date" className="campo mt-1 w-44" value={rascunho.de} max={hoje} onChange={(e) => setRascunho((r) => ({ ...r, de: e.target.value }))} />
          </label>
          <label className="flex flex-col text-sm font-semibold">
            Até
            <input type="date" className="campo mt-1 w-44" value={rascunho.ate} onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))} />
          </label>
          <button type="button" className="btn-primario" onClick={aplicar}>
            Mostrar
          </button>
          {erro && (
            <p role="alert" className="w-full text-sm font-semibold text-[#8C1D18]">
              {erro}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

const ORDENS: { valor: string; rotulo: string; ordem: Ordem }[] = [
  { valor: "data-asc", rotulo: "Data (mais antiga primeiro)", ordem: { coluna: "data", direcao: "asc" } },
  { valor: "data-desc", rotulo: "Data (mais recente primeiro)", ordem: { coluna: "data", direcao: "desc" } },
  { valor: "valorCentavos-desc", rotulo: "Valor (maior primeiro)", ordem: { coluna: "valorCentavos", direcao: "desc" } },
  { valor: "valorCentavos-asc", rotulo: "Valor (menor primeiro)", ordem: { coluna: "valorCentavos", direcao: "asc" } },
  { valor: "categoriaId-asc", rotulo: "Categoria (A a Z)", ordem: { coluna: "categoriaId", direcao: "asc" } },
  { valor: "descricao-asc", rotulo: "Descrição (A a Z)", ordem: { coluna: "descricao", direcao: "asc" } },
  { valor: "tipo-asc", rotulo: "Tipo (entradas primeiro)", ordem: { coluna: "tipo", direcao: "asc" } },
];

export function chaveDaOrdem(o: Ordem): string {
  return `${o.coluna}-${o.direcao}`;
}

export function ordemDaChave(chave: string | null): Ordem | null {
  return ORDENS.find((o) => o.valor === chave)?.ordem ?? null;
}

/**
 * Filtros como os "segmentadores" do Excel dela: Tipo em botões, Categoria em lista de marcar,
 * busca na descrição, e os interruptores de vendas do sistema e colunas de compra.
 */
export function BarraDeFiltros(p: {
  filtros: Filtros;
  aoMudar: (f: Filtros) => void;
  categorias: readonly CategoriaDTO[];
  ordem: Ordem;
  aoOrdenar: (o: Ordem) => void;
  colunasDeCompra: boolean;
  aoColunasDeCompra: (v: boolean) => void;
  mostrarColunasDeCompra: boolean;
}) {
  const id = useId();
  const f = p.filtros;
  const tipos: { valor: TipoLancamento | null; rotulo: string }[] = [
    { valor: null, rotulo: "Tudo" },
    { valor: "ENTRADA", rotulo: "Entradas" },
    { valor: "SAIDA", rotulo: "Saídas" },
  ];
  const visiveis = p.categorias.filter((c) => (!f.tipo || c.tipo === f.tipo) && (c.ativo || c.linhas > 0 || c.sistema));
  const marcadas = f.categorias.length;
  const ativos = (f.tipo ? 1 : 0) + (marcadas ? 1 : 0) + (f.busca.trim() ? 1 : 0) + (f.automaticas ? 0 : 1);

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div role="group" aria-label="Tipo" className="flex gap-1.5">
        {tipos.map((t) => (
          <button
            key={t.rotulo}
            type="button"
            aria-pressed={f.tipo === t.valor}
            onClick={() => p.aoMudar({ ...f, tipo: t.valor, categorias: t.valor ? f.categorias.filter((c) => p.categorias.find((k) => k.id === c)?.tipo === t.valor) : f.categorias })}
            className={botaoSegmento(f.tipo === t.valor)}
          >
            {t.rotulo}
          </button>
        ))}
      </div>

      <details className="relative">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border-2 border-primaria/40 bg-white px-4 text-sm font-semibold hover:bg-accent1/40 [&::-webkit-details-marker]:hidden">
          Categorias{marcadas ? ` (${marcadas})` : ": todas"}
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="absolute left-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border-2 border-primaria/60 bg-white p-2 shadow-lg">
          <fieldset>
            <legend className="sr-only">Mostrar só estas categorias</legend>
            {visiveis.map((c) => (
              <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 hover:bg-accent1/30">
                <input
                  type="checkbox"
                  className="size-5 accent-secundaria"
                  checked={f.categorias.includes(c.id)}
                  onChange={(e) =>
                    p.aoMudar({ ...f, categorias: e.target.checked ? [...f.categorias, c.id] : f.categorias.filter((x) => x !== c.id) })
                  }
                />
                <span className="flex-1">
                  {c.nome}
                  <span className="block text-xs text-primaria/80">
                    {c.tipo === "ENTRADA" ? "entrada" : "saída"}
                    {c.sistema ? " · automática" : ""}
                    {c.ativo ? "" : " · desativada"}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {marcadas > 0 && (
            <button type="button" className="mt-2 w-full rounded px-2 py-2 text-left text-sm font-semibold text-secundaria underline" onClick={() => p.aoMudar({ ...f, categorias: [] })}>
              Limpar (mostrar todas)
            </button>
          )}
        </div>
      </details>

      <label className="flex flex-col text-sm font-semibold">
        Procurar na descrição
        <input
          type="search"
          className="campo mt-1 w-56"
          value={f.busca}
          placeholder="ex.: açúcar"
          onChange={(e) => p.aoMudar({ ...f, busca: e.target.value })}
        />
      </label>

      <label className="flex flex-col text-sm font-semibold" htmlFor={`${id}-ordem`}>
        Ordenar por
        <select
          id={`${id}-ordem`}
          className="campo mt-1 w-72"
          value={chaveDaOrdem(p.ordem)}
          onChange={(e) => {
            const o = ordemDaChave(e.target.value);
            if (o) p.aoOrdenar(o);
          }}
        >
          {ORDENS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-secundaria" checked={f.automaticas} onChange={(e) => p.aoMudar({ ...f, automaticas: e.target.checked })} />
          Mostrar vendas do site, feira e mimos
        </label>
        {p.mostrarColunasDeCompra && (
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5 accent-secundaria" checked={p.colunasDeCompra} onChange={(e) => p.aoColunasDeCompra(e.target.checked)} />
            Mostrar colunas de compra (quantidade, unidade, fornecedor)
          </label>
        )}
      </div>

      {ativos > 0 && (
        <button type="button" className="min-h-11 text-sm font-semibold text-secundaria underline underline-offset-2" onClick={() => p.aoMudar({ tipo: null, categorias: [], busca: "", automaticas: true })}>
          Tirar os filtros
        </button>
      )}
    </div>
  );
}
