/**
 * Live 3D backdrop behind the menus: a frozen kart slowly turning on a small
 * glossy podium under a moonlit night sky, floor fading into the sky with fog,
 * graveyard silhouettes on the horizon, low green mist, a few cartoon zombie
 * hands poking out of the ground, thin rotating light rings, drifting motes, and
 * a slowly orbiting camera. The framing mode decides where the kart sits on
 * screen so the DOM menus can be composed around it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterDef, IKart } from '../core/types';
import { LAYER_BLOOM } from '../core/constants';
import { damp, seededRandom } from '../core/math';
import { Kart } from '../kart/Kart';

export type MenuFraming = 'title' | 'characters' | 'tracks';

interface FramingSpec {
  /** Horizontal camera distance from the kart (m). */
  distance: number;
  /** Camera height above the kart focus point (m). */
  height: number;
  fov: number;
  /** Desired NDC position (-1..1) of the kart focus point on screen. */
  sx: number;
  sy: number;
  /** NDC position of the moon; it stays put on screen while the camera orbits. */
  mx: number;
  my: number;
}

const FRAMINGS: Record<MenuFraming, FramingSpec> = {
  title: { distance: 5.7, height: 1.0, fov: 30, sx: 0, sy: -0.3, mx: 0.52, my: 0.6 },
  characters: { distance: 5.3, height: 0.95, fov: 30, sx: 0.58, sy: -0.08, mx: 0.8, my: 0.8 },
  tracks: { distance: 5.9, height: 0.85, fov: 30, sx: 0, sy: 0.42, mx: 0.72, my: 0.97 },
};

const PODIUM_RADIUS = 1.55;
const PODIUM_HEIGHT = 0.32;
/** Height of the kart's visual centre above the podium top. */
const KART_FOCUS_Y = 0.42;
const ORBIT_SPEED = 0.11;
const KART_SPIN = 0.22;
const FRAMING_LAMBDA = 3.2;
const FOG_COLOR = 0x1a1136;
const DUST_COUNT = 420;
const DUST_RADIUS = 7;
const DUST_HEIGHT = 4.5;
/** Mote diameter in metres (min + random share of range). */
const DUST_SIZE_MIN = 0.018;
const DUST_SIZE_RANGE = 0.03;
/** Upper bound for a single mote as a share of the viewport height. */
const DUST_MAX_SCREEN_FRACTION = 0.02;
/** Star size in CSS pixels; scaled by the renderer pixel ratio at draw time. */
const STAR_SIZE = 1.6;
/** Moon angular radius (degrees). */
const MOON_RADIUS_DEG = 2.4;
/** Graveyard silhouette rings (m). Both sit inside the sky dome; the near one stands on the floor. */
const HORIZON_NEAR_RADIUS = 105;
const HORIZON_FAR_RADIUS = 175;
/** Initial orbit angle; the zombie hands are placed so they are in view at the start. */
const START_ANGLE = 0.7;

const glslFloat = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const SKY_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uGlow;
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uMoonU;
uniform vec3 uMoonV;
uniform float uMoonTan;
uniform float uMoonEdge;
uniform float uMoon;
varying vec3 vWorldPos;
float moonCrater(vec2 p, vec2 c, float r) {
  return 1.0 - smoothstep(0.75, 1.0, length(p - c) / r);
}
void main() {
  vec3 d = normalize(vWorldPos);
  float h = d.y;
  // Above the horizon: horizon colour → zenith. Below: stay at the horizon colour so the
  // fogged floor (same colour) meets it without a seam.
  vec3 c = h > 0.0 ? mix(uMid, uTop, pow(max(h, 0.0), 0.5)) : uMid;
  // Soft glow just above the horizon, slowly breathing. It starts from zero at the
  // horizon itself: any glow there makes the sky brighter than the fogged floor edge
  // and draws a hard line across the screen.
  float rise = smoothstep(0.0, 0.12, h);
  float glow = rise * exp(-max(h, 0.0) * 6.0) * (0.55 + 0.1 * sin(uTime * 0.35 + d.x * 2.0));
  c += uGlow * glow;
  // Faint ghostly aurora band.
  float band = exp(-pow((h - 0.22 + 0.03 * sin(uTime * 0.25 + d.x * 3.0)) * 10.0, 2.0));
  c += vec3(0.02, 0.09, 0.07) * band * (0.6 + 0.4 * sin(uTime * 0.4 + d.z * 4.0));
  // Cartoon moon, placed relative to the camera (it only ever shows above the horizon).
  if (uMoon > 0.0) {
    vec3 dm = normalize(vWorldPos - cameraPosition);
    float off = 1.0 - dot(dm, uMoonDir);
    // Masked just above the horizon only; the hill silhouettes cover that strip.
    float lift = smoothstep(0.005, 0.04, h) * uMoon;
    c += vec3(0.32, 0.55, 0.36) * (exp(-off * 500.0) * 0.16 + exp(-off * 80.0) * 0.05) * lift;
    if (off < uMoonEdge) {
      vec2 p = vec2(dot(dm, uMoonU), dot(dm, uMoonV)) / ((1.0 - off) * uMoonTan);
      float r = length(p);
      float disc = (1.0 - smoothstep(0.96, 1.04, r)) * lift;
      float cr = moonCrater(p, vec2(-0.34, 0.3), 0.26) + moonCrater(p, vec2(0.3, -0.28), 0.2)
        + moonCrater(p, vec2(0.1, 0.58), 0.13) + moonCrater(p, vec2(-0.2, -0.5), 0.16) + moonCrater(p, vec2(0.52, 0.28), 0.11);
      float side = smoothstep(0.35, 1.0, r) * clamp(0.5 + 0.5 * dot(p / max(r, 1e-3), vec2(0.7, -0.7)), 0.0, 1.0);
      vec3 mc = vec3(0.78, 0.84, 0.56) * (1.0 - 0.22 * min(cr, 1.0)) * (1.0 - 0.3 * side);
      c = mix(c, mc, disc);
    }
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uHeight;
// Drawing-buffer pixels per metre at 1 m depth: viewportHeight / (2 * tan(fov / 2)).
uniform float uScale;
uniform float uViewportHeight;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.08 + 0.06 * aSeed);
  p.y = mod(p.y + t, uHeight);
  p.x += sin(uTime * 0.3 + aSeed * 12.0) * 0.25;
  p.z += cos(uTime * 0.27 + aSeed * 9.0) * 0.25;
  // Fade in near the floor and out near the top.
  float fade = smoothstep(0.0, 0.5, p.y) * (1.0 - smoothstep(uHeight - 1.2, uHeight, p.y));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(0.05, -mv.z);
  // Motes right in front of the lens would cover a large part of the frame: hide them.
  fade *= smoothstep(1.2, 2.6, depth);
  vAlpha = fade * (0.35 + 0.65 * fract(aSeed * 7.31));
  float worldSize = ${glslFloat(DUST_SIZE_MIN)} + ${glslFloat(DUST_SIZE_RANGE)} * fract(aSeed * 3.17);
  gl_PointSize = min(worldSize * uScale / depth, uViewportHeight * ${glslFloat(DUST_MAX_SCREEN_FRACTION)});
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha * 0.55;
  gl_FragColor = vec4(vec3(0.72, 1.0, 0.66) * a, a);
}`;

const MIST_VERT = /* glsl */ `
attribute float aLayer;
varying vec3 vPos;
varying float vLayer;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vLayer = aLayer;
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vPos;
varying float vLayer;
varying float vDepth;
float mhash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float mnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mhash(i), mhash(i + vec2(1.0, 0.0)), u.x), mix(mhash(i + vec2(0.0, 1.0)), mhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 q = vPos.xz * (0.32 - vLayer * 0.07);
  vec2 drift = vec2(uTime * (0.05 + vLayer * 0.03), uTime * 0.02);
  float n = mnoise(q + drift + vLayer * 7.3) * 0.65 + mnoise(q * 2.3 - drift * 1.6) * 0.35;
  float r = length(vPos.xz);
  float radial = smoothstep(2.7, 6.0, r) * (1.0 - smoothstep(12.0, 30.0, r));
  // Keep patches off the lens.
  float nearCam = smoothstep(1.5, 4.0, vDepth);
  float a = smoothstep(0.45, 0.92, n) * radial * nearCam * (0.075 - vLayer * 0.02);
  gl_FragColor = vec4(uColor, a);
}`;

interface Ring {
  mesh: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
  speed: number;
  baseOpacity: number;
}

interface ZombieHand {
  mesh: THREE.Mesh;
  phase: number;
  baseYaw: number;
}

/** Flat triangle soup on a cylinder: x runs along the arc (m), y is height. Vertex colour follows height. */
class SilhouetteRing {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private readonly c = new THREE.Color();

  constructor(
    private readonly radius: number,
    private readonly shade: (y: number, out: THREE.Color) => void,
  ) {}

  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
    this.vertex(ax, ay);
    this.vertex(bx, by);
    this.vertex(cx, cy);
  }

  quad(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
    this.tri(ax, ay, bx, by, cx, cy);
    this.tri(ax, ay, cx, cy, dx, dy);
  }

  /** Convex polygon as a fan; points are [x, y] pairs. */
  poly(pts: number[][]): void {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0][0], pts[0][1], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }

  /** Painted with a fixed colour instead of the height ramp (lit windows). */
  flatQuad(x0: number, y0: number, x1: number, y1: number, col: THREE.Color): void {
    const pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (const [x, y] of pts) {
      this.place(x, y);
      this.colors.push(col.r, col.g, col.b);
    }
  }

  private vertex(x: number, y: number): void {
    this.place(x, y);
    this.shade(y, this.c);
    this.colors.push(this.c.r, this.c.g, this.c.b);
  }

  private place(x: number, y: number): void {
    const a = x / this.radius;
    this.positions.push(Math.sin(a) * this.radius, y, Math.cos(a) * this.radius);
  }
}

export class MenuBackdrop {
  readonly group = new THREE.Group();

  private kart: IKart | null = null;
  private currentId: string | null = null;
  private readonly kartHolder = new THREE.Group();
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly dustMaterial: THREE.ShaderMaterial;
  private readonly mistMaterial: THREE.ShaderMaterial;
  private readonly rings: Ring[] = [];
  private readonly hands: ZombieHand[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly fog = new THREE.FogExp2(FOG_COLOR, 0.03);
  private readonly background = new THREE.Color(FOG_COLOR);
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envTexture: THREE.Texture | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;

  private framing: MenuFraming = 'title';
  private readonly cur: FramingSpec = { ...FRAMINGS.title };
  private angle = START_ANGLE;
  private time = 0;

  private readonly origin = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private readonly focus = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly upv = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly viewport = new THREE.Vector4();

  constructor() {
    this.group.name = 'MenuBackdrop';

    // Sky dome ----------------------------------------------------------------
    const skyGeo = new THREE.SphereGeometry(220, 32, 16);
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x05040f) },
        uMid: { value: new THREE.Color(FOG_COLOR) },
        uGlow: { value: new THREE.Color(0x2a1550) },
        uTime: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0, 0.1, -1).normalize() },
        uMoonU: { value: new THREE.Vector3(1, 0, 0) },
        uMoonV: { value: new THREE.Vector3(0, 1, 0) },
        uMoonTan: { value: Math.tan(THREE.MathUtils.degToRad(MOON_RADIUS_DEG)) },
        uMoonEdge: { value: 1 - Math.cos(THREE.MathUtils.degToRad(MOON_RADIUS_DEG * 1.1)) },
        uMoon: { value: 1 },
      },
    });
    const sky = new THREE.Mesh(skyGeo, this.skyMaterial);
    sky.frustumCulled = false;
    // After the floor and silhouettes so hidden sky pixels are depth-rejected before shading.
    sky.renderOrder = 10;
    this.group.add(sky);
    this.disposables.push(skyGeo, this.skyMaterial);

    // Star field ----------------------------------------------------------------
    const starCount = 420;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 0.75);
      const r = 190;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) + 12;
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xdfe6ff,
      size: STAR_SIZE,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    // Without attenuation the size is in drawing-buffer pixels: keep it constant in CSS pixels.
    stars.onBeforeRender = (renderer) => {
      starMat.size = STAR_SIZE * renderer.getPixelRatio();
    };
    this.group.add(stars);
    this.disposables.push(starGeo, starMat);

    // Graveyard silhouettes on the horizon -----------------------------------------
    this.buildHorizon();

    // Floor: dark, glossy, fades into the sky colour through the fog -------------
    const floorGeo = new THREE.CircleGeometry(140, 72);
    const gridTex = this.makeGridTexture();
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.75,
      map: gridTex,
      envMapIntensity: 1.2,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.005;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.disposables.push(floorGeo, floorMat, gridTex);

    // Scattered headstones and cartoon zombie hands --------------------------------
    this.buildGraves();
    this.buildHands();

    // Podium ----------------------------------------------------------------------
    const podiumMat = new THREE.MeshStandardMaterial({ color: 0x15142c, metalness: 0.8, roughness: 0.22, envMapIntensity: 1.4 });
    const podiumGeo = new THREE.CylinderGeometry(PODIUM_RADIUS, PODIUM_RADIUS + 0.12, PODIUM_HEIGHT, 72);
    const podium = new THREE.Mesh(podiumGeo, podiumMat);
    podium.position.y = PODIUM_HEIGHT / 2;
    podium.castShadow = true;
    podium.receiveShadow = true;
    this.group.add(podium);
    this.disposables.push(podiumGeo, podiumMat);

    const stepGeo = new THREE.CylinderGeometry(PODIUM_RADIUS + 0.75, PODIUM_RADIUS + 0.85, 0.1, 72);
    const step = new THREE.Mesh(stepGeo, podiumMat);
    step.position.y = 0.05;
    step.receiveShadow = true;
    this.group.add(step);
    this.disposables.push(stepGeo);

    // Thin light rings (slightly over 1.0 so bloom just kisses them) ---------------
    this.addRing(PODIUM_RADIUS + 0.03, PODIUM_HEIGHT + 0.01, 0.016, new THREE.Color(0.45, 1.05, 1.45), 1, 0, 0.95);
    this.addRing(PODIUM_RADIUS + 0.86, 0.105, 0.014, new THREE.Color(1.3, 0.4, 1.0), 3, 0.22, 0.85);
    this.addRing(PODIUM_RADIUS + 1.9, 0.012, 0.012, new THREE.Color(0.45, 1.3, 0.6), 2, -0.14, 0.6);

    // Low green mist -------------------------------------------------------------
    this.mistMaterial = this.buildMist();

    // Dust motes -------------------------------------------------------------------
    const dustPos = new Float32Array(DUST_COUNT * 3);
    const dustSeed = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      const r = Math.sqrt(Math.random()) * DUST_RADIUS;
      const a = Math.random() * Math.PI * 2;
      dustPos[i * 3] = Math.cos(a) * r;
      dustPos[i * 3 + 1] = Math.random() * DUST_HEIGHT;
      dustPos[i * 3 + 2] = Math.sin(a) * r;
      dustSeed[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: DUST_HEIGHT },
        uScale: { value: 1 },
        uViewportHeight: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const dust = new THREE.Points(dustGeo, this.dustMaterial);
    dust.frustumCulled = false;
    // gl_PointSize is in pixels of whatever target is being drawn (canvas or the
    // post-processing buffer), so derive the scale from that target and the live FOV.
    dust.onBeforeRender = (renderer, _scene, cam) => {
      renderer.getCurrentViewport(this.viewport);
      const h = Math.max(1, this.viewport.w);
      const fov = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? (cam as THREE.PerspectiveCamera).fov : 50;
      const u = this.dustMaterial.uniforms;
      u.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
      u.uViewportHeight.value = h;
    };
    this.group.add(dust);
    this.disposables.push(dustGeo, this.dustMaterial);

    // Lights -----------------------------------------------------------------------
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(3.2, 6.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3.5;
    key.shadow.camera.right = 3.5;
    key.shadow.camera.top = 3.5;
    key.shadow.camera.bottom = -3.5;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.group.add(key, key.target);

    const top = new THREE.SpotLight(0xffffff, 60, 0, 0.55, 0.7, 2);
    top.position.set(0, 6.5, 0.5);
    top.target.position.set(0, PODIUM_HEIGHT, 0);
    this.group.add(top, top.target);

    const hemi = new THREE.HemisphereLight(0x3d48a8, 0x0b0716, 0.55);
    this.group.add(hemi);
    const rimA = new THREE.PointLight(0x37a8ff, 38, 22, 2);
    rimA.position.set(-4.2, 1.9, -3.2);
    const rimB = new THREE.PointLight(0xff3ab8, 38, 22, 2);
    rimB.position.set(4.2, 1.5, -3.2);
    this.group.add(rimA, rimB);

    this.kartHolder.position.y = PODIUM_HEIGHT;
    this.group.add(this.kartHolder);
    this.focus.set(0, PODIUM_HEIGHT + KART_FOCUS_Y, 0);
  }

  /** Swap the displayed kart to a character (no-op if unchanged). */
  setCharacter(def: CharacterDef): void {
    if (def.id === this.currentId) return;
    this.currentId = def.id;
    this.disposeKart();
    try {
      const kart: IKart = new Kart(0, def, true);
      kart.setFrozen(true);
      kart.resetTo(this.origin, this.identity);
      kart.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      this.kartHolder.add(kart.object);
      this.kart = kart;
    } catch (err) {
      console.error('[MenuBackdrop] failed to build kart', err);
      this.kart = null;
    }
  }

  /** Where the kart should sit on screen for the current menu panel. */
  setFraming(mode: MenuFraming, immediate = false): void {
    this.framing = mode;
    if (immediate) Object.assign(this.cur, FRAMINGS[mode]);
  }

  attach(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer): void {
    scene.add(this.group);
    scene.fog = this.fog;
    scene.background = this.background;
    this.scene = scene;
    if (renderer && renderer !== this.renderer) {
      this.stopWatchingContext();
      this.renderer = renderer;
      renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    }
    if (renderer && !this.envTexture) this.buildEnvironment(renderer);
    scene.environment = this.envTexture;
    Object.assign(this.cur, FRAMINGS[this.framing]);
    camera.fov = this.cur.fov;
    camera.updateProjectionMatrix();
    this.update(0, camera);
  }

  detach(scene: THREE.Scene): void {
    scene.remove(this.group);
    if (scene.fog === this.fog) scene.fog = null;
    if (scene.environment === this.envTexture) scene.environment = null;
    if (this.scene === scene) this.scene = null;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.time += dt;
    this.angle += dt * ORBIT_SPEED;
    this.kartHolder.rotation.y += dt * KART_SPIN;
    this.skyMaterial.uniforms.uTime.value = this.time;
    this.dustMaterial.uniforms.uTime.value = this.time;
    this.mistMaterial.uniforms.uTime.value = this.time;

    const pulse = 0.9 + 0.1 * Math.sin(this.time * 1.7);
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.mesh.rotation.z += dt * r.speed;
      r.material.opacity = r.baseOpacity * pulse;
    }

    // Slow, friendly wave.
    for (let i = 0; i < this.hands.length; i++) {
      const h = this.hands[i];
      h.mesh.rotation.set(
        Math.sin(this.time * 0.9 + h.phase) * 0.07,
        h.baseYaw + Math.sin(this.time * 0.5 + h.phase * 2.0) * 0.12,
        Math.sin(this.time * 1.3 + h.phase) * 0.16,
      );
    }

    if (this.kart) {
      this.kart.updateVisuals(dt);
      this.kart.object.position.copy(this.origin);
    }

    // Ease framing parameters toward the active mode.
    const want = FRAMINGS[this.framing];
    const c = this.cur;
    c.distance = damp(c.distance, want.distance, FRAMING_LAMBDA, dt);
    c.height = damp(c.height, want.height, FRAMING_LAMBDA, dt);
    c.fov = damp(c.fov, want.fov, FRAMING_LAMBDA, dt);
    c.sx = damp(c.sx, want.sx, FRAMING_LAMBDA, dt);
    c.sy = damp(c.sy, want.sy, FRAMING_LAMBDA, dt);
    c.mx = damp(c.mx, want.mx, FRAMING_LAMBDA, dt);
    c.my = damp(c.my, want.my, FRAMING_LAMBDA, dt);

    const bob = Math.sin(this.time * 0.45) * 0.1;
    const f = this.focus;
    this.camPos.set(Math.sin(this.angle) * c.distance, f.y + c.height + bob, Math.cos(this.angle) * c.distance);

    // Place the kart focus point at NDC (sx, sy) by offsetting the look target in the
    // camera's own right/up directions.
    this.dir.subVectors(f, this.camPos);
    const dist = this.dir.length();
    this.dir.multiplyScalar(1 / Math.max(1e-6, dist));
    this.right.crossVectors(this.dir, this.worldUp).normalize();
    this.upv.crossVectors(this.right, this.dir);
    const halfH = dist * Math.tan((c.fov * Math.PI) / 360);
    const halfW = halfH * Math.max(0.1, camera.aspect);
    this.target.copy(f).addScaledVector(this.right, -c.sx * halfW).addScaledVector(this.upv, -c.sy * halfH);

    camera.position.copy(this.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    if (Math.abs(camera.fov - c.fov) > 0.01) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }
    this.placeMoon(camera);
  }

  dispose(): void {
    this.stopWatchingContext();
    this.renderer = null;
    this.scene = null;
    this.disposeKart();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.rings.length = 0;
    this.hands.length = 0;
    this.releaseEnvironment(true);
    this.group.clear();
  }

  // ----------------------------------------------------------------- private

  private disposeKart(): void {
    if (!this.kart) return;
    this.kartHolder.remove(this.kart.object);
    try {
      this.kart.dispose();
    } catch (err) {
      console.warn('[MenuBackdrop] kart dispose failed', err);
    }
    this.kart = null;
  }

  /** Keep the moon at the framing's NDC spot: direction through that pixel from the camera. */
  private placeMoon(camera: THREE.PerspectiveCamera): void {
    const c = this.cur;
    const tanH = Math.tan((c.fov * Math.PI) / 360);
    const fwd = this.dir.subVectors(this.target, camera.position).normalize();
    const right = this.right.crossVectors(fwd, this.worldUp).normalize();
    const up = this.upv.crossVectors(right, fwd);
    const u = this.skyMaterial.uniforms;
    const moonDir = u.uMoonDir.value as THREE.Vector3;
    moonDir
      .copy(fwd)
      .addScaledVector(right, c.mx * tanH * Math.max(0.1, camera.aspect))
      .addScaledVector(up, c.my * tanH)
      .normalize();
    (u.uMoonU.value as THREE.Vector3).crossVectors(moonDir, this.worldUp).normalize();
    (u.uMoonV.value as THREE.Vector3).crossVectors(u.uMoonU.value as THREE.Vector3, moonDir).normalize();
  }

  /**
   * Thin glowing ring made of `segments` evenly spaced arcs (1 = full circle),
   * spinning at `speed` rad/s.
   */
  private addRing(
    radius: number,
    y: number,
    tube: number,
    color: THREE.Color,
    segments: number,
    speed: number,
    opacity: number,
  ): void {
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity, fog: false });
    const holder = new THREE.Group();
    holder.rotation.x = Math.PI / 2;
    holder.position.y = y;
    const arc = segments === 1 ? Math.PI * 2 : (Math.PI * 2 * 0.62) / segments;
    for (let i = 0; i < segments; i++) {
      const geo = new THREE.TorusGeometry(radius, tube, 8, Math.max(24, Math.round(96 * (arc / (Math.PI * 2)))), arc);
      const seg = new THREE.Mesh(geo, mat);
      seg.rotation.z = (i / segments) * Math.PI * 2;
      seg.layers.enable(LAYER_BLOOM);
      holder.add(seg);
      this.disposables.push(geo);
    }
    this.disposables.push(mat);
    this.group.add(holder);
    this.rings.push({ mesh: holder, material: mat, speed, baseOpacity: opacity });
  }

  /**
   * Two unlit, unfogged rings of flat graveyard silhouettes (hills, headstones, crosses,
   * crooked trees, fences, a crypt and a chapel with lit windows). The foot of each ring
   * is the fog colour so it meets the fogged floor without a line; the continuous hill
   * band also hides the floor/sky horizon. One draw call.
   */
  private buildHorizon(): void {
    const fog = new THREE.Color(FOG_COLOR);
    const mistNear = new THREE.Color(0x1d3a3c);
    const darkNear = new THREE.Color(0x07060f);
    const mistFar = new THREE.Color(0x1f2a40);
    const darkFar = new THREE.Color(0x0f0c20);
    const ramp = (y: number, out: THREE.Color, m: THREE.Color, dk: THREE.Color, y1: number, y2: number): void => {
      if (y <= 0) out.copy(fog);
      else if (y < y1) out.copy(fog).lerp(m, y / y1);
      else if (y < y2) out.copy(m).lerp(dk, (y - y1) / (y2 - y1));
      else out.copy(dk);
    };
    const near = new SilhouetteRing(HORIZON_NEAR_RADIUS, (y, out) => ramp(y, out, mistNear, darkNear, 1.1, 3.4));
    const far = new SilhouetteRing(HORIZON_FAR_RADIUS, (y, out) => ramp(y, out, mistFar, darkFar, 2.5, 8.0));
    const rng = seededRandom(1313);
    const lit = new THREE.Color(0.18, 0.62, 0.3);

    // Rolling hill bands (bottom below the floor so no gap shows).
    const band = (ring: SilhouetteRing, radius: number, base: number, amp: number, step: number, freq: number): ((x: number) => number) => {
      const len = Math.PI * 2 * radius;
      const ph = rng() * 10;
      const height = (x: number): number => {
        const a = (x / len) * Math.PI * 2;
        return base + amp * (0.5 + 0.3 * Math.sin(a * freq + ph) + 0.2 * Math.sin(a * freq * 2.7 + ph * 1.7));
      };
      const n = Math.ceil(len / step);
      for (let i = 0; i < n; i++) {
        const x0 = (i / n) * len;
        const x1 = ((i + 1) / n) * len;
        const h0 = height(x0);
        const h1 = height(x1);
        ring.quad(x0, -3, x1, -3, x1, 0, x0, 0);
        ring.quad(x0, 0, x1, 0, x1, h1, x0, h0);
      }
      return height;
    };
    const nearH = band(near, HORIZON_NEAR_RADIUS, 3.0, 1.8, 3, 5);
    const farH = band(far, HORIZON_FAR_RADIUS, 5.5, 7.0, 6, 3);

    const rot = (px: number, py: number, bx: number, by: number, tilt: number): number[] => {
      const s = Math.sin(tilt);
      const c = Math.cos(tilt);
      return [bx + px * c - py * s, by + px * s + py * c];
    };
    const tomb = (ring: SilhouetteRing, bx: number, by: number, w: number, h: number, tilt: number): void => {
      const pts: number[][] = [rot(-w / 2, -0.6, bx, by, tilt), rot(w / 2, -0.6, bx, by, tilt)];
      const top = h - w / 2;
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI;
        pts.push(rot(Math.cos(a) * (w / 2), top + Math.sin(a) * (w / 2), bx, by, tilt));
      }
      ring.poly(pts);
    };
    const cross = (ring: SilhouetteRing, bx: number, by: number, h: number, t: number, tilt: number): void => {
      const v = [rot(-t / 2, -0.6, bx, by, tilt), rot(t / 2, -0.6, bx, by, tilt), rot(t / 2, h, bx, by, tilt), rot(-t / 2, h, bx, by, tilt)];
      ring.poly(v);
      const arm = h * 0.36;
      const ay = h * 0.7;
      const hbar = [rot(-arm, ay - t / 2, bx, by, tilt), rot(arm, ay - t / 2, bx, by, tilt), rot(arm, ay + t / 2, bx, by, tilt), rot(-arm, ay + t / 2, bx, by, tilt)];
      ring.poly(hbar);
    };
    const branch = (ring: SilhouetteRing, x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
      const segs = 3;
      let px = x;
      let py = y;
      let a = ang;
      let pw = w;
      for (let s = 0; s < segs; s++) {
        a += (rng() - 0.5) * 0.5;
        const l = len / segs;
        const nx = px + Math.sin(a) * l;
        const ny = py + Math.cos(a) * l;
        const nw = pw * 0.72;
        const ox = Math.cos(a);
        const oy = -Math.sin(a);
        ring.quad(px - ox * pw, py - oy * pw, px + ox * pw, py + oy * pw, nx + ox * nw, ny + oy * nw, nx - ox * nw, ny - oy * nw);
        if (depth > 0 && s >= 1) {
          const side = rng() < 0.5 ? -1 : 1;
          branch(ring, nx, ny, a + side * (0.6 + rng() * 0.5), len * (0.45 + rng() * 0.2), nw * 0.8, depth - 1);
        }
        px = nx;
        py = ny;
        pw = nw;
      }
      if (depth > 0) branch(ring, px, py, a + (rng() < 0.5 ? -0.7 : 0.7), len * 0.4, pw, depth - 1);
    };
    const tree = (ring: SilhouetteRing, bx: number, by: number, h: number): void => {
      branch(ring, bx, by - 0.5, (rng() - 0.5) * 0.3, h, h * 0.045, 2);
    };
    const fence = (ring: SilhouetteRing, x0: number, x1: number, heightAt: (x: number) => number): void => {
      for (let x = x0; x < x1; x += 0.95) {
        const by = heightAt(x) - 0.3;
        ring.quad(x - 0.08, by, x + 0.08, by, x + 0.08, by + 2.1, x - 0.08, by + 2.1);
        ring.tri(x - 0.16, by + 2.1, x + 0.16, by + 2.1, x, by + 2.55);
      }
      for (const ry of [0.7, 1.7]) {
        const ya = heightAt(x0) - 0.3 + ry;
        const yb = heightAt(x1) - 0.3 + ry;
        ring.quad(x0, ya - 0.07, x1, yb - 0.07, x1, yb + 0.07, x0, ya + 0.07);
      }
    };
    const crypt = (ring: SilhouetteRing, bx: number, by: number): void => {
      ring.quad(bx - 4.2, by - 0.6, bx + 4.2, by - 0.6, bx + 4.2, by + 0.6, bx - 4.2, by + 0.6);
      ring.quad(bx - 3.4, by + 0.5, bx + 3.4, by + 0.5, bx + 3.4, by + 5.6, bx - 3.4, by + 5.6);
      ring.tri(bx - 4.0, by + 5.5, bx + 4.0, by + 5.5, bx, by + 8.0);
      cross(ring, bx, by + 7.6, 2.2, 0.35, 0);
      ring.flatQuad(bx - 0.8, by + 0.6, bx + 0.8, by + 3.4, lit);
    };
    const chapel = (ring: SilhouetteRing, bx: number, by: number): void => {
      ring.quad(bx - 5, by - 1, bx + 5, by - 1, bx + 5, by + 8, bx - 5, by + 8);
      ring.tri(bx - 5.8, by + 7.8, bx + 5.8, by + 7.8, bx, by + 12.5);
      ring.quad(bx + 1.8, by + 6, bx + 5.2, by + 6, bx + 5.2, by + 17, bx + 1.8, by + 17);
      ring.tri(bx + 1.4, by + 16.8, bx + 5.6, by + 16.8, bx + 3.5, by + 25);
      cross(ring, bx + 3.5, by + 24.6, 3.2, 0.45, 0);
      ring.flatQuad(bx - 3.2, by + 3, bx - 1.6, by + 6, lit);
      ring.flatQuad(bx - 0.6, by + 3, bx + 1.0, by + 6, lit);
      ring.flatQuad(bx + 2.9, by + 11, bx + 4.1, by + 13.2, lit);
    };

    // Near ring: a cemetery all the way round.
    const nearLen = Math.PI * 2 * HORIZON_NEAR_RADIUS;
    let x = 0;
    let slot = 0;
    while (x < nearLen - 8) {
      const kind = slot % 7;
      const by = nearH(x);
      if (kind === 2) {
        tree(near, x, by, 8 + rng() * 5);
        x += 9 + rng() * 6;
      } else if (kind === 5) {
        const run = 10 + rng() * 8;
        fence(near, x, Math.min(x + run, nearLen - 2), nearH);
        x += run + 3;
      } else {
        const count = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < count; i++) {
          const gx = x + i * (2.6 + rng() * 1.6);
          const gy = nearH(gx);
          const tilt = (rng() - 0.5) * 0.3;
          if (rng() < 0.3) cross(near, gx, gy, 3.4 + rng() * 1.6, 0.42, tilt);
          else tomb(near, gx, gy, 1.5 + rng() * 0.9, 2.3 + rng() * 1.2, tilt);
        }
        x += count * 3.4 + 3 + rng() * 5;
      }
      slot++;
    }
    crypt(near, nearLen * 0.18, nearH(nearLen * 0.18));
    crypt(near, nearLen * 0.63, nearH(nearLen * 0.63));

    // Far ring: taller hills, sparse big trees and one chapel.
    const farLen = Math.PI * 2 * HORIZON_FAR_RADIUS;
    for (let i = 0; i < 16; i++) {
      const fx = ((i + rng() * 0.6) / 16) * farLen;
      tree(far, fx, farH(fx), 12 + rng() * 8);
    }
    chapel(far, farLen * 0.41, farH(farLen * 0.41));

    const positions = [...near.positions, ...far.positions];
    const colors = [...near.colors, ...far.colors];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'graveyardHorizon';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  /** A loose ring of tilted headstones and crosses in the fog around the podium. One draw call. */
  private buildGraves(): void {
    const rng = seededRandom(4242);
    const parts: THREE.BufferGeometry[] = [];
    const stone = new THREE.Color();
    const moss = new THREE.Color(0x3d6a46);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const count = 24;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.18;
      const r = 14 + rng() * 18;
      stone.setHSL(0.7 + rng() * 0.05, 0.1 + rng() * 0.06, 0.16 + rng() * 0.05);
      const pieces: THREE.BufferGeometry[] = [];
      const kind = rng();
      const scale = 0.9 + rng() * 0.5;
      if (kind < 0.55) {
        const w = 0.8;
        const h = 0.75;
        pieces.push(paint(new THREE.BoxGeometry(w, h, 0.2).translate(0, h / 2 - 0.1, 0), stone));
        pieces.push(paint(new THREE.CylinderGeometry(w / 2, w / 2, 0.2, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, h - 0.1, 0), stone));
      } else if (kind < 0.85) {
        pieces.push(paint(new THREE.BoxGeometry(0.16, 1.35, 0.16).translate(0, 0.55, 0), stone));
        pieces.push(paint(new THREE.BoxGeometry(0.72, 0.16, 0.16).translate(0, 0.85, 0), stone));
      } else {
        pieces.push(paint(new THREE.BoxGeometry(0.7, 0.95, 0.22).translate(0, 0.37, 0), stone));
        pieces.push(paint(new THREE.ConeGeometry(0.5, 0.35, 4).rotateY(Math.PI / 4).scale(1, 1, 0.44).translate(0, 0.99, 0), stone));
      }
      pieces.push(paint(new THREE.SphereGeometry(0.34, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, 0.35, 0.9).translate(0, -0.02, 0.1), moss));
      p.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      e.set((rng() - 0.5) * 0.3, a + Math.PI + (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.3);
      q.setFromEuler(e);
      s.setScalar(scale);
      m.compose(p, q, s);
      for (const g of pieces) parts.push(forMerge(g).applyMatrix4(m));
    }
    const geo = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!geo) return;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'graves';
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  /** Cartoon zombie hands poking out of dirt mounds, beyond the camera orbit. */
  private buildHands(): void {
    const geo = buildHandGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    this.disposables.push(geo, mat);
    const far = START_ANGLE + Math.PI;
    const spots = [
      { az: far + 0.42, r: 7.4, scale: 1.15, phase: 0 },
      { az: far + 0.62, r: 8.2, scale: 0.95, phase: 1.7 },
      { az: far - 2.3, r: 7.6, scale: 1.1, phase: 3.1 },
    ];
    for (const sp of spots) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.sin(sp.az) * sp.r, 0, Math.cos(sp.az) * sp.r);
      mesh.scale.setScalar(sp.scale);
      mesh.name = 'zombieHand';
      const baseYaw = sp.az + Math.PI;
      mesh.rotation.y = baseYaw;
      this.group.add(mesh);
      this.hands.push({ mesh, phase: sp.phase, baseYaw });
    }
  }

  /** Three stacked horizontal sheets of drifting green mist around the podium. One draw call. */
  private buildMist(): THREE.ShaderMaterial {
    const layers = [0.06, 0.28, 0.55];
    const parts: THREE.BufferGeometry[] = [];
    layers.forEach((y, i) => {
      const g = new THREE.RingGeometry(2.6, 46, 72, 6).rotateX(-Math.PI / 2).translate(0, y, 0);
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      const n = g.getAttribute('position').count;
      g.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(n).fill(i), 1));
      parts.push(g);
    });
    const geo = mergeGeometries(parts, false) ?? parts[0];
    for (const g of parts) if (g !== geo) g.dispose();
    const mat = new THREE.ShaderMaterial({
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x46c984) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'groundMist';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
    return mat;
  }

  private readonly onContextRestored = (): void => {
    // The PMREM target's pixels died with the old context: bake it again.
    const renderer = this.renderer;
    if (!renderer) return;
    const old = this.envTexture;
    this.releaseEnvironment(false);
    this.buildEnvironment(renderer);
    if (this.scene && this.scene.environment === old) this.scene.environment = this.envTexture;
  };

  private stopWatchingContext(): void {
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
  }

  /** Drop the environment map; GPU objects are freed only if they still belong to a live context. */
  private releaseEnvironment(freeGpu: boolean): void {
    if (freeGpu) this.envTarget?.dispose();
    this.envTarget = null;
    this.envTexture = null;
  }

  /** Small PMREM environment (gradient sky + two soft light cards) for glossy reflections. */
  private buildEnvironment(renderer: THREE.WebGLRenderer): void {
    let pmrem: THREE.PMREMGenerator | null = null;
    try {
      pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const skyMat = this.skyMaterial.clone();
      skyMat.uniforms.uTime = { value: 0 };
      skyMat.uniforms.uMoon = { value: 0 };
      const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat);
      envScene.add(sky);
      const cardMat = (c: number) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, fog: false });
      const cardGeo = new THREE.PlaneGeometry(12, 5);
      const cardA = new THREE.Mesh(cardGeo, cardMat(0x9ad8ff));
      cardA.position.set(-6, 9, 4);
      cardA.lookAt(0, 0, 0);
      const cardB = new THREE.Mesh(cardGeo, cardMat(0xff8fd8));
      cardB.position.set(7, 7, -3);
      cardB.lookAt(0, 0, 0);
      const cardC = new THREE.Mesh(cardGeo, cardMat(0xffffff));
      cardC.position.set(0, 12, 0);
      cardC.lookAt(0, 0, 0);
      envScene.add(cardA, cardB, cardC);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 24), new THREE.MeshBasicMaterial({ color: 0x08071a, fog: false }));
      floor.rotation.x = -Math.PI / 2;
      envScene.add(floor);
      const rt = pmrem.fromScene(envScene, 0.04, 0.5, 300);
      this.envTarget = rt;
      this.envTexture = rt.texture;
      sky.geometry.dispose();
      skyMat.dispose();
      cardGeo.dispose();
      (cardA.material as THREE.Material).dispose();
      (cardB.material as THREE.Material).dispose();
      (cardC.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
    } catch (err) {
      console.warn('[MenuBackdrop] environment map failed', err);
      this.envTarget = null;
      this.envTexture = null;
    } finally {
      pmrem?.dispose();
    }
  }

  private makeGridTexture(): THREE.Texture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0b0a19';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(90, 100, 220, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(size, 1);
      ctx.moveTo(1, 0);
      ctx.lineTo(1, size);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(70, 70);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}

/** Solid vertex colour for a primitive. */
function paint(geo: THREE.BufferGeometry, col: THREE.Color): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Non-indexed position/normal/color only, so different primitives merge. */
function forMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/**
 * Friendly cartoon zombie hand: green forearm in a torn purple sleeve, a bandage, a
 * plaster and a stitched seam, waving from a dirt mound. Base at y = 0, palm faces +Z.
 */
function buildHandGeometry(): THREE.BufferGeometry {
  const skin = new THREE.Color(0x8cc466);
  const skinDark = new THREE.Color(0x6fa653);
  const sleeve = new THREE.Color(0x5b4a93);
  const bandage = new THREE.Color(0xeae3c9);
  const plaster = new THREE.Color(0xf2c79c);
  const stitch = new THREE.Color(0x27242e);
  const dirt = new THREE.Color(0x3d2c28);
  const dirtLight = new THREE.Color(0x54403a);
  const rng = seededRandom(77);
  const parts: THREE.BufferGeometry[] = [];

  // Dirt mound with a few clods.
  parts.push(paint(new THREE.SphereGeometry(0.48, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.36, 1), dirt));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    parts.push(paint(new THREE.IcosahedronGeometry(0.07 + rng() * 0.05, 0).translate(Math.cos(a) * 0.5, 0.03, Math.sin(a) * 0.5), dirtLight));
  }

  // Torn sleeve: ragged top edge.
  const sl = new THREE.CylinderGeometry(0.175, 0.2, 0.34, 12, 1, false);
  const sp = sl.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    if (sp.getY(i) > 0.1) sp.setY(i, sp.getY(i) + (i % 2 === 0 ? 0.06 : -0.03));
  }
  sl.computeVertexNormals();
  parts.push(paint(sl.translate(0, 0.25, 0), sleeve));

  // Forearm, bandage wraps, plaster and stitches.
  parts.push(paint(new THREE.CylinderGeometry(0.105, 0.125, 0.62, 12).translate(0, 0.66, 0), skin));
  parts.push(paint(new THREE.TorusGeometry(0.118, 0.028, 6, 16).rotateX(Math.PI / 2).translate(0, 0.62, 0), bandage));
  parts.push(paint(new THREE.TorusGeometry(0.114, 0.026, 6, 16).rotateX(Math.PI / 2 + 0.25).translate(0, 0.7, 0), bandage));
  parts.push(paint(new THREE.BoxGeometry(0.15, 0.05, 0.02).rotateZ(0.6).translate(0.02, 0.84, 0.11), plaster));
  parts.push(paint(new THREE.BoxGeometry(0.012, 0.2, 0.012).translate(-0.03, 0.47, 0.118), stitch));
  for (let i = 0; i < 4; i++) {
    parts.push(paint(new THREE.BoxGeometry(0.06, 0.012, 0.012).translate(-0.03, 0.39 + i * 0.052, 0.118), stitch));
  }

  // Palm, fingers (different lengths, a little crooked) and thumb.
  parts.push(paint(new THREE.SphereGeometry(0.16, 14, 10).scale(1.0, 1.08, 0.58).translate(0, 1.05, 0), skin));
  const fingers = [
    { x: -0.105, len: 0.13, tilt: 0.28 },
    { x: -0.036, len: 0.17, tilt: 0.08 },
    { x: 0.036, len: 0.16, tilt: -0.06 },
    { x: 0.1, len: 0.12, tilt: -0.3 },
  ];
  for (const f of fingers) {
    const g = new THREE.CapsuleGeometry(0.036, f.len, 4, 8)
      .translate(0, f.len / 2 + 0.03, 0)
      .rotateX(0.18 + rng() * 0.2)
      .rotateZ(f.tilt)
      .translate(f.x, 1.17, 0);
    parts.push(paint(g, skin));
  }
  parts.push(paint(new THREE.CapsuleGeometry(0.038, 0.1, 4, 8).translate(0, 0.08, 0).rotateZ(-1.0).translate(0.13, 0.98, 0.02), skinDark));

  const prepared = parts.map(forMerge);
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  return merged ?? new THREE.BufferGeometry();
}
