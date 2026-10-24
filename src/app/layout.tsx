import type { Metadata } from "next";
import { SCRIPT_MENU_FIXADO } from "@/components/admin/menu/scriptDoMenu";
import { marca } from "@/design-system";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${marca.nome} — ${marca.slogan}`,
    template: `%s | ${marca.nome}`,
  },
  description: `${marca.nome}: ${marca.slogan.toLowerCase()}, feitas com ingredientes selecionados.`,
};

// Layout raiz mínimo. Header/Footer/Carrinho ficam em (loja)/layout.tsx e o
// painel administrativo tem o próprio layout em (admin)/admin/layout.tsx.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: o script do <head> põe data-painel-fixado no <html> antes do React hidratar.
    <html lang="pt-BR" className="h-full" suppressHydrationWarning>
      <head>
        {/* Menu do painel fixado ou recolhido, lido antes da primeira pintura (a barra não pisca). */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_MENU_FIXADO }} />
        {/* As fontes vêm do Google Fonts via @import (globals.css). Abrir a conexão antes encurta a espera. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="isolate flex min-h-full flex-col">{children}</body>
    </html>
  );
}
