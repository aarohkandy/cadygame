// src/game/camera/cockpit-rig.ts (WP3)
// First-person cockpit camera (GAME_DESIGN 3.2). The eye is fixed to the seat's base frame: 10 cm behind, 16 cm left,
// 36 cm up, looking just in front of the opponent base, so the own arm enters lower right like a viewmodel. Flicks move the reticle and the arm, never the view; only the pilot's
// stance (a low-pass of the aim) turns the camera, through tanh-limited look offsets (±24° yaw, ±10° pitch). On top
// sit the section 6 command roll (clamp(−0.012 · pan acceleration, ±3°) low-passed at 12 Hz), a small pitch sway
// from lift speed (6 Hz, 0.3 rad/s deadzone, 20°/s slew, ≤ 1.5°), the juice rotations and FOV punch, and the KO
// focus hold toward the loser's gripper. 3.5: total roll is clamped to ±3° and the camera never bobs or idles.
// Output is a render-space pose (render = sim (x, y, z) -> (x s, z s, -y s)) with a three.js xyzw quaternion.

import {
  RENDER_SCALE,
  type CameraPose, type CockpitRig, type CreateCockpitRig, type JuiceOutput, type PhysicsFrame, type PilotController,
  type Seat, type Settings,
} from "../contracts.ts";
import { COCKPIT_EYE_EGO, COCKPIT_TARGET_EGO } from "../render/camera-math.ts";
import { clamp, onePoleHz, slew } from "./springs.ts";

export { COCKPIT_TARGET_EGO };
export const SWAY_FILTER_HZ = 6;
export const SWAY_DEADZONE_RAD_S = 0.3;
/** Section 6 "Command" row: roll = clamp(−0.012 · pan accel, ±3°), low-passed at 12 Hz. */
export const ROLL_ACCEL_K_DEG = 0.012;      // deg per rad/s² of pan acceleration
export const ROLL_FILTER_HZ = 12;
export const ROLL_MAX_DEG = 3;
export const SWAY_PITCH_K_DEG = 0.05;
export const SWAY_PITCH_MAX_DEG = 1.5;
export const SWAY_SLEW_DEG_S = 20;
export const KO_FOCUS_MAX_DEG = 4;
export const RITUAL_EYES_PITCH_DEG = 12;

const DEG = Math.PI / 180;

interface SeatSway { panPrev: number; liftF: number; roll: number; pitch: number }

export interface CockpitRigExt extends CockpitRig {
  /** Secondary sway currently applied (radians), for ?debug=feel and tests. */
  readonly sway: { readonly roll: number; readonly pitch: number };
}

export interface CockpitRigOptions {
  /** Wall clock in ms; defaults to performance.now(). compute() derives its frame time from it. */
  now?: () => number;
}

function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  return a <= dz ? 0 : Math.sign(v) * (a - dz);
}

/** Sim world point -> ego for a seat (5.4). */
function toEgo(seat: Seat, x: number, y: number, z: number, out: number[]): number[] {
  if (seat === "atlas") { out[0] = x + 0.32; out[1] = y; } else { out[0] = -(x - 0.32); out[1] = -y; }
  out[2] = z;
  return out;
}

/** Rotation matrix (columns right, up, back) to a three.js xyzw quaternion. */
function basisToQuat(
  rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, bx: number, by: number, bz: number,
  out: [number, number, number, number],
): void {
  const m00 = rx, m01 = ux, m02 = bx;
  const m10 = ry, m11 = uy, m12 = by;
  const m20 = rz, m21 = uz, m22 = bz;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 - m00 + m11 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 - m00 - m11 + m22);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  out[0] = x / n; out[1] = y / n; out[2] = z / n; out[3] = w / n;
}

export function createCockpitRigWith(opts: CockpitRigOptions = {}): CockpitRigExt {
  const now = opts.now ?? (() => (globalThis.performance ? globalThis.performance.now() : Date.now()));
  const sways: Record<Seat, SeatSway> = {
    atlas: { panPrev: 0, liftF: 0, roll: 0, pitch: 0 },
    blaze: { panPrev: 0, liftF: 0, roll: 0, pitch: 0 },
  };
  let lastMs: number | null = null;
  let lastSeat: Seat | null = null;
  const swayOut = { roll: 0, pitch: 0 };
  const ego: number[] = [0, 0, 0];

  const rig: CockpitRigExt = {
    sway: swayOut,
    compute(seat: Seat, pilot: PilotController | null, juice: JuiceOutput, frame: PhysicsFrame, settings: Readonly<Settings>, out: CameraPose): CameraPose {
      const t = now();
      const dt = lastMs === null || lastSeat !== seat ? 0 : clamp((t - lastMs) / 1000, 0, 0.1);
      lastMs = t;
      if (lastSeat !== seat) { const s0 = sways[seat]; s0.panPrev = 0; s0.liftF = 0; s0.roll = 0; s0.pitch = 0; lastSeat = seat; }
      const motion = clamp(settings.camera.motion01, 0, 1);

      // Command roll from measured pan acceleration (section 6), pitch sway from lift speed.
      const sw = sways[seat];
      const qd = frame.arms[seat].qd;
      const pan = Number.isFinite(qd[0]) ? qd[0] : 0;
      const lift = Number.isFinite(qd[1]) ? qd[1] : 0;
      const panAccel = dt > 0 ? (pan - sw.panPrev) / dt : 0;
      sw.panPrev = pan;
      const rollTarget = clamp(-ROLL_ACCEL_K_DEG * panAccel, -ROLL_MAX_DEG, ROLL_MAX_DEG) * DEG;
      sw.roll = onePoleHz(sw.roll, rollTarget, dt, ROLL_FILTER_HZ);
      sw.liftF = onePoleHz(sw.liftF, lift, dt, SWAY_FILTER_HZ);
      const pitchTarget = clamp(SWAY_PITCH_K_DEG * deadzone(sw.liftF, SWAY_DEADZONE_RAD_S), -SWAY_PITCH_MAX_DEG, SWAY_PITCH_MAX_DEG) * DEG;
      sw.pitch = slew(sw.pitch, pitchTarget, SWAY_SLEW_DEG_S * DEG, dt);
      swayOut.roll = sw.roll * motion;
      swayOut.pitch = sw.pitch * motion;

      let yaw = pilot ? pilot.look.yawOffset : 0;
      let pitch = pilot ? pilot.look.pitchOffset : 0;
      // Boot ritual (3.4): the eyes open, pitch −12° → 0 over the ritual's last 400 ms. Not a bob: it plays once.
      const eyes = pilot && "eyesOpen" in pilot ? (pilot as { eyesOpen: number }).eyesOpen : 1;
      if (eyes < 1) pitch += (eyes - 1) * RITUAL_EYES_PITCH_DEG * DEG;

      // Eye and base look direction in the seat's ego frame.
      const ex = COCKPIT_EYE_EGO[0], ey = COCKPIT_EYE_EGO[1], ez = COCKPIT_EYE_EGO[2];
      let fx = COCKPIT_TARGET_EGO[0] - ex, fy = COCKPIT_TARGET_EGO[1] - ey, fz = COCKPIT_TARGET_EGO[2] - ez;

      // KO focus: ease the look toward the loser's gripper by up to 4 degrees (no pull-back, no cut).
      const ko = juice.koFocus;
      if (ko.seat !== null && ko.weight > 0) {
        const g = frame.arms[ko.seat].eePos;
        toEgo(seat, g[0], g[1], g[2], ego);
        const baseBearing = Math.atan2(fy, fx);
        const baseElev = Math.atan2(fz, Math.hypot(fx, fy));
        const tb = Math.atan2(ego[1] - ey, ego[0] - ex);
        const te = Math.atan2(ego[2] - ez, Math.hypot(ego[0] - ex, ego[1] - ey));
        const maxRad = KO_FOCUS_MAX_DEG * DEG * ko.weight;
        // bearing + = left, view yaw + = right
        yaw += clamp(-(tb - baseBearing) - yaw, -maxRad, maxRad);
        pitch += clamp((te - baseElev) - pitch, -maxRad, maxRad);
      }

      yaw += juice.yaw;
      pitch += juice.pitch + swayOut.pitch;
      const roll = clamp(juice.roll + swayOut.roll, -ROLL_MAX_DEG * DEG, ROLL_MAX_DEG * DEG);   // 3.5: ±3°, always

      // Normalise the base forward, then build right/up (ego z up).
      const fl = Math.hypot(fx, fy, fz);
      fx /= fl; fy /= fl; fz /= fl;
      // right = forward x up(0,0,1) -> (fy, -fx, 0)
      let rx = fy, ry = -fx, rz = 0;
      const rl = Math.hypot(rx, ry) || 1;
      rx /= rl; ry /= rl;
      // up = right x forward
      let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

      // Yaw (right positive) about ego up: forward swings toward right.
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      // rotate about world z by -yaw
      const f1x = fx * cy + fy * sy, f1y = -fx * sy + fy * cy;
      const r1x = rx * cy + ry * sy, r1y = -rx * sy + ry * cy;
      const u1x = ux * cy + uy * sy, u1y = -ux * sy + uy * cy;
      fx = f1x; fy = f1y; rx = r1x; ry = r1y; ux = u1x; uy = u1y;
      // Pitch (up positive) about the right axis.
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const f2x = fx * cp + ux * sp, f2y = fy * cp + uy * sp, f2z = fz * cp + uz * sp;
      const u2x = ux * cp - fx * sp, u2y = uy * cp - fy * sp, u2z = uz * cp - fz * sp;
      fx = f2x; fy = f2y; fz = f2z; ux = u2x; uy = u2y; uz = u2z;
      // Roll (clockwise as seen by the player) about forward: right tips down.
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const r3x = rx * cr - ux * sr, r3y = ry * cr - uy * sr, r3z = rz * cr - uz * sr;
      const u3x = ux * cr + rx * sr, u3y = uy * cr + ry * sr, u3z = uz * cr + rz * sr;
      rx = r3x; ry = r3y; rz = r3z; ux = u3x; uy = u3y; uz = u3z;

      // Ego -> sim world (atlas: translate; blaze: 180 degrees about z), then sim -> render.
      const flip = seat === "atlas" ? 1 : -1;
      const mountX = seat === "atlas" ? -0.32 : 0.32;
      const wx = mountX + flip * ex, wy = flip * ey, wz = ez;
      const s = RENDER_SCALE;
      out.position[0] = wx * s; out.position[1] = wz * s; out.position[2] = -wy * s;
      // Direction ego -> render: world (flip x, flip y, z) -> render (flip x, z, -flip y).
      // three.js camera: +X right, +Y up, looks down -Z (so column Z = -forward).
      basisToQuat(flip * rx, rz, -flip * ry, flip * ux, uz, -flip * uy, -flip * fx, -fz, flip * fy, out.quaternion);
      out.fovDeg = clamp(settings.camera.fovDeg, 50, 80) + juice.fovOffsetDeg;
      return out;
    },
  };
  return rig;
}

export const createCockpitRig: CreateCockpitRig = () => createCockpitRigWith();
