import { marca } from "@/design-system";

/**
 * Rodapé como a faixa do painel de identidade: xadrez vinho em cima e, na faixa vinho,
 * "GELEIÔ GELEIAS ARTESANAIS" em dourado, o filete com coração e a assinatura caligráfica.
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
      </div>
    </footer>
  );
}
