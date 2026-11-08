"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CategoriaDTO, TipoLancamento } from "@/lib/planilha/tipos";
import type { FormaPagamento } from "@/lib/vendas";
import type { UnidadeDespesa } from "@/lib/despesas";
import type { Direcao } from "./teclado";
import {
  OPCOES_FORMA,
  OPCOES_TIPO,
  OPCOES_UNIDADE,
  filtrarOpcoes,
  lerData,
  lerQuantidadeDigitada,
  lerValor,
  normalizar,
  opcaoDoTexto,
  opcoesDeCategoria,
  type CampoId,
  type Campos,
  type Opcao,
} from "./modelo";

/** Limites de texto da API (descrição 120, observação 300, fornecedor 80). */
const MAXIMO: Partial<Record<CampoId, number>> = { descricao: 120, observacao: 300, fornecedor: 80 };

type OpcaoDaLista = Opcao & { criar?: TipoLancamento };

export type PropsEditor = {
  campo: CampoId;
  /** Texto com que o campo começa (o conteúdo atual com F2/Enter, ou a tecla digitada). */
  textoInicial: string;
  /** Começou digitando uma letra (troca o conteúdo): a lista já vem filtrada por ela. */
  substituir: boolean;
  campos: Campos;
  categorias: readonly CategoriaDTO[];
  descricoes: readonly string[];
  hoje: string;
  rotulo: string;
  /** Confirma; `depois` = para onde vai o foco (null = fica na célula, como no clique fora). */
  aoConfirmar: (mudancas: Partial<Campos>, depois: Direcao | null) => void;
  aoCancelar: (motivo?: string) => void;
  aoCriarCategoria: (tipo: TipoLancamento, nome: string) => Promise<{ ok: true; categoria: CategoriaDTO } | { ok: false; erro: string }>;
  /** Colar várias células (texto com Tab ou quebra de linha) dentro do campo: vira colagem na grade. */
  aoColarVarias: (texto: string) => void;
};

/**
 * Campo de edição de uma célula. Nas colunas de escolha (Tipo, Categoria, Forma, Unidade) e na
 * Descrição, é um combobox ARIA com lista filtrada pelo que se digita (sem acento); na Categoria, a
 * lista termina com "+ Criar categoria" quando o nome não existe. Erro de leitura (data, valor) não
 * fecha o campo: a mensagem aparece embaixo, ligada por aria-describedby.
 */
export function EditorCelula(p: PropsEditor) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState(p.textoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(p.substituir && p.campo !== "descricao" ? 0 : -1);
  const [ocupado, setOcupado] = useState(false);
  const [paraCima, setParaCima] = useState(false);
  const encerrado = useRef(false);

  const comLista = ["tipo", "categoriaId", "formaPagamento", "unidade", "descricao"].includes(p.campo);
  const todas = useMemo<Opcao[]>(() => {
    switch (p.campo) {
      case "tipo":
        return [...OPCOES_TIPO];
      case "categoriaId":
        return opcoesDeCategoria(p.categorias, p.campos.tipo, p.campos.categoriaId);
      case "formaPagamento":
        return [...OPCOES_FORMA];
      case "unidade":
        return [...OPCOES_UNIDADE];
      case "descricao":
        return p.descricoes.map((d) => ({ valor: d, rotulo: d }));
      default:
        return [];
    }
  }, [p.campo, p.categorias, p.campos.tipo, p.campos.categoriaId, p.descricoes]);

  const opcoes = useMemo<OpcaoDaLista[]>(() => {
    if (!comLista) return [];
    // Ao abrir com F2/Enter (texto = valor atual), a lista mostra tudo; ao digitar, filtra.
    const filtro = texto === p.textoInicial && !p.substituir && p.campo !== "descricao" ? "" : texto;
    let lista: OpcaoDaLista[] = filtrarOpcoes(todas, filtro);
    if (p.campo === "descricao") lista = texto.trim() ? lista.filter((o) => normalizar(o.rotulo) !== normalizar(texto)).slice(0, 8) : [];
    if (p.campo === "categoriaId" && texto.trim() && !todas.some((o) => normalizar(o.rotulo) === normalizar(texto))) {
      const tipos: TipoLancamento[] = p.campos.tipo ? [p.campos.tipo] : ["SAIDA", "ENTRADA"];
      lista = [
        ...lista,
        ...tipos.map((t) => ({
          valor: `__criar-${t}`,
          rotulo: `+ Criar categoria “${texto.trim().slice(0, 40)}”`,
          detalhe: t === "SAIDA" ? "de saída" : "de entrada",
          criar: t,
        })),
      ];
    }
    return lista;
  }, [comLista, todas, texto, p.textoInicial, p.substituir, p.campo, p.campos.tipo]);

  const aberto = comLista && opcoes.length > 0;
  const ativoValido = ativo >= 0 && ativo < opcoes.length ? ativo : -1;

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    // Começou digitando: cursor no fim. F2/Enter: tudo selecionado? Não: no Excel o F2 põe o cursor no fim.
    el.setSelectionRange(el.value.length, el.value.length);
    // Pouco espaço embaixo (últimas linhas): a lista abre para cima.
    const caixa = el.closest("[data-rolagem]")?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (caixa) setParaCima(caixa.bottom - r.bottom < 240 && r.top - caixa.top > 240);
  }, []);

  useEffect(() => {
    if (ativoValido >= 0) document.getElementById(`${id}-op-${ativoValido}`)?.scrollIntoView({ block: "nearest" });
  }, [ativoValido, id]);

  /** Lê o que está digitado (ou a opção escolhida) e devolve as mudanças da linha, ou o erro. */
  function ler(escolhida: OpcaoDaLista | null): { ok: true; mudancas: Partial<Campos> } | { ok: false; erro: string } | { ok: "criar"; tipo: TipoLancamento } {
    const t = texto.trim();
    switch (p.campo) {
      case "data": {
        const r = lerData(t, p.hoje);
        return r.ok ? { ok: true, mudancas: { data: r.valor } } : r;
      }
      case "valorCentavos": {
        const r = lerValor(t);
        if (!r.ok) return r;
        if (!r.valor.negativo) return { ok: true, mudancas: { valorCentavos: r.valor.centavos } };
        if (p.campos.tipo === "ENTRADA") return { ok: false, erro: "Valor negativo numa entrada: digite sem o sinal ou troque o tipo para Saída." };
        // Valor negativo numa linha sem tipo vira Saída (como na planilha dela).
        return { ok: true, mudancas: { valorCentavos: r.valor.centavos, ...(p.campos.tipo ? {} : { tipo: "SAIDA" as const }) } };
      }
      case "quantidade": {
        if (!t) return { ok: true, mudancas: { quantidade: null } };
        const r = lerQuantidadeDigitada(t);
        return r.ok ? { ok: true, mudancas: { quantidade: r.valor } } : r;
      }
      case "descricao":
      case "observacao":
      case "fornecedor": {
        const valor = escolhida && p.campo === "descricao" ? escolhida.valor : t;
        const max = MAXIMO[p.campo] ?? 120;
        if (valor.length > max) return { ok: false, erro: `Texto longo demais: no máximo ${max} letras.` };
        return { ok: true, mudancas: { [p.campo]: valor } as Partial<Campos> };
      }
      case "tipo": {
        const o = escolhida ?? opcaoDoTexto(todas, t);
        if (!o) return { ok: false, erro: "Escolha Entrada ou Saída (digite E ou S)." };
        return { ok: true, mudancas: { tipo: o.valor as TipoLancamento } };
      }
      case "categoriaId": {
        if (escolhida?.criar) return { ok: "criar", tipo: escolhida.criar };
        const o = escolhida ?? opcaoDoTexto(todas, t);
        if (!o) return { ok: false, erro: t ? "Categoria não encontrada: escolha da lista ou crie uma nova (seta para baixo)." : "Escolha a categoria." };
        const categoria = p.categorias.find((c) => c.id === o.valor);
        return { ok: true, mudancas: { categoriaId: o.valor, ...(!p.campos.tipo && categoria ? { tipo: categoria.tipo } : {}) } };
      }
      case "formaPagamento": {
        if (!t && !escolhida) return { ok: true, mudancas: { formaPagamento: null } };
        const o = escolhida ?? opcaoDoTexto(todas, t);
        return o ? { ok: true, mudancas: { formaPagamento: o.valor as FormaPagamento } } : { ok: false, erro: "Escolha uma forma da lista (PIX, Dinheiro…)." };
      }
      case "unidade": {
        if (!t && !escolhida) return { ok: true, mudancas: { unidade: null } };
        const o = escolhida ?? opcaoDoTexto(todas, t);
        return o ? { ok: true, mudancas: { unidade: o.valor as UnidadeDespesa } } : { ok: false, erro: "Escolha uma unidade da lista." };
      }
    }
  }

  async function confirmar(depois: Direcao | null, escolhida: OpcaoDaLista | null = aberto && ativoValido >= 0 ? opcoes[ativoValido] : null) {
    if (encerrado.current || ocupado) return false;
    // Na descrição, Enter sem escolher na lista grava o que foi digitado.
    const r = ler(escolhida);
    if (r.ok === "criar") {
      setOcupado(true);
      const criada = await p.aoCriarCategoria(r.tipo, texto.trim().slice(0, 40));
      setOcupado(false);
      if (!criada.ok) {
        setErro(criada.erro);
        return false;
      }
      encerrado.current = true;
      p.aoConfirmar({ categoriaId: criada.categoria.id, ...(p.campos.tipo ? {} : { tipo: criada.categoria.tipo }) }, depois);
      return true;
    }
    if (!r.ok) {
      setErro(r.erro);
      return false;
    }
    encerrado.current = true;
    p.aoConfirmar(r.mudancas, depois);
    return true;
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    // A grade não trata as teclas do campo: daqui não sobe nada.
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (aberto && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = opcoes.length;
      setAtivo((a) => (e.key === "ArrowDown" ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      void confirmar(e.key === "Enter" ? (e.shiftKey ? "cima" : "baixo") : e.shiftKey ? "esquerda" : "direita");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (aberto && ativoValido >= 0) {
        setAtivo(-1);
        return;
      }
      encerrado.current = true;
      p.aoCancelar();
    }
  }

  const erroId = `${id}-erro`;
  const listaId = `${id}-lista`;

  return (
    <div className="relative">
      <input
        ref={input}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setErro(null);
          setAtivo(p.campo === "descricao" ? -1 : 0);
        }}
        onKeyDown={tecla}
        onPaste={(e) => {
          const colado = e.clipboardData.getData("text/plain");
          if (/[\t\n]/.test(colado.replace(/\r?\n$/, ""))) {
            e.preventDefault();
            encerrado.current = true;
            p.aoColarVarias(colado);
          }
        }}
        onBlur={() => {
          // Clicou fora: guarda se der para ler; senão desiste (e avisa o porquê).
          if (encerrado.current) return;
          const r = ler(null);
          if (r.ok === true) {
            encerrado.current = true;
            p.aoConfirmar(r.mudancas, null);
          } else {
            encerrado.current = true;
            p.aoCancelar(r.ok === false ? r.erro : undefined);
          }
        }}
        aria-label={p.rotulo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? erroId : undefined}
        {...(comLista
          ? {
              role: "combobox",
              "aria-expanded": aberto,
              "aria-controls": listaId,
              "aria-autocomplete": "list" as const,
              "aria-activedescendant": aberto && ativoValido >= 0 ? `${id}-op-${ativoValido}` : undefined,
            }
          : {})}
        inputMode={p.campo === "valorCentavos" || p.campo === "quantidade" ? "decimal" : undefined}
        maxLength={MAXIMO[p.campo] ? (MAXIMO[p.campo] ?? 0) + 20 : 60}
        autoComplete="off"
        spellCheck={p.campo === "descricao" || p.campo === "observacao"}
        disabled={ocupado}
        className={`block h-11 w-full min-w-0 border-0 bg-white px-2 text-base text-primaria outline-2 outline-offset-0 outline-secundaria focus:outline-2 ${
          p.campo === "valorCentavos" || p.campo === "quantidade" ? "text-right tabular-nums" : ""
        } ${erro ? "outline-[3px] outline-[#B3261E]" : ""}`}
      />
      {comLista && (
        <ul
          id={listaId}
          role="listbox"
          aria-label={`Opções de ${p.rotulo}`}
          hidden={!aberto}
          className={`absolute left-0 z-30 max-h-60 min-w-full overflow-y-auto rounded-md border-2 border-primaria/70 bg-white py-1 shadow-lg ${
            paraCima ? "bottom-full mb-1" : "top-full mt-1"
          } w-max max-w-[22rem]`}
        >
          {opcoes.map((o, i) => (
            <li
              key={o.valor}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === ativoValido}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void confirmar(null, o)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-base ${
                i === ativoValido ? "bg-primaria text-destaque" : "text-primaria hover:bg-accent1/40"
              } ${o.criar ? "font-semibold" : ""}`}
            >
              <span>{o.rotulo}</span>
              {o.detalhe && <span className={`text-sm ${i === ativoValido ? "text-destaque" : "text-primaria/80"}`}>{o.detalhe}</span>}
            </li>
          ))}
        </ul>
      )}
      {erro && (
        <p
          id={erroId}
          role="alert"
          className={`absolute left-0 z-30 w-max max-w-[22rem] rounded-md border-2 border-[#B3261E] bg-white px-3 py-2 text-sm font-semibold text-[#8C1D18] shadow-lg ${
            // Do lado oposto ao da lista, para não cobrir as opções.
            (aberto ? !paraCima : paraCima) ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {erro} <span className="font-normal">(Esc desiste)</span>
        </p>
      )}
    </div>
  );
}
