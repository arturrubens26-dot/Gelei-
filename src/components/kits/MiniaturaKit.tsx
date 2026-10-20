import { FotoDoPote } from "@/components/FotoDoPote";

/**
 * Miniatura de uma caixa de kit (carrinho, checkout, confirmação e painel): quadrado kraft com um
 * canto em xadrez e os potes REAIS lado a lado, um pouco sobrepostos (o do meio na frente).
 * Decorativa: o texto ao lado diz o nome do kit e a composição.
 *
 * Cada pote fica num ladrilho kraft com a foto em multiply (o fundo claro da foto vira papelão) e as
 * bordas laterais e de cima esmaecidas por máscara: assim o pote da frente cobre o de trás sem deixar
 * a quina do ladrilho aparecendo. O brilho a mais leva o cinza-claro do fundo das fotos para perto
 * do branco, que no multiply some no kraft.
 */
export function MiniaturaKit({
  sabores,
  className = "size-18",
}: {
  sabores: readonly { productId: string; imagemUrl: string; quantidade: number }[];
  className?: string;
}) {
  // Um ladrilho por pote (Pimenta ×2 vira dois potes de Pimenta).
  const potes = sabores.flatMap((s) => Array.from({ length: s.quantidade }, () => s));
  const n = Math.max(potes.length, 1);
  const largura = n <= 3 ? 40 : 32; // % do quadrado
  const passo = n > 1 ? Math.min(largura * 0.72, (98 - largura) / (n - 1)) : 0;
  const inicio = (100 - (largura + passo * (n - 1))) / 2;
  const meio = (n - 1) / 2;

  return (
    <span
      aria-hidden="true"
      className={`relative isolate block shrink-0 overflow-hidden rounded-md border border-kraft-sombra bg-kraft shadow-[inset_0_-6px_10px_-6px_rgb(110_70_30/0.35)] ${className}`}
    >
      <span className="bg-gingham absolute inset-0 mix-blend-multiply" style={{ clipPath: "polygon(0 0, 40% 0, 0 40%)", backgroundSize: "8px 8px" }} />
      {potes.map((pote, i) => {
        const frente = n - Math.round(Math.abs(i - meio) * 2);
        return (
          <span
            key={`${pote.productId}-${i}`}
            className="absolute bottom-[7%] isolate overflow-hidden bg-kraft [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent,#000_20%,#000_80%,transparent),linear-gradient(to_bottom,transparent,#000_22%)]"
            style={{
              left: `${inicio + passo * i}%`,
              width: `${largura}%`,
              height: i === Math.round(meio) && n % 2 === 1 ? "56%" : "50%",
              zIndex: frente,
            }}
          >
            <FotoDoPote src={pote.imagemUrl} alt="" lado={96} sizes="48px" className="size-full scale-[1.15] object-cover mix-blend-multiply brightness-[1.08]" />
          </span>
        );
      })}
    </span>
  );
}
