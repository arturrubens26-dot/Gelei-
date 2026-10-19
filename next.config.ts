import type { NextConfig } from "next";

const emProducao = process.env.NODE_ENV === "production";

const cabecalhosDeSeguranca = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // CSP parcial: bloqueia embutir o site em outro (clickjacking), <base>/<form> externos e plugins.
  // Uma CSP completa (script-src) pede nonces no Next e deve ser avaliada à parte.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  // Só em produção (HTTPS): HSTS, e uma CSP mais completa em modo Report-Only (reporta no console do
  // navegador, não bloqueia nada). Com a doc do Next 16.4: CSP com nonce exigiria renderização 100%
  // dinâmica e perderia o shell estático (PPR), então ficamos com 'unsafe-inline' em script/style.
  // Depois de verificar que não há violações reais, troque o nome para "Content-Security-Policy".
  ...(emProducao
    ? [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        {
          key: "Content-Security-Policy-Report-Only",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src https://fonts.gstatic.com",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Laço de recarga no `next dev` (Next 16.4.0): cada log do navegador (o "Download the React
  // DevTools" sai em toda página) é gravado em .next/dev/logs para o servidor MCP de agentes; com a
  // página conectada, o Turbopack recompila, manda recarregar, a página loga de novo, e o painel
  // recarregava ~2 vezes por segundo. Sem o MCP (ninguém usa aqui) não há gravação; sem o repasse ao
  // terminal, nem processamento do log. Reavaliar ao atualizar o Next (o dev server aponta a 16.4.2).
  logging: { browserToTerminal: false },
  experimental: { mcpServer: false },
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca }];
  },
  turbopack: {
    rules: {
      // Só o globals.css passa pelo Tailwind. Um "*.css" pegaria também os *.module.css e,
      // com `as: "*.css"`, eles virariam CSS global e perderiam as classes exportadas.
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
