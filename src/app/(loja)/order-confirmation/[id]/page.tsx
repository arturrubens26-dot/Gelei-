import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusPagamento } from "@/components/checkout/StatusPagamento";
import { exigirUsuario } from "@/lib/auth/dal";
import { formatarBRL } from "@/lib/dinheiro";
import { codigoPedido, formatarDataHora } from "@/lib/formatacao";
import { buscarPedidoDoUsuario } from "@/lib/pedidos";

export const metadata: Metadata = { title: "Confirmação do pedido" };

export default function PaginaConfirmacao({ params }: PageProps<"/order-confirmation/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando seu pedido…</span>
          </div>
        }
      >
        <DadosDoPedido params={params} />
      </Suspense>
    </main>
  );
}

async function DadosDoPedido({ params }: { params: PageProps<"/order-confirmation/[id]">["params"] }) {
  const { id } = await params;
  const usuario = await exigirUsuario(`/order-confirmation/${id}`);
  // Só o dono vê o pedido: de outra pessoa (ou inexistente) é 404.
  const pedido = await buscarPedidoDoUsuario(id, usuario.id);
  if (!pedido) notFound();

  const e = pedido.endereco;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-titulos text-4xl font-bold text-primaria">Pedido recebido!</h1>
        <p className="mt-2 text-primaria/85">
          Obrigada pela compra, {usuario.nome.split(" ")[0]}. Pedido <strong>{codigoPedido(pedido.id)}</strong> ·{" "}
          {formatarDataHora(pedido.createdAt)}
        </p>
      </header>

      <StatusPagamento pedidoId={pedido.id} statusServidor={pedido.status} />

      <section aria-labelledby="titulo-itens" className="cartao p-5">
        <h2 id="titulo-itens" className="mb-3 text-2xl font-bold">
          Itens
        </h2>
        <ul className="divide-y divide-accent1/70">
          {pedido.itens.map((item) => (
            <li key={item.productId} className="flex items-baseline justify-between gap-4 py-2 text-sm">
              <span>
                {item.quantidade} × {item.nome}
              </span>
              <span className="shrink-0 font-semibold">{formatarBRL(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 flex flex-col gap-1.5 border-t-2 border-accent2/60 pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatarBRL(pedido.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Taxa de entrega</dt>
            <dd>{formatarBRL(pedido.deliveryFee)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-xl font-bold">
            <dt>Total</dt>
            <dd>{formatarBRL(pedido.total)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="titulo-entrega" className="cartao p-5">
        <h2 id="titulo-entrega" className="mb-3 text-2xl font-bold">
          Entrega
        </h2>
        <address className="text-sm not-italic leading-relaxed">
          {e.rua}, {e.numero}
          {e.complemento ? ` — ${e.complemento}` : ""}
          <br />
          {e.bairro} · {e.cidade}/{e.estado}
          <br />
          CEP {e.cep.slice(0, 5)}-{e.cep.slice(5)}
        </address>
      </section>

      <div>
        <Link href="/products" className="btn-secundario">
          Continuar comprando
        </Link>
      </div>
    </div>
  );
}
