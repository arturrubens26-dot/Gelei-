import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { FichaProducao } from "@/components/admin/producao/FichaProducao";

export const metadata: Metadata = { title: "Ficha de produção" };

export default function PaginaFichaProducao({ params }: PageProps<"/admin/production/[id]">) {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/production">
        <Ficha params={params} />
      </GuardaAdmin>
    </Suspense>
  );
}

async function Ficha({ params }: { params: PageProps<"/admin/production/[id]">["params"] }) {
  const { id } = await params;
  return <FichaProducao id={id} />;
}
