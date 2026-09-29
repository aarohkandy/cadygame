// src/game/render/vfx/bursts.ts (WP6)
// Burst shapes (GAME_DESIGN 6.8), one instanced pool and one draw, additive HDR for the night arena:
//   flash       the contact flash: a white-hot disc with a soft halo (85 ms)
//   star        a 4-point lens flare over heavy contacts and the KO
//   glow        a soft radial bloom that lingers under a big hit (the air lighting up)
//   chevron     the deflect 6-chevron ring
//   clash_ring  a thin bright ring in the air (attacker colour on heavy hits)
//   puff        contact dust (dim, stays under the bloom threshold)
//   shockwave   a camera-facing ring (locks, de-rez)
//   deck_ring   a shockwave lying FLAT on the deck, racing outward from under the impact
// Growth, fade and drift are evaluated on the GPU from spawn attributes; the deck ring skips the billboard
// and lays its quad in the sim XY plane.
import {
  AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial,
} from "three";
import {
  type Prewarmable, TOKEN_HEX } from "../../contracts.ts";
import { CALIBRATION } from "../quality.ts";
import { GLSL_BILLBOARD, RENDER_SCALE_UNIFORM, createRingPool, writeColor, type RingPool } from "./sparks.ts";

export const BURST_POOL = 96;

export type BurstKind = "flash" | "chevron" | "clash_ring" | "puff" | "shockwave" | "deck_ring" | "glow" | "star";
const KIND_INDEX: Record<BurstKind, number> = { flash: 0, chevron: 1, clash_ring: 2, puff: 3, shockwave: 4, deck_ring: 5, glow: 6, star: 7 };

/**
 * The two kinds a strike puts at the contact point in neutral white. Measured with every contact pool's
 * clock pinned at age 50 ms (`~/tl-tools/ver-freeze.mjs`): hiding this pool alone took the frame from
 * 10 220 colourless pixels at or above 0.95 to **zero** — the sparks and the arcs only clipped where they
 * landed on top of this disc, which at 12 and 9 in `#FFFFFF` was saturated before anything was added to it.
 * So these are multiples of `CALIBRATION.emissive.spark`, the authored knob for how hot a contact is, in
 * the same filament white `sparks.ts` uses, rather than literals nothing could turn down: 12 → 9 and
 * 9 → 6.75. Still well over the 0.98 bloom threshold, so the flash still flares; it no longer clips to grey.
 */
const FILAMENT = "#FFEAC8";
const HOT = CALIBRATION.emissive.spark;

/** Default life (s), start and end size (sim m, full width), colour, HDR intensity per kind. */
export const BURST_SPEC: Readonly<Record<BurstKind, { life: number; size0: number; size1: number; hex: string; intensity: number }>> = {
  // The contact flash sells a landed strike at cockpit range: a hard 85 ms pop, 7 cm across, plus halo.
  flash: { life: 0.085, size0: 0.035, size1: 0.08, hex: FILAMENT, intensity: HOT * 1.5 },
  star: { life: 0.16, size0: 0.06, size1: 0.2, hex: FILAMENT, intensity: HOT * 1.125 },
  glow: { life: 0.28, size0: 0.06, size1: 0.12, hex: TOKEN_HEX.signal, intensity: 1.6 },
  chevron: { life: 0.3, size0: 0.02, size1: 0.12, hex: TOKEN_HEX.block, intensity: 8 },
  clash_ring: { life: 0.25, size0: 0.01, size1: 0.11, hex: "#FFFFFF", intensity: 8 },
  puff: { life: 0.22, size0: 0.008, size1: 0.028, hex: "#6E7688", intensity: 0.5 },
  shockwave: { life: 0.36, size0: 0.03, size1: 0.24, hex: TOKEN_HEX.volt, intensity: 5 },
  deck_ring: { life: 0.42, size0: 0.02, size1: 0.3, hex: "#FFFFFF", intensity: 5 },
};

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aTime;   // birth, life, kind, rotation
attribute vec4 aSize;   // size0, size1, driftUp (m/s), alpha
attribute vec3 aColor;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vK;
varying float vKind;
varying float vAlpha;
${GLSL_BILLBOARD}
void main() {
  float age = uTime - aTime.x;
  if (age < 0.0 || age > aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  float k = age / aTime.y;
  float grow = 1.0 - pow(1.0 - k, 3.0);
  float size = mix(aSize.x, aSize.y, grow);
  vec3 c = aPos + vec3(0.0, 0.0, aSize.z * age);
  if (aTime.z > 4.5 && aTime.z < 5.5) {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(c + vec3(position.xy * size, 0.0), 1.0);
  } else {
    gl_Position = tlBillboard(c, position.xy, size, aTime.w);
  }
  vUv = position.xy + 0.5;
  vColor = aColor;
  vK = k;
  vKind = aTime.z;
  vAlpha = aSize.w;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vK;
varying float vKind;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.0) discard;
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  vec3 col = vColor;
  float a = 0.0;
  int kind = int(vKind + 0.5);
  if (kind == 0) {
    float disc = 1.0 - smoothstep(0.3, 0.5, r);
    float halo = pow(max(0.0, 1.0 - r), 3.0) * 0.6;
    a = (disc + halo) * (1.0 - vK * vK);
  } else if (kind == 7) {
    float ang = atan(p.y, p.x);
    float rays = pow(abs(cos(ang * 2.0)), 40.0) + 0.5 * pow(abs(sin(ang * 2.0)), 60.0);
    float core = pow(max(0.0, 1.0 - r * 3.0), 2.0);
    a = (rays * pow(max(0.0, 1.0 - r), 2.0) + core) * (1.0 - vK);
  } else if (kind == 6) {
    a = pow(max(0.0, 1.0 - r), 2.2) * (1.0 - vK) * (1.0 - vK);
  } else if (kind == 1) {
    float ang = atan(p.y, p.x);
    float sector = mod(ang + 3.14159265 / 6.0, 3.14159265 / 3.0) - 3.14159265 / 6.0;
    float chev = abs(r - 0.7 + abs(sector) * 0.55);
    float core = 1.0 - smoothstep(0.03, 0.07, chev);
    float glow = (1.0 - smoothstep(0.07, 0.22, chev)) * 0.35;
    float gap = step(abs(sector), 0.42);
    a = (core + glow) * gap * (1.0 - smoothstep(0.6, 1.0, vK));
  } else if (kind == 2 || kind == 4 || kind == 5) {
    float w = kind == 2 ? 0.045 : 0.07;
    float ring = abs(r - 0.85);
    float core = 1.0 - smoothstep(w * 0.3, w, ring);
    float glow = (1.0 - smoothstep(w, w * 4.0, ring)) * 0.3;
    // The deck ring leaves a faint filled wake inside it.
    float wake = kind == 5 ? smoothstep(0.3, 0.85, r) * (1.0 - step(0.85, r)) * 0.06 : 0.0;
    a = (core + glow + wake) * (1.0 - smoothstep(0.35, 1.0, vK));
  } else {
    float blob = 1.0 - smoothstep(0.2, 1.0, r);
    a = blob * 0.5 * (1.0 - vK);
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface BurstPool extends Prewarmable {
  readonly mesh: Mesh;
  readonly pool: RingPool;
  spawn(nowS: number, kind: BurstKind, x: number, y: number, z: number, opts?: { hex?: string; scale?: number; rotation?: number; driftUp?: number; lifeScale?: number; intensity?: number }): void;
  update(nowS: number): void;
  clear(): void;
  dispose(): void;
}

export function createBurstPool(capacity = BURST_POOL): BurstPool {
  const base = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  const aPos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aTime = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-10), 4);
  const aSize = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const aColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  for (const a of [aPos, aTime, aSize, aColor]) { a.setUsage(DynamicDrawUsage); }
  geometry.setAttribute("aPos", aPos);
  geometry.setAttribute("aTime", aTime);
  geometry.setAttribute("aSize", aSize);
  geometry.setAttribute("aColor", aColor);
  geometry.instanceCount = capacity;
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uRenderScale: RENDER_SCALE_UNIFORM },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.name = "bursts";
  const pool = createRingPool(capacity);
  let dirty = false;
  let epoch = 0;
  const self: BurstPool = {
    mesh, pool,
    spawn(nowS, kind, x, y, z, opts) {
      const spec = BURST_SPEC[kind];
      const life = spec.life * (opts?.lifeScale ?? 1);
      const i = pool.alloc(nowS, life);
      const s = opts?.scale ?? 1;
      aPos.array[i * 3] = x; aPos.array[i * 3 + 1] = y; aPos.array[i * 3 + 2] = z;
      aTime.array[i * 4] = nowS - epoch; aTime.array[i * 4 + 1] = life;
      aTime.array[i * 4 + 2] = KIND_INDEX[kind]; aTime.array[i * 4 + 3] = opts?.rotation ?? 0;
      aSize.array[i * 4] = spec.size0 * s; aSize.array[i * 4 + 1] = spec.size1 * s;
      aSize.array[i * 4 + 2] = opts?.driftUp ?? (kind === "puff" ? 0.05 : 0); aSize.array[i * 4 + 3] = 1;
      writeColor(aColor.array as Float32Array, i * 3, opts?.hex ?? spec.hex, opts?.intensity ?? spec.intensity);
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
        aPos.needsUpdate = true; aTime.needsUpdate = true; aSize.needsUpdate = true; aColor.needsUpdate = true;
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
    prewarmDraw() { self.spawn(0, "flash", 0, 0, 0.01, { scale: 0.02 }); self.update(0); },
  };
  return self;
}
