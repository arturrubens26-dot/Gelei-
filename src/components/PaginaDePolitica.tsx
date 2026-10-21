import type { ReactNode } from "react";
import { Ornamento } from "@/components/marca/Ornamento";
import { dadosLoja } from "@/lib/dados-loja";

/**
 * Página de política da loja (entrega e trocas, privacidade): título com o filete, a data da última
 * revisão e o texto num cartão de papel, como o rótulo. Fecha sempre com o contato da loja.
 * O conteúdo usa h2, p, ul e a (estilos em `.texto-corrido`, no globals.css).
 */
export function PaginaDePolitica({ titulo, atualizadaEm, children }: { titulo: string; atualizadaEm: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8 text-center">
        <h1 className="font-titulos text-4xl font-semibold text-balance text-primaria sm:text-5xl">{titulo}</h1>
        <Ornamento className="mt-4" />
        <p className="mt-4 text-sm text-primaria/80">Atualizada em {atualizadaEm}</p>
      </header>
      <article className="cartao texto-corrido p-6 sm:p-10">
        {children}
        <h2>Fale com a gente</h2>
        <p>
          Dúvidas, pedidos ou reclamações: chame a Geleiô no Instagram{" "}
          <a href={dadosLoja.instagram.url} target="_blank" rel="noopener noreferrer">
            @{dadosLoja.instagram.usuario}
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
          . A loja fica na {dadosLoja.endereco.logradouro}, {dadosLoja.endereco.bairro}, {dadosLoja.endereco.cidade}-
          {dadosLoja.endereco.uf}, CEP {dadosLoja.endereco.cep}.
        </p>
      </article>
    </main>
  );
}
