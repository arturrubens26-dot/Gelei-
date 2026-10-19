import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AnimatedJamJar } from "@/components/AnimatedJamJar";
import { AuthForm } from "@/components/AuthForm";
import { ManchasDeFundo } from "@/components/login/ManchasDeFundo";
import { logos, marca } from "@/design-system";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { destinoSeguro } from "@/lib/auth/destino";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Tela de login fora do layout da loja: um painel só, com o formulário em "vidro fosco" à
 * esquerda e, à direita, o pote real de Maracujá que abre sozinho (no celular, vem depois do formulário).
 */
export default function PaginaLogin({ searchParams }: PageProps<"/login">) {
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

        <div className="flex items-center justify-center px-1 py-2 [grid-area:form] sm:px-4 lg:py-0">
          {/* searchParams e a sessão são dados da requisição: ficam atrás do Suspense. A reserva tem a
              altura do cartão, para a cena (abaixo, no celular) não pular quando o formulário chegar. */}
          <Suspense
            fallback={
              <div className="h-[35rem] w-full max-w-md animate-pulse rounded-[1.75rem] bg-white/60 sm:h-[37rem]" role="status">
                <span className="sr-only">Carregando…</span>
              </div>
            }
          >
            <FormularioDeLogin searchParams={searchParams} />
          </Suspense>
        </div>

        <div className="relative h-64 overflow-hidden rounded-[1.5rem] border border-accent2/50 bg-destaque [grid-area:cena] sm:h-80 lg:h-auto">
          <AnimatedJamJar />
          <p className="assinatura absolute inset-x-0 bottom-4 hidden text-center text-3xl text-primaria lg:block">{marca.fraseRodape}</p>
        </div>
      </div>
    </main>
  );
}

async function FormularioDeLogin({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const destino = destinoSeguro((await searchParams).next);
  if (await getUsuarioAtual()) redirect(destino);
  return <AuthForm destino={destino} variante="vidro" />;
}
