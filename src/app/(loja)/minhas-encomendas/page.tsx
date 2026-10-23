import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { AbasDaConta } from "@/components/AbasDaConta";
import { LinkInstagram } from "@/components/checkout/PagamentoPorEtapa";
import { diaComSemana } from "@/components/lembrancinhas/datas";
import { SeloDaEncomenda } from "@/components/lembrancinhas/SeloDaEncomenda";
import { situacaoDaEncomenda } from "@/components/lembrancinhas/situacao";
import { Ornamento } from "@/components/marca/Ornamento";
import { exigirUsuario } from "@/lib/auth/dal";
import { formatarBRL } from "@/lib/dinheiro";
import { expirarVencidas, listarEncomendasDoUsuario, type EncomendaDTO } from "@/lib/encomendas";
import { palavraDoModo } from "@/lib/encomendas-regras";
import { obterLembrancinhas } from "@/lib/lembrancinhas";

export const metadata: Metadata = { title: "Minhas encomendas" };

/**
 * As encomendas de lembrancinhas da conta, da mais recente para a mais antiga: status em texto, o que
 * vem agora e o caminho para pagar a entrada ou o restante (na página de cada encomenda).
 */
export default function PaginaMinhasEncomendas() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-6 text-center">
        <h1 className="font-titulos text-4xl font-semibold text-primaria sm:text-5xl">Minhas encomendas</h1>
        <Ornamento className="mt-4" />
      </header>
      <AbasDaConta atual="/minhas-encomendas" />
      <Suspense
        fallback={
          <div className="h-72 animate-pulse rounded-2xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando suas encomendas…</span>
          </div>
        }
      >
        <ListaDeEncomendas />
      </Suspense>
    </main>
  );
}

async function ListaDeEncomendas() {
  const usuario = await exigirUsuario("/minhas-encomendas");
  await io();
  const agora = new Date();
  const [encomendas, config] = await Promise.all([listarEncomendasDoUsuario(usuario.id, agora), obterLembrancinhas()]);
  // A lista já mostra o status efetivo; os prazos vencidos são gravados depois da resposta.
  after(() => expirarVencidas(agora, { userId: usuario.id }));

  if (encomendas.length === 0) {
    return (
      <div className="cartao flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-titulos text-2xl">Você ainda não fez encomendas de lembrancinhas.</p>
        <p className="max-w-md text-primaria/80">
          {config.ativo
            ? "Potinhos de geleia de 40 ml para os convidados da sua festa, de 15 a 50, nos sabores que você escolher."
            : "As encomendas de lembrancinhas voltam em breve."}
        </p>
        <Link href={config.ativo ? "/lembrancinhas" : "/products"} className="btn-primario px-8">
          {config.ativo ? "Encomendar lembrancinhas" : "Ver as geleias"}
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-4">
        {encomendas.map((e) => (
          <li key={e.id}>
            <CartaoDaEncomenda encomenda={e} />
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center text-sm text-primaria/80">
        Dúvidas? Fale com a gente no Instagram <LinkInstagram />.
      </p>
    </>
  );
}

function CartaoDaEncomenda({ encomenda: e }: { encomenda: EncomendaDTO }) {
  const situacao = situacaoDaEncomenda(e);
  const pagar = e.acoes.pagarEntrada ? "Pagar a entrada" : e.acoes.pagarRestante ? "Pagar o restante" : null;
  const palavra = palavraDoModo(e.modoEntrega);
  return (
    <article aria-labelledby={`encomenda-${e.id}`} className="cartao flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={`encomenda-${e.id}`} className="text-xl font-bold">
            Encomenda {e.codigo}
          </h2>
          <SeloDaEncomenda status={e.statusEfetivo} />
        </div>
        <p className="mt-1 text-sm text-primaria/80">
          {e.potinhos} potinhos · festa em {diaComSemana(e.dataFesta)}
        </p>
        <p className="text-sm text-primaria/80">
          {palavra[0].toUpperCase() + palavra.slice(1)} em {diaComSemana(e.dataEntrega)}
        </p>
        <p className="mt-2 text-sm">
          <strong className="font-semibold">{situacao.titulo}.</strong> {situacao.texto}
        </p>
      </div>
      <div className="flex shrink-0 flex-row items-center justify-between gap-4 sm:flex-col sm:items-end">
        <p className="text-xl font-bold tabular-nums">{formatarBRL(e.total)}</p>
        <Link href={`/minhas-encomendas/${e.id}`} className={pagar ? "btn-primario" : "btn-secundario"}>
          {pagar ?? "Ver a encomenda"}
          <span className="sr-only"> {e.codigo}</span>
        </Link>
      </div>
    </article>
  );
}
