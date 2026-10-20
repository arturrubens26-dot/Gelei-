import type { Metadata } from "next";
import Link from "next/link";
import { MonteSeuKit } from "@/components/kits/MonteSeuKit";
import { Ornamento } from "@/components/marca/Ornamento";
import { listarKits } from "@/lib/kits";
import { listarProdutos } from "@/lib/produtos";

export const metadata: Metadata = {
  title: "Monte seu kit",
  description: "Monte uma caixa de presente Geleiô com três geleias artesanais à sua escolha.",
};

/**
 * "Monte seu kit". Kits e catálogo vêm do cache (`use cache`, tags "kits" e "produtos"): a página é
 * prerenderizada e o painel a expira na hora ao mudar preço, sabor ou visibilidade.
 */
export default async function PaginaKits() {
  const [kits, produtos] = await Promise.all([listarKits(), listarProdutos()]);
  // Na v1 há um kit só (vários tipos de kit ficam para a etapa 2).
  const kit = kits[0];
  // Só os potes que a dona marcou "Pode entrar no Kit Presente" (o servidor recusa os outros).
  const sabores = produtos.filter((p) => p.permitidoEmKit);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 sm:px-6 lg:pb-16 lg:pt-12">
      {kit && sabores.length > 0 ? (
        <MonteSeuKit kit={kit} produtos={sabores} />
      ) : (
        <section className="flex flex-col items-center gap-4 py-16 text-center" aria-labelledby="titulo-kits">
          <h1 id="titulo-kits" className="font-titulos text-4xl font-semibold text-primaria">
            Os kits voltam em breve
          </h1>
          <Ornamento />
          <p className="max-w-md text-primaria/85">
            Estamos preparando novas caixas de presente. Enquanto isso, conheça os sabores avulsos.
          </p>
          <Link href="/products" className="btn-primario mt-2">
            Ver as geleias
          </Link>
        </section>
      )}
    </main>
  );
}
