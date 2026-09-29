// src/game/policy/opponent/layers.ts (WP4)
// The opponent's motion language (EMOTION_BIBLE 4.1, 4.4) as additive joint-space layers over the behaviour's
// commanded pose: q_cmd = q_base + q_affect + q_breath + q_gaze + q_react, plus the tell pose of the primitive in
// flight and the temperament's target shaping (command overshoot rings, follow-through lag). Breathing and gaze
// attenuate to 0.3 during a tell and to 0 while a strike is live, so the tell and the strike read. Nothing here is
// ever still: the layers are the life metric. All randomness is the seeded Rng, drawn only on committed ticks.

import { GRIP_CLOSED, GRIP_OPEN, type Vec3 } from "../../contracts.ts";
import type { Rng } from "../../core/rng.ts";
import { clampToLimits } from "../action-validation.ts";
import { MOTOR_LIMIT_MARGIN } from "./motor.ts";
import type { Temperament } from "./personalities.ts";
import type { Pose } from "./primitives.ts";

export type GazeTarget = "gripper" | "camera" | "core" | "away";
export type GazeKind = "glance" | "look" | "track";
export interface GazeEvent { t: number; target: GazeTarget; kind: GazeKind; onAim: boolean; }

/** What the behaviour is doing this tick, for attenuation and the tell pose. */
export interface MotionState {
  /** "idle" (guard), "windup", "active", "follow", "recover" or "transition" (between rounds). */
  phase: "idle" | "windup" | "active" | "follow" | "recover" | "transition";
  /** Primitive whose tell pose applies during the wind-up (null: none). */
  tell: "POKE" | "JAB" | "HOOK" | "SLAM" | "GRAB" | null;
  /** Lateral side (+1 toward +y) for the HOOK tell. */
  side: number;
}

export interface LayerInputs {
  arousal: number; valence: number; stance: number;
  /** Player's gripper, camera eye, the Core and the aim point, all ego (m). */
  gripper: Vec3; camera: Vec3; core: Vec3 | null; aim: Vec3;
  /** Side the player sits on (+1: their hand is at +y), for the closed-stance turn away. */
  awaySide: number;
  motion: MotionState;
}

const LIFT = 1, ELBOW = 2, WRIST = 3, ROLL = 4, PAN = 0, JAW = 5;
const GATE_TAU_S = 0.08;
const TELL_BLEND_S = 0.06;
const BREATH_LIFT = 0.012;
const BREATH_ELBOW = 0.010;
const SWAY_PAN = 0.02;
const SWAY_ROLL = 0.03;
const SHIFT_PAN = 0.06;
const SACCADE_WRIST = 0.015;
const SACCADE_JAW = 0.03 * (GRIP_OPEN - GRIP_CLOSED);
const GAZE_CAP = 0.35;
const ARRIVAL_SPEED = 0.15;
const RING_CAP = 0.04;
const ARRIVAL_TRAVEL = 0.03;
const LAG_SAMPLES = 12;
/** Tell poses (4.2), joint Δ from guard during the wind-up. */
const TELLS: Readonly<Record<NonNullable<MotionState["tell"]>, readonly number[]>> = {
  POKE: [0, 0, 0, 0, 0, 0],
  JAB: [0, 0, 0.10, -0.05, 0, 0],
  HOOK: [-0.20, 0, 0, 0, 0.30, 0],
  SLAM: [0, -0.35, -0.20, 0, 0, 1],
  GRAB: [0, 0, 0, 0.15, 0, 1],
};

function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }
function minJerk(u: number): number { const t = clamp(u, 0, 1); return t * t * t * (10 - 15 * t + 6 * t * t); }
function wrap(a: number): number { return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; }

interface GazeMove { from0: number; from1: number; to0: number; to1: number; startT: number; durS: number; overshoot: number; }

export class MotionLayers {
  private tm: Temperament | null = null;
  private lastT = -1;
  private gate = 1;
  private tellBlend = 0;
  private tellId: MotionState["tell"] = null;
  // Breathing
  private breathPhase = 0;
  private breathRateMul = 1;
  private breathStunUntil = -1;
  private windedUntil = -1;
  private cycleJitter = 1;
  private sway1 = 0;
  private sway2 = 0;
  private shiftFrom = 0;
  private shiftTo = 0;
  private shiftStartT = -10;
  private nextShiftT = 0;
  private saccadeT = -10;
  private saccadeSign = 1;
  private nextSaccadeT = 0;
  // Gaze
  private gaze0 = 0;      // yaw offset (rad)
  private gaze1 = 0;      // pitch offset (rad)
  private gazeTarget: GazeTarget = "gripper";
  private gazeHoldUntil = 0;
  private gazeMove: GazeMove | null = null;
  private eyeContactUntil = -1;
  private jawEyeContact = 0;
  readonly gazeEvents: GazeEvent[] = [];
  // React
  private reactStartT = -10;
  private reactStep = [0, 0, 0, 0, 0, 0];
  private reactReguardS = 0.2;
  private wobbleUntil = -1;
  // Temperament shaping
  private readonly prevBase = new Float64Array(6);
  private readonly travel = new Float64Array(6);
  private readonly ringA = new Float64Array(6);
  private readonly ringT = new Float64Array(6).fill(-10);
  private readonly lagT = new Float64Array(LAG_SAMPLES).fill(-10);
  private readonly lagRoll = new Float64Array(LAG_SAMPLES);
  private readonly lagJaw = new Float64Array(LAG_SAMPLES);
  private lagHead = 0;

  reset(tm: Temperament, rng: Rng): void {
    this.tm = tm;
    this.lastT = -1; this.gate = 1; this.tellBlend = 0; this.tellId = null;
    this.breathPhase = rng.next(); this.breathRateMul = 1; this.breathStunUntil = -1; this.windedUntil = -1; this.cycleJitter = 1;
    this.sway1 = rng.range(0, Math.PI * 2); this.sway2 = rng.range(0, Math.PI * 2);
    this.shiftFrom = 0; this.shiftTo = 0; this.shiftStartT = -10; this.nextShiftT = rng.range(4, 9);
    this.saccadeT = -10; this.saccadeSign = 1; this.nextSaccadeT = rng.range(0.8, 2.5);
    this.gaze0 = 0; this.gaze1 = 0; this.gazeTarget = "gripper"; this.gazeHoldUntil = 0; this.gazeMove = null;
    this.eyeContactUntil = -1; this.jawEyeContact = 0; this.gazeEvents.length = 0;
    this.reactStartT = -10; this.reactStep.fill(0); this.wobbleUntil = -1;
    this.prevBase.fill(Number.NaN); this.travel.fill(0); this.ringA.fill(0); this.ringT.fill(-10); this.lastPhase = "idle";
    this.lagT.fill(-10); this.lagHead = 0;
  }

  /* ───────── commands from the behaviour ───────── */

  /** Reactive glance (80–170 ms, 5–8 % overshoot) at a target; `onAim` marks the pre-attack snap. */
  glance(t: number, target: GazeTarget, rng: Rng, onAim = false, holdS = 0): void {
    this.startGaze(t, target, rng.range(0.08, 0.17), rng.range(0.05, 0.08), "glance", onAim);
    this.gazeHoldUntil = t + (holdS > 0 ? holdS : rng.range(0.3, 0.9));
  }

  /** Considered look (250–400 ms ease-in-out), held 300–900 ms. */
  look(t: number, target: GazeTarget, rng: Rng, holdS = 0): void {
    this.startGaze(t, target, rng.range(0.25, 0.4), 0, "look", false);
    this.gazeHoldUntil = t + (holdS > 0 ? holdS : rng.range(0.3, 0.9));
  }

  /** Eye contact (600–1200 ms at the camera, jaws +10 %). */
  eyeContact(t: number, rng: Rng): void {
    const hold = rng.range(0.6, 1.2);
    this.look(t, "camera", rng, hold);
    this.eyeContactUntil = t + hold;
  }

  /**
   * Commanded flinch (4.1): a step away from the contact of 0.12…0.25 rad scaled by m, jaw shut, re-guard over
   * 140–400 ms with 10 % overshoot. `kind` scales it: light contact 40 %, blocked 60 % (a shove), Core slam adds a
   * 300 ms pan wobble. Big hits stun breathing one cycle, then it runs at 1.6× decaying over 6 s.
   */
  flinch(t: number, m: number, side: number, kind: "hit" | "light" | "blocked" | "core", rng: Rng): void {
    const mm = clamp(m, 0, 1);
    const scale = kind === "light" ? 0.4 : kind === "blocked" ? 0.6 : 1;
    const d = (0.12 + 0.13 * mm) * scale;
    this.reactStartT = t;
    this.reactStep[PAN] = 0.5 * d * side;          // pan + swings the hand toward −y: away from a contact at +y
    this.reactStep[LIFT] = kind === "blocked" ? -0.4 * d : 0.6 * d;
    this.reactStep[ELBOW] = kind === "blocked" ? -0.6 * d : d;
    this.reactStep[WRIST] = 0.8 * d;
    this.reactStep[ROLL] = 0.3 * d * side;
    this.reactStep[JAW] = 1;
    this.reactReguardS = kind === "blocked" ? 0.09 : 0.14 + 0.26 * mm;
    if (kind === "core") this.wobbleUntil = t + 0.3;
    if (mm >= 0.5 && kind === "hit") {
      const rate = this.breathRate();
      this.breathStunUntil = t + 1 / Math.max(0.1, rate);
      this.windedUntil = this.breathStunUntil + 6;
    }
    this.glance(t + 0.001, "camera", rng, false, rng.range(0.4, 0.9));
  }

  /* ───────── the per-tick composition ───────── */

  /**
   * Applies every layer to `q` (6 joint targets, in place) for the base pose `p` at time `t`. `commit` advances the
   * state (and draws from the Rng); a look-ahead sample evaluates the current state at `t` without moving it.
   */
  apply(t: number, q: number[] | Float64Array, p: Pose, inp: LayerInputs, rng: Rng, commit: boolean): void {
    const tm = this.tm;
    if (!tm) return;
    const dt = this.lastT < 0 ? 0 : clamp(t - this.lastT, 0, 0.1);
    const m = inp.motion;
    const gateTarget = m.phase === "idle" || m.phase === "transition" ? 1 : m.phase === "windup" ? 0.3 : m.phase === "recover" ? 0.6 : 0;
    const gate = commit ? this.gate + (gateTarget - this.gate) * (1 - Math.exp(-dt / GATE_TAU_S)) : this.gate;
    const tellTarget = m.phase === "windup" && m.tell ? 1 : 0;
    const tellBlend = commit ? this.tellBlend + (tellTarget - this.tellBlend) * (1 - Math.exp(-dt / TELL_BLEND_S)) : this.tellBlend;
    if (commit) { this.gate = gate; this.tellBlend = tellBlend; if (m.tell) this.tellId = m.tell; }

    // Temperament: arrival rings (at the end of a strike and of the return to guard) and follow-through lag work
    // on the base command.
    if (commit) this.shape(t, dt, q, tm, m.phase);
    // Second-order ring: overshoot × travel decaying at ζω, so BACKLASH (ζ 0.9) is dead in one swing and OVERSHOOT
    // (ζ 0.35) wobbles visibly. ponytail: amplitude capped at RING_CAP so a full-reach slam does not buzz the servo.
    const omega = 2 * Math.PI * tm.ringHz;
    const fd = tm.ringHz * Math.sqrt(Math.max(0, 1 - tm.ringZeta * tm.ringZeta));
    const ring = (j: number): number => {
      const tau = t - this.ringT[j];
      if (tau < 0 || tau > 0.6) return 0;
      return this.ringA[j] * Math.exp(-tm.ringZeta * omega * tau) * Math.cos(2 * Math.PI * fd * tau);
    };
    const lag = tm.followLagMs / 1000;
    if (lag > 0) { q[ROLL] = this.lagged(t - lag, q[ROLL], this.lagRoll); q[JAW] = this.lagged(t - lag, q[JAW], this.lagJaw); }

    // Affect posture (4.1), always on.
    const a = clamp(inp.arousal, 0, 1), v = clamp(inp.valence, -1, 1), s = clamp(inp.stance, -1, 1);
    q[LIFT] += -0.10 * a; q[ELBOW] += -0.08 * a; q[WRIST] += -0.06 * a - 0.08 * v;
    if (s > 0) q[ELBOW] += -0.10 * s; else { q[ELBOW] += 0.12 * -s; q[PAN] += 0.10 * -s * inp.awaySide; }
    const idleJaw = gate * (v > 0 ? 0.15 * v * (GRIP_OPEN - GRIP_CLOSED) : 0);

    // Breathing, sway, weight shift and micro-saccades (attenuated by the gate).
    if (commit) this.advanceBreath(t, dt, a, tm, rng);
    const phase = commit ? this.breathPhase : this.breathPhase + dt * this.breathRate(a) * (t > this.breathStunUntil ? 1 : 0);
    const b = this.breathWave(phase) * tm.breathDepth;
    const w1 = 2 * Math.PI * 0.17 * t + this.sway1, w2 = 2 * Math.PI * 0.11 * t + this.sway2;
    const shift = this.shiftFrom + (this.shiftTo - this.shiftFrom) * minJerk((t - this.shiftStartT) / 0.35);
    const sac = this.saccade(t);
    q[LIFT] += gate * BREATH_LIFT * b;
    q[ELBOW] += gate * -BREATH_ELBOW * b;
    q[PAN] += gate * (SWAY_PAN * Math.sin(w1) + shift);
    q[ROLL] += gate * SWAY_ROLL * Math.sin(w2);
    q[WRIST] += gate * SACCADE_WRIST * sac;
    let jaw = idleJaw + gate * SACCADE_JAW * sac + (t < this.eyeContactUntil ? 0.10 * (GRIP_OPEN - GRIP_CLOSED) : 0);

    // Gaze: the gripper looks (attenuated like breathing).
    if (commit) this.advanceGaze(t, dt, p, inp, tm, rng);
    const g0 = this.gaze0, g1 = this.gaze1;
    q[PAN] += gate * 0.35 * g0; q[ROLL] += gate * 0.5 * g0; q[WRIST] += gate * -0.6 * g1;

    // Tell pose of the primitive in flight (4.2).
    if (tellBlend > 0.001 && this.tellId) {
      const tell = TELLS[this.tellId];
      const side = m.side || 1;
      q[PAN] += tellBlend * tell[PAN] * side; q[LIFT] += tellBlend * tell[LIFT]; q[ELBOW] += tellBlend * tell[ELBOW];
      q[WRIST] += tellBlend * tell[WRIST]; q[ROLL] += tellBlend * tell[ROLL] * side;
      if (tell[JAW] > 0) jaw += tellBlend * (GRIP_OPEN - Math.max(q[JAW], GRIP_CLOSED));
    }

    // Commanded flinch (4.1), with the re-guard overshoot.
    const rt = t - this.reactStartT;
    if (rt >= 0 && rt < this.reactReguardS * 1.8) {
      const u = rt / this.reactReguardS;
      const env = rt < 0.02 ? rt / 0.02 : u < 1 ? 1 - 1.1 * minJerk(u) : -0.1 * Math.exp(-(rt - this.reactReguardS) / (0.3 * this.reactReguardS));
      for (let j = 0; j < 5; j++) q[j] += env * this.reactStep[j];
      if (rt < 0.2) jaw = GRIP_CLOSED - q[JAW];       // jaw snaps shut
    }
    if (t < this.wobbleUntil) q[PAN] += 0.05 * Math.sin(2 * Math.PI * 6 * (t - (this.wobbleUntil - 0.3))) * ((this.wobbleUntil - t) / 0.3);

    for (let j = 0; j < 5; j++) q[j] += ring(j);
    q[JAW] += jaw;
    clampToLimits(q, MOTOR_LIMIT_MARGIN);
    if (commit) this.lastT = t;
  }

  /* ───────── breathing ───────── */

  private breathRate(a = 0): number {
    const tm = this.tm;
    if (!tm) return 0.3;
    return tm.breathHz * (1 + a) * this.breathRateMul * this.cycleJitter;
  }

  private breathWave(phase: number): number {
    // Inhale 45 % / exhale 55 %: warp the phase so the rise is quicker than the fall.
    const u = phase - Math.floor(phase);
    const w = u < 0.45 ? 0.5 * (u / 0.45) : 0.5 + 0.5 * ((u - 0.45) / 0.55);
    return Math.sin(2 * Math.PI * w);
  }

  private advanceBreath(t: number, dt: number, a: number, tm: Temperament, rng: Rng): void {
    if (t < this.windedUntil) this.breathRateMul = 1 + 0.6 * clamp((this.windedUntil - t) / 6, 0, 1); else this.breathRateMul = 1;
    if (t > this.breathStunUntil) {
      const before = Math.floor(this.breathPhase);
      this.breathPhase += dt * this.breathRate(a);
      if (Math.floor(this.breathPhase) !== before) this.cycleJitter = tm.breathIrregular ? rng.range(0.8, 1.2) : 1;
    }
    if (t >= this.nextShiftT) {
      this.shiftFrom = this.shiftFrom + (this.shiftTo - this.shiftFrom) * minJerk((t - this.shiftStartT) / 0.35);
      const choices = [-SHIFT_PAN, 0, SHIFT_PAN].filter((x) => Math.abs(x - this.shiftTo) > 1e-6);
      this.shiftTo = choices[rng.int(choices.length)];
      this.shiftStartT = t;
      this.nextShiftT = t + rng.range(4, 9);
    }
    if (t >= this.nextSaccadeT) {
      this.saccadeT = t;
      this.saccadeSign = rng.next() < 0.5 ? -1 : 1;
      this.nextSaccadeT = t + rng.range(0.8, 2.5);
    }
  }

  /** Micro-saccade envelope: 80 ms out, 120 ms back. */
  private saccade(t: number): number {
    const u = t - this.saccadeT;
    if (u < 0 || u > 0.2) return 0;
    return this.saccadeSign * (u < 0.08 ? minJerk(u / 0.08) : 1 - minJerk((u - 0.08) / 0.12));
  }

  /* ───────── gaze ───────── */

  private startGaze(t: number, target: GazeTarget, durS: number, overshoot: number, kind: GazeKind, onAim: boolean): void {
    this.gazeTarget = target;
    this.gazeMove = { from0: this.gaze0, from1: this.gaze1, to0: this.gaze0, to1: this.gaze1, startT: t, durS, overshoot };
    this.gazeEvents.push({ t, target, kind, onAim });
    if (this.gazeEvents.length > 64) this.gazeEvents.shift();
  }

  private targetOffsets(p: Pose, inp: LayerInputs, out: [number, number]): void {
    const tgt: Vec3 | null = this.gazeTarget === "gripper" ? inp.gripper : this.gazeTarget === "camera" ? inp.camera : this.gazeTarget === "core" ? inp.core : null;
    if (!tgt) { out[0] = this.awayYaw; out[1] = 0.1; return; }
    const dx = tgt[0] - p.x, dy = tgt[1] - p.y, dz = tgt[2] - p.z;
    const yaw = wrap(Math.atan2(dy, dx) - Math.atan2(p.y, p.x));
    const pitch = Math.atan2(dz, Math.hypot(dx, dy)) - p.pitch;
    out[0] = clamp(yaw, -GAZE_CAP, GAZE_CAP); out[1] = clamp(pitch, -GAZE_CAP, GAZE_CAP);
  }

  private awayYaw = 0.25;
  private readonly want: [number, number] = [0, 0];

  private advanceGaze(t: number, dt: number, p: Pose, inp: LayerInputs, tm: Temperament, rng: Rng): void {
    if (t >= this.gazeHoldUntil && !this.gazeMove) {
      // Budget (4.1): 60 % player gripper, 25 % player camera, 15 % elsewhere; DEADBAND glances at the wrong thing.
      const r = rng.next();
      let next: GazeTarget = r < 0.6 ? "gripper" : r < 0.85 ? "camera" : "away";
      if (next === "away" && inp.core && rng.next() < 0.5) next = "core";
      if (tm.wrongTargetGlance > 0 && rng.next() < tm.wrongTargetGlance) next = next === "gripper" ? "away" : "gripper";
      if (next === "away") this.awayYaw = rng.range(-0.3, 0.3);
      this.look(t, next, rng);
    }
    const want = this.want;
    this.targetOffsets(p, inp, want);
    const mv = this.gazeMove;
    if (mv) {
      const u = (t - mv.startT) / mv.durS;
      mv.to0 = want[0]; mv.to1 = want[1];
      if (u >= 1) {
        this.gaze0 = mv.to0 + (mv.to0 - mv.from0) * mv.overshoot; this.gaze1 = mv.to1 + (mv.to1 - mv.from1) * mv.overshoot;
        this.gazeMove = null;
      } else {
        const e = mv.overshoot > 0 ? 1 - Math.pow(1 - u, 3) : minJerk(u);
        this.gaze0 = mv.from0 + (mv.to0 - mv.from0) * e; this.gaze1 = mv.from1 + (mv.to1 - mv.from1) * e;
      }
      return;
    }
    const k = 1 - Math.exp(-dt / (tm.gazeTauMs / 1000));
    this.gaze0 += (want[0] - this.gaze0) * k;
    this.gaze1 += (want[1] - this.gaze1) * k;
  }

  /* ───────── temperament shaping ───────── */

  private lastPhase: MotionState["phase"] = "idle";

  private shape(t: number, dt: number, q: number[] | Float64Array, tm: Temperament, phase: MotionState["phase"]): void {
    // A ring fires when a strike lands its path (active → follow) or the arm returns to guard (recover → idle),
    // sized by the travel of that move: overshoot × travel, then the entrant's damping.
    const arrival = (this.lastPhase === "active" && phase !== "active") || (this.lastPhase === "recover" && phase !== "recover");
    if (dt > 0 && Number.isFinite(this.prevBase[0])) {
      for (let j = 0; j < 5; j++) {
        const step = q[j] - this.prevBase[j];
        if (Math.abs(step) / dt > ARRIVAL_SPEED) this.travel[j] += step;
        if (arrival) {
          if (Math.abs(this.travel[j]) >= ARRIVAL_TRAVEL) { this.ringA[j] = clamp(tm.overshoot * this.travel[j], -RING_CAP, RING_CAP); this.ringT[j] = t; }
          this.travel[j] = 0;
        }
      }
    }
    if (phase === "idle" || phase === "transition") for (let j = 0; j < 5; j++) if (!arrival) this.travel[j] *= 0.9;
    this.lastPhase = phase;
    for (let j = 0; j < 6; j++) this.prevBase[j] = q[j];
    this.lagT[this.lagHead] = t; this.lagRoll[this.lagHead] = q[ROLL]; this.lagJaw[this.lagHead] = q[JAW];
    this.lagHead = (this.lagHead + 1) % LAG_SAMPLES;
  }

  /** Value of a lagged joint at time `at` from its sample ring (falls back to the current value). */
  private lagged(at: number, current: number, buf: Float64Array): number {
    let prevI = -1, nextI = -1;
    for (let k = 0; k < LAG_SAMPLES; k++) {
      const ts = this.lagT[k];
      if (ts < 0) continue;
      if (ts <= at && (prevI < 0 || ts > this.lagT[prevI])) prevI = k;
      if (ts > at && (nextI < 0 || ts < this.lagT[nextI])) nextI = k;
    }
    if (prevI < 0) return current;
    if (nextI < 0) return buf[prevI];
    const span = this.lagT[nextI] - this.lagT[prevI];
    const u = span > 0 ? (at - this.lagT[prevI]) / span : 1;
    return buf[prevI] + (buf[nextI] - buf[prevI]) * u;
  }
}
