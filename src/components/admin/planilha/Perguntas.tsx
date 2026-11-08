"use client";

import { formatarBRL } from "@/lib/dinheiro";
import type { FilaDeGravacao, LinhaGrade, Resposta } from "./filaDeGravacao";
import { formatarData } from "./modelo";

const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });

const botao = "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-sm font-semibold";
const principal = `${botao} border-secundaria bg-secundaria text-destaque hover:bg-primaria`;
const secundario = `${botao} border-secundaria bg-white text-secundaria hover:bg-accent1/40`;

/**
 * "Precisa da sua atenção": linhas que não salvaram ou que só ela pode decidir (outro admin mudou a
 * mesma linha, parece venda presencial, excluir tira do estoque). Fica acima da planilha, fora da
 * grade, com botões comuns (Tab chega neles).
 */
export function Perguntas({ linhas, fila, numeros }: { linhas: readonly LinhaGrade[]; fila: FilaDeGravacao; numeros: ReadonlyMap<string, number> }) {
  const comAtencao = linhas.filter((l) => l.pergunta || l.estado === "erro");
  if (!comAtencao.length) return null;
  const responder = (k: string, r: Resposta) => fila.responder(k, r);

  return (
    <section aria-labelledby="titulo-atencao" className="rounded-md border-2 border-[#B3261E] bg-[#FDECEA] p-4">
      <h2 id="titulo-atencao" className="font-textos text-lg font-bold text-[#8C1D18]">
        Precisa da sua atenção ({comAtencao.length})
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-[#B3261E]/30">
        {comAtencao.map((l) => {
          const n = numeros.get(l.k);
          const nome = `Linha ${n ?? "nova"}${l.campos.descricao ? ` (“${l.campos.descricao}”)` : ""}`;
          const p = l.pergunta;
          return (
            <li key={l.k} className="flex flex-col gap-2 py-3">
              {!p && l.erro && (
                <>
                  <p>
                    <strong>{nome} não salvou:</strong> {l.erro.mensagem}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={principal} onClick={() => fila.tentarDeNovo(l.k)}>
                      Tentar de novo
                    </button>
                  </div>
                </>
              )}
              {p?.tipo === "versao" && (
                <>
                  <p>
                    <strong>{nome}</strong> foi alterada por {p.atual.atualizadoPor?.nome.split(" ")[0] ?? "outra pessoa"}
                    {p.atual.atualizadoEm ? ` às ${hora.format(new Date(p.atual.atualizadoEm))}` : ""} enquanto você mexia. Como ficou:{" "}
                    {formatarData(p.atual.data)} · {p.atual.categoriaNome} · {p.atual.descricao} · {formatarBRL(p.atual.valorCentavos / 100)}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={secundario} onClick={() => responder(l.k, "usar-a-dele")}>
                      Usar a versão de {p.atual.atualizadoPor?.nome.split(" ")[0] ?? "lá"}
                    </button>
                    <button type="button" className={principal} onClick={() => responder(l.k, "manter-a-minha")}>
                      {p.acao === "excluir" ? "Excluir mesmo assim" : "Manter a minha"}
                    </button>
                  </div>
                </>
              )}
              {p?.tipo === "parece-venda" && (
                <>
                  <p>
                    <strong>{nome}</strong> parece uma venda que já entrou pelo sistema
                    {p.vendas[0] ? ` (${p.vendas[0].descricao}, ${formatarData(p.vendas[0].data)}, ${formatarBRL(p.vendas[0].valorCentavos / 100)})` : ""}.
                    Venda de geleia se lança em Venda presencial; aqui, só o que não passa pelo sistema. Lançar mesmo assim?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={secundario} onClick={() => responder(l.k, "apagar-linha")}>
                      Não lançar (apagar a linha)
                    </button>
                    <button type="button" className={principal} onClick={() => responder(l.k, "lancar-mesmo-assim")}>
                      Lançar mesmo assim
                    </button>
                  </div>
                </>
              )}
              {p?.tipo === "confirmar-estoque" && (
                <>
                  <p>
                    <strong>{nome}</strong> é uma compra que entrou no estoque da Produção. {p.mensagem}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={secundario} onClick={() => responder(l.k, "nao-excluir")}>
                      Não excluir
                    </button>
                    <button type="button" className={principal} onClick={() => responder(l.k, "excluir-mesmo-assim")}>
                      Excluir e tirar do estoque
                    </button>
                  </div>
                </>
              )}
              {p?.tipo === "sumiu" && (
                <>
                  <p>
                    <strong>{nome}</strong> foi excluída por outra pessoa enquanto você mexia.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={secundario} onClick={() => responder(l.k, "tirar-da-tela")}>
                      Tirar da tela
                    </button>
                    <button type="button" className={principal} onClick={() => responder(l.k, "recriar")}>
                      Lançar de novo
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
