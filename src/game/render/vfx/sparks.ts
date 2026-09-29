// src/game/render/vfx/sparks.ts (WP5)
// Velocity-aligned spark streaks (GAME_DESIGN 6.8): strike sparks, graze ticks, deflect streaks, the clash
// fan, and low-integrity shoulder sparks all share one GPU-simulated pool. Each streak is an instanced
// quad whose ballistic path is evaluated in the vertex shader from its spawn attributes, so a frame costs
// one draw and zero JS per live particle. Additive HDR against the night arena: a filament-hot head that
// cools to orange down a long streak trail, bright enough that bloom catches every spark and nothing else.
// EMOTION_BIBLE 6: strike sparks land and stay. A streak that reaches the deck inside its air life stops there as a
// cooling ember for `restS` (10 s) instead of vanishing mid-air, so a heavy exchange leaves the deck peppered.
// Also home to the small runtime helpers every VFX module shares (seeded random, ring allocation, GLSL).
import {
  AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial,
} from "three";
import {
  type Prewarmable, RENDER_SCALE, TOKEN_HEX } from "../../contracts.ts";
import { CALIBRATION } from "../quality.ts";

/* ───────────────────────── shared helpers ───────────────────────── */

/** Small seeded generator (mulberry32) so effect variation is reproducible in debug scenes and tests. */
export function createVfxRandom(seed = 0x7a11_5eed): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ring allocator over a fixed pool: returns the next slot, recycling the oldest when every slot is live. */
export interface RingPool {
  readonly capacity: number;
  /** Allocations that had to recycle a live slot (tests: bounded, never grows the pool). */
  readonly recycled: number;
  alloc(nowS: number, lifeS: number): number;
  active(nowS: number): number;
  clear(): void;
}
export function createRingPool(capacity: number): RingPool {
  const until = new Float64Array(capacity).fill(-1);
  let head = 0;
  let recycled = 0;
  return {
    capacity,
    get recycled() { return recycled; },
    alloc(nowS, lifeS) {
      const slot = head;
      if (until[slot] > nowS) recycled++;
      until[slot] = nowS + lifeS;
      head = (head + 1) % capacity;
      return slot;
    },
    active(nowS) {
      let n = 0;
      for (let i = 0; i < capacity; i++) if (until[i] > nowS) n++;
      return n;
    },
    clear() { until.fill(-1); head = 0; },
  };
}

const colorCache = new Map<string, Color>();
/** Parsed linear colour for a hex token, cached so hot paths never re-parse strings. */
export function linearColor(hex: string): Color {
  let c = colorCache.get(hex);
  if (!c) { c = new Color(hex); colorCache.set(hex, c); }
  return c;
}

/** Linear colour × intensity written into a Float32Array slot. */
export function writeColor(out: Float32Array, o: number, hex: string, intensity: number): void {
  const c = linearColor(hex);
  out[o] = c.r * intensity; out[o + 1] = c.g * intensity; out[o + 2] = c.b * intensity;
}

/** Orthonormal tangent of a direction (for spreading cones around a contact normal). */
export function spreadDirection(nx: number, ny: number, nz: number, spread: number, rand: () => number, out: Float64Array): Float64Array {
  let tx = -ny, ty = nx, tz = 0;
  if (Math.abs(nz) > 0.9) { tx = 1; ty = 0; tz = 0; }
  let n = Math.hypot(tx, ty, tz) || 1; tx /= n; ty /= n; tz /= n;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const a = rand() * Math.PI * 2;
  const r = spread * Math.sqrt(rand());
  let dx = nx + (tx * Math.cos(a) + bx * Math.sin(a)) * r;
  let dy = ny + (ty * Math.cos(a) + by * Math.sin(a)) * r;
  let dz = nz + (tz * Math.cos(a) + bz * Math.sin(a)) * r;
  n = Math.hypot(dx, dy, dz) || 1; dx /= n; dy /= n; dz /= n;
  out[0] = dx; out[1] = dy; out[2] = dz;
  return out;
}

/** GLSL: expand a quad corner in view space around a sim-space centre (world root scale applied). */
export const GLSL_BILLBOARD = /* glsl */ `
uniform float uRenderScale;
vec4 tlBillboard(vec3 centerSim, vec2 corner, float sizeSim, float rot) {
  vec4 mv = modelViewMatrix * vec4(centerSim, 1.0);
  float c = cos(rot), s = sin(rot);
  vec2 r = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  mv.xy += r * sizeSim * uRenderScale;
  return projectionMatrix * mv;
}
`;

export const RENDER_SCALE_UNIFORM = { value: RENDER_SCALE };

/* ───────────────────────── streak pool ───────────────────────── */

export const SPARK_POOL = 512;
export const GRAVITY_SIM = 9.8;
/** How long a landed strike spark glows on the deck (EMOTION_BIBLE 6: still there 10 s later). */
export const SPARK_REST_S = 10;
const DECK_Z = 0.0015;
const NEVER_LANDS = 1e9;

/** Seconds until a spark launched from height z0 with vertical speed vz reaches the deck (Infinity when z0 < 0). */
export function landingTime(z0: number, vz: number): number {
  if (z0 < 0) return Infinity;
  return (vz + Math.sqrt(vz * vz + 2 * GRAVITY_SIM * z0)) / GRAVITY_SIM;
}

export type StreakKind = "hit" | "graze" | "deflect" | "team" | "ember";

/**
 * Struck-steel filament white (~2800 K), not paper white. A strike throws 6 + 30·m coincident streaks from
 * one point, and these are additively blended: at the contact frame twenty of them overlap, so whatever the
 * core colour is, the sum clips. With a neutral #FFFFFF core the clipped region is a colourless disc; with a
 * filament core only the very centre goes white and the ring around it stays incandescent, which is what a
 * shower of hot metal looks like. The trail still cools to signal orange through `hot`.
 */
const FILAMENT = "#FFEAC8";

/**
 * `hot` streaks cool from filament white to signal orange along the trail; the rest keep their colour.
 *
 * `gain` is a multiple of `CALIBRATION.emissive.spark`, which is the single authored knob for how hot a
 * spark is (quality.ts). It was written down and then never read — every intensity here was its own literal,
 * so lowering the calibrated number moved nothing and the director's frame blew out at the contact point.
 */
const KIND_CORE: Record<StreakKind, { hex: string; gain: number; width: number; lenScale: number; hot: number }> = {
  hit: { hex: FILAMENT, gain: 1.125, width: 0.0019, lenScale: 1.6, hot: 1 },
  graze: { hex: FILAMENT, gain: 0.5, width: 0.0012, lenScale: 0.9, hot: 1 },
  deflect: { hex: TOKEN_HEX.block, gain: 1, width: 0.0017, lenScale: 1.5, hot: 0 },
  team: { hex: FILAMENT, gain: 0.75, width: 0.0014, lenScale: 1.1, hot: 0.5 },
  ember: { hex: TOKEN_HEX.strike, gain: 0.875, width: 0.0013, lenScale: 1.0, hot: 1 },
};

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aTime;      // birth, life, width, stretch
attribute vec4 aCore;      // linear HDR core colour, hot (cools to orange)
attribute vec2 aLand;      // landing time (s after birth; 1e9 = never), rest on the deck (s)
uniform float uTime;
uniform float uGravity;
varying vec2 vUv;
varying vec3 vCore;
varying vec2 vHot;
varying float vFade;
varying float vRest;       // 0 in flight; 0..1 age through the rest on the deck
void main() {
  float age = uTime - aTime.x;
  float life = aTime.y;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; vRest = 0.0; return; }
  vec3 g = vec3(0.0, 0.0, -uGravity);
  float landed = step(aLand.x, age);
  float ta = min(age, aLand.x);
  vec3 head = aPos + aVel * ta + 0.5 * g * ta * ta;
  vec3 vel = aVel + g * ta;
  float airLife = min(life, aLand.x);
  float k = landed > 0.5 ? 0.0 : age / airLife;
  vRest = landed * clamp((age - aLand.x) / max(aLand.y, 1e-3), 0.0, 1.0);
  head.z = mix(head.z, ${DECK_Z.toFixed(4)}, landed);
  float len = mix(length(vel) * aTime.w * (1.0 - 0.6 * k), aTime.z * 1.5, landed);
  vec3 tail = head - mix(normalize(vel + vec3(1e-6)), vec3(0.0, 0.0, -1.0), landed) * len;
  vec4 hv = modelViewMatrix * vec4(head, 1.0);
  vec4 tv = modelViewMatrix * vec4(tail, 1.0);
  vec2 dir = hv.xy - tv.xy;
  float dl = length(dir);
  dir = dl > 1e-6 ? dir / dl : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  vec4 p = mix(tv, hv, position.y + 0.5);
  p.xy += side * position.x * aTime.z * 2.0 * ${RENDER_SCALE.toFixed(2)} * (1.0 - 0.5 * k) * mix(1.0, 0.8, landed);
  gl_Position = projectionMatrix * p;
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vCore = aCore.rgb;
  vHot = vec2(aCore.w, k);
  vFade = mix(1.0 - smoothstep(0.55, 1.0, k), 1.0 - smoothstep(0.7, 1.0, vRest), landed);
}
`;
const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCore;
varying vec2 vHot;
varying float vFade;
varying float vRest;
void main() {
  if (vFade <= 0.0) discard;
  float x = abs(vUv.x - 0.5) * 2.0;
  // vUv.y: 0 tail → 1 head. The head is filament-hot; the trail cools to orange and thins out.
  float core = 1.0 - smoothstep(0.0, 0.45, x);
  // The additive skirt is what sets how wide the clipped region gets when a shower overlaps: the old linear
  // falloff still carried half its gain at the quad's mid-width, so twenty coincident streaks summed to a
  // flat white patch far wider than any of them. Cubed, the halo hugs the core and the overlap reads as a
  // cluster of hot points instead of one blob.
  float glow = pow(1.0 - x, 3.0) * 0.30;
  float trail = smoothstep(0.0, 0.7, vUv.y);
  float heat = mix(0.25, 1.0, vUv.y * vUv.y);
  vec3 warm = vCore * vec3(1.0, 0.36, 0.08);
  vec3 col = mix(vCore, warm, vHot.x * clamp(vHot.y + (1.0 - vUv.y) * 0.8, 0.0, 1.0));
  // On the deck: a round ember, orange cooling to a dull red and dimming through the rest.
  if (vRest > 0.0) {
    float r = length(vUv - 0.5) * 2.0;
    float dot = 1.0 - smoothstep(0.3, 1.0, r);
    vec3 ember = warm * mix(0.35, 0.03, vRest);
    gl_FragColor = vec4(ember, dot * vFade * 0.9);
    if (gl_FragColor.a < 0.004) discard;
    return;
  }
  float a = (core + glow) * trail * heat * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface StreakPool extends Prewarmable {
  readonly mesh: Mesh;
  readonly pool: RingPool;
  /**
   * Spawns one streak at sim position with sim velocity (m/s); life in seconds of VFX time. With `restS` a streak
   * that reaches the deck inside its life lands there and glows for `restS` more seconds.
   */
  spawn(nowS: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, lifeS: number, kind: StreakKind, sizeScale?: number, restS?: number): void;
  /** Uploads this frame's spawns and advances the shader clock. */
  update(nowS: number): void;
  clear(): void;
  dispose(): void;
}

export function createStreakPool(capacity = SPARK_POOL, name = "sparks"): StreakPool {
  const base = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  const aPos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aVel = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aTime = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-10), 4);
  const aCore = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const aLand = new InstancedBufferAttribute(new Float32Array(capacity * 2).fill(NEVER_LANDS), 2);
  for (const a of [aPos, aVel, aTime, aCore, aLand]) a.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aPos", aPos);
  geometry.setAttribute("aVel", aVel);
  geometry.setAttribute("aTime", aTime);
  geometry.setAttribute("aCore", aCore);
  geometry.setAttribute("aLand", aLand);
  geometry.instanceCount = capacity;
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uGravity: { value: GRAVITY_SIM } },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = name;
  const pool = createRingPool(capacity);
  let dirty = false;
  // Time values are stored relative to an epoch that is re-based before float32 precision matters.
  let epoch = 0;
  const self: StreakPool = {
    mesh, pool,
    spawn(nowS, x, y, z, vx, vy, vz, lifeS, kind, sizeScale = 1, restS = 0) {
      const tLand = restS > 0 ? landingTime(z, vz) : Infinity;
      const lands = tLand < lifeS;
      const i = pool.alloc(nowS, lands ? tLand + restS : lifeS);
      const k = KIND_CORE[kind];
      aPos.array[i * 3] = x; aPos.array[i * 3 + 1] = y; aPos.array[i * 3 + 2] = z;
      aVel.array[i * 3] = vx; aVel.array[i * 3 + 1] = vy; aVel.array[i * 3 + 2] = vz;
      aTime.array[i * 4] = nowS - epoch; aTime.array[i * 4 + 1] = lands ? tLand + restS : lifeS;
      aLand.array[i * 2] = lands ? tLand : NEVER_LANDS; aLand.array[i * 2 + 1] = lands ? restS : 0;
      aTime.array[i * 4 + 2] = k.width * sizeScale; aTime.array[i * 4 + 3] = 0.018 * k.lenScale * sizeScale;
      writeColor(aCore.array as Float32Array, i * 4, k.hex, k.gain * CALIBRATION.emissive.spark);
      aCore.array[i * 4 + 3] = k.hot;
      dirty = true;
    },
    update(nowS) {
      // A pool with nothing in it must not cost a draw call: the dead instances are parked at a zero
      // scale, but the InstancedMesh still issues drawElementsInstanced for the whole capacity.
      mesh.visible = pool.active(nowS) > 0;
      if (nowS - epoch > 600 && pool.active(nowS) === 0) {
        epoch = nowS;
        (aTime.array as Float32Array).fill(-10);
        dirty = true;
      }
      material.uniforms.uTime.value = nowS - epoch;
      if (dirty) {
        aPos.needsUpdate = true; aVel.needsUpdate = true; aTime.needsUpdate = true; aCore.needsUpdate = true; aLand.needsUpdate = true;
        dirty = false;
      }
    },
    clear() {
      pool.clear();
      (aTime.array as Float32Array).fill(-10);
      aTime.needsUpdate = true;
    },
    dispose() { geometry.dispose(); base.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.spawn(0, 0, 0, 0.01, 0, 0, 0.01, 0.05, "hit", 0.1); self.update(0); },
  };
  return self;
}

/** Strike spark count (6.8): 6 + 30·m, ×1.6 on a crit. */
export function sparkCount(magnitude: number, crit: boolean): number {
  const m = Math.max(0, Math.min(1, magnitude));
  return Math.round((6 + 30 * m) * (crit ? 1.6 : 1));
}
