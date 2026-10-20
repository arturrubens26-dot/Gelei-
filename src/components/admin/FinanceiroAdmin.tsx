"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GraficoReceita, rotuloMes } from "@/components/admin/GraficoReceita";
import type { FinanceiroDoMes } from "@/lib/admin";
import { ROTULO_CATEGORIA, formatarDia, nomeDoMes, somarMeses } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";

/** "outubro de 2026" → "Outubro de 2026" (o `capitalize` do CSS faria "Outubro De 2026"). */
const primeiraMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * Financeiro, um mês por vez: quanto entrou, quanto saiu e o que sobrou; de onde veio e para onde
 * foi o dinheiro; os 12 meses até ele; e cada movimentação (vendas e despesas na mesma lista).
 */
export function FinanceiroAdmin() {
  // null = mês corrente (quem decide é o servidor, no horário de Brasília).
  const [mes, setMes] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [resultado, setResultado] = useState<{ chave: string; dados?: FinanceiroDoMes; erro?: string } | null>(null);
  const [comoTabela, setComoTabela] = useState(false);
  const chave = `${mes ?? "atual"}|${versao}`;

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/financial-stats${mes ? `?mes=${mes}` : ""}`)
      .then(async (resposta) => {
        const json = await resposta.json().catch(() => null);
        if (cancelado) return;
        setResultado(resposta.ok ? { chave, dados: json } : { chave, erro: json?.erro ?? "Não foi possível carregar o financeiro." });
      })
      .catch(() => {
        if (!cancelado) setResultado({ chave, erro: "Sem conexão. Tente novamente." });
      });
    return () => {
      cancelado = true;
    };
  }, [chave, mes]);

  const carregando = resultado?.chave !== chave;
  const dados = resultado?.dados;
  const erro = !carregando ? resultado?.erro : undefined;
  const mesNaTela = dados?.mes ?? mes;
  const noMesAtual = dados ? dados.mes === dados.mesAtual : mes === null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulos text-3xl font-bold">Financeiro</h1>
          <p className="mt-1 text-sm text-primaria/80">Quanto entrou, quanto saiu e o que sobrou em cada mês.</p>
        </div>
        <nav aria-label="Escolher o mês" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secundario"
            disabled={!mesNaTela}
            onClick={() => mesNaTela && setMes(somarMeses(mesNaTela, -1))}
            aria-label={mesNaTela ? `Mês anterior: ${nomeDoMes(somarMeses(mesNaTela, -1))}` : "Mês anterior"}
          >
            ‹
          </button>
          <p className="min-w-44 text-center font-titulos text-lg font-semibold" aria-live="polite">
            {mesNaTela ? primeiraMaiuscula(nomeDoMes(mesNaTela)) : "Mês atual"}
          </p>
          <button
            type="button"
            className="btn-secundario"
            disabled={!mesNaTela || noMesAtual}
            onClick={() => mesNaTela && setMes(somarMeses(mesNaTela, 1))}
            aria-label={mesNaTela ? `Próximo mês: ${nomeDoMes(somarMeses(mesNaTela, 1))}` : "Próximo mês"}
          >
            ›
          </button>
          {!noMesAtual && (
            <button type="button" className="btn-secundario" onClick={() => setMes(null)}>
              Mês atual
            </button>
          )}
          <button
            type="button"
            className="btn-secundario aria-disabled:cursor-wait aria-disabled:opacity-60"
            onClick={() => !carregando && setVersao((v) => v + 1)}
            aria-disabled={carregando || undefined}
          >
            {carregando ? "Atualizando…" : "Atualizar"}
          </button>
        </nav>
      </header>

      {erro && (
        <p role="alert" className="rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria">
          {erro}
        </p>
      )}

      {!dados && carregando && (
        <div className="h-64 animate-pulse rounded-2xl bg-accent1/30" role="status">
          <span className="sr-only">Carregando o financeiro…</span>
        </div>
      )}

      {dados && (
        <div className={`flex flex-col gap-8 transition-opacity ${carregando ? "opacity-60" : ""}`} aria-busy={carregando}>
          <Resumo dados={dados} />

          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <Entradas dados={dados} />
            <Saidas dados={dados} />
          </div>

          <section aria-labelledby="titulo-evolucao" className="cartao p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="titulo-evolucao" className="text-2xl font-bold">
                  Últimos 12 meses
                </h2>
                <p className="text-xs text-primaria/75">Até {nomeDoMes(dados.mes)}: entradas e saídas de cada mês.</p>
              </div>
              <button type="button" className="btn-secundario" onClick={() => setComoTabela((v) => !v)}>
                {comoTabela ? "Ver gráfico" : "Ver como tabela"}
              </button>
            </div>
            {dados.evolucao.every((m) => m.receita === 0 && m.despesas === 0) ? (
              <p className="py-12 text-center text-sm text-primaria/80">Nenhuma venda paga nem despesa nesses 12 meses.</p>
            ) : comoTabela ? (
              <div role="region" aria-label="Tabela dos últimos 12 meses" tabIndex={0} className="relative overflow-x-auto">
                <table className="w-full min-w-md text-left text-sm">
                  <caption className="sr-only">Entradas, saídas e o que sobrou em cada mês</caption>
                  <thead className="border-b-2 border-accent2/60">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Mês</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Vendas</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Entradas</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Saídas</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Sobrou</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-accent1/70">
                    {dados.evolucao.map((m) => (
                      <tr key={m.mes} className={m.mes === dados.mes ? "bg-accent1/30" : undefined}>
                        <th scope="row" className="px-3 py-2 font-medium">
                          {/* Clicar no mês abre o Financeiro dele. */}
                          <button type="button" className="underline underline-offset-2" onClick={() => setMes(m.mes)}>
                            {rotuloMes(m.mes)}
                          </button>
                        </th>
                        <td className="px-3 py-2 text-right tabular-nums">{m.pedidos}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatarBRL(m.receita)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatarBRL(m.despesas)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${m.receita - m.despesas < 0 ? "text-secundaria" : ""}`}>
                          {formatarBRL(m.receita - m.despesas)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <GraficoReceita dados={dados.evolucao} />
            )}
          </section>

          <Movimentacoes dados={dados} />
        </div>
      )}
    </div>
  );
}

function Resumo({ dados }: { dados: FinanceiroDoMes }) {
  const { entradas, saidas, resultado, vendas, lancamentos } = dados.resumo;
  const negativo = resultado < 0;
  return (
    <section aria-labelledby="titulo-resumo" className="flex flex-col gap-4">
      <h2 id="titulo-resumo" className="sr-only">
        Resumo de {nomeDoMes(dados.mes)}
      </h2>
      <p className="text-base">
        Em <strong>{nomeDoMes(dados.mes)}</strong> entraram <strong>{formatarBRL(entradas)}</strong> e saíram{" "}
        <strong>{formatarBRL(saidas)}</strong>:{" "}
        {negativo ? (
          <strong className="text-secundaria">faltaram {formatarBRL(-resultado)}</strong>
        ) : (
          <strong>sobraram {formatarBRL(resultado)}</strong>
        )}
        .
      </p>
      <ul className="grid gap-4 sm:grid-cols-3">
        <li className="cartao p-5">
          <p className="text-sm font-medium text-primaria/85">Entradas</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">{formatarBRL(entradas)}</p>
          <p className="mt-1 text-xs text-primaria/80">
            {vendas} {vendas === 1 ? "venda paga" : "vendas pagas"} (site, feira e balcão)
          </p>
        </li>
        <li className="cartao p-5">
          <p className="text-sm font-medium text-primaria/85">Saídas</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">{formatarBRL(saidas)}</p>
          <p className="mt-1 text-xs text-primaria/80">
            {lancamentos} {lancamentos === 1 ? "despesa lançada" : "despesas lançadas"}
          </p>
        </li>
        <li className={`cartao p-5 ${negativo ? "border-secundaria" : ""}`}>
          <p className="text-sm font-medium text-primaria/85">{negativo ? "Faltou" : "Sobrou"}</p>
          <p className={`mt-2 text-3xl font-bold tabular-nums ${negativo ? "text-secundaria" : ""}`}>{formatarBRL(resultado)}</p>
          <p className="mt-1 text-xs text-primaria/80">entradas menos saídas</p>
        </li>
      </ul>
    </section>
  );
}

function Entradas({ dados }: { dados: FinanceiroDoMes }) {
  const { site, presencial, ticketMedio, porSabor, kits } = dados.entradas;
  return (
    <section aria-labelledby="titulo-entradas" className="cartao flex flex-col gap-4 p-5">
      <div>
        <h2 id="titulo-entradas" className="text-2xl font-bold">
          De onde veio o dinheiro
        </h2>
        <p className="text-xs text-primaria/75">Vendas pagas, enviadas ou entregues. Pendentes e canceladas ficam de fora.</p>
      </div>
      <dl className="flex flex-col divide-y divide-accent1/70 text-sm">
        <Linha rotulo="Vendas pelo site" valor={site.total} detalhe={`${site.pedidos} ${site.pedidos === 1 ? "pedido" : "pedidos"}`} />
        <Linha rotulo="Vendas na feira e no balcão" valor={presencial.total} detalhe={`${presencial.vendas} ${presencial.vendas === 1 ? "venda" : "vendas"}`} />
        <Linha rotulo="Frete cobrado no site" valor={site.frete} detalhe="já incluído nas vendas pelo site" discreto />
        <Linha rotulo="Valor médio por venda" valor={ticketMedio} detalhe="entradas ÷ vendas" discreto />
        {/* Já está dentro das vendas acima: a linha só mostra quanto veio em caixas e o desconto dado. */}
        {kits.caixas > 0 && (
          <Linha
            rotulo="Kits de presente"
            valor={kits.valor}
            detalhe={`${kits.caixas} ${kits.caixas === 1 ? "caixa" : "caixas"} · desconto dado ${formatarBRL(kits.desconto)} · já incluído nas vendas`}
            discreto
          />
        )}
      </dl>
      <div>
        <h3 className="mb-2 font-semibold">Por sabor</h3>
        {porSabor.length === 0 ? (
          <p className="text-sm text-primaria/80">Nenhuma venda paga neste mês.</p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Potes vendidos (total e quantos dentro de caixas de kit) e valor por sabor, sem o frete</caption>
              <thead className="border-b-2 border-accent2/60">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">Sabor</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Potes</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">em kits</th>
                  <th scope="col" className="py-2 pl-3 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent1/70">
                {porSabor.map((s) => (
                  <tr key={s.productId}>
                    <th scope="row" className="py-2 pr-3 font-medium">{s.nome}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{s.potes}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-primaria/85">{s.potesEmKits > 0 ? s.potesEmKits : "—"}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{formatarBRL(s.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {porSabor.some((s) => s.potesEmKits > 0) && (
              <p className="mt-2 text-xs text-primaria/75">
                “Potes” já inclui os que saíram em kits. O valor de um pote em kit é a parte dele no preço da caixa.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Linha({ rotulo, valor, detalhe, discreto = false }: { rotulo: string; valor: number; detalhe: string; discreto?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={discreto ? "text-primaria/80" : "font-medium"}>
        {rotulo}
        <span className="block text-xs font-normal text-primaria/70">{detalhe}</span>
      </dt>
      <dd className={`shrink-0 tabular-nums ${discreto ? "text-primaria/80" : "text-lg font-semibold"}`}>{formatarBRL(valor)}</dd>
    </div>
  );
}

function Saidas({ dados }: { dados: FinanceiroDoMes }) {
  const maior = Math.max(0, ...dados.saidas.map((c) => c.total));
  const total = dados.resumo.saidas;
  return (
    <section aria-labelledby="titulo-saidas" className="cartao flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="titulo-saidas" className="text-2xl font-bold">
            Para onde foi o dinheiro
          </h2>
          <p className="text-xs text-primaria/75">Despesas do mês, pela data da compra, por categoria.</p>
        </div>
        <Link href="/admin/expenses" className="text-sm font-semibold text-secundaria underline underline-offset-2">
          Lançar ou corrigir despesas
        </Link>
      </div>
      {dados.saidas.length === 0 ? (
        <p className="text-sm text-primaria/80">Nenhuma despesa lançada neste mês.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {dados.saidas.map((c) => {
            const parte = total > 0 ? Math.round((c.total / total) * 100) : 0;
            return (
              <li key={c.categoria}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {ROTULO_CATEGORIA[c.categoria]}{" "}
                    <span className="text-xs font-normal text-primaria/70">
                      ({c.lancamentos} {c.lancamentos === 1 ? "lançamento" : "lançamentos"})
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatarBRL(c.total)} <span className="text-xs text-primaria/70">· {parte}%</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-accent1/40" aria-hidden="true">
                  <div className="h-full rounded-full bg-secundaria/80" style={{ width: `${maior > 0 ? (c.total / maior) * 100 : 0}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Movimentacoes({ dados }: { dados: FinanceiroDoMes }) {
  return (
    <section aria-labelledby="titulo-movimentacoes" className="cartao p-5">
      <h2 id="titulo-movimentacoes" className="text-2xl font-bold">
        Movimentações do mês
      </h2>
      <p className="mb-4 text-xs text-primaria/75">
        Vendas pagas e despesas de {nomeDoMes(dados.mes)}, da mais recente para a mais antiga.
        {dados.movimentacoesTruncadas ? " Mostrando as 100 mais recentes." : ""}
      </p>
      {dados.movimentacoes.length === 0 ? (
        <p className="py-8 text-center text-sm text-primaria/80">Nenhuma movimentação neste mês.</p>
      ) : (
        <div role="region" aria-label="Tabela das movimentações do mês" tabIndex={0} className="relative overflow-x-auto">
          <table className="w-full min-w-2xl text-left text-sm">
            <caption className="sr-only">Entradas e saídas do mês</caption>
            <thead className="border-b-2 border-accent2/60">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Dia</th>
                <th scope="col" className="px-3 py-2 font-semibold">Tipo</th>
                <th scope="col" className="px-3 py-2 font-semibold">Descrição</th>
                <th scope="col" className="px-3 py-2 font-semibold">Onde / categoria</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-accent1/70">
              {dados.movimentacoes.map((m) => (
                <tr key={`${m.tipo}-${m.id}`}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatarDia(m.dia)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        m.tipo === "entrada" ? "bg-accent1/70" : "border border-secundaria/60 text-secundaria"
                      }`}
                    >
                      {m.tipo === "entrada" ? "Entrada" : "Saída"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{m.descricao}</td>
                  <td className="px-3 py-2 text-primaria/85">{m.detalhe}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${m.tipo === "saida" ? "text-secundaria" : ""}`}>
                    {m.tipo === "saida" ? "− " : "+ "}
                    {formatarBRL(m.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
