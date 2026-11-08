"use client";

import { useSearchParams } from "next/navigation";
import { useId, useRef, type KeyboardEvent } from "react";
import { Auxiliar } from "./Auxiliar";
import { Lancamentos } from "./Lancamentos";

/** As abas da planilha (fase 1). Painel, Tabela dinâmica e Resultado diário entram na fase 2. */
export const ABAS = [
  { id: "lancamentos", rotulo: "Lançamentos", dica: "o dia a dia: entradas e saídas" },
  { id: "auxiliar", rotulo: "Auxiliar", dica: "categorias, saldo inicial e histórico" },
] as const;

export type Aba = (typeof ABAS)[number]["id"];

function lerAba(valor: string | null): Aba {
  return ABAS.some((a) => a.id === valor) ? (valor as Aba) : "lancamentos";
}

/**
 * Página Financeiro > Planilha: as entradas e saídas da loja numa grade que se usa como o Excel
 * (digitar, Enter, Tab, colar do Excel), com as vendas do site entrando sozinhas.
 *
 * As duas abas ficam montadas (só a ativa aparece): o que ela digitou e ainda não salvou numa aba
 * não se perde ao olhar a outra. A aba vem do endereço (`?aba=auxiliar`), como em Produção.
 */
export function PlanilhaAdmin() {
  const aba = lerAba(useSearchParams().get("aba"));
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function irPara(alvo: Aba, focar = false) {
    const url = new URL(window.location.href);
    if (alvo === "lancamentos") url.searchParams.delete("aba");
    else url.searchParams.set("aba", alvo);
    // O Next acompanha o history.replaceState: useSearchParams (e o item marcado do menu) mudam junto.
    window.history.replaceState(null, "", url);
    if (focar) refs.current[alvo]?.focus();
  }

  // Padrão ARIA de abas: setas, Home e End trocam de aba (a ativação acompanha o foco).
  function teclaNasAbas(e: KeyboardEvent<HTMLDivElement>) {
    const i = ABAS.findIndex((a) => a.id === aba);
    let j = i;
    if (e.key === "ArrowRight") j = (i + 1) % ABAS.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + ABAS.length) % ABAS.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = ABAS.length - 1;
    else return;
    e.preventDefault();
    irPara(ABAS[j].id, true);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-titulos text-3xl font-bold">Planilha</h1>
        <p className="mt-1 max-w-prose text-base text-primaria/85">
          As entradas e saídas da loja, como no Excel: digite, tecle Enter e pronto, salva sozinho. As vendas do site, da
          feira e dos mimos entram sozinhas.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Partes da planilha"
        onKeyDown={teclaNasAbas}
        className="flex flex-wrap items-end gap-1 border-b-2 border-primaria/70"
      >
        {ABAS.map((a) => {
          const ativa = a.id === aba;
          return (
            <button
              key={a.id}
              ref={(el) => {
                refs.current[a.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-aba-${a.id}`}
              aria-selected={ativa}
              aria-controls={`${base}-painel-${a.id}`}
              tabIndex={ativa ? 0 : -1}
              onClick={() => irPara(a.id)}
              className={`-mb-0.5 inline-flex min-h-12 flex-col items-start justify-center rounded-t-md border-2 px-4 py-1.5 text-left transition-colors ${
                ativa
                  ? "border-primaria border-b-white bg-white text-primaria"
                  : "border-transparent bg-accent1/35 text-primaria hover:bg-accent1/60"
              }`}
            >
              <span className="text-base font-bold">{a.rotulo}</span>
              <span className="hidden text-xs font-medium text-primaria/80 sm:block">{a.dica}</span>
            </button>
          );
        })}
      </div>

      {ABAS.map((a) => (
        <div
          key={a.id}
          role="tabpanel"
          id={`${base}-painel-${a.id}`}
          aria-labelledby={`${base}-aba-${a.id}`}
          hidden={a.id !== aba}
          // O painel não recebe foco: o primeiro controle dele (período, botões) já é focável.
        >
          {a.id === "lancamentos" ? <Lancamentos ativa={aba === "lancamentos"} /> : <Auxiliar ativa={aba === "auxiliar"} />}
        </div>
      ))}
    </div>
  );
}
