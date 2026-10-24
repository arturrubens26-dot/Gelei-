"use client";

import { useId, useState, type ReactNode } from "react";
import { TITULO_DESTAQUES, TITULO_HARMONIZACOES } from "@/lib/produtos-regras";

/**
 * Foto do pote que vira e mostra o verso, com as harmonizações e o "Por que você vai gostar".
 * Só o quadrado da foto vira: o preço e o "Adicionar ao Carrinho" ficam fora e nunca somem.
 *
 * Acessibilidade: um único <button> cobre o quadrado nos dois lados (o foco não se perde ao virar),
 * no padrão de divulgação (aria-expanded + aria-controls). O nome é fixo e quem muda é o estado; o
 * verso vem logo depois no DOM, então o leitor de tela o lê em seguida. Enter e Espaço viram (é um
 * botão), Esc desvira. A face escondida fica `inert` (fora do Tab e do leitor de tela).
 *
 * O giro é só CSS (`.verso-da-foto` no globals.css): com "reduzir movimento" a troca é na hora.
 * As etiquetas "Harmonizações" e "Ver a foto" são impressas em cada face (giram junto) e decorativas.
 * O texto escala com a largura do quadrado (unidades cqw), para caber de ~260 px a ~370 px.
 */
export function FotoComVerso({
  sabor,
  descricao,
  harmonizacoes,
  destaques,
  children,
}: {
  /** "Pimenta": vai no nome do botão. */
  sabor: string;
  /** A descrição do sabor: fica no verso, no lugar de aparecer sob a foto. */
  descricao?: string;
  harmonizacoes: string[];
  destaques: string[];
  /** A foto (FotoDoPote), renderizada no servidor. */
  children: ReactNode;
}) {
  const [virado, setVirado] = useState(false);
  // useId: com Cache Components a página anterior fica montada (escondida) e ids fixos repetiriam.
  const idVerso = `${useId()}-verso`;

  return (
    <div className="verso-da-foto group relative aspect-square @container" data-virado={virado || undefined}>
      <button
        type="button"
        aria-expanded={virado}
        aria-controls={idVerso}
        onClick={() => setVirado((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && virado) {
            e.preventDefault();
            setVirado(false);
          }
        }}
        className="absolute inset-0 z-10 cursor-pointer touch-manipulation rounded-sm"
      >
        <span className="sr-only">Sobre o sabor e harmonizações: {sabor}</span>
      </button>

      <div className="virador">
        <div className="face frente rounded-sm bg-[#f3ece3]" inert={virado}>
          {children}
          <Etiqueta>
            <IconeVirar />
            Sobre o sabor
          </Etiqueta>
        </div>

        <div
          id={idVerso}
          inert={!virado}
          className="face verso flex flex-col justify-center gap-[4cqw] rounded-sm bg-destaque px-[6cqw] pt-[5cqw] pb-[10cqw] text-left text-primaria shadow-[inset_0_0_0_4px_#fff7ee,inset_0_0_0_5px_rgb(212_175_55/0.55)]"
        >
          {descricao && (
            <p className="line-clamp-5 min-w-0 text-[clamp(0.75rem,4.2cqw,0.95rem)] leading-[1.35]">{descricao}</p>
          )}
          {descricao && (harmonizacoes.length > 0 || destaques.length > 0) && <Divisoria />}
          {harmonizacoes.length > 0 && <Lista titulo={TITULO_HARMONIZACOES} itens={harmonizacoes} />}
          {harmonizacoes.length > 0 && destaques.length > 0 && <Divisoria />}
          {destaques.length > 0 && <Lista titulo={TITULO_DESTAQUES} itens={destaques} />}
          <Etiqueta>
            <IconeVirar invertido />
            Ver a foto
          </Etiqueta>
        </div>
      </div>
    </div>
  );
}

function Divisoria() {
  return <span aria-hidden="true" className="mx-auto block h-px w-1/4 shrink-0 bg-accent2/70" />;
}

function Lista({ titulo, itens }: { titulo: string; itens: string[] }) {
  return (
    <div className="min-w-0">
      <p className="font-titulos text-[clamp(0.9375rem,5.4cqw,1.2rem)] leading-tight font-semibold">{titulo}</p>
      <ul className="mt-[1.5cqw] flex flex-col gap-[0.8cqw] text-[clamp(0.6875rem,4cqw,0.9rem)] leading-[1.3]">
        {itens.map((item) => (
          <li key={item} className="flex gap-[2cqw]">
            <span aria-hidden="true" className="mt-[0.5em] size-[0.4em] shrink-0 rounded-full bg-secundaria" />
            <span className="line-clamp-2 min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Etiqueta no canto de baixo da face: mostra que dá para virar (o nome do botão diz o mesmo). */
function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="absolute right-[3cqw] bottom-[3cqw] inline-flex items-center gap-1 rounded-full border border-accent2 bg-white/95 px-2.5 py-1 text-xs font-semibold text-primaria shadow-sm transition-colors group-hover:border-secundaria group-hover:bg-secundaria group-hover:text-destaque"
    >
      {children}
    </span>
  );
}

function IconeVirar({ invertido = false }: { invertido?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`size-3.5 ${invertido ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M14.5 2.8v3.6h-3.6" />
    </svg>
  );
}
