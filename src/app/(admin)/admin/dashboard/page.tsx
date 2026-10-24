import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import { resumoDashboard } from "@/lib/admin";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarPrazo } from "@/lib/encomendas-regras";
import { codigoPedido, formatarDataHora } from "@/lib/formatacao";
import { obterLembrancinhas } from "@/lib/lembrancinhas";

export const metadata: Metadata = { title: "Dashboard" };

export default function PaginaDashboard() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/dashboard">
        <Resumo />
      </GuardaAdmin>
    </Suspense>
  );
}

async function Resumo() {
  const [r, lembrancinhas] = await Promise.all([resumoDashboard(), obterLembrancinhas()]);
  const enc = r.encomendas;
  const mostrarEncomendas = lembrancinhas.ativo || enc.aguardandoResposta + enc.entregasHoje + enc.devolucoesPendentes > 0;
  const cartoesEncomendas = [
    {
      rotulo: "Encomendas a responder",
      valor: String(enc.aguardandoResposta),
      dica: enc.proximoPrazo ? `a primeira até ${formatarPrazo(new Date(enc.proximoPrazo))}` : "nenhuma esperando",
      href: "/admin/encomendas?visao=responder",
      urgente: enc.aguardandoResposta > 0,
    },
    { rotulo: "Lembrancinhas para hoje", valor: String(enc.entregasHoje), dica: "entregas ou retiradas", href: "/admin/encomendas?visao=agenda", urgente: false },
    {
      rotulo: "Devoluções pendentes",
      valor: String(enc.devolucoesPendentes),
      dica: "devolver pelo app InfinitePay",
      href: "/admin/encomendas?visao=devolucoes",
      urgente: enc.devolucoesPendentes > 0,
    },
  ];

  const cartoes = [
    { rotulo: "Pedidos pendentes", valor: String(r.pendentes), dica: "aguardando pagamento", href: "/admin/orders" },
    { rotulo: "Pagos, a enviar", valor: String(r.aEnviar), dica: "a despachar ou a entregar", href: "/admin/orders" },
    { rotulo: "Faturamento bruto", valor: formatarBRL(r.faturamentoBruto), dica: `${r.pedidosPagos} pedidos pagos`, href: "/admin/financial" },
    { rotulo: "Ticket médio", valor: formatarBRL(r.ticketMedio), dica: "por pedido pago", href: "/admin/financial" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulos text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-primaria/80">Visão geral da operação da Geleiô.</p>
        </div>
        <Link href="/admin/orders/nova" className="btn-primario">
          Registrar venda presencial
        </Link>
      </header>

      {/* Colunas automáticas: o cartão nunca fica mais estreito que um valor como "R$ 12.345,67". */}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
        {cartoes.map((c) => (
          <li key={c.rotulo}>
            <Link href={c.href} className="cartao block h-full p-5 transition-colors hover:bg-accent1/20">
              <p className="text-sm font-medium text-primaria/85">{c.rotulo}</p>
              <p className="mt-2 text-2xl font-bold sm:text-3xl">{c.valor}</p>
              <p className="mt-1 text-xs text-primaria/80">{c.dica}</p>
            </Link>
          </li>
        ))}
      </ul>

      {mostrarEncomendas && (
        <section aria-labelledby="titulo-lembrancinhas" className="flex flex-col gap-3">
          <h2 id="titulo-lembrancinhas" className="text-2xl font-bold">
            Lembrancinhas
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
            {cartoesEncomendas.map((c) => (
              <li key={c.rotulo}>
                <Link href={c.href} className={`cartao block h-full p-5 transition-colors hover:bg-accent1/20 ${c.urgente ? "border-secundaria" : ""}`}>
                  <p className="text-sm font-medium text-primaria/85">{c.rotulo}</p>
                  <p className={`mt-2 text-2xl font-bold sm:text-3xl ${c.urgente ? "text-secundaria" : ""}`}>{c.valor}</p>
                  <p className="mt-1 text-xs text-primaria/80">{c.dica}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="titulo-recentes" className="cartao p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="titulo-recentes" className="text-2xl font-bold">
            Pedidos recentes
          </h2>
          <Link href="/admin/orders" className="text-sm font-semibold text-secundaria underline underline-offset-2">
            Ver todos
          </Link>
        </div>
        {r.recentes.length === 0 ? (
          <p className="py-6 text-center text-sm text-primaria/80">Ainda não há pedidos.</p>
        ) : (
          <ul className="divide-y divide-accent1/70">
            {r.recentes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <span>
                  <strong>{codigoPedido(p.id)}</strong> · {p.cliente}
                  <span className="block text-xs text-primaria/75">{formatarDataHora(p.createdAt)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{formatarBRL(p.total)}</span>
                  <EtiquetaStatus status={p.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
