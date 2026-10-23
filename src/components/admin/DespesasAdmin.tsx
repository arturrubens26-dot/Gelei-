"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { Kpi } from "@/components/admin/Kpi";
import { coresGrafico } from "@/design-system";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import {
  CATEGORIAS_DESPESA,
  EXEMPLOS_CATEGORIA,
  NOME_UNIDADE,
  PRIMEIRO_MES,
  ROTULO_CATEGORIA,
  SIGLA_UNIDADE,
  UNIDADES_DESPESA,
  formatarCustoUnitario,
  formatarDia,
  formatarQuantidade,
  hojeNaLoja,
  lerQuantidade,
  nomeDoMes,
  quantidadeParaCampo,
  somarMeses,
  type CategoriaDespesa,
  type DespesaDTO,
  type PlannerMes,
  type UnidadeDespesa,
} from "@/lib/despesas";
import { SIGLA_INSUMO, fatorConversao, formatarCustoMedio, formatarQtdInsumo, type InsumoDTO } from "@/lib/producao";

type Formulario = {
  descricao: string;
  categoria: CategoriaDespesa | "";
  quantidade: string;
  unidade: UnidadeDespesa;
  valor: string;
  /** Sempre uma data concreta ("AAAA-MM-DD") depois da primeira carga: o campo nunca "cai" para hoje. */
  data: string;
  fornecedor: string;
  observacao: string;
  /** Compra de insumo: em qual insumo do estoque da Produção ela entra ("" = despesa comum). */
  insumoId: string;
  /** Quanto entrou no estoque (unidade do insumo), quando não dá para converter sozinho (pacote, caixa…). */
  quantidadeBase: string;
};

type Campo = keyof Formulario;
type Erros = Partial<Record<Campo, string>>;
type Aviso = { tipo: "ok" | "erro"; texto: string } | null;

const FORM_VAZIO: Formulario = {
  descricao: "",
  categoria: "",
  quantidade: "1",
  unidade: "UN",
  valor: "",
  data: "",
  fornecedor: "",
  observacao: "",
  insumoId: "",
  quantidadeBase: "",
};

/** Ordem dos campos na tela: o foco vai para o primeiro com erro. */
const ORDEM_CAMPOS: Campo[] = [
  "descricao", "categoria", "insumoId", "quantidade", "unidade", "quantidadeBase", "valor", "data", "fornecedor", "observacao",
];

/** Quanto entra no estoque: convertido sozinho (kg → g, L → mL) ou o que a pessoa informou. */
function entradaNoEstoque(f: Formulario, insumo: InsumoDTO | undefined): { quantidade: number | null; automatica: boolean } {
  if (!insumo) return { quantidade: null, automatica: false };
  const fator = fatorConversao(f.unidade, insumo.unidade);
  const q = lerQuantidade(f.quantidade);
  if (fator !== null) return { quantidade: q === null ? null : Math.round(q * fator * 1000) / 1000, automatica: true };
  return { quantidade: lerQuantidade(f.quantidadeBase), automatica: false };
}

/** A API recebe o valor em centavos; o erro dela volta para o campo "valor". */
const CAMPO_DA_API: Record<string, Campo> = { valorCentavos: "valor" };

function validar(f: Formulario, hoje: string | undefined, insumo: InsumoDTO | undefined): Erros {
  const erros: Erros = {};
  if (!f.descricao.trim()) erros.descricao = "Diga o que foi comprado (ex.: Adesivos).";
  if (!f.categoria) erros.categoria = "Escolha uma categoria.";
  if (insumo && entradaNoEstoque(f, insumo).quantidade === null && !fatorConversao(f.unidade, insumo.unidade)) {
    erros.quantidadeBase = `Informe quantos ${SIGLA_INSUMO[insumo.unidade]} entraram no estoque.`;
  }
  if (lerQuantidade(f.quantidade) === null) {
    erros.quantidade = "Use um número maior que zero, com até 3 casas decimais (ex.: 50 ou 2,5).";
  }
  const centavos = lerValorEmCentavos(f.valor);
  if (centavos === null || centavos < 1) erros.valor = "Informe o valor pago, como 20,00 ou 1.234,56.";
  if (!f.data) erros.data = "Informe a data da compra.";
  else if (f.data < "2020-01-01") erros.data = "Use uma data de 2020 em diante.";
  else if (hoje && f.data > hoje) erros.data = "A data da compra não pode ser depois de hoje.";
  return erros;
}

const porcentagem = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * Painel de despesas: lança o que foi gasto (ex.: Adesivos, 50 un, R$ 20,00 → R$ 0,40 cada),
 * mostra o mês com vendas, despesas e saldo, o gasto por categoria e a lista para corrigir ou excluir.
 */
export function DespesasAdmin() {
  // null = mês corrente: quem decide é o servidor (horário de Brasília), não o relógio do navegador.
  const [mes, setMes] = useState<string | null>(null);
  const [versao, setVersao] = useState(0); // incrementa para recarregar depois de salvar/excluir
  const [dados, setDados] = useState<PlannerMes | null>(null);
  const [carga, setCarga] = useState<{ chave: string; erro?: string } | null>(null);

  const [form, setForm] = useState<Formulario>(FORM_VAZIO);
  const [editando, setEditando] = useState<DespesaDTO | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null); // resultado do formulário
  const [avisoLista, setAvisoLista] = useState<Aviso>(null); // resultado de excluir (perto da lista)
  const [excluindo, setExcluindo] = useState<string | null>(null);
  /** Insumos da Produção (para ligar a compra ao estoque). null = ainda carregando ou indisponível. */
  const [insumos, setInsumos] = useState<InsumoDTO[] | null>(null);
  const [insumosFalharam, setInsumosFalharam] = useState(false);
  const [recargaInsumos, setRecargaInsumos] = useState(0);

  // useId: a rota visitada continua montada (Cache Components) e ids fixos se repetiriam.
  const id = useId();
  const refTituloLista = useRef<HTMLHeadingElement>(null);
  const refTituloMes = useRef<HTMLParagraphElement>(null);
  /** A pessoa mexeu na data? Se não, o servidor usa o "hoje" dele (aba aberta de um dia para o outro). */
  const dataTocada = useRef(false);
  /** Data (e se foi tocada) de antes de abrir uma edição: volta ao terminar ou cancelar. */
  const dataAntesDaEdicao = useRef<{ data: string; tocada: boolean } | null>(null);
  // Valores atuais para usar depois de um await (sem pegar o estado velho da hora do clique).
  const atual = useRef<{ mesNaTela?: string; editandoId?: string }>({});

  /** Foco num campo pelo id (únicos graças ao useId). Só em manipuladores de evento. */
  const focarCampo = (campo: Campo) => document.getElementById(`${id}-${campo}`)?.focus();

  const chave = `${mes ?? "atual"}|${versao}`;

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/expenses${mes ? `?mes=${mes}` : ""}`)
      .then(async (resposta) => {
        const json = await resposta.json().catch(() => null);
        if (cancelado) return;
        if (resposta.ok) {
          const recebido = json as PlannerMes;
          setDados(recebido);
          setCarga({ chave });
          // Data padrão = hoje (do servidor), até a pessoa escolher outra.
          setForm((f) => (!f.data || !dataTocada.current ? { ...f, data: recebido.hoje } : f));
        } else {
          setCarga({ chave, erro: json?.erro ?? "Não foi possível carregar as despesas." });
        }
      })
      .catch(() => {
        if (!cancelado) setCarga({ chave, erro: "Sem conexão. Tente novamente." });
      });
    return () => {
      cancelado = true;
    };
  }, [chave, mes]);

  // Insumos da Produção: recarrega junto com a lista (um insumo pode ter sido cadastrado em outra aba).
  // Se falhar, a despesa ligada a um insumo não pode ser salva (ver `salvar`).
  useEffect(() => {
    let cancelado = false;
    fetch("/api/admin/supplies")
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        if (r.ok && json?.insumos) setInsumos(json.insumos as InsumoDTO[]);
        else setInsumosFalharam(true);
      })
      .catch(() => !cancelado && setInsumosFalharam(true));
    return () => {
      cancelado = true;
    };
  }, [versao, recargaInsumos]);

  // Voltou para a aba num outro dia (ficou aberta de um dia para o outro): recarrega para o "hoje" valer.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && dados && hojeNaLoja() !== dados.hoje) setVersao((v) => v + 1);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [dados]);

  // Ao trocar de mês, mantém o mês anterior (esmaecido) até o novo chegar, em vez de piscar.
  const carregando = carga?.chave !== chave;
  const erroCarga = !carregando ? carga?.erro : undefined;
  const mesAtual = dados?.hoje.slice(0, 7);
  const mesNaTela = mes ?? dados?.mes;
  // Se o mês novo falhou, não mostra os números do mês anterior debaixo do título do novo.
  const exibidos = dados && !(erroCarga && dados.mes !== mesNaTela) ? dados : null;

  useEffect(() => {
    atual.current = { mesNaTela, editandoId: editando?.id };
  });

  function mudar(campo: Campo) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const valor = e.target.value;
      if (campo === "data") dataTocada.current = true;
      setForm((f) => ({ ...f, [campo]: valor }));
      setErros((atuais) => (atuais[campo] ? { ...atuais, [campo]: undefined } : atuais));
    };
  }

  function focarPrimeiroErro(lista: Erros) {
    const campo = ORDEM_CAMPOS.find((c) => lista[c]);
    if (campo) focarCampo(campo);
  }

  /** Sai do modo edição devolvendo a data de antes (quem lançava várias notas do mesmo dia continua). */
  function encerrarEdicao() {
    const antes = dataAntesDaEdicao.current;
    dataAntesDaEdicao.current = null;
    dataTocada.current = antes?.tocada ?? false;
    setEditando(null);
    setForm({ ...FORM_VAZIO, data: antes?.data || dados?.hoje || "" });
    setErros({});
  }

  function cancelarEdicao() {
    if (enviando) return;
    encerrarEdicao();
    setAviso(null);
    focarCampo("descricao");
  }

  function editar(d: DespesaDTO) {
    if (enviando || excluindo) return;
    const comecado = !editando && (form.descricao.trim() || form.valor.trim());
    if (comecado && !window.confirm("Descartar o lançamento que você começou a preencher?")) return;
    if (!editando) dataAntesDaEdicao.current = { data: form.data, tocada: dataTocada.current };
    dataTocada.current = true;
    setEditando(d);
    setForm({
      descricao: d.descricao,
      categoria: d.categoria,
      quantidade: quantidadeParaCampo(d.quantidade),
      unidade: d.unidade,
      valor: valorParaCampo(d.valorTotal),
      data: d.data,
      fornecedor: d.fornecedor ?? "",
      observacao: d.observacao ?? "",
      insumoId: d.insumo?.id ?? "",
      quantidadeBase: d.quantidadeBase === null ? "" : quantidadeParaCampo(d.quantidadeBase),
    });
    setErros({});
    setAviso({ tipo: "ok", texto: `Editando "${d.descricao}", de ${formatarDia(d.data)}. Altere os campos e clique em Salvar alterações.` });
    // O foco leva a tela até o formulário (e quem usa leitor de tela sabe onde está).
    focarCampo("descricao");
  }

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;

    const insumoEscolhido = insumos?.find((i) => i.id === form.insumoId);
    // Compra ligada ao estoque, mas a lista de insumos não chegou: salvar mandaria insumoId null e
    // a compra sairia do estoque sem aviso (a sobra ficaria negativa). Busca a lista de novo.
    if (form.insumoId && !insumoEscolhido) {
      setInsumosFalharam(false);
      setRecargaInsumos((n) => n + 1);
      setAviso({
        tipo: "erro",
        texto: "Esta compra está ligada ao estoque da Produção, e a lista de insumos ainda não carregou. Aguarde um instante e salve de novo.",
      });
      return;
    }
    const locais = validar(form, dados?.hoje, insumoEscolhido);
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      setAviso({ tipo: "erro", texto: "Confira os campos destacados." });
      focarPrimeiroErro(locais);
      return;
    }

    const emEdicao = editando;
    const estoque = entradaNoEstoque(form, insumoEscolhido);
    const corpo = {
      insumoId: insumoEscolhido ? insumoEscolhido.id : null,
      // Só manda quando não dá para converter sozinho; o servidor converte kg → g e L → mL.
      quantidadeBase: insumoEscolhido && !estoque.automatica ? estoque.quantidade : null,
      descricao: form.descricao.trim(),
      categoria: form.categoria,
      quantidade: lerQuantidade(form.quantidade),
      unidade: form.unidade,
      valorCentavos: lerValorEmCentavos(form.valor),
      // Sem data tocada, o servidor usa o hoje dele.
      data: dataTocada.current ? form.data : undefined,
      fornecedor: form.fornecedor.trim() || null,
      observacao: form.observacao.trim() || null,
    };

    setEnviando(true);
    setAviso(null);
    try {
      const resposta = await fetch(emEdicao ? `/api/admin/expenses/${emEdicao.id}` : "/api/admin/expenses", {
        method: emEdicao ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        const detalhes = json?.detalhes as Record<string, string[]> | undefined;
        if (resposta.status === 400 && detalhes) {
          const doServidor: Erros = {};
          for (const [chaveApi, mensagens] of Object.entries(detalhes)) {
            const campo = CAMPO_DA_API[chaveApi] ?? (chaveApi as Campo);
            if (ORDEM_CAMPOS.includes(campo)) doServidor[campo] = mensagens[0];
          }
          setErros(doServidor);
          focarPrimeiroErro(doServidor);
        }
        if (resposta.status === 404) {
          encerrarEdicao();
          setVersao((v) => v + 1);
        }
        setAviso({ tipo: "erro", texto: json?.erro ?? "Não foi possível salvar a despesa." });
        return;
      }

      const salva = json as DespesaDTO;
      const mesDaDespesa = salva.data.slice(0, 7);
      const outroMes = mesDaDespesa !== atual.current.mesNaTela;
      setAviso({
        tipo: "ok",
        texto:
          `${emEdicao ? "Despesa atualizada" : "Despesa lançada"}: ${salva.descricao}, ${formatarBRL(salva.valorTotal)}.` +
          (outroMes ? ` Mostrando ${nomeDoMes(mesDaDespesa)}, o mês da compra.` : ""),
      });
      if (emEdicao) {
        encerrarEdicao();
      } else {
        // Mantém a data para lançar várias notas do mesmo dia em sequência.
        setForm((f) => ({ ...FORM_VAZIO, data: f.data }));
        setErros({});
      }
      if (outroMes) setMes(mesDaDespesa);
      setVersao((v) => v + 1);
      focarCampo("descricao");
    } catch {
      setAviso({ tipo: "erro", texto: "Sem conexão. A despesa não foi salva; tente novamente." });
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(d: DespesaDTO) {
    if (enviando || excluindo) return;
    if (!window.confirm(`Excluir a despesa "${d.descricao}" (${formatarBRL(d.valorTotal)})? Isso não pode ser desfeito.`)) {
      return;
    }
    setExcluindo(d.id);
    setAvisoLista(null);
    try {
      const resposta = await fetch(`/api/admin/expenses/${d.id}`, { method: "DELETE" });
      // 404: já tinha sido excluída (outra aba): para quem usa, o resultado é o mesmo.
      if (!resposta.ok && resposta.status !== 404) {
        const json = await resposta.json().catch(() => null);
        setAvisoLista({ tipo: "erro", texto: json?.erro ?? "Não foi possível excluir a despesa." });
        return;
      }
      setAvisoLista({ tipo: "ok", texto: `Despesa excluída: ${d.descricao}.` });
      // Se era a que estava em edição AGORA (não na hora do clique), sai da edição.
      if (atual.current.editandoId === d.id) encerrarEdicao();
      setVersao((v) => v + 1);
      // O botão clicado some com a linha: o foco vai para o título da lista, não para o topo da página.
      refTituloLista.current?.focus();
    } catch {
      setAvisoLista({ tipo: "erro", texto: "Sem conexão. A despesa não foi excluída; tente novamente." });
    } finally {
      setExcluindo(null);
    }
  }

  function irParaMes(alvo: string) {
    setMes(alvo);
    // "Mês atual" some ao chegar no mês atual: o foco vai para o título do mês, não para o topo.
    refTituloMes.current?.focus();
  }

  /** Props de acessibilidade de cada campo: erro (ou dica) e textos extras ligados por aria-describedby. */
  function aria(campo: Campo, opcoes: { dica?: boolean; extras?: string[] } = {}) {
    const erro = erros[campo];
    const descritores = [erro ? `${id}-${campo}-erro` : opcoes.dica ? `${id}-${campo}-dica` : null, ...(opcoes.extras ?? [])].filter(Boolean);
    return {
      id: `${id}-${campo}`,
      "aria-invalid": erro ? true : undefined,
      "aria-describedby": descritores.length ? descritores.join(" ") : undefined,
    };
  }

  // Prévia do que foi entendido: o valor sempre; o custo de cada unidade quando a quantidade não é 1.
  const quantidadePrevia = lerQuantidade(form.quantidade);
  const centavosPrevia = lerValorEmCentavos(form.valor);
  const idPrevia = `${id}-previa`;
  const previa: ReactNode =
    centavosPrevia && centavosPrevia > 0 ? (
      quantidadePrevia && quantidadePrevia !== 1 ? (
        <>
          Cada {SIGLA_UNIDADE[form.unidade]} saiu por{" "}
          <strong className="tabular-nums">{formatarCustoUnitario(centavosPrevia / 100, quantidadePrevia)}</strong>
          <span className="text-primaria/80">
            {" "}
            ({formatarQuantidade(quantidadePrevia, form.unidade)} por {formatarBRL(centavosPrevia / 100)})
          </span>
        </>
      ) : (
        <>
          Valor entendido: <strong className="tabular-nums">{formatarBRL(centavosPrevia / 100)}</strong>
        </>
      )
    ) : null;

  // Compra de insumo: quanto entra no estoque e a que custo.
  const insumoDoForm = insumos?.find((i) => i.id === form.insumoId);
  const estoqueDoForm = entradaNoEstoque(form, insumoDoForm);

  /** Escolher o insumo já sugere a categoria (ingrediente → Ingredientes; embalagem → Potes e embalagens). */
  function escolherInsumo(e: ChangeEvent<HTMLSelectElement>) {
    const novo = insumos?.find((i) => i.id === e.target.value);
    setForm((f) => ({
      ...f,
      insumoId: e.target.value,
      categoria: novo && !f.categoria ? (novo.tipo === "INGREDIENTE" ? "INGREDIENTES" : "EMBALAGENS") : f.categoria,
      descricao: novo && !f.descricao.trim() ? novo.nome : f.descricao,
    }));
    setErros((atuais) => ({ ...atuais, insumoId: undefined, quantidadeBase: undefined }));
  }

  const mesDaData = form.data ? form.data.slice(0, 7) : null;
  const dicaData = mesDaData && mesNaTela && mesDaData !== mesNaTela ? `Vai para ${nomeDoMes(mesDaData)}.` : undefined;
  // Editar/Excluir travados enquanto salva ou exclui: a resposta atrasada não atropela outra edição.
  const linhaTravada = enviando || excluindo !== null;
  const podeVoltar = Boolean(mesNaTela && mesNaTela > PRIMEIRO_MES);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-titulos text-3xl font-bold">Despesas</h1>
        <p className="mt-1 text-sm text-primaria/80">
          Registre tudo o que você gasta com a loja: frutas, potes, adesivos, frete… O saldo do mês compara com as vendas pagas.
        </p>
      </header>

      {/* Mês em exibição */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p ref={refTituloMes} tabIndex={-1} className="font-titulos text-2xl font-bold" aria-live="polite">
          {mesNaTela ? maiuscula(nomeDoMes(mesNaTela)) : "Carregando…"}
        </p>
        <nav aria-label="Escolher o mês" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secundario aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            aria-disabled={!podeVoltar || undefined}
            onClick={() => podeVoltar && mesNaTela && setMes(somarMeses(mesNaTela, -1))}
            aria-label={mesNaTela ? `Mês anterior: ${nomeDoMes(somarMeses(mesNaTela, -1))}` : "Mês anterior"}
          >
            ‹ Anterior
          </button>
          {mesAtual && mesNaTela !== mesAtual && (
            <button type="button" className="btn-secundario" onClick={() => irParaMes(mesAtual)}>
              Mês atual
            </button>
          )}
          <button
            type="button"
            className="btn-secundario aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            aria-disabled={!mesNaTela || undefined}
            onClick={() => mesNaTela && setMes(somarMeses(mesNaTela, 1))}
            aria-label={mesNaTela ? `Próximo mês: ${nomeDoMes(somarMeses(mesNaTela, 1))}` : "Próximo mês"}
          >
            Próximo ›
          </button>
        </nav>
      </div>

      {erroCarga && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria">
          <span>{erroCarga}</span>
          <button type="button" className="btn-secundario" onClick={() => setVersao((v) => v + 1)}>
            Tentar de novo
          </button>
        </div>
      )}

      {!dados && carregando && (
        <div className="h-32 animate-pulse rounded-2xl bg-accent1/30" role="status">
          <span className="sr-only">Carregando as despesas…</span>
        </div>
      )}

      {/* Resumo do mês */}
      {exibidos && (
        <ul
          className={`grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4 transition-opacity ${carregando ? "opacity-60" : ""}`}
          aria-busy={carregando}
        >
          {/* "Entradas" inclui o líquido das lembrancinhas (pode ser negativo num mês só de devoluções). */}
          <Kpi
            rotulo={exibidos.lembrancinhas !== 0 ? "Entradas do mês" : "Vendas do mês"}
            valor={formatarBRL(exibidos.entradas)}
            dica={`${plural(exibidos.pedidosPagos, "pedido pago", "pedidos pagos")}, com frete${
              exibidos.lembrancinhas !== 0 ? `; lembrancinhas ${formatarBRL(exibidos.lembrancinhas)}` : ""
            }`}
          />
          <Kpi
            rotulo="Despesas do mês"
            valor={formatarBRL(exibidos.totalDespesas)}
            dica={plural(exibidos.lancamentos, "lançamento", "lançamentos")}
          />
          <Kpi
            rotulo="Saldo do mês"
            valor={formatarBRL(exibidos.saldo)}
            dica={exibidos.saldo < 0 ? "as despesas passaram das entradas" : "entradas menos despesas"}
          />
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        {/* Formulário */}
        <section aria-labelledby={`${id}-titulo-form`} className="cartao p-5">
          <h2 id={`${id}-titulo-form`} className="text-2xl font-bold">
            {editando ? "Editar despesa" : "Lançar despesa"}
          </h2>
          <p className="mt-1 text-xs text-primaria/75">
            {editando ? `Corrigindo "${editando.descricao}" de ${formatarDia(editando.data)}.` : "Exemplo: Adesivos, 50 unidades, R$ 20,00."}
          </p>

          <form onSubmit={salvar} noValidate className="mt-4 flex flex-col gap-4">
            <CampoForm id={`${id}-descricao`} rotulo="O que foi comprado" erro={erros.descricao}>
              <input
                {...aria("descricao")}
                required
                className="campo"
                value={form.descricao}
                onChange={mudar("descricao")}
                maxLength={120}
                autoComplete="off"
                placeholder="Ex.: Adesivos do rótulo"
              />
            </CampoForm>

            <CampoForm
              id={`${id}-categoria`}
              rotulo="Categoria"
              erro={erros.categoria}
              dica={form.categoria ? `Ex.: ${EXEMPLOS_CATEGORIA[form.categoria]}.` : undefined}
            >
              <select {...aria("categoria", { dica: Boolean(form.categoria) })} required className="campo" value={form.categoria} onChange={mudar("categoria")}>
                <option value="">Escolha…</option>
                {CATEGORIAS_DESPESA.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_CATEGORIA[c]}
                  </option>
                ))}
              </select>
            </CampoForm>

            {/* Compra de ingrediente ou embalagem: entra no estoque da Produção (o custo do pote sai daqui). */}
            {!insumos && insumosFalharam && (
              <p role="status" className="text-sm text-secundaria sm:col-span-2">
                Não foi possível carregar os insumos da Produção (para ligar a compra ao estoque).{" "}
                <button
                  type="button"
                  className="min-h-11 font-semibold underline underline-offset-2"
                  onClick={() => {
                    setInsumosFalharam(false);
                    setRecargaInsumos((n) => n + 1);
                  }}
                >
                  Tentar de novo
                </button>
              </p>
            )}
            {insumos && insumos.length > 0 && (
              <CampoForm
                id={`${id}-insumoId`}
                rotulo="Entra no estoque da produção como (opcional)"
                erro={erros.insumoId}
                dica={insumoDoForm ? `Compras anteriores: ${formatarCustoMedio(insumoDoForm.custoMedio, insumoDoForm.unidade)}` : "Escolha o ingrediente ou a embalagem para o estoque e o custo do pote."}
              >
                <select {...aria("insumoId", { dica: true })} className="campo" value={form.insumoId} onChange={escolherInsumo}>
                  <option value="">Não (despesa comum)</option>
                  {insumos
                    .filter((i) => (i.ativo && i.controlaEstoque) || i.id === form.insumoId)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nome} ({i.tipo === "INGREDIENTE" ? "ingrediente" : "embalagem"}, em {SIGLA_INSUMO[i.unidade]})
                      </option>
                    ))}
                </select>
              </CampoForm>
            )}

            <div className="grid grid-cols-2 gap-3">
              <CampoForm id={`${id}-quantidade`} rotulo="Quantidade" erro={erros.quantidade}>
                <input
                  {...aria("quantidade", { extras: previa ? [idPrevia] : [] })}
                  required
                  className="campo"
                  value={form.quantidade}
                  onChange={mudar("quantidade")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="50"
                />
              </CampoForm>
              <CampoForm id={`${id}-unidade`} rotulo="Unidade" erro={erros.unidade}>
                <select {...aria("unidade")} required className="campo" value={form.unidade} onChange={mudar("unidade")}>
                  {UNIDADES_DESPESA.map((u) => (
                    <option key={u} value={u}>
                      {NOME_UNIDADE[u]}
                    </option>
                  ))}
                </select>
              </CampoForm>
            </div>

            {insumoDoForm && !estoqueDoForm.automatica && (
              <CampoForm
                id={`${id}-quantidadeBase`}
                rotulo={`Quantos ${SIGLA_INSUMO[insumoDoForm.unidade]} de ${insumoDoForm.nome} vieram`}
                erro={erros.quantidadeBase}
                dica={`${NOME_UNIDADE[form.unidade]} não vira ${SIGLA_INSUMO[insumoDoForm.unidade]} sozinho: diga quanto entrou no estoque.`}
              >
                <input
                  {...aria("quantidadeBase", { dica: true })}
                  required
                  className="campo"
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.quantidadeBase}
                  onChange={mudar("quantidadeBase")}
                  placeholder={insumoDoForm.unidade === "UN" ? "Ex.: 24" : "Ex.: 1.000"}
                />
              </CampoForm>
            )}
            {insumoDoForm && estoqueDoForm.quantidade !== null && (
              <p className="rounded-lg border border-accent3/50 bg-white px-3 py-2 text-sm">
                Entra no estoque: <strong>{formatarQtdInsumo(estoqueDoForm.quantidade, insumoDoForm.unidade)}</strong> de {insumoDoForm.nome}
                {centavosPrevia ? (
                  <span className="text-primaria/80"> · {formatarCustoMedio(centavosPrevia / 100 / estoqueDoForm.quantidade, insumoDoForm.unidade)}</span>
                ) : null}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <CampoForm id={`${id}-valor`} rotulo="Valor pago (total)" erro={erros.valor}>
                <div className="relative">
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-primaria/80">
                    R$
                  </span>
                  <input
                    {...aria("valor", { extras: previa ? [idPrevia] : [] })}
                    required
                    className="campo pl-10"
                    value={form.valor}
                    onChange={mudar("valor")}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="20,00"
                  />
                </div>
              </CampoForm>
              <CampoForm id={`${id}-data`} rotulo="Data da compra" erro={erros.data} dica={dicaData}>
                <input
                  {...aria("data", { dica: Boolean(dicaData) })}
                  required
                  type="date"
                  className="campo"
                  value={form.data}
                  min="2020-01-01"
                  max={dados?.hoje}
                  onChange={mudar("data")}
                />
              </CampoForm>
            </div>

            {previa && (
              <p id={idPrevia} className="rounded-lg bg-accent1/25 px-3 py-2 text-sm">
                {previa}
              </p>
            )}

            <CampoForm id={`${id}-fornecedor`} rotulo="Onde comprou (opcional)" erro={erros.fornecedor}>
              <input
                {...aria("fornecedor")}
                className="campo"
                value={form.fornecedor}
                onChange={mudar("fornecedor")}
                maxLength={80}
                placeholder="Ex.: Gráfica Central"
              />
            </CampoForm>

            <CampoForm id={`${id}-observacao`} rotulo="Observação (opcional)" erro={erros.observacao}>
              <textarea
                {...aria("observacao")}
                className="campo"
                rows={2}
                value={form.observacao}
                onChange={mudar("observacao")}
                maxLength={300}
              />
            </CampoForm>

            <div className="flex flex-wrap gap-3">
              {/* aria-disabled (e não disabled): o foco fica no botão se o envio falhar. */}
              <button type="submit" className="btn-primario aria-disabled:cursor-wait aria-disabled:opacity-60" aria-disabled={enviando || undefined}>
                {enviando ? "Salvando…" : editando ? "Salvar alterações" : "Lançar despesa"}
              </button>
              {editando && (
                <button
                  type="button"
                  className="btn-secundario aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                  onClick={cancelarEdicao}
                  aria-disabled={enviando || undefined}
                >
                  Cancelar edição
                </button>
              )}
            </div>

            <p role="status" aria-live="polite" className={`min-h-5 text-sm font-medium ${aviso?.tipo === "erro" ? "text-secundaria" : ""}`}>
              {aviso?.texto}
            </p>
          </form>
        </section>

        {/* Gasto por categoria */}
        <section aria-labelledby={`${id}-titulo-categorias`} className={`cartao p-5 transition-opacity ${carregando ? "opacity-60" : ""}`}>
          <h2 id={`${id}-titulo-categorias`} className="text-2xl font-bold">
            Para onde foi o dinheiro
          </h2>
          <p className="mt-1 text-xs text-primaria/75">
            {exibidos ? `Despesas de ${nomeDoMes(exibidos.mes)} por categoria, da maior para a menor.` : "Despesas do mês por categoria."}
          </p>
          {exibidos && exibidos.porCategoria.length === 0 ? (
            <p className="py-10 text-center text-sm text-primaria/80">Nenhuma despesa lançada neste mês.</p>
          ) : (
            <ul className="mt-5 flex flex-col gap-4">
              {exibidos?.porCategoria.map((c) => {
                const parte = exibidos.totalDespesas > 0 ? c.total / exibidos.totalDespesas : 0;
                return (
                  <li key={c.categoria}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium">
                        {ROTULO_CATEGORIA[c.categoria]}
                        <span className="text-xs font-normal text-primaria/75"> · {plural(c.lancamentos, "lançamento", "lançamentos")}</span>
                      </span>
                      <span className="tabular-nums">
                        <strong>{formatarBRL(c.total)}</strong>
                        <span className="text-primaria/75"> · {porcentagem.format(parte)}</span>
                      </span>
                    </div>
                    {/* Barra só ilustra a parte do total: o valor e a % já estão escritos ao lado. */}
                    <div className="mt-1.5 h-2 rounded-full bg-accent1/30" aria-hidden="true">
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${Math.max(parte * 100, 1.5)}%`, backgroundColor: coresGrafico.despesas }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Lista do mês */}
      <section aria-labelledby={`${id}-titulo-lista`} className={`cartao p-5 transition-opacity ${carregando ? "opacity-60" : ""}`} aria-busy={carregando}>
        <h2 id={`${id}-titulo-lista`} ref={refTituloLista} tabIndex={-1} className="text-2xl font-bold">
          {exibidos ? `Despesas de ${nomeDoMes(exibidos.mes)}` : "Despesas do mês"}
        </h2>
        <p className="mt-1 text-xs text-primaria/75">Da compra mais recente para a mais antiga. Use Editar para corrigir um lançamento.</p>
        {/* Resultado de excluir aqui, perto da lista (no celular o formulário fica longe). */}
        <p role="status" aria-live="polite" className={`mb-3 mt-2 min-h-5 text-sm font-medium ${avisoLista?.tipo === "erro" ? "text-secundaria" : ""}`}>
          {avisoLista?.texto}
        </p>
        {exibidos?.truncado && (
          <p className="mb-3 text-sm font-medium">
            Mostrando os {exibidos.despesas.length} lançamentos mais recentes; os totais acima contam todos os {exibidos.lancamentos}.
          </p>
        )}
        {exibidos && exibidos.despesas.length === 0 ? (
          <p className="py-8 text-center text-sm text-primaria/80">
            Nenhuma despesa em {nomeDoMes(exibidos.mes)}. Use o formulário acima para lançar a primeira.
          </p>
        ) : exibidos ? (
          <>
            {/* Celular: cartões (a tabela de 7 colunas obrigaria a rolar de lado para achar Editar). */}
            <ul className="divide-y divide-accent1/70 sm:hidden">
              {exibidos.despesas.map((d) => (
                <li key={d.id} className={`flex flex-col gap-1.5 py-3 text-sm ${editando?.id === d.id ? "bg-accent1/20" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{d.descricao}</span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">{formatarBRL(d.valorTotal)}</span>
                  </div>
                  <p className="text-xs text-primaria/80">
                    {formatarDia(d.data)} · {ROTULO_CATEGORIA[d.categoria]}
                  </p>
                  <p className="text-xs tabular-nums text-primaria/80">
                    {formatarQuantidade(d.quantidade, d.unidade)} · {formatarCustoUnitario(d.valorTotal, d.quantidade)} / {SIGLA_UNIDADE[d.unidade]}
                  </p>
                  {d.fornecedor && <p className="text-xs text-primaria/75">{d.fornecedor}</p>}
                  {d.insumo && d.quantidadeBase !== null && (
                    <p className="text-xs text-primaria/75">Estoque: +{formatarQtdInsumo(d.quantidadeBase, d.insumo.unidade)} de {d.insumo.nome}</p>
                  )}
                  {d.observacao && <p className="text-xs italic text-primaria/75">{d.observacao}</p>}
                  <AcoesLinha d={d} travada={linhaTravada} excluindo={excluindo === d.id} onEditar={editar} onExcluir={excluir} />
                </li>
              ))}
              <li className="flex items-baseline justify-between py-3 text-sm font-semibold">
                <span>Total do mês</span>
                <span className="font-bold tabular-nums">{formatarBRL(exibidos.totalDespesas)}</span>
              </li>
            </ul>

            {/* `relative`: os spans sr-only dos botões são absolutos e, sem isso, esticam a página. */}
            <div role="region" aria-label="Tabela das despesas do mês" tabIndex={0} className="relative hidden overflow-x-auto sm:block">
              <table className="w-full min-w-3xl text-left text-sm">
                <caption className="sr-only">Despesas de {nomeDoMes(exibidos.mes)}</caption>
                <thead className="border-b-2 border-accent2/60">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Data</th>
                    <th scope="col" className="px-3 py-2 font-semibold">O que foi comprado</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Categoria</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Quantidade</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Custo unitário</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Valor pago</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-accent1/70">
                  {exibidos.despesas.map((d) => (
                    <tr key={d.id} className={editando?.id === d.id ? "bg-accent1/20" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2">{formatarDia(d.data)}</td>
                      <td className="px-3 py-2">
                        <span className="font-semibold">{d.descricao}</span>
                        {d.fornecedor && <span className="block text-xs text-primaria/75">{d.fornecedor}</span>}
                        {d.insumo && d.quantidadeBase !== null && (
                          <span className="block text-xs text-primaria/75">
                            Estoque: +{formatarQtdInsumo(d.quantidadeBase, d.insumo.unidade)} de {d.insumo.nome}
                          </span>
                        )}
                        {d.observacao && <span className="block text-xs italic text-primaria/75">{d.observacao}</span>}
                      </td>
                      <td className="px-3 py-2">{ROTULO_CATEGORIA[d.categoria]}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatarQuantidade(d.quantidade, d.unidade)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {formatarCustoUnitario(d.valorTotal, d.quantidade)}
                        <span className="text-primaria/75"> / {SIGLA_UNIDADE[d.unidade]}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatarBRL(d.valorTotal)}</td>
                      <td className="px-3 py-2">
                        <AcoesLinha d={d} travada={linhaTravada} excluindo={excluindo === d.id} onEditar={editar} onExcluir={excluir} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-accent2/60">
                  <tr>
                    <th scope="row" colSpan={5} className="px-3 py-2 text-right font-semibold">
                      Total do mês
                    </th>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">{formatarBRL(exibidos.totalDespesas)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

/** Editar e Excluir de uma linha. aria-disabled (não disabled) para o foco não se perder se der erro. */
function AcoesLinha({
  d,
  travada,
  excluindo,
  onEditar,
  onExcluir,
}: {
  d: DespesaDTO;
  travada: boolean;
  excluindo: boolean;
  onEditar: (d: DespesaDTO) => void;
  onExcluir: (d: DespesaDTO) => void;
}) {
  const classe =
    "inline-flex min-h-11 items-center rounded-full border-2 border-accent2 px-3 text-xs font-semibold text-primaria transition-colors hover:bg-accent1/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={classe} aria-disabled={travada || undefined} onClick={() => onEditar(d)}>
        Editar<span className="sr-only"> {d.descricao}</span>
      </button>
      <button type="button" className={classe} aria-disabled={travada || undefined} onClick={() => onExcluir(d)}>
        {excluindo ? "Excluindo…" : "Excluir"}
        <span className="sr-only"> {d.descricao}</span>
      </button>
    </div>
  );
}
