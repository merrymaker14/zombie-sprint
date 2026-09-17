import * as THREE from 'three';
import type { BuildContext } from './context';
import { headingFromDir, indexAtS, track, trackMesh } from './context';
import { mergeParts } from './decor';
import {
  makeBannerTexture,
  makeBoostBaseTexture,
  makeBoostChevronTile,
  makeBoostTrailTexture,
  makeSignAtlas,
  makeStartBannerTexture,
  type SignAtlas,
  type SignSpec,
} from '../textures';
import { lerp } from '../../core/math';
import { t, trackName } from '../../core/i18n';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Length (metres) of the visible boost strip; the 'boost' surface region uses the same value. */
export const BOOST_PAD_LENGTH = 3.5;
/** Distance from the road edge (curb line) to the pad edge. */
const BOOST_PAD_INSET = 1.0;

export interface RoadFrame {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  hw: number;
  whw: number;
  heading: number;
}

/** Frame at arc-length s: position, forward (horizontal), right. */
export function frameAtS(ctx: BuildContext, s: number): RoadFrame {
  const cl = ctx.cl;
  const i = indexAtS(cl, s);
  const th = Math.hypot(cl.tx[i], cl.tz[i]) || 1;
  const fx = cl.tx[i] / th;
  const fz = cl.tz[i] / th;
  return {
    x: cl.px[i],
    y: cl.py[i],
    z: cl.pz[i],
    fx,
    fz,
    rx: cl.bx[i],
    rz: cl.bz[i],
    hw: cl.hw[i],
    whw: cl.whw[i],
    heading: headingFromDir(fx, fz),
  };
}

type Part = { geo: THREE.BufferGeometry; color: number | THREE.Color };

// -----------------------------------------------------------------------------------------------
// Theme looks and sign texts
// -----------------------------------------------------------------------------------------------

interface PropLook {
  concrete: number;
  accent: number;
  seatA: number;
  seatB: number;
  /** Alternating roof-lip segments (warning stripes). */
  lipA: number;
  lipB: number;
  metal: number;
  brace: number;
  chord: number;
  flags: number[];
  skin: number;
  sleeve: number;
}

function propLook(ctx: BuildContext): PropLook {
  switch (ctx.def.theme) {
    case 'desert':
      return {
        concrete: 0x8f7d6b, accent: 0x7c3a1e, seatA: 0xc99a48, seatB: 0x6d5a4a, lipA: 0xffc21a, lipB: 0x2a2320,
        metal: 0x7a4a2e, brace: 0xffc21a, chord: 0x3a2a22, flags: [0xd9822b, 0x8a8078, 0xffc21a], skin: 0x9cc46a, sleeve: 0x7a6a5a,
      };
    case 'snow':
      return {
        concrete: 0x8d9aa7, accent: 0x2c3e50, seatA: 0xf2c318, seatB: 0x46586a, lipA: 0xf2c318, lipB: 0x1e2730,
        metal: 0x6f7c89, brace: 0xf2c318, chord: 0x1e2730, flags: [0xf2c318, 0x1e2730, 0x7ac943], skin: 0x9fd0a0, sleeve: 0xc8452f,
      };
    case 'neon':
      return {
        concrete: 0x1a1a26, accent: 0x2a1450, seatA: 0x24163a, seatB: 0x1a2a44, lipA: 0x7dff4a, lipB: 0x151520,
        metal: 0x20202e, brace: 0x2a2a3a, chord: ctx.def.palette.curb, flags: [0x7dff4a], skin: 0x7dcf5a, sleeve: 0x3a2a66,
      };
    default:
      return {
        concrete: 0x77717f, accent: 0x4b2d63, seatA: 0x5e8f3a, seatB: 0x8d7fa0, lipA: 0xf08a24, lipB: 0x2a2033,
        metal: 0x3d3746, brace: 0x5b516a, chord: 0x7ac943, flags: [0x7ac943, 0x6b4f8a, 0xf08a24], skin: 0x8fcf5f, sleeve: 0x6b4f8a,
      };
  }
}

/** Three boards on the grandstand walls + two bridge banners per theme (translated text, pictograms, no brands). */
function signSpecs(ctx: BuildContext): { stands: SignSpec[]; bridges: SignSpec[] } {
  const name = trackName(ctx.def.id, ctx.def.name).toUpperCase();
  const INK = 0x1b1522;
  switch (ctx.def.theme) {
    case 'desert':
      return {
        stands: [
          { text: t('sign.hordeAhead'), bg: 0xffc21a, fg: INK, accent: INK, icon: 'walker', style: 'plain' },
          { text: t('sign.title'), bg: 0x2a1a14, fg: 0xffc21a, accent: 0xffc21a, icon: 'biohazard', style: 'hazard' },
          { text: t('sign.nextExit'), bg: 0x1f6b3a, fg: 0xffffff, accent: 0xffffff, icon: 'arrow', style: 'highway' },
        ],
        bridges: [
          { text: name, bg: 0x1f6b3a, fg: 0xffffff, accent: 0xffffff, icon: 'arrow', style: 'highway' },
          { text: t('sign.cautionHorde'), bg: 0x2a1a14, fg: 0xffc21a, accent: 0xffc21a, icon: 'skull', style: 'hazard' },
        ],
      };
    case 'snow':
      return {
        stands: [
          { text: t('sign.quarantineZone'), bg: 0x1e2730, fg: 0xffd21a, accent: 0xffd21a, icon: 'biohazard', style: 'hazard' },
          { text: t('sign.keepFrozen'), bg: 0xdff1ff, fg: 0x1f4f8a, accent: 0x1f4f8a, icon: 'frozen', style: 'plain' },
          { text: t('sign.title'), bg: 0x243646, fg: 0xa6ef5a, accent: 0xeef8ff, icon: 'hand', style: 'slime' },
        ],
        bridges: [
          { text: name, bg: 0x243646, fg: 0xdff1ff, accent: 0xeef8ff, icon: 'frozen', style: 'slime' },
          { text: t('sign.quarantine'), bg: 0x1e2730, fg: 0xffd21a, accent: 0xffd21a, icon: 'biohazard', style: 'hazard' },
        ],
      };
    case 'neon':
      return {
        stands: [
          { text: t('sign.quarantine'), bg: 0x14040a, fg: 0xff4a4a, accent: 0xffd21a, icon: 'biohazard', style: 'hologram' },
          { text: t('sign.zoneClosed'), bg: 0x0b0418, fg: 0xff2fd6, accent: 0x00e5ff, icon: 'skull', style: 'hologram' },
          { text: t('sign.title'), bg: 0x03160b, fg: 0x7dff4a, accent: 0x7dff4a, icon: 'zombie', style: 'hologram' },
        ],
        bridges: [
          { text: name, bg: 0x061a22, fg: 0x00e5ff, accent: 0xff2fd6, icon: 'walker', style: 'hologram' },
          { text: t('sign.cautionHorde'), bg: 0x14100a, fg: 0xffd21a, accent: 0xffd21a, icon: 'walker', style: 'hazard' },
        ],
      };
    default:
      return {
        stands: [
          { text: t('sign.title'), bg: 0x2c1d3d, fg: 0xa6ef5a, accent: 0x86d04a, icon: 'zombie', style: 'slime' },
          { text: t('sign.restInSpeed'), bg: 0x2e2c38, fg: 0xf1ead2, accent: 0xa9a6b8, icon: 'tombstone', style: 'plain' },
          { text: t('sign.cautionHorde'), bg: 0xf08a24, fg: INK, accent: INK, icon: 'skull', style: 'plain' },
        ],
        bridges: [
          { text: name, bg: 0x3b2750, fg: 0xf1ead2, accent: 0x86d04a, icon: 'hand', style: 'slime' },
          { text: t('sign.zombieCrossing'), bg: 0xffc21a, fg: INK, accent: INK, icon: 'walker', style: 'plain' },
        ],
      };
  }
}

const STAND_BOARD_W = 14;
const STAND_BOARD_H = 1.05;
const BRIDGE_BANNER_H = 1.8;

/** Arc-length positions of the two banner bridges (off the void section on Frostbite). */
function bridgeSpots(ctx: BuildContext): number[] {
  const L = ctx.cl.length;
  return [92, L * (ctx.def.voidRanges && ctx.def.voidRanges.length ? 0.72 : 0.55)];
}

interface SignKit {
  atlas: SignAtlas;
  material: THREE.MeshStandardMaterial;
}

const signKits = new WeakMap<BuildContext, SignKit>();

/** One atlas + one material shared by every board of the track (grandstands and bridges). */
function signKit(ctx: BuildContext): SignKit {
  const cached = signKits.get(ctx);
  if (cached) return cached;
  const isNight = ctx.def.theme === 'neon';
  const specs = signSpecs(ctx);
  const signs: { spec: SignSpec; aspect: number }[] = specs.stands.map((spec) => ({ spec, aspect: STAND_BOARD_W / STAND_BOARD_H }));
  for (const [k, s] of bridgeSpots(ctx).entries()) {
    const span = frameAtS(ctx, s).whw * 2 + 3.0;
    signs.push({ spec: specs.bridges[k % specs.bridges.length], aspect: (span - 1.2) / BRIDGE_BANNER_H });
  }
  const atlas = makeSignAtlas(signs, isNight);
  const material = new THREE.MeshStandardMaterial({
    map: atlas.texture,
    roughness: 0.6,
    emissive: 0xffffff,
    emissiveMap: atlas.texture,
    // a little self-light keeps the boards readable at dusk; neon boards glow
    emissiveIntensity: isNight ? 0.95 : 0.3,
  });
  track(ctx, atlas.texture);
  ctx.disposables.push(material);
  const kit = { atlas, material };
  signKits.set(ctx, kit);
  return kit;
}

/** Collects world-space textured quads (atlas rows) into one geometry. */
class QuadBatch {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];
  private readonly nrm: number[] = [];
  private readonly idx: number[] = [];

  /** Quad centred at (cx, cy, cz) facing the horizontal normal (nx, nz). */
  add(cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number, v0: number, v1: number): void {
    const rx = nz;
    const rz = -nx;
    const hw = w / 2;
    const hh = h / 2;
    const b = this.pos.length / 3;
    this.pos.push(
      cx - rx * hw, cy - hh, cz - rz * hw,
      cx + rx * hw, cy - hh, cz + rz * hw,
      cx + rx * hw, cy + hh, cz + rz * hw,
      cx - rx * hw, cy + hh, cz - rz * hw,
    );
    this.uv.push(0, v0, 1, v0, 1, v1, 0, v1);
    for (let k = 0; k < 4; k++) this.nrm.push(nx, 0, nz);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

// -----------------------------------------------------------------------------------------------
// Zombie spectators
// -----------------------------------------------------------------------------------------------

/** Per-vertex shading modes read by the crowd shader. */
const TINT_FIXED = 0;
const TINT_SKIN = 1;
const TINT_CLOTH = 2;
const TINT_PANTS = 3;
const TINT_SKIN_DARK = 4;

type ZombiePart = { geo: THREE.BufferGeometry; color: number; mode: number; arm?: number; extra?: number };

/** Box without the bottom and back (+Z) faces: never seen from the track. */
function openBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const src = g.index!.array;
  const keep: number[] = [];
  for (const face of [0, 1, 2, 5]) for (let k = 0; k < 6; k++) keep.push(src[face * 6 + k]);
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

const HEAD = { x: 0, y: 1.15, z: -0.03, a: 0.2, b: 0.19, c: 0.175 };
const _dz = new THREE.Vector3(0, 0, -1);
const _dn = new THREE.Vector3();

/** Place a flat +Z-facing decal on the head ellipsoid at (dx, dy), lifted along the surface normal. */
function onHead(geo: THREE.BufferGeometry, dx: number, dy: number, lift: number): THREE.BufferGeometry {
  geo.rotateY(Math.PI);
  const k = Math.max(0, 1 - (dx * dx) / (HEAD.a * HEAD.a) - (dy * dy) / (HEAD.b * HEAD.b));
  const dz = -HEAD.c * Math.sqrt(k);
  _dn.set(dx / (HEAD.a * HEAD.a), dy / (HEAD.b * HEAD.b), dz / (HEAD.c * HEAD.c)).normalize();
  geo.applyQuaternion(_q.setFromUnitVectors(_dz, _dn));
  geo.translate(HEAD.x + dx + _dn.x * lift, HEAD.y + dy + _dn.y * lift, HEAD.z + dz + _dn.z * lift);
  return geo;
}

function polyGeo(points: [number, number][]): THREE.BufferGeometry {
  return new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))));
}

/**
 * One cartoon zombie spectator (~1.35 m, feet at y = 0, facing -Z): tinted skin and clothes,
 * torn shirt hem, odd-sized eyes, crooked teeth, messy hair, arms stretched forward with limp
 * hands. Parts with `extra` 1/2 are alternative accessories (head bandage + patch, or stitches +
 * arm bandage + torn hole) picked per instance in the shader.
 */
function buildZombieSpectatorGeometry(): THREE.BufferGeometry {
  const parts: ZombiePart[] = [];
  const W = 0xffffff;
  // legs and torso
  for (const sx of [-1, 1]) parts.push({ geo: openBox(0.15, 0.48, 0.2).translate(sx * 0.095, 0.24, 0), color: W, mode: TINT_PANTS });
  parts.push({ geo: openBox(0.44, 0.5, 0.26).translate(0, 0.72, 0), color: W, mode: TINT_CLOTH });
  // torn hem hanging over the trousers
  const hem: [number, number][] = [[-0.22, 0.02], [0.22, 0.02], [0.22, -0.05], [0.14, 0], [0.07, -0.08], [0.0, -0.01], [-0.08, -0.07], [-0.15, 0], [-0.22, -0.06]];
  parts.push({ geo: polyGeo(hem).rotateY(Math.PI).translate(0, 0.47, -0.132), color: 0xd8d8d8, mode: TINT_CLOTH });
  parts.push({ geo: new THREE.PlaneGeometry(0.11, 0.1).rotateY(Math.PI).translate(0.1, 0.84, -0.133), color: 0xc9a86a, mode: TINT_FIXED, extra: 1 });
  parts.push({ geo: polyGeo([[-0.05, 0.03], [0.04, 0.05], [0.06, -0.01], [0.01, -0.05], [-0.05, -0.03]]).rotateY(Math.PI).translate(-0.1, 0.62, -0.133), color: W, mode: TINT_SKIN, extra: 2 });
  // head
  parts.push({ geo: new THREE.SphereGeometry(1, 8, 5).scale(HEAD.a, HEAD.b, HEAD.c).translate(HEAD.x, HEAD.y, HEAD.z), color: W, mode: TINT_SKIN });
  // messy hair
  const tufts: [number, number, number][] = [[-0.07, -0.55, 0.02], [0.0, 0.1, -0.02], [0.08, 0.6, 0.01]];
  for (const [x, tilt, z] of tufts) {
    parts.push({ geo: new THREE.ConeGeometry(0.055, 0.15, 4, 1, true).rotateZ(tilt).translate(HEAD.x + x, HEAD.y + 0.2, HEAD.z + z), color: 0x2d2433, mode: TINT_FIXED });
  }
  // tired rings, odd-sized eyes looking different ways, crooked grin
  parts.push({ geo: onHead(new THREE.CircleGeometry(0.082, 7), 0.075, 0.022, 0.004), color: W, mode: TINT_SKIN_DARK });
  parts.push({ geo: onHead(new THREE.CircleGeometry(0.058, 6), -0.08, 0.014, 0.004), color: W, mode: TINT_SKIN_DARK });
  parts.push({ geo: onHead(new THREE.CircleGeometry(0.066, 7), 0.075, 0.036, 0.011), color: 0xf8f8ee, mode: TINT_FIXED });
  parts.push({ geo: onHead(new THREE.CircleGeometry(0.045, 6), -0.08, 0.026, 0.011), color: 0xf8f8ee, mode: TINT_FIXED });
  parts.push({ geo: onHead(new THREE.CircleGeometry(0.027, 5), 0.058, 0.03, 0.019), color: 0x151018, mode: TINT_FIXED });
  parts.push({ geo: onHead(new THREE.CircleGeometry(0.02, 5), -0.068, 0.036, 0.019), color: 0x151018, mode: TINT_FIXED });
  parts.push({ geo: onHead(polyGeo([[-0.075, 0.012], [0.07, 0.03], [0.064, -0.012], [-0.058, -0.032]]), 0, -0.078, 0.006), color: 0x2a1a22, mode: TINT_FIXED });
  parts.push({ geo: onHead(new THREE.PlaneGeometry(0.03, 0.032), -0.022, -0.07, 0.012), color: 0xf4f0dc, mode: TINT_FIXED });
  parts.push({ geo: onHead(new THREE.PlaneGeometry(0.026, 0.04), 0.03, -0.066, 0.012), color: 0xf4f0dc, mode: TINT_FIXED });
  // accessory A: bandage round the head
  parts.push({
    geo: new THREE.CylinderGeometry(0.2, 0.2, 0.055, 9, 1, true).scale(1.04, 1, 0.93).rotateZ(0.32).translate(HEAD.x, HEAD.y + 0.075, HEAD.z),
    color: 0xece6d2,
    mode: TINT_FIXED,
    extra: 1,
  });
  // accessory B: forehead stitches
  parts.push({ geo: onHead(new THREE.PlaneGeometry(0.11, 0.014), -0.03, 0.115, 0.008), color: 0x2a2030, mode: TINT_FIXED, extra: 2 });
  for (const x of [-0.065, -0.03, 0.005]) parts.push({ geo: onHead(new THREE.PlaneGeometry(0.012, 0.045), x, 0.115, 0.01), color: 0x2a2030, mode: TINT_FIXED, extra: 2 });
  // arms stretched toward the track, hands hanging limp
  for (const sx of [1, -1]) {
    const arm = sx > 0 ? 1 : 2;
    parts.push({ geo: new THREE.BoxGeometry(0.13, 0.13, 0.24).translate(sx * 0.29, 0.88, -0.1), color: W, mode: TINT_CLOTH, arm });
    parts.push({ geo: new THREE.BoxGeometry(0.1, 0.1, 0.26).translate(sx * 0.29, 0.88, -0.34), color: 0xeeeeee, mode: TINT_SKIN, arm });
    parts.push({ geo: new THREE.BoxGeometry(0.13, 0.045, 0.13).translate(0, 0, -0.06).rotateX(-0.55).translate(sx * 0.29, 0.885, -0.47), color: W, mode: TINT_SKIN, arm });
  }
  parts.push({ geo: new THREE.BoxGeometry(0.118, 0.118, 0.07).translate(0.29, 0.88, -0.33), color: 0xece6d2, mode: TINT_FIXED, arm: 1, extra: 2 });

  const counts = parts.map((p) => (p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count));
  const geo = mergeParts(parts.map((p) => ({ geo: p.geo, color: p.color })));
  const total = counts.reduce((a, b) => a + b, 0);
  const zombie = new Float32Array(total * 3);
  let o = 0;
  parts.forEach((p, i) => {
    for (let k = 0; k < counts[i]; k++, o += 3) {
      zombie[o] = p.mode;
      zombie[o + 1] = p.arm ?? 0;
      zombie[o + 2] = p.extra ?? 0;
    }
  });
  geo.setAttribute('aZombie', new THREE.BufferAttribute(zombie, 3));
  return geo;
}

const ZOMBIE_SKINS = [0x8fcf5f, 0x7fb957, 0x9fc28a, 0xa7d3a0, 0x6fae6b, 0x8fae9e, 0xb5cd72, 0x82bfae];
const ZOMBIE_CLOTHES = [0x6b4f8a, 0x3f5f8a, 0x5a6b3a, 0xa08a5a, 0x4a4a55, 0x2f7a78, 0xc9b9a0, 0x8a5a9a, 0xc07a2a, 0x7a4a36];

/** Instanced shader-animated zombie crowd: shambling sway, reaching arms, some cheering. One draw call. */
function buildZombieCrowd(ctx: BuildContext, slots: { x: number; y: number; z: number; heading: number }[]): THREE.InstancedMesh {
  const rng = ctx.rng;
  const geo = buildZombieSpectatorGeometry();
  const phases = new Float32Array(slots.length);
  const shirts = new Float32Array(slots.length * 3);
  for (let i = 0; i < slots.length; i++) {
    phases[i] = rng() * Math.PI * 2;
    _c.setHex(ZOMBIE_CLOTHES[Math.floor(rng() * ZOMBIE_CLOTHES.length)]).offsetHSL(0, 0, (rng() - 0.5) * 0.08);
    shirts[i * 3] = _c.r;
    shirts[i * 3 + 1] = _c.g;
    shirts[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirts, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const timeUniform = ctx.timeUniform;
  // Faint self-light in the tint colours so the crowd still reads at night (eyes glow less than skin).
  const glow = { value: ctx.def.theme === 'neon' ? 0.5 : ctx.def.theme === 'grassland' ? 0.1 : 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uCrowdGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCrowdGlow;
varying float vZsGlow;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef USE_COLOR
totalEmissiveRadiance += vColor.rgb * uCrowdGlow * vZsGlow;
#endif`,
      );
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
attribute float aPhase;
attribute vec3 aShirt;
attribute vec3 aZombie;
varying float vZsGlow;
mat3 zsRotX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 zsRotZ(float a) { float c = cos(a); float s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
{
  float m = aZombie.x;
  vec3 tint = vec3(1.0);
  tint = mix(tint, instanceColor.rgb, step(0.5, m) * step(m, 1.5));
  tint = mix(tint, aShirt, step(1.5, m) * step(m, 2.5));
  tint = mix(tint, aShirt * 0.42 + 0.015, step(2.5, m) * step(m, 3.5));
  tint = mix(tint, instanceColor.rgb * 0.58, step(3.5, m));
  vColor.rgb = color.rgb * tint;
}
#endif`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
float zsRate = 0.75 + 0.5 * fract(aPhase * 3.71);
float zsT = uTime * zsRate + aPhase;
float zsCheer = step(0.74, fract(aPhase * 7.13));
float zsSide = step(1.5, aZombie.y);
float zsArmA = step(0.5, aZombie.y) * mix(0.05 + 0.18 * sin(zsT * 2.3 + zsSide * 1.2), 1.05 + 0.4 * sin(zsT * 5.0 + zsSide * 3.14), zsCheer);
mat3 zsArm = zsRotX(zsArmA);
mat3 zsBody = zsRotZ(0.1 * sin(zsT * 1.7)) * zsRotX(-0.08 + 0.05 * sin(zsT * 1.1 + 1.3));
objectNormal = zsBody * (zsArm * objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vZsGlow = mix(0.35, 1.0, step(0.5, aZombie.x));
float zsPick = step(0.5, fract(aPhase * 5.31));
float zsShow = 1.0 - step(0.5, aZombie.z) * (1.0 - step(1.5, aZombie.z)) * (1.0 - zsPick) - step(1.5, aZombie.z) * zsPick;
transformed = zsArm * (transformed - vec3(0.0, 0.88, 0.0)) + vec3(0.0, 0.88, 0.0);
transformed = zsBody * transformed;
transformed.y += abs(sin(zsT * 1.7)) * 0.035;
transformed *= zsShow;`,
      );
  };
  mat.customProgramCacheKey = () => 'zs-zombie-crowd';
  const crowd = new THREE.InstancedMesh(geo, mat, slots.length);
  crowd.name = 'crowd';
  crowd.castShadow = false;
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    _p.set(sl.x, sl.y, sl.z);
    _e.set(0, sl.heading, 0);
    _q.setFromEuler(_e);
    const sc = 0.9 + rng() * 0.22;
    _s.set(sc, sc * (0.94 + rng() * 0.12), sc);
    _m.compose(_p, _q, _s);
    crowd.setMatrixAt(i, _m);
    crowd.setColorAt(i, _c.setHex(ZOMBIE_SKINS[Math.floor(rng() * ZOMBIE_SKINS.length)]));
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.computeBoundingSphere();
  trackMesh(ctx, crowd);
  return crowd;
}

// -----------------------------------------------------------------------------------------------
// Grandstands
// -----------------------------------------------------------------------------------------------

/**
 * Smallest distance (metres) beyond the wall line over local (lateral, along) points of frame f,
 * checked against the centerline within `window` metres of arc length around `s0`.
 */
function footprintClearance(ctx: BuildContext, f: RoadFrame, pts: [number, number][], s0: number, window: number): number {
  const cl = ctx.cl;
  const L = cl.length;
  let best = Infinity;
  for (const [lat, along] of pts) {
    const x = f.x + f.rx * lat - f.fx * along;
    const z = f.z + f.rz * lat - f.fz * along;
    for (let i = 0; i < cl.n; i++) {
      const ds = ((((i / cl.n) * L - s0) % L) + L * 1.5) % L - L / 2;
      if (Math.abs(ds) > window) continue;
      const d = Math.hypot(cl.px[i] - x, cl.pz[i] - z) - cl.whw[i];
      if (d < best) best = d;
    }
  }
  return best;
}

/** Stadium grandstands on both sides of the start straight, with warning boards, floodlights and a zombie crowd. */
export function buildGrandstands(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grandstands';
  const theme = ctx.def.theme;
  const rng = ctx.rng;
  const look = propLook(ctx);
  const length = 66;
  const tiers = 6;
  const tierDepth = 1.9;
  const tierRise = 1.05;
  const centerS = 16; // metres past the finish line
  const f = frameAtS(ctx, centerS);
  const isNight = theme === 'neon';
  const accent = new THREE.Color(look.accent);
  const concrete = new THREE.Color(look.concrete);
  const seatA = new THREE.Color(look.seatA);
  const seatB = new THREE.Color(look.seatB);

  // Per-side distance of the front wall: the box is straight, so push it out until its front edge
  // keeps clear of the wall line of the start section along its whole length (curves included).
  const minClear = 3.2;
  const baseFor = (side: number): number => {
    let b = f.whw + 3.5;
    for (let iter = 0; iter < 12; iter++) {
      const pts: [number, number][] = [];
      for (let a = -length / 2 - 1; a <= length / 2 + 1; a += 2) pts.push([side * (b - 0.35), a]);
      const c = footprintClearance(ctx, f, pts, centerS, length / 2 + 30);
      if (c >= minClear) break;
      b += minClear - c + 0.05;
    }
    return b;
  };
  const bases = new Map<number, number>([[-1, baseFor(-1)], [1, baseFor(1)]]);
  // Floodlight masts just behind the back wall; slide them toward the middle if another part of the
  // track passes close behind the stand.
  const masts = new Map<number, number>();
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const lat = side * (bases.get(side)! + tierDepth * tiers + 1.0);
      let pick = length / 2 - 1.5;
      for (const inset of [1.5, 5, 9, 14, 20]) {
        pick = end * (length / 2 - inset);
        if (footprintClearance(ctx, f, [[lat, pick]], 0, ctx.cl.length) >= 1.5) break;
      }
      masts.set(side * 2 + end, pick);
    }
  }
  const mastLat = (side: number): number => side * (bases.get(side)! + tierDepth * tiers + 1.0);

  const parts: Part[] = [];
  const crowdSlots: { x: number; y: number; z: number; heading: number }[] = [];
  const topY = tierRise * tiers;
  const roofY = topY + 4.6;
  const toWorld = (lat: number, along: number, y: number): [number, number, number] => [
    f.x + f.rx * lat - f.fx * along,
    f.y + y,
    f.z + f.rz * lat - f.fz * along,
  ];
  for (let side = -1; side <= 1; side += 2) {
    const base = bases.get(side)!;
    for (let k = 0; k < tiers; k++) {
      const lat = side * (base + tierDepth * (k + 0.5));
      const h = tierRise * (k + 1);
      const box = new THREE.BoxGeometry(tierDepth, h, length);
      box.translate(lat, h / 2, 0);
      parts.push({ geo: box, color: k % 2 === 0 ? concrete : concrete.clone().offsetHSL(0, 0, -0.06) });
      const seats = new THREE.BoxGeometry(0.5, 0.12, length);
      seats.translate(side * (base + tierDepth * k + 0.3), h + 0.06, 0);
      parts.push({ geo: seats, color: k % 2 === 0 ? seatA : seatB });
      const count = Math.floor(length / 0.95);
      for (let c = 0; c < count; c++) {
        if (rng() < 0.14) continue;
        const slotLat = side * (base + tierDepth * (k + 0.5)) + side * (rng() - 0.2) * 0.5;
        const along = -length / 2 + 0.5 + c * 0.95 + (rng() - 0.5) * 0.3;
        const [x, y, z] = toWorld(slotLat, along, h);
        crowdSlots.push({ x, y, z, heading: f.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.5 });
      }
    }
    // front wall behind the warning boards
    const wall = new THREE.BoxGeometry(0.3, 1.25, length + 0.6);
    wall.translate(side * (base - 0.15), 0.625, 0);
    parts.push({ geo: wall, color: accent });
    // back wall
    const backWall = new THREE.BoxGeometry(0.4, topY + 1.2, length + 0.6);
    backWall.translate(side * (base + tierDepth * tiers + 0.2), (topY + 1.2) / 2, 0);
    parts.push({ geo: backWall, color: concrete.clone().offsetHSL(0, 0, -0.1) });
    // roof on posts, sloping slightly toward the track
    const roof = new THREE.BoxGeometry(tierDepth * tiers + 2.5, 0.3, length + 2);
    roof.rotateZ(-side * 0.06);
    roof.translate(side * (base + (tierDepth * tiers) / 2 + 0.2), roofY, 0);
    parts.push({ geo: roof, color: accent.clone().offsetHSL(0, 0, -0.12) });
    // roof lip painted in warning stripes
    const segs = 22;
    const segLen = (length + 2) / segs;
    for (let k = 0; k < segs; k++) {
      const lip = new THREE.BoxGeometry(0.25, 0.9, segLen);
      lip.translate(side * (base - 0.9), roofY + 0.2, -(length + 2) / 2 + (k + 0.5) * segLen);
      parts.push({ geo: lip, color: k % 2 === 0 ? look.lipA : look.lipB });
    }
    for (let p = 0; p < 6; p++) {
      const post = new THREE.CylinderGeometry(0.18, 0.18, roofY + 0.6, 6);
      post.translate(side * (base + tierDepth * tiers + 0.6), (roofY + 0.6) / 2, -length / 2 + (p / 5) * length);
      parts.push({ geo: post, color: concrete.clone().offsetHSL(0, 0, -0.2) });
    }
    // floodlight masts near both ends of each stand
    for (const end of [-1, 1]) {
      const mastH = roofY + 9;
      const mast = new THREE.CylinderGeometry(0.22, 0.34, mastH, 6);
      const mx = mastLat(side);
      const mz = masts.get(side * 2 + end)!;
      mast.translate(mx, mastH / 2, mz);
      parts.push({ geo: mast, color: 0x6a6a72 });
      const head = new THREE.BoxGeometry(2.6, 1.2, 0.5);
      head.translate(mx - side * 0.6, mastH + 0.4, mz);
      parts.push({ geo: head, color: 0x2a2a30 });
    }
  }
  const geo = mergeParts(parts);
  const stands = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  stands.castShadow = true;
  stands.receiveShadow = true;
  stands.name = 'grandstandStructure';
  trackMesh(ctx, stands);
  _e.set(0, f.heading, 0);
  stands.quaternion.setFromEuler(_e);
  stands.position.set(f.x, f.y, f.z);
  group.add(stands);

  // Floodlight lamp clusters (emissive) - one instanced mesh.
  {
    const lampGeo = new THREE.BoxGeometry(2.3, 0.7, 0.2);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: isNight ? 2.2 : 1.1, roughness: 0.3 });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 4);
    let li = 0;
    for (let side = -1; side <= 1; side += 2) {
      const base = bases.get(side)!;
      for (const end of [-1, 1]) {
        const mastH = roofY + 9;
        const lx = mastLat(side) - side * 0.6;
        const lz = masts.get(side * 2 + end)!;
        _p.set(f.x + f.rx * lx - f.fx * lz, f.y + mastH + 0.4, f.z + f.rz * lx - f.fz * lz);
        _e.set(0.35 * side, f.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
        _q.setFromEuler(_e);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        lamps.setMatrixAt(li++, _m);
      }
    }
    lamps.instanceMatrix.needsUpdate = true;
    lamps.name = 'floodlights';
    trackMesh(ctx, lamps);
    group.add(lamps);
  }

  // Warning boards along the front walls: one merged mesh on the shared sign atlas.
  {
    const kit = signKit(ctx);
    const batch = new QuadBatch();
    for (let k = 0; k < 3; k++) {
      const row = kit.atlas.rows[k];
      for (let side = -1; side <= 1; side += 2) {
        const along = (k - 1) * 20;
        const lat = side * (bases.get(side)! - 0.32);
        const [x, y, z] = toWorld(lat, along, 0.66);
        batch.add(x, y, z, -side * f.rx, -side * f.rz, STAND_BOARD_W, STAND_BOARD_H, row.v0, row.v1);
      }
    }
    const boards = new THREE.Mesh(batch.build(), kit.material);
    boards.name = 'standBoards';
    ctx.disposables.push(boards.geometry);
    group.add(boards);
  }

  group.add(buildZombieCrowd(ctx, crowdSlots));
  return group;
}

// -----------------------------------------------------------------------------------------------
// Start gantry
// -----------------------------------------------------------------------------------------------

/** Big cartoon zombie hand reaching up (local origin at the wrist bottom, palm facing +Z). */
function zombieHandParts(x: number, y: number, z: number, scale: number, skin: number, sleeve: number, lean: number): Part[] {
  const out: Part[] = [];
  const place = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.scale(scale, scale, scale).rotateZ(lean).translate(x, y, z);
  out.push({ geo: place(new THREE.CylinderGeometry(0.4, 0.46, 0.8, 8).translate(0, 0.4, 0)), color: sleeve });
  out.push({ geo: place(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8).translate(0, 1.0, 0)), color: skin });
  out.push({ geo: place(new THREE.BoxGeometry(0.8, 0.7, 0.34).translate(0, 1.5, 0)), color: skin });
  const fingers: [number, number, number][] = [[-0.29, 0.5, -0.2], [-0.1, 0.62, -0.06], [0.1, 0.58, 0.06], [0.29, 0.46, 0.22]];
  for (const [fx, len, tilt] of fingers) {
    out.push({ geo: place(new THREE.BoxGeometry(0.17, len, 0.2).translate(0, len / 2, 0).rotateZ(-tilt).translate(fx, 1.8, 0)), color: skin });
  }
  out.push({ geo: place(new THREE.BoxGeometry(0.17, 0.42, 0.2).translate(0, 0.21, 0).rotateZ(1.0).translate(-0.4, 1.35, 0)), color: skin });
  // bandage wrap on the wrist
  out.push({ geo: place(new THREE.CylinderGeometry(0.33, 0.33, 0.14, 8, 1, true).translate(0, 1.05, 0)), color: 0xece6d2 });
  return out;
}

/** Start/finish gantry: twin lattice pillars outside the walls, truss crossbar, START/FINISH band, title board, zombie hands, lights. */
export function buildGantry(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gantry';
  const theme = ctx.def.theme;
  const isNight = theme === 'neon';
  const look = propLook(ctx);
  const f = frameAtS(ctx, 0);
  // Pillars stand behind the wall line (barrier props reach ~1 m past it) with the 1.6 m feet clear of it.
  let whw = f.whw;
  for (let s = -2; s <= 2; s += 0.5) whw = Math.max(whw, frameAtS(ctx, s).whw);
  const span = whw * 2 + 4.0;
  const height = 9.2;
  const metal = look.metal;
  const parts: Part[] = [];
  // lattice pillars (4 legs + cross braces)
  for (const sx of [-1, 1]) {
    for (const dx of [-0.42, 0.42]) {
      for (const dz of [-0.42, 0.42]) {
        const leg = new THREE.BoxGeometry(0.16, height, 0.16);
        leg.translate(sx * span / 2 + dx, height / 2, dz);
        parts.push({ geo: leg, color: metal });
      }
    }
    for (let k = 1; k < 6; k++) {
      const y = (k / 6) * height;
      const brace = new THREE.BoxGeometry(1.0, 0.16, 1.0);
      brace.translate(sx * span / 2, y, 0);
      parts.push({ geo: brace, color: k % 2 === 0 ? look.brace : metal });
    }
    const foot = new THREE.BoxGeometry(1.6, 0.4, 1.6);
    foot.translate(sx * span / 2, 0.2, 0);
    parts.push({ geo: foot, color: 0x3a3a40 });
    parts.push(...zombieHandParts(sx * (span / 2 + 0.2), height + 0.35, 0, 1.15, look.skin, look.sleeve, -sx * 0.18));
  }
  // crossbar (banner housing) + truss chords
  const bar = new THREE.BoxGeometry(span + 1.0, 2.2, 1.1).translate(0, height - 0.9, 0);
  parts.push({ geo: bar, color: isNight ? 0x14141f : 0x2b2b30 });
  for (const dz of [-0.62, 0.62]) {
    parts.push({ geo: new THREE.BoxGeometry(span + 1.0, 0.14, 0.14).translate(0, height + 0.3, dz), color: look.chord });
    parts.push({ geo: new THREE.BoxGeometry(span + 1.0, 0.14, 0.14).translate(0, height - 2.1, dz), color: isNight ? ctx.def.palette.roadStripe : look.chord });
  }
  const segs = Math.max(4, Math.round(span / 2.2));
  for (let k = 0; k <= segs; k++) {
    const x = -span / 2 - 0.5 + (k / segs) * (span + 1.0);
    parts.push({ geo: new THREE.BoxGeometry(0.1, 2.5, 0.1).translate(x, height - 0.9, 0.62), color: metal });
    parts.push({ geo: new THREE.BoxGeometry(0.1, 2.5, 0.1).translate(x, height - 0.9, -0.62), color: metal });
  }
  // start-light housing hanging under the bar (centre)
  const housing = new THREE.BoxGeometry(5.2, 0.9, 0.6).translate(0, height - 2.5, 0);
  parts.push({ geo: housing, color: 0x1a1a1e });
  const geo = mergeParts(parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  const structure = new THREE.Mesh(geo, mat);
  structure.castShadow = true;
  structure.receiveShadow = true;
  structure.name = 'gantryStructure';
  trackMesh(ctx, structure);
  group.add(structure);

  // START · FINISH band on both faces of the crossbar (one mesh, texture keeps the plane's aspect).
  const bandW = span - 0.6;
  const bandH = 1.9;
  const banner = makeStartBannerTexture(theme, ctx.def.palette.roadStripe, bandW / bandH);
  track(ctx, banner);
  const bannerMat = new THREE.MeshBasicMaterial({ map: banner, toneMapped: !isNight });
  {
    const batch = new QuadBatch();
    batch.add(0, height - 0.9, 0.57, 0, 1, bandW, bandH, 0, 1); // toward approaching karts
    batch.add(0, height - 0.9, -0.57, 0, -1, bandW, bandH, 0, 1);
    const bandMesh = new THREE.Mesh(batch.build(), bannerMat);
    bandMesh.name = 'startBanner';
    ctx.disposables.push(bandMesh.geometry, bannerMat);
    group.add(bandMesh);
  }

  // Title board on top of the gantry, cut out along its painted silhouette; readable from both sides.
  const title = makeBannerTexture(theme, ctx.def.palette.roadStripe);
  track(ctx, title);
  const titleMat = new THREE.MeshBasicMaterial({ map: title, toneMapped: !isNight, alphaTest: 0.5 });
  const titleW = Math.min(span * 0.62, (f.hw * 2 + 5.2) * 0.62);
  const titleH = titleW * 0.25;
  {
    const batch = new QuadBatch();
    const cy = height + 0.25 + titleH / 2;
    batch.add(0, cy, 0.03, 0, 1, titleW, titleH, 0, 1);
    batch.add(0, cy, -0.03, 0, -1, titleW, titleH, 0, 1);
    const titleMesh = new THREE.Mesh(batch.build(), titleMat);
    titleMesh.name = 'titleBoard';
    ctx.disposables.push(titleMesh.geometry, titleMat);
    group.add(titleMesh);
  }

  // Start lights: 5 lamps under the bar (red/amber/green mix) - purely decorative, slow cycle.
  const lampGeo = new THREE.SphereGeometry(0.26, 10, 8);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.3, vertexColors: false });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 5);
  for (let i = 0; i < 5; i++) {
    _p.set(-2.0 + i * 1.0, height - 2.5, 0.35);
    _e.set(0, 0, 0);
    _q.setFromEuler(_e);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    lamps.setMatrixAt(i, _m);
    lamps.setColorAt(i, _c.setHex(i < 2 ? 0xff3b30 : i < 4 ? 0xffb020 : 0x3dff6a));
  }
  lamps.instanceMatrix.needsUpdate = true;
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  lamps.name = 'startLights';
  trackMesh(ctx, lamps);
  group.add(lamps);
  ctx.updaters.push((_dt, elapsed) => {
    lampMat.emissiveIntensity = 1.1 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed * 2.4));
  });

  if (isNight) {
    // glowing tube along the bar
    const tube = new THREE.BoxGeometry(span + 1.2, 0.12, 0.12).translate(0, height + 0.5, 0);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(ctx.def.palette.curb), emissiveIntensity: 2.0 });
    const tm = new THREE.Mesh(tube, tubeMat);
    trackMesh(ctx, tm);
    group.add(tm);
  } else {
    // tattered pennants along the crossbar (clear of the title board)
    const rag = new THREE.ShapeGeometry(
      new THREE.Shape([
        new THREE.Vector2(0, 0), new THREE.Vector2(0.78, -0.04), new THREE.Vector2(0.6, -0.14), new THREE.Vector2(0.74, -0.24),
        new THREE.Vector2(0.52, -0.3), new THREE.Vector2(0.64, -0.42), new THREE.Vector2(0.3, -0.38), new THREE.Vector2(0, -0.46),
      ]),
    ).translate(0.04, 1.2, 0);
    const flagGeo = mergeParts([
      { geo: new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5).translate(0, 0.6, 0), color: 0x9a9aa0 },
      { geo: rag, color: 0xffffff },
    ]);
    const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    const slots: number[] = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + 0.6 + (i / (n - 1)) * (span - 1.2);
      if (Math.abs(x) < titleW / 2 + 0.3) continue;
      slots.push(x);
    }
    const flags = new THREE.InstancedMesh(flagGeo, flagMat, slots.length);
    slots.forEach((x, i) => {
      _p.set(x, height + 0.4, 0.62);
      _e.set(0, (i % 3) * 0.25 - 0.25, 0);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      flags.setMatrixAt(i, _m);
      flags.setColorAt(i, _c.setHex(look.flags[i % look.flags.length]));
    });
    flags.instanceMatrix.needsUpdate = true;
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
    trackMesh(ctx, flags);
    group.add(flags);
  }

  _e.set(0, f.heading, 0);
  group.quaternion.setFromEuler(_e);
  group.position.set(f.x, f.y, f.z);
  return group;
}

// -----------------------------------------------------------------------------------------------
// Banner bridges over the track
// -----------------------------------------------------------------------------------------------

/** Two banner bridges spanning the road further along the lap (warning banners on the shared sign atlas). */
export function buildSponsorBridges(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sponsorBridges';
  const look = propLook(ctx);
  const kit = signKit(ctx);
  const metal = look.metal;
  const parts: Part[] = [];
  const batch = new QuadBatch();
  bridgeSpots(ctx).forEach((s, k) => {
    const f = frameAtS(ctx, s);
    const span = f.whw * 2 + 3.0;
    const h = 7.4;
    const local: Part[] = [];
    for (const sx of [-1, 1]) {
      local.push({ geo: new THREE.BoxGeometry(0.55, h, 0.55).translate(sx * span / 2, h / 2, 0), color: metal });
      local.push({ geo: new THREE.BoxGeometry(1.4, 0.35, 1.4).translate(sx * span / 2, 0.17, 0), color: 0x3a3a40 });
      // warning bands on the posts
      for (let b = 0; b < 3; b++) local.push({ geo: new THREE.BoxGeometry(0.6, 0.35, 0.6).translate(sx * span / 2, 1.2 + b * 0.7, 0), color: look.brace });
    }
    local.push({ geo: new THREE.BoxGeometry(span + 0.55, 0.35, 0.9).translate(0, h - 0.17, 0), color: metal });
    local.push({ geo: new THREE.BoxGeometry(span + 0.55, 0.35, 0.9).translate(0, h - 2.35, 0), color: metal });
    for (let i = 0; i <= 8; i++) {
      const x = -span / 2 + (i / 8) * span;
      local.push({ geo: new THREE.BoxGeometry(0.1, 2.0, 0.1).translate(x, h - 1.26, 0.35), color: metal });
      local.push({ geo: new THREE.BoxGeometry(0.1, 2.0, 0.1).translate(x, h - 1.26, -0.35), color: metal });
    }
    // transform this bridge into world space
    _e.set(0, f.heading, 0);
    _q.setFromEuler(_e);
    _p.set(f.x, f.y, f.z);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    for (const part of local) {
      part.geo.applyMatrix4(_m);
      parts.push(part);
    }
    // banner faces: +face toward approaching karts (-forward), -face toward the far side
    const row = kit.atlas.rows[3 + k];
    for (const face of [1, -1]) {
      const nx = -f.fx * face;
      const nz = -f.fz * face;
      batch.add(f.x + nx * 0.42, f.y + h - 1.26, f.z + nz * 0.42, nx, nz, span - 1.2, BRIDGE_BANNER_H, row.v0, row.v1);
    }
  });
  const geo = mergeParts(parts);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'sponsorBridgeStructure';
  trackMesh(ctx, mesh);
  group.add(mesh);
  const banners = new THREE.Mesh(batch.build(), kit.material);
  banners.name = 'sponsorBridgeBanner';
  ctx.disposables.push(banners.geometry);
  group.add(banners);
  return group;
}

// -----------------------------------------------------------------------------------------------
// Boost pads
// -----------------------------------------------------------------------------------------------

export interface BoostPadInfo {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  halfWidth: number;
}

/** Append a road-following ribbon (subdivided along s) to the given buffers. */
function pushRibbon(
  ctx: BuildContext,
  verts: number[],
  uvs: number[],
  idx: number[],
  norms: number[],
  s0: number,
  s1: number,
  halfWidthAt: (f: RoadFrame) => number,
  lift: number,
  vRepeat: number,
  segments: number,
): void {
  const base = verts.length / 3;
  for (let k = 0; k <= segments; k++) {
    const f = frameAtS(ctx, lerp(s0, s1, k / segments));
    const w = halfWidthAt(f);
    verts.push(f.x - f.rx * w, f.y + lift, f.z - f.rz * w, f.x + f.rx * w, f.y + lift, f.z + f.rz * w);
    const v = (k / segments) * vRepeat;
    uvs.push(0, v, 1, v);
    norms.push(0, 1, 0, 0, 1, 0);
  }
  for (let k = 0; k < segments; k++) {
    const a = base + k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

function ribbonGeometry(verts: number[], uvs: number[], idx: number[], norms: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Arcade boost pads: a dark rounded strip (BOOST_PAD_LENGTH long, inside the road edge
 * lines) carrying three scrolling orange-to-yellow chevrons, plus a faint orange trail on the road
 * ahead of each pad. Three merged meshes for all pads.
 */
export function buildBoostPads(ctx: BuildContext, pads: BoostPadInfo[]): THREE.Group | null {
  const { cl, def } = ctx;
  if (def.boostPads.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'boostPads';
  const halfLen = BOOST_PAD_LENGTH / 2;
  const chevronInset = 0.28;
  const chevronCount = 3;
  const trailLen = 7.0;

  const bV: number[] = [];
  const bU: number[] = [];
  const bI: number[] = [];
  const bN: number[] = [];
  const cV: number[] = [];
  const cU: number[] = [];
  const cI: number[] = [];
  const cN: number[] = [];
  const tV: number[] = [];
  const tU: number[] = [];
  const tI: number[] = [];
  const tN: number[] = [];

  for (const t of def.boostPads) {
    const s = t * cl.length;
    const fc = frameAtS(ctx, s);
    const w = Math.max(3, fc.hw - BOOST_PAD_INSET);
    pushRibbon(ctx, bV, bU, bI, bN, s - halfLen, s + halfLen, () => w, 0.03, 1, 4);
    pushRibbon(ctx, cV, cU, cI, cN, s - halfLen + chevronInset, s + halfLen - chevronInset, () => w - chevronInset, 0.045, chevronCount, 4);
    pushRibbon(ctx, tV, tU, tI, tN, s + halfLen, s + halfLen + trailLen, () => w * 0.9, 0.02, 1, 6);
    pads.push({
      position: new THREE.Vector3(fc.x, fc.y, fc.z),
      forward: new THREE.Vector3(fc.fx, 0, fc.fz).normalize(),
      halfWidth: w,
    });
  }

  // base strip
  const baseTex = makeBoostBaseTexture();
  track(ctx, baseTex);
  const baseMat = new THREE.MeshStandardMaterial({
    map: baseTex,
    transparent: true,
    roughness: 0.55,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const baseMesh = new THREE.Mesh(ribbonGeometry(bV, bU, bI, bN), baseMat);
  baseMesh.name = 'boostPadBase';
  baseMesh.receiveShadow = true;
  baseMesh.renderOrder = 2;
  trackMesh(ctx, baseMesh);
  group.add(baseMesh);

  // trail on the road ahead of the pad
  const trailTex = makeBoostTrailTexture();
  track(ctx, trailTex);
  const trailMat = new THREE.MeshBasicMaterial({
    map: trailTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const trailMesh = new THREE.Mesh(ribbonGeometry(tV, tU, tI, tN), trailMat);
  trailMesh.name = 'boostPadTrail';
  trailMesh.renderOrder = 1;
  trackMesh(ctx, trailMesh);
  group.add(trailMesh);

  // scrolling chevrons
  const chevTex = makeBoostChevronTile();
  track(ctx, chevTex);
  const chevMat = new THREE.MeshStandardMaterial({
    map: chevTex,
    transparent: true,
    depthWrite: false,
    emissive: 0xffffff,
    emissiveMap: chevTex,
    emissiveIntensity: 1.2,
    roughness: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const chevMesh = new THREE.Mesh(ribbonGeometry(cV, cU, cI, cN), chevMat);
  chevMesh.name = 'boostPadChevrons';
  chevMesh.renderOrder = 3;
  trackMesh(ctx, chevMesh);
  group.add(chevMesh);

  ctx.updaters.push((dt, elapsed) => {
    // chevrons travel forward at ~2 chevrons per second
    chevTex.offset.y -= dt * 2.0;
    if (chevTex.offset.y < -1000) chevTex.offset.y += 1000;
    chevMat.emissiveIntensity = 1.2 + Math.sin(elapsed * 5) * 0.12;
  });
  return group;
}

/** Item box positions: ITEM_BOX_ROW_SIZE boxes across 80% of the road width, ~1 m above the road. */
export function computeItemBoxPositions(ctx: BuildContext, rowSize: number): THREE.Vector3[] {
  const { cl, def } = ctx;
  const out: THREE.Vector3[] = [];
  for (const t of def.itemBoxRows) {
    const f = frameAtS(ctx, t * cl.length);
    const span = f.hw * 0.8;
    for (let k = 0; k < rowSize; k++) {
      const lat = rowSize === 1 ? 0 : lerp(-span, span, k / (rowSize - 1));
      out.push(new THREE.Vector3(f.x + f.rx * lat, f.y + 1.0, f.z + f.rz * lat));
    }
  }
  return out;
}
