"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

type Modo = "entrar" | "criar";

/** Título e chamada da versão "vidro" (tela /login), que tem cabeçalho próprio. */
const CABECALHO: Record<Modo, { titulo: string; subtitulo: string }> = {
  entrar: {
    titulo: "Que bom ver você de novo",
    subtitulo: "Entre para acompanhar seus pedidos e finalizar suas compras.",
  },
  criar: {
    titulo: "Crie sua conta",
    subtitulo: "É rapidinho: nome, e-mail e senha. Depois é só escolher os sabores.",
  },
};

/**
 * Entrar / criar conta rápida. Depois do sucesso vai para `destino` e atualiza
 * os dados do servidor (o header e o checkout passam a enxergar o usuário).
 *
 * - `variante="cartao"` (padrão): embutido no checkout, com o seletor "Já tenho conta / Criar conta" no topo.
 * - `variante="vidro"`: a tela /login, com título (h1) e a troca de modo abaixo do botão principal.
 */
export function AuthForm({
  destino,
  modoInicial = "entrar",
  variante = "cartao",
}: {
  destino: string;
  modoInicial?: Modo;
  variante?: "cartao" | "vidro";
}) {
  const router = useRouter();
  // IDs únicos: com Cache Components a página anterior fica montada (escondida) e o mesmo
  // formulário pode existir duas vezes no DOM; ids fixos duplicariam e quebrariam os <label for>.
  const uid = useId();
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const [enviando, setEnviando] = useState(false);
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const enviandoRef = useRef(false);
  const alertaRef = useRef<HTMLParagraphElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);

  const criando = modo === "criar";
  const vidro = variante === "vidro";

  // A rota escondida (Cache Components) continua no DOM: ao esconder, os Effects são desmontados,
  // e aproveitamos para não deixar a senha digitada guardada lá.
  useEffect(() => {
    const campoSenha = senhaRef.current;
    return () => {
      if (campoSenha) campoSenha.value = "";
    };
  }, []);

  function trocarModo(novo: Modo) {
    flushSync(() => {
      setModo(novo);
      setErro(null);
      setErrosCampo({});
      setSenhaVisivel(false);
    });
    // Na tela de login o título muda ("Crie sua conta"): levar o foco até ele faz o leitor de tela
    // anunciar a troca, e o campo Nome que surgiu fica logo à frente na ordem do Tab.
    if (vidro) tituloRef.current?.focus();
  }

  /** Mostra o erro e só então leva o foco ao alerta (com o texto já no DOM). */
  function mostrarErro(mensagem: string, detalhes: Record<string, string[]> = {}) {
    flushSync(() => {
      setErro(mensagem);
      setErrosCampo(detalhes);
    });
    alertaRef.current?.focus();
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current) return;
    const formulario = evento.currentTarget;
    const dados = new FormData(formulario);
    const corpo = {
      ...(criando ? { nome: String(dados.get("nome") ?? "") } : {}),
      email: String(dados.get("email") ?? ""),
      senha: String(dados.get("senha") ?? ""),
    };

    setErro(null);
    setErrosCampo({});
    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resposta = await fetch(`/api/auth/${criando ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        mostrarErro(json?.erro ?? "Não foi possível continuar.", json?.detalhes && typeof json.detalhes === "object" ? json.detalhes : {});
        return;
      }
      formulario.reset();
      router.replace(destino);
      router.refresh();
    } catch {
      mostrarErro("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const erroDe = (campo: string) => errosCampo[campo]?.[0];
  const idNome = `${uid}-nome`;
  const idEmail = `${uid}-email`;
  const idSenha = `${uid}-senha`;
  const classeCampo = vidro ? "campo min-h-12 rounded-xl" : "campo";

  return (
    <div
      className={
        vidro
          ? "w-full max-w-md rounded-[1.75rem] border border-white/70 bg-white/60 p-6 shadow-[0_24px_60px_-40px_rgb(107_29_42/0.35)] backdrop-blur-xl sm:p-9"
          : "cartao mx-auto w-full max-w-md p-6 shadow-sm"
      }
    >
      {vidro ? (
        <div className="mb-7">
          <h1
            ref={tituloRef}
            tabIndex={-1}
            className="font-titulos text-3xl leading-tight font-bold text-balance text-primaria outline-offset-4 sm:text-[2.15rem]"
          >
            {CABECALHO[modo].titulo}
          </h1>
          <p className="mt-2 text-sm text-primaria/80 sm:text-base">{CABECALHO[modo].subtitulo}</p>
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-full border border-accent2 p-1" role="group" aria-label="Entrar ou criar conta">
          {(["entrar", "criar"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              disabled={enviando}
              onClick={() => trocarModo(m)}
              // Em cores forçadas (Alto Contraste) o fundo some: o botão marcado ganha as cores de seleção do sistema.
              className={`min-h-11 rounded-full border-2 border-transparent text-sm font-semibold transition-colors disabled:cursor-not-allowed forced-colors:aria-pressed:bg-[Highlight] forced-colors:aria-pressed:text-[HighlightText] forced-colors:aria-pressed:forced-color-adjust-none ${
                modo === m ? "bg-secundaria text-destaque" : "text-primaria hover:bg-accent1/40"
              }`}
            >
              {m === "entrar" ? "Já tenho conta" : "Criar conta"}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {criando && (
          <div>
            <label htmlFor={idNome} className="mb-1 block text-sm font-semibold">
              Nome
            </label>
            <input
              id={idNome}
              name="nome"
              autoComplete="name"
              required
              placeholder="Seu nome"
              className={classeCampo}
              aria-invalid={erroDe("nome") ? true : undefined}
              aria-describedby={erroDe("nome") ? `${idNome}-erro` : undefined}
            />
            {erroDe("nome") && (
              <p id={`${idNome}-erro`} className="mt-1 text-sm font-medium text-secundaria">
                {erroDe("nome")}
              </p>
            )}
          </div>
        )}
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
            className={classeCampo}
            aria-invalid={erroDe("email") ? true : undefined}
            aria-describedby={erroDe("email") ? `${idEmail}-erro` : undefined}
          />
          {erroDe("email") && (
            <p id={`${idEmail}-erro`} className="mt-1 text-sm font-medium text-secundaria">
              {erroDe("email")}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={idSenha} className="mb-1 block text-sm font-semibold">
            Senha
          </label>
          <div className="relative">
            <input
              ref={senhaRef}
              id={idSenha}
              name="senha"
              type={senhaVisivel ? "text" : "password"}
              autoComplete={criando ? "new-password" : "current-password"}
              required
              minLength={criando ? 8 : undefined}
              placeholder={criando ? "Crie uma senha" : "Sua senha"}
              className={`${classeCampo} pr-12`}
              aria-invalid={erroDe("senha") ? true : undefined}
              aria-describedby={erroDe("senha") ? `${idSenha}-erro` : criando ? `${idSenha}-dica` : undefined}
            />
            <button
              type="button"
              onClick={() => setSenhaVisivel((v) => !v)}
              aria-pressed={senhaVisivel}
              aria-controls={idSenha}
              aria-label="Mostrar senha"
              className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-primaria/75 transition-colors hover:text-secundaria"
            >
              <IconeOlho riscado={!senhaVisivel} />
            </button>
          </div>
          {criando && !erroDe("senha") && (
            <p id={`${idSenha}-dica`} className="mt-1 text-xs text-primaria/80">
              Pelo menos 8 caracteres.
            </p>
          )}
          {erroDe("senha") && (
            <p id={`${idSenha}-erro`} className="mt-1 text-sm font-medium text-secundaria">
              {erroDe("senha")}
            </p>
          )}
        </div>

        {/* Vazio, o alerta não ocupa espaço (o -mt-4 anula o gap); continua no DOM para o role="alert". */}
        <p ref={alertaRef} tabIndex={-1} role="alert" className="text-sm font-medium text-secundaria outline-offset-4 empty:-mt-4">
          {erro}
        </p>

        {/* aria-disabled (e não disabled) durante o envio: um botão desabilitado perde o foco para o <body>. */}
        <button
          type="submit"
          aria-disabled={enviando || undefined}
          className={`${
            vidro ? "btn-primario min-h-12 w-full rounded-xl bg-primaria text-base hover:bg-secundaria" : "btn-primario w-full"
          } aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          {enviando ? "Aguarde…" : criando ? "Criar conta e continuar" : "Entrar"}
        </button>
      </form>

      {vidro && (
        <>
          <div aria-hidden="true" className="my-5 flex items-center gap-3 text-xs font-semibold tracking-[0.2em] text-primaria/85 uppercase">
            <span className="h-px flex-1 bg-primaria/15" />
            ou
            <span className="h-px flex-1 bg-primaria/15" />
          </div>
          <button
            type="button"
            disabled={enviando}
            onClick={() => trocarModo(criando ? "entrar" : "criar")}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-primaria/45 bg-white/70 px-5 text-sm font-semibold text-primaria transition-colors hover:border-primaria/70 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {criando ? "Já tenho conta" : "Criar conta"}
          </button>
        </>
      )}
    </div>
  );
}

/** Olho aberto quando a senha está visível; riscado quando está oculta. */
function IconeOlho({ riscado }: { riscado: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {riscado && <path d="m4 4 16 16" />}
    </svg>
  );
}
