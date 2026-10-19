import type { Metadata } from "next";
import { AplicacoesDeMarca } from "@/components/AplicacoesDeMarca";
import { Ornamento } from "@/components/marca/Ornamento";
import { ProdutoCard } from "@/components/ProdutoCard";
import { listarProdutos } from "@/lib/produtos";

export const metadata: Metadata = {
  title: "Produtos",
  description: "Geleias artesanais Geleiô: pimenta, abacaxi com pimenta, abacaxi, morango e maracujá.",
};

export default async function PaginaProdutos() {
  // `listarProdutos` usa `use cache`: a página é prerenderizada e revalidada.
  const produtos = await listarProdutos();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="font-titulos text-4xl font-semibold text-primaria sm:text-5xl">Nossas geleias</h1>
        <Ornamento className="mt-4" />
        <p className="mx-auto mt-4 max-w-prose text-primaria/85">
          Feitas em pequenos lotes, com frutas selecionadas e sem conservantes.
        </p>
      </header>

      {produtos.length === 0 ? (
        <p className="py-16 text-center text-primaria/80">Nenhum produto disponível no momento.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {produtos.map((produto, indice) => (
            // `*:w-full`: o cartão ocupa a largura toda e, por estar numa linha flex, estica na altura.
            <li key={produto.id} className="flex *:w-full">
              {/* As 3 primeiras imagens (primeira fileira no desktop) carregam com prioridade. */}
              <ProdutoCard produto={produto} prioritario={indice < 3} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-16 border-t border-accent2/40 pt-12">
        <AplicacoesDeMarca />
      </div>
    </main>
  );
}
