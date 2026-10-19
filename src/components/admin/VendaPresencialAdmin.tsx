"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { hojeNaLoja } from "@/lib/despesas";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import { codigoPedido } from "@/lib/formatacao";
import { MAX_POR_PRODUTO } from "@/lib/limites";
import { FORMAS_PAGAMENTO, MAX_PRECO_UNITARIO_CENTAVOS, ROTULO_FORMA_PAGAMENTO, type FormaPagamento } from "@/lib/vendas";

export type ProdutoDaVenda = { id: string; nome: string; precoCentavos: number };

type Linha = { quantidade: string; preco: string };
type Situacao = "ENTREGUE" | "PAGO";

/** Chave única por tentativa (Idempotency-Key). `randomUUID` só existe em contexto seguro (HTTPS/localhost). */
function novaChave(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  );
}

const linhasIniciais = (produtos: ProdutoDaVenda[]): Record<string, Linha> =>
  Object.fromEntries(produtos.map((p) => [p.id, { quantidade: "", preco: valorParaCampo(p.precoCentavos / 100) }]));

/** "3" → 3; vazio → 0; o resto (1,5; -1; 100) → null. */
function lerQuantidade(texto: string): number | null {
  const t = texto.trim();
  if (!t) return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_POR_PRODUTO ? n : null;
}

/**
 * Formulário de venda presencial (feira, balcão). Cada produto do catálogo aparece com quantidade e
 * preço (o do catálogo, editável para desconto). O total é recalculado no servidor do mesmo jeito
 * (centavos inteiros). Depois de registrar, o formulário volta limpo para a próxima venda.
 */
export function VendaPresencialAdmin({ produtos }: { produtos: ProdutoDaVenda[] }) {
  const uid = useId();
  const [linhas, setLinhas] = useState<Record<string, Linha>>(() => linhasIniciais(produtos));
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | null>(null);
  const [situacao, setSituacao] = useState<Situacao>("ENTREGUE");
  const [outroDia, setOutroDia] = useState(false);
  const [dia, setDia] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<{ id: string; total: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  // Mesma venda reenviada (duplo clique, rede que caiu) => mesma chave; qualquer mudança => chave nova.
  const tentativa = useRef<{ chave: string; assinatura: string } | null>(null);
  const alertaRef = useRef<HTMLParagraphElement>(null);
  const sucessoRef = useRef<HTMLParagraphElement>(null);

  // Total ao vivo (só das linhas válidas; as inválidas aparecem com erro ao enviar).
  let totalCentavos = 0;
  let potes = 0;
  for (const p of produtos) {
    const q = lerQuantidade(linhas[p.id].quantidade);
    const c = lerValorEmCentavos(linhas[p.id].preco);
    if (q && c !== null) {
      totalCentavos += q * c;
      potes += q;
    }
  }

  function mudarLinha(id: string, campo: keyof Linha, valor: string) {
    setLinhas((atual) => ({ ...atual, [id]: { ...atual[id], [campo]: valor } }));
    setSucesso(null);
  }

  function mostrarErros(porCampo: Record<string, string>, geral: string) {
    flushSync(() => {
      setErros(porCampo);
      setErroGeral(geral);
    });
    alertaRef.current?.focus();
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current) return;
    setSucesso(null);

    // Validação local (a mesma regra roda no servidor).
    const porCampo: Record<string, string> = {};
    const itens: { productId: string; quantidade: number; precoUnitarioCentavos: number }[] = [];
    for (const p of produtos) {
      const q = lerQuantidade(linhas[p.id].quantidade);
      const c = lerValorEmCentavos(linhas[p.id].preco);
      if (q === null) porCampo[`qtd-${p.id}`] = `Use um número inteiro de 0 a ${MAX_POR_PRODUTO}.`;
      if (q && c === null) porCampo[`preco-${p.id}`] = "Preço inválido (ex.: 24,90).";
      if (q && c !== null && c > MAX_PRECO_UNITARIO_CENTAVOS) porCampo[`preco-${p.id}`] = `Máximo de ${formatarBRL(MAX_PRECO_UNITARIO_CENTAVOS / 100)} por pote.`;
      if (q && c !== null && c <= MAX_PRECO_UNITARIO_CENTAVOS) itens.push({ productId: p.id, quantidade: q, precoUnitarioCentavos: c });
    }
    if (itens.length === 0 && Object.keys(porCampo).length === 0) porCampo.itens = "Informe a quantidade de pelo menos um produto.";
    else if (itens.length > 0 && itens.every((i) => i.precoUnitarioCentavos === 0)) porCampo.itens = "A venda não pode ter total zero (brinde vai em Despesas).";
    if (!formaPagamento) porCampo.formaPagamento = "Escolha a forma de pagamento.";
    if (outroDia && !dia) porCampo.data = "Escolha o dia da venda.";
    if (Object.keys(porCampo).length > 0) {
      mostrarErros(porCampo, "Confira os campos destacados.");
      return;
    }

    const corpo = {
      itens,
      formaPagamento,
      status: situacao,
      // "Hoje" vai sem data: o servidor usa o dia dele (uma aba aberta desde ontem não grava a data de ontem).
      ...(outroDia ? { data: dia } : {}),
      clienteNome: clienteNome.trim() || null,
      observacao: observacao.trim() || null,
    };
    const assinatura = JSON.stringify(corpo);
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { chave: novaChave(), assinatura };

    setErros({});
    setErroGeral(null);
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resposta = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": tentativa.current.chave },
        body: JSON.stringify(corpo),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        // Erros por campo vêm com o caminho ("itens.0.precoUnitarioCentavos"): leva ao produto certo.
        const doServidor: Record<string, string> = {};
        const detalhes: Record<string, string[]> = json?.detalhes && typeof json.detalhes === "object" ? json.detalhes : {};
        for (const [caminho, mensagens] of Object.entries(detalhes)) {
          const m = /^itens\.(\d+)\.(quantidade|precoUnitarioCentavos)$/.exec(caminho);
          const item = m ? itens[Number(m[1])] : undefined;
          const chave = item ? `${m![2] === "quantidade" ? "qtd" : "preco"}-${item.productId}` : caminho.split(".")[0];
          doServidor[chave] = Array.isArray(mensagens) ? String(mensagens[0]) : String(mensagens);
        }
        mostrarErros(doServidor, json?.erro ?? "Não foi possível registrar a venda.");
        return;
      }
      // Registrada: descarta a chave (a próxima venda, mesmo idêntica, é outra) e limpa para a próxima.
      tentativa.current = null;
      flushSync(() => {
        setSucesso({ id: json.venda.id, total: json.venda.total });
        setLinhas(linhasIniciais(produtos));
        setFormaPagamento(null);
        setSituacao("ENTREGUE");
        setOutroDia(false);
        setDia("");
        setClienteNome("");
        setObservacao("");
      });
      sucessoRef.current?.focus();
    } catch {
      mostrarErros({}, "Sem conexão. Tente de novo: a mesma venda não será lançada duas vezes.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const id = (sufixo: string) => `${uid}-${sufixo}`;
  const erroDe = (chave: string) =>
    erros[chave] ? (
      <p id={id(`erro-${chave}`)} className="mt-1 text-sm font-medium text-secundaria">
        {erros[chave]}
      </p>
    ) : null;
  const descrito = (chave: string) => (erros[chave] ? id(`erro-${chave}`) : undefined);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulos text-3xl font-bold">Registrar venda presencial</h1>
          <p className="mt-1 max-w-prose text-sm text-primaria/80">
            Venda feita na feira ou no balcão. Entra no faturamento como pedido pago, sem frete. Preencha só os produtos vendidos.
          </p>
        </div>
        <Link href="/admin/orders" className="btn-secundario">
          Ver pedidos
        </Link>
      </header>

      <p ref={sucessoRef} tabIndex={-1} role="status" className="text-sm font-semibold outline-offset-4 empty:hidden">
        {sucesso && (
          <>
            Venda {codigoPedido(sucesso.id)} registrada: {formatarBRL(sucesso.total)}. O formulário está pronto para a próxima.
          </>
        )}
      </p>

      <form onSubmit={enviar} noValidate className="flex flex-col gap-6">
        <fieldset className="cartao p-4 sm:p-6" aria-describedby={descrito("itens")}>
          <legend className="float-left mb-3 w-full font-titulos text-xl font-bold">Produtos</legend>
          <ul className="clear-left divide-y divide-accent1/70">
            {produtos.map((p) => {
              const linha = linhas[p.id];
              const q = lerQuantidade(linha.quantidade);
              const c = lerValorEmCentavos(linha.preco);
              const precoDiferente = c !== null && c !== p.precoCentavos;
              return (
                <li key={p.id} className="relative grid grid-cols-2 gap-x-3 gap-y-2 py-3 sm:grid-cols-[1fr_7rem_9rem_7rem] sm:items-start">
                  <p className="col-span-2 pt-2 font-semibold sm:col-span-1">{p.nome}</p>
                  <div>
                    <label htmlFor={id(`qtd-${p.id}`)} className="mb-1 block text-xs font-semibold">
                      Quantidade<span className="sr-only"> de {p.nome}</span>
                    </label>
                    <input
                      id={id(`qtd-${p.id}`)}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      value={linha.quantidade}
                      onChange={(e) => mudarLinha(p.id, "quantidade", e.target.value)}
                      className="campo tabular-nums"
                      aria-invalid={erros[`qtd-${p.id}`] ? true : undefined}
                      aria-describedby={descrito(`qtd-${p.id}`)}
                    />
                    {erroDe(`qtd-${p.id}`)}
                  </div>
                  <div>
                    <label htmlFor={id(`preco-${p.id}`)} className="mb-1 block text-xs font-semibold">
                      Preço por pote (R$)<span className="sr-only"> de {p.nome}</span>
                    </label>
                    <input
                      id={id(`preco-${p.id}`)}
                      inputMode="decimal"
                      autoComplete="off"
                      value={linha.preco}
                      onChange={(e) => mudarLinha(p.id, "preco", e.target.value)}
                      className="campo tabular-nums"
                      aria-invalid={erros[`preco-${p.id}`] ? true : undefined}
                      aria-describedby={[descrito(`preco-${p.id}`), precoDiferente ? id(`catalogo-${p.id}`) : undefined].filter(Boolean).join(" ") || undefined}
                    />
                    {precoDiferente && (
                      <p id={id(`catalogo-${p.id}`)} className="mt-1 text-xs font-medium text-primaria/80">
                        Catálogo: {formatarBRL(p.precoCentavos / 100)}
                      </p>
                    )}
                    {erroDe(`preco-${p.id}`)}
                  </div>
                  <p className="col-span-2 text-right text-sm tabular-nums sm:col-span-1 sm:pt-8">
                    {q && c !== null ? formatarBRL((q * c) / 100) : <span className="text-primaria/60">—</span>}
                  </p>
                </li>
              );
            })}
          </ul>
          {erroDe("itens")}
          <p className="mt-4 flex items-baseline justify-between border-t-2 border-accent2/60 pt-3" aria-live="polite" aria-atomic="true">
            <span className="font-semibold">
              Total{potes > 0 ? ` (${potes} ${potes === 1 ? "pote" : "potes"})` : ""}
            </span>
            <span className="font-titulos text-2xl font-bold tabular-nums">{formatarBRL(totalCentavos / 100)}</span>
          </p>
        </fieldset>

        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset className="cartao p-4 sm:p-6" aria-describedby={descrito("formaPagamento")}>
            <legend className="float-left mb-3 w-full font-titulos text-xl font-bold">Pagamento</legend>
            <div className="clear-left grid gap-2 sm:grid-cols-2">
              {FORMAS_PAGAMENTO.map((f) => (
                <label key={f} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-primaria/30 px-3 has-checked:border-secundaria has-checked:bg-accent1/30">
                  <input type="radio" name={id("forma")} value={f} checked={formaPagamento === f} onChange={() => setFormaPagamento(f)} className="size-4 accent-secundaria" />
                  <span className="text-sm font-medium">{ROTULO_FORMA_PAGAMENTO[f]}</span>
                </label>
              ))}
            </div>
            {erroDe("formaPagamento")}
          </fieldset>

          <fieldset className="cartao p-4 sm:p-6">
            <legend className="float-left mb-3 w-full font-titulos text-xl font-bold">Situação</legend>
            <div className="clear-left grid gap-2">
              {(
                [
                  ["ENTREGUE", "Entregue na hora", "o cliente levou o pote"],
                  ["PAGO", "Paga, entregar depois", "encomenda: marque como entregue depois, em Pedidos"],
                ] as const
              ).map(([valor, rotulo, dica]) => (
                <label key={valor} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-primaria/30 px-3 py-2 has-checked:border-secundaria has-checked:bg-accent1/30">
                  <input type="radio" name={id("situacao")} value={valor} checked={situacao === valor} onChange={() => setSituacao(valor)} className="mt-1 size-4 accent-secundaria" />
                  <span className="text-sm">
                    <span className="font-medium">{rotulo}</span>
                    <span className="block text-xs text-primaria/80">{dica}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset className="cartao p-4 sm:p-6" aria-describedby={descrito("data")}>
            <legend className="float-left mb-3 w-full font-titulos text-xl font-bold">Data da venda</legend>
            <div className="clear-left flex flex-wrap gap-2">
              {([false, true] as const).map((outro) => (
                <label key={String(outro)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-primaria/30 px-3 has-checked:border-secundaria has-checked:bg-accent1/30">
                  <input type="radio" name={id("quando")} checked={outroDia === outro} onChange={() => setOutroDia(outro)} className="size-4 accent-secundaria" />
                  <span className="text-sm font-medium">{outro ? "Outro dia" : "Hoje"}</span>
                </label>
              ))}
            </div>
            {outroDia && (
              <div className="mt-3">
                <label htmlFor={id("dia")} className="mb-1 block text-sm font-semibold">
                  Dia da venda
                </label>
                <input
                  id={id("dia")}
                  type="date"
                  min="2020-01-01"
                  max={hojeNaLoja()}
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                  className="campo"
                  aria-invalid={erros.data ? true : undefined}
                  aria-describedby={descrito("data")}
                />
              </div>
            )}
            {erroDe("data")}
          </fieldset>

          <fieldset className="cartao p-4 sm:p-6">
            <legend className="float-left mb-3 w-full font-titulos text-xl font-bold">Cliente e observação</legend>
            <div className="clear-left flex flex-col gap-4">
            <div>
              <label htmlFor={id("cliente")} className="mb-1 block text-sm font-semibold">
                Nome do cliente <span className="font-normal text-primaria/80">(opcional)</span>
              </label>
              <input
                id={id("cliente")}
                maxLength={100}
                autoComplete="off"
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
                className="campo"
                aria-invalid={erros.clienteNome ? true : undefined}
                aria-describedby={descrito("clienteNome")}
              />
              {erroDe("clienteNome")}
            </div>
            <div>
              <label htmlFor={id("obs")} className="mb-1 block text-sm font-semibold">
                Observação <span className="font-normal text-primaria/80">(opcional, ex.: Feira da Praça)</span>
              </label>
              <textarea
                id={id("obs")}
                rows={2}
                maxLength={300}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="campo"
                aria-invalid={erros.observacao ? true : undefined}
                aria-describedby={descrito("observacao")}
              />
              {erroDe("observacao")}
            </div>
            </div>
          </fieldset>
        </div>

        <p ref={alertaRef} tabIndex={-1} role="alert" className="text-sm font-medium text-secundaria outline-offset-4 empty:hidden">
          {erroGeral}
        </p>

        {/* Barra presa ao pé da tela: no celular, na feira, o total e o botão ficam sempre à vista. */}
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-accent2/60 bg-destaque/95 px-1 py-3">
          <p className="text-sm">
            Total <strong className="font-titulos text-xl tabular-nums">{formatarBRL(totalCentavos / 100)}</strong>
          </p>
          <button type="submit" aria-disabled={enviando || undefined} className="btn-primario aria-disabled:cursor-not-allowed aria-disabled:opacity-60">
            {enviando ? "Registrando…" : "Registrar venda"}
          </button>
        </div>
      </form>
    </div>
  );
}
