import Link from "next/link";
import { FotoDoPote } from "@/components/FotoDoPote";
import { formatarBRL } from "@/lib/dinheiro";
import type { LembrancinhasDTO } from "@/lib/lembrancinhas";

/**
 * Chamada da home para as lembrancinhas (só com as encomendas abertas): o que é, quanto custa, os
 * sabores em mini e o caminho para encomendar.
 */
export function ChamadaLembrancinhas({ config }: { config: LembrancinhasDTO }) {
  const fotos = config.sabores.slice(0, 4);
  return (
    <section aria-labelledby="titulo-chamada-lembrancinhas" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-6 rounded-2xl border-2 border-accent2/70 bg-white/70 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 id="titulo-chamada-lembrancinhas" className="font-titulos text-3xl font-semibold text-primaria sm:text-4xl">
            Lembrancinhas para a sua festa
          </h2>
          <p className="mt-3 text-primaria/85">
            Potinhos de geleia de 40 ml para os convidados levarem para casa: de {config.minPotinhos} a {config.maxPotinhos} potinhos, nos
            sabores que você escolher, a {formatarBRL(config.precoPotinho)} cada. Encomende com pelo menos 5 dias de antecedência.
          </p>
          <Link href="/lembrancinhas" className="btn-primario mt-5">
            Encomendar lembrancinhas
          </Link>
        </div>
        {fotos.length > 0 && (
          <ul aria-label="Sabores em mini" className="flex flex-wrap gap-3">
            {fotos.map((s) => (
              <li key={s.productId} className="flex w-18 flex-col items-center gap-1 text-center text-xs font-semibold">
                <span className="size-16 overflow-hidden rounded-full border-2 border-accent2/70 bg-[#f3ece3]">
                  <FotoDoPote src={s.imagemUrl} alt="" lado={128} sizes="64px" className="size-full scale-[1.3] object-cover object-[50%_58%]" />
                </span>
                {s.sabor}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
