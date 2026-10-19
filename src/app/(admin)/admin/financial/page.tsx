import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { FinanceiroAdmin } from "@/components/admin/FinanceiroAdmin";

export const metadata: Metadata = { title: "Financeiro" };

export default function PaginaFinanceiro() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/financial">
        <FinanceiroAdmin />
      </GuardaAdmin>
    </Suspense>
  );
}
