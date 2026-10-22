import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusPagamento } from "@/components/checkout/StatusPagamento";
import { MiniaturaKit } from "@/components/kits/MiniaturaKit";
import { exigirUsuario } from "@/lib/auth/dal";
import { dadosLoja } from "@/lib/dados-loja";
import { formatarBRL } from "@/lib/dinheiro";
import { enderecoDeRetirada, formatarTelefone } from "@/lib/entrega-regras";
import { codigoPedido, formatarDataHora } from "@/lib/formatacao";
import { textoDaComposicao } from "@/lib/kits-regras";
import { obterSituacaoPagamento } from "@/lib/pagamentos";
import { buscarPedidoDoUsuario } from "@/lib/pedidos";

export const metadata: Metadata = { title: "Confirmação do pedido" };

type Props = PageProps<"/order-confirmation/[id]">;

export default function PaginaConfirmacao({ params, searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando seu pedido…</span>
          </div>
        }
      >
        <DadosDoPedido params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function DadosDoPedido({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  // `?retorno=1`: veio da InfinitePay (por /pagamento/retorno). Sem sessão, volta para cá depois do login.
  const voltouDoPagamento = busca.retorno === "1";
  const usuario = await exigirUsuario(`/order-confirmation/${id}${voltouDoPagamento ? "?retorno=1" : ""}`);
  // Só o dono vê o pedido: de outra pessoa (ou inexistente) é 404.
  const [pedido, situacao] = await Promise.all([buscarPedidoDoUsuario(id, usuario.id), obterSituacaoPagamento(id, usuario.id)]);
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

      {situacao && <StatusPagamento pedidoId={pedido.id} situacaoInicial={situacao} voltouDoPagamento={voltouDoPagamento} />}

      <section aria-labelledby="titulo-itens" className="cartao p-5">
        <h2 id="titulo-itens" className="mb-3 text-2xl font-bold">
          Itens
        </h2>
        <ul className="divide-y divide-accent1/70">
          {pedido.kits.map((kit) => (
            <li key={kit.id} className="flex items-center gap-3 py-2 text-sm">
              <MiniaturaKit sabores={kit.sabores} className="size-14" />
              <span className="min-w-0 flex-1">
                {kit.quantidade} × {kit.nome}
                <span className="block text-primaria/80">
                  {textoDaComposicao(kit.sabores)} · {formatarBRL(kit.precoUnitario)} cada
                </span>
              </span>
              <span className="shrink-0 self-baseline font-semibold">{formatarBRL(kit.subtotal)}</span>
            </li>
          ))}
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
            <dt>{pedido.modoEntrega === "RETIRADA" ? "Retirada na loja" : "Taxa de entrega"}</dt>
            <dd>{pedido.modoEntrega === "RETIRADA" ? "Grátis" : formatarBRL(pedido.deliveryFee)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-xl font-bold">
            <dt>Total</dt>
            <dd>{formatarBRL(pedido.total)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="titulo-entrega" className="cartao p-5">
        <h2 id="titulo-entrega" className="mb-3 text-2xl font-bold">
          {pedido.modoEntrega === "RETIRADA" ? "Retirada na loja" : "Entrega"}
        </h2>
        {pedido.modoEntrega === "RETIRADA" || !e ? (
          <>
            <p className="text-sm leading-relaxed">Sem custo, na loja:</p>
            <address className="mt-1 text-sm font-semibold not-italic leading-relaxed">{enderecoDeRetirada()}</address>
          </>
        ) : (
          <address className="text-sm not-italic leading-relaxed">
            {e.rua}, {e.numero}
            {e.complemento ? ` — ${e.complemento}` : ""}
            <br />
            {e.bairro} · {e.cidade}/{e.estado}
            <br />
            CEP {e.cep.slice(0, 5)}-{e.cep.slice(5)}
          </address>
        )}
        <p className="mt-4 border-t border-accent2/50 pt-4 text-sm leading-relaxed text-primaria/90">
          {pedido.status === "CANCELADO"
            ? "Este pedido foi cancelado."
            : `Depois que o pagamento for confirmado, chamamos você no WhatsApp${
                pedido.telefone ? ` ${formatarTelefone(pedido.telefone)}` : ""
              } para combinar o dia e o horário da ${pedido.modoEntrega === "RETIRADA" ? "retirada" : "entrega"}.`}
        </p>
        <p className="mt-2 text-sm text-primaria/85">
          Dúvidas? Fale com a gente no Instagram{" "}
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
      </section>

      <div>
        <Link href="/products" className="btn-secundario">
          Continuar comprando
        </Link>
      </div>
    </div>
  );
}
