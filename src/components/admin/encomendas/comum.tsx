import Link from "next/link";
import type { ReactNode } from "react";
import { diaComSemana, diaCurto } from "@/components/lembrancinhas/datas";
import { SeloDaEncomenda } from "@/components/lembrancinhas/SeloDaEncomenda";
import { formatarBRL } from "@/lib/dinheiro";
import type { EncomendaAdminDTO } from "@/lib/encomendas-admin";
import { formatarPrazo, type AlertaEncomenda } from "@/lib/encomendas-regras";

/** Peças das telas de encomendas do painel (lista, agenda e ficha). */

export const ROTULO_ALERTA_ENCOMENDA: Record<AlertaEncomenda, string> = {
  DEVOLUCAO_PENDENTE: "Devolução pendente",
  PAGO_COM_DIVERGENCIA: "Pagamento a conferir",
  AVISO_NAO_CONFERIDO: "Aviso não conferido",
};

export const EXPLICACAO_ALERTA_ENCOMENDA: Record<AlertaEncomenda, string> = {
  DEVOLUCAO_PENDENTE: 'Há dinheiro a devolver para a cliente. Devolva pelo app da InfinitePay e marque aqui "Marquei como devolvida".',
  PAGO_COM_DIVERGENCIA:
    "A InfinitePay diz que foi pago, mas o valor, o método ou as parcelas não conferem; a parcela não foi dada como paga. Confira a venda no app InfinitePay (pela referência abaixo).",
  AVISO_NAO_CONFERIDO:
    "Chegou o aviso de pagamento, mas há mais de 30 minutos a conferência não fecha. Confira a venda no app InfinitePay (pela referência abaixo).",
};

/** Selo vermelho do alerta (texto vinho sobre fundo claro, como os demais selos). */
export function SeloAlerta({ alerta }: { alerta: AlertaEncomenda }) {
  return (
    <span className="inline-flex items-center rounded-full border-2 border-secundaria bg-white px-3 py-0.5 text-xs font-bold text-secundaria">
      {ROTULO_ALERTA_ENCOMENDA[alerta]}
    </span>
  );
}

/** "faltam 3 h 20 min" / "faltam 2 dias" / "venceu". */
export function tempoRestante(iso: string, agora: number): string {
  const ms = new Date(iso).getTime() - agora;
  if (ms <= 0) return "venceu";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `faltam ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `faltam ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return `faltam ${Math.floor(h / 24)} dias`;
}

const palavra = (modo: EncomendaAdminDTO["modoEntrega"]) => (modo === "RETIRADA" ? "Retirada" : "Entrega");

/**
 * Uma encomenda nas listas do painel: código (abre a ficha), status, cliente, potinhos, festa e
 * entrega, valores e o que está pendente. `destaque`: a frase do que a dona precisa fazer.
 */
export function CartaoEncomendaAdmin({ e, destaque, agora, children }: { e: EncomendaAdminDTO; destaque?: string; agora: number; children?: ReactNode }) {
  const prazo =
    e.statusEfetivo === "SOLICITADA"
      ? `Responder até ${formatarPrazo(new Date(e.prazos.responderAte))} (${tempoRestante(e.prazos.responderAte, agora)})`
      : e.statusEfetivo === "AGUARDANDO_ENTRADA" && e.prazos.entradaAte
        ? `Entrada até ${formatarPrazo(new Date(e.prazos.entradaAte))} (${tempoRestante(e.prazos.entradaAte, agora)})`
        : null;
  return (
    <article aria-labelledby={`enc-${e.id}`} className="cartao flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id={`enc-${e.id}`} className="text-lg font-bold">
            <Link href={`/admin/encomendas/${e.id}`} className="inline-flex min-h-11 items-center text-secundaria underline underline-offset-2 hover:text-primaria">
              {e.codigo}
              <span className="sr-only">: abrir a ficha da encomenda</span>
            </Link>
          </h3>
          <SeloDaEncomenda status={e.statusEfetivo} />
          {e.alerta && <SeloAlerta alerta={e.alerta} />}
        </div>
        <p className="text-sm">
          <strong className="font-semibold">{e.cliente.nome}</strong> · {e.potinhos} potinhos
        </p>
        <p className="text-sm text-primaria/85">
          Festa {diaComSemana(e.dataFesta)} · {palavra(e.modoEntrega)} {diaCurto(e.dataEntrega)}
        </p>
        {prazo && <p className="mt-1 text-sm font-semibold text-secundaria">{prazo}</p>}
        {destaque && <p className="mt-1 text-sm font-semibold">{destaque}</p>}
        {e.devolucao.pendente > 0 && <p className="mt-1 text-sm font-semibold text-secundaria">Devolver {formatarBRL(e.devolucao.pendente)}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
        <p className="text-right text-sm">
          <span className="block text-lg font-bold tabular-nums">{formatarBRL(e.total)}</span>
          <span className="text-primaria/80">
            Entrada {e.entradaPagaEm ? "paga" : formatarBRL(e.entrada)} · Restante{" "}
            {e.restantePagoEm ? (e.restanteForaDoSite ? "recebido na loja" : "pago") : formatarBRL(e.restante)}
          </span>
        </p>
        {children}
      </div>
    </article>
  );
}
