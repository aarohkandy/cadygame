// src/game/camera/juice.ts (WP3)
// Camera and screen juice (EMOTION_BIBLE section 6 camera column, 3.5 rules). Every GameEvent is first classified
// into a FeedbackPlan: its magnitude tier and the channels it may use (A audio, V world VFX, S hit stop, C camera,
// E damage edge, P post). The plan enforces the per-tier budget: graze and light <= 4, heavy <= 5, KO everything.
// Only KO, Stagger taken, and Stun taken touch post; ordinary strikes never set chromatic aberration. Juice then
// turns the plan's C/E/P numbers into springs and envelopes that run on wall time, so they keep moving through hit
// stop. The section 6 numbers are the Arcade numbers as written (no punch multiplier on top); Proving Ground halves
// the camera, Harness zeroes it. 3.5 caps (roll 3°, FOV punch 6°, trauma 0.35 outside a KO) are clamped here and
// the maxima reached per round are kept in `stats` for ?debug=feel.
//
// Conventions for JuiceOutput angles (consumed only by cockpit-rig.ts): yaw + turns the view right, pitch + looks up,
// roll + tilts clockwise as seen by the player. victimVibration.offset is in sim metres, world frame.

import {
  MOUNT_X, TOKEN_HEX,
  type FeedbackContext, type GameEvent, type HitstopMsFor, type JuiceOutput, type LinkId, type MatchPreset, type Seat, type Settings,
} from "../contracts.ts";
import { COCKPIT_EYE_EGO, COCKPIT_TARGET_EGO } from "../render/camera-math.ts";
import { noise1 } from "./noise.ts";
import { clamp, createSpring, decay, kickImpulse, resetSpring, stepCritical, type Spring1 } from "./springs.ts";

/** Eye position in the seat's ego frame (3.2); defined once in camera-math. */
export { COCKPIT_EYE_EGO };

export type FeedbackTier = "none" | "light" | "heavy" | "ko";
export type Channel = "A" | "V" | "S" | "C" | "E" | "P";
export type JuiceProfile = "full" | "honest" | "spectator";

/** Channel budget per tier (8.1). KO may use everything. */
export const TIER_BUDGET: Readonly<Record<FeedbackTier, number>> = { none: 3, light: 4, heavy: 5, ko: 6 };

export const TRAUMA_DECAY_PER_S = 1.6;
export const SHAKE_MAX_YAW_DEG = 1.2;
export const SHAKE_MAX_PITCH_DEG = 1.2;
export const SHAKE_MAX_ROLL_DEG = 2.0;
/** 3.5: the camera never exceeds these outside a KO; the build clamps and counts every attempt. */
export const ROLL_MAX_DEG = 3;
export const TRAUMA_MAX_LIVE = 0.35;
/** The one allowed slow motion (section 6 KO row): sim clock at 0.3x for 700 ms after the KO confirm. */
export const KO_SLOWMO = { scale: 0.3, ms: 700 } as const;
/** Sim clock scale during the KO beat; WP1 sim-driver multiplies its step budget by this. */
export function koTimeScale(koAgeMs: number): number {
  return koAgeMs >= 0 && koAgeMs < KO_SLOWMO.ms ? KO_SLOWMO.scale : 1;
}
export const SHAKE_HZ_TAKEN = 18;
export const SHAKE_HZ_DEALT = 24;
export const KICK_OMEGA = 22;
export const FOV_OMEGA = 18;
/** Stacked punches in a flurry never swing the FOV or the view further than these (deg). */
export const FOV_OFFSET_MAX_DEG = 6;
export const VIEW_OFFSET_MAX_DEG = 7;
export const CA_TAU_S = 0.09;
export const VIGNETTE_TAU_S = 0.2;
export const EDGE_MS = 450;
export const VIBRATION_HZ = 30;
export const VIBRATION_VICTIM_M = 0.0015;
export const KO_FOCUS_START_MS = 150;
export const KO_FOCUS_FULL_MS = 1000;
const DEG = Math.PI / 180;

export interface FeedbackPlan {
  tier: FeedbackTier;
  channels: Set<Channel>;
  trauma: number;
  traumaHz: number;
  kickYawDeg: number;
  kickPitchDeg: number;
  kickRollDeg: number;
  fovDeg: number;
  /** Dealt shake is roll-biased (a sharp 24 Hz snap); taken shake is a full slam. */
  rollBias: boolean;
  edge: { strength: number; color: string; bearing: number } | null;
  chromatic: number;
  vignette: number;
  desaturate: number;
  desaturateMs: number;
  vibration: { seat: Seat; link: LinkId; normal: readonly [number, number, number]; durationMs: number } | null;
  koFocus: Seat | null;
}

export function juiceProfileFor(preset: MatchPreset, playerSeat: Seat | null): JuiceProfile {
  if (playerSeat === null || preset === "harness") return "spectator";
  return preset === "proving_ground" ? "honest" : "full";
}

/** Team colour of a seat from the local player's side: the pilot is cobalt, whoever they face is magenta. */
export function teamColor(seat: Seat, playerSeat: Seat | null): string {
  if (playerSeat === null) return seat === "atlas" ? TOKEN_HEX.cobalt : TOKEN_HEX.magenta;
  return seat === playerSeat ? TOKEN_HEX.cobalt : TOKEN_HEX.magenta;
}

function emptyPlan(): FeedbackPlan {
  return {
    tier: "none", channels: new Set<Channel>(), trauma: 0, traumaHz: SHAKE_HZ_TAKEN, kickYawDeg: 0, kickPitchDeg: 0, kickRollDeg: 0,
    fovDeg: 0, rollBias: false, edge: null, chromatic: 0, vignette: 0, desaturate: 0, desaturateMs: 0, vibration: null, koFocus: null,
  };
}

const BASE_BEARING = Math.atan2(COCKPIT_TARGET_EGO[1] - COCKPIT_EYE_EGO[1], COCKPIT_TARGET_EGO[0] - COCKPIT_EYE_EGO[0]);
const BASE_ELEVATION = Math.atan2(
  COCKPIT_TARGET_EGO[2] - COCKPIT_EYE_EGO[2],
  Math.hypot(COCKPIT_TARGET_EGO[0] - COCKPIT_EYE_EGO[0], COCKPIT_TARGET_EGO[1] - COCKPIT_EYE_EGO[1]),
);

/** Bearing (rad, + = left of the view centre) and elevation (+ = above it) of a world point, relative to the
 *  cockpit's rest look direction, so the damage edge and kick match the side of the screen the hit is on. */
export function bearingFromEye(seat: Seat, pos: readonly number[]): { bearing: number; elevation: number } {
  const ex = seat === "atlas" ? pos[0] - MOUNT_X.atlas : -(pos[0] - MOUNT_X.blaze);
  const ey = seat === "atlas" ? pos[1] : -pos[1];
  const dx = ex - COCKPIT_EYE_EGO[0];
  const dy = ey - COCKPIT_EYE_EGO[1];
  const dz = pos[2] - COCKPIT_EYE_EGO[2];
  const b = Math.atan2(dy, dx) - BASE_BEARING;
  return { bearing: Math.atan2(Math.sin(b), Math.cos(b)), elevation: Math.atan2(dz, Math.hypot(dx, dy)) - BASE_ELEVATION };
}


/**
 * Classifies one event for the local player (8.1). `hitstopMs` is WP2's hitstopMsFor for this event and preset
 * (0 outside Arcade), so the S channel is present exactly when the sim-driver freezes.
 * Returns the tier, channels, and the camera, edge, and post numbers before settings and profile scaling.
 */
export function planFeedback(e: GameEvent, playerSeat: Seat | null, hitstopMs: number): FeedbackPlan {
  const p = emptyPlan();
  const ch = p.channels;
  const me = playerSeat;
  const add = (...c: Channel[]) => { for (const x of c) ch.add(x); };
  if (hitstopMs > 0) ch.add("S");
  switch (e.type) {
    case "contact":
      add("A", "V");
      break;
    case "strike": {
      const m = clamp(e.magnitude, 0, 1);
      add("A", "V");
      // The victim's link shake travels with the freeze, whatever the tier, because it is what makes the
      // freeze legible: it is the one thing moving while the sim is stopped. A guarded hit is a light row -
      // A, V, S and no camera (8.1 "Budget per magnitude tier") - but it does freeze the sim for
      // round(50 · m²) ms, and a freeze with nothing moving in it reads as a dropped frame. The shake is part
      // of the V channel the row already carries, so the budget is unchanged; only the camera stays heavy-only.
      // A graze has no freeze (8.1 hit-stop table) and neither has anything outside Arcade, where
      // hitstopMsFor is 0, so in both cases nothing shakes.
      if (hitstopMs > 0) p.vibration = { seat: e.victim, link: e.zone, normal: e.normal, durationMs: Math.max(60, hitstopMs) };
      if (e.tier === "graze") { p.tier = "light"; break; }
      if (e.guarded) {
        // Block: hitting their guard pushes you back 0.5° along the normal, no shake; being the wall moves nothing.
        p.tier = "light";
        if (e.attacker === me) { add("C"); kickAlongNormal(p, me, e.normal, 0.5); }
        break;
      }
      const heavy = m >= 0.4 || e.crit;
      p.tier = heavy ? "heavy" : "light";
      if (!heavy || me === null) break;
      if (e.attacker === me) {
        // Heavy hit dealt: recoil −0.8° pitch, FOV −2.5°·(0.5+m), trauma 0.10 + 0.15·m at 24 Hz roll-biased.
        add("C");
        p.trauma = 0.1 + 0.15 * m + (e.crit ? 0.05 : 0);
        p.traumaHz = SHAKE_HZ_DEALT;
        p.rollBias = true;
        p.kickPitchDeg = -0.8;
        p.fovDeg = -2.5 * (0.5 + m);
      } else if (e.victim === me) {
        // Hit taken: kick away from the contact 1.5° + 3°·m, trauma 0.15 + 0.20·m at 18 Hz, FOV +3°·m.
        add("C", "E");
        p.trauma = 0.15 + 0.2 * m;
        p.traumaHz = SHAKE_HZ_TAKEN;
        const { bearing, elevation } = bearingFromEye(me, e.pos);
        const k = 1.5 + 3 * m;
        let yaw = Math.sin(bearing);           // contact on the left (bearing > 0) kicks the view right (+yaw)
        let pitch = -Math.sin(elevation);      // contact below kicks the view up
        const n = Math.hypot(yaw, pitch);
        if (n < 1e-3) { yaw = 0; pitch = 1; } else { yaw /= n; pitch /= n; }
        p.kickYawDeg = k * yaw;
        p.kickPitchDeg = k * pitch;
        p.kickRollDeg = 0.5 * k * yaw;
        p.fovDeg = 3 * m;
        p.edge = { strength: 0.3 * m, color: teamColor(e.attacker, me), bearing };
      }
      break;
    }
    case "late_guard":
      p.tier = "light";
      add("A", "V");
      break;
    case "deflect":
      p.tier = "heavy";
      add("A", "V");
      if (me === e.defender) {
        add("C");
        p.fovDeg = -2;
      } else if (me === e.attacker) {
        add("C", "P");
        p.kickPitchDeg = 2.5;
        p.desaturate = 0.3;
        p.desaturateMs = e.hard ? 900 : 650;
      }
      break;
    case "clash": {
      p.tier = "heavy";
      add("A", "V");
      if (me !== null) { add("C"); kickAlongNormal(p, me, e.normal, 1.5); }   // both cameras 1.5° along the normal
      break;
    }
    case "whiff":
      p.tier = "light";
      add("A", "V");
      if (e.seat === me) {
        // 0.6° roll into the swing, then a 0.4° stumble dip at the leash (the roll spring's own settle).
        add("C");
        p.kickRollDeg = 0.6;
        p.kickPitchDeg = -0.4;
      }
      break;
    case "charge":
      p.tier = "light";
      add("A", "V");
      if (e.stage === "release" && e.seat === me) { add("C"); p.fovDeg = -1.5; }
      break;
    case "servo_state":
      if (e.state === "stagger") {
        add("A", "V");
        if (e.seat === me) {
          // Stagger: a 0.6° pitch dip and the brownout post (CA + vignette 400 ms); no shake, the arm is the show.
          p.tier = "heavy";
          add("C", "P");
          p.kickPitchDeg = -0.6;
          p.chromatic = 0.002;
          p.vignette = 0.15;
        } else {
          p.tier = "light";
        }
      } else if (e.state === "offline" || e.state === "stun" || e.state === "cutout") {
        p.tier = "light";
        add("A", "V");
      }
      break;
    case "burst":
      p.tier = "heavy";
      add("A", "V");
      if (e.seat === me) { add("C"); p.fovDeg = -2; }
      break;
    case "overheat":
      p.tier = "light";
      add("A", "V");
      break;
    case "ability":
      p.tier = "light";
      add("A", "V");
      if (e.seat === me && e.ability === "snap" && e.phase === "start") { add("C"); p.fovDeg = -1.5; }
      break;
    case "core":
      if (e.stage === "drop") {
        p.tier = "light";
        add("A", "V");
        if (me !== null) { add("C"); p.trauma = 0.05; p.traumaHz = SHAKE_HZ_TAKEN; }
      } else if (e.stage === "steal") {
        p.tier = "heavy";
        add("A", "V");
        if (me !== null && e.seat === me) { add("C"); p.trauma = 0.15; p.traumaHz = SHAKE_HZ_DEALT; }
      } else if (e.stage === "lock") {
        p.tier = "ko";
        add("A", "V");
      } else {
        add("A");
      }
      break;
    case "ko":
      p.tier = "ko";
      add("A", "V", "C", "P");
      p.koFocus = e.victim;
      if (me === e.victim) {
        p.fovDeg = 5;
        p.trauma = 0.45;
        p.traumaHz = SHAKE_HZ_TAKEN;
        p.chromatic = 0.004;
        p.vignette = 0.35;
      } else if (me === e.attacker) {
        p.fovDeg = -4;
        p.trauma = 0.3;
        p.traumaHz = SHAKE_HZ_DEALT;
        p.vignette = 0.2;
      } else {
        p.vignette = 0.15;
      }
      break;
    case "match_end":
      p.tier = "ko";
      add("A");
      break;
    case "phase":
    case "round_end":
      add("A");
      break;
    case "policy_fault":
    case "heat_warning":
    case "low_integrity":
    case "first_strike":
    case "combo":
    case "stalemate":
    case "flaw":
      add("A");
      break;
    default:
      break;
  }
  if (ch.has("S") && p.tier === "none") p.tier = "light";
  return p;
}

/** Pushed back along the contact normal (atlas -> blaze) by `deg`: the lateral part becomes yaw, the vertical pitch. */
function kickAlongNormal(p: FeedbackPlan, me: Seat, normal: readonly number[], deg: number): void {
  const sign = me === "atlas" ? -1 : 1;
  const ny = (me === "atlas" ? normal[1] : -normal[1]) * sign;
  const nz = normal[2] * sign;
  const lat = Math.hypot(ny, nz);
  p.kickYawDeg = lat > 1e-3 ? (-ny / lat) * deg : 0;
  p.kickPitchDeg = lat > 1e-3 ? (nz / lat) * deg : deg;
}

/** Applies the preset juice profile to a plan: full is the section 6 table as written; honest halves the camera and
 *  drops post; spectator keeps A and V. */
export function applyProfile(p: FeedbackPlan, profile: JuiceProfile): FeedbackPlan {
  if (profile === "full") return p;
  p.channels.delete("P");
  p.chromatic = 0; p.vignette = 0; p.desaturate = 0; p.desaturateMs = 0;
  if (profile === "honest") {
    p.channels.delete("S");
    p.trauma *= 0.5; p.kickYawDeg *= 0.5; p.kickPitchDeg *= 0.5; p.kickRollDeg *= 0.5; p.fovDeg *= 0.5;
    return p;
  }
  p.channels.delete("S"); p.channels.delete("C"); p.channels.delete("E");
  p.trauma = 0; p.kickYawDeg = 0; p.kickPitchDeg = 0; p.kickRollDeg = 0; p.fovDeg = 0; p.edge = null;
  p.vibration = null;
  if (p.tier !== "ko") p.koFocus = null;
  return p;
}

/* ───────────────────────── runtime ───────────────────────── */

/** 3.5 maxima reached since the last round reset, degrees and trauma units, for ?debug=feel (WP1 reads). */
export interface JuiceStats { maxRollDeg: number; maxFovDeg: number; maxTrauma: number; capHits: number }

export interface JuiceSystem {
  readonly out: JuiceOutput;
  readonly trauma: number;
  /** The most recent plans (bus order), newest last; kept for ?debug=feel and tests. */
  readonly lastPlans: readonly FeedbackPlan[];
  readonly stats: Readonly<JuiceStats>;
  onEvents(events: readonly GameEvent[], ctx: FeedbackContext): void;
  update(wallDtS: number, ctx: FeedbackContext, settings: Readonly<Settings>): void;
  /** New round: the per-round maxima start again (the motion state is left alone). */
  resetStats(): void;
  reset(): void;
}

interface EdgeEnvelope { strength: number; color: string; bearing: number; ageMs: number }
interface Vibration { seat: Seat; link: LinkId; nx: number; ny: number; nz: number; ageMs: number; durationMs: number }

export function createJuice(hitstopMsFor: HitstopMsFor): JuiceSystem {
  const out: JuiceOutput = {
    yaw: 0, pitch: 0, roll: 0, fovOffsetDeg: 0,
    chromaticOffset: 0, vignetteBoost: 0, desaturate: 0,
    edge: { left: 0, right: 0, top: 0, color: TOKEN_HEX.strike },
    victimVibration: { seat: null, link: null, offset: [0, 0, 0] },
    koFocus: { seat: null, weight: 0 },
    trauma: 0,
  };
  let trauma = 0;
  let noiseT = 0;
  let traumaHz = SHAKE_HZ_TAKEN;
  let strongest = 0;
  let strongestAgeMs = Infinity;
  const kickYaw: Spring1 = createSpring();
  const kickPitch: Spring1 = createSpring();
  const kickRoll: Spring1 = createSpring();
  const fov: Spring1 = createSpring();
  let chromatic = 0;
  let vignette = 0;
  let desat = 0;
  let desatHoldMs = 0;
  let edge: EdgeEnvelope | null = null;
  let vibration: Vibration | null = null;
  let koSeat: Seat | null = null;
  let koAgeMs = 0;
  let koWeight = 0;
  let pendingProfile: JuiceProfile = "full";
  let rollBias = 0;
  const plans: FeedbackPlan[] = [];
  const stats: JuiceStats = { maxRollDeg: 0, maxFovDeg: 0, maxTrauma: 0, capHits: 0 };

  function apply(plan: FeedbackPlan): void {
    if (plan.channels.has("C")) {
      if (plan.trauma > 0) {
        // 3.5: trauma never exceeds 0.35 outside a KO. The KO row is the one event allowed above it.
        const cap = plan.tier === "ko" ? 1 : TRAUMA_MAX_LIVE;
        if (trauma + plan.trauma > cap) stats.capHits++;
        trauma = Math.min(cap, trauma + plan.trauma);
        rollBias = plan.rollBias ? 1 : 0;
        if (plan.trauma >= strongest || strongestAgeMs > 300) {
          strongest = plan.trauma;
          strongestAgeMs = 0;
          traumaHz = plan.traumaHz;
        }
      }
      if (plan.kickYawDeg !== 0) kickImpulse(kickYaw, plan.kickYawDeg * DEG, KICK_OMEGA);
      if (plan.kickPitchDeg !== 0) kickImpulse(kickPitch, plan.kickPitchDeg * DEG, KICK_OMEGA);
      if (plan.kickRollDeg !== 0) kickImpulse(kickRoll, plan.kickRollDeg * DEG, KICK_OMEGA);
      if (plan.fovDeg !== 0) kickImpulse(fov, plan.fovDeg, FOV_OMEGA);
    }
    if (plan.channels.has("E") && plan.edge) {
      edge = { strength: Math.min(1, Math.max(edge && edge.ageMs < EDGE_MS ? edge.strength : 0, plan.edge.strength)), color: plan.edge.color, bearing: plan.edge.bearing, ageMs: 0 };
    }
    if (plan.channels.has("P")) {
      if (plan.chromatic > 0) chromatic = Math.max(chromatic, plan.chromatic);
      if (plan.vignette > 0) vignette = Math.max(vignette, plan.vignette);
      if (plan.desaturate > 0) { desat = Math.max(desat, plan.desaturate); desatHoldMs = Math.max(desatHoldMs, plan.desaturateMs); }
    }
    if (plan.vibration) {
      const v = plan.vibration;
      vibration = { seat: v.seat, link: v.link, nx: v.normal[0], ny: v.normal[1], nz: v.normal[2], ageMs: 0, durationMs: v.durationMs };
    }
    if (plan.koFocus) { koSeat = plan.koFocus; koAgeMs = 0; }
  }

  const sys: JuiceSystem = {
    out,
    get trauma() { return trauma; },
    get lastPlans() { return plans; },
    stats,

    onEvents(events, ctx) {
      plans.length = 0;
      pendingProfile = juiceProfileFor(ctx.preset, ctx.playerSeat);
      for (const e of events) if (e.type === "phase" && e.phase === "round_intro") sys.resetStats();
      for (const e of events) {
        const hs = hitstopMsFor(e, ctx.preset, ctx.playerSeat);
        const plan = applyProfile(planFeedback(e, ctx.playerSeat, Number.isFinite(hs) ? hs : 0), pendingProfile);
        if (plan.channels.size === 0) continue;
        plans.push(plan);
        if (plans.length > 32) plans.shift();
        apply(plan);
      }
    },

    update(wallDtS, ctx, settings) {
      const dt = Math.min(0.1, Math.max(0, Number.isFinite(wallDtS) ? wallDtS : 0));
      const dtMs = dt * 1000;
      const motion = clamp(settings.camera.motion01, 0, 1);
      const stable = settings.camera.cockpit === "stable" ? 0.5 : 1;
      const effects = clamp(settings.video.effects01, 0, 1);

      trauma = Math.max(0, trauma - TRAUMA_DECAY_PER_S * dt);
      strongestAgeMs += dtMs;
      if (strongestAgeMs > 300) strongest = 0;
      noiseT += dt * traumaHz;
      const shake = trauma * trauma * motion * stable;
      const kick = motion * stable;
      stepCritical(kickYaw, 0, KICK_OMEGA, dt);
      stepCritical(kickPitch, 0, KICK_OMEGA, dt);
      stepCritical(kickRoll, 0, KICK_OMEGA, dt);
      stepCritical(fov, 0, FOV_OMEGA, dt);
      const lim = VIEW_OFFSET_MAX_DEG * DEG;
      const rollLim = ROLL_MAX_DEG * DEG;
      // Roll bias (dealt): the roll carries the shake, yaw and pitch fall to half.
      const xyShake = shake * (1 - 0.5 * rollBias);
      const rollShake = shake * (1 + 0.5 * rollBias);
      out.yaw = clamp(xyShake * SHAKE_MAX_YAW_DEG * DEG * noise1(noiseT, 0) + kick * kickYaw.x, -lim, lim) + 0; // + 0: a disabled channel reads +0, never -0
      out.pitch = clamp(xyShake * SHAKE_MAX_PITCH_DEG * DEG * noise1(noiseT, 1) + kick * kickPitch.x, -lim, lim) + 0;
      const rollRaw = rollShake * SHAKE_MAX_ROLL_DEG * DEG * noise1(noiseT, 2) + kick * kickRoll.x;
      out.roll = clamp(rollRaw, -rollLim, rollLim) + 0;
      const fovRaw = motion * fov.x;
      out.fovOffsetDeg = clamp(fovRaw, -FOV_OFFSET_MAX_DEG, FOV_OFFSET_MAX_DEG) + 0;
      // 3.5 asserts: the caps are law; a plan that would have broken one is counted, never shown.
      const inKoBeat = ctx.phase === "ko";
      if (Math.abs(rollRaw) > rollLim || Math.abs(fovRaw) > FOV_OFFSET_MAX_DEG || (!inKoBeat && trauma > TRAUMA_MAX_LIVE + 1e-9)) stats.capHits++;
      stats.maxRollDeg = Math.max(stats.maxRollDeg, Math.abs(out.roll) / DEG);
      stats.maxFovDeg = Math.max(stats.maxFovDeg, Math.abs(out.fovOffsetDeg));
      stats.maxTrauma = Math.max(stats.maxTrauma, trauma);

      chromatic = decay(chromatic, dt, CA_TAU_S);
      if (chromatic < 1e-5) chromatic = 0;
      vignette = decay(vignette, dt, VIGNETTE_TAU_S);
      if (vignette < 1e-4) vignette = 0;
      // Hold for the stun, then fade (tau 120 ms) for whatever part of this frame fell after the hold.
      const fadeS = Math.max(0, dtMs - desatHoldMs) / 1000;
      desatHoldMs = Math.max(0, desatHoldMs - dtMs);
      if (fadeS > 0) desat = decay(desat, fadeS, 0.12);
      if (desat < 1e-3) desat = 0;
      out.chromaticOffset = chromatic * effects;
      out.vignetteBoost = vignette * effects;
      out.desaturate = desat * effects;
      out.trauma = trauma;

      if (edge) {
        edge.ageMs += dtMs;
        const t = edge.ageMs;
        const env = t < 60 ? 1 : t >= EDGE_MS ? 0 : 1 - smooth((t - 60) / (EDGE_MS - 60));
        const s = edge.strength * env * effects;
        // Bearing + = left. Split between the side edges and the top by how far off-centre the contact was.
        const side = clamp(Math.abs(Math.sin(edge.bearing)) * 1.6, 0, 1);
        out.edge.left = edge.bearing > 0 ? s * side : 0;
        out.edge.right = edge.bearing <= 0 ? s * side : 0;
        out.edge.top = s * (1 - side);
        out.edge.color = edge.color;
        if (t >= EDGE_MS) edge = null;
      } else {
        out.edge.left = 0; out.edge.right = 0; out.edge.top = 0;
      }

      const vv = out.victimVibration;
      if (vibration) {
        vibration.ageMs += dtMs;
        const T = vibration.durationMs;
        const t = vibration.ageMs;
        if (t >= T) {
          vibration = null;
          vv.seat = null; vv.link = null; vv.offset[0] = 0; vv.offset[1] = 0; vv.offset[2] = 0;
        } else {
          const sign = vibration.seat === "blaze" ? 1 : -1;       // normal points atlas -> blaze: push the victim away
          const a = VIBRATION_VICTIM_M * (1 - t / T) * Math.sign(Math.sin(2 * Math.PI * VIBRATION_HZ * (t / 1000)) || 1) * motion;
          vv.seat = vibration.seat; vv.link = vibration.link;
          vv.offset[0] = vibration.nx * a * sign; vv.offset[1] = vibration.ny * a * sign; vv.offset[2] = vibration.nz * a * sign;
        }
      } else if (vv.seat !== null) {
        vv.seat = null; vv.link = null; vv.offset[0] = 0; vv.offset[1] = 0; vv.offset[2] = 0;
      }

      // KO focus (8.3): holds on the drooping arm from 150 ms, fully by 1000 ms, while the KO beat lasts.
      if (koSeat !== null) {
        koAgeMs += dtMs;
        const inKo = ctx.phase === "ko";
        const target = inKo ? smooth(clamp((koAgeMs - KO_FOCUS_START_MS) / (KO_FOCUS_FULL_MS - KO_FOCUS_START_MS), 0, 1)) : 0;
        koWeight = inKo ? target : Math.max(0, koWeight - dt / 0.3);
        if (!inKo && koWeight === 0 && koAgeMs > 200) koSeat = null;
      }
      out.koFocus.seat = koSeat;
      out.koFocus.weight = koSeat !== null ? koWeight : 0;
    },

    resetStats() {
      stats.maxRollDeg = 0; stats.maxFovDeg = 0; stats.maxTrauma = 0; stats.capHits = 0;
    },

    reset() {
      trauma = 0; strongest = 0; strongestAgeMs = Infinity; rollBias = 0;
      sys.resetStats();
      resetSpring(kickYaw); resetSpring(kickPitch); resetSpring(kickRoll); resetSpring(fov);
      chromatic = 0; vignette = 0; desat = 0; desatHoldMs = 0; edge = null; vibration = null; koSeat = null; koWeight = 0;
      out.yaw = 0; out.pitch = 0; out.roll = 0; out.fovOffsetDeg = 0; out.chromaticOffset = 0; out.vignetteBoost = 0; out.desaturate = 0; out.trauma = 0;
      out.edge.left = 0; out.edge.right = 0; out.edge.top = 0;
      out.victimVibration.seat = null; out.victimVibration.link = null;
      out.koFocus.seat = null; out.koFocus.weight = 0;
      plans.length = 0;
    },
  };
  return sys;
}

function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
