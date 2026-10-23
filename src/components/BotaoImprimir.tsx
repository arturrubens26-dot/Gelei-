"use client";

/** Abre a impressão do navegador (que também salva em PDF): o comprovante da página. */
export function BotaoImprimir({ rotulo = "Imprimir ou salvar em PDF", className = "btn-secundario" }: { rotulo?: string; className?: string }) {
  return (
    <button type="button" className={`${className} print:hidden`} onClick={() => window.print()}>
      {rotulo}
    </button>
  );
}
