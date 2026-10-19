"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/dashboard", rotulo: "Dashboard" },
  { href: "/admin/orders", rotulo: "Pedidos" },
  { href: "/admin/financial", rotulo: "Financeiro" },
  { href: "/admin/expenses", rotulo: "Despesas" },
  { href: "/admin/production", rotulo: "Produção" },
  { href: "/admin/products", rotulo: "Produtos" },
] as const;

export function AdminNav() {
  return <MenuDoPainel caminho={usePathname()} />;
}

/**
 * O menu em si. Sem `caminho` nenhum item fica marcado: é o fallback do `<Suspense>` no layout,
 * porque em rota dinâmica (`/admin/production/[id]`) o caminho só existe na requisição.
 */
export function MenuDoPainel({ caminho }: { caminho?: string }) {
  return (
    <nav aria-label="Menu do painel">
      <ul className="flex flex-wrap gap-1 lg:flex-col">
        {LINKS.map((l) => {
          const ativo = caminho !== undefined && (caminho === l.href || caminho.startsWith(`${l.href}/`));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={ativo ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold transition-colors ${
                  ativo ? "bg-secundaria text-destaque" : "text-primaria hover:bg-accent1/40"
                }`}
              >
                {l.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
