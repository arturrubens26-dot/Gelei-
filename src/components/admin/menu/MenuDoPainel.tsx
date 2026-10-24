"use client";

import Image from "next/image";
import Link from "next/link";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { IconeDoPainel } from "@/components/admin/menu/IconesDoPainel";
import { GRUPOS_DO_MENU, type ItemAtivo } from "@/components/admin/menu/itens";
import { marca, simbolos } from "@/design-system";

/**
 * O menu do painel, só o desenho (sem estado próprio; o fallback do <Suspense> do layout usa o mesmo):
 * - telas largas (≥ 1024 px): barra lateral recolhida em trilho de ícones que se abre sobre o conteúdo
 *   (mouse ou teclado) ou fica fixada e empurra o conteúdo. "Fixado" vem do `<html data-painel-fixado>`
 *   (variante `fixado:` do globals.css); "aberto" vem do `data-aberto` do trilho (AdminNav) e vale para
 *   os filhos pela variante `expandido:`;
 * - celular e tablet: barra no alto com o botão "Menu", que abre a gaveta com os mesmos grupos.
 * Os estados e eventos chegam por props; sem eles (fallback) é o trilho recolhido, sem item marcado.
 */

export const ID_DO_MENU = "menu-do-painel";
export const ID_DA_GAVETA = "gaveta-do-painel";

type VarianteDaLista = "trilho" | "gaveta";

/** Os grupos e seus itens. No trilho os rótulos aparecem só com a barra aberta; na gaveta, sempre. */
function ListaDoMenu({
  ativo,
  variante,
  id,
  comDica = false,
  aoNavegar,
}: {
  ativo: ItemAtivo | null;
  variante: VarianteDaLista;
  id: string;
  /** Trilho recolhido: o nome do item vai no `title` (toque longo e leitores que o usam). */
  comDica?: boolean;
  aoNavegar?: () => void;
}) {
  const trilho = variante === "trilho";
  const aparece = trilho ? "opacity-0 transition-opacity duration-150 expandido:opacity-100" : "";
  return (
    <nav aria-label="Menu do painel" id={id}>
      <ul className="flex flex-col">
        {GRUPOS_DO_MENU.map((grupo, i) => (
          <li key={grupo.titulo} className={i > 0 ? "mt-1" : undefined}>
            {/* Mesma altura com a barra aberta ou recolhida: os ícones não "andam" ao abrir. */}
            <p
              id={`${id}-grupo-${i}`}
              className={`relative flex items-center text-xs font-bold text-secundaria ${trilho ? "h-6 px-3.5" : "h-9 px-4"}`}
            >
              <span className={`whitespace-nowrap ${aparece}`}>{grupo.titulo}</span>
              {/* Trilho recolhido: o título some e um traço fino separa os grupos. */}
              {trilho && i > 0 && (
                <span aria-hidden="true" className="absolute inset-x-3.5 top-1/2 h-px bg-accent2/70 transition-opacity duration-150 expandido:opacity-0" />
              )}
            </p>
            <ul aria-labelledby={`${id}-grupo-${i}`} className="flex flex-col gap-0.5">
              {grupo.itens.map((item) => {
                const marcado = ativo?.item.href === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={aoNavegar}
                      aria-current={marcado ? "page" : undefined}
                      title={comDica ? item.rotulo : undefined}
                      className={`flex items-center gap-3 rounded-lg text-sm font-semibold transition-colors ${
                        trilho ? "h-9 px-3.5" : "min-h-11 px-4"
                      } ${marcado ? "bg-secundaria text-destaque" : "text-primaria hover:bg-accent1/40"}`}
                    >
                      <IconeDoPainel nome={item.icone} className="size-5 shrink-0" />
                      <span className={`min-w-0 truncate whitespace-nowrap ${aparece}`}>{item.rotulo}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const linhaDoRodape =
  "flex h-9 w-full items-center gap-3 rounded-lg px-3.5 text-sm font-semibold text-primaria transition-colors hover:bg-accent1/40";

type Props = {
  ativo: ItemAtivo | null;
  /** Nome do usuário e "Sair" (vem do servidor). */
  rodape: ReactNode;
  /** Estado do trilho (desktop). Sem eles, recolhido. */
  fixado?: boolean;
  aberto?: boolean;
  /** Barra aberta por cima do conteúdo (sombra): aberta e não fixada. */
  sobrepoe?: boolean;
  aoFixar?: () => void;
  /** Eventos do mouse e do teclado no trilho. */
  eventosDoTrilho?: HTMLAttributes<HTMLDivElement>;
  /** Gaveta (celular e tablet). */
  gavetaAberta?: boolean;
  gavetaRef?: Ref<HTMLDialogElement>;
  botaoMenuRef?: Ref<HTMLButtonElement>;
  aoAbrirGaveta?: () => void;
  aoFecharGaveta?: () => void;
  /** O <dialog> fechou (botão, Esc, fundo ou navegação). */
  aoGavetaFechada?: () => void;
};

export function MenuDoPainel({
  ativo,
  rodape,
  fixado = false,
  aberto = false,
  sobrepoe = false,
  aoFixar,
  eventosDoTrilho,
  gavetaAberta = false,
  gavetaRef,
  botaoMenuRef,
  aoAbrirGaveta,
  aoFecharGaveta,
  aoGavetaFechada,
}: Props) {
  const expandido = fixado || aberto;
  const marca36 = <Image src={simbolos.framboesas.src} alt="" width={36} height={36} loading="eager" className="shrink-0" />;
  const nome = (
    <span className="flex flex-col leading-none">
      <span className="font-titulos text-2xl font-bold">{marca.nome}</span>
      <span className="mt-1 text-xs font-semibold uppercase tracking-[0.25em] text-secundaria">Painel</span>
    </span>
  );

  return (
    <>
      {/* Celular e tablet: barra no alto (fica visível ao rolar) com o botão do menu e onde a pessoa está. */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-accent2/60 bg-[#fffbf6]/95 px-3 py-2 backdrop-blur-sm print:hidden lg:hidden">
        <button
          ref={botaoMenuRef}
          type="button"
          onClick={aoAbrirGaveta}
          aria-expanded={gavetaAberta}
          aria-controls={ID_DA_GAVETA}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-accent2/80 bg-white px-3 text-sm font-semibold text-primaria transition-colors hover:bg-accent1/40"
        >
          <IconeDoPainel nome="menu" />
          Menu
        </button>
        <p className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-xs text-primaria/75">{ativo?.grupo.titulo ?? "Painel"}</span>
          <span className="block truncate font-titulos text-lg font-bold">{ativo?.item.rotulo ?? marca.nome}</span>
        </p>
        <Link href="/admin/dashboard" className="shrink-0" aria-label={`Painel ${marca.nome}: ir para o Dashboard`}>
          {marca36}
        </Link>
      </div>

      {/* Gaveta: <dialog> modal (o navegador prende o foco, esconde o resto e fecha com Esc). */}
      <dialog
        ref={gavetaRef}
        id={ID_DA_GAVETA}
        aria-label="Menu do painel"
        onClose={aoGavetaFechada}
        onClick={(e) => {
          // Clique no fundo escurecido: o alvo é o próprio <dialog>.
          if (e.target === e.currentTarget) aoFecharGaveta?.();
        }}
        className="gaveta-painel m-0 h-dvh max-h-dvh w-80 max-w-[88vw] bg-[#fffbf6] p-0 text-primaria shadow-xl backdrop:bg-primaria/50 print:hidden lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-accent2/60 px-4 py-3">
            <Link href="/admin/dashboard" onClick={aoFecharGaveta} className="flex items-center gap-3" aria-label={`Painel ${marca.nome}`}>
              {marca36}
              {nome}
            </Link>
            <button
              type="button"
              onClick={aoFecharGaveta}
              aria-label="Fechar o menu"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-primaria transition-colors hover:bg-accent1/40"
            >
              <IconeDoPainel nome="fechar" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-3">
            <ListaDoMenu ativo={ativo} variante="gaveta" id="menu-da-gaveta" aoNavegar={aoFecharGaveta} />
          </div>
          <div className="flex shrink-0 flex-col gap-1 border-t border-accent2/60 px-2 py-3">
            <Link href="/" className="flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm font-semibold text-primaria hover:bg-accent1/40">
              <IconeDoPainel nome="loja" className="size-5 shrink-0" />
              Ver a loja
            </Link>
            <div className="px-4">{rodape}</div>
          </div>
        </div>
      </dialog>

      {/* Telas largas: o espaço que a barra ocupa no layout (4,5 rem recolhida, 16 rem fixada); o trilho
          em si flutua dentro dele e, aberto sem estar fixado, passa por cima do conteúdo. */}
      <aside className="hidden shrink-0 print:hidden lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-18 lg:self-start lg:transition-[width] lg:duration-200 lg:fixado:w-64 motion-reduce:lg:transition-none">
        <div
          {...eventosDoTrilho}
          data-aberto={aberto ? "true" : "false"}
          data-sobrepoe={sobrepoe ? "true" : "false"}
          className="painel-menu absolute inset-y-0 left-0 z-40 flex w-18 flex-col overflow-hidden border-r border-accent2/60 bg-[#fffbf6] transition-[width,box-shadow] duration-200 fixado:w-64 aberto:w-64 data-[sobrepoe=true]:shadow-[8px_0_24px_-12px_rgb(107_29_42/0.45)] motion-reduce:transition-none"
        >
          <Link href="/admin/dashboard" className="flex h-14 shrink-0 items-center gap-3 px-3 outline-offset-[-2px]" aria-label={`Painel ${marca.nome}: ir para o Dashboard`}>
            <span className="flex size-12 shrink-0 items-center justify-center">{marca36}</span>
            <span className="opacity-0 transition-opacity duration-150 expandido:opacity-100">{nome}</span>
          </Link>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-2 [scrollbar-width:thin]">
            <ListaDoMenu ativo={ativo} variante="trilho" id={ID_DO_MENU} comDica={!expandido} />
          </div>

          <div className="flex shrink-0 flex-col gap-0.5 border-t border-accent2/60 p-2.5">
            <button
              type="button"
              onClick={aoFixar}
              aria-pressed={fixado}
              aria-expanded={expandido}
              aria-controls={ID_DO_MENU}
              className={`${linhaDoRodape} fixado:bg-accent1/40`}
            >
              {/* Alfinete cheio quando fixado (pelo atributo do <html>, igual à largura da barra). */}
              <IconeDoPainel nome="pino" className="size-5 shrink-0 fixado:fill-current" />
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 expandido:opacity-100">Fixar menu</span>
            </button>
            <Link href="/" className={linhaDoRodape} title={expandido ? undefined : "Ver a loja"}>
              <IconeDoPainel nome="loja" className="size-5 shrink-0" />
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 expandido:opacity-100">Ver a loja</span>
            </Link>
            {/* Nome e "Sair" só com a barra aberta (recolhida, nem recebem o foco do teclado). */}
            <div inert={!expandido} className="h-0 overflow-hidden px-3.5 opacity-0 transition-opacity duration-150 expandido:h-9 expandido:opacity-100">
              {rodape}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
