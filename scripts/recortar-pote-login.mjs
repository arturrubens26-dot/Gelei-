// Recorta a foto real do pote de Maracujá em camadas com transparência, para a cena do login
// (src/components/AnimatedJamJar.tsx, que usa as MESMAS coordenadas da foto original):
//   tampa.webp:      a tampa dourada (com o pedaço do lacre que está sobre ela)
//   pote.webp:       o pote sem a tampa (gargalo, rótulo, geleia e base)
//   gargalo.webp:    a rosca que a tampa escondia (clonada da rosca visível, cortada no arco da boca)
//   superficie.webp: polpa com sementes, achatada na perspectiva da boca (e usada na colher)
// Fundo da foto liso (≈229,230,233) até y≈616: a silhueta sai da diferença para o fundo, linha a linha.
// Abaixo disso aparece a base com frisos atrás do pote: ali a borda vem de um contorno simétrico
// medido na foto (CONTORNO_BASE). Se trocar a foto, refaça as medidas e as coordenadas da cena.
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

/**
 * Lateral do corpo abaixo de y=616 (sem fundo liso): meia-largura medida na borda da geleia, linha
 * a linha, mais ~4 px de parede de vidro. Entre os pontos, interpolação linear.
 */
const CONTORNO_BASE = [
  [616, 239.5], [680, 241], [700, 239], [712, 233], [720, 226], [728, 216], [736, 207],
  [744, 203], [752, 199], [760, 190], [768, 180], [774, 172], [778, 165],
];
const FIM_POTE = 778;
function bordaModelo(y) {
  if (y > FIM_POTE) return null;
  let meiaLargura = CONTORNO_BASE[0][1];
  for (let i = 1; i < CONTORNO_BASE.length; i++) {
    const [y0, m0] = CONTORNO_BASE[i - 1], [y1, m1] = CONTORNO_BASE[i];
    if (y <= y1) {
      meiaLargura = y <= y0 ? m0 : m0 + ((m1 - m0) * (y - y0)) / (y1 - y0);
      break;
    }
  }
  return [CX - meiaLargura, CX + meiaLargura];
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
// (Tentei a largura da geleia pela saturação na base: o reflexo laranja na base branca alargava
// as últimas linhas. O contorno modelado, medido na foto, ficou mais limpo.)
const ULTIMA_LINHA = FIM_POTE;

// Pote: do gargalo (y 283) à base. Até 616 pela diferença; depois pelo contorno modelado.
const mPote = mascara(283, ULTIMA_LINHA, (y) => {
  if (y <= 616) {
    const b = bordasPorDiferenca(y, 45);
    // Sem fundo liso o bastante a linha falha: usa a lateral reta do corpo.
    return b && b[1] - b[0] > 300 ? b : bordaModelo(y);
  }
  return bordaModelo(y);
});

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
  const arquivo = path.join(saida, nome);
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract(caixa)
    .webp({ quality: 86, alphaQuality: 90, effort: 6 })
    .toFile(arquivo);
  const meta = await sharp(arquivo).metadata();
  console.log(nome, caixa, `${meta.width}x${meta.height}`);
}

// Caixas com folga de 4 px; as coordenadas entram no SVG da cena (mesmo sistema da foto).
await exportar(mTampa, { left: 140, top: 188, width: 486, height: LIMITE_TAMPA - 188 + 3 }, "tampa.webp");
await exportar(mPote, { left: 136, top: 281, width: 494, height: ULTIMA_LINHA + 3 - 281 }, "pote.webp");

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
