"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { calcularEntrega, mascararCep } from "@/lib/carrinho/entrega";
import { acoesCarrinho, totaisDoCarrinho, useCarrinho } from "@/lib/carrinho/store";
import { formatarBRL } from "@/lib/dinheiro";
import { MAX_POR_PRODUTO } from "@/lib/limites";
import { ehFotoEnviada } from "@/lib/produtos-regras";
import { useCarrinhoUI } from "./contexto";

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

  const vazio = estado.itens.length === 0;

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
            {estado.itens.map((item) => (
              <li key={item.productId} className="flex gap-3 border-b border-accent1/60 pb-4">
                <Image
                  src={item.imagemUrl}
                  alt=""
                  width={72}
                  height={72}
                  unoptimized={ehFotoEnviada(item.imagemUrl)}
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
                      <button
                        type="button"
                        className="inline-flex size-11 items-center justify-center rounded-full text-lg hover:bg-accent1/40 disabled:opacity-40"
                        aria-label={`Aumentar quantidade de ${item.nome}`}
                        disabled={item.quantidade >= MAX_POR_PRODUTO}
                        onClick={() => mudarQuantidade(item.productId, item.nome, item.quantidade + 1)}
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
              ) : totais.cotacaoValida ? (
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
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatarBRL(totais.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Entrega</dt>
              <dd>{totais.entrega === null ? "calcule pelo CEP" : formatarBRL(totais.entrega)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-accent1 pt-2 text-lg font-bold">
              <dt>{totais.total === null ? "Total (sem entrega)" : "Total"}</dt>
              <dd>{formatarBRL(totais.total ?? totais.subtotal)}</dd>
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
