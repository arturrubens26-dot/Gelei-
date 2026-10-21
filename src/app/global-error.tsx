"use client";

import { useEffect } from "react";

// Esta tela substitui o layout raiz inteiro e pode aparecer sem o CSS do site: as cores da marca e o
// foco visível vão aqui mesmo. Carmesim com creme ≈ 5,9:1; vinho sobre creme ≈ 12:1.
const CSS = `
  .ge-corpo { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #FFF7EE; color: #6B1D2A;
    font-family: "Montserrat", system-ui, "Segoe UI", Arial, sans-serif; line-height: 1.6; padding: 24px 16px; box-sizing: border-box; }
  .ge-caixa { max-width: 34rem; text-align: center; }
  .ge-titulo { font-family: "Playfair Display", Georgia, "Times New Roman", serif; font-size: 2.25rem; line-height: 1.2; margin: 0 0 16px; }
  .ge-filete { width: 96px; height: 1px; background: #D4AF37; margin: 0 auto 20px; border: 0; }
  .ge-acoes { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 28px; }
  .ge-botao { min-height: 44px; padding: 10px 28px; border-radius: 999px; font: inherit; font-weight: 600; font-size: 0.95rem;
    cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; box-sizing: border-box; }
  .ge-principal { background: #A9374F; color: #FFF7EE; border: 1px solid transparent; }
  .ge-principal:hover { background: #6B1D2A; }
  .ge-secundario { background: transparent; color: #A9374F; border: 2px solid #A9374F; }
  .ge-secundario:hover { background: #A9374F; color: #FFF7EE; }
  .ge-botao:focus-visible { outline: 2px solid #A9374F; outline-offset: 2px; }
  .ge-codigo { margin-top: 28px; font-size: 0.875rem; opacity: 0.85; }
`;

/** Último recurso: o próprio layout raiz falhou. Sem o cabeçalho nem o rodapé da loja. */
export default function ErroGlobal({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <head>
        <title>Algo deu errado | Geleiô</title>
        <meta name="robots" content="noindex" />
        <style>{CSS}</style>
      </head>
      <body className="ge-corpo">
        <main className="ge-caixa">
          <h1 className="ge-titulo">Algo deu errado por aqui</h1>
          <hr className="ge-filete" />
          <p>Não conseguimos abrir a Geleiô agora. Costuma ser passageiro: tente de novo em instantes.</p>
          <p>Se continuar, fale com a gente no Instagram @ge.leio.</p>
          <div className="ge-acoes">
            <button type="button" className="ge-botao ge-principal" onClick={() => retry()}>
              Tentar de novo
            </button>
            {/* <a> e não <Link>: recarrega a página inteira, caso o problema esteja no roteador. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- de propósito, ver acima */}
            <a href="/" className="ge-botao ge-secundario">
              Voltar ao início
            </a>
          </div>
          {error.digest && <p className="ge-codigo">Código do erro: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
