import type { Metadata } from "next";
import Link from "next/link";
import { AplicacoesDeMarca } from "@/components/AplicacoesDeMarca";
import { MiniaturaKit } from "@/components/kits/MiniaturaKit";
import { Ornamento } from "@/components/marca/Ornamento";
import { ProdutoCard } from "@/components/ProdutoCard";
import { formatarBRL } from "@/lib/dinheiro";
import { listarKits } from "@/lib/kits";
import { listarProdutos } from "@/lib/produtos";

// Sabores de cores bem diferentes na miniatura da chamada (vermelho, laranja com sementes, amarelo).
const SABORES_DA_CHAMADA = ["pimenta-112g", "maracuja-125g", "abacaxi-com-pimenta-125g"];

export const metadata: Metadata = {
  title: "Produtos",
  description: "Geleias artesanais Geleiô: pimenta, abacaxi com pimenta, abacaxi, morango e maracujá.",
};

export default async function PaginaProdutos() {
  // `listarProdutos` e `listarKits` usam `use cache`: a página é prerenderizada e revalidada.
  const [produtos, kits] = await Promise.all([listarProdutos(), listarKits()]);
  const kit = kits[0];
  // A miniatura da chamada só mostra potes que podem ir na caixa (sem nenhum, a chamada some, como o montador).
  const doKit = produtos.filter((p) => p.permitidoEmKit);
  const amostra = [
    ...SABORES_DA_CHAMADA.flatMap((id) => doKit.filter((p) => p.id === id)),
    ...doKit.filter((p) => !SABORES_DA_CHAMADA.includes(p.id)),
  ]
    .slice(0, kit?.potes ?? 3)
    .map((p) => ({ productId: p.id, imagemUrl: p.imagemUrl, quantidade: 1 }));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="font-titulos text-4xl font-semibold text-primaria sm:text-5xl">Nossas geleias</h1>
        <Ornamento className="mt-4" />
        <p className="mx-auto mt-4 max-w-prose text-primaria/85">
          Feitas em pequenos lotes, com frutas selecionadas e sem conservantes.
        </p>
      </header>

      {kit && amostra.length > 0 && (
        <aside
          aria-labelledby="chamada-kit"
          className="mb-10 flex flex-wrap items-center gap-4 rounded-md border border-kraft-sombra bg-kraft/55 p-4 sm:flex-nowrap sm:gap-6 sm:p-5"
        >
          <MiniaturaKit sabores={amostra} className="size-20 sm:size-24" />
          <div className="min-w-0 flex-1 basis-40">
            <h2 id="chamada-kit" className="font-titulos text-2xl font-semibold leading-tight">
              Monte seu kit
            </h2>
            <p className="mt-1 text-sm text-primaria">
              {kit.potes} geleias à sua escolha por <strong className="font-semibold">{formatarBRL(kit.preco)}</strong>, numa caixa de
              presente.
            </p>
          </div>
          <Link href="/kits" className="btn-primario w-full shrink-0 sm:w-auto">
            Montar meu kit
          </Link>
        </aside>
      )}

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
