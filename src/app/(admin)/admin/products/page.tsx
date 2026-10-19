import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { db } from "@/lib/db";
import { formatarBRL } from "@/lib/dinheiro";

export const metadata: Metadata = { title: "Produtos" };

export default function PaginaProdutosAdmin() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/products">
        <Catalogo />
      </GuardaAdmin>
    </Suspense>
  );
}

async function Catalogo() {
  const produtos = await db.product.findMany({ orderBy: { nome: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-titulos text-3xl font-bold">Produtos</h1>
        <p className="mt-1 text-sm text-primaria/80">
          Catálogo atual da loja. A edição de produtos (preço, estoque, fotos) vem na próxima etapa.
        </p>
      </header>

      <div role="region" aria-label="Tabela de produtos" tabIndex={0} className="cartao relative overflow-x-auto">
        <table className="w-full min-w-xl text-left text-sm">
          <caption className="sr-only">Produtos cadastrados</caption>
          <thead className="border-b-2 border-accent2/60 bg-accent1/20">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Produto</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Preço</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Peso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-accent1/70">
            {produtos.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Image src={p.imagemUrl} alt="" width={40} height={40} className="size-10 rounded border border-accent2/50" />
                    <span className="font-medium">{p.nome}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatarBRL(p.preco.toNumber())}</td>
                <td className="px-4 py-3 text-right tabular-nums">{p.pesoGramas} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
