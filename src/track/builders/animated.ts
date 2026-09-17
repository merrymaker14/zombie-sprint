import * as THREE from 'three';
import type { BuildContext } from './context';
import { headingFromDir, trackMesh } from './context';
import { ball, box, cone, cyl, glowMaterial, mergeGlow, scatter, wallClearance, type GlowPart } from './decor';
import { landmarkFootprints } from './landmarks';
import { lerp } from '../../core/math';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** Per-theme animated set pieces: bats and wisps, vultures and smoke, infected aurora, helicopters. */
export function buildAnimatedProps(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'animated';
  const theme = ctx.def.theme;
  switch (theme) {
    case 'grassland':
    case 'beach':
      addBats(ctx, group);
      addWisps(ctx, group);
      break;
    case 'desert':
    case 'volcano':
      addWindpump(ctx, group);
      addVultures(ctx, group);
      addSmoke(ctx, group);
      break;
    case 'snow':
      addAurora(ctx, group);
      addSkyBeams(ctx, group);
      break;
    case 'neon':
      addHelicopters(ctx, group);
      break;
  }
  return group;
}

/** Glow material whose vertices flap: y is lifted by |x| * sin(time + per-instance phase). */
function flapMaterial(ctx: BuildContext, speed: number, amount: number): THREE.MeshStandardMaterial {
  const mat = glowMaterial(null, { roughness: 0.8, side: THREE.DoubleSide });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.uniforms.uTime = ctx.timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nattribute float aPhase;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float flapWing = smoothstep(0.12, 0.6, abs(transformed.x));
        transformed.y += abs(transformed.x) * sin(uTime * ${speed.toFixed(2)} + aPhase * 6.2831) * ${amount.toFixed(2)} * flapWing;`,
      );
  };
  mat.customProgramCacheKey = () => `zs-flap-${speed}-${amount}`;
  return mat;
}

function wingShape(points: [number, number][]): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let k = 1; k < points.length; k++) s.lineTo(points[k][0], points[k][1]);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function instancedFlyers(ctx: BuildContext, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string): THREE.InstancedMesh {
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = ctx.rng();
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trackMesh(ctx, mesh);
  return mesh;
}

interface Orbit {
  cx: number;
  cy: number;
  cz: number;
  r: number;
  w: number;
  phase: number;
  bob: number;
}

function orbitInstances(ctx: BuildContext, mesh: THREE.InstancedMesh, orbits: Orbit[], scale: number, bank: number): void {
  const update = (elapsed: number): void => {
    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i];
      const a = o.phase + elapsed * o.w;
      _p.set(o.cx + Math.cos(a) * o.r, o.cy + Math.sin(elapsed * 1.3 + o.phase * 3) * o.bob, o.cz + Math.sin(a) * o.r);
      const vx = -Math.sin(a) * Math.sign(o.w);
      const vz = Math.cos(a) * Math.sign(o.w);
      _e.set(0, headingFromDir(vx, vz), -bank * Math.sign(o.w), 'YXZ');
      _q.setFromEuler(_e);
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.updaters.push((_dt, elapsed) => update(elapsed));
}

// ------------------------------------------------------------------ graveyard: bats + will-o'-wisps
function addBats(ctx: BuildContext, group: THREE.Group): void {
  const rng = ctx.rng;
  const bodyCol = 0x2a2233;
  const wingCol = 0x3a2e48;
  const P: GlowPart[] = [
    { geo: ball(0.22, 8, 6).scale(0.8, 0.9, 1.15), color: bodyCol },
    { geo: ball(0.16, 8, 6).translate(0, 0.1, -0.24), color: bodyCol },
    { geo: cone(0.06, 0.18, 4).translate(-0.08, 0.3, -0.24), color: bodyCol },
    { geo: cone(0.06, 0.18, 4).translate(0.08, 0.3, -0.24), color: bodyCol },
    { geo: ball(0.04, 5, 4).translate(-0.06, 0.13, -0.38), color: 0xffd23a, glow: 2.5 },
    { geo: ball(0.04, 5, 4).translate(0.06, 0.13, -0.38), color: 0xffd23a, glow: 2.5 },
  ];
  const wing: [number, number][] = [
    [0.12, 0.12],
    [0.55, 0.36],
    [1.05, 0.32],
    [1.35, 0.02],
    [1.08, -0.1],
    [0.85, -0.02],
    [0.6, -0.2],
    [0.38, -0.06],
    [0.12, -0.14],
  ];
  const right = wingShape(wing);
  const left = wingShape(wing.map(([x, y]) => [-x, y] as [number, number]));
  P.push({ geo: right, color: wingCol }, { geo: left, color: wingCol });
  const geo = mergeGlow(P);
  const fps = landmarkFootprints(ctx);
  const centers: { x: number; z: number }[] = fps.slice(0, 3).map((f) => ({ x: f.x, z: f.z }));
  for (const p of scatter(ctx, 3, 5, 40)) centers.push({ x: p.x, z: p.z });
  const orbits: Orbit[] = [];
  centers.forEach((c, k) => {
    const n = k < 2 ? 6 : 4;
    const baseY = ctx.field.heightAt(c.x, c.z);
    for (let i = 0; i < n; i++) {
      orbits.push({
        cx: c.x + (rng() - 0.5) * 6,
        cy: baseY + lerp(9, 18, rng()),
        cz: c.z + (rng() - 0.5) * 6,
        r: lerp(4, 12, rng()),
        w: lerp(0.5, 1.0, rng()) * (rng() < 0.5 ? -1 : 1),
        phase: rng() * Math.PI * 2,
        bob: lerp(0.5, 1.6, rng()),
      });
    }
  });
  const mesh = instancedFlyers(ctx, geo, flapMaterial(ctx, 16, 0.75), orbits.length, 'bats');
  orbitInstances(ctx, mesh, orbits, 1.5, 0.35);
  group.add(mesh);
}

function addWisps(ctx: BuildContext, group: THREE.Group): void {
  const rng = ctx.rng;
  const pts = scatter(ctx, 22, 1, 35).filter((p) => wallClearance(ctx, p.x, p.z) > 3);
  const geo = new THREE.IcosahedronGeometry(0.28, 1);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6) });
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  mesh.name = 'wisps';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cols = [new THREE.Color(0.55, 1, 0.6), new THREE.Color(0.45, 0.95, 1), new THREE.Color(0.8, 0.6, 1)];
  const seeds = pts.map(() => ({ ph: rng() * Math.PI * 2, r: lerp(0.8, 2.5, rng()), h: lerp(0.9, 2.2, rng()), w: lerp(0.4, 0.9, rng()) }));
  pts.forEach((_, i) => mesh.setColorAt(i, cols[i % cols.length]));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  trackMesh(ctx, mesh);
  const update = (elapsed: number): void => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sd = seeds[i];
      const a = sd.ph + elapsed * sd.w;
      _p.set(p.x + Math.cos(a) * sd.r, p.y + sd.h + Math.sin(elapsed * 2.1 + sd.ph) * 0.35, p.z + Math.sin(a * 1.3) * sd.r);
      const pulse = 0.8 + 0.3 * Math.sin(elapsed * 3.3 + sd.ph * 2);
      _s.setScalar(pulse);
      _q.identity();
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.updaters.push((_dt, elapsed) => update(elapsed));
  group.add(mesh);
}

// ------------------------------------------------------------------ doomsday highway: creaky windpump, vultures, smoke
function spotNear(ctx: BuildContext, t: number, lateralDist: number, side: number): THREE.Vector3 {
  const cl = ctx.cl;
  const i = Math.floor((((t % 1) + 1) % 1) * cl.n) % cl.n;
  const lat = side * (cl.whw[i] + lateralDist);
  const x = cl.px[i] + cl.bx[i] * lat;
  const z = cl.pz[i] + cl.bz[i] * lat;
  return new THREE.Vector3(x, ctx.field.heightAt(x, z), z);
}

function addWindpump(ctx: BuildContext, group: THREE.Group): void {
  const pos = spotNear(ctx, 0.3, 16, -1);
  const yaw = headingFromDir(ctx.cl.px[Math.floor(0.3 * ctx.cl.n)] - pos.x, ctx.cl.pz[Math.floor(0.3 * ctx.cl.n)] - pos.z);
  const H = 12;
  const rust = 0x7a4a2e;
  const P: GlowPart[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = cyl(0.08, 0.12, H, 5);
    leg.translate(0, H / 2, 0);
    const lp = leg.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < lp.count; v++) {
      const r = lerp(2.2, 0.45, lp.getY(v) / H);
      lp.setX(v, lp.getX(v) + Math.cos(a) * r);
      lp.setZ(v, lp.getZ(v) + Math.sin(a) * r);
    }
    leg.computeVertexNormals();
    P.push({ geo: leg, color: 0x5a4a40 });
    for (let b = 1; b <= 3; b++) {
      if (k === 2 && b === 2) continue;
      const y = (b / 4) * H;
      const r = lerp(2.2, 0.45, y / H);
      const a2 = a + Math.PI / 2;
      const x0 = Math.cos(a) * r;
      const z0 = Math.sin(a) * r;
      const x1 = Math.cos(a2) * r;
      const z1 = Math.sin(a2) * r;
      const brace = box(Math.hypot(x1 - x0, z1 - z0), 0.07, 0.07);
      brace.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      brace.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      P.push({ geo: brace, color: 0x5a4a40 });
    }
  }
  P.push({ geo: box(1.4, 0.12, 1.4).translate(0, H, 0), color: 0x4a3a30 });
  P.push({ geo: box(0.35, 0.35, 1.4).translate(0, H + 0.4, 0.3), color: rust });
  const tail = box(0.06, 1.3, 2.2);
  tail.translate(0, H + 0.6, 1.9);
  tail.rotateY(0.25);
  P.push({ geo: tail, color: 0x8a5a3a });
  const tower = new THREE.Mesh(mergeGlow(P), glowMaterial(null, { roughness: 0.9, metalness: 0.2 }));
  tower.name = 'windpumpTower';
  tower.castShadow = true;
  tower.position.set(pos.x, pos.y - 0.3, pos.z);
  tower.rotation.y = yaw;
  trackMesh(ctx, tower);
  group.add(tower);

  const F: GlowPart[] = [{ geo: cyl(0.28, 0.28, 0.3, 8).rotateX(Math.PI / 2), color: 0x3a3030 }];
  const blades = 14;
  for (let k = 0; k < blades; k++) {
    if (k === 3 || k === 4 || k === 9) continue;
    const a = (k / blades) * Math.PI * 2;
    const blade = box(0.42, 2.1, 0.04);
    blade.rotateY(0.35);
    blade.translate(0, 1.45, 0);
    if (k === 7) blade.rotateX(0.3);
    blade.rotateZ(a);
    F.push({ geo: blade, color: k % 3 === 0 ? 0x8a5a3a : 0x9a8a78 });
  }
  F.push({ geo: new THREE.TorusGeometry(1.9, 0.04, 4, 20), color: 0x5a4a40 });
  const fan = new THREE.Mesh(mergeGlow(F), glowMaterial(null, { roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide }));
  fan.name = 'windpumpFan';
  fan.castShadow = true;
  const holder = new THREE.Group();
  holder.position.set(pos.x, pos.y - 0.3 + H + 0.4, pos.z);
  holder.rotation.y = yaw;
  fan.position.set(0, 0, -0.5);
  holder.add(fan);
  trackMesh(ctx, fan);
  group.add(holder);
  ctx.updaters.push((dt, elapsed) => {
    // creaky: gusts spin it up, then it stalls and rocks back a little
    const gust = Math.max(0, Math.sin(elapsed * 0.35) + 0.35 * Math.sin(elapsed * 1.7));
    fan.rotation.z -= dt * (gust * 2.4 - 0.08 * Math.sin(elapsed * 3.1));
  });
}

function addVultures(ctx: BuildContext, group: THREE.Group): void {
  const rng = ctx.rng;
  const dark = 0x2e2622;
  const P: GlowPart[] = [
    { geo: ball(0.3, 8, 6).scale(0.75, 0.7, 1.4), color: dark },
    { geo: new THREE.TorusGeometry(0.16, 0.07, 5, 10).translate(0, 0.08, -0.4), color: 0xe8e0d0 },
    { geo: cyl(0.05, 0.07, 0.3, 5).rotateX(-1.1).translate(0, 0.14, -0.55), color: 0xc88a7a },
    { geo: ball(0.11, 7, 5).translate(0, 0.24, -0.7), color: 0xd89a8a },
    { geo: cone(0.05, 0.16, 4).rotateX(-Math.PI / 2).translate(0, 0.2, -0.86), color: 0xe0c07a },
    { geo: cone(0.18, 0.5, 4).rotateX(Math.PI / 2).translate(0, 0, 0.55), color: dark },
  ];
  const wing: [number, number][] = [
    [0.15, 0.2],
    [0.9, 0.28],
    [1.6, 0.18],
    [1.9, 0.02],
    [1.75, -0.12],
    [1.55, -0.06],
    [1.4, -0.2],
    [1.2, -0.12],
    [0.6, -0.22],
    [0.15, -0.2],
  ];
  P.push({ geo: wingShape(wing), color: 0x3a302a }, { geo: wingShape(wing.map(([x, y]) => [-x, y] as [number, number])), color: 0x3a302a });
  const geo = mergeGlow(P);
  const fps = landmarkFootprints(ctx);
  const orbits: Orbit[] = [];
  const centers = fps.length ? fps : [{ x: ctx.field.centerX, z: ctx.field.centerZ, r: 10 }];
  for (let i = 0; i < 8; i++) {
    const c = centers[i % centers.length];
    orbits.push({
      cx: c.x + (rng() - 0.5) * 10,
      cy: ctx.field.heightAt(c.x, c.z) + lerp(22, 38, rng()),
      cz: c.z + (rng() - 0.5) * 10,
      r: lerp(10, 22, rng()),
      w: lerp(0.18, 0.32, rng()) * (i % 2 === 0 ? 1 : -1),
      phase: rng() * Math.PI * 2,
      bob: 1.5,
    });
  }
  const mesh = instancedFlyers(ctx, geo, flapMaterial(ctx, 3.2, 0.22), orbits.length, 'vultures');
  orbitInstances(ctx, mesh, orbits, 1.8, 0.28);
  group.add(mesh);
}

function addSmoke(ctx: BuildContext, group: THREE.Group): void {
  const rng = ctx.rng;
  const sources = scatter(ctx, 3, 40, 160);
  const perSource = 9;
  const count = sources.length * perSource;
  if (count === 0) return;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a4440, transparent: true, opacity: 0.42, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'smokePlumes';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trackMesh(ctx, mesh);
  const offs = new Float32Array(count).map(() => rng());
  const update = (elapsed: number): void => {
    let i = 0;
    for (const src of sources) {
      for (let k = 0; k < perSource; k++, i++) {
        const age = (elapsed * 0.05 + k / perSource + offs[i] * 0.05) % 1;
        const grow = 2 + age * 10;
        const fade = age > 0.85 ? (1 - age) / 0.15 : 1;
        _p.set(src.x + age * 26 + Math.sin(age * 7 + k) * 2, src.y + 1 + age * 55, src.z + age * 9);
        _s.setScalar(grow * fade);
        _q.identity();
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.updaters.push((_dt, elapsed) => update(elapsed));
  group.add(mesh);
}

// ------------------------------------------------------------------ frozen outbreak: infected aurora + sky beams
const AURORA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i.x + i.y * 57.0), b = hash(i.x + 1.0 + i.y * 57.0), c = hash(i.x + (i.y + 1.0) * 57.0), d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  float x = vUv.x * 6.0;
  float t = uTime * 0.12;
  float curtain = noise(vec2(x * 1.5 + t, t * 0.6)) * 0.6 + noise(vec2(x * 4.0 - t * 1.3, 2.0 + t)) * 0.4;
  float band = smoothstep(0.25, 0.75, curtain);
  float v = vUv.y;
  float vertical = smoothstep(0.0, 0.25, v) * (1.0 - smoothstep(0.55, 1.0, v));
  float rays = 0.6 + 0.4 * noise(vec2(x * 12.0 + t * 3.0, v * 3.0));
  float alpha = band * vertical * rays * 0.8;
  vec3 col = mix(uColorA, uColorB, smoothstep(0.1, 0.8, v + 0.2 * noise(vec2(x, t))));
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

function addAurora(ctx: BuildContext, group: THREE.Group): void {
  const cx = ctx.field.centerX;
  const cz = ctx.field.centerZ;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: ctx.timeUniform,
      uColorA: { value: new THREE.Color(0x9dff2e) },
      uColorB: { value: new THREE.Color(0x2effa8) },
    },
    vertexShader: AURORA_VERT,
    fragmentShader: AURORA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  ctx.disposables.push(mat);
  const geo = new THREE.PlaneGeometry(520, 110, 1, 1);
  ctx.disposables.push(geo);
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.9 + 0.3;
    const r = 520 + i * 60;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx + Math.cos(a) * r, 150 + i * 25, cz + Math.sin(a) * r);
    mesh.lookAt(cx, 120, cz);
    mesh.frustumCulled = false;
    mesh.renderOrder = -500;
    mesh.name = 'aurora';
    group.add(mesh);
  }
}

/** Searchlight beams sweeping the sky above the abandoned station. */
function addSkyBeams(ctx: BuildContext, group: THREE.Group): void {
  const fps = landmarkFootprints(ctx);
  const station = fps[1] ?? { x: ctx.field.centerX, z: ctx.field.centerZ, r: 10 };
  const base = new THREE.Vector3(station.x, ctx.field.heightAt(station.x, station.z) + 2, station.z);
  const count = 3;
  const geo = new THREE.CylinderGeometry(0.3, 5, 1, 14, 1, true);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8ffe0, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'skyBeams';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trackMesh(ctx, mesh);
  const offsets = [new THREE.Vector3(-14, 0, -6), new THREE.Vector3(10, 0, 8), new THREE.Vector3(2, 0, -14)];
  const update = (elapsed: number): void => {
    for (let i = 0; i < count; i++) {
      const yaw = elapsed * (0.22 + i * 0.07) * (i % 2 === 0 ? 1 : -1) + i * 2.1;
      const pitch = 0.38 + Math.sin(elapsed * 0.4 + i) * 0.16;
      _v.set(Math.sin(pitch) * Math.cos(yaw), Math.cos(pitch), Math.sin(pitch) * Math.sin(yaw));
      _q.setFromUnitVectors(UP, _v);
      _p.copy(base).add(offsets[i]);
      _s.set(1, 140, 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.updaters.push((_dt, elapsed) => update(elapsed));
  group.add(mesh);
}

// ------------------------------------------------------------------ neon quarantine: patrol helicopters with searchlights
function addHelicopters(ctx: BuildContext, group: THREE.Group): void {
  const { field, rng } = ctx;
  const count = 2;
  const hull = 0x2a3140;
  const body = mergeGlow([
    { geo: ball(1.2, 12, 8).scale(1.1, 0.95, 1.8), color: hull },
    { geo: ball(0.9, 10, 6).scale(1, 0.75, 1).translate(0, 0.2, -1.3), color: 0x7ff0ff, glow: 0.6 },
    { geo: cyl(0.22, 0.4, 4.8, 8).rotateX(Math.PI / 2).translate(0, 0.35, 3.8), color: hull },
    { geo: box(0.12, 1.4, 1.0).translate(0, 0.9, 6.0), color: hull },
    { geo: box(2.6, 0.08, 0.12).translate(0, -1.35, -0.6), color: 0x1a1d24 },
    { geo: box(0.12, 0.08, 3.4).translate(-1.1, -1.4, 0), color: 0x1a1d24 },
    { geo: box(0.12, 0.08, 3.4).translate(1.1, -1.4, 0), color: 0x1a1d24 },
    { geo: box(0.12, 0.5, 0.12).translate(-1.1, -1.15, 0.6), color: 0x1a1d24 },
    { geo: box(0.12, 0.5, 0.12).translate(1.1, -1.15, 0.6), color: 0x1a1d24 },
    { geo: box(2.3, 0.3, 0.05).translate(0, -0.2, 0.9).rotateY(0), color: 0xffc21a, glow: 0.8 },
    { geo: ball(0.16, 6, 4).translate(0, 1.2, 0.4), color: 0xff2a1a, glow: 4 },
    { geo: ball(0.12, 6, 4).translate(0, 1.6, 6.4), color: 0xff2a1a, glow: 4 },
    { geo: cyl(0.35, 0.3, 0.3, 10).translate(0, -1.1, -1.4), color: 0xfff6d8, glow: 3 },
  ]);
  const bodies = new THREE.InstancedMesh(body, glowMaterial(null, { roughness: 0.5, metalness: 0.4 }), count);
  bodies.name = 'helicopters';
  const rotorGeo = mergeGlow([
    { geo: box(0.3, 0.06, 10), color: 0x15161c },
    { geo: box(10, 0.06, 0.3), color: 0x15161c },
    { geo: cyl(0.2, 0.2, 0.5, 8).translate(0, -0.25, 0), color: 0x15161c },
  ]);
  const rotors = new THREE.InstancedMesh(rotorGeo, glowMaterial(null, { roughness: 0.6 }), count);
  rotors.name = 'helicopterRotors';
  const beamGeo = new THREE.CylinderGeometry(0.02, 1, 1, 18, 1, true);
  beamGeo.translate(0, -0.5, 0);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, count);
  beams.name = 'helicopterBeams';
  for (const m of [bodies, rotors, beams]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trackMesh(ctx, m);
    group.add(m);
  }
  const cx = field.centerX;
  const cz = field.centerZ;
  const cfg = Array.from({ length: count }, (_, i) => ({
    r: lerp(90, 150, rng()),
    h: lerp(42, 55, rng()),
    w: lerp(0.07, 0.1, rng()) * (i % 2 === 0 ? 1 : -1),
    ph: rng() * Math.PI * 2 + i * Math.PI,
  }));
  const update = (elapsed: number): void => {
    for (let i = 0; i < count; i++) {
      const c = cfg[i];
      const a = c.ph + elapsed * c.w;
      _p.set(cx + Math.cos(a) * c.r, c.h + Math.sin(elapsed * 0.5 + i) * 2, cz + Math.sin(a) * c.r);
      const vx = -Math.sin(a) * Math.sign(c.w);
      const vz = Math.cos(a) * Math.sign(c.w);
      _e.set(0.12, headingFromDir(vx, vz), 0, 'YXZ');
      _q.setFromEuler(_e);
      _s.setScalar(1.6);
      _m.compose(_p, _q, _s);
      bodies.setMatrixAt(i, _m);
      // rotor: spin about the body's up axis
      _q2.setFromAxisAngle(UP, elapsed * 18 + i);
      _q2.premultiply(_q);
      _v.set(0, 1.9, 0).applyQuaternion(_q).multiplyScalar(1.6).add(_p);
      _m.compose(_v, _q2, _s);
      rotors.setMatrixAt(i, _m);
      // searchlight: sweeps a circle on the ground ahead of the helicopter
      const gx = _p.x + vx * 25 + Math.cos(elapsed * 0.9 + i) * 18;
      const gz = _p.z + vz * 25 + Math.sin(elapsed * 0.9 + i) * 18;
      const gy = field.heightAt(gx, gz);
      const lamp = _v.set(0, -1.8, -2.2).applyQuaternion(_q).multiplyScalar(1.6).add(_p);
      _dir.set(gx - lamp.x, gy - lamp.y, gz - lamp.z);
      const len = _dir.length();
      _dir.divideScalar(len);
      _q2.setFromUnitVectors(DOWN, _dir);
      _s.set(len * 0.16, len, len * 0.16);
      _m.compose(lamp, _q2, _s);
      beams.setMatrixAt(i, _m);
      _s.setScalar(1.6);
    }
    bodies.instanceMatrix.needsUpdate = true;
    rotors.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.updaters.push((_dt, elapsed) => update(elapsed));
}
