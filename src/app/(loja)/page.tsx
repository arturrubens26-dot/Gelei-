import { AplicacoesDeMarca } from "@/components/AplicacoesDeMarca";
import { Abertura } from "@/components/home/Abertura";
import { NossosSabores } from "@/components/home/NossosSabores";
import { listarProdutos } from "@/lib/produtos";

// A Pimenta já é a foto da abertura; os destaques mostram outros sabores (com foto real) para não repetir.
const DESTAQUES = ["abacaxi-com-pimenta-125g", "maracuja-125g", "abacaxi-125g"];

/** Página inicial: só busca os dados e compõe as seções (que ficam em components/home). */
export default async function Home() {
  // `listarProdutos` usa `use cache`: a página continua prerenderizada.
  const produtos = await listarProdutos();
  const destaques = [
    ...DESTAQUES.flatMap((id) => produtos.filter((p) => p.id === id)),
    ...produtos.filter((p) => !DESTAQUES.includes(p.id)),
  ].slice(0, 3);

  return (
    <main className="flex-1">
      <Abertura />
      <NossosSabores produtos={destaques} />
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <AplicacoesDeMarca />
      </section>
    </main>
  );
}
