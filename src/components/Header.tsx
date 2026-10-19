import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { BotaoCarrinho } from "@/components/carrinho/BotaoCarrinho";
import { MenuUsuario, MenuUsuarioCarregando } from "@/components/MenuUsuario";
import { logos, marca } from "@/design-system";

/** Cabeçalho da loja: logo oficial (pote + framboesas + Geleiô), navegação, conta e carrinho. */
export function Header() {
  return (
    <header className="border-b border-accent2/50 bg-destaque">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Link href="/" className="shrink-0" aria-label={`${marca.nome} — ${marca.slogan}. Ir para a página inicial`}>
          <Image
            src={logos.cabecalho.src}
            alt=""
            width={logos.cabecalho.largura}
            height={logos.cabecalho.altura}
            priority
            sizes="140px"
            className="h-16 w-auto sm:h-20"
          />
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          <nav aria-label="Principal">
            <Link
              href="/products"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-primaria underline-offset-4 hover:text-secundaria hover:underline"
            >
              Nossas geleias
            </Link>
          </nav>
          <Suspense fallback={<MenuUsuarioCarregando />}>
            <MenuUsuario />
          </Suspense>
          <BotaoCarrinho />
        </div>
      </div>
    </header>
  );
}
