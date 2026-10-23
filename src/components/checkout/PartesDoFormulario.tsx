import type { ReactNode } from "react";

/**
 * Peças do formulário de compra usadas no checkout e na encomenda de lembrancinhas: a seção numerada
 * (os passos são uma sequência de verdade), a opção de entrega/retirada e o campo com rótulo e erro.
 */

/** Seção numerada do formulário. `id` opcional para links internos (ex.: "Ver resumo"). */
export function Secao({ numero, titulo, id, children }: { numero: number; titulo: string; id?: string; children: ReactNode }) {
  const idTitulo = `secao-${numero}`;
  return (
    <section id={id} aria-labelledby={idTitulo} className="cartao scroll-mt-4 p-5 shadow-sm sm:p-6">
      <h2 id={idTitulo} className="mb-4 flex items-center gap-3 text-2xl font-bold">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secundaria font-textos text-base font-bold text-destaque" aria-hidden="true">
          {numero}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Uma das duas opções (entrega ou retirada): o cartão inteiro é o rótulo do radio. */
export function OpcaoDeEntrega({
  nome,
  marcado,
  aoEscolher,
  titulo,
  preco,
  descricao,
}: {
  nome: string;
  marcado: boolean;
  aoEscolher: () => void;
  titulo: string;
  preco: string;
  descricao: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-accent2/70 p-3 has-checked:border-2 has-checked:border-secundaria has-checked:bg-accent1/20">
      <input type="radio" name={nome} className="mt-1 size-4 shrink-0 accent-secundaria" checked={marcado} onChange={aoEscolher} />
      <span className="min-w-0 text-sm leading-snug">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold">{titulo}</span>
          <span className="font-semibold tabular-nums">{preco}</span>
        </span>
        <span className="mt-0.5 block text-xs text-primaria/80">{descricao}</span>
      </span>
    </label>
  );
}

/** Campo de texto com rótulo e mensagem de erro ligada por `aria-describedby`. */
export function Campo({
  id,
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  className,
  maxLength,
  erro,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: string;
  className?: string;
  maxLength?: number;
  erro?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {rotulo}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
        className="campo"
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
      />
      {erro && (
        <p id={`${id}-erro`} className="mt-1 text-xs font-medium text-secundaria">
          {erro}
        </p>
      )}
    </div>
  );
}
