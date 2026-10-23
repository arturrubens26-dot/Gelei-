"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CampoForm } from "@/components/admin/CampoForm";
import { EXPLICACAO_ALERTA_ENCOMENDA, ROTULO_ALERTA_ENCOMENDA, SeloAlerta } from "@/components/admin/encomendas/comum";
import { LinkWhatsApp } from "@/components/admin/LinkWhatsApp";
import { diaComSemana } from "@/components/lembrancinhas/datas";
import { SeloDaEncomenda } from "@/components/lembrancinhas/SeloDaEncomenda";
import { formatarBRL, lerValorEmCentavos, valorParaCampo } from "@/lib/dinheiro";
import type { DevolucaoDaEncomendaDTO, EncomendaAdminDetalheDTO, PagamentoDaEncomendaDTO } from "@/lib/encomendas-admin";
import { ROTULO_STATUS_ENCOMENDA, TAMANHO_MAX_TEXTO, TAMANHO_MIN_MOTIVO, formatarPrazo, type AcaoAdmin, type AcaoDaLoja } from "@/lib/encomendas-regras";
import { enderecoDeRetirada } from "@/lib/entrega-regras";
import { formatarDataHora } from "@/lib/formatacao";
import { FORMAS_PAGAMENTO, ROTULO_FORMA_PAGAMENTO, type FormaPagamento } from "@/lib/vendas";

type Encomenda = EncomendaAdminDetalheDTO;

const STATUS_COBRANCA: Record<PagamentoDaEncomendaDTO["status"], string> = {
  PENDENTE: "Link aberto",
  APROVADO: "Pago",
  CANCELADO: "Encerrado",
  RECUSADO: "Recusado",
  ESTORNADO: "Estornado",
};

const MOTIVO_DEVOLUCAO: Record<DevolucaoDaEncomendaDTO["motivo"], string> = {
  DESISTENCIA: "Desistência da cliente",
  CANCELAMENTO: "Cancelamento",
  PAGAMENTO_TARDIO: "Pago depois de encerrada",
  PAGAMENTO_DUPLICADO: "Pago em dobro",
};

/** Ações que pedem um formulário antes (as outras são um clique, com confirmação quando pesa). */
const COM_FORMULARIO: readonly AcaoAdmin[] = ["recusar", "registrar-restante", "cancelar", "devolucao-feita"];

const prazo = (iso: string | null) => (iso ? formatarPrazo(new Date(iso)) : "—");

/**
 * Ficha de uma encomenda no painel (GET/PATCH /api/admin/encomendas/[id]): o que fazer agora (os
 * botões vêm da API, com motivo quando bloqueados e aviso que não bloqueia), o aviso pronto para o
 * WhatsApp, cliente e entrega, potinhos e valores, prazos, cobranças da InfinitePay (pela referência
 * a dona acha a venda no app), devoluções, a agenda dos dias vizinhos e a linha do tempo. Dá para
 * imprimir. Toda ação manda o status que a tela mostra: se mudou, a API responde 409 e a ficha recarrega.
 */
export function FichaEncomenda({ id }: { id: string }) {
  const uid = useId();
  const [enc, setEnc] = useState<Encomenda | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [aberta, setAberta] = useState<AcaoAdmin | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null);
  const mensagemRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/admin/encomendas/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelado) return;
        if (r.ok) {
          setEnc(json.encomenda);
          setErroCarga(null);
        } else setErroCarga(json?.erro ?? "Não foi possível carregar a encomenda.");
      })
      .catch(() => !cancelado && setErroCarga("Sem conexão. Tente novamente."));
    return () => {
      cancelado = true;
    };
  }, [id, versao]);

  useEffect(() => {
    if (mensagem) mensagemRef.current?.focus();
  }, [mensagem]);

  /** Uma ação (PATCH). `true` se deu certo. */
  async function agir(corpo: Record<string, unknown>, sucesso: string): Promise<boolean> {
    if (!enc || ocupado) return false;
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await fetch(`/api/admin/encomendas/${encodeURIComponent(enc.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...corpo, statusEsperado: enc.statusEfetivo }),
      });
      const json = await r.json().catch(() => null);
      if (r.ok) {
        setEnc(json.encomenda);
        setAberta(null);
        setMensagem({ texto: `${sucesso}${json.aviso ? ` Atenção: ${json.aviso}` : ""}`, erro: false });
        return true;
      }
      const d = json?.detalhes;
      const faixa =
        typeof d?.minimoCentavos === "number" && typeof d?.maximoCentavos === "number"
          ? ` Devolva entre ${formatarBRL(d.minimoCentavos / 100)} e ${formatarBRL(d.maximoCentavos / 100)}.`
          : "";
      const porCampo = r.status === 400 && d && !faixa ? Object.values(d as Record<string, string[]>).flat()[0] : undefined;
      setMensagem({ texto: `${json?.erro ?? "Não foi possível concluir."}${faixa}${porCampo && porCampo !== json?.erro ? ` ${porCampo}` : ""}`, erro: true });
      // A encomenda mudou (pagamento, expiração, desistência): a ficha mostra como está agora.
      if (r.status === 409) setVersao((v) => v + 1);
      return false;
    } catch {
      setMensagem({ texto: "Sem conexão. Tente novamente.", erro: true });
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (erroCarga && !enc) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-secundaria bg-white/70 p-4 text-sm font-medium text-secundaria">
        <span>{erroCarga}</span>
        <button type="button" className="btn-secundario" onClick={() => setVersao((v) => v + 1)}>
          Tentar de novo
        </button>
        <Link href="/admin/encomendas" className="underline underline-offset-2">
          Voltar para Encomendas
        </Link>
      </div>
    );
  }
  if (!enc || enc.id !== id) {
    return (
      <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
        <span className="sr-only">Carregando a ficha da encomenda…</span>
      </div>
    );
  }

  const e = enc;
  const palavra = e.modoEntrega === "RETIRADA" ? "Retirada" : "Entrega";
  const acoes = e.acoes.filter((a) => a.acao !== "avisada");

  function clicar(a: AcaoDaLoja) {
    if (!a.permitida) return;
    if (COM_FORMULARIO.includes(a.acao)) {
      setAberta((atual) => (atual === a.acao ? null : a.acao));
      return;
    }
    const perguntas: Partial<Record<AcaoAdmin, string>> = {
      aprovar: `Aprovar a encomenda ${e.codigo}? A cliente terá 24 horas para pagar a entrada de ${formatarBRL(e.entrada)}.`,
      "marcar-entregue": `Confirmar que a encomenda ${e.codigo} foi ${e.modoEntrega === "RETIRADA" ? "retirada" : "entregue"}?`,
      "iniciar-producao": a.aviso ? `${a.aviso} Iniciar a produção mesmo assim?` : undefined,
    };
    const pergunta = perguntas[a.acao];
    if (pergunta && !window.confirm(pergunta)) return;
    void agir({ acao: a.acao }, `Pronto: ${a.rotulo.toLowerCase()}.`);
  }

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-secundaria">Ficha da encomenda de lembrancinhas</p>
          <h1 className="font-titulos text-3xl font-bold">Encomenda {e.codigo}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-primaria/85">
            <span>Solicitada em {formatarDataHora(e.criadaEm)}</span>
            <SeloDaEncomenda status={e.statusEfetivo} />
            {e.alerta && <SeloAlerta alerta={e.alerta} />}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" className="btn-secundario" onClick={() => window.print()}>
            Imprimir
          </button>
          <Link href="/admin/encomendas" className="btn-secundario">
            Voltar para Encomendas
          </Link>
        </div>
      </header>

      {e.alerta && (
        <p className="rounded-lg border-2 border-secundaria bg-white p-3 text-sm font-medium">
          <strong className="block text-secundaria">{ROTULO_ALERTA_ENCOMENDA[e.alerta]}</strong>
          {EXPLICACAO_ALERTA_ENCOMENDA[e.alerta]}
        </p>
      )}

      <section aria-labelledby={`${uid}-acoes`} className="cartao flex flex-col gap-3 p-5 print:hidden">
        <h2 id={`${uid}-acoes`} className="text-xl font-bold">
          O que fazer agora
        </h2>
        <p ref={mensagemRef} tabIndex={-1} role={mensagem?.erro ? "alert" : "status"} className={`text-sm font-medium outline-offset-4 empty:hidden ${mensagem?.erro ? "text-secundaria" : ""}`}>
          {mensagem?.texto}
        </p>
        {acoes.length === 0 ? (
          <p className="text-sm text-primaria/80">Nada a fazer: a encomenda está {ROTULO_STATUS_ENCOMENDA[e.statusEfetivo].toLowerCase()}.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {acoes.map((a) => (
              <li key={a.acao} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => clicar(a)}
                    aria-disabled={!a.permitida || ocupado || undefined}
                    aria-expanded={COM_FORMULARIO.includes(a.acao) ? aberta === a.acao : undefined}
                    aria-describedby={a.motivo || a.aviso ? `${uid}-${a.acao}-nota` : undefined}
                    className={`${a.acao === "cancelar" || a.acao === "recusar" ? "btn-secundario" : "btn-primario"} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
                  >
                    {a.rotulo}
                  </button>
                  {(a.motivo || a.aviso) && (
                    <span id={`${uid}-${a.acao}-nota`} className={`text-xs ${a.motivo ? "font-semibold text-secundaria" : "text-primaria/80"}`}>
                      {a.motivo ?? a.aviso}
                    </span>
                  )}
                </div>
                {aberta === a.acao && a.acao === "recusar" && <FormRecusar ocupado={ocupado} aoEnviar={(motivo) => agir({ acao: "recusar", motivo }, "Encomenda recusada. Avise a cliente pelo WhatsApp.")} />}
                {aberta === a.acao && a.acao === "registrar-restante" && (
                  <FormRestante
                    restante={e.restante}
                    ocupado={ocupado}
                    aoEnviar={(formaPagamento, observacao) =>
                      agir({ acao: "registrar-restante", formaPagamento, observacao: observacao || null }, "Restante registrado: encomenda quitada.")
                    }
                  />
                )}
                {aberta === a.acao && a.acao === "cancelar" && (
                  <FormCancelar
                    cancelamento={e.cancelamento}
                    ocupado={ocupado}
                    aoEnviar={(motivo, devolverCentavos, aPedidoDaCliente) =>
                      agir(
                        { acao: "cancelar", motivo, devolverCentavos, aPedidoDaCliente },
                        devolverCentavos > 0
                          ? `Encomenda cancelada. Devolva ${formatarBRL(devolverCentavos / 100)} pelo app da InfinitePay e marque aqui quando fizer.`
                          : "Encomenda cancelada.",
                      )
                    }
                  />
                )}
                {aberta === a.acao && a.acao === "devolucao-feita" && (
                  <FormDevolucao
                    pendente={e.devolucao.pendente}
                    ocupado={ocupado}
                    aoEnviar={(observacao) => agir({ acao: "devolucao-feita", observacao: observacao || null }, "Devolução marcada como feita.")}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-whats`} className="cartao flex flex-col gap-3 p-5 print:hidden">
        <h2 id={`${uid}-whats`} className="text-xl font-bold">
          Avisar a cliente no WhatsApp
        </h2>
        <p className="whitespace-pre-line rounded-lg border border-accent2/60 bg-white p-3 text-sm">{e.whatsapp.texto}</p>
        <div className="flex flex-wrap items-center gap-3">
          <a href={e.whatsapp.link} target="_blank" rel="noopener noreferrer" className="btn-primario">
            Abrir no WhatsApp<span className="sr-only"> (abre em nova aba)</span>
          </a>
          <button type="button" className="btn-secundario" disabled={ocupado} onClick={() => void agir({ acao: "avisada", status: e.statusEfetivo }, "Anotado: a cliente foi avisada.")}>
            Avisei no WhatsApp
          </button>
        </div>
        <p className="text-xs text-primaria/80">
          {e.avisadaStatus && e.avisadaEm
            ? `Último aviso: ${ROTULO_STATUS_ENCOMENDA[e.avisadaStatus].toLowerCase()}, em ${formatarDataHora(e.avisadaEm)}.`
            : "Ainda sem aviso registrado."}
          {e.avisadaStatus && e.avisadaStatus !== e.statusEfetivo ? " O status mudou depois disso." : ""}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby={`${uid}-cliente`} className="cartao p-5 print:break-inside-avoid">
          <h2 id={`${uid}-cliente`} className="mb-3 text-xl font-bold">
            Cliente e {palavra.toLowerCase()}
          </h2>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold">Cliente</dt>
            <dd>
              <Link href={`/admin/clientes/${e.cliente.id}`} className="font-semibold text-secundaria underline underline-offset-2">
                {e.cliente.nome}
              </Link>
              <span className="block text-primaria/80">{e.cliente.email}</span>
            </dd>
            <dt className="font-semibold">WhatsApp</dt>
            <dd>
              <LinkWhatsApp telefone={e.telefone} pedido={e.codigo} />
            </dd>
            <dt className="font-semibold">Festa</dt>
            <dd>{diaComSemana(e.dataFesta)}</dd>
            <dt className="font-semibold">{palavra}</dt>
            <dd>{diaComSemana(e.dataEntrega)}</dd>
            <dt className="font-semibold">{e.modoEntrega === "RETIRADA" ? "Onde" : "Endereço"}</dt>
            <dd>
              {e.endereco ? (
                <address className="not-italic">
                  {e.endereco.rua}, {e.endereco.numero}
                  {e.endereco.complemento ? ` — ${e.endereco.complemento}` : ""}
                  <br />
                  {e.endereco.bairro} · {e.endereco.cidade}/{e.endereco.estado} · CEP {e.endereco.cep}
                </address>
              ) : (
                `Na loja: ${enderecoDeRetirada()}`
              )}
            </dd>
            {e.observacao && (
              <>
                <dt className="font-semibold">Observação</dt>
                <dd className="whitespace-pre-line">{e.observacao}</dd>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby={`${uid}-potinhos`} className="cartao p-5 print:break-inside-avoid">
          <h2 id={`${uid}-potinhos`} className="mb-3 text-xl font-bold">
            {e.potinhos} potinhos de 40 ml
          </h2>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Potinhos por sabor</caption>
            <thead className="border-b-2 border-accent2/60">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Sabor</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">Potinhos</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-accent1/70">
              {e.itens.map((i) => (
                <tr key={i.productId}>
                  <th scope="row" className="py-1.5 pr-3 font-medium">{i.sabor}</th>
                  <td className="px-3 py-1.5 text-right text-base font-bold tabular-nums">{i.quantidade}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{formatarBRL(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 flex flex-col gap-1 border-t-2 border-accent2/60 pt-3 text-sm">
            <Linha rotulo="Potinhos" valor={formatarBRL(e.subtotal)} />
            <Linha rotulo={e.modoEntrega === "RETIRADA" ? "Retirada" : "Entrega"} valor={e.frete > 0 ? formatarBRL(e.frete) : "Grátis"} />
            <Linha rotulo="Total" valor={formatarBRL(e.total)} forte />
            <Linha rotulo={`Entrada${e.entradaPagaEm ? ` (paga em ${formatarDataHora(e.entradaPagaEm)})` : ""}`} valor={formatarBRL(e.entrada)} />
            <Linha
              rotulo={`Restante${e.restantePagoEm ? ` (${e.restanteForaDoSite ? "recebido na loja" : "pago"} em ${formatarDataHora(e.restantePagoEm)})` : ""}`}
              valor={formatarBRL(e.restante)}
            />
            <Linha rotulo="Peso para o frete" valor={`${e.pesoTotalGramas} g`} />
          </dl>
          {e.restanteForaDoSite && e.restanteForma && (
            <p className="mt-2 text-xs text-primaria/85">
              Restante: {ROTULO_FORMA_PAGAMENTO[e.restanteForma]}
              {e.restanteRegistradoPor ? `, registrado por ${e.restanteRegistradoPor}` : ""}
              {e.restanteObservacao ? ` · ${e.restanteObservacao}` : ""}
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby={`${uid}-prazos`} className="cartao p-5 print:break-inside-avoid">
        <h2 id={`${uid}-prazos`} className="mb-3 text-xl font-bold">
          Prazos
        </h2>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">Responder até</dt>
          <dd>{prazo(e.prazos.responderAte)}</dd>
          <dt className="font-semibold">Entrada até</dt>
          <dd>{e.prazos.entradaAte ? prazo(e.prazos.entradaAte) : "depois da aprovação (24 horas)"}</dd>
          <dt className="font-semibold">Desistência com devolução integral</dt>
          <dd>
            até {prazo(e.prazos.corteEm)}; depois, {e.politica.percentualRetido}% da entrada fica com a loja
          </dd>
        </dl>
      </section>

      <section aria-labelledby={`${uid}-cobrancas`} className="cartao p-5">
        <h2 id={`${uid}-cobrancas`} className="mb-1 text-xl font-bold">
          Pagamentos pelo site
        </h2>
        <p className="mb-3 text-xs text-primaria/80">No app InfinitePay, procure a venda pela referência.</p>
        {e.pagamentos.length === 0 ? (
          <p className="text-sm text-primaria/80">Nenhum link de pagamento aberto ainda.</p>
        ) : (
          <div role="region" aria-label="Tabela de pagamentos" tabIndex={0} className="relative overflow-x-auto">
            <table className="w-full min-w-xl text-left text-sm">
              <thead className="border-b-2 border-accent2/60">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">Parcela</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Valor</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Como</th>
                  <th scope="col" className="py-2 pl-3 font-semibold">Referência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-accent1/70">
                {e.pagamentos.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3">
                      {p.parcela === "ENTRADA" ? "Entrada" : "Restante"}
                      <span className="block text-xs text-primaria/75">{formatarDataHora(p.criadoEm)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold">{STATUS_COBRANCA[p.status]}</span>
                      {p.aprovadoEm && <span className="block text-xs text-primaria/75">{formatarDataHora(p.aprovadoEm)}</span>}
                      {p.divergente ? (
                        <span className="block text-xs font-semibold text-secundaria">Valor ou método não conferem</span>
                      ) : p.emConferencia ? (
                        <span className="block text-xs font-semibold text-secundaria">Em conferência</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatarBRL(p.valor)}
                      {p.valorPago != null && p.valorPago > p.valor && <span className="block text-xs text-primaria/75">pago {formatarBRL(p.valorPago)}</span>}
                    </td>
                    <td className="px-3 py-2">{p.rotuloMetodo ?? (p.gateway === "simulado" ? "Demonstração" : "—")}</td>
                    <td className="py-2 pl-3 font-mono text-xs">{p.referencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {e.devolucoes.length > 0 && (
        <section aria-labelledby={`${uid}-devolucoes`} className="cartao p-5">
          <h2 id={`${uid}-devolucoes`} className="mb-3 text-xl font-bold">
            Devoluções
          </h2>
          <ul className="flex flex-col divide-y divide-accent1/70 text-sm">
            {e.devolucoes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span>
                  <strong className="font-semibold">{MOTIVO_DEVOLUCAO[d.motivo]}</strong> · {formatarDataHora(d.criadaEm)}
                  {d.observacao && <span className="block text-xs text-primaria/80">{d.observacao}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatarBRL(d.valor)}</span>
                  <span className={`text-xs font-bold ${d.status === "PENDENTE" ? "text-secundaria" : ""}`}>
                    {d.status === "PENDENTE" ? "A devolver" : `Devolvida${d.feitaEm ? ` em ${formatarDataHora(d.feitaEm)}` : ""}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {e.agendaProxima.length > 0 && (
        <section aria-labelledby={`${uid}-agenda`} className="cartao p-5 print:hidden">
          <h2 id={`${uid}-agenda`} className="mb-1 text-xl font-bold">
            Agenda perto desta entrega
          </h2>
          <p className="mb-3 text-xs text-primaria/80">Potinhos confirmados de 3 dias antes a 3 dias depois.</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {e.agendaProxima.map((d) => (
              <li key={d.dia} className={`rounded-lg border p-3 ${d.dia === e.dataEntrega ? "border-secundaria bg-accent1/20" : "border-accent2/60 bg-white/60"}`}>
                <strong className="block first-letter:uppercase">{diaComSemana(d.dia)}</strong>
                {d.potinhos} potinhos em {d.encomendas} {d.encomendas === 1 ? "encomenda" : "encomendas"}
                {d.aguardandoEntrada > 0 && ` (+${d.potinhosAguardando} aguardando entrada)`}
                {d.porSabor.length > 0 && <span className="block text-xs text-primaria/80">{d.porSabor.map((s) => `${s.sabor} ${s.potinhos}`).join(" · ")}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby={`${uid}-historico`} className="cartao p-5 print:break-inside-avoid">
        <h2 id={`${uid}-historico`} className="mb-3 text-xl font-bold">
          Histórico
        </h2>
        <ol className="flex flex-col gap-2 border-l-2 border-accent2/70 pl-4 text-sm">
          {e.linhaDoTempo.map((t, i) => (
            <li key={i}>
              <time dateTime={t.quando} className="block text-xs font-semibold text-primaria/80">
                {formatarDataHora(t.quando)}
              </time>
              {t.texto}
            </li>
          ))}
        </ol>
        {(e.motivoRecusa || e.motivoCancelamento) && (
          <p className="mt-3 text-sm">
            <strong className="font-semibold">Motivo:</strong> {e.motivoRecusa ?? e.motivoCancelamento}
          </p>
        )}
      </section>

      <details className="cartao p-5">
        <summary className="min-h-11 cursor-pointer content-center text-xl font-bold">Política aceita pela cliente</summary>
        <p className="mt-2 text-xs text-primaria/80">
          Versão {e.politica.versao}, aceita em {formatarDataHora(e.politica.aceitaEm)}; {e.politica.percentualRetido}% da entrada retido depois do corte.
        </p>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          {e.politica.textos.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </details>
    </article>
  );
}

function Linha({ rotulo, valor, forte = false }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${forte ? "text-base font-bold" : ""}`}>
      <dt>{rotulo}</dt>
      <dd className="shrink-0 tabular-nums">{valor}</dd>
    </div>
  );
}

const painelForm = "flex flex-col gap-3 rounded-lg border-2 border-accent2/70 bg-white p-4";

function FormRecusar({ ocupado, aoEnviar }: { ocupado: boolean; aoEnviar: (motivo: string) => Promise<boolean> }) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (motivo.trim().length < TAMANHO_MIN_MOTIVO) return setErro(`Explique o motivo (pelo menos ${TAMANHO_MIN_MOTIVO} letras); a cliente vê este texto.`);
    setErro(null);
    void aoEnviar(motivo.trim());
  }
  return (
    <form onSubmit={enviar} noValidate className={painelForm}>
      <CampoForm id={`${id}-motivo`} rotulo="Motivo da recusa" erro={erro ?? undefined} dica="A cliente vê este texto. Nada foi cobrado.">
        <textarea id={`${id}-motivo`} className="campo" rows={3} maxLength={TAMANHO_MAX_TEXTO} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-motivo-erro` : `${id}-motivo-dica`} />
      </CampoForm>
      <div>
        <button type="submit" className="btn-primario" disabled={ocupado}>
          {ocupado ? "Recusando…" : "Recusar a encomenda"}
        </button>
      </div>
    </form>
  );
}

function FormRestante({ restante, ocupado, aoEnviar }: { restante: number; ocupado: boolean; aoEnviar: (forma: FormaPagamento, observacao: string) => Promise<boolean> }) {
  const id = useId();
  const [forma, setForma] = useState<FormaPagamento>("DINHEIRO");
  const [obs, setObs] = useState("");
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void aoEnviar(forma, obs.trim());
      }}
      className={painelForm}
    >
      <p className="text-sm">
        Use só se a cliente pagou o restante de <strong>{formatarBRL(restante)}</strong> direto com você (fora do site).
      </p>
      <CampoForm id={`${id}-forma`} rotulo="Como ela pagou">
        <select id={`${id}-forma`} className="campo" value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)}>
          {FORMAS_PAGAMENTO.map((f) => (
            <option key={f} value={f}>
              {ROTULO_FORMA_PAGAMENTO[f]}
            </option>
          ))}
        </select>
      </CampoForm>
      <CampoForm id={`${id}-obs`} rotulo="Observação (opcional)">
        <input id={`${id}-obs`} className="campo" maxLength={TAMANHO_MAX_TEXTO} value={obs} onChange={(e) => setObs(e.target.value)} />
      </CampoForm>
      <div>
        <button type="submit" className="btn-primario" disabled={ocupado}>
          {ocupado ? "Registrando…" : "Registrar o restante"}
        </button>
      </div>
    </form>
  );
}

function FormCancelar({
  cancelamento,
  ocupado,
  aoEnviar,
}: {
  cancelamento: Encomenda["cancelamento"];
  ocupado: boolean;
  aoEnviar: (motivo: string, devolverCentavos: number, aPedidoDaCliente: boolean) => Promise<boolean>;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [aPedido, setAPedido] = useState(false);
  const faixa = aPedido ? cancelamento.aPedidoDaCliente : cancelamento.pelaLoja;
  // A loja cancela: devolve tudo. A cliente pediu: o mínimo da política (a dona pode subir até o total).
  const [valor, setValor] = useState(() => valorParaCampo(cancelamento.pelaLoja.maximoCentavos / 100));
  const [erro, setErro] = useState<{ motivo?: string; valor?: string }>({});
  const pago = cancelamento.totalPagoCentavos > 0;

  function trocarPedido(marcado: boolean) {
    setAPedido(marcado);
    const f = marcado ? cancelamento.aPedidoDaCliente : cancelamento.pelaLoja;
    setValor(valorParaCampo((marcado ? f.minimoCentavos : f.maximoCentavos) / 100));
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    const novos: typeof erro = {};
    if (motivo.trim().length < TAMANHO_MIN_MOTIVO) novos.motivo = `Explique o motivo (pelo menos ${TAMANHO_MIN_MOTIVO} letras).`;
    const centavos = pago ? lerValorEmCentavos(valor) : 0;
    if (centavos === null || centavos < faixa.minimoCentavos || centavos > faixa.maximoCentavos) {
      novos.valor = `Entre ${formatarBRL(faixa.minimoCentavos / 100)} e ${formatarBRL(faixa.maximoCentavos / 100)}.`;
    }
    setErro(novos);
    if (Object.keys(novos).length > 0 || centavos === null) return;
    if (!window.confirm(`Cancelar a encomenda${centavos > 0 ? ` e devolver ${formatarBRL(centavos / 100)}` : ""}? Não dá para desfazer.`)) return;
    void aoEnviar(motivo.trim(), centavos, aPedido);
  }

  return (
    <form onSubmit={enviar} noValidate className={painelForm}>
      <CampoForm id={`${id}-motivo`} rotulo="Motivo do cancelamento" erro={erro.motivo} dica="A cliente vê este texto.">
        <textarea id={`${id}-motivo`} className="campo" rows={2} maxLength={TAMANHO_MAX_TEXTO} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-invalid={erro.motivo ? true : undefined} aria-describedby={erro.motivo ? `${id}-motivo-erro` : `${id}-motivo-dica`} />
      </CampoForm>
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-secundaria" checked={aPedido} onChange={(e) => trocarPedido(e.target.checked)} />
        A cliente pediu para cancelar (pelo WhatsApp)
      </label>
      {pago ? (
        <CampoForm
          id={`${id}-valor`}
          rotulo="Devolver (R$)"
          erro={erro.valor}
          dica={`Já pago: ${formatarBRL(cancelamento.totalPagoCentavos / 100)}. ${aPedido ? "Pela política, no mínimo" : "A loja cancelando, devolve tudo:"} ${formatarBRL(faixa.minimoCentavos / 100)}.`}
        >
          <input id={`${id}-valor`} className="campo max-w-40" inputMode="decimal" maxLength={10} value={valor} onChange={(e) => setValor(e.target.value)} aria-invalid={erro.valor ? true : undefined} aria-describedby={erro.valor ? `${id}-valor-erro` : `${id}-valor-dica`} />
        </CampoForm>
      ) : (
        <p className="text-sm text-primaria/85">Nada foi pago: não há o que devolver.</p>
      )}
      <div>
        <button type="submit" className="btn-primario" disabled={ocupado}>
          {ocupado ? "Cancelando…" : "Cancelar a encomenda"}
        </button>
      </div>
    </form>
  );
}

function FormDevolucao({ pendente, ocupado, aoEnviar }: { pendente: number; ocupado: boolean; aoEnviar: (observacao: string) => Promise<boolean> }) {
  const id = useId();
  const [obs, setObs] = useState("");
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void aoEnviar(obs.trim());
      }}
      className={painelForm}
    >
      <p className="text-sm">
        Marque só depois de devolver <strong>{formatarBRL(pendente)}</strong> pelo app da InfinitePay.
      </p>
      <CampoForm id={`${id}-obs`} rotulo="Observação (opcional)" dica="Ex.: devolvido pelo app em 23/10.">
        <input id={`${id}-obs`} className="campo" maxLength={TAMANHO_MAX_TEXTO} value={obs} onChange={(e) => setObs(e.target.value)} aria-describedby={`${id}-obs-dica`} />
      </CampoForm>
      <div>
        <button type="submit" className="btn-primario" disabled={ocupado}>
          {ocupado ? "Salvando…" : "Marquei como devolvida"}
        </button>
      </div>
    </form>
  );
}
