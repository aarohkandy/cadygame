// src/game/render/interpolate.ts (WP6)
// Render-side interpolation between the last two physics steps (GAME_DESIGN 10.3) and the sim ↔ render
// space conversions. Everything here writes into caller-owned buffers and allocates nothing per call.
//
// Spaces:
//   sim     MuJoCo world, metres, Z up. Quaternions stored wxyz.
//   render  three.js world, Y up, render = sim (x, y, z) → (x·s, z·s, −y·s), s = RENDER_SCALE.
//           Quaternions xyzw (three's order).
// The scene's world root is `<group scale={s} rotation={[-π/2, 0, 0]}>`, so objects parented to it are
// authored in sim coordinates directly; only cameras and screen projection work in render space.
import { RENDER_SCALE, type PhysicsFrame } from "../contracts.ts";

/** Minimal array shape every writer accepts: typed arrays, tuples, and three's `.elements`-style arrays. */
export type NumArray = { [index: number]: number; readonly length: number };

const HALF_SQRT2 = Math.SQRT1_2;
/** The world root rotation, R_x(−π/2), as an xyzw quaternion. */
export const SIM_TO_RENDER_QUAT: readonly [number, number, number, number] = [-HALF_SQRT2, 0, 0, HALF_SQRT2];

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach factor: `x += (target − x) · damp(λ, dt)`. */
export function damp(lambda: number, dtS: number): number { return 1 - Math.exp(-lambda * dtS); }
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
export function easeOutCubic(t: number): number { const x = 1 - clamp01(t); return 1 - x * x * x; }
/** Overshoot ease used by slam-ins (SCOPE 1.3 motion: 240 ms with overshoot). */
export function easeOutBack(t: number, k = 1.70158): number {
  const x = clamp01(t) - 1;
  return 1 + (k + 1) * x * x * x + k * x * x;
}

/* ───────────────────────── positions ───────────────────────── */

export function lerp3(a: NumArray, ao: number, b: NumArray, bo: number, t: number, out: NumArray, oo = 0): NumArray {
  out[oo] = a[ao] + (b[bo] - a[ao]) * t;
  out[oo + 1] = a[ao + 1] + (b[bo + 1] - a[ao + 1]) * t;
  out[oo + 2] = a[ao + 2] + (b[bo + 2] - a[ao + 2]) * t;
  return out;
}

export function simToRenderPos(x: number, y: number, z: number, out: NumArray, oo = 0): NumArray {
  out[oo] = x * RENDER_SCALE;
  out[oo + 1] = z * RENDER_SCALE;
  out[oo + 2] = -y * RENDER_SCALE;
  return out;
}

export function renderToSimPos(x: number, y: number, z: number, out: NumArray, oo = 0): NumArray {
  const inv = 1 / RENDER_SCALE;
  out[oo] = x * inv;
  out[oo + 1] = -z * inv;
  out[oo + 2] = y * inv;
  return out;
}

/* ───────────────────────── quaternions ───────────────────────── */

/**
 * Spherical interpolation of two wxyz quaternions stored in flat arrays, shortest path, written as wxyz.
 * Falls back to normalized lerp when the inputs are nearly parallel. α = 0 and α = 1 return the inputs exactly.
 */
export function slerpWxyz(a: NumArray, ao: number, b: NumArray, bo: number, t: number, out: NumArray, oo = 0): NumArray {
  const aw = a[ao], ax = a[ao + 1], ay = a[ao + 2], az = a[ao + 3];
  let bw = b[bo], bx = b[bo + 1], by = b[bo + 2], bz = b[bo + 3];
  if (t <= 0) { out[oo] = aw; out[oo + 1] = ax; out[oo + 2] = ay; out[oo + 3] = az; return out; }
  if (t >= 1) {
    out[oo] = bw; out[oo + 1] = bx; out[oo + 2] = by; out[oo + 3] = bz; return out;
  }
  let cos = aw * bw + ax * bx + ay * by + az * bz;
  if (cos < 0) { cos = -cos; bw = -bw; bx = -bx; by = -by; bz = -bz; }
  let ka: number; let kb: number;
  if (cos > 0.9995) {
    ka = 1 - t; kb = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    ka = Math.sin((1 - t) * theta) / sin;
    kb = Math.sin(t * theta) / sin;
  }
  let w = ka * aw + kb * bw, x = ka * ax + kb * bx, y = ka * ay + kb * by, z = ka * az + kb * bz;
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n; x /= n; y /= n; z /= n;
  out[oo] = w; out[oo + 1] = x; out[oo + 2] = y; out[oo + 3] = z;
  return out;
}

/** wxyz (MuJoCo) → xyzw (three). */
export function wxyzToXyzw(q: NumArray, qo: number, out: NumArray, oo = 0): NumArray {
  const w = q[qo], x = q[qo + 1], y = q[qo + 2], z = q[qo + 3];
  out[oo] = x; out[oo + 1] = y; out[oo + 2] = z; out[oo + 3] = w;
  return out;
}

/** Hamilton product of two xyzw quaternions, a ⊗ b. `out` may alias either input. */
export function mulQuatXyzw(a: NumArray, ao: number, b: NumArray, bo: number, out: NumArray, oo = 0): NumArray {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[oo] = ax * bw + aw * bx + ay * bz - az * by;
  out[oo + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[oo + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Sim-space wxyz orientation → render-space xyzw orientation (left-multiplies the world root rotation). */
export function simToRenderQuat(qWxyz: NumArray, qo: number, out: NumArray, oo = 0): NumArray {
  const x = qWxyz[qo + 1], y = qWxyz[qo + 2], z = qWxyz[qo + 3], w = qWxyz[qo];
  const r = SIM_TO_RENDER_QUAT;
  out[oo] = r[0] * w + r[3] * x + r[1] * z - r[2] * y;
  out[oo + 1] = r[1] * w + r[3] * y + r[2] * x - r[0] * z;
  out[oo + 2] = r[2] * w + r[3] * z + r[0] * y - r[1] * x;
  out[oo + 3] = r[3] * w - r[0] * x - r[1] * y - r[2] * z;
  return out;
}

/** Rotates vector v (xyz at vo) by the xyzw quaternion q, writing into out. `out` may alias `v`. */
export function rotateVecXyzw(q: NumArray, qo: number, v: NumArray, vo: number, out: NumArray, oo = 0): NumArray {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const vx = v[vo], vy = v[vo + 1], vz = v[vo + 2];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[oo] = vx + qw * tx + (qy * tz - qz * ty);
  out[oo + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[oo + 2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/* ───────────────────────── physics frame reads ───────────────────────── */

/** True when the frame carries a body buffer entry for `bodyId` (stub engines report nbody 1 and id 0). */
export function hasBody(frame: PhysicsFrame, bodyId: number): boolean {
  return bodyId > 0 && bodyId < frame.nbody && frame.bodyPosCurr.length >= (bodyId + 1) * 3;
}

/**
 * Interpolated sim-space pose of one MuJoCo body: position lerp and quaternion slerp by α between the
 * previous and current step (10.3). Writes position xyz into `outPos` and orientation **xyzw** into `outQuat`
 * so the result can be copied straight into a three.js object parented under the world root.
 */
export function interpolateBody(
  frame: PhysicsFrame, bodyId: number, alpha: number,
  outPos: NumArray, outQuatXyzw: NumArray, scratchWxyz: NumArray,
): void {
  const a = clamp01(alpha);
  lerp3(frame.bodyPosPrev, bodyId * 3, frame.bodyPosCurr, bodyId * 3, a, outPos, 0);
  slerpWxyz(frame.bodyQuatPrev, bodyId * 4, frame.bodyQuatCurr, bodyId * 4, a, scratchWxyz, 0);
  wxyzToXyzw(scratchWxyz, 0, outQuatXyzw, 0);
}

/**
 * Interpolated sim-space position of a point that only exists in the current frame (end effector, cube)
 * is not possible without a previous sample; `PointHistory` keeps one for such points per render frame.
 */
export interface PointHistory { prev: Float64Array; curr: Float64Array; step: number; }
export function createPointHistory(): PointHistory {
  return { prev: new Float64Array(3), curr: new Float64Array(3), step: -1 };
}
/** Records `p` for `step` (once per physics step seen) and writes the α-interpolated point into out. */
export function samplePointHistory(h: PointHistory, p: NumArray, po: number, step: number, alpha: number, out: NumArray): NumArray {
  if (h.step < 0) {
    h.prev[0] = h.curr[0] = p[po]; h.prev[1] = h.curr[1] = p[po + 1]; h.prev[2] = h.curr[2] = p[po + 2];
    h.step = step;
  } else if (step !== h.step) {
    h.prev[0] = h.curr[0]; h.prev[1] = h.curr[1]; h.prev[2] = h.curr[2];
    h.curr[0] = p[po]; h.curr[1] = p[po + 1]; h.curr[2] = p[po + 2];
    if (step < h.step || step - h.step > 8) { h.prev[0] = h.curr[0]; h.prev[1] = h.curr[1]; h.prev[2] = h.curr[2]; }
    h.step = step;
  }
  return lerp3(h.prev, 0, h.curr, 0, clamp01(alpha), out, 0);
}
