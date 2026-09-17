import * as THREE from 'three';
import type { TrackTheme } from '../../core/types';
import type { BuildContext } from './context';
import { track, trackMesh } from './context';
import { clamp01, seededRandom } from '../../core/math';

export const SKY_RADIUS = 1500;

const SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = wp.xyz - cameraPosition;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Force the dome onto the far plane so it is never clipped by the camera far distance.
  clip.z = clip.w * 0.999999;
  gl_Position = clip;
}
`;

const SKY_FRAG = /* glsl */ `
#define TAU 6.2831853
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform float uTime;
// Tileable noise: r = 3-octave fbm, g = single octave (8 lattice cells per tile).
uniform sampler2D uNoise;
// Sun or moon disc: direction, tangent basis, tan(angular radius), 1 - cos of the disc bound.
uniform vec3 uDiscDir;
uniform vec3 uDiscU;
uniform vec3 uDiscV;
uniform float uDiscTan;
uniform float uDiscEdge;
uniform vec3 uDiscColor;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uStars;
uniform float uClouds;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uMist;
uniform vec3 uMistColor;
uniform float uSmoke;
uniform vec3 uSmokeColor;
uniform float uSmokeAz[4];
uniform float uSiren;
uniform float uSirenAz[4];
varying vec3 vWorldDir;

float wrapAngle(float a) {
  return mod(a + 3.14159265, TAU) - 3.14159265;
}
#ifdef USE_STARS
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
#endif
#ifdef USE_MOON
// Filled crater mask (1 inside) for the cartoon moon.
float crater(vec2 p, vec2 c, float r) {
  return 1.0 - smoothstep(0.78, 1.0, length(p - c) / r);
}
#endif

void main() {
  vec3 d = normalize(vWorldDir);
  float y = d.y;
  vec3 col = y >= 0.0 ? mix(uHorizon, uTop, pow(min(y, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(min(-y, 1.0), 0.6));
  // horizon glow band
  col += uHorizon * exp(-abs(y) * 9.0) * 0.18;
  float az = atan(d.z, d.x);

#ifdef USE_STARS
  if (y > 0.04) {
    vec2 g = vec2(az, asin(y)) * 95.0;
    vec2 cell = floor(g);
    float h = hash12(cell);
    if (h > 0.74) {
      float h2 = hash12(cell + 17.0);
      vec2 sp = vec2(hash12(cell + 3.1), h2) * 0.7 + 0.15;
      float star = smoothstep(0.13, 0.0, length(fract(g) - sp)) * (0.4 + 0.6 * h2) * smoothstep(0.04, 0.3, y);
      col += vec3(0.75 + 0.25 * h2, 0.85, 1.0) * star * 1.4 * uStars;
    }
  }
#endif

  // sun / moon: soft halo from the angular distance, then an opaque disc
  float off = 1.0 - dot(d, uDiscDir);
  float above = smoothstep(-0.03, 0.04, y);
  float glowNear = exp(-off * 9.0);
  col += uGlowColor * (exp(-off * 90.0) * 0.3 + glowNear * 0.1) * uGlow * above;
  float discMask = 0.0;
  if (off < uDiscEdge) {
    float sd = 1.0 - off;
    vec2 p = vec2(dot(d, uDiscU), dot(d, uDiscV)) / (sd * uDiscTan);
    float r = length(p);
    discMask = (1.0 - smoothstep(0.97, 1.03, r)) * above;
    vec3 dc = uDiscColor;
#ifdef USE_MOON
    float cr = crater(p, vec2(-0.36, 0.28), 0.27) + crater(p, vec2(0.32, -0.3), 0.21) + crater(p, vec2(0.08, 0.58), 0.13)
      + crater(p, vec2(0.5, 0.3), 0.12) + crater(p, vec2(-0.22, -0.52), 0.17) + crater(p, vec2(-0.62, -0.12), 0.1);
    // lit from the upper left: craters and the lower right rim are a touch darker
    float side = clamp(0.5 + 0.5 * dot(p / max(r, 1e-3), vec2(0.7, -0.7)), 0.0, 1.0) * smoothstep(0.45, 1.0, r);
    dc *= (1.0 - 0.2 * min(cr, 1.0)) * (1.0 - 0.22 * side);
#else
    dc *= 1.0 - 0.12 * smoothstep(0.6, 1.0, r);
#endif
    col = mix(col, dc, discMask);
  }

#ifdef USE_CLOUDS
  // drifting cloud layer projected on a flat ceiling
  if (y > 0.0) {
    vec2 cuv = d.xz / (y + 0.14) * 0.14 + vec2(uTime * 0.0008, uTime * 0.0003);
    float n = texture2D(uNoise, cuv).r;
    float cover = smoothstep(0.78 - uClouds * 0.5, 1.02 - uClouds * 0.4, n) * smoothstep(0.0, 0.16, y);
    vec3 cc = mix(uCloudShade, uCloudLit, smoothstep(0.45, 0.95, n)) + uGlowColor * glowNear * 0.35 * uGlow;
    col = mix(col, cc, cover * mix(0.85, 0.55, discMask));
  }
#endif

#ifdef USE_SMOKE
  // rising smoke columns from far away
  if (y > -0.02 && y < 0.42) {
    float s = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float w = 0.018 + y * 0.22;
      float dx = wrapAngle(az - uSmokeAz[k]) - y * (0.28 + 0.08 * fk);
      if (abs(dx) < w * 1.6) {
        float turb = texture2D(uNoise, vec2(dx * 4.75 + fk * 0.37, y * 3.25 - uTime * 0.015 + fk * 0.61)).g;
        float body = 1.0 - smoothstep(0.35, 1.1, abs(dx) / w + (turb - 0.5) * 0.9);
        s = max(s, body * (1.0 - smoothstep(0.1, 0.3 + 0.05 * fk, y)));
      }
    }
    col = mix(col, uSmokeColor, s * uSmoke);
  }
#endif

#ifdef USE_MIST
  // low mist hugging the horizon
  if (y < 0.4) {
    float mn = 0.75 + 0.25 * texture2D(uNoise, vec2(az / TAU * 7.0 + uTime * 0.002, y * 2.25)).g;
    col = mix(col, uMistColor, clamp(uMist * exp(-max(y, 0.0) * 11.0) * mn, 0.0, 1.0));
  }
#endif

#ifdef USE_SIREN
  // pulsing emergency glow over the far city
  if (y < 0.6) {
    float band = exp(-max(y, 0.0) * 4.0) * smoothstep(-0.04, 0.02, y);
    vec3 sc = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float dx = wrapAngle(az - uSirenAz[k]);
      float pulse = 0.5 + 0.5 * sin(uTime * (2.2 + 0.4 * fk) + fk * 1.9);
      vec3 tint = mod(fk, 2.0) < 0.5 ? vec3(1.0, 0.08, 0.1) : vec3(1.0, 0.55, 0.05);
      sc += tint * exp(-dx * dx * 14.0) * (0.35 + 0.65 * pulse * pulse);
    }
    col += sc * band * 0.5 * uSiren;
  }
#endif

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface SkyStyle {
  moon: boolean;
  /** Visual disc: angular radius, elevation and azimuth relative to the start straight (+ = right). */
  radiusDeg: number;
  elevationDeg: number;
  azimuthDeg: number;
  discColor: number;
  discGain: number;
  glowColor: number;
  glow: number;
  stars: number;
  clouds: number;
  cloudLit: number;
  cloudShade: number;
  mist: number;
  mistColor: number;
  smoke: number;
  smokeColor: number;
  siren: number;
}

const SKY_STYLES: Partial<Record<TrackTheme, SkyStyle>> = {
  // Moonlit cemetery dusk.
  grassland: {
    moon: true,
    radiusDeg: 5.2,
    elevationDeg: 17,
    azimuthDeg: -24,
    discColor: 0xf1f3c6,
    discGain: 1.15,
    glowColor: 0x9fe6b6,
    glow: 1.0,
    stars: 0.7,
    clouds: 0.38,
    cloudLit: 0x767aa4,
    cloudShade: 0x2c2f4e,
    mist: 0.55,
    mistColor: 0x8fcf9e,
    smoke: 0,
    smokeColor: 0,
    siren: 0,
  },
  // Dusty crimson sunset with smoke from the burning city.
  desert: {
    moon: false,
    radiusDeg: 5.5,
    elevationDeg: 8,
    azimuthDeg: 20,
    discColor: 0xffb46e,
    discGain: 1.45,
    glowColor: 0xff6a2e,
    glow: 1.5,
    stars: 0,
    clouds: 0.42,
    cloudLit: 0xa0604a,
    cloudShade: 0x4c2c30,
    mist: 0.45,
    mistColor: 0xc98a66,
    smoke: 1.0,
    smokeColor: 0x241a1e,
    siren: 0,
  },
  // Cold overcast with a weak sun behind the cloud deck.
  snow: {
    moon: false,
    radiusDeg: 3.4,
    elevationDeg: 15,
    azimuthDeg: 28,
    discColor: 0xe6eef0,
    discGain: 0.95,
    glowColor: 0xc6dbe0,
    glow: 0.55,
    stars: 0,
    clouds: 0.9,
    cloudLit: 0xa4b0b6,
    cloudShade: 0x56646f,
    mist: 0.4,
    mistColor: 0xbccfca,
    smoke: 0,
    smokeColor: 0,
    siren: 0,
  },
  // Locked-down city night: green-tinted moon and siren glow on the skyline.
  neon: {
    moon: true,
    radiusDeg: 4.2,
    elevationDeg: 21,
    azimuthDeg: 22,
    discColor: 0xe2f7c4,
    discGain: 1.05,
    glowColor: 0x6dff9a,
    glow: 0.75,
    stars: 1.0,
    clouds: 0.22,
    cloudLit: 0x3a2452,
    cloudShade: 0x120a1c,
    mist: 0.38,
    mistColor: 0x1c4a34,
    smoke: 0,
    smokeColor: 0,
    siren: 1,
  },
};

const NOISE_SIZE = 256;

/**
 * Tileable value noise baked once per track so the sky shader does one texture fetch instead of
 * a dozen hashes per pixel: r = 3-octave fbm, g = a single octave with another seed.
 */
function makeSkyNoise(): THREE.DataTexture {
  const size = NOISE_SIZE;
  const lattice = (cells: number, seed: number): Float32Array => {
    const rng = seededRandom(seed);
    const v = new Float32Array(cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = rng();
    return v;
  };
  const sample = (lat: Float32Array, cells: number, x: number, y: number): number => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let tx = fx - ix;
    let ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const x0 = ix % cells;
    const y0 = iy % cells;
    const x1 = (x0 + 1) % cells;
    const y1 = (y0 + 1) % cells;
    const a = lat[y0 * cells + x0];
    const b = lat[y0 * cells + x1];
    const c = lat[y1 * cells + x0];
    const d = lat[y1 * cells + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  const o1 = lattice(8, 11);
  const o2 = lattice(16, 23);
  const o3 = lattice(32, 37);
  const single = lattice(8, 51);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fbm = (sample(o1, 8, x, y) * 0.5 + sample(o2, 16, x, y) * 0.25 + sample(o3, 32, x, y) * 0.125) / 0.875;
      const i = (y * size + x) * 4;
      data[i] = Math.round(clamp01(fbm) * 255);
      data[i + 1] = Math.round(clamp01(sample(single, 8, x, y)) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Gradient sky dome with a sun or cartoon moon, stars, clouds, mist, smoke and siren glow. Never fogged.
 * Drawn after the opaque scene with a depth test so only pixels that stay visible run the shader.
 */
export function buildSky(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sky';
  const env = ctx.def.environment;
  const style = (SKY_STYLES[ctx.def.theme] ?? SKY_STYLES.grassland) as SkyStyle;
  const cx = ctx.field.centerX;
  const cz = ctx.field.centerZ;
  const { cl } = ctx;

  // Place the disc relative to the start straight so it is in view on the grid and main straight.
  const fwd = new THREE.Vector2(cl.tx[0], cl.tz[0]);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, -1);
  fwd.normalize();
  const az = THREE.MathUtils.degToRad(style.azimuthDeg);
  const el = THREE.MathUtils.degToRad(style.elevationDeg);
  // Right of travel = (-fz, fx) rotated clockwise when seen from above.
  const hx = fwd.x * Math.cos(az) - fwd.y * Math.sin(az);
  const hz = fwd.y * Math.cos(az) + fwd.x * Math.sin(az);
  const discDir = new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize();
  const discU = new THREE.Vector3().crossVectors(discDir, new THREE.Vector3(0, 1, 0)).normalize();
  const discV = new THREE.Vector3().crossVectors(discU, discDir).normalize();

  const baseAz = Math.atan2(hz, hx);
  const smokeAz = [baseAz + 0.35, baseAz - 0.9, baseAz + 2.2, baseAz - 2.6];
  const sirenAz = [baseAz - 0.55, baseAz + 0.8, baseAz + 2.6, baseAz - 2.0];

  const noise = makeSkyNoise();
  track(ctx, noise);
  const defines: Record<string, string> = {};
  if (style.moon) defines.USE_MOON = '';
  if (style.stars > 0) defines.USE_STARS = '';
  if (style.clouds > 0) defines.USE_CLOUDS = '';
  if (style.smoke > 0) defines.USE_SMOKE = '';
  if (style.mist > 0) defines.USE_MIST = '';
  if (style.siren > 0) defines.USE_SIREN = '';
  const radius = THREE.MathUtils.degToRad(style.radiusDeg);

  const geo = new THREE.SphereGeometry(SKY_RADIUS, 40, 20);
  const mat = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      uNoise: { value: noise },
      uTop: { value: new THREE.Color(env.skyTop) },
      uHorizon: { value: new THREE.Color(env.skyHorizon) },
      uBottom: { value: new THREE.Color(env.skyBottom) },
      uTime: ctx.timeUniform,
      uDiscDir: { value: discDir },
      uDiscU: { value: discU },
      uDiscV: { value: discV },
      uDiscTan: { value: Math.tan(radius) },
      uDiscEdge: { value: 1 - Math.cos(radius * 1.1) },
      uDiscColor: { value: new THREE.Color(style.discColor).multiplyScalar(style.discGain) },
      uGlowColor: { value: new THREE.Color(style.glowColor) },
      uGlow: { value: style.glow },
      uStars: { value: style.stars },
      uClouds: { value: style.clouds },
      uCloudLit: { value: new THREE.Color(style.cloudLit) },
      uCloudShade: { value: new THREE.Color(style.cloudShade) },
      uMist: { value: style.mist },
      uMistColor: { value: new THREE.Color(style.mistColor) },
      uSmoke: { value: style.smoke },
      uSmokeColor: { value: new THREE.Color(style.smokeColor) },
      uSmokeAz: { value: smokeAz },
      uSiren: { value: style.siren },
      uSirenAz: { value: sirenAz },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.position.set(cx, 0, cz);
  // After every opaque object (still before transparent ones); the vertex shader pins it to the far plane.
  dome.renderOrder = 1000;
  dome.frustumCulled = false;
  dome.name = 'skyDome';
  trackMesh(ctx, dome);
  group.add(dome);
  return group;
}
