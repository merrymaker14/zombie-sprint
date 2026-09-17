import * as THREE from 'three';
import type { TrackDefinition, TrackTheme } from '../core/types';
import { fbm2, clamp01, seededRandom } from '../core/math';
import { t } from '../core/i18n';

/** Length of one road texture tile along the track (metres). */
export const ROAD_TILE_LENGTH = 8;

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function css(hex: number, alpha = 1): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return { canvas, ctx };
}

function finishTexture(canvas: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; anisotropy?: number } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.repeat !== false) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// -----------------------------------------------------------------------------------------------
// Cartoon signage: pictograms and fitted display text (no text is baked in; callers pass t() strings)
// -----------------------------------------------------------------------------------------------

const DISPLAY_FONT = '"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';

/** Set the largest display font (<= maxSize) whose rendered width fits maxWidth. Returns the size. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number, weight = '900'): number {
  let size = Math.max(8, Math.floor(maxSize));
  ctx.font = `${weight} ${size}px ${DISPLAY_FONT}`;
  const w = ctx.measureText(text).width;
  if (w > maxWidth) {
    size = Math.max(8, Math.floor((size * maxWidth) / w));
    ctx.font = `${weight} ${size}px ${DISPLAY_FONT}`;
  }
  return size;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function ellipsePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
}

/** Diagonal two-colour warning stripes clipped to a rectangle. */
function hazardStripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: string, b: string, stripe: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = b;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = a;
  for (let sx = x - h; sx < x + w + h; sx += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + stripe, y + h);
    ctx.lineTo(sx + stripe + h, y);
    ctx.lineTo(sx + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Goo hanging from a top edge (rounded drops). Kid-friendly slime, not blood. */
function slimeDrips(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, seed: number): void {
  const rng = seededRandom(seed);
  ctx.fillStyle = fill;
  const band = h * 0.12;
  ctx.fillRect(x, y, w, band);
  let px = x + rng() * h * 0.2;
  while (px < x + w - h * 0.08) {
    const dw = h * (0.07 + rng() * 0.08);
    const dl = h * (0.1 + rng() * rng() * 0.45);
    const r = dw / 2;
    ctx.beginPath();
    ctx.moveTo(px - r * 0.5, y + band - 1);
    ctx.quadraticCurveTo(px, y + band, px, y + band + dl * 0.4);
    ctx.lineTo(px, y + band + dl);
    ctx.arc(px + r, y + band + dl, r, Math.PI, 0, true);
    ctx.lineTo(px + dw, y + band + dl * 0.4);
    ctx.quadraticCurveTo(px + dw, y + band, px + dw + r * 0.5, y + band - 1);
    ctx.closePath();
    ctx.fill();
    px += dw + h * (0.06 + rng() * 0.28);
  }
}

/** Icicles hanging from a top edge. */
function icicles(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  const rng = seededRandom(seed);
  ctx.fillStyle = 'rgba(236,248,255,0.95)';
  ctx.fillRect(x, y, w, h * 0.08);
  let px = x;
  while (px < x + w - 4) {
    const dw = h * (0.06 + rng() * 0.07);
    const dl = h * (0.12 + rng() * 0.3);
    ctx.beginPath();
    ctx.moveTo(px, y + h * 0.08);
    ctx.lineTo(px + dw / 2, y + h * 0.08 + dl);
    ctx.lineTo(px + dw, y + h * 0.08);
    ctx.closePath();
    ctx.fill();
    px += dw + rng() * h * 0.08;
  }
}

/** Cute cartoon skull: big round eye sockets with a shine, button nose, block teeth. */
function drawSkull(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, bone: string, dark: string): void {
  const r = s * 0.34;
  const lw = Math.max(1.5, s * 0.04);
  ctx.lineJoin = 'round';
  ctx.fillStyle = bone;
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw;
  // jaw first so the cranium outline overlaps it
  roundRectPath(ctx, cx - r * 0.6, cy + r * 0.35, r * 1.2, r * 0.78, r * 0.28);
  ctx.fill();
  ctx.stroke();
  ellipsePath(ctx, cx, cy - r * 0.12, r, r * 0.92);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = bone;
  ctx.fillRect(cx - r * 0.55, cy + r * 0.3, r * 1.1, r * 0.25);
  // teeth
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw * 0.8;
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(cx + k * r * 0.26, cy + r * 0.72);
    ctx.lineTo(cx + k * r * 0.26, cy + r * 1.08);
    ctx.stroke();
  }
  // eyes
  ctx.fillStyle = dark;
  ellipsePath(ctx, cx - r * 0.4, cy - r * 0.05, r * 0.29, r * 0.33);
  ctx.fill();
  ellipsePath(ctx, cx + r * 0.4, cy - r * 0.05, r * 0.29, r * 0.33);
  ctx.fill();
  ctx.fillStyle = bone;
  ellipsePath(ctx, cx - r * 0.32, cy - r * 0.15, r * 0.09, r * 0.09);
  ctx.fill();
  ellipsePath(ctx, cx + r * 0.48, cy - r * 0.15, r * 0.09, r * 0.09);
  ctx.fill();
  // nose
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.1, cy + r * 0.3);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.3);
  ctx.lineTo(cx, cy + r * 0.44);
  ctx.closePath();
  ctx.fill();
}

/** Friendly zombie mascot head: messy hair, forehead stitches, odd-sized eyes, crooked grin. */
function drawZombieHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, skin: string, dark: string): void {
  const r = s * 0.38;
  const lw = Math.max(1.5, s * 0.04);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw;
  // hair tufts behind the head
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.85, cy - r * 0.35);
  ctx.lineTo(cx - r * 0.7, cy - r * 1.2);
  ctx.lineTo(cx - r * 0.35, cy - r * 0.8);
  ctx.lineTo(cx - r * 0.05, cy - r * 1.3);
  ctx.lineTo(cx + r * 0.2, cy - r * 0.85);
  ctx.lineTo(cx + r * 0.6, cy - r * 1.15);
  ctx.lineTo(cx + r * 0.85, cy - r * 0.35);
  ctx.closePath();
  ctx.fill();
  // ears
  ctx.fillStyle = skin;
  ellipsePath(ctx, cx - r * 0.98, cy + r * 0.05, r * 0.2, r * 0.26);
  ctx.fill();
  ctx.stroke();
  ellipsePath(ctx, cx + r * 0.98, cy + r * 0.05, r * 0.2, r * 0.26);
  ctx.fill();
  ctx.stroke();
  // head
  ellipsePath(ctx, cx, cy, r, r * 0.96);
  ctx.fill();
  ctx.stroke();
  // stitches across the forehead
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.05, cy - r * 0.62);
  ctx.lineTo(cx + r * 0.62, cy - r * 0.42);
  ctx.stroke();
  for (let k = 0; k < 3; k++) {
    const px = cx + r * (0.16 + k * 0.18);
    const py = cy - r * (0.58 - k * 0.064);
    ctx.beginPath();
    ctx.moveTo(px - r * 0.03, py - r * 0.1);
    ctx.lineTo(px + r * 0.03, py + r * 0.1);
    ctx.stroke();
  }
  // tired under-eye shadows
  ctx.fillStyle = 'rgba(40,30,60,0.28)';
  ellipsePath(ctx, cx - r * 0.38, cy + r * 0.02, r * 0.3, r * 0.3);
  ctx.fill();
  ellipsePath(ctx, cx + r * 0.36, cy + r * 0.02, r * 0.22, r * 0.22);
  ctx.fill();
  // eyes: one big, one small, looking in different directions
  ctx.lineWidth = lw * 0.8;
  ctx.fillStyle = '#fbfbf2';
  ellipsePath(ctx, cx - r * 0.36, cy - r * 0.1, r * 0.27, r * 0.28);
  ctx.fill();
  ctx.stroke();
  ellipsePath(ctx, cx + r * 0.36, cy - r * 0.06, r * 0.17, r * 0.17);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = dark;
  ellipsePath(ctx, cx - r * 0.3, cy - r * 0.06, r * 0.1, r * 0.1);
  ctx.fill();
  ellipsePath(ctx, cx + r * 0.33, cy - r * 0.1, r * 0.07, r * 0.07);
  ctx.fill();
  // crooked grin with two teeth
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.42);
  ctx.quadraticCurveTo(cx, cy + r * 0.66, cx + r * 0.46, cy + r * 0.34);
  ctx.stroke();
  ctx.fillStyle = '#fbfbf2';
  ctx.fillRect(cx - r * 0.18, cy + r * 0.47, r * 0.14, r * 0.14);
  ctx.strokeRect(cx - r * 0.18, cy + r * 0.47, r * 0.14, r * 0.14);
  ctx.fillRect(cx + r * 0.1, cy + r * 0.44, r * 0.12, r * 0.18);
  ctx.strokeRect(cx + r * 0.1, cy + r * 0.44, r * 0.12, r * 0.18);
}

/** Cartoon zombie hand rising out of the ground (sleeve cuff, splayed fingers). baseY is the bottom. */
function drawZombieHand(ctx: CanvasRenderingContext2D, cx: number, baseY: number, s: number, skin: string, sleeve: string, dark: string, mound: string | null): void {
  const lw = Math.max(1.5, s * 0.035);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw;
  const finger = (x: number, y: number, w: number, h: number, a: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    roundRectPath(ctx, -w / 2, -h, w, h + w * 0.6, w / 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  const palmW = s * 0.3;
  const palmTop = baseY - s * 0.62;
  // fingers behind the palm
  const fw = s * 0.075;
  finger(cx - palmW * 0.36, palmTop + s * 0.04, fw, s * 0.2, -0.22);
  finger(cx - palmW * 0.12, palmTop + s * 0.02, fw, s * 0.26, -0.06);
  finger(cx + palmW * 0.12, palmTop + s * 0.02, fw, s * 0.24, 0.08);
  finger(cx + palmW * 0.36, palmTop + s * 0.04, fw, s * 0.18, 0.26);
  finger(cx - palmW * 0.52, palmTop + s * 0.2, fw, s * 0.15, -0.9);
  // palm
  roundRectPath(ctx, cx - palmW / 2, palmTop, palmW, s * 0.3, s * 0.08);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();
  // ragged sleeve
  const sw = s * 0.36;
  const sTop = baseY - s * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx - sw / 2, baseY);
  ctx.lineTo(cx - sw / 2, sTop);
  const teeth = 5;
  for (let k = 0; k < teeth; k++) {
    ctx.lineTo(cx - sw / 2 + ((k + 0.5) / teeth) * sw, sTop + (k % 2 === 0 ? s * 0.07 : s * 0.02));
    ctx.lineTo(cx - sw / 2 + ((k + 1) / teeth) * sw, sTop);
  }
  ctx.lineTo(cx + sw / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = sleeve;
  ctx.fill();
  ctx.stroke();
  if (mound) {
    ctx.fillStyle = mound;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, s * 0.46, s * 0.12, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** Rounded tombstone with an engraved cross and a grass tuft. */
function drawTombstone(ctx: CanvasRenderingContext2D, cx: number, baseY: number, s: number, stone: string, dark: string): void {
  const w = s * 0.5;
  const h = s * 0.72;
  const lw = Math.max(1.5, s * 0.035);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY);
  ctx.lineTo(cx - w / 2, baseY - h + w / 2);
  ctx.arc(cx, baseY - h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(cx + w / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = stone;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.fillStyle = dark;
  ctx.fillRect(cx - s * 0.03, baseY - h + s * 0.14, s * 0.06, s * 0.3);
  ctx.fillRect(cx - s * 0.11, baseY - h + s * 0.22, s * 0.22, s * 0.06);
  // a little crack
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.5, baseY - h * 0.55);
  ctx.lineTo(cx + w * 0.3, baseY - h * 0.45);
  ctx.lineTo(cx + w * 0.36, baseY - h * 0.35);
  ctx.stroke();
  ctx.fillStyle = '#4f8f34';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.75, baseY);
  for (let k = 0; k <= 8; k++) ctx.lineTo(cx - w * 0.75 + (k / 8) * w * 1.5, baseY - (k % 2 === 0 ? 0 : s * 0.09));
  ctx.closePath();
  ctx.fill();
}

/** Biohazard trefoil, drawn on a scratch canvas so the cut-outs stay transparent. */
function drawBiohazard(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string): void {
  const S = Math.max(8, Math.ceil(s));
  const scratch = makeCanvas(S, S);
  const c = scratch.ctx;
  const u = S / 2;
  const m = u;
  c.fillStyle = fill;
  c.strokeStyle = fill;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    c.beginPath();
    c.arc(m + Math.cos(a) * u * 0.34, m + Math.sin(a) * u * 0.34, u * 0.5, 0, Math.PI * 2);
    c.fill();
  }
  c.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    c.beginPath();
    c.arc(m + Math.cos(a) * u * 0.5, m + Math.sin(a) * u * 0.5, u * 0.36, 0, Math.PI * 2);
    c.fill();
  }
  c.beginPath();
  c.arc(m, m, u * 0.14, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = u * 0.09;
  c.beginPath();
  c.arc(m, m, u * 0.36, 0, Math.PI * 2);
  c.stroke();
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = u * 0.07;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3 + Math.PI / 3;
    c.beginPath();
    c.moveTo(m + Math.cos(a) * u * 0.28, m + Math.sin(a) * u * 0.28);
    c.lineTo(m + Math.cos(a) * u * 0.44, m + Math.sin(a) * u * 0.44);
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
  ctx.drawImage(scratch.canvas, cx - S / 2, cy - S / 2);
}

/** Road-sign style shambling zombie: arms out in front, one knee bent. baseY is the feet line. */
function drawWalker(ctx: CanvasRenderingContext2D, cx: number, baseY: number, s: number, fill: string): void {
  ctx.strokeStyle = fill;
  ctx.fillStyle = fill;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const L = (w: number, pts: [number, number][]): void => {
    ctx.lineWidth = s * w;
    ctx.beginPath();
    ctx.moveTo(cx + pts[0][0] * s, baseY - pts[0][1] * s);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(cx + pts[k][0] * s, baseY - pts[k][1] * s);
    ctx.stroke();
  };
  ellipsePath(ctx, cx + 0.1 * s, baseY - 0.84 * s, 0.1 * s, 0.1 * s);
  ctx.fill();
  L(0.15, [[0.02, 0.68], [-0.05, 0.42]]);
  L(0.065, [[0.03, 0.64], [0.33, 0.62]]);
  L(0.065, [[0.0, 0.58], [0.31, 0.54]]);
  L(0.085, [[-0.05, 0.4], [0.08, 0.22], [0.1, 0.03]]);
  L(0.085, [[-0.06, 0.4], [-0.2, 0.2], [-0.3, 0.05]]);
}

/** A little zombie head frozen inside an ice cube. */
function drawFrozenZombie(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, skin: string, dark: string): void {
  drawZombieHead(ctx, cx, cy + s * 0.04, s * 0.78, skin, dark);
  roundRectPath(ctx, cx - s * 0.43, cy - s * 0.43, s * 0.86, s * 0.86, s * 0.1);
  ctx.fillStyle = 'rgba(170,225,255,0.45)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(235,250,255,0.95)';
  ctx.lineWidth = Math.max(1.5, s * 0.04);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.3, cy - s * 0.18);
  ctx.lineTo(cx - s * 0.16, cy - s * 0.32);
  ctx.moveTo(cx - s * 0.3, cy - s * 0.04);
  ctx.lineTo(cx - s * 0.02, cy - s * 0.32);
  ctx.stroke();
}

/** Big highway arrow bending off to nowhere. */
function drawExitArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineWidth = s * 0.14;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, cy + s * 0.42);
  ctx.lineTo(cx - s * 0.1, cy + s * 0.05);
  ctx.quadraticCurveTo(cx - s * 0.1, cy - s * 0.15, cx + s * 0.12, cy - s * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.38, cy - s * 0.24);
  ctx.lineTo(cx + s * 0.06, cy - s * 0.44);
  ctx.lineTo(cx + s * 0.1, cy + s * 0.02);
  ctx.closePath();
  ctx.fill();
}

export type SignIcon = 'skull' | 'zombie' | 'hand' | 'tombstone' | 'biohazard' | 'walker' | 'frozen' | 'arrow';
export type SignStyle = 'slime' | 'hazard' | 'highway' | 'plain' | 'hologram';

/** One trackside sign: already-translated text, colours and the pictogram drawn at both ends. */
export interface SignSpec {
  text: string;
  bg: number;
  fg: number;
  accent: number;
  icon: SignIcon;
  style: SignStyle;
}

const INK = '#1b1522';

function drawIcon(ctx: CanvasRenderingContext2D, icon: SignIcon, cx: number, cy: number, s: number, fg: string, accent: string): void {
  switch (icon) {
    case 'skull':
      drawSkull(ctx, cx, cy, s, '#f3ecd6', INK);
      break;
    case 'zombie':
      drawZombieHead(ctx, cx, cy + s * 0.05, s, '#8fcf5f', INK);
      break;
    case 'hand':
      drawZombieHand(ctx, cx, cy + s * 0.46, s, '#8fcf5f', accent, INK, '#5a3d2b');
      break;
    case 'tombstone':
      drawTombstone(ctx, cx, cy + s * 0.42, s, '#a9a6b8', INK);
      break;
    case 'biohazard':
      drawBiohazard(ctx, cx, cy, s * 0.92, fg);
      break;
    case 'walker':
      drawWalker(ctx, cx - s * 0.04, cy + s * 0.45, s * 0.92, fg);
      break;
    case 'frozen':
      drawFrozenZombie(ctx, cx, cy, s, '#8fcf5f', INK);
      break;
    case 'arrow':
      drawExitArrow(ctx, cx, cy, s, fg);
      break;
  }
}

/** Paint one sign into the rectangle (x, y, w, h) of a canvas. */
function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, spec: SignSpec, glow: boolean, seed: number): void {
  const bg = css(spec.bg);
  const fg = css(spec.fg);
  const accent = css(spec.accent);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  let inset = h * 0.12;
  if (spec.style === 'hazard') {
    const band = h * 1.25;
    hazardStripes(ctx, x, y, band, h, accent, INK, h * 0.22);
    hazardStripes(ctx, x + w - band, y, band, h, accent, INK, h * 0.22);
    inset = band + h * 0.08;
  } else if (spec.style === 'slime') {
    slimeDrips(ctx, x, y, w, h, accent, seed);
  } else if (spec.style === 'hologram') {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = accent;
    for (let yy = y; yy < y + h; yy += Math.max(3, h * 0.05)) ctx.fillRect(x, yy, w, Math.max(1, h * 0.018));
    ctx.globalAlpha = 1;
  }
  if (spec.style === 'highway') {
    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(2, h * 0.045);
    roundRectPath(ctx, x + h * 0.08, y + h * 0.08, w - h * 0.16, h * 0.84, h * 0.14);
    ctx.stroke();
  } else {
    ctx.strokeStyle = spec.style === 'hologram' ? accent : css(spec.fg, 0.75);
    ctx.lineWidth = Math.max(2, h * 0.05);
    if (glow) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = h * 0.25;
    }
    ctx.strokeRect(x + h * 0.04, y + h * 0.04, w - h * 0.08, h * 0.92);
    ctx.shadowBlur = 0;
  }
  // text first (to know its width), pictograms hug it; wide boards get a second pair near the ends
  const iconS = h * 0.84;
  const iconCy = y + h * 0.52;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fitFont(ctx, spec.text, w - 2 * inset - iconS * 2.6, h * 0.66);
  const tw = ctx.measureText(spec.text).width;
  const gap = iconS * 0.75;
  const leftCx = Math.max(x + inset + iconS * 0.55, x + w / 2 - tw / 2 - gap);
  const rightCx = Math.min(x + w - inset - iconS * 0.55, x + w / 2 + tw / 2 + gap);
  if (glow) {
    ctx.shadowColor = fg;
    ctx.shadowBlur = h * 0.2;
  }
  drawIcon(ctx, spec.icon, leftCx, iconCy, iconS, fg, accent);
  drawIcon(ctx, spec.icon, rightCx, iconCy, iconS, fg, accent);
  const outerL = x + inset + iconS * 0.6;
  if (leftCx - outerL > iconS * 1.8) {
    drawIcon(ctx, spec.icon, outerL, iconCy, iconS, fg, accent);
    drawIcon(ctx, spec.icon, x + w - (outerL - x), iconCy, iconS, fg, accent);
  }
  ctx.shadowBlur = 0;
  const ty = y + h * 0.54;
  if (glow) {
    ctx.shadowColor = fg;
    ctx.shadowBlur = h * 0.3;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.strokeStyle = spec.style === 'highway' ? 'rgba(0,0,0,0.25)' : 'rgba(10,6,16,0.85)';
  ctx.strokeText(spec.text, x + w / 2, ty);
  ctx.fillStyle = fg;
  ctx.fillText(spec.text, x + w / 2, ty);
  ctx.shadowBlur = 0;
  ctx.restore();
}

export interface SignAtlas {
  texture: THREE.CanvasTexture;
  /** Per sign: v range of its row (u always spans 0..1). */
  rows: { v0: number; v1: number }[];
}

/**
 * All trackside boards of one track in a single texture (one material, few draw calls).
 * Each row keeps the aspect of the board it is mapped onto, so text is never stretched.
 */
export function makeSignAtlas(signs: { spec: SignSpec; aspect: number }[], glow: boolean): SignAtlas {
  const W = 2048;
  const gutter = 12;
  const heights = signs.map((s) => Math.round(THREE.MathUtils.clamp(W / Math.max(1, s.aspect), 64, 320)));
  const H = heights.reduce((a, b) => a + b + gutter, gutter);
  const { canvas, ctx } = makeCanvas(W, H);
  const rows: { v0: number; v1: number }[] = [];
  let y = gutter;
  signs.forEach((s, i) => {
    const h = heights[i];
    // gutter bleed in the sign's own background so mipmaps do not pick up neighbours
    ctx.fillStyle = css(s.spec.bg);
    ctx.fillRect(0, y - gutter / 2, W, h + gutter);
    drawSign(ctx, 0, y, W, h, s.spec, glow, 101 + i * 17);
    rows.push({ v0: 1 - (y + h - 0.5) / H, v1: 1 - (y + 0.5) / H });
    y += h + gutter;
  });
  return { texture: finishTexture(canvas, { repeat: false }), rows };
}

/** Fill the canvas with a base colour modulated by tiling fbm noise. */
function fillNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: number,
  amount: number,
  scale: number,
  seed: number,
  tint?: { color: number; strength: number },
): void {
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const [br, bg, bb] = hexToRgb(base);
  const tintRgb = tint ? hexToRgb(tint.color) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Tile seamlessly by blending 4 offset copies is overkill; use a periodic domain via sin.
      const u = (x / w) * Math.PI * 2;
      const v = (y / h) * Math.PI * 2;
      const nx = Math.cos(u) * scale + seed;
      const ny = Math.sin(u) * scale + seed * 1.7;
      const nz = Math.cos(v) * scale + seed * 0.3;
      const nw = Math.sin(v) * scale + seed * 2.1;
      const n1 = fbm2(nx + nz, ny + nw, 4);
      const n2 = fbm2(nx * 2.7 - nw, ny * 2.7 + nz, 3);
      const n = (n1 - 0.5) * amount + (n2 - 0.5) * amount * 0.5;
      let r = br * (1 + n);
      let g = bg * (1 + n);
      let b = bb * (1 + n);
      if (tintRgb) {
        const k = clamp01((n2 - 0.5) * 2) * tint!.strength;
        r = r * (1 - k) + tintRgb[0] * k;
        g = g * (1 - k) + tintRgb[1] * k;
        b = b * (1 - k) + tintRgb[2] * k;
      }
      const i = (y * w + x) * 4;
      data[i] = clamp01(r / 255) * 255;
      data[i + 1] = clamp01(g / 255) * 255;
      data[i + 2] = clamp01(b / 255) * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export interface RoadTextures {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture | null;
}

/**
 * Road surface: u = across the road (0 left edge .. 1 right edge), v = along the track,
 * one tile = ROAD_TILE_LENGTH metres. Contains asphalt/ice noise, edge lines and a centre dash.
 */
export function makeRoadTextures(def: TrackDefinition): RoadTextures {
  const W = 512;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const theme = def.theme;
  const p = def.palette;
  const rng = seededRandom(1234);

  if (theme === 'snow') {
    // Smooth ice: pale blue-grey, only broad low-frequency variation, soft sheen and a few large cracks.
    fillNoise(ctx, W, H, p.road, 0.09, 0.55, 3.1, { color: 0xc9e2f2, strength: 0.22 });
    // soft sheen streaks along the driving direction
    for (let i = 0; i < 7; i++) {
      const x = rng() * W;
      const w = 40 + rng() * 90;
      const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(240,250,255,0.13)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - w / 2, 0, w, H);
    }
    // sparse large cracks: a bright core with a darker shadow line
    for (let i = 0; i < 5; i++) {
      const pts: [number, number][] = [];
      let x = rng() * W;
      let y = rng() * H;
      const dirX = (rng() - 0.5) * 1.4;
      const dirY = rng() < 0.5 ? -1 : 1;
      const segs = 5 + Math.floor(rng() * 4);
      for (let k = 0; k <= segs; k++) {
        pts.push([x, y]);
        x += dirX * 30 + (rng() - 0.5) * 34;
        y += dirY * (36 + rng() * 40);
      }
      const drawPoly = (): void => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.stroke();
      };
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(70,95,120,0.35)';
      ctx.lineWidth = 4.5;
      drawPoly();
      ctx.strokeStyle = 'rgba(235,248,255,0.55)';
      ctx.lineWidth = 1.8;
      drawPoly();
      // a short side branch
      if (rng() < 0.7) {
        const j = 1 + Math.floor(rng() * (pts.length - 2));
        ctx.beginPath();
        ctx.moveTo(pts[j][0], pts[j][1]);
        ctx.lineTo(pts[j][0] + (rng() - 0.5) * 70, pts[j][1] + (rng() - 0.5) * 50);
        ctx.strokeStyle = 'rgba(235,248,255,0.4)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  } else {
    // Asphalt: near-black grey with very fine aggregate grain and only a whisper of low-frequency mottling.
    fillNoise(ctx, W, H, p.road, theme === 'neon' ? 0.16 : 0.12, 0.9, 3.1);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const grain = theme === 'neon' ? 10 : 14;
    for (let i = 0; i < d.length; i += 4) {
      const g = (rng() - 0.5) * grain + (rng() < 0.035 ? 18 : 0);
      d[i] = clamp01((d[i] + g) / 255) * 255;
      d[i + 1] = clamp01((d[i + 1] + g) / 255) * 255;
      d[i + 2] = clamp01((d[i + 2] + g * 1.05) / 255) * 255;
    }
    ctx.putImageData(img, 0, 0);
    // faint lighter wear bands where the karts actually drive (worn aggregate reads lighter)
    for (const cx of [0.27, 0.73]) {
      const bw = W * 0.2;
      const g = ctx.createLinearGradient(W * cx - bw / 2, 0, W * cx + bw / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, theme === 'neon' ? 'rgba(200,210,255,0.07)' : 'rgba(255,255,255,0.09)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(W * cx - bw / 2, 0, bw, H);
    }
    if (theme === 'desert') {
      // sand blown onto the edges of the road
      for (const side of [0, 1]) {
        const g = ctx.createLinearGradient(side === 0 ? 0 : W, 0, side === 0 ? W * 0.12 : W * 0.88, 0);
        g.addColorStop(0, css(p.offroad, 0.32));
        g.addColorStop(1, css(p.offroad, 0));
        ctx.fillStyle = g;
        ctx.fillRect(side === 0 ? 0 : W * 0.88, 0, W * 0.12, H);
      }
    }
    // occasional darker patch (repair) to break up the tile
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000';
    ctx.fillRect(W * 0.42, H * 0.3, W * 0.16, H * 0.22);
    ctx.globalAlpha = 1;
  }

  // Edge lines + centre dash
  const stripe = css(p.roadStripe);
  const edgeW = W * 0.02;
  const edgeInset = W * 0.035;
  ctx.fillStyle = stripe;
  ctx.globalAlpha = theme === 'snow' ? 0.55 : 0.9;
  ctx.fillRect(edgeInset, 0, edgeW, H);
  ctx.fillRect(W - edgeInset - edgeW, 0, edgeW, H);
  // centre dash: two 2.4 m dashes per 8 m tile
  const dashLen = (2.4 / ROAD_TILE_LENGTH) * H;
  const dashW = W * 0.018;
  ctx.fillRect(W / 2 - dashW / 2, H * 0.05, dashW, dashLen);
  ctx.fillRect(W / 2 - dashW / 2, H * 0.55, dashW, dashLen);
  ctx.globalAlpha = 1;
  if (theme !== 'snow') {
    // paint wear: knock the lines back a touch so they do not look freshly printed
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = css(p.road);
    for (let i = 0; i < 60; i++) ctx.fillRect(rng() * W, rng() * H, 2 + rng() * 6, 2 + rng() * 10);
    ctx.globalAlpha = 1;
  }
  const map = finishTexture(canvas);

  let emissiveMap: THREE.CanvasTexture | null = null;
  if (theme === 'neon') {
    const e = makeCanvas(W, H);
    e.ctx.fillStyle = '#000';
    e.ctx.fillRect(0, 0, W, H);
    e.ctx.fillStyle = css(p.roadStripe);
    e.ctx.fillRect(edgeInset, 0, edgeW, H);
    e.ctx.fillStyle = css(p.curb);
    e.ctx.fillRect(W - edgeInset - edgeW, 0, edgeW, H);
    e.ctx.fillStyle = css(p.roadStripe);
    e.ctx.fillRect(W / 2 - dashW / 2, H * 0.05, dashW, dashLen);
    e.ctx.fillRect(W / 2 - dashW / 2, H * 0.55, dashW, dashLen);
    // glow halo
    e.ctx.globalAlpha = 0.35;
    e.ctx.fillStyle = css(p.roadStripe);
    e.ctx.fillRect(edgeInset - edgeW, 0, edgeW * 3, H);
    e.ctx.fillStyle = css(p.curb);
    e.ctx.fillRect(W - edgeInset - edgeW * 2, 0, edgeW * 3, H);
    e.ctx.globalAlpha = 1;
    emissiveMap = finishTexture(e.canvas);
  }
  return { map, emissiveMap };
}

/** Tiling ground texture (grass / sand / snow / dark asphalt). One tile ~ 4 m. */
export function makeGroundTexture(theme: TrackTheme, base: number): THREE.CanvasTexture {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const amount = theme === 'snow' ? 0.08 : theme === 'neon' ? 0.2 : theme === 'grassland' ? 0.2 : 0.32;
  const tint =
    theme === 'grassland'
      ? { color: 0x8fc93e, strength: 0.3 }
      : theme === 'desert'
        ? { color: 0xb87a3c, strength: 0.3 }
        : theme === 'snow'
          ? { color: 0xcfe3f5, strength: 0.25 }
          : undefined;
  fillNoise(ctx, S, S, base, amount, 1.3, 7.7, tint);
  const rng = seededRandom(99);
  if (theme === 'grassland') {
    // two-tone turf: broad darker patches over the base green (periodic so the tile stays seamless)
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x / S) * Math.PI * 2;
        const v = (y / S) * Math.PI * 2;
        const n = fbm2(Math.cos(u) * 0.9 + Math.cos(v) * 0.9 + 11.3, Math.sin(u) * 0.9 + Math.sin(v) * 0.9 + 4.2, 3);
        const k = clamp01((n - 0.47) * 3.2) * 0.42;
        const i = (y * S + x) * 4;
        d[i] = d[i] * (1 - k) + 0x2f * k;
        d[i + 1] = d[i + 1] * (1 - k) + 0x7a * k;
        d[i + 2] = d[i + 2] * (1 - k) + 0x24 * k;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(170,230,80,0.6)' : 'rgba(30,80,25,0.65)';
      ctx.fillRect(rng() * S, rng() * S, 1, 2 + rng() * 3);
    }
  } else if (theme === 'desert') {
    // wind ripples
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = 'rgba(90,50,20,1)';
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      const y = rng() * S;
      ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.1 + i) * 4);
      ctx.stroke();
    }
  } else if (theme === 'snow') {
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(rng() * S, rng() * S, 1, 1);
    }
  } else if (theme === 'neon') {
    // pavement tiles
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(60,80,120,1)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * S) / 4, 0);
      ctx.lineTo((i * S) / 4, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * S) / 4);
      ctx.lineTo(S, (i * S) / 4);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return finishTexture(canvas);
}

/** Black/white checker for the start/finish line. */
export function makeCheckerTexture(cols = 12, rows = 2): THREE.CanvasTexture {
  const cell = 32;
  const { canvas, ctx } = makeCanvas(cols * cell, rows * cell);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f4f4' : '#111111';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return finishTexture(canvas, { repeat: false });
}

/** Per-theme look of the gantry title board and the start/finish plaque. */
function gantryLook(theme: TrackTheme, accent: number): { board: string; board2: string; text: string; trim: string; skin: string; sleeve: string } {
  switch (theme) {
    case 'desert':
      return { board: '#6b3420', board2: '#4e2616', text: '#ffc21a', trim: '#2a1a14', skin: '#9cc46a', sleeve: '#7a6a5a' };
    case 'snow':
      return { board: '#243646', board2: '#1a2733', text: '#ffd21a', trim: '#0f1820', skin: '#9fd0a0', sleeve: '#c8452f' };
    case 'neon':
      return { board: '#120a22', board2: '#0b0616', text: css(accent), trim: '#7dff4a', skin: '#7dff4a', sleeve: '#3a2a66' };
    default:
      return { board: '#3b2750', board2: '#2c1d3d', text: '#a6ef5a', trim: '#1b1226', skin: '#8fcf5f', sleeve: '#6b4f8a' };
  }
}

/**
 * Title board for the top of the start gantry: the translated game title on a themed plank board,
 * with two cartoon zombie hands reaching up from behind it. Transparent outside the silhouette
 * (use alphaTest).
 */
export function makeBannerTexture(theme: TrackTheme, accent: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const look = gantryLook(theme, accent);
  const title = t('sign.title');
  const bx = 40;
  const by = 78;
  const bw = W - 80;
  const bh = H - by - 10;
  // hands behind the board
  drawZombieHand(ctx, 150, by + 96, 176, look.skin, look.sleeve, INK, null);
  drawZombieHand(ctx, W - 150, by + 96, 176, look.skin, look.sleeve, INK, null);
  // board with planks
  ctx.save();
  roundRectPath(ctx, bx, by, bw, bh, 18);
  ctx.clip();
  ctx.fillStyle = look.board;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = look.board2;
  for (let k = 1; k < 3; k++) ctx.fillRect(bx, by + (k * bh) / 3 - 3, bw, 6);
  const rng = seededRandom(theme.length * 31 + 7);
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 26; i++) ctx.fillRect(bx + rng() * bw, by + rng() * bh, 30 + rng() * 90, 3);
  ctx.globalAlpha = 1;
  if (theme === 'snow') icicles(ctx, bx, by, bw, bh, 12);
  else if (theme === 'desert') hazardStripes(ctx, bx, by, bw, 18, '#ffc21a', INK, 22);
  else slimeDrips(ctx, bx, by, bw, bh * 0.9, theme === 'neon' ? '#7dff4a' : '#86d04a', 44);
  ctx.restore();
  ctx.lineWidth = 10;
  ctx.strokeStyle = look.trim;
  if (theme === 'neon') {
    ctx.shadowColor = look.trim;
    ctx.shadowBlur = 24;
  }
  roundRectPath(ctx, bx + 5, by + 5, bw - 10, bh - 10, 16);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // bolts
  ctx.fillStyle = theme === 'neon' ? '#7dff4a' : '#c9c2b0';
  for (const px of [bx + 26, bx + bw - 26]) for (const py of [by + 26, by + bh - 26]) {
    ellipsePath(ctx, px, py, 7, 7);
    ctx.fill();
  }
  // title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fitFont(ctx, title, bw - 150, 116, 'italic 900');
  const ty = by + bh / 2 + 10;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(6, size * 0.16);
  ctx.strokeStyle = 'rgba(10,6,16,0.92)';
  ctx.strokeText(title, W / 2, ty);
  ctx.fillStyle = look.text;
  if (theme === 'neon') {
    ctx.shadowColor = look.text;
    ctx.shadowBlur = 30;
  }
  ctx.fillText(title, W / 2, ty);
  ctx.shadowBlur = 0;
  // highlight on the letters
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, ty - size * 0.12);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText(title, W / 2, ty);
  ctx.restore();
  return finishTexture(canvas, { repeat: false });
}

/** Boost pad body: dark rounded strip with a lighter rim (transparent outside). u across, v along. */
export function makeBoostBaseTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const r = 14;
  const rr = (x: number, y: number, w: number, h: number, rad: number): void => {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  };
  rr(2, 2, W - 4, H - 4, r);
  ctx.fillStyle = '#4a4b52';
  ctx.fill();
  rr(6, 6, W - 12, H - 12, r - 3);
  ctx.fillStyle = '#17171b';
  ctx.fill();
  // faint inner panel lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((W * i) / 4, 8);
    ctx.lineTo((W * i) / 4, H - 8);
    ctx.stroke();
  }
  return finishTexture(canvas, { repeat: false });
}

/** One boost chevron per tile (transparent background), orange at the back fading to yellow at the tip. */
export function makeBoostChevronTile(): THREE.CanvasTexture {
  const W = 256;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  // chevron points toward canvas top (= +v = track forward, CanvasTexture flips Y)
  const thick = H * 0.3;
  const tipY = H * 0.12;
  const wingY = H * 0.62;
  const grad = ctx.createLinearGradient(0, wingY + thick, 0, tipY);
  grad.addColorStop(0, '#ff7a12');
  grad.addColorStop(0.55, '#ffb020');
  grad.addColorStop(1, '#ffef5a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(W * 0.06, wingY);
  ctx.lineTo(W / 2, tipY);
  ctx.lineTo(W * 0.94, wingY);
  ctx.lineTo(W * 0.94, wingY + thick);
  ctx.lineTo(W / 2, tipY + thick);
  ctx.lineTo(W * 0.06, wingY + thick);
  ctx.closePath();
  ctx.fill();
  // thin bright highlight along the leading edge
  ctx.strokeStyle = 'rgba(255,255,220,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.06, wingY);
  ctx.lineTo(W / 2, tipY);
  ctx.lineTo(W * 0.94, wingY);
  ctx.stroke();
  return finishTexture(canvas);
}

/** Faint orange fade used for the on-road boost trail ahead of a pad (v = along, fades to 0 at v = 1). */
export function makeBoostTrailTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  // v = 0 is canvas bottom (flipY)
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, 'rgba(255,150,40,0.36)');
  g.addColorStop(0.45, 'rgba(255,170,50,0.16)');
  g.addColorStop(1, 'rgba(255,190,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // soften the sides
  const side = ctx.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.2, 'rgba(0,0,0,0)');
  side.addColorStop(0.8, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  return finishTexture(canvas, { repeat: false });
}

/** Single tyre skid streak: dark rubber with ragged edges, fading in at v = 0 and out at v = 1. */
export function makeSkidTexture(): THREE.CanvasTexture {
  const W = 32;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const rng = seededRandom(31);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const fade = Math.sin(Math.PI * Math.min(1, Math.max(0, v))) ** 0.7;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const edge = 1 - Math.pow(Math.abs(u - 0.5) * 2, 3);
      const rough = 0.75 + rng() * 0.25;
      const a = fade * edge * rough * 0.78;
      const i = (y * W + x) * 4;
      d[i] = 12;
      d[i + 1] = 12;
      d[i + 2] = 14;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(canvas, { repeat: false });
}

/** Plain trackside board with caller-supplied (already translated) text and skull pictograms. */
export function makeSponsorTexture(text: string, bg: number, fg: number, accent: number, glow = false): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  drawSign(ctx, 0, 0, W, H, { text, bg, fg, accent, icon: 'skull', style: glow ? 'hologram' : 'plain' }, glow, 5);
  return finishTexture(canvas, { repeat: false });
}

/**
 * Checkered start/finish band with a themed plaque carrying the translated START · FINISH text.
 * `aspect` is width / height of the plane the texture is mapped onto, so cells stay square and
 * the lettering is not stretched.
 */
export function makeStartBannerTexture(theme: TrackTheme, accent: number, aspect = 1024 / 192): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round(THREE.MathUtils.clamp(W / Math.max(1, aspect), 96, 512));
  const { canvas, ctx } = makeCanvas(W, H);
  const rows = 4;
  const cell = H / rows;
  const cols = Math.ceil(W / cell);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f4f4' : '#141416';
      ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
  const look = gantryLook(theme, accent);
  const text = t('sign.startFinish');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const iconS = H * 0.74;
  const size = fitFont(ctx, text, W * 0.62 - iconS * 2.4, H * 0.62);
  const tw = ctx.measureText(text).width;
  const pw = tw + iconS * 2.6 + H * 0.3;
  const ph = H * 0.86;
  const px = W / 2 - pw / 2;
  const py = H / 2 - ph / 2;
  roundRectPath(ctx, px, py, pw, ph, H * 0.16);
  ctx.fillStyle = look.board;
  ctx.fill();
  ctx.lineWidth = Math.max(3, H * 0.05);
  ctx.strokeStyle = theme === 'neon' ? css(accent) : look.text;
  if (theme === 'neon') {
    ctx.shadowColor = css(accent);
    ctx.shadowBlur = H * 0.18;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  const skullBone = theme === 'neon' ? '#e9fff0' : '#f3ecd6';
  drawSkull(ctx, px + H * 0.2 + iconS * 0.6, H / 2 + H * 0.02, iconS, skullBone, INK);
  drawSkull(ctx, px + pw - H * 0.2 - iconS * 0.6, H / 2 + H * 0.02, iconS, skullBone, INK);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.14);
  ctx.strokeStyle = 'rgba(10,6,16,0.9)';
  ctx.strokeText(text, W / 2, H / 2 + H * 0.03);
  ctx.fillStyle = look.text;
  if (theme === 'neon') {
    ctx.shadowColor = look.text;
    ctx.shadowBlur = H * 0.2;
  }
  ctx.fillText(text, W / 2, H / 2 + H * 0.03);
  ctx.shadowBlur = 0;
  return finishTexture(canvas, { repeat: false });
}

/** Text label wrapped around a cylinder (water tower / silo). */
export function makeLabelTexture(text: string, bg: number, fg: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = css(bg);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = css(fg, 0.9);
  ctx.fillRect(0, 12, W, 10);
  ctx.fillRect(0, H - 22, W, 10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 120px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = css(fg);
  // text occupies the front third of the cylinder only
  ctx.fillText(text, W * 0.5, H / 2 + 6);
  return finishTexture(canvas);
}

/** Skyscraper facade: emissive window grid (used as emissiveMap + map). */
export function makeWindowTexture(seed: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256;
  const a = makeCanvas(S, S);
  const e = makeCanvas(S, S);
  a.ctx.fillStyle = '#141420';
  a.ctx.fillRect(0, 0, S, S);
  e.ctx.fillStyle = '#000';
  e.ctx.fillRect(0, 0, S, S);
  const rng = seededRandom(seed);
  const cols = 8;
  const rows = 12;
  const cw = S / cols;
  const ch = S / rows;
  const colours = ['#ffe9a8', '#9fe8ff', '#ff9ad6', '#c9b8ff', '#ffffff'];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng() < 0.62;
      const px = x * cw + cw * 0.2;
      const py = y * ch + ch * 0.2;
      const w = cw * 0.6;
      const h = ch * 0.55;
      a.ctx.fillStyle = lit ? '#2a2a3a' : '#0c0c14';
      a.ctx.fillRect(px, py, w, h);
      if (lit) {
        const col = colours[Math.floor(rng() * colours.length)];
        e.ctx.fillStyle = col;
        e.ctx.globalAlpha = 0.5 + rng() * 0.5;
        e.ctx.fillRect(px, py, w, h);
        e.ctx.globalAlpha = 1;
      }
    }
  }
  return { map: finishTexture(a.canvas), emissive: finishTexture(e.canvas) };
}

/** Holographic quarantine warnings for the neon city (translated text + pictograms, no brands). */
export function makeBillboardTexture(variant: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const designs: { bg: string; a: string; b: string; key: string; icon: SignIcon }[] = [
    { bg: '#1c0507', a: '#ff4040', b: '#ffd21a', key: 'sign.quarantine', icon: 'biohazard' },
    { bg: '#03160b', a: '#7dff4a', b: '#00e5ff', key: 'sign.cautionHorde', icon: 'walker' },
    { bg: '#1a0418', a: '#ff2fd6', b: '#ffd21a', key: 'sign.zoneClosed', icon: 'skull' },
  ];
  const d = designs[((variant % designs.length) + designs.length) % designs.length];
  ctx.fillStyle = d.bg;
  ctx.fillRect(0, 0, W, H);
  // hazard bands top and bottom
  hazardStripes(ctx, 0, 0, W, 26, d.b, '#0a0a0a', 20);
  hazardStripes(ctx, 0, H - 26, W, 26, d.b, '#0a0a0a', 20);
  // scanlines
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = d.a;
  for (let y = 30; y < H - 30; y += 6) ctx.fillRect(0, y, W, 2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = d.a;
  ctx.lineWidth = 6;
  ctx.shadowColor = d.a;
  ctx.shadowBlur = 18;
  ctx.strokeRect(8, 32, W - 16, H - 64);
  // pictogram on the left
  const iconS = 132;
  const icx = 22 + iconS / 2;
  const icy = H / 2;
  ctx.shadowColor = d.b;
  ctx.shadowBlur = 16;
  drawIcon(ctx, d.icon, icx, icy, iconS, d.b, d.a);
  ctx.shadowBlur = 0;
  // text, split into two lines after a colon
  const text = t(d.key);
  const colon = text.indexOf(': ');
  const lines = colon > 0 ? [text.slice(0, colon + 1), text.slice(colon + 2)] : [text];
  const left = 22 + iconS + 12;
  const tw = W - left - 24;
  const cx = left + tw / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = d.a;
  ctx.shadowBlur = 22;
  ctx.fillStyle = d.a;
  if (lines.length === 1) {
    fitFont(ctx, lines[0], tw, 96);
    ctx.fillText(lines[0], cx, H / 2 + 4);
  } else {
    const size = Math.min(fitFont(ctx, lines[0], tw, 62), fitFont(ctx, lines[1], tw, 62));
    ctx.font = `900 ${size}px ${DISPLAY_FONT}`;
    ctx.fillText(lines[0], cx, H / 2 - size * 0.5);
    ctx.fillText(lines[1], cx, H / 2 + size * 0.62);
  }
  ctx.shadowBlur = 0;
  return finishTexture(canvas, { repeat: false });
}

/** Sandstone strata for the desert barrier blocks. */
export function makeSandstoneTexture(base: number): THREE.CanvasTexture {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  fillNoise(ctx, S, S, base, 0.22, 1.1, 4.4, { color: 0x8a5a30, strength: 0.3 });
  ctx.globalAlpha = 0.25;
  const rng = seededRandom(5);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(80,40,20,1)' : 'rgba(255,230,190,1)';
    const y = rng() * S;
    ctx.fillRect(0, y, S, 2 + rng() * 4);
  }
  ctx.globalAlpha = 1;
  return finishTexture(canvas);
}

/** Soft radial glow sprite (sun / neon halos). */
export function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finishTexture(canvas, { repeat: false });
}
