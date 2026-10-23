import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AbasDaConta } from "@/components/AbasDaConta";
import { SeloDoPagamento } from "@/components/checkout/SeloDoPagamento";
import { Ornamento } from "@/components/marca/Ornamento";
import { exigirUsuario } from "@/lib/auth/dal";
import { dadosLoja } from "@/lib/dados-loja";
import { formatarBRL } from "@/lib/dinheiro";
import { ROTULO_MODO_ENTREGA } from "@/lib/entrega-regras";
import { formatarDataHora } from "@/lib/formatacao";
import type { PedidoResumoDTO } from "@/lib/pagamentos-regras";
import { obterLembrancinhas } from "@/lib/lembrancinhas";
import { listarPedidosDoUsuario } from "@/lib/pedidos";

export const metadata: Metadata = { title: "Meus pedidos" };

/**
 * Os pedidos da conta, do mais recente ao mais antigo. É o caminho de volta para quem saiu da página
 * de pagamento sem pagar, ou volta outro dia: o pedido que falta pagar tem o botão "Pagar".
 */
export default async function PaginaMeusPedidos() {
  // Com as lembrancinhas abertas, a aba leva às encomendas (configuração em cache, sem sessão).
  const { ativo } = await obterLembrancinhas();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8 text-center">
        <h1 className="font-titulos text-4xl font-semibold text-primaria sm:text-5xl">Meus pedidos</h1>
        <Ornamento className="mt-4" />
      </header>
      {ativo && <AbasDaConta atual="/meus-pedidos" />}
      {/* A sessão é dado da requisição: a lista chega por streaming. */}
      <Suspense
        fallback={
          <div className="h-72 animate-pulse rounded-2xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando seus pedidos…</span>
          </div>
        }
      >
        <ListaDePedidos />
      </Suspense>
    </main>
  );
}

async function ListaDePedidos() {
  const usuario = await exigirUsuario("/meus-pedidos");
  const pedidos = await listarPedidosDoUsuario(usuario.id);

  if (pedidos.length === 0) {
    return (
      <div className="cartao flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-titulos text-2xl">Você ainda não fez pedidos pelo site.</p>
        <p className="text-primaria/80">Quando fizer, eles aparecem aqui, com o pagamento e a entrega de cada um.</p>
        <Link href="/products" className="btn-primario px-8">
          Ver as geleias
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-4">
        {pedidos.map((p) => (
          <li key={p.id}>
            <CartaoDoPedido pedido={p} />
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center text-sm text-primaria/80">
        Um pedido pode ser pago em até 48 horas. Dúvidas? Fale com a gente no Instagram{" "}
        <a
          href={dadosLoja.instagram.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
        >
          @{dadosLoja.instagram.usuario}
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
        .
      </p>
    </>
  );
}

function CartaoDoPedido({ pedido: p }: { pedido: PedidoResumoDTO }) {
  const pagar = p.etapa === "PAGAR";
  return (
    <article aria-labelledby={`pedido-${p.id}`} className="cartao flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={`pedido-${p.id}`} className="text-xl font-bold">
            Pedido {p.codigo}
          </h2>
          <SeloDoPagamento status={p.status} etapa={p.etapa} />
        </div>
        <p className="mt-1 text-sm text-primaria/80">
          {formatarDataHora(p.createdAt)} · {ROTULO_MODO_ENTREGA[p.modoEntrega]}
        </p>
        <p className="mt-2 text-sm">{p.resumo}</p>
        {p.etapa === "EXPIRADO" && (
          <p className="mt-2 text-sm text-primaria/85">O prazo para pagar terminou. Se ainda quiser, faça um novo pedido.</p>
        )}
      </div>
      <div className="flex shrink-0 flex-row items-center justify-between gap-4 sm:flex-col sm:items-end">
        <p className="text-xl font-bold tabular-nums">{formatarBRL(p.total)}</p>
        <Link href={`/order-confirmation/${p.id}`} className={pagar ? "btn-primario" : "btn-secundario"}>
          {pagar ? "Pagar" : "Ver o pedido"}
          <span className="sr-only"> {p.codigo}</span>
        </Link>
      </div>
    </article>
  );
}
