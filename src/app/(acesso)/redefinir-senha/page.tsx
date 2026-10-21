import type { Metadata } from "next";
import { PainelDeAcesso } from "@/components/login/PainelDeAcesso";
import { FormRedefinirSenha } from "@/components/senha/FormRedefinirSenha";

export const metadata: Metadata = {
  title: "Criar senha nova",
  // Página de link pessoal: fora dos buscadores.
  robots: { index: false, follow: false },
};

/**
 * Destino do link de redefinição (`/redefinir-senha#t=<token>`), gerado pela dona no painel ou
 * mandado por e-mail. A página é estática: o token só existe no fragmento, lido no navegador.
 */
export default function PaginaRedefinirSenha() {
  return (
    <PainelDeAcesso>
      <FormRedefinirSenha />
    </PainelDeAcesso>
  );
}
