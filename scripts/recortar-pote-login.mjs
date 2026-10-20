// Recorta a foto real do pote de Maracujá em camadas com transparência, para a cena do login
// (src/components/AnimatedJamJar.tsx, que usa as MESMAS coordenadas da foto original):
//   tampa.webp:      a tampa dourada (com o pedaço do lacre que está sobre ela)
//   pote.webp:       o pote sem a tampa (gargalo, rótulo, geleia e base)
//   gargalo.webp:    a rosca que a tampa escondia (clonada da rosca visível, cortada no arco da boca)
//   superficie.webp: polpa com sementes, achatada na perspectiva da boca (e usada na colher)
// Fundo da foto liso (≈229,230,233) até y≈615: ali a silhueta sai da diferença para o fundo, linha a
// linha. Abaixo aparece o suporte branco com frisos atrás do pote (com a sombra dele à esquerda e
// reflexos alaranjados da geleia): ali a borda é uma curva simétrica medida na foto (CONTORNO_BASE),
// do corpo até o pé de vidro encostar no suporte. No pote, o contorno inteiro vira um polígono e o
// alfa sai da distância de cada pixel a ele (veja "Pote", mais abaixo).
// Se trocar a foto, refaça as medidas e as coordenadas da cena.
// Uso (na raiz do projeto): node scripts/recortar-pote-login.mjs fotos-originais/maracuja-125g.png public/login
import path from "node:path";
import sharp from "sharp";

const [foto, saida] = process.argv.slice(2);

const { data, info } = await sharp(foto).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const CX = 383; // eixo do pote (média das bordas da tampa e do corpo)
const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };

function fundoDaLinha(y) {
  const a = [];
  for (let x = 12; x < 32; x++) a.push(px(x, y));
  for (let x = W - 32; x < W - 12; x++) a.push(px(x, y));
  return [0, 1, 2].map((c) => a.reduce((s, p) => s + p[c], 0) / a.length);
}

/** Bordas [esq, dir] do objeto na linha y (diferença para o fundo acima do limiar). */
function bordasPorDiferenca(y, limiar) {
  const f = fundoDaLinha(y);
  let e = -1, d = -1;
  for (let x = 40; x < W - 40; x++) {
    const p = px(x, y);
    if (Math.abs(p[0] - f[0]) + Math.abs(p[1] - f[1]) + Math.abs(p[2] - f[2]) > limiar) {
      if (e < 0) e = x;
      d = x;
    }
  }
  return e < 0 ? null : [e, d];
}

/** Máscara (0–255) de uma faixa de linhas, preenchendo entre as bordas de cada linha. */
function mascara(y0, y1, bordas) {
  const m = Buffer.alloc(W * H, 0);
  for (let y = y0; y <= y1; y++) {
    const b = bordas(y);
    if (!b) continue;
    const [e, d] = b;
    for (let x = Math.ceil(e); x <= Math.floor(d); x++) m[y * W + x] = 255;
    // Meio pixel de borda proporcional (anti-serrilhado das bordas fracionárias do modelo).
    const fe = Math.ceil(e) - e, fd = d - Math.floor(d);
    if (fe > 0 && Math.ceil(e) - 1 >= 0) m[y * W + Math.ceil(e) - 1] = Math.round(255 * fe);
    if (fd > 0 && Math.floor(d) + 1 < W) m[y * W + Math.floor(d) + 1] = Math.round(255 * fd);
  }
  return m;
}

// Tampa: y 192–285 (passa 2 px da borda de baixo, que fica por cima do pote quando fechada).
const LIMITE_TAMPA = 285;
const mTampa = mascara(192, LIMITE_TAMPA, (y) => bordasPorDiferenca(y, 30));

/** Grava a caixa de uma imagem RGBA do tamanho da foto. */
async function gravar(rgba, caixa, nome) {
  const arquivo = path.join(saida, nome);
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract(caixa)
    .webp({ quality: 86, alphaQuality: 90, effort: 6 })
    .toFile(arquivo);
  const meta = await sharp(arquivo).metadata();
  console.log(nome, caixa, `${meta.width}x${meta.height}`);
}

async function exportar(m, caixa, nome) {
  // Desfoca a máscara de leve: borda macia, sem degraus nem halo duro do fundo cinza.
  // b-w: sem isso o sharp devolve 3 canais e o índice do alfa cai na linha errada.
  const alfa = await sharp(m, { raw: { width: W, height: H, channels: 1 } }).blur(0.6).toColourspace("b-w").raw().toBuffer();
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = data[i * 3];
    rgba[i * 4 + 1] = data[i * 3 + 1];
    rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = alfa[i];
  }
  await gravar(rgba, caixa, nome);
}

// Caixas com folga de 4 px; as coordenadas entram no SVG da cena (mesmo sistema da foto).
await exportar(mTampa, { left: 140, top: 188, width: 486, height: LIMITE_TAMPA - 188 + 3 }, "tampa.webp");

/*
 * Pote: do gargalo (y 283, coberto pela tampa ou pela rosca) até o pé de vidro.
 *
 * Laterais até y 615 (fundo liso): borda subpixel, linha a linha, onde a diferença para o fundo
 * logo ao lado chega à metade da do vidro logo para dentro. (O limiar fixo de 45 sozinho pegava
 * 1–2 px de fundo cinza a mais, uma franja clara em volta do pote.)
 */
const TOPO_POTE = 283;
const FIM_FUNDO_LISO = 615;

function bordasSubpixel(y) {
  const b = bordasPorDiferenca(y, 45);
  if (!b || b[1] - b[0] < 300) throw new Error(`linha ${y}: borda do pote não encontrada (a foto mudou? refaça as medidas)`);
  const lado = (x0, passo) => {
    // Fundo local (8–16 px para fora) e nível do vidro (maior diferença nos 4 px para dentro).
    const f = [0, 1, 2].map((c) => {
      let s = 0;
      for (let k = 8; k <= 16; k++) s += px(x0 - passo * k, y)[c];
      return s / 9;
    });
    const dif = (x) => { const p = px(x, y); return Math.abs(p[0] - f[0]) + Math.abs(p[1] - f[1]) + Math.abs(p[2] - f[2]); };
    const alvo = Math.max(...[0, 1, 2, 3].map((k) => dif(x0 + passo * k))) / 2;
    let x = x0 - 3 * passo;
    while (dif(x) < alvo) x += passo;
    const antes = dif(x - passo);
    return x - passo + (passo * (alvo - antes)) / (dif(x) - antes);
  };
  return [lado(b[0], 1), lado(b[1], -1)];
}

const medidas = [];
for (let y = TOPO_POTE; y <= FIM_FUNDO_LISO; y++) medidas.push(bordasSubpixel(y));
// Média móvel 1-2-1 entre linhas vizinhas: tira o tremido de décimos de pixel da medida.
const lateral = medidas.map((m, i) => {
  const a = medidas[Math.max(0, i - 1)], c = medidas[Math.min(medidas.length - 1, i + 1)];
  return [0, 1].map((k) => (a[k] + 2 * m[k] + c[k]) / 4);
});

/**
 * Borda de y 616 até o fundo, como [meia-largura em torno de CX, y] do lado direito; o esquerdo é o
 * espelho. Medida no lado direito, iluminado e limpo (à esquerda o suporte está na sombra do pote):
 *   - corpo e anel da base (y 616–700): meio do degrau de luminância entre o suporte e o vidro,
 *     linha a linha (os dois lados batem em ±1 px);
 *   - canto e fundo: onde a razão azul/vermelho cruza 0,6 (a geleia âmbar quase não tem azul; o
 *     suporte tem, mesmo com o reflexo laranja), linha a linha no canto e coluna a coluna no fundo;
 *   - no eixo, o topo dos frisos claros, onde o vidro encosta no suporte (y 782,5). A faixa escura
 *     com "dentes" logo abaixo já é o suporte na sombra do pote, não vidro.
 * Os frisos fazem degraus de ±2 px nas medidas: os pontos são a envoltória convexa delas, suavizada.
 * Entre os pontos, spline Catmull-Rom centrípeta (passa por todos, sem bicos nem laçadas).
 */
const CONTORNO_BASE = [
  [238, 616], [238, 640], [238, 661], [238.8, 666], [240.7, 669.5], [241.3, 674], [240.8, 683],
  [239.7, 693], [237.4, 703], [232.6, 712.5], [225.2, 720], [217.2, 727.4], [209.7, 734.1],
  [202.2, 740.8], [194.7, 747.5], [187.2, 754.1], [177.8, 759.8], [168.4, 763.7], [158.9, 767.4],
  [149, 770.2], [139, 772.6], [129, 774.7], [119, 776.4], [109, 777.9], [99, 779.2], [89, 780.4],
  [79, 781.1], [69, 781.4], [59, 781.7], [49, 782.1], [39, 782.3], [29, 782.4], [19, 782.5],
  [9, 782.5], [0, 782.5],
];
const FUNDO_POTE = CONTORNO_BASE.at(-1)[1];

/** Spline Catmull-Rom centrípeta entre p[1] e p[n-2] (as pontas só dão a direção). */
function catmullRom(p, porTrecho = 8) {
  const passo = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const mistura = (a, b, ta, tb, u) => [0, 1].map((c) => (a[c] * (tb - u) + b[c] * (u - ta)) / (tb - ta));
  const saida = [];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const t1 = passo(p0, p1), t2 = t1 + passo(p1, p2), t3 = t2 + passo(p2, p3);
    for (let j = 0; j < porTrecho; j++) {
      const u = t1 + ((t2 - t1) * j) / porTrecho;
      const a1 = mistura(p0, p1, 0, t1, u), a2 = mistura(p1, p2, t1, t2, u), a3 = mistura(p2, p3, t2, t3, u);
      saida.push(mistura(mistura(a1, a2, 0, t2, u), mistura(a2, a3, t1, t3, u), t1, t2, u));
    }
  }
  saida.push(p.at(-2));
  return saida;
}

// Contorno aberto (a linha de cima, y 283, fica reta e sem degradê, escondida pela rosca):
// lateral esquerda descendo, base da esquerda para a direita, lateral direita subindo.
const cadeiaBase = [
  [CX - 238, FIM_FUNDO_LISO - 15], // ponta: só dá a direção (lateral reta)
  ...CONTORNO_BASE.map(([dx, y]) => [CX - dx, y]),
  ...CONTORNO_BASE.slice(0, -1).reverse().map(([dx, y]) => [CX + dx, y]),
  [CX + 238, FIM_FUNDO_LISO - 15],
];
const contorno = [
  ...lateral.map(([e], i) => [e, TOPO_POTE + i]),
  ...catmullRom(cadeiaBase),
  ...lateral.map(([, d], i) => [d, TOPO_POTE + i]).reverse(),
];

/**
 * Largura (px) do degradê do alfa: 1,5 nas laterais (a borda da própria foto tem ~2 px) e 2,6 de
 * y 770 para baixo, onde o vidro assenta no suporte.
 */
const suave = (t) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
const larguraBorda = (y) => 1.5 + 1.1 * suave((y - 700) / 70);
/** De quantos px para dentro vem a cor da borda: no fundo, acima da ponta dos frisos claros. */
const recuoCor = (y) => larguraBorda(y) / 2 + 1 + 1.5 * suave((y - 700) / 70);

/**
 * Alfa pela distância com sinal ao contorno (negativa dentro): 50% em cima da linha, indo de 1 a 0
 * na largura da borda. Na faixa da borda a cor vem de um ponto um pouco para dentro (na normal),
 * então o degradê é do próprio vidro/geleia, sem franja cinza do fundo nem pedaços do suporte.
 */
function recortarPote() {
  const RAIO = 6, CEL = 8;
  // Trechos do contorno em células de 8 px, para buscar só os próximos de cada pixel.
  const celulas = new Map();
  for (let i = 0; i < contorno.length - 1; i++) {
    const [ax, ay] = contorno[i], [bx, by] = contorno[i + 1];
    for (let cy = Math.floor((Math.min(ay, by) - RAIO) / CEL); cy <= Math.floor((Math.max(ay, by) + RAIO) / CEL); cy++)
      for (let cx = Math.floor((Math.min(ax, bx) - RAIO) / CEL); cx <= Math.floor((Math.max(ax, bx) + RAIO) / CEL); cx++) {
        const k = cy * 1000 + cx;
        if (!celulas.has(k)) celulas.set(k, []);
        celulas.get(k).push(i);
      }
  }
  // Polígono fechado (com a linha de cima), para saber o que fica dentro em cada linha.
  const fechado = [...contorno, contorno[0]];
  const amostra = (x, y) => {
    // Bilinear na foto.
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
    return [0, 1, 2].map((k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy);
  };

  const rgba = Buffer.alloc(W * H * 4);
  let ultima = 0;
  const yMax = Math.ceil(FUNDO_POTE + RAIO);
  for (let y = TOPO_POTE; y <= yMax; y++) {
    // Onde o polígono cruza a linha: entre um par de cruzamentos é dentro.
    const xs = [];
    for (let i = 0; i < fechado.length - 1; i++) {
      const [ax, ay] = fechado[i], [bx, by] = fechado[i + 1];
      if ((ay <= y && y < by) || (by <= y && y < ay)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    const estaDentro = (x) => { let n = 0; for (const v of xs) if (v < x) n++; return n % 2 === 1; };
    for (let x = 0; x < W; x++) {
      const lista = celulas.get(Math.floor(y / CEL) * 1000 + Math.floor(x / CEL));
      let dist = Infinity, nx = 0, ny = 0;
      for (const i of lista ?? []) {
        const [ax, ay] = contorno[i], [bx, by] = contorno[i + 1];
        const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
        const d = Math.hypot(x - ax - t * vx, y - ay - t * vy);
        if (d < dist) { dist = d; const l = Math.sqrt(l2); nx = -vy / l; ny = vx / l; } // normal para fora
      }
      const ehDentro = estaDentro(x);
      let alfa, cor;
      if (dist > RAIO) {
        if (!ehDentro) continue;
        alfa = 1;
        cor = px(x, y);
      } else {
        const sd = ehDentro ? -dist : dist, w = larguraBorda(y);
        alfa = Math.min(1, Math.max(0, 0.5 - sd / w));
        if (alfa <= 0) continue;
        const k = recuoCor(y);
        const original = px(x, y);
        if (sd <= -k) cor = original;
        else {
          const recuo = sd + k;
          const dentroCor = amostra(x - nx * recuo, y - ny * recuo);
          const t = suave((sd + k) / k);
          cor = original.map((v, c) => v * (1 - t) + dentroCor[c] * t);
        }
      }
      const o = (y * W + x) * 4;
      rgba[o] = Math.round(cor[0]);
      rgba[o + 1] = Math.round(cor[1]);
      rgba[o + 2] = Math.round(cor[2]);
      rgba[o + 3] = Math.round(255 * alfa);
      ultima = Math.max(ultima, y);
    }
  }
  return { rgba, ultima };
}

const pote = recortarPote();
await gravar(pote.rgba, { left: 136, top: 281, width: 494, height: pote.ultima + 3 - 281 }, "pote.webp");
console.log(`pote: fundo no eixo em y ${FUNDO_POTE} (BASE_POTE da cena), última linha com alfa ${pote.ultima}`);

/**
 * Gargalo (rosca) que a tampa escondia: quando ela sobe, a boca do pote precisa aparecer. Em vez
 * de desenhar, clona a faixa de rosca logo abaixo da tampa (y 286–324, vidro com geleia atrás) e
 * a sobe 34 px, cortando o topo no arco da frente da boca (elipse cx 383, cy 258, rx 200, ry 22).
 */
export const BOCA = { cx: 383, cy: 258, rx: 200, ry: 22 };
{
  const DESLOCAMENTO = 34, TOPO = 250, BASE = 292;
  const rgba = Buffer.alloc(W * H * 4);
  for (let yd = TOPO; yd <= BASE; yd++) {
    const ys = yd + DESLOCAMENTO;
    const b = bordasPorDiferenca(ys, 45);
    if (!b) continue;
    const [e, d] = b;
    for (let x = e; x <= d; x++) {
      const u = (x - BOCA.cx) / BOCA.rx;
      if (Math.abs(u) > 1) continue;
      const labio = BOCA.cy + BOCA.ry * Math.sqrt(1 - u * u);
      // Anti-serrilhado do arco: alfa proporcional ao quanto o pixel passa do lábio.
      const cobertura = Math.min(1, Math.max(0, yd + 1 - labio));
      if (cobertura <= 0) continue;
      const i = (ys * W + x) * 3, o = (yd * W + x) * 4;
      rgba[o] = data[i];
      rgba[o + 1] = data[i + 1];
      rgba[o + 2] = data[i + 2];
      rgba[o + 3] = Math.round(255 * cobertura);
    }
  }
  const caixa = { left: 176, top: TOPO, width: 416, height: BASE - TOPO + 1 };
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract(caixa)
    .webp({ quality: 86, alphaQuality: 90, effort: 6 })
    .toFile(path.join(saida, "gargalo.webp"));
  console.log("gargalo.webp", caixa);
}

/**
 * Superfície da geleia vista pela boca: a polpa com sementes da faixa abaixo do rótulo
 * (x 200–566, y 688–752; o rótulo termina em y≈680), achatada na perspectiva da boca (400 × 44). Sem recorte: a cena aplica
 * o clipPath elíptico e o sombreado por cima.
 */
await sharp(foto)
  .extract({ left: 200, top: 688, width: 366, height: 64 })
  .resize(400, 44, { fit: "fill" })
  .modulate({ brightness: 1.06, saturation: 1.05 })
  .webp({ quality: 84 })
  .toFile(path.join(saida, "superficie.webp"));
console.log("superficie.webp 400x44");
