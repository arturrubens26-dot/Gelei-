"use client";

import { useId, useState } from "react";
import { carregarLancamentos } from "./api";
import { baixar, gerarCsvLancamentos, gerarXlsx, montarAbas, nomeDoArquivo } from "./exportar";

/**
 * "Baixar no Excel": o período na tela, com o que está SALVO (antes, grava o que estiver pendente).
 * Sem nome de cliente, a não ser que ela marque (proteção de dados). O SheetJS só carrega no clique.
 */
export function BotaoExportar({ de, ate, antes }: { de: string; ate: string; antes: () => Promise<number> }) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [comNomes, setComNomes] = useState(false);
  const [ocupado, setOcupado] = useState<"xlsx" | "csv" | null>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);

  async function exportar(formato: "xlsx" | "csv") {
    setOcupado(formato);
    setMensagem(null);
    try {
      const naoSalvas = await antes();
      const r = await carregarLancamentos({ de, ate }, comNomes);
      if (!r.ok) return setMensagem({ texto: r.erro, erro: true });
      const abas = montarAbas(r.dados, comNomes);
      const nome = nomeDoArquivo(de, ate);
      if (formato === "xlsx") {
        const XLSX = await import("xlsx");
        baixar(`${nome}.xlsx`, gerarXlsx(XLSX, abas) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      } else {
        baixar(`${nome}.csv`, gerarCsvLancamentos(abas), "text/csv;charset=utf-8");
      }
      setMensagem({
        texto: `Arquivo ${nome}.${formato} baixado com ${r.dados.linhas.length} ${r.dados.linhas.length === 1 ? "lançamento" : "lançamentos"}.${
          naoSalvas ? ` Atenção: ${naoSalvas} ${naoSalvas === 1 ? "linha ainda não salva ficou" : "linhas ainda não salvas ficaram"} de fora.` : ""
        }${r.dados.truncado ? " O período tem mais de 5.000 lançamentos: escolha um período menor para levar tudo." : ""}`,
      });
    } catch {
      setMensagem({ texto: "Não foi possível montar o arquivo. Tente de novo.", erro: true });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="relative">
      <button type="button" className="btn-secundario" aria-expanded={aberto} aria-controls={`${id}-painel`} onClick={() => setAberto((v) => !v)}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
        </svg>
        Baixar no Excel
      </button>
      {aberto && (
        <div
          id={`${id}-painel`}
          className="absolute right-0 z-30 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-md border-2 border-primaria/60 bg-white p-4 shadow-lg"
        >
          <p className="text-sm">O período na tela, com o que está salvo, em 5 abas: Lançamentos, Resumo mensal, Por categoria, Resultado diário e Categorias.</p>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-secundaria" checked={comNomes} onChange={(e) => setComNomes(e.target.checked)} />
            <span>
              Incluir o nome dos clientes nas vendas
              <span className="block text-xs text-primaria/80">Deixe desmarcado se o arquivo for para outra pessoa (proteção de dados).</span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primario" disabled={!!ocupado} onClick={() => void exportar("xlsx")}>
              {ocupado === "xlsx" ? "Montando…" : "Baixar .xlsx"}
            </button>
            <button type="button" className="btn-secundario" disabled={!!ocupado} onClick={() => void exportar("csv")}>
              {ocupado === "csv" ? "Montando…" : "Baixar .csv"}
            </button>
          </div>
          <p role="status" className={`text-sm ${mensagem?.erro ? "font-semibold text-[#8C1D18]" : ""}`}>
            {mensagem?.texto}
          </p>
        </div>
      )}
    </div>
  );
}
