// src/game/kinematics/so101-kinematics.ts (WP2)
// Analytic forward kinematics of the vendored SO-101 (so101.xml, read-only) and the command-space IK the pilot,
// the built-in opponent and the range cue use (GAME_DESIGN 3.1.1).
//
// Frames. Everything here is in a seat's EGO frame (GAME_DESIGN 5.4): the arm's own mount, +x toward the opponent,
// +z up. In MJCF terms that is the `base` body frame, so the chain below is exactly the body/joint chain of so101.xml.
//
// Planar structure. shoulder_lift, elbow_flex and wrist_flex rotate about parallel axes, so after the pan rotation the
// shoulder-lift pivot, elbow, wrist and wrist_roll axis point all move in one vertical plane. The planar constants
// (link lengths and angle offsets) are measured from this module's own exact FK at load, which is why the closed form
// matches full FK to floating-point precision instead of to a hand-fitted tolerance.
import {
  GRIP_CLOSED, HOME_TIP_EGO, JOINT_LIMITS,
  type CommandState, type So101Kinematics, type Vec3,
} from "../contracts.ts";

/* ───────────────────────── exact FK chain from so101.xml ───────────────────────── */

type Mat3 = Float64Array;   // row-major 3×3

interface BodyDef { pos: readonly [number, number, number]; quat: readonly [number, number, number, number] }

/** Bodies on the path base → gripper, each with its hinge about local +z at the body origin (so101.xml). */
const CHAIN: readonly BodyDef[] = [
  { pos: [0.0388353, 0, 0.0624], quat: [0, 0, -1, 0] },                                // shoulder     (shoulder_pan)
  { pos: [-0.0303992, -0.0182778, -0.0542], quat: [1, -1, -1, -1] },                   // upper_arm    (shoulder_lift)
  { pos: [-0.11257, -0.028, 0], quat: [1, 0, 0, 1] },                                  // lower_arm    (elbow_flex)
  { pos: [-0.1349, 0.0052, 0], quat: [1, 0, 0, -1] },                                  // wrist        (wrist_flex)
  { pos: [5.55112e-17, -0.0611, 0.0181], quat: [0.0172091, -0.0172091, 0.706897, 0.706897] }, // gripper (wrist_roll)
];
/** gripperframe site in the gripper body frame. */
export const GRIPPERFRAME_POS: Vec3 = [0.012, -0.000218, -0.098127];
export const GRIPPERFRAME_QUAT: readonly [number, number, number, number] = [1, 0, 1, 0];

/** MuJoCo's mju_quat2Mat after mju_normalize4. */
function quatToMat(q: readonly number[], out: Mat3): Mat3 {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  const w = q[0] / n, x = q[1] / n, y = q[2] / n, z = q[3] / n;
  out[0] = w * w + x * x - y * y - z * z; out[1] = 2 * (x * y - w * z); out[2] = 2 * (x * z + w * y);
  out[3] = 2 * (x * y + w * z); out[4] = w * w - x * x + y * y - z * z; out[5] = 2 * (y * z - w * x);
  out[6] = 2 * (x * z - w * y); out[7] = 2 * (y * z + w * x); out[8] = w * w - x * x - y * y + z * z;
  return out;
}

const BODY_MAT: readonly Mat3[] = CHAIN.map((b) => quatToMat(b.quat, new Float64Array(9)));
const SITE_MAT = quatToMat(GRIPPERFRAME_QUAT, new Float64Array(9));

function mul3(a: Mat3, b: Mat3, out: Mat3): Mat3 {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
  out[0] = a0 * b[0] + a1 * b[3] + a2 * b[6]; out[1] = a0 * b[1] + a1 * b[4] + a2 * b[7]; out[2] = a0 * b[2] + a1 * b[5] + a2 * b[8];
  out[3] = a3 * b[0] + a4 * b[3] + a5 * b[6]; out[4] = a3 * b[1] + a4 * b[4] + a5 * b[7]; out[5] = a3 * b[2] + a4 * b[5] + a5 * b[8];
  out[6] = a6 * b[0] + a7 * b[3] + a8 * b[6]; out[7] = a6 * b[1] + a7 * b[4] + a8 * b[7]; out[8] = a6 * b[2] + a7 * b[5] + a8 * b[8];
  return out;
}

/** out = m · Rz(angle) */
function mulRz(m: Mat3, angle: number, out: Mat3): Mat3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m6 = m[6], m7 = m[7];
  out[0] = m0 * c + m1 * s; out[1] = -m0 * s + m1 * c; out[2] = m[2];
  out[3] = m3 * c + m4 * s; out[4] = -m3 * s + m4 * c; out[5] = m[5];
  out[6] = m6 * c + m7 * s; out[7] = -m6 * s + m7 * c; out[8] = m[8];
  return out;
}

/** Scratch for one FK evaluation. Not re-entrant; kinematics is single-threaded per realm. */
const fkR = new Float64Array(9);
const fkT = new Float64Array(9);
const fkP = new Float64Array(3);

/**
 * Walks base → gripper with joints q[0..4]. Leaves the gripper body origin in fkP and its rotation in fkR.
 * Returns early after `upTo` bodies (1 = shoulder … 5 = gripper) so planar measurements can stop at any joint frame.
 */
function walk(q: ArrayLike<number>, upTo: number): void {
  fkR[0] = 1; fkR[1] = 0; fkR[2] = 0; fkR[3] = 0; fkR[4] = 1; fkR[5] = 0; fkR[6] = 0; fkR[7] = 0; fkR[8] = 1;
  fkP[0] = 0; fkP[1] = 0; fkP[2] = 0;
  for (let i = 0; i < upTo; i++) {
    const p = CHAIN[i].pos;
    const x = fkR[0] * p[0] + fkR[1] * p[1] + fkR[2] * p[2];
    const y = fkR[3] * p[0] + fkR[4] * p[1] + fkR[5] * p[2];
    const z = fkR[6] * p[0] + fkR[7] * p[1] + fkR[8] * p[2];
    fkP[0] += x; fkP[1] += y; fkP[2] += z;
    mul3(fkR, BODY_MAT[i], fkT);
    mulRz(fkT, q[i] ?? 0, fkR);
  }
}

/** Gripperframe site position (ego) for joints q, including roll. */
export function fkTip(q: ArrayLike<number>, out: Float64Array): Float64Array {
  walk(q, 5);
  const p = GRIPPERFRAME_POS;
  out[0] = fkP[0] + fkR[0] * p[0] + fkR[1] * p[1] + fkR[2] * p[2];
  out[1] = fkP[1] + fkR[3] * p[0] + fkR[4] * p[1] + fkR[5] * p[2];
  out[2] = fkP[2] + fkR[6] * p[0] + fkR[7] * p[1] + fkR[8] * p[2];
  return out;
}

/** Gripperframe site rotation matrix (ego, row-major) for joints q. */
export function fkTipMat(q: ArrayLike<number>, out: Float64Array): Float64Array {
  walk(q, 5);
  return mul3(fkR, SITE_MAT, out);
}

/** Origin of body `index` (1 shoulder, 2 upper_arm, 3 lower_arm, 4 wrist, 5 gripper) in ego. */
export function fkBodyOrigin(q: ArrayLike<number>, index: 1 | 2 | 3 | 4 | 5, out: Float64Array): Float64Array {
  walk(q, index);
  out[0] = fkP[0]; out[1] = fkP[1]; out[2] = fkP[2];
  return out;
}

/* ───────────────────────── planar model, measured from the FK above ───────────────────────── */

interface Planar {
  panAxisX: number; panAxisY: number;   // where the vertical pan axis pierces the table plane (ego)
  panSign: number;                      // ego heading = panSign · q0
  lateral: number;                      // roll-axis point's constant offset across the arm plane (pan frame v)
  sU: number; sW: number;               // shoulder-lift pivot in the pan plane (u radial from the pan axis, w height)
  l1: number; c1: number;               // pivot → elbow
  l2: number; c2: number;               // elbow → wrist_flex pivot
  l3: number; c3: number;               // wrist_flex pivot → roll-axis point
  c4: number;                           // roll-axis (toward the jaws) direction angle at q = 0
  s: number;                            // in-plane angle = s · (joint sum) + c
  elbowSign: number;                    // sign of (a2 − a1) for the working elbow branch
}

const tmpA = new Float64Array(3);

function planarPoint(q: ArrayLike<number>, index: 3 | 4 | 5, p: Planar | null, out: Float64Array): Float64Array {
  fkBodyOrigin(q, index, tmpA);
  // q[0] is zero whenever this is used for measurement, so the pan plane is the ego x–z plane shifted to the axis.
  out[0] = tmpA[0] - (p ? p.panAxisX : 0);
  out[1] = tmpA[2];
  return out;
}

function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

function measurePlanar(): Planar {
  const zero = [0, 0, 0, 0, 0, 0];
  // Pan axis: the shoulder body origin lies on it, and the axis is vertical (shoulder quat flips z).
  const shoulder = fkBodyOrigin(zero, 1, new Float64Array(3));
  const upper = fkBodyOrigin(zero, 2, new Float64Array(3));
  // Pan sign: heading of the roll-axis point for a small positive pan.
  const g0 = fkBodyOrigin(zero, 5, new Float64Array(3));
  const g1 = fkBodyOrigin([0.1, 0, 0, 0, 0, 0], 5, new Float64Array(3));
  const h0 = Math.atan2(g0[1] - shoulder[1], g0[0] - shoulder[0]);
  const h1 = Math.atan2(g1[1] - shoulder[1], g1[0] - shoulder[0]);
  const panSign = Math.sign(wrapPi(h1 - h0));
  const base: Planar = {
    panAxisX: shoulder[0], panAxisY: shoulder[1], panSign, lateral: g0[1] - shoulder[1],
    sU: upper[0] - shoulder[0], sW: upper[2], l1: 0, c1: 0, l2: 0, c2: 0, l3: 0, c3: 0, c4: 0, s: 1, elbowSign: 1,
  };
  const pt = (q: number[], i: 3 | 4 | 5) => planarPoint(q, i, base, new Float64Array(2));
  const e = pt(zero, 3), w = pt(zero, 4), g = pt(zero, 5);
  base.l1 = Math.hypot(e[0] - base.sU, e[1] - base.sW); base.c1 = Math.atan2(e[1] - base.sW, e[0] - base.sU);
  base.l2 = Math.hypot(w[0] - e[0], w[1] - e[1]); base.c2 = Math.atan2(w[1] - e[1], w[0] - e[0]);
  base.l3 = Math.hypot(g[0] - w[0], g[1] - w[1]); base.c3 = Math.atan2(g[1] - w[1], g[0] - w[0]);
  // Tool direction: gripper body −z (the roll axis pointing at the jaws), projected on the plane.
  walk(zero, 5);
  base.c4 = Math.atan2(-fkR[8], -fkR[2]);
  // Sign of the in-plane rotation for a positive joint step.
  const e1 = pt([0, 0.1, 0, 0, 0, 0], 3);
  base.s = Math.sign(wrapPi(Math.atan2(e1[1] - base.sW, e1[0] - base.sU) - base.c1));
  // Working elbow branch: the one the arm uses in its guard stance (elbow raised above the pivot–wrist line).
  const guardQ = [0, -0.62, 1.08, -0.48, 0, 0];
  const ge = pt(guardQ, 3), gw = pt(guardQ, 4);
  const a1 = Math.atan2(ge[1] - base.sW, ge[0] - base.sU);
  const a2 = Math.atan2(gw[1] - ge[1], gw[0] - ge[0]);
  base.elbowSign = Math.sign(wrapPi(a2 - a1)) || 1;
  return base;
}

export const PLANAR: Readonly<Planar> = measurePlanar();

export const REACH_MIN_M = 0.12;
export const REACH_MAX_M = 0.42;
export const ELEVATION_MIN = -0.35;
export const ELEVATION_MAX = 0.9;
export const TOOL_MIN = -0.8;
export const TOOL_MAX = 0.8;

function clampJoint(j: number, v: number): number {
  const lim = JOINT_LIMITS[j];
  return v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
}

/** Solves the planar chain so the roll-axis point sits at (u, w) in the pan plane with tool angle T. Writes q1..q3. */
function solvePlanar(u: number, w: number, toolAngle: number, out: Float64Array): void {
  const P = PLANAR;
  const sum3 = (toolAngle - P.c4) / P.s;
  const a3 = toolAngle - P.c4 + P.c3;
  const wx = u - P.l3 * Math.cos(a3) - P.sU;
  const wz = w - P.l3 * Math.sin(a3) - P.sW;
  let d = Math.hypot(wx, wz);
  const dMin = Math.abs(P.l1 - P.l2) + 1e-6, dMax = P.l1 + P.l2 - 1e-6;
  const scale = d < 1e-9 ? 1 : (d < dMin ? dMin : d > dMax ? dMax : d) / d;
  d *= scale;
  const cosG = (d * d - P.l1 * P.l1 - P.l2 * P.l2) / (2 * P.l1 * P.l2);
  const gamma = P.elbowSign * Math.acos(cosG < -1 ? -1 : cosG > 1 ? 1 : cosG);
  const a1 = Math.atan2(wz * scale, wx * scale) - Math.atan2(P.l2 * Math.sin(gamma), P.l1 + P.l2 * Math.cos(gamma));
  const a2 = a1 + gamma;
  const q1 = wrapPi(a1 - P.c1) / P.s;
  const q12 = wrapPi(a2 - P.c2) / P.s;
  out[1] = q1;
  out[2] = wrapPi(q12 - q1);
  out[3] = wrapPi(sum3 - q12);
}

/** Pan-plane (u, w) of the roll-axis point and its tool angle, for joints q. */
function planarOf(q: ArrayLike<number>, out: Float64Array): Float64Array {
  const P = PLANAR;
  const a1 = P.s * (q[1] ?? 0) + P.c1;
  const a2 = P.s * ((q[1] ?? 0) + (q[2] ?? 0)) + P.c2;
  const sum3 = (q[1] ?? 0) + (q[2] ?? 0) + (q[3] ?? 0);
  const a3 = P.s * sum3 + P.c3;
  out[0] = P.sU + P.l1 * Math.cos(a1) + P.l2 * Math.cos(a2) + P.l3 * Math.cos(a3);
  out[1] = P.sW + P.l1 * Math.sin(a1) + P.l2 * Math.sin(a2) + P.l3 * Math.sin(a3);
  out[2] = wrapPi(P.s * sum3 + P.c4);
  return out;
}

const planarScratch = new Float64Array(3);

function commandToJointsImpl(cmd: CommandState, out: Float64Array): Float64Array {
  const u = PLANAR.sU + cmd.reach * Math.cos(cmd.elev);
  const w = PLANAR.sW + cmd.reach * Math.sin(cmd.elev);
  solvePlanar(u, w, cmd.elev + cmd.tool, out);
  out[0] = clampJoint(0, cmd.yaw);
  out[1] = clampJoint(1, out[1]);
  out[2] = clampJoint(2, out[2]);
  out[3] = clampJoint(3, out[3]);
  out[4] = clampJoint(4, cmd.roll);
  out[5] = clampJoint(5, cmd.grip);
  return out;
}

function homeCommandImpl(): CommandState {
  const P = PLANAR;
  // Roll-axis point at HOME_TIP_EGO: radial distance from the pan axis, less the constant lateral offset.
  const dx = HOME_TIP_EGO[0] - P.panAxisX, dy = HOME_TIP_EGO[1] - P.panAxisY;
  const u = Math.sqrt(Math.max(0, dx * dx + dy * dy - P.lateral * P.lateral));
  const yaw = P.panSign * (Math.atan2(dy, dx) - Math.atan2(P.lateral, u));
  const du = u - P.sU, dw = HOME_TIP_EGO[2] - P.sW;
  return { yaw, elev: Math.atan2(dw, du), reach: Math.hypot(du, dw), tool: HOME_TOOL, roll: 0, grip: GRIP_CLOSED };
}

/**
 * Home guard tool angle: the jaws lie along the aim ray. Raising them further is not available at this roll-axis
 * point (wrist_flex would pass its −1.658 rad limit and drag the roll-axis point off HOME_TIP_EGO), so the gripperframes
 * start ~5.5 cm apart with the roll-axis points 0.24 m apart.
 */
export const HOME_TOOL = 0;

const HOME: Readonly<CommandState> = Object.freeze(homeCommandImpl());

/* ───────────────────────── tip solver (DLS on exact FK) ───────────────────────── */

const solveCmd: CommandState = { yaw: 0, elev: 0, reach: 0, tool: 0, roll: 0, grip: 0 };
const solveTip = new Float64Array(3);
const solveTipB = new Float64Array(3);
const solveQ = new Float64Array(6);
const jac = new Float64Array(9);

function solveTipImpl(target: Vec3, pitch: number, seed: ArrayLike<number>, out: Float64Array): { ok: boolean; errorM: number } {
  const P = PLANAR;
  // Closed-form start: aim the pan at the target, then place the roll-axis point one tool length short of it.
  const dx = target[0] - P.panAxisX, dy = target[1] - P.panAxisY;
  const tipLen = Math.hypot(GRIPPERFRAME_POS[0], GRIPPERFRAME_POS[2]);
  const horiz = Math.hypot(dx, dy);
  const u0 = Math.sqrt(Math.max(1e-6, horiz * horiz - P.lateral * P.lateral)) - tipLen * Math.cos(pitch);
  const w0 = target[2] - tipLen * Math.sin(pitch);
  let yaw = P.panSign * (Math.atan2(dy, dx) - Math.atan2(P.lateral, u0 + tipLen * Math.cos(pitch)));
  let elev = Math.atan2(w0 - P.sW, u0 - P.sU);
  let reach = Math.hypot(u0 - P.sU, w0 - P.sW);
  solveCmd.roll = seed[4] ?? 0;
  solveCmd.grip = seed[5] ?? GRIP_CLOSED;
  const evalTip = (y: number, e: number, r: number, o: Float64Array) => {
    solveCmd.yaw = y; solveCmd.elev = e; solveCmd.reach = r; solveCmd.tool = pitch - e;
    commandToJointsImpl(solveCmd, solveQ);
    return fkTip(solveQ, o);
  };
  let err = Infinity;
  for (let it = 0; it < 12; it++) {
    evalTip(yaw, elev, reach, solveTip);
    const ex = target[0] - solveTip[0], ey = target[1] - solveTip[1], ez = target[2] - solveTip[2];
    err = Math.hypot(ex, ey, ez);
    if (err < 1e-6) break;
    const h = 1e-6;
    const vars = [yaw, elev, reach];
    for (let k = 0; k < 3; k++) {
      vars[k] += h;
      evalTip(vars[0], vars[1], vars[2], solveTipB);
      vars[k] -= h;
      jac[k] = (solveTipB[0] - solveTip[0]) / h;
      jac[3 + k] = (solveTipB[1] - solveTip[1]) / h;
      jac[6 + k] = (solveTipB[2] - solveTip[2]) / h;
    }
    // Damped least squares: Δ = Jᵀ (J Jᵀ + λ² I)⁻¹ e
    const lam2 = 1e-6;
    const a00 = jac[0] * jac[0] + jac[1] * jac[1] + jac[2] * jac[2] + lam2;
    const a01 = jac[0] * jac[3] + jac[1] * jac[4] + jac[2] * jac[5];
    const a02 = jac[0] * jac[6] + jac[1] * jac[7] + jac[2] * jac[8];
    const a11 = jac[3] * jac[3] + jac[4] * jac[4] + jac[5] * jac[5] + lam2;
    const a12 = jac[3] * jac[6] + jac[4] * jac[7] + jac[5] * jac[8];
    const a22 = jac[6] * jac[6] + jac[7] * jac[7] + jac[8] * jac[8] + lam2;
    const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
    if (Math.abs(det) < 1e-18) break;
    const b0 = ((a11 * a22 - a12 * a12) * ex + (a02 * a12 - a01 * a22) * ey + (a01 * a12 - a02 * a11) * ez) / det;
    const b1 = ((a12 * a02 - a01 * a22) * ex + (a00 * a22 - a02 * a02) * ey + (a01 * a02 - a00 * a12) * ez) / det;
    const b2 = ((a01 * a12 - a11 * a02) * ex + (a01 * a02 - a00 * a12) * ey + (a00 * a11 - a01 * a01) * ez) / det;
    let dy0 = jac[0] * b0 + jac[3] * b1 + jac[6] * b2;
    let de = jac[1] * b0 + jac[4] * b1 + jac[7] * b2;
    let dr = jac[2] * b0 + jac[5] * b1 + jac[8] * b2;
    const big = Math.max(Math.abs(dy0), Math.abs(de), Math.abs(dr) * 4);
    if (big > 0.3) { const k = 0.3 / big; dy0 *= k; de *= k; dr *= k; }
    yaw += dy0; elev += de; reach += dr;
  }
  solveCmd.yaw = yaw; solveCmd.elev = elev; solveCmd.reach = reach; solveCmd.tool = pitch - elev;
  commandToJointsImpl(solveCmd, out);
  fkTip(out, solveTip);
  err = Math.hypot(target[0] - solveTip[0], target[1] - solveTip[1], target[2] - solveTip[2]);
  return { ok: err < 1e-3, errorM: err };
}

/* ───────────────────────── factory ───────────────────────── */

export function createKinematics(): So101Kinematics {
  return {
    fkTipEgo(q, out) { return fkTip(q, out); },
    fkRollAxisEgo(q, out) { return fkBodyOrigin(q, 5, out); },
    commandToJoints(cmd, out) { return commandToJointsImpl(cmd, out); },
    jointsToCommand(q, out) {
      const P = PLANAR;
      planarOf(q, planarScratch);
      const du = planarScratch[0] - P.sU, dw = planarScratch[1] - P.sW;
      out.yaw = q[0] ?? 0;
      out.elev = Math.atan2(dw, du);
      out.reach = Math.hypot(du, dw);
      out.tool = wrapPi(planarScratch[2] - out.elev);
      out.roll = q[4] ?? 0;
      out.grip = q[5] ?? 0;
      return out;
    },
    solveTipEgo(target, pitch, seed, out) { return solveTipImpl(target, pitch, seed, out); },
    homeCommand() { return { ...HOME }; },
  };
}
