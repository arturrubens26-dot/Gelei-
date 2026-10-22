import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GerarLinkSenha } from "@/components/admin/GerarLinkSenha";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import type { ClienteDetalheDTO, SituacaoLinkSenha } from "@/lib/auth/redefinicao-regras";
import { fichaDoCliente } from "@/lib/clientes-admin";
import { formatarBRL } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatacao";

export const metadata: Metadata = { title: "Ficha da cliente" };

const formatoData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const data = (iso: string) => formatoData.format(new Date(iso));

const ROTULO_SITUACAO: Record<SituacaoLinkSenha, string> = {
  VALENDO: "Valendo",
  USADO: "Usado",
  VENCIDO: "Vencido",
  SUBSTITUIDO: "Substituído",
};

type Props = PageProps<"/admin/clientes/[id]">;

/**
 * Ficha da cliente: os dados para a dona COMPARAR com o que a cliente disser (sem ler para ela), os
 * últimos pedidos, o histórico de links de senha e o bloco que gera um link novo.
 */
export default function PaginaFichaCliente({ params }: Props) {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/clientes">
        <Ficha params={params} />
      </GuardaAdmin>
    </Suspense>
  );
}

async function Ficha({ params }: Pick<Props, "params">) {
  const { id } = await params;
  const cliente = await fichaDoCliente(id);

  if (!cliente) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-4 text-sm font-medium text-secundaria">
        <span>Conta de cliente não encontrada.</span>
        <Link href="/admin/clientes" className="underline underline-offset-2">
          Voltar para Clientes
        </Link>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-widest text-secundaria uppercase">Ficha da cliente</p>
          <h1 className="font-titulos text-3xl font-bold break-words">{cliente.nome}</h1>
        </div>
        <Link href="/admin/clientes" className="btn-secundario">
          Voltar para a busca
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <div className="flex flex-col gap-6">
          <DadosDaConta cliente={cliente} />
          <UltimosPedidos pedidos={cliente.ultimosPedidos} total={cliente.pedidos} />
          <HistoricoDeLinks links={cliente.links} />
        </div>
        <GerarLinkSenha
          clienteId={cliente.id}
          temHistorico={!cliente.semHistorico}
          temTelefone={cliente.telefoneFinal !== null}
        />
      </div>
    </article>
  );
}

function DadosDaConta({ cliente: c }: { cliente: ClienteDetalheDTO }) {
  return (
    <section aria-labelledby="titulo-conta" className="cartao p-5">
      <h2 id="titulo-conta" className="text-xl font-bold">
        Dados para comparar
      </h2>
      <p className="mt-1 text-sm text-primaria/85">Compare com o que a cliente disser. Não leia estes dados para ela.</p>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">E-mail</dt>
        <dd className="break-all">{c.email}</dd>
        <dt className="font-semibold">Nome no cadastro</dt>
        <dd className="break-words">{c.nome}</dd>
        <dt className="font-semibold">Conta criada em</dt>
        <dd>{data(c.criadoEm)}</dd>
        <dt className="font-semibold">WhatsApp</dt>
        <dd>{c.telefoneFinal ? `termina em ${c.telefoneFinal}` : "nunca informado"}</dd>
        <dt className="font-semibold">Pedidos pelo site</dt>
        <dd>{c.pedidos}</dd>
        <dt className="font-semibold">Endereços salvos</dt>
        <dd>{c.enderecos}</dd>
      </dl>
      {c.semHistorico && (
        <p className="mt-4 rounded-lg border-2 border-secundaria bg-secundaria/5 p-3 text-sm font-medium">
          Conta sem pedidos nem endereços: confira com mais cuidado. Na dúvida, sugira criar uma conta nova.
        </p>
      )}
    </section>
  );
}

function UltimosPedidos({ pedidos, total }: { pedidos: ClienteDetalheDTO["ultimosPedidos"]; total: number }) {
  return (
    <section aria-labelledby="titulo-pedidos" className="cartao p-5">
      <h2 id="titulo-pedidos" className="text-xl font-bold">
        Últimos pedidos
      </h2>
      {pedidos.length === 0 ? (
        <p className="mt-2 text-sm text-primaria/80">Nenhum pedido pelo site.</p>
      ) : (
        <>
          {total > pedidos.length && (
            <p className="mt-1 text-sm text-primaria/80">
              Os {pedidos.length} mais recentes de {total}.
            </p>
          )}
          <ul className="mt-3 flex flex-col divide-y divide-accent1/70">
            {pedidos.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/admin/orders/${p.id}`}
                    className="inline-flex min-h-11 items-center font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
                  >
                    {p.codigo}
                    <span className="sr-only">: abrir a ficha do pedido</span>
                  </Link>
                  <EtiquetaStatus status={p.status} />
                  <span className="ml-auto font-semibold tabular-nums">{formatarBRL(p.total)}</span>
                </span>
                <span className="text-primaria/85">{formatarDataHora(p.createdAt)}</span>
                <span>{p.resumo}</span>
                <span className="text-primaria/85">
                  {p.modoEntrega === "RETIRADA"
                    ? "Retirada na loja"
                    : [p.bairro, p.cidade, p.cepInicio ? `CEP ${p.cepInicio}-…` : null].filter(Boolean).join(" · ") || "Entrega"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function HistoricoDeLinks({ links }: { links: ClienteDetalheDTO["links"] }) {
  return (
    <section aria-labelledby="titulo-links" className="cartao p-5">
      <h2 id="titulo-links" className="text-xl font-bold">
        Links de senha nova
      </h2>
      {links.length === 0 ? (
        <p className="mt-2 text-sm text-primaria/80">Nenhum link gerado para esta conta.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-accent1/70">
          {links.map((l) => (
            <li key={`${l.criadoEm}-${l.origem}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
              <span>
                {formatarDataHora(l.criadoEm)} ·{" "}
                {l.origem === "PAINEL" ? `pelo painel${l.geradoPor ? `, por ${l.geradoPor}` : ""}` : "pelo e-mail"}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold text-primaria ${
                  l.situacao === "VALENDO" ? "border-accent3 bg-accent3/20" : "border-primaria/30 bg-primaria/5"
                }`}
              >
                {ROTULO_SITUACAO[l.situacao]}
                {l.situacao === "VALENDO" ? ` até ${formatarDataHora(l.expiraEm).slice(-5)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
