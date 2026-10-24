"use client";

import { useEffect, useId, useState } from "react";
import { CartaoEncomendaAdmin } from "@/components/admin/encomendas/comum";
import { diaComSemana, diaCurto } from "@/components/lembrancinhas/datas";
import { formatarPrazo, prazoDaEntrada } from "@/lib/encomendas-regras";
import type { EncomendaAdminDTO, ListaEncomendasAdminDTO, VisaoEncomendas } from "@/lib/encomendas-admin";

const ABAS: { visao: VisaoEncomendas; rotulo: string; contagem?: keyof ListaEncomendasAdminDTO["contagens"] }[] = [
  { visao: "responder", rotulo: "Responder", contagem: "responder" },
  { visao: "agenda", rotulo: "Agenda" },
  { visao: "aguardando-entrada", rotulo: "Aguardando entrada", contagem: "aguardandoEntrada" },
  { visao: "devolucoes", rotulo: "Devoluções", contagem: "devolucoes" },
  { visao: "historico", rotulo: "Histórico" },
];

const VAZIO: Record<VisaoEncomendas, string> = {
  responder: "Nenhuma solicitação esperando resposta.",
  agenda: "Nenhuma entrega ou retirada neste período.",
  "aguardando-entrada": "Nenhuma encomenda aprovada esperando a entrada.",
  devolucoes: "Nenhuma devolução pendente.",
  historico: "Ainda não há encomendas.",
};

const botaoAba =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold transition-colors";

/**
 * Encomendas de lembrancinhas no painel, por aba (GET /api/admin/encomendas): responder (com o prazo
 * correndo e "Aprovar" direto), agenda de produção por dia e sabor, aguardando a entrada, devoluções
 * pendentes e histórico. A aba fica no endereço (?visao=), para voltar da ficha no mesmo lugar.
 */
export function EncomendasAdmin({ visaoInicial }: { visaoInicial: VisaoEncomendas }) {
  const uid = useId();
  const [visao, setVisao] = useState(visaoInicial);
  const [pagina, setPagina] = useState(1);
  const [periodo, setPeriodo] = useState<{ de: string; ate: string } | null>(null);
  const [campos, setCampos] = useState({ de: "", ate: "" });
  const [versao, setVersao] = useState(0);
  const [consulta, setConsulta] = useState<{ chave: string; dados?: ListaEncomendasAdminDTO; erro?: string } | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // O relógio é lido quando os dados chegam (no navegador), não na renderização do servidor.
  const [agora, setAgora] = useState(0);

  const chave = `${visao}|${pagina}|${periodo?.de ?? ""}|${periodo?.ate ?? ""}|${versao}`;

  useEffect(() => {
    let cancelado = false;
    const params = new URLSearchParams({ visao, pagina: String(pagina) });
    if (visao === "agenda" && periodo) {
      params.set("de", periodo.de);
      params.set("ate", periodo.ate);
    }
    fetch(`/api/admin/encomendas?${params}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        setAgora(Date.now());
        if (r.ok && json.visao === "agenda" && json.de && json.ate) setCampos((c) => (c.de || c.ate ? c : { de: json.de, ate: json.ate }));
        setConsulta(r.ok ? { chave, dados: json } : { chave, erro: json?.erro ?? "Não foi possível carregar as encomendas." });
      })
      .catch(() => !cancelado && setConsulta({ chave, erro: "Sem conexão. Tente novamente." }));
    return () => {
      cancelado = true;
    };
  }, [chave, visao, pagina, periodo]);

  function trocar(v: VisaoEncomendas) {
    setVisao(v);
    setPagina(1);
    setMensagem(null);
    window.history.replaceState(null, "", `?visao=${v}`);
  }

  async function aprovar(e: EncomendaAdminDTO) {
    if (!window.confirm(`Aprovar a encomenda ${e.codigo} (${e.potinhos} potinhos, ${e.modoEntrega === "RETIRADA" ? "retirada" : "entrega"} em ${diaCurto(e.dataEntrega)})? A cliente terá até ${formatarPrazo(prazoDaEntrada(new Date(), new Date(e.prazos.corteEm)))} para pagar a entrada.`)) return;
    setOcupado(e.id);
    setMensagem(null);
    try {
      const r = await fetch(`/api/admin/encomendas/${encodeURIComponent(e.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "aprovar", statusEsperado: e.statusEfetivo }),
      });
      const json = await r.json().catch(() => null);
      setMensagem(
        r.ok
          ? `Encomenda ${e.codigo} aprovada. Avise a cliente pelo WhatsApp (na ficha há o texto pronto).${json?.aviso ? ` ${json.aviso}` : ""}`
          : (json?.erro ?? "Não foi possível aprovar."),
      );
    } catch {
      setMensagem("Sem conexão. Tente novamente.");
    } finally {
      setOcupado(null);
      setVersao((v) => v + 1);
    }
  }

  const carregando = consulta?.chave !== chave;
  const dados = consulta?.dados?.visao === visao ? consulta.dados : undefined;
  const erro = !carregando ? consulta?.erro : undefined;
  const contagens = consulta?.dados?.contagens;
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  return (
    <section aria-labelledby={`${uid}-titulo`} className="flex flex-col gap-5">
      <h2 id={`${uid}-titulo`} className="sr-only">
        Lista de encomendas
      </h2>
      <div className="flex flex-wrap gap-2 print:hidden" role="group" aria-label="Escolher a lista">
        {ABAS.map((a) => {
          const n = a.contagem && contagens ? contagens[a.contagem] : 0;
          const ativa = a.visao === visao;
          return (
            <button
              key={a.visao}
              type="button"
              aria-pressed={ativa}
              onClick={() => trocar(a.visao)}
              className={`${botaoAba} ${ativa ? "border-secundaria bg-secundaria text-destaque" : "border-accent2 text-primaria hover:bg-accent1/40"}`}
            >
              {a.rotulo}
              {n > 0 && (
                <span className={`rounded-full px-2 text-xs ${ativa ? "bg-destaque text-secundaria" : "bg-secundaria text-destaque"}`}>
                  {n}
                  <span className="sr-only"> {n === 1 ? "encomenda" : "encomendas"}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {visao === "agenda" && (
        <form
          className="flex flex-wrap items-end gap-3 print:hidden"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (campos.de && campos.ate) setPeriodo({ de: campos.de, ate: campos.ate });
          }}
        >
          <div>
            <label htmlFor={`${uid}-de`} className="mb-1 block text-sm font-semibold">
              De
            </label>
            <input id={`${uid}-de`} type="date" className="campo" value={campos.de} onChange={(ev) => setCampos((c) => ({ ...c, de: ev.target.value }))} />
          </div>
          <div>
            <label htmlFor={`${uid}-ate`} className="mb-1 block text-sm font-semibold">
              Até
            </label>
            <input id={`${uid}-ate`} type="date" className="campo" value={campos.ate} onChange={(ev) => setCampos((c) => ({ ...c, ate: ev.target.value }))} />
          </div>
          <button type="submit" className="btn-secundario">
            Mostrar
          </button>
          <button type="button" className="btn-secundario" onClick={() => window.print()}>
            Imprimir a agenda
          </button>
          <p className="w-full text-xs text-primaria/75">No máximo 62 dias por vez. Conta as confirmadas; as que esperam a entrada aparecem à parte.</p>
        </form>
      )}

      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium print:hidden">
        {mensagem}
      </p>
      {erro && (
        <p role="alert" className="rounded-lg border-2 border-secundaria bg-white/70 p-3 text-sm font-medium text-secundaria">
          {erro}
        </p>
      )}

      <div className={`flex flex-col gap-4 transition-opacity ${carregando ? "opacity-60" : ""}`} aria-busy={carregando}>
        {!dados && carregando && <div className="h-40 animate-pulse rounded-2xl bg-accent1/30" />}
        {dados && visao === "agenda" && <Agenda dados={dados} agora={agora} />}
        {dados && visao !== "agenda" && dados.encomendas.length === 0 && <p className="cartao p-6 text-center text-sm text-primaria/80">{VAZIO[visao]}</p>}
        {dados && visao !== "agenda" && (
          <ul className="flex flex-col gap-3">
            {dados.encomendas.map((e) => (
              <li key={e.id}>
                <CartaoEncomendaAdmin e={e} agora={agora}>
                  {visao === "responder" && e.statusEfetivo === "SOLICITADA" && (
                    <button type="button" className="btn-primario" disabled={ocupado === e.id} onClick={() => aprovar(e)}>
                      {ocupado === e.id ? "Aprovando…" : "Aprovar"}
                      <span className="sr-only"> {e.codigo}</span>
                    </button>
                  )}
                </CartaoEncomendaAdmin>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dados && visao === "historico" && totalPaginas > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between gap-4 text-sm">
          <button type="button" className="btn-secundario" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span>
            Página {dados.pagina} de {totalPaginas} · {dados.total} encomendas
          </span>
          <button type="button" className="btn-secundario" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </button>
        </nav>
      )}
    </section>
  );
}

/** Agenda de produção: por dia de entrega ou retirada, os potinhos por sabor e as encomendas do dia. */
function Agenda({ dados, agora }: { dados: ListaEncomendasAdminDTO; agora: number }) {
  const dias = dados.agenda ?? [];
  if (dias.length === 0) return <p className="cartao p-6 text-center text-sm text-primaria/80">{VAZIO.agenda}</p>;
  const porId = new Map(dados.encomendas.map((e) => [e.id, e]));
  return (
    <>
      <p className="text-sm text-primaria/85">
        De {diaComSemana(dados.de ?? dias[0].dia)} a {diaComSemana(dados.ate ?? dias[dias.length - 1].dia)}
      </p>
      {dias.map((d) => (
        <section key={d.dia} aria-labelledby={`dia-${d.dia}`} className="cartao p-4 print:break-inside-avoid sm:p-5">
          <h3 id={`dia-${d.dia}`} className="text-xl font-bold first-letter:uppercase">
            {diaComSemana(d.dia)}
          </h3>
          <p className="text-sm text-primaria/85">
            {d.encomendas > 0 ? (
              <>
                {d.encomendas} {d.encomendas === 1 ? "encomenda confirmada" : "encomendas confirmadas"} · <strong>{d.potinhos} potinhos</strong>
                {d.aguardandoEntrada > 0 && ` · mais ${d.potinhosAguardando} potinhos aguardando a entrada`}
              </>
            ) : (
              `Nada confirmado ainda: ${d.potinhosAguardando} potinhos de ${d.aguardandoEntrada} ${d.aguardandoEntrada === 1 ? "encomenda" : "encomendas"} aguardando a entrada.`
            )}
          </p>
          {d.porSabor.length > 0 && (
            <table className="mt-3 w-full max-w-md text-left text-sm">
              <caption className="sr-only">Potinhos a produzir por sabor em {diaComSemana(d.dia)}</caption>
              <thead className="border-b-2 border-accent2/60">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Sabor</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Potinhos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent1/70">
                {d.porSabor.map((s) => (
                  <tr key={s.productId}>
                    <th scope="row" className="py-1.5 pr-3 font-medium">{s.sabor}</th>
                    <td className="py-1.5 text-right text-base font-bold tabular-nums">{s.potinhos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {d.ids.map((id) => {
              const e = porId.get(id);
              return e ? (
                <li key={id}>
                  <CartaoEncomendaAdmin e={e} agora={agora} />
                </li>
              ) : null;
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
