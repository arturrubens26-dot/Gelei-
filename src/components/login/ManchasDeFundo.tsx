/**
 * Manchas de cor desfocadas atrás do painel de login, nas cores da marca (rosa antigo, dourado e
 * carmesim). São gradientes radiais parados: dão o ar "aquarelado" da referência sem custo de
 * animação, e o cartão de vidro (backdrop-blur) as desfoca uma vez só. O pai precisa de
 * `relative isolate overflow-hidden`.
 */
export function ManchasDeFundo() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -top-[22%] -left-[14%] h-[62%] w-[52%] rounded-full bg-[radial-gradient(closest-side,rgb(231_183_183/0.9),rgb(231_183_183/0))]" />
      <div className="absolute top-[34%] left-[24%] h-[46%] w-[40%] rounded-full bg-[radial-gradient(closest-side,rgb(212_175_55/0.24),rgb(212_175_55/0))]" />
      {/* Mancha que atravessa do cartão para a moldura, ligando os dois lados (como na referência). */}
      <div className="absolute top-[38%] left-[36%] h-[42%] w-[30%] rounded-full bg-[radial-gradient(closest-side,rgb(231_183_183/0.7),rgb(231_183_183/0))]" />
      <div className="absolute top-[6%] -right-[10%] h-[74%] w-[56%] rounded-full bg-[radial-gradient(closest-side,rgb(169_55_79/0.38),rgb(169_55_79/0))]" />
      <div className="absolute -bottom-[30%] left-[14%] h-[60%] w-[54%] rounded-full bg-[radial-gradient(closest-side,rgb(231_183_183/0.7),rgb(231_183_183/0))]" />
    </div>
  );
}
