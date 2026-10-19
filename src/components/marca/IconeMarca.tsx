import type { IconeDeMarca } from "@/design-system";

/**
 * Ícones em traço das "aplicações da marca" (painel de identidade): folha e ramo em verde musgo,
 * coração, colher e framboesa em vinho. Vetoriais, para ficarem nítidos em qualquer tamanho.
 */
const VERDE = "text-accent3";
const VINHO = "text-primaria";

export function IconeMarca({ icone, className = "size-10" }: { icone: IconeDeMarca; className?: string }) {
  const comum = {
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (icone) {
    case "folha":
      return (
        <svg {...comum} className={`${VERDE} ${className}`}>
          <path d="M6 26C6 14 13 7 26 6c-1 12.5-8 20-20 20Z" />
          <path d="M6 26 20 12" />
          <path d="M10.5 21.5v-4.6M10.5 21.5h4.6M14.5 17.5v-4.2M14.5 17.5h4.2M18 14v-3.4M18 14h3.4" />
        </svg>
      );
    case "coracao":
      return (
        <svg {...comum} className={`${VINHO} ${className}`}>
          <path d="M16 27s-10-6.3-12.4-12.2C1.8 10.3 4.4 5.5 9 5.5c2.9 0 5 1.6 7 4.2 2-2.6 4.1-4.2 7-4.2 4.6 0 7.2 4.8 5.4 9.3C26 20.7 16 27 16 27Z" />
        </svg>
      );
    case "colher":
      return (
        <svg {...comum} className={`${VINHO} ${className}`}>
          <path d="M21.6 4.5c3.6 0 6 2.7 5.5 5.9-.6 3.7-4 5.6-6.9 5.4-1.3-.1-2.3.3-3.2 1.2L8.4 25.6a2.2 2.2 0 0 1-3.1-3.1l8.6-8.6c.9-.9 1.3-1.9 1.2-3.2-.2-3.3 2.5-6.2 6.5-6.2Z" />
        </svg>
      );
    case "ramo":
      return (
        <svg {...comum} className={`${VERDE} ${className}`}>
          <path d="M7 27C11 20 16.5 13.5 26 6" />
          <path d="M12.3 19.6c-3.8.4-6.5-1.2-7.4-4.3 3.4-.9 6 .4 7.4 4.3Z" />
          <path d="M12.6 19.4c-.2 3.8-2.2 6.2-5.4 6.7-.6-3.4 1.2-5.9 5.4-6.7Z" />
          <path d="M17.2 14.2c-.6-3.8.9-6.5 4-7.6 1.1 3.3-.2 6-4 7.6Z" />
          <path d="M17.6 13.9c3.6-1.3 6.5-.4 7.8 2.5-3.1 1.4-6 .6-7.8-2.5Z" />
        </svg>
      );
    case "framboesa":
      return (
        // Fruto: contorno de cone arredondado com as bolinhas (drupéolas) juntas por dentro, e o
        // cálice verde em cima. Bolinhas soltas sem contorno pareciam um cacho de uva.
        <svg {...comum} className={`${VINHO} ${className}`}>
          <path d="M16 29.2c-5.3 0-9.3-4.9-9.3-10.4 0-4 2.5-6.6 5.9-7.2h6.8c3.4.6 5.9 3.2 5.9 7.2 0 5.5-4 10.4-9.3 10.4Z" />
          <g strokeWidth={1.1}>
            <circle cx="12.2" cy="14.4" r="1.7" />
            <circle cx="16" cy="14.4" r="1.7" />
            <circle cx="19.8" cy="14.4" r="1.7" />
            <circle cx="10.3" cy="17.8" r="1.7" />
            <circle cx="14.1" cy="17.8" r="1.7" />
            <circle cx="17.9" cy="17.8" r="1.7" />
            <circle cx="21.7" cy="17.8" r="1.7" />
            <circle cx="12.2" cy="21.2" r="1.7" />
            <circle cx="16" cy="21.2" r="1.7" />
            <circle cx="19.8" cy="21.2" r="1.7" />
            <circle cx="14.1" cy="24.6" r="1.7" />
            <circle cx="17.9" cy="24.6" r="1.7" />
          </g>
          <g className="text-accent3" stroke="currentColor">
            <path d="M16 11.6c-2.4-2.3-5.4-2.4-7.5-.9 2.2 1.7 5 2 7.5.9Z" />
            <path d="M16 11.6c2.4-2.3 5.4-2.4 7.5-.9-2.2 1.7-5 2-7.5.9Z" />
            <path d="M16 11.6V5.5" />
          </g>
        </svg>
      );
  }
}
