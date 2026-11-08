"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviaColagem } from "./colar";

/**
 * Prévia de colar várias linhas do Excel: "12 novas, 3 alteradas, 1 com erro". As linhas com erro
 * não entram; as categorias que não existem podem ser criadas (ou ir para "Outros"). Diálogo nativo
 * (<dialog> modal: prende o foco e fecha no Esc).
 */
export function DialogoColar({
  previa,
  aoConfirmar,
  aoCancelar,
}: {
  previa: PreviaColagem;
  aoConfirmar: (criarCategorias: boolean) => Promise<string | null>;
  aoCancelar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [criar, setCriar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const total = previa.novas + previa.alteradas;
  const comErro = previa.linhas.filter((l) => l.erros.length);

  return (
    <dialog
      ref={ref}
      aria-labelledby="titulo-colar"
      onCancel={(e) => {
        e.preventDefault();
        if (!ocupado) aoCancelar();
      }}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border-2 border-primaria bg-white p-0 text-primaria backdrop:bg-primaria/40"
    >
      <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5">
        <h2 id="titulo-colar" className="text-2xl font-bold">
          Colar do Excel
        </h2>
        {previa.erroGeral ? (
          <p role="alert" className="font-semibold text-[#8C1D18]">
            {previa.erroGeral}
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2 text-base">
              <li className="rounded-full bg-accent1/40 px-3 py-1 font-semibold">{previa.novas} {previa.novas === 1 ? "linha nova" : "linhas novas"}</li>
              <li className="rounded-full bg-accent1/40 px-3 py-1 font-semibold">{previa.alteradas} {previa.alteradas === 1 ? "alterada" : "alteradas"}</li>
              {previa.comErro > 0 && <li className="rounded-full bg-[#FDECEA] px-3 py-1 font-semibold text-[#8C1D18]">{previa.comErro} com erro (não entram)</li>}
              {previa.puladas > 0 && <li className="rounded-full bg-[#F3EEE8] px-3 py-1">{previa.puladas} vendas do sistema puladas</li>}
            </ul>
            {previa.cabecalho && <p className="text-sm">A primeira linha tinha os nomes das colunas: casei as colunas pelos nomes e as linhas entram como novas.</p>}
            {previa.categoriasNovas.length > 0 && (
              <div className="rounded-md border border-primaria/30 p-3">
                <p className="font-semibold">Categorias que ainda não existem: {previa.categoriasNovas.map((c) => `“${c.nome}” (${c.tipo === "SAIDA" ? "saída" : "entrada"})`).join(", ")}.</p>
                <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="checkbox" className="size-5 accent-secundaria" checked={criar} onChange={(e) => setCriar(e.target.checked)} />
                  Criar essas categorias (senão, as linhas vão para “Outros” / “Outras entradas”)
                </label>
              </div>
            )}
            {comErro.length > 0 && (
              <div>
                <h3 className="font-textos text-base font-bold">Linhas com erro</h3>
                <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-sm">
                  {comErro.slice(0, 50).map((l) => (
                    <li key={l.origem}>
                      Linha {l.origem} do que foi colado: {l.erros.join("; ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-primaria/85">Depois de colar, um Ctrl+Z (ou o botão Desfazer) volta tudo de uma vez.</p>
          </>
        )}
        {erro && (
          <p role="alert" className="font-semibold text-[#8C1D18]">
            {erro}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secundario" onClick={aoCancelar} disabled={ocupado}>
            Cancelar
          </button>
          {!previa.erroGeral && total > 0 && (
            <button
              type="button"
              className="btn-primario"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const falha = await aoConfirmar(criar);
                setOcupado(false);
                if (falha) setErro(falha);
              }}
            >
              {ocupado ? "Colando…" : `Colar ${total} ${total === 1 ? "linha" : "linhas"}`}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
