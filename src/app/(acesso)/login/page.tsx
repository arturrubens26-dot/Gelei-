import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { CartaoCarregando, PainelDeAcesso } from "@/components/login/PainelDeAcesso";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { destinoSeguro } from "@/lib/auth/destino";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Tela de login fora do layout da loja: um painel só, com o formulário em "vidro fosco" à
 * esquerda e, à direita, o pote real de Maracujá que abre sozinho (no celular, vem depois do formulário).
 */
export default function PaginaLogin({ searchParams }: PageProps<"/login">) {
  return (
    <PainelDeAcesso>
      {/* searchParams e a sessão são dados da requisição: ficam atrás do Suspense. A reserva tem a
          altura do cartão, para a cena (abaixo, no celular) não pular quando o formulário chegar. */}
      <Suspense fallback={<CartaoCarregando />}>
        <FormularioDeLogin searchParams={searchParams} />
      </Suspense>
    </PainelDeAcesso>
  );
}

async function FormularioDeLogin({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const parametros = await searchParams;
  const destino = destinoSeguro(parametros.next);
  if (await getUsuarioAtual()) redirect(destino);
  // Vindo de /redefinir-senha: a senha nova já vale, e a pessoa entra com ela (não há login automático).
  const aviso = parametros.senha === "alterada" ? "Senha alterada. Entre com a nova senha." : undefined;
  return <AuthForm destino={destino} variante="vidro" aviso={aviso} />;
}
