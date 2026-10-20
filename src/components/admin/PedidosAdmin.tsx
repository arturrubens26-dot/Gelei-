"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EtiquetaStatus } from "@/components/EtiquetaStatus";
import type { PedidoAdminDTO } from "@/lib/admin";
import { hojeNaLoja } from "@/lib/despesas";
import { formatarBRL } from "@/lib/dinheiro";
import { ROTULO_STATUS, codigoPedido, formatarDataHora } from "@/lib/formatacao";
import { TODOS_STATUS, transicoesPermitidas, type StatusPedido } from "@/lib/status";
import { ROTULO_CANAL, ROTULO_FORMA_PAGAMENTO, TODOS_CANAIS, type CanalPedido } from "@/lib/vendas";

type Resposta = { pedidos: PedidoAdminDTO[]; total: number; pagina: number; porPagina: number };
type Filtro = StatusPedido | "TODOS";
type FiltroCanal = CanalPedido | "TODOS";

/** Rótulo do botão de cancelar: a venda presencial já entregue é "estornada" (lançamento errado). */
function rotuloAcao(p: PedidoAdminDTO, destino: StatusPedido): string {
  if (destino !== "CANCELADO" || p.canal !== "PRESENCIAL") return ACAO[destino];
  return p.status === "ENTREGUE" ? "Estornar venda" : "Cancelar venda";
}

/** Rótulo do botão que leva o pedido ao próximo status. */
const ACAO: Record<StatusPedido, string> = {
  PENDENTE: "Pendente",
  PAGO: "Marcar como Pago",
  ENVIADO: "Marcar como Enviado",
  ENTREGUE: "Marcar como Entregue",
  CANCELADO: "Cancelar pedido",
};

const botaoAcao =
  "inline-flex min-h-11 items-center rounded-full border-2 px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function PedidosAdmin() {
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [canal, setCanal] = useState<FiltroCanal>("TODOS");
  const [pagina, setPagina] = useState(1);
  const [versao, setVersao] = useState(0); // incrementa para recarregar após uma ação
  const [consulta, setConsulta] = useState<{ chave: string; dados?: Resposta; erro?: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const chave = `${filtro}|${canal}|${pagina}|${versao}`;

  useEffect(() => {
    let cancelado = false;
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (filtro !== "TODOS") params.set("status", filtro);
    if (canal !== "TODOS") params.set("canal", canal);

    fetch(`/api/admin/orders?${params}`)
      .then(async (resposta) => {
        const json = await resposta.json().catch(() => null);
        if (cancelado) return;
        // Página além do fim (ex.: o último pedido da página 2 mudou de status e a lista encolheu):
        // volta para a última página que existe em vez de mostrar "Página 2 de 1" vazia.
        if (resposta.ok && json.pedidos.length === 0 && json.total > 0 && json.pagina > 1) {
          setPagina(Math.max(1, Math.ceil(json.total / json.porPagina)));
          return;
        }
        setConsulta(
          resposta.ok ? { chave, dados: json } : { chave, erro: json?.erro ?? "Não foi possível carregar os pedidos." },
        );
      })
      .catch(() => {
        if (!cancelado) setConsulta({ chave, erro: "Sem conexão. Tente novamente." });
      });
    return () => {
      cancelado = true;
    };
  }, [chave, filtro, canal, pagina]);

  // Ao recarregar, mantém a tabela anterior (esmaecida) em vez de piscar um esqueleto.
  const carregando = consulta?.chave !== chave;
  const dados = consulta?.dados;
  const erro = !carregando ? consulta?.erro : undefined;
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  async function alterar(pedido: PedidoAdminDTO, novo: StatusPedido) {
    const pergunta =
      pedido.canal === "PRESENCIAL"
        ? `${rotuloAcao(pedido, novo)} ${codigoPedido(pedido.id)} (${formatarBRL(pedido.total)})? Ela sai do faturamento e isso não pode ser desfeito.`
        : `Cancelar o pedido ${codigoPedido(pedido.id)}? Isso não pode ser desfeito.`;
    if (novo === "CANCELADO" && !window.confirm(pergunta)) {
      return;
    }
    setOcupado(pedido.id);
    setMensagem(null);
    try {
      const resposta = await fetch(`/api/admin/orders/${pedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        setMensagem(json?.erro ?? "Não foi possível alterar o status.");
      } else {
        // `aviso`: ao cancelar, o PIX do pedido já estava pago (ou não deu para cancelá-lo no Mercado Pago).
        setMensagem(
          `Pedido ${codigoPedido(pedido.id)} agora está como ${ROTULO_STATUS[novo]}.${json?.aviso ? ` Atenção: ${json.aviso}` : ""}`,
        );
      }
      setVersao((v) => v + 1); // recarrega de qualquer forma: o status pode ter mudado em outro lugar
    } catch {
      setMensagem("Sem conexão. Tente novamente.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulos text-3xl font-bold">Pedidos</h1>
          <p className="mt-1 text-sm text-primaria/80">Todos os pedidos da loja, do mais recente para o mais antigo.</p>
        </div>
        <Link href="/admin/orders/nova" className="btn-primario">
          Registrar venda presencial
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
          {(["TODOS", ...TODOS_STATUS] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => {
                setFiltro(f);
                setPagina(1);
              }}
              className={`${botaoAcao} ${
                filtro === f
                  ? "border-secundaria bg-secundaria text-destaque"
                  : "border-accent2 text-primaria hover:bg-accent1/40"
              }`}
            >
              {f === "TODOS" ? "Todos" : ROTULO_STATUS[f]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por canal de venda">
          {(["TODOS", ...TODOS_CANAIS] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={canal === c}
              onClick={() => {
                setCanal(c);
                setPagina(1);
              }}
              className={`${botaoAcao} ${
                canal === c ? "border-primaria bg-primaria text-destaque" : "border-accent2 text-primaria hover:bg-accent1/40"
              }`}
            >
              {c === "TODOS" ? "Online e presencial" : c === "ONLINE" ? "Só online" : "Só presencial"}
            </button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium">
        {mensagem}
      </p>

      {erro && (
        <p role="alert" className="rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria">
          {erro}
        </p>
      )}

      {/* `relative`: os spans sr-only dos botões são absolutos e, sem isso, escapam do recorte e esticam a página. */}
      {/* Região rolável: precisa de tabIndex para quem usa só o teclado conseguir rolar a tabela. */}
      <div
        role="region"
        aria-label="Tabela de pedidos"
        tabIndex={0}
        className={`cartao relative overflow-x-auto transition-opacity ${carregando ? "opacity-60" : ""}`}
        aria-busy={carregando}
      >
        <table className="w-full min-w-2xl text-left text-sm">
          <caption className="sr-only">Lista de pedidos</caption>
          <thead className="border-b-2 border-accent2/60 bg-accent1/20">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">ID</th>
              <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
              <th scope="col" className="px-4 py-3 font-semibold">Data</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Valor total</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-accent1/70">
            {!dados && carregando && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-primaria/80">Carregando pedidos…</td>
              </tr>
            )}
            {dados && dados.pedidos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-primaria/80">Nenhum pedido encontrado neste filtro.</td>
              </tr>
            )}
            {dados?.pedidos.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-4 py-3">
                  {/* O código abre a ficha do pedido (o que separar, para onde mandar, imprimir). */}
                  <Link
                    href={`/admin/orders/${p.id}`}
                    className="inline-flex min-h-11 items-center font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
                  >
                    {codigoPedido(p.id)}
                    <span className="sr-only">: abrir a ficha do pedido</span>
                  </Link>
                  {p.qtdKits > 0 && (
                    <span className="block w-fit rounded-full border border-kraft-sombra bg-kraft px-2 py-0.5 text-xs font-semibold text-primaria">
                      Com kit
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {p.cliente.nome}
                  {p.canal === "PRESENCIAL" ? (
                    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <span className="rounded-full border border-accent3 bg-accent3/15 px-2 py-0.5 font-semibold text-primaria">
                        {ROTULO_CANAL.PRESENCIAL}
                      </span>
                      {p.formaPagamento && <span className="text-primaria/80">{ROTULO_FORMA_PAGAMENTO[p.formaPagamento]}</span>}
                    </span>
                  ) : (
                    <span className="block text-xs text-primaria/75">{p.cliente.email}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatarDataHora(p.createdAt)}
                  {/* Venda presencial lançada noutro dia (retroativa): mostra quando entrou no painel. */}
                  {p.lancadoEm && hojeNaLoja(new Date(p.lancadoEm)) !== hojeNaLoja(new Date(p.createdAt)) && (
                    <span className="block text-xs text-primaria/75">lançada em {formatarDataHora(p.lancadoEm)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatarBRL(p.total)}</td>
                <td className="px-4 py-3"><EtiquetaStatus status={p.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-2">
                    {transicoesPermitidas(p.status, p.canal).length === 0 && <span className="text-xs text-primaria/70">—</span>}
                    {transicoesPermitidas(p.status, p.canal).map((destino) => (
                      <button
                        key={destino}
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => alterar(p, destino)}
                        className={`${botaoAcao} ${
                          destino === "CANCELADO"
                            ? "border-primaria/50 text-primaria hover:bg-primaria/10"
                            : "border-secundaria bg-secundaria text-destaque hover:bg-primaria"
                        }`}
                      >
                        {rotuloAcao(p, destino)}
                        <span className="sr-only"> {codigoPedido(p.id)}</span>
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dados && totalPaginas > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-4 text-sm">
          <button type="button" className="btn-secundario" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span>
            Página {dados.pagina} de {totalPaginas} · {dados.total} pedidos
          </span>
          <button type="button" className="btn-secundario" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </button>
        </nav>
      )}
    </div>
  );
}
