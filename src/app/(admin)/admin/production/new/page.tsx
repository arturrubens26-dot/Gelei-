import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { FormProducao } from "@/components/admin/producao/FormProducao";

export const metadata: Metadata = { title: "Nova produção" };

/** Nova produção. `?de=<id>` produz de novo a partir de um lote; `?editar=<id>` corrige um lote. */
export default function PaginaNovaProducao() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/production/new">
        <FormProducao />
      </GuardaAdmin>
    </Suspense>
  );
}
