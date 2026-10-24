import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfigLembrancinhasAdmin } from "@/components/admin/encomendas/ConfigLembrancinhasAdmin";
import { RolarParaSecao } from "@/components/admin/menu/RolarParaSecao";
import { EncomendasAdmin } from "@/components/admin/encomendas/EncomendasAdmin";
import { CarregandoAdmin, GuardaAdmin } from "@/components/admin/GuardaAdmin";
import { VISOES_ENCOMENDAS, obterConfigLembrancinhasAdmin, type VisaoEncomendas } from "@/lib/encomendas-admin";

export const metadata: Metadata = { title: "Encomendas" };

type Props = PageProps<"/admin/encomendas">;

export default function PaginaEncomendasAdmin({ searchParams }: Props) {
  return (
    <Suspense fallback={<CarregandoAdmin />}>
      <GuardaAdmin destino="/admin/encomendas">
        <Conteudo searchParams={searchParams} />
      </GuardaAdmin>
    </Suspense>
  );
}

/** A configuração é lida do banco a cada visita (não do cache da loja); as listas vêm da API. */
async function Conteudo({ searchParams }: Pick<Props, "searchParams">) {
  const [busca, config] = await Promise.all([searchParams, obterConfigLembrancinhasAdmin()]);
  const pedida = typeof busca.visao === "string" ? busca.visao : "";
  const visao: VisaoEncomendas = (VISOES_ENCOMENDAS as readonly string[]).includes(pedida) ? (pedida as VisaoEncomendas) : "responder";
  return (
    <div className="flex flex-col gap-6">
      <header className="print:hidden">
        <h1 className="font-titulos text-3xl font-bold">Encomendas de lembrancinhas</h1>
        <p className="mt-1 text-sm text-primaria/80">Responda as solicitações, acompanhe os pagamentos e planeje a produção dos potinhos.</p>
      </header>
      <RolarParaSecao />
      <div id="secao-configuracao" tabIndex={-1} className="scroll-mt-20 outline-none print:hidden lg:scroll-mt-6">
        <ConfigLembrancinhasAdmin inicial={config} />
      </div>
      <EncomendasAdmin visaoInicial={visao} />
    </div>
  );
}
