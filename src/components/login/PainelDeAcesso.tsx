import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedJamJar } from "@/components/AnimatedJamJar";
import { ManchasDeFundo } from "@/components/login/ManchasDeFundo";
import { logos, marca } from "@/design-system";

/**
 * Moldura das telas de acesso (/login, /esqueci-senha, /redefinir-senha), fora do layout da loja: um
 * painel só, com o formulário em "vidro fosco" à esquerda e, à direita, o pote real de Maracujá que abre
 * sozinho (no celular, vem depois do formulário). O formulário entra em `children`.
 */
export function PainelDeAcesso({ children }: { children: ReactNode }) {
  return (
    <main data-fundo="areia" className="grid flex-1 place-items-center bg-(--cor-areia) p-3 sm:p-6 lg:p-8">
      <div className="relative isolate grid w-full max-w-6xl grid-cols-1 gap-4 overflow-hidden rounded-[2rem] bg-[#fffaf6] p-3 shadow-[0_40px_90px_-45px_rgb(107_29_42/0.5)] [grid-template-areas:'topo'_'form'_'cena'] sm:p-5 lg:min-h-[min(820px,calc(100dvh-4rem))] lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:[grid-template-areas:'topo_cena'_'form_cena']">
        <ManchasDeFundo />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 [grid-area:topo] sm:px-4">
          <Link href="/" className="shrink-0" aria-label={`${marca.nome} — ${marca.slogan}. Ir para a página inicial`}>
            <Image
              src={logos.cabecalho.src}
              alt=""
              width={logos.cabecalho.largura}
              height={logos.cabecalho.altura}
              loading="eager"
              sizes="110px"
              className="h-14 w-auto sm:h-16"
            />
          </Link>
          <Link
            href="/products"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primaria/85 underline-offset-4 hover:text-secundaria hover:underline"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12.5 4.5 7 10l5.5 5.5" />
            </svg>
            Voltar à loja
          </Link>
        </div>

        <div className="flex items-center justify-center px-1 py-2 [grid-area:form] sm:px-4 lg:py-0">{children}</div>

        <div className="relative h-64 overflow-hidden rounded-[1.5rem] border border-accent2/50 bg-destaque [grid-area:cena] sm:h-80 lg:h-auto">
          <AnimatedJamJar />
          {/* pointer-events-none: a frase ocupa a largura toda e ficava por cima do botão de pausa. */}
          <p className="assinatura pointer-events-none absolute inset-x-0 bottom-4 hidden text-center text-3xl text-primaria lg:block">{marca.fraseRodape}</p>
        </div>
      </div>
    </main>
  );
}

/** O cartão de vidro fosco do formulário (o mesmo do AuthForm na variante "vidro"). */
export const CLASSE_CARTAO_DE_VIDRO =
  "w-full max-w-md rounded-[1.75rem] border border-white/70 bg-white/60 p-6 shadow-[0_24px_60px_-40px_rgb(107_29_42/0.35)] backdrop-blur-xl sm:p-9";

/** Reserva do Suspense com a altura aproximada do cartão (a cena, embaixo no celular, não pula). */
export function CartaoCarregando({ altura = "h-[35rem] sm:h-[37rem]" }: { altura?: string }) {
  return (
    <div className={`${altura} w-full max-w-md animate-pulse rounded-[1.75rem] bg-white/60`} role="status">
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
