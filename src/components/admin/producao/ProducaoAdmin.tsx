"use client";

import { useSearchParams } from "next/navigation";
import { EstoqueInsumos } from "./EstoqueInsumos";
import { ListaProducoes } from "./ListaProducoes";

type Aba = "producoes" | "estoque";

/** Página Produção: os lotes de geleia e o estoque de insumos (duas visões da mesma cozinha). */
export function ProducaoAdmin() {
  // A aba vem do endereço (?aba=estoque): o menu tem um atalho para o estoque, e o "voltar" a respeita.
  const aba: Aba = useSearchParams().get("aba") === "estoque" ? "estoque" : "producoes";
  function setAba(alvo: Aba) {
    const url = new URL(window.location.href);
    if (alvo === "estoque") url.searchParams.set("aba", "estoque");
    else url.searchParams.delete("aba");
    // O Next acompanha o history.replaceState: useSearchParams (e o item marcado do menu) mudam junto, sem buscar a página de novo.
    window.history.replaceState(null, "", url);
  }
  const botao = (alvo: Aba, rotulo: string) => (
    <button
      type="button"
      aria-pressed={aba === alvo}
      onClick={() => setAba(alvo)}
      className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors ${
        aba === alvo ? "border-secundaria bg-secundaria text-destaque" : "border-accent2 text-primaria hover:bg-accent1/40"
      }`}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-titulos text-3xl font-bold">Produção</h1>
        <p className="mt-1 max-w-prose text-sm text-primaria/80">
          Cada lote de geleia: o que entrou, quanto custou, quantos potes rendeu e o que sobrou no estoque. É o caderno de
          produção, com as contas feitas sozinhas.
        </p>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Escolher a visão">
        {botao("producoes", "Produções")}
        {botao("estoque", "Estoque de insumos")}
      </div>
      {aba === "producoes" ? <ListaProducoes /> : <EstoqueInsumos />}
    </div>
  );
}
