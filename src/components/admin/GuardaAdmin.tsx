import type { ReactNode } from "react";
import { exigirAdminPagina } from "@/lib/auth/dal";

/**
 * Barreira de acesso das páginas do painel: só renderiza os filhos se o
 * usuário for admin (conferido no banco). Sem login vai para /login; logado
 * sem ser admin volta para a loja. Precisa ficar dentro de <Suspense>.
 *
 * Os dados do painel só chegam ao navegador pelas rotas /api/admin/*, que
 * validam o admin de novo a cada chamada: esta barreira protege a página, e as
 * rotas protegem os dados.
 */
export async function GuardaAdmin({ destino, children }: { destino: string; children: ReactNode }) {
  await exigirAdminPagina(destino);
  return <>{children}</>;
}

export function CarregandoAdmin() {
  return (
    <div className="h-64 animate-pulse rounded-2xl bg-accent1/30" role="status">
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
