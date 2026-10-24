import type { ReactNode } from "react";
import type { NomeDoIcone } from "@/components/admin/menu/itens";

/**
 * Ícones em traço do menu do painel (o mesmo desenho do ícone do WhatsApp: 24 × 24, traço de 1,8,
 * pontas redondas, cor do texto). Vetoriais e decorativos: o nome do item vem do texto ao lado.
 */
const TRACOS: Record<NomeDoIcone | "pino" | "loja" | "menu" | "fechar", ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
    </>
  ),
  pedidos: (
    <>
      <path d="M5.5 8h13l-1 12h-11l-1-12Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  balcao: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 9.5v.01M17.5 14.5v.01" />
    </>
  ),
  encomendas: (
    <>
      <rect x="3.5" y="9" width="17" height="4" rx="1" />
      <path d="M5 13v7.5h14V13M12 9v11.5" />
      <path d="M12 9C11 5.5 7 5 7 7.3 7 8.6 9 9 12 9Zm0 0c1-3.5 5-4 5-1.7 0 1.3-2 1.7-5 1.7Z" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.4-3.3 3-5.2 6-5.2s5.6 1.9 6 5.2" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M17.5 14.4c2.4.3 3.9 2 4.2 4.6" />
    </>
  ),
  produtos: (
    <>
      <rect x="6" y="3.5" width="12" height="3.5" rx="1" />
      <path d="M7 7v1.5C5.5 9.5 5 10.5 5 12v6.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V12c0-1.5-.5-2.5-2-3.5V7" />
      <path d="M8.5 13.5h7" />
    </>
  ),
  kits: (
    <>
      <path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9L12 3Z" />
      <path d="M3.8 7.7 12 12l8.2-4.3M12 12v9" />
    </>
  ),
  producoes: (
    <>
      <path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5Z" />
      <path d="M2.5 11h19M7 7.5c0-1 1-1.2 1-2.2M12 7.5c0-1 1-1.2 1-2.2M17 7.5c0-1 1-1.2 1-2.2" />
    </>
  ),
  estoque: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M4.5 8.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.5M9.5 12.5h5" />
    </>
  ),
  financeiro: <path d="M4 4v16h16M8 16v-4M12.5 16V8M17 16v-6" />,
  despesas: (
    <>
      <path d="M6 3.5h12V21l-2.2-1.5L13.6 21l-2.2-1.5L9.2 21 7 19.5 6 20.2V3.5Z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  entrega: (
    <>
      <path d="M2.5 6.5h11v10h-11v-10Z" />
      <path d="M13.5 10h4l3 3v3.5h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  ajustes: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  pino: (
    <>
      <path d="M9 3.5h6L14 9l3 3.5H7L10 9 9 3.5Z" />
      <path d="M12 12.5v8" />
    </>
  ),
  loja: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.6 2.6 0 0 0 5.3 0 2.6 2.6 0 0 0 5.4 0 2.6 2.6 0 0 0 5.3 0M5.5 12.5V20h13v-7.5" />
      <path d="M10 20v-4.5h4V20" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  fechar: <path d="m6 6 12 12M18 6 6 18" />,
};

export function IconeDoPainel({ nome, className = "size-5" }: { nome: keyof typeof TRACOS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {TRACOS[nome]}
    </svg>
  );
}
