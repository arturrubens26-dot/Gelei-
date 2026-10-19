"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarDia, hojeNaLoja } from "@/lib/despesas";
import { formatarPorcentagem, gerarCsv } from "@/lib/producao";
import type { ProducaoResumoDTO } from "@/lib/producao-admin";
import { baixarCsv } from "./csv";

const acao =
  "inline-flex min-h-11 items-center rounded-full border-2 border-accent2 px-3 text-xs font-semibold text-primaria transition-colors hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Lotes de geleia: custo por pote, margem e o que cada um rendeu. */
export function ListaProducoes() {
  const id = useId();
  const [versao, setVersao] = useState(0);
  const [producoes, setProducoes] = useState<ProducaoResumoDTO[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const refTitulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/admin/production")
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        if (r.ok) {
          setProducoes(json.producoes);
          setErroCarga(null);
        } else setErroCarga(json?.erro ?? "Não foi possível carregar as produções.");
      })
      .catch(() => !cancelado && setErroCarga("Sem conexão. Tente novamente."));
    return () => {
      cancelado = true;
    };
  }, [versao]);

  async function excluir(p: ProducaoResumoDTO) {
    if (excluindo) return;
    if (!window.confirm(`Excluir a produção "${p.nome}" de ${formatarDia(p.data)}? O que ela usou volta para o estoque.`)) return;
    setExcluindo(p.id);
    setAviso(null);
    try {
      const r = await fetch(`/api/admin/production/${p.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) {
        const json = await r.json().catch(() => null);
        setAviso({ tipo: "erro", texto: json?.erro ?? "Não foi possível excluir." });
        return;
      }
      setAviso({ tipo: "ok", texto: `Produção excluída: ${p.nome}.` });
      setVersao((v) => v + 1);
      refTitulo.current?.focus();
    } catch {
      setAviso({ tipo: "erro", texto: "Sem conexão. Tente novamente." });
    } finally {
      setExcluindo(null);
    }
  }

  const lista = producoes ?? [];
  const totalPotes = lista.reduce((s, p) => s + p.potes, 0);
  const totalCusto = lista.reduce((s, p) => s + p.totais.total, 0);
  const lucro = lista.reduce((s, p) => s + (p.totais.lucroDoLote ?? 0), 0);

  function exportar() {
    const csv = gerarCsv(
      [
        "Data", "Receita", "Sabor", "Potes", "Ingredientes (R$)", "Custos da produção (R$)", "Embalagens (R$)",
        "Custo total (R$)", "Custo por pote (R$)", "Preço de venda (R$)", "Margem por pote (R$)", "Lucro do lote se vender tudo (R$)",
      ],
      lista.map((p) => [
        formatarDia(p.data), p.nome, p.produto?.nome ?? "", p.potes, p.totais.ingredientes, p.totais.extras, p.totais.embalagens,
        p.totais.total, p.totais.porPote, p.totais.precoVenda, p.totais.margemPorPote, p.totais.lucroDoLote,
      ]),
    );
    baixarCsv(`producoes-geleio-${hojeNaLoja()}.csv`, csv);
  }

  return (
    <div className="flex flex-col gap-6">
      {producoes && producoes.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
          <li className="cartao p-5">
            <p className="text-sm font-medium text-primaria/85">Potes produzidos</p>
            <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{totalPotes}</p>
            <p className="mt-1 text-xs text-primaria/80">em {producoes.length} {producoes.length === 1 ? "produção" : "produções"}</p>
          </li>
          <li className="cartao p-5">
            <p className="text-sm font-medium text-primaria/85">Custo médio por pote</p>
            <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{totalPotes > 0 ? formatarBRL(totalCusto / totalPotes) : "—"}</p>
            <p className="mt-1 text-xs text-primaria/80">ingredientes, custos e embalagem</p>
          </li>
          <li className="cartao p-5">
            <p className="text-sm font-medium text-primaria/85">Lucro se vender tudo</p>
            <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{formatarBRL(lucro)}</p>
            <p className="mt-1 text-xs text-primaria/80">preço do site menos o custo de cada pote</p>
          </li>
        </ul>
      )}

      <section aria-labelledby={`${id}-titulo`} className="cartao p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={`${id}-titulo`} ref={refTitulo} tabIndex={-1} className="text-2xl font-bold">
              Produções
            </h2>
            <p className="mt-1 text-xs text-primaria/75">Da mais recente para a mais antiga. Abra a ficha para ver ingredientes, custos e sobras.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/production/new" className="btn-primario">
              Nova produção
            </Link>
            <button type="button" className="btn-secundario" onClick={exportar} disabled={lista.length === 0}>
              Baixar planilha
            </button>
          </div>
        </div>

        <p role="status" aria-live="polite" className={`mt-3 min-h-5 text-sm font-medium ${aviso?.tipo === "erro" ? "text-secundaria" : ""}`}>
          {aviso?.texto}
        </p>

        {erroCarga && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria">
            <span>{erroCarga}</span>
            <button type="button" className="btn-secundario" onClick={() => setVersao((v) => v + 1)}>
              Tentar de novo
            </button>
          </div>
        )}
        {!producoes && !erroCarga && (
          <div className="h-40 animate-pulse rounded-xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando as produções…</span>
          </div>
        )}
        {producoes && producoes.length === 0 && (
          <p className="py-10 text-center text-sm text-primaria/80">
            Nenhuma produção registrada. Use <strong>Nova produção</strong> logo depois de cozinhar: o custo por pote sai na hora.
          </p>
        )}

        {lista.length > 0 && (
          <>
            {/* Celular: cartões */}
            {/* Cartões até xl: a tabela tem 896px, e do lg em diante o menu lateral come 240px; antes
                disso, no tablet, Margem e Ações ficavam escondidas fora da tela. */}
            <ul className="divide-y divide-accent1/70 xl:hidden">
              {lista.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/admin/production/${p.id}`} className="font-semibold text-secundaria underline underline-offset-2">
                      {p.nome}
                    </Link>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{p.totais.porPote === null ? "—" : `${formatarBRL(p.totais.porPote)}/pote`}</span>
                  </div>
                  <p className="text-xs text-primaria/80">
                    {formatarDia(p.data)} · {p.produto?.nome ?? "sem sabor do catálogo"} · {p.potes} potes · total {formatarBRL(p.totais.total)}
                  </p>
                  {p.totais.margemPorPote !== null && (
                    <p className="text-xs text-primaria/80">
                      Margem {formatarBRL(p.totais.margemPorPote)} por pote ({formatarPorcentagem(p.totais.margemPct ?? 0)})
                    </p>
                  )}
                  <AcoesLote p={p} excluindo={excluindo === p.id} travado={excluindo !== null} onExcluir={excluir} />
                </li>
              ))}
            </ul>

            <div role="region" aria-label="Tabela das produções" tabIndex={0} className="relative hidden overflow-x-auto xl:block">
              <table className="w-full min-w-4xl text-left text-sm">
                <caption className="sr-only">Produções registradas</caption>
                <thead className="border-b-2 border-accent2/60">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Data</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Receita</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Sabor</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Potes</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Custo total</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Custo por pote</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Margem por pote</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-accent1/70">
                  {lista.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatarDia(p.data)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/production/${p.id}`} className="font-semibold text-secundaria underline underline-offset-2">
                          {p.nome}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{p.produto?.nome ?? <span className="text-primaria/70">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.potes}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatarBRL(p.totais.total)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                        {p.totais.porPote === null ? "—" : formatarBRL(p.totais.porPote)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {p.totais.margemPorPote === null ? (
                          "—"
                        ) : (
                          <>
                            {formatarBRL(p.totais.margemPorPote)}
                            <span className="text-primaria/75"> · {formatarPorcentagem(p.totais.margemPct ?? 0)}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <AcoesLote p={p} excluindo={excluindo === p.id} travado={excluindo !== null} onExcluir={excluir} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AcoesLote({
  p,
  excluindo,
  travado,
  onExcluir,
}: {
  p: ProducaoResumoDTO;
  excluindo: boolean;
  travado: boolean;
  onExcluir: (p: ProducaoResumoDTO) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/admin/production/new?de=${p.id}`} className={acao}>
        Produzir de novo<span className="sr-only"> {p.nome}</span>
      </Link>
      <button type="button" className={acao} aria-disabled={travado || undefined} onClick={() => onExcluir(p)}>
        {excluindo ? "Excluindo…" : "Excluir"}
        <span className="sr-only"> {p.nome}</span>
      </button>
    </div>
  );
}
