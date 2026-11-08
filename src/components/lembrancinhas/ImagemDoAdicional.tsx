import { useId } from "react";
import { FotoDoPote } from "@/components/FotoDoPote";
import { LEGENDA_IMAGEM_ILUSTRATIVA, ehAdicionalPadrao } from "@/lib/adicionais-regras";
import { cores, kraft } from "@/design-system";

/**
 * Imagem de um item adicional dos mimos. A dona envia a foto pelo painel; enquanto não houver, a loja desenha
 * uma ilustração simples na identidade da marca (vinho, rosa antigo, dourado, verde musgo e o xadrez gingham).
 * SEMPRE com a legenda "Imagem ilustrativa": a imagem é só um exemplo do item (o acabamento pode variar).
 */
export function ImagemDoAdicional({
  adicional,
  lado = 160,
  sizes = "96px",
  className = "",
  legenda = true,
}: {
  adicional: { id: string; nome: string; imagemUrl: string | null };
  /** Lado pedido ao otimizador, quando há foto enviada. */
  lado?: number;
  sizes?: string;
  /** Classes do quadrado da imagem (tamanho e borda). */
  className?: string;
  /** Mostra a legenda embaixo (padrão). Só desligue se outra legenda "Imagem ilustrativa" já estiver à vista. */
  legenda?: boolean;
}) {
  return (
    <figure className="m-0 flex w-fit flex-col items-center gap-1">
      <span className={`block overflow-hidden rounded-md border border-accent2/70 bg-[#f3ece3] ${className || "size-24"}`}>
        {adicional.imagemUrl ? (
          <FotoDoPote src={adicional.imagemUrl} alt="" lado={lado} sizes={sizes} className="size-full object-cover" />
        ) : (
          <IlustracaoDoAdicional id={adicional.id} className="size-full" />
        )}
      </span>
      {legenda && <figcaption className="text-[0.7rem] leading-tight text-primaria/80">{LEGENDA_IMAGEM_ILUSTRATIVA}</figcaption>}
    </figure>
  );
}

const vinho = cores.primaria;
const carmesim = cores.secundaria;
const rosa = cores.accent1;
const ouro = cores.accent2;
const musgo = cores.accent3;
const creme = cores.destaque;

/** As quatro ilustrações padrão (e uma genérica para um item novo sem foto). Decorativas: o nome do item está ao lado. */
export function IlustracaoDoAdicional({ id, className = "" }: { id: string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gingham = `gingham-${uid}`;

  return (
    <svg viewBox="0 0 120 120" role="presentation" aria-hidden="true" focusable="false" className={className} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={gingham} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={creme} />
          <rect width="6" height="12" fill={carmesim} opacity="0.35" />
          <rect width="12" height="6" fill={carmesim} opacity="0.35" />
        </pattern>
      </defs>
      <rect width="120" height="120" fill="#f3ece3" />
      {ehAdicionalPadrao(id) ? <Desenho id={id} gingham={gingham} /> : <Generico />}
    </svg>
  );
}

function Desenho({ id: qual, gingham: xadrez }: { id: string; gingham: string }) {
  switch (qual) {
    case "florzinhas":
      return (
        <g>
          {/* hastes e folhas */}
          <path d="M34 104 C34 84 36 72 38 60" stroke={musgo} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M60 106 C60 86 60 74 60 44" stroke={musgo} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M88 104 C88 86 85 74 82 62" stroke={musgo} strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M60 86 C50 84 44 78 42 72 C52 72 58 78 60 86Z" fill={musgo} />
          <path d="M60 78 C70 76 76 70 78 64 C68 64 62 70 60 78Z" fill={musgo} />
          {/* flores: pétalas em rosa antigo, miolo dourado */}
          {[
            [38, 54, 11],
            [60, 38, 14],
            [82, 56, 11],
          ].map(([cx, cy, r]) => (
            <g key={`${cx}-${cy}`}>
              {[0, 72, 144, 216, 288].map((graus) => (
                <ellipse
                  key={graus}
                  cx={cx}
                  cy={cy - r * 0.8}
                  rx={r * 0.55}
                  ry={r * 0.8}
                  fill={rosa}
                  stroke={vinho}
                  strokeWidth="1.2"
                  transform={`rotate(${graus} ${cx} ${cy})`}
                />
              ))}
              <circle cx={cx} cy={cy} r={r * 0.4} fill={ouro} stroke={vinho} strokeWidth="1.2" />
            </g>
          ))}
        </g>
      );
    case "paninho-na-tampa":
      return (
        <g>
          {/* potinho de vidro com a geleia */}
          <rect x="34" y="58" width="52" height="46" rx="9" fill={carmesim} stroke={vinho} strokeWidth="2" />
          <rect x="40" y="64" width="9" height="30" rx="4" fill="#fff" opacity="0.28" />
          {/* tampa e paninho xadrez caindo ao redor dela */}
          <rect x="32" y="50" width="56" height="10" rx="3" fill={ouro} stroke={vinho} strokeWidth="2" />
          <path
            d="M24 56 C24 38 40 30 60 30 C80 30 96 38 96 56 L92 64 L84 58 L76 66 L68 58 L60 66 L52 58 L44 66 L36 58 L28 64Z"
            fill={`url(#${xadrez})`}
            stroke={vinho}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* barbante */}
          <path d="M32 58 C46 62 74 62 88 58" stroke={vinho} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M88 58 C94 62 96 70 92 76 M88 58 C98 60 100 68 98 72" stroke={vinho} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case "caixinha":
      return (
        <g>
          {/* caixinha kraft, com tampa, laço e uma janela que mostra o potinho */}
          <path d="M22 54 L60 40 L98 54 L98 98 L60 108 L22 98Z" fill={kraft.base} stroke={vinho} strokeWidth="2" strokeLinejoin="round" />
          <path d="M22 54 L60 66 L98 54" fill="none" stroke={vinho} strokeWidth="2" strokeLinejoin="round" />
          <path d="M60 66 L60 108" stroke={vinho} strokeWidth="2" />
          <path d="M60 66 L98 54 L98 98 L60 108Z" fill={kraft.sombra} opacity="0.55" />
          <rect x="30" y="68" width="22" height="20" rx="4" fill="#fff" stroke={vinho} strokeWidth="1.6" transform="skewY(8) translate(0 -4)" />
          <circle cx="41" cy="79" r="6" fill={carmesim} transform="skewY(8) translate(0 -4)" />
          {/* laço */}
          <path
            d="M60 42 C48 28 38 34 46 42 C52 46 58 44 60 42Z M60 42 C72 28 82 34 74 42 C68 46 62 44 60 42Z"
            fill={rosa}
            stroke={vinho}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="60" cy="43" r="3.2" fill={ouro} stroke={vinho} strokeWidth="1.4" />
        </g>
      );
    case "colherzinha":
      return (
        <g>
          {/* colherzinha de madeira na diagonal, com uma gota de geleia */}
          <path d="M28 98 L72 54" stroke="#b78a55" strokeWidth="7" strokeLinecap="round" />
          <path d="M28 98 L72 54" stroke="#d4a972" strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="82" cy="44" rx="17" ry="12" transform="rotate(-45 82 44)" fill="#d4a972" stroke={vinho} strokeWidth="2" />
          <ellipse cx="82" cy="44" rx="11" ry="7" transform="rotate(-45 82 44)" fill={carmesim} opacity="0.9" />
          <path d="M90 74 C87 80 86 84 90 86 C94 84 93 80 90 74Z" fill={carmesim} stroke={vinho} strokeWidth="1.4" />
          <circle cx="30" cy="96" r="1.6" fill={vinho} />
        </g>
      );
    default:
      return <Generico />;
  }
}

function Generico() {
  return (
    <g>
      <circle cx="60" cy="60" r="26" fill={rosa} stroke={vinho} strokeWidth="2" />
      <path
        d="M60 44 L63 55 L74 55 L65 62 L69 73 L60 66 L51 73 L55 62 L46 55 L57 55Z"
        fill={ouro}
        stroke={vinho}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </g>
  );
}
