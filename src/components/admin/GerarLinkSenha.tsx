"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  CONFERENCIAS,
  MAX_OBSERVACAO_LINK,
  ROTULO_CONFERENCIA,
  conferenciaSuficiente,
  horaDeBrasilia,
  type ConferenciaIdentidade,
  type LinkSenhaGeradoDTO,
} from "@/lib/auth/redefinicao-regras";

/**
 * Bloco "Gerar link de redefinição" da ficha da cliente: o roteiro de conferência de identidade
 * (plano, seção 3.3), as caixas do que foi conferido (o servidor exige e grava), o botão, e o link
 * mostrado UMA vez, com a mensagem pronta para copiar e mandar na mesma conversa do Instagram.
 */
export function GerarLinkSenha({
  clienteId,
  temHistorico,
  temTelefone,
}: {
  clienteId: string;
  /** A conta tem pedido ou endereço: então precisa conferir algo do pedido ou da entrega. */
  temHistorico: boolean;
  /** Há telefone no cadastro (dá para conferir o final). */
  temTelefone: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [marcadas, setMarcadas] = useState<ConferenciaIdentidade[]>([]);
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<LinkSenhaGeradoDTO | null>(null);
  const [copiado, setCopiado] = useState<"mensagem" | "link" | null>(null);
  const enviandoRef = useRef(false);
  const mensagemRef = useRef<HTMLTextAreaElement>(null);
  const resultadoRef = useRef<HTMLDivElement>(null);

  // O link aparece uma vez: some quando a ficha sai da tela (com Cache Components ela fica escondida).
  useEffect(() => () => setGerado(null), []);
  useEffect(() => {
    if (gerado) resultadoRef.current?.focus();
  }, [gerado]);

  const opcoes = CONFERENCIAS.filter((c) => c !== "TELEFONE" || temTelefone);
  const suficiente = conferenciaSuficiente(marcadas, temHistorico);
  const exigencia = temHistorico
    ? "Para gerar: e-mail, nome e algo de um pedido ou o endereço."
    : "Para gerar: e-mail e nome.";

  function alternar(c: ConferenciaIdentidade, marcado: boolean) {
    setErro(null);
    setMarcadas((atuais) => (marcado ? [...atuais, c] : atuais.filter((x) => x !== c)));
  }

  async function gerar() {
    if (enviandoRef.current) return;
    if (!suficiente) {
      setErro(`Confira mais antes de gerar o link. ${exigencia}`);
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/admin/clientes/${encodeURIComponent(clienteId)}/link-senha`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conferencia: marcadas, ...(observacao.trim() ? { observacao: observacao.trim() } : {}) }),
      });
      const json = await resposta.json().catch(() => null);
      if (resposta.status === 201 && typeof json?.link === "string" && typeof json?.mensagemSugerida === "string") {
        setGerado(json as LinkSenhaGeradoDTO);
        setMarcadas([]);
        setObservacao("");
        router.refresh(); // o histórico de links da ficha passa a mostrar este
        return;
      }
      const detalhe = Array.isArray(json?.detalhes?.conferencia) ? String(json.detalhes.conferencia[0]) : null;
      setErro(detalhe ?? json?.erro ?? "Não foi possível gerar o link agora. Tente de novo em instantes.");
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  async function copiar(qual: "mensagem" | "link") {
    if (!gerado) return;
    try {
      await navigator.clipboard.writeText(qual === "mensagem" ? gerado.mensagemSugerida : gerado.link);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 4000);
    } catch {
      // Sem permissão para a área de transferência: seleciona a mensagem para copiar com Ctrl+C.
      mensagemRef.current?.select();
      setErro("Selecionamos a mensagem: copie com Ctrl+C.");
    }
  }

  const idObservacao = `${uid}-observacao`;
  const idExigencia = `${uid}-exigencia`;

  return (
    <section aria-labelledby={`${uid}-titulo`} className="cartao flex flex-col gap-4 p-5 lg:sticky lg:top-6">
      <h2 id={`${uid}-titulo`} className="text-xl font-bold">
        Senha nova para a cliente
      </h2>

      <div className="text-sm">
        <p className="font-semibold">Antes de gerar, confira quem está pedindo:</p>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 leading-relaxed">
          <li>
            Ela diz o <strong>e-mail</strong> da conta, e você procura por ele. Nunca sugira nem confirme um e-mail (“é maria@…?”).
          </li>
          <li>
            Ela diz o <strong>nome</strong> como está no cadastro.
          </li>
          <li>
            Ela diz <strong>algo de um pedido</strong> que só ela sabe: o que comprou (sabores ou kit), o bairro ou o CEP da entrega, o
            mês da compra ou o código do pedido. Compare com a ficha, sem ler os dados para ela.
          </li>
          {temTelefone && (
            <li>
              Se ela disser o <strong>WhatsApp</strong>, confira se o final bate com a ficha.
            </li>
          )}
          <li>
            Mande o link <strong>só na mesma conversa</strong> em que ela respondeu, nunca em comentário público. Se outra pessoa pedir
            pela mesma conta, não gere.
          </li>
        </ol>
        {!temHistorico && (
          <p className="mt-3 rounded-lg border-2 border-secundaria bg-secundaria/5 p-3 font-medium">
            Conta sem pedidos nem endereços: confira com mais cuidado. Na dúvida, sugira criar uma conta nova.
          </p>
        )}
      </div>

      {gerado ? (
        <div ref={resultadoRef} tabIndex={-1} className="flex flex-col gap-3 rounded-lg border-2 border-accent3 bg-accent3/10 p-4 text-sm outline-offset-4">
          <p role="status" className="font-semibold">
            Link gerado. Ele vale até as {horaDeBrasilia(new Date(gerado.expiraEm))} e só aparece agora: copie a mensagem e mande na
            conversa com a cliente.
          </p>
          <label htmlFor={`${uid}-mensagem`} className="font-semibold">
            Mensagem para a cliente
          </label>
          <textarea
            ref={mensagemRef}
            id={`${uid}-mensagem`}
            readOnly
            rows={7}
            value={gerado.mensagemSugerida}
            onFocus={(e) => e.currentTarget.select()}
            className="campo resize-none text-sm break-all"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primario" onClick={() => copiar("mensagem")}>
              {copiado === "mensagem" ? "Mensagem copiada!" : "Copiar mensagem"}
            </button>
            <button type="button" className="btn-secundario" onClick={() => copiar("link")}>
              {copiado === "link" ? "Link copiado!" : "Copiar só o link"}
            </button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {copiado === "mensagem" ? "Mensagem copiada." : copiado === "link" ? "Link copiado." : ""}
          </p>
          <button
            type="button"
            className="self-start text-sm font-semibold text-secundaria underline underline-offset-2 hover:text-primaria"
            onClick={() => {
              setGerado(null);
              setCopiado(null);
            }}
          >
            Gerar outro link (o anterior deixa de valer)
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1" aria-describedby={idExigencia}>
            <legend className="mb-1 text-sm font-semibold">O que você conferiu</legend>
            {opcoes.map((c) => (
              <label key={c} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-accent1/20">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-secundaria"
                  checked={marcadas.includes(c)}
                  onChange={(e) => alternar(c, e.target.checked)}
                />
                {ROTULO_CONFERENCIA[c]}
              </label>
            ))}
            <p id={idExigencia} className="mt-1 text-xs text-primaria/80">
              {exigencia}
            </p>
          </fieldset>

          <div>
            <label htmlFor={idObservacao} className="mb-1 block text-sm font-semibold">
              Observação (opcional)
            </label>
            <textarea
              id={idObservacao}
              rows={2}
              maxLength={MAX_OBSERVACAO_LINK}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo resize-y"
              aria-describedby={`${idObservacao}-dica`}
            />
            <p id={`${idObservacao}-dica`} className="mt-1 text-xs text-primaria/80">
              Ex.: “pediu pelo Instagram, disse o kit de outubro”. {observacao.length}/{MAX_OBSERVACAO_LINK}
            </p>
          </div>

          <p role="alert" className="text-sm font-medium text-secundaria empty:hidden">
            {erro}
          </p>

          {/* aria-disabled (e não disabled): o botão continua focável e explica o que falta ao clicar. */}
          <button
            type="button"
            onClick={gerar}
            aria-disabled={!suficiente || enviando || undefined}
            aria-describedby={idExigencia}
            className="btn-primario aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {enviando ? "Gerando…" : "Gerar link de redefinição"}
          </button>
        </div>
      )}

      {gerado && erro && (
        <p role="alert" className="text-sm font-medium text-secundaria">
          {erro}
        </p>
      )}
    </section>
  );
}
