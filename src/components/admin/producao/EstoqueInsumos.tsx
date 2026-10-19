"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { formatarBRL } from "@/lib/dinheiro";
import { hojeNaLoja, lerQuantidade } from "@/lib/despesas";
import {
  NOME_UNIDADE_INSUMO,
  ROTULO_TIPO_INSUMO,
  SIGLA_INSUMO,
  TIPOS_INSUMO,
  UNIDADES_INSUMO,
  formatarCustoMedio,
  formatarQtdInsumo,
  gerarCsv,
  situacaoDoEstoque,
  type InsumoDTO,
  type SituacaoEstoque,
  type TipoInsumo,
  type UnidadeInsumo,
} from "@/lib/producao";
import { baixarCsv } from "./csv";

type FormInsumo = { nome: string; tipo: TipoInsumo; unidade: UnidadeInsumo; estoqueMinimo: string; controlaEstoque: boolean; ativo: boolean };
const INSUMO_VAZIO: FormInsumo = { nome: "", tipo: "INGREDIENTE", unidade: "G", estoqueMinimo: "", controlaEstoque: true, ativo: true };

type FormAjuste = { sentido: "sai" | "entra"; quantidade: string; motivo: string; data: string };

const ROTULO_SITUACAO: Record<SituacaoEstoque, string> = {
  ok: "Em dia",
  baixo: "Estoque baixo",
  acabou: "Acabou",
  negativo: "Falta lançar compra",
  "sem-controle": "Sem controle",
};
const ESTILO_SITUACAO: Record<SituacaoEstoque, string> = {
  ok: "border-accent3/60 text-primaria",
  baixo: "border-accent2 bg-accent2/15 text-primaria",
  acabou: "border-secundaria/60 bg-accent1/30 text-primaria",
  negativo: "border-secundaria bg-secundaria/10 font-semibold text-secundaria",
  "sem-controle": "border-primaria/20 text-primaria/75",
};

const botaoLinha =
  "inline-flex min-h-11 items-center rounded-full border-2 border-accent2 px-3 text-xs font-semibold text-primaria transition-colors hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Estoque de insumos: a "planilha" de ingredientes e embalagens, com cadastro e ajuste. */
export function EstoqueInsumos() {
  const id = useId();
  const [versao, setVersao] = useState(0);
  const [insumos, setInsumos] = useState<InsumoDTO[] | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [editando, setEditando] = useState<InsumoDTO | "novo" | null>(null);
  const [ajustando, setAjustando] = useState<InsumoDTO | null>(null);
  const [verInativos, setVerInativos] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/admin/supplies")
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        if (r.ok) {
          setInsumos(json.insumos);
          setErroCarga(null);
        } else setErroCarga(json?.erro ?? "Não foi possível carregar o estoque.");
      })
      .catch(() => !cancelado && setErroCarga("Sem conexão. Tente novamente."));
    return () => {
      cancelado = true;
    };
  }, [versao]);

  const visiveis = (insumos ?? []).filter((i) => verInativos || i.ativo);
  const valorTotal = visiveis.reduce((s, i) => s + i.valorEmEstoque, 0);
  const alertas = visiveis.filter((i) => ["baixo", "acabou", "negativo"].includes(situacaoDoEstoque(i)) && i.ativo);

  function exportar() {
    const linhas = visiveis.map((i) => [
      i.nome,
      i.tipo === "INGREDIENTE" ? "Ingrediente" : "Embalagem",
      SIGLA_INSUMO[i.unidade],
      i.controlaEstoque ? i.comprado : null,
      i.controlaEstoque ? i.usado : null,
      i.controlaEstoque ? i.ajustado : null,
      i.controlaEstoque ? i.sobra : null,
      i.custoMedio === null ? null : Number((i.unidade === "UN" ? i.custoMedio : i.custoMedio * 1000).toFixed(4)),
      i.valorEmEstoque,
      ROTULO_SITUACAO[situacaoDoEstoque(i)],
    ]);
    const csv = gerarCsv(
      ["Insumo", "Tipo", "Unidade", "Comprado", "Usado", "Ajustes", "Sobra", "Custo médio (R$ por kg, L ou un)", "Valor em estoque (R$)", "Situação"],
      linhas,
    );
    baixarCsv(`estoque-geleio-${hojeNaLoja()}.csv`, csv);
  }

  function aoSalvarInsumo(salvo: InsumoDTO, novo: boolean) {
    setEditando(null);
    setAviso({ tipo: "ok", texto: `${novo ? "Insumo cadastrado" : "Insumo atualizado"}: ${salvo.nome}.` });
    setVersao((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Resumo */}
      {insumos && (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
          <li className="cartao p-5">
            <p className="text-sm font-medium text-primaria/85">Valor parado em estoque</p>
            <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{formatarBRL(valorTotal)}</p>
            <p className="mt-1 text-xs text-primaria/80">sobra × custo médio de cada insumo</p>
          </li>
          <li className="cartao p-5">
            <p className="text-sm font-medium text-primaria/85">Precisam de atenção</p>
            <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{alertas.length}</p>
            <p className="mt-1 text-xs text-primaria/80">
              {alertas.length === 0 ? "nada acabando" : alertas.map((i) => i.nome).slice(0, 3).join(", ") + (alertas.length > 3 ? "…" : "")}
            </p>
          </li>
        </ul>
      )}

      <section aria-labelledby={`${id}-titulo`} className="cartao p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={`${id}-titulo`} className="text-2xl font-bold">
              Estoque de insumos
            </h2>
            <p className="mt-1 max-w-prose text-xs text-primaria/75">
              As compras entram aqui quando você lança a despesa em{" "}
              <Link href="/admin/expenses" className="font-semibold text-secundaria underline underline-offset-2">
                Despesas
              </Link>{" "}
              escolhendo o insumo. O que cada produção usa sai daqui. Sobra = comprado − usado ± ajustes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primario" onClick={() => { setEditando("novo"); setAjustando(null); }}>
              Novo insumo
            </button>
            <button type="button" className="btn-secundario" onClick={exportar} disabled={!insumos || visiveis.length === 0}>
              Baixar planilha
            </button>
          </div>
        </div>

        <p role="status" aria-live="polite" className={`mt-3 min-h-5 text-sm font-medium ${aviso?.tipo === "erro" ? "text-secundaria" : ""}`}>
          {aviso?.texto}
        </p>

        {editando && (
          <FormularioInsumo
            key={editando === "novo" ? "novo" : editando.id}
            inicial={editando === "novo" ? null : editando}
            onCancelar={() => setEditando(null)}
            onSalvo={aoSalvarInsumo}
          />
        )}
        {ajustando && (
          <FormularioAjuste
            key={ajustando.id}
            insumo={ajustando}
            onCancelar={() => setAjustando(null)}
            onSalvo={(i) => {
              setAjustando(null);
              setAviso({ tipo: "ok", texto: `Estoque de ${i.nome} ajustado: sobra agora ${formatarQtdInsumo(i.sobra, i.unidade)}.` });
              setVersao((v) => v + 1);
            }}
          />
        )}

        {erroCarga && (
          <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria">
            <span>{erroCarga}</span>
            <button type="button" className="btn-secundario" onClick={() => setVersao((v) => v + 1)}>
              Tentar de novo
            </button>
          </div>
        )}

        {!insumos && !erroCarga && (
          <div className="mt-4 h-40 animate-pulse rounded-xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando o estoque…</span>
          </div>
        )}

        {insumos && visiveis.length === 0 && (
          <p className="py-10 text-center text-sm text-primaria/80">
            Nenhum insumo ainda. Cadastre os ingredientes (maçã, açúcar, pimenta…) e as embalagens (pote, tampa, rótulo).
          </p>
        )}

        {insumos && visiveis.length > 0 && (
          <div role="region" aria-label="Planilha do estoque de insumos" tabIndex={0} className="relative mt-4 overflow-x-auto">
            <table className="w-full min-w-4xl text-left text-sm">
              <caption className="sr-only">Estoque de insumos</caption>
              <thead className="border-b-2 border-accent2/60">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">Insumo</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Comprado</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Usado</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Ajustes</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Sobra</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Custo médio</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Valor em estoque</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent1/70">
                {visiveis.map((i) => {
                  const situacao = situacaoDoEstoque(i);
                  const q = (v: number) => (i.controlaEstoque ? formatarQtdInsumo(v, i.unidade) : "—");
                  return (
                    <tr key={i.id}>
                      {/* Inativo vira etiqueta (com opacidade o texto caía abaixo de 4,5:1). A coluna do nome
                          fica presa à esquerda: no celular a tabela rola de lado e o nome não some. */}
                      <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold">
                        {i.nome}
                        {!i.ativo && (
                          <span className="ml-1.5 inline-flex rounded-full border border-primaria/40 px-1.5 text-[11px] font-semibold uppercase tracking-wide">
                            inativo
                          </span>
                        )}
                        <span className="block text-xs font-normal text-primaria/75">
                          {i.tipo === "INGREDIENTE" ? "Ingrediente" : "Embalagem"} · {SIGLA_INSUMO[i.unidade]}
                        </span>
                      </th>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{q(i.comprado)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{q(i.usado)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{i.ajustado === 0 ? "—" : q(i.ajustado)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{q(i.sobra)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatarCustoMedio(i.custoMedio, i.unidade)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{i.controlaEstoque ? formatarBRL(i.valorEmEstoque) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${ESTILO_SITUACAO[situacao]}`}>
                          {ROTULO_SITUACAO[situacao]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={botaoLinha} onClick={() => { setEditando(i); setAjustando(null); }}>
                            Editar<span className="sr-only"> {i.nome}</span>
                          </button>
                          {i.controlaEstoque && (
                            <button type="button" className={botaoLinha} onClick={() => { setAjustando(i); setEditando(null); }}>
                              Ajustar<span className="sr-only"> o estoque de {i.nome}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {insumos?.some((i) => !i.ativo) && (
          <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-secundaria" checked={verInativos} onChange={(e) => setVerInativos(e.target.checked)} />
            Mostrar insumos inativos
          </label>
        )}
      </section>
    </div>
  );
}

// --- formulários ---------------------------------------------------------------------

function Campo({ id, rotulo, erro, dica, children }: { id: string; rotulo: string; erro?: string; dica?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {rotulo}
      </label>
      {children}
      {erro ? (
        <p id={`${id}-erro`} className="mt-1 text-xs font-semibold text-secundaria">
          {erro}
        </p>
      ) : (
        dica && (
          <p id={`${id}-dica`} className="mt-1 text-xs text-primaria/75">
            {dica}
          </p>
        )
      )}
    </div>
  );
}

/** Cadastro/edição de um insumo. Também usado pela tela de produção (cadastro rápido). */
export function FormularioInsumo({
  inicial,
  tipoFixo,
  aninhado = false,
  onCancelar,
  onSalvo,
}: {
  inicial: InsumoDTO | null;
  /** Na produção, o tipo já vem da seção (ingredientes ou embalagens). */
  tipoFixo?: TipoInsumo;
  /**
   * Dentro de outro formulário (o da produção). Lá não pode haver um segundo `<form>`: é HTML
   * inválido, e o envio subiria pela árvore do React e salvaria o lote junto com o insumo.
   */
  aninhado?: boolean;
  onCancelar: () => void;
  onSalvo: (insumo: InsumoDTO, novo: boolean) => void;
}) {
  const id = useId();
  const [form, setForm] = useState<FormInsumo>(
    inicial
      ? {
          nome: inicial.nome,
          tipo: inicial.tipo,
          unidade: inicial.unidade,
          estoqueMinimo: inicial.estoqueMinimo === null ? "" : String(inicial.estoqueMinimo).replace(".", ","),
          controlaEstoque: inicial.controlaEstoque,
          ativo: inicial.ativo,
        }
      : { ...INSUMO_VAZIO, tipo: tipoFixo ?? "INGREDIENTE", unidade: tipoFixo === "EMBALAGEM" ? "UN" : "G" },
  );
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const unidadeTravada = Boolean(inicial?.temMovimento);

  async function salvar(e?: FormEvent) {
    e?.preventDefault();
    if (enviando) return;
    const locais: Record<string, string> = {};
    if (!form.nome.trim()) locais.nome = "Informe o nome (ex.: Maçã, Pote 125 ml).";
    const minimo = form.estoqueMinimo.trim() ? lerQuantidade(form.estoqueMinimo) : null;
    if (form.estoqueMinimo.trim() && minimo === null) locais.estoqueMinimo = "Use um número, como 500 ou 2,5.";
    if (Object.keys(locais).length) {
      setErros(locais);
      document.getElementById(`${id}-${Object.keys(locais)[0]}`)?.focus();
      return;
    }
    setEnviando(true);
    setErroGeral(null);
    try {
      const r = await fetch(inicial ? `/api/admin/supplies/${inicial.id}` : "/api/admin/supplies", {
        method: inicial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.nome.trim(),
          tipo: form.tipo,
          unidade: form.unidade,
          estoqueMinimo: minimo,
          controlaEstoque: form.controlaEstoque,
          ativo: form.ativo,
        }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) {
        const detalhes = (json?.detalhes ?? {}) as Record<string, string[]>;
        setErros(Object.fromEntries(Object.entries(detalhes).map(([k, v]) => [k, v[0]])));
        setErroGeral(json?.erro ?? "Não foi possível salvar o insumo.");
        return;
      }
      onSalvo(json as InsumoDTO, !inicial);
    } catch {
      setErroGeral("Sem conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  const aria = (campo: string) => ({
    id: `${id}-${campo}`,
    "aria-invalid": erros[campo] ? true : undefined,
    "aria-describedby": erros[campo] ? `${id}-${campo}-erro` : undefined,
  });

  const conteudo = (
    <>
      <p id={`${id}-titulo`} className="mb-3 font-titulos text-lg font-bold">
        {inicial ? `Editar ${inicial.nome}` : "Novo insumo"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id={`${id}-nome`} rotulo="Nome" erro={erros.nome}>
          <input {...aria("nome")} required autoFocus className="campo" value={form.nome} maxLength={80} placeholder="Ex.: Maçã" onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </Campo>
        {!tipoFixo && (
          <Campo id={`${id}-tipo`} rotulo="Tipo" erro={erros.tipo}>
            <select {...aria("tipo")} className="campo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoInsumo })}>
              {TIPOS_INSUMO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_INSUMO[t]}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo
          id={`${id}-unidade`}
          rotulo="Contar em"
          erro={erros.unidade}
          dica={unidadeTravada ? "Já tem compras ou usos: a unidade não muda mais." : "Compras em kg ou L são convertidas sozinhas."}
        >
          <select
            {...aria("unidade")}
            className="campo"
            value={form.unidade}
            disabled={unidadeTravada}
            onChange={(e) => setForm({ ...form, unidade: e.target.value as UnidadeInsumo })}
          >
            {UNIDADES_INSUMO.map((u) => (
              <option key={u} value={u}>
                {NOME_UNIDADE_INSUMO[u]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id={`${id}-estoqueMinimo`} rotulo={`Avisar abaixo de (${SIGLA_INSUMO[form.unidade]}, opcional)`} erro={erros.estoqueMinimo}>
          <input
            {...aria("estoqueMinimo")}
            className="campo"
            inputMode="decimal"
            value={form.estoqueMinimo}
            placeholder={form.unidade === "UN" ? "Ex.: 10" : "Ex.: 500"}
            onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
          />
        </Campo>
      </div>
      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-secundaria" checked={form.controlaEstoque} onChange={(e) => setForm({ ...form, controlaEstoque: e.target.checked })} />
        <span>
          Controlar o estoque deste insumo
          <span className="block text-xs text-primaria/75">Desmarque para o que vem de casa ou não vale contar (limão do quintal, água da torneira).</span>
        </span>
      </label>
      {inicial && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-secundaria" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
          Ativo (desmarque para esconder das listas sem perder o histórico)
        </label>
      )}
      {erroGeral && (
        <p role="alert" className="mt-2 text-sm font-semibold text-secundaria">
          {erroGeral}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type={aninhado ? "button" : "submit"}
          className="btn-primario aria-disabled:opacity-60"
          aria-disabled={enviando || undefined}
          onClick={aninhado ? () => void salvar() : undefined}
        >
          {enviando ? "Salvando…" : inicial ? "Salvar insumo" : "Cadastrar insumo"}
        </button>
        <button type="button" className="btn-secundario" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </>
  );

  const classe = "mt-4 rounded-xl border border-accent2/60 bg-destaque/60 p-4";
  if (!aninhado) {
    return (
      <form onSubmit={salvar} noValidate className={classe}>
        {conteudo}
      </form>
    );
  }
  // Aninhado: um grupo. Enter num campo de texto cadastra o insumo (e não envia o formulário de fora).
  return (
    <div
      role="group"
      aria-labelledby={`${id}-titulo`}
      className={classe}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
          e.preventDefault();
          void salvar();
        }
      }}
    >
      {conteudo}
    </div>
  );
}

function FormularioAjuste({ insumo, onCancelar, onSalvo }: { insumo: InsumoDTO; onCancelar: () => void; onSalvo: (i: InsumoDTO) => void }) {
  const id = useId();
  const [form, setForm] = useState<FormAjuste>({ sentido: "sai", quantidade: "", motivo: "", data: hojeNaLoja() });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const sigla = SIGLA_INSUMO[insumo.unidade];

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const qtd = lerQuantidade(form.quantidade);
    const locais: Record<string, string> = {};
    if (qtd === null) locais.quantidade = `Informe quanto (em ${sigla}), como 200 ou 1,5.`;
    if (!form.motivo.trim()) locais.motivo = "Diga o motivo (ex.: estragou, recontagem).";
    if (Object.keys(locais).length) {
      setErros(locais);
      document.getElementById(`${id}-${Object.keys(locais)[0]}`)?.focus();
      return;
    }
    setEnviando(true);
    setErroGeral(null);
    try {
      const r = await fetch(`/api/admin/supplies/${insumo.id}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade: form.sentido === "sai" ? -(qtd as number) : qtd, motivo: form.motivo.trim(), data: form.data }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) {
        const detalhes = (json?.detalhes ?? {}) as Record<string, string[]>;
        setErros(Object.fromEntries(Object.entries(detalhes).map(([k, v]) => [k, v[0]])));
        setErroGeral(json?.erro ?? "Não foi possível ajustar.");
        return;
      }
      onSalvo(json as InsumoDTO);
    } catch {
      setErroGeral("Sem conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  const aria = (campo: string) => ({
    id: `${id}-${campo}`,
    "aria-invalid": erros[campo] ? true : undefined,
    "aria-describedby": erros[campo] ? `${id}-${campo}-erro` : undefined,
  });

  return (
    <form onSubmit={salvar} noValidate className="mt-4 rounded-xl border border-accent2/60 bg-destaque/60 p-4">
      <p className="font-titulos text-lg font-bold">Ajustar estoque: {insumo.nome}</p>
      <p className="mb-3 text-xs text-primaria/75">
        Sobra atual: {formatarQtdInsumo(insumo.sobra, insumo.unidade)}. Use para perdas (estragou, caiu) ou para acertar com uma recontagem.
      </p>
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-semibold">O que aconteceu</legend>
        <div className="flex flex-wrap gap-4">
          {(["sai", "entra"] as const).map((s) => (
            <label key={s} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name={`${id}-sentido`} className="size-4 accent-secundaria" checked={form.sentido === s} onChange={() => setForm({ ...form, sentido: s })} />
              {s === "sai" ? "Saiu do estoque (perda)" : "Entrou no estoque (achei mais)"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo id={`${id}-quantidade`} rotulo={`Quanto (${sigla})`} erro={erros.quantidade}>
          <input {...aria("quantidade")} required autoFocus className="campo" inputMode="decimal" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
        </Campo>
        <Campo id={`${id}-motivo`} rotulo="Motivo" erro={erros.motivo}>
          <input {...aria("motivo")} required className="campo" maxLength={120} value={form.motivo} placeholder="Ex.: maçã estragou" onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
        </Campo>
        <Campo id={`${id}-data`} rotulo="Data" erro={erros.data}>
          <input {...aria("data")} type="date" className="campo" value={form.data} min="2020-01-01" max={hojeNaLoja()} onChange={(e) => setForm({ ...form, data: e.target.value })} />
        </Campo>
      </div>
      {erroGeral && (
        <p role="alert" className="mt-2 text-sm font-semibold text-secundaria">
          {erroGeral}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" className="btn-primario aria-disabled:opacity-60" aria-disabled={enviando || undefined}>
          {enviando ? "Salvando…" : "Registrar ajuste"}
        </button>
        <button type="button" className="btn-secundario" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
