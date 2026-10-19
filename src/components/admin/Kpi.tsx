/** Cartão de número do painel (Financeiro, Despesas): rótulo, valor grande e uma dica. Vai dentro de um <ul>. */
export function Kpi({ rotulo, valor, dica }: { rotulo: string; valor: string; dica: string }) {
  return (
    <li className="cartao p-5">
      <p className="text-sm font-medium text-primaria/85">{rotulo}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{valor}</p>
      <p className="mt-1 text-xs text-primaria/80">{dica}</p>
    </li>
  );
}
