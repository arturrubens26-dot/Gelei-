"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import { lerQuantidade, quantidadeParaCampo } from "@/lib/despesas";
import {
  SIGLA_INSUMO,
  custoDoItem,
  formatarCustoMedio,
  formatarPorcentagem,
  formatarQtdInsumo,
  totaisDaProducao,
  type InsumoDTO,
  type TipoInsumo,
} from "@/lib/producao";
import type { DadosDoFormulario, ProducaoDetalheDTO } from "@/lib/producao-admin";
import { FormularioInsumo } from "./EstoqueInsumos";

type Linha = {
  chave: string;
  insumoId: string;
  quantidade: string;
  /** Custo do item inteiro informado pela pessoa ("" = automático pelas compras). */
  custo: string;
  /** Embalagem: quantidade acompanha os potes até a pessoa mexer nela. */
  segueOsPotes?: boolean;
};
type LinhaCusto = { chave: string; descricao: string; valor: string };
type Secao = "ingredientes" | "embalagens";
type Form = {
  data: string;
  productId: string;
  nome: string;
  potes: string;
  observacao: string;
  ingredientes: Linha[];
  embalagens: Linha[];
  custos: LinhaCusto[];
};

const TIPO_DA_SECAO: Record<Secao, TipoInsumo> = { ingredientes: "INGREDIENTE", embalagens: "EMBALAGEM" };

/**
 * Formulário da produção (o caderno, com as contas feitas). `?de=<id>` copia um lote ("produzir de
 * novo"); `?editar=<id>` corrige um lote (os itens que continuam guardam o custo do dia original).
 */
export function FormProducao() {
  const router = useRouter();
  const parametros = useSearchParams();
  const de = parametros.get("de");
  const editar = parametros.get("editar");
  const id = useId();

  const [dados, setDados] = useState<DadosDoFormulario | null>(null);
  const [original, setOriginal] = useState<ProducaoDetalheDTO | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  /** De qual formulário é o `form` na tela ("nova", "de:<id>", "editar:<id>"). */
  const [chaveDoForm, setChaveDoForm] = useState<string | null>(null);
  const [erroCarga, setErroCarga] = useState<{ chave: string; mensagem: string } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [errosGerais, setErrosGerais] = useState<string[]>([]);
  /** Para onde vai o foco depois que os erros aparecem (id do campo; null = a lista de erros). */
  const [foco, setFoco] = useState<{ alvo: string | null } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [cadastrando, setCadastrando] = useState<Secao | null>(null);
  const sequencia = useRef(0);
  const refErros = useRef<HTMLDivElement>(null);
  /** Espelho de `chaveDoForm` para o efeito (sem repetir a busca a cada carga). */
  const carregado = useRef<string | null>(null);

  const novaChave = () => `l${++sequencia.current}`;
  const chaveAtual = editar ? `editar:${editar}` : de ? `de:${de}` : "nova";

  // Com Cache Components a rota visitada fica montada e escondida, e este efeito roda de novo quando
  // ela volta à tela (ex.: depois de lançar a compra em Despesas, como a tela sugere). O rascunho do
  // mesmo formulário fica; só os insumos (estoque e custo) são recarregados. Outro formulário
  // (outro ?de= ou ?editar=) carrega do zero, e nada do anterior aparece nem é salvo.
  useEffect(() => {
    let cancelado = false;
    const idLote = editar ?? de;
    const chave = editar ? `editar:${editar}` : de ? `de:${de}` : "nova";
    const buscar = (url: string) => fetch(url).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) }));

    if (carregado.current === chave) {
      buscar("/api/admin/production/form-data")
        .then((base) => !cancelado && base.ok && setDados(base.json as DadosDoFormulario))
        .catch(() => undefined);
      return () => {
        cancelado = true;
      };
    }

    Promise.all([buscar("/api/admin/production/form-data"), idLote ? buscar(`/api/admin/production/${encodeURIComponent(idLote)}`) : null])
      .then(([base, lote]) => {
        if (cancelado) return;
        if (!base.ok) return setErroCarga({ chave, mensagem: base.json?.erro ?? "Não foi possível carregar o formulário." });
        if (lote && !lote.ok) return setErroCarga({ chave, mensagem: lote.json?.erro ?? "Produção não encontrada." });
        const d = base.json as DadosDoFormulario;
        const l = (lote?.json ?? null) as ProducaoDetalheDTO | null;
        setDados(d);
        setOriginal(editar ? l : null);
        setErroCarga(null);
        setErros({});
        setErrosGerais([]);
        setCadastrando(null);
        const linha = (tipo: TipoInsumo, segue = false): Linha[] =>
          l
            ? l.itens
                .filter((i) => i.tipo === tipo)
                .map((i) => ({
                  chave: `l${++sequencia.current}`,
                  insumoId: i.insumoId,
                  quantidade: quantidadeParaCampo(i.quantidade),
                  // Produzir de novo: o que veio de casa (custo 0) continua 0, em vez de cobrar
                  // "informe quanto custou" ou pegar a média de uma compra.
                  custo: !editar && i.custoUnitario === 0 ? "0" : "",
                  segueOsPotes: tipo === "EMBALAGEM" && i.quantidade === l.potes,
                }))
            : [{ chave: `l${++sequencia.current}`, insumoId: "", quantidade: "", custo: "", segueOsPotes: segue }];
        carregado.current = chave;
        setChaveDoForm(chave);
        setForm({
          data: editar && l ? l.data : d.hoje,
          productId: l?.produto?.id ?? "",
          nome: editar && l ? l.nome : d.sugestaoNome,
          potes: l ? String(l.potes) : "",
          observacao: editar && l ? (l.observacao ?? "") : "",
          ingredientes: linha("INGREDIENTE"),
          embalagens: linha("EMBALAGEM", true),
          custos: (l ? l.custos.map((c) => ({ descricao: c.descricao, valor: c.valor })) : d.custosSugeridos).map((c) => ({
            chave: `l${++sequencia.current}`,
            descricao: c.descricao,
            valor: c.valor === null ? "" : valorParaCampo(c.valor),
          })),
        });
      })
      .catch(() => !cancelado && setErroCarga({ chave, mensagem: "Sem conexão. Tente novamente." }));
    return () => {
      cancelado = true;
    };
  }, [de, editar, tentativa]);

  // O foco vai para o erro depois que ele está na tela (com aria-invalid e a mensagem ligados):
  // focar antes fazia o leitor de tela anunciar o campo sem a mensagem.
  useEffect(() => {
    if (foco) (foco.alvo ? document.getElementById(`${id}-${foco.alvo}`) : refErros.current)?.focus();
  }, [foco, id]);

  if (erroCarga?.chave === chaveAtual) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-4 text-sm font-medium text-secundaria">
        <span>{erroCarga.mensagem}</span>
        <button
          type="button"
          className="btn-secundario"
          onClick={() => {
            setErroCarga(null);
            setTentativa((t) => t + 1);
          }}
        >
          Tentar de novo
        </button>
        <Link href="/admin/production" className="underline underline-offset-2">
          Voltar para Produção
        </Link>
      </div>
    );
  }
  if (!dados || !form || chaveDoForm !== chaveAtual) {
    return (
      <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
        <span className="sr-only">Carregando o formulário…</span>
      </div>
    );
  }

  const insumoPorId = new Map(dados.insumos.map((i) => [i.id, i]));
  const produto = dados.produtos.find((p) => p.id === form.productId) ?? null;
  const potes = Number.isInteger(Number(form.potes)) && Number(form.potes) > 0 ? Number(form.potes) : 0;
  const originalPorInsumo = new Map((original?.itens ?? []).map((i) => [i.insumoId, i]));

  /** Custo unitário que a linha vai ter (informado, o do dia original na correção, ou a média das compras). */
  function custoUnitarioDaLinha(l: Linha, quantidade: number | null): number | null {
    if (l.custo.trim() !== "") {
      const c = lerValorEmCentavos(l.custo);
      return c !== null && quantidade ? c / 100 / quantidade : null;
    }
    const antes = originalPorInsumo.get(l.insumoId);
    if (antes) return antes.custoUnitario;
    return insumoPorId.get(l.insumoId)?.custoMedio ?? null;
  }

  // Linhas preenchidas viram itens (para o resumo ao vivo).
  const itensPreenchidos = (secao: Secao) =>
    form[secao]
      .map((l) => {
        const q = lerQuantidade(secao === "embalagens" && l.segueOsPotes && potes ? String(potes) : l.quantidade);
        const custoUnitario = custoUnitarioDaLinha(l, q);
        return { l, q, custoUnitario };
      })
      .filter((x) => x.l.insumoId && x.q);
  const itensResumo = (["ingredientes", "embalagens"] as Secao[]).flatMap((s) =>
    itensPreenchidos(s).map((x) => ({ tipo: TIPO_DA_SECAO[s], quantidade: x.q as number, custoUnitario: x.custoUnitario ?? 0 })),
  );
  const custosResumo = form.custos
    .map((c) => ({ descricao: c.descricao, valor: (lerValorEmCentavos(c.valor) ?? 0) / 100 }))
    .filter((c) => c.descricao.trim());
  const totais = totaisDaProducao(itensResumo, custosResumo, potes, produto?.preco ?? null);

  // --- edição do formulário ---------------------------------------------------------------

  const mudar = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const mudarLinha = (secao: Secao, chave: string, patch: Partial<Linha>) =>
    setForm((f) => (f ? { ...f, [secao]: f[secao].map((l) => (l.chave === chave ? { ...l, ...patch } : l)) } : f));
  const adicionarLinha = (secao: Secao) =>
    setForm((f) => (f ? { ...f, [secao]: [...f[secao], { chave: novaChave(), insumoId: "", quantidade: "", custo: "", segueOsPotes: secao === "embalagens" }] } : f));
  const removerLinha = (secao: Secao, chave: string) => setForm((f) => (f ? { ...f, [secao]: f[secao].filter((l) => l.chave !== chave) } : f));
  const mudarCusto = (chave: string, patch: Partial<LinhaCusto>) =>
    setForm((f) => (f ? { ...f, custos: f.custos.map((c) => (c.chave === chave ? { ...c, ...patch } : c)) } : f));

  function insumoCadastrado(secao: Secao, novo: InsumoDTO) {
    setDados((d) => (d ? { ...d, insumos: [...d.insumos, novo] } : d));
    setForm((f) => {
      if (!f) return f;
      const vazia = f[secao].find((l) => !l.insumoId);
      const linhas = vazia
        ? f[secao].map((l) => (l === vazia ? { ...l, insumoId: novo.id } : l))
        : [...f[secao], { chave: novaChave(), insumoId: novo.id, quantidade: "", custo: "", segueOsPotes: secao === "embalagens" }];
      return { ...f, [secao]: linhas };
    });
    setCadastrando(null);
  }

  // --- envio ------------------------------------------------------------------------------

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (enviando || !form) return;
    const locais: Record<string, string> = {};
    const gerais: string[] = [];
    // Na ordem da tela: o foco vai para o primeiro erro.
    if (!form.nome.trim()) locais.nome = "Dê um nome (ex.: Receita 1).";
    if (!form.data) locais.data = "Informe a data da produção.";
    if (!potes) locais.potes = "Quantos potes renderam? Use um número inteiro.";

    type Saida = { insumoId: string; quantidade: number; custoInformadoCentavos: number | null };
    const itens: Saida[] = [];
    const chaveDoIndice: string[] = [];
    const vistos = new Set<string>();
    for (const secao of ["ingredientes", "embalagens"] as Secao[]) {
      for (const l of form[secao]) {
        const quantidadeTexto = secao === "embalagens" && l.segueOsPotes && potes ? String(potes) : l.quantidade;
        const vazia = !l.insumoId && !quantidadeTexto.trim() && !l.custo.trim();
        if (vazia) continue;
        if (!l.insumoId) {
          locais[`${l.chave}-insumo`] = "Escolha o insumo.";
          continue;
        }
        if (vistos.has(l.insumoId)) locais[`${l.chave}-insumo`] = "Já está na lista: some as quantidades numa linha só.";
        vistos.add(l.insumoId);
        const q = lerQuantidade(quantidadeTexto);
        if (q === null) locais[`${l.chave}-quantidade`] = "Use um número maior que zero (ex.: 500 ou 2,5).";
        let custoInformado: number | null = null;
        if (l.custo.trim() !== "") {
          custoInformado = lerValorEmCentavos(l.custo);
          if (custoInformado === null) locais[`${l.chave}-custo`] = "Valor inválido (ex.: 3,49 ou 0).";
        } else if (!originalPorInsumo.has(l.insumoId) && insumoPorId.get(l.insumoId)?.custoMedio == null) {
          locais[`${l.chave}-custo`] = "Sem compra lançada: informe quanto custou (0 se foi de casa).";
        }
        itens.push({ insumoId: l.insumoId, quantidade: q ?? 0, custoInformadoCentavos: custoInformado });
        chaveDoIndice.push(l.chave);
      }
    }
    if (!itens.some((_, i) => form.ingredientes.some((l) => l.chave === chaveDoIndice[i]))) {
      gerais.push("Informe pelo menos um ingrediente.");
    }
    const custos: { descricao: string; valorCentavos: number }[] = [];
    for (const c of form.custos) {
      if (!c.descricao.trim() && !c.valor.trim()) continue;
      if (!c.descricao.trim()) locais[`${c.chave}-descricao`] = "Diga o que é (ex.: Gás).";
      const v = lerValorEmCentavos(c.valor);
      if (v === null) locais[`${c.chave}-valor`] = "Informe o valor (0 se não teve).";
      custos.push({ descricao: c.descricao.trim(), valorCentavos: v ?? 0 });
    }

    if (Object.keys(locais).length || gerais.length) {
      setErros(locais);
      setErrosGerais(gerais.length ? gerais : ["Confira os campos destacados."]);
      setFoco({ alvo: Object.keys(locais)[0] ?? null });
      return;
    }

    setEnviando(true);
    setErros({});
    setErrosGerais([]);
    try {
      const r = await fetch(editar ? `/api/admin/production/${encodeURIComponent(editar)}` : "/api/admin/production", {
        method: editar ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: form.data,
          productId: form.productId || null,
          nome: form.nome.trim(),
          potes,
          itens,
          custos,
          observacao: form.observacao.trim() || null,
        }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) {
        // "itens.3.custoInformadoCentavos" → a linha certa; o resto vira lista geral.
        const detalhes = (json?.detalhes ?? {}) as Record<string, string[]>;
        const doServidor: Record<string, string> = {};
        const lista: string[] = [json?.erro ?? "Não foi possível salvar a produção."];
        for (const [chave, msgs] of Object.entries(detalhes)) {
          const m = /^itens\.(\d+)\.(\w+)$/.exec(chave);
          const c = /^custos\.(\d+)\.(\w+)$/.exec(chave);
          if (m && chaveDoIndice[Number(m[1])]) {
            const campo = m[2] === "custoInformadoCentavos" ? "custo" : m[2] === "insumoId" ? "insumo" : "quantidade";
            doServidor[`${chaveDoIndice[Number(m[1])]}-${campo}`] = msgs[0];
          } else if (c && form.custos[Number(c[1])]) {
            doServidor[`${form.custos.filter((x) => x.descricao.trim() || x.valor.trim())[Number(c[1])]?.chave}-${c[2] === "valorCentavos" ? "valor" : "descricao"}`] = msgs[0];
          } else if (["nome", "potes", "data"].includes(chave)) {
            doServidor[chave] = msgs[0];
          } else lista.push(msgs[0]);
        }
        setErros(doServidor);
        setErrosGerais(lista);
        setFoco({ alvo: null });
        return;
      }
      // Salvo: o próximo "Nova produção" (a mesma rota, ainda montada) começa do zero, sem
      // mostrar nem reenviar este lote.
      carregado.current = null;
      setChaveDoForm(null);
      router.push(`/admin/production/${encodeURIComponent(json.id)}`);
    } catch {
      setErrosGerais(["Sem conexão. A produção não foi salva; tente novamente."]);
      setFoco({ alvo: null });
    } finally {
      setEnviando(false);
    }
  }

  // --- tela ------------------------------------------------------------------------------

  const aria = (campo: string, dica?: string) => ({
    id: `${id}-${campo}`,
    "aria-invalid": erros[campo] ? true : undefined,
    // O erro primeiro; a dica (compra, sobra, custo automático) continua sendo lida junto.
    "aria-describedby": [erros[campo] ? `${id}-${campo}-erro` : null, dica].filter(Boolean).join(" ") || undefined,
  });
  const erroDe = (campo: string) =>
    erros[campo] ? (
      <p id={`${id}-${campo}-erro`} className="mt-1 text-xs font-semibold text-secundaria">
        {erros[campo]}
      </p>
    ) : null;

  function secaoDeItens(secao: Secao, titulo: string, explicacao: string) {
    const tipo = TIPO_DA_SECAO[secao];
    const opcoes = dados!.insumos.filter((i) => i.tipo === tipo);
    return (
      <fieldset className="cartao @container p-5">
        <legend className="sr-only">{titulo}</legend>
        <p className="font-titulos text-xl font-bold" aria-hidden="true">
          {titulo}
        </p>
        <p className="mb-3 text-xs text-primaria/75">{explicacao}</p>
        <ul className="flex flex-col gap-4">
          {form![secao].map((l, indice) => {
            const insumo = insumoPorId.get(l.insumoId);
            const qTexto = secao === "embalagens" && l.segueOsPotes && potes ? String(potes) : l.quantidade;
            const q = lerQuantidade(qTexto);
            const unitario = custoUnitarioDaLinha(l, q);
            const automatico = l.custo.trim() === "";
            const custo = q && unitario !== null ? custoDoItem({ quantidade: q, custoUnitario: unitario }) : null;
            const usadoAntes = originalPorInsumo.get(l.insumoId)?.quantidade ?? 0;
            const sobraDepois = insumo && insumo.controlaEstoque && q ? insumo.sobra + usadoAntes - q : null;
            const n = indice + 1;
            return (
              <li key={l.chave} className="grid gap-3 rounded-lg border border-accent1/80 p-3 @xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @xl:items-start">
                <div>
                  <label htmlFor={`${id}-${l.chave}-insumo`} className="mb-1 block text-xs font-semibold">
                    {secao === "ingredientes" ? `Ingrediente ${n}` : `Embalagem ${n}`}
                  </label>
                  <select
                    {...aria(`${l.chave}-insumo`, insumo ? `${id}-${l.chave}-compra` : undefined)}
                    className="campo"
                    value={l.insumoId}
                    onChange={(e) => mudarLinha(secao, l.chave, { insumoId: e.target.value })}
                  >
                    <option value="">Escolha…</option>
                    {opcoes
                      .filter((i) => i.ativo || i.id === l.insumoId)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.nome}
                          {i.controlaEstoque ? ` (sobra ${formatarQtdInsumo(i.sobra, i.unidade)})` : ""}
                        </option>
                      ))}
                  </select>
                  {erroDe(`${l.chave}-insumo`)}
                  {insumo && (
                    <p id={`${id}-${l.chave}-compra`} className="mt-1 text-xs text-primaria/75">
                      {insumo.custoMedio !== null ? `Compra: ${formatarCustoMedio(insumo.custoMedio, insumo.unidade)}` : "Sem compra lançada"}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={`${id}-${l.chave}-quantidade`} className="mb-1 block text-xs font-semibold">
                    Quantidade{insumo ? ` (${SIGLA_INSUMO[insumo.unidade]})` : ""}
                  </label>
                  <input
                    {...aria(`${l.chave}-quantidade`, sobraDepois !== null ? `${id}-${l.chave}-sobra` : undefined)}
                    className="campo"
                    inputMode="decimal"
                    value={qTexto}
                    placeholder={secao === "embalagens" ? "= potes" : "Ex.: 500"}
                    onChange={(e) => mudarLinha(secao, l.chave, { quantidade: e.target.value, segueOsPotes: false })}
                  />
                  {erroDe(`${l.chave}-quantidade`)}
                  {sobraDepois !== null && (
                    <p id={`${id}-${l.chave}-sobra`} className={`mt-1 text-xs ${sobraDepois < 0 ? "font-semibold text-secundaria" : "text-primaria/75"}`}>
                      {sobraDepois < 0
                        ? `Faltam ${formatarQtdInsumo(-sobraDepois, insumo!.unidade)} no estoque: lance a compra em Despesas.`
                        : `Sobra depois: ${formatarQtdInsumo(sobraDepois, insumo!.unidade)}`}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={`${id}-${l.chave}-custo`} className="mb-1 block text-xs font-semibold">
                    Custo (R$)
                  </label>
                  <input
                    {...aria(`${l.chave}-custo`, automatico && custo !== null ? `${id}-${l.chave}-auto` : undefined)}
                    className="campo"
                    inputMode="decimal"
                    value={l.custo}
                    placeholder={automatico && custo !== null ? valorParaCampo(custo) : "Ex.: 0"}
                    onChange={(e) => mudarLinha(secao, l.chave, { custo: e.target.value })}
                  />
                  {erroDe(`${l.chave}-custo`)}
                  {!erros[`${l.chave}-custo`] && (
                    <p id={`${id}-${l.chave}-auto`} className="mt-1 text-xs text-primaria/75">
                      {automatico ? (custo !== null ? `Automático: ${formatarBRL(custo)}` : insumo ? "Informe (0 se foi de casa)" : "") : "Valor informado por você"}
                    </p>
                  )}
                </div>
                <div className="@xl:pt-5">
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center rounded-full border-2 border-primaria/30 px-3 text-xs font-semibold text-primaria hover:bg-accent1/40"
                    onClick={() => removerLinha(secao, l.chave)}
                    aria-label={`Remover ${secao === "ingredientes" ? "ingrediente" : "embalagem"} ${n}${insumo ? ` (${insumo.nome})` : ""}`}
                  >
                    Remover
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secundario" onClick={() => adicionarLinha(secao)}>
            + {secao === "ingredientes" ? "Ingrediente" : "Embalagem"}
          </button>
          <button type="button" className="btn-secundario" onClick={() => setCadastrando(secao)} aria-expanded={cadastrando === secao}>
            Cadastrar insumo novo
          </button>
        </div>
        {cadastrando === secao && (
          <FormularioInsumo aninhado inicial={null} tipoFixo={tipo} onCancelar={() => setCadastrando(null)} onSalvo={(novo) => insumoCadastrado(secao, novo)} />
        )}
      </fieldset>
    );
  }

  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulos text-3xl font-bold">{editar ? "Corrigir produção" : de ? "Produzir de novo" : "Nova produção"}</h1>
          <p className="mt-1 max-w-prose text-sm text-primaria/80">
            Anote como no caderno: o que usou (em gramas), os custos do dia e quantos potes renderam. O custo de cada
            ingrediente sai do preço que você pagou nas compras.
          </p>
        </div>
        <Link href="/admin/production" className="btn-secundario">
          Voltar
        </Link>
      </header>

      <div ref={refErros} tabIndex={-1} role="alert" className={errosGerais.length ? "rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria" : "sr-only"}>
        {errosGerais.length > 0 && (
          <ul className="list-inside list-disc">
            {errosGerais.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          {/* Dados do lote */}
          <fieldset className="cartao grid gap-4 p-5 sm:grid-cols-2">
            <legend className="sr-only">Dados da produção</legend>
            <div>
              <label htmlFor={`${id}-nome`} className="mb-1 block text-sm font-semibold">
                Nome da receita
              </label>
              <input {...aria("nome")} required className="campo" maxLength={80} value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} />
              {erroDe("nome")}
            </div>
            <div>
              <label htmlFor={`${id}-sabor`} className="mb-1 block text-sm font-semibold">
                Sabor
              </label>
              <select id={`${id}-sabor`} className="campo" value={form.productId} onChange={(e) => mudar({ productId: e.target.value })}>
                <option value="">Nenhum (receita de teste)</option>
                {dados.produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} · {formatarBRL(p.preco)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-data`} className="mb-1 block text-sm font-semibold">
                Data da produção
              </label>
              <input {...aria("data")} required type="date" className="campo" min="2020-01-01" max={dados.hoje} value={form.data} onChange={(e) => mudar({ data: e.target.value })} />
              {erroDe("data")}
            </div>
            <div>
              <label htmlFor={`${id}-potes`} className="mb-1 block text-sm font-semibold">
                Potes que renderam
              </label>
              <input {...aria("potes")} required className="campo" inputMode="numeric" value={form.potes} placeholder="Ex.: 7" onChange={(e) => mudar({ potes: e.target.value })} />
              {erroDe("potes")}
            </div>
          </fieldset>

          {secaoDeItens("ingredientes", "Ingredientes usados", "Em gramas, mililitros ou unidades. Deixe o custo vazio para usar o preço das compras; ponha 0 para o que veio de casa.")}
          {secaoDeItens("embalagens", "Embalagens", "Pote, tampa, rótulo, lacre… A quantidade acompanha os potes até você mudar.")}

          {/* Custos do dia */}
          <fieldset className="cartao @container p-5">
            <legend className="sr-only">Custos da produção</legend>
            <p className="font-titulos text-xl font-bold" aria-hidden="true">
              Custos da produção
            </p>
            <p className="mb-3 text-xs text-primaria/75">Gás, energia, água, mão de obra… Ficam sugeridos para a próxima produção.</p>
            <ul className="flex flex-col gap-5 @md:gap-3">
              {form.custos.map((c, i) => (
                // Com pouco espaço (celular; tablet com o menu e o resumo ao lado) o nome ocupa a linha
                // toda: em 3 colunas "Mão de obra" virava "Mão de". Medido no cartão (@container), não na tela.
                <li key={c.chave} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 @md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                  <div className="col-span-2 @md:col-span-1">
                    <label htmlFor={`${id}-${c.chave}-descricao`} className="sr-only">
                      Custo {i + 1}: o que é
                    </label>
                    <input {...aria(`${c.chave}-descricao`)} className="campo" maxLength={60} value={c.descricao} placeholder="Ex.: Gás" onChange={(e) => mudarCusto(c.chave, { descricao: e.target.value })} />
                    {erroDe(`${c.chave}-descricao`)}
                  </div>
                  <div>
                    <label htmlFor={`${id}-${c.chave}-valor`} className="sr-only">
                      Custo {i + 1}: valor em reais
                    </label>
                    <input {...aria(`${c.chave}-valor`)} className="campo" inputMode="decimal" value={c.valor} placeholder="R$ 0,00" onChange={(e) => mudarCusto(c.chave, { valor: e.target.value })} />
                    {erroDe(`${c.chave}-valor`)}
                  </div>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center rounded-full border-2 border-primaria/30 px-3 text-xs font-semibold hover:bg-accent1/40"
                    onClick={() => setForm((f) => (f ? { ...f, custos: f.custos.filter((x) => x.chave !== c.chave) } : f))}
                    aria-label={`Remover o custo ${c.descricao || i + 1}`}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-secundario mt-3"
              onClick={() => setForm((f) => (f ? { ...f, custos: [...f.custos, { chave: novaChave(), descricao: "", valor: "" }] } : f))}
            >
              + Custo
            </button>
          </fieldset>

          <div className="cartao p-5">
            <label htmlFor={`${id}-observacao`} className="mb-1 block text-sm font-semibold">
              Observação (opcional)
            </label>
            <textarea
              id={`${id}-observacao`}
              className="campo"
              rows={3}
              maxLength={500}
              value={form.observacao}
              placeholder="Ex.: ponto mais firme; pimenta mais ardida"
              onChange={(e) => mudar({ observacao: e.target.value })}
            />
          </div>
        </div>

        {/* Resumo ao vivo */}
        <aside aria-labelledby={`${id}-resumo`} className="cartao flex flex-col gap-3 p-5 lg:sticky lg:top-6">
          <h2 id={`${id}-resumo`} className="text-xl font-bold">
            Resumo
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt>Ingredientes</dt>
            <dd className="text-right tabular-nums">{formatarBRL(totais.ingredientes)}</dd>
            <dt>Custos da produção</dt>
            <dd className="text-right tabular-nums">{formatarBRL(totais.extras)}</dd>
            <dt>Embalagens</dt>
            <dd className="text-right tabular-nums">{formatarBRL(totais.embalagens)}</dd>
            <dt className="border-t border-accent2/60 pt-1 font-semibold">Total do lote</dt>
            <dd className="border-t border-accent2/60 pt-1 text-right font-semibold tabular-nums">{formatarBRL(totais.total)}</dd>
          </dl>
          <div className="rounded-lg bg-accent1/25 p-3">
            <p className="text-sm">Cada pote custa</p>
            <p className="text-3xl font-bold tabular-nums">{totais.porPote === null ? "—" : formatarBRL(totais.porPote)}</p>
            {totais.porPote !== null && (
              <p className="text-xs text-primaria/80">
                geleia {formatarBRL(totais.geleiaPorPote ?? 0)} + embalagem {formatarBRL(totais.embalagemPorPote ?? 0)}
              </p>
            )}
          </div>
          {totais.margemPorPote !== null && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              <dt>Preço de venda</dt>
              <dd className="text-right tabular-nums">{formatarBRL(totais.precoVenda ?? 0)}</dd>
              <dt className="font-semibold">Margem por pote</dt>
              <dd className={`text-right font-semibold tabular-nums ${totais.margemPorPote < 0 ? "text-secundaria" : ""}`}>
                {formatarBRL(totais.margemPorPote)} · {formatarPorcentagem(totais.margemPct ?? 0)}
              </dd>
              <dt>Se vender os {potes} potes</dt>
              <dd className="text-right tabular-nums">{formatarBRL(totais.lucroDoLote ?? 0)}</dd>
            </dl>
          )}
          {produto && potes > 0 && (
            <p className="text-xs text-primaria/75">
              Rendimento: {potes} × {produto.pesoGramas} g ≈ {formatarQtdInsumo(potes * produto.pesoGramas, "G")} de geleia.
            </p>
          )}
          <button type="submit" className="btn-primario w-full aria-disabled:opacity-60" aria-disabled={enviando || undefined}>
            {enviando ? "Salvando…" : editar ? "Salvar correção" : "Salvar produção"}
          </button>
        </aside>
      </div>
    </form>
  );
}
