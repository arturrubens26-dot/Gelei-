import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { getUsuarioAtual } from "@/lib/auth/dal";
import { listarEnderecos } from "@/lib/enderecos";
import { obterTaxaDeEntregaCentavos } from "@/lib/entrega";
import { pagamentoOnlineDisponivel } from "@/lib/pagamentos";
import { telefoneDoCliente } from "@/lib/pedidos";

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
  // Site no ar antes do pagamento real: avisa em vez de deixar montar um pedido que não tem como ser pago.
  // `connection()`: a checagem lê variáveis de ambiente e roda na hora da requisição; sem isso ela
  // rodaria no prerender e o "em breve" (ou não) ficaria gravado no shell estático do build.
  await connection();
  if (!pagamentoOnlineDisponivel()) {
    return (
      <section aria-labelledby="titulo-em-breve" className="cartao p-6 text-center">
        <h2 id="titulo-em-breve" className="mb-2 font-titulos text-2xl font-bold">
          Pedidos pelo site em breve
        </h2>
        <p className="mx-auto mb-6 max-w-md text-primaria/80">
          Estamos preparando o pagamento pelo site, com PIX ou cartão. Enquanto isso, conheça os sabores; seu carrinho fica guardado
          neste navegador.
        </p>
        <Link href="/products" className="btn-primario">
          Ver os sabores
        </Link>
      </section>
    );
  }

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

  const [enderecos, telefone, taxaEntregaCentavos] = await Promise.all([
    listarEnderecos(usuario.id),
    telefoneDoCliente(usuario.id),
    obterTaxaDeEntregaCentavos(),
  ]);

  // `key` por usuário: se outra pessoa entrar no mesmo navegador, o estado do checkout recomeça do zero.
  return (
    <CheckoutClient
      key={usuario.id}
      nomeUsuario={usuario.nome}
      enderecos={enderecos}
      telefoneInicial={telefone}
      taxaEntregaCentavos={taxaEntregaCentavos}
    />
  );
}
