import Image from "next/image";
import Link from "next/link";
import { logos, marca } from "@/design-system";

/** Abertura da página inicial: o logo composto como no rótulo, ao lado do pote de verdade. */
export function Abertura() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:py-16">
      <div className="flex flex-col items-center text-center">
        <h1>
          <Image
            src={logos.principal.src}
            alt={`${marca.nome} — ${marca.slogan}`}
            width={logos.principal.largura}
            height={logos.principal.altura}
            priority
            sizes="(min-width: 640px) 380px, 280px"
            className="h-auto w-70 sm:w-95"
          />
        </h1>
        <p className="assinatura mt-2 text-4xl text-primaria sm:text-5xl">{marca.fraseRodape}</p>
        <p className="mt-6 max-w-md text-base leading-relaxed text-primaria/85">
          Geleias feitas em pequenos lotes, com frutas selecionadas e sem conservantes.
        </p>
        <Link href="/products" className="btn-primario mt-8 px-8 py-3 text-base">
          Conhecer os sabores
        </Link>
      </div>

      <div className="cartao mx-auto w-full max-w-sm p-2.5">
        <Image
          src="/marca/pote-pimenta.jpg"
          alt="Pote de geleia de Pimenta Geleiô, com tampa dourada e lacre vinho"
          width={800}
          height={1067}
          priority
          sizes="(min-width: 1024px) 384px, 90vw"
          className="aspect-[4/5] w-full rounded-sm object-cover object-center"
        />
      </div>
    </section>
  );
}
