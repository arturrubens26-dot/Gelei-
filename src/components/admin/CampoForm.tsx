import type { ReactNode } from "react";

/**
 * Rótulo + campo + erro (ou dica) dos formulários do painel. O campo filho usa `aria-describedby`
 * com `${id}-erro` / `${id}-dica` para o leitor de tela ler a mensagem junto.
 */
export function CampoForm({ id, rotulo, erro, dica, children }: { id: string; rotulo: string; erro?: string; dica?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {rotulo}
      </label>
      {children}
      {erro ? (
        <p id={`${id}-erro`} className="mt-1 text-xs font-semibold text-secundaria">
          {erro}
        </p>
      ) : (
        dica && (
          <p id={`${id}-dica`} className="mt-1 text-xs text-primaria/75">
            {dica}
          </p>
        )
      )}
    </div>
  );
}
