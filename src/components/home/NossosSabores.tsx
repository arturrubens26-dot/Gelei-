import Link from "next/link";
import { Ornamento } from "@/components/marca/Ornamento";
import { ProdutoCard } from "@/components/ProdutoCard";
import type { ProdutoDTO } from "@/lib/produtos";

/** Sabores em destaque na página inicial, com o atalho para o catálogo completo. */
export function NossosSabores({ produtos }: { produtos: ProdutoDTO[] }) {
  return (
    <section aria-labelledby="titulo-sabores" className="border-t border-accent2/40 bg-white/50">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 id="titulo-sabores" className="text-center text-3xl font-semibold text-primaria sm:text-4xl">
          Nossos sabores
        </h2>
        <Ornamento className="mt-4" />
        <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {produtos.map((produto) => (
            <li key={produto.id} className="flex *:w-full">
              <ProdutoCard produto={produto} />
            </li>
          ))}
        </ul>
        <div className="mt-10 flex justify-center">
          <Link href="/products" className="btn-secundario px-8">
            Ver todas as geleias
          </Link>
        </div>
      </div>
    </section>
  );
}
