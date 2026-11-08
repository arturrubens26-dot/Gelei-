"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CategoriaDTO, TipoLancamento } from "@/lib/planilha/tipos";
import { FORMAS_PAGAMENTO, ROTULO_FORMA_PAGAMENTO, type FormaPagamento } from "@/lib/vendas";
import type { LinhaGrade } from "./filaDeGravacao";
import { lerData, lerValor, opcoesDeCategoria, type Campos } from "./modelo";

const NOVA = "__nova__";

/**
 * Formulário de um lançamento (celular): folha que sobe de baixo, em <dialog> modal (prende o foco,
 * Esc fecha). Valor com teclado numérico. Salvar fecha na hora; a linha salva em seguida (o cartão
 * mostra "Salvando…" ou "Não salvou").
 */
export function FormLancamento({
  linha,
  categorias,
  descricoes,
  hoje,
  aoSalvar,
  aoExcluir,
  aoFechar,
  aoCriarCategoria,
}: {
  linha: LinhaGrade | null;
  categorias: readonly CategoriaDTO[];
  descricoes: readonly string[];
  hoje: string;
  aoSalvar: (campos: Partial<Campos>) => void;
  aoExcluir?: () => void;
  aoFechar: () => void;
  aoCriarCategoria: (tipo: TipoLancamento, nome: string) => Promise<{ ok: true; categoria: CategoriaDTO } | { ok: false; erro: string }>;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const c = linha?.campos;
  const [tipo, setTipo] = useState<TipoLancamento>(c?.tipo ?? "SAIDA");
  const [valor, setValor] = useState(c?.valorCentavos != null ? (c.valorCentavos / 100).toFixed(2).replace(".", ",") : "");
  const [categoria, setCategoria] = useState(c?.categoriaId ?? "");
  const [nomeNova, setNomeNova] = useState("");
  const [descricao, setDescricao] = useState(c?.descricao ?? "");
  const [data, setData] = useState(c?.data || hoje);
  const [forma, setForma] = useState<FormaPagamento | "">(c?.formaPagamento ?? "");
  const [observacao, setObservacao] = useState(c?.observacao ?? "");
  const [erros, setErros] = useState<Partial<Record<"valor" | "categoria" | "data" | "geral", string>>>({});
  const [ocupado, setOcupado] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const opcoes = opcoesDeCategoria(categorias, tipo, c?.categoriaId);
  const categoriaValida = categoria === NOVA || opcoes.some((o) => o.valor === categoria);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const novos: typeof erros = {};
    const v = lerValor(valor);
    if (!v.ok) novos.valor = v.erro;
    const d = lerData(data, hoje);
    if (!d.ok) novos.data = d.erro;
    if (!categoriaValida || !categoria) novos.categoria = "Escolha a categoria.";
    if (categoria === NOVA && !nomeNova.trim()) novos.categoria = "Digite o nome da categoria nova.";
    setErros(novos);
    if (Object.keys(novos).length || !v.ok || !d.ok) return;
    let categoriaId = categoria;
    if (categoria === NOVA) {
      setOcupado(true);
      const r = await aoCriarCategoria(tipo, nomeNova.trim().slice(0, 40));
      setOcupado(false);
      if (!r.ok) return setErros({ categoria: r.erro });
      categoriaId = r.categoria.id;
    }
    aoSalvar({
      tipo,
      valorCentavos: v.valor.centavos,
      categoriaId,
      descricao: descricao.trim().slice(0, 120),
      data: d.valor,
      formaPagamento: forma || null,
      observacao: observacao.trim().slice(0, 300),
    });
  }

  const erroDe = (campo: keyof typeof erros) =>
    erros[campo] ? (
      <p id={`${id}-${campo}-erro`} className="mt-1 text-sm font-semibold text-[#8C1D18]">
        {erros[campo]}
      </p>
    ) : null;
  const ligado = (campo: keyof typeof erros) => (erros[campo] ? { "aria-invalid": true, "aria-describedby": `${id}-${campo}-erro` } : {});

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-titulo`}
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
      className="mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-none rounded-t-2xl border-t-4 border-primaria bg-white p-0 text-primaria backdrop:bg-primaria/40"
    >
      <form onSubmit={salvar} className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" noValidate>
        <div className="flex items-center justify-between">
          <h2 id={`${id}-titulo`} className="text-2xl font-bold">
            {linha ? "Editar lançamento" : "Novo lançamento"}
          </h2>
          <button type="button" onClick={aoFechar} className="min-h-11 px-2 text-base font-semibold text-secundaria underline">
            Fechar
          </button>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Tipo</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["ENTRADA", "SAIDA"] as const).map((t) => (
              <label
                key={t}
                className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-2 text-lg font-bold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-secundaria ${
                  tipo === t ? (t === "ENTRADA" ? "border-[#1F6B3A] bg-[#1F6B3A] text-white" : "border-secundaria bg-secundaria text-destaque") : "border-primaria/40 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name={`${id}-tipo`}
                  className="sr-only"
                  checked={tipo === t}
                  onChange={() => {
                    setTipo(t);
                    if (categoria && categoria !== NOVA && categorias.find((k) => k.id === categoria)?.tipo !== t) setCategoria("");
                  }}
                />
                {t === "ENTRADA" ? "Entrada" : "Saída"}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-valor`} className="text-sm font-semibold">
            Valor (R$)
          </label>
          <input
            id={`${id}-valor`}
            className="campo mt-1 text-2xl font-bold tabular-nums"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            {...ligado("valor")}
          />
          {erroDe("valor")}
        </div>

        <div>
          <label htmlFor={`${id}-categoria`} className="text-sm font-semibold">
            Categoria
          </label>
          <select id={`${id}-categoria`} className="campo mt-1" value={categoriaValida ? categoria : ""} onChange={(e) => setCategoria(e.target.value)} {...ligado("categoria")}>
            <option value="">Escolha…</option>
            {opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
                {o.detalhe ? ` (${o.detalhe})` : ""}
              </option>
            ))}
            <option value={NOVA}>+ Criar categoria nova…</option>
          </select>
          {categoria === NOVA && (
            <input
              aria-label="Nome da categoria nova"
              className="campo mt-2"
              maxLength={40}
              placeholder="ex.: Gás"
              value={nomeNova}
              onChange={(e) => setNomeNova(e.target.value)}
            />
          )}
          {erroDe("categoria")}
        </div>

        <div>
          <label htmlFor={`${id}-descricao`} className="text-sm font-semibold">
            Descrição <span className="font-normal text-primaria/80">(opcional)</span>
          </label>
          <input id={`${id}-descricao`} className="campo mt-1" list={`${id}-descricoes`} maxLength={120} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          <datalist id={`${id}-descricoes`}>
            {descricoes.slice(0, 300).map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-data`} className="text-sm font-semibold">
              Data
            </label>
            <input id={`${id}-data`} type="date" className="campo mt-1" min="2020-01-01" max={hoje} value={data} onChange={(e) => setData(e.target.value)} {...ligado("data")} />
            {erroDe("data")}
          </div>
          <div>
            <label htmlFor={`${id}-forma`} className="text-sm font-semibold">
              Forma <span className="font-normal text-primaria/80">(opcional)</span>
            </label>
            <select id={`${id}-forma`} className="campo mt-1" value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento | "")}>
              <option value="">—</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMA_PAGAMENTO[f]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-obs`} className="text-sm font-semibold">
            Observação <span className="font-normal text-primaria/80">(opcional)</span>
          </label>
          <input id={`${id}-obs`} className="campo mt-1" maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>

        {linha?.erro && (
          <p role="alert" className="rounded-md bg-[#FDECEA] p-3 text-sm font-semibold text-[#8C1D18]">
            Não salvou: {linha.erro.mensagem}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button type="submit" className="btn-primario min-h-12 text-base" disabled={ocupado}>
            {ocupado ? "Criando a categoria…" : "Salvar"}
          </button>
          {aoExcluir &&
            (confirmarExclusao ? (
              <div className="flex gap-2">
                <button type="button" className="btn-secundario flex-1" onClick={() => setConfirmarExclusao(false)}>
                  Não excluir
                </button>
                <button type="button" className="btn-primario flex-1" onClick={aoExcluir}>
                  Excluir mesmo
                </button>
              </div>
            ) : (
              <button type="button" className="btn-secundario min-h-12" onClick={() => setConfirmarExclusao(true)}>
                Excluir lançamento
              </button>
            ))}
        </div>
      </form>
    </dialog>
  );
}
