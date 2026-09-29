// src/game/input/assists.ts (WP3)
// Human command-layer assists (GAME_DESIGN 3.1.4): range cue, grab assist, dock magnet, aim assist, plus the guard
// line used by the guard blend (3.1.1). Assists edit the command only; they never touch the servo, physics, or
// scoring, and the pilot records which of them shaped each written ctrl. Everything here is pure: inputs are a
// PhysicsFrame, a seat, the kinematics, and caller-owned scratch, so the functions run per physics step with zero
// allocation and are testable without a browser.
//
// Command-space targets are found by a damped Gauss-Newton solve on (yaw, elevation, reach) against WP2's own
// commandToJoints + fkRollAxisEgo, so the assists agree with whatever link offsets the kinematics model fits.

import {
  CORE_CUBE_INDEX, GRIP_CLOSED, MOUNT_X,
  type CommandState, type PhysicsFrame, type RangeCue, type Seat, type So101Kinematics,
} from "../contracts.ts";

/* ── command ranges (3.1.1) ── */
export const YAW_LIMIT = 1.9;
export const ELEV_MIN = -0.35;
export const ELEV_MAX = 0.9;
export const REACH_MIN = 0.12;
export const REACH_MAX = 0.42;
export const TOOL_LIMIT = 0.8;
export const ROLL_LIMIT = 2.74385;

/* ── assist constants (3.1.4) ── */
export const RANGE_SWEEP_HALF_RAD = 0.9;
export const RANGE_SWEEP_SAMPLES = 9;
export const RANGE_JAB_SAMPLES = 3;
export const RANGE_JAB_EXTRA_M = 0.1;
export const HURTBOX_RADIUS_M = 0.02;
export const RANGE_TOLERANCE_M = 0.015;
export const GRAB_RADIUS_M = 0.05;
export const GRAB_JAW_Z_M = 0.025;
export const GRAB_LIFT_M = 0.06;
export const GRAB_YAW_PULL_RAD = 0.12;
/** Magnitude of the tool pitch used for a vertical approach; the sign that points the jaws down is measured from FK. */
export const GRAB_TOOL_VERTICAL = TOOL_LIMIT;
export const DOCK_MAGNET_RADIUS_M = 0.04;
export const DOCK_MAGNET_Z_M = 0.03;
export const AIM_ASSIST_RATE = 0.6;                  // rad/s
export const GUARD_LINE_R_M = 0.24;
export const GUARD_BLEND = 0.6;
export const GUARD_TOOL = 0.4;
/** Cubes parked off the table sit at x >= 2.0 world (EngineResetOptions / placeCube); never grab those. */
const PARKED_X = 1.5;

/**
 * Assist envelope. The player's aim lives in the 3.1.1 ranges, but the Core has to reach the table next to the base:
 * the own dock sits 0.20 m in front of the mount, which needs the roll axis closer and lower than a player aim ever
 * goes. Assist-shaped commands (grab, dock magnet, guard line) may use this wider envelope; joint limits still apply
 * inside commandToJoints.
 */
export const ASSIST_ELEV_MIN = -1.2;
export const ASSIST_ELEV_MAX = 1.2;
export const ASSIST_REACH_MIN = 0.05;

export function clampAssistCommand(c: CommandState): CommandState {
  c.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, c.yaw));
  c.elev = Math.max(ASSIST_ELEV_MIN, Math.min(ASSIST_ELEV_MAX, c.elev));
  c.reach = Math.max(ASSIST_REACH_MIN, Math.min(REACH_MAX, c.reach));
  c.tool = Math.max(-TOOL_LIMIT, Math.min(TOOL_LIMIT, c.tool));
  c.roll = Math.max(-ROLL_LIMIT, Math.min(ROLL_LIMIT, c.roll));
  return c;
}

export function clampCommand(c: CommandState): CommandState {
  c.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, c.yaw));
  c.elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX, c.elev));
  c.reach = Math.max(REACH_MIN, Math.min(REACH_MAX, c.reach));
  c.tool = Math.max(-TOOL_LIMIT, Math.min(TOOL_LIMIT, c.tool));
  c.roll = Math.max(-ROLL_LIMIT, Math.min(ROLL_LIMIT, c.roll));
  return c;
}

export function copyCommand(from: Readonly<CommandState>, to: CommandState): CommandState {
  to.yaw = from.yaw; to.elev = from.elev; to.reach = from.reach; to.tool = from.tool; to.roll = from.roll; to.grip = from.grip;
  return to;
}

/* ── seat frames (5.4): atlas p_ego = p - (-0.32, 0, 0); blaze is a 180 degree turn about z ── */

export function worldToEgo(seat: Seat, x: number, y: number, z: number, out: Float64Array, o = 0): Float64Array {
  if (seat === "atlas") { out[o] = x - MOUNT_X.atlas; out[o + 1] = y; }
  else { out[o] = -(x - MOUNT_X.blaze); out[o + 1] = -y; }
  out[o + 2] = z;
  return out;
}

export function egoToWorld(seat: Seat, x: number, y: number, z: number, out: Float64Array, o = 0): Float64Array {
  if (seat === "atlas") { out[o] = x + MOUNT_X.atlas; out[o + 1] = y; }
  else { out[o] = MOUNT_X.blaze - x; out[o + 1] = -y; }
  out[o + 2] = z;
  return out;
}

/** World yaw about +z to the seat's ego yaw. */
export function worldYawToEgo(seat: Seat, yaw: number): number {
  return seat === "atlas" ? yaw : wrapPi(yaw + Math.PI);
}

export function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Folds an angle into [-pi/4, pi/4] (a cube's faces repeat every quarter turn). */
export function foldQuarter(a: number): number {
  const q = Math.PI / 2;
  let t = (a + q / 2) % q;
  if (t < 0) t += q;
  return t - q / 2;
}

/* ── scratch ── */

export interface AssistScratch {
  joints: Float64Array;       // 6
  p: Float64Array;            // 3
  q: Float64Array;            // 3
  a: Float64Array;            // 3
  b: Float64Array;            // 3
  cmd: CommandState;
  probe: CommandState;
}

export function createAssistScratch(): AssistScratch {
  return {
    joints: new Float64Array(6), p: new Float64Array(3), q: new Float64Array(3), a: new Float64Array(3), b: new Float64Array(3),
    cmd: { yaw: 0, elev: 0, reach: 0, tool: 0, roll: 0, grip: 0 },
    probe: { yaw: 0, elev: 0, reach: 0, tool: 0, roll: 0, grip: 0 },
  };
}

/* ── pan calibration: which way +yaw turns, and where the pan axis sits, measured from the kinematics itself ── */

export interface PanCalibration { sign: number; cx: number; cy: number; zeroBearing: number }
const calibrations = new WeakMap<So101Kinematics, PanCalibration>();

/**
 * Samples the roll-axis point at three yaws of the home command and fits the circle through them: its centre is the
 * pan axis and the bearing change gives the sign of yaw (so101: +shoulder_pan turns the arm toward ego -y, right).
 */
export function panCalibration(kin: So101Kinematics): PanCalibration {
  const hit = calibrations.get(kin);
  if (hit) return hit;
  const c = kin.homeCommand();
  const j = new Float64Array(6);
  const pts: number[] = [];
  for (const yaw of [-0.6, 0, 0.6]) {
    c.yaw = yaw;
    kin.commandToJoints(c, j);
    const p = kin.fkRollAxisEgo(j, new Float64Array(3));
    pts.push(p[0], p[1]);
  }
  const [ax, ay, bx, by, cx3, cy3] = pts;
  const d = 2 * (ax * (by - cy3) + bx * (cy3 - ay) + cx3 * (ay - by));
  let cx = 0;
  let cy = 0;
  if (Math.abs(d) > 1e-12) {
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx3 * cx3 + cy3 * cy3;
    cx = (a2 * (by - cy3) + b2 * (cy3 - ay) + c2 * (ay - by)) / d;
    cy = (a2 * (cx3 - bx) + b2 * (ax - cx3) + c2 * (bx - ax)) / d;
  }
  const bearingNeg = Math.atan2(ay - cy, ax - cx);
  const bearingPos = Math.atan2(cy3 - cy, cx3 - cx);
  const sign = wrapPi(bearingPos - bearingNeg) >= 0 ? 1 : -1;
  const cal: PanCalibration = { sign, cx, cy, zeroBearing: Math.atan2(by - cy, bx - cx) };
  calibrations.set(kin, cal);
  return cal;
}

/** Command yaw that turns the arm toward the ego XY point. */
export function yawToward(kin: So101Kinematics, x: number, y: number): number {
  const cal = panCalibration(kin);
  return cal.sign * wrapPi(Math.atan2(y - cal.cy, x - cal.cx) - cal.zeroBearing);
}

const MAX_STEP_RAD = 0.35;
const MAX_STEP_M = 0.06;
const J9 = new Float64Array(9);
const M9 = new Float64Array(9);
const V3 = new Float64Array(3);

export type ArmPoint = "roll" | "tip";

function pointOf(kin: So101Kinematics, c: CommandState, s: AssistScratch, out: Float64Array, point: ArmPoint): Float64Array {
  kin.commandToJoints(c, s.joints);
  return point === "tip" ? kin.fkTipEgo(s.joints, out) : kin.fkRollAxisEgo(s.joints, out);
}

/**
 * Finds yaw, elevation and reach that put the wrist_roll axis point at `target` (ego), keeping `inout.tool`, `roll`
 * and `grip`. When `keepYaw` is set, yaw stays and only elevation and reach move (horizontal distance and height).
 * Writes the result into `inout` (clamped) and returns the remaining position error in metres.
 */
export function solveRollAxisCommand(
  kin: So101Kinematics, target: ArrayLike<number>, inout: CommandState, s: AssistScratch, keepYaw = false,
): number {
  return solvePointCommand(kin, target, inout, s, keepYaw, "roll");
}

/** As solveRollAxisCommand, for either the roll-axis point or the gripperframe tip. */
export function solvePointCommand(
  kin: So101Kinematics, target: ArrayLike<number>, inout: CommandState, s: AssistScratch, keepYaw: boolean, point: ArmPoint,
): number {
  const c = inout;
  if (!keepYaw) c.yaw = yawToward(kin, target[0], target[1]);
  clampAssistCommand(c);
  const eps = 1e-4;
  const lambda = 1e-6;
  const cur = s.a;
  const fd = s.b;
  let err = Number.POSITIVE_INFINITY;
  // Jacobian columns: yaw (0), elev (1), reach (2). Stored row-major 3x3 in module scratch (no allocation).
  const J = J9;
  pointOf(kin, c, s, cur, point);
  err = Math.hypot(target[0] - cur[0], target[1] - cur[1], target[2] - cur[2]);
  for (let iter = 0; iter < 16 && err >= 2e-4; iter++) {
    const ex = target[0] - cur[0];
    const ey = target[1] - cur[1];
    const ez = target[2] - cur[2];
    for (let col = keepYaw ? 1 : 0; col < 3; col++) {
      copyCommand(c, s.probe);
      if (col === 0) s.probe.yaw += eps; else if (col === 1) s.probe.elev += eps; else s.probe.reach += eps;
      pointOf(kin, s.probe, s, fd, point);
      J[col] = (fd[0] - cur[0]) / eps;
      J[3 + col] = (fd[1] - cur[1]) / eps;
      J[6 + col] = (fd[2] - cur[2]) / eps;
    }
    let d0 = 0, d1 = 0, d2 = 0;
    if (keepYaw) {
      // 3x2 least squares: (JᵀJ + λI) d = Jᵀ e
      let a11 = lambda, a12 = 0, a22 = lambda, b1 = 0, b2 = 0;
      for (let r = 0; r < 3; r++) {
        const j1 = J[r * 3 + 1];
        const j2 = J[r * 3 + 2];
        const e = r === 0 ? ex : r === 1 ? ey : ez;
        a11 += j1 * j1; a12 += j1 * j2; a22 += j2 * j2; b1 += j1 * e; b2 += j2 * e;
      }
      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-14) break;
      d1 = (b1 * a22 - b2 * a12) / det;
      d2 = (a11 * b2 - a12 * b1) / det;
    } else {
      // Damped normal equations on the full 3x3.
      const m = M9;
      const v = V3;
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) {
          let sum = i === k ? lambda : 0;
          for (let r = 0; r < 3; r++) sum += J[r * 3 + i] * J[r * 3 + k];
          m[i * 3 + k] = sum;
        }
        v[i] = J[i] * ex + J[3 + i] * ey + J[6 + i] * ez;
      }
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      if (Math.abs(det) < 1e-18) break;
      d0 = (v[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (v[1] * m[8] - m[5] * v[2]) + m[2] * (v[1] * m[7] - m[4] * v[2])) / det;
      d1 = (m[0] * (v[1] * m[8] - m[5] * v[2]) - v[0] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * v[2] - v[1] * m[6])) / det;
      d2 = (m[0] * (m[4] * v[2] - v[1] * m[7]) - m[1] * (m[3] * v[2] - v[1] * m[6]) + v[0] * (m[3] * m[7] - m[4] * m[6])) / det;
    }
    // Trust region: joint limits make the map kinked, so cap each step and backtrack when it does not help.
    const scale = Math.min(1, MAX_STEP_RAD / Math.max(1e-12, Math.abs(d0)), MAX_STEP_RAD / Math.max(1e-12, Math.abs(d1)), MAX_STEP_M / Math.max(1e-12, Math.abs(d2)));
    let alpha = scale;
    let accepted = false;
    const y0 = c.yaw, e0 = c.elev, r0 = c.reach;
    for (let tries = 0; tries < 6; tries++) {
      c.yaw = y0 + d0 * alpha; c.elev = e0 + d1 * alpha; c.reach = r0 + d2 * alpha;
      clampAssistCommand(c);
      pointOf(kin, c, s, cur, point);
      const next = Math.hypot(target[0] - cur[0], target[1] - cur[1], target[2] - cur[2]);
      if (next < err) { err = next; accepted = true; break; }
      alpha *= 0.5;
    }
    if (!accepted) {
      c.yaw = y0; c.elev = e0; c.reach = r0;
      pointOf(kin, c, s, cur, point);
      break;
    }
  }
  pointOf(kin, c, s, cur, point);
  return Math.hypot(target[0] - cur[0], target[1] - cur[1], target[2] - cur[2]);
}

/* ── range cue ── */

function segPointDist(ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, py: number, pz: number): number {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const wx = px - ax, wy = py - ay, wz = pz - az;
  const vv = vx * vx + vy * vy + vz * vz;
  const t = vv > 1e-12 ? Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / vv)) : 0;
  return Math.hypot(wx - vx * t, wy - vy * t, wz - vz * t);
}

/**
 * Distance from a world point to the opponent's hurtbox capsule surfaces (lower_arm, wrist, gripper, camera_mount;
 * radius 0.02 m). Capsules run between the ArmFrame joint origins the engine publishes every step.
 */
export function hurtboxDistance(opp: PhysicsFrame["arms"]["atlas"], px: number, py: number, pz: number): number {
  const e = opp.elbowPos, w = opp.wristPos, t = opp.eePos, c = opp.cameraMountPos;
  const d1 = segPointDist(e[0], e[1], e[2], w[0], w[1], w[2], px, py, pz);         // lower_arm
  const d2 = segPointDist(w[0], w[1], w[2], t[0], t[1], t[2], px, py, pz);         // wrist + gripper
  const d3 = segPointDist(c[0], c[1], c[2], w[0], w[1], w[2], px, py, pz);         // camera_mount
  return Math.min(d1, d2, d3) - HURTBOX_RADIUS_M;
}

/** Command yaw that points the arm at the opponent's gripperframe. */
export function opponentYaw(kin: So101Kinematics, seat: Seat, frame: PhysicsFrame, s: AssistScratch): number {
  const opp = frame.arms[seat === "atlas" ? "blaze" : "atlas"].eePos;
  worldToEgo(seat, opp[0], opp[1], opp[2], s.p);
  return yawToward(kin, s.p[0], s.p[1]);
}

/* ── match-1 reach tracking (EMOTION_BIBLE 2 "Assist in match 1") ── */
export const REACH_TRACK_CORE_M = 0.6;

/**
 * Reach change that puts the tip at the depth of the nearest target: the opponent's gripper, or the Core when it
 * is on the table within REACH_TRACK_CORE_M of the tip. Depth is the ego radial distance from the mount; the
 * tip's radius moves one-for-one with the reach command, so one FK gives the delta. null when nothing to track.
 */
export function targetReachDelta(kin: So101Kinematics, seat: Seat, aim: Readonly<CommandState>, frame: PhysicsFrame, s: AssistScratch): number | null {
  kin.commandToJoints(aim, s.joints);
  kin.fkTipEgo(s.joints, s.p);
  const rTip = Math.hypot(s.p[0], s.p[1]);
  const tipX = s.p[0], tipY = s.p[1], tipZ = s.p[2];
  const opp = frame.arms[seat === "atlas" ? "blaze" : "atlas"].eePos;
  worldToEgo(seat, opp[0], opp[1], opp[2], s.q);
  let rTarget = Math.hypot(s.q[0], s.q[1]);
  const c = CORE_CUBE_INDEX * 3;
  const cp = frame.cubes.pos;
  if (cp[c] < PARKED_X) {
    worldToEgo(seat, cp[c], cp[c + 1], cp[c + 2], s.q);
    const dCore = Math.hypot(s.q[0] - tipX, s.q[1] - tipY, s.q[2] - tipZ);
    if (dCore < REACH_TRACK_CORE_M) rTarget = Math.hypot(s.q[0], s.q[1]);
  }
  if (!Number.isFinite(rTarget) || !Number.isFinite(rTip)) return null;
  return rTarget - rTip;
}

/**
 * Range cue (3.1.4): 9 FK tip samples along the flick sweep at the current reach and elevation, 3 along the jab.
 * Only sweep samples on the side facing the opponent count. `aim` is the un-wound aim command.
 */
export function computeRangeCue(
  kin: So101Kinematics, seat: Seat, aim: Readonly<CommandState>, frame: PhysicsFrame, out: RangeCue, s: AssistScratch,
): RangeCue {
  const opp = frame.arms[seat === "atlas" ? "blaze" : "atlas"];
  const oppYaw = opponentYaw(kin, seat, frame, s);
  const side = Math.sign(wrapPi(oppYaw - aim.yaw));
  const probe = copyCommand(aim, s.probe);
  const w = s.q;
  let nearest = Number.POSITIVE_INFINITY;
  let flick = false;
  for (let i = 0; i < RANGE_SWEEP_SAMPLES; i++) {
    const off = -RANGE_SWEEP_HALF_RAD + (2 * RANGE_SWEEP_HALF_RAD * i) / (RANGE_SWEEP_SAMPLES - 1);
    probe.yaw = aim.yaw + off;
    kin.commandToJoints(probe, s.joints);
    kin.fkTipEgo(s.joints, s.p);
    egoToWorld(seat, s.p[0], s.p[1], s.p[2], w);
    const d = hurtboxDistance(opp, w[0], w[1], w[2]);
    if (d < nearest) nearest = d;
    const facing = off === 0 || side === 0 || Math.sign(off) === side;
    if (facing && d <= RANGE_TOLERANCE_M) flick = true;
  }
  probe.yaw = aim.yaw;
  kin.commandToJoints(probe, s.joints);
  kin.fkTipEgo(s.joints, s.p);
  out.flickArcRadiusM = Math.hypot(s.p[0], s.p[1]);
  let jab = false;
  for (let i = 1; i <= RANGE_JAB_SAMPLES; i++) {
    probe.reach = Math.min(REACH_MAX, aim.reach + (RANGE_JAB_EXTRA_M * i) / RANGE_JAB_SAMPLES);
    kin.commandToJoints(probe, s.joints);
    kin.fkTipEgo(s.joints, s.p);
    if (i === RANGE_JAB_SAMPLES) out.jabArcRadiusM = Math.hypot(s.p[0], s.p[1]);
    egoToWorld(seat, s.p[0], s.p[1], s.p[2], w);
    const d = hurtboxDistance(opp, w[0], w[1], w[2]);
    if (d < nearest) nearest = d;
    if (d <= RANGE_TOLERANCE_M) jab = true;
  }
  out.flick = flick;
  out.jab = jab;
  out.nearestM = Number.isFinite(nearest) ? Math.max(0, nearest) : 0;
  return out;
}

/* ── grab assist ── */

/** Nearest un-parked cube whose centre is within 0.05 m of the seat's physical gripperframe, or -1. */
export function findGrabCube(seat: Seat, frame: PhysicsFrame): number {
  const tip = frame.arms[seat].eePos;
  const pos = frame.cubes.pos;
  let best = -1;
  let bestD = GRAB_RADIUS_M;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (Math.abs(x) > PARKED_X) continue;
    const d = Math.hypot(x - tip[0], y - tip[1], z - tip[2]);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Cube yaw about world z from its wxyz quaternion. */
export function cubeYawWorld(frame: PhysicsFrame, cube: number): number {
  const q = frame.cubes.quat;
  const w = q[cube * 4], x = q[cube * 4 + 1], y = q[cube * 4 + 2], z = q[cube * 4 + 3];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/**
 * Grab command (3.1.4): tool vertical, roll folded onto the nearest face pair relative to the arm's heading, the roll
 * axis over the cube centre with the jaws at z 0.025 (+0.06 once both jaws hold it). Aim yaw is pulled onto the
 * cube's azimuth when within 0.12 rad; otherwise the aim yaw stays and only reach and height follow the cube.
 */
export function grabCommand(
  kin: So101Kinematics, seat: Seat, frame: PhysicsFrame, cube: number, aim: Readonly<CommandState>, lifted: boolean,
  out: CommandState, s: AssistScratch,
): CommandState {
  const pos = frame.cubes.pos;
  const target = worldToEgo(seat, pos[cube * 3], pos[cube * 3 + 1], pos[cube * 3 + 2], s.q);
  const tx = target[0], ty = target[1];
  const azimuth = yawToward(kin, tx, ty);
  copyCommand(aim, out);
  const pull = Math.abs(wrapPi(azimuth - aim.yaw)) <= GRAB_YAW_PULL_RAD;
  out.yaw = pull ? azimuth : aim.yaw;
  out.tool = verticalTool(kin, aim, s);
  out.grip = GRIP_CLOSED;
  // The jaws close where the gripperframe is, so the grab solves the gripperframe onto the cube centre at jaw height.
  // (With a truly vertical tool this is also the roll axis over the cube; WP2's ±0.8 tool range tilts the jaws, and
  // placing the roll axis instead would close them several centimetres past the cube.)
  const goal = s.p;
  goal[0] = tx; goal[1] = ty; goal[2] = GRAB_JAW_Z_M + (lifted ? GRAB_LIFT_M : 0);
  // Roll moves the gripperframe (it sits 12 mm off the roll axis), so square the jaws first and re-solve once the
  // final yaw is known. The jaw axis follows the arm's heading at roll 0; the cube's faces repeat every quarter turn.
  const cubeYaw = worldYawToEgo(seat, cubeYawWorld(frame, cube));
  for (let pass = 0; pass < 2; pass++) {
    out.roll = grabRoll(kin, cubeYaw, out.yaw);
    solvePointCommand(kin, goal, out, s, !pull, "tip");
  }
  out.roll = grabRoll(kin, cubeYaw, out.yaw);
  return out;
}

/** Wrist roll that squares the jaws to the nearest face pair of a cube with ego yaw `cubeYaw`, at arm yaw `yaw`. */
export function grabRoll(kin: So101Kinematics, cubeYaw: number, yaw: number): number {
  const cal = panCalibration(kin);
  return foldQuarter(cubeYaw - (cal.zeroBearing + yaw / cal.sign));
}

/** Tool pitch (±0.8) that puts the gripperframe lowest under the roll axis for this pose: the vertical approach. */
export function verticalTool(kin: So101Kinematics, pose: Readonly<CommandState>, s: AssistScratch): number {
  const probe = copyCommand(pose, s.probe);
  let best = GRAB_TOOL_VERTICAL;
  let bestDrop = -Infinity;
  for (const tool of [GRAB_TOOL_VERTICAL, -GRAB_TOOL_VERTICAL]) {
    probe.tool = tool;
    kin.commandToJoints(probe, s.joints);
    kin.fkRollAxisEgo(s.joints, s.a);
    kin.fkTipEgo(s.joints, s.b);
    const drop = s.a[2] - s.b[2];
    if (drop > bestDrop) { bestDrop = drop; best = tool; }
  }
  return best;
}

/* ── dock magnet ── */

export function ownDockEgo(seat: Seat, frame: PhysicsFrame, out: Float64Array): Float64Array {
  const i = seat === "atlas" ? 0 : 3;
  return worldToEgo(seat, frame.docks[i], frame.docks[i + 1], frame.docks[i + 2], out);
}

/** The seat holds the Core and its XY centre is within 0.04 m of the seat's own dock centre. */
export function coreOverOwnDock(seat: Seat, frame: PhysicsFrame): boolean {
  const holding = frame.active.bothJawsOnCube[seat] === CORE_CUBE_INDEX || frame.active.gripperOnCube[seat] === CORE_CUBE_INDEX;
  if (!holding) return false;
  const i = seat === "atlas" ? 0 : 3;
  const c = CORE_CUBE_INDEX * 3;
  return Math.hypot(frame.cubes.pos[c] - frame.docks[i], frame.cubes.pos[c + 1] - frame.docks[i + 1]) <= DOCK_MAGNET_RADIUS_M;
}

/** Dock magnet command: the held Core (gripperframe) over the own dock centre at z 0.03, jaws still closed. */
export function dockCommand(
  kin: So101Kinematics, seat: Seat, frame: PhysicsFrame, aim: Readonly<CommandState>, out: CommandState, s: AssistScratch,
): CommandState {
  copyCommand(aim, out);
  const goal = ownDockEgo(seat, frame, s.p);
  goal[2] = DOCK_MAGNET_Z_M;
  out.grip = GRIP_CLOSED;
  out.tool = verticalTool(kin, aim, s);
  // Like the grab, the held Core sits between the jaws, so the gripperframe is what goes over the dock.
  solvePointCommand(kin, goal, out, s, false, "tip");
  return out;
}

/* ── guard line (3.1.1) ── */

/**
 * The guard pose: roll axis at r = 0.24 m along the segment from the seat's shoulder to the opponent's gripperframe,
 * wrist_flex +0.40, jaws closed. The pilot blends 60% of the way from the aim command to this.
 */
export function guardCommand(
  kin: So101Kinematics, seat: Seat, frame: PhysicsFrame, aim: Readonly<CommandState>, out: CommandState, s: AssistScratch,
): CommandState {
  const own = frame.arms[seat];
  const opp = frame.arms[seat === "atlas" ? "blaze" : "atlas"];
  const sh = worldToEgo(seat, own.shoulderPos[0], own.shoulderPos[1], own.shoulderPos[2], s.a);
  const tip = worldToEgo(seat, opp.eePos[0], opp.eePos[1], opp.eePos[2], s.b);
  let dx = tip[0] - sh[0], dy = tip[1] - sh[1], dz = tip[2] - sh[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) { dx = 1; dy = 0; dz = 0; } else { dx /= len; dy /= len; dz /= len; }
  const goal = s.p;
  goal[0] = sh[0] + dx * GUARD_LINE_R_M;
  goal[1] = sh[1] + dy * GUARD_LINE_R_M;
  goal[2] = sh[2] + dz * GUARD_LINE_R_M;
  copyCommand(aim, out);
  out.tool = GUARD_TOOL;
  out.grip = GRIP_CLOSED;
  solveRollAxisCommand(kin, goal, out, s, false);
  return out;
}

/** Blends the aim toward the guard pose by GUARD_BLEND on every axis the guard line sets. */
export function blendGuard(aim: Readonly<CommandState>, guard: Readonly<CommandState>, out: CommandState): CommandState {
  const k = GUARD_BLEND;
  out.yaw = aim.yaw + (guard.yaw - aim.yaw) * k;
  out.elev = aim.elev + (guard.elev - aim.elev) * k;
  out.reach = aim.reach + (guard.reach - aim.reach) * k;
  out.tool = aim.tool + (guard.tool - aim.tool) * k;
  out.roll = aim.roll;
  out.grip = GRIP_CLOSED;
  return out;
}
