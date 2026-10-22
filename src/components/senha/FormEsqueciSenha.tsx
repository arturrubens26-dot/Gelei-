"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { CLASSE_CARTAO_DE_VIDRO } from "@/components/login/PainelDeAcesso";
import { MENSAGEM_PEDIDO_ENVIADO } from "@/lib/auth/redefinicao-regras";

/**
 * "Esqueci minha senha" por e-mail (só quando a loja tem e-mail configurado). A resposta é sempre a
 * mesma, exista a conta ou não: a tela nunca revela quem tem cadastro.
 */
export function FormEsqueciSenha({ linkDoLogin }: { linkDoLogin: string }) {
  const uid = useId();
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const alertaRef = useRef<HTMLParagraphElement>(null);
  const confirmacaoRef = useRef<HTMLDivElement>(null);

  function mostrarErro(texto: string) {
    flushSync(() => setErroGeral(texto));
    alertaRef.current?.focus();
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current) return;
    const email = String(new FormData(evento.currentTarget).get("email") ?? "").trim();
    setErroGeral(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErroEmail("Digite o e-mail da sua conta, como voce@exemplo.com.");
      mostrarErro("Confira o e-mail.");
      return;
    }
    setErroEmail(null);
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resposta = await fetch("/api/auth/esqueci-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await resposta.json().catch(() => null);
      if (resposta.status === 202) {
        flushSync(() => setEnviado(typeof json?.mensagem === "string" ? json.mensagem : MENSAGEM_PEDIDO_ENVIADO));
        confirmacaoRef.current?.focus();
        return;
      }
      const detalhe = Array.isArray(json?.detalhes?.email) ? String(json.detalhes.email[0]) : null;
      if (resposta.status === 400 && detalhe) {
        setErroEmail(detalhe);
        mostrarErro("Confira o e-mail.");
      } else {
        mostrarErro(json?.erro ?? "Não foi possível enviar agora. Tente de novo em instantes.");
      }
    } catch {
      mostrarErro("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const idEmail = `${uid}-email`;
  const botaoVoltar =
    "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-primaria/45 bg-white/70 px-5 text-sm font-semibold text-primaria transition-colors hover:border-primaria/70 hover:bg-white";

  if (enviado) {
    return (
      <div ref={confirmacaoRef} tabIndex={-1} className={`${CLASSE_CARTAO_DE_VIDRO} outline-offset-4`}>
        <h1 className="font-titulos text-3xl leading-tight font-bold text-balance text-primaria">Confira seu e-mail</h1>
        <p role="status" className="mt-3 text-primaria/90">
          {enviado}
        </p>
        <Link href={linkDoLogin} className={`${botaoVoltar} mt-6`}>
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div className={CLASSE_CARTAO_DE_VIDRO}>
      <div className="mb-7">
        <h1 className="font-titulos text-3xl leading-tight font-bold text-balance text-primaria sm:text-[2.15rem]">Esqueci minha senha</h1>
        <p className="mt-2 text-sm text-primaria/80 sm:text-base">Digite o e-mail da sua conta e mandamos um link para criar uma senha nova.</p>
      </div>
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor={idEmail} className="mb-1 block text-sm font-semibold">
            E-mail
          </label>
          <input
            id={idEmail}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="voce@exemplo.com"
            className="campo min-h-12 rounded-xl"
            aria-invalid={erroEmail ? true : undefined}
            aria-describedby={erroEmail ? `${idEmail}-erro` : undefined}
          />
          {erroEmail && (
            <p id={`${idEmail}-erro`} className="mt-1 text-sm font-medium text-secundaria">
              {erroEmail}
            </p>
          )}
        </div>

        {/* Vazio, o alerta não ocupa espaço (o -mt-4 anula o gap); continua no DOM para o role="alert". */}
        <p ref={alertaRef} tabIndex={-1} role="alert" className="text-sm font-medium text-secundaria outline-offset-4 empty:-mt-4">
          {erroGeral}
        </p>

        {/* aria-disabled (e não disabled) durante o envio: um botão desabilitado perde o foco para o <body>. */}
        <button
          type="submit"
          aria-disabled={enviando || undefined}
          className="btn-primario min-h-12 w-full rounded-xl bg-primaria text-base hover:bg-secundaria aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          {enviando ? "Enviando…" : "Enviar o link"}
        </button>
        <Link href={linkDoLogin} className={botaoVoltar}>
          Voltar para o login
        </Link>
      </form>
    </div>
  );
}
