import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { MenuDoPainel } from "@/components/admin/menu/MenuDoPainel";
import { BotaoSair } from "@/components/BotaoSair";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { marca } from "@/design-system";

export const metadata: Metadata = {
  title: { default: "Painel", template: `%s | Painel ${marca.nome}` },
  // Painel interno: fora dos buscadores.
  robots: { index: false, follow: false },
};

/**
 * Layout do painel. Em telas largas, o menu é uma barra lateral recolhida em trilho de ícones que abre
 * ao passar o mouse (ou com o teclado) e pode ser fixada; em celular e tablet, um botão "Menu" abre a
 * gaveta. Os itens são agrupados por função (components/admin/menu/itens.ts). Sem o cabeçalho da loja.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  const rodape = (
    <Suspense fallback={<span className="block h-5 w-24 animate-pulse rounded bg-accent1/50" role="status" aria-label="Carregando usuário" />}>
      <UsuarioDoPainel />
    </Suspense>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-destaque text-primaria lg:flex-row">
      {/* Aparece ao receber o foco: pula o menu inteiro (no celular ele fica na gaveta; no computador, na lateral). */}
      <a
        href="#conteudo-do-painel"
        className="sr-only z-50 rounded-lg bg-secundaria px-4 py-3 font-semibold text-destaque focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Pular para o conteúdo
      </a>

      {/* Suspense: na ficha de produção (rota dinâmica) o caminho só chega com a requisição; até lá o
          menu aparece sem item marcado. print:hidden está dentro do menu: a ficha sai impressa sem ele. */}
      <Suspense fallback={<MenuDoPainel ativo={null} rodape={rodape} />}>
        <AdminNav rodape={rodape} />
      </Suspense>

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
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="truncate" title={usuario.email}>
        {usuario.nome.split(" ")[0]}
      </span>
      <BotaoSair />
    </div>
  );
}
