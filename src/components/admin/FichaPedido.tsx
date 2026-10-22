"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkWhatsApp } from "@/components/admin/LinkWhatsApp";
import { ALERTA_INFORMATIVO, EXPLICACAO_ALERTA, ROTULO_ALERTA, SelosPagamento, type PagamentoDoPedidoAdmin } from "@/components/admin/SelosPagamento";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import { FotoDoPote } from "@/components/FotoDoPote";
import { MiniaturaKit } from "@/components/kits/MiniaturaKit";
import { formatarBRL } from "@/lib/dinheiro";
import { codigoPedido, formatarDataHora } from "@/lib/formatacao";
import { rotuloDoMetodo } from "@/lib/pagamentos-regras";
import type { PedidoAdminDetalheDTO } from "@/lib/pedidos-admin";
import { separarNome } from "@/lib/produtos-regras";
import { ROTULO_CANAL, ROTULO_FORMA_PAGAMENTO } from "@/lib/vendas";

const sabor = (nome: string) => separarNome(nome).sabor;

/**
 * Pagamento pelo site (InfinitePay): como a cliente pagou, quanto saiu do bolso dela (com os juros do
 * parcelado) e, se for o caso, o dinheiro a devolver pelo app.
 */
function PagamentoOnline({ pedido }: { pedido: Pick<PedidoAdminDetalheDTO, "status" | "total"> & PagamentoDoPedidoAdmin }) {
  const p = pedido.pagamento ?? null;
  const metodo = p ? rotuloDoMetodo(p.metodo, p.parcelas) : null;
  const situacao =
    metodo ??
    (p?.alerta === "PAGO_COM_DIVERGENCIA" || p?.alerta === "AVISO_NAO_CONFERIDO"
      ? "A conferir no app InfinitePay"
      : pedido.status === "PENDENTE"
      ? pedido.expirado
        ? "Prazo para pagar terminou (48 h)"
        : "Aguardando a cliente pagar"
      : pedido.status === "CANCELADO"
        ? "Não pago"
        : "Pelo site (InfinitePay)");
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-accent2/60 pt-3 text-sm">
      <p>
        Pagamento: <strong>{situacao}</strong>
      </p>
      {p?.valorPago != null && p.valorPago > pedido.total && (
        <p className="text-primaria/85">
          A cliente pagou {formatarBRL(p.valorPago)}, com os juros do parcelamento.
        </p>
      )}
      {p?.alerta && (
        <p
          className={`rounded-lg border-2 p-3 font-medium ${
            ALERTA_INFORMATIVO.has(p.alerta) ? "border-accent2 bg-accent2/10" : "border-secundaria bg-secundaria/5"
          }`}
        >
          <strong className={`block ${ALERTA_INFORMATIVO.has(p.alerta) ? "text-primaria" : "text-secundaria"}`}>{ROTULO_ALERTA[p.alerta]}</strong>
          {EXPLICACAO_ALERTA[p.alerta]}
        </p>
      )}
    </div>
  );
}
const potes = (n: number) => `${n} ${n === 1 ? "pote" : "potes"}`;

/**
 * Ficha de um pedido (dá para imprimir e levar para a bancada): o que separar (caixas a montar e
 * potes de cada sabor), as caixas de kit com a composição, os potes avulsos, para onde mandar e os
 * valores. Os dados vêm de GET /api/admin/orders/[id], que confere o admin a cada chamada.
 */
export function FichaPedido({ id }: { id: string }) {
  const [pedido, setPedido] = useState<(PedidoAdminDetalheDTO & PagamentoDoPedidoAdmin) | null>(null);
  const [erro, setErro] = useState<{ id: string; mensagem: string } | null>(null);
  const [tentativa, setTentativa] = useState(0);

  // Roda de novo quando a ficha volta à tela (Cache Components): mostra o status atualizado.
  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/orders/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        if (r.ok) {
          setPedido(json.pedido);
          setErro(null);
        } else setErro({ id, mensagem: json?.erro ?? "Não foi possível carregar o pedido." });
      })
      .catch(() => !cancelado && setErro({ id, mensagem: "Sem conexão. Tente novamente." }));
    return () => {
      cancelado = true;
    };
  }, [id, tentativa]);

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
        <Link href="/admin/orders" className="underline underline-offset-2">
          Voltar para Pedidos
        </Link>
      </div>
    );
  }
  // `pedido.id !== id`: a ficha de outro pedido ainda na tela enquanto esta carrega.
  if (!pedido || pedido.id !== id) {
    return (
      <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
        <span className="sr-only">Carregando a ficha do pedido…</span>
      </div>
    );
  }

  const { separar, endereco: e } = pedido;
  const totalPotes = separar.potes.reduce((soma, p) => soma + p.total, 0);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-secundaria">Ficha do pedido</p>
          <h1 className="font-titulos text-3xl font-bold">Pedido {codigoPedido(pedido.id)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-primaria/85">
            <span>{formatarDataHora(pedido.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{ROTULO_CANAL[pedido.canal]}</span>
            <EtiquetaStatus status={pedido.status} />
            <SelosPagamento status={pedido.status} expirado={pedido.expirado} pagamento={pedido.pagamento} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" className="btn-secundario" onClick={() => window.print()}>
            Imprimir
          </button>
          <Link href="/admin/orders" className="btn-secundario">
            Voltar para Pedidos
          </Link>
        </div>
      </header>

      <section aria-labelledby="titulo-separar" className="cartao p-5 print:break-inside-avoid">
        <h2 id="titulo-separar" className="text-xl font-bold">
          Separar para este pedido
        </h2>
        <p className="mt-1 text-sm text-primaria/85">
          {separar.caixas > 0 ? (
            <>
              Montar <strong>{separar.caixas}</strong> {separar.caixas === 1 ? "caixa de kit" : "caixas de kit"} ·{" "}
            </>
          ) : null}
          {potes(totalPotes)} no total
        </p>
        <div role="region" aria-label="Tabela: potes a separar por sabor" tabIndex={0} className="relative mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b-2 border-accent2/60">
              <tr>
                <th scope="col" className="px-2 py-2 sm:px-3 font-semibold">Sabor</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-semibold">Avulsos</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-semibold">Nas caixas</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-accent1/70">
              {separar.potes.map((p) => (
                <tr key={p.productId}>
                  <th scope="row" className="px-2 py-2 sm:px-3 font-medium">{p.nome}</th>
                  <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{p.avulsos || "—"}</td>
                  <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{p.emKits || "—"}</td>
                  <td className="px-2 py-2 sm:px-3 text-right text-base font-bold tabular-nums">{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pedido.kits.length > 0 && (
        <section aria-labelledby="titulo-caixas" className="cartao p-5 print:break-inside-avoid">
          <h2 id="titulo-caixas" className="mb-3 text-xl font-bold">
            Caixas de kit
          </h2>
          <ul className="flex flex-col divide-y divide-accent1/70">
            {pedido.kits.map((k) => (
              <li key={k.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <MiniaturaKit sabores={k.sabores} className="size-20" />
                <div className="min-w-40 flex-1">
                  <p className="font-semibold">
                    {k.quantidade} × {k.nome}
                  </p>
                  <p className="text-xs text-primaria/80">Em cada caixa:</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {k.sabores.map((s) => (
                      <li key={s.productId} className="inline-flex items-center gap-1.5 rounded-full border border-accent2/70 bg-white py-0.5 pl-0.5 pr-2.5 text-sm">
                        <span className="size-7 overflow-hidden rounded-full bg-[#f3ece3]">
                          <FotoDoPote src={s.imagemUrl} alt="" lado={56} className="size-full scale-[1.3] object-cover" />
                        </span>
                        <span>
                          {sabor(s.nome)} <strong className="tabular-nums">×{s.quantidade}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="ml-auto shrink-0 text-right text-sm tabular-nums">
                  {formatarBRL(k.precoUnitario)} cada
                  <strong className="block text-base">{formatarBRL(k.subtotal)}</strong>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pedido.itens.length > 0 && (
        <section aria-labelledby="titulo-avulsos" className="cartao p-5 print:break-inside-avoid">
          <h2 id="titulo-avulsos" className="mb-3 text-xl font-bold">
            Potes avulsos
          </h2>
          <div role="region" aria-label="Tabela: potes avulsos" tabIndex={0} className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-accent2/60">
                <tr>
                  <th scope="col" className="px-2 py-2 sm:px-3 font-semibold">Produto</th>
                  <th scope="col" className="px-2 py-2 sm:px-3 text-right font-semibold">Qtd.</th>
                  <th scope="col" className="px-2 py-2 sm:px-3 text-right font-semibold">Preço</th>
                  <th scope="col" className="px-2 py-2 sm:px-3 text-right font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent1/70">
                {pedido.itens.map((i) => (
                  <tr key={i.productId}>
                    <th scope="row" className="px-2 py-2 sm:px-3 font-medium">
                      <span className="flex items-center gap-2">
                        <span className="size-8 shrink-0 overflow-hidden rounded-sm bg-[#f3ece3]">
                          <FotoDoPote src={i.imagemUrl} alt="" lado={64} className="size-full scale-[1.3] object-cover" />
                        </span>
                        {i.nome}
                      </span>
                    </th>
                    <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{i.quantidade}</td>
                    <td className="whitespace-nowrap px-2 py-2 sm:px-3 text-right tabular-nums">{formatarBRL(i.precoUnitario)}</td>
                    <td className="whitespace-nowrap px-2 py-2 sm:px-3 text-right font-semibold tabular-nums">{formatarBRL(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="titulo-cliente" className="cartao p-5 print:break-inside-avoid">
          <h2 id="titulo-cliente" className="mb-3 text-xl font-bold">
            {pedido.modoEntrega === "RETIRADA" ? "Cliente e retirada" : e ? "Cliente e entrega" : "Cliente"}
          </h2>
          <p className="font-semibold">{pedido.cliente.nome}</p>
          {pedido.cliente.email && <p className="text-sm text-primaria/85">{pedido.cliente.email}</p>}
          {pedido.telefone && (
            <p className="text-sm">
              <LinkWhatsApp telefone={pedido.telefone} />
            </p>
          )}
          {pedido.modoEntrega === "RETIRADA" ? (
            <p className="mt-3 text-sm leading-relaxed">
              <strong className="font-semibold">Retirada na loja</strong> (sem frete). Combine o dia e o horário com a cliente pelo
              WhatsApp.
            </p>
          ) : e ? (
            <address className="mt-3 text-sm not-italic leading-relaxed">
              {e.rua}, {e.numero}
              {e.complemento ? ` — ${e.complemento}` : ""}
              <br />
              {e.bairro} · {e.cidade}/{e.estado}
              <br />
              CEP {e.cep.slice(0, 5)}-{e.cep.slice(5)}
            </address>
          ) : (
            <p className="mt-3 text-sm">Venda presencial, sem entrega.</p>
          )}
          {pedido.formaPagamento && (
            <p className="mt-3 text-sm">
              Pagamento: <strong>{ROTULO_FORMA_PAGAMENTO[pedido.formaPagamento]}</strong>
            </p>
          )}
          {pedido.observacao && <p className="mt-3 whitespace-pre-line text-sm italic text-primaria/85">{pedido.observacao}</p>}
        </section>

        <section aria-labelledby="titulo-valores" className="cartao p-5 print:break-inside-avoid">
          <h2 id="titulo-valores" className="mb-3 text-xl font-bold">
            Valores
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>Potes e caixas</dt>
            <dd className="text-right tabular-nums">{formatarBRL(pedido.subtotal)}</dd>
            <dt>Frete</dt>
            <dd className="text-right tabular-nums">{formatarBRL(pedido.deliveryFee)}</dd>
            <dt className="border-t border-accent2/60 pt-1 text-base font-bold">Total</dt>
            <dd className="border-t border-accent2/60 pt-1 text-right text-base font-bold tabular-nums">{formatarBRL(pedido.total)}</dd>
          </dl>
          {pedido.canal === "ONLINE" && <PagamentoOnline pedido={pedido} />}
        </section>
      </div>
    </article>
  );
}
