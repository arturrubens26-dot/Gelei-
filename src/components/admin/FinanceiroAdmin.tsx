"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import { GraficoReceita, rotuloMes } from "@/components/admin/GraficoReceita";
import { Kpi } from "@/components/admin/Kpi";
import type { EstatisticasFinanceiras } from "@/lib/admin";
import { formatarBRL } from "@/lib/dinheiro";
import { codigoPedido, formatarDataHora } from "@/lib/formatacao";

export function FinanceiroAdmin() {
  const [versao, setVersao] = useState(0);
  const [resultado, setResultado] = useState<{ versao: number; dados?: EstatisticasFinanceiras; erro?: string } | null>(null);
  const [comoTabela, setComoTabela] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/admin/financial-stats")
      .then(async (resposta) => {
        const json = await resposta.json().catch(() => null);
        if (cancelado) return;
        setResultado(
          resposta.ok ? { versao, dados: json } : { versao, erro: json?.erro ?? "Não foi possível carregar o financeiro." },
        );
      })
      .catch(() => {
        if (!cancelado) setResultado({ versao, erro: "Sem conexão. Tente novamente." });
      });
    return () => {
      cancelado = true;
    };
  }, [versao]);

  const carregando = resultado?.versao !== versao;
  const dados = resultado?.dados;
  const erro = !carregando ? resultado?.erro : undefined;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titulos text-3xl font-bold">Financeiro</h1>
          <p className="mt-1 text-sm text-primaria/80">
            Entradas são os pedidos <strong>Pago, Enviado e Entregue</strong> (pendentes e cancelados ficam de fora). Saídas são
            as despesas lançadas em{" "}
            <Link href="/admin/expenses" className="font-semibold text-secundaria underline underline-offset-2">
              Despesas
            </Link>
            .
          </p>
        </div>
        {/* aria-disabled (e não disabled): o foco não se perde enquanto atualiza. */}
        <button
          type="button"
          className="btn-secundario aria-disabled:cursor-wait aria-disabled:opacity-60"
          onClick={() => !carregando && setVersao((v) => v + 1)}
          aria-disabled={carregando || undefined}
        >
          {carregando ? "Atualizando…" : "Atualizar"}
        </button>
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
          {/* KPIs */}
          {/* Colunas automáticas: o cartão nunca fica mais estreito que um valor como "R$ 12.345,67". */}
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
            <Kpi rotulo="Faturamento bruto total" valor={formatarBRL(dados.faturamentoBruto)} dica={`${dados.pedidosPagos} pedidos pagos, com frete`} />
            <Kpi rotulo="Despesas registradas" valor={formatarBRL(dados.despesasTotal)} dica="tudo o que foi lançado em Despesas" />
            <Kpi
              rotulo="Resultado"
              valor={formatarBRL(dados.resultado)}
              dica={dados.resultado < 0 ? "faturamento menos despesas: negativo" : "faturamento menos despesas"}
            />
            {/* É receita (o cliente paga o frete); o que a loja paga de entrega entra em Despesas. */}
            <Kpi rotulo="Frete cobrado dos clientes" valor={formatarBRL(dados.custoDelivery)} dica="já incluído no faturamento bruto" />
            <Kpi rotulo="Ticket médio" valor={formatarBRL(dados.ticketMedio)} dica="faturamento bruto ÷ pedidos pagos" />
            {/* Parte do faturamento feita na feira/balcão: sem isso o ticket médio mistura canais sem aviso. */}
            <Kpi
              rotulo="Vendas presenciais"
              valor={formatarBRL(dados.vendasPresenciais.total)}
              dica={`${dados.vendasPresenciais.quantidade} ${dados.vendasPresenciais.quantidade === 1 ? "venda" : "vendas"} na feira ou no balcão, já no faturamento`}
            />
          </ul>

          {/* Entradas e despesas por mês */}
          <section aria-labelledby="titulo-receita" className="cartao p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="titulo-receita" className="text-2xl font-bold">
                  Entradas e despesas por mês
                </h2>
                <p className="text-xs text-primaria/75">
                  Últimos 12 meses. Vendas pela data do pedido e despesas pela data da compra (horário de Brasília).
                </p>
              </div>
              {/* Sem aria-pressed: o texto já muda ("Ver gráfico"/"Ver como tabela"); os dois juntos se contradiziam. */}
              <button type="button" className="btn-secundario" onClick={() => setComoTabela((v) => !v)}>
                {comoTabela ? "Ver gráfico" : "Ver como tabela"}
              </button>
            </div>

            {dados.receitaMensal.every((m) => m.receita === 0 && m.despesas === 0) ? (
              <p className="py-12 text-center text-sm text-primaria/80">Ainda não há vendas pagas nem despesas nos últimos 12 meses.</p>
            ) : comoTabela ? (
              <div role="region" aria-label="Tabela das entradas e despesas por mês" tabIndex={0} className="relative overflow-x-auto">
                <table className="w-full min-w-md text-left text-sm">
                  <caption className="sr-only">Entradas, despesas e saldo por mês</caption>
                  <thead className="border-b-2 border-accent2/60">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Mês</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Pedidos</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Entradas</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Despesas</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-accent1/70">
                    {dados.receitaMensal.map((m) => (
                      <tr key={m.mes}>
                        <th scope="row" className="px-3 py-2 font-medium">{rotuloMes(m.mes)}</th>
                        <td className="px-3 py-2 text-right tabular-nums">{m.pedidos}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatarBRL(m.receita)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatarBRL(m.despesas)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatarBRL(m.receita - m.despesas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <GraficoReceita dados={dados.receitaMensal} />
            )}
          </section>

          {/* Transações recentes */}
          <section aria-labelledby="titulo-transacoes" className="cartao p-5">
            <h2 id="titulo-transacoes" className="mb-1 text-2xl font-bold">
              Transações recentes
            </h2>
            <p className="mb-4 text-xs text-primaria/75">
              Entradas (vendas pagas), das mais novas para as mais antigas. As saídas estão em{" "}
              <Link href="/admin/expenses" className="font-semibold text-secundaria underline underline-offset-2">
                Despesas
              </Link>
              .
            </p>
            {dados.transacoesRecentes.length === 0 ? (
              <p className="py-8 text-center text-sm text-primaria/80">Nenhuma venda paga ainda.</p>
            ) : (
              <div role="region" aria-label="Tabela das vendas recentes" tabIndex={0} className="relative overflow-x-auto">
                <table className="w-full min-w-2xl text-left text-sm">
                  <caption className="sr-only">Vendas pagas mais recentes</caption>
                  <thead className="border-b-2 border-accent2/60">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Data</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Pedido</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Cliente</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Frete</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Entrada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-accent1/70">
                    {dados.transacoesRecentes.map((t) => (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap px-3 py-2">{formatarDataHora(t.createdAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-semibold">{codigoPedido(t.id)}</td>
                        <td className="px-3 py-2">{t.cliente}</td>
                        <td className="px-3 py-2"><EtiquetaStatus status={t.status} /></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatarBRL(t.deliveryFee)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatarBRL(t.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
