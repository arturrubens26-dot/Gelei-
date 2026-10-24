import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { FUSO_LOJA } from "@/lib/despesas";
import { MIN_CARACTERES_BUSCA, buscarClientes } from "@/lib/clientes-admin";

export const metadata: Metadata = { title: "Clientes" };

/** Máximo que `buscarClientes` devolve: com tantos, pedimos para refinar. */
const MAX_RESULTADOS = 20;

const formatoData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_LOJA, day: "2-digit", month: "2-digit", year: "numeric" });

type Props = PageProps<"/admin/clientes">;

/**
 * Busca de contas de cliente (nunca de admin) por e-mail, nome ou telefone. A dona chega aqui quando
 * uma cliente pede uma senha nova pelo Instagram: acha a conta, abre a ficha, confere a identidade e
 * gera o link. Formulário GET (funciona sem JavaScript; com ele, navega sem recarregar).
 */
export default function PaginaClientes({ searchParams }: Props) {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/clientes">
        <BuscaDeClientes searchParams={searchParams} />
      </GuardaAdmin>
    </Suspense>
  );
}

async function BuscaDeClientes({ searchParams }: Pick<Props, "searchParams">) {
  const { busca: bruto } = await searchParams;
  const busca = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim().slice(0, 100) ?? "";
  const valida = busca.length >= MIN_CARACTERES_BUSCA;
  const clientes = valida ? await buscarClientes(busca) : [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-titulos text-3xl font-bold">Clientes</h1>
        <p className="mt-1 max-w-prose text-sm text-primaria/80">
          Procure a conta de uma cliente para conferir quem ela é e, se ela pediu, gerar um link para criar uma senha nova.
        </p>
      </header>

      <Form action="/admin/clientes" role="search" aria-label="Buscar clientes" className="cartao flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor="busca-clientes" className="mb-1 block text-sm font-semibold">
            E-mail, nome ou telefone
          </label>
          <input
            id="busca-clientes"
            name="busca"
            type="search"
            defaultValue={busca}
            required
            minLength={MIN_CARACTERES_BUSCA}
            maxLength={100}
            autoComplete="off"
            className="campo"
            aria-describedby="busca-clientes-dica"
          />
          <p id="busca-clientes-dica" className="mt-1 text-xs text-primaria/80">
            Pelo menos {MIN_CARACTERES_BUSCA} letras. Procure pelo que a cliente disser: nunca sugira um e-mail para ela.
          </p>
        </div>
        <button type="submit" className="btn-primario sm:mt-6">
          Buscar
        </button>
      </Form>

      {busca.length > 0 && !valida && (
        <p role="status" className="text-sm font-medium text-secundaria">
          Digite pelo menos {MIN_CARACTERES_BUSCA} letras para buscar.
        </p>
      )}

      {valida && (
        <section aria-labelledby="titulo-resultados" className="flex flex-col gap-3">
          <h2 id="titulo-resultados" role="status" className="text-xl font-bold">
            {clientes.length === 0
              ? `Nenhuma conta encontrada para “${busca}”`
              : `${clientes.length} ${clientes.length === 1 ? "conta encontrada" : "contas encontradas"}`}
          </h2>
          {clientes.length >= MAX_RESULTADOS && (
            <p className="text-sm text-primaria/80">Mostrando as {MAX_RESULTADOS} mais recentes. Digite mais para encontrar a conta certa.</p>
          )}
          {clientes.length > 0 && (
            <ul className="cartao divide-y divide-accent1/70">
              {clientes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/clientes/${c.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-accent1/20"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-secundaria underline underline-offset-2">{c.nome}</span>
                      <span className="block text-sm break-all text-primaria/85">{c.email}</span>
                    </span>
                    <span className="text-xs text-primaria/80">
                      Conta desde {formatoData.format(new Date(c.criadoEm))} · {c.pedidos} {c.pedidos === 1 ? "pedido" : "pedidos"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
