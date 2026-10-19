import type { Metadata } from "next";
import { marca } from "@/design-system";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${marca.nome} — ${marca.slogan}`,
    template: `%s | ${marca.nome}`,
  },
  description: `${marca.nome}: ${marca.slogan.toLowerCase()}, feitas com amor e ingredientes selecionados.`,
};

// Layout raiz mínimo. Header/Footer/Carrinho ficam em (loja)/layout.tsx e o
// painel administrativo tem o próprio layout em (admin)/admin/layout.tsx.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full">
      <head>
        {/* As fontes vêm do Google Fonts via @import (globals.css). Abrir a conexão antes encurta a espera. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
