import Link from "next/link";
import { BotaoSair } from "@/components/BotaoSair";
import { getUsuarioAtual } from "@/lib/auth/dal";

/**
 * Lê a sessão (dados da requisição), então precisa ficar dentro de <Suspense>:
 * o resto da página continua estático e só este pedaço "chega depois".
 */
export async function MenuUsuario() {
  const usuario = await getUsuarioAtual();

  if (!usuario) {
    return (
      <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-semibold text-secundaria underline-offset-2 hover:underline">
        Entrar
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden max-w-32 truncate sm:inline" title={usuario.email}>
        Olá, {usuario.nome.split(" ")[0]}
      </span>
      {/* No celular, "Pedidos" (mais curto) para o cabeçalho caber em 360 px. */}
      <Link href="/meus-pedidos" className="inline-flex min-h-11 items-center font-semibold text-secundaria underline-offset-2 hover:underline">
        <span className="sm:hidden">Pedidos</span>
        <span className="hidden sm:inline">Meus pedidos</span>
      </Link>
      {usuario.isAdmin && (
        <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center font-semibold text-secundaria underline-offset-2 hover:underline">
          Painel
        </Link>
      )}
      <BotaoSair />
    </div>
  );
}

/** Espaço reservado enquanto a sessão carrega (evita o cabeçalho "pular"). */
export function MenuUsuarioCarregando() {
  return <span className="inline-block h-5 w-14 animate-pulse rounded bg-accent1/50" aria-hidden="true" />;
}
