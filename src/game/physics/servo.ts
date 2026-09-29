// src/game/physics/servo.ts (WP2)
// Writes servo parameters into a compiled model: the per-mode base (stock Menagerie or an Arcade loadout, 4.8/4.10) at
// reset, and composed runtime profiles for the 5 arm actuators (4.6). The gripper actuator is always stock.
import type { MjModel } from "@mujoco/mujoco";
import {
  SEATS,
  type LoadoutId, type PhysicsMode, type Seat, type ServoProfile,
} from "../contracts.ts";
import { LOADOUTS, STOCK_SERVO, TAU_CAP_NM, tuning, type ServoParams } from "../combat/tuning.ts";
import { ARM_ACTUATORS, ARM_JOINTS, type ModelIndex } from "./model-index.ts";

export const OFFLINE_PROFILE: Readonly<ServoProfile> = Object.freeze({
  tauScale: tuning.arcade.states.offline.tau, kpScale: tuning.arcade.states.offline.kp, kvScale: tuning.arcade.states.offline.kv,
});

export function isOfflineProfile(p: ServoProfile): boolean {
  return p.tauScale === OFFLINE_PROFILE.tauScale && p.kpScale === OFFLINE_PROFILE.kpScale && p.kvScale === OFFLINE_PROFILE.kvScale;
}

export function isIdentityProfile(p: ServoProfile): boolean {
  return p.tauScale === 1 && p.kpScale === 1 && p.kvScale === 1;
}

/** Base parameters for a seat's arm actuators in a physics mode. */
export function baseServoFor(mode: PhysicsMode, loadout: LoadoutId): Readonly<ServoParams> {
  return mode === "arcade" ? LOADOUTS[loadout] : STOCK_SERVO;
}

/** SimState.servo layout: [kp, kv, forcerangeHi] per actuator, in actuator id order. */
export const SERVO_STRIDE = 3;

function writeActuator(model: MjModel, id: number, kp: number, kv: number, tau: number): void {
  const gain = model.actuator_gainprm as Float64Array;
  const bias = model.actuator_biasprm as Float64Array;
  const range = model.actuator_forcerange as Float64Array;
  gain[id * 10] = kp;
  bias[id * 10 + 1] = -kp;
  bias[id * 10 + 2] = -kv;
  range[id * 2] = -tau;
  range[id * 2 + 1] = tau;
}

/** Resets every actuator and arm dof to the mode's base parameters. */
export function writeBaseServo(model: MjModel, index: ModelIndex, mode: PhysicsMode, loadouts: Readonly<Record<Seat, LoadoutId>>): void {
  const damping = model.dof_damping as Float64Array;
  const armature = model.dof_armature as Float64Array;
  for (const seat of SEATS) {
    const base = baseServoFor(mode, loadouts[seat]);
    for (let j = 0; j < ARM_JOINTS; j++) {
      const arm = j < ARM_ACTUATORS;
      const p = arm ? base : STOCK_SERVO;
      writeActuator(model, index.actuatorId[seat][j], p.kp, p.kv, p.tauMax);
      const dof = index.armDofAdr[seat][j];
      damping[dof] = p.damping;
      armature[dof] = p.armature;
    }
  }
}

/** Applies a composed profile to a seat's 5 arm actuators relative to its base; |τ| is capped at 8.0 N·m. */
export function writeProfile(model: MjModel, index: ModelIndex, seat: Seat, base: Readonly<ServoParams>, profile: ServoProfile): void {
  const tau = Math.min(TAU_CAP_NM, base.tauMax * profile.tauScale);
  const kp = base.kp * profile.kpScale;
  const kv = base.kv * profile.kvScale;
  for (let j = 0; j < ARM_ACTUATORS; j++) writeActuator(model, index.actuatorId[seat][j], kp, kv, tau);
}

export function readServo(model: MjModel, nu: number, out: Float64Array): Float64Array {
  const gain = model.actuator_gainprm as Float64Array;
  const bias = model.actuator_biasprm as Float64Array;
  const range = model.actuator_forcerange as Float64Array;
  for (let i = 0; i < nu; i++) {
    out[i * SERVO_STRIDE] = gain[i * 10];
    out[i * SERVO_STRIDE + 1] = -bias[i * 10 + 2];
    out[i * SERVO_STRIDE + 2] = range[i * 2 + 1];
  }
  return out;
}

export function writeServo(model: MjModel, nu: number, servo: ArrayLike<number>): void {
  for (let i = 0; i < nu; i++) {
    writeActuator(model, i, servo[i * SERVO_STRIDE], servo[i * SERVO_STRIDE + 1], servo[i * SERVO_STRIDE + 2]);
  }
}
