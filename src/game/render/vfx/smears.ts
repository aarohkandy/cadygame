// src/game/render/vfx/smears.ts (WP6)
// Gripper smears (6.8): per arm, the last 8 interpolated gripperframe positions as a camera-facing
// ribbon in the team colour × 2 with an ink edge, visible while tip speed > 0.9 m/s (and forced for 250 ms
// on a charge release). Both ribbons live in one geometry and one draw; JS writes 16 points per frame.
import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, ShaderMaterial, Vector2,
} from "three";
import {
  type Prewarmable, RENDER_SCALE } from "../../contracts.ts";

export const SMEAR_POINTS = 8;
export const SMEAR_SPEED_MS = 0.9;
export const SMEAR_FORCE_S = 0.25;
const SMEAR_WIDTH_M = 0.011;

const VERT = /* glsl */ `
attribute vec3 aNext;
attribute vec3 aInfo;      // side (±1), t along (0 head → 1 tail), arm index
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec2 uAlpha;
varying float vSide;
varying float vT;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 a = modelViewMatrix * vec4(position, 1.0);
  vec4 b = modelViewMatrix * vec4(aNext, 1.0);
  vec2 d = b.xy - a.xy;
  float l = length(d);
  d = l > 1e-7 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float w = ${(SMEAR_WIDTH_M * RENDER_SCALE).toFixed(5)} * (1.0 - aInfo.y) * (1.0 - aInfo.y * 0.2);
  a.xy += n * aInfo.x * w;
  gl_Position = projectionMatrix * a;
  vSide = aInfo.x;
  vT = aInfo.y;
  bool second = aInfo.z > 0.5;
  vColor = second ? uColor1 : uColor0;
  vAlpha = second ? uAlpha.y : uAlpha.x;
}
`;
const FRAG = /* glsl */ `
varying float vSide;
varying float vT;
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.001) discard;
  float x = abs(vSide);
  float core = 1.0 - smoothstep(0.45, 0.7, x);
  vec3 ink = vec3(0.0044, 0.0048, 0.007);
  vec3 col = mix(ink, vColor, core);
  float a = (core * 0.9 + (1.0 - core) * 0.7) * (1.0 - vT) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface SmearRibbons extends Prewarmable {
  readonly mesh: Mesh;
  /** Feed the interpolated tip position (sim) for arm 0 (atlas) or 1 (blaze) once per render frame. */
  push(arm: 0 | 1, x: number, y: number, z: number, speedMs: number, dtS: number, teamLinear: Color): void;
  /** Forces the ribbon visible (charge release). */
  force(arm: 0 | 1): void;
  /** Hides both ribbons and forgets history (round reset, teleports). */
  clear(): void;
  update(): void;
  dispose(): void;
  readonly alpha: Float32Array;
}

export function createSmearRibbons(): SmearRibbons {
  const verts = 2 * SMEAR_POINTS * 2;
  const position = new BufferAttribute(new Float32Array(verts * 3), 3);
  const next = new BufferAttribute(new Float32Array(verts * 3), 3);
  const info = new BufferAttribute(new Float32Array(verts * 3), 3);
  position.setUsage(DynamicDrawUsage);
  next.setUsage(DynamicDrawUsage);
  const indices: number[] = [];
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < SMEAR_POINTS; i++) {
      for (let s = 0; s < 2; s++) {
        const v = (arm * SMEAR_POINTS + i) * 2 + s;
        info.array[v * 3] = s === 0 ? -1 : 1;
        info.array[v * 3 + 1] = i / (SMEAR_POINTS - 1);
        info.array[v * 3 + 2] = arm;
      }
      if (i < SMEAR_POINTS - 1) {
        const a = (arm * SMEAR_POINTS + i) * 2;
        const b = a + 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", position);
  geometry.setAttribute("aNext", next);
  geometry.setAttribute("aInfo", info);
  geometry.setIndex(indices);
  const uniforms = {
    uColor0: { value: new Color() }, uColor1: { value: new Color() },
    uAlpha: { value: new Vector2() },
  };
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.name = "smears";
  const hist = new Float32Array(2 * SMEAR_POINTS * 3);
  const prewarmColor = new Color(1, 1, 1);
  const filled = new Uint8Array(2);
  const forceLeft = new Float32Array(2);
  const alpha = new Float32Array(2);
  let dirty = true;
  const self: SmearRibbons = {
    mesh, alpha,
    push(arm, x, y, z, speed, dt, teamLinear) {
      const o = arm * SMEAR_POINTS * 3;
      if (!filled[arm]) {
        for (let i = 0; i < SMEAR_POINTS; i++) { hist[o + i * 3] = x; hist[o + i * 3 + 1] = y; hist[o + i * 3 + 2] = z; }
        filled[arm] = 1;
      } else {
        hist.copyWithin(o + 3, o, o + (SMEAR_POINTS - 1) * 3);
        hist[o] = x; hist[o + 1] = y; hist[o + 2] = z;
      }
      forceLeft[arm] = Math.max(0, forceLeft[arm] - dt);
      const want = speed > SMEAR_SPEED_MS || forceLeft[arm] > 0 ? Math.min(1, (speed - SMEAR_SPEED_MS) / 0.6 + (forceLeft[arm] > 0 ? 1 : 0.25)) : 0;
      alpha[arm] += (want - alpha[arm]) * Math.min(1, dt * (want > alpha[arm] ? 30 : 10));
      (arm === 0 ? uniforms.uColor0 : uniforms.uColor1).value.copy(teamLinear).multiplyScalar(2);
      dirty = true;
    },
    force(arm) { forceLeft[arm] = SMEAR_FORCE_S; },
    clear() { filled[0] = 0; filled[1] = 0; alpha[0] = 0; alpha[1] = 0; forceLeft[0] = 0; forceLeft[1] = 0; dirty = true; },
    update() {
      uniforms.uAlpha.value.x = alpha[0];
      uniforms.uAlpha.value.y = alpha[1];
      mesh.visible = alpha[0] > 0.002 || alpha[1] > 0.002;
      if (!dirty) return;
      for (let arm = 0; arm < 2; arm++) {
        const o = arm * SMEAR_POINTS * 3;
        for (let i = 0; i < SMEAR_POINTS; i++) {
          const j = i < SMEAR_POINTS - 1 ? i + 1 : i - 1;
          const sign = i < SMEAR_POINTS - 1 ? 1 : -1;
          for (let s = 0; s < 2; s++) {
            const v = ((arm * SMEAR_POINTS + i) * 2 + s) * 3;
            position.array[v] = hist[o + i * 3]; position.array[v + 1] = hist[o + i * 3 + 1]; position.array[v + 2] = hist[o + i * 3 + 2];
            // aNext points along the ribbon; for the last point mirror the previous direction.
            next.array[v] = hist[o + i * 3] + sign * (hist[o + j * 3] - hist[o + i * 3]);
            next.array[v + 1] = hist[o + i * 3 + 1] + sign * (hist[o + j * 3 + 1] - hist[o + i * 3 + 1]);
            next.array[v + 2] = hist[o + i * 3 + 2] + sign * (hist[o + j * 3 + 2] - hist[o + i * 3 + 2]);
          }
        }
      }
      position.needsUpdate = true;
      next.needsUpdate = true;
      dirty = false;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /**
     * One live ribbon so WP1's prewarm draw compiles this program before the show (Prewarmable). The tip
     * speed has to be above SMEAR_SPEED_MS or the ribbon comes up at alpha 0, which is not a drawable state.
     */
    prewarmDraw() { self.push(0, 0, 0, 0.01, SMEAR_SPEED_MS * 3, 1 / 60, prewarmColor); self.update(); },
  };
  return self;
}
