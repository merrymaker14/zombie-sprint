import * as THREE from 'three';
import type { TrackTheme } from '../../core/types';
import type { BuildContext } from './context';
import { color, track, trackMesh } from './context';
import { makeGroundTexture } from '../textures';
import { TERRAIN_EXTENT, VOID_BASIN_DEPTH } from '../TerrainField';
import { fbm2, smoothstep, clamp01, lerp } from '../../core/math';

const TERRAIN_SEGMENTS = 240;

interface TerrainStyle {
  /** Steep slopes. */
  rock: number;
  /** Ground well above / below the road band. */
  high: number;
  low: number;
  water: number;
  /** Tint of the strip next to the road; null = palette.offroad. */
  roadBand: number | null;
  /** Distant ring silhouettes: near (lower) ring, far (taller) ring and their tops. */
  ringNear: number;
  ringFar: number;
  peak: number;
  /** Normalised height where ridges turn to the peak colour (> 1 = never). */
  peakLine: number;
}

const TERRAIN_STYLES: Partial<Record<TrackTheme, TerrainStyle>> = {
  // Mossy cemetery grass under moonlight, dark rolling hills.
  grassland: {
    rock: 0x55525e,
    high: 0x5d6b45,
    low: 0x2e4a33,
    water: 0x1d3a44,
    roadBand: null,
    ringNear: 0x243040,
    ringFar: 0x3d4f5e,
    peak: 0x4a5a6c,
    peakLine: 0.85,
  },
  // Ash-dusted dunes, burnt mesas against the sunset.
  desert: {
    rock: 0x6e4a3c,
    high: 0xbd9676,
    low: 0x87644f,
    water: 0x1d3a5a,
    roadBand: null,
    ringNear: 0x4a2a2c,
    ringFar: 0x8a4c3e,
    peak: 0x9a5842,
    peakLine: 1.1,
  },
  // Grey trampled snow, bleak rock ridges.
  snow: {
    rock: 0x5f6b76,
    high: 0xeef2f4,
    low: 0xc6d0d6,
    water: 0x0f2d3c,
    roadBand: 0xe4eaee,
    ringNear: 0x5a6772,
    ringFar: 0x7f8f99,
    peak: 0xdde5ea,
    peakLine: 0.4,
  },
  // Dark city blocks.
  neon: {
    rock: 0x15131d,
    high: 0x1a1826,
    low: 0x0a0912,
    water: 0x1d3a5a,
    roadBand: 0x1c1a28,
    ringNear: 0x0a0714,
    ringFar: 0x1a0f2c,
    peak: 0x24163a,
    peakLine: 1.1,
  },
};

/** Large displaced ground plane with theme vertex colours. */
export function buildTerrain(ctx: BuildContext): THREE.Mesh {
  const { def, field } = ctx;
  const theme = def.theme;
  const geo = new THREE.PlaneGeometry(TERRAIN_EXTENT, TERRAIN_EXTENT, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;

  const style = (TERRAIN_STYLES[theme] ?? TERRAIN_STYLES.grassland) as TerrainStyle;
  const ground = color(def.palette.ground);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  const rock = color(style.rock);
  const high = color(style.high);
  const low = color(style.low);
  const water = color(style.water);
  const roadBand = color(style.roadBand ?? def.palette.offroad);

  const roadYMin = ctx.cl.minY;
  // Displace first, then derive slope from the recomputed normals (cheaper than extra height taps).
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i) + field.centerX;
    const z = pos.getZ(i) + field.centerZ;
    const h = field.heightAt(x, z);
    pos.setXYZ(i, x, h, z);
    uv.setXY(i, x / 6, z / 6);
  }
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = pos.getY(i);
    const slope = clamp01((1 - nrm.getY(i)) * 2.2);
    const n = fbm2(x * 0.015 + 3.3, z * 0.015 + 8.8, 3);
    field.sampleField(x, z);
    const nearRoad = 1 - smoothstep(ctx.cl.maxWallHalfWidth + 2, ctx.cl.maxWallHalfWidth + 18, field.fDist);

    // height-based blend relative to the road elevation band
    const rel = clamp01((h - roadYMin + 6) / 40);
    c.copy(low).lerp(high, rel);
    c.lerp(ground, 0.35);
    tmp.copy(c).offsetHSL(0, 0, (n - 0.5) * 0.12);
    c.copy(tmp);
    c.lerp(rock, slope * (theme === 'desert' ? 0.7 : 0.85));
    c.lerp(roadBand, nearRoad * 0.55);
    if (theme === 'snow') {
      // deep basin = frozen water; snow stays bright on the flats
      const depthBelowRoad = roadYMin - h;
      const wet = smoothstep(VOID_BASIN_DEPTH * 0.4, VOID_BASIN_DEPTH * 0.75, depthBelowRoad);
      c.lerp(water, wet);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();

  const tex = makeGroundTexture(theme, 0xffffff);
  track(ctx, tex);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  trackMesh(ctx, mesh);
  return mesh;
}

/** Low-poly ring of distant hills / mountains (or a skyline for the neon city). */
export function buildMountains(ctx: BuildContext): THREE.Mesh {
  const { def, field } = ctx;
  const theme = def.theme;
  const rings = [
    { radius: 560, hMin: 30, hMax: 95, seg: 96, tint: 0.55 },
    { radius: 700, hMin: 60, hMax: 170, seg: 80, tint: 1 },
  ];
  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const style = (TERRAIN_STYLES[theme] ?? TERRAIN_STYLES.grassland) as TerrainStyle;
  // Unfogged silhouettes: the base melts into the fog colour, the ridge line keeps its own tone.
  const base = color(def.environment.fogColor);
  const peak = color(style.peak);
  const c = new THREE.Color();
  let vbase = 0;
  for (const ring of rings) {
    const seg = ring.seg;
    const mid = color(ring.tint < 1 ? style.ringNear : style.ringFar);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nz = fbm2(Math.cos(a) * 3 + ring.radius * 0.01, Math.sin(a) * 3, 3);
      let h = lerp(ring.hMin, ring.hMax, nz);
      if (theme === 'neon') {
        // skyline: flat-topped blocks
        h = Math.round(h / 12) * 12 + (i % 2 === 0 ? 10 : 0);
      } else {
        h *= 0.8 + 0.4 * fbm2(a * 6.3, ring.radius, 2);
      }
      const r = ring.radius * (0.96 + 0.08 * fbm2(a * 2, 5, 2));
      const x = field.centerX + Math.cos(a) * r;
      const z = field.centerZ + Math.sin(a) * r;
      // bottom
      verts.push(x, -40, z);
      c.copy(base);
      cols.push(c.r, c.g, c.b);
      // top
      verts.push(x, h, z);
      const k = clamp01(h / ring.hMax);
      c.copy(mid).lerp(peak, smoothstep(style.peakLine - 0.3, style.peakLine + 0.2, k));
      cols.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < seg; i++) {
      const a = vbase + i * 2;
      const b = a + 1;
      const d = a + 2;
      const e = a + 3;
      // inward facing (camera is inside the ring)
      idx.push(a, d, b, b, d, e);
    }
    vbase += (seg + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mountains';
  trackMesh(ctx, mesh);
  return mesh;
}
