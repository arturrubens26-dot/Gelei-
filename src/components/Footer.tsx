import Link from "next/link";
import { marca } from "@/design-system";
import { dadosLegais, dadosLoja } from "@/lib/dados-loja";

/** Links da faixa de baixo: creme sobre vinho (≈ 10:1); no foco, o contorno dourado aparece sobre o vinho. */
const estiloLink =
  "inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:text-accent2 hover:underline focus-visible:outline-accent2";

/**
 * Rodapé como a faixa do painel de identidade: xadrez vinho em cima e, na faixa vinho,
 * "GELEIÔ GELEIAS ARTESANAIS" em dourado.
 * Embaixo, separado por um filete dourado, o endereço, as políticas (entrega e trocas, privacidade) e
 * o Instagram da loja (o contato fica no mesmo lugar em todas as páginas, como pede o WCAG 3.2.6).
 * Dourado sobre vinho ≈ 5,5:1 e creme sobre vinho ≈ 12:1 (ok para texto).
 */
export function Footer() {
  return (
    <footer className="mt-auto print:hidden">
      <div className="h-4 bg-gingham" aria-hidden="true" />
      <div className="bg-primaria text-destaque">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-center lg:flex-row lg:justify-center lg:gap-6">
          <p className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.32em] text-accent2">
            <span className="hidden h-px w-12 bg-accent2/70 sm:block" aria-hidden="true" />
            {marca.nome} {marca.slogan}
            <span className="hidden h-px w-12 bg-accent2/70 sm:block" aria-hidden="true" />
          </p>
        </div>
        <div className="border-t border-accent2/30">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-5 text-center text-sm text-destaque/90 lg:flex-row lg:justify-between lg:text-left">
            <address className="not-italic">
              {dadosLoja.endereco.logradouro} · {dadosLoja.endereco.bairro}
              <br className="sm:hidden" />
              <span className="hidden sm:inline"> · </span>
              {dadosLoja.endereco.cidade}-{dadosLoja.endereco.uf} · CEP {dadosLoja.endereco.cep}
              {/* Decreto 7.962/2013, art. 2º: CNPJ/CPF e e-mail de contato, quando a loja os preencher em dados-loja.ts. */}
              {dadosLegais.documento?.trim() && (
                <>
                  <br />
                  CNPJ/CPF {dadosLegais.documento}
                </>
              )}
              {dadosLegais.email?.trim() && (
                <>
                  {dadosLegais.documento?.trim() ? " · " : <br />}
                  <a href={`mailto:${dadosLegais.email}`} className="font-semibold underline underline-offset-4 hover:text-accent2">
                    {dadosLegais.email}
                  </a>
                </>
              )}
            </address>
            <nav aria-label="Informações da loja">
              <ul className="flex flex-wrap items-center justify-center gap-x-6">
                <li>
                  <Link href="/entrega-e-trocas" className={estiloLink}>
                    Entrega e trocas
                  </Link>
                </li>
                <li>
                  <Link href="/privacidade" className={estiloLink}>
                    Privacidade
                  </Link>
                </li>
                <li>
                  <a href={dadosLoja.instagram.url} target="_blank" rel="noopener noreferrer" className={`${estiloLink} gap-2`}>
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                    </svg>
                    @{dadosLoja.instagram.usuario}
                    <span className="sr-only">no Instagram (abre em nova aba)</span>
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
