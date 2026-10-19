"use client";

import Image from "next/image";
import { useAnimate, useInView, useReducedMotion, type AnimationPlaybackControls, type AnimationSequence } from "framer-motion";
import { useCallback, useEffect, useId, useRef } from "react";

/*
 * Cena do card da direita do login: o pote real de Maracujá (foto recortada em camadas) abre
 * sozinho. A tampa desenrosca e sobe inclinada, uma colher de pau entra, tira geleia e uma gota
 * pinga de volta. Repete quando a pessoa foca um campo do formulário.
 *
 * Camadas (de trás para a frente), todas no MESMO sistema de coordenadas da foto original
 * (fotos-originais/maracuja-125g.png, 768 px de largura), com a cena de x 0–768 e y −80–880:
 *   boca (superfície da geleia) → onda → colher → gota → pote + gargalo → borda da frente → tampa
 * A colher passa ATRÁS do pote: ao descer, some atrás da borda da frente, como se entrasse nele.
 * As camadas animadas ocupam a cena inteira, então deslocamentos em % valem em qualquer tamanho.
 *
 * Os recortes estão em public/login/ (gerados pelo script descrito no README).
 */

const VW = 768;
const VH = 960;
const Y0 = -80;
const VIEWBOX = `0 ${Y0} ${VW} ${VH}`;

/** Deslocamento em unidades da cena → % da camada (que tem o tamanho da cena). */
const ux = (u: number) => `${(u / VW) * 100}%`;
const uy = (u: number) => `${(u / VH) * 100}%`;
/** Posição de uma imagem recortada, a partir da caixa dela na foto original. */
const caixa = (x: number, y: number, largura: number) => ({
  left: `${(x / VW) * 100}%`,
  top: `${((y - Y0) / VH) * 100}%`,
  width: `${(largura / VW) * 100}%`,
});
/** Ponto da cena como transform-origin de uma camada. */
const origem = (x: number, y: number) => `${(x / VW) * 100}% ${((y - Y0) / VH) * 100}%`;

// Boca do pote (elipse da superfície da geleia) e pontos da coreografia, medidos na foto.
const BOCA = { cx: 383, cy: 258, rx: 198, ry: 21 };
const CENTRO_TAMPA = { x: 383, y: 240 };
const CONCHA = { x: 452, y: 196 }; // centro da concha da colher em repouso
/** Escala da colher: a concha fica com ~1/3 da largura do pote, como uma colher de pau de verdade. */
const ESCALA_COLHER = 1.4;
// Ponta da concha na pose erguida (centro 458,118; eixo a −46°; meio-eixo 58 × 1,4): onde a gota nasce.
const PONTA_GOTA = { x: 402, y: 178 };
const QUEDA_GOTA = 82; // até a superfície da geleia

// Poses (deslocamentos a partir do desenho em repouso).
const TAMPA_ERGUIDA = { x: ux(-120), y: uy(-205), rotate: -14 };
const COLHER_FORA = { x: ux(260), y: uy(-320), rotate: 18 };
const COLHER_DENTRO = { x: ux(-46), y: uy(78), rotate: -6 };
const COLHER_ERGUIDA = { x: ux(6), y: uy(-78), rotate: 4 };

const SAIDA_SUAVE = [0.22, 1, 0.36, 1] as const;

/** Abre o pote: desenroscar, erguer a tampa, colher entra, pega geleia, gota pinga. ≈ 5 s. */
const ABRIR: AnimationSequence = [
  ["[data-tampa]", { rotate: [0, -4, 3, -4, 3, -2], y: [uy(0), uy(-3), uy(-6), uy(-9), uy(-12), uy(-16)] }, { duration: 1.1, ease: "easeInOut" }],
  ["[data-tampa]", TAMPA_ERGUIDA, { duration: 0.95, ease: SAIDA_SUAVE }],
  [
    "[data-colher]",
    { opacity: [0, 1], x: [COLHER_FORA.x, ux(0)], y: [COLHER_FORA.y, uy(0)], rotate: [COLHER_FORA.rotate, 0] },
    { duration: 1, ease: SAIDA_SUAVE, at: "-0.35" },
  ],
  ["[data-colher]", COLHER_DENTRO, { duration: 0.6, ease: "easeInOut", at: "+0.1" }],
  // A porção aparece enquanto a concha está escondida dentro do pote.
  ["[data-porcao]", { opacity: 1 }, { duration: 0.01, at: "+0.2" }],
  ["[data-colher]", COLHER_ERGUIDA, { duration: 0.9, ease: [0.33, 1, 0.68, 1] }],
  ["[data-gota]", { opacity: [0, 1], scale: [0.2, 1], y: uy(0), scaleY: 1 }, { duration: 0.4, ease: "easeOut", at: "-0.15" }],
  ["[data-gota]", { y: [uy(0), uy(QUEDA_GOTA)], scaleY: [1, 1.25] }, { duration: 0.5, ease: "easeIn", at: "+0.35" }],
  ["[data-gota]", { opacity: 0 }, { duration: 0.08 }],
  ["[data-onda]", { opacity: [0.9, 0], scale: [0.3, 1.6] }, { duration: 0.75, ease: "easeOut", at: "<" }],
];

/** Uma gota a cada ~4 s enquanto o pote está aberto. */
const PINGAR: AnimationSequence = [
  ["[data-gota]", { opacity: [0, 1], scale: [0.2, 1], y: uy(0), scaleY: 1 }, { duration: 0.45, ease: "easeOut" }],
  ["[data-gota]", { y: [uy(0), uy(QUEDA_GOTA)], scaleY: [1, 1.25] }, { duration: 0.5, ease: "easeIn", at: "+0.7" }],
  ["[data-gota]", { opacity: 0 }, { duration: 0.08 }],
  ["[data-onda]", { opacity: [0.9, 0], scale: [0.3, 1.6] }, { duration: 0.75, ease: "easeOut", at: "<" }],
];

/** Fecha de novo (antes de repetir): colher sai, tampa volta e enrosca. */
const FECHAR: AnimationSequence = [
  ["[data-gota]", { opacity: 0 }, { duration: 0.1 }],
  ["[data-colher]", { ...COLHER_FORA, opacity: 0 }, { duration: 0.7, ease: [0.64, 0, 0.78, 0] }],
  ["[data-porcao]", { opacity: 0 }, { duration: 0.01 }],
  ["[data-tampa]", { x: ux(0), y: uy(-16), rotate: -2 }, { duration: 0.75, ease: SAIDA_SUAVE, at: "-0.3" }],
  ["[data-tampa]", { y: uy(0), rotate: [-2, 3, -3, 2, 0] }, { duration: 0.6, ease: "easeInOut" }],
];

/** Quadro parado (reduzir movimento): pote aberto, colher erguida com geleia, gota pendurada. */
const QUADRO_PARADO: AnimationSequence = [
  ["[data-tampa]", TAMPA_ERGUIDA, { duration: 0 }],
  ["[data-colher]", { ...COLHER_ERGUIDA, opacity: 1 }, { duration: 0, at: 0 }],
  ["[data-porcao]", { opacity: 1 }, { duration: 0, at: 0 }],
  ["[data-gota]", { opacity: 1, scale: 1, y: uy(0) }, { duration: 0, at: 0 }],
];

/** Intervalo mínimo entre uma repetição pelo foco e outra (passar do e-mail para a senha não repete). */
const INTERVALO_REPETICAO_MS = 8000;

type Estado = "fechado" | "tocando" | "aberto";

/**
 * Pote animado do login. Decorativo (aria-hidden, imagens com alt=""): o conteúdo está no formulário.
 * Ocupa o elemento pai, que precisa ter tamanho definido e `position: relative`.
 *
 * Como há movimento contínuo (tampa flutuando, gotas), existe o controle "Pausar animação"
 * (WCAG 2.2.2), fora da área aria-hidden. Com "reduzir movimento" no sistema a cena fica parada
 * no quadro final e o controle some. Fora da tela (rota escondida, que continua montada), pausa.
 */
export function AnimatedJamJar() {
  const [escopo, animar] = useAnimate<HTMLDivElement>();
  const reduzir = useReducedMotion();
  const visivel = useInView(escopo);
  const id = useId();

  const estado = useRef<Estado>("fechado");
  const geracao = useRef(0); // muda ao desmontar: coreografias em andamento param no próximo passo
  const ativos = useRef(new Set<AnimationPlaybackControls>());
  const lacos = useRef(new Set<AnimationPlaybackControls>());
  const pausadoPelaPessoa = useRef(false);
  const visivelRef = useRef(false);
  const fimUltima = useRef(0);
  const imagens = useRef<(HTMLImageElement | null)[]>([]);

  /** Roda uma sequência registrando os controles (para pausar/cancelar). */
  const rodar = useCallback(
    async (sequencia: AnimationSequence, opcoes?: { repeat?: number; repeatDelay?: number }, laco = false) => {
      const controles = animar(sequencia, opcoes);
      const conjunto = laco ? lacos.current : ativos.current;
      conjunto.add(controles);
      if (pausadoPelaPessoa.current || !visivelRef.current) controles.pause();
      try {
        await controles;
      } finally {
        conjunto.delete(controles);
      }
    },
    [animar],
  );

  const pararLacos = useCallback(() => {
    for (const c of lacos.current) c.stop();
    lacos.current.clear();
  }, []);

  /** Desmontagem: invalida coreografias em andamento (próximo passo não roda) e para tudo. */
  const pararTudo = useCallback(() => {
    geracao.current++;
    for (const c of ativos.current) c.stop();
    ativos.current.clear();
    pararLacos();
    estado.current = "fechado";
  }, [pararLacos]);

  /** Depois de aberto: tampa flutua, colher balança de leve e pinga uma gota de vez em quando. */
  const iniciarLacos = useCallback(() => {
    const flutuar = animar(
      "[data-tampa]",
      { y: [TAMPA_ERGUIDA.y, uy(-213)], rotate: [TAMPA_ERGUIDA.rotate, -12.5] },
      { duration: 3.2, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" },
    );
    const balancar = animar(
      "[data-colher]",
      { y: [COLHER_ERGUIDA.y, uy(-81)], rotate: [COLHER_ERGUIDA.rotate, 4.6] },
      { duration: 2.6, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" },
    );
    lacos.current.add(flutuar);
    lacos.current.add(balancar);
    if (pausadoPelaPessoa.current || !visivelRef.current) {
      flutuar.pause();
      balancar.pause();
    }
    void rodar(PINGAR, { repeat: Infinity, repeatDelay: 2.6 }, true);
  }, [animar, rodar]);

  const abrir = useCallback(async () => {
    const minha = geracao.current;
    estado.current = "tocando";
    await rodar(ABRIR);
    if (minha !== geracao.current) return;
    estado.current = "aberto";
    fimUltima.current = performance.now();
    iniciarLacos();
  }, [rodar, iniciarLacos]);

  const repetir = useCallback(async () => {
    const minha = geracao.current;
    estado.current = "tocando";
    pararLacos();
    await rodar(FECHAR);
    if (minha !== geracao.current) return;
    await abrir();
  }, [abrir, pararLacos, rodar]);

  // Começo: espera as fotos decodificarem (sem animar camadas ainda invisíveis) e abre o pote.
  // Com "reduzir movimento", vai direto para o quadro parado.
  useEffect(() => {
    if (reduzir === null) return; // ainda não sabemos (primeira renderização)
    const minha = ++geracao.current;
    let cancelado = false;

    if (reduzir) {
      pararLacos();
      animar(QUADRO_PARADO);
      estado.current = "aberto";
    } else {
      const fotos = imagens.current.filter((img): img is HTMLImageElement => Boolean(img));
      void Promise.all(fotos.map((img) => img.decode().catch(() => undefined))).then(() => {
        if (!cancelado && minha === geracao.current && estado.current === "fechado") void abrir();
      });
    }

    return () => {
      cancelado = true;
      pararTudo();
    };
  }, [reduzir, abrir, animar, pararLacos, pararTudo]);

  // Foco num campo do formulário (no mesmo <main>) repete a cena, no máximo a cada 8 s.
  useEffect(() => {
    if (reduzir !== false) return;
    const pagina = escopo.current?.closest("main");
    if (!pagina) return;
    const aoFocar = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLInputElement) || e.target.type === "checkbox") return;
      if (pausadoPelaPessoa.current || !visivelRef.current || estado.current !== "aberto") return;
      if (performance.now() - fimUltima.current < INTERVALO_REPETICAO_MS) return;
      void repetir();
    };
    pagina.addEventListener("focusin", aoFocar);
    return () => pagina.removeEventListener("focusin", aoFocar);
  }, [reduzir, repetir, escopo]);

  // Fora da tela (rota escondida com display:none, aba de outra página): pausa tudo.
  useEffect(() => {
    visivelRef.current = visivel;
    const todos = [...ativos.current, ...lacos.current];
    if (visivel && !pausadoPelaPessoa.current) todos.forEach((c) => c.play());
    else todos.forEach((c) => c.pause());
  }, [visivel]);

  function alternarPausa(pausar: boolean) {
    pausadoPelaPessoa.current = pausar;
    const todos = [...ativos.current, ...lacos.current];
    if (pausar) todos.forEach((c) => c.pause());
    else if (visivelRef.current) todos.forEach((c) => c.play());
  }

  const recorteBoca = `${id}-boca`;
  const sombreadoBoca = `${id}-sombreado`;
  const madeira = `${id}-madeira`;
  const madeiraConcha = `${id}-concha`;
  const geleiaGota = `${id}-gota`;
  const recortePorcao = `${id}-porcao`;

  return (
    <>
      {/* No desktop a assinatura "Feito com amor, para você." fica embaixo do card: a cena para acima dela. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 bottom-0 grid place-items-center [container-type:size] lg:bottom-16">
        <div ref={escopo} className="relative aspect-[4/5] w-[min(100cqw,80cqh)] select-none">
          {/* Fundo: brilho, sombra no chão e a boca do pote (superfície da geleia, vista de cima). */}
          <svg viewBox={VIEWBOX} className="absolute inset-0 size-full" focusable="false">
            <defs>
              <radialGradient id={`${id}-brilho`}>
                <stop offset="0" stopColor="#E7B7B7" stopOpacity="0.45" />
                <stop offset="1" stopColor="#E7B7B7" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`${id}-sombra`}>
                <stop offset="0" stopColor="#6B1D2A" stopOpacity="0.32" />
                <stop offset="1" stopColor="#6B1D2A" stopOpacity="0" />
              </radialGradient>
              <clipPath id={recorteBoca}>
                <ellipse cx={BOCA.cx} cy={BOCA.cy} rx={BOCA.rx} ry={BOCA.ry} />
              </clipPath>
              <radialGradient id={sombreadoBoca} cx="0.5" cy="0.62" r="0.62">
                <stop offset="0.55" stopColor="#5a2e00" stopOpacity="0" />
                <stop offset="1" stopColor="#5a2e00" stopOpacity="0.55" />
              </radialGradient>
            </defs>
            <circle cx="383" cy="470" r="400" fill={`url(#${id}-brilho)`} />
            <ellipse cx="383" cy="786" rx="240" ry="20" fill={`url(#${id}-sombra)`} />
            <g clipPath={`url(#${recorteBoca})`}>
              {/* Polpa real (faixa da própria foto, achatada na perspectiva da boca). */}
              <image href="/login/superficie.webp" x={BOCA.cx - 200} y={BOCA.cy - 21} width="400" height="44" preserveAspectRatio="none" />
              <ellipse cx={BOCA.cx} cy={BOCA.cy} rx={BOCA.rx} ry={BOCA.ry} fill={`url(#${sombreadoBoca})`} />
              <ellipse cx="330" cy="252" rx="70" ry="4" fill="#fff" fillOpacity="0.3" />
            </g>
            {/* Aro de trás do vidro */}
            <path d={`M${BOCA.cx - 200} ${BOCA.cy}A200 22 0 0 1 ${BOCA.cx + 200} ${BOCA.cy}`} fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="3" />
          </svg>

          {/* Onda que a gota faz ao cair na geleia */}
          <div data-onda className="absolute inset-0 opacity-0" style={{ transformOrigin: origem(PONTA_GOTA.x, BOCA.cy + 3) }}>
            <svg viewBox={VIEWBOX} className="size-full" focusable="false">
              <ellipse cx={PONTA_GOTA.x} cy={BOCA.cy + 3} rx="40" ry="5" fill="none" stroke="#FFE2A8" strokeWidth="3" />
            </svg>
          </div>

          {/* Colher de pau (com a porção de geleia na concha, que aparece ao sair do pote) */}
          <div data-colher className="absolute inset-0 opacity-0" style={{ transformOrigin: origem(CONCHA.x, CONCHA.y) }}>
            <svg viewBox={VIEWBOX} className="size-full" focusable="false">
              <defs>
                {/* Sombreado cilíndrico da madeira: claro no alto, escuro na borda de baixo. */}
                <linearGradient id={madeira} x1="0" y1="-11" x2="0" y2="11" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#B98450" />
                  <stop offset="0.3" stopColor="#F3D6AC" />
                  <stop offset="0.65" stopColor="#D49F66" />
                  <stop offset="1" stopColor="#9A6533" />
                </linearGradient>
                <linearGradient id={`${madeira}-concha`} x1="0" y1="-36" x2="0" y2="36" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#C18D58" />
                  <stop offset="0.25" stopColor="#F0CFA0" />
                  <stop offset="0.7" stopColor="#CF9A60" />
                  <stop offset="1" stopColor="#94602F" />
                </linearGradient>
                <radialGradient id={madeiraConcha} cx="0.4" cy="0.35" r="0.8">
                  <stop offset="0" stopColor="#B98551" />
                  <stop offset="1" stopColor="#8E5C2E" />
                </radialGradient>
                <clipPath id={recortePorcao}>
                  <path d="M-48 2C-46-16-22-26 4-24 28-22 44-12 44 2 44 16 24 24 0 24-26 24-50 18-48 2Z" />
                </clipPath>
              </defs>
              <g transform={`translate(${CONCHA.x} ${CONCHA.y}) rotate(-50) scale(${ESCALA_COLHER})`}>
                {/* Cabo: afina até a ponta, com veios da madeira */}
                <path d="M50-11C150-10 330-9 470-7.5Q482 0 470 7.5C330 9 150 10 50 11Z" fill={`url(#${madeira})`} />
                <path d="M80-3C200-2.6 330-2 460-1.4M110 4C220 4.2 340 4 450 3.4M150-6.5C240-6.2 330-5.6 420-5" fill="none" stroke="#9C6A38" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
                {/* Concha */}
                <ellipse rx="58" ry="36" fill={`url(#${madeira}-concha)`} />
                <ellipse cx="-2" cy="1" rx="49" ry="29" fill={`url(#${madeiraConcha})`} />
                <ellipse cx="-14" cy="-12" rx="22" ry="5" fill="#fff" fillOpacity="0.18" />
                {/* Porção cremosa: a mesma polpa da foto, recortada no formato de um montinho */}
                <g data-porcao style={{ opacity: 0 }}>
                  <g clipPath={`url(#${recortePorcao})`}>
                    <rect x="-50" y="-26" width="96" height="52" fill="#D9921F" />
                    <image href="/login/superficie.webp" x="-60" y="-28" width="120" height="56" preserveAspectRatio="none" />
                  </g>
                  <path d="M-30-12C-14-20 10-20 26-12" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
                </g>
              </g>
            </svg>
          </div>

          {/* Gota que se forma na ponta da concha e cai de volta no pote */}
          <div data-gota className="absolute inset-0 opacity-0" style={{ transformOrigin: origem(PONTA_GOTA.x, PONTA_GOTA.y) }}>
            <svg viewBox={VIEWBOX} className="size-full" focusable="false">
              <defs>
                <radialGradient id={geleiaGota} cx="0.38" cy="0.6" r="0.7">
                  <stop offset="0" stopColor="#FFD27A" />
                  <stop offset="0.6" stopColor="#E7A12F" />
                  <stop offset="1" stopColor="#B26F10" />
                </radialGradient>
              </defs>
              <g transform={`translate(${PONTA_GOTA.x} ${PONTA_GOTA.y}) scale(1.6)`}>
                <path d="M0-4C3 2 8 7 8 12.5A8 8 0 0 1-8 12.5C-8 7-3 2 0-4Z" fill={`url(#${geleiaGota})`} />
                <ellipse cx="-2.5" cy="9" rx="2" ry="3" fill="#fff" fillOpacity="0.7" />
              </g>
            </svg>
          </div>

          {/* Pote (foto) e o gargalo que a tampa escondia (clonado da rosca da própria foto) */}
          <Image
            ref={(el) => {
              imagens.current[0] = el;
            }}
            src="/login/pote.webp"
            alt=""
            width={494}
            height={500}
            loading="eager"
            draggable={false}
            sizes="(min-width: 1024px) 340px, 60vw"
            className="absolute h-auto max-w-none"
            style={caixa(136, 281, 494)}
          />
          <Image
            src="/login/gargalo.webp"
            alt=""
            width={416}
            height={43}
            loading="eager"
            draggable={false}
            sizes="(min-width: 1024px) 290px, 50vw"
            className="absolute h-auto max-w-none"
            style={caixa(176, 250, 416)}
          />
          {/* Borda da frente da boca, por cima da colher (é ela que "esconde" a concha ao entrar) */}
          <svg viewBox={VIEWBOX} className="absolute inset-0 size-full" focusable="false">
            <path d={`M${BOCA.cx - 200} ${BOCA.cy}A200 22 0 0 0 ${BOCA.cx + 200} ${BOCA.cy}`} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="3" />
          </svg>

          {/* Tampa (foto) */}
          <div data-tampa className="absolute inset-0" style={{ transformOrigin: origem(CENTRO_TAMPA.x, CENTRO_TAMPA.y) }}>
            <Image
              ref={(el) => {
                imagens.current[1] = el;
              }}
              src="/login/tampa.webp"
              alt=""
              width={486}
              height={100}
              loading="eager"
              draggable={false}
              sizes="(min-width: 1024px) 340px, 60vw"
              className="absolute h-auto max-w-none"
              style={caixa(140, 188, 486)}
            />
          </div>
        </div>
      </div>

      {/* Pausa (WCAG 2.2.2): fora da área aria-hidden; some quando o sistema pede menos movimento. */}
      <label
        title="Pausar animação"
        className="absolute bottom-3 left-3 inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-accent2/70 bg-white/85 text-primaria shadow-sm transition-colors hover:bg-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-secundaria motion-reduce:hidden"
      >
        <input
          type="checkbox"
          aria-label="Pausar animação"
          className="peer sr-only"
          onChange={(e) => alternarPausa(e.currentTarget.checked)}
        />
        <svg viewBox="0 0 20 20" className="size-4 peer-checked:hidden" fill="currentColor" aria-hidden="true">
          <rect x="5" y="4" width="3.4" height="12" rx="1" />
          <rect x="11.6" y="4" width="3.4" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 20 20" className="hidden size-4 peer-checked:block" fill="currentColor" aria-hidden="true">
          <path d="M6.5 4.3v11.4a.8.8 0 0 0 1.2.7l9-5.7a.8.8 0 0 0 0-1.4l-9-5.7a.8.8 0 0 0-1.2.7Z" />
        </svg>
      </label>
    </>
  );
}
