// src/game/harness/moment-buffer.ts (WP5)
// The last 6.0 s of SimState at 50 Hz (GAME_DESIGN 5.8), for earned round and match replays that must not
// need the episode file. A fixed ring of preallocated states: push copies into the oldest slot and never
// allocates once the ring is full. clip() returns independent copies in time order.

import type { MomentBuffer, MomentClip, SimState } from "../contracts.ts";

export const MOMENT_SECONDS = 6.0;
export const MOMENT_HZ = 50;

export interface MomentBufferExtras {
  /** States currently held. */
  readonly size: number;
  readonly capacity: number;
  /** Oldest and newest held sim times, or null when empty. */
  span(): { from: number; to: number } | null;
}

function allocLike(s: SimState): SimState {
  return {
    time: 0, qpos: new Float64Array(s.qpos.length), qvel: new Float64Array(s.qvel.length), ctrl: new Float64Array(s.ctrl.length),
    qacc_warmstart: new Float64Array(s.qacc_warmstart.length), servo: new Float64Array(s.servo.length),
  };
}

function sameShape(a: SimState, b: SimState): boolean {
  return a.qpos.length === b.qpos.length && a.qvel.length === b.qvel.length && a.ctrl.length === b.ctrl.length
    && a.qacc_warmstart.length === b.qacc_warmstart.length && a.servo.length === b.servo.length;
}

function copyInto(dst: SimState, src: SimState): void {
  dst.time = src.time;
  dst.qpos.set(src.qpos); dst.qvel.set(src.qvel); dst.ctrl.set(src.ctrl);
  dst.qacc_warmstart.set(src.qacc_warmstart); dst.servo.set(src.servo);
}

function cloneState(s: SimState): SimState {
  const out = allocLike(s);
  copyInto(out, s);
  return out;
}

export function createMomentBuffer(seconds = MOMENT_SECONDS, hz = MOMENT_HZ): MomentBuffer & MomentBufferExtras {
  // One extra slot so a full window of `seconds` is always covered at both ends.
  const capacity = Math.max(2, Math.ceil(seconds * hz) + 1);
  const slots: (SimState | null)[] = new Array<SimState | null>(capacity).fill(null);
  const times = new Float64Array(capacity);
  let head = 0;      // next write position
  let size = 0;

  const indexAt = (k: number) => (head - size + k + capacity) % capacity;   // k = 0 oldest

  const buffer: MomentBuffer & MomentBufferExtras = {
    get size() { return size; },
    capacity,

    push(t: number, sim: SimState): void {
      if (size > 0 && t < times[indexAt(size - 1)]) size = 0;   // time went backwards: a reset, start over
      let slot = slots[head];
      if (!slot || !sameShape(slot, sim)) slot = slots[head] = allocLike(sim);
      copyInto(slot, sim);
      times[head] = t;
      head = (head + 1) % capacity;
      if (size < capacity) size++;
    },

    clip(eventT: number, beforeS: number, afterS: number): MomentClip {
      const clip: MomentClip = { frames: [], times: [], eventT };
      const lo = eventT - beforeS - 1e-9;
      const hi = eventT + afterS + 1e-9;
      for (let k = 0; k < size; k++) {
        const i = indexAt(k);
        const t = times[i];
        if (t < lo || t > hi) continue;
        clip.frames.push(cloneState(slots[i] as SimState));
        clip.times.push(t);
      }
      return clip;
    },

    clear(): void {
      head = 0;
      size = 0;
    },

    span() {
      if (size === 0) return null;
      return { from: times[indexAt(0)], to: times[indexAt(size - 1)] };
    },
  };
  return buffer;
}
