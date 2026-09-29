// src/game/combat/servo-states.ts (WP2)
// The Arcade servo state machine (GAME_DESIGN 4.6): state scales, durations, immunity, the knockback detector, and
// the Offline state every preset applies at KO. Transitions emit `servo_state` events through the caller's sink.
import type {
  ArmFrame, GameEvent, LoadoutId, Seat, SeatCombatState, ServoProfile, ServoStateId,
} from "../contracts.ts";
import { LOADOUTS, tuning, vFreeFor } from "./tuning.ts";

const ST = tuning.arcade.states;
const KB = tuning.arcade.knockback;

export type ServoCause = Extract<GameEvent, { type: "servo_state" }>["cause"];

export const STATE_SCALES: Readonly<Record<ServoStateId, Readonly<ServoProfile>>> = Object.freeze({
  normal: Object.freeze({ tauScale: 1, kpScale: 1, kvScale: 1 }),
  micro_stagger: Object.freeze({ tauScale: ST.micro.tau, kpScale: ST.micro.kp, kvScale: ST.micro.kv }),
  stagger: Object.freeze({ tauScale: ST.stagger.tau, kpScale: ST.stagger.kp, kvScale: ST.stagger.kv }),
  stun: Object.freeze({ tauScale: ST.stun.tau, kpScale: ST.stun.kp, kvScale: ST.stun.kv }),
  cutout: Object.freeze({ tauScale: ST.cutout.tau, kpScale: ST.cutout.kp, kvScale: ST.cutout.kv }),
  offline: Object.freeze({ tauScale: ST.offline.tau, kpScale: ST.offline.kp, kvScale: ST.offline.kv }),
});

/** Strike stagger: (180 + 8·dmg) ms × staggerRecv, capped at 450 ms. */
export function strikeStaggerMs(damage: number, loadout: LoadoutId): number {
  return Math.min(ST.stagger.maxMs, (ST.stagger.baseMs + ST.stagger.perDamageMs * damage) * LOADOUTS[loadout].staggerRecv);
}

export function knockbackStaggerMs(loadout: LoadoutId): number {
  return ST.stagger.knockbackMs * LOADOUTS[loadout].staggerRecv;
}

/** A fresh Stagger may start from Normal or Micro-stagger, outside immunity. Stun, Cutout and Offline are not overridden. */
export function canBeStaggered(s: SeatCombatState): boolean {
  return (s.servoState === "normal" || s.servoState === "micro_stagger") && s.staggerImmuneMs <= 0;
}

/** Guard is unavailable while Stunned or Offline, and during the first 60% of a Stagger. */
export function guardAllowed(s: SeatCombatState): boolean {
  if (s.servoState === "stun" || s.servoState === "offline") return false;
  if (s.servoState === "stagger") {
    const elapsed = s.servoStateTotalMs - s.servoStateRemainingMs;
    return elapsed >= ST.stagger.guardAfterFrac * s.servoStateTotalMs;
  }
  return true;
}

/** Deflect needs the defender outside Stun, Stagger, Cutout (and alive). */
export function deflectAllowed(s: SeatCombatState): boolean {
  return s.servoState === "normal" || s.servoState === "micro_stagger";
}

export type EventSink = (e: GameEvent) => void;

/** Enters `state` for `ms` and emits the transition. Offline is permanent for the round. */
export function enterState(s: SeatCombatState, seat: Seat, state: ServoStateId, ms: number, cause: ServoCause, t: number, step: number, emit: EventSink): void {
  if (s.servoState === "offline") return;
  s.servoState = state;
  s.servoStateTotalMs = state === "offline" || state === "normal" ? 0 : ms;
  s.servoStateRemainingMs = s.servoStateTotalMs;
  if (state !== "stagger") s.staggerFollowUps = 0;
  emit({ type: "servo_state", t, step, seat, state, durationMs: s.servoStateTotalMs, cause });
}

/**
 * Ends the current timed state now (natural end, second strike or burst). Stagger and Stun grant 900 ms of stagger
 * immunity. Returns the state that ended.
 */
export function endState(s: SeatCombatState, seat: Seat, cause: ServoCause, t: number, step: number, emit: EventSink): ServoStateId {
  const ended = s.servoState;
  if (ended === "normal" || ended === "offline") return ended;
  if (ended === "stagger" || ended === "stun") s.staggerImmuneMs = ST.immunityMs;
  s.staggerFollowUps = 0;
  enterState(s, seat, "normal", 0, cause, t, step, emit);
  return ended;
}

/* ───────────────────────── knockback detector (4.6 trigger c) ───────────────────────── */

export interface KnockbackInput {
  arm: ArmFrame; t: number; dt: number; loadout: LoadoutId;
  lastCrossContactT: number;         // −1 none
  lastGuardEdgeT: number;            // press or release, −∞ none
  eligibleState: boolean;            // not Stun, Stagger, Micro-stagger, Cutout, Offline
}

export interface KnockbackDetector {
  reset(): void;
  /** Once per physics step. True on the step the 120 ms hold completes. */
  step(input: KnockbackInput): boolean;
  readonly heldMs: number;
}

export function createKnockbackDetector(): KnockbackDetector {
  const CAP = 512;                                 // ring of |error| per joint; covers 60 ms at any supported timestep
  const errRing = new Float64Array(5 * CAP);
  const ctrlRing = new Float64Array(5 * CAP);
  let head = 0, filled = 0;
  let heldS = 0;
  let lastCommandStepT = Number.NEGATIVE_INFINITY;

  function back(ring: Float64Array, joint: number, stepsBack: number): number {
    const idx = (head - 1 - stepsBack + CAP * 4) % CAP;
    return ring[joint * CAP + idx];
  }

  return {
    get heldMs() { return heldS * 1000; },
    reset() { head = 0; filled = 0; heldS = 0; lastCommandStepT = Number.NEGATIVE_INFINITY; },
    step(i) {
      const { arm, t, dt } = i;
      for (let j = 0; j < 5; j++) {
        errRing[j * CAP + head] = Math.abs(arm.ctrl[j] - arm.q[j]);
        ctrlRing[j * CAP + head] = arm.ctrl[j];
      }
      head = (head + 1) % CAP;
      if (filled < CAP) filled++;

      // Command step: any arm ctrl moving > 0.20 rad within one 50 Hz control tick.
      const tickSteps = Math.min(filled - 1, Math.max(1, Math.round(KB.commandTickMs / 1000 / dt)));
      if (tickSteps > 0) {
        for (let j = 0; j < 5; j++) {
          if (Math.abs(back(ctrlRing, j, 0) - back(ctrlRing, j, tickSteps)) > KB.commandStepRad) { lastCommandStepT = t; break; }
        }
      }

      let ok = i.eligibleState
        && i.lastCrossContactT >= 0 && t - i.lastCrossContactT <= KB.contactWindowMs / 1000 + 1e-9
        && t - i.lastGuardEdgeT > KB.guardEdgeQuietMs / 1000
        && t - lastCommandStepT > KB.commandStepQuietMs / 1000;
      if (ok) {
        let jMax = 0, eMax = -1;
        for (let j = 0; j < 5; j++) {
          const e = back(errRing, j, 0);
          if (e > eMax) { eMax = e; jMax = j; }
        }
        const signedErr = arm.ctrl[jMax] - arm.q[jMax];
        const lagSteps = Math.round(KB.nonDecreasingMs / 1000 / dt);
        const qd = arm.qd[jMax];
        ok = eMax > KB.errorMin
          && filled > lagSteps && eMax >= back(errRing, jMax, lagSteps)
          && (
            (Math.sign(qd) !== Math.sign(signedErr) && Math.abs(qd) >= KB.awaySpeedMin)
            || Math.abs(qd) < KB.freeFrac * vFreeFor(i.loadout, jMax, eMax)
          );
      }
      if (!ok) { heldS = 0; return false; }
      const before = heldS;
      heldS += dt;
      const need = KB.holdMs / 1000 - 1e-9;
      return before < need && heldS >= need;
    },
  };
}
