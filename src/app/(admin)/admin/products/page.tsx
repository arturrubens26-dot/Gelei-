import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { ProdutosAdmin } from "@/components/admin/ProdutosAdmin";
import { listarProdutosAdmin } from "@/lib/produtos-admin";

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

/** Lido do banco a cada visita (não do cache da loja): mostra também os produtos ocultos. */
async function Catalogo() {
  return <ProdutosAdmin produtos={await listarProdutosAdmin()} />;
}
