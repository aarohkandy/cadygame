// src/game/policy/opponent/mind.ts (WP4)
// Mood (GAME_DESIGN 5.5) and affect (EMOTION_BIBLE 4.1, 4.4, 4.5). Mood is what the selector reads: aggression,
// composure, focus, each low-passed with the personality's τ so temperament drifts over seconds, never flips in a
// frame. Affect is what the body shows: arousal (τ 1.5 s, a speed-and-acceleration multiplier on every behaviour),
// valence (τ 4 s), stance (τ 2 s) and the menace gauge (10 Hz: +0.15 per strike attempt in reach, +0.25 per hit on
// the player, −0.05 per 100 ms without contact). `affect()` is published through the policy status channel as
// OpponentAffect for audio and the hosts.

import type { Observation, OpponentAffect } from "../../contracts.ts";
import type { PersonalityParams } from "./personalities.ts";

export interface Mood { aggression: number; composure: number; focus: number; }

const HIT_MEMORY_S = 3;
const COMPOSURE_HIT_SCALE = 45;      // damage that costs a full composure point before decay scaling
const COMPOSURE_RECOVER_PER_S = 0.08;
const CLUTCH_S = 10;
const CLOSE_GAP = 20;
const DESPERATE_GAP = 40;
const AROUSAL_TAU_S = 1.5;
const VALENCE_TAU_S = 4;
const STANCE_TAU_S = 2;
/** Menace gauge steps (4.5). */
export const MENACE_ATTEMPT = 0.15;
export const MENACE_HIT = 0.25;
export const MENACE_DECAY_PER_S = 0.5;
export const MENACE_BACKSTAGE = 0.8;
export const MENACE_PROBE = 0.2;

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clamp11(x: number): number { return x < -1 ? -1 : x > 1 ? 1 : x; }

export class Mind {
  readonly mood: Mood = { aggression: 0.5, composure: 1, focus: 0.6 };
  /** Body affect (4.1): arousal 0..1, valence −1..1, stance −1 (closed) .. 1 (open). */
  arousal = 0.2;
  valence = 0;
  stance = 0.2;
  menace = 0;
  private p: PersonalityParams | null = null;
  private lastT = -1;
  private hitHeat = 0;        // recent damage taken, decays over HIT_MEMORY_S
  private dealtHeat = 0;
  /** Impulses that decay with their layer's τ: the flinch's stance −0.3, a personality's on-hit valence, a grudge. */
  private arousalKick = 0;
  private valenceKick = 0;
  private stanceKick = 0;
  private lastContactT = 0;
  composureDecayMul = 1;
  desperation = 0;
  clutch = 0;
  /** Integrity difference (self − opponent) in integrity points. */
  integrityGap = 0;
  /** External threat estimate (decision.ts), 0..1; feeds arousal. */
  threat = 0;

  reset(p: PersonalityParams, keepMood: boolean): void {
    this.p = p;
    if (!keepMood) {
      this.mood.aggression = p.baseAggression;
      this.mood.composure = 1;
      this.mood.focus = 0.6;
      this.valence = 0; this.stance = 0.2; this.arousal = 0.2;
    }
    this.lastT = -1;
    this.hitHeat = 0; this.dealtHeat = 0;
    this.arousalKick = 0; this.valenceKick = 0; this.stanceKick = 0;
    this.menace = 0; this.lastContactT = 0; this.threat = 0;
    this.desperation = 0; this.clutch = 0; this.integrityGap = 0;
  }

  /** Damage events felt this observation. */
  noteDamage(taken: number, dealt: number): void {
    const p = this.p;
    if (taken > 0) {
      this.hitHeat += taken;
      this.mood.composure = clamp01(this.mood.composure - (taken / COMPOSURE_HIT_SCALE) * 0.35 * this.composureDecayMul);
      if (p) {
        const h = p.temperament.onHit;
        this.valenceKick += h.valence; this.stanceKick += h.stance;
        this.mood.composure = clamp01(this.mood.composure + h.composure);
      }
    }
    if (dealt > 0) {
      this.dealtHeat += dealt;
      this.mood.composure = clamp01(this.mood.composure + dealt / 200);
      this.valenceKick += 0.15;
    }
  }

  /** The commanded flinch's affect (4.1): stance −0.3 for 2 s, arousal +0.25. */
  noteFlinch(m: number): void {
    this.stanceKick -= 0.3 * Math.max(0.4, m);
    this.arousalKick += 0.25 * Math.max(0.4, m);
  }

  /** Menace inputs (4.5). */
  noteStrikeAttempt(inReach: boolean): void { if (inReach) this.menace = clamp01(this.menace + MENACE_ATTEMPT); }
  noteHitOnPlayer(t: number): void { this.menace = clamp01(this.menace + MENACE_HIT); this.lastContactT = t; }
  noteContact(t: number): void { this.lastContactT = t; }

  /** A grudge (4.5): opening aggression +0.2, no eye-contact beat. */
  holdGrudge(grudge: number): void {
    this.mood.aggression = clamp01(this.mood.aggression + 0.2 * clamp01(grudge));
    this.valenceKick -= 0.2 * clamp01(grudge);
  }

  /** Bump arousal or valence directly (a taunt, fear, a celebration). */
  kick(arousal: number, valence: number, stance = 0): void {
    this.arousalKick += arousal; this.valenceKick += valence; this.stanceKick += stance;
  }

  affect(): OpponentAffect {
    return { arousal: round3(this.arousal), valence: round3(this.valence), stance: round3(this.stance), composure: round3(this.mood.composure), menace: round3(this.menace) };
  }

  update(obs: Observation): void {
    const p = this.p;
    if (!p) return;
    const dt = this.lastT < 0 ? 0 : Math.max(0, Math.min(0.5, obs.t - this.lastT));
    this.lastT = obs.t;
    const decay = Math.exp(-dt / HIT_MEMORY_S);
    this.hitHeat *= decay;
    this.dealtHeat *= decay;

    const self = obs.self.integrity, opp = obs.opponent.integrity;
    this.integrityGap = self - opp;
    this.desperation = opp - self > DESPERATE_GAP ? 1 : 0;
    const fight = obs.round.phase === "fight" || obs.round.phase === "sudden_death";
    this.clutch = fight && obs.round.time_remaining <= CLUTCH_S && Math.abs(this.integrityGap) < CLOSE_GAP ? 1 : 0;

    const roundsBehind = obs.round.rounds_won.opponent - obs.round.rounds_won.self;
    const hitTilt = p.tilt * Math.min(1, this.hitHeat / 30);
    const scoreTilt = 0.08 * p.scoreWeight * Math.sign(roundsBehind);
    const aggTarget = clamp01(p.baseAggression + hitTilt + scoreTilt + 0.2 * this.desperation + 0.1 * this.clutch - 0.1 * Math.min(1, this.dealtHeat / 40) * (p.tilt < 0 ? 1 : 0));
    const focusTarget = clamp01(0.6 + 0.3 * this.clutch - 0.2 * Math.min(1, this.hitHeat / 40));
    const a = dt > 0 ? 1 - Math.exp(-dt / p.moodTauS) : 0;
    this.mood.aggression += (aggTarget - this.mood.aggression) * a;
    this.mood.focus += (focusTarget - this.mood.focus) * a;
    this.mood.composure = clamp01(this.mood.composure + COMPOSURE_RECOVER_PER_S * dt * (this.hitHeat < 5 ? 1 : 0.25));

    // Affect (4.1, 4.4): arousal from threat, recent contact and the clutch, scaled by the entrant's gain.
    const tm = p.temperament;
    const arousalTarget = clamp01((0.15 + 0.45 * this.threat + 0.35 * Math.min(1, (this.hitHeat + this.dealtHeat) / 30) + 0.2 * this.clutch + 0.2 * this.desperation + this.arousalKick) * tm.arousalGain);
    const valenceTarget = clamp11(0.35 * Math.tanh(this.integrityGap / 30) + 0.3 * Math.min(1, this.dealtHeat / 30) - 0.3 * Math.min(1, this.hitHeat / 30) + this.valenceKick);
    const stanceTarget = clamp11(0.3 + 0.4 * (this.mood.aggression - 0.5) - 0.6 * Math.min(1, this.hitHeat / 30) + 0.2 * Math.tanh(this.integrityGap / 40) + this.stanceKick);
    if (dt > 0) {
      this.arousal += (arousalTarget - this.arousal) * (1 - Math.exp(-dt / AROUSAL_TAU_S));
      this.valence += (valenceTarget - this.valence) * (1 - Math.exp(-dt / VALENCE_TAU_S));
      this.stance += (stanceTarget - this.stance) * (1 - Math.exp(-dt / STANCE_TAU_S));
      this.arousalKick *= Math.exp(-dt / AROUSAL_TAU_S);
      this.valenceKick *= Math.exp(-dt / VALENCE_TAU_S);
      this.stanceKick *= Math.exp(-dt / STANCE_TAU_S);
      if (fight && obs.t - this.lastContactT > 0.1) this.menace = clamp01(this.menace - MENACE_DECAY_PER_S * dt);
    }
    if (!fight) this.menace = 0;
  }
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
