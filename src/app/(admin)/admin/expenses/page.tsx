import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { DespesasAdmin } from "@/components/admin/DespesasAdmin";

export const metadata: Metadata = { title: "Despesas" };

export default function PaginaDespesas() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/expenses">
        <DespesasAdmin />
      </GuardaAdmin>
    </Suspense>
  );
}
