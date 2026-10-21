import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sessaoValida } from "./redefinicao-regras";
import { lerSessao } from "./sessao";

export type UsuarioAtual = {
  id: string;
  nome: string;
  email: string;
  isAdmin: boolean;
};

/**
 * Camada de acesso (DAL): único lugar que transforma cookie em usuário.
 * Sem cache entre requisições de propósito — a checagem de admin precisa
 * refletir o banco agora. `cache()` do React só evita repetir a consulta
 * dentro da mesma renderização.
 */
export const getUsuarioAtual = cache(async (): Promise<UsuarioAtual | null> => {
  const sessao = await lerSessao();
  if (!sessao) return null;
  const usuario = await db.user.findUnique({
    where: { id: sessao.userId },
    select: { id: true, nome: true, email: true, isAdmin: true, sessaoVersao: true },
  });
  // Senha trocada depois que este cookie foi emitido: a sessão não vale mais (sem consulta a mais).
  if (!usuario || !sessaoValida(sessao.versao, usuario.sessaoVersao)) return null;
  return { id: usuario.id, nome: usuario.nome, email: usuario.email, isAdmin: usuario.isAdmin };
});

/** Para páginas: manda para o login se não houver usuário. */
export async function exigirUsuario(destinoAposLogin: string): Promise<UsuarioAtual> {
  const usuario = await getUsuarioAtual();
  if (!usuario) redirect(`/login?next=${encodeURIComponent(destinoAposLogin)}`);
  return usuario;
}

/** Para páginas do painel: quem não é admin volta para a loja. */
export async function exigirAdminPagina(destinoAposLogin: string): Promise<UsuarioAtual> {
  const usuario = await exigirUsuario(destinoAposLogin);
  if (!usuario.isAdmin) redirect("/");
  return usuario;
}
