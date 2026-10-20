import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { BotaoCarrinho } from "@/components/carrinho/BotaoCarrinho";
import { MenuUsuario, MenuUsuarioCarregando } from "@/components/MenuUsuario";
import { logos, marca } from "@/design-system";
import { listarKits } from "@/lib/kits";

const estiloLink =
  "inline-flex min-h-11 items-center text-sm font-semibold text-primaria underline-offset-4 hover:text-secundaria hover:underline";

/**
 * Cabeçalho da loja: logo oficial (pote + framboesas + Geleiô), navegação, conta e carrinho.
 * O link "Kits" só aparece com um kit à venda (lista em cache, expirada pelo painel ao mudar).
 */
export async function Header() {
  return <CabecalhoDaLoja temKit={await haKitAVenda()} />;
}

/**
 * O cabeçalho está em toda página da loja: se o banco falhar ao consultar os kits, a loja segue no
 * ar sem o link "Kits" (em vez de cair inteira por causa de um link). Sinais internos do Next
 * (renderização dinâmica, redirecionamento) passam adiante pelo unstable_rethrow.
 */
async function haKitAVenda() {
  try {
    return (await listarKits()).length > 0;
  } catch (erro) {
    unstable_rethrow(erro);
    console.error("Cabeçalho: não foi possível consultar os kits; o link 'Kits' fica oculto.", erro);
    return false;
  }
}

function CabecalhoDaLoja({ temKit }: { temKit: boolean }) {

  return (
    <header className="border-b border-accent2/50 bg-destaque">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Link href="/" className="shrink-0" aria-label={`${marca.nome} — ${marca.slogan}. Ir para a página inicial`}>
          <Image
            src={logos.cabecalho.src}
            alt=""
            width={logos.cabecalho.largura}
            height={logos.cabecalho.altura}
            priority
            sizes="140px"
            className="h-16 w-auto sm:h-20"
          />
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          <nav aria-label="Principal">
            <ul className="flex items-center gap-4 sm:gap-6">
              <li>
                <Link href="/products" className={estiloLink}>
                  Nossas geleias
                </Link>
              </li>
              {temKit && (
                <li>
                  <Link href="/kits" className={estiloLink}>
                    Kits
                  </Link>
                </li>
              )}
            </ul>
          </nav>
          <Suspense fallback={<MenuUsuarioCarregando />}>
            <MenuUsuario />
          </Suspense>
          <BotaoCarrinho />
        </div>
      </div>
    </header>
  );
}
