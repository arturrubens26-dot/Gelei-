import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { AdminNav, MenuDoPainel } from "@/components/admin/AdminNav";
import { BotaoSair } from "@/components/BotaoSair";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { marca, simbolos } from "@/design-system";

export const metadata: Metadata = {
  title: { default: "Painel", template: `%s | Painel ${marca.nome}` },
  // Painel interno: fora dos buscadores.
  robots: { index: false, follow: false },
};

/** Layout do painel: menu lateral (Creme + Vinho), sem o cabeçalho da loja. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    // O menu só vai para a lateral em telas largas (lg): em tablets ele fica no topo e as tabelas
    // do painel ganham a largura toda (com a lateral, a tabela de pedidos tinha só ~460px em 768px).
    <div className="flex min-h-dvh flex-col bg-destaque text-primaria lg:flex-row">
      {/* Aparece ao receber o foco: pula as ~9 paradas do menu (no celular ele ocupa a tela de cima). */}
      <a
        href="#conteudo-do-painel"
        className="sr-only z-50 rounded-lg bg-secundaria px-4 py-3 font-semibold text-destaque focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Pular para o conteúdo
      </a>
      {/* print:hidden: a ficha de produção sai impressa sem o menu. */}
      <aside className="flex shrink-0 flex-col gap-6 border-b border-accent2/60 bg-white/50 p-4 print:hidden lg:w-60 lg:border-b-0 lg:border-r lg:p-5">
        <Link href="/admin/dashboard" className="flex items-center gap-3" aria-label={`Painel ${marca.nome}`}>
          <Image src={simbolos.framboesas.src} alt="" width={36} height={36} />
          <span className="flex flex-col leading-none">
            <span className="font-titulos text-2xl font-bold">{marca.nome}</span>
            <span className="mt-1 text-xs font-semibold uppercase tracking-[0.25em] text-secundaria">Painel</span>
          </span>
        </Link>

        {/* Suspense: na ficha de produção (rota dinâmica) o caminho só chega com a requisição;
            até lá o menu aparece sem item marcado. Nas rotas fixas o build já resolve o caminho. */}
        <Suspense fallback={<MenuDoPainel />}>
          <AdminNav />
        </Suspense>

        <div className="mt-auto flex flex-col gap-3 border-t border-accent2/40 pt-4 text-sm">
          <Suspense fallback={<span className="h-5 w-24 animate-pulse rounded bg-accent1/50" role="status" aria-label="Carregando usuário" />}>
            <UsuarioDoPainel />
          </Suspense>
          <Link href="/" className="inline-flex min-h-11 items-center font-medium text-secundaria underline underline-offset-2">
            Ver a loja
          </Link>
        </div>
      </aside>

      <main id="conteudo-do-painel" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-8">
        {children}
      </main>
    </div>
  );
}

async function UsuarioDoPainel() {
  const usuario = await getUsuarioAtual();
  if (!usuario) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate" title={usuario.email}>
        {usuario.nome.split(" ")[0]}
      </span>
      <BotaoSair />
    </div>
  );
}
