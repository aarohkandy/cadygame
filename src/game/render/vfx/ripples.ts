// src/game/render/vfx/ripples.ts (WP6)
// Hex-grid shapes laid on a plane: the guard ripple (6.8: a ring on the contact normal growing 0 → 0.06 m
// over 220 ms, ink body with a paper edge, pool 8) and the BULWARK ability plane (8.1: a hex plane 6 cm in
// front of the gripper in ink/paper while the ability is active, one per seat). One instanced draw.
import {
  DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3,
} from "three";
import type { Prewarmable } from "../../contracts.ts";
import { createRingPool, type RingPool } from "./sparks.ts";

export const RIPPLE_POOL = 8;
export const RIPPLE_LIFE_S = 0.22;
export const RIPPLE_MAX_SIZE_M = 0.06;
/** Two extra instances after the pool: the BULWARK planes for atlas and blaze. */
const BULWARK_SLOTS = 2;

const VERT = /* glsl */ `
attribute vec4 aTime;   // birth, life, mode (0 ripple, 1 bulwark), alpha
uniform float uTime;
varying vec2 vUv;
varying float vK;
varying float vMode;
varying float vAlpha;
void main() {
  float age = uTime - aTime.x;
  bool alive = aTime.z > 0.5 ? aTime.w > 0.0 : (age >= 0.0 && age <= aTime.y);
  if (!alive) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  float k = aTime.z > 0.5 ? 0.5 : age / aTime.y;
  float grow = aTime.z > 0.5 ? 1.0 : (1.0 - pow(1.0 - k, 2.0));
  vec3 p = position * max(grow, 0.02);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vUv = uv;
  vK = k;
  vMode = aTime.z;
  vAlpha = aTime.z > 0.5 ? aTime.w : 1.0;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vK;
varying float vMode;
varying float vAlpha;
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
vec2 hexCell(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}
void main() {
  if (vAlpha <= 0.0) discard;
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  vec2 cell = hexCell(p * 5.0);
  float line = smoothstep(0.40, 0.5, hexDist(cell));
  vec3 ink = vec3(0.0044, 0.0048, 0.007);
  vec3 paper = vec3(0.92, 0.9, 0.84);
  float a;
  vec3 col;
  if (vMode < 0.5) {
    float ring = 1.0 - smoothstep(0.0, 0.22, abs(r - 0.78));
    float edge = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.96));
    float fill = (1.0 - smoothstep(0.7, 1.0, r)) * line;
    col = mix(ink, paper, edge);
    a = max(max(ring * 0.75, fill * 0.55), edge) * (1.0 - smoothstep(0.5, 1.0, vK));
  } else {
    float border = smoothstep(0.86, 0.96, hexDist(p));
    if (hexDist(p) > 1.0) discard;
    float shimmer = 0.75 + 0.25 * sin(uTime * 9.0 + p.y * 6.0);
    col = mix(ink, paper, max(border, line * 0.6));
    a = max(border, line * 0.45 * shimmer) * 0.9;
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface RipplePool extends Prewarmable {
  readonly mesh: InstancedMesh;
  readonly pool: RingPool;
  /** Guard ripple at sim position facing the contact normal. */
  spawn(nowS: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): void;
  /** BULWARK plane for a seat: centre, facing normal, visibility 0..1. */
  setBulwark(seatIndex: 0 | 1, x: number, y: number, z: number, nx: number, ny: number, nz: number, alpha: number): void;
  update(nowS: number): void;
  clear(): void;
  dispose(): void;
}

export function createRipplePool(capacity = RIPPLE_POOL): RipplePool {
  const geometry = new PlaneGeometry(1, 1);
  const total = capacity + BULWARK_SLOTS;
  const aTime = new InstancedBufferAttribute(new Float32Array(total * 4).fill(-10), 4);
  aTime.setUsage(DynamicDrawUsage);
  for (let s = 0; s < BULWARK_SLOTS; s++) { aTime.array[(capacity + s) * 4 + 2] = 1; aTime.array[(capacity + s) * 4 + 3] = 0; }
  geometry.setAttribute("aTime", aTime);
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
  });
  const mesh = new InstancedMesh(geometry, material, total);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.name = "ripples";
  const pool = createRingPool(capacity);
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), n = new Vector3(), zAxis = new Vector3(0, 0, 1);
  let epoch = 0;
  let dirty = false;
  const place = (i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number) => {
    n.set(nx, ny, nz);
    if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
    q.setFromUnitVectors(zAxis, n.normalize());
    mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(size, size, size)));
  };
  const self: RipplePool = {
    mesh, pool,
    spawn(nowS, x, y, z, nx, ny, nz) {
      const i = pool.alloc(nowS, RIPPLE_LIFE_S);
      place(i, x + nx * 0.002, y + ny * 0.002, z + nz * 0.002, nx, ny, nz, RIPPLE_MAX_SIZE_M * 2);
      aTime.array[i * 4] = nowS - epoch; aTime.array[i * 4 + 1] = RIPPLE_LIFE_S; aTime.array[i * 4 + 2] = 0; aTime.array[i * 4 + 3] = 1;
      dirty = true;
    },
    setBulwark(seatIndex, x, y, z, nx, ny, nz, alpha) {
      const i = capacity + seatIndex;
      const prev = aTime.array[i * 4 + 3];
      if (alpha <= 0 && prev <= 0) return;
      if (alpha > 0) place(i, x, y, z, nx, ny, nz, 0.07);
      aTime.array[i * 4 + 3] = alpha;
      dirty = true;
    },
    update(nowS) {
      // A pool with nothing in it must not cost a draw call: the dead instances are parked at a zero
      // scale, but the InstancedMesh still issues drawElementsInstanced for the whole capacity.
      mesh.visible = pool.active(nowS) > 0;
      if (nowS - epoch > 600 && pool.active(nowS) === 0) {
        epoch = nowS;
        for (let i = 0; i < capacity; i++) aTime.array[i * 4] = -10;
        dirty = true;
      }
      material.uniforms.uTime.value = nowS - epoch;
      if (dirty) { mesh.instanceMatrix.needsUpdate = true; aTime.needsUpdate = true; dirty = false; }
    },
    clear() {
      pool.clear();
      for (let i = 0; i < capacity; i++) aTime.array[i * 4] = -10;
      for (let sI = 0; sI < BULWARK_SLOTS; sI++) aTime.array[(capacity + sI) * 4 + 3] = 0;
      aTime.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.spawn(0, 0, 0, 0.01, 0, 0, 1); self.update(0); },
  };
  return self;
}
