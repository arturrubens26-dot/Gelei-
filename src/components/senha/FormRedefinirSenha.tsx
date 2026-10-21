"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { avisarResultadoLogin } from "@/components/login/eventos";
import { CLASSE_CARTAO_DE_VIDRO } from "@/components/login/PainelDeAcesso";
import { MENSAGEM_LINK_INVALIDO } from "@/lib/auth/redefinicao-regras";
import { MAX_BYTES_SENHA, MIN_CARACTERES_SENHA } from "@/lib/limites";

type Erros = { senha?: string; confirmacao?: string };

/** Lê `#t=<token>` (o token vem no fragmento: não vai ao servidor, aos logs nem ao Referer). */
function tokenDoFragmento(hash: string): string | null {
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return t && /^[A-Za-z0-9_-]{20,200}$/.test(t) ? t : null;
}

/** As mesmas regras do servidor (senhaNovaSchema): de 8 caracteres a 72 bytes. */
function erroDaSenha(senha: string): string | undefined {
  if (senha.length < MIN_CARACTERES_SENHA) return `Use pelo menos ${MIN_CARACTERES_SENHA} caracteres.`;
  if (new TextEncoder().encode(senha).length > MAX_BYTES_SENHA) return "Senha longa demais (acentos e emojis contam mais).";
  return undefined;
}

/**
 * Criar uma senha nova a partir do link de redefinição (`/redefinir-senha#t=<token>`). O token sai da
 * barra de endereço assim que a página abre. Depois da troca, vai para o login com o aviso: ninguém
 * entra sozinho (o limite de tentativas do login continua valendo).
 */
export function FormRedefinirSenha() {
  const router = useRouter();
  const uid = useId();
  // undefined: ainda lendo o fragmento; null: o link veio sem token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<{ texto: string; linkVencido: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [visivel, setVisivel] = useState(false);
  const enviandoRef = useRef(false);
  const alertaRef = useRef<HTMLParagraphElement>(null);
  const formularioRef = useRef<HTMLFormElement>(null);
  // O token lido do fragmento. Num ref porque o fragmento sai da URL na primeira leitura e o Effect
  // roda de novo (StrictMode, ou a rota que volta a aparecer com Cache Components).
  const lidoRef = useRef<string | null | undefined>(undefined);

  // Lê o token uma vez e o tira da URL (histórico, favoritos, prints). Ao sair da tela (a rota fica
  // montada e escondida), apaga o que foi digitado.
  useEffect(() => {
    if (lidoRef.current === undefined) {
      lidoRef.current = tokenDoFragmento(window.location.hash);
      if (window.location.hash) history.replaceState(history.state, "", window.location.pathname + window.location.search);
    }
    // O fragmento só existe no navegador: ler aqui (e não no render) evita diferença com o HTML do servidor.
    setToken(lidoRef.current);
    const formulario = formularioRef.current;
    return () => formulario?.reset();
  }, []);

  function mostrarErro(texto: string, linkVencido = false) {
    flushSync(() => setErroGeral({ texto, linkVencido }));
    alertaRef.current?.focus();
    if (alertaRef.current) avisarResultadoLogin(alertaRef.current, "erro");
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current || !token) return;
    const dados = new FormData(evento.currentTarget);
    const senha = String(dados.get("senha") ?? "");
    const confirmacao = String(dados.get("confirmacao") ?? "");
    const locais: Erros = {
      senha: erroDaSenha(senha),
      confirmacao: senha && confirmacao !== senha ? "As duas senhas estão diferentes." : !confirmacao ? "Repita a senha nova." : undefined,
    };
    setErroGeral(null);
    setErros(locais);
    if (locais.senha || locais.confirmacao) {
      mostrarErro("Confira os campos destacados.");
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resposta = await fetch("/api/auth/redefinir-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, senha }),
      });
      const json = await resposta.json().catch(() => null);
      if (resposta.ok) {
        if (formularioRef.current) avisarResultadoLogin(formularioRef.current, "sucesso");
        lidoRef.current = null;
        router.replace("/login?senha=alterada");
        return;
      }
      const detalheSenha = Array.isArray(json?.detalhes?.senha) ? String(json.detalhes.senha[0]) : undefined;
      if (resposta.status === 400 && detalheSenha) {
        setErros({ senha: detalheSenha });
        mostrarErro("Confira a senha nova.");
      } else if (resposta.status === 400) {
        // Vencido, já usado, substituído por um mais novo ou inexistente: a mesma mensagem.
        mostrarErro(json?.erro ?? MENSAGEM_LINK_INVALIDO, true);
      } else {
        mostrarErro(json?.erro ?? "Não foi possível salvar a senha agora. Tente de novo em instantes.");
      }
    } catch {
      mostrarErro("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  if (token === undefined) {
    return <div className={`${CLASSE_CARTAO_DE_VIDRO} h-96 animate-pulse`} role="status" aria-label="Abrindo o link" />;
  }

  if (token === null) {
    return (
      <div className={CLASSE_CARTAO_DE_VIDRO}>
        <h1 className="font-titulos text-3xl leading-tight font-bold text-balance text-primaria">Link incompleto</h1>
        <p className="mt-3 text-primaria/85">
          Este endereço chegou sem o código da redefinição. Abra de novo o link que você recebeu, sem cortar nenhuma parte, ou peça
          um novo.
        </p>
        <Link href="/esqueci-senha" className="btn-primario mt-6 min-h-12 w-full rounded-xl text-base">
          Pedir um novo link
        </Link>
      </div>
    );
  }

  const idSenha = `${uid}-senha`;
  const idConfirmacao = `${uid}-confirmacao`;
  const idDica = `${uid}-dica`;

  return (
    <div className={CLASSE_CARTAO_DE_VIDRO}>
      <div className="mb-7">
        <h1 className="font-titulos text-3xl leading-tight font-bold text-balance text-primaria sm:text-[2.15rem]">Crie uma senha nova</h1>
        <p className="mt-2 text-sm text-primaria/80 sm:text-base">Depois é só entrar com ela. O link funciona uma vez só.</p>
      </div>

      <form ref={formularioRef} onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {/* Para o gerenciador de senhas guardar a senha nova na conta certa. */}
        <input type="text" name="username" autoComplete="username" hidden readOnly value="" />

        <div>
          <label htmlFor={idSenha} className="mb-1 block text-sm font-semibold">
            Nova senha
          </label>
          <div className="relative">
            <input
              id={idSenha}
              name="senha"
              type={visivel ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={MIN_CARACTERES_SENHA}
              className="campo min-h-12 rounded-xl pr-12"
              aria-invalid={erros.senha ? true : undefined}
              aria-describedby={erros.senha ? `${idSenha}-erro` : idDica}
            />
            <BotaoVerSenha visivel={visivel} alternar={() => setVisivel((v) => !v)} controla={`${idSenha} ${idConfirmacao}`} />
          </div>
          {erros.senha ? (
            <p id={`${idSenha}-erro`} className="mt-1 text-sm font-medium text-secundaria">
              {erros.senha}
            </p>
          ) : (
            <p id={idDica} className="mt-1 text-xs text-primaria/80">
              Pelo menos {MIN_CARACTERES_SENHA} caracteres.
            </p>
          )}
        </div>

        <div>
          <label htmlFor={idConfirmacao} className="mb-1 block text-sm font-semibold">
            Repita a nova senha
          </label>
          <input
            id={idConfirmacao}
            name="confirmacao"
            type={visivel ? "text" : "password"}
            autoComplete="new-password"
            required
            className="campo min-h-12 rounded-xl"
            aria-invalid={erros.confirmacao ? true : undefined}
            aria-describedby={erros.confirmacao ? `${idConfirmacao}-erro` : undefined}
          />
          {erros.confirmacao && (
            <p id={`${idConfirmacao}-erro`} className="mt-1 text-sm font-medium text-secundaria">
              {erros.confirmacao}
            </p>
          )}
        </div>

        {/* Vazio, o alerta não ocupa espaço (o -mt-4 anula o gap); continua no DOM para o role="alert". */}
        <p ref={alertaRef} tabIndex={-1} role="alert" className="text-sm font-medium text-secundaria outline-offset-4 empty:-mt-4">
          {erroGeral?.texto}
          {erroGeral?.linkVencido && (
            <>
              {" "}
              <Link href="/esqueci-senha" className="font-semibold underline underline-offset-2 hover:text-primaria">
                Pedir um novo link
              </Link>
            </>
          )}
        </p>

        {/* aria-disabled (e não disabled) durante o envio: um botão desabilitado perde o foco para o <body>. */}
        <button
          type="submit"
          aria-disabled={enviando || undefined}
          className="btn-primario min-h-12 w-full rounded-xl bg-primaria text-base hover:bg-secundaria aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          {enviando ? "Salvando…" : "Salvar a senha nova"}
        </button>
      </form>
    </div>
  );
}

function BotaoVerSenha({ visivel, alternar, controla }: { visivel: boolean; alternar: () => void; controla: string }) {
  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={visivel}
      aria-controls={controla}
      aria-label="Mostrar senha"
      className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-primaria/75 transition-colors hover:text-secundaria"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
        {!visivel && <path d="m4 4 16 16" />}
      </svg>
    </button>
  );
}
