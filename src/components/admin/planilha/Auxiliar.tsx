"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { CATEGORIAS_DESPESA, ROTULO_CATEGORIA, type CategoriaDespesa } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import type { CategoriaDTO, ConfigFinanceiroDTO, ItemHistoricoDTO, TipoLancamento } from "@/lib/planilha/tipos";
import { alterarCategoria, criarCategoria, excluirCategoria, lerConfig, lerHistorico, listarCategorias, salvarConfig } from "./api";
import { formatarData, lerValor } from "./modelo";

const quando = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });

/**
 * Aba Auxiliar (como a guia "Auxiliar" da planilha dela): as categorias de saída e de entrada
 * (criar, renomear, reordenar, desativar), o saldo inicial da conta e o histórico de alterações
 * (quem lançou, alterou ou excluiu o quê). Carrega ao abrir a aba.
 */
export function Auxiliar({ ativa }: { ativa: boolean }) {
  const [recarga, setRecarga] = useState(0);
  const [categorias, setCategorias] = useState<CategoriaDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState({ texto: "", n: 0 });
  const avisar = (texto: string) => setAviso((a) => ({ texto, n: a.n + 1 }));

  useEffect(() => {
    if (!ativa) return;
    let cancelado = false;
    listarCategorias().then((r) => {
      if (cancelado) return;
      if (r.ok) {
        setCategorias(r.dados.categorias);
        setErro(null);
      } else setErro(r.erro);
    });
    return () => {
      cancelado = true;
    };
  }, [ativa, recarga]);

  function trocar(c: CategoriaDTO) {
    setCategorias((lista) => (lista ?? []).map((x) => (x.id === c.id ? c : x)));
  }

  return (
    <div className="flex flex-col gap-6 pt-4">
      <p role="status" aria-live="polite" className="sr-only" key={aviso.n}>
        {aviso.texto}
      </p>
      {erro && (
        <p role="alert" className="rounded-lg border-2 border-[#B3261E] bg-white p-3 font-semibold text-[#8C1D18]">
          {erro}{" "}
          <button type="button" className="underline" onClick={() => setRecarga((n) => n + 1)}>
            Tentar de novo
          </button>
        </p>
      )}
      {!categorias && !erro && (
        <div className="h-64 animate-pulse rounded-md bg-accent1/30" role="status">
          <span className="sr-only">Carregando…</span>
        </div>
      )}
      {categorias && (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <ListaCategorias
            tipo="SAIDA"
            categorias={categorias}
            aoTrocar={trocar}
            aoCriar={(c) => setCategorias((l) => [...(l ?? []), c])}
            aoExcluir={(id) => setCategorias((l) => (l ?? []).filter((x) => x.id !== id))}
            avisar={avisar}
          />
          <ListaCategorias
            tipo="ENTRADA"
            categorias={categorias}
            aoTrocar={trocar}
            aoCriar={(c) => setCategorias((l) => [...(l ?? []), c])}
            aoExcluir={(id) => setCategorias((l) => (l ?? []).filter((x) => x.id !== id))}
            avisar={avisar}
          />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <SaldoInicial ativa={ativa} avisar={avisar} />
        <Historico ativa={ativa} categorias={categorias ?? []} />
      </div>
    </div>
  );
}

const botaoPequeno =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border-2 border-primaria/30 bg-white px-2 text-sm font-semibold text-primaria hover:bg-accent1/40 disabled:cursor-not-allowed disabled:opacity-40";

function ListaCategorias({
  tipo,
  categorias,
  aoTrocar,
  aoCriar,
  aoExcluir,
  avisar,
}: {
  tipo: TipoLancamento;
  categorias: CategoriaDTO[];
  aoTrocar: (c: CategoriaDTO) => void;
  aoCriar: (c: CategoriaDTO) => void;
  aoExcluir: (id: string) => void;
  avisar: (m: string) => void;
}) {
  const id = useId();
  const lista = categorias.filter((c) => c.tipo === tipo && !c.sistema).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
  const sistema = categorias.filter((c) => c.tipo === tipo && c.sistema);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nova, setNova] = useState({ nome: "", grupo: "OUTROS" as CategoriaDespesa, fora: false });
  const [erroNova, setErroNova] = useState<string | null>(null);
  const titulo = tipo === "SAIDA" ? "Saídas (gastos)" : "Entradas (ganhos)";

  async function mudar(c: CategoriaDTO, dados: Parameters<typeof alterarCategoria>[1], mensagem: string) {
    setOcupado(c.id);
    const r = await alterarCategoria(c.id, dados);
    setOcupado(null);
    if (r.ok) {
      aoTrocar(r.dados);
      setErros((e) => ({ ...e, [c.id]: "" }));
      avisar(mensagem);
    } else setErros((e) => ({ ...e, [c.id]: r.erro }));
  }

  async function mover(i: number, delta: -1 | 1) {
    const ativas = lista.filter((c) => c.ativo);
    const j = i + delta;
    if (j < 0 || j >= ativas.length) return;
    const nova = [...ativas];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setOcupado(nova[j].id);
    // Renumera de 10 em 10 (as semeadas podem ter a mesma ordem): só grava quem mudou.
    for (let n = 0; n < nova.length; n++) {
      const ordem = (n + 1) * 10;
      if (nova[n].ordem === ordem) continue;
      const r = await alterarCategoria(nova[n].id, { ordem });
      if (!r.ok) {
        setErros((e) => ({ ...e, [nova[n].id]: r.erro }));
        break;
      }
      aoTrocar(r.dados);
    }
    setOcupado(null);
    avisar(`“${ativas[i].nome}” foi para a posição ${j + 1}.`);
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    const nome = nova.nome.trim();
    if (!nome) return setErroNova("Digite o nome da categoria.");
    const r = await criarCategoria({ tipo, nome, ...(tipo === "SAIDA" ? { grupo: nova.grupo } : {}), foraDoResultado: nova.fora });
    if (!r.ok) return setErroNova(r.erro);
    aoCriar(r.dados);
    setNova({ nome: "", grupo: "OUTROS", fora: false });
    setErroNova(null);
    avisar(`Categoria “${r.dados.nome}” criada.`);
  }

  return (
    <section aria-labelledby={`${id}-t`} className="rounded-md border-2 border-primaria/70 bg-white">
      <h2 id={`${id}-t`} className="bg-primaria px-4 py-2.5 font-textos text-lg font-bold text-destaque">
        {titulo}
      </h2>
      <ul className="divide-y divide-primaria/15">
        {lista.map((c) => {
          const posicao = lista.filter((x) => x.ativo).findIndex((x) => x.id === c.id);
          return (
            <li key={c.id} className={`flex flex-col gap-2 px-3 py-3 ${c.ativo ? "" : "bg-[#F3EEE8]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <NomeEditavel
                  valor={c.nome}
                  rotulo={`Nome da categoria ${c.nome}`}
                  desativado={ocupado === c.id}
                  aoSalvar={(nome) => mudar(c, { nome }, `Categoria renomeada para “${nome}”.`)}
                />
                <span className="text-sm text-primaria/85">
                  {c.linhas} {c.linhas === 1 ? "lançamento" : "lançamentos"}
                  {c.ativo ? "" : " · desativada"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tipo === "SAIDA" && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">Grupo do relatório</span>
                    <select
                      className="campo w-auto min-w-44 py-1.5 text-sm"
                      value={c.grupo ?? "OUTROS"}
                      disabled={c.padrao || ocupado === c.id}
                      title={c.padrao ? "Categoria padrão: o grupo não muda" : undefined}
                      onChange={(e) => mudar(c, { grupo: e.target.value as CategoriaDespesa }, `Grupo de “${c.nome}” trocado.`)}
                    >
                      {CATEGORIAS_DESPESA.map((g) => (
                        <option key={g} value={g}>
                          {ROTULO_CATEGORIA[g]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-secundaria"
                    checked={c.foraDoResultado}
                    disabled={ocupado === c.id}
                    onChange={(e) =>
                      mudar(c, { foraDoResultado: e.target.checked }, e.target.checked ? `“${c.nome}” agora fica fora do lucro.` : `“${c.nome}” volta a contar no lucro.`)
                    }
                  />
                  Fora do lucro <span className="text-primaria/80">(aporte, retirada)</span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {c.ativo && (
                  <>
                    <button type="button" className={botaoPequeno} disabled={posicao <= 0 || !!ocupado} onClick={() => void mover(posicao, -1)} aria-label={`Subir ${c.nome}`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className={botaoPequeno}
                      disabled={posicao < 0 || posicao >= lista.filter((x) => x.ativo).length - 1 || !!ocupado}
                      onClick={() => void mover(posicao, 1)}
                      aria-label={`Descer ${c.nome}`}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={botaoPequeno}
                  disabled={ocupado === c.id}
                  onClick={() => mudar(c, { ativo: !c.ativo }, c.ativo ? `“${c.nome}” desativada: some das listas, os lançamentos ficam.` : `“${c.nome}” ativada.`)}
                >
                  {c.ativo ? "Desativar" : "Ativar"}
                </button>
                {c.linhas === 0 && !c.padrao && (
                  <button
                    type="button"
                    className={botaoPequeno}
                    disabled={ocupado === c.id}
                    onClick={async () => {
                      setOcupado(c.id);
                      const r = await excluirCategoria(c.id);
                      setOcupado(null);
                      if (r.ok) {
                        aoExcluir(c.id);
                        avisar(`Categoria “${c.nome}” excluída.`);
                      } else setErros((e) => ({ ...e, [c.id]: r.erro }));
                    }}
                  >
                    Excluir
                  </button>
                )}
              </div>
              {erros[c.id] && (
                <p role="alert" className="text-sm font-semibold text-[#8C1D18]">
                  {erros[c.id]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {sistema.length > 0 && (
        <p className="border-t border-primaria/15 bg-[#F3EEE8] px-4 py-2.5 text-sm">
          <strong>Automáticas</strong> (vêm das vendas, não se editam): {sistema.map((c) => c.nome).join(", ")}.
        </p>
      )}
      <form onSubmit={criar} className="flex flex-col gap-2 border-t-2 border-primaria/30 p-3" noValidate>
        <p className="font-semibold">Nova categoria de {tipo === "SAIDA" ? "saída" : "entrada"}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col text-sm font-semibold">
            Nome
            <input
              className="campo mt-1"
              maxLength={40}
              value={nova.nome}
              placeholder={tipo === "SAIDA" ? "ex.: Gás" : "ex.: Vendas na feira (fora do site)"}
              onChange={(e) => setNova((n) => ({ ...n, nome: e.target.value }))}
              aria-invalid={erroNova ? true : undefined}
              aria-describedby={erroNova ? `${id}-erro-nova` : undefined}
            />
          </label>
          {tipo === "SAIDA" && (
            <label className="flex flex-col text-sm font-semibold">
              Grupo do relatório
              <select className="campo mt-1 w-auto" value={nova.grupo} onChange={(e) => setNova((n) => ({ ...n, grupo: e.target.value as CategoriaDespesa }))}>
                {CATEGORIAS_DESPESA.map((g) => (
                  <option key={g} value={g}>
                    {ROTULO_CATEGORIA[g]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn-primario">
            Adicionar
          </button>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-secundaria" checked={nova.fora} onChange={(e) => setNova((n) => ({ ...n, fora: e.target.checked }))} />
          Fora do lucro (conta só no caixa, como aporte ou retirada)
        </label>
        {erroNova && (
          <p id={`${id}-erro-nova`} role="alert" className="text-sm font-semibold text-[#8C1D18]">
            {erroNova}
          </p>
        )}
      </form>
    </section>
  );
}

/** Nome que se edita no lugar: salva ao sair do campo ou com Enter; Esc volta o nome. */
function NomeEditavel({ valor, rotulo, desativado, aoSalvar }: { valor: string; rotulo: string; desativado: boolean; aoSalvar: (v: string) => void }) {
  const [texto, setTexto] = useState(valor);
  const [anterior, setAnterior] = useState(valor);
  if (valor !== anterior) {
    setAnterior(valor);
    setTexto(valor);
  }
  const salvar = () => {
    const t = texto.trim();
    if (!t) return setTexto(valor);
    if (t !== valor) aoSalvar(t.slice(0, 40));
  };
  return (
    <input
      aria-label={rotulo}
      className="campo min-w-0 flex-1 font-semibold sm:max-w-xs"
      maxLength={40}
      value={texto}
      disabled={desativado}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          salvar();
        } else if (e.key === "Escape") setTexto(valor);
      }}
    />
  );
}

function SaldoInicial({ ativa, avisar }: { ativa: boolean; avisar: (m: string) => void }) {
  const id = useId();
  const [config, setConfig] = useState<ConfigFinanceiroDTO | null>(null);
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!ativa) return;
    let cancelado = false;
    lerConfig().then((r) => {
      if (cancelado) return;
      if (!r.ok) return setErro(r.erro);
      setConfig(r.dados);
      setValor((r.dados.saldoInicialCentavos / 100).toFixed(2).replace(".", ","));
      setData(r.dados.saldoInicialEm ?? "");
    });
    return () => {
      cancelado = true;
    };
  }, [ativa]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    let centavos = 0;
    if (valor.trim() && valor.trim() !== "0") {
      const v = lerValor(valor);
      if (!v.ok) return setErro(v.erro);
      centavos = v.valor.negativo ? -v.valor.centavos : v.valor.centavos;
    }
    if (!data) return setErro("Escolha o dia do saldo (o 1º do mês em que começou a usar a planilha).");
    setOcupado(true);
    const r = await salvarConfig({ saldoInicialCentavos: centavos, saldoInicialEm: data });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setConfig(r.dados);
    setErro(null);
    avisar("Saldo inicial salvo.");
  }

  return (
    <section aria-labelledby={`${id}-t`} className="rounded-md border-2 border-primaria/70 bg-white">
      <h2 id={`${id}-t`} className="bg-primaria px-4 py-2.5 font-textos text-lg font-bold text-destaque">
        Saldo inicial da conta
      </h2>
      <form onSubmit={salvar} className="flex flex-col gap-3 p-4" noValidate>
        <p className="text-sm">
          Quanto tinha na conta da loja no <strong>dia 1º do mês</strong> em que começou a usar a planilha. A partir dele, a planilha mostra o
          saldo em caixa.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-sm font-semibold">
            Valor (R$)
            <input className="campo mt-1 tabular-nums" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" aria-describedby={erro ? `${id}-erro` : undefined} aria-invalid={erro ? true : undefined} />
          </label>
          <label className="flex flex-col text-sm font-semibold">
            No dia
            <input type="date" className="campo mt-1" min="2020-01-01" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-primaria/85">Conta no vermelho? Use o sinal de menos (−150,00).</p>
        {erro && (
          <p id={`${id}-erro`} role="alert" className="text-sm font-semibold text-[#8C1D18]">
            {erro}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primario" disabled={ocupado || !config}>
            {ocupado ? "Salvando…" : "Salvar saldo"}
          </button>
          {config?.saldoInicialEm && (
            <p className="text-sm text-primaria/85">
              Agora: {formatarBRL(config.saldoInicialCentavos / 100)} em {formatarData(config.saldoInicialEm)}
              {config.atualizadoPor ? ` · por ${config.atualizadoPor.nome.split(" ")[0]} em ${quando.format(new Date(config.atualizadoEm))}` : ""}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

const ACAO: Record<string, string> = {
  CRIOU: "lançou",
  ALTEROU: "alterou",
  EXCLUIU: "excluiu",
  IMPORTOU: "importou",
  DESFEZ_IMPORTACAO: "desfez a importação de",
  PROMOVEU_ADMIN: "deu acesso de admin a",
  REBAIXOU_ADMIN: "tirou o acesso de admin de",
};

const CAMPOS_HISTORICO: Record<string, string> = {
  data: "data",
  tipo: "tipo",
  categoriaId: "categoria",
  descricao: "descrição",
  valorCentavos: "valor",
  formaPagamento: "forma",
  observacao: "observação",
  quantidade: "quantidade",
  unidade: "unidade",
  fornecedor: "fornecedor",
  nome: "nome",
  ativo: "ativa",
  foraDoResultado: "fora do lucro",
  grupo: "grupo",
  ordem: "posição",
  saldoInicialCentavos: "saldo inicial",
  saldoInicialEm: "dia do saldo",
};

/** Um valor do histórico em texto ("R$ 12,50", "07/11/2026", nome da categoria…). */
function textoDoValor(campo: string, v: unknown, categorias: readonly CategoriaDTO[]): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if ((campo === "valorCentavos" || campo === "saldoInicialCentavos") && typeof v === "number") return formatarBRL(v / 100);
  if ((campo === "data" || campo === "saldoInicialEm") && typeof v === "string") return formatarData(v.slice(0, 10));
  if (campo === "categoriaId" && typeof v === "string") return categorias.find((c) => c.id === v)?.nome ?? v;
  if (campo === "tipo") return v === "ENTRADA" ? "Entrada" : "Saída";
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

export function frasesDoHistorico(item: ItemHistoricoDTO, categorias: readonly CategoriaDTO[]): { titulo: string; mudancas: string[] } {
  const quem = item.admin?.nome.split(" ")[0] ?? "Alguém";
  const acao = ACAO[item.acao] ?? item.acao.toLowerCase();
  const dados = (item.depois ?? item.antes ?? {}) as Record<string, unknown>;
  let alvo: string;
  if (item.entidade === "categoria") alvo = `a categoria “${String(dados.nome ?? "")}”`;
  else if (item.entidade === "config") alvo = "o saldo inicial";
  else if (item.entidade === "despesa" || item.entidade === "entrada") {
    const valor = typeof dados.valorCentavos === "number" ? ` (${formatarBRL(dados.valorCentavos / 100)})` : "";
    alvo = `${item.entidade === "entrada" ? "a entrada" : "a saída"} “${String(dados.descricao ?? "")}”${valor}`;
  } else alvo = item.entidade;
  const mudancas: string[] = [];
  if (item.acao === "ALTEROU" && item.antes && item.depois) {
    for (const [campo, rotulo] of Object.entries(CAMPOS_HISTORICO)) {
      const a = item.antes[campo];
      const d = item.depois[campo];
      if (JSON.stringify(a) !== JSON.stringify(d) && (a !== undefined || d !== undefined)) {
        mudancas.push(`${rotulo}: ${textoDoValor(campo, a, categorias)} → ${textoDoValor(campo, d, categorias)}`);
      }
    }
  }
  return { titulo: `${quem} ${acao} ${alvo}`, mudancas };
}

function Historico({ ativa, categorias }: { ativa: boolean; categorias: readonly CategoriaDTO[] }) {
  const id = useId();
  const [limite, setLimite] = useState(50);
  const [itens, setItens] = useState<ItemHistoricoDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ativa) return;
    let cancelado = false;
    lerHistorico({ limite }).then((r) => {
      if (cancelado) return;
      if (r.ok) setItens(r.dados.itens);
      else setErro(r.erro);
    });
    return () => {
      cancelado = true;
    };
  }, [ativa, limite]);

  return (
    <section aria-labelledby={`${id}-t`} className="rounded-md border-2 border-primaria/70 bg-white">
      <h2 id={`${id}-t`} className="bg-primaria px-4 py-2.5 font-textos text-lg font-bold text-destaque">
        Histórico de alterações
      </h2>
      <div className="p-4">
        <p className="mb-3 text-sm">Quem lançou, alterou ou excluiu o quê (as mais recentes primeiro). As vendas do site não aparecem aqui.</p>
        {erro && (
          <p role="alert" className="text-sm font-semibold text-[#8C1D18]">
            {erro}
          </p>
        )}
        {!itens && !erro && <p role="status">Carregando…</p>}
        {itens && itens.length === 0 && <p>Nada alterado ainda.</p>}
        {itens && itens.length > 0 && (
          <ol className="flex max-h-[28rem] flex-col divide-y divide-primaria/15 overflow-y-auto" tabIndex={0} aria-label="Lista do histórico">
            {itens.map((i) => {
              const f = frasesDoHistorico(i, categorias);
              return (
                <li key={i.id} className="py-2">
                  <p className="text-sm">
                    <span className="mr-2 font-semibold tabular-nums text-primaria/85">{quando.format(new Date(i.criadoEm))}</span>
                    {f.titulo}
                  </p>
                  {f.mudancas.length > 0 && <p className="text-sm text-primaria/85">{f.mudancas.join(" · ")}</p>}
                </li>
              );
            })}
          </ol>
        )}
        {itens && itens.length >= limite && limite < 200 && (
          <button type="button" className="btn-secundario mt-3" onClick={() => setLimite(200)}>
            Ver mais (até 200)
          </button>
        )}
      </div>
    </section>
  );
}
