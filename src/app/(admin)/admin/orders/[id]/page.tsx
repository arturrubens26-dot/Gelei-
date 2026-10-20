import type { Metadata } from "next";
import { Suspense } from "react";
import { FichaPedido } from "@/components/admin/FichaPedido";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";

export const metadata: Metadata = { title: "Ficha do pedido" };

export default function PaginaFichaPedido({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/orders">
        <Ficha params={params} />
      </GuardaAdmin>
    </Suspense>
  );
}

async function Ficha({ params }: { params: PageProps<"/admin/orders/[id]">["params"] }) {
  const { id } = await params;
  return <FichaPedido id={id} />;
}
