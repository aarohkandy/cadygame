// src/game/policy/opponent/perception.ts (WP4)
// What the built-in opponent knows about the fight (GAME_DESIGN 5.5.3). It sees the opponent through a 1.5 s
// history delayed by the tier's perception lag, runs event detectors on that lagged view, and releases each
// detected event to Decision after a human reaction time (ex-Gaussian, 120 ms floor, measured from the event's
// true onset). Contacts are felt, not seen: they arrive with the observation. A decayed order-1/order-2 habit
// model predicts the player's next action; charge-release delays feed the heavy-guess rule.
//
// Nothing here reads a wall clock or Math.random: time is obs.t, randomness comes from the policy's seeded Rng.

import { GUARD_VOLUME_RADIUS, type Observation, type Vec3 } from "../../contracts.ts";
import { exGaussian, type Rng } from "../../core/rng.ts";
import { fkBodyOrigin } from "../../kinematics/so101-kinematics.ts";

/* ───────────────────────── constants (5.5.3) ───────────────────────── */

export const HISTORY_S = 1.5;
const ONSET_SPEED = 0.35;          // m/s toward the guard volume
const ONSET_HOLD_S = 0.04;
const FEINT_STOP_SPEED = 0.1;
const FEINT_WINDOW_S = 0.12;
const WHIFF_SPEED = 0.1;
const MIDLINE_X = 0.32;
const GUARD_HOLD_S = 0.3;
const SPACING_WINDOW_S = 0.3;
const SPACING_DELTA_M = 0.03;
const HISTORY_CAP = 160;
const RELEASE_DELAYS_KEPT = 12;

/** Player action symbols for the habit model. */
export const HABIT_SYMBOLS = ["J", "S", "H", "G", "F", "T", "A", "R"] as const;
export type HabitSymbol = (typeof HABIT_SYMBOLS)[number];
const SYM_INDEX: Readonly<Record<HabitSymbol, number>> = { J: 0, S: 1, H: 2, G: 3, F: 4, T: 5, A: 6, R: 7 };
export type Situation = "none" | "after_blocked" | "after_hit" | "after_whiff";
const SIT_INDEX: Readonly<Record<Situation, number>> = { none: 0, after_blocked: 1, after_hit: 2, after_whiff: 3 };

export type PerceptEventKind = "attack_onset" | "charge_public" | "whiff" | "feint_suspect" | "throw";

export interface PerceptEvent {
  kind: PerceptEventKind;
  /** True sim time the thing happened (onset of the motion). */
  t: number;
  /** When Decision may act on it. */
  releaseT: number;
  /** Symbol the player's action was classified as (attack onsets only). */
  symbol: HabitSymbol | null;
  /** Opponent EE position and velocity at the event (ego). */
  pos: Vec3; vel: Vec3;
  /** Expected contact time for attacks (constant-velocity estimate toward the guard volume). */
  impactT: number;
  /** Reaction drawn for this event (ms), for humanness stats. */
  reactionMs: number;
  /** Set on an attack onset once the same motion was seen to stop short (a feint), possibly before release. */
  feint: boolean;
}

interface Snap {
  t: number;
  oppEe: Vec3; oppVel: Vec3; oppWrist: Vec3; oppElbow: Vec3;
  oppCharge: number; oppGuard: boolean;
  selfWrist: Vec3;
}

export interface FeltContact {
  kind: Observation["contacts"][number]["kind"];
  attacker: "self" | "opponent" | null;
  damageToSelf: number; damageToOpponent: number;
  t: number;
}

export interface PerceptionTuning {
  lagMs: number;
  reaction: { mu: number; sigma: number; tau: number };
  halfLife: number;
  habitWeight: number;
}

const SHOULDER_ORIGIN: Vec3 = (() => {
  const o = fkBodyOrigin([0, 0, 0, 0, 0, 0], 1, new Float64Array(3));
  return [o[0], o[1], o[2]];
})();

function copy3(src: ArrayLike<number>, dst: Vec3): void { dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; }

/** Closest point on segment ab to p. */
export function closestOnSegment(a: Vec3, b: Vec3, p: ArrayLike<number>, out: Vec3): Vec3 {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let s = len2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  out[0] = a[0] + abx * s; out[1] = a[1] + aby * s; out[2] = a[2] + abz * s;
  return out;
}

/* ───────────────────────── habit model ───────────────────────── */

export interface HabitPrediction { symbol: HabitSymbol; p: number; evidence: number; }

export class HabitModel {
  private readonly o1 = new Float64Array(4 * 9 * 8);
  private readonly o2 = new Float64Array(4 * 9 * 9 * 8);
  private prev1 = 8;   // 8 = none
  private prev2 = 8;
  private decay = 1;
  situation: Situation = "none";
  readonly delays: number[] = [];

  reset(halfLife: number): void {
    this.o1.fill(0); this.o2.fill(0); this.prev1 = 8; this.prev2 = 8; this.situation = "none";
    this.decay = halfLife > 0 ? Math.pow(0.5, 1 / halfLife) : 0;
    this.delays.length = 0;
  }

  setHalfLife(halfLife: number): void { this.decay = halfLife > 0 ? Math.pow(0.5, 1 / halfLife) : 0; }

  observe(sym: HabitSymbol): void {
    const s = SIT_INDEX[this.situation];
    const x = SYM_INDEX[sym];
    for (let i = 0; i < this.o1.length; i++) this.o1[i] *= this.decay;
    for (let i = 0; i < this.o2.length; i++) this.o2[i] *= this.decay;
    this.o1[(s * 9 + this.prev1) * 8 + x] += 1;
    this.o2[((s * 9 + this.prev2) * 9 + this.prev1) * 8 + x] += 1;
    this.prev2 = this.prev1;
    this.prev1 = x;
    this.situation = "none";
  }

  predict(): HabitPrediction {
    const s = SIT_INDEX[this.situation];
    const base2 = ((s * 9 + this.prev2) * 9 + this.prev1) * 8;
    const base1 = (s * 9 + this.prev1) * 8;
    let total = 0;
    for (let x = 0; x < 8; x++) total += this.o2[base2 + x];
    const useO2 = total >= 2;
    const arr = useO2 ? this.o2 : this.o1;
    const base = useO2 ? base2 : base1;
    if (!useO2) { total = 0; for (let x = 0; x < 8; x++) total += arr[base + x]; }
    let best = 0, bestV = -1;
    for (let x = 0; x < 8; x++) if (arr[base + x] > bestV) { bestV = arr[base + x]; best = x; }
    // Laplace-smoothed so a single observation never reads as certainty.
    const p = total > 0 ? (bestV + 0.25) / (total + 2) : 0;
    return { symbol: HABIT_SYMBOLS[best], p, evidence: total };
  }

  /** Probability of a given next symbol under the current context (smoothed). */
  probabilityOf(sym: HabitSymbol): number {
    const s = SIT_INDEX[this.situation];
    const base = (s * 9 + this.prev1) * 8;
    let total = 0;
    for (let x = 0; x < 8; x++) total += this.o1[base + x];
    return total > 0 ? (this.o1[base + SYM_INDEX[sym]] + 0.25) / (total + 2) : 0;
  }

  noteReleaseDelay(ms: number): void {
    this.delays.push(ms);
    if (this.delays.length > RELEASE_DELAYS_KEPT) this.delays.shift();
  }
}

/* ───────────────────────── perception ───────────────────────── */

export interface PerceptionView {
  /** Lagged opponent state (what the AI "sees" now). */
  t: number; oppEe: Vec3; oppVel: Vec3; oppWrist: Vec3; oppElbow: Vec3; oppCharge: number; oppGuard: boolean;
  /** Closing speed of the lagged opponent EE toward our guard volume (m/s), and distance to it (m). */
  closingSpeed: number; guardDistance: number;
}

export class Perception {
  private readonly hist: Snap[] = [];
  private head = 0;
  private count = 0;
  private lastProcessedT = -Infinity;
  private prevSnapT = -1;
  private onsetCandidateT = -1;
  private activeOnset: PerceptEvent | null = null;
  private activeContact = false;
  private chargeStartT = -1;
  private chargeFullT = -1;
  private chargeEvent: PerceptEvent | null = null;
  private guardHoldStart = -1;
  private guardHoldEmitted = false;
  private spacingRefT = -1;
  private spacingRefX = 0;
  private low = false;
  private readonly pending: PerceptEvent[] = [];
  readonly habit = new HabitModel();
  readonly view: PerceptionView = {
    t: 0, oppEe: [0.44, 0, 0.15], oppVel: [0, 0, 0], oppWrist: [0.44, 0, 0.15], oppElbow: [0.5, 0, 0.2],
    oppCharge: 0, oppGuard: false, closingSpeed: 0, guardDistance: 1,
  };
  readonly felt: FeltContact[] = [];
  tuning: PerceptionTuning = { lagMs: 90, reaction: { mu: 260, sigma: 35, tau: 90 }, halfLife: 15, habitWeight: 1 };
  /** Reactions drawn so far this round (ms), for humanness tests and debug. */
  readonly reactionLog: number[] = [];
  private readonly nearest: Vec3 = [0, 0, 0];

  constructor() {
    for (let i = 0; i < HISTORY_CAP; i++) {
      this.hist.push({ t: -1, oppEe: [0, 0, 0], oppVel: [0, 0, 0], oppWrist: [0, 0, 0], oppElbow: [0, 0, 0], oppCharge: 0, oppGuard: false, selfWrist: [0, 0, 0] });
    }
  }

  reset(tuning: PerceptionTuning, keepHabits: boolean): void {
    this.tuning = tuning;
    this.head = 0; this.count = 0; this.lastProcessedT = -Infinity; this.prevSnapT = -1;
    this.onsetCandidateT = -1; this.activeOnset = null; this.activeContact = false;
    this.chargeStartT = -1; this.chargeFullT = -1; this.chargeEvent = null; this.guardHoldStart = -1; this.guardHoldEmitted = false;
    this.spacingRefT = -1; this.low = false;
    this.pending.length = 0; this.felt.length = 0; this.reactionLog.length = 0;
    if (keepHabits) this.habit.setHalfLife(tuning.halfLife * tuning.habitWeight);
    else this.habit.reset(tuning.halfLife * tuning.habitWeight);
  }

  /** Ingests one observation, runs detectors up to the lagged time, and queues released events. */
  ingest(obs: Observation, rng: Rng, blockBias: boolean): void {
    const snap = this.hist[this.head];
    this.head = (this.head + 1) % HISTORY_CAP;
    if (this.count < HISTORY_CAP) this.count++;
    snap.t = obs.t;
    copy3(obs.opponent.ee.pos, snap.oppEe); copy3(obs.opponent.ee.linvel, snap.oppVel);
    copy3(obs.opponent.wrist_pos, snap.oppWrist); copy3(obs.opponent.elbow_pos, snap.oppElbow);
    snap.oppCharge = obs.opponent.charge_public; snap.oppGuard = obs.opponent.guard;
    copy3(obs.self.wrist_pos, snap.selfWrist);

    this.felt.length = 0;
    for (const c of obs.contacts) {
      this.felt.push({ kind: c.kind, attacker: c.attacker, damageToSelf: c.damage_to_self, damageToOpponent: c.damage_to_opponent, t: c.t });
      if (c.attacker === "opponent" && (c.kind === "strike" || c.kind === "graze" || c.kind === "clash" || c.kind === "deflect" || c.kind === "cube_hit")) {
        this.activeContact = true;
        this.habit.situation = c.kind === "deflect" ? "after_blocked" : "after_hit";
      }
      if (c.kind === "cube_hit" && c.attacker === "opponent") this.queue("throw", c.t, c.t, null, snap.oppEe, snap.oppVel, rng, false, 0);
    }

    const lagT = obs.t - this.tuning.lagMs / 1000;
    // Process every snapshot that became visible since last time, oldest first.
    const n = this.count;
    for (let k = n - 1; k >= 0; k--) {
      const s = this.hist[(this.head - 1 - k + HISTORY_CAP * 2) % HISTORY_CAP];
      if (s.t <= this.lastProcessedT || s.t > lagT) continue;
      this.detect(s, rng, blockBias);
      this.lastProcessedT = s.t;
      this.updateView(s);
    }
  }

  private updateView(s: Snap): void {
    const v = this.view;
    v.t = s.t;
    copy3(s.oppEe, v.oppEe); copy3(s.oppVel, v.oppVel); copy3(s.oppWrist, v.oppWrist); copy3(s.oppElbow, v.oppElbow);
    v.oppCharge = s.oppCharge; v.oppGuard = s.oppGuard;
    closestOnSegment(SHOULDER_ORIGIN, s.selfWrist, s.oppEe, this.nearest);
    const dx = this.nearest[0] - s.oppEe[0], dy = this.nearest[1] - s.oppEe[1], dz = this.nearest[2] - s.oppEe[2];
    const d = Math.hypot(dx, dy, dz);
    v.guardDistance = Math.max(0, d - GUARD_VOLUME_RADIUS);
    v.closingSpeed = d > 1e-6 ? (s.oppVel[0] * dx + s.oppVel[1] * dy + s.oppVel[2] * dz) / d : 0;
  }

  private detect(s: Snap, rng: Rng, blockBias: boolean): void {
    this.detectInner(s, rng, blockBias);
    this.prevSnapT = s.t;
  }

  private detectInner(s: Snap, rng: Rng, blockBias: boolean): void {
    this.updateView(s);
    const v = this.view;
    const speed = Math.hypot(s.oppVel[0], s.oppVel[1], s.oppVel[2]);

    // Public charge: a heavy is coming (4.7). Track start, full, and release for the heavy-guess model.
    if (s.oppCharge > 0) {
      if (this.chargeStartT < 0) {
        this.chargeStartT = s.t;
        this.chargeEvent = this.queue("charge_public", s.t, s.t, "S", s.oppEe, s.oppVel, rng, blockBias, s.t + 0.6);
      }
      if (s.oppCharge >= 0.999 && this.chargeFullT < 0) this.chargeFullT = s.t;
    } else if (this.chargeStartT >= 0) {
      const released = v.closingSpeed > ONSET_SPEED || speed > 0.5;
      if (released) {
        const fullT = this.chargeFullT >= 0 ? this.chargeFullT : s.t;
        this.habit.noteReleaseDelay(Math.max(0, (s.t - fullT) * 1000));
      } else {
        if (this.chargeEvent) this.chargeEvent.feint = true;
        this.queue("feint_suspect", s.t, s.t, "F", s.oppEe, s.oppVel, rng, false, 0);
      }
      this.chargeStartT = -1; this.chargeFullT = -1; this.chargeEvent = null;
    }

    // Attack onset: closing on our guard volume above 0.35 m/s for 40 ms.
    if (v.closingSpeed > ONSET_SPEED) {
      // The motion began somewhere between the last calm sample and this one: take the midpoint as its onset.
      if (this.onsetCandidateT < 0) this.onsetCandidateT = this.prevSnapT >= 0 && s.t - this.prevSnapT < 0.1 ? (this.prevSnapT + s.t) / 2 : s.t;
      if (!this.activeOnset && s.t - this.onsetCandidateT >= ONSET_HOLD_S - 1e-9) {
        const lateral = Math.abs(s.oppVel[1]) > Math.abs(s.oppVel[0]) * 1.2;
        const sym: HabitSymbol = lateral ? "H" : "J";
        const eta = v.closingSpeed > 0.05 ? v.guardDistance / v.closingSpeed : 0.3;
        this.activeOnset = this.queue("attack_onset", this.onsetCandidateT, s.t, sym, s.oppEe, s.oppVel, rng, blockBias, s.t + Math.min(0.4, eta));
        this.activeContact = false;
        this.habit.observe(sym);
      }
    } else {
      this.onsetCandidateT = -1;
    }

    // An onset that stops dead within 120 ms with no contact was a feint; one that ends past the midline with
    // no contact was a whiff.
    const onset = this.activeOnset;
    if (onset && speed < Math.max(FEINT_STOP_SPEED, WHIFF_SPEED)) {
      if (!this.activeContact) {
        if (s.t - onset.t <= FEINT_WINDOW_S + ONSET_HOLD_S) {
          onset.feint = true;
          this.queue("feint_suspect", s.t, s.t, null, s.oppEe, s.oppVel, rng, false, 0);
          this.habit.observe("F");
        } else if (s.oppEe[0] < MIDLINE_X) {
          this.queue("whiff", s.t, s.t, null, s.oppEe, s.oppVel, rng, false, 0);
          this.habit.situation = "after_whiff";
        }
      }
      this.activeOnset = null;
    }

    // Guard hold (G): Arcade guard intent, or a slow hand parked on its own side in stock presets.
    const holding = s.oppGuard || (speed < 0.12 && s.oppEe[0] > 0.40);
    if (holding) {
      if (this.guardHoldStart < 0) { this.guardHoldStart = s.t; this.guardHoldEmitted = false; }
      if (!this.guardHoldEmitted && s.t - this.guardHoldStart >= GUARD_HOLD_S) { this.habit.observe("G"); this.guardHoldEmitted = true; }
    } else {
      this.guardHoldStart = -1;
    }

    // Cube / Core work (T): the hand low on the table.
    if (s.oppEe[2] < 0.06) {
      if (!this.low) { this.habit.observe("T"); this.low = true; }
    } else if (s.oppEe[2] > 0.08) {
      this.low = false;
    }

    // Spacing (A / R): net travel toward or away from us over 300 ms.
    if (this.spacingRefT < 0) { this.spacingRefT = s.t; this.spacingRefX = s.oppEe[0]; }
    else if (s.t - this.spacingRefT >= SPACING_WINDOW_S) {
      const dx = s.oppEe[0] - this.spacingRefX;
      if (!this.activeOnset && Math.abs(dx) > SPACING_DELTA_M) this.habit.observe(dx < 0 ? "A" : "R");
      this.spacingRefT = s.t; this.spacingRefX = s.oppEe[0];
    }
  }

  private queue(kind: PerceptEventKind, t: number, detectedT: number, symbol: HabitSymbol | null, pos: Vec3, vel: Vec3, rng: Rng, blockBias: boolean, impactT: number): PerceptEvent {
    const r = this.tuning.reaction;
    const mu = blockBias ? r.mu * 0.8 : r.mu;
    const reaction = exGaussian(rng, mu, r.sigma, r.tau);
    // The event can never be acted on before it was visible (detection already includes the perception lag).
    const releaseT = Math.max(t + reaction / 1000, detectedT + this.tuning.lagMs / 1000);
    const e: PerceptEvent = { kind, t, releaseT, symbol, pos: [pos[0], pos[1], pos[2]], vel: [vel[0], vel[1], vel[2]], impactT, reactionMs: (releaseT - t) * 1000, feint: false };
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].releaseT > releaseT) i--;
    this.pending.splice(i, 0, e);
    if (kind === "attack_onset" || kind === "charge_public") this.reactionLog.push(e.reactionMs);
    return e;
  }

  /** Pops the next event released at or before t, or null. */
  popReleased(t: number): PerceptEvent | null {
    if (this.pending.length === 0 || this.pending[0].releaseT > t + 1e-9) return null;
    return this.pending.shift() as PerceptEvent;
  }

  /** Mean or sampled release delay past full charge (ms) for the heavy-guess rule. */
  expectedReleaseDelayMs(rng: Rng): number {
    const d = this.habit.delays;
    if (d.length === 0) return 250;
    return d[rng.int(d.length)];
  }

  get chargeStart(): number { return this.chargeStartT; }
}
