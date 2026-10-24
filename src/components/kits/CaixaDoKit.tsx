import Image from "next/image";
import type { CSSProperties } from "react";
import { FotoDoPote } from "@/components/FotoDoPote";
import { cores, coresGrafico, logos } from "@/design-system";
import { separarNome } from "@/lib/produtos-regras";
import estilos from "./CaixaDoKit.module.css";

/** Um pote numa vaga da caixa. `chave` muda a cada pote posto: é o que faz a animação de entrada rodar. */
export type PoteNaVaga = { productId: string; nome: string; imagemUrl: string; chave: string | number };

/**
 * A caixa de presente do "Monte seu kit", desenhada em CSS/SVG no estilo da referência (kraft claro,
 * cantos em xadrez vinho, logo oficial, assinatura, ramos de framboesa em traço fino, janela com os
 * potes e a faixa dos compromissos). Nunca usa os mockups recebidos: eles têm o logo errado, 250 g e
 * sabores que não existem. Nas vagas entram as fotos REAIS dos sabores escolhidos.
 *
 * Tudo é medido em fração da largura (viewBox 300×200 e `cqw`), então a caixa é a mesma ilustração
 * em qualquer tela. O enfeite fica escondido do leitor de tela; quem descreve a caixa é a página.
 *
 * Com `aoTirar` e `aoEscolher` as vagas são botões (montador); sem eles, só ilustração (prévia do painel).
 */
export function CaixaDoKit({
  vagas,
  aoTirar,
  aoEscolher,
  completa = false,
  tamanho = "grande",
  className = "",
}: {
  vagas: readonly (PoteNaVaga | null)[];
  aoTirar?: (indice: number) => void;
  aoEscolher?: (indice: number) => void;
  /** Caixa cheia: o coração sob a janela se enche. */
  completa?: boolean;
  /** Só muda o tamanho das imagens pedidas ao otimizador. */
  tamanho?: "grande" | "pequena";
  className?: string;
}) {
  const interativa = Boolean(aoTirar && aoEscolher);
  const tamanhos =
    tamanho === "grande"
      ? { logo: "(min-width: 1024px) 180px, 28vw", pote: "(min-width: 1024px) 220px, 34vw" }
      : { logo: "(min-width: 768px) 96px, 28vw", pote: "(min-width: 768px) 120px, 30vw" };

  return (
    <div
      data-caixa-kit=""
      className={`@container relative isolate aspect-[3/2] w-full overflow-hidden rounded-[6px] bg-kraft shadow-[0_22px_40px_-24px_rgb(107_29_42/0.55),0_2px_6px_rgb(107_29_42/0.12)] ${className}`}
      style={papel}
    >
      {/* Cantos em xadrez vinho, "impressos" no papelão (multiply deixa o fundo creme do xadrez no tom do kraft). */}
      {CANTOS.map((recorte) => (
        <div
          key={recorte}
          aria-hidden="true"
          className="bg-gingham absolute inset-0 mix-blend-multiply"
          style={{ clipPath: recorte, backgroundSize: "4cqw 4cqw" }}
        />
      ))}

      <Desenho />

      {/* Logo oficial (nunca redesenhado). Decorativo aqui: o nome da loja já está no cabeçalho. */}
      <Image
        src={logos.principal.src}
        alt=""
        width={logos.principal.largura}
        height={logos.principal.altura}
        sizes={tamanhos.logo}
        className="pointer-events-none absolute left-[22%] top-[3.5%] h-auto w-[27%] select-none"
      />

      {/* Janela da caixa: o fundo é o papelão de dentro, mais escuro em cima (na sombra da tampa). */}
      <div className="absolute left-[11.33%] top-[43%] h-[41%] w-[77.33%] overflow-hidden rounded-[2.4cqw] bg-[linear-gradient(to_bottom,#a9875a,#c4a77c_38%,#d6be96)]">
        <ol
          aria-label={interativa ? `Sua caixa, ${vagas.length} vagas` : undefined}
          aria-hidden={interativa ? undefined : true}
          className="grid h-full gap-[1cqw] p-[1.1cqw]"
          style={{ gridTemplateColumns: `repeat(${vagas.length}, minmax(0, 1fr))` }}
        >
          {vagas.map((pote, i) => (
            <li key={i} className="relative">
              <Vaga
                pote={pote}
                numero={i + 1}
                sizes={tamanhos.pote}
                aoTirar={aoTirar ? () => aoTirar(i) : undefined}
                aoEscolher={aoEscolher ? () => aoEscolher(i) : undefined}
              />
            </li>
          ))}
        </ol>
        {/* Borda do recorte e a sombra que a frente da caixa faz sobre os potes (por cima das fotos). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 rounded-[2.4cqw] border-[0.45cqw] border-[#9c7c50]/60 shadow-[inset_0_2.6cqw_2.4cqw_-1.4cqw_rgb(58_32_12/0.55),inset_0_-0.8cqw_1.4cqw_-0.6cqw_rgb(58_32_12/0.25)]"
        />
      </div>

      {/* Coração pendurado no meio, sob a janela: se enche quando a caixa fica completa. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 22"
        className="absolute left-1/2 top-[81.5%] z-20 w-[4.2cqw] -translate-x-1/2 drop-shadow-[0_0.3cqw_0.3cqw_rgb(58_32_12/0.3)]"
      >
        <path
          d={CORACAO}
          fill={completa ? cores.secundaria : cores.destaque}
          stroke={cores.secundaria}
          strokeWidth={1.8}
          className="motion-safe:transition-[fill] motion-safe:duration-500"
        />
      </svg>
    </div>
  );
}

/** Uma vaga da janela. Montador: botão "tirar" (com o pote) ou "escolher sabor" (livre). */
function Vaga({
  pote,
  numero,
  sizes,
  aoTirar,
  aoEscolher,
}: {
  pote: PoteNaVaga | null;
  numero: number;
  sizes: string;
  aoTirar?: () => void;
  aoEscolher?: () => void;
}) {
  const sabor = pote ? separarNome(pote.nome).sabor : null;
  // A animação de entrada é do montador (a pessoa pôs o pote); a prévia do painel já abre montada.
  const entrada = aoTirar ? estilos.entrar : "";
  const conteudo = pote ? (
    <>
      {/* `key`: cada pote novo monta este bloco de novo e a animação de entrada roda uma vez.
          O multiply leva o fundo claro da foto para o tom do papelão de dentro da caixa. */}
      <span key={pote.chave} className={`absolute inset-0 overflow-hidden rounded-[1.4cqw] mix-blend-multiply ${entrada}`}>
        <FotoDoPote
          src={pote.imagemUrl}
          alt=""
          lado={480}
          sizes={sizes}
          className="size-full scale-[1.16] object-cover"
        />
      </span>
      {/* Nome no pé da vaga quando a caixa é grande o bastante para ler (≥ 28rem). */}
      <span
        aria-hidden="true"
        className="absolute bottom-[3%] left-1/2 z-20 hidden max-w-[92%] -translate-x-1/2 truncate whitespace-nowrap rounded-full bg-destaque/90 px-[1.4cqw] py-[0.2cqw] text-[1.6cqw] font-semibold leading-tight text-primaria shadow-sm @md:block"
      >
        {sabor}
      </span>
    </>
  ) : (
    <PoteVazio />
  );

  if (!aoTirar || !aoEscolher) return <span className="absolute inset-0">{conteudo}</span>;

  // Um botão só, com o mesmo lugar na árvore nos dois estados: ao tirar o pote o foco continua aqui.
  return (
    <button
      type="button"
      onClick={pote ? aoTirar : aoEscolher}
      aria-label={pote ? `Tirar ${sabor} da vaga ${numero}` : `Vaga ${numero} livre: escolher sabor`}
      className="group absolute inset-0 cursor-pointer rounded-[1.4cqw] focus-visible:outline-[3px] focus-visible:outline-offset-[-5px] focus-visible:outline-secundaria focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-destaque"
    >
      {conteudo}
      {pote && (
        // "×" no canto: o alvo de toque é a vaga inteira (≥ 44 px mesmo no celular de 320 px).
        <span
          aria-hidden="true"
          className="absolute right-[6%] top-[6%] z-20 flex size-[max(1.375rem,4.4cqw)] items-center justify-center rounded-full border border-primaria/25 bg-destaque/95 text-primaria shadow-sm motion-safe:transition-colors group-hover:border-secundaria group-hover:bg-secundaria group-hover:text-destaque"
        >
          <svg viewBox="0 0 12 12" className="size-[55%]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M3 3l6 6M9 3 3 9" />
          </svg>
        </span>
      )}
    </button>
  );
}

/**
 * Vaga livre: o contorno pontilhado de um pote, esperando o sabor. O pote em vinho/70 dá ≈ 3,1:1
 * sobre o papelão de dentro (o mínimo para componente de interface é 3:1); a moldura tracejada é só
 * apoio. Ao passar o mouse, os dois vão para o carmesim.
 */
function PoteVazio() {
  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-[1.4cqw] border-[0.35cqw] border-dashed border-primaria/45 bg-destaque/10 motion-safe:transition-colors group-hover:border-secundaria group-hover:bg-destaque/30">
      <svg
        viewBox="0 0 40 44"
        aria-hidden="true"
        className="w-[46%] text-primaria/70 group-hover:text-secundaria"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="3" width="22" height="7" rx="2" strokeDasharray="3 2.4" />
        <path d="M11 10v2.5M29 10v2.5" />
        <rect x="5" y="12.5" width="30" height="28" rx="8" strokeDasharray="3.2 2.6" />
        <path d="M20 21v11M14.5 26.5h11" strokeWidth={2} />
      </svg>
    </span>
  );
}

/** Coração dos filetes e da faixa (mesmo desenho do Ornamento da marca), num quadro 24×22. */
export const CORACAO =
  "M12 20.5 10.6 19.2C5.4 14.5 2 11.4 2 7.6 2 4.5 4.4 2 7.5 2c1.7 0 3.4.8 4.5 2.1C13.1 2.8 14.8 2 16.5 2 19.6 2 22 4.5 22 7.6c0 3.8-3.4 6.9-8.6 11.6L12 20.5Z";

/** Triângulos dos cantos (no quadro 300×200 da caixa), como recortes em %. */
const CANTOS = [
  "polygon(0 0, 15.33% 0, 0 35%)",
  "polygon(84.67% 0, 100% 0, 100% 35%)",
  "polygon(0 68%, 0 100%, 14.67% 100%)",
  "polygon(100% 68%, 100% 100%, 85.33% 100%)",
];

/**
 * Papelão: luz suave do alto à esquerda, um pouco de sombra no canto oposto e um grão fino
 * (ruído SVG pequeno, repetido: é desenhado uma vez e ladrilhado, sem filtro na caixa inteira).
 */
const GRAO = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .36 0 0 0 0 .24 0 0 0 0 .12 0 0 0 .22 0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>",
)}")`;

const papel: CSSProperties = {
  backgroundImage: [
    "radial-gradient(120% 90% at 28% 12%, rgb(255 255 255 / 0.32), transparent 58%)",
    "radial-gradient(90% 90% at 100% 100%, rgb(110 70 30 / 0.14), transparent 62%)",
    GRAO,
  ].join(", "),
  backgroundSize: "auto, auto, 160px 160px",
};

/** O que é impresso na caixa (quadro 300×200): dobra da tampa, ramos e a faixa de baixo. */
function Desenho() {
  return (
    <svg viewBox="0 0 300 200" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full select-none">
      {/* Dobra da tampa: uma faixa mais clara no alto, com o vinco. */}
      <rect width="300" height="5.5" fill="#fff" opacity="0.22" />
      <path d="M0 5.5H300" stroke={KRAFT_ESCURO} strokeWidth="0.5" opacity="0.7" />

      <g transform="translate(21 35)">
        <Ramo />
      </g>
      <g transform="translate(281 37) scale(-1 1)">
        <Ramo segundaFruta />
      </g>

      {/* Faixa de baixo. A largura de cada selo é fixa (textLength): cabe igual em qualquer fonte. */}
      <g className="font-textos" fill={cores.primaria} fontSize="4.4" fontWeight="600">
        <text x="71" y="189.5" textLength="82" lengthAdjust="spacing">
          INGREDIENTES SELECIONADOS
        </text>
        <text x="171" y="189.5" textLength="56" lengthAdjust="spacing">
          SEM CONSERVANTES
        </text>
      </g>
      <g fill={cores.accent2}>
        <path d={CORACAO} transform="translate(159 184.2) scale(0.22)" />
      </g>
    </svg>
  );
}

const KRAFT_ESCURO = "#9c7c50";

/** Dourado escurecido: o accent2 puro some no kraft em traço tão fino. */
const DOURADO_TRACO = coresGrafico.despesas;

/**
 * Contorno de uma folha serrilhada que sai da origem e aponta para +x (comprimento `c`, largura
 * `l`): os dentes avançam um pouco para a ponta, como numa folha de framboeseira.
 */
function contornoDeFolha(c: number, l: number, dentes: number): string {
  const meia = (t: number) => (l / 2) * Math.sin(Math.PI * t ** 0.7);
  const lado = (sinal: 1 | -1) =>
    Array.from({ length: dentes * 2 - 1 }, (_, k) => {
      const i = k + 1;
      const t = i / (dentes * 2);
      const dente = i % 2 === 1 ? Math.sin(Math.PI * t) : 0;
      return `${(c * t + c * 0.03 * dente).toFixed(2)} ${(sinal * (meia(t) + l * 0.09 * dente)).toFixed(2)}`;
    });
  return `M0 0L${lado(-1).join("L")}L${c} 0L${lado(1).reverse().join("L")}Z`;
}

/** Nervura central e as laterais da mesma folha. */
function nervurasDaFolha(c: number, l: number): string {
  const meia = (t: number) => (l / 2) * Math.sin(Math.PI * t ** 0.7);
  const laterais = [0.25, 0.48, 0.7].flatMap((t) => [
    `M${(c * t).toFixed(2)} 0L${(c * (t + 0.13)).toFixed(2)} ${(-meia(t + 0.13) * 0.75).toFixed(2)}`,
    `M${(c * t).toFixed(2)} 0L${(c * (t + 0.13)).toFixed(2)} ${(meia(t + 0.13) * 0.75).toFixed(2)}`,
  ]);
  return `M0 0L${c * 0.97} 0${laterais.join("")}`;
}

/** As folhas do ramo: [x, y, ângulo, comprimento, largura, dentes]. */
const FOLHAS: [number, number, number, number, number, number][] = [
  [24.5, 7, 198, 18, 8.5, 6],
  [23.4, 10, -12, 15, 7, 5],
  [26, 3.5, -118, 9, 4.4, 4],
];
const DESENHO_FOLHAS = FOLHAS.map(([x, y, angulo, c, l, dentes]) => ({
  transform: `translate(${x} ${y}) rotate(${angulo})`,
  contorno: contornoDeFolha(c, l, dentes),
  nervuras: nervurasDaFolha(c, l),
}));

/**
 * Ramo de framboesa em traço fino (quadro ~40×46): folhas serrilhadas em dourado, a fruta em vinho
 * com as drupéolas rosadas e o cálice em verde musgo, como as ilustrações da referência.
 * `segundaFruta` (lado direito) troca a florzinha por uma framboesa menor: os lados não ficam iguais.
 */
function Ramo({ segundaFruta = false }: { segundaFruta?: boolean }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.5">
      {/* Galho */}
      <path d="M27 1C25 8 20.5 16 15 26.6" stroke={cores.accent3} strokeWidth="0.6" />
      {DESENHO_FOLHAS.map((f) => (
        <g key={f.transform} transform={f.transform} stroke={DOURADO_TRACO}>
          <path d={f.contorno} fill={cores.destaque} fillOpacity="0.45" />
          <path d={f.nervuras} strokeWidth="0.35" />
        </g>
      ))}
      {segundaFruta ? (
        <>
          <path d="M22 15.5C25 18.5 29 21 31 24.2" stroke={cores.accent3} strokeWidth="0.5" />
          <g transform="translate(31 30) scale(0.62)">
            <Framboesa />
          </g>
        </>
      ) : (
        // Florzinha da framboeseira
        <g stroke={DOURADO_TRACO} transform="translate(34 22)">
          {[0, 72, 144, 216, 288].map((angulo) => (
            <ellipse key={angulo} cx="0" cy="-2.3" rx="1.4" ry="2.1" transform={`rotate(${angulo})`} fill={cores.destaque} fillOpacity="0.6" />
          ))}
          <circle r="0.8" fill={cores.accent2} stroke="none" />
        </g>
      )}
      <g transform="translate(15 36)">
        <Framboesa />
      </g>
    </g>
  );
}

/** Framboesa (centro em 0,0, ~17×20): drupéolas em cone arredondado, brilho e o cálice no alto. */
function Framboesa() {
  return (
    <g>
      <g stroke={cores.primaria} strokeWidth="0.5" fill={cores.accent1} fillOpacity="0.8">
        {DRUPEOLAS.map(([x, y, r]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={r} />
        ))}
      </g>
      <g fill="#fff" opacity="0.75">
        {BRILHOS.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x - 0.55} cy={y - 0.6} r="0.45" />
        ))}
      </g>
      <g stroke={cores.accent3} strokeWidth="0.5" fill={cores.accent3} fillOpacity="0.25">
        {[200, 162, 18, -20, -62, -118].map((angulo) => (
          <path key={angulo} d="M0 0Q2.6-1.1 5 0Q2.6 1.1 0 0Z" transform={`translate(0 -9.2) rotate(${angulo})`} />
        ))}
      </g>
    </g>
  );
}

/** [x, y, raio] de cada drupéola, de cima para baixo (as de baixo ficam na frente). */
const DRUPEOLAS: [number, number, number][] = [
  ...[-3.4, 0, 3.4].map((x): [number, number, number] => [x, -7.4, 1.8]),
  ...[-5.1, -1.7, 1.7, 5.1].map((x): [number, number, number] => [x, -4.5, 1.85]),
  ...[-6.5, -3.3, 0, 3.3, 6.5].map((x): [number, number, number] => [x, -1.6, 1.85]),
  ...[-5.1, -1.7, 1.7, 5.1].map((x): [number, number, number] => [x, 1.3, 1.85]),
  ...[-3.4, 0, 3.4].map((x): [number, number, number] => [x, 4.2, 1.8]),
  ...[-1.7, 1.7].map((x): [number, number, number] => [x, 7, 1.7]),
  [0, 9.5, 1.55],
];
/** Drupéolas do lado da luz (alto à esquerda), com um pontinho de brilho. */
const BRILHOS: [number, number][] = [
  [-3.4, -7.4],
  [-5.1, -4.5],
  [-1.7, -4.5],
  [-3.3, -1.6],
  [-6.5, -1.6],
];
