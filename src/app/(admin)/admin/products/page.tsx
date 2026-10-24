import type { Metadata } from "next";
import { Suspense } from "react";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { KitsAdmin } from "@/components/admin/KitsAdmin";
import { RolarParaSecao } from "@/components/admin/menu/RolarParaSecao";
import { ProdutosAdmin } from "@/components/admin/ProdutosAdmin";
import { TaxaDeEntregaAdmin } from "@/components/admin/TaxaDeEntregaAdmin";
import { obterConfigEntregaAdmin } from "@/lib/entrega";
import { listarKitsAdmin } from "@/lib/kits-admin";
import { listarProdutosAdmin } from "@/lib/produtos-admin";

export const metadata: Metadata = { title: "Produtos" };

export default function PaginaProdutosAdmin() {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/products">
        <Catalogo />
      </GuardaAdmin>
    </Suspense>
  );
}

/** Lido do banco a cada visita (não do cache da loja): mostra também os produtos e kits ocultos. */
async function Catalogo() {
  const [produtos, kits, entrega] = await Promise.all([listarProdutosAdmin(), listarKitsAdmin(), obterConfigEntregaAdmin()]);
  // Prévia da caixa e conta da economia: só os sabores que a cliente pode escolher (à venda e
  // marcados "Pode entrar no Kit Presente"), como em listarKitsAdmin.
  const sabores = produtos
    .filter((p) => p.ativo && p.permitidoEmKit)
    .map((p) => ({ id: p.id, nome: p.nome, imagemUrl: p.imagemUrl, preco: p.preco }));
  return (
    <div className="flex flex-col gap-12">
      {/* Os atalhos "Kits" e "Taxa de entrega" do menu rolam até estas partes (?secao=). */}
      <RolarParaSecao />
      <ProdutosAdmin produtos={produtos} />
      <div id="secao-kits" tabIndex={-1} className="scroll-mt-20 border-t border-accent2/50 pt-10 outline-none lg:scroll-mt-6">
        <KitsAdmin kits={kits} sabores={sabores} />
      </div>
      <div id="secao-entrega" tabIndex={-1} className="scroll-mt-20 border-t border-accent2/50 pt-10 outline-none lg:scroll-mt-6">
        <TaxaDeEntregaAdmin inicial={entrega} />
      </div>
    </div>
  );
}
