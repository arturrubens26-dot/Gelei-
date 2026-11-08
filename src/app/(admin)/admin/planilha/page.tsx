import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { PlanilhaAdmin } from "@/components/admin/planilha/PlanilhaAdmin";

export const metadata: Metadata = { title: "Planilha" };

export default function PaginaPlanilha() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/planilha">
        <PlanilhaAdmin />
      </GuardaAdmin>
    </Suspense>
  );
}
