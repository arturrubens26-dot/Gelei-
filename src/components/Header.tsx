import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { BotaoCarrinho } from "@/components/carrinho/BotaoCarrinho";
import { MenuUsuario, MenuUsuarioCarregando } from "@/components/MenuUsuario";
import { logos, marca } from "@/design-system";
import { listarKits } from "@/lib/kits";
import { obterLembrancinhas } from "@/lib/lembrancinhas";

const estiloLink =
  "inline-flex min-h-11 items-center text-sm font-semibold text-primaria underline-offset-4 hover:text-secundaria hover:underline";

/**
 * Cabeçalho da loja: logo oficial (pote + framboesas + Geleiô), navegação, conta e carrinho.
 * O link "Kits" só aparece com um kit à venda, e "Lembrancinhas" só com as encomendas abertas no
 * painel (as duas consultas em cache, expiradas pelo painel ao mudar).
 */
export async function Header() {
  const [temKit, temLembrancinhas] = await Promise.all([haKitAVenda(), lembrancinhasAbertas()]);
  return <CabecalhoDaLoja temKit={temKit} temLembrancinhas={temLembrancinhas} />;
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

/** Mesma regra do link "Kits": se a consulta falhar, a loja segue sem o link. */
async function lembrancinhasAbertas() {
  try {
    return (await obterLembrancinhas()).ativo;
  } catch (erro) {
    unstable_rethrow(erro);
    console.error("Cabeçalho: não foi possível consultar as lembrancinhas; o link fica oculto.", erro);
    return false;
  }
}

function CabecalhoDaLoja({ temKit, temLembrancinhas }: { temKit: boolean; temLembrancinhas: boolean }) {
  return (
    <header className="border-b border-accent2/50 bg-destaque print:hidden">
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

        {/* Com os três links ("Nossas geleias", "Kits" e "Lembrancinhas") a navegação não cabe ao lado da conta
            e do carrinho no celular: até 1024 px ela ganha uma linha própria. Com menos links, fica na linha
            do logo, como sempre. No computador fica sempre na mesma linha, antes da conta. */}
        <nav
          aria-label="Principal"
          className={
            temKit && temLembrancinhas
              ? "order-last w-full border-t border-accent2/30 lg:order-none lg:ml-auto lg:mr-2 lg:w-auto lg:border-0"
              : "ml-auto lg:mr-2"
          }
        >
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-0 lg:gap-6">
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
            {temLembrancinhas && (
              <li>
                <Link href="/lembrancinhas" className={estiloLink}>
                  Lembrancinhas
                </Link>
              </li>
            )}
          </ul>
        </nav>

        <div className="flex items-center gap-4 sm:gap-6">
          <Suspense fallback={<MenuUsuarioCarregando />}>
            <MenuUsuario />
          </Suspense>
          <BotaoCarrinho />
        </div>
      </div>
    </header>
  );
}
