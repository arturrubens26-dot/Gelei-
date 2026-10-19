"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Kpi } from "@/components/admin/Kpi";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarDia } from "@/lib/despesas";
import { formatarCustoMedio, formatarPorcentagem, formatarQtdInsumo, type TipoInsumo } from "@/lib/producao";
import type { ProducaoDetalheDTO } from "@/lib/producao-admin";

/** Ficha de um lote (dá para imprimir): o que entrou, quanto custou, rendimento, margem e sobras. */
export function FichaProducao({ id }: { id: string }) {
  const router = useRouter();
  const [lote, setLote] = useState<ProducaoDetalheDTO | null>(null);
  const [erro, setErro] = useState<{ id: string; mensagem: string } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [excluindo, setExcluindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Roda de novo quando a ficha volta à tela (Cache Components): depois de "Corrigir", mostra o lote atualizado.
  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/production/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        if (r.ok) {
          setLote(json);
          setErro(null);
        } else setErro({ id, mensagem: json?.erro ?? "Não foi possível carregar a produção." });
      })
      .catch(() => !cancelado && setErro({ id, mensagem: "Sem conexão. Tente novamente." }));
    return () => {
      cancelado = true;
    };
  }, [id, tentativa]);

  async function excluir() {
    if (!lote || excluindo) return;
    if (!window.confirm(`Excluir a produção "${lote.nome}"? O que ela usou volta para o estoque.`)) return;
    setExcluindo(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/admin/production/${encodeURIComponent(lote.id)}`, { method: "DELETE" });
      if (r.ok || r.status === 404) {
        router.push("/admin/production");
        return;
      }
      const json = await r.json().catch(() => null);
      setAviso(json?.erro ?? "Não foi possível excluir.");
    } catch {
      setAviso("Sem conexão. Tente novamente.");
    } finally {
      setExcluindo(false);
    }
  }

  if (erro?.id === id) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-4 text-sm font-medium text-secundaria">
        <span>{erro.mensagem}</span>
        <button
          type="button"
          className="btn-secundario"
          onClick={() => {
            setErro(null);
            setTentativa((t) => t + 1);
          }}
        >
          Tentar de novo
        </button>
        <Link href="/admin/production" className="underline underline-offset-2">
          Voltar para Produção
        </Link>
      </div>
    );
  }
  // `lote.id !== id`: a ficha de outro lote ainda na tela enquanto esta carrega.
  if (!lote || lote.id !== id) {
    return (
      <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
        <span className="sr-only">Carregando a ficha…</span>
      </div>
    );
  }

  const t = lote.totais;
  const peso = lote.produto?.pesoGramas ?? null;
  const tabela = (tipo: TipoInsumo, titulo: string) => {
    const itens = lote.itens.filter((i) => i.tipo === tipo);
    if (itens.length === 0) return null;
    const total = itens.reduce((s, i) => s + i.custo, 0);
    return (
      <section className="cartao p-5 print:break-inside-avoid print:shadow-none">
        <h2 className="mb-3 text-xl font-bold">{titulo}</h2>
        <div role="region" aria-label={`Tabela: ${titulo}`} tabIndex={0} className="relative overflow-x-auto">
          <table className="w-full min-w-xl text-left text-sm">
            <thead className="border-b-2 border-accent2/60">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Insumo</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Quantidade</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Preço pago</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Custo</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sobra hoje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-accent1/70">
              {itens.map((i) => (
                <tr key={i.insumoId}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">{i.nome}</th>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatarQtdInsumo(i.quantidade, i.unidade)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {i.custoUnitario === 0 ? "de casa" : formatarCustoMedio(i.custoUnitario, i.unidade)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatarBRL(i.custo)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${i.sobraHoje !== null && i.sobraHoje < 0 ? "font-semibold text-secundaria" : ""}`}>
                    {i.sobraHoje === null ? "—" : formatarQtdInsumo(i.sobraHoje, i.unidade)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-accent2/60">
              <tr>
                <th scope="row" colSpan={3} className="px-3 py-2 text-right font-semibold">Total</th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">{formatarBRL(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    );
  };

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-secundaria">Ficha de produção</p>
          <h1 className="font-titulos text-3xl font-bold">{lote.nome}</h1>
          <p className="mt-1 text-sm text-primaria/80">
            {formatarDia(lote.data)} · {lote.produto ? lote.produto.nome : "receita de teste (sem sabor do catálogo)"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" className="btn-secundario" onClick={() => window.print()}>
            Imprimir
          </button>
          <Link href={`/admin/production/new?de=${lote.id}`} className="btn-secundario">
            Produzir de novo
          </Link>
          <Link href={`/admin/production/new?editar=${lote.id}`} className="btn-secundario">
            Corrigir
          </Link>
          <button type="button" className="btn-secundario aria-disabled:opacity-60" aria-disabled={excluindo || undefined} onClick={excluir}>
            {excluindo ? "Excluindo…" : "Excluir"}
          </button>
          <Link href="/admin/production" className="btn-secundario">
            Voltar
          </Link>
        </div>
      </header>
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-secundaria print:hidden">
        {aviso}
      </p>

      <ul className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4">
        <Kpi
          rotulo="Rendeu"
          valor={`${lote.potes} ${lote.potes === 1 ? "pote" : "potes"}`}
          dica={peso ? `≈ ${formatarQtdInsumo(lote.potes * peso, "G")} de geleia (${peso} g cada)` : "potes cheios"}
        />
        <Kpi
          rotulo="Custo de cada pote"
          valor={t.porPote === null ? "—" : formatarBRL(t.porPote)}
          dica={`geleia ${formatarBRL(t.geleiaPorPote ?? 0)} + embalagem ${formatarBRL(t.embalagemPorPote ?? 0)}`}
        />
        {t.margemPorPote !== null && (
          <Kpi
            rotulo="Margem por pote"
            valor={formatarBRL(t.margemPorPote)}
            dica={`${formatarPorcentagem(t.margemPct ?? 0)} do preço de ${formatarBRL(t.precoVenda ?? 0)}`}
          />
        )}
        {t.lucroDoLote !== null && (
          <Kpi rotulo="Se vender tudo" valor={formatarBRL(t.lucroDoLote)} dica={`lucro dos ${lote.potes} potes`} />
        )}
      </ul>

      {tabela("INGREDIENTE", "Ingredientes")}
      {tabela("EMBALAGEM", "Embalagens")}

      {lote.custos.length > 0 && (
        <section className="cartao p-5 print:break-inside-avoid">
          <h2 className="mb-3 text-xl font-bold">Custos da produção</h2>
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {lote.custos.map((c, i) => (
              <div key={`${c.descricao}-${i}`} className="contents">
                <dt>{c.descricao}</dt>
                <dd className="text-right tabular-nums">{formatarBRL(c.valor)}</dd>
              </div>
            ))}
            <dt className="border-t border-accent2/60 pt-1 font-semibold">Total</dt>
            <dd className="border-t border-accent2/60 pt-1 text-right font-bold tabular-nums">{formatarBRL(t.extras)}</dd>
          </dl>
        </section>
      )}

      <section className="cartao p-5 print:break-inside-avoid">
        <h2 className="mb-3 text-xl font-bold">Conta do lote</h2>
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt>Ingredientes</dt>
          <dd className="text-right tabular-nums">{formatarBRL(t.ingredientes)}</dd>
          <dt>Custos da produção</dt>
          <dd className="text-right tabular-nums">{formatarBRL(t.extras)}</dd>
          <dt>Embalagens</dt>
          <dd className="text-right tabular-nums">{formatarBRL(t.embalagens)}</dd>
          <dt className="border-t border-accent2/60 pt-1 font-semibold">Total do lote</dt>
          <dd className="border-t border-accent2/60 pt-1 text-right font-bold tabular-nums">{formatarBRL(t.total)}</dd>
          <dt>÷ {lote.potes} potes</dt>
          <dd className="text-right font-bold tabular-nums">{t.porPote === null ? "—" : `${formatarBRL(t.porPote)} por pote`}</dd>
        </dl>
        {lote.observacao && <p className="mt-4 whitespace-pre-line text-sm italic text-primaria/85">{lote.observacao}</p>}
      </section>
    </article>
  );
}
