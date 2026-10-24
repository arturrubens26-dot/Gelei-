/**
 * Design system da Geleiô — fonte única de verdade para cores, tipografia,
 * símbolos e padrões. O `tailwind.config.ts` consome este arquivo, então
 * qualquer ajuste de marca deve ser feito aqui.
 */

export const marca = {
  nome: "Geleiô",
  slogan: "Geleias Artesanais",
  fraseRodape: "Feito com amor, para você.",
} as const;

/**
 * Paleta de cores (referência da identidade visual).
 *
 * Contraste sobre `destaque` (#FFF7EE), calculado: primaria ≈ 12:1 e secundaria ≈ 5,9:1
 * (ok para texto). accent2 (dourado, ≈ 2:1) e accent3 (verde musgo, ≈ 4,06:1, abaixo
 * dos 4,5:1) NÃO servem como texto: use só em bordas, fundos e ícones, e ponha o texto
 * em primaria por cima (como em EtiquetaStatus).
 */
export const cores = {
  /** Vinho Escuro — texto principal, títulos, logo */
  primaria: "#6B1D2A",
  /** Carmesim — botões e ações principais */
  secundaria: "#A9374F",
  /** Creme Suave — fundo principal */
  destaque: "#FFF7EE",
  /** Rosa Antigo — superfícies e detalhes suaves */
  accent1: "#E7B7B7",
  /** Dourado Ouro — bordas e selos */
  accent2: "#D4AF37",
  /** Verde Musgo — folhas, ingredientes, estados de sucesso */
  accent3: "#6F7F5F",
} as const;

export type NomeCor = keyof typeof cores;

/**
 * Kraft da caixa de presente ("Monte seu kit"), desenhada em CSS: `bg-kraft` e `bg-kraft-sombra`.
 * Texto sobre kraft SEMPRE em primaria (≈ 8,1:1 sobre `base` e ≈ 5,4:1 sobre `sombra`): o carmesim
 * fica em ≈ 4,4:1 sobre o kraft claro, abaixo dos 4,5:1, e só serve para enfeite e ícone.
 */
export const kraft = {
  /** Papelão claro da caixa. */
  base: "#E9D7B7",
  /** Dobras, filetes e o fundo da janela (a parte de dentro da caixa, na sombra). */
  sombra: "#C9AE85",
} as const;

/**
 * Cores das séries nos gráficos do painel. Entradas no carmesim da marca; despesas num dourado
 * escurecido (o accent2 puro tem contraste ≈ 2:1 sobre branco, abaixo dos 3:1 de WCAG 1.4.11).
 * Par validado para daltonismo sobre o branco do cartão: ΔE 16,2 (deuteranopia), contraste ≥ 3:1.
 * (Verde musgo + carmesim reprovava: ΔE 5,8 para deuteranopia.)
 */
export const coresGrafico = {
  entradas: cores.secundaria,
  despesas: "#B08A2A",
} as const;

export const tipografia = {
  titulos: {
    familia: "Playfair Display",
    fallback: ["Georgia", "Times New Roman", "serif"],
    pesos: [400, 500, 600, 700, 800],
  },
  textos: {
    familia: "Montserrat",
    fallback: ["system-ui", "Segoe UI", "Arial", "sans-serif"],
    pesos: [400, 500, 600, 700],
  },
  /**
   * Caligráfica da assinatura "Feito com amor, para você." (como no painel de identidade).
   * Só para a assinatura: nunca em texto corrido, botões ou rótulos.
   */
  assinatura: {
    familia: "Parisienne",
    fallback: ["Brush Script MT", "cursive"],
    pesos: [400],
  },
} as const;

/** URL do Google Fonts com as famílias e todos os pesos usados (o globals.css importa esta mesma lista). */
export const googleFontsUrl =
  "https://fonts.googleapis.com/css2" +
  `?family=${tipografia.textos.familia.replace(/ /g, "+")}:wght@${tipografia.textos.pesos.join(";")}` +
  `&family=${tipografia.titulos.familia.replace(/ /g, "+")}:wght@${tipografia.titulos.pesos.join(";")}` +
  `&family=${tipografia.assinatura.familia.replace(/ /g, "+")}` +
  "&display=swap";

/**
 * Logo oficial, recortado do painel de identidade com o fundo removido (PNG transparente).
 * Quando houver o arquivo vetorial (SVG/PDF) do logo, substitua mantendo os caminhos.
 */
export const logos = {
  /** Potinho com coração + "Geleiô" + "GELEIAS ARTESANAIS" + filete com coração (1061×1066, exibido a 430×432). */
  principal: { src: "/marca/logo-geleio.png", largura: 430, altura: 432 },
  /** Potinho com coração + "Geleiô" (1048×821, exibido a 430×337): cabeçalho. */
  cabecalho: { src: "/marca/logo-geleio-topo.png", largura: 430, altura: 337 },
} as const;

/**
 * Símbolos da marca. São MARCADORES DE POSIÇÃO (SVGs simples em /public):
 * substitua os arquivos pelos vetores oficiais mantendo os mesmos caminhos.
 */
export const simbolos = {
  framboesas: {
    src: "/simbolos/framboesas.svg",
    alt: "Framboesas",
    placeholder: true,
  },
  coracao: {
    src: "/simbolos/coracao.svg",
    alt: "Coração",
    placeholder: true,
  },
  selo: {
    src: "/simbolos/selo-feito-com-amor.svg",
    alt: 'Selo "Feito com Amor"',
    placeholder: true,
  },
} as const;

export type NomeSimbolo = keyof typeof simbolos;

export type IconeDeMarca = "folha" | "coracao" | "colher" | "ramo" | "framboesa";

/** "Aplicações de marca": os quatro compromissos do painel de identidade, na mesma ordem. */
export const aplicacoesDeMarca = [
  { icone: "folha", titulo: "Ingredientes selecionados" },
  { icone: "colher", titulo: "Receita artesanal" },
  { icone: "ramo", titulo: "Sem conservantes" },
  { icone: "framboesa", titulo: "Sabor que encanta" },
] as const satisfies readonly { icone: IconeDeMarca; titulo: string }[];

/** Converte "#RRGGBB" em "rgb(r g b / alpha)". */
export function hexParaRgb(hex: string, alpha = 1): string {
  const valor = hex.replace("#", "");
  const r = parseInt(valor.slice(0, 2), 16);
  const g = parseInt(valor.slice(2, 4), 16);
  const b = parseInt(valor.slice(4, 6), 16);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * Padrão xadrez "gingham": duas listras translúcidas que se cruzam, deixando
 * os quadrados de interseção mais escuros — o efeito clássico de toalha.
 */
export function gingham({
  cor = cores.primaria,
  opacidade = 0.5,
  fundo = cores.destaque,
  tamanho = 20,
}: {
  cor?: string;
  opacidade?: number;
  fundo?: string;
  tamanho?: number;
} = {}) {
  const listra = hexParaRgb(cor, opacidade);
  return {
    backgroundColor: fundo,
    backgroundImage: [
      `linear-gradient(90deg, ${listra} 50%, transparent 50%)`,
      `linear-gradient(${listra} 50%, transparent 50%)`,
    ].join(", "),
    backgroundSize: `${tamanho}px ${tamanho}px`,
  };
}

export const padroes = {
  /** Xadrez vinho marcado — bordas e faixas decorativas */
  gingham: gingham({ opacidade: 0.5, tamanho: 20 }),
  /** Xadrez vinho muito discreto — fundo sutil de seções */
  ginghamSuave: gingham({ opacidade: 0.07, tamanho: 28 }),
} as const;

export const designSystem = { marca, cores, tipografia, simbolos, padroes } as const;
export default designSystem;
