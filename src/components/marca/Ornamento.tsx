/**
 * Filete dourado com coração ao centro: o ornamento que separa as seções no painel de
 * identidade e fica sob o logo. Decorativo (escondido de leitores de tela).
 */
export function Ornamento({ className = "", largura = "w-14 sm:w-20" }: { className?: string; largura?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2.5 text-accent2 ${className}`} aria-hidden="true">
      <span className={`h-px bg-current ${largura}`} />
      <svg viewBox="0 0 24 24" className="size-3.5 fill-current">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
      <span className={`h-px bg-current ${largura}`} />
    </div>
  );
}
