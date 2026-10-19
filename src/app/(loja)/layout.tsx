import { CarrinhoProvider } from "@/components/carrinho/CarrinhoProvider";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

/** Layout da loja: Header, Footer e carrinho lateral em todas as páginas públicas. */
export default function LojaLayout({ children }: LayoutProps<"/">) {
  return (
    <CarrinhoProvider>
      <Header />
      {children}
      <Footer />
    </CarrinhoProvider>
  );
}
