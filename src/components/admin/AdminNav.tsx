"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { aplicarFixado, lerFixado, useMenuFixado } from "@/components/admin/menu/estadoMenu";
import { itemAtivo } from "@/components/admin/menu/itens";
import { MenuDoPainel } from "@/components/admin/menu/MenuDoPainel";

/** Quanto a barra espera, depois que o mouse sai, para fechar (não fecha sem querer ao passar do lado). */
const ATRASO_PARA_FECHAR_MS = 200;
const DESKTOP = "(min-width: 1024px)";

/**
 * Menu do painel com os estados: aberto por mouse (com atraso na saída) ou por teclado (foco), fixado
 * (escolha guardada no navegador) e a gaveta do celular e tablet. Lê o caminho e a consulta da página,
 * então precisa ficar dentro de <Suspense>: em rota dinâmica (`/admin/production/[id]`) eles só
 * existem na requisição, e o layout mostra `MenuDoPainel` sem item marcado até lá.
 */
export function AdminNav({ rodape }: { rodape: ReactNode }) {
  const caminho = usePathname();
  const parametros = useSearchParams();
  const ativo = itemAtivo(caminho, parametros);
  const chaveDaPagina = `${caminho}?${parametros.toString()}`;

  const [fixado, alternarFixado] = useMenuFixado();
  const [mouse, setMouse] = useState(false);
  const [teclado, setTeclado] = useState(false);
  // Esc fecha a barra aberta por cima; fica fechada até o mouse sair ou o foco ir para outro item.
  const [fechadaPorEsc, setFechadaPorEsc] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aberto = (mouse || teclado) && !fechadaPorEsc;

  // O valor certo no <html> já na abertura da tela (o script do <head> só roda no carregamento).
  useLayoutEffect(() => aplicarFixado(lerFixado()), []);
  useEffect(() => () => void (temporizador.current && clearTimeout(temporizador.current)), []);

  const eventosDoTrilho = {
    onPointerEnter(e: PointerEvent<HTMLDivElement>) {
      // Toque não tem "passar o mouse": em tablet o toque no alfinete é o caminho.
      if (e.pointerType === "touch") return;
      if (temporizador.current) clearTimeout(temporizador.current);
      setMouse(true);
      setFechadaPorEsc(false);
    },
    onPointerLeave(e: PointerEvent<HTMLDivElement>) {
      if (e.pointerType === "touch") return;
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => {
        setMouse(false);
        setFechadaPorEsc(false);
      }, ATRASO_PARA_FECHAR_MS);
    },
    onFocus(e: FocusEvent<HTMLDivElement>) {
      // Só o foco de teclado abre: depois de um clique o link fica focado, e a barra não pode ficar presa aberta.
      if (e.target.matches(":focus-visible")) {
        setTeclado(true);
        setFechadaPorEsc(false);
      }
    },
    onBlur(e: FocusEvent<HTMLDivElement>) {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setTeclado(false);
        setFechadaPorEsc(false);
      }
    },
  };

  // Esc fecha a barra aberta por cima (com o mouse parado em cima ou com o foco dentro dela).
  const sobrepoe = aberto && !fixado;
  useEffect(() => {
    if (!sobrepoe) return;
    const aoTeclar = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setFechadaPorEsc(true);
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [sobrepoe]);

  // --- gaveta (celular e tablet) ---
  const gavetaRef = useRef<HTMLDialogElement>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const [gavetaAberta, setGavetaAberta] = useState(false);

  const abrirGaveta = useCallback(() => {
    const gaveta = gavetaRef.current;
    if (!gaveta || gaveta.open) return;
    gaveta.showModal();
    setGavetaAberta(true);
    // O item da página fica à vista, com o título do grupo (a lista toda cabe só rolando).
    gaveta.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "center" });
  }, []);
  // close() dispara o evento "close" do <dialog>, que atualiza gavetaAberta (também no Esc e no clique no fundo).
  const fecharGaveta = useCallback(() => gavetaRef.current?.close(), []);

  // Navegou (inclusive para outra parte da mesma página): a gaveta fecha.
  useEffect(() => {
    gavetaRef.current?.close();
  }, [chaveDaPagina]);

  // Girou o tablet ou aumentou a janela: a gaveta não existe em tela larga.
  useEffect(() => {
    const consulta = window.matchMedia(DESKTOP);
    const fechar = () => consulta.matches && fecharGaveta();
    consulta.addEventListener("change", fechar);
    return () => consulta.removeEventListener("change", fechar);
  }, [fecharGaveta]);

  return (
    <MenuDoPainel
      ativo={ativo}
      rodape={rodape}
      fixado={fixado}
      aberto={aberto}
      sobrepoe={sobrepoe}
      aoFixar={alternarFixado}
      eventosDoTrilho={eventosDoTrilho}
      gavetaAberta={gavetaAberta}
      gavetaRef={gavetaRef}
      aoAbrirGaveta={abrirGaveta}
      aoFecharGaveta={fecharGaveta}
      botaoMenuRef={botaoMenuRef}
      aoGavetaFechada={() => {
        setGavetaAberta(false);
        // O foco volta ao botão que abriu a gaveta (o Safari não foca botão no clique, e o navegador não saberia onde voltar).
        botaoMenuRef.current?.focus();
      }}
    />
  );
}
