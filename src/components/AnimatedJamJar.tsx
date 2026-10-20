"use client";

import Image from "next/image";
import {
  frame,
  useAnimate,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  type AnimationPlaybackControls,
  type AnimationSequence,
} from "framer-motion";
import { useCallback, useEffect, useId, useRef } from "react";
import { EVENTO_RESULTADO_LOGIN, type ResultadoLogin } from "@/components/login/eventos";

/*
 * Cena do card da direita do login: o pote real de Maracujá (foto recortada em camadas) abre
 * sozinho. A tampa desenrosca e sobe inclinada, uma colher de pau entra, tira geleia e uma gota
 * pinga de volta. Repete quando a pessoa foca um campo do formulário.
 *
 * Depois de aberto, o pote responde a quem está na tela:
 *   - o mouse sobre o card move as camadas em profundidades diferentes (colher mais, brilho
 *     menos), numa mola frouxa que passa do ponto e volta, como gelatina;
 *   - um clique/toque no pote (o cursor vira uma colher) faz ele chacoalhar e a geleia ondular;
 *   - o formulário avisa o resultado (login/eventos.ts): num erro o pote balança "não", num
 *     acerto dá um pulinho.
 * O "balanço" é feito nas camadas do corpo do pote (data-corpo), com origem no fundo dele. A
 * colher fica de fora (está "na mão"); a tampa só vai junto quando está no pote (data-acompanha).
 *
 * Camadas (de trás para a frente), todas no MESMO sistema de coordenadas da foto original
 * (fotos-originais/maracuja-125g.png, 768 px de largura), com a cena de x 0–768 e y −80–880:
 *   brilho, sombra → [corpo: boca (superfície da geleia), ondas] → colher → gota →
 *   [corpo: pote, gargalo, borda da frente] → tampa → área de toque (transparente)
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
/**
 * Paralaxe de uma camada: `--px`/`--py` (−1 a 1, posição do mouse no card) vezes a profundidade,
 * em % da camada. Usa a propriedade `translate`, que se soma ao `transform` das animações.
 */
const paralaxe = (profundidade: number) =>
  `calc(var(--px, 0) * ${-profundidade}%) calc(var(--py, 0) * ${-profundidade * 0.7}%)`;

// Boca do pote (elipse da superfície da geleia) e pontos da coreografia, medidos na foto.
const BOCA = { cx: 383, cy: 258, rx: 198, ry: 21 };
/**
 * Centro do fundo do pote, onde o pé de vidro encosta na mesa (y 782,5 no recorte, com a borda
 * macia até 783): origem do balanço do corpo (achata e estica a partir da mesa) e centro da sombra.
 */
const BASE_POTE = { x: 383, y: 783 };
/** Área do pote que responde ao clique/toque: do topo da tampa fechada até o fundo. */
const AREA_TOQUE = { x: 136, y: 188, largura: 494, altura: BASE_POTE.y - 188 };
/** Camadas do corpo do pote: balançam a partir do fundo e ficam no plano do meio do paralaxe. */
const ESTILO_CORPO = { transformOrigin: origem(BASE_POTE.x, BASE_POTE.y), translate: paralaxe(2) };
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

/**
 * Pose de repouso, aplicada na hora no começo da cena: tampa fechada, colher fora, sem gota nem
 * porção, corpo e sombra no lugar. Uma animação parada no meio (stop) congela o valor onde estava,
 * e ABRIR e QUADRO_PARADO não repõem tudo (o 1º trecho do ABRIR nem tem `x` da tampa).
 */
const POSE_REPOUSO: AnimationSequence = [
  ["[data-tampa]", { x: ux(0), y: uy(0), rotate: 0 }, { duration: 0 }],
  ["[data-colher]", { ...COLHER_FORA, opacity: 0 }, { duration: 0, at: 0 }],
  ["[data-porcao], [data-gota], [data-onda], [data-onda-toque]", { opacity: 0 }, { duration: 0, at: 0 }],
  ["[data-corpo], [data-acompanha]", { y: uy(0), rotate: 0, scaleX: 1, scaleY: 1 }, { duration: 0, at: 0 }],
  ["[data-sombra]", { scaleX: 1, opacity: 1 }, { duration: 0, at: 0 }],
];

/*
 * Reações do pote (clique, erro, acerto). Podem vir em qualquer fase da coreografia, então o
 * alvo muda: com o pote aberto, só o corpo balança (a tampa flutua à parte); com a tampa no pote
 * (ou a caminho), ela vai junto pelo invólucro data-acompanha — senão abriria uma fresta entre os dois.
 */
const CORPO = "[data-corpo]";
const CORPO_E_TAMPA = "[data-corpo], [data-acompanha]";
const alvoDoBalanco = (estado: Estado) => (estado === "aberto" ? CORPO : CORPO_E_TAMPA);

/** Clique/toque no pote: ele achata, estica e assenta como gelatina, e a superfície ondula. */
const chacoalhar = (alvo: string): AnimationSequence => [
  [alvo, { scaleX: [1, 1.06, 0.96, 1.025, 0.99, 1], scaleY: [1, 0.93, 1.05, 0.98, 1.01, 1] }, { duration: 0.85, ease: "easeInOut" }],
  ["[data-sombra]", { scaleX: [1, 1.07, 0.96, 1.02, 1] }, { duration: 0.85, ease: "easeInOut", at: 0 }],
  ["[data-onda-toque]", { opacity: [0.9, 0], scale: [0.3, 1.2] }, { duration: 0.8, ease: "easeOut", at: 0.1 }],
];

/** Erro no login: o pote balança "não" (gira um pouco para cada lado, a partir do fundo). */
const negar = (alvo: string): AnimationSequence => [
  [alvo, { rotate: [0, -4, 3.5, -2.5, 1.2, 0] }, { duration: 0.75, ease: "easeInOut" }],
  ["[data-sombra]", { scaleX: [1, 0.97, 1.02, 0.99, 1] }, { duration: 0.75, ease: "easeInOut", at: 0 }],
];

/** Login certo: o pote agacha, pula e assenta (a sombra encolhe enquanto ele está no ar). */
const MOMENTOS_PULO = [0, 0.18, 0.5, 0.78, 1];
const comemorar = (alvo: string): AnimationSequence => [
  [
    alvo,
    { y: [uy(0), uy(6), uy(-46), uy(0), uy(0)], scaleX: [1, 1.05, 0.96, 1.06, 1], scaleY: [1, 0.94, 1.05, 0.92, 1] },
    { duration: 0.8, times: MOMENTOS_PULO, ease: "easeInOut" },
  ],
  ["[data-sombra]", { scaleX: [1, 1.04, 0.78, 1.06, 1], opacity: [1, 1, 0.55, 1, 1] }, { duration: 0.8, times: MOMENTOS_PULO, ease: "easeInOut", at: 0 }],
];

/** Mola do paralaxe: frouxa de propósito (passa do ponto e volta), para o pote "tremelicar". */
const MOLA_PARALAXE = { stiffness: 140, damping: 11, mass: 0.7 };

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
 * Pausado ou com menos movimento, o pote também deixa de reagir ao mouse, ao toque e ao formulário.
 */
export function AnimatedJamJar() {
  const [escopo, animar] = useAnimate<HTMLDivElement>();
  const reduzir = useReducedMotion();
  const visivel = useInView(escopo);
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);

  // Paralaxe: o alvo segue o mouse; a mola leva até lá e escreve --px/--py na cena.
  const alvoX = useMotionValue(0);
  const alvoY = useMotionValue(0);
  const molaX = useSpring(alvoX, MOLA_PARALAXE);
  const molaY = useSpring(alvoY, MOLA_PARALAXE);
  useMotionValueEvent(molaX, "change", (v) => escopo.current?.style.setProperty("--px", v.toFixed(3)));
  useMotionValueEvent(molaY, "change", (v) => escopo.current?.style.setProperty("--py", v.toFixed(3)));

  const estado = useRef<Estado>("fechado");
  const geracao = useRef(0); // muda ao desmontar: coreografias em andamento param no próximo passo
  const ativos = useRef(new Set<AnimationPlaybackControls>());
  const lacos = useRef(new Set<AnimationPlaybackControls>());
  const pausadoPelaPessoa = useRef(false);
  const visivelRef = useRef(false);
  const fimUltima = useRef(0);
  const imagens = useRef<(HTMLImageElement | null)[]>([]);
  const reacao = useRef<AnimationPlaybackControls | null>(null);

  /** Roda uma sequência da coreografia registrando os controles (para pausar/cancelar). */
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

  /**
   * Reação a um toque ou ao formulário (chacoalhar, negar, comemorar). Dura menos de 1 s e quem
   * dispara é a pessoa, então fica FORA dos conjuntos pausáveis: no framer-motion 13 uma animação
   * interrompida (stop, ou outra no mesmo valor) nunca resolve a promise, e um pause() depois disso
   * reaplica o 1º quadro da Web Animation cancelada (os anéis da ondulação ficavam congelados).
   * Uma reação nova termina a anterior na hora (complete leva ao fim, que é a pose de repouso).
   */
  const reagir = useCallback(
    (sequencia: AnimationSequence) => {
      reacao.current?.complete();
      const controles = animar(sequencia);
      reacao.current = controles;
      void controles.then(() => {
        if (reacao.current === controles) reacao.current = null;
      });
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

  // Começo (e volta à rota, que reexecuta os efeitos): repõe a pose de repouso, espera as fotos
  // decodificarem (sem animar camadas ainda invisíveis) e abre o pote. Com "reduzir movimento",
  // vai direto para o quadro parado.
  useEffect(() => {
    if (reduzir === null) return; // ainda não sabemos (primeira renderização)
    const minha = ++geracao.current;
    let cancelado = false;

    // Web Animations "zumbis" (paradas no meio, que um pause() reacenderia) saem de cena.
    escopo.current?.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    reacao.current = null;
    animar(POSE_REPOUSO);

    if (reduzir) {
      pararLacos();
      animar(QUADRO_PARADO);
      estado.current = "aberto";
    } else {
      const fotos = imagens.current.filter((img): img is HTMLImageElement => Boolean(img));
      // A pose com duração 0 só é escrita no próximo quadro do framer-motion: o ABRIR espera esse
      // quadro, senão leria o x da tampa ainda fora do lugar.
      const poseAplicada = new Promise<void>((pronto) => frame.postRender(() => pronto()));
      void Promise.all([poseAplicada, ...fotos.map((img) => img.decode().catch(() => undefined))]).then(() => {
        if (!cancelado && minha === geracao.current && estado.current === "fechado") void abrir();
      });
    }

    return () => {
      cancelado = true;
      pararTudo();
    };
  }, [reduzir, abrir, animar, pararLacos, pararTudo, escopo]);

  // Formulário no mesmo <main>: o foco num campo repete a cena (no máximo a cada 8 s) e o
  // resultado do envio faz o pote reagir (balança "não" no erro, pula no acerto).
  useEffect(() => {
    if (reduzir !== false) return;
    const pagina = escopo.current?.closest("main");
    if (!pagina) return;
    const podeReagir = () => !pausadoPelaPessoa.current && visivelRef.current;
    const aoFocar = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLInputElement) || e.target.type === "checkbox") return;
      if (!podeReagir() || estado.current !== "aberto") return;
      if (performance.now() - fimUltima.current < INTERVALO_REPETICAO_MS) return;
      void repetir();
    };
    // Reage mesmo no meio da repetição (quem digita rápido envia antes de o pote reabrir).
    const aoResultado = (e: Event) => {
      if (!podeReagir()) return;
      const resultado = (e as CustomEvent<ResultadoLogin>).detail;
      reagir((resultado === "erro" ? negar : comemorar)(alvoDoBalanco(estado.current)));
    };
    pagina.addEventListener("focusin", aoFocar);
    pagina.addEventListener(EVENTO_RESULTADO_LOGIN, aoResultado);
    return () => {
      pagina.removeEventListener("focusin", aoFocar);
      pagina.removeEventListener(EVENTO_RESULTADO_LOGIN, aoResultado);
    };
  }, [reduzir, repetir, reagir, escopo]);

  // Paralaxe pelo mouse sobre o card inteiro (no toque não há "passar por cima": fica parado).
  useEffect(() => {
    if (reduzir !== false) return;
    const cartao = raiz.current?.parentElement;
    // A cena é guardada aqui: quando a rota é escondida, o React solta o ref antes da limpeza.
    const cena = escopo.current;
    if (!cartao || !cena) return;
    const limitar = (v: number) => Math.max(-1, Math.min(1, v));
    const aoMover = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || pausadoPelaPessoa.current) return;
      const r = cartao.getBoundingClientRect();
      alvoX.set(limitar(((e.clientX - r.left) / r.width) * 2 - 1));
      alvoY.set(limitar(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const aoSair = () => {
      alvoX.set(0);
      alvoY.set(0);
    };
    cartao.addEventListener("pointermove", aoMover);
    cartao.addEventListener("pointerleave", aoSair);
    return () => {
      cartao.removeEventListener("pointermove", aoMover);
      cartao.removeEventListener("pointerleave", aoSair);
      // Volta ao centro na hora (sem a mola, que escreveria num ref já solto).
      aoSair();
      molaX.jump(0);
      molaY.jump(0);
      cena.style.setProperty("--px", "0");
      cena.style.setProperty("--py", "0");
    };
  }, [reduzir, alvoX, alvoY, molaX, molaY, escopo]);

  /**
   * Clique/toque no pote: chacoalha como gelatina. É `click`, não `pointerdown`: no celular o
   * pointerdown dispara antes de o navegador decidir que o gesto é rolagem (e no mouse viria até
   * do botão direito e do meio).
   */
  function cutucar() {
    if (reduzir !== false || pausadoPelaPessoa.current) return;
    reagir(chacoalhar(alvoDoBalanco(estado.current)));
  }

  // Fora da tela (rota escondida com display:none, aba de outra página): pausa a coreografia e os
  // laços. As reações (menos de 1 s) não entram aqui: terminam sozinhas, na pose de repouso.
  useEffect(() => {
    visivelRef.current = visivel;
    const todos = [...ativos.current, ...lacos.current];
    if (visivel && !pausadoPelaPessoa.current) todos.forEach((c) => c.play());
    else todos.forEach((c) => c.pause());
  }, [visivel]);

  function alternarPausa(pausar: boolean) {
    pausadoPelaPessoa.current = pausar;
    const todos = [...ativos.current, ...lacos.current];
    // Pausado, o pote não responde ao clique: o cursor de colher some (globals.css).
    raiz.current?.toggleAttribute("data-pausado", pausar);
    if (pausar) {
      todos.forEach((c) => c.pause());
      // Pausar é parar tudo, inclusive o paralaxe: volta ao centro sem a mola.
      alvoX.set(0);
      alvoY.set(0);
      molaX.jump(0);
      molaY.jump(0);
    } else if (visivelRef.current) todos.forEach((c) => c.play());
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
      <div
        ref={raiz}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 bottom-0 grid place-items-center [container-type:size] lg:bottom-16"
      >
        <div ref={escopo} className="relative aspect-[4/5] w-[min(100cqw,80cqh)] select-none">
          {/* Fundo: brilho atrás do pote e sombra no chão (a sombra encolhe quando o pote pula). */}
          <svg viewBox={VIEWBOX} className="absolute inset-0 size-full" style={{ translate: paralaxe(1) }} focusable="false">
            <defs>
              <radialGradient id={`${id}-brilho`}>
                <stop offset="0" stopColor="#E7B7B7" stopOpacity="0.45" />
                <stop offset="1" stopColor="#E7B7B7" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`${id}-sombra`}>
                <stop offset="0" stopColor="#6B1D2A" stopOpacity="0.32" />
                <stop offset="1" stopColor="#6B1D2A" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="383" cy="470" r="400" fill={`url(#${id}-brilho)`} />
          </svg>
          <div data-sombra className="absolute inset-0" style={{ transformOrigin: origem(BASE_POTE.x, BASE_POTE.y), translate: paralaxe(2) }}>
            <svg viewBox={VIEWBOX} className="size-full" focusable="false">
              <ellipse cx={BASE_POTE.x} cy={BASE_POTE.y} rx="240" ry="20" fill={`url(#${id}-sombra)`} />
            </svg>
          </div>

          {/* Corpo, parte de trás: a boca do pote (superfície da geleia, vista de cima) e as ondas nela. */}
          <div data-corpo className="absolute inset-0" style={ESTILO_CORPO}>
            <svg viewBox={VIEWBOX} className="absolute inset-0 size-full" focusable="false">
              <defs>
                <clipPath id={recorteBoca}>
                  <ellipse cx={BOCA.cx} cy={BOCA.cy} rx={BOCA.rx} ry={BOCA.ry} />
                </clipPath>
                <radialGradient id={sombreadoBoca} cx="0.5" cy="0.62" r="0.62">
                  <stop offset="0.55" stopColor="#5a2e00" stopOpacity="0" />
                  <stop offset="1" stopColor="#5a2e00" stopOpacity="0.55" />
                </radialGradient>
              </defs>
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

            {/* Ondulação do toque: dois anéis concêntricos que se abrem na superfície inteira */}
            <div data-onda-toque className="absolute inset-0 opacity-0" style={{ transformOrigin: origem(BOCA.cx, BOCA.cy) }}>
              <svg viewBox={VIEWBOX} className="size-full" focusable="false">
                <ellipse cx={BOCA.cx} cy={BOCA.cy} rx="150" ry="14" fill="none" stroke="#FFE2A8" strokeWidth="3" />
                <ellipse cx={BOCA.cx} cy={BOCA.cy} rx="88" ry="8" fill="none" stroke="#FFE2A8" strokeWidth="2.5" />
              </svg>
            </div>
          </div>

          {/* Colher de pau (com a porção de geleia na concha, que aparece ao sair do pote) */}
          <div data-colher className="absolute inset-0 opacity-0" style={{ transformOrigin: origem(CONCHA.x, CONCHA.y), translate: paralaxe(3) }}>
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
          <div data-gota className="absolute inset-0 opacity-0" style={{ transformOrigin: origem(PONTA_GOTA.x, PONTA_GOTA.y), translate: paralaxe(3) }}>
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

          {/* Corpo, parte da frente: o pote (foto) e o gargalo que a tampa escondia (clonado da rosca da própria foto) */}
          <div data-corpo className="absolute inset-0" style={ESTILO_CORPO}>
            <Image
              ref={(el) => {
                imagens.current[0] = el;
              }}
              src="/login/pote.webp"
              alt=""
              width={494}
              height={505}
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
          </div>

          {/* Tampa (foto). O invólucro acompanha o balanço do corpo quando ela está no pote e fica no
              mesmo plano do paralaxe (fechada, não pode desencaixar do gargalo). */}
          <div data-acompanha className="absolute inset-0" style={ESTILO_CORPO}>
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

          {/* Onde o pote responde ao clique/toque; no mouse, o cursor vira uma colher de pau. */}
          <div
            className="cursor-colher pointer-events-auto absolute touch-manipulation"
            style={{ ...caixa(AREA_TOQUE.x, AREA_TOQUE.y, AREA_TOQUE.largura), height: `${(AREA_TOQUE.altura / VH) * 100}%` }}
            onClick={cutucar}
          />
        </div>
      </div>

      {/* Pausa (WCAG 2.2.2): fora da área aria-hidden; some quando o sistema pede menos movimento.
          z-10: no desktop a assinatura do card (largura toda, logo depois na página) cobria o botão
          e o clique do mouse caía nela. */}
      <label
        title="Pausar animação"
        className="absolute bottom-3 left-3 z-10 inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-accent2/70 bg-white/85 text-primaria shadow-sm transition-colors hover:bg-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-secundaria motion-reduce:hidden"
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
