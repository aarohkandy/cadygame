// src/game/render/vfx/decals.ts (WP6)
// Strike scuff decals (GAME_DESIGN 6.6 and finals-visual 2.10 "pristine to wrecked"): a pale scuff with a
// metal-bright centre projected flat onto the deck wherever a strike lands under 2 cm height. Pool 64,
// persists for the round, wiped by the round re-render scan. One instanced draw.
import {
  DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3,
} from "three";
import type { Prewarmable } from "../../contracts.ts";

export const DECAL_POOL = 64;
export const DECAL_MAX_HEIGHT_M = 0.02;
const DECAL_Z = 0.0012;

const VERT = /* glsl */ `
attribute vec3 aInfo;   // seed, strength 0..1, revealed (0 hidden)
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  vUv = uv;
  vInfo = aInfo;
  if (aInfo.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vInfo;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n21(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  if (vInfo.z <= 0.0) discard;
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= 0.55;                      // scuffs streak along the strike direction (instance x axis)
  float r = length(p);
  float n = n21(vUv * 18.0 + vInfo.x * 31.0) * 0.6 + n21(vUv * 46.0 - vInfo.x * 7.0) * 0.4;
  float mask = (1.0 - smoothstep(0.35, 0.95, r + (n - 0.5) * 0.5)) * vInfo.y;
  float streaks = smoothstep(0.55, 0.9, n21(vec2(vUv.x * 3.0, vUv.y * 60.0) + vInfo.x * 13.0));
  vec3 scuff = vec3(0.141, 0.147, 0.171);          // #6A6D75
  vec3 metal = vec3(0.62, 0.64, 0.68);
  vec3 col = mix(scuff, metal, (1.0 - smoothstep(0.0, 0.3, r)) * 0.55 + streaks * 0.25);
  float a = mask * (0.55 + streaks * 0.3);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface ScuffDecals extends Prewarmable {
  readonly mesh: InstancedMesh;
  readonly count: number;
  /** Adds a scuff at sim (x, y) oriented along `yaw`, sized by strike magnitude. No-op above 2 cm. */
  add(x: number, y: number, z: number, yaw: number, magnitude: number): boolean;
  clear(): void;
  update(): void;
  dispose(): void;
}

export function createScuffDecals(capacity = DECAL_POOL): ScuffDecals {
  const geometry = new PlaneGeometry(1, 1);
  const aInfo = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  aInfo.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aInfo", aInfo);
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = "scuff-decals";
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), zAxis = new Vector3(0, 0, 1);
  let head = 0;
  let count = 0;
  let dirty = false;
  let seed = 1;
  const self: ScuffDecals = {
    mesh,
    get count() { return count; },
    add(x, y, z, yaw, magnitude) {
      if (z > DECAL_MAX_HEIGHT_M) return false;
      const size = 0.012 + 0.03 * Math.min(1, Math.max(0, magnitude));
      q.setFromAxisAngle(zAxis, yaw);
      mesh.setMatrixAt(head, m.compose(p.set(x, y, DECAL_Z), q, s.set(size * 1.8, size, 1)));
      seed = (seed * 16807) % 2147483647;
      aInfo.array[head * 3] = (seed % 1000) / 1000;
      aInfo.array[head * 3 + 1] = 0.55 + 0.45 * Math.min(1, magnitude * 1.4);
      aInfo.array[head * 3 + 2] = 1;
      head = (head + 1) % capacity;
      count = Math.min(capacity, count + 1);
      dirty = true;
      return true;
    },
    clear() {
      for (let i = 0; i < capacity; i++) aInfo.array[i * 3 + 2] = 0;
      head = 0; count = 0; dirty = true;
    },
    update() {
      mesh.visible = count > 0;
      if (!dirty) return;
      mesh.instanceMatrix.needsUpdate = true;
      aInfo.needsUpdate = true;
      dirty = false;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.add(0, 0, 0, 0, 0); aInfo.array[((head + capacity - 1) % capacity) * 3 + 1] = 0; self.update(); },
  };
  return self;
}
