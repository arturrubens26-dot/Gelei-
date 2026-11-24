import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense, type ReactNode } from "react";
import { BotaoImprimir } from "@/components/BotaoImprimir";
import { LinkInstagram } from "@/components/checkout/PagamentoPorEtapa";
import { diaComSemana, diaCurto } from "@/components/lembrancinhas/datas";
import { DesistirDaEncomenda } from "@/components/lembrancinhas/DesistirDaEncomenda";
import { PagamentoDaParcela } from "@/components/lembrancinhas/PagamentoDaParcela";
import { SeloDaEncomenda } from "@/components/lembrancinhas/SeloDaEncomenda";
import { situacaoDaEncomenda } from "@/components/lembrancinhas/situacao";
import { exigirUsuario } from "@/lib/auth/dal";
import { dadosLoja } from "@/lib/dados-loja";
import { rotuloDoPrecoAdicional } from "@/lib/adicionais-regras";
import { formatarBRL } from "@/lib/dinheiro";
import { buscarEncomendaDoUsuario, expirarVencidas } from "@/lib/encomendas";
import { situacaoDaParcela } from "@/lib/encomendas-pagamentos";
import {
  DIAS_DESISTENCIA_APOS_ENTRADA,
  DIAS_DESISTENCIA_APOS_RECEBER,
  VERSAO_POLITICA_TRES_DIAS,
  formatarPrazo,
  palavraDoModo,
  retemEntradaNaDesistencia,
  statusFinal,
} from "@/lib/encomendas-regras";
import { AVISO_SO_TERESINA, enderecoDeRetirada, formatarTelefone } from "@/lib/entrega-regras";
import { formatarDataHora } from "@/lib/formatacao";

export const metadata: Metadata = { title: "Encomenda de mimos" };

type Props = PageProps<"/minhas-encomendas/[id]">;

export default function PaginaEncomenda({ params, searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 print:max-w-none print:p-0">
      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-2xl bg-accent1/30" role="status">
            <span className="sr-only">Carregando sua encomenda…</span>
          </div>
        }
      >
        <DadosDaEncomenda params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function DadosDaEncomenda({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  // `?retorno=1`: veio da InfinitePay (por /pagamento/retorno). Sem sessão, volta para cá depois do login.
  const voltouDoPagamento = busca.retorno === "1";
  const usuario = await exigirUsuario(`/minhas-encomendas/${id}${voltouDoPagamento ? "?retorno=1" : ""}`);
  await io();
  const agora = new Date();
  // Só a dona da encomenda a vê: de outra pessoa (ou inexistente) é 404.
  const encomenda = await buscarEncomendaDoUsuario(id, usuario.id, agora);
  if (!encomenda) notFound();
  // A página já mostra o status efetivo; o prazo vencido é gravado depois da resposta.
  after(() => expirarVencidas(agora, { userId: usuario.id, encomendaId: encomenda.id }));

  const e = encomenda;
  const nadaPago = e.entradaPagaEm === null && e.restantePagoEm === null;
  const mostrarPagamento = !(statusFinal(e.statusEfetivo) && nadaPago);
  const [entrada, restante] = mostrarPagamento
    ? await Promise.all([situacaoDaParcela(e.id, usuario.id, "ENTRADA", agora), situacaoDaParcela(e.id, usuario.id, "RESTANTE", agora)])
    : [null, null];

  const situacao = situacaoDaEncomenda(e);
  const palavra = palavraDoModo(e.modoEntrega);
  const Palavra = palavra[0].toUpperCase() + palavra.slice(1);
  const corte = formatarPrazo(new Date(e.prazos.corteEm));
  // Política v2 (art. 49): nada é retido e não existe "prazo da devolução integral"; só a v1 (antiga) usa o corte.
  // A v3 (atual): até 3 dias depois de pagar a entrada, com devolução de tudo; depois, sem devolução.
  const semRetencao = !retemEntradaNaDesistencia(e.politica.versao);
  const tresDias = e.politica.versao === VERSAO_POLITICA_TRES_DIAS;

  return (
    <div className="flex flex-col gap-6">
      {/* Comprovante impresso: quem vende e como falar com a loja (Decreto 7.962, art. 2º e art. 4º, IV). */}
      <div className="hidden text-sm print:block">
        <p className="font-titulos text-xl font-bold">Geleiô · Geleias Artesanais</p>
        <p>
          {enderecoDeRetirada()} · Instagram @{dadosLoja.instagram.usuario}
        </p>
        <p>Comprovante da encomenda, emitido em {formatarDataHora(agora.toISOString())}.</p>
      </div>

      <header>
        <p className="text-sm print:hidden">
          <Link href="/minhas-encomendas" className="inline-flex min-h-11 items-center font-semibold text-secundaria underline-offset-2 hover:underline">
            ← Minhas encomendas
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-titulos text-4xl font-bold text-primaria">Encomenda {e.codigo}</h1>
          <SeloDaEncomenda status={e.statusEfetivo} />
        </div>
        <p className="mt-2 text-primaria/85">
          Mimos · {e.potinhos} potinhos · solicitada em {formatarDataHora(e.criadaEm)}
        </p>
      </header>

      <section
        aria-labelledby="titulo-situacao"
        className={`rounded-lg border-2 p-4 sm:p-5 ${situacao.acao ? "border-secundaria bg-accent1/25" : "border-accent3 bg-accent3/10"}`}
      >
        <h2 id="titulo-situacao" className="text-xl font-bold">
          {situacao.titulo}
        </h2>
        <p className="mt-1 text-sm leading-relaxed">{situacao.texto}</p>
      </section>

      {mostrarPagamento && entrada && restante && (
        <section aria-labelledby="titulo-pagamento" className="cartao p-5">
          <h2 id="titulo-pagamento" className="text-2xl font-bold">
            Pagamento
          </h2>
          <div className="mt-4 flex flex-col gap-5 divide-y divide-accent2/50 [&>*+*]:pt-5">
            <PagamentoDaParcela
              encomendaId={e.id}
              parcela="ENTRADA"
              valor={e.entrada}
              situacaoInicial={entrada}
              pagarAte={e.prazos.entradaAte}
              descricao={`50% do valor dos potinhos${e.adicionaisTotal > 0 ? " e dos itens adicionais" : ""}, para confirmar a encomenda.`}
              horasParaPagar={e.prazos.horasParaPagarEntrada}
              restanteForaDoSite={false}
            />
            <PagamentoDaParcela
              encomendaId={e.id}
              parcela="RESTANTE"
              valor={e.restante}
              situacaoInicial={restante}
              pagarAte={null}
              descricao={`${e.frete > 0 ? "Inclui a taxa de entrega. " : ""}Pague até o dia da ${palavra} (${diaCurto(e.dataEntrega)}).`}
              horasParaPagar={e.prazos.horasParaPagarEntrada}
              restanteForaDoSite={e.restanteForaDoSite}
            />
          </div>
        </section>
      )}

      <section aria-labelledby="titulo-itens" className="cartao p-5">
        <h2 id="titulo-itens" className="mb-3 text-2xl font-bold">
          Potinhos de 40 ml
        </h2>
        <ul className="divide-y divide-accent1/70">
          {e.itens.map((i) => (
            <li key={i.productId} className="flex items-baseline justify-between gap-4 py-2 text-sm">
              <span>
                {i.quantidade} × {i.sabor}
                <span className="block text-primaria/80">{formatarBRL(i.precoUnitario)} cada</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatarBRL(i.subtotal)}</span>
            </li>
          ))}
        </ul>
        {e.adicionais.length > 0 && (
          <div className="mt-4 border-t-2 border-accent2/60 pt-4">
            <h3 className="text-lg font-bold">Itens adicionais</h3>
            <p className="text-xs text-primaria/80">Valem para todos os {e.potinhos} potinhos da encomenda.</p>
            <ul className="mt-2 divide-y divide-accent1/70">
              {e.adicionais.map((a) => (
                <li key={a.adicionalId} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span>
                    {a.nome}
                    <span className="block text-primaria/80">{rotuloDoPrecoAdicional(Math.round(a.precoPorPotinho * 100))}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{a.total > 0 ? formatarBRL(a.total) : "sem custo"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="mt-4 flex flex-col gap-1.5 border-t-2 border-accent2/60 pt-4 text-sm">
          <Linha rotulo={`${e.potinhos} potinhos`} valor={formatarBRL(e.subtotal)} />
          {e.adicionais.length > 0 && <Linha rotulo="Itens adicionais" valor={e.adicionaisTotal > 0 ? formatarBRL(e.adicionaisTotal) : "sem custo"} />}
          <Linha rotulo={e.modoEntrega === "RETIRADA" ? "Retirada na loja" : "Taxa de entrega"} valor={e.frete > 0 ? formatarBRL(e.frete) : "Grátis"} />
          <div className="flex justify-between pt-1 text-xl font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatarBRL(e.total)}</dd>
          </div>
          <Linha rotulo={`Entrada (50% dos potinhos${e.adicionaisTotal > 0 ? " e adicionais" : ""})`} valor={formatarBRL(e.entrada)} />
          <Linha rotulo={`Restante${e.frete > 0 ? " (com a entrega)" : ""}`} valor={formatarBRL(e.restante)} />
        </dl>
      </section>

      <section aria-labelledby="titulo-festa" className="cartao p-5">
        <h2 id="titulo-festa" className="mb-3 text-2xl font-bold">
          Festa e {palavra}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          <Item rotulo="Festa">{diaComSemana(e.dataFesta)}</Item>
          <Item rotulo={Palavra}>{diaComSemana(e.dataEntrega)}, horário combinado pelo WhatsApp</Item>
          <Item rotulo={e.modoEntrega === "RETIRADA" ? "Onde retirar" : "Endereço"}>
            {e.endereco ? (
              <address className="not-italic">
                {e.endereco.rua}, {e.endereco.numero}
                {e.endereco.complemento ? ` — ${e.endereco.complemento}` : ""}
                <br />
                {e.endereco.bairro} · {e.endereco.cidade}/{e.endereco.estado} · CEP {e.endereco.cep.slice(0, 5)}-{e.endereco.cep.slice(5)}
              </address>
            ) : (
              <address className="not-italic">{enderecoDeRetirada()}</address>
            )}
          </Item>
          <Item rotulo="Área de entrega">{AVISO_SO_TERESINA} Fora de Teresina, só a retirada na loja.</Item>
          <Item rotulo="WhatsApp">{formatarTelefone(e.telefone)}</Item>
          {e.observacao && <Item rotulo="Observação">{e.observacao}</Item>}
          <Item rotulo="Desistência">
            {tresDias
              ? e.acoes.desistirAte
                ? `Até ${formatarPrazo(new Date(e.acoes.desistirAte))} (${DIAS_DESISTENCIA_APOS_ENTRADA} dias depois de pagar a entrada), com devolução de tudo o que você pagou. Depois disso, não há devolução.`
                : e.acoes.desistir
                  ? `Antes de pagar a entrada, a qualquer momento. Depois de pagar, você tem ${DIAS_DESISTENCIA_APOS_ENTRADA} dias para desistir e receber tudo de volta.`
                  : `O prazo de ${DIAS_DESISTENCIA_APOS_ENTRADA} dias depois de pagar a entrada terminou: não é mais possível desistir.`
              : semRetencao
              ? e.acoes.desistirAte
                ? `Até ${formatarPrazo(new Date(e.acoes.desistirAte))} (${DIAS_DESISTENCIA_APOS_RECEBER} dias depois de receber), com devolução de tudo o que você pagou.`
                : e.statusEfetivo === "ENTREGUE"
                  ? `O prazo de ${DIAS_DESISTENCIA_APOS_RECEBER} dias depois de receber terminou; para desistir, fale com a Geleiô.`
                  : `A qualquer momento antes de receber e até ${DIAS_DESISTENCIA_APOS_RECEBER} dias depois, com devolução de tudo o que você pagou.`
              : `Com devolução integral até ${corte}.`}
          </Item>
        </dl>
      </section>

      {e.acoes.desistir && (
        <DesistirDaEncomenda
          encomendaId={e.id}
          previaInicial={e.acoes.desistir}
          semRetencao={semRetencao}
          tresDias={tresDias}
          desistirAte={e.acoes.desistirAte ? formatarPrazo(new Date(e.acoes.desistirAte)) : null}
          corte={corte}
          depoisDoCorte={agora.getTime() >= new Date(e.prazos.corteEm).getTime()}
          temPagamento={!nadaPago}
        />
      )}

      <section aria-labelledby="titulo-historico" className="cartao p-5">
        <h2 id="titulo-historico" className="mb-3 text-2xl font-bold">
          Histórico
        </h2>
        <ol className="flex flex-col gap-3 border-l-2 border-accent2/70 pl-4 text-sm">
          {e.linhaDoTempo.map((t, i) => (
            <li key={i} className="relative">
              <span className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-full bg-secundaria" aria-hidden="true" />
              <time dateTime={t.quando} className="block text-xs font-semibold text-primaria/80">
                {formatarDataHora(t.quando)}
              </time>
              {t.texto}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="titulo-politica" className="cartao p-5">
        <h2 id="titulo-politica" className="text-2xl font-bold">
          Política de desistência
        </h2>
        <p className="mt-1 text-sm text-primaria/80">
          Aceita em {formatarDataHora(e.politica.aceitaEm)} (versão {e.politica.versao}).
        </p>
        {e.politica.textos.length > 0 ? (
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
            {e.politica.textos.map((t, i) => (
              <li key={i} className={i === 1 || i === 2 ? "font-semibold" : undefined}>
                {t}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm">
            Fale com a gente no Instagram <LinkInstagram /> para receber o texto aceito.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <BotaoImprimir />
        <p className="text-sm text-primaria/85">
          Dúvidas? Fale com a gente no Instagram <LinkInstagram />.
        </p>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{rotulo}</dt>
      <dd className="text-right tabular-nums">{valor}</dd>
    </div>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-semibold">{rotulo}</dt>
      <dd className="-mt-2 sm:mt-0">{children}</dd>
    </div>
  );
}
