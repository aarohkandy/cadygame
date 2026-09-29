// src/game/policy/opponent/motor.ts (WP4)
// Task-space pose → six joint targets (GAME_DESIGN 5.5.2 "Output", research 2.7). The tip solver is WP2's
// analytic kinematics (full FK including roll, damped least squares), warm-started from the previous solution.
// Targets are clamped 0.01 rad inside JOINT_LIMITS, so the built-in AI never logs a violation. Unreachable
// poses resolve to the closest reachable one; the servo, not the motor, smooths the result.

import { GRIP_CLOSED, type So101Kinematics, type Vec3 } from "../../contracts.ts";
import { createKinematics } from "../../kinematics/so101-kinematics.ts";
import { clampToLimits } from "../action-validation.ts";
import type { Pose } from "./primitives.ts";

export const MOTOR_LIMIT_MARGIN = 0.01;
const TABLE_CLEARANCE_Z = 0.018;
/** Pitch relaxations tried in order (rad): nearest first, toward horizontal before toward vertical. */
const PITCH_OFFSETS: readonly number[] = [0, 0.15, -0.15, 0.3, 0.45, -0.3, 0.6, 0.8, 1.0, 1.2, -0.5];
const PITCH_LIMIT = 1.6;

export class Motor {
  private readonly kin: So101Kinematics;
  private readonly seed = new Float64Array(6);
  private readonly out = new Float64Array(6);
  private readonly target: Vec3 = [0, 0, 0];
  /** Last IK residual (m). */
  lastErrorM = 0;
  /** Wrist pitch actually used by the last solve. */
  pitchUsed = 0;
  private askedPitch = Number.NaN;
  private relaxed = false;
  private fallbackErr = Infinity;
  private fallbackPitch = 0;

  constructor(kinematics: So101Kinematics = createKinematics()) {
    this.kin = kinematics;
  }

  reset(home: ArrayLike<number>): void {
    for (let j = 0; j < 6; j++) this.seed[j] = home[j] ?? 0;
    this.seed[4] = 0;
    this.seed[5] = GRIP_CLOSED;
    this.askedPitch = Number.NaN;
    this.relaxed = false;
  }

  /**
   * Solves one pose and writes clamped joint targets into `out` (length ≥ 6). A wrist pitch the arm cannot hold at
   * that point (straight down far out, say) is relaxed toward the nearest pitch that reaches it exactly, so the
   * hand always goes where it was sent and the solution never flips branch between neighbouring poses.
   */
  solve(p: Pose, out: number[] | Float64Array): void {
    this.target[0] = p.x;
    this.target[1] = p.y;
    this.target[2] = Math.max(TABLE_CLEARANCE_Z, p.z);
    this.seed[4] = 0;
    this.seed[5] = p.grip;
    let bestErr = Infinity;
    let bestPitch = p.pitch;
    let solvedPitch = Number.NaN;              // the pitch whose solution is currently in this.out
    // Hysteresis: while the asked pitch stays put and the pitch relaxed last tick still reaches the point, keep it.
    // Re-searching every tick lets the choice flip across a feasibility edge and swing the wrist a full radian.
    if (this.relaxed && Math.abs(p.pitch - this.askedPitch) < 1e-6 && this.pitchUsed !== p.pitch) {
      const res = this.kin.solveTipEgo(this.target, this.pitchUsed, this.seed, this.out);
      solvedPitch = this.pitchUsed;
      if (res.ok) { bestErr = res.errorM; bestPitch = this.pitchUsed; }
    }
    for (let i = 0; i < PITCH_OFFSETS.length && bestErr === Infinity; i++) {
      const pitch = p.pitch + PITCH_OFFSETS[i];
      if (pitch < -PITCH_LIMIT || pitch > PITCH_LIMIT) continue;
      const res = this.kin.solveTipEgo(this.target, pitch, this.seed, this.out);
      solvedPitch = pitch;
      if (res.ok) { bestErr = res.errorM; bestPitch = pitch; break; }
      if (res.errorM < this.fallbackErr - 1e-9) { this.fallbackErr = res.errorM; this.fallbackPitch = pitch; }
    }
    if (bestErr === Infinity) { bestErr = this.fallbackErr; bestPitch = this.fallbackPitch; }
    this.fallbackErr = Infinity;
    this.askedPitch = p.pitch;
    this.relaxed = bestPitch !== p.pitch;
    if (bestPitch !== solvedPitch) this.kin.solveTipEgo(this.target, bestPitch, this.seed, this.out);
    this.lastErrorM = bestErr;
    this.pitchUsed = bestPitch;
    const finite = Number.isFinite(this.out[0]) && Number.isFinite(this.out[1]) && Number.isFinite(this.out[2]) && Number.isFinite(this.out[3]);
    if (finite) for (let j = 0; j < 4; j++) this.seed[j] = this.out[j];
    for (let j = 0; j < 6; j++) out[j] = this.seed[j];
    out[4] = p.roll ?? 0;
    out[5] = p.grip;
    clampToLimits(out, MOTOR_LIMIT_MARGIN);
  }

}
