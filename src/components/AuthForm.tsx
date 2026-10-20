"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { avisarResultadoLogin, movimentoReduzido } from "@/components/login/eventos";
import { MAX_BYTES_SENHA } from "@/lib/limites";

type Modo = "entrar" | "criar";

const SENHA_MINIMA = 8;
/** Parecido com o z.email() do servidor: precisa de domínio com ponto e final de 2+ letras. */
const EMAIL_PROVAVEL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

type MedidaSenha = { tamanho: number; longa: boolean };

/**
 * Quanto do formulário já está pronto, de 0 a 1 (a altura da geleia no botão da tela /login).
 * Segue as regras do servidor (registroSchema/loginSchema em lib/validacao.ts) para o botão não
 * "encher" com algo que vai ser recusado: nome com 2+ letras (ao criar conta), e-mail plausível e
 * senha digitada (ao criar, de 8 caracteres a 72 bytes). A validação de verdade continua no servidor.
 */
function medirPreenchimento(formulario: HTMLFormElement, criando: boolean) {
  const dados = new FormData(formulario);
  const texto = (campo: string) => String(dados.get(campo) ?? "");
  const email = texto("email").trim();
  const senhaDigitada = texto("senha");
  const senha: MedidaSenha = {
    tamanho: senhaDigitada.length,
    longa: new TextEncoder().encode(senhaDigitada).length > MAX_BYTES_SENHA,
  };
  const passos = [
    EMAIL_PROVAVEL.test(email) && email.length <= 160,
    criando ? senha.tamanho >= SENHA_MINIMA && !senha.longa : senha.tamanho > 0,
  ];
  if (criando) passos.push(texto("nome").trim().length >= 2);
  return { nivel: passos.filter(Boolean).length / passos.length, senha };
}

/**
 * Altura da geleia no botão (0 a 1) para um nível de preenchimento. Pela metade, ela sobe só no
 * fundo, abaixo do texto (a linha da onda não corta as letras); completo, inunda o botão de uma vez.
 */
const alturaDaGeleia = (nivel: number) => (nivel === 0 ? 0 : nivel === 1 ? 1 : 0.06 + nivel * 0.27);

// Movimentos do botão de geleia e do cartão (Web Animations; só sem "reduzir movimento").
/** A geleia acabou de subir ou descer: a onda marulha e assenta baixinha. */
const MARULHO: Keyframe[] = [
  { transform: "translateX(-50%) scaleY(1.5)" },
  { transform: "translateX(-25%) scaleY(0.9)", offset: 0.45 },
  // Termina na altura de repouso da crista (.geleia-onda no globals.css), sem pulinho no fim.
  { transform: "translateX(0%) scaleY(0.5)" },
];
/** Enviando: a geleia fica mexendo até a resposta chegar. */
const MEXENDO: Keyframe[] = [{ transform: "translateX(-50%) scaleY(0.9)" }, { transform: "translateX(0%) scaleY(0.9)" }];
/** Formulário completo: o botão treme uma vez, como gelatina saindo da forma. */
const BALANCO: Keyframe[] = [
  { transform: "none" },
  { transform: "scale(1.04, 0.92)" },
  { transform: "scale(0.97, 1.06)" },
  { transform: "scale(1.02, 0.97)" },
  { transform: "scale(0.995, 1.01)" },
  { transform: "none" },
];
/** Erro: o cartão sacode de um lado para o outro, amortecendo. */
const TREMOR: Keyframe[] = [
  { transform: "none" },
  { transform: "translateX(-10px) skewX(3deg)" },
  { transform: "translateX(8px) skewX(-2.5deg)" },
  { transform: "translateX(-5px) skewX(1.5deg)" },
  { transform: "translateX(2px) skewX(-0.5deg)" },
  { transform: "none" },
];

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
 *   Nela o botão "Entrar" enche de geleia conforme os campos ficam prontos, cada campo focado
 *   pinga uma gota, a senha nova tem um potinho que enche até o mínimo, e o resultado do envio
 *   é avisado ao pote animado ao lado (login/eventos.ts).
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
  const [nivel, setNivel] = useState(0);
  const [medidaSenha, setMedidaSenha] = useState<MedidaSenha>({ tamanho: 0, longa: false });
  const enviandoRef = useRef(false);
  const alertaRef = useRef<HTMLParagraphElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);
  const cartaoRef = useRef<HTMLDivElement>(null);
  const formularioRef = useRef<HTMLFormElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const ondaRef = useRef<HTMLSpanElement>(null);

  const criando = modo === "criar";
  const vidro = variante === "vidro";

  // A rota escondida (Cache Components) continua no DOM: ao esconder, os Effects são desmontados,
  // e aproveitamos para não deixar a senha digitada guardada lá (nem a geleia que ela enchia).
  // Ao mostrar de novo, a geleia é medida outra vez (o e-mail pode ter ficado preenchido).
  const medirAoMostrar = useEffectEvent(() => medir());
  useEffect(() => {
    const campoSenha = senhaRef.current;
    medirAoMostrar();
    return () => {
      if (campoSenha) campoSenha.value = "";
      setNivel(0);
      setMedidaSenha({ tamanho: 0, longa: false });
    };
  }, []);

  // A geleia do botão mudou de altura: a onda marulha; se encheu, o botão treme uma vez.
  useEffect(() => {
    if (!vidro || nivel === 0 || movimentoReduzido()) return;
    const marulho = ondaRef.current?.animate(MARULHO, { duration: 1400, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
    const balanco = nivel === 1 ? botaoRef.current?.animate(BALANCO, { duration: 800, easing: "ease-out" }) : undefined;
    return () => {
      marulho?.cancel();
      balanco?.cancel();
    };
  }, [nivel, vidro]);

  // Enviando: a geleia fica mexendo (o texto "Aguarde…" continua sendo o aviso).
  useEffect(() => {
    if (!vidro || !enviando || movimentoReduzido()) return;
    const mexendo = ondaRef.current?.animate(MEXENDO, { duration: 1000, iterations: Infinity });
    return () => mexendo?.cancel();
  }, [enviando, vidro]);

  /** Recalcula a geleia do botão e o potinho da senha a partir do que está nos campos. */
  function medir(criandoAgora = criando) {
    if (!vidro || !formularioRef.current) return;
    const medida = medirPreenchimento(formularioRef.current, criandoAgora);
    setNivel(medida.nivel);
    setMedidaSenha((atual) => (atual.tamanho === medida.senha.tamanho && atual.longa === medida.senha.longa ? atual : medida.senha));
  }

  function trocarModo(novo: Modo) {
    flushSync(() => {
      setModo(novo);
      setErro(null);
      setErrosCampo({});
      setSenhaVisivel(false);
    });
    // O campo Nome entrou (ou saiu): a geleia do botão se ajusta ao novo total de passos.
    medir(novo === "criar");
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
    if (vidro) {
      if (alertaRef.current) avisarResultadoLogin(alertaRef.current, "erro");
      if (!movimentoReduzido()) cartaoRef.current?.animate(TREMOR, { duration: 600, easing: "ease-out" });
    }
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
      if (vidro) avisarResultadoLogin(formulario, "sucesso");
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
  // Na tela de login, cada campo pinga uma gota de geleia ao receber o foco (globals.css).
  const classeCaixaCampo = vidro ? "gota-foco" : undefined;

  return (
    <div
      ref={cartaoRef}
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

      {/* onInput/onFocus medem o preenchimento (o foco pega também o que o navegador preencheu sozinho). */}
      <form ref={formularioRef} onSubmit={enviar} onInput={() => medir()} onFocus={() => medir()} className="flex flex-col gap-4" noValidate>
        {criando && (
          <div className={vidro ? "surgir-geleia" : undefined}>
            <label htmlFor={idNome} className="mb-1 block text-sm font-semibold">
              Nome
            </label>
            <div className={classeCaixaCampo}>
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
            </div>
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
          <div className={classeCaixaCampo}>
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
          </div>
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
          <div className={`relative ${classeCaixaCampo ?? ""}`}>
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
          {criando &&
            !erroDe("senha") &&
            (vidro ? (
              // A contagem muda a cada tecla: fica só para quem vê (aria-hidden). O campo é descrito
              // por um texto fixo, para o leitor de tela não reler a dica a cada caractere.
              <p className="mt-1.5 flex items-center gap-2 text-xs text-primaria/80">
                <PotinhoDaSenha nivel={medidaSenha.longa ? 1 : Math.min(medidaSenha.tamanho / SENHA_MINIMA, 1)} />
                <span aria-hidden="true">{dicaDaSenha(medidaSenha)}</span>
                <span id={`${idSenha}-dica`} className="sr-only">
                  Pelo menos {SENHA_MINIMA} caracteres.
                </span>
              </p>
            ) : (
              <p id={`${idSenha}-dica`} className="mt-1 text-xs text-primaria/80">
                Pelo menos {SENHA_MINIMA} caracteres.
              </p>
            ))}
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
          ref={botaoRef}
          type="submit"
          aria-disabled={enviando || undefined}
          className={`${
            vidro ? "btn-primario botao-geleia min-h-12 w-full rounded-xl bg-primaria text-base hover:bg-primaria" : "btn-primario w-full"
          } aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          {vidro && (
            <span aria-hidden="true" className="geleia-nivel" data-vazio={nivel === 0 || undefined} style={{ "--geleia": alturaDaGeleia(nivel) } as CSSProperties}>
              <span ref={ondaRef} className="geleia-onda">
                <svg viewBox="0 0 200 10" preserveAspectRatio="none" className="block size-full" fill="currentColor">
                  <path d="M0 5Q12.5 0 25 5T50 5T75 5T100 5T125 5T150 5T175 5T200 5V10H0Z" />
                </svg>
              </span>
            </span>
          )}
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

/** Dica da senha nova: quantos caracteres faltam até "dar o ponto", como a geleia no fogo. */
function dicaDaSenha({ tamanho, longa }: MedidaSenha) {
  if (longa) return "Longa demais (acentos e emojis contam mais).";
  if (tamanho === 0) return `Pelo menos ${SENHA_MINIMA} caracteres.`;
  const faltam = SENHA_MINIMA - tamanho;
  if (faltam <= 0) return "Senha no ponto.";
  return faltam === 1 ? "Falta 1 caractere." : `Faltam ${faltam} caracteres.`;
}

/** Potinho que enche de geleia até a senha ter o mínimo de caracteres (decorativo: a dica ao lado diz o mesmo). */
function PotinhoDaSenha({ nivel }: { nivel: number }) {
  const recorte = `${useId()}-potinho`;
  const interior = "M3.5 7.5h9v8a3 3 0 0 1-3 3h-3a3 3 0 0 1-3-3Z";
  return (
    <svg viewBox="0 0 16 20" className="h-6 w-[1.2rem] shrink-0 overflow-visible" aria-hidden="true">
      <defs>
        <clipPath id={recorte}>
          <path d={interior} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${recorte})`}>
        {/* 11 = altura do interior do pote (de y 7,5 a 18,5); a geleia sobe com um leve passar do ponto. */}
        <rect
          x="2"
          y="7.5"
          width="12"
          height="12"
          className="fill-secundaria transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
          style={{ transform: `translateY(${(1 - nivel) * 11}px)` }}
        />
      </g>
      <path d={interior} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="2.5" y="3.5" width="11" height="3.2" rx="1" className={`fill-accent2 transition-transform duration-300 ${nivel === 1 ? "-translate-y-0.5 -rotate-6" : ""}`} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
    </svg>
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
