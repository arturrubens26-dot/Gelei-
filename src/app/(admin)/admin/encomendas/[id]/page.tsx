import type { Metadata } from "next";
import { Suspense } from "react";
import { FichaEncomenda } from "@/components/admin/encomendas/FichaEncomenda";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";

export const metadata: Metadata = { title: "Ficha da encomenda" };

export default function PaginaFichaEncomenda({ params }: PageProps<"/admin/encomendas/[id]">) {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/encomendas">
        <Ficha params={params} />
      </GuardaAdmin>
    </Suspense>
  );
}

async function Ficha({ params }: { params: PageProps<"/admin/encomendas/[id]">["params"] }) {
  const { id } = await params;
  return <FichaEncomenda id={id} />;
}
