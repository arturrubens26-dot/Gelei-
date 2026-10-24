import { CarrinhoProvider } from "@/components/carrinho/CarrinhoProvider";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

/** Layout da loja: Header, Footer e carrinho lateral em todas as páginas públicas. */
export default function LojaLayout({ children }: LayoutProps<"/">) {
  return (
    <CarrinhoProvider>
      {/* Marca d'água: o potinho da marca, em traço vinho bem suave, fixo atrás de toda a loja. */}
      <div aria-hidden="true" className="marca-dagua" />
      <Header />
      {children}
      <Footer />
    </CarrinhoProvider>
  );
}
