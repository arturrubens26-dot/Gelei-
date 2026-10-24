"use client";

import { useRef, useState } from "react";
import { useCarrinhoUI } from "@/components/carrinho/contexto";
import { FotoDoPote } from "@/components/FotoDoPote";
import { CORACAO, CaixaDoKit, type PoteNaVaga } from "@/components/kits/CaixaDoKit";
import { IconeMarca } from "@/components/marca/IconeMarca";
import { acoesCarrinho } from "@/lib/carrinho/store";
import { formatarBRL } from "@/lib/dinheiro";
import type { KitDTO } from "@/lib/kits";
import {
  PERMITIR_SABOR_REPETIDO,
  composicaoDasVagas,
  conferirComposicao,
  economiaDoKit,
  emCentavos,
  faixaDeEconomia,
} from "@/lib/kits-regras";
import type { ProdutoDTO } from "@/lib/produtos";
import { separarNome } from "@/lib/produtos-regras";

const brl = (centavos: number) => formatarBRL(centavos / 100);
const potes = (n: number) => `${n} ${n === 1 ? "pote" : "potes"}`;
const falta = (n: number) => (n === 1 ? "Falta 1 pote." : `Faltam ${n} potes.`);
/** Espaço não separável (U+00A0): não aparece, mas torna a frase "outra" para a região viva. */
const ESPACO_INVISIVEL = String.fromCharCode(0xa0);

/** Os dois compromissos impressos na faixa da caixa, também como texto legível (a caixa é ilustração). */
const SELOS = [
  { icone: "folha", titulo: "Ingredientes selecionados" },
  { icone: "ramo", titulo: "Sem conservantes" },
] as const;

/**
 * "Monte seu kit": a cliente enche a caixa escolhendo os sabores. [+] põe o sabor na primeira vaga
 * livre; [−] tira o último pote daquele sabor; o × da vaga tira aquele pote. Com a caixa completa,
 * "Adicionar kit ao carrinho" põe a caixa no carrinho, abre o carrinho e esvazia a caixa.
 *
 * Regras (composição, economia) vêm de `kits-regras`, as mesmas do servidor. Uma região de status
 * anuncia cada mudança ("Pimenta na vaga 2. Falta 1 pote."); os botões são nativos.
 */
export function MonteSeuKit({ kit, produtos }: { kit: KitDTO; produtos: ProdutoDTO[] }) {
  const { abrir } = useCarrinhoUI();
  const [vagasGuardadas, setVagas] = useState<(PoteNaVaga | null)[]>(() => Array.from({ length: kit.potes }, () => null));
  const [anuncio, setAnuncio] = useState("");
  // Aviso visível (caixa cheia, faltam sabores). Não é região viva: o anúncio acima já fala.
  const [aviso, setAviso] = useState<string | null>(null);
  const contador = useRef(0);
  const tituloLista = useRef<HTMLHeadingElement>(null);
  const secaoCaixa = useRef<HTMLElement>(null);

  const porId = new Map(produtos.map((p) => [p.id, p]));
  // Um sabor escolhido pode sair da loja com a página aberta (a dona o oculta e a rota volta com
  // dados novos, mas o estado das vagas fica): a vaga dele passa a contar como livre, e um aviso
  // diz o que saiu. A próxima ação na caixa já parte das vagas válidas.
  const vagas = vagasGuardadas.map((v) => (v && porId.has(v.productId) ? v : null));
  const saiuDaLoja = [...new Set(vagasGuardadas.filter((v) => v && !porId.has(v.productId)).map((v) => separarNome(v!.nome).sabor))];
  const precoCentavos = emCentavos(kit.preco);
  const composicao = composicaoDasVagas(vagas.map((v) => v?.productId ?? null));
  const conferida = conferirComposicao(composicao, kit.potes);
  const completa = conferida.ok;
  const escolhidos = vagas.filter(Boolean).length;
  const faltam = kit.potes - escolhidos;
  const cheia = faltam === 0;

  /** Economia da caixa montada (completa) ou a faixa possível (incompleta); `null` se não houver. */
  const economiaDe = (lista: (PoteNaVaga | null)[]) => {
    const sabores = composicaoDasVagas(lista.map((v) => v?.productId ?? null)).map((s) => ({
      quantidade: s.quantidade,
      precoAvulsoCentavos: emCentavos(porId.get(s.productId)?.preco ?? 0),
    }));
    return economiaDoKit(precoCentavos, sabores);
  };
  const faixa = faixaDeEconomia(precoCentavos, kit.potes, produtos.map((p) => emCentavos(p.preco)));
  const economiaAgora = completa ? economiaDe(vagas) : null;
  const textoEconomia =
    economiaAgora !== null
      ? economiaAgora > 0
        ? `Economize ${brl(economiaAgora)}`
        : null
      : faixa && faixa.maxima > 0
        ? faixa.minima === faixa.maxima
          ? `Economize ${brl(faixa.maxima)}`
          : `Economize até ${brl(faixa.maxima)}`
        : null;

  const pesos = produtos.map((p) => p.pesoGramas);
  const faixaDePeso =
    Math.min(...pesos) === Math.max(...pesos) ? `${pesos[0]} g` : `${Math.min(...pesos)} g a ${Math.max(...pesos)} g`;

  // Repetir a mesma frase não seria lida de novo pela região viva: alterna um espaço invisível no fim.
  function anunciar(texto: string, visivel = false) {
    setAnuncio((anterior) => (anterior === texto ? `${texto}${ESPACO_INVISIVEL}` : texto));
    setAviso(visivel ? texto : null);
  }

  /**
   * Leva o foco (e a tela, se a lista estiver longe) para a lista de sabores. No celular a caixa
   * fica presa no alto: a lista para logo abaixo dela, e não escondida atrás.
   */
  function irParaLista() {
    const titulo = tituloLista.current;
    if (!titulo) return;
    titulo.focus({ preventScroll: true });
    const caixaPresa = secaoCaixa.current && getComputedStyle(secaoCaixa.current).position === "sticky" ? secaoCaixa.current : null;
    const acima = caixaPresa ? caixaPresa.getBoundingClientRect().height : 0;
    const topo = titulo.getBoundingClientRect().top;
    if (topo < acima || topo > acima + (window.innerHeight - acima) * 0.5) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: topo - acima - 12, behavior: suave ? "smooth" : "auto" });
    }
  }

  function depois(lista: (PoteNaVaga | null)[], frase: string) {
    const restantes = lista.filter((v) => v === null).length;
    if (restantes > 0) return `${frase} ${falta(restantes)}`;
    const economia = economiaDe(lista);
    return `${frase} Caixa completa: ${brl(precoCentavos)}${economia > 0 ? `, você economiza ${brl(economia)}` : ""}.`;
  }

  function colocar(produto: ProdutoDTO) {
    const sabor = separarNome(produto.nome).sabor;
    const livre = vagas.indexOf(null);
    if (livre === -1) {
      anunciar("A caixa está cheia. Tire um pote para trocar.", true);
      return;
    }
    if (!PERMITIR_SABOR_REPETIDO && vagas.some((v) => v?.productId === produto.id)) {
      anunciar(`${sabor} já está na caixa.`, true);
      return;
    }
    contador.current += 1;
    const nova = vagas.map((v, i) =>
      i === livre ? { productId: produto.id, nome: produto.nome, imagemUrl: produto.imagemUrl, chave: contador.current } : v,
    );
    setVagas(nova);
    anunciar(depois(nova, `${sabor} na vaga ${livre + 1}.`));
  }

  function tirarDaVaga(indice: number) {
    const pote = vagas[indice];
    if (!pote) return;
    const nova = vagas.map((v, i) => (i === indice ? null : v));
    setVagas(nova);
    anunciar(depois(nova, `${separarNome(pote.nome).sabor} saiu da vaga ${indice + 1}.`));
  }

  /** [−]: tira o último pote daquele sabor (o mais à direita). */
  function tirarUltimo(produto: ProdutoDTO) {
    const indice = vagas.findLastIndex((v) => v?.productId === produto.id);
    if (indice !== -1) tirarDaVaga(indice);
    else anunciar(`Não há ${separarNome(produto.nome).sabor} na caixa.`);
  }

  function adicionar() {
    if (!conferida.ok) {
      anunciar(`Escolha mais ${faltam} ${faltam === 1 ? "sabor" : "sabores"}.`, true);
      irParaLista();
      return;
    }
    // As vagas já são só de sabores à venda; a conferência é defesa, para nunca quebrar em silêncio.
    const sabores = [];
    for (const s of conferida.composicao) {
      const p = porId.get(s.productId);
      if (!p) {
        anunciar("Um dos sabores saiu da loja. Escolha outro para completar a caixa.", true);
        return;
      }
      sabores.push({ productId: p.id, nome: p.nome, quantidade: s.quantidade, pesoGramas: p.pesoGramas, precoAvulso: p.preco, imagemUrl: p.imagemUrl });
    }
    const resultado = acoesCarrinho.adicionarKit({
      kitId: kit.id,
      nome: kit.nome,
      preco: kit.preco,
      pesoCaixaGramas: kit.pesoCaixaGramas,
      sabores,
    });
    if (!resultado.ok) {
      anunciar(resultado.mensagem, true);
      return;
    }
    setVagas(Array.from({ length: kit.potes }, () => null));
    anunciar(`${kit.nome} no carrinho.`);
    abrir();
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-x-6 md:gap-y-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-x-12">
      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>

      <header className="md:col-start-2 md:row-start-1">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secundaria">{kit.nome}</p>
        <h1 className="mt-1 font-titulos text-4xl font-semibold text-primaria sm:text-5xl">Monte seu kit</h1>
        <p className="mt-3 max-w-prose text-primaria/85">{kit.descricao}</p>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span>
            <strong className="font-semibold">{kit.potes} geleias</strong> por{" "}
            <strong className="text-xl font-bold tabular-nums">{brl(precoCentavos)}</strong>
          </span>
          {textoEconomia && (
            <span className="rounded-full border border-accent3 bg-accent3/15 px-3 py-0.5 text-sm font-semibold tabular-nums">
              {textoEconomia}
            </span>
          )}
        </p>
      </header>

      {/* No celular a caixa fica presa no alto enquanto a pessoa escolhe na lista (o pote entrando na
          vaga é o momento da tela; sem isso ele aconteceria fora da vista). Em tela baixa (< 640 px de
          altura, celular deitado) ela não prende: ocuparia a tela toda. No tablet e no computador, a
          caixa fica na coluna da esquerda, presa enquanto a lista rola. */}
      <section
        ref={secaoCaixa}
        aria-labelledby="titulo-caixa"
        className="sticky top-0 z-20 -mx-4 bg-destaque/95 px-4 pb-3 pt-2 shadow-[0_12px_16px_-16px_rgb(107_29_42/0.5)] backdrop-blur-sm sm:-mx-6 sm:px-6 [@media(max-height:639px)]:static md:static md:col-start-1 md:row-span-4 md:row-start-1 md:mx-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none"
      >
        <div className="mx-auto max-w-xl md:sticky md:top-6">
          <h2 id="titulo-caixa" className="sr-only">
            Sua caixa
          </h2>
          <CaixaDoKit vagas={vagas} completa={cheia} aoTirar={tirarDaVaga} aoEscolher={irParaLista} />
          <div className="mt-2.5 flex items-center justify-center gap-2.5 text-sm font-semibold md:mt-4">
            <span className="flex gap-1" aria-hidden="true">
              {vagas.map((v, i) => (
                <svg key={i} viewBox="0 0 24 22" className="size-4">
                  <path
                    d={CORACAO}
                    className={v ? "fill-secundaria stroke-secundaria" : "fill-none stroke-primaria/60"}
                    strokeWidth={2}
                  />
                </svg>
              ))}
            </span>
            <span>
              {escolhidos} de {potes(kit.potes)} {escolhidos === 1 ? "escolhido" : "escolhidos"}
            </span>
          </div>
          {/* A nota da ilustração fica sob a caixa no tablet/computador; no celular, no fim da lista
              (a caixa presa no alto precisa ser só a caixa). */}
          <p className="mt-2 hidden text-center text-xs text-primaria/75 md:block">
            Ilustração da caixa. Os potes são os sabores que você escolher ({faixaDePeso}).
          </p>
        </div>
      </section>

      <section aria-labelledby="titulo-sabores" className="@container md:col-start-2 md:row-start-2">
        <h2 id="titulo-sabores" ref={tituloLista} tabIndex={-1} className="text-2xl font-semibold outline-offset-4">
          Escolha {kit.potes} sabores{PERMITIR_SABOR_REPETIDO ? " (pode repetir)" : ""}
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {produtos.map((p) => {
            const { sabor, peso } = separarNome(p.nome);
            const naCaixa = vagas.filter((v) => v?.productId === p.id).length;
            return (
              // Estreito: nome em cima (largura toda) e, embaixo, o preço e o contador. Largo (≥ 26rem):
              // nome e preço à esquerda, contador à direita.
              <li
                key={p.id}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md border p-2.5 motion-safe:transition-colors ${
                  naCaixa > 0 ? "border-secundaria/70 bg-accent1/25" : "border-accent2/60 bg-white/70"
                }`}
              >
                <span className="row-span-2 size-14 self-center overflow-hidden rounded-sm bg-[#f3ece3] @[26rem]:size-16">
                  <FotoDoPote src={p.imagemUrl} alt="" lado={128} sizes="64px" className="size-full scale-[1.3] object-cover object-[50%_58%]" />
                </span>
                <p className="col-span-2 self-end font-titulos text-lg font-semibold leading-snug @[26rem]:col-span-1">{sabor}</p>
                <p className="col-start-2 row-start-2 self-start text-sm leading-snug text-primaria/80">
                  {peso ? `${peso.replace(/(\d)g$/, "$1 g")} · ` : ""}
                  <span className="whitespace-nowrap">{formatarBRL(p.preco)}</span> avulso
                </p>
                <div className="col-start-3 row-start-2 inline-flex items-center rounded-full border border-accent2 bg-white @[26rem]:row-span-2 @[26rem]:row-start-1">
                  {/* aria-disabled (não disabled): ao tirar o último pote, um botão desabilitado
                      perderia o foco para o <body> e quem usa teclado perderia o lugar. */}
                  <button
                    type="button"
                    className="inline-flex size-11 items-center justify-center rounded-full text-xl leading-none hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent"
                    aria-label={`Tirar um pote de ${sabor}`}
                    aria-disabled={naCaixa === 0 || undefined}
                    onClick={() => tirarUltimo(p)}
                  >
                    −
                  </button>
                  <span className="min-w-7 text-center text-base font-semibold tabular-nums">
                    {naCaixa}
                    <span className="sr-only"> na caixa</span>
                  </span>
                  <button
                    type="button"
                    className="inline-flex size-11 items-center justify-center rounded-full text-xl leading-none hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent"
                    aria-label={`Pôr ${sabor} na caixa`}
                    aria-disabled={cheia || undefined}
                    onClick={() => colocar(p)}
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-col gap-3 md:col-start-2 md:row-start-3">
        <ul aria-label="Na caixa e nos potes" className="grid grid-cols-2 text-center text-xs font-semibold leading-snug text-primaria">
          {SELOS.map((s, i) => (
            <li key={s.titulo} className={`flex flex-col items-center gap-1.5 px-2 ${i > 0 ? "border-l border-dotted border-accent2" : ""}`}>
              <IconeMarca icone={s.icone} className="size-8" />
              {s.titulo}
            </li>
          ))}
        </ul>
        <p className="text-center text-xs text-primaria/75 md:hidden">
          Ilustração da caixa. Os potes são os sabores que você escolher ({faixaDePeso}).
        </p>
      </div>

      {/* Barra de adicionar: presa ao pé da tela (sticky: some antes do rodapé, sem cobri-lo). No
          tablet/computador vira um cartão no fim da coluna da direita, preso ao pé se a lista for longa. */}
      <div className="@container sticky bottom-0 z-30 -mx-4 border-t-2 border-accent2/60 bg-destaque/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_24px_-18px_rgb(107_29_42/0.6)] backdrop-blur-sm sm:-mx-6 sm:px-6 md:bottom-4 md:col-start-2 md:row-start-4 md:mx-0 md:rounded-md md:border-2 md:p-4 md:shadow-[0_10px_24px_-18px_rgb(107_29_42/0.6)]">
        {saiuDaLoja.length > 0 && !aviso && (
          <p className="mb-2 text-sm font-semibold text-primaria">
            {saiuDaLoja.join(" e ")}{" "}
            {saiuDaLoja.length > 1 ? "saíram da loja e foram tirados da caixa." : "saiu da loja e foi tirado da caixa."} Escolha outro
            sabor.
          </p>
        )}
        {aviso && (
          <p className="mb-2 text-sm font-semibold text-primaria" id="aviso-kit">
            {aviso}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-26 flex-1">
            <p className="text-xl font-bold leading-tight tabular-nums">{brl(precoCentavos)}</p>
            <p className="text-xs text-primaria/85">
              {completa ? (economiaAgora ? `Você economiza ${brl(economiaAgora)}` : `${potes(kit.potes)} na caixa`) : `${escolhidos} de ${potes(kit.potes)}`}
            </p>
          </div>
          <button
            type="button"
            className="btn-primario shrink-0 grow px-4 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-secundaria @md:grow-0 sm:px-6"
            aria-disabled={!completa || undefined}
            aria-describedby={aviso ? "aviso-kit" : undefined}
            onClick={adicionar}
          >
            {/* Um só texto: o gap do .btn-primario separaria "kit" de "ao carrinho" com espaço dobrado. */}
            <span>
              Adicionar kit<span className="hidden min-[360px]:inline"> ao carrinho</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
