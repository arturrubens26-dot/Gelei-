import Link from "next/link";

const ABAS = [
  { href: "/meus-pedidos", rotulo: "Pedidos" },
  { href: "/minhas-encomendas", rotulo: "Lembrancinhas" },
] as const;

/** Troca entre "Meus pedidos" e "Minhas encomendas" (as compras da conta, em duas listas). */
export function AbasDaConta({ atual }: { atual: (typeof ABAS)[number]["href"] }) {
  return (
    <nav aria-label="Suas compras" className="mb-6 flex justify-center print:hidden">
      <ul className="inline-flex rounded-full border border-accent2 bg-white/70 p-1">
        {ABAS.map((a) => {
          const ativa = a.href === atual;
          return (
            <li key={a.href}>
              <Link
                href={a.href}
                aria-current={ativa ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold ${
                  ativa ? "bg-secundaria text-destaque" : "text-primaria hover:bg-accent1/40"
                }`}
              >
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
