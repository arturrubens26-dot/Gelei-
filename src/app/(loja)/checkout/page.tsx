import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { listarEnderecos } from "@/lib/enderecos";

export const metadata: Metadata = { title: "Finalizar pedido" };

export default function PaginaCheckout() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="mb-6 font-titulos text-4xl font-bold text-primaria">Finalizar pedido</h1>
      {/* A sessão é dado da requisição: o conteúdo chega por streaming. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status" aria-label="Carregando o checkout" />}>
        <ConteudoDoCheckout />
      </Suspense>
    </main>
  );
}

async function ConteudoDoCheckout() {
  const usuario = await getUsuarioAtual();

  // Sem login: entrar ou criar conta rápida aqui mesmo, e voltar ao checkout.
  if (!usuario) {
    return (
      <section aria-labelledby="titulo-acesso">
        <h2 id="titulo-acesso" className="mb-2 text-center text-2xl font-bold">
          Entre ou crie sua conta
        </h2>
        <p className="mx-auto mb-6 max-w-md text-center text-primaria/80">
          É rápido: só precisamos de nome, e-mail e senha para acompanhar seu pedido.
        </p>
        <AuthForm destino="/checkout" modoInicial="criar" />
      </section>
    );
  }

  // `key` por usuário: se outra pessoa entrar no mesmo navegador, o estado do checkout recomeça do zero.
  return <CheckoutClient key={usuario.id} nomeUsuario={usuario.nome} enderecos={await listarEnderecos(usuario.id)} />;
}
