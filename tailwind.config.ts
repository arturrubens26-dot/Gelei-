import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { cores, kraft, padroes, tipografia } from "./src/design-system";

const pilha = (fonte: { familia: string; fallback: readonly string[] }) => [
  `"${fonte.familia}"`,
  ...fonte.fallback,
];

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      // `kraft` vira `bg-kraft` / `bg-kraft-sombra` (caixa do kit).
      colors: { ...cores, kraft: { DEFAULT: kraft.base, sombra: kraft.sombra } },
      fontFamily: {
        titulos: pilha(tipografia.titulos),
        textos: pilha(tipografia.textos),
        assinatura: pilha(tipografia.assinatura),
      },
    },
  },
  plugins: [
    // Utilitários do padrão xadrez: `bg-gingham` e `bg-gingham-suave`.
    plugin(({ addUtilities }) => {
      addUtilities({
        ".bg-gingham": { ...padroes.gingham },
        ".bg-gingham-suave": { ...padroes.ginghamSuave },
      });
    }),
  ],
};

export default config;
