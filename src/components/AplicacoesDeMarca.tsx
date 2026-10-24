import { IconeMarca } from "@/components/marca/IconeMarca";
import { aplicacoesDeMarca } from "@/design-system";

/**
 * Os quatro compromissos da marca, como no painel de identidade: ícone em traço e legenda,
 * separados por pontilhado dourado.
 */
export function AplicacoesDeMarca() {
  return (
    <section aria-label="Nossos compromissos">
      <ul className="mx-auto grid max-w-4xl grid-cols-2 gap-y-8 sm:grid-cols-4 sm:gap-y-0">
        {aplicacoesDeMarca.map((item, i) => (
          <li
            key={item.titulo}
            className={`flex flex-col items-center gap-3 px-3 text-center ${
              i > 0 ? "sm:border-l sm:border-dotted sm:border-accent2" : ""
            }`}
          >
            <IconeMarca icone={item.icone} className="size-11" />
            <p className="max-w-[9rem] text-xs font-semibold leading-snug tracking-wide text-primaria">{item.titulo}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
