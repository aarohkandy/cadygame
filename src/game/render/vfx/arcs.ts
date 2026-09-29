// src/game/render/vfx/arcs.ts
// Electric arcs: jagged bolts of light between two points (heavy hits and crits jump from the contact down the
// victim's arm, clashes crackle between both grippers, the KO shorts out the loser). One instanced ribbon
// draw, additive HDR. Each arc re-strikes its jagged path ~28 times a second on the GPU (hash noise keyed on a
// quantised clock), so JS only writes the endpoints at spawn.
import {
  AdditiveBlending, BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, ShaderMaterial,
} from "three";
import {
  type Prewarmable, RENDER_SCALE } from "../../contracts.ts";
import { createRingPool, writeColor, type RingPool } from "./sparks.ts";

export const ARC_POOL = 12;
const SEGMENTS = 16;

const VERT = /* glsl */ `
attribute vec2 aStrip;     // side (-0.5 / +0.5), t along 0..1
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aTime;      // birth, life, seed, width (sim m)
attribute vec3 aColor;
uniform float uTime;
varying vec3 vColor;
varying float vX;
varying float vFade;
float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float vnoise(float x, float s) {
  float i = floor(x); float f = fract(x);
  return mix(h11(i + s), h11(i + 1.0 + s), f) * 2.0 - 1.0;
}
vec3 boltAt(float t, vec3 a, vec3 b, float seed, float frame, vec3 side, vec3 up) {
  float env = sin(3.14159265 * t);
  float s = seed * 97.0 + frame * 13.0;
  float jag = vnoise(t * 7.0, s) * 0.7 + vnoise(t * 19.0, s + 5.0) * 0.3;
  float jag2 = vnoise(t * 7.0, s + 31.0) * 0.7 + vnoise(t * 19.0, s + 47.0) * 0.3;
  float len = length(b - a);
  return mix(a, b, t) + (side * jag + up * jag2) * env * len * 0.16;
}
void main() {
  float age = uTime - aTime.x;
  if (age < 0.0 || age > aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return; }
  float k = age / aTime.y;
  float frame = floor(uTime * 28.0);
  vec3 d = normalize(aB - aA + vec3(1e-6));
  vec3 side = normalize(cross(d, abs(d.z) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(side, d);
  float t = aStrip.y;
  vec3 p0 = boltAt(t, aA, aB, aTime.z, frame, side, up);
  vec3 p1 = boltAt(min(t + 0.02, 1.0), aA, aB, aTime.z, frame, side, up);
  vec3 p2 = boltAt(max(t - 0.02, 0.0), aA, aB, aTime.z, frame, side, up);
  vec4 m0 = modelViewMatrix * vec4(p0, 1.0);
  vec4 m1 = modelViewMatrix * vec4(p1, 1.0);
  vec4 m2 = modelViewMatrix * vec4(p2, 1.0);
  vec2 dir = m1.xy - m2.xy;
  float dl = length(dir);
  dir = dl > 1e-7 ? dir / dl : vec2(0.0, 1.0);
  m0.xy += vec2(-dir.y, dir.x) * aStrip.x * aTime.w * ${RENDER_SCALE.toFixed(2)};
  gl_Position = projectionMatrix * m0;
  vColor = aColor;
  vX = aStrip.x * 2.0;
  // Flickers on and off as it re-strikes, and dies over the last third.
  float flick = step(0.25, h11(frame + aTime.z * 7.0));
  vFade = (1.0 - smoothstep(0.6, 1.0, k)) * mix(0.35, 1.0, flick);
}
`;
const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vX;
varying float vFade;
void main() {
  if (vFade <= 0.0) discard;
  float x = abs(vX);
  float core = 1.0 - smoothstep(0.0, 0.3, x);
  float glow = pow(1.0 - x, 2.0) * 0.5;
  vec3 col = mix(vColor, vec3(max(vColor.r, max(vColor.g, vColor.b))), core * 0.7);
  float a = (core + glow) * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface ArcPool extends Prewarmable {
  readonly mesh: Mesh;
  readonly pool: RingPool;
  /** A bolt from A to B (sim m) for `lifeS` of VFX time. */
  spawn(nowS: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, lifeS: number, hex: string, intensity?: number, width?: number): void;
  update(nowS: number): void;
  clear(): void;
  dispose(): void;
}

export function createArcPool(capacity = ARC_POOL): ArcPool {
  const strip = new Float32Array((SEGMENTS + 1) * 2 * 2);
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    strip.set([-0.5, t, 0.5, t], i * 4);
    if (i < SEGMENTS) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute("aStrip", new BufferAttribute(strip, 2));
  // three needs a position attribute to size the draw; the shader never reads it.
  geometry.setAttribute("position", new BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
  const aA = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aB = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const aTime = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-10), 4);
  const aColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  for (const a of [aA, aB, aTime, aColor]) a.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aA", aA);
  geometry.setAttribute("aB", aB);
  geometry.setAttribute("aTime", aTime);
  geometry.setAttribute("aColor", aColor);
  geometry.instanceCount = capacity;
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.name = "arcs";
  const pool = createRingPool(capacity);
  let dirty = false;
  let epoch = 0;
  let seed = 0;
  const self: ArcPool = {
    mesh, pool,
    spawn(nowS, ax, ay, az, bx, by, bz, lifeS, hex, intensity = 7, width = 0.0024) {
      const i = pool.alloc(nowS, lifeS);
      aA.array[i * 3] = ax; aA.array[i * 3 + 1] = ay; aA.array[i * 3 + 2] = az;
      aB.array[i * 3] = bx; aB.array[i * 3 + 1] = by; aB.array[i * 3 + 2] = bz;
      seed = (seed + 0.618034) % 1;
      aTime.array[i * 4] = nowS - epoch; aTime.array[i * 4 + 1] = lifeS;
      aTime.array[i * 4 + 2] = seed * 100; aTime.array[i * 4 + 3] = width;
      writeColor(aColor.array as Float32Array, i * 3, hex, intensity);
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
        aA.needsUpdate = true; aB.needsUpdate = true; aTime.needsUpdate = true; aColor.needsUpdate = true;
        dirty = false;
      }
    },
    clear() {
      pool.clear();
      (aTime.array as Float32Array).fill(-10);
      aTime.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.spawn(0, 0, 0, 0.01, 0.002, 0, 0.01, 0.05, "#FFFFFF", 0.5, 0.0004); self.update(0); },
  };
  return self;
}
