import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Ornamento } from "@/components/marca/Ornamento";
import { logos, marca } from "@/design-system";

/**
 * Tela de aviso de página inteira (404, erro, link vencido): o pote ilustrado, o título em
 * Playfair, o filete com coração e as ações. Sem hooks nem dados do servidor, então serve tanto
 * para o `not-found` (servidor) quanto para os `error.tsx` (cliente).
 *
 * - `pote="vazio"`: o pote fechado e quase vazio (página que não existe).
 * - `pote="destampado"`: a tampa torta e a geleia escorrendo (algo falhou).
 */
export function TelaDeAviso({
  titulo,
  pote,
  children,
  acoes,
  rodape,
}: {
  titulo: string;
  pote: "vazio" | "destampado";
  /** Texto principal (um ou dois parágrafos curtos). */
  children: ReactNode;
  /** Botões e links principais. */
  acoes: ReactNode;
  /** Linha discreta abaixo das ações (contato, código do erro). */
  rodape?: ReactNode;
}) {
  return (
    // Sem id fixo: com Cache Components a rota anterior continua montada (escondida) e ids repetiriam.
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-14 text-center sm:py-20">
      <PoteIlustrado variante={pote} />
      <h1 className="mt-6 font-titulos text-4xl leading-tight font-semibold text-balance text-primaria sm:text-5xl">
        {titulo}
      </h1>
      <Ornamento className="mt-4" />
      <div className="mt-5 flex max-w-prose flex-col gap-3 leading-relaxed text-primaria/85">{children}</div>
      <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">{acoes}</div>
      {rodape && <div className="mt-8 flex flex-col gap-1 text-sm text-primaria/80">{rodape}</div>}
    </div>
  );
}

/** Cabeçalho mínimo (só o logo) para as telas que ficam fora do layout da loja. */
export function TopoSimples() {
  return (
    <header className="border-b border-accent2/50 bg-destaque">
      <div className="mx-auto flex max-w-6xl items-center px-4 py-2 sm:px-6">
        <Link href="/" className="shrink-0" aria-label={`${marca.nome} — ${marca.slogan}. Ir para a página inicial`}>
          <Image
            src={logos.cabecalho.src}
            alt=""
            width={logos.cabecalho.largura}
            height={logos.cabecalho.altura}
            sizes="140px"
            className="h-16 w-auto sm:h-20"
          />
        </Link>
      </div>
    </header>
  );
}

/** Pote de geleia desenhado (decorativo): vidro com contorno vinho, tampa dourada e o rótulo com coração. */
function PoteIlustrado({ variante }: { variante: "vazio" | "destampado" }) {
  const destampado = variante === "destampado";
  return (
    <svg viewBox="0 0 120 140" className="h-32 w-auto sm:h-36" aria-hidden="true">
      {/* Vidro */}
      <path
        d="M24 42q0-6 6-6h60q6 0 6 6v72q0 16-16 16H40q-16 0-16-16Z"
        className="fill-white stroke-primaria"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Geleia: um restinho no fundo (vazio) ou o pote cheio até a metade (destampado). */}
      {destampado ? (
        <path d="M27 84h66v30q0 13-13 13H40q-13 0-13-13Z" className="fill-secundaria/85" />
      ) : (
        <path d="M28 119h64q-2 8-12 8H40q-10 0-12-8Z" className="fill-secundaria/70" />
      )}
      {/* Rótulo */}
      <rect x="34" y="60" width="52" height="30" rx="2" className="fill-destaque stroke-accent2" strokeWidth="1.5" />
      <path
        d="M60 82.5l-1.1-1C55 78 52.5 75.7 52.5 72.9c0-2.3 1.8-4.1 4.1-4.1 1.3 0 2.6.6 3.4 1.6.8-1 2.1-1.6 3.4-1.6 2.3 0 4.1 1.8 4.1 4.1 0 2.8-2.5 5.1-6.4 8.6Z"
        className="fill-secundaria"
      />
      {/* Gargalo */}
      <rect x="32" y="30" width="56" height="8" rx="2" className="fill-white stroke-primaria" strokeWidth="2.5" />
      {destampado && (
        // Geleia escorrendo da boca do pote, por fora do vidro.
        <path d="M70 30h14v14q0 4-3 4t-3-4v-4q0-2-2-2t-2 2v10q0 4-3 4t-3-4V34q0-4 2-4Z" className="fill-secundaria" />
      )}
      {/* Tampa: fechada, ou torta e levantada. */}
      <g transform={destampado ? "rotate(-16 28 28) translate(-4 -8)" : undefined}>
        <rect x="28" y="12" width="64" height="18" rx="4" className="fill-accent2 stroke-primaria" strokeWidth="2.5" />
        <path d="M34 18.5h52M34 23.5h52" className="stroke-primaria/45" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
