import { marca } from "@/design-system";
import { dadosLoja } from "@/lib/dados-loja";

/**
 * Rodapé como a faixa do painel de identidade: xadrez vinho em cima e, na faixa vinho,
 * "GELEIÔ GELEIAS ARTESANAIS" em dourado, o filete com coração e a assinatura caligráfica.
 * Embaixo, separado por um filete dourado, o endereço e o Instagram da loja (o contato fica no
 * mesmo lugar em todas as páginas, como pede o WCAG 3.2.6).
 * Dourado sobre vinho ≈ 5,5:1 e creme sobre vinho ≈ 12:1 (ok para texto).
 */
export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="h-4 bg-gingham" aria-hidden="true" />
      <div className="bg-primaria text-destaque">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-center lg:flex-row lg:justify-between lg:gap-6">
          <p className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.32em] text-accent2">
            <span className="hidden h-px w-12 bg-accent2/70 sm:block" aria-hidden="true" />
            {marca.nome} {marca.slogan}
            <span className="hidden h-px w-12 bg-accent2/70 sm:block" aria-hidden="true" />
          </p>
          <svg viewBox="0 0 24 24" className="hidden size-4 fill-accent2 lg:block" aria-hidden="true">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <p className="assinatura text-3xl text-destaque sm:text-4xl">{marca.fraseRodape}</p>
        </div>
        <div className="border-t border-accent2/30">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-5 text-center text-sm text-destaque/90 sm:flex-row sm:justify-between sm:text-left">
            <address className="not-italic">
              {dadosLoja.endereco.logradouro} · {dadosLoja.endereco.bairro}
              <br className="sm:hidden" />
              <span className="hidden sm:inline"> · </span>
              {dadosLoja.endereco.cidade}-{dadosLoja.endereco.uf} · CEP {dadosLoja.endereco.cep}
            </address>
            <a
              href={dadosLoja.instagram.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:text-accent2 hover:underline focus-visible:outline-accent2"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
              @{dadosLoja.instagram.usuario}
              <span className="sr-only">no Instagram (abre em nova aba)</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
