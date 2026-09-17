import * as THREE from 'three';
import type { BuildContext } from './context';
import { headingFromDir, indexAtS, trackMesh } from './context';
import { CELLS, PropBatch, ball, box, cone, cyl, glowMaterial, mergeGlow, propAtlas, type GlowPart } from './decor';
import { seededRandom, wrap01 } from '../../core/math';
import type { TrackDefinition } from '../../core/types';

/** True if t lies inside any void range (ranges may wrap around 0). */
export function isVoidT(def: TrackDefinition, t: number): boolean {
  const ranges = def.voidRanges;
  if (!ranges || ranges.length === 0) return false;
  const tw = wrap01(t);
  for (const [a, b] of ranges) {
    if (a <= b) {
      if (tw >= a && tw <= b) return true;
    } else if (tw >= a || tw <= b) {
      return true;
    }
  }
  return false;
}

/** Distance (metres) from t to the nearest void range edge, or Infinity. */
function distToVoidEdge(def: TrackDefinition, t: number, length: number): number {
  const ranges = def.voidRanges;
  if (!ranges) return Infinity;
  let best = Infinity;
  for (const [a, b] of ranges) {
    for (const e of [a, b]) {
      let d = Math.abs(wrap01(t) - e);
      if (d > 0.5) d = 1 - d;
      best = Math.min(best, d * length);
    }
  }
  return best;
}

interface Slot {
  x: number;
  y: number;
  z: number;
  heading: number;
  side: number;
  t: number;
  s: number;
}

/** Enumerate barrier slots along both wall lines. */
function wallSlots(ctx: BuildContext, spacing: number, lateralOffset: number, includeVoid: boolean): Slot[] {
  const { cl, def } = ctx;
  const slots: Slot[] = [];
  const count = Math.floor(cl.length / spacing);
  const actual = cl.length / count;
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < count; k++) {
      const s = k * actual + (side > 0 ? actual * 0.5 : 0);
      const t = s / cl.length;
      if (!includeVoid && isVoidT(def, t)) continue;
      const i = indexAtS(cl, s);
      const lat = cl.whw[i] + lateralOffset;
      slots.push({
        x: cl.px[i] + cl.bx[i] * side * lat,
        y: cl.py[i],
        z: cl.pz[i] + cl.bz[i] * side * lat,
        heading: headingFromDir(cl.tx[i], cl.tz[i]),
        side,
        t,
        s,
      });
    }
  }
  return slots;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function setInstance(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, heading: number, sx = 1, sy = 1, sz = 1, tilt = 0): void {
  _p.set(x, y, z);
  _e.set(tilt, heading, 0);
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(i, _m);
}

function finishInstanced(ctx: BuildContext, group: THREE.Group, mesh: THREE.InstancedMesh, name: string, castShadow = true): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.name = name;
  trackMesh(ctx, mesh);
  group.add(mesh);
}

/** Themed barriers along the wall line (none in void ranges: warning posts instead). */
export function buildBarriers(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'barriers';
  const theme = ctx.def.theme;
  if (theme === 'grassland' || theme === 'beach') buildCemeteryFence(ctx, group);
  else if (theme === 'desert' || theme === 'volcano') buildJerseyBarriers(ctx, group);
  else if (theme === 'snow') buildQuarantineBarriers(ctx, group);
  else buildNeonRails(ctx, group);
  return group;
}

// ------------------------------------------------------------------ graveyard: stone curb + wrought-iron fence
const FENCE_SPACING = 2.4;

function buildCemeteryFence(ctx: BuildContext, group: THREE.Group): void {
  // Local -Z runs along the track. Curb 0.5 m, iron bars up to ~1.35 m, a stone post per segment.
  const iron = 0x2b2931;
  const stone = 0xa6a2ab;
  const P: GlowPart[] = [
    { geo: box(0.55, 0.5, FENCE_SPACING - 0.02).translate(0, 0.25, 0), color: stone },
    { geo: box(0.6, 0.08, FENCE_SPACING).translate(0, 0.52, 0), color: 0x8a8690 },
    { geo: box(0.46, 1.22, 0.46).translate(0, 0.61, -FENCE_SPACING / 2 + 0.23), color: 0x98949e },
    { geo: box(0.56, 0.12, 0.56).translate(0, 1.28, -FENCE_SPACING / 2 + 0.23), color: 0x7e7a86 },
  ];
  const bars = 5;
  for (let k = 0; k < bars; k++) {
    const z = -FENCE_SPACING / 2 + 0.62 + (k * (FENCE_SPACING - 0.8)) / (bars - 1);
    P.push({ geo: cyl(0.028, 0.028, 0.76, 4, true).translate(0, 0.94, z), color: iron });
    P.push({ geo: cone(0.065, 0.2, 4).translate(0, 1.4, z), color: iron });
  }
  P.push({ geo: box(0.05, 0.05, FENCE_SPACING - 0.4).translate(0, 1.18, 0.2), color: iron });
  P.push({ geo: box(0.05, 0.05, FENCE_SPACING - 0.4).translate(0, 0.72, 0.2), color: iron });
  const geo = mergeGlow(P);
  const slots = wallSlots(ctx, FENCE_SPACING, 0.5, false);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), slots.length);
  const rng = ctx.rng;
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    setInstance(mesh, i, sl.x, sl.y - 0.02, sl.z, sl.heading + (rng() - 0.5) * 0.04, 1, 0.97 + rng() * 0.06, 1);
    const k = rng();
    _c.setRGB(1, 1, 1).offsetHSL(0, 0, -k * 0.12);
    if (k > 0.85) _c.setRGB(0.86, 0.95, 0.84);
    mesh.setColorAt(i, _c);
  }
  finishInstanced(ctx, group, mesh, 'cemeteryFence');

  // little lanterns on every fifth post
  const lampGeo = mergeGlow([
    { geo: box(0.26, 0.34, 0.26).translate(0, 0.17, 0), color: 0xffcf6a, glow: 2.2 },
    { geo: cone(0.24, 0.22, 4).rotateY(Math.PI / 4).translate(0, 0.45, 0), color: iron },
    { geo: box(0.3, 0.04, 0.3).translate(0, 0.0, 0), color: iron },
  ]);
  const lampSlots = slots.filter((_, i) => i % 5 === 0);
  const lamps = new THREE.InstancedMesh(lampGeo, glowMaterial(null, { roughness: 0.6 }), lampSlots.length);
  lampSlots.forEach((sl, i) => {
    const c = Math.cos(sl.heading);
    const s = Math.sin(sl.heading);
    // post centre sits half a segment back along local -Z
    const lz = -FENCE_SPACING / 2 + 0.23;
    setInstance(lamps, i, sl.x + lz * s, sl.y + 1.34, sl.z + lz * c, sl.heading);
  });
  finishInstanced(ctx, group, lamps, 'fenceLanterns', false);
}

// ------------------------------------------------------------------ doomsday highway: concrete jersey barriers
function jerseyShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0);
  s.lineTo(0.32, 0);
  s.lineTo(0.17, 0.26);
  s.lineTo(0.1, 0.84);
  s.lineTo(-0.1, 0.84);
  s.lineTo(-0.17, 0.26);
  s.closePath();
  return s;
}

function buildJerseyBarriers(ctx: BuildContext, group: THREE.Group): void {
  const L = 1.96;
  const body = new THREE.ExtrudeGeometry(jerseyShape(), { depth: L, bevelEnabled: false });
  body.translate(0, 0, -L / 2);
  const parts: GlowPart[] = [{ geo: body, color: 0xb9b1a6 }];
  const slant = Math.atan2(0.07, 0.58);
  for (const sx of [-1, 1]) {
    const band = new THREE.PlaneGeometry(L - 0.3, 0.26);
    band.rotateY((sx * Math.PI) / 2);
    band.rotateZ(sx * slant);
    band.translate(sx * 0.148, 0.52, 0);
    parts.push({ geo: band, color: 0xffffff, uv: CELLS.stripesYellow });
  }
  const geo = mergeGlow(parts);
  const slots = wallSlots(ctx, 2.05, 0.5, false);
  const mat = glowMaterial(propAtlas(ctx), { roughness: 0.95 });
  const mesh = new THREE.InstancedMesh(geo, mat, slots.length);
  const rng = ctx.rng;
  slots.forEach((sl, i) => {
    const knocked = rng() < 0.06;
    setInstance(mesh, i, sl.x, sl.y - 0.02, sl.z, sl.heading + (rng() - 0.5) * (knocked ? 0.35 : 0.05), 1, 0.96 + rng() * 0.08, 1, knocked ? (rng() - 0.5) * 0.12 : 0);
    const dirt = rng();
    _c.setRGB(1, 1, 1).offsetHSL(0, 0, -dirt * 0.18);
    if (dirt > 0.8) _c.setRGB(0.86, 0.72, 0.6);
    mesh.setColorAt(i, _c);
  });
  finishInstanced(ctx, group, mesh, 'jerseyBarriers');

  // Canyon: tall rock walls stacked above the barriers in the descent section.
  const canyon: [number, number][] = ctx.def.id === 'dune_drift' ? [[0.49, 0.685]] : [];
  if (canyon.length === 0) return;
  const rows = 7;
  const blockSlots = slots.filter((sl) => inRanges(canyon, sl.t));
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.9, 2.0), new THREE.MeshStandardMaterial({ color: 0xffffff, map: rockTexture(ctx), roughness: 0.95 }), blockSlots.length * rows);
  const base = new THREE.Color(ctx.def.palette.wall).lerp(new THREE.Color(0x8a7a70), 0.45);
  let idx = 0;
  for (const sl of blockSlots) {
    for (let r = 1; r <= rows; r++) {
      const sy = 0.95 + rng() * 0.15;
      const yaw = sl.heading + (rng() - 0.5) * 0.06;
      const off = r % 2 === 1 ? 1.0 : 0;
      const dx = -Math.sin(yaw) * off;
      const dz = -Math.cos(yaw) * off;
      const lean = (r * 0.14 + 0.1) * sl.side;
      const lx = Math.cos(yaw) * lean;
      const lz = -Math.sin(yaw) * lean;
      setInstance(blocks, idx, sl.x + dx + lx, sl.y + 0.45 + r * 0.9, sl.z + dz + lz, yaw, 1 + r * 0.08, sy, 1 + r * 0.12);
      _c.copy(base).offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.12 - r * 0.012);
      blocks.setColorAt(idx, _c);
      idx++;
    }
  }
  blocks.count = idx;
  finishInstanced(ctx, group, blocks, 'canyonWalls');
}

/** Small layered-rock texture for the canyon blocks. */
function rockTexture(ctx: BuildContext): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas not available');
  const rng = seededRandom(5);
  g.fillStyle = '#d8d2cc';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 18; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(70,50,40,0.28)' : 'rgba(255,245,230,0.3)';
    g.fillRect(0, rng() * S, S, 2 + rng() * 5);
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(40,30,25,${0.05 + rng() * 0.12})`;
    g.fillRect(rng() * S, rng() * S, 2 + rng() * 6, 2 + rng() * 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  ctx.disposables.push(tex);
  return tex;
}

function inRanges(ranges: [number, number][], t: number): boolean {
  for (const [a, b] of ranges) if (t >= a && t <= b) return true;
  return false;
}

// ------------------------------------------------------------------ frozen outbreak: plastic quarantine barriers + tape
const QB_SPACING = 1.48;

function buildQuarantineBarriers(ctx: BuildContext, group: THREE.Group): void {
  const { cl, def } = ctx;
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, 0);
  shape.lineTo(0.3, 0);
  shape.lineTo(0.18, 0.8);
  shape.lineTo(-0.18, 0.8);
  shape.closePath();
  const len = QB_SPACING - 0.06;
  const body = new THREE.ExtrudeGeometry(shape, { depth: len, steps: 2, bevelEnabled: false });
  body.translate(0, 0, -len / 2);
  // one body, coloured per triangle: yellow half, dark half, snowy top
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const yellow = new THREE.Color(0xffb81a);
  const dark = new THREE.Color(0x2a2d34);
  const snow = new THREE.Color(0xf6fbff);
  for (let t = 0; t < pos.count; t += 3) {
    const y = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const c = y > 0.79 ? snow : z < 0 ? yellow : dark;
    for (let v = 0; v < 3; v++) cols.set([c.r, c.g, c.b], (t + v) * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const geo = mergeGlow([{ geo: body, color: 0xffffff, keepColor: true }]);
  const slots = wallSlots(ctx, QB_SPACING, 0.45, false);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 }), slots.length);
  const rng = ctx.rng;
  slots.forEach((sl, i) => {
    setInstance(mesh, i, sl.x, sl.y - 0.02, sl.z, sl.heading + (rng() - 0.5) * 0.08, 1, 0.94 + rng() * 0.1, 1, (rng() - 0.5) * 0.04);
    _c.setRGB(1, 1, 1).offsetHSL(0, 0, -rng() * 0.08);
    mesh.setColorAt(i, _c);
  });
  finishInstanced(ctx, group, mesh, 'quarantineBarriers');

  // Tape strung between posts above the barriers, plus warning posts at the void edges.
  const batch = new PropBatch();
  const postGeo = mergeGlow([
    { geo: cyl(0.05, 0.06, 1.55, 4, true).translate(0, 0.78, 0), color: 0xe8e2d0 },
    { geo: cyl(0.065, 0.065, 0.16, 4, true).translate(0, 1.2, 0), color: 0xd8302c },
    { geo: box(0.14, 0.14, 0.14).translate(0, 1.6, 0), color: 0xff4a1a, glow: 2.4 },
  ]);
  const postEvery = 13;
  const tapeParts: THREE.BufferGeometry[] = [];
  for (let side = -1; side <= 1; side += 2) {
    const tape = new TapeBuilder();
    let prev: [number, number, number, number] | null = null;
    const n = Math.floor(cl.length / 0.7);
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * cl.length;
      const t = s / cl.length;
      const i = indexAtS(cl, s);
      const lat = cl.whw[i] + 0.45;
      const x = cl.px[i] + cl.bx[i] * side * lat;
      const z = cl.pz[i] + cl.bz[i] * side * lat;
      const along = k / postEvery;
      const sag = Math.sin((along - Math.floor(along)) * Math.PI) * 0.16;
      const y = cl.py[i] + 1.38 - sag;
      const inVoid = isVoidT(def, t) || distToVoidEdge(def, t, cl.length) < 3;
      if (!inVoid && k % postEvery === 0) batch.add(postGeo, x, cl.py[i] - 0.05, z, 0);
      if (prev && !inVoid) tape.segment(prev[0], prev[1], prev[2], x, y, z, k % 2 === 0);
      prev = inVoid ? null : [x, y, z, s];
    }
    const g = tape.build();
    if (g) tapeParts.push(g);
  }
  for (const g of tapeParts) {
    batch.addMatrix(g, new THREE.Matrix4());
    g.dispose();
  }
  if (def.voidRanges && def.voidRanges.length > 0) {
    const warn = mergeGlow([
      { geo: cyl(0.07, 0.09, 1.0, 6).translate(0, 0.5, 0), color: 0x2a2d34 },
      { geo: cyl(0.085, 0.085, 0.32, 6).translate(0, 0.78, 0), color: 0xffb81a },
      { geo: ball(0.14, 8, 6).translate(0, 1.08, 0), color: 0xff3a1a, glow: 2.6 },
    ]);
    const vs = wallSlots(ctx, 7.5, 0.35, true).filter((sl) => isVoidT(def, sl.t) || distToVoidEdge(def, sl.t, cl.length) < 4);
    for (const sl of vs) batch.add(warn, sl.x, sl.y, sl.z, sl.heading);
    warn.dispose();
  }
  postGeo.dispose();
  const tapeMesh = batch.build(ctx, glowMaterial(null, { roughness: 0.6, side: THREE.DoubleSide }), 'quarantineTape', false, false);
  if (tapeMesh) group.add(tapeMesh);
}

/** Raw two-sided ribbon of alternating yellow / black tape segments (glow-material attributes). */
class TapeBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];

  segment(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, yellow: boolean): void {
    const h = 0.07;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const c = yellow ? [1.0, 0.74, 0.1] : [0.12, 0.12, 0.14];
    const quad = [
      [x0, y0 - h, z0],
      [x1, y1 - h, z1],
      [x1, y1 + h, z1],
      [x0, y0 - h, z0],
      [x1, y1 + h, z1],
      [x0, y0 + h, z0],
    ];
    for (const v of quad) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(nx, 0, nz);
      this.col.push(c[0], c[1], c[2]);
    }
  }

  build(): THREE.BufferGeometry | null {
    const count = this.pos.length / 3;
    if (count === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2).fill(0.125), 2));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(new Float32Array(count).fill(0.25), 1));
    return g;
  }
}

// ------------------------------------------------------------------ neon quarantine: posts + striped glowing rails
function buildNeonRails(ctx: BuildContext, group: THREE.Group): void {
  const { cl, def } = ctx;
  const postGeo = new THREE.BoxGeometry(0.16, 0.9, 0.16);
  postGeo.translate(0, 0.45, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1b1b28, roughness: 0.4, metalness: 0.7 });
  const slots = wallSlots(ctx, 2.5, 0.4, false);
  const posts = new THREE.InstancedMesh(postGeo, postMat, slots.length);
  slots.forEach((sl, i) => setInstance(posts, i, sl.x, sl.y, sl.z, sl.heading));
  finishInstanced(ctx, group, posts, 'neonPosts');

  // Top rail: glowing red / amber quarantine stripes (diagonal); lower rail: cyan neon.
  const n = cl.n;
  const lift = (i: number): number => cl.py[i];
  {
    const pos: number[] = [];
    const col: number[] = [];
    const amber = [1.25, 0.82, 0.06];
    const red = [1.05, 0.06, 0.05];
    const y0 = 0.72;
    const y1 = 0.9;
    const shear = 0.35;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < n; k++) {
        const i = k;
        const j = (k + 1) % n;
        const lat = (q: number): number => cl.whw[q] + 0.4;
        const bx = (q: number): number => cl.px[q] + cl.bx[q] * side * lat(q);
        const bz = (q: number): number => cl.pz[q] + cl.bz[q] * side * lat(q);
        const tx = cl.tx[i] * shear;
        const tz = cl.tz[i] * shear;
        const a = [bx(i), lift(i) + y0, bz(i)];
        const b = [bx(j), lift(j) + y0, bz(j)];
        const c = [bx(j) + tx, lift(j) + y1, bz(j) + tz];
        const d = [bx(i) + tx, lift(i) + y1, bz(i) + tz];
        const cc = Math.floor(k / 1) % 2 === 0 ? amber : red;
        for (const v of [a, b, c, a, c, d]) {
          pos.push(v[0], v[1], v[2]);
          col.push(cc[0], cc[1], cc[2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.name = 'quarantineRail';
    trackMesh(ctx, mesh);
    group.add(mesh);
  }
  {
    const step = 2;
    const perSide = Math.floor(n / step) + 1;
    const verts = new Float32Array(perSide * 2 * 2 * 3);
    const idx = new Uint32Array((perSide - 1) * 2 * 6);
    let vi = 0;
    let ii = 0;
    for (let side = -1; side <= 1; side += 2) {
      const base = vi;
      for (let k = 0; k < perSide; k++) {
        const i = (k * step) % n;
        const lat = cl.whw[i] + 0.4;
        const x = cl.px[i] + cl.bx[i] * side * lat;
        const z = cl.pz[i] + cl.bz[i] * side * lat;
        const y = cl.py[i];
        verts.set([x, y + 0.38, z, x, y + 0.44, z], vi * 3);
        vi += 2;
      }
      for (let k = 0; k < perSide - 1; k++) {
        const a = base + k * 2;
        idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ii);
        ii += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(def.palette.curb), emissiveIntensity: 1.8, roughness: 0.4, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'neonRail';
    trackMesh(ctx, mesh);
    group.add(mesh);
  }
}
