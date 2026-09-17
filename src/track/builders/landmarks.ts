import * as THREE from 'three';
import type { BuildContext } from './context';
import { headingFromDir, trackMesh } from './context';
import {
  CELLS,
  PropBatch,
  ball,
  barrelParts,
  box,
  carParts,
  concreteBlockParts,
  cone,
  crateParts,
  cyl,
  floodlightParts,
  glowMaterial,
  mergeGlow,
  mergeParts,
  propAtlas,
  pumpkinParts,
  signParts,
  stripeByAngle,
  tapeFenceParts,
  tentParts,
  zombieParts,
  type GlowPart,
} from './decor';
import { fbm2, lerp, wrap01 } from '../../core/math';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

interface Spot {
  x: number;
  y: number;
  z: number;
  /** Yaw so that local -Z faces the track. */
  facing: number;
}

/**
 * Find a clear spot beside the track near parameter t on the given side: walk outward from the
 * wall line until the whole footprint (radius) clears every part of the track.
 */
function findSpot(ctx: BuildContext, t: number, side: number, minClear: number, footprint: number): Spot {
  const { cl, field } = ctx;
  const i = Math.floor(wrap01(t) * cl.n) % cl.n;
  const need = cl.maxWallHalfWidth + footprint + 4;
  let lat = cl.whw[i] + minClear + footprint;
  let x = 0;
  let z = 0;
  for (let k = 0; k < 40; k++) {
    x = cl.px[i] + cl.bx[i] * side * lat;
    z = cl.pz[i] + cl.bz[i] * side * lat;
    if (field.distanceToTrack(x, z) >= need) break;
    lat += 4;
  }
  const dx = cl.px[i] - x;
  const dz = cl.pz[i] - z;
  return { x, y: field.heightAt(x, z), z, facing: headingFromDir(dx, dz) };
}

interface Site {
  t: number;
  side: number;
  minClear: number;
  footprint: number;
  /** Radius kept clear of scattered decor. */
  keepOut: number;
}

const SITES: Record<string, Record<string, Site>> = {
  grassland: {
    gate: { t: 0.27, side: 1, minClear: 5, footprint: 9, keepOut: 20 },
    chapel: { t: 0.79, side: -1, minClear: 10, footprint: 13, keepOut: 22 },
    crypt: { t: 0.13, side: -1, minClear: 6, footprint: 9, keepOut: 15 },
  },
  desert: {
    tower: { t: 0.4, side: -1, minClear: 8, footprint: 6, keepOut: 12 },
    bus: { t: 0.21, side: -1, minClear: 5, footprint: 7, keepOut: 12 },
  },
  snow: {
    waterfall: { t: 0.235, side: -1, minClear: 20, footprint: 22, keepOut: 32 },
    station: { t: 0.66, side: 1, minClear: 14, footprint: 26, keepOut: 38 },
    iceA: { t: 0.29, side: 1, minClear: 3, footprint: 3, keepOut: 6 },
    iceB: { t: 0.57, side: 1, minClear: 3, footprint: 3, keepOut: 6 },
    iceC: { t: 0.12, side: -1, minClear: 4, footprint: 3, keepOut: 6 },
    iceD: { t: 0.85, side: -1, minClear: 4, footprint: 3, keepOut: 6 },
  },
  neon: {
    holo: { t: 0.585, side: 1, minClear: 16, footprint: 8, keepOut: 20 },
    checkpoint: { t: 0.1, side: -1, minClear: 3, footprint: 6, keepOut: 18 },
  },
};

function themeKey(ctx: BuildContext): string {
  const th = ctx.def.theme;
  if (th === 'volcano') return 'desert';
  if (th === 'beach') return 'grassland';
  return th;
}

function siteSpot(ctx: BuildContext, name: string): Spot {
  const s = SITES[themeKey(ctx)][name];
  return findSpot(ctx, s.t, s.side, s.minClear, s.footprint);
}

/** Desert overpass across the canyon (t) and a ruined viaduct beside the start straight. */
const OVERPASS_T = 0.63;
const VIADUCT = { s0: 40, s1: 150, lateral: 44, side: -1, spacing: 22 };

/** Footprints of all landmarks for the current theme (decor keeps out of them). */
export function landmarkFootprints(ctx: BuildContext): { x: number; z: number; r: number }[] {
  const key = themeKey(ctx);
  const out: { x: number; z: number; r: number }[] = [];
  const sites = SITES[key];
  if (sites) {
    for (const name of Object.keys(sites)) {
      const sp = siteSpot(ctx, name);
      out.push({ x: sp.x, z: sp.z, r: sites[name].keepOut });
    }
  }
  if (key === 'desert') {
    for (const p of overpassPiers(ctx)) out.push({ x: p.x, z: p.z, r: 7 });
    for (const p of viaductPiers(ctx)) out.push({ x: p.x, z: p.z, r: 8 });
  }
  return out;
}

/** 2-3 large landmark props per track, visible from the road. */
export function buildLandmarks(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'landmarks';
  switch (ctx.def.theme) {
    case 'desert':
    case 'volcano':
      buildWastelandLandmarks(ctx, group);
      break;
    case 'snow':
      buildOutbreakLandmarks(ctx, group);
      break;
    case 'neon':
      buildQuarantineLandmarks(ctx, group);
      break;
    default:
      buildGraveyardLandmarks(ctx, group);
  }
  return group;
}

/** Bake local parts at a spot (local -Z faces the track when yaw = spot.facing). */
function place(batch: PropBatch, parts: GlowPart[], x: number, y: number, z: number, yaw: number, scale = 1, tiltX = 0, tiltZ = 0): void {
  const g = mergeGlow(parts);
  batch.add(g, x, y, z, yaw, scale, tiltX, tiltZ);
  g.dispose();
}

/** Transform every part's geometry (for nesting templates inside a larger local layout). */
function moveParts(parts: GlowPart[], x: number, y: number, z: number, yaw = 0, scale = 1, tiltX = 0, tiltZ = 0): GlowPart[] {
  _e.set(tiltX, yaw, tiltZ, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(scale, scale, scale);
  _m.compose(_p, _q, _s);
  for (const pt of parts) pt.geo.applyMatrix4(_m);
  return parts;
}

function extrude(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Rectangle with a pointed (gothic) arch top; origin at the bottom centre. */
function archShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const hs = h - w * 0.62;
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, hs);
  s.quadraticCurveTo(w / 2, hs + (h - hs) * 0.62, 0, h);
  s.quadraticCurveTo(-w / 2, hs + (h - hs) * 0.62, -w / 2, hs);
  s.closePath();
  return s;
}

function triangleShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return s;
}

function addBatchMesh(group: THREE.Group, mesh: THREE.Mesh | null): void {
  if (mesh) group.add(mesh);
}

// =====================================================================================
// Graveyard Loop: cemetery gate, crooked chapel, mausoleum
// =====================================================================================
const STONE = 0x8c8894;
const STONE_DARK = 0x6a6672;
const IRON = 0x24222a;

function ironBars(P: GlowPart[], x0: number, x1: number, h: number, spacing: number, z = 0, tips = true): void {
  const n = Math.max(1, Math.round((x1 - x0) / spacing));
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    P.push({ geo: cyl(0.035, 0.035, h, 4).translate(x, h / 2, z), color: IRON });
    if (tips) P.push({ geo: cone(0.08, 0.26, 4).translate(x, h + 0.12, z), color: IRON });
  }
  const len = Math.abs(x1 - x0);
  P.push({ geo: box(len, 0.07, 0.07).translate((x0 + x1) / 2, h * 0.85, z), color: IRON });
  P.push({ geo: box(len, 0.07, 0.07).translate((x0 + x1) / 2, h * 0.2, z), color: IRON });
}

function buildGraveyardLandmarks(ctx: BuildContext, group: THREE.Group): void {
  const batch = new PropBatch();

  // ---- cemetery gate with fence wings
  {
    const spot = siteSpot(ctx, 'gate');
    const P: GlowPart[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * 3.5;
      P.push({ geo: box(1.5, 0.5, 1.5).translate(x, 0.25, 0), color: STONE_DARK });
      P.push({ geo: box(1.2, 5.0, 1.2).translate(x, 2.9, 0), color: STONE });
      P.push({ geo: box(1.55, 0.35, 1.55).translate(x, 5.55, 0), color: STONE_DARK });
      P.push({ geo: cone(1.0, 0.8, 4).rotateY(Math.PI / 4).translate(x, 6.1, 0), color: STONE });
      moveParts(pumpkinParts(0xffd23a), 0, 0, 0, 0, 1.25).forEach((pt) => P.push({ ...pt, geo: pt.geo.translate(x, 6.35, 0) }));
      P.push({ geo: ball(0.25, 6, 4).scale(1.6, 0.6, 1).translate(x + 0.35, 4.2, -0.62), color: 0x5f8a45 });
      // gate leaf, swung inward
      const leaf: GlowPart[] = [];
      ironBars(leaf, 0, 2.7, 3.6, 0.34);
      leaf.push({ geo: box(2.7, 0.08, 0.08).translate(1.35, 2.2, 0), color: IRON });
      moveParts(leaf, sx * 2.85, 0.1, 0, sx < 0 ? -0.55 : Math.PI + 0.55);
      P.push(...leaf);
      // fence wing
      const w0 = sx * 4.3;
      const w1 = sx * 17;
      P.push({ geo: box(Math.abs(w1 - w0), 0.6, 0.55).translate((w0 + w1) / 2, 0.3, 0), color: STONE_DARK });
      const wing: GlowPart[] = [];
      ironBars(wing, Math.min(w0, w1), Math.max(w0, w1), 2.2, 0.32);
      wing.forEach((pt) => P.push({ ...pt, geo: pt.geo.translate(0, 0.6, 0) }));
      for (const px of [sx * 10.5, sx * 17]) {
        P.push({ geo: box(0.8, 3.1, 0.8).translate(px, 1.55, 0), color: STONE });
        P.push({ geo: box(1.0, 0.25, 1.0).translate(px, 3.2, 0), color: STONE_DARK });
      }
    }
    // iron arch with a moon-and-bat emblem
    for (const r of [3.45, 3.05]) {
      const arch = new THREE.TorusGeometry(r, 0.08, 4, 22, Math.PI);
      arch.translate(0, 5.2, 0);
      P.push({ geo: arch, color: IRON });
    }
    for (let k = 1; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      const bar = box(0.05, 0.42, 0.05);
      bar.rotateZ(a - Math.PI / 2);
      bar.translate(Math.cos(a) * 3.25, 5.2 + Math.sin(a) * 3.25, 0);
      P.push({ geo: bar, color: IRON });
    }
    const disc = cyl(1.0, 1.0, 0.1, 18);
    disc.rotateX(-Math.PI / 2);
    disc.rotateY(Math.PI);
    disc.translate(0, 7.55, -0.02);
    P.push({ geo: disc, color: 0xffffff, uv: CELLS.moonBat, glow: 0.35 });
    P.push({ geo: new THREE.TorusGeometry(1.02, 0.08, 4, 18).translate(0, 7.55, 0), color: IRON });
    place(batch, P, spot.x, spot.y - 0.3, spot.z, spot.facing);
  }

  // ---- crooked gothic chapel
  {
    const spot = siteSpot(ctx, 'chapel');
    const P: GlowPart[] = [];
    const W = 9;
    const H = 7;
    const D = 15;
    const z0 = -D / 2;
    P.push({ geo: box(W + 1, 0.7, D + 1).translate(0, 0.35, 0), color: STONE_DARK });
    P.push({ geo: box(W, H, D).translate(0, 0.7 + H / 2, 0), color: 0x7f7a88 });
    const roofRise = 5.2;
    const slope = Math.hypot(W / 2 + 0.6, roofRise);
    const ang = Math.atan2(roofRise, W / 2 + 0.6);
    for (const s of [-1, 1]) {
      const slab = box(slope, 0.35, D + 1.2);
      slab.rotateZ(-s * ang);
      slab.translate((s * (W / 2 + 0.6)) / 2, 0.7 + H + roofRise / 2, 0);
      P.push({ geo: slab, color: 0x3b3346 });
    }
    for (const zs of [-1, 1]) {
      P.push({ geo: extrude(triangleShape(W, roofRise), 0.5).translate(0, 0.7 + H, zs * (D / 2 - 0.25)), color: 0x7f7a88 });
    }
    // buttresses
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const b = box(0.9, 4.8, 1.1);
        b.translate(s * (W / 2 + 0.45), 0.7 + 2.4, -D / 2 + 2 + k * 3.7);
        P.push({ geo: b, color: STONE_DARK });
        // glowing lancet windows between buttresses
        if (k < 3) {
          const win = extrude(archShape(1.1, 3.0), 0.12);
          win.rotateY(Math.PI / 2);
          win.translate(s * (W / 2 + 0.05), 2.4, -D / 2 + 3.85 + k * 3.7);
          const lit = (k + (s > 0 ? 1 : 0)) % 2 === 0;
          P.push({ geo: win, color: lit ? 0xb6ff6a : 0xffc86a, glow: lit ? 1.6 : 1.2 });
        }
      }
    }
    // boarded window
    for (const a of [0.6, -0.6]) {
      const plank = box(0.16, 2.6, 0.1);
      plank.rotateX(a);
      plank.translate(W / 2 + 0.14, 3.9, -D / 2 + 3.85);
      P.push({ geo: plank, color: 0x6b4a2e });
    }
    // front: steps, pointed door ajar with green light, rose window
    for (let k = 0; k < 3; k++) {
      P.push({ geo: box(4.6 - k * 0.6, 0.25, 1.0).translate(0, 0.12 + k * 0.25, z0 - 1.6 + k * 0.5), color: STONE_DARK });
    }
    P.push({ geo: extrude(archShape(3.2, 4.8), 0.4).translate(0, 0.7, z0 - 0.1), color: 0x5e5a66 });
    P.push({ geo: extrude(archShape(2.4, 4.0), 0.2).translate(0, 0.7, z0 - 0.32), color: 0x3a2618 });
    P.push({ geo: box(0.2, 3.1, 0.06).translate(0.05, 2.25, z0 - 0.44), color: 0x9dff5a, glow: 2.4 });
    const rose = cyl(1.35, 1.35, 0.14, 18);
    rose.rotateX(-Math.PI / 2);
    rose.rotateY(Math.PI);
    rose.translate(0, 0.7 + H + 1.7, z0 - 0.55);
    P.push({ geo: rose, color: 0xffffff, uv: CELLS.roseWindow, glow: 1.2 });
    P.push({ geo: new THREE.TorusGeometry(1.42, 0.18, 5, 18).translate(0, 0.7 + H + 1.7, z0 - 0.55), color: STONE_DARK });
    // crooked bell tower with spire and cross
    const tower: GlowPart[] = [];
    const TW = 3.4;
    const TH = 15;
    tower.push({ geo: box(TW, TH, TW).translate(0, TH / 2, 0), color: 0x857f8e });
    tower.push({ geo: box(TW + 0.5, 0.4, TW + 0.5).translate(0, TH - 3.6, 0), color: STONE_DARK });
    tower.push({ geo: box(TW + 0.5, 0.4, TW + 0.5).translate(0, TH, 0), color: STONE_DARK });
    for (let f = 0; f < 4; f++) {
      const open = extrude(archShape(1.3, 2.4), 0.2);
      open.translate(0, TH - 3.1, -TW / 2 - 0.02);
      open.rotateY((f * Math.PI) / 2);
      tower.push({ geo: open, color: 0x16131c });
    }
    tower.push({ geo: cone(0.7, 1.0, 8).translate(0, TH - 1.6, 0), color: 0xc9a13a });
    tower.push({ geo: cone(2.7, 7.5, 4).rotateY(Math.PI / 4).translate(0, TH + 0.2 + 3.75, 0), color: 0x3b3346 });
    tower.push({ geo: box(0.18, 2.0, 0.18).translate(0, TH + 8.6, 0), color: IRON });
    tower.push({ geo: box(1.1, 0.18, 0.18).translate(0, TH + 8.9, 0), color: IRON });
    tower.push({ geo: cyl(0.55, 0.55, 0.12, 14).rotateX(Math.PI / 2).translate(0, TH - 7, -TW / 2 - 0.02), color: 0xffe9a0, glow: 1.4 });
    moveParts(tower, -W / 2 + 0.6, 0.7, z0 + 1.4, 0, 1, 0.03, 0.06);
    P.push(...tower);
    // ravens on the ridge
    for (let k = 0; k < 3; k++) {
      const rz = -4 + k * 4.2;
      const ry = 0.7 + H + roofRise + 0.15;
      P.push({ geo: ball(0.32, 8, 6).scale(0.8, 0.9, 1.3).translate(0.1, ry + 0.3, rz), color: 0x1c1a22 });
      P.push({ geo: ball(0.2, 8, 6).translate(0.1, ry + 0.72, rz - 0.3), color: 0x1c1a22 });
      P.push({ geo: cone(0.07, 0.3, 4).rotateX(-Math.PI / 2).translate(0.1, ry + 0.7, rz - 0.6), color: 0xe0a030 });
      P.push({ geo: ball(0.05, 5, 4).translate(0.2, ry + 0.78, rz - 0.44), color: 0xffe07a, glow: 2 });
    }
    // pumpkins on the steps
    for (const sx of [-1.8, 1.9]) {
      P.push(...moveParts(pumpkinParts(0xffd23a), sx, 0.62, z0 - 1.3, 0, 1.1));
    }
    place(batch, P, spot.x, spot.y - 0.35, spot.z, spot.facing + 0.25);
  }

  // ---- mausoleum with a friendly caretaker
  {
    const spot = siteSpot(ctx, 'crypt');
    const P: GlowPart[] = [];
    P.push({ geo: box(8, 0.4, 8.6).translate(0, 0.2, 0), color: STONE_DARK });
    P.push({ geo: box(7.2, 0.4, 7.8).translate(0, 0.6, 0.2), color: STONE });
    P.push({ geo: box(5.6, 4.4, 6).translate(0, 3.0, 0.8), color: 0x9a969e });
    for (const cx of [-2.4, -0.95, 0.95, 2.4]) {
      P.push({ geo: cyl(0.28, 0.32, 3.8, 10).translate(cx, 2.7, -2.9), color: 0xb4b0b8 });
      P.push({ geo: box(0.8, 0.3, 0.8).translate(cx, 4.7, -2.9), color: STONE });
    }
    P.push({ geo: box(6.4, 0.5, 7.6).translate(0, 5.1, 0.2), color: STONE });
    P.push({ geo: extrude(triangleShape(6.4, 1.7), 0.5).translate(0, 5.35, -3.3), color: 0xa6a2aa });
    const roofSlope = Math.hypot(3.4, 1.7);
    for (const s of [-1, 1]) {
      const slab = box(roofSlope, 0.3, 7.8);
      slab.rotateZ(-s * Math.atan2(1.7, 3.4));
      slab.translate(s * 1.7, 6.2, 0.2);
      P.push({ geo: slab, color: 0x5e5a66 });
    }
    P.push({ geo: box(2.0, 3.0, 0.2).translate(0, 2.3, -2.25), color: 0x2f4a3a });
    P.push({ geo: box(0.1, 2.8, 0.06).translate(0.02, 2.3, -2.37), color: 0x9dff5a, glow: 2.6 });
    for (const sx of [-1, 1]) {
      P.push({ geo: box(0.7, 1.0, 0.7).translate(sx * 3.3, 1.3, -3.4), color: STONE });
      P.push({ geo: cyl(0.2, 0.34, 0.6, 8).translate(sx * 3.3, 2.1, -3.4), color: 0x6a8a7a });
      P.push({ geo: cone(0.2, 0.55, 6).translate(sx * 3.3, 2.65, -3.4), color: 0x8dff5a, glow: 2.2 });
    }
    P.push({ geo: ball(0.5, 6, 4).scale(1.4, 0.5, 1).translate(-2.2, 5.5, -3.2), color: 0x5f8a45 });
    const keeper = zombieParts({ skin: 0x9ad07a, shirt: 0x6a4a9a, pants: 0x4a4a5a, hair: 0x2a2030, pose: 'wave' });
    P.push(...moveParts(keeper, 4.6, 0.0, -4.4, 0.4, 1.05));
    // shovel leaning on the step
    const handle = cyl(0.04, 0.04, 1.6, 5);
    handle.rotateZ(0.35);
    handle.translate(5.6, 0.8, -3.6);
    P.push({ geo: handle, color: 0x7a5534 });
    P.push({ geo: box(0.36, 0.44, 0.05).translate(5.9, 0.1, -3.6), color: 0x6a6e76 });
    place(batch, P, spot.x, spot.y - 0.3, spot.z, spot.facing, 1.35);
  }

  addBatchMesh(group, batch.build(ctx, glowMaterial(propAtlas(ctx), { roughness: 0.9 }), 'graveyardLandmarks'));
}

// =====================================================================================
// Doomsday Highway: broken overpass, ruined viaduct, rusty water tower, bus, ash mesas
// =====================================================================================
interface Pier {
  x: number;
  y: number;
  z: number;
  heading: number;
}

function overpassPiers(ctx: BuildContext): Pier[] {
  const { cl, field } = ctx;
  const i = Math.floor(OVERPASS_T * cl.n) % cl.n;
  const heading = headingFromDir(cl.tx[i], cl.tz[i]);
  const out: Pier[] = [];
  for (const side of [-1, 1]) {
    const lat = cl.whw[i] + 5.5;
    const x = cl.px[i] + cl.bx[i] * side * lat;
    const z = cl.pz[i] + cl.bz[i] * side * lat;
    out.push({ x, y: field.heightAt(x, z), z, heading });
  }
  return out;
}

function viaductPiers(ctx: BuildContext): Pier[] {
  const { cl, field } = ctx;
  const out: Pier[] = [];
  for (let s = VIADUCT.s0; s <= VIADUCT.s1; s += VIADUCT.spacing) {
    const i = Math.floor((s / cl.length) * cl.n) % cl.n;
    const x = cl.px[i] + cl.bx[i] * VIADUCT.side * (cl.whw[i] + VIADUCT.lateral);
    const z = cl.pz[i] + cl.bz[i] * VIADUCT.side * (cl.whw[i] + VIADUCT.lateral);
    out.push({ x, y: field.heightAt(x, z), z, heading: headingFromDir(cl.tx[i], cl.tz[i]) });
  }
  return out;
}

const CONCRETE = 0xa39c92;
const CONCRETE_DARK = 0x7d776f;

/** Jagged broken end of a deck slab along local X at x = xEnd (dir = +1 or -1 outward). */
function jaggedEnd(P: GlowPart[], xEnd: number, dir: number, y: number, width: number, thick: number): void {
  for (let k = 0; k < 5; k++) {
    const zc = -width / 2 + (k + 0.5) * (width / 5);
    const len = 0.6 + ((k * 37) % 5) * 0.35;
    const chunk = box(len, thick * (0.6 + ((k * 13) % 3) * 0.2), width / 5 + 0.05);
    chunk.rotateZ(dir * (0.1 + ((k * 7) % 3) * 0.08));
    chunk.translate(xEnd + dir * len / 2, y - 0.1 * k, zc);
    P.push({ geo: chunk, color: k % 2 === 0 ? CONCRETE : CONCRETE_DARK });
  }
}

function buildWastelandLandmarks(ctx: BuildContext, group: THREE.Group): void {
  const { cl, field } = ctx;
  const batch = new PropBatch();

  // ---- broken overpass across the canyon
  {
    const i = Math.floor(OVERPASS_T * cl.n) % cl.n;
    const roadY = cl.py[i];
    const heading = headingFromDir(cl.tx[i], cl.tz[i]);
    const whw = cl.whw[i];
    const deckY = 11.5;
    const thick = 1.3;
    const width = 8;
    const P: GlowPart[] = [];
    // local frame: +X = right of travel (binormal), -Z = along travel
    for (const side of [-1, 1]) {
      const px = side * (whw + 5.5);
      const groundY = Math.min(overpassPiers(ctx)[side < 0 ? 0 : 1].y - roadY, 0) - 1.5;
      const h = deckY - groundY;
      P.push({ geo: box(2.2, h, 2.6).translate(px, groundY + h / 2, 0), color: CONCRETE_DARK });
      P.push({ geo: box(3.2, 1.2, width - 0.4).translate(px, deckY - 0.6, 0), color: CONCRETE });
    }
    const addDeck = (x0: number, x1: number): void => {
      const len = Math.abs(x1 - x0);
      const cx = (x0 + x1) / 2;
      P.push({ geo: box(len, thick, width).translate(cx, deckY + thick / 2, 0), color: CONCRETE });
      for (const zs of [-1, 1]) {
        P.push({ geo: box(len, 0.9, 0.35).translate(cx, deckY + thick + 0.45, zs * (width / 2 - 0.17)), color: CONCRETE_DARK });
        P.push({ geo: box(len, 0.12, 0.38).translate(cx, deckY + thick + 0.2, zs * (width / 2 - 0.17)), color: 0xffc21a });
      }
    };
    const far = whw + 26;
    addDeck(-far, -1.8);
    jaggedEnd(P, -1.8, 1, deckY + thick / 2, width, thick);
    addDeck(6.2, far);
    jaggedEnd(P, 6.2, -1, deckY + thick / 2, width, thick);
    // slab hanging from the right-hand break
    const hang = box(3.2, thick, width - 1);
    hang.translate(-1.6, 0, 0);
    hang.rotateZ(0.62);
    hang.translate(6.2, deckY + 0.2, 0.3);
    P.push({ geo: hang, color: CONCRETE_DARK });
    // car teetering over the gap, barrels on the deck
    P.push(...moveParts(carParts(0x5f8f8a), -3.2, deckY + thick - 0.1, 0.8, -Math.PI / 2, 1, -0.22, 0));
    P.push(...moveParts(barrelParts(0xe0b030, true, true), -9, deckY + thick, -2, 0, 1.2));
    P.push(...moveParts(barrelParts(0x8a4b2a, false, false), -10.2, deckY + thick, -1.2, 0, 1.2));
    P.push(...moveParts(concreteBlockParts(), 12, deckY + thick, 1.5, 0.3, 1));
    // side ramps down to the ground outside the canyon
    place(batch, P, cl.px[i], roadY, cl.pz[i], heading);
  }

  // ---- ruined viaduct beside the start straight
  {
    const piers = viaductPiers(ctx);
    const P: GlowPart[] = [];
    const deckH = 10;
    const tops: THREE.Vector3[] = [];
    piers.forEach((p, k) => {
      const lean = k === 2 ? 0.18 : 0;
      const h = deckH + 1.5;
      const col: GlowPart[] = [
        { geo: box(2.2, h, 2.2).translate(0, h / 2 - 1.5, 0), color: CONCRETE_DARK },
        { geo: box(7.5, 1.2, 3.0).translate(0, deckH - 0.6, 0), color: CONCRETE },
      ];
      if (k === piers.length - 1) {
        // snapped pier: only the stump remains
        col.length = 0;
        col.push({ geo: box(2.2, 5, 2.2).translate(0, 1.0, 0), color: CONCRETE_DARK });
        jaggedEnd(col, 0, 1, 3.6, 2.2, 1.2);
      }
      P.push(...moveParts(col, p.x, p.y, p.z, p.heading, 1, 0, lean));
      tops.push(new THREE.Vector3(p.x, p.y + deckH, p.z));
    });
    for (let k = 0; k + 1 < tops.length; k++) {
      const a = tops[k];
      const b = tops[k + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const yaw = headingFromDir(dx, dz);
      const seg: GlowPart[] = [];
      if (k === 1) {
        // collapsed span: one end on the ground
        const slab = box(7, 1.2, len);
        const drop = a.y - field.heightAt((a.x + b.x) / 2, (a.z + b.z) / 2);
        slab.rotateX(-Math.atan2(drop, len) * 0.9);
        slab.translate(0, -drop / 2 + 0.4, -len / 2);
        seg.push({ geo: slab, color: CONCRETE });
      } else if (k === tops.length - 2) {
        seg.push({ geo: box(7, 1.2, len * 0.55).translate(0, 0.6, -len * 0.275), color: CONCRETE });
        const tip: GlowPart[] = [];
        jaggedEnd(tip, 0, 1, 0.6, 7, 1.2);
        moveParts(tip, 0, 0, -len * 0.55, Math.PI / 2);
        seg.push(...tip);
      } else {
        seg.push({ geo: box(7, 1.2, len).translate(0, 0.6, -len / 2), color: CONCRETE });
        for (const sx of [-1, 1]) seg.push({ geo: box(0.3, 0.8, len).translate(sx * 3.35, 1.6, -len / 2), color: CONCRETE_DARK });
        if (k === 0) seg.push(...moveParts(carParts(0xa0524a), 1.4, 1.2, -len * 0.4, 0.3, 1));
      }
      P.push(...moveParts(seg, a.x, a.y, a.z, yaw));
    }
    place(batch, P, 0, 0, 0, 0);
  }

  // ---- rusty water tower with a hazard band
  {
    const spot = siteSpot(ctx, 'tower');
    const P: GlowPart[] = [];
    const legH = 14;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = cyl(0.22, 0.3, legH, 6);
      leg.translate(0, legH / 2, 0);
      const pos = leg.getAttribute('position') as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const r = lerp(4.2, 3.0, pos.getY(v) / legH);
        pos.setX(v, pos.getX(v) + Math.cos(a) * r);
        pos.setZ(v, pos.getZ(v) + Math.sin(a) * r);
      }
      leg.computeVertexNormals();
      P.push({ geo: leg, color: 0x6b4a33 });
      for (let b = 1; b <= 2; b++) {
        const y = (b / 3) * legH;
        const r = lerp(4.2, 3.0, y / legH);
        const a2 = ((k + 1) / 4) * Math.PI * 2 + Math.PI / 4;
        const x0 = Math.cos(a) * r;
        const z0 = Math.sin(a) * r;
        const x1 = Math.cos(a2) * r;
        const z1 = Math.sin(a2) * r;
        if (k === 1 && b === 2) continue;
        const brace = box(Math.hypot(x1 - x0, z1 - z0), 0.12, 0.12);
        brace.rotateY(-Math.atan2(z1 - z0, x1 - x0));
        brace.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
        P.push({ geo: brace, color: 0x5a3e2c });
      }
    }
    const tank: GlowPart[] = [];
    tank.push({ geo: cyl(4.3, 3.4, 1.1, 16).translate(0, 0.55, 0), color: 0x7a5236 });
    tank.push({ geo: cyl(4.3, 4.3, 5, 18).translate(0, 3.6, 0), color: 0x8a5a3a });
    tank.push({ geo: stripeByAngle(cyl(4.34, 4.34, 0.9, 32, true).translate(0, 2.0, 0), 0x1d1d1d, 0xffc21a, 12), color: 0xffffff, keepColor: true });
    tank.push({ geo: cone(4.6, 2.4, 16).translate(0, 7.3, 0), color: 0x6b4a33 });
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3;
      tank.push({ geo: ball(0.7 + (k % 2) * 0.4, 6, 4).scale(1, 1.3, 0.2).rotateY(Math.PI / 2 - a).translate(Math.cos(a) * 4.25, 4 + (k % 3), Math.sin(a) * 4.25), color: 0x5a2e18 });
    }
    const badge = new THREE.PlaneGeometry(2.4, 2.4);
    badge.rotateY(Math.PI);
    badge.translate(0, 4.4, -4.34);
    tank.push({ geo: badge, color: 0xffffff, uv: CELLS.signBiohazard });
    moveParts(tank, 0, legH, 0, 0, 1, 0.02, 0.1);
    P.push(...tank);
    P.push({ geo: box(0.5, legH, 0.08).translate(0.4, legH / 2, -3.6), color: 0x4a3a30 });
    place(batch, P, spot.x, spot.y - 0.4, spot.z, spot.facing);
  }

  // ---- stranded bus with a zombie waiting on the roof
  {
    const spot = siteSpot(ctx, 'bus');
    const P: GlowPart[] = [];
    const L = 11;
    P.push({ geo: box(2.6, 2.5, L).translate(0, 1.85, 0), color: 0xd9a232 });
    P.push({ geo: box(2.4, 1.3, 2.2).translate(0, 1.25, -L / 2 - 1.1), color: 0xd9a232 });
    P.push({ geo: box(2.62, 0.18, L).translate(0, 1.4, 0), color: 0x1d1d1d });
    P.push({ geo: box(2.62, 0.18, L).translate(0, 2.05, 0), color: 0x1d1d1d });
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 6; k++) P.push({ geo: box(0.05, 0.8, 1.3).translate(sx * 1.31, 2.55, -L / 2 + 1.2 + k * 1.72), color: 0x2a3036 });
      P.push({ geo: box(0.03, 0.9, 1.8).translate(sx * 1.315, 1.6, -1 + sx * 2.5), color: 0x7a4020 });
    }
    P.push({ geo: box(2.3, 1.0, 0.05).translate(0, 2.6, -L / 2 - 0.02), color: 0x2a3036 });
    for (const zs of [-L / 2 + 1.2, L / 2 - 2]) {
      for (const sx of [-1, 1]) P.push({ geo: cyl(0.55, 0.55, 0.35, 10).rotateZ(Math.PI / 2).scale(1, zs > 0 && sx > 0 ? 0.7 : 1, 1).translate(sx * 1.2, 0.5, zs), color: 0x1e1e20 });
    }
    P.push(...moveParts(zombieParts({ skin: 0x9ad07a, shirt: 0x3f6f9a, pants: 0x5a4a3a, hair: 0x3a2a1a, pose: 'wave' }), 0.3, 3.1, 1.5, 0.3, 1));
    P.push(...moveParts(tapeFenceParts(8), 0, 0, -L / 2 - 4.5, 0.15, 1));
    P.push(...moveParts(signParts(CELLS.signZombie, 1.3, 2.4), -3, 0, -L / 2 - 3, 0.3, 1.1));
    place(batch, P, spot.x, spot.y - 0.35, spot.z, spot.facing + Math.PI / 2 + 0.3, 1, 0, 0.08);
  }

  // ---- ash-dusted mesas far out
  {
    const parts: { geo: THREE.BufferGeometry; color: number | THREE.Color }[] = [];
    const strata = [0x8a6a58, 0x9e7c64, 0xb09078, 0x7e6252, 0xa88a74];
    const mesaAt = (spot: Spot, baseR: number, layers: { r: number; h: number }[], seed: number): void => {
      let y = spot.y - 1.5;
      layers.forEach((L, li) => {
        const g = new THREE.CylinderGeometry(L.r, L.r * 1.12, L.h, 14, 1);
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < pos.count; v++) {
          const x = pos.getX(v);
          const z = pos.getZ(v);
          const a = Math.atan2(z, x);
          const n = 0.82 + 0.36 * fbm2(Math.cos(a) * 2 + seed + li * 3, Math.sin(a) * 2 + seed, 2);
          pos.setX(v, x * n);
          pos.setZ(v, z * n * 0.85);
        }
        g.translate(spot.x, y + L.h / 2, spot.z);
        parts.push({ geo: g, color: strata[(li + seed) % strata.length] });
        y += L.h;
      });
      const skirt = new THREE.ConeGeometry(baseR * 1.35, 3.5, 14);
      skirt.translate(spot.x, spot.y + 0.2, spot.z);
      parts.push({ geo: skirt, color: 0x6e5646 });
    };
    mesaAt(findSpot(ctx, 0.155, -1, 34, 26), 26, [{ r: 26, h: 9 }, { r: 22, h: 7 }, { r: 19, h: 8 }, { r: 12, h: 5 }], 1);
    mesaAt(findSpot(ctx, 0.83, 1, 30, 22), 22, [{ r: 22, h: 8 }, { r: 17, h: 10 }, { r: 15, h: 6 }], 3);
    const mesh = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    mesh.name = 'mesas';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    trackMesh(ctx, mesh);
    group.add(mesh);
  }

  addBatchMesh(group, batch.build(ctx, glowMaterial(propAtlas(ctx), { roughness: 0.9 }), 'wastelandLandmarks'));
}

// =====================================================================================
// Frozen Outbreak: frozen waterfall, abandoned polar station, zombies frozen in ice
// =====================================================================================
function iceMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.12,
    metalness: 0.05,
    emissive: 0x0c2e48,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
}

function frozenZombie(opaque: GlowPart[], ice: GlowPart[], x: number, y: number, z: number, yaw: number, s: number, variant: number): void {
  const looks = [
    { skin: 0x8fcf6a, shirt: 0x6a4a9a, pants: 0x3f4a6a, hair: 0x2a2030 },
    { skin: 0x9ad07a, shirt: 0xc8492f, pants: 0x4a4a3a, hair: 0x5a3a1a },
    { skin: 0x7fbf8a, shirt: 0x3f8f9a, pants: 0x3a3a4a, hair: 0x1a1a22 },
  ][variant % 3];
  const pose = variant % 2 === 0 ? 'up' : 'wave';
  opaque.push(...moveParts(zombieParts({ ...looks, pose, surprised: true }), x, y + 0.05 * s, z, yaw, s));
  const block = box(1.7, 2.7, 1.5);
  block.translate(0, 1.3, -0.1);
  ice.push(...moveParts([{ geo: block, color: 0xcdefff }], x, y, z, yaw, s, 0, (variant - 1) * 0.04));
  for (let k = 0; k < 3; k++) {
    const chunk = new THREE.DodecahedronGeometry(0.45, 0);
    chunk.translate(-0.9 + k * 0.9, 0.2, -0.9 + (k % 2) * 1.6);
    ice.push(...moveParts([{ geo: chunk, color: 0xb8e4ff }], x, y, z, yaw, s));
  }
}

function buildOutbreakLandmarks(ctx: BuildContext, group: THREE.Group): void {
  const batch = new PropBatch();
  const iceParts: GlowPart[] = [];

  // ---- frozen waterfall: the cascade faces the track (local -Z)
  {
    const spot = siteSpot(ctx, 'waterfall');
    const W = 46;
    const H = 26;
    const rock: GlowPart[] = [];
    const ice: GlowPart[] = [];
    for (let k = 0; k < 3; k++) {
      const slab = box(W + k * 4, H / 3 + 0.6, 10 + k * 2.5);
      slab.translate(0, (k + 0.5) * (H / 3), k * 1.2 + 4);
      rock.push({ geo: slab, color: k === 0 ? 0x94a2b2 : k === 1 ? 0xa2afbe : 0xb0bcc8 });
    }
    rock.push({ geo: box(W + 9, 1.4, 16).translate(0, H + 0.6, 6.5), color: 0xf6fbff });
    const rng = ctx.rng;
    for (let k = 0; k < 14; k++) {
      const x = -W / 2 + 3 + (k / 13) * (W - 6) + (rng() - 0.5) * 1.5;
      const h = H * (0.55 + rng() * 0.45);
      const r = 1.1 + rng() * 1.3;
      const col = cyl(r * 0.55, r, h, 7);
      col.translate(x, H - h / 2 + 0.4, -1.4 + (rng() - 0.5) * 1.0);
      ice.push({ geo: col, color: 0xdff4ff });
      const ic = cone(r * 0.5, 2.6 + rng() * 2, 6);
      ic.rotateX(Math.PI);
      ic.translate(x, H - h - 1.3, -1.6);
      ice.push({ geo: ic, color: 0xdff4ff });
    }
    const pool = cyl(W * 0.42, W * 0.5, 1.2, 18);
    pool.scale(1, 1, 0.55);
    pool.translate(0, 0.4, -6);
    ice.push({ geo: pool, color: 0xcfeeff });
    // a surprised zombie caught mid-cascade
    frozenZombie(rock, ice, 6, 2.2, -5.6, 0, 2.4, 0);
    for (let k = 0; k < 3; k++) rock.push({ geo: box(W + k * 4 + 0.6, 0.7, 2.4).translate(0, (k + 1) * (H / 3) - 0.1, k * 1.2 + 4 - (5 + k * 1.25) + 1.0), color: 0xf2f7fb });
    place(batch, rock, spot.x, spot.y - 1.5, spot.z, spot.facing);
    iceParts.push(...moveParts(ice, spot.x, spot.y - 1.5, spot.z, spot.facing));
  }

  // ---- abandoned polar research station
  {
    const spot = siteSpot(ctx, 'station');
    const P: GlowPart[] = [];
    const addModule = (x: number, z: number, len: number, yaw: number, body: number): void => {
      const M: GlowPart[] = [];
      for (const lx of [-len / 2 + 0.6, 0, len / 2 - 0.6]) {
        for (const lz of [-2.2, 2.2]) M.push({ geo: box(0.3, 2.2, 0.3).translate(lx, 1.1, lz), color: 0x4a4e56 });
      }
      M.push({ geo: box(len, 3.2, 5.6).translate(0, 3.8, 0), color: body });
      const roof = new THREE.CylinderGeometry(2.8, 2.8, len + 0.2, 12, 1, false, 0, Math.PI);
      roof.rotateZ(Math.PI / 2);
      roof.scale(1, 0.45, 1);
      roof.translate(0, 5.4, 0);
      M.push({ geo: roof, color: 0xeef5fb });
      for (let k = 0; k < Math.floor(len / 2.6); k++) {
        const wx = -len / 2 + 1.6 + k * 2.6;
        const lit = (k * 7 + Math.floor(x)) % 4 === 1;
        M.push({ geo: box(1.2, 0.9, 0.08).translate(wx, 4.2, -2.84), color: lit ? 0xb6ff6a : 0x1e2630, glow: lit ? 1.8 : 0 });
      }
      M.push({ geo: box(1.2, 2.0, 0.1).translate(len / 2 - 1.2, 3.25, -2.86), color: 0x5a5e66 });
      M.push({ geo: box(0.08, 1.8, 0.05).translate(len / 2 - 0.6, 3.25, -2.92), color: 0x9dff5a, glow: 2.2 });
      M.push({ geo: ball(2.2, 8, 5).scale(1.6, 0.4, 1).translate(len / 2 - 1, 0.2, -3.2), color: 0xf4f9ff });
      P.push(...moveParts(M, x, 0, z, yaw));
    };
    addModule(-6, 0, 12, 0, 0xc8492f);
    addModule(9, 3, 10, -0.3, 0x3f6f9a);
    addModule(0, 12, 10, 0.1, 0xd9a232);
    // tube corridor
    P.push({ geo: cyl(0.9, 0.9, 4, 10).rotateZ(Math.PI / 2).translate(1.8, 3.6, 0.5), color: 0x9aa0a8 });
    // radar dome on a tower
    P.push({ geo: box(3.2, 7, 3.2).translate(-15, 3.5, 8), color: 0x7a7f88 });
    P.push({ geo: new THREE.SphereGeometry(2.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-15, 7, 8), color: 0xf2f5f8 });
    // antenna mast with a red beacon
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const leg = cyl(0.06, 0.1, 22, 5);
      leg.translate(0, 11, 0);
      leg.rotateZ(0.03);
      leg.rotateY(a);
      leg.translate(15 + Math.cos(a) * 0.6, 0, 12 + Math.sin(a) * 0.6);
      P.push({ geo: leg, color: 0xc8492f });
    }
    P.push({ geo: ball(0.45, 8, 6).translate(15, 22.3, 12), color: 0xff2a1a, glow: 3 });
    // fuel tanks with hazard bands
    for (let k = 0; k < 2; k++) {
      const tank = cyl(1.3, 1.3, 5, 14);
      tank.rotateZ(Math.PI / 2);
      tank.translate(14, 1.6, -4 + k * 3);
      P.push({ geo: tank, color: 0xffc21a });
      const band = stripeByAngle(cyl(1.34, 1.34, 0.6, 20, true), 0x1d1d1d, 0xffc21a, 6);
      band.rotateZ(Math.PI / 2);
      band.translate(14, 1.6, -4 + k * 3);
      P.push({ geo: band, color: 0xffffff, keepColor: true });
    }
    // quarantine perimeter
    P.push(...moveParts(tapeFenceParts(18), -4, 0, -7.5, 0, 1.1));
    P.push(...moveParts(tapeFenceParts(10), 11, 0, -9, -0.2, 1.1));
    P.push(...moveParts(signParts(CELLS.signBiohazard, 1.8, 2.6), 5.5, 0, -8.3, 0, 1));
    P.push(...moveParts(signParts(CELLS.signHand, 1.6, 2.2), -13, 0, -8, 0.2, 1));
    P.push(...moveParts(floodlightParts(8), -17, 0, -4, 0.3, 1));
    P.push(...moveParts(tentParts(0x6f7a4a, true), 17, 0, 18, -0.5, 1));
    P.push(...moveParts(crateParts(0x8a6a44), -9, 0, -5, 0.3, 1.2));
    P.push(...moveParts(barrelParts(0x3f6f9a, true, true), -10.5, 0, -4.2, 0, 1.2));
    // snowdrifts
    for (let k = 0; k < 6; k++) {
      P.push({ geo: ball(3, 9, 5).scale(1.4, 0.3, 1).translate(-18 + k * 7, 0, 16 - (k % 2) * 30), color: 0xf4f9ff });
    }
    place(batch, P, spot.x, spot.y - 0.3, spot.z, spot.facing, 1.45);
  }

  // ---- zombies frozen solid beside the route
  const opaque: GlowPart[] = [];
  ['iceA', 'iceB', 'iceC', 'iceD'].forEach((name, k) => {
    const spot = siteSpot(ctx, name);
    frozenZombie(opaque, iceParts, spot.x, spot.y - 0.15, spot.z, spot.facing + (k % 2 === 0 ? 0.3 : -0.3), k < 2 ? 1.7 : 1.35, k);
  });
  batch.addParts(opaque);

  addBatchMesh(group, batch.build(ctx, glowMaterial(propAtlas(ctx), { roughness: 0.8 }), 'outbreakLandmarks'));
  if (iceParts.length) {
    const iceMesh = new THREE.Mesh(mergeGlow(iceParts), iceMaterial());
    iceMesh.name = 'frozenIce';
    iceMesh.renderOrder = 2;
    trackMesh(ctx, iceMesh);
    group.add(iceMesh);
  }
}

// =====================================================================================
// Neon Quarantine: warning hologram, checkpoint, monorail
// =====================================================================================
function buildQuarantineLandmarks(ctx: BuildContext, group: THREE.Group): void {
  const batch = new PropBatch();
  const atlas = propAtlas(ctx);

  // ---- giant warning hologram (single-sided screen, solid frame behind)
  const screens = new PropBatch();
  {
    const spot = siteSpot(ctx, 'holo');
    const W = 30;
    const H = 15;
    const base = 16;
    const P: GlowPart[] = [];
    for (const sx of [-1, 1]) {
      P.push({ geo: box(1.2, base + H, 1.2).translate(sx * (W / 2 - 1.5), (base + H) / 2, 1.0), color: 0x1c1c2a });
    }
    P.push({ geo: box(W + 1.6, H + 1.6, 0.9).translate(0, base + H / 2, 0.5), color: 0x121220 });
    P.push({ geo: box(W + 2.4, 0.5, 1.6).translate(0, base + H + 1.1, 0.2), color: 0xffc21a, glow: 1.8 });
    P.push({ geo: box(W + 2.4, 0.5, 1.6).translate(0, base - 1.1, 0.2), color: 0xff3b3b, glow: 1.8 });
    for (const sx of [-1, 1]) P.push({ geo: ball(0.6, 8, 6).translate(sx * (W / 2 + 1.2), base + H + 1.1, 0.2), color: 0xff2a1a, glow: 3 });
    place(batch, P, spot.x, spot.y - 0.5, spot.z, spot.facing);
    const screen = new THREE.PlaneGeometry(W, H);
    screen.rotateY(Math.PI);
    screen.translate(0, base + H / 2, -0.05);
    place(screens, [{ geo: screen, color: 0xffffff, uv: CELLS.holoWide }], spot.x, spot.y - 0.5, spot.z, spot.facing);
  }

  // ---- quarantine checkpoint
  {
    const spot = siteSpot(ctx, 'checkpoint');
    const P: GlowPart[] = [];
    // guard booth
    P.push({ geo: box(3.4, 3.0, 3.0).translate(0, 1.5, 0), color: 0xdfe3ea });
    P.push({ geo: box(4.0, 0.3, 3.6).translate(0, 3.15, 0), color: 0x2a2a34 });
    P.push({ geo: box(2.6, 1.1, 0.08).translate(0, 1.9, -1.54), color: 0x7ff0ff, glow: 1.6 });
    P.push({ geo: box(0.08, 1.1, 2.0).translate(1.74, 1.9, 0), color: 0x7ff0ff, glow: 1.6 });
    P.push({ geo: box(3.42, 0.35, 3.02).translate(0, 0.6, 0), color: 0xffffff, uv: CELLS.stripesYellow });
    P.push({ geo: ball(0.25, 8, 6).translate(-0.8, 3.5, 0), color: 0xff2a1a, glow: 3 });
    P.push({ geo: ball(0.25, 8, 6).translate(0.8, 3.5, 0), color: 0x2a6aff, glow: 3 });
    // raised boom barriers
    for (const sx of [-1, 1]) {
      const bx = sx * 3.2;
      P.push({ geo: box(0.6, 1.1, 0.6).translate(bx, 0.55, -2.4), color: 0x2a2a34 });
      const arm = box(0.25, 6.5, 0.18);
      arm.translate(0, 3.25, 0);
      arm.rotateZ(sx * 0.35);
      arm.translate(bx, 1.0, -2.4);
      P.push({ geo: arm, color: 0xffffff, uv: CELLS.stripesRed });
    }
    // stacked containers
    const container = (x: number, y: number, z: number, yaw: number, c: number): void => {
      const C: GlowPart[] = [{ geo: box(6, 2.5, 2.4).translate(0, 1.25, 0), color: c }];
      for (let k = 0; k < 9; k++) C.push({ geo: box(0.1, 2.3, 2.46).translate(-2.8 + k * 0.7, 1.25, 0), color: new THREE.Color(c).offsetHSL(0, 0, -0.08) });
      P.push(...moveParts(C, x, y, z, yaw));
    };
    container(9, 0, 3, 0.1, 0x2f7a7a);
    container(9.3, 2.5, 3.1, -0.05, 0xc8622f);
    container(-9, 0, 4, -0.2, 0x5a5a8a);
    // concrete blocks + barricades out front
    for (let k = 0; k < 4; k++) P.push(...moveParts(concreteBlockParts(), -8 + k * 2.3 + (k > 1 ? 7.2 : 0), 0, -5.5, (k - 1.5) * 0.05, 1));
    P.push(...moveParts(signParts(CELLS.signBiohazard, 2.0, 3.2), 5.5, 0, -4.5, 0.2, 1));
    P.push(...moveParts(signParts(CELLS.signHand, 2.0, 3.2), -5.6, 0, -4.5, -0.2, 1));
    P.push(...moveParts(floodlightParts(9), 13, 0, -2, -0.4, 1));
    P.push(...moveParts(floodlightParts(9), -13, 0, -1, 0.4, 1));
    P.push(...moveParts(tapeFenceParts(10), 13, 0, -4.5, 0.3, 1));
    P.push(...moveParts(tentParts(0xdfe3ea, false), -3, 0, 8, 0.2, 1.3));
    P.push(...moveParts(barrelParts(0xe0b030, true, true), 4.5, 0, 1.5, 0, 1.2));
    P.push(...moveParts(barrelParts(0xe0b030, true, true), 5.3, 0, 2.3, 0, 1.2));
    // zombies peeking over the containers
    const peek = { skin: 0x8fcf6a, shirt: 0x5a4a8a, pants: 0x3a3a4a, hair: 0x1a1a22 };
    P.push(...moveParts(zombieParts({ ...peek, pose: 'wave' }), 8, 5.0, 3.6, 0.2, 1.1));
    P.push(...moveParts(zombieParts({ ...peek, shirt: 0x3f8f5a, pose: 'reach' }), 10.8, 5.0, 3.2, -0.15, 1.1));
    place(batch, P, spot.x, spot.y - 0.3, spot.z, spot.facing);
  }

  addBatchMesh(group, batch.build(ctx, glowMaterial(atlas, { roughness: 0.55, metalness: 0.2 }), 'quarantineLandmarks'));

  const screenMat = new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, opacity: 0.92 });
  addBatchMesh(group, screens.build(ctx, screenMat, 'holoBillboardScreen', false, false));
  ctx.updaters.push((_dt, elapsed) => {
    const flicker = Math.sin(elapsed * 23.0) > 0.96 ? 0.55 : 1;
    screenMat.color.setScalar((1.45 + 0.25 * Math.sin(elapsed * 1.7)) * flicker);
    screenMat.opacity = 0.86 + 0.08 * Math.sin(elapsed * 3.3);
  });

  addMonorail(ctx, group);
}

function addMonorail(ctx: BuildContext, group: THREE.Group): void {
  const { cl, field } = ctx;
  // Elevated beam running beside the long straight and around hairpin 2 (t 0.44 .. 0.86), outer side.
  const t0 = 0.44;
  const t1 = 0.86;
  const side = -1;
  const lateralExtra = 15;
  const railY = 11.5;
  const n = cl.n;
  const i0 = Math.floor(t0 * n);
  const i1 = Math.floor(t1 * n);
  const step = 4;
  const count = Math.floor((i1 - i0) / step) + 1;
  const hw = 0.9;
  const hh = 0.55;
  const verts = new Float32Array(count * 4 * 3);
  const idx: number[] = [];
  const baseY = (i: number): number => cl.py[i] + railY;
  for (let k = 0; k < count; k++) {
    const i = i0 + k * step;
    const lat = cl.whw[i] + lateralExtra;
    const x = cl.px[i] + cl.bx[i] * side * lat;
    const z = cl.pz[i] + cl.bz[i] * side * lat;
    const y = baseY(i);
    const corners = [
      [x - cl.bx[i] * hw, y + hh, z - cl.bz[i] * hw],
      [x + cl.bx[i] * hw, y + hh, z + cl.bz[i] * hw],
      [x + cl.bx[i] * hw, y - hh, z + cl.bz[i] * hw],
      [x - cl.bx[i] * hw, y - hh, z - cl.bz[i] * hw],
    ];
    for (let c = 0; c < 4; c++) {
      const o = (k * 4 + c) * 3;
      verts[o] = corners[c][0];
      verts[o + 1] = corners[c][1];
      verts[o + 2] = corners[c][2];
    }
    if (k > 0) {
      const a = (k - 1) * 4;
      const b = k * 4;
      for (let c = 0; c < 4; c++) {
        const c2 = (c + 1) % 4;
        idx.push(a + c, b + c, a + c2, a + c2, b + c, b + c2);
      }
    }
  }
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  beamGeo.setIndex(idx);
  beamGeo.computeVertexNormals();
  beamGeo.computeBoundingSphere();
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a3c, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  beam.name = 'monorailBeam';
  beam.castShadow = true;
  trackMesh(ctx, beam);
  group.add(beam);

  // hazard-amber guide strip on the inner face of the beam
  const glowVerts = new Float32Array(count * 2 * 3);
  const glowIdx: number[] = [];
  for (let k = 0; k < count; k++) {
    const i = i0 + k * step;
    const lat = cl.whw[i] + lateralExtra - hw - 0.02;
    const x = cl.px[i] + cl.bx[i] * side * lat;
    const z = cl.pz[i] + cl.bz[i] * side * lat;
    const y = baseY(i);
    glowVerts.set([x, y + 0.12, z, x, y - 0.12, z], k * 6);
    if (k > 0) {
      const a = (k - 1) * 2;
      glowIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowVerts, 3));
  glowGeo.setIndex(glowIdx);
  glowGeo.computeVertexNormals();
  glowGeo.computeBoundingSphere();
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffa21a, emissiveIntensity: 1.6, side: THREE.DoubleSide }));
  glow.name = 'monorailGlow';
  trackMesh(ctx, glow);
  group.add(glow);

  const pylonGeo = new THREE.BoxGeometry(1.1, 1, 1.1);
  pylonGeo.translate(0, 0.5, 0);
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x1a1a28, roughness: 0.5, metalness: 0.5 });
  const spacing = 22;
  const span = (t1 - t0) * cl.length;
  const pylonCount = Math.floor(span / spacing) + 1;
  const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, pylonCount);
  for (let k = 0; k < pylonCount; k++) {
    const i = Math.min(i1, i0 + Math.floor(((k * spacing) / cl.length) * n));
    const lat = cl.whw[i] + lateralExtra;
    const x = cl.px[i] + cl.bx[i] * side * lat;
    const z = cl.pz[i] + cl.bz[i] * side * lat;
    const groundY = field.heightAt(x, z) - 0.5;
    const h = baseY(i) - hh - groundY;
    _p.set(x, groundY, z);
    _e.set(0, headingFromDir(cl.tx[i], cl.tz[i]), 0);
    _q.setFromEuler(_e);
    _s.set(1, h, 1);
    _m.compose(_p, _q, _s);
    pylons.setMatrixAt(k, _m);
  }
  pylons.instanceMatrix.needsUpdate = true;
  pylons.castShadow = true;
  pylons.name = 'monorailPylons';
  trackMesh(ctx, pylons);
  group.add(pylons);

  // evacuation train: 3 cars shuttling back and forth, green-lit windows with passengers
  const carParts3: GlowPart[] = [];
  const carLen = 7;
  for (let c = 0; c < 3; c++) {
    const z0 = (c - 1) * (carLen + 0.6);
    carParts3.push({ geo: box(2.4, 2.4, carLen).translate(0, hh + 1.5, z0), color: 0xe8ecf4 });
    carParts3.push({ geo: box(2.0, 0.4, carLen - 0.8).translate(0, hh + 2.9, z0), color: 0x2a2a3c });
    carParts3.push({ geo: box(2.6, 0.5, carLen - 0.4).translate(0, hh + 0.25, z0), color: 0x1a1a28 });
    for (const sx of [-1, 1]) {
      for (let w = 0; w < 3; w++) {
        const win = new THREE.PlaneGeometry(1.8, 0.95);
        win.rotateY(sx * Math.PI / 2);
        win.translate(sx * 1.215, hh + 1.9, z0 - 2.1 + w * 2.1);
        carParts3.push({ geo: win, color: 0xffffff, uv: w === 1 ? CELLS.zombieWindow : undefined, glow: 1.3 });
      }
      carParts3.push({ geo: box(0.06, 0.25, carLen - 0.6).translate(sx * 1.24, hh + 0.8, z0), color: 0xffc21a, glow: 1.2 });
    }
  }
  for (const dir of [-1, 1]) {
    const nose = cone(1.3, 2.2, 8);
    nose.rotateX(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    nose.translate(0, hh + 1.5, dir * (1.5 * carLen + 1.2 + 1.1));
    carParts3.push({ geo: nose, color: 0xe8ecf4 });
    carParts3.push({ geo: ball(0.3, 8, 6).translate(0, hh + 2.2, dir * (1.5 * carLen + 1.4)), color: 0xff3b1a, glow: 3 });
  }
  const train = new THREE.Mesh(mergeGlow(carParts3), glowMaterial(propAtlas(ctx), { roughness: 0.35, metalness: 0.4 }));
  train.name = 'monorailTrain';
  train.castShadow = true;
  trackMesh(ctx, train);
  group.add(train);

  const sStart = t0 * cl.length + 14;
  const sEnd = t1 * cl.length - 14;
  const speed = 16;
  const period = (sEnd - sStart) / speed;
  ctx.updaters.push((_dt, elapsed) => {
    const cycle = (period + 3) * 2;
    let u = (elapsed % cycle) / cycle;
    let forward = true;
    if (u >= 0.5) {
      u = (u - 0.5) * 2;
      forward = false;
    } else u *= 2;
    const dwell = 3 / (period + 3);
    const k = Math.min(1, Math.max(0, (u - dwell * 0.5) / (1 - dwell)));
    const s = forward ? lerp(sStart, sEnd, k) : lerp(sEnd, sStart, k);
    const i = Math.floor((s / cl.length) * n) % n;
    const lat = cl.whw[i] + lateralExtra;
    train.position.set(cl.px[i] + cl.bx[i] * side * lat, baseY(i), cl.pz[i] + cl.bz[i] * side * lat);
    const h = headingFromDir(cl.tx[i], cl.tz[i]);
    train.rotation.y = forward ? h : h + Math.PI;
  });
}
