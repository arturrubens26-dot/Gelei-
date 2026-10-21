import type { Metadata } from "next";
import Link from "next/link";
import { CarrinhoProvider } from "@/components/carrinho/CarrinhoProvider";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { TelaDeAviso } from "@/components/TelaDeAviso";

export const metadata: Metadata = { title: "Página não encontrada" };

/**
 * 404 da loja inteira: endereço que não existe e `notFound()` (pedido de outra pessoa, produto
 * excluído). Fica no layout raiz, que não tem o cabeçalho da loja, então traz o seu: a cliente
 * continua com o menu, a conta e o carrinho à mão.
 */
export default function NaoEncontrada() {
  return (
    <CarrinhoProvider>
      <Header />
      <main className="flex flex-1 flex-col">
        <TelaDeAviso
          titulo="Página não encontrada"
          pote="vazio"
          acoes={
            <>
              <Link href="/products" className="btn-primario px-8">
                Ver as geleias
              </Link>
              <Link href="/" className="btn-secundario px-8">
                Ir para o início
              </Link>
            </>
          }
          rodape={
            <p>
              Procurando um pedido?{" "}
              <Link href="/meus-pedidos" className="inline-flex min-h-11 items-center font-semibold text-secundaria underline underline-offset-2 hover:text-primaria">
                Veja em Meus pedidos
              </Link>
            </p>
          }
        >
          <p>O endereço pode ter mudado ou ter sido digitado com algum erro. Os sabores continuam todos aqui.</p>
        </TelaDeAviso>
      </main>
      <Footer />
    </CarrinhoProvider>
  );
}
