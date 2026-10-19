import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { ProducaoAdmin } from "@/components/admin/producao/ProducaoAdmin";

export const metadata: Metadata = { title: "Produção" };

export default function PaginaProducao() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/production">
        <ProducaoAdmin />
      </GuardaAdmin>
    </Suspense>
  );
}
