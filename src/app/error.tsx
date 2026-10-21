"use client";

import { Footer } from "@/components/Footer";
import { TelaDeErro } from "@/components/TelaDeErro";
import { TopoSimples } from "@/components/TelaDeAviso";

/**
 * Erro fora das páginas da loja (no próprio layout da loja, no /login): este limite fica no layout
 * raiz, que não tem cabeçalho, então traz um mínimo (o logo) e o rodapé com o contato.
 */
export default function Erro(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <TopoSimples />
      <main className="flex flex-1 flex-col">
        <TelaDeErro {...props} />
      </main>
      <Footer />
    </>
  );
}
