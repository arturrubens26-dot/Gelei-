import Link from "next/link";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { temEncomendas } from "@/lib/encomendas";
import { obterLembrancinhas } from "@/lib/lembrancinhas";

const ABAS = [
  { href: "/meus-pedidos", rotulo: "Pedidos" },
  { href: "/minhas-encomendas", rotulo: "Lembrancinhas" },
] as const;

type Aba = (typeof ABAS)[number]["href"];

/** Troca entre "Meus pedidos" e "Minhas encomendas" (as compras da conta, em duas listas). */
export function AbasDaConta({ atual }: { atual: Aba }) {
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

/**
 * As abas só quando fazem sentido: com as lembrancinhas abertas, ou para quem já encomendou (mesmo
 * com o recurso fechado, a cliente precisa achar a encomenda dela). Lê a sessão: fica em <Suspense>.
 */
export async function AbasSeHouverEncomendas({ atual }: { atual: Aba }) {
  const { ativo } = await obterLembrancinhas();
  if (!ativo) {
    const usuario = await getUsuarioAtual();
    if (!usuario || !(await temEncomendas(usuario.id))) return null;
  }
  return <AbasDaConta atual={atual} />;
}
