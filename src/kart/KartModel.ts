/**
 * Procedural zombie sprint kart model. Cartoony-but-polished, faces local -Z,
 * wheels rest on y = 0. Everything is generated from primitives (no assets).
 * Static parts
 * that share a material are merged into single meshes to keep draw calls low
 * (~20 per kart).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterDef } from '../core/types';
import { lerp, smoothstep } from '../core/math';
import { CHARACTERS } from './roster';

export interface KartModelParts {
  root: THREE.Group;
  body: THREE.Mesh;
  /** The four spinning wheel groups (rotate about local X). Order: FL, FR, RL, RR. */
  wheels: THREE.Object3D[];
  /** Steering pivots for the two front wheels (rotate about local Y). */
  frontWheels: THREE.Object3D[];
  /** Rotate about local Z to turn the steering wheel. */
  steeringWheel: THREE.Object3D;
  driver: THREE.Group;
  driverHead: THREE.Object3D;
  /** Exhaust pipe groups at the rear (local +Z is the pipe direction). */
  exhausts: THREE.Object3D[];
  bodyMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
}

/** Extra handles the Kart uses for animation; a structural subtype of KartModelParts. */
export interface KartModelPartsEx extends KartModelParts {
  /** Emissive material on the exhaust tips (flickers while boosting). */
  exhaustGlowMaterial: THREE.MeshStandardMaterial;
  /** Wheel radii matching `wheels` order (for spin speed). */
  wheelRadii: number[];
  /** Disposes every geometry, material and texture owned by this model. */
  dispose(): void;
  /** Cloth pieces (scarf, headband tails) that flutter with speed. Rest pose is rotation 0. */
  flaps?: THREE.Object3D[];
  /** Crackling bits that flicker on and off. */
  sparks?: THREE.Object3D[];
}

// --- dimensions -------------------------------------------------------------
const WHEEL_R_F = 0.2;
const WHEEL_R_R = 0.22;
const WHEEL_W_F = 0.18;
const WHEEL_W_R = 0.22;
const WHEEL_X = 0.52;
const WHEEL_Z_F = -0.52;
const WHEEL_Z_R = 0.5;
const BODY_WIDTH = 0.64;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** Collects transformed geometry copies and merges them into one indexed geometry. */
class Batch {
  private parts: THREE.BufferGeometry[] = [];

  add(
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ): this {
    let g = geo.clone();
    if (!g.index) {
      const indexed = mergeVertices(g);
      g.dispose();
      g = indexed;
    }
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return merged;
  }
}

function makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = false;
  m.name = name;
  return m;
}

/** Cylinder oriented from a to b (used for arms, legs, column). */
function limbGeometry(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  radial = 8,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, len), 2, radial);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  return g;
}

function addVertexColor(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Width taper of the chassis along z (kart space): narrow nose, slightly narrower tail. */
function chassisWidthScale(z: number): number {
  const nose = smoothstep(-0.92, -0.18, z);
  const tail = smoothstep(0.25, 0.86, z);
  return lerp(0.5, 1, nose) * lerp(1, 0.8, tail);
}

function buildChassisGeometry(): THREE.BufferGeometry {
  // Side profile: u = forward (+ = nose), v = up.
  const s = new THREE.Shape();
  s.moveTo(-0.76, 0.17);
  s.lineTo(0.74, 0.17);
  s.quadraticCurveTo(0.86, 0.17, 0.86, 0.27);
  s.quadraticCurveTo(0.86, 0.36, 0.72, 0.39);
  s.lineTo(0.36, 0.46);
  s.quadraticCurveTo(0.18, 0.5, 0.12, 0.44);
  s.lineTo(0.06, 0.31);
  s.lineTo(-0.4, 0.31);
  s.lineTo(-0.48, 0.42);
  s.lineTo(-0.7, 0.42);
  s.quadraticCurveTo(-0.8, 0.42, -0.8, 0.32);

  const extruded = new THREE.ExtrudeGeometry(s, {
    depth: BODY_WIDTH,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 5,
  });
  // shape u -> -z (forward), extrusion z -> x (width)
  extruded.rotateY(Math.PI / 2);
  extruded.translate(-BODY_WIDTH / 2, 0, 0);

  // Smooth shading: merge by position only, then recompute normals.
  extruded.deleteAttribute('normal');
  extruded.deleteAttribute('uv');
  const geo = mergeVertices(extruded, 1e-3);
  extruded.dispose();

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setX(i, pos.getX(i) * chassisWidthScale(z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return geo;
}

function makeNumberTexture(num: number, accent: number, color: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const accentCss = '#' + accent.toString(16).padStart(6, '0');
    const dark = new THREE.Color(color).multiplyScalar(0.28);
    const r = 22;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#f8f9fc';
    ctx.beginPath();
    ctx.roundRect(4, 4, size - 8, size - 8, r);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = accentCss;
    ctx.stroke();
    ctx.fillStyle = '#' + dark.getHexString();
    ctx.font = 'bold 88px system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), size / 2, size / 2 + 6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

interface WheelGeos {
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
}

function buildWheelGeometry(radius: number, width: number): WheelGeos {
  const tube = width * 0.5;
  const tyreBatch = new Batch();
  const torus = addVertexColor(new THREE.TorusGeometry(radius - tube, tube, 8, 16), 0x15151a);
  tyreBatch.add(torus, 0, 0, 0, 0, Math.PI / 2, 0);
  torus.dispose();
  const tread = addVertexColor(
    new THREE.CylinderGeometry(radius * 1.005, radius * 1.005, width * 0.42, 22, 1, true),
    0x2c2c33,
  );
  tyreBatch.add(tread, 0, 0, 0, 0, 0, Math.PI / 2);
  tread.dispose();

  const rimBatch = new Batch();
  const rimR = radius * 0.58;
  const rimW = width * 0.72;
  const rim = new THREE.CylinderGeometry(rimR, rimR, rimW, 14);
  rimBatch.add(rim, 0, 0, 0, 0, 0, Math.PI / 2);
  rim.dispose();
  const spoke = new THREE.BoxGeometry(rimW + 0.03, radius * 0.5, 0.035);
  spoke.translate(0, radius * 0.3, 0);
  for (let i = 0; i < 5; i++) {
    rimBatch.add(spoke, 0, 0, 0, (i / 5) * Math.PI * 2, 0, 0);
  }
  spoke.dispose();
  const hub = new THREE.SphereGeometry(radius * 0.22, 10, 7);
  rimBatch.add(hub, 0, 0, 0, 0, 0, 0, 1.6, 1, 1);
  hub.dispose();

  return { tyre: tyreBatch.build(), rim: rimBatch.build() };
}

// --- zombie driver -----------------------------------------------------------
// Every driver is a handful of merged, vertex-coloured meshes: one matte mesh for
// the body, one for the head, one for the hands on the wheel, plus optional shiny
// (metal) and glow meshes for the signature props.

type Paint = number | ((x: number, y: number, z: number) => number);
type Vec3 = readonly [number, number, number];
type TrackGeo = <T extends THREE.BufferGeometry>(g: T) => T;
type TrackMat = <T extends THREE.Material>(m: T) => T;

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n0 = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);

function mixHex(a: number, b: number, t: number): number {
  return _c0.setHex(a).lerp(_c1.setHex(b), t).getHex();
}

function paintGeometry(geo: THREE.BufferGeometry, paint: Paint): void {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  if (typeof paint === 'number') _c0.setHex(paint);
  for (let i = 0; i < pos.count; i++) {
    if (typeof paint !== 'number') _c0.setHex(paint(pos.getX(i), pos.getY(i), pos.getZ(i)));
    arr[i * 3] = _c0.r;
    arr[i * 3 + 1] = _c0.g;
    arr[i * 3 + 2] = _c0.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Like Batch, but bakes a vertex colour per part so many colours share one material. */
class PaintBatch {
  private parts: THREE.BufferGeometry[] = [];
  /** Applied after each part's own transform (e.g. a head tilt). */
  readonly post = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, paint: Paint, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    return this.addMatrix(geo, paint, _m);
  }

  addMatrix(geo: THREE.BufferGeometry, paint: Paint, matrix: THREE.Matrix4): this {
    let g = geo.clone();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.index) {
      const indexed = mergeVertices(g);
      g.dispose();
      g = indexed;
    }
    paintGeometry(g, paint);
    g.applyMatrix4(matrix);
    g.applyMatrix4(this.post);
    this.parts.push(g);
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return merged;
  }
}

/** Orthonormal frame with +Y along `dir`; the local X axis follows `hint` as closely as possible. */
function frameAlongY(dir: THREE.Vector3, hint: THREE.Vector3 = WORLD_X): void {
  _by.copy(dir).normalize();
  _bz.crossVectors(hint, _by);
  if (_bz.lengthSq() < 1e-6) _bz.crossVectors(WORLD_Y, _by);
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
  _bz.normalize();
  _bx.crossVectors(_by, _bz).normalize();
}

/** Orthonormal frame with +Z along `normal`; local +Y stays as close to world up as possible. */
function frameAlongZ(normal: THREE.Vector3): void {
  _bz.copy(normal).normalize();
  if (Math.abs(_bz.y) > 0.97) _bx.crossVectors(new THREE.Vector3(0, 0, -1), _bz);
  else _bx.crossVectors(WORLD_Y, _bz);
  _bx.normalize();
  _by.crossVectors(_bz, _bx).normalize();
}

/** Matrix from the current basis (_bx/_by/_bz), an extra local rotation, scale and position. */
function basisMatrix(out: THREE.Matrix4, pos: THREE.Vector3, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  out.makeBasis(_bx, _by, _bz);
  if (rx !== 0 || ry !== 0 || rz !== 0) out.multiply(_m2.makeRotationFromEuler(_e.set(rx, ry, rz)));
  out.scale(_s.set(sx, sy, sz));
  out.setPosition(pos);
  return out;
}

class Ellipsoid {
  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
    readonly rx: number,
    readonly ry: number,
    readonly rz: number,
  ) {}

  /** yaw 0 = straight ahead (-Z), +PI/2 = +X side, PI = back; pitch goes up and may pass over the top. */
  at(yaw: number, pitch: number, lift: number, pos: THREE.Vector3, normal: THREE.Vector3): void {
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const t = 1 / Math.sqrt((dx / this.rx) ** 2 + (dy / this.ry) ** 2 + (dz / this.rz) ** 2);
    normal.set((dx * t) / (this.rx * this.rx), (dy * t) / (this.ry * this.ry), (dz * t) / (this.rz * this.rz)).normalize();
    pos.set(this.cx + dx * t, this.cy + dy * t, this.cz + dz * t).addScaledVector(normal, lift);
  }

  /** Matrix whose local +Z follows the surface normal; spin turns the part around that normal. */
  decal(out: THREE.Matrix4, yaw: number, pitch: number, lift: number, spin: number, sx: number, sy: number, sz: number, rx = 0, ry = 0): THREE.Matrix4 {
    this.at(yaw, pitch, lift, _v0, _n0);
    frameAlongZ(_n0);
    return basisMatrix(out, _v0, rx, ry, spin, sx, sy, sz);
  }
}

interface ZombieLook {
  skin: number;
  /** Tired rings under the eyes, inner ears, nails. */
  shade: number;
  shirt: number;
  pants: number;
  hair: number;
  patch: number;
  sleeves: 'none' | 'short' | 'long';
  head: Vec3;
  build: number;
  bigEye: 1 | -1;
}

const ZOMBIE_LOOKS: Record<string, ZombieLook> = {
  zippy: { skin: 0x9fd47c, shade: 0x6f7486, shirt: 0x283a7c, pants: 0x283a7c, hair: 0x1e2c4a, patch: 0xff3fb4, sleeves: 'none', head: [0.162, 0.17, 0.157], build: 1, bigEye: 1 },
  pixel: { skin: 0xa9dcae, shade: 0x8f78a6, shirt: 0x2e2447, pants: 0x1d1830, hair: 0x4dffc3, patch: 0xff4fa3, sleeves: 'long', head: [0.158, 0.168, 0.155], build: 1, bigEye: -1 },
  fennec: { skin: 0x92bf6f, shade: 0x6d6376, shirt: 0xe8902a, pants: 0x5a4a3a, hair: 0x5e3b22, patch: 0x7a3b1c, sleeves: 'short', head: [0.158, 0.164, 0.155], build: 1, bigEye: 1 },
  max: { skin: 0xa6c67f, shade: 0x70697c, shirt: 0x7a4a2a, pants: 0x4a3a2c, hair: 0x6c4326, patch: 0xffd23f, sleeves: 'long', head: [0.16, 0.168, 0.156], build: 1.08, bigEye: 1 },
  juno: { skin: 0x9ccaa0, shade: 0x6c6a8c, shirt: 0x444859, pants: 0x3a3d4c, hair: 0x1d1a29, patch: 0xffb020, sleeves: 'long', head: [0.158, 0.18, 0.152], build: 1.08, bigEye: -1 },
  kai: { skin: 0x76b9a2, shade: 0x5a6b82, shirt: 0xd1a93a, pants: 0x587340, hair: 0x3f6e2d, patch: 0xff7a1a, sleeves: 'short', head: [0.165, 0.163, 0.16], build: 1.08, bigEye: 1 },
  bram: { skin: 0x82a56b, shade: 0x5e5a70, shirt: 0xd88a3c, pants: 0x3c3a36, hair: 0x34402c, patch: 0x5aa0d8, sleeves: 'none', head: [0.148, 0.152, 0.146], build: 1.36, bigEye: 1 },
  rosa: { skin: 0xb5c99f, shade: 0x86709a, shirt: 0x5b2c83, pants: 0x3a1d56, hair: 0x6d53a3, patch: 0x19d3c5, sleeves: 'long', head: [0.16, 0.168, 0.157], build: 1.2, bigEye: 1 },
};

const EYE_WHITE = 0xebe7cf;
const PUPIL = 0x1c1824;
const TOOTH = 0xf3eec8;
const MOUTH = 0x3b2433;
const STITCH = 0x28301f;
const BANDAGE = 0xcdc7b8;
const PLASTER = 0xe9c29a;

interface ZombieDriver {
  driver: THREE.Group;
  driverHead: THREE.Group;
  flaps?: THREE.Object3D[];
  sparks?: THREE.Object3D[];
}

/** Turns a surface inside out (reversed winding and normals). */
function flipFaces(geo: THREE.BufferGeometry): void {
  const index = geo.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, a);
    }
  }
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

function lumpyHeadGeometry(seed: number, flatTop: number): THREE.BufferGeometry {
  const src = new THREE.SphereGeometry(1, 22, 16);
  src.deleteAttribute('normal');
  src.deleteAttribute('uv');
  const g = mergeVertices(src, 1e-4);
  src.dispose();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const n = Math.sin(x * 3.7 + seed) * Math.sin(y * 4.3 + seed * 2.1) * Math.sin(z * 3.1 + seed * 0.7);
    const r = 1 + 0.045 * n;
    x *= r;
    y *= r;
    z *= r;
    if (y < 0) {
      // Soft jowls.
      x *= 1 + 0.08 * -y;
      z *= 1 + 0.03 * -y;
    }
    if (flatTop > 0 && y > 0.45) y = 0.45 + (y - 0.45) * (1 - flatTop);
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function buildZombieDriver(character: CharacterDef, steerPivot: THREE.Object3D, track: TrackGeo, mat: TrackMat): ZombieDriver {
  const id = character.id in ZOMBIE_LOOKS ? character.id : 'zippy';
  const L = ZOMBIE_LOOKS[id];
  const B = L.build;
  const [hrx, hry, hrz] = L.head;

  // Unit primitives; every part is a scaled copy.
  const SPH = new THREE.SphereGeometry(1, 12, 9);
  const SPH_LO = new THREE.SphereGeometry(1, 7, 5);
  const HEMI = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const CONE = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0);
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
  const NUT = new THREE.CylinderGeometry(1, 1, 1, 6);
  const RING = new THREE.TorusGeometry(1, 0.12, 5, 20);
  const ARC = new THREE.TorusGeometry(1, 0.22, 4, 10, Math.PI);
  const unit = [SPH, SPH_LO, HEMI, CONE, BOX, CYL, NUT, RING, ARC];

  const body = new PaintBatch();
  const bodyGlow = new PaintBatch();
  const hands = new PaintBatch();
  const head = new PaintBatch();
  const headShiny = new PaintBatch();
  const headGlow = new PaintBatch();
  const M = new THREE.Matrix4();
  // The Howler throws its head back mid-howl.
  if (id === 'fennec') {
    head.post.makeRotationX(0.24).premultiply(_m1.makeTranslation(0, 0, -0.035));
    headShiny.post.copy(head.post);
    headGlow.post.copy(head.post);
  }

  // --- placement helpers -------------------------------------------------------
  const along = (b: PaintBatch, geo: THREE.BufferGeometry, paint: Paint, base: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, flatX = 1, flatZ = 1, hint: THREE.Vector3 = WORLD_X): void => {
    frameAlongY(dir, hint);
    b.addMatrix(geo, paint, basisMatrix(M, base, 0, 0, 0, rad * flatX, len, rad * flatZ));
  };
  const spike = (b: PaintBatch, paint: Paint, base: Vec3, dir: Vec3, len: number, rad: number, flatX = 1, flatZ = 1): void => {
    along(b, CONE, paint, _v1.set(base[0], base[1], base[2]), _v2.set(dir[0], dir[1], dir[2]), len, rad, flatX, flatZ);
  };
  /** Box stretched between two points, lying on a surface with the given normal. */
  const strip = (b: PaintBatch, paint: Paint, a: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3, width: number, thick: number, geo: THREE.BufferGeometry = BOX): void => {
    _bx.subVectors(c, a);
    const len = _bx.length();
    _bx.normalize();
    _bz.copy(normal).addScaledVector(_bx, -normal.dot(_bx)).normalize();
    _by.crossVectors(_bz, _bx).normalize();
    b.addMatrix(geo, paint, basisMatrix(M, _v3.addVectors(a, c).multiplyScalar(0.5), 0, 0, 0, len, width, thick));
  };
  /** Tank-top strap running over the top of the shoulder, front to back. */
  const shoulderStrap = (b: PaintBatch, paint: Paint, x: number, top: number, width: number): void => {
    const f = new THREE.Vector3(x, top - 0.085, chestZ + 0.012);
    const t = new THREE.Vector3(x, top + 0.004, 0.02);
    const k = new THREE.Vector3(x, top - 0.075, 0.02 + 0.15 * torsoSZ - 0.004);
    strip(b, paint, f, t, _n0.set(0, 0.55, -0.85).normalize(), width, 0.016);
    strip(b, paint, t, k, _n0.set(0, 0.55, 0.85).normalize(), width, 0.016);
  };
  const limb = (b: PaintBatch, paint: Paint, a: Vec3, c: Vec3, r: number, radial = 8): void => {
    const g = limbGeometry(a[0], a[1], a[2], c[0], c[1], c[2], r, radial);
    b.add(g, paint);
    g.dispose();
  };
  const lerp3 = (a: Vec3, c: Vec3, t: number): Vec3 => [lerp(a[0], c[0], t), lerp(a[1], c[1], t), lerp(a[2], c[2], t)];
  /** Ring (or ragged cuff / stitch ring) around a limb segment at parameter t. */
  const limbRing = (b: PaintBatch, paint: Paint, a: Vec3, c: Vec3, t: number, radius: number, tube: number): void => {
    _v1.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    frameAlongY(_v1);
    // Torus lies in XY; turn it so its axis follows the limb.
    const p = lerp3(a, c, t);
    b.addMatrix(RING, paint, basisMatrix(M, _v2.set(p[0], p[1], p[2]), Math.PI / 2, 0, 0, radius, radius, tube / 0.12));
  };
  const raggedCuff = (b: PaintBatch, paint: Paint, a: Vec3, c: Vec3, t: number, radius: number, count = 7): void => {
    const p = lerp3(a, c, t);
    const d = _v3.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize().clone();
    frameAlongY(d);
    const u = _bx.clone();
    const w = _bz.clone();
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const out = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
      const base = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(out, radius * 0.92);
      const dir = d.clone().addScaledVector(out, 0.35);
      along(b, CONE, paint, base, dir, i % 2 === 0 ? 0.045 : 0.028, 0.02);
    }
  };
  const stitchRing = (b: PaintBatch, a: Vec3, c: Vec3, t: number, radius: number): void => {
    limbRing(b, STITCH, a, c, t, radius, 0.004);
    const p = lerp3(a, c, t);
    const d = _v3.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize().clone();
    frameAlongY(d);
    const u = _bx.clone();
    const w = _bz.clone();
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2;
      const out = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
      const base = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(out, radius);
      _bz.copy(out);
      _by.copy(d);
      _bx.crossVectors(_by, _bz).normalize();
      b.addMatrix(BOX, STITCH, basisMatrix(M, base, 0, 0, 0, 0.005, 0.03, 0.006));
    }
  };

  // --- body ----------------------------------------------------------------------
  const wide = 1 + (B - 1) * 0.75;
  const armR = B > 1.2 ? 1.3 : 1;
  const shoulderY = 0.33 + (B - 1) * 0.04;
  const torsoSZ = 0.75 * (1 + (B - 1) * 0.45);
  const chestZ = 0.02 - 0.15 * torsoSZ;
  const torso = new THREE.CapsuleGeometry(0.15, 0.1, 3, 12);
  body.add(torso, L.shirt, 0, 0.2, 0.02, 0, 0, 0, 1.1 * wide, 1 + (B - 1) * 0.2, torsoSZ);
  torso.dispose();

  const sleeveUpper = L.sleeves === 'none' ? L.skin : L.shirt;
  const sleeveLower = L.sleeves === 'long' ? L.shirt : L.skin;
  const arms: { sh: Vec3; el: Vec3; wr: Vec3 }[] = [];
  for (const sx of [-1, 1]) {
    const sh: Vec3 = [sx * 0.2 * wide, shoulderY, 0.02];
    const el: Vec3 = [sx * 0.215 * wide, 0.2, -0.12];
    const wr: Vec3 = [sx * 0.138, 0.205, -0.238];
    arms.push({ sh, el, wr });
    body.add(SPH, sleeveUpper, sh[0], sh[1], sh[2], 0, 0, 0, 0.078 * armR, 0.078 * armR, 0.078 * armR);
    limb(body, sleeveUpper, sh, el, 0.05 * armR);
    limb(body, sleeveLower, el, wr, 0.041 * armR);
    if (L.sleeves === 'short') raggedCuff(body, L.shirt, sh, el, 0.9, 0.05 * armR);
    if (L.sleeves === 'long') raggedCuff(body, L.shirt, el, wr, 0.82, 0.041 * armR, 6);
    limb(body, L.pants, [sx * 0.1, 0.02, -0.02], [sx * 0.13, -0.03, -0.34], 0.06);
  }
  const neckR = 0.046 * (B > 1.2 ? 1.35 : 1);
  limb(body, L.skin, [0, 0.3, 0.02], [0, 0.45, -0.01], neckR);

  // Ripped hole in the shirt front.
  const hole = new THREE.CircleGeometry(1, 9);
  {
    const pos = hole.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const k = i % 2 === 0 ? 1 : 0.55;
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
    }
  }
  if (id !== 'zippy' && id !== 'kai') body.add(hole, L.skin, 0.07 * wide, 0.25, chestZ - 0.003, 0.25, Math.PI, 0.4, 0.04, 0.035, 1);

  // Patch with stitches on the upper back of one shoulder (reads from the chase camera).
  {
    const a = arms[id === 'rosa' ? 0 : 1];
    const sx = Math.sign(a.sh[0]);
    const n = new THREE.Vector3(sx * 0.35, 0.8, 0.45).normalize();
    const c = new THREE.Vector3(a.sh[0], a.sh[1], a.sh[2]).addScaledVector(n, 0.074 * armR);
    frameAlongZ(n);
    const bx = _bx.clone();
    const by = _by.clone();
    body.addMatrix(BOX, L.patch, basisMatrix(M, c, 0, 0, 0.3, 0.06, 0.055, 0.012));
    for (let i = 0; i < 4; i++) {
      const ang = 0.3 + (i * Math.PI) / 2;
      const off = bx.clone().multiplyScalar(Math.cos(ang) * 0.03).addScaledVector(by, Math.sin(ang) * 0.028);
      frameAlongZ(n);
      body.addMatrix(BOX, STITCH, basisMatrix(M, c.clone().add(off).addScaledVector(n, 0.007), 0, 0, ang, 0.004, 0.022, 0.005));
    }
  }

  // --- hands on the wheel (steering pivot space, rim radius 0.13) ------------
  for (const sx of [-1, 1]) {
    hands.add(SPH, L.skin, sx * 0.142, 0.002, 0.03, 0, 0, sx * 0.15, 0.036, 0.047, 0.03);
    for (let k = 0; k < 4; k++) {
      const y = -0.03 + k * 0.02;
      limb(hands, L.skin, [sx * 0.162, y, 0.014], [sx * 0.118, y * 0.9, -0.026], 0.0105, 6);
      hands.add(SPH_LO, L.shade, sx * 0.114, y * 0.9, -0.036, 0, 0, 0, 0.0075, 0.0075, 0.005);
    }
    limb(hands, L.skin, [sx * 0.13, 0.03, 0.04], [sx * 0.104, 0.04, 0.008], 0.011, 6);
  }
  if (id === 'bram' || id === 'zippy') {
    // Plaster on a knuckle.
    hands.add(BOX, PLASTER, 0.14, 0.012, -0.03, 0, 0.3, 0, 0.03, 0.014, 0.006);
  }

  // --- head ------------------------------------------------------------------------
  const E = new Ellipsoid(0, 0.14, 0, hrx, hry, hrz);
  const headGeo = lumpyHeadGeometry(character.name.length * 0.7, id === 'juno' ? 0.75 : 0);
  head.add(headGeo, (x, y) => (y < -0.55 ? mixHex(L.skin, L.shade, 0.18) : L.skin), 0, 0.14, 0, 0, 0, 0, hrx, hry, hrz);
  headGeo.dispose();

  const onHead = (b: PaintBatch, geo: THREE.BufferGeometry, paint: Paint, yaw: number, pitch: number, lift: number, spin: number, sx: number, sy: number, sz: number, rx = 0, ry = 0): void => {
    b.addMatrix(geo, paint, E.decal(M, yaw, pitch, lift, spin, sx, sy, sz, rx, ry));
  };
  const headSpike = (b: PaintBatch, paint: Paint, yaw: number, pitch: number, lift: number, len: number, rad: number, bend: Vec3, flatX = 1, flatZ = 1, ell: Ellipsoid = E, hint: THREE.Vector3 = WORLD_X): void => {
    ell.at(yaw, pitch, lift, _v1, _n0);
    _v2.copy(_n0).add(_v3.set(bend[0], bend[1], bend[2]));
    along(b, CONE, paint, _v1.clone(), _v2.clone(), len, rad, flatX, flatZ, hint);
  };
  const stitchLine = (b: PaintBatch, yaw0: number, pitch0: number, yaw1: number, pitch1: number, n: number, lift = 0.003, ell: Ellipsoid = E, color = STITCH): void => {
    const a = new THREE.Vector3();
    const c = new THREE.Vector3();
    const na = new THREE.Vector3();
    const nc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      ell.at(lerp(yaw0, yaw1, i / n), lerp(pitch0, pitch1, i / n), lift, a, na);
      ell.at(lerp(yaw0, yaw1, (i + 1) / n), lerp(pitch0, pitch1, (i + 1) / n), lift, c, nc);
      na.add(nc).normalize();
      strip(b, color, a, c, na, 0.006, 0.006);
      // Cross tick.
      _bx.subVectors(c, a).normalize();
      _bz.copy(na);
      _by.crossVectors(_bz, _bx).normalize();
      b.addMatrix(BOX, color, basisMatrix(M, _v3.addVectors(a, c).multiplyScalar(0.5), 0, 0, 0, 0.006, 0.034, 0.007));
    }
  };
  const bandAid = (b: PaintBatch, yaw: number, pitch: number, size = 1): void => {
    onHead(b, BOX, PLASTER, yaw, pitch, 0.002, 0.785, 0.06 * size, 0.02 * size, 0.008);
    onHead(b, BOX, PLASTER, yaw, pitch, 0.004, -0.785, 0.06 * size, 0.02 * size, 0.008);
  };

  type EyeStyle = 'goofy' | 'sleepy' | 'closed' | 'wide' | 'none';
  const eye = (side: 1 | -1, big: boolean, style: EyeStyle): void => {
    if (style === 'none') return;
    const r = big ? 0.044 : 0.035;
    const yaw = side * 0.37;
    const pitch = 0.1 + (big ? 0.02 : 0);
    // Tired bag under the eye only (a full dark ring read as a bruise).
    onHead(head, SPH, mixHex(L.skin, L.shade, 0.5), yaw, pitch - (r * 0.95) / hry, -0.006, 0, r * 0.95, r * 0.42, 0.014);
    if (style === 'closed') {
      onHead(head, ARC, PUPIL, yaw, pitch, 0.006, 0, r * 0.6, r * 0.6, 0.03);
      return;
    }
    // Eyeball sunk into the head so it reads as an eye, not a ball stuck on the face.
    const sink = r * 0.45;
    onHead(head, SPH, EYE_WHITE, yaw, pitch, -sink, 0, r, r, r * 0.8);
    // Both pupils look ahead and slightly cross toward the nose; the small eye is a touch lower.
    const gazeYaw = -side * (style === 'wide' ? 0.015 : 0.035);
    const gazePitch = big ? 0.0 : -0.02;
    const pr = style === 'wide' ? r * 0.34 : r * 0.46;
    // Front of the flattened eyeball sits at r * 0.8 - sink above the skin.
    const front = r * 0.8 - sink;
    onHead(head, SPH, PUPIL, yaw + gazeYaw, pitch + gazePitch, front - pr * 0.25, 0, pr, pr, pr * 0.35);
    onHead(head, SPH_LO, EYE_WHITE, yaw + gazeYaw - pr * 0.35 / hrx, pitch + gazePitch + pr * 0.4 / hry, front + pr * 0.08, 0, pr * 0.28, pr * 0.28, pr * 0.12);
    if (style === 'sleepy') {
      // Heavy upper lid covering the top third.
      onHead(head, SPH, mixHex(L.skin, L.shade, 0.15), yaw, pitch + (r * 0.62) / hry, -sink + r * 0.12, 0, r * 1.08, r * 0.55, r * 0.8);
    }
  };
  const face = (eyes: EyeStyle, mouth: 'grin' | 'open' | 'none', browColor = L.hair): void => {
    eye(L.bigEye, true, eyes);
    eye(-L.bigEye as 1 | -1, false, eyes);
    onHead(head, SPH, mixHex(L.skin, L.shade, 0.22), 0, -0.14, -0.006, 0, 0.02, 0.018, 0.026);
    if (browColor >= 0) {
      onHead(head, BOX, browColor, L.bigEye * 0.37, 0.37, 0.004, L.bigEye * -0.2, 0.055, 0.014, 0.014);
      onHead(head, BOX, browColor, -L.bigEye * 0.37, 0.3, 0.004, L.bigEye * -0.28, 0.05, 0.014, 0.014);
    }
    if (mouth === 'grin') {
      onHead(head, SPH, MOUTH, 0.04, -0.42, -0.005, 0.14, 0.062, 0.022, 0.016);
      // Teeth stay inside the dark mouth shape; near its rim the mouth is paper-thin and a tooth there sticks out.
      onHead(head, BOX, TOOTH, -0.012, -0.395, 0.0105, 0.12, 0.016, 0.016, 0.005);
      onHead(head, BOX, TOOTH, 0.075, -0.41, 0.0105, -0.15, 0.013, 0.012, 0.005);
    } else if (mouth === 'open') {
      onHead(head, SPH, MOUTH, 0.03, -0.43, -0.005, 0.1, 0.045, 0.034, 0.016);
      onHead(head, BOX, TOOTH, 0.0, -0.37, 0.0105, -0.1, 0.016, 0.016, 0.005);
    }
    for (const side of [-1, 1]) {
      onHead(head, SPH, L.skin, side * 1.52, 0.02, -0.008, 0, 0.03, 0.046, 0.02);
      onHead(head, SPH, L.shade, side * 1.52, 0.02, 0.004, 0, 0.017, 0.028, 0.01);
    }
  };

  const hairPaint = (base: number, tip: number) => (_x: number, y: number) => (y > 0.55 ? tip : base);
  const flaps: THREE.Object3D[] = [];
  const sparks: THREE.Object3D[] = [];
  const driverHead = new THREE.Group();
  driverHead.name = 'driverHead';
  driverHead.position.set(0, 0.39, -0.01);
  const driver = new THREE.Group();
  driver.name = 'driver';
  driver.position.set(0, 0.41, 0.18);

  const flapMesh = (parent: THREE.Object3D, b: PaintBatch, x: number, y: number, z: number, name: string): void => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = makeMesh(track(b.build()), matte, name);
    pivot.add(mesh);
    parent.add(pivot);
    flaps.push(pivot);
  };

  const matte = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 }));
  let shinyMat: THREE.MeshStandardMaterial | null = null;
  let glowMat: THREE.MeshBasicMaterial | null = null;
  const glowMaterial = (): THREE.MeshBasicMaterial => {
    if (!glowMat) glowMat = mat(new THREE.MeshBasicMaterial({ vertexColors: true }));
    return glowMat;
  };
  const shinyMaterial = (): THREE.MeshStandardMaterial => {
    if (!shinyMat) {
      shinyMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.7, emissive: 0x3a3a3a, emissiveIntensity: 1 }));
    }
    return shinyMat;
  };


  // --- signature looks ---------------------------------------------------------------
  switch (id) {
    case 'zippy': {
      // Grave Sprinter: sweatband with fluttering tails, swept-back spikes, race bib, wristbands.
      face('goofy', 'grin');
      stitchLine(head, 2.75, 0.2, 3.5, -0.05, 4);
      bandAid(head, -0.62, -0.28, 0.8);
      head.add(HEMI, L.hair, 0, 0.14 + 0.055, 0.008, -0.08, 0, 0, hrx * 1.03, hry * 0.78, hrz * 1.04);
      const spikes: [number, number, number][] = [
        [0, 1.25, 0.11], [0.55, 1.05, 0.1], [-0.55, 1.05, 0.1], [1.05, 0.85, 0.08], [-1.05, 0.85, 0.08],
        [1.7, 0.9, 0.09], [-1.7, 0.9, 0.09], [2.3, 0.85, 0.11], [-2.3, 0.85, 0.11], [3.14, 0.9, 0.12], [0, 0.95, 0.07],
      ];
      for (const [yaw, pitch, len] of spikes) headSpike(head, hairPaint(L.hair, 0x3b5a8a), yaw, pitch, -0.02, len * 1.1, 0.042, [0, 0.15, 1.0]);
      const bandY = 0.075;
      const k = Math.sqrt(1 - (bandY / hry) ** 2);
      head.add(RING, (_x, _y, z) => (Math.abs(z) < 0.05 ? 0xffffff : 0xff3fb4), 0, 0.14 + bandY, 0.004, Math.PI / 2 - 0.14, 0, 0, hrx * k + 0.014, hrz * k + 0.014, 0.2);
      head.add(SPH, 0xff3fb4, 0, 0.14 + bandY - 0.018, hrz * k + 0.03, 0, 0, 0, 0.03, 0.026, 0.024);
      const tails = new PaintBatch();
      for (const side of [-1, 1]) {
        tails.add(BOX, 0xff3fb4, side * 0.028, -0.02, 0.065, 0.3, side * 0.38, side * 0.35, 0.05, 0.012, 0.14);
        tails.add(BOX, 0xff3fb4, side * 0.075, -0.052, 0.18, 0.38, side * 0.45, -side * 0.2, 0.046, 0.012, 0.13);
        tails.add(BOX, 0xffffff, side * 0.075, -0.052, 0.18, 0.38, side * 0.45, -side * 0.2, 0.048, 0.008, 0.028);
        spike(tails, 0xff3fb4, [side * 0.1, -0.075, 0.235], [side * 0.45, -0.35, 1], 0.05, 0.03, 1, 0.3);
      }
      flapMesh(driverHead, tails, 0, 0.14 + bandY - 0.018, hrz * k + 0.04, 'headbandTails');
      // Bib with a big "1" and safety pins.
      body.add(BOX, 0xfbf8ee, 0, 0.22, chestZ - 0.004, 0.08, 0, 0, 0.12, 0.1, 0.01);
      body.add(BOX, 0x22304a, 0.0, 0.215, chestZ - 0.011, 0.08, 0, 0, 0.016, 0.066, 0.006);
      body.add(BOX, 0x22304a, 0.012, 0.24, chestZ - 0.011, 0.08, 0, -0.75, 0.024, 0.012, 0.006);
      body.add(BOX, 0x22304a, 0, 0.186, chestZ - 0.009, 0.08, 0, 0, 0.04, 0.01, 0.006);
      for (const [px, py] of [[-0.05, 0.262], [0.05, 0.262], [-0.05, 0.178], [0.05, 0.178]]) {
        body.add(SPH_LO, 0xc9ced6, px, py, chestZ - 0.011, 0, 0, 0, 0.007, 0.007, 0.004);
      }
      for (const a of arms) {
        limbRing(body, 0xff3fb4, a.el, a.wr, 0.7, 0.047, 0.018);
        limbRing(body, 0xffffff, a.el, a.wr, 0.7, 0.049, 0.006);
        stitchRing(body, a.sh, a.el, 0.3, 0.052);
      }
      // Singlet: bare shoulders, so paint a strap over each.
      for (const a of arms) {
        const sx = Math.sign(a.sh[0]);
        shoulderStrap(body, L.shirt, sx * 0.1, 0.37, 0.045);
      }
      break;
    }
    case 'pixel': {
      // Neon Ghoul: glowing mohawk, neon sleeve stripes, hoodie with a glowing drawstring.
      face('goofy', 'grin', 0x2a2440);
      stitchLine(head, 1.0, 0.55, 2.3, 0.3, 5);
      stitchLine(head, -1.2, 0.45, -2.1, 0.15, 3);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const pitch = lerp(0.62, 2.8, t);
        const len = 0.075 + 0.07 * Math.sin(Math.PI * Math.min(1, t * 1.15));
        headSpike(headGlow, (_x, y) => (y > 0.62 ? 0xff5fd2 : 0x4dffc3), 0, pitch, -0.014, len + 0.012, 0.045, [0, 0, 0.25 * t], 0.5);
      }
      headSpike(head, 0x2c2440, 0, 1.7, -0.02, 0.02, 0.03, [0, 0, 0], 1.2);
      onHead(headGlow, RING, 0xff5fd2, 1.5, -0.32, 0.004, 0, 0.016, 0.016, 0.06);
      // Hood bunched behind the neck.
      body.add(SPH, mixHex(L.shirt, 0xffffff, 0.08), 0, 0.37, 0.1, 0.35, 0, 0, 0.14 * wide, 0.06, 0.075);
      body.add(RING, L.shirt, 0, 0.4, 0.08, Math.PI / 2 + 0.5, 0, 0, 0.095, 0.06, 0.25);
      bodyGlow.add(RING, 0x4dffc3, 0, 0.405, 0.08, Math.PI / 2 + 0.5, 0, 0, 0.11, 0.075, 0.12);
      for (const a of arms) {
        const sx = Math.sign(a.sh[0]);
        for (const [p0, p1, r, col] of [[a.sh, a.el, 0.05, 0x4dffc3], [a.el, a.wr, 0.041, 0xff5fd2]] as [Vec3, Vec3, number, number][]) {
          const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
          const out = new THREE.Vector3(sx, 0.25, 0).addScaledVector(d.clone().normalize(), -new THREE.Vector3(sx, 0.25, 0).dot(d.clone().normalize())).normalize();
          const a0 = new THREE.Vector3(p0[0], p0[1], p0[2]).addScaledVector(out, r * 1.02);
          const a1 = new THREE.Vector3(p1[0], p1[1], p1[2]).addScaledVector(out, r * 1.02);
          strip(bodyGlow, col, a0, a1, out, 0.016, 0.01);
        }
        limbRing(bodyGlow, 0x4dffc3, a.el, a.wr, 0.86, 0.043, 0.008);
      }
      for (const sx of [-1, 1]) {
        bodyGlow.add(BOX, 0x4dffc3, sx * 0.035, 0.26, chestZ - 0.004, 0.1, 0, sx * 0.08, 0.008, 0.09, 0.008);
        bodyGlow.add(SPH_LO, 0xff5fd2, sx * 0.039, 0.21, chestZ - 0.01, 0, 0, 0, 0.012, 0.012, 0.012);
      }
      bodyGlow.add(BOX, 0x4dffc3, -0.01, 0.2, chestZ - 0.002, 0.08, 0, 0, 0.006, 0.17, 0.006);
      break;
    }
    case 'fennec': {
      // Howler: shaggy mane, wolf ears, head thrown back mid-howl.
      face('closed', 'none', -1);
      onHead(head, SPH, MOUTH, 0, -0.42, -0.004, 0, 0.04, 0.056, 0.026);
      onHead(head, SPH, 0xff7fa0, 0, -0.5, 0.004, 0, 0.024, 0.016, 0.014);
      for (const side of [-1, 1]) onHead(head, CONE, TOOTH, side * 0.09, -0.3, 0.006, Math.PI, 0.009, 0.024, 0.009);
      onHead(head, SPH, 0x2d2227, 0, -0.12, 0.0, 0, 0.03, 0.021, 0.022);
      onHead(head, BOX, L.hair, 0.37, 0.3, 0.006, -0.35, 0.05, 0.014, 0.014);
      onHead(head, BOX, L.hair, -0.37, 0.3, 0.006, 0.35, 0.05, 0.014, 0.014);
      stitchLine(head, -0.62, -0.1, -0.55, -0.5, 3);
      head.add(SPH, L.hair, 0, 0.15, 0.035, 0, 0, 0, hrx * 1.08, hry * 1.05, hrz * 1.02);
      const mane = hairPaint(L.hair, 0x9a6a3e);
      // Shaggy locks hang down and back like shingles; a spiky crest stands on top.
      const rows: [number, number, number][] = [[1.0, 0.13, 0.32], [0.45, 0.15, 0.3], [-0.1, 0.14, 0.3], [-0.42, 0.13, 0.36]];
      rows.forEach(([pitch, len, step], ri) => {
        for (let yaw = 0.95 + (ri % 2) * step * 0.5; yaw <= Math.PI + 0.01; yaw += step) {
          for (const side of [-1, 1]) {
            if (yaw > Math.PI - 0.05 && side < 0) continue;
            const jitter = Math.sin(yaw * 9.3 + ri * 2.1 + side) * 0.025;
            const tangent = new THREE.Vector3(Math.cos(side * yaw), 0, Math.sin(side * yaw));
            const nape = pitch < 0.2 && yaw > 1.5 ? 0.62 : 1;
            headSpike(head, mane, side * yaw, pitch, -0.02, (len + jitter) * nape, 0.06, [side * 0.05 * Math.sin(yaw), -1.15, 0.3], 1, 0.42, E, tangent);
          }
        }
      });
      for (const [yaw, pitch, len] of [[0, 1.35, 0.13], [Math.PI, 1.2, 0.12], [0.9, 1.3, 0.1], [-0.9, 1.3, 0.1], [2.2, 1.25, 0.11], [-2.2, 1.25, 0.11]] as [number, number, number][]) {
        headSpike(head, mane, yaw, pitch, -0.02, len, 0.05, [0, 0.2, 0.45]);
      }
      for (const yaw of [-0.4, 0, 0.4]) headSpike(head, mane, yaw, 0.95, -0.02, 0.075, 0.04, [0, -0.1, -0.35]);
      for (const side of [-1, 1]) {
        headSpike(head, L.hair, side * 0.62, 1.05, -0.02, 0.13, 0.055, [side * 0.35, 0.3, 0], 1, 0.45);
        headSpike(head, 0xf29aa8, side * 0.6, 1.02, 0.004, 0.085, 0.03, [side * 0.35, 0.3, -0.25], 1, 0.3);
      }
      // Claw rips on the shoulders and rolled sleeves.
      for (const a of arms) {
        const sx = Math.sign(a.sh[0]);
        for (let i = 0; i < 3; i++) {
          body.add(BOX, L.skin, a.sh[0] + sx * 0.01, a.sh[1] + 0.06, a.sh[2] - 0.03 + i * 0.03, 0, 0.5 * sx, 0.3 * sx, 0.012, 0.012, 0.055);
        }
        limbRing(body, 0xb86a1a, a.sh, a.el, 0.78, 0.053, 0.014);
      }
      body.add(BOX, 0x9a5a1a, 0, 0.2, chestZ - 0.003, 0.08, 0, 0, 0.012, 0.18, 0.01);
      break;
    }
    case 'max': {
      // Rotter Ace: leather flying cap with goggles, droopy moustache, fur collar, long scarf.
      face('goofy', 'grin', 0x3a2a1f);
      bandAid(head, -0.3, -0.6, 0.8);
      const cap = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.6);
      head.add(cap, L.hair, 0, 0.14, 0.006, 0.66, 0, 0, hrx * 1.07, hry * 1.07, hrz * 1.08);
      cap.dispose();
      const C = new Ellipsoid(0, 0.14, 0.006, hrx * 1.07, hry * 1.07, hrz * 1.08);
      stitchLine(head, 0, 0.9, 0, 2.6, 7, 0.002, C, 0xc99a66);
      for (const side of [-1, 1]) {
        onHead(head, SPH, L.hair, side * 1.47, -0.3, 0.012, 0, 0.055, 0.078, 0.022);
        onHead(head, BOX, 0x3a2a1e, side * 1.32, -0.78, 0.014, side * 0.1, 0.016, 0.07, 0.007);
        onHead(headShiny, BOX, 0xd9a441, side * 1.36, -0.62, 0.02, 0, 0.024, 0.016, 0.008);
      }
      const strap = new THREE.TorusGeometry(1, 0.09, 4, 28);
      head.add(strap, 0x3a2a1e, 0, 0.14 + 0.03, 0.012, Math.PI / 2 + 0.5, 0, 0, hrx * 1.1, hrz * 1.1, 0.24);
      strap.dispose();
      for (const side of [-1, 1]) {
        C.decal(M, side * 0.3, 0.62, 0.016, 0, 0.036, 0.036, 0.05);
        headShiny.addMatrix(RING, 0xd5dbe2, M);
        C.decal(M, side * 0.3, 0.62, 0.012, 0, 0.03, 0.03, 0.012);
        headShiny.addMatrix(SPH, 0x7fd6ff, M);
      }
      C.decal(M, 0, 0.64, 0.012, 0, 0.04, 0.012, 0.012);
      headShiny.addMatrix(BOX, 0xd5dbe2, M);
      for (const side of [-1, 1]) {
        onHead(head, SPH, 0x3a2a1f, side * 0.075, -0.25, 0.006, side * -0.35, 0.046, 0.014, 0.018);
        onHead(head, SPH, 0x3a2a1f, side * 0.19, -0.2, 0.0, 0, 0.013, 0.013, 0.013);
      }
      // Fur collar and a striped scarf.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        body.add(SPH, i % 2 ? 0xefe2c4 : 0xdfcca4, Math.cos(a) * 0.1 * wide, 0.355 + Math.max(0, Math.sin(a)) * 0.02, 0.015 + Math.sin(a) * 0.085, 0, a, 0, 0.042, 0.032, 0.036);
      }
      const scarfPaint = (x: number, y: number) => (Math.sin(Math.atan2(y, x) * 5) > 0.45 ? 0xd83a2e : 0xf7f3e8);
      body.add(RING, scarfPaint, 0, 0.405, -0.01, Math.PI / 2, 0, 0, 0.066, 0.062, 0.26);
      const scarf = new PaintBatch();
      const chain = [[0, 0, 0], [0.07, 0.012, 0.07], [0.16, 0.034, 0.125], [0.26, 0.05, 0.165], [0.355, 0.074, 0.195]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
      for (let i = 0; i < chain.length - 1; i++) {
        _n0.set(Math.sin(i * 1.7) * 0.6, 1, 0).normalize();
        strip(scarf, i === 2 ? 0xd83a2e : 0xf7f3e8, chain[i], chain[i + 1], _n0, 0.078 - i * 0.004, 0.014);
      }
      const tip = chain[chain.length - 1];
      for (let k = -2; k <= 2; k++) {
        along(scarf, BOX, 0xd83a2e, tip.clone().add(_v1.set(k * -0.006, 0, k * 0.012)).addScaledVector(_v2.set(0.95, 0.2, 0.3), 0.025), _v2.set(0.95, 0.1, 0.3), 0.05, 0.006, 1, 1);
      }
      flapMesh(driver, scarf, 0.05, 0.41, 0.06, 'scarfTail');
      break;
    }
    case 'juno': {
      // Voltage Zombie: flat top, hair standing on end with a white streak, neck bolts that spark.
      face('wide', 'grin');
      stitchLine(head, -0.62, 0.5, 0.62, 0.47, 7);
      stitchLine(head, 2.6, 0.1, 3.6, 0.0, 4);
      const topY = 0.14 + hry * 0.52;
      head.add(SPH, L.hair, 0, topY - 0.012, 0.008, 0, 0, 0, hrx * 0.92, 0.035, hrz * 0.9);
      for (const x of [-0.11, -0.055, 0, 0.055, 0.11]) {
        for (const z of [-0.075, 0, 0.075]) {
          const streak = x === 0.055;
          const len = 0.12 + 0.07 * Math.abs(Math.sin(x * 61 + z * 37)) + (z === 0 ? 0.03 : 0);
          spike(head, streak ? 0xefeaf8 : hairPaint(L.hair, 0x3a3150), [x, topY - 0.02, z], [x * 1.6, 1, z * 1.3 + 0.08], len, 0.034);
        }
      }
      for (const side of [-1, 1]) {
        headSpike(head, L.hair, side * 1.35, 0.55, -0.02, 0.075, 0.03, [side * 0.1, 0.5, 0]);
        headSpike(head, L.hair, side * 1.8, 0.45, -0.02, 0.07, 0.03, [side * 0.1, 0.4, 0.2]);
      }
      const sparkBatch = new PaintBatch();
      for (const side of [-1, 1]) {
        headShiny.add(CYL, 0xb9c2cc, side * 0.12, 0.03, 0.02, 0, 0, Math.PI / 2, 0.018, 0.11, 0.018);
        headShiny.add(NUT, 0x8d96a3, side * 0.172, 0.03, 0.02, 0, 0, Math.PI / 2, 0.034, 0.026, 0.034);
        const zig: [number, number, number][] = [[0.03, 0.03, 0.9], [0.055, 0.045, -0.7], [0.075, 0.075, 0.9]];
        for (const [dx, dy, rz] of zig) sparkBatch.add(BOX, dy > 0.05 ? 0xfff27a : 0xffb020, side * (0.175 + dx), dy + 0.03, 0.02, 0, 0, side * rz, 0.038, 0.012, 0.012);
        sparkBatch.add(BOX, 0x9ff4ff, side * 0.215, 0.0, 0.03, 0, 0, side * -0.5, 0.034, 0.01, 0.01);
        sparkBatch.add(BOX, 0x9ff4ff, side * 0.245, -0.015, 0.03, 0, 0, side * 0.6, 0.028, 0.01, 0.01);
      }
      const sparkMesh = new THREE.Mesh(track(sparkBatch.build()), glowMaterial());
      sparkMesh.name = 'boltSparks';
      driverHead.add(sparkMesh);
      sparks.push(sparkMesh);
      // Lightning emblem on the chest and on one shoulder.
      const bolt = (b: PaintBatch, x: number, y: number, z: number, s: number, rx: number): void => {
        b.add(BOX, 0xffc93a, x + 0.01 * s, y + 0.03 * s, z, rx, 0, 0.5, 0.014 * s, 0.05 * s, 0.008);
        b.add(BOX, 0xffc93a, x, y, z, rx, 0, -0.9, 0.012 * s, 0.035 * s, 0.008);
        b.add(BOX, 0xffc93a, x - 0.01 * s, y - 0.03 * s, z, rx, 0, 0.5, 0.014 * s, 0.05 * s, 0.008);
      };
      bolt(bodyGlow, 0.0, 0.23, chestZ - 0.006, 1.1, 0.08);
      body.add(BOX, 0x2a2c36, 0, 0.235, chestZ - 0.002, 0.08, 0, 0, 0.06, 0.1, 0.006);
      body.add(RING, 0x2a2c36, 0, 0.395, -0.005, Math.PI / 2, 0, 0, 0.06, 0.056, 0.3);
      break;
    }
    case 'kai': {
      // Swamp Walker: lily pad with a frog and a lotus, dripping weeds, overalls.
      face('sleepy', 'open', 0x2e4f22);
      stitchLine(head, 2.4, 0.3, 3.3, -0.1, 4);
      bandAid(head, 0.62, -0.3, 0.8);
      const weed = (i: number) => (i % 2 ? 0x3f6e2d : 0x5b8a36);
      // Wet weed mop: a cap plus ribbon strands draping over the back and sides.
      head.add(HEMI, (_x, y) => (y > 0.7 ? 0x4f7f33 : 0x3a6329), 0, 0.14 + 0.05, 0.012, 0.35, 0, 0, hrx * 1.05, hry * 0.88, hrz * 1.07);
      const W = new Ellipsoid(0, 0.14, 0.01, hrx * 1.03, hry * 1.02, hrz * 1.05);
      let si = 0;
      for (let yaw = 1.0; yaw <= Math.PI + 0.01; yaw += 0.26) {
        for (const side of [-1, 1]) {
          if (yaw > Math.PI - 0.05 && side < 0) continue;
          const pts: THREE.Vector3[] = [];
          const nrm: THREE.Vector3[] = [];
          const top = 0.55 - 0.25 * Math.sin((yaw - 1) * 0.7);
          const bottom = -0.7 - 0.25 * Math.abs(Math.sin(yaw * 3.1 + side));
          for (let i = 0; i <= 3; i++) {
            const v = new THREE.Vector3();
            const n = new THREE.Vector3();
            W.at(side * (yaw + Math.sin(i * 1.9 + yaw) * 0.07), lerp(top, bottom, i / 3), 0.004, v, n);
            pts.push(v);
            nrm.push(n);
          }
          for (let i = 0; i < 3; i++) strip(head, weed(si + i), pts[i], pts[i + 1], nrm[i], 0.03, 0.01);
          along(head, CONE, weed(si + 1), pts[3].clone(), _v2.set(0, -1, 0.25), 0.07, 0.016, 1, 0.4);
          si++;
        }
      }
      for (const [yaw, pitch0, pitch1] of [[0.22, 0.9, 0.52], [-0.3, 0.88, 0.6], [0.62, 0.8, 0.3], [-0.68, 0.8, 0.25]] as [number, number, number][]) {
        W.at(yaw, pitch0, 0.004, _v1, _n0);
        const p0 = _v1.clone();
        W.at(yaw * 1.1, pitch1, 0.004, _v2, _n0);
        strip(head, weed(si++), p0, _v2.clone(), _n0.clone(), 0.03, 0.01);
      }
      for (const [yaw, pitch, len] of [[0.12, 0.72, 0.045], [-0.45, 0.62, 0.03], [2.9, 0.4, 0.05]] as [number, number, number][]) {
        E.at(yaw, pitch, 0.004, _v1, _n0);
        const a: Vec3 = [_v1.x, _v1.y, _v1.z];
        const c: Vec3 = [_v1.x, _v1.y - len, _v1.z + (yaw > 1 ? 0.012 : -0.012)];
        limb(head, 0xa6e05a, a, c, 0.009, 6);
        head.add(SPH_LO, 0xa6e05a, c[0], c[1] - 0.006, c[2], 0, 0, 0, 0.014, 0.017, 0.014);
      }
      // Lily pad (with a notch), veins, lotus and a tiny frog.
      const padM = new THREE.Matrix4().compose(_v1.set(0.01, 0.19 + hry * 0.88 + 0.004, 0.02), _q.setFromEuler(_e.set(-0.2, 0.5, 0.14)), _s.set(1, 1, 1));
      const local = (b: PaintBatch, geo: THREE.BufferGeometry, paint: Paint, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): void => {
        _m1.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
        b.addMatrix(geo, paint, _m1.premultiply(padM));
      };
      const pad = new THREE.CylinderGeometry(1, 1, 1, 22, 1, false, 0.35, Math.PI * 2 - 0.7);
      local(head, pad, (_x, y) => (y > 0 ? 0x62c247 : 0x3d8a31), 0, 0, 0, 0, 0, 0, 0.175, 0.018, 0.175);
      pad.dispose();
      for (let i = 0; i < 6; i++) {
        const a = 0.9 + (i / 6) * (Math.PI * 2 - 1.2);
        local(head, BOX, 0x93e06a, Math.sin(a) * 0.078, 0.01, Math.cos(a) * 0.078, 0, a, 0, 0.006, 0.004, 0.14);
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        _v2.set(Math.cos(a) * 0.7, 1, Math.sin(a) * 0.7);
        frameAlongY(_v2);
        _v3.set(0.05 + Math.cos(a) * 0.016, 0.03, 0.045 + Math.sin(a) * 0.016);
        basisMatrix(_m1, _v3, 0, 0, 0, 0.017, 0.034, 0.01).premultiply(padM);
        head.addMatrix(SPH, (_x, y) => (y > 0.3 ? 0xffd2ea : 0xff7fc4), _m1);
      }
      local(head, SPH, 0xffd84a, 0.05, 0.03, 0.045, 0, 0, 0, 0.013, 0.012, 0.013);
      const frogY = 0.03;
      const fx = -0.055;
      const fz = -0.03;
      local(head, SPH, 0x86d84c, fx, frogY, fz, 0, 0, 0, 0.034, 0.026, 0.038);
      local(head, SPH, 0xd9f59a, fx, frogY - 0.006, fz - 0.016, 0.4, 0, 0, 0.024, 0.016, 0.02);
      for (const s of [-1, 1]) {
        local(head, SPH, 0x86d84c, fx + s * 0.017, frogY + 0.022, fz - 0.02, 0, 0, 0, 0.014, 0.014, 0.014);
        local(head, SPH_LO, EYE_WHITE, fx + s * 0.018, frogY + 0.026, fz - 0.031, 0, 0, 0, 0.009, 0.009, 0.006);
        local(head, SPH_LO, PUPIL, fx + s * 0.018, frogY + 0.027, fz - 0.037, 0, 0, 0, 0.005, 0.005, 0.003);
        local(head, SPH, 0x6cc23a, fx + s * 0.03, frogY - 0.018, fz - 0.018, 0, 0, 0, 0.012, 0.008, 0.016);
        local(head, SPH, 0x6cc23a, fx + s * 0.033, frogY - 0.016, fz + 0.022, 0, 0, 0, 0.016, 0.012, 0.022);
      }
      local(head, BOX, 0x2f5a1c, fx, frogY + 0.004, fz - 0.037, 0, 0, 0, 0.028, 0.003, 0.003);
      // Overalls: bib, pocket, buttons and straps over the shoulders.
      body.add(BOX, L.pants, 0, 0.16, chestZ - 0.002, 0.1, 0, 0, 0.18 * wide, 0.13, 0.016);
      body.add(BOX, mixHex(L.pants, 0x000000, 0.2), 0, 0.15, chestZ - 0.011, 0.1, 0, 0, 0.07, 0.045, 0.004);
      for (const sx of [-1, 1]) {
        body.add(SPH_LO, 0xffd23f, sx * 0.065 * wide, 0.215, chestZ - 0.013, 0, 0, 0, 0.011, 0.011, 0.006);
        const f0 = new THREE.Vector3(sx * 0.065 * wide, 0.22, chestZ - 0.006);
        const f1 = new THREE.Vector3(sx * 0.1 * wide, 0.375, -0.03);
        const f2 = new THREE.Vector3(sx * 0.1 * wide, 0.385, 0.075);
        const f3 = new THREE.Vector3(sx * 0.075 * wide, 0.29, 0.135);
        strip(body, 0xff7a1a, f0, f1, _n0.set(0, 0.3, -1).normalize(), 0.032, 0.012);
        strip(body, 0xff7a1a, f1, f2, _n0.set(0, 1, 0), 0.032, 0.012);
        strip(body, 0xff7a1a, f2, f3, _n0.set(0, 0.3, 1).normalize(), 0.032, 0.012);
      }
      for (const a of arms) limbRing(body, 0x9acd4a, a.el, a.wr, 0.45, 0.043, 0.006);
      break;
    }
    case 'bram': {
      // Bone Crusher: small bandaged head on a huge frame, underbite tusks, plaster cast.
      // The eye goes on the side the bandage leaves open.
      eye(-L.bigEye as 1 | -1, true, 'goofy');
      onHead(head, SPH, mixHex(L.skin, L.shade, 0.22), 0, -0.1, -0.004, 0, 0.026, 0.022, 0.03);
      onHead(head, BOX, L.hair, 0.15, 0.36, -0.002, -0.22, 0.1, 0.024, 0.012);
      onHead(head, BOX, L.hair, -0.15, 0.36, -0.002, 0.22, 0.1, 0.024, 0.012);
      for (const side of [-1, 1]) {
        onHead(head, SPH, L.skin, side * 1.52, 0.05, -0.008, 0, 0.034, 0.042, 0.022);
        onHead(head, SPH, L.shade, side * 1.52, 0.05, 0.004, 0, 0.018, 0.024, 0.01);
      }
      // Heavy jaw with an underbite.
      head.add(SPH, L.skin, 0, 0.065, -0.07, -0.15, 0, 0, 0.125, 0.07, 0.095);
      head.add(BOX, MOUTH, 0, 0.088, -0.163, 0.25, 0, 0.04, 0.1, 0.014, 0.02);
      for (const sx of [-1, 1]) spike(head, TOOTH, [sx * 0.046, 0.082, -0.168], [sx * 0.12, 1, -0.12], 0.028, 0.011);
      head.add(HEMI, L.hair, 0, 0.14 + 0.035, 0.008, -0.05, 0, 0, hrx * 1.03, hry * 0.8, hrz * 1.04);
      // Bandage wraps: one across an eye, one around the crown, loose ends at the back.
      const wrap = new THREE.TorusGeometry(1, 0.13, 5, 26);
      head.add(wrap, (x) => (Math.sin(x * 40) > 0.6 ? 0xb9b3a4 : BANDAGE), 0, 0.14, 0.0, Math.PI / 2 + 0.35, -0.35, 0.5, hrx * 1.02, hrz * 1.02, 0.24);
      head.add(wrap, (x) => (Math.sin(x * 40) > 0.6 ? 0xb9b3a4 : BANDAGE), 0, 0.14 + 0.085, 0.004, Math.PI / 2 - 0.2, 0, -0.25, hrx * 0.86, hrz * 0.86, 0.22);
      wrap.dispose();
      head.add(BOX, BANDAGE, 0.02, 0.2, hrz + 0.012, 0.5, 0.2, 0.15, 0.03, 0.08, 0.006);
      head.add(BOX, BANDAGE, -0.02, 0.19, hrz + 0.008, 0.35, -0.3, -0.2, 0.03, 0.07, 0.006);
      bandAid(head, 2.6, 0.95, 1.1);
      stitchLine(head, 0.55, -0.15, 0.8, -0.45, 3);
      // Tank top straps, plaster cast, bicep bandage, sewn-on shoulder.
      for (const a of arms) {
        const sx = Math.sign(a.sh[0]);
        shoulderStrap(body, L.shirt, sx * 0.13, 0.385, 0.06);
      }
      const castArm = arms[0];
      limb(body, (_x, y) => (Math.sin(y * 90) > 0.8 ? 0xb9b3a4 : BANDAGE), lerp3(castArm.el, castArm.wr, 0.05), lerp3(castArm.el, castArm.wr, 0.9), 0.041 * armR + 0.02, 10);
      const castMid = lerp3(castArm.el, castArm.wr, 0.45);
      body.add(SPH_LO, 0xff6fae, castMid[0] - 0.068, castMid[1] + 0.02, castMid[2], 0, 0, 0, 0.012, 0.012, 0.012);
      body.add(SPH_LO, 0x4fa3ff, castMid[0] - 0.06, castMid[1] + 0.045, castMid[2] + 0.04, 0, 0, 0, 0.01, 0.01, 0.01);
      body.add(BOX, 0x5a4a8a, castMid[0] - 0.066, castMid[1] - 0.01, castMid[2] - 0.035, 0.6, 0, 0.4, 0.004, 0.04, 0.006);
      body.add(BOX, 0x5a4a8a, castMid[0] - 0.064, castMid[1] + 0.0, castMid[2] - 0.02, -0.4, 0, 0.4, 0.004, 0.035, 0.006);
      const other = arms[1];
      for (const t of [0.45, 0.58]) limbRing(body, BANDAGE, other.sh, other.el, t, 0.068, 0.02);
      stitchRing(body, other.sh, other.el, 0.18, 0.07);
      stitchRing(body, castArm.sh, castArm.el, 0.2, 0.07);
      break;
    }
    case 'rosa': {
      // Grave Queen: crooked crown, standing lace collar, purple bun with a white streak.
      face('goofy', 'none', 0x4a3570);
      onHead(head, SPH, 0x6b2b5a, 0.03, -0.42, -0.005, 0.1, 0.05, 0.022, 0.016);
      onHead(head, BOX, TOOTH, 0.045, -0.405, 0.0105, -0.12, 0.014, 0.013, 0.005);
      for (let i = 0; i < 3; i++) {
        onHead(head, BOX, PUPIL, L.bigEye * (0.33 + i * 0.045), 0.19 + (i === 1 ? 0.012 : 0), 0.035, L.bigEye * (0.5 - i * 0.5), 0.004, 0.022, 0.004);
      }
      onHead(head, SPH_LO, 0x3a2a3a, -0.33, -0.3, 0.0, 0, 0.009, 0.009, 0.006);
      for (const side of [-1, 1]) onHead(head, SPH, 0xd98fb0, side * 0.62, -0.16, -0.002, 0, 0.03, 0.018, 0.008);
      stitchLine(head, 0.55, -0.02, 0.75, -0.35, 3);
      const streak = 0xe6e1f2;
      head.add(SPH, L.hair, 0, 0.15, 0.028, 0, 0, 0, hrx * 1.09, hry * 1.06, hrz * 1.08);
      onHead(head, SPH, L.hair, -0.32, 0.72, -0.005, -0.45, 0.085, 0.038, 0.035);
      onHead(head, SPH, streak, 0.3, 0.74, -0.005, 0.4, 0.08, 0.036, 0.035);
      for (const sx of [-1, 1]) {
        head.add(SPH, sx > 0 ? streak : L.hair, sx * 0.158, 0.03, 0.015, 0, 0, sx * -0.12, 0.048, 0.12, 0.058);
        head.add(SPH, sx > 0 ? streak : L.hair, sx * 0.17, -0.07, 0.02, 0, 0, 0, 0.032, 0.03, 0.035);
      }
      head.add(SPH, L.hair, 0, 0.225, 0.152, 0.5, 0, 0, 0.088, 0.08, 0.072);
      head.add(SPH, L.hair, 0.05, 0.17, 0.19, 0, 0, 0, 0.04, 0.036, 0.036);
      head.add(SPH, L.hair, -0.055, 0.18, 0.185, 0, 0, 0, 0.036, 0.034, 0.034);
      // Crown, tilted.
      const crownM = new THREE.Matrix4().compose(_v1.set(0.035, 0.14 + hry + 0.018, 0.0), _q.setFromEuler(_e.set(-0.12, 0.3, -0.34)), _s.set(1, 1, 1));
      const inCrown = (geo: THREE.BufferGeometry, paint: Paint, x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): void => {
        _m1.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
        headShiny.addMatrix(geo, paint, _m1.premultiply(crownM));
      };
      const band = new THREE.CylinderGeometry(1, 0.9, 1, 20, 1, true);
      const bandInner = new THREE.CylinderGeometry(0.97, 0.87, 1, 20, 1, true);
      flipFaces(bandInner);
      inCrown(band, 0xf5c04a, 0, 0.022, 0, 0, 0, 0, 0.09, 0.05, 0.09);
      inCrown(bandInner, 0xc48f2a, 0, 0.022, 0, 0, 0, 0, 0.09, 0.05, 0.09);
      band.dispose();
      bandInner.dispose();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI;
        const x = Math.sin(a) * 0.088;
        const z = -Math.cos(a) * 0.088;
        const tall = i === 0 ? 0.07 : 0.055;
        _v2.set(Math.sin(a) * 0.15, 1, -Math.cos(a) * 0.15);
        frameAlongY(_v2);
        basisMatrix(_m1, _v3.set(x, 0.042, z), 0, 0, 0, 0.022, tall, 0.012).premultiply(crownM);
        headShiny.addMatrix(CONE, 0xf5c04a, _m1);
        inCrown(SPH_LO, 0xfff0a0, x * 1.05, 0.045 + tall, z * 1.05, 0, 0, 0, 0.011, 0.011, 0.011);
        inCrown(SPH_LO, i === 0 ? 0xff4f9a : 0x19d3c5, x * 1.05, 0.022, z * 1.05, 0, a, 0, 0.013, 0.013, 0.008);
      }
      for (const side of [-1, 1]) {
        E.at(side * 1.5, -0.32, 0.012, _v1, _n0);
        headShiny.add(SPH_LO, 0x19d3c5, _v1.x, _v1.y - 0.02, _v1.z, 0, 0, 0, 0.014, 0.018, 0.014);
      }
      // Lace collar: small ruffles in front, a tall fan standing up behind the neck.
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const back = Math.sin(a);
        const lace = i % 2 ? 0xf7f3ff : 0xe3daf2;
        const base = new THREE.Vector3(Math.cos(a) * 0.085 * wide, 0.36, 0.02 + Math.sin(a) * 0.08);
        if (back > 0.15) {
          const len = 0.06 + 0.1 * Math.sqrt(back);
          const dir = new THREE.Vector3(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.8);
          frameAlongY(dir, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
          body.addMatrix(SPH, lace, basisMatrix(M, base.clone().addScaledVector(_by, len * 0.5), 0, 0, 0, 0.036, len * 0.55, 0.011));
        } else {
          const dir = new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a));
          frameAlongY(dir, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
          body.addMatrix(SPH, lace, basisMatrix(M, base.clone().addScaledVector(_by, 0.022), 0, 0, 0, 0.03, 0.03, 0.011));
        }
      }
      for (const a of arms) {
        const sh = a.sh;
        body.add(SPH, L.shirt, sh[0] * 1.05, sh[1] + 0.01, sh[2], 0, 0, 0, 0.1, 0.085, 0.095);
        limbRing(body, 0xe0b04a, a.sh, a.el, 0.55, 0.054, 0.012);
      }
      body.add(BOX, 0xe0b04a, 0, 0.3, chestZ + 0.006, 0.3, 0, 0, 0.14 * wide, 0.014, 0.012);
      body.add(SPH_LO, 0x19d3c5, 0, 0.3, chestZ - 0.004, 0, 0, 0, 0.018, 0.022, 0.01);
      break;
    }
  }

  hole.dispose();
  for (const g of unit) g.dispose();

  // --- meshes ------------------------------------------------------------------------
  driver.add(makeMesh(track(body.build()), matte, 'zombieBody'));
  if (!bodyGlow.empty) {
    const m = makeMesh(track(bodyGlow.build()), glowMaterial(), 'zombieBodyGlow');
    m.castShadow = false;
    driver.add(m);
  }
  driverHead.add(makeMesh(track(head.build()), matte, 'zombieHead'));
  if (!headShiny.empty) driverHead.add(makeMesh(track(headShiny.build()), shinyMaterial(), 'zombieHeadMetal'));
  if (!headGlow.empty) {
    const m = makeMesh(track(headGlow.build()), glowMaterial(), 'zombieHeadGlow');
    m.castShadow = false;
    driverHead.add(m);
  }
  driver.add(driverHead);
  const handMesh = makeMesh(track(hands.build()), matte, 'zombieHands');
  steerPivot.add(handMesh);

  return { driver, driverHead, flaps: flaps.length ? flaps : undefined, sparks: sparks.length ? sparks : undefined };
}

export function buildKartModel(character: CharacterDef): KartModelPartsEx {
  const root = new THREE.Group();
  root.name = `kart-${character.id}`;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.add(g);
    return g;
  };
  const mat = <T extends THREE.Material>(m: T): T => {
    materials.add(m);
    return m;
  };

  // --- materials -----------------------------------------------------------
  const bodyMaterial = mat(
    new THREE.MeshPhysicalMaterial({
      color: character.color,
      metalness: 0.2,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  const accentMaterial = mat(
    new THREE.MeshStandardMaterial({
      color: character.accent,
      metalness: 0.45,
      roughness: 0.3,
      emissive: character.accent,
      emissiveIntensity: 0.32,
    }),
  );
  // Scenes have no environment map, so pure metals fake their ambient reflection with a grey emissive.
  const chrome = mat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.18, emissive: 0x4a5058, emissiveIntensity: 1 }),
  );
  const darkMetal = mat(new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.55, roughness: 0.5 }));
  const rubber = mat(new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.9, metalness: 0.05 }));
  const tyreMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  const rimMat = mat(
    new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.7, roughness: 0.3, emissive: 0x2a2e34, emissiveIntensity: 1 }),
  );
  const seatMat = mat(
    new THREE.MeshStandardMaterial({ color: 0x1c1c23, roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide }),
  );
  const exhaustGlowMaterial = mat(
    new THREE.MeshStandardMaterial({
      color: 0x120805,
      emissive: 0xff7a1a,
      emissiveIntensity: 0,
      roughness: 0.6,
    }),
  );
  const number = Math.max(1, CHARACTERS.indexOf(character) + 1);
  const plateTex = makeNumberTexture(number, character.accent, character.color);
  textures.add(plateTex);
  const plateMat = mat(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.45, metalness: 0.05 }));

  // --- chassis (body material) ---------------------------------------------
  const bodyBatch = new Batch();
  const chassis = buildChassisGeometry();
  bodyBatch.add(chassis);
  chassis.dispose();
  const pod = new RoundedBoxGeometry(0.28, 0.16, 0.74, 1, 0.05);
  bodyBatch.add(pod, WHEEL_X - 0.03, 0.24, 0.02);
  bodyBatch.add(pod, -WHEEL_X + 0.03, 0.24, 0.02);
  pod.dispose();
  const body = makeMesh(track(bodyBatch.build()), bodyMaterial, 'body');
  body.receiveShadow = true;
  root.add(body);

  // --- dark metal parts ----------------------------------------------------
  const darkBatch = new Batch();
  const floorPan = new RoundedBoxGeometry(0.98, 0.06, 1.34, 1, 0.02);
  darkBatch.add(floorPan, 0, 0.13, -0.02);
  floorPan.dispose();
  const engine = new RoundedBoxGeometry(0.4, 0.24, 0.26, 1, 0.04);
  darkBatch.add(engine, 0, 0.55, 0.66);
  engine.dispose();
  const mount = new THREE.BoxGeometry(0.04, 0.04, 0.14);
  darkBatch.add(mount, 0.17, 0.19, -0.76);
  darkBatch.add(mount, -0.17, 0.19, -0.76);
  mount.dispose();
  const column = limbGeometry(0, 0.46, -0.3, 0, 0.6, -0.08, 0.022, 8);
  darkBatch.add(column);
  column.dispose();
  const strut = new THREE.BoxGeometry(0.04, 0.26, 0.05);
  darkBatch.add(strut, 0.3, 0.575, 0.68);
  darkBatch.add(strut, -0.3, 0.575, 0.68);
  strut.dispose();
  root.add(makeMesh(track(darkBatch.build()), darkMetal, 'darkParts'));

  // --- chrome parts --------------------------------------------------------
  const chromeBatch = new Batch();
  const head = new RoundedBoxGeometry(0.3, 0.1, 0.16, 1, 0.03);
  chromeBatch.add(head, 0, 0.7, 0.64);
  head.dispose();
  const filter = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12);
  chromeBatch.add(filter, -0.12, 0.7, 0.74, 0, 0, Math.PI / 2);
  filter.dispose();
  root.add(makeMesh(track(chromeBatch.build()), chrome, 'chromeParts'));

  // --- exhausts (separate so they can flicker) ------------------------------
  const exhausts: THREE.Object3D[] = [];
  const pipeGeo = track(new THREE.CylinderGeometry(0.046, 0.052, 0.28, 12, 1, false));
  pipeGeo.translate(0, 0.14, 0);
  pipeGeo.rotateX(Math.PI / 2);
  const glowGeo = track(new THREE.CircleGeometry(0.04, 12));
  glowGeo.translate(0, 0, 0.283);
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.name = 'exhaust';
    g.position.set(sx * 0.17, 0.5, 0.64);
    g.rotation.x = -0.16;
    g.add(makeMesh(pipeGeo, chrome, 'pipe'));
    const glow = makeMesh(glowGeo, exhaustGlowMaterial, 'exhaustGlow');
    glow.castShadow = false;
    g.add(glow);
    root.add(g);
    exhausts.push(g);
  }

  // --- accent parts (spoiler, bumper, glowing strips) -----------------------
  const accentBatch = new Batch();
  const wing = new RoundedBoxGeometry(0.94, 0.035, 0.24, 1, 0.015);
  accentBatch.add(wing, 0, 0.71, 0.72, -0.22, 0, 0);
  wing.dispose();
  const plate = new THREE.BoxGeometry(0.025, 0.11, 0.26);
  accentBatch.add(plate, 0.47, 0.72, 0.72, -0.22, 0, 0);
  accentBatch.add(plate, -0.47, 0.72, 0.72, -0.22, 0, 0);
  plate.dispose();
  const bumperArc = Math.PI * 0.9;
  const bumper = new THREE.TorusGeometry(0.33, 0.03, 6, 18, bumperArc);
  bumper.rotateX(Math.PI / 2);
  bumper.rotateY(bumperArc / 2 + Math.PI / 2);
  accentBatch.add(bumper, 0, 0.19, -0.5);
  bumper.dispose();
  const podStrip = new THREE.BoxGeometry(0.05, 0.014, 0.62);
  accentBatch.add(podStrip, WHEEL_X - 0.03, 0.325, 0.02);
  accentBatch.add(podStrip, -WHEEL_X + 0.03, 0.325, 0.02);
  podStrip.dispose();
  const hoodStrip = new THREE.BoxGeometry(0.06, 0.012, 0.36);
  accentBatch.add(hoodStrip, 0, 0.465, -0.54, -0.19, 0, 0);
  hoodStrip.dispose();
  const rearStrip = new THREE.BoxGeometry(0.42, 0.03, 0.02);
  accentBatch.add(rearStrip, 0, 0.27, 0.815, 0.25, 0, 0);
  rearStrip.dispose();
  root.add(makeMesh(track(accentBatch.build()), accentMaterial, 'accentParts'));

  // --- number plates -------------------------------------------------------
  const plateBatch = new Batch();
  const frontPlate = new THREE.PlaneGeometry(0.22, 0.16);
  plateBatch.add(frontPlate, 0, 0.29, -0.9, 0.08, Math.PI, 0);
  frontPlate.dispose();
  const sidePlate = new THREE.PlaneGeometry(0.18, 0.11);
  plateBatch.add(sidePlate, 0.636, 0.24, 0.02, 0, Math.PI / 2, 0);
  plateBatch.add(sidePlate, -0.636, 0.24, 0.02, 0, -Math.PI / 2, 0);
  sidePlate.dispose();
  const plates = makeMesh(track(plateBatch.build()), plateMat, 'plates');
  plates.castShadow = false;
  root.add(plates);

  // --- seat ----------------------------------------------------------------
  const seatBatch = new Batch();
  const seatBack = new THREE.CylinderGeometry(0.23, 0.21, 0.42, 14, 1, true, -Math.PI / 2, Math.PI);
  seatBatch.add(seatBack, 0, 0.57, 0.3, 0.12, 0, 0);
  seatBack.dispose();
  const seatBase = new RoundedBoxGeometry(0.46, 0.09, 0.4, 1, 0.03);
  seatBatch.add(seatBase, 0, 0.37, 0.16);
  seatBase.dispose();
  // Low padded roll: a tall headrest would swallow the hair, hats and collars.
  const headrest = new RoundedBoxGeometry(0.24, 0.07, 0.09, 1, 0.03);
  seatBatch.add(headrest, 0, 0.752, 0.515, 0.12, 0, 0);
  headrest.dispose();
  root.add(makeMesh(track(seatBatch.build()), seatMat, 'seat'));

  // --- steering wheel --------------------------------------------------------
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0.61, -0.07);
  steerPivot.rotation.x = -0.53;
  const steeringWheel = new THREE.Group();
  steeringWheel.name = 'steeringWheel';
  const wheelBatch = new Batch();
  const ring = new THREE.TorusGeometry(0.13, 0.022, 6, 20);
  wheelBatch.add(ring);
  ring.dispose();
  const hubGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12);
  wheelBatch.add(hubGeo, 0, 0, 0, Math.PI / 2, 0, 0);
  hubGeo.dispose();
  const spokeGeo = new THREE.BoxGeometry(0.03, 0.11, 0.015);
  spokeGeo.translate(0, 0.07, 0);
  for (const a of [Math.PI, Math.PI / 6, -Math.PI / 6]) {
    wheelBatch.add(spokeGeo, 0, 0, 0, 0, 0, a);
  }
  spokeGeo.dispose();
  steeringWheel.add(makeMesh(track(wheelBatch.build()), rubber, 'steeringWheelMesh'));
  steerPivot.add(steeringWheel);
  root.add(steerPivot);

  // --- wheels ----------------------------------------------------------------
  const frontGeos = buildWheelGeometry(WHEEL_R_F, WHEEL_W_F);
  const rearGeos = buildWheelGeometry(WHEEL_R_R, WHEEL_W_R);
  track(frontGeos.tyre);
  track(frontGeos.rim);
  track(rearGeos.tyre);
  track(rearGeos.rim);
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wheelRadii: number[] = [];
  const makeWheel = (geos: WheelGeos, x: number, y: number, z: number, isFront: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    spin.name = 'wheel';
    spin.add(makeMesh(geos.tyre, tyreMat, 'tyre'));
    spin.add(makeMesh(geos.rim, rimMat, 'rim'));
    pivot.add(spin);
    root.add(pivot);
    wheels.push(spin);
    wheelRadii.push(isFront ? WHEEL_R_F : WHEEL_R_R);
    if (isFront) frontWheels.push(pivot);
  };
  makeWheel(frontGeos, -WHEEL_X, WHEEL_R_F, WHEEL_Z_F, true);
  makeWheel(frontGeos, WHEEL_X, WHEEL_R_F, WHEEL_Z_F, true);
  makeWheel(rearGeos, -WHEEL_X, WHEEL_R_R, WHEEL_Z_R, false);
  makeWheel(rearGeos, WHEEL_X, WHEEL_R_R, WHEEL_Z_R, false);

  // --- driver ------------------------------------------------------------------
  const zombie = buildZombieDriver(character, steerPivot, track, mat);
  const driver = zombie.driver;
  const driverHead = zombie.driverHead;
  root.add(driver);

  const dispose = () => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    geometries.clear();
    materials.clear();
    textures.clear();
    root.removeFromParent();
  };

  return {
    root,
    body,
    wheels,
    frontWheels,
    steeringWheel,
    driver,
    driverHead,
    exhausts,
    bodyMaterial,
    accentMaterial,
    exhaustGlowMaterial,
    wheelRadii,
    dispose,
    flaps: zombie.flaps,
    sparks: zombie.sparks,
  };
}
