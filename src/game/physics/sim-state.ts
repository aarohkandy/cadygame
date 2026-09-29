// src/game/physics/sim-state.ts (WP2)
// Exact save/restore of the integration state (qpos, qvel, ctrl, qacc_warmstart, time) plus the servo parameters that
// Arcade edits at runtime, and the FNV-1a checksum used by checkpoints and verify (5.8, 5.9).
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import type { SimState } from "../contracts.ts";
import { readServo, SERVO_STRIDE, writeServo } from "./servo.ts";

export function allocSimState(nq: number, nv: number, nu: number): SimState {
  return {
    time: 0, qpos: new Float64Array(nq), qvel: new Float64Array(nv), ctrl: new Float64Array(nu),
    qacc_warmstart: new Float64Array(nv), servo: new Float64Array(nu * SERVO_STRIDE),
  };
}

function fits(s: SimState, nq: number, nv: number, nu: number): boolean {
  return s.qpos.length === nq && s.qvel.length === nv && s.ctrl.length === nu && s.qacc_warmstart.length === nv
    && s.servo.length === nu * SERVO_STRIDE;
}

export function saveSimState(model: MjModel, data: MjData, out?: SimState): SimState {
  const nq = model.nq, nv = model.nv, nu = model.nu;
  const s = out && fits(out, nq, nv, nu) ? out : allocSimState(nq, nv, nu);
  s.time = data.time;
  s.qpos.set(data.qpos as Float64Array);
  s.qvel.set(data.qvel as Float64Array);
  s.ctrl.set(data.ctrl as Float64Array);
  s.qacc_warmstart.set(data.qacc_warmstart as Float64Array);
  readServo(model, nu, s.servo);
  return s;
}

/** Writes the state and runs mj_forward so every derived quantity (xpos, contacts, sensors) matches it. */
export function restoreSimState(mujoco: MainModule, model: MjModel, data: MjData, state: SimState): void {
  if (!fits(state, model.nq, model.nv, model.nu)) {
    throw new Error(`SimState does not match the loaded model (nq ${model.nq}, nv ${model.nv}, nu ${model.nu})`);
  }
  writeServo(model, model.nu, state.servo);
  data.time = state.time;
  (data.qpos as Float64Array).set(state.qpos);
  (data.qvel as Float64Array).set(state.qvel);
  (data.ctrl as Float64Array).set(state.ctrl);
  (data.qacc_warmstart as Float64Array).set(state.qacc_warmstart);
  mujoco.mj_forward(model, data);
  // mj_forward leaves the warm start alone today; writing it again keeps the next mj_step bit-exact regardless.
  (data.qacc_warmstart as Float64Array).set(state.qacc_warmstart);
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvBytes(h: number, arr: Float64Array): number {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME);
  }
  return h;
}

/** FNV-1a 32 over the little-endian bytes of qpos ∥ qvel ∥ ctrl. Unsigned. */
export function checksumArrays(qpos: Float64Array, qvel: Float64Array, ctrl: Float64Array): number {
  let h = FNV_OFFSET;
  h = fnvBytes(h, qpos);
  h = fnvBytes(h, qvel);
  h = fnvBytes(h, ctrl);
  return h >>> 0;
}

export function checksumData(data: MjData): number {
  return checksumArrays(data.qpos as Float64Array, data.qvel as Float64Array, data.ctrl as Float64Array);
}
