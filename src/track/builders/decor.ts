import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildContext } from './context';
import { headingFromDir, normalizeForMerge, paintGeometry, track, trackMesh } from './context';
import { clamp01, lerp, seededRandom } from '../../core/math';
import { landmarkFootprints } from './landmarks';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Merge several coloured parts into one non-indexed geometry with vertex colours. */
export function mergeParts(parts: { geo: THREE.BufferGeometry; color: number | THREE.Color; keepColor?: boolean }[]): THREE.BufferGeometry {
  const geos = parts.map((p) => {
    const g = normalizeForMerge(p.geo);
    if (!(p.keepColor && g.getAttribute('color'))) {
      paintGeometry(g, p.color instanceof THREE.Color ? p.color : new THREE.Color(p.color));
    }
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('mergeParts failed');
  merged.computeBoundingSphere();
  return merged;
}

export interface ScatterPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic scatter of positions around the track: within [minDist, maxDist] metres of the
 * centerline (minDist is added to wallHalfWidth + 3), outside the start/grandstand zone.
 */
export function scatter(ctx: BuildContext, count: number, minDist: number, maxDist: number, extraReject?: (x: number, z: number) => boolean): ScatterPoint[] {
  const { cl, field, rng } = ctx;
  const pts: ScatterPoint[] = [];
  const margin = maxDist + 10;
  const x0 = cl.minX - margin;
  const x1 = cl.maxX + margin;
  const z0 = cl.minZ - margin;
  const z1 = cl.maxZ + margin;
  const startX = cl.px[0];
  const startZ = cl.pz[0];
  const inner = cl.maxWallHalfWidth + 3 + minDist;
  let tries = 0;
  while (pts.length < count && tries < count * 60) {
    tries++;
    const x = lerp(x0, x1, rng());
    const z = lerp(z0, z1, rng());
    const d = field.distanceToTrack(x, z);
    if (d < inner || d > maxDist) continue;
    // keep the start area clear for the grandstands / gantry
    const dsx = x - startX;
    const dsz = z - startZ;
    if (dsx * dsx + dsz * dsz < 55 * 55) continue;
    if (extraReject && extraReject(x, z)) continue;
    pts.push({ x, y: field.heightAt(x, z), z });
  }
  return pts;
}

// =====================================================================================
// Shared prop toolkit (used by landmarks / animated / barriers too)
// =====================================================================================

export interface UvRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

/** A coloured part; `glow` adds emission of its (textured) colour, `uv` maps it into the prop atlas. */
export interface GlowPart {
  geo: THREE.BufferGeometry;
  color: number | THREE.Color;
  glow?: number;
  uv?: UvRect;
  keepColor?: boolean;
}

const ATLAS_SIZE = 1024;
const ATLAS_CELL = ATLAS_SIZE / 4;
/** UV of the plain white atlas cell used by untextured parts. */
const WHITE_UV = 0.125;

function cellRect(col: number, row: number, w = 1, h = 1): UvRect {
  const e = 6 / ATLAS_SIZE;
  return { u: col / 4 + e, v: row / 4 + e, w: w / 4 - 2 * e, h: h / 4 - 2 * e };
}

/** Atlas cells (row 0 is the bottom of the texture). */
export const CELLS = {
  signBiohazard: cellRect(1, 0),
  signZombie: cellRect(2, 0),
  signHand: cellRect(3, 0),
  signArrow: cellRect(0, 1),
  holoBiohazard: cellRect(1, 1),
  holoZombie: cellRect(2, 1),
  holoHand: cellRect(3, 1),
  roseWindow: cellRect(0, 2),
  stripesYellow: cellRect(1, 2),
  stripesRed: cellRect(2, 2),
  holoArrow: cellRect(3, 2),
  holoWide: cellRect(0, 3, 2, 1),
  zombieWindow: cellRect(2, 3),
  moonBat: cellRect(3, 3),
};

/** Prepare a part for merging: vertex colour, atlas uv and glow attribute. */
function prepGlowPart(p: GlowPart): THREE.BufferGeometry {
  const g = normalizeForMerge(p.geo);
  if (!(p.keepColor && g.getAttribute('color'))) {
    paintGeometry(g, p.color instanceof THREE.Color ? p.color : _c.setHex(p.color));
  }
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const r = p.uv;
  for (let i = 0; i < uv.count; i++) {
    if (r) uv.setXY(i, r.u + clamp01(uv.getX(i)) * r.w, r.v + clamp01(uv.getY(i)) * r.h);
    else uv.setXY(i, WHITE_UV, WHITE_UV);
  }
  const glow = new Float32Array(uv.count).fill(p.glow ?? 0);
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  return g;
}

/** Merge glow parts into one geometry (position, normal, uv, color, glow). */
export function mergeGlow(parts: GlowPart[]): THREE.BufferGeometry {
  const geos = parts.map(prepGlowPart);
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('mergeGlow failed');
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Vertex-coloured standard material with an optional atlas map; the per-vertex `glow`
 * attribute adds emission of the surface colour, so lit and glowing parts share a draw call.
 */
export function glowMaterial(map: THREE.Texture | null, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, map, ...extra });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  mat.customProgramCacheKey = () => 'zs-glow';
  return mat;
}

/** Collects world-space copies of prop templates and bakes them into a single mesh. */
export class PropBatch {
  private readonly geos: THREE.BufferGeometry[] = [];

  get size(): number {
    return this.geos.length;
  }

  /** Place a template: yaw turns local -Z, tilts are applied in the prop's local frame. */
  add(template: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, scale = 1, tiltX = 0, tiltZ = 0, scaleY = scale): void {
    _e.set(tiltX, yaw, tiltZ, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(scale, scaleY, scale);
    _m.compose(_p, _q, _s);
    this.addMatrix(template, _m);
  }

  addMatrix(template: THREE.BufferGeometry, m: THREE.Matrix4): void {
    const g = template.clone();
    g.applyMatrix4(m);
    this.geos.push(g);
  }

  /** Add loose parts already in world space. */
  addParts(parts: GlowPart[]): void {
    if (parts.length) this.geos.push(mergeGlow(parts));
  }

  build(ctx: BuildContext, mat: THREE.Material, name: string, castShadow = true, receiveShadow = true): THREE.Mesh | null {
    if (this.geos.length === 0) {
      mat.dispose();
      return null;
    }
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    if (!merged) {
      mat.dispose();
      return null;
    }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    trackMesh(ctx, mesh);
    return mesh;
  }
}

/** Nearest centerline sample index for a world XZ position. */
export function nearestIndex(ctx: BuildContext, x: number, z: number): number {
  const { cl } = ctx;
  return Math.floor(cl.indexOf(cl.closestT(x, z))) % cl.n;
}

/** Yaw that turns a prop's local -Z toward the nearest point of the track. */
export function yawToTrack(ctx: BuildContext, x: number, z: number): number {
  const { cl } = ctx;
  const i = nearestIndex(ctx, x, z);
  return headingFromDir(cl.px[i] - x, cl.pz[i] - z);
}

/** Distance (metres) beyond the local wall line; negative means inside the walls. */
export function wallClearance(ctx: BuildContext, x: number, z: number): number {
  const { cl } = ctx;
  const i = nearestIndex(ctx, x, z);
  return Math.hypot(x - cl.px[i], z - cl.pz[i]) - cl.whw[i];
}

/** Reject predicate for landmark footprints (decor keeps out of them). */
export function makeFootprintReject(ctx: BuildContext): (x: number, z: number) => boolean {
  const fps = landmarkFootprints(ctx);
  return (x, z) => {
    for (const f of fps) {
      const dx = x - f.x;
      const dz = z - f.z;
      if (dx * dx + dz * dz < f.r * f.r) return true;
    }
    return false;
  };
}

// ------------------------------------------------------------------ geometry shorthands
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8, open = false): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const ball = (r: number, ws = 10, hs = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs);
export const cone = (r: number, h: number, seg = 6): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);

/** Colour each triangle by its angle around the Y axis (hazard bands on round things). */
export function stripeByAngle(geo: THREE.BufferGeometry, a: number, b: number, count: number): THREE.BufferGeometry {
  const g = normalizeForMerge(geo);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  for (let t = 0; t < pos.count; t += 3) {
    const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const k = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * count * 2);
    const c = k % 2 === 0 ? ca : cb;
    for (let v = 0; v < 3; v++) {
      col[(t + v) * 3] = c.r;
      col[(t + v) * 3 + 1] = c.g;
      col[(t + v) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// =====================================================================================
// Pictogram atlas (no lettering: every sign is a symbol)
// =====================================================================================

const atlasCache = new WeakMap<BuildContext, THREE.CanvasTexture>();

/** One shared 4x4 pictogram atlas per track build (cell 0,0 is plain white). */
export function propAtlas(ctx: BuildContext): THREE.CanvasTexture {
  const cached = atlasCache.get(ctx);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas not available');
  drawAtlas(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  track(ctx, tex);
  atlasCache.set(ctx, tex);
  return tex;
}

type G2D = CanvasRenderingContext2D;

function cellOrigin(col: number, row: number, h = 1): [number, number] {
  return [col * ATLAS_CELL, (4 - row - h) * ATLAS_CELL];
}

function biohazard(g: G2D, cx: number, cy: number, r: number, fg: string, bg: string): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = fg;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44, r * 0.46, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = bg;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.32, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = fg;
  g.lineWidth = r * 0.1;
  g.beginPath();
  g.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = bg;
  g.lineWidth = r * 0.07;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
    g.stroke();
  }
  g.fillStyle = bg;
  g.beginPath();
  g.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Cartoon zombie walking to the right with arms out (unit height ~1.5). */
function zombieIcon(g: G2D, cx: number, cy: number, s: number): void {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 0.15;
  g.beginPath();
  g.moveTo(-0.05, 0.12);
  g.lineTo(0.14, 0.42);
  g.lineTo(0.12, 0.72);
  g.stroke();
  g.beginPath();
  g.moveTo(-0.05, 0.12);
  g.lineTo(-0.2, 0.42);
  g.lineTo(-0.36, 0.68);
  g.stroke();
  g.lineWidth = 0.3;
  g.beginPath();
  g.moveTo(-0.06, 0.1);
  g.lineTo(0.05, -0.3);
  g.stroke();
  g.lineWidth = 0.11;
  g.beginPath();
  g.moveTo(0.05, -0.3);
  g.lineTo(0.55, -0.34);
  g.stroke();
  g.beginPath();
  g.moveTo(0.02, -0.18);
  g.lineTo(0.5, -0.18);
  g.stroke();
  g.beginPath();
  g.arc(0.14, -0.56, 0.18, 0, Math.PI * 2);
  g.fill();
  // messy hair
  g.beginPath();
  g.moveTo(-0.04, -0.62);
  g.lineTo(-0.08, -0.76);
  g.lineTo(0.02, -0.72);
  g.lineTo(0.06, -0.8);
  g.lineTo(0.12, -0.72);
  g.lineTo(0.2, -0.78);
  g.lineTo(0.3, -0.62);
  g.closePath();
  g.fill();
  g.restore();
}

function handIcon(g: G2D, cx: number, cy: number, s: number): void {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.beginPath();
  g.roundRect(-0.34, -0.08, 0.64, 0.62, 0.16);
  g.fill();
  for (let i = 0; i < 4; i++) {
    const x = -0.33 + i * 0.16;
    const top = -0.6 + Math.abs(i - 1.3) * 0.08;
    g.beginPath();
    g.roundRect(x, top, 0.13, 0.6, 0.065);
    g.fill();
  }
  g.save();
  g.translate(0.28, 0.2);
  g.rotate(-0.7);
  g.beginPath();
  g.roundRect(-0.06, -0.3, 0.13, 0.4, 0.065);
  g.fill();
  g.restore();
  g.restore();
}

function arrowIcon(g: G2D, cx: number, cy: number, s: number): void {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.lineWidth = 0.16;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-0.4, 0.45);
  g.lineTo(-0.4, -0.05);
  g.quadraticCurveTo(-0.4, -0.25, -0.2, -0.25);
  g.lineTo(0.2, -0.25);
  g.stroke();
  g.beginPath();
  g.moveTo(0.45, -0.25);
  g.lineTo(0.12, -0.5);
  g.lineTo(0.12, 0.0);
  g.closePath();
  g.fill();
  g.restore();
}

function scanlines(g: G2D, x: number, y: number, w: number, h: number, color: string): void {
  g.save();
  g.globalAlpha = 0.22;
  g.fillStyle = color;
  for (let yy = y; yy < y + h; yy += 6) g.fillRect(x, yy, w, 2);
  g.restore();
}

function stripes(g: G2D, x: number, y: number, w: number, h: number, a: string, b: string, n: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = a;
  g.fillRect(x, y, w, h);
  g.fillStyle = b;
  const step = w / n;
  for (let k = -n; k < n * 2; k++) {
    const x0 = x + k * step;
    g.beginPath();
    g.moveTo(x0, y + h);
    g.lineTo(x0 + step * 0.5, y + h);
    g.lineTo(x0 + step * 0.5 + h, y);
    g.lineTo(x0 + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function signPlate(g: G2D, col: number, row: number, bg: string, border: string): [number, number] {
  const [x, y] = cellOrigin(col, row);
  const S = ATLAS_CELL;
  g.fillStyle = border;
  g.fillRect(x, y, S, S);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x + 18, y + 18, S - 36, S - 36, 22);
  g.fill();
  return [x + S / 2, y + S / 2];
}

function holoPlate(g: G2D, col: number, row: number, w: number, glow: string): [number, number] {
  const [x, y] = cellOrigin(col, row);
  const W = ATLAS_CELL * w;
  const S = ATLAS_CELL;
  g.fillStyle = '#07040d';
  g.fillRect(x, y, W, S);
  g.strokeStyle = glow;
  g.lineWidth = 10;
  g.shadowColor = glow;
  g.shadowBlur = 18;
  g.strokeRect(x + 14, y + 14, W - 28, S - 28);
  g.shadowBlur = 0;
  return [x + W / 2, y + S / 2];
}

function drawAtlas(g: G2D): void {
  const S = ATLAS_CELL;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  // road signs (row 0/1)
  let [cx, cy] = signPlate(g, 1, 0, '#ffc21a', '#1d1d1d');
  biohazard(g, cx, cy + 4, 86, '#1d1d1d', '#ffc21a');
  [cx, cy] = signPlate(g, 2, 0, '#ffc21a', '#1d1d1d');
  g.fillStyle = '#1d1d1d';
  g.strokeStyle = '#1d1d1d';
  zombieIcon(g, cx - 18, cy + 8, 120);
  [cx, cy] = signPlate(g, 3, 0, '#d8302c', '#f4f1ea');
  g.fillStyle = '#f4f1ea';
  handIcon(g, cx, cy + 6, 130);
  [cx, cy] = signPlate(g, 0, 1, '#ff8a1f', '#1d1d1d');
  g.fillStyle = '#1d1d1d';
  g.strokeStyle = '#1d1d1d';
  arrowIcon(g, cx, cy, 150);

  // holograms
  [cx, cy] = holoPlate(g, 1, 1, 1, '#ffb020');
  g.shadowColor = '#ff9a1a';
  g.shadowBlur = 16;
  biohazard(g, cx, cy, 78, '#ffb020', '#07040d');
  g.shadowBlur = 0;
  scanlines(g, cx - S / 2, cy - S / 2, S, S, '#ffb020');
  [cx, cy] = holoPlate(g, 2, 1, 1, '#7dff5a');
  g.shadowColor = '#7dff5a';
  g.shadowBlur = 16;
  g.fillStyle = '#7dff5a';
  g.strokeStyle = '#7dff5a';
  zombieIcon(g, cx - 16, cy + 10, 118);
  g.shadowBlur = 0;
  scanlines(g, cx - S / 2, cy - S / 2, S, S, '#7dff5a');
  [cx, cy] = holoPlate(g, 3, 1, 1, '#ff3b3b');
  g.shadowColor = '#ff3b3b';
  g.shadowBlur = 16;
  g.fillStyle = '#ff4a4a';
  handIcon(g, cx, cy + 8, 120);
  g.shadowBlur = 0;
  scanlines(g, cx - S / 2, cy - S / 2, S, S, '#ff4a4a');
  [cx, cy] = holoPlate(g, 3, 2, 1, '#34e8ff');
  g.shadowColor = '#34e8ff';
  g.shadowBlur = 16;
  g.fillStyle = '#34e8ff';
  g.strokeStyle = '#34e8ff';
  arrowIcon(g, cx, cy, 140);
  g.shadowBlur = 0;
  scanlines(g, cx - S / 2, cy - S / 2, S, S, '#34e8ff');

  // stained-glass rose window
  {
    const [x, y] = cellOrigin(0, 2);
    g.fillStyle = '#3a3542';
    g.fillRect(x, y, S, S);
    const ccx = x + S / 2;
    const ccy = y + S / 2;
    const cols = ['#8a4dff', '#5cff7a', '#ffb13a', '#3ad6ff', '#ff5ab8', '#b6ff4a'];
    for (let k = 0; k < 12; k++) {
      g.fillStyle = cols[k % cols.length];
      g.beginPath();
      g.moveTo(ccx, ccy);
      g.arc(ccx, ccy, 116, (k / 12) * Math.PI * 2, ((k + 1) / 12) * Math.PI * 2);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#1c1820';
    g.lineWidth = 8;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(ccx, ccy);
      g.lineTo(ccx + Math.cos(a) * 116, ccy + Math.sin(a) * 116);
      g.stroke();
    }
    for (const r of [40, 80, 116]) {
      g.beginPath();
      g.arc(ccx, ccy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#ffe07a';
    g.beginPath();
    g.arc(ccx, ccy, 30, 0, Math.PI * 2);
    g.fill();
  }

  // hazard stripes
  {
    const [x, y] = cellOrigin(1, 2);
    stripes(g, x, y, S, S, '#ffc21a', '#1d1d1d', 4);
    const [x2, y2] = cellOrigin(2, 2);
    stripes(g, x2, y2, S, S, '#f4f1ea', '#d8302c', 4);
  }

  // wide hologram: quarantine warning
  {
    const [x, y] = cellOrigin(0, 3);
    const W = S * 2;
    g.fillStyle = '#07040d';
    g.fillRect(x, y, W, S);
    stripes(g, x, y, W, 34, '#ffc21a', '#07040d', 12);
    stripes(g, x, y + S - 34, W, 34, '#ffc21a', '#07040d', 12);
    g.shadowColor = '#ff9a1a';
    g.shadowBlur = 20;
    biohazard(g, x + 128, y + S / 2, 84, '#ffb020', '#07040d');
    g.shadowColor = '#7dff5a';
    g.fillStyle = '#7dff5a';
    g.strokeStyle = '#7dff5a';
    // warning triangle around a zombie
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(x + 384, y + 52);
    g.lineTo(x + 480, y + 206);
    g.lineTo(x + 288, y + 206);
    g.closePath();
    g.stroke();
    zombieIcon(g, x + 376, y + 150, 72);
    g.shadowBlur = 0;
    scanlines(g, x, y, W, S, '#ffe0a0');
  }

  // lit window with a zombie silhouette
  {
    const [x, y] = cellOrigin(2, 3);
    g.fillStyle = '#1a1d16';
    g.fillRect(x, y, S, S);
    const grd = g.createLinearGradient(x, y, x, y + S);
    grd.addColorStop(0, '#d6ff8a');
    grd.addColorStop(1, '#58c93a');
    g.fillStyle = grd;
    g.fillRect(x + 24, y + 24, S - 48, S - 48);
    g.fillStyle = '#10140c';
    g.beginPath();
    g.arc(x + S / 2, y + 120, 42, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.roundRect(x + S / 2 - 62, y + 160, 124, 90, 30);
    g.fill();
    g.lineWidth = 22;
    g.lineCap = 'round';
    g.strokeStyle = '#10140c';
    g.beginPath();
    g.moveTo(x + S / 2 - 50, y + 180);
    g.lineTo(x + S / 2 - 86, y + 70);
    g.moveTo(x + S / 2 + 50, y + 180);
    g.lineTo(x + S / 2 + 90, y + 78);
    g.stroke();
  }

  // moon + bat emblem (dark iron plate)
  {
    const [x, y] = cellOrigin(3, 3);
    g.fillStyle = '#2b2733';
    g.fillRect(x, y, S, S);
    g.fillStyle = '#ffe9a0';
    g.beginPath();
    g.arc(x + S / 2, y + S / 2, 96, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2733';
    g.beginPath();
    g.arc(x + S / 2 + 44, y + S / 2 - 22, 84, 0, Math.PI * 2);
    g.fill();
    // bat
    g.fillStyle = '#15121a';
    const bx = x + S / 2 - 12;
    const by = y + S / 2 + 20;
    g.beginPath();
    g.moveTo(bx, by - 18);
    g.quadraticCurveTo(bx - 40, by - 50, bx - 92, by - 30);
    g.quadraticCurveTo(bx - 70, by - 18, bx - 70, by + 2);
    g.quadraticCurveTo(bx - 50, by - 10, bx - 34, by + 8);
    g.quadraticCurveTo(bx - 20, by - 4, bx, by + 22);
    g.quadraticCurveTo(bx + 20, by - 4, bx + 34, by + 8);
    g.quadraticCurveTo(bx + 50, by - 10, bx + 70, by + 2);
    g.quadraticCurveTo(bx + 70, by - 18, bx + 92, by - 30);
    g.quadraticCurveTo(bx + 40, by - 50, bx, by - 18);
    g.fill();
    g.beginPath();
    g.moveTo(bx - 10, by - 14);
    g.lineTo(bx - 14, by - 34);
    g.lineTo(bx - 3, by - 22);
    g.lineTo(bx + 3, by - 22);
    g.lineTo(bx + 14, by - 34);
    g.lineTo(bx + 10, by - 14);
    g.fill();
  }
}

// =====================================================================================
// Prop templates (local space: feet at y = 0, front faces -Z)
// =====================================================================================

export interface ZombieLook {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  pose: 'reach' | 'up' | 'wave';
  surprised?: boolean;
  eyeGlow?: number;
  eyeColor?: number;
  /** Low-poly silhouette for distant crowds. */
  lod?: boolean;
}

/** A friendly cartoon zombie (about 2.1 m tall). */
export function zombieParts(look: ZombieLook): GlowPart[] {
  const P: GlowPart[] = [];
  const lod = look.lod === true;
  const B = (r: number, w: number, h: number): THREE.BufferGeometry => (lod ? ball(r, Math.max(4, w >> 1), Math.max(3, h >> 1)) : ball(r, w, h));
  const armSeg = lod ? 4 : 6;
  for (const sx of [-1, 1]) {
    P.push({ geo: box(0.2, 0.78, 0.22).translate(sx * 0.13, 0.43, sx * 0.04), color: look.pants });
    P.push({ geo: box(0.24, 0.12, 0.36).translate(sx * 0.13, 0.06, -0.05 + sx * 0.04), color: 0x3a2e26 });
  }
  const torso = box(0.58, 0.72, 0.34);
  torso.rotateX(0.16);
  torso.translate(0, 1.16, -0.04);
  P.push({ geo: torso, color: look.shirt });
  for (let k = 0; k < (lod ? 0 : 3); k++) {
    const hem = cone(0.08, 0.18, 3);
    hem.rotateX(Math.PI);
    hem.translate(-0.18 + k * 0.18, 0.76, -0.1);
    P.push({ geo: hem, color: look.shirt });
  }
  if (!lod) P.push({ geo: box(0.17, 0.16, 0.03).translate(0.13, 1.22, -0.24), color: 0xc9a36a });
  P.push({ geo: cyl(0.08, 0.09, 0.14, armSeg).translate(0, 1.56, -0.08), color: look.skin });

  const head: GlowPart[] = [];
  head.push({ geo: B(0.28, 12, 10).scale(1, 1.05, 0.95).translate(0.02, 1.82, -0.1), color: look.skin });
  const bigR = look.surprised ? 0.1 : 0.095;
  const smallR = look.surprised ? 0.1 : 0.062;
  if (!lod) {
    head.push({ geo: ball(0.12, 8, 6).scale(1, 0.75, 0.4).translate(-0.1, 1.83, -0.3), color: 0x6a5a7a });
    head.push({ geo: ball(0.1, 8, 6).scale(1, 0.75, 0.4).translate(0.12, 1.82, -0.3), color: 0x6a5a7a });
  }
  head.push({ geo: B(bigR, 8, 6).translate(-0.1, 1.88, -0.33), color: 0xffffff });
  head.push({ geo: B(smallR, 8, 6).translate(0.12, 1.86, -0.34), color: 0xffffff });
  const eyeCol = look.eyeColor ?? 0x16121a;
  head.push({ geo: B(0.042, 6, 5).translate(-0.09, 1.88, -0.42), color: eyeCol, glow: look.eyeGlow });
  head.push({ geo: B(0.03, 6, 5).translate(0.12, 1.86, -0.4), color: eyeCol, glow: look.eyeGlow });
  if (lod) {
    head.push({ geo: box(0.22, 0.05, 0.05).translate(0.02, 1.68, -0.36), color: 0x2a1418 });
  } else if (look.surprised) {
    head.push({ geo: ball(0.07, 8, 6).scale(1, 1.2, 0.5).translate(0.02, 1.66, -0.35), color: 0x2a1418 });
  } else {
    head.push({ geo: box(0.22, 0.05, 0.05).translate(0.02, 1.68, -0.36), color: 0x2a1418 });
    head.push({ geo: box(0.045, 0.06, 0.03).translate(-0.04, 1.7, -0.39), color: 0xf6f0d8 });
    head.push({ geo: box(0.04, 0.05, 0.03).translate(0.07, 1.69, -0.39), color: 0xf6f0d8 });
  }
  // forehead stitches
  const seam = box(0.2, 0.022, 0.03);
  seam.rotateZ(0.25);
  seam.translate(0.0, 2.0, -0.3);
  if (!lod) head.push({ geo: seam, color: 0x2a2030 });
  for (let k = 0; k < (lod ? 0 : 3); k++) {
    head.push({ geo: box(0.018, 0.07, 0.03).translate(-0.07 + k * 0.07, 1.99 + k * 0.018, -0.305), color: 0x2a2030 });
  }
  for (let k = 0; k < (lod ? 2 : 4); k++) {
    const tuft = cone(0.06, 0.2, 4);
    tuft.rotateZ((k - 1.5) * 0.45);
    tuft.translate(-0.12 + k * 0.08, 2.1, -0.02);
    head.push({ geo: tuft, color: look.hair });
  }
  for (const h of head) {
    h.geo.translate(0, -1.82, 0);
    h.geo.rotateZ(0.14);
    h.geo.translate(0, 1.82, 0);
    P.push(h);
  }

  const arm = (sx: number, up: boolean): void => {
    if (up) {
      P.push({ geo: cyl(0.075, 0.075, 0.62, armSeg).translate(sx * 0.4, 1.72, -0.05), color: look.skin });
      P.push({ geo: cyl(0.1, 0.1, 0.24, armSeg).translate(sx * 0.4, 1.46, -0.05), color: look.shirt });
      P.push({ geo: B(0.1, 8, 6).scale(1, 1.2, 0.6).translate(sx * 0.4, 2.08, -0.05), color: look.skin });
      if (!lod) P.push({ geo: box(0.17, 0.07, 0.17).translate(sx * 0.4, 1.76, -0.05), color: 0xf2efe6 });
    } else {
      const a = cyl(0.075, 0.075, 0.62, armSeg);
      a.rotateX(Math.PI / 2);
      a.translate(sx * 0.38, 1.38, -0.42);
      P.push({ geo: a, color: look.skin });
      const sl = cyl(0.1, 0.1, 0.26, armSeg);
      sl.rotateX(Math.PI / 2);
      sl.translate(sx * 0.38, 1.38, -0.2);
      P.push({ geo: sl, color: look.shirt });
      P.push({ geo: B(0.1, 8, 6).scale(1, 0.6, 1.2).translate(sx * 0.38, 1.38, -0.78), color: look.skin });
      if (sx > 0 && !lod) P.push({ geo: box(0.17, 0.17, 0.07).translate(sx * 0.38, 1.38, -0.5), color: 0xf2efe6 });
    }
  };
  arm(-1, look.pose === 'up' || look.pose === 'wave');
  arm(1, look.pose === 'up');
  return P;
}

/** Crooked leafless tree (~6 m). */
export function bareTreeParts(seed: number, bark: number, twig: number): GlowPart[] {
  const r = seededRandom(seed);
  const P: GlowPart[] = [];
  const H = 4.6 + r() * 1.2;
  const bendX = (r() - 0.5) * 1.6;
  const bendZ = (r() - 0.5) * 0.8;
  const trunk = new THREE.CylinderGeometry(0.18, 0.46, H, 6, 5, true);
  const pos = trunk.getAttribute('position') as THREE.BufferAttribute;
  for (let v = 0; v < pos.count; v++) {
    const k = (pos.getY(v) + H / 2) / H;
    pos.setX(v, pos.getX(v) + bendX * k * k + Math.sin(k * 7) * 0.08);
    pos.setZ(v, pos.getZ(v) + bendZ * Math.sin(k * Math.PI));
  }
  trunk.translate(0, H / 2, 0);
  trunk.computeVertexNormals();
  P.push({ geo: trunk, color: bark });
  const branch = (x: number, y: number, z: number, yaw: number, pitch: number, len: number, rad: number, depth: number): void => {
    const b = new THREE.CylinderGeometry(rad * 0.35, rad, len, 4, 1, true);
    b.translate(0, len / 2, 0);
    b.rotateZ(-pitch);
    b.rotateY(yaw);
    b.translate(x, y, z);
    P.push({ geo: b, color: depth === 0 ? bark : twig });
    if (depth >= 2) return;
    const ex = x + Math.sin(pitch) * Math.cos(yaw) * len;
    const ey = y + Math.cos(pitch) * len;
    const ez = z - Math.sin(pitch) * Math.sin(yaw) * len;
    const kids = depth === 0 ? 2 : 1;
    for (let k = 0; k < kids; k++) {
      const f = 0.55 + r() * 0.35;
      const bx = x + (ex - x) * f;
      const by = y + (ey - y) * f;
      const bz = z + (ez - z) * f;
      branch(bx, by, bz, yaw + (r() - 0.5) * 1.8, Math.min(1.7, pitch + (r() - 0.3) * 0.9), len * (0.45 + r() * 0.2), rad * 0.5, depth + 1);
    }
  };
  const topX = bendX;
  const topZ = 0;
  const count = 4 + Math.floor(r() * 2);
  for (let k = 0; k < count; k++) {
    const f = 0.45 + (k / count) * 0.5;
    const yaw = (k / count) * Math.PI * 2 + r() * 0.8;
    branch(bendX * f * f, H * f, bendZ * Math.sin(f * Math.PI), yaw, 0.7 + r() * 0.5, 1.6 + r() * 1.2, 0.16, 0);
  }
  branch(topX, H - 0.1, topZ, r() * Math.PI * 2, 0.25 + r() * 0.3, 1.4 + r(), 0.13, 0);
  return P;
}

/** Jack-o'-lantern with a glowing grin (front -Z). */
export function pumpkinParts(face: number): GlowPart[] {
  const P: GlowPart[] = [];
  const body = new THREE.SphereGeometry(0.55, 14, 9);
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const z = pos.getZ(v);
    const k = 0.9 + 0.1 * Math.abs(Math.cos(Math.atan2(z, x) * 4));
    pos.setX(v, x * k);
    pos.setZ(v, z * k);
    pos.setY(v, pos.getY(v) * 0.78);
  }
  body.computeVertexNormals();
  body.translate(0, 0.43, 0);
  P.push({ geo: body, color: 0xff7a1c });
  const stem = cyl(0.05, 0.08, 0.26, 5);
  stem.rotateZ(0.3);
  stem.translate(0.03, 0.9, 0);
  P.push({ geo: stem, color: 0x4d6b2a });
  for (const sx of [-1, 1]) {
    const eye = cone(0.12, 0.08, 3);
    eye.rotateX(-Math.PI / 2);
    eye.rotateZ(Math.PI);
    eye.translate(sx * 0.19, 0.55, -0.48);
    P.push({ geo: eye, color: face, glow: 2.2 });
  }
  const nose = cone(0.06, 0.06, 3);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0.42, -0.53);
  P.push({ geo: nose, color: face, glow: 2.2 });
  P.push({ geo: box(0.44, 0.1, 0.08).translate(0, 0.28, -0.5), color: face, glow: 2.2 });
  P.push({ geo: box(0.08, 0.06, 0.1).translate(-0.1, 0.34, -0.5), color: face, glow: 2.2 });
  P.push({ geo: box(0.08, 0.06, 0.1).translate(0.12, 0.23, -0.5), color: face, glow: 2.2 });
  return P;
}

/** Headstone variants: 0 rounded, 1 cross, 2 obelisk, 3 wooden cross. Includes the grave mound. */
export function gravestoneParts(variant: number, stone: number): GlowPart[] {
  const P: GlowPart[] = [];
  const dark = new THREE.Color(stone).offsetHSL(0, 0, -0.14);
  const mound = ball(0.6, 7, 4);
  mound.scale(0.95, 0.3, 1.55);
  mound.translate(0, 0, -1.15);
  P.push({ geo: mound, color: 0x5a4632 });
  if (variant === 0) {
    P.push({ geo: box(1.3, 0.2, 0.5).translate(0, 0.1, 0), color: dark });
    P.push({ geo: box(1.0, 1.0, 0.24).translate(0, 0.7, 0), color: stone });
    const top = cyl(0.5, 0.5, 0.22, 10);
    top.rotateX(Math.PI / 2);
    top.translate(0, 1.2, 0);
    P.push({ geo: top, color: stone });
    P.push({ geo: box(0.46, 0.08, 0.04).translate(0, 1.12, -0.12), color: dark });
    P.push({ geo: box(0.08, 0.36, 0.04).translate(0, 1.02, -0.12), color: dark });
    const crack = box(0.03, 0.34, 0.04);
    crack.rotateZ(0.5);
    crack.translate(0.28, 0.55, -0.12);
    P.push({ geo: crack, color: dark });
    P.push({ geo: ball(0.16, 6, 4).scale(1.4, 0.6, 1).translate(-0.4, 1.15, -0.02), color: 0x5f8a45 });
  } else if (variant === 1) {
    P.push({ geo: box(0.8, 0.36, 0.55).translate(0, 0.18, 0), color: dark });
    P.push({ geo: box(0.24, 1.9, 0.22).translate(0, 1.3, 0), color: stone });
    P.push({ geo: box(1.0, 0.24, 0.22).translate(0, 1.72, 0), color: stone });
  } else if (variant === 2) {
    P.push({ geo: box(1.0, 0.4, 1.0).translate(0, 0.2, 0), color: dark });
    P.push({ geo: cyl(0.26, 0.36, 2.1, 4).rotateY(Math.PI / 4).translate(0, 1.45, 0), color: stone });
    P.push({ geo: cone(0.3, 0.55, 4).rotateY(Math.PI / 4).translate(0, 2.77, 0), color: stone });
  } else {
    P.push({ geo: box(0.16, 1.5, 0.14).translate(0, 0.72, 0), color: 0x6b4a2e });
    const arm = box(0.8, 0.14, 0.12);
    arm.rotateZ(0.12);
    arm.translate(0, 1.08, -0.02);
    P.push({ geo: arm, color: 0x7a5534 });
  }
  return P;
}

/** Cartoon zombie hand poking out of a dirt mound (front -Z). */
export function handParts(skin: number, sleeve: number): GlowPart[] {
  const P: GlowPart[] = [];
  P.push({ geo: ball(0.5, 9, 5).scale(1, 0.32, 1).translate(0, 0, 0), color: 0x4e3b2a });
  P.push({ geo: cyl(0.1, 0.12, 0.62, 7).translate(0, 0.36, 0), color: skin });
  P.push({ geo: cyl(0.15, 0.17, 0.2, 7).translate(0, 0.14, 0), color: sleeve });
  P.push({ geo: cyl(0.125, 0.125, 0.07, 7).translate(0, 0.52, 0), color: 0xf2efe6 });
  P.push({ geo: box(0.3, 0.3, 0.12).translate(0, 0.78, 0), color: skin });
  for (let k = 0; k < 4; k++) {
    const f = cyl(0.036, 0.042, 0.24 - Math.abs(k - 1.5) * 0.03, 5);
    f.translate(0, 0.12, 0);
    f.rotateZ((k - 1.5) * -0.16);
    f.translate(-0.11 + k * 0.073, 0.92, 0);
    P.push({ geo: f, color: skin });
  }
  const thumb = cyl(0.04, 0.045, 0.2, 5);
  thumb.translate(0, 0.1, 0);
  thumb.rotateZ(-1.0);
  thumb.translate(0.14, 0.72, 0);
  P.push({ geo: thumb, color: skin });
  return P;
}

/** Rusty oil drum; `band` adds a hazard stripe, `goo` a glowing drip. */
export function barrelParts(paint: number, band: boolean, goo: boolean): GlowPart[] {
  const P: GlowPart[] = [];
  P.push({ geo: cyl(0.34, 0.34, 0.92, 10).translate(0, 0.46, 0), color: paint });
  const rim = new THREE.Color(paint).offsetHSL(0, 0, -0.12);
  P.push({ geo: cyl(0.36, 0.36, 0.05, 10, true).translate(0, 0.3, 0), color: rim });
  P.push({ geo: cyl(0.36, 0.36, 0.05, 10, true).translate(0, 0.64, 0), color: rim });
  if (band) P.push({ geo: stripeByAngle(cyl(0.352, 0.352, 0.2, 16, true).translate(0, 0.47, 0), 0x1d1d1d, 0xffc21a, 5), color: 0xffffff, keepColor: true });
  if (goo) {
    P.push({ geo: cyl(0.22, 0.22, 0.03, 10).translate(0.02, 0.93, 0), color: 0x7dff4a, glow: 1.4 });
    P.push({ geo: cyl(0.05, 0.03, 0.34, 5).translate(0.3, 0.78, -0.16), color: 0x7dff4a, glow: 1.4 });
  }
  return P;
}

/** Abandoned rusty car (front -Z). */
export function carParts(paint: number): GlowPart[] {
  const P: GlowPart[] = [];
  const rust = 0x7a4020;
  P.push({ geo: box(1.9, 0.66, 4.3).translate(0, 0.72, 0), color: paint });
  P.push({ geo: box(1.66, 0.56, 2.0).translate(0, 1.33, 0.3), color: 0x2a3036 });
  P.push({ geo: box(1.74, 0.1, 2.1).translate(0, 1.64, 0.3), color: paint });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.push({ geo: box(0.1, 0.56, 0.1).translate(sx * 0.82, 1.33, 0.3 + sz * 0.98), color: paint });
    }
  }
  P.push({ geo: box(2.0, 0.22, 0.2).translate(0, 0.46, -2.18), color: 0x5a4a40 });
  P.push({ geo: box(2.0, 0.22, 0.2).translate(0, 0.46, 2.18), color: 0x5a4a40 });
  for (const sx of [-1, 1]) {
    P.push({ geo: box(0.36, 0.18, 0.06).translate(sx * 0.62, 0.84, -2.16), color: 0xe8dcb0 });
    P.push({ geo: box(0.02, 0.4, 0.9).translate(sx * 0.955, 0.7, -0.6 + sx * 0.8), color: rust });
  }
  P.push({ geo: box(0.7, 0.02, 0.8).translate(0.3, 1.056, -1.3), color: rust });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = cyl(0.38, 0.38, 0.28, 9);
      w.rotateZ(Math.PI / 2);
      if (sx > 0 && sz > 0) w.scale(1, 0.72, 1);
      w.translate(sx * 0.9, sx > 0 && sz > 0 ? 0.28 : 0.38, sz * 1.38);
      P.push({ geo: w, color: 0x1e1e20 });
    }
  }
  return P;
}

/** Leaning road sign with a pictogram plate (front -Z). */
export function signParts(cell: UvRect, size = 1.3, pole = 2.6): GlowPart[] {
  const P: GlowPart[] = [];
  P.push({ geo: cyl(0.05, 0.06, pole + size * 0.5, 6).translate(0, (pole + size * 0.5) / 2, 0.06), color: 0x8a8f96 });
  P.push({ geo: box(size + 0.08, size + 0.08, 0.05).translate(0, pole, 0), color: 0x5d6168 });
  const plate = new THREE.PlaneGeometry(size, size);
  plate.rotateY(Math.PI);
  plate.translate(0, pole, -0.08);
  P.push({ geo: plate, color: 0xffffff, uv: cell });
  return P;
}

/** Stack of old tyres. */
export function tyreStackParts(n: number): GlowPart[] {
  const P: GlowPart[] = [];
  for (let k = 0; k < n; k++) {
    const t = new THREE.TorusGeometry(0.34, 0.14, 5, 9);
    t.rotateX(Math.PI / 2);
    t.translate((k % 2) * 0.05, 0.14 + k * 0.27, 0);
    P.push({ geo: t, color: 0x1f1f22 });
  }
  return P;
}

/** Army tent with a snowy ridge (front -Z = door). */
export function tentParts(canvas: number, snow: boolean): GlowPart[] {
  const P: GlowPart[] = [];
  const W = 3.4;
  const L = 4.4;
  const H = 2.3;
  const slope = Math.hypot(W / 2, H);
  const ang = Math.atan2(H, W / 2);
  for (const s of [-1, 1]) {
    const panel = box(slope, 0.06, L);
    panel.rotateZ(-s * ang);
    panel.translate((s * W) / 4, H / 2, 0);
    P.push({ geo: panel, color: canvas });
    if (snow) {
      const cap = box(slope * 0.55, 0.14, L + 0.1);
      cap.rotateZ(-s * ang);
      cap.translate((s * W) / 4 * 0.55, H * 0.72 + 0.08, 0);
      P.push({ geo: cap, color: 0xf4f9ff });
    }
  }
  for (const zs of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-W / 2, 0);
    shape.lineTo(W / 2, 0);
    shape.lineTo(0, H);
    shape.closePath();
    const tri = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    tri.translate(0, 0, zs * (L / 2 - 0.02) - 0.025);
    P.push({ geo: tri, color: new THREE.Color(canvas).offsetHSL(0, 0, -0.06) });
  }
  P.push({ geo: box(0.9, 1.4, 0.05).translate(0, 0.7, -L / 2 - 0.03), color: 0x2a2a22 });
  P.push({ geo: box(0.08, 2.5, 0.08).translate(0, 1.25, -L / 2 - 0.1), color: 0x4a4038 });
  return P;
}

/** Wooden crate. */
export function crateParts(c: number): GlowPart[] {
  const P: GlowPart[] = [{ geo: box(1, 1, 1).translate(0, 0.5, 0), color: c }];
  const d = new THREE.Color(c).offsetHSL(0, 0, -0.12);
  for (const sz of [-1, 1]) {
    const plank = box(1.2, 0.12, 0.04);
    plank.rotateZ(0.78);
    plank.translate(0, 0.5, sz * 0.51);
    P.push({ geo: plank, color: d });
  }
  return P;
}

/** Quarantine tape strung between posts along a local X run of `len` metres. */
export function tapeFenceParts(len: number, yellow = true): GlowPart[] {
  const P: GlowPart[] = [];
  const posts = Math.max(2, Math.round(len / 3) + 1);
  const step = len / (posts - 1);
  for (let k = 0; k < posts; k++) {
    const x = -len / 2 + k * step;
    P.push({ geo: cyl(0.05, 0.06, 1.2, 4, true).translate(x, 0.6, 0), color: 0xe8e2d0 });
    P.push({ geo: box(0.36, 0.08, 0.36).translate(x, 0.04, 0), color: 0x3a3a3a });
  }
  const segs = Math.max(4, Math.round(len / 0.9));
  for (let k = 0; k < segs; k++) {
    const x0 = -len / 2 + (k / segs) * len;
    const x1 = -len / 2 + ((k + 1) / segs) * len;
    const f = ((x0 + x1) / 2 + len / 2) / step;
    const sag = Math.sin((f - Math.floor(f)) * Math.PI) * 0.1;
    const seg = box(x1 - x0 + 0.01, 0.12, 0.015);
    seg.translate((x0 + x1) / 2, 1.02 - sag, 0);
    P.push({ geo: seg, color: k % 2 === 0 ? (yellow ? 0xffc21a : 0xf4f1ea) : yellow ? 0x1d1d1d : 0xd8302c });
  }
  return P;
}

/** Floodlight mast with a glowing lamp head facing -Z. */
export function floodlightParts(h: number): GlowPart[] {
  const P: GlowPart[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const leg = cyl(0.05, 0.07, h, 5);
    leg.translate(0, h / 2, 0);
    leg.rotateZ(0.08);
    leg.rotateY(a);
    P.push({ geo: leg, color: 0x4a4e56 });
  }
  P.push({ geo: box(1.6, 0.12, 0.12).translate(0, h, 0), color: 0x3a3e46 });
  for (const sx of [-0.5, 0.5]) {
    const head = box(0.6, 0.5, 0.4);
    head.rotateX(0.35);
    head.translate(sx, h + 0.1, -0.1);
    P.push({ geo: head, color: 0x2a2d33 });
    const lens = box(0.5, 0.4, 0.04);
    lens.rotateX(0.35);
    lens.translate(sx, h + 0.04, -0.32);
    P.push({ geo: lens, color: 0xfff6d8, glow: 2.5 });
  }
  return P;
}

/** Striped road barricade on A-frame legs (front -Z). */
export function barricadeParts(): GlowPart[] {
  const P: GlowPart[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = box(0.08, 1.2, 0.08);
      leg.rotateX(sz * 0.28);
      leg.translate(sx * 0.9, 0.58, sz * 0.16);
      P.push({ geo: leg, color: 0x2a2a30 });
    }
  }
  P.push({ geo: box(2.2, 0.3, 0.06).translate(0, 0.95, -0.02), color: 0xffffff, uv: CELLS.stripesRed });
  P.push({ geo: box(2.2, 0.26, 0.06).translate(0, 0.5, -0.02), color: 0xffffff, uv: CELLS.stripesYellow });
  P.push({ geo: box(0.2, 0.16, 0.2).translate(-0.9, 1.18, 0), color: 0x2a2a30 });
  P.push({ geo: ball(0.11, 6, 4).translate(-0.9, 1.3, 0), color: 0xffa21a, glow: 2.6 });
  return P;
}

/** Concrete block with a painted hazard band. */
export function concreteBlockParts(): GlowPart[] {
  return [
    { geo: box(2.0, 0.8, 0.7).translate(0, 0.4, 0), color: 0x8f8c86 },
    { geo: box(2.02, 0.24, 0.72).translate(0, 0.55, 0), color: 0xffffff, uv: CELLS.stripesYellow },
  ];
}

// =====================================================================================
// Theme builders
// =====================================================================================

/** Themed decorations: batched templates, a handful of draw calls per theme. */
export function buildDecorations(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'decor';
  switch (ctx.def.theme) {
    case 'desert':
    case 'volcano':
      buildDesert(ctx, group);
      break;
    case 'snow':
      buildSnow(ctx, group);
      break;
    case 'neon':
      buildNeon(ctx, group);
      break;
    default:
      buildGraveyard(ctx, group);
  }
  return group;
}

/** Rotate local (lx, lz) by yaw and offset to world. */
function localToWorld(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

function addBatch(group: THREE.Group, mesh: THREE.Mesh | null): void {
  if (mesh) group.add(mesh);
}

// ------------------------------------------------------------------ graveyard (grassland)
function buildGraveyard(ctx: BuildContext, group: THREE.Group): void {
  const { rng, field } = ctx;
  const reject = makeFootprintReject(ctx);
  const big = new PropBatch();
  const small = new PropBatch();
  const templates: THREE.BufferGeometry[] = [];
  const T = (parts: GlowPart[]): THREE.BufferGeometry => {
    const g = mergeGlow(parts);
    templates.push(g);
    return g;
  };

  // crooked bare trees
  const trees = [T(bareTreeParts(11, 0x4a3d3a, 0x3c3236)), T(bareTreeParts(23, 0x564440, 0x40353a)), T(bareTreeParts(37, 0x3f3638, 0x352c30))];
  for (const p of scatter(ctx, 170, 3, 220, reject)) {
    big.add(trees[Math.floor(rng() * trees.length)], p.x, p.y - 0.15, p.z, rng() * Math.PI * 2, lerp(1.1, 1.7, rng()), (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12);
  }

  // grave plots in rows facing the road
  const stones = [0x9ea3ab, 0x8d9199, 0xa9a49a, 0x7f8a86];
  const graveT: THREE.BufferGeometry[][] = [0, 1, 2, 3].map((v) => stones.map((c) => T(gravestoneParts(v, c))));
  const centers = scatter(ctx, 52, 1, 60, reject);
  for (const c of centers) {
    const yaw = yawToTrack(ctx, c.x, c.z);
    const rows = 2 + Math.floor(rng() * 2);
    const cols = 3 + Math.floor(rng() * 3);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (rng() < 0.15) continue;
        const lx = (col - (cols - 1) / 2) * 2.9 + (rng() - 0.5) * 0.5;
        const lz = row * 4.0 + (rng() - 0.5) * 0.4;
        const [x, z] = localToWorld(c.x, c.z, yaw, lx, lz);
        if (wallClearance(ctx, x, z) < 3 || reject(x, z)) continue;
        const r = rng();
        const variant = r < 0.5 ? 0 : r < 0.75 ? 1 : r < 0.88 ? 2 : 3;
        const tmpl = graveT[variant][Math.floor(rng() * stones.length)];
        big.add(tmpl, x, field.heightAt(x, z) - 0.05, z, yaw + (rng() - 0.5) * 0.35, lerp(1.15, 1.5, rng()), (rng() - 0.5) * 0.22, (rng() - 0.5) * 0.25);
      }
    }
  }
  // lone graves close to the road
  for (const p of scatter(ctx, 70, 0.5, 22, reject)) {
    const variant = Math.floor(rng() * 4);
    big.add(graveT[variant][Math.floor(rng() * stones.length)], p.x, p.y - 0.05, p.z, yawToTrack(ctx, p.x, p.z) + (rng() - 0.5) * 0.5, lerp(1.2, 1.6, rng()), (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
  }

  // jack-o'-lanterns near the road
  const pumpkins = [T(pumpkinParts(0xffd23a)), T(pumpkinParts(0xb6ff4a))];
  for (const p of scatter(ctx, 70, 0, 26, reject)) {
    big.add(pumpkins[rng() < 0.8 ? 0 : 1], p.x, p.y - 0.08, p.z, yawToTrack(ctx, p.x, p.z) + (rng() - 0.5) * 0.7, lerp(0.9, 1.7, rng()));
  }

  // zombie hands poking out of the ground
  const hands = [T(handParts(0x8fcf6a, 0x6a4a7a)), T(handParts(0x9ad07a, 0x3f6f9a)), T(handParts(0x7fbf8a, 0x8a5a3a))];
  for (const p of scatter(ctx, 26, 1, 40, reject)) {
    big.add(hands[Math.floor(rng() * hands.length)], p.x, p.y - 0.05, p.z, yawToTrack(ctx, p.x, p.z) + (rng() - 0.5) * 0.8, lerp(1.4, 2.1, rng()), (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4);
  }

  // graveyard lanterns
  const lantern = T([
    { geo: cyl(0.07, 0.09, 2.6, 6).translate(0, 1.3, 0), color: 0x25232a },
    { geo: box(0.7, 0.07, 0.07).translate(0.3, 2.5, 0), color: 0x25232a },
    { geo: box(0.34, 0.44, 0.34).translate(0.55, 2.15, 0), color: 0xffcf6a, glow: 2.0 },
    { geo: cone(0.3, 0.26, 4).rotateY(Math.PI / 4).translate(0.55, 2.5, 0), color: 0x25232a },
    { geo: box(0.4, 0.05, 0.4).translate(0.55, 1.92, 0), color: 0x25232a },
  ]);
  for (const p of scatter(ctx, 26, 0, 14, reject)) {
    big.add(lantern, p.x, p.y - 0.1, p.z, rng() * Math.PI * 2, 1);
  }

  // small ground clutter: dry grass tufts + glowing toadstools
  const tuftParts: GlowPart[] = [];
  for (let k = 0; k < 5; k++) {
    const b = cone(0.07, 0.55 + (k % 3) * 0.12, 3);
    b.translate(0, 0.27, 0);
    b.rotateZ((k - 2) * 0.28);
    b.rotateY(k * 1.3);
    b.translate(Math.cos(k * 2.1) * 0.12, 0, Math.sin(k * 2.1) * 0.12);
    tuftParts.push({ geo: b, color: k % 2 === 0 ? 0x6d6b3a : 0x857a4a });
  }
  const tuft = T(tuftParts);
  const shroomParts = (capCol: number): GlowPart[] => {
    const P: GlowPart[] = [];
    for (let k = 0; k < 3; k++) {
      const x = Math.cos(k * 2.3) * 0.2;
      const z = Math.sin(k * 2.3) * 0.2;
      const h = 0.18 + k * 0.08;
      P.push({ geo: cyl(0.04, 0.05, h, 5).translate(x, h / 2, z), color: 0xe8e0d0 });
      P.push({ geo: new THREE.SphereGeometry(0.13 + k * 0.03, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, h, z), color: capCol, glow: 0.9 });
    }
    return P;
  };
  const shrooms = [T(shroomParts(0x9a5cff)), T(shroomParts(0x6dff7a))];
  for (const p of scatter(ctx, 260, 0, 30, reject).concat(scatter(ctx, 90, 30, 70, reject))) {
    small.add(tuft, p.x, p.y - 0.05, p.z, rng() * Math.PI * 2, lerp(0.9, 1.8, rng()));
  }
  for (const p of scatter(ctx, 60, 0, 40, reject)) {
    small.add(shrooms[rng() < 0.5 ? 0 : 1], p.x, p.y - 0.02, p.z, rng() * Math.PI * 2, lerp(1.0, 2.0, rng()));
  }

  for (const t of templates) t.dispose();
  addBatch(group, big.build(ctx, glowMaterial(null, { roughness: 0.9 }), 'graveyardProps', true, true));
  addBatch(group, small.build(ctx, glowMaterial(null, { roughness: 0.9 }), 'graveyardClutter', false, true));
}

// ------------------------------------------------------------------ doomsday highway (desert)
function buildDesert(ctx: BuildContext, group: THREE.Group): void {
  const { rng } = ctx;
  const reject = makeFootprintReject(ctx);
  const batch = new PropBatch();
  const templates: THREE.BufferGeometry[] = [];
  const T = (parts: GlowPart[]): THREE.BufferGeometry => {
    const g = mergeGlow(parts);
    templates.push(g);
    return g;
  };

  // a few surviving saguaros (dusty)
  const body = new THREE.CylinderGeometry(0.36, 0.46, 4.4, 8);
  body.translate(0, 2.2, 0);
  const cap = new THREE.SphereGeometry(0.36, 8, 6);
  cap.translate(0, 4.4, 0);
  const armL = new THREE.CylinderGeometry(0.22, 0.24, 1.5, 7);
  armL.rotateZ(Math.PI / 2);
  armL.translate(-0.9, 2.3, 0);
  const armLUp = new THREE.CylinderGeometry(0.22, 0.22, 1.6, 7);
  armLUp.translate(-1.55, 3.0, 0);
  const armLCap = new THREE.SphereGeometry(0.22, 7, 5);
  armLCap.translate(-1.55, 3.8, 0);
  const green = 0x5f7f4a;
  const cactusGeo = mergeParts([
    { geo: body, color: green },
    { geo: cap, color: 0x6b8a52 },
    { geo: armL, color: green },
    { geo: armLUp, color: green },
    { geo: armLCap, color: 0x6b8a52 },
  ]);
  cactusGeo.scale(1.4, 1.4, 1.4);
  const cactusPts = scatter(ctx, 55, 4, 160, reject);
  const cacti = makeInstanced(ctx, cactusGeo, stdMat({ roughness: 0.8 }), cactusPts.length, 'cacti');
  fillInstances(cacti, cactusPts, rng, 0.8, 1.2, -0.1, 0.1, (r) => _c.setHSL(0.22 + (r() - 0.5) * 0.05, 0.22, 0.42 + (r() - 0.5) * 0.1));
  group.add(cacti);

  // ash-dusted boulders
  const rockGeo = mergeParts([{ geo: new THREE.DodecahedronGeometry(1.1, 0), color: 0xa08a78 }]);
  const rockPts = scatter(ctx, 200, 0.5, 200, reject);
  const rocks = makeInstanced(ctx, rockGeo, stdMat({ roughness: 1 }), rockPts.length, 'rocks');
  fillInstances(rocks, rockPts, rng, 0.7, 3.4, -0.4, 0.6, (r) => _c.setHSL(0.06 + (r() - 0.5) * 0.03, 0.2, 0.45 + (r() - 0.5) * 0.16), true);
  group.add(rocks);

  // dead trees
  const trees = [T(bareTreeParts(5, 0x6e5f52, 0x5e5046)), T(bareTreeParts(17, 0x5a4a40, 0x4a3e36)), T(bareTreeParts(29, 0x7a6a5c, 0x62544a))];
  for (const p of scatter(ctx, 70, 1, 150, reject)) {
    batch.add(trees[Math.floor(rng() * trees.length)], p.x, p.y - 0.2, p.z, rng() * Math.PI * 2, lerp(0.8, 1.2, rng()), (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.2);
  }

  // abandoned cars, some in little jams near the road
  const cars = [0x5f8f8a, 0xa0524a, 0xb8964a, 0x7f95a8, 0xc9bfa6, 0x8a5a3a].map((c) => T(carParts(c)));
  for (const p of scatter(ctx, 34, 1, 45, reject)) {
    const yaw = yawToTrack(ctx, p.x, p.z) + Math.PI / 2 + (rng() - 0.5) * 1.2;
    batch.add(cars[Math.floor(rng() * cars.length)], p.x, p.y - 0.12 - rng() * 0.2, p.z, yaw, 1.25, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.14);
  }

  // barrels in clusters, some toxic
  const barrels = [T(barrelParts(0xe0b030, true, true)), T(barrelParts(0x8a4b2a, false, false)), T(barrelParts(0x3f6f9a, true, false)), T(barrelParts(0x8a4b2a, false, true))];
  for (const c of scatter(ctx, 30, 0.5, 35, reject)) {
    const n = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const x = c.x + (rng() - 0.5) * 2.4;
      const z = c.z + (rng() - 0.5) * 2.4;
      if (wallClearance(ctx, x, z) < 2.5) continue;
      const fallen = rng() < 0.2;
      batch.add(barrels[Math.floor(rng() * barrels.length)], x, ctx.field.heightAt(x, z) - (fallen ? -0.34 : 0.05), z, rng() * Math.PI * 2, 1.2, fallen ? Math.PI / 2 : (rng() - 0.5) * 0.12, 0);
    }
  }
  const tyres = [T(tyreStackParts(2)), T(tyreStackParts(4))];
  for (const p of scatter(ctx, 24, 0.5, 40, reject)) {
    batch.add(tyres[rng() < 0.5 ? 0 : 1], p.x, p.y - 0.05, p.z, rng() * Math.PI, 1.2, (rng() - 0.5) * 0.2, 0);
  }

  // bent warning signs facing oncoming traffic
  addRoadsideSigns(ctx, batch, T, 34, [CELLS.signZombie, CELLS.signBiohazard, CELLS.signArrow, CELLS.signHand], reject);

  for (const t of templates) t.dispose();
  addBatch(group, batch.build(ctx, glowMaterial(propAtlas(ctx), { roughness: 0.85 }), 'wastelandProps', true, true));
}

/** Signs just beyond the walls, turned toward karts approaching from behind. */
function addRoadsideSigns(
  ctx: BuildContext,
  batch: PropBatch,
  T: (parts: GlowPart[]) => THREE.BufferGeometry,
  count: number,
  cells: UvRect[],
  reject: (x: number, z: number) => boolean,
): void {
  const { cl, rng, def } = ctx;
  const signs = cells.map((c) => T(signParts(c)));
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count + (rng() - 0.5) * 0.01;
    const i = Math.floor(((t % 1) + 1) % 1 * cl.n) % cl.n;
    if (def.voidRanges && def.voidRanges.some(([a, b]) => t >= a - 0.02 && t <= b + 0.02)) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const lat = cl.whw[i] + 2.2 + rng() * 2.5;
    const x = cl.px[i] + cl.bx[i] * side * lat;
    const z = cl.pz[i] + cl.bz[i] * side * lat;
    const dxs = x - cl.px[0];
    const dzs = z - cl.pz[0];
    if (dxs * dxs + dzs * dzs < 55 * 55 || reject(x, z) || wallClearance(ctx, x, z) < 1.8) continue;
    const yaw = headingFromDir(-cl.tx[i], -cl.tz[i]) + side * 0.35;
    batch.add(signs[k % signs.length], x, ctx.field.heightAt(x, z) - 0.1, z, yaw, lerp(1.1, 1.4, rng()), (rng() - 0.5) * 0.18, (rng() - 0.5) * 0.25);
  }
}

// ------------------------------------------------------------------ frozen outbreak (snow)
function buildSnow(ctx: BuildContext, group: THREE.Group): void {
  const { rng } = ctx;
  const lowReject = (x: number, z: number): boolean => ctx.field.heightAt(x, z) < ctx.cl.minY - 8;
  const fp = makeFootprintReject(ctx);
  const reject = (x: number, z: number): boolean => lowReject(x, z) || fp(x, z);
  const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.4, 6);
  trunk.translate(0, 0.7, 0);
  const c1 = new THREE.ConeGeometry(1.6, 2.8, 7);
  c1.translate(0, 2.3, 0);
  const c2 = new THREE.ConeGeometry(1.2, 2.3, 7);
  c2.translate(0, 3.7, 0);
  const c3 = new THREE.ConeGeometry(0.8, 1.9, 7);
  c3.translate(0, 5.0, 0);
  const snowCap = new THREE.ConeGeometry(0.45, 0.9, 7);
  snowCap.translate(0, 5.8, 0);
  const pineGeo = mergeParts([
    { geo: trunk, color: 0x5a3d26 },
    { geo: c1, color: 0x1f5a3a },
    { geo: c2, color: 0x256a44 },
    { geo: c3, color: 0x2c7a4e },
    { geo: snowCap, color: 0xf4faff },
  ]);
  const pinePts = scatter(ctx, 220, 2, 240, reject);
  const pines = makeInstanced(ctx, pineGeo, stdMat(), pinePts.length, 'pines');
  fillInstances(pines, pinePts, rng, 0.8, 1.7, -0.1, 0.06, (r) => _c.setHSL(0.42, 0.18, 0.46 + (r() - 0.5) * 0.2));
  group.add(pines);

  const batch = new PropBatch();
  const templates: THREE.BufferGeometry[] = [];
  const T = (parts: GlowPart[]): THREE.BufferGeometry => {
    const g = mergeGlow(parts);
    templates.push(g);
    return g;
  };

  // zombie snowmen reaching for the road
  const snowmen = [T(zombieSnowmanParts(0)), T(zombieSnowmanParts(1)), T(zombieSnowmanParts(2))];
  for (const p of scatter(ctx, 38, 0.5, 45, reject)) {
    batch.add(snowmen[Math.floor(rng() * snowmen.length)], p.x, p.y - 0.12, p.z, yawToTrack(ctx, p.x, p.z) + (rng() - 0.5) * 0.6, lerp(0.8, 1.15, rng()), 0.08 + rng() * 0.08, (rng() - 0.5) * 0.12);
  }

  // abandoned quarantine camps: tents, tape fences, crates, floodlights
  const tents = [T(tentParts(0x6f7a4a, true)), T(tentParts(0x8a8f7a, true))];
  const crates = [T(crateParts(0x8a6a44)), T(crateParts(0x6a7a52))];
  const flood = T(floodlightParts(6));
  const tapes = [T(tapeFenceParts(9)), T(tapeFenceParts(6))];
  const drums = [T(barrelParts(0x3f6f9a, true, false)), T(barrelParts(0xc84a2a, false, false))];
  const campCenters = scatter(ctx, 9, 8, 70, reject);
  for (const c of campCenters) {
    const yaw = yawToTrack(ctx, c.x, c.z);
    const put = (tmpl: THREE.BufferGeometry, lx: number, lz: number, dy: number, dyaw: number, s = 1): void => {
      const [x, z] = localToWorld(c.x, c.z, yaw, lx, lz);
      if (wallClearance(ctx, x, z) < 3 || reject(x, z)) return;
      batch.add(tmpl, x, ctx.field.heightAt(x, z) + dy, z, yaw + dyaw, s);
    };
    put(tents[0], -3.2, 4, -0.05, 0.1);
    put(tents[1], 3.4, 5, -0.05, -0.15);
    put(tapes[0], 0, -1.5, -0.05, 0);
    put(tapes[1], -5.5, 1.5, -0.05, Math.PI / 2 + 0.2);
    put(crates[0], 5.8, 0.8, -0.02, 0.4);
    put(crates[1], 6.4, 1.9, 0.95, 0.9, 0.8);
    put(drums[Math.floor(rng() * 2)], -6.2, -0.4, -0.02, 0);
    if (rng() < 0.7) put(flood, 0.5, 9, -0.1, 0);
  }

  // hazard signs along the route
  addRoadsideSigns(ctx, batch, T, 14, [CELLS.signBiohazard, CELLS.signHand, CELLS.signZombie], reject);

  for (const t of templates) t.dispose();
  addBatch(group, batch.build(ctx, glowMaterial(propAtlas(ctx), { roughness: 0.75 }), 'outbreakProps', true, true));

  // ice spikes (fewer)
  const spikeGeo = mergeParts([{ geo: new THREE.ConeGeometry(0.6, 3.6, 5), color: 0xb8e8ff }]);
  spikeGeo.translate(0, 1.6, 0);
  const spikePts = scatter(ctx, 110, 0.5, 120, reject);
  const spikes = makeInstanced(ctx, spikeGeo, stdMat({ roughness: 0.15, metalness: 0.1, emissive: 0x0b2a3d, emissiveIntensity: 0.5 }), spikePts.length, 'iceSpikes');
  fillInstances(spikes, spikePts, rng, 0.5, 1.8, -0.2, 0.5, (r) => _c.setHSL(0.55, 0.5, 0.75 + (r() - 0.5) * 0.2), true);
  group.add(spikes);
}

/** Snowman who has clearly caught the bug: mismatched coal eyes, stitches, reaching stick arms. */
export function zombieSnowmanParts(variant: number): GlowPart[] {
  const P: GlowPart[] = [];
  const snow = 0xf4f8fb;
  const sick = variant === 1 ? 0xc2e3ad : 0xd0eabf;
  P.push({ geo: ball(0.8, 10, 7).translate(0, 0.75, 0), color: snow });
  P.push({ geo: ball(0.58, 10, 7).translate(0, 1.95, 0), color: snow });
  P.push({ geo: ball(0.44, 10, 8).translate(0.04, 2.82, -0.02), color: sick });
  // mismatched coal eyes with dark rings
  P.push({ geo: ball(0.19, 6, 4).scale(1, 0.85, 0.35).translate(-0.15, 2.9, -0.34), color: 0x7a6a92 });
  P.push({ geo: ball(0.13, 6, 4).scale(1, 0.85, 0.35).translate(0.2, 2.87, -0.36), color: 0x7a6a92 });
  P.push({ geo: ball(0.13, 6, 4).translate(-0.15, 2.93, -0.42), color: 0xffffff });
  P.push({ geo: ball(0.08, 6, 4).translate(0.2, 2.88, -0.43), color: 0xffffff });
  P.push({ geo: ball(0.06, 6, 4).translate(-0.13, 2.93, -0.54), color: 0x16161c });
  P.push({ geo: ball(0.04, 6, 4).translate(0.21, 2.87, -0.51), color: 0x16161c });
  // droopy carrot
  const nose = cone(0.08, 0.5, 6);
  nose.rotateX(-Math.PI / 2 + 0.45);
  nose.translate(0.03, 2.72, -0.62);
  P.push({ geo: nose, color: 0xff7a1a });
  // crooked coal grin with one tooth
  for (let k = 0; k < 5; k++) {
    const x = -0.18 + k * 0.09;
    P.push({ geo: box(0.06, 0.06, 0.05).translate(x + 0.04, 2.56 + Math.abs(k - 2) * 0.03 - (k === 3 ? 0.03 : 0), -0.4), color: 0x16161c });
  }
  P.push({ geo: box(0.05, 0.07, 0.03).translate(0.04, 2.52, -0.43), color: 0xffffff });
  // plaster cross on the head
  const pl1 = box(0.26, 0.07, 0.03);
  pl1.rotateZ(0.6);
  pl1.translate(0.2, 3.1, -0.3);
  const pl2 = pl1.clone();
  pl2.rotateZ(-1.2);
  P.push({ geo: pl1, color: 0xe8c89a });
  P.push({ geo: new THREE.BoxGeometry(0.26, 0.07, 0.03).rotateZ(-0.6).translate(0.2, 3.1, -0.3), color: 0xe8c89a });
  pl2.dispose();
  // stitched seam on the belly
  P.push({ geo: box(0.03, 0.56, 0.03).translate(0.12, 1.95, -0.57), color: 0x2a2030 });
  for (let k = 0; k < 4; k++) P.push({ geo: box(0.14, 0.025, 0.03).translate(0.12, 1.74 + k * 0.14, -0.58), color: 0x2a2030 });
  P.push({ geo: ball(0.06, 6, 5).translate(-0.12, 2.1, -0.55), color: 0x16161c });
  // tattered hat or bandage
  if (variant === 2) {
    P.push({ geo: cyl(0.46, 0.46, 0.16, 12, true).translate(0.04, 3.02, -0.02), color: 0xf2efe6 });
  } else {
    const hat = cyl(0.28, 0.3, 0.46, 9);
    hat.translate(0, 0.23, 0);
    hat.rotateZ(0.3);
    hat.translate(0.02, 3.12, 0);
    P.push({ geo: hat, color: 0x24222a });
    const brim = cyl(0.46, 0.46, 0.05, 10);
    brim.rotateZ(0.3);
    brim.translate(0.02, 3.13, 0);
    P.push({ geo: brim, color: 0x24222a });
  }
  // tattered scarf
  const scarf = new THREE.TorusGeometry(0.44, 0.09, 4, 10);
  scarf.rotateX(Math.PI / 2);
  scarf.translate(0, 2.44, 0);
  P.push({ geo: scarf, color: variant === 1 ? 0x6a4a9a : 0x3f8f5a });
  P.push({ geo: box(0.16, 0.5, 0.06).rotateZ(0.2).translate(0.22, 2.2, -0.46), color: variant === 1 ? 0x6a4a9a : 0x3f8f5a });
  // stick arms reaching forward
  for (const sx of [-1, 1]) {
    const arm = cyl(0.045, 0.06, 1.3, 5);
    arm.rotateX(Math.PI / 2 - 0.25);
    arm.translate(sx * 0.5, 2.25, -0.7);
    P.push({ geo: arm, color: 0x5a3d26 });
    for (let k = 0; k < 3; k++) {
      const f = cyl(0.02, 0.03, 0.28, 4);
      f.rotateX(Math.PI / 2);
      f.rotateY((k - 1) * 0.5);
      f.translate(sx * 0.5 + (k - 1) * 0.06, 2.42, -1.4);
      P.push({ geo: f, color: 0x5a3d26 });
    }
  }
  return P;
}

// ------------------------------------------------------------------ neon quarantine (neon)
const WINDOW_W = 3.2;
const WINDOW_H = 3.6;
const WINDOW_COLS = 8;
const WINDOW_ROWS = 12;

/** Night facade: lit windows, a few with zombie silhouettes, emergency red ones. */
function makeCityWindowTexture(seed: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 512;
  const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas not available');
    return [c, g];
  };
  const [ca, a] = mk();
  const [ce, e] = mk();
  a.fillStyle = '#16161f';
  a.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const rng = seededRandom(seed);
  const cw = S / WINDOW_COLS;
  const ch = S / WINDOW_ROWS;
  const colours = ['#ffe9a8', '#9fe8ff', '#b6ff7a', '#ffe9a8', '#c9b8ff', '#ff4a3a'];
  for (let y = 0; y < WINDOW_ROWS; y++) {
    for (let x = 0; x < WINDOW_COLS; x++) {
      const lit = rng() < 0.5;
      const px = x * cw + cw * 0.18;
      const py = y * ch + ch * 0.2;
      const w = cw * 0.64;
      const h = ch * 0.58;
      a.fillStyle = lit ? '#2c2c3a' : '#0c0c14';
      a.fillRect(px, py, w, h);
      if (!lit) continue;
      const col = colours[Math.floor(rng() * colours.length)];
      e.fillStyle = col;
      e.globalAlpha = 0.55 + rng() * 0.45;
      e.fillRect(px, py, w, h);
      e.globalAlpha = 1;
      if (rng() < 0.28) {
        // zombie silhouette pressed against the glass
        e.fillStyle = '#000';
        const sx = px + w * (0.3 + rng() * 0.4);
        e.beginPath();
        e.arc(sx, py + h * 0.42, h * 0.2, 0, Math.PI * 2);
        e.fill();
        e.fillRect(sx - w * 0.2, py + h * 0.6, w * 0.4, h * 0.4);
        e.fillRect(sx - w * 0.3, py + h * 0.2, w * 0.08, h * 0.45);
        e.fillRect(sx + w * 0.22, py + h * 0.25, w * 0.08, h * 0.4);
      }
    }
  }
  const fin = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: fin(ca), emissive: fin(ce) };
}

function buildNeon(ctx: BuildContext, group: THREE.Group): void {
  const { rng, field } = ctx;
  const reject = makeFootprintReject(ctx);
  const batch = new PropBatch();
  const templates: THREE.BufferGeometry[] = [];
  const T = (parts: GlowPart[]): THREE.BufferGeometry => {
    const g = mergeGlow(parts);
    templates.push(g);
    return g;
  };

  // skyscrapers: one window every WINDOW_W x WINDOW_H metres
  const win = makeCityWindowTexture(77);
  track(ctx, win.map, win.emissive);
  const buildingGeos: THREE.BufferGeometry[] = [];
  const bpts = scatter(ctx, 130, 22, 300, reject);
  const tileU = WINDOW_W * WINDOW_COLS;
  const tileV = WINDOW_H * WINDOW_ROWS;
  const roofZombies = [
    T(zombieParts({ skin: 0x2a3326, shirt: 0x1c1a24, pants: 0x14131a, hair: 0x0c0c10, pose: 'reach', eyeGlow: 3.5, eyeColor: 0x9dff3a, lod: true })),
    T(zombieParts({ skin: 0x2a3326, shirt: 0x1c1a24, pants: 0x14131a, hair: 0x0c0c10, pose: 'wave', eyeGlow: 3.5, eyeColor: 0x9dff3a, lod: true })),
    T(zombieParts({ skin: 0x2a3326, shirt: 0x1c1a24, pants: 0x14131a, hair: 0x0c0c10, pose: 'up', eyeGlow: 3.5, eyeColor: 0xff5a3a, lod: true })),
  ];
  const roofLight = T([
    { geo: cyl(0.06, 0.06, 1.2, 5).translate(0, 0.6, 0), color: 0x2a2a34 },
    { geo: box(0.4, 0.4, 0.4).translate(0, 1.3, 0), color: 0xff2a1a, glow: 3.0 },
  ]);
  for (const p of bpts) {
    const w = lerp(10, 26, rng());
    const d = lerp(10, 26, rng());
    const h = lerp(18, 95, Math.pow(rng(), 1.6));
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // BoxGeometry groups: +x,-x (d x h), +y,-y (w x d), +z,-z (w x h)
    const sizes: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    const offU = Math.floor(rng() * WINDOW_COLS) / WINDOW_COLS;
    for (let f = 0; f < 6; f++) {
      const [su, sv] = sizes[f];
      const isRoof = f === 2 || f === 3;
      for (let v = f * 4; v < f * 4 + 4; v++) {
        uv.setXY(v, isRoof ? 0.001 : offU + (uv.getX(v) * su) / tileU, isRoof ? 0.001 : (uv.getY(v) * sv) / tileV);
      }
    }
    const baseY = field.heightAt(p.x, p.z) - 0.5;
    g.translate(p.x, baseY + h / 2, p.z);
    buildingGeos.push(normalizeForMerge(g));
    const dist = field.distanceToTrack(p.x, p.z);
    const roofY = baseY + h;
    if (dist < 120 && h < 60 && rng() < 0.5) {
      const yaw = yawToTrack(ctx, p.x, p.z);
      const n = 1 + (rng() < 0.45 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const [x, z] = localToWorld(p.x, p.z, yaw, (k - (n - 1) / 2) * 3.2, -Math.min(w, d) / 2 + 1.4);
        batch.add(roofZombies[Math.floor(rng() * roofZombies.length)], x, roofY, z, yaw + (rng() - 0.5) * 0.4, lerp(2.2, 2.8, rng()));
      }
    }
    if (h > 40) {
      batch.add(roofLight, p.x + w / 2 - 0.6, roofY, p.z + d / 2 - 0.6, 0, 1.4);
      batch.add(roofLight, p.x - w / 2 + 0.6, roofY, p.z - d / 2 + 0.6, 0, 1.4);
    }
  }
  const cityGeo = mergeGeometries(buildingGeos, false);
  for (const g of buildingGeos) g.dispose();
  if (cityGeo) {
    cityGeo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      map: win.map,
      emissive: 0xffffff,
      emissiveMap: win.emissive,
      emissiveIntensity: 1.3,
      roughness: 0.6,
      metalness: 0.3,
    });
    const city = new THREE.Mesh(cityGeo, mat);
    city.name = 'skyscrapers';
    city.castShadow = true;
    city.receiveShadow = true;
    trackMesh(ctx, city);
    group.add(city);
  }

  // hazard-striped posts with blinking emergency beacons
  const pylonGeo = mergeParts([
    { geo: new THREE.BoxGeometry(0.5, 6, 0.5).translate(0, 3, 0), color: 0x24242e },
    { geo: new THREE.BoxGeometry(0.54, 0.5, 0.54).translate(0, 4.8, 0), color: 0xffc21a },
    { geo: new THREE.BoxGeometry(0.54, 0.5, 0.54).translate(0, 2.8, 0), color: 0xffc21a },
  ]);
  const pylonPts = scatter(ctx, 110, 1, 70, reject);
  const pylons = makeInstanced(ctx, pylonGeo, stdMat({ roughness: 0.5, metalness: 0.3 }), pylonPts.length, 'beaconPosts');
  fillInstances(pylons, pylonPts, rng, 0.9, 1.3, -0.1, 0);
  group.add(pylons);
  const capGeo = new THREE.SphereGeometry(0.42, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  const capMat = beaconMaterial(ctx);
  const caps = makeInstanced(ctx, capGeo, capMat, pylonPts.length, 'beacons', false);
  for (let i = 0; i < pylonPts.length; i++) {
    pylons.getMatrixAt(i, _m);
    _m.decompose(_p, _q, _s);
    _p.y += 6 * _s.y;
    _m.compose(_p, _q, _s);
    caps.setMatrixAt(i, _m);
    caps.setColorAt(i, _c.setHex(i % 3 === 0 ? 0x3a8aff : i % 3 === 1 ? 0xff2a1a : 0xffa21a));
  }
  caps.instanceMatrix.needsUpdate = true;
  if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
  group.add(caps);

  // warning holograms on poles: single-sided screens turned to the road, dark backs
  const boardPts = scatter(ctx, 36, 2, 60, reject);
  const poleTmpl = T([
    { geo: cyl(0.18, 0.22, 8, 6).translate(0, 4, 0.3), color: 0x202030 },
    { geo: box(8.4, 4.4, 0.3).translate(0, 10, 0.3), color: 0x15151f },
    { geo: box(8.6, 0.16, 0.5).translate(0, 12.25, 0.15), color: 0xffc21a, glow: 1.5 },
    { geo: box(8.6, 0.16, 0.5).translate(0, 7.75, 0.15), color: 0xffc21a, glow: 1.5 },
  ]);
  const screenCells = [CELLS.holoBiohazard, CELLS.holoZombie, CELLS.holoHand, CELLS.holoArrow];
  const screenTmpl = screenCells.map((cell) => {
    const plane = new THREE.PlaneGeometry(4, 4);
    plane.rotateY(Math.PI);
    plane.translate(0, 10, -0.02);
    const left = plane.clone().translate(2.05, 0, 0);
    const right = plane.translate(-2.05, 0, 0);
    return T([
      { geo: left, color: 0xffffff, uv: cell },
      { geo: right, color: 0xffffff, uv: screenCells[(screenCells.indexOf(cell) + 1) % screenCells.length] },
    ]);
  });
  const screens = new PropBatch();
  boardPts.forEach((p, i) => {
    const yaw = yawToTrack(ctx, p.x, p.z) + (rng() - 0.5) * 0.5;
    batch.add(poleTmpl, p.x, p.y - 0.1, p.z, yaw, 1);
    screens.add(screenTmpl[i % screenTmpl.length], p.x, p.y - 0.1, p.z, yaw, 1);
  });

  // quarantine barricades, blocks and drums near the road
  const barricade = T(barricadeParts());
  const block = T(concreteBlockParts());
  const drum = T(barrelParts(0xe0b030, true, true));
  for (const c of scatter(ctx, 30, 0.5, 30, reject)) {
    const yaw = yawToTrack(ctx, c.x, c.z);
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const [x, z] = localToWorld(c.x, c.z, yaw, (k - (n - 1) / 2) * 2.4, (rng() - 0.5) * 0.6);
      if (wallClearance(ctx, x, z) < 2.2 || reject(x, z)) continue;
      const tmpl = k % 2 === 0 ? barricade : block;
      batch.add(tmpl, x, field.heightAt(x, z) - 0.05, z, yaw + (rng() - 0.5) * 0.3, 1.1);
    }
    const [dx, dz] = localToWorld(c.x, c.z, yaw, (n / 2) * 2.4 + 1, 1);
    if (wallClearance(ctx, dx, dz) > 2.2) batch.add(drum, dx, field.heightAt(dx, dz) - 0.05, dz, rng() * 6, 1.2);
  }
  const tapes = T(tapeFenceParts(12));
  for (const p of scatter(ctx, 14, 3, 40, reject)) {
    batch.add(tapes, p.x, p.y - 0.05, p.z, yawToTrack(ctx, p.x, p.z), 1.2);
  }

  for (const t of templates) t.dispose();
  addBatch(group, batch.build(ctx, glowMaterial(propAtlas(ctx), { roughness: 0.6, metalness: 0.2 }), 'quarantineProps', true, true));
  const screenMat = new THREE.MeshBasicMaterial({ map: propAtlas(ctx), color: new THREE.Color(1.7, 1.7, 1.7), transparent: true, opacity: 0.92 });
  const screenMesh = screens.build(ctx, screenMat, 'holoScreens', false, false);
  if (screenMesh) {
    group.add(screenMesh);
    ctx.updaters.push((_dt, elapsed) => {
      const f = 1.45 + 0.3 * Math.sin(elapsed * 3.1) + (Math.sin(elapsed * 17.3) > 0.97 ? -0.8 : 0);
      screenMat.color.setScalar(f);
      screenMat.opacity = 0.86 + 0.08 * Math.sin(elapsed * 2.3);
    });
  }
}

/** Unlit instanced beacon that blinks with a per-instance phase (no extra lights, one draw call). */
export function beaconMaterial(ctx: BuildContext): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ctx.timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vBlink;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #endif
        float cyc = fract(uTime * (0.8 + ph * 0.7) + ph);
        vBlink = smoothstep(0.0, 0.06, cyc) * (1.0 - smoothstep(0.3, 0.45, cyc));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlink;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.18 + vBlink * 2.6;');
  };
  mat.customProgramCacheKey = () => 'zs-beacon';
  return mat;
}

// ------------------------------------------------------------------ instancing helpers
function fillInstances(
  mesh: THREE.InstancedMesh,
  pts: ScatterPoint[],
  rng: () => number,
  scaleMin: number,
  scaleMax: number,
  yOffset = 0,
  tilt = 0,
  colorFn?: (rng: () => number) => THREE.Color,
  nonUniform = false,
): void {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const s = lerp(scaleMin, scaleMax, rng());
    _p.set(p.x, p.y + yOffset, p.z);
    _e.set((rng() - 0.5) * tilt, rng() * Math.PI * 2, (rng() - 0.5) * tilt);
    _q.setFromEuler(_e);
    if (nonUniform) _s.set(s * lerp(0.7, 1.3, rng()), s * lerp(0.6, 1.4, rng()), s * lerp(0.7, 1.3, rng()));
    else _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    if (colorFn) mesh.setColorAt(i, colorFn(rng));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function makeInstanced(ctx: BuildContext, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string, shadows = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  trackMesh(ctx, mesh);
  return mesh;
}

const stdMat = (extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...extra });
