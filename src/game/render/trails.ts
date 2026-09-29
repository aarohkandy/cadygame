// src/game/render/trails.ts (WP6, PRIME TIME)
// Gripper motion trails: per arm, a glowing camera-facing ribbon from the gripper tip that draws only while
// the tip moves faster than TRAIL_SPEED_MS (or for TRAIL_FORCE_S after a charge release), so a flick
// leaves a bright arc in the team colour with a white-hot core that burns out over TRAIL_LIFE_S. Points
// are laid down by distance (TRAIL_SPACING_M), not per frame, so the arc's shape does not depend on the
// frame rate. One pooled geometry per arm, written in place; no per-frame allocation.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, ShaderMaterial,
} from "three";
import { RENDER_SCALE, type Prewarmable } from "../contracts.ts";

export const TRAIL_POINTS = 28;
/** Tip speed (sim m/s) where the trail starts to draw, and where it reaches full strength. */
export const TRAIL_SPEED_MS = 1.0;
export const TRAIL_FULL_MS = 2.2;
export const TRAIL_LIFE_S = 0.3;
export const TRAIL_SPACING_M = 0.012;
export const TRAIL_FORCE_S = 0.25;
const TRAIL_WIDTH_M = 0.008;

const VERT = /* glsl */ `
attribute vec3 aNext;
attribute vec2 aInfo;      // side (±1), fade 0..1
varying float vSide;
varying float vFade;
void main() {
  vec4 a = modelViewMatrix * vec4(position, 1.0);
  vec4 b = modelViewMatrix * vec4(aNext, 1.0);
  vec2 d = b.xy - a.xy;
  float l = length(d);
  d = l > 1e-7 ? d / l : vec2(1.0, 0.0);
  a.xy += vec2(-d.y, d.x) * aInfo.x * ${(TRAIL_WIDTH_M * RENDER_SCALE).toFixed(5)} * (0.25 + 0.75 * aInfo.y);
  gl_Position = projectionMatrix * a;
  vSide = aInfo.x;
  vFade = aInfo.y;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vSide;
varying float vFade;
void main() {
  float x = abs(vSide);
  float glow = 1.0 - smoothstep(0.0, 1.0, x);
  float core = 1.0 - smoothstep(0.0, 0.3, x);
  float a = vFade * glow;
  if (a < 0.004) discard;
  // Additive: team colour halo, white-hot core that cools as the point ages.
  gl_FragColor = vec4((uColor * (0.8 + 1.6 * glow) + vec3(1.0) * core * vFade * 1.6) * a, 1.0);
}
`;

export interface GripperTrail extends Prewarmable {
  readonly mesh: Mesh;
  /** Feed the interpolated tip (sim metres) and its speed once per render frame. */
  push(x: number, y: number, z: number, speedMs: number, dtS: number): void;
  /** Forces the trail on for TRAIL_FORCE_S (charge release). */
  force(): void;
  /** Forgets history (round reset, de-rez, teleports). */
  clear(): void;
  setColor(teamLinear: Color): void;
  dispose(): void;
}

/** Trail strength 0..1 for a tip speed: 0 below TRAIL_SPEED_MS, 1 from TRAIL_FULL_MS. */
export function trailStrength(speedMs: number): number {
  const v = (speedMs - TRAIL_SPEED_MS) / (TRAIL_FULL_MS - TRAIL_SPEED_MS);
  return v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
}

export function createGripperTrail(): GripperTrail {
  const N = TRAIL_POINTS;
  const position = new BufferAttribute(new Float32Array(N * 2 * 3), 3);
  const next = new BufferAttribute(new Float32Array(N * 2 * 3), 3);
  const info = new BufferAttribute(new Float32Array(N * 2 * 2), 2);
  for (const a of [position, next, info]) a.setUsage(DynamicDrawUsage);
  const indices: number[] = [];
  for (let i = 0; i < N; i++) {
    info.array[i * 4] = -1;
    info.array[i * 4 + 2] = 1;
    if (i < N - 1) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("aNext", next);
  geometry.setAttribute("aInfo", info);
  geometry.setIndex(indices);
  const color = { value: new Color() };
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { uColor: color },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.name = "gripper-trail";
  mesh.visible = false;

  // Points, head at index 0: xyz and glow (the strength when laid down, burning out linearly over TRAIL_LIFE_S).
  const pts = new Float32Array(N * 3);
  const glow = new Float32Array(N);
  let count = 0;
  let forceLeft = 0;

  const write = () => {
    let any = false;
    for (let i = 0; i < N; i++) {
      const k = i < count ? i : count - 1;
      const j = k < count - 1 ? k + 1 : k > 0 ? k - 1 : k;
      const sign = k < count - 1 || k === 0 ? 1 : -1;
      const fade = i < count ? glow[k] * (1 - (k / N) * 0.6) : 0;
      if (fade > 0.004) any = true;
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s) * 3;
        for (let c = 0; c < 3; c++) {
          const p = count > 0 ? pts[k * 3 + c] : 0;
          position.array[v + c] = p;
          next.array[v + c] = count > 0 ? p + sign * (pts[j * 3 + c] - p) : 0;
        }
        info.array[(i * 2 + s) * 2 + 1] = fade;
      }
    }
    position.needsUpdate = true;
    next.needsUpdate = true;
    info.needsUpdate = true;
    mesh.visible = any;
  };

  const self: GripperTrail = {
    mesh,
    push(x, y, z, speed, dt) {
      forceLeft = Math.max(0, forceLeft - dt);
      const s = Math.max(trailStrength(speed), forceLeft > 0 ? 1 : 0);
      const burn = dt / TRAIL_LIFE_S;
      for (let i = 0; i < count; i++) glow[i] = glow[i] > burn ? glow[i] - burn : 0;
      // Points are laid down by distance from the last one (index 1); between them the head tracks the tip.
      if (count < 2 || Math.hypot(x - pts[3], y - pts[4], z - pts[5]) >= TRAIL_SPACING_M) {
        pts.copyWithin(3, 0, (N - 1) * 3);
        glow.copyWithin(1, 0, N - 1);
        glow[0] = 0;
        count = Math.min(N, count + 1);
      }
      pts[0] = x; pts[1] = y; pts[2] = z;
      if (s > glow[0]) glow[0] = s;
      if (s === 0 && !mesh.visible) return;
      write();
    },
    force() { forceLeft = TRAIL_FORCE_S; },
    clear() { count = 0; forceLeft = 0; glow.fill(0); mesh.visible = false; },
    setColor(team) { color.value.copy(team).multiplyScalar(1.6); },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.push(0, 0, 0.01, 0, 1 / 60); self.push(0.001, 0, 0.01, 0, 1 / 60); mesh.visible = true; },
  };
  return self;
}
