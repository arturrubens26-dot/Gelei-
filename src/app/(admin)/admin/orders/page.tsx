import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { PedidosAdmin } from "@/components/admin/PedidosAdmin";

export const metadata: Metadata = { title: "Pedidos" };

export default function PaginaPedidos() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/orders">
        <PedidosAdmin />
      </GuardaAdmin>
    </Suspense>
  );
}
