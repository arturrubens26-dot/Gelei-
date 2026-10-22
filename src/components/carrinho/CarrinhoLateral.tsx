"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FotoDoPote } from "@/components/FotoDoPote";
import { MiniaturaKit } from "@/components/kits/MiniaturaKit";
import { calcularEntrega, mascararCep } from "@/lib/carrinho/entrega";
import { acoesCarrinho, economiaDaCaixa, totaisDoCarrinho, useCarrinho, type KitCarrinho } from "@/lib/carrinho/store";
import { formatarBRL } from "@/lib/dinheiro";
import { emCentavos, textoDaComposicao } from "@/lib/kits-regras";
import { MAX_KITS_POR_PEDIDO, MAX_POR_PRODUTO } from "@/lib/limites";
import { useCarrinhoUI } from "./contexto";

/** A cotação guardada já foi recalculada nesta carga de página? */
let cotacaoConferida = false;

/**
 * Carrinho lateral. Usa <dialog> nativo (showModal): o navegador cuida do foco
 * preso, da tecla Esc e do fundo escurecido.
 */
export function CarrinhoLateral() {
  const { aberto, fechar } = useCarrinhoUI();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const estado = useCarrinho();
  const totais = totaisDoCarrinho(estado);
  const [calculando, setCalculando] = useState(false);
  const [erroCep, setErroCep] = useState<string | null>(null);
  // Uma única região "viva" para anunciar mudanças (quantidade, remoção); antes cada contador
  // tinha a sua e o leitor de tela dizia só "2", sem contexto.
  const [anuncio, setAnuncio] = useState("");

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (aberto && !el.open) el.showModal();
    if (!aberto && el.open) el.close();
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  async function calcular() {
    if (estado.cep.length !== 8) {
      setErroCep("Informe um CEP com 8 dígitos.");
      return;
    }
    setErroCep(null);
    setCalculando(true);
    const resultado = await calcularEntrega(estado.cep, totais.pesoTotalGramas);
    setCalculando(false);
    if (resultado.ok) {
      acoesCarrinho.definirCotacao(resultado.cotacao);
    } else {
      acoesCarrinho.definirCotacao(null);
      setErroCep(resultado.mensagem);
    }
  }

  // A cotação guardada no navegador pode ser velha (o frete fictício de antes do deploy, ou a taxa
  // que a dona mudou no painel): na primeira abertura desta carga de página, calcula de novo.
  const cotacaoGuardada = totais.cotacaoValida;
  useEffect(() => {
    if (!aberto || !cotacaoGuardada || cotacaoConferida) return;
    cotacaoConferida = true;
    calcularEntrega(cotacaoGuardada.cep, cotacaoGuardada.pesoTotalGramas).then((r) =>
      // Não deu para conferir: some a cotação (a cliente calcula de novo) em vez de ficar o valor velho.
      acoesCarrinho.definirCotacao(r.ok ? r.cotacao : null),
    );
  }, [aberto, cotacaoGuardada]);

  function mudarQuantidade(productId: string, nome: string, quantidade: number) {
    acoesCarrinho.definirQuantidade(productId, quantidade);
    setAnuncio(quantidade < 1 ? `${nome} removido do carrinho.` : `${nome}: quantidade ${quantidade}.`);
    // Se o item sumiu, o botão focado deixa de existir: leva o foco para o título do carrinho.
    if (quantidade < 1) titulo.current?.focus();
  }

  function remover(productId: string, nome: string) {
    acoesCarrinho.remover(productId);
    setAnuncio(`${nome} removido do carrinho.`);
    titulo.current?.focus();
  }

  function mudarCaixas(kit: KitCarrinho, quantidade: number) {
    acoesCarrinho.definirQuantidadeKit(kit.chave, quantidade);
    const nome = `${kit.nome} (${textoDaComposicao(kit.sabores)})`;
    setAnuncio(quantidade < 1 ? `${nome} removido do carrinho.` : `${nome}: ${quantidade} ${quantidade === 1 ? "caixa" : "caixas"}.`);
    if (quantidade < 1) titulo.current?.focus();
  }

  function removerKit(kit: KitCarrinho) {
    acoesCarrinho.removerKit(kit.chave);
    setAnuncio(`${kit.nome} (${textoDaComposicao(kit.sabores)}) removido do carrinho.`);
    titulo.current?.focus();
  }

  const vazio = totais.vazio;

  return (
    <dialog
      ref={dialogo}
      onClose={fechar}
      onClick={(e) => {
        // Clique no fundo escurecido (o alvo é o próprio <dialog>) fecha.
        if (e.target === dialogo.current) fechar();
      }}
      aria-labelledby="titulo-carrinho"
      className="my-0 ml-auto mr-0 hidden h-dvh max-h-dvh w-full max-w-md border-l-4 border-accent2 bg-destaque p-0 text-primaria backdrop:bg-primaria/50 open:flex open:flex-col"
    >
      <div className="flex items-center justify-between border-b border-accent2/60 px-5 py-4">
        <h2 id="titulo-carrinho" ref={titulo} tabIndex={-1} className="text-2xl font-bold outline-offset-4">
          Seu carrinho
        </h2>
        <button
          type="button"
          onClick={fechar}
          className="inline-flex size-11 items-center justify-center rounded-full text-2xl leading-none hover:bg-accent1/40"
          aria-label="Fechar carrinho"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {vazio ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="font-titulos text-xl">Seu carrinho está vazio.</p>
            <Link href="/products" onClick={fechar} className="btn-secundario">
              Ver produtos
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {estado.kits.map((kit) => (
              <LinhaDoKit
                key={kit.chave}
                kit={kit}
                podeAumentar={totais.caixas < MAX_KITS_POR_PEDIDO}
                aoMudar={(q) => mudarCaixas(kit, q)}
                aoRemover={() => removerKit(kit)}
              />
            ))}
            {estado.itens.map((item) => (
              <li key={item.productId} className="flex gap-3 border-b border-accent1/60 pb-4">
                <FotoDoPote
                  src={item.imagemUrl}
                  alt=""
                  lado={72}
                  className="size-18 shrink-0 rounded-lg border border-accent2/60 object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="font-titulos text-base font-semibold leading-snug">{item.nome}</p>
                  <p className="text-sm text-primaria/80">{formatarBRL(item.preco)} cada</p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center rounded-full border border-accent2">
                      <button
                        type="button"
                        className="inline-flex size-11 items-center justify-center rounded-full text-lg hover:bg-accent1/40"
                        aria-label={`Diminuir quantidade de ${item.nome}`}
                        onClick={() => mudarQuantidade(item.productId, item.nome, item.quantidade - 1)}
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center text-sm font-semibold">{item.quantidade}</span>
                      {/* aria-disabled (não disabled): no limite, o botão desabilitado jogaria o foco no <body>. */}
                      <button
                        type="button"
                        className="inline-flex size-11 items-center justify-center rounded-full text-lg hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                        aria-label={`Aumentar quantidade de ${item.nome}`}
                        aria-disabled={item.quantidade >= MAX_POR_PRODUTO || undefined}
                        onClick={() => {
                          if (item.quantidade < MAX_POR_PRODUTO) mudarQuantidade(item.productId, item.nome, item.quantidade + 1);
                        }}
                      >
                        +
                      </button>
                    </div>
                    <p className="font-semibold">{formatarBRL(item.preco * item.quantidade)}</p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center self-start text-sm font-medium text-secundaria underline underline-offset-2"
                    onClick={() => remover(item.productId, item.nome)}
                  >
                    Remover <span className="sr-only">{item.nome}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!vazio && (
          <section className="mt-6" aria-labelledby="titulo-entrega">
            <h3 id="titulo-entrega" className="text-lg font-semibold">
              Entrega
            </h3>
            <p className="mt-1 text-xs text-primaria/80">Entregamos em Teresina. No checkout, você também pode retirar na loja, sem custo.</p>
            <form
              className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                void calcular();
              }}
            >
              <div className="flex-1">
                <label htmlFor="cep-carrinho" className="mb-1 block text-sm font-semibold">
                  CEP de entrega
                </label>
                <input
                  id="cep-carrinho"
                  name="cep"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="00000-000"
                  value={mascararCep(estado.cep)}
                  onChange={(e) => {
                    setErroCep(null);
                    acoesCarrinho.definirCep(e.target.value);
                  }}
                  className="campo"
                  aria-invalid={erroCep ? true : undefined}
                  aria-describedby="status-entrega"
                />
              </div>
              <button type="submit" className="btn-secundario shrink-0" disabled={calculando}>
                {calculando ? "Calculando…" : "Calcular Entrega"}
              </button>
            </form>
            <p id="status-entrega" className="mt-2 min-h-5 text-sm" role="status" aria-live="polite">
              {erroCep ? (
                <span className="font-medium text-secundaria">{erroCep}</span>
              ) : calculando ? null : totais.cotacaoValida ? (
                <span>
                  Entrega para {totais.cotacaoValida.endereco?.cidade ?? totais.cotacaoValida.regiao}
                  {totais.cotacaoValida.endereco?.estado ? `/${totais.cotacaoValida.endereco.estado}` : ""}:{" "}
                  <strong>{formatarBRL(totais.cotacaoValida.valor)}</strong>
                </span>
              ) : totais.cotacaoVelha ? (
                <span>O carrinho mudou. Calcule a entrega de novo.</span>
              ) : null}
            </p>
          </section>
        )}
      </div>

      {!vazio && (
        <div className="border-t-2 border-accent2/60 bg-white/50 px-5 py-4">
          {totais.economiaKitsCentavos > 0 && (
            <p className="mb-2 text-xs text-primaria/85">
              Com {totais.caixas === 1 ? "o kit" : "os kits"}, você economiza{" "}
              <strong className="font-semibold">{formatarBRL(totais.economiaKitsCentavos / 100)}</strong> em relação aos potes avulsos.
            </p>
          )}
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatarBRL(totais.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Entrega</dt>
              <dd>{calculando ? "calculando…" : totais.entrega === null ? "calcule pelo CEP" : formatarBRL(totais.entrega)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-accent1 pt-2 text-lg font-bold">
              <dt>{totais.total === null || calculando ? "Total (sem entrega)" : "Total"}</dt>
              <dd>{formatarBRL(calculando ? totais.subtotal : (totais.total ?? totais.subtotal))}</dd>
            </div>
          </dl>
          <Link href="/checkout" onClick={fechar} className="btn-primario mt-4 w-full">
            Finalizar compra
          </Link>
        </div>
      )}
    </dialog>
  );
}

/**
 * Uma linha de caixas de kit: miniatura com os potes reais, a composição ("Pimenta ×2 · Morango"),
 * o preço da caixa com o dos mesmos potes avulsos e o contador de caixas.
 */
function LinhaDoKit({
  kit,
  podeAumentar,
  aoMudar,
  aoRemover,
}: {
  kit: KitCarrinho;
  podeAumentar: boolean;
  aoMudar: (quantidade: number) => void;
  aoRemover: () => void;
}) {
  const composicao = textoDaComposicao(kit.sabores);
  const { avulsosCentavos } = economiaDaCaixa(kit);
  const potes = kit.sabores.reduce((soma, s) => soma + s.quantidade, 0);
  const nome = `${kit.nome} (${composicao})`;

  return (
    <li className="flex gap-3 border-b border-accent1/60 pb-4">
      <MiniaturaKit sabores={kit.sabores} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="font-titulos text-base font-semibold leading-snug">{kit.nome}</p>
          <p className="text-sm font-medium leading-snug">{composicao}</p>
        </div>
        <p className="text-sm text-primaria/80">
          <span className="whitespace-nowrap">{formatarBRL(kit.preco)} cada</span>
          {/* O preço dos avulsos só aparece quando a caixa sai mais barata (senão a loja não fala em economia). */}
          {avulsosCentavos > emCentavos(kit.preco) && (
            <span className="whitespace-nowrap">
              {" "}
              ({potes} avulsos: {formatarBRL(avulsosCentavos / 100)})
            </span>
          )}
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-full border border-accent2">
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-full text-lg hover:bg-accent1/40"
              aria-label={`Diminuir caixas de ${nome}`}
              onClick={() => aoMudar(kit.quantidade - 1)}
            >
              −
            </button>
            <span className="min-w-8 text-center text-sm font-semibold">{kit.quantidade}</span>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-full text-lg hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              aria-label={`Aumentar caixas de ${nome}`}
              aria-disabled={!podeAumentar || undefined}
              onClick={() => {
                if (podeAumentar) aoMudar(kit.quantidade + 1);
              }}
            >
              +
            </button>
          </div>
          <p className="font-semibold">{formatarBRL((emCentavos(kit.preco) * kit.quantidade) / 100)}</p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center self-start text-sm font-medium text-secundaria underline underline-offset-2"
          onClick={aoRemover}
        >
          Remover <span className="sr-only">{nome}</span>
        </button>
      </div>
    </li>
  );
}
