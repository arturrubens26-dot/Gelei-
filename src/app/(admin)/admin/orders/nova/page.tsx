import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { VendaPresencialAdmin } from "@/components/admin/VendaPresencialAdmin";
import { listarProdutos } from "@/lib/produtos";

export const metadata: Metadata = { title: "Registrar venda presencial" };

/** Venda presencial (feira, balcão): página própria, mais cômoda no celular do que um modal. */
export default function PaginaNovaVenda() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/orders/nova">
        <FormularioComCatalogo />
      </GuardaAdmin>
    </Suspense>
  );
}

async function FormularioComCatalogo() {
  const produtos = await listarProdutos();
  return (
    <VendaPresencialAdmin
      produtos={produtos.map((p) => ({ id: p.id, nome: p.nome, precoCentavos: Math.round(p.preco * 100) }))}
    />
  );
}
