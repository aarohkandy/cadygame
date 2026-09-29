// src/game/combat/damage.ts (WP5)
// Pure attribution and damage math (GAME_DESIGN 4.2, 4.3). No state: combat-rules.ts owns lockout, stagger and events.
import type { LinkId, LoadoutId, Seat } from "../contracts.ts";
import { LOADOUTS, tuning, vRefFor } from "./tuning.ts";

const S = tuning.arcade.scoring;

export type OnsetClass = "contact" | "clash" | "graze" | "strike";

export interface Attribution {
  kind: OnsetClass;
  attacker: Seat | null;      // null for contact and clash
  nu: number;                 // vN / vRef(attacker); 0 for contact and clash
  alpha: number; beta: number;
}

/**
 * α = aN / vRef(atlas), β = bN / vRef(blaze). Shove below 0.20; clash when both ≥ 0.20 within a 0.75–1.33 ratio;
 * otherwise the larger side attacks and ν = vN / vRef(attacker) splits graze (< 0.35) from strike.
 */
export function attribute(aN: number, bN: number, vN: number, vRefAtlas: number, vRefBlaze: number, out: Attribution): Attribution {
  const alpha = aN / vRefAtlas, beta = bN / vRefBlaze;
  out.alpha = alpha; out.beta = beta;
  if (Math.max(alpha, beta) < S.contactMaxRatio) {
    out.kind = "contact"; out.attacker = null; out.nu = 0;
    return out;
  }
  if (Math.min(alpha, beta) >= S.clashMinRatio) {
    const ratio = alpha / beta;
    if (ratio >= S.clashRatioLo && ratio <= S.clashRatioHi) {
      out.kind = "clash"; out.attacker = null; out.nu = 0;
      return out;
    }
  }
  const attacker: Seat = alpha >= beta ? "atlas" : "blaze";
  const nu = vN / (attacker === "atlas" ? vRefAtlas : vRefBlaze);
  out.attacker = attacker;
  out.nu = nu;
  out.kind = nu < S.strikeNu ? (nu < S.grazeNu ? "contact" : "graze") : "strike";
  return out;
}

export function newAttribution(): Attribution {
  return { kind: "contact", attacker: null, nu: 0, alpha: 0, beta: 0 };
}

/** raw = 20 × clamp((ν − 0.20) / 0.55, 0, 1.45)^1.2, in [0, 31.2]. */
export function rawDamage(nu: number): number {
  const x = (nu - S.rawOffset) / S.rawSpan;
  const c = x < 0 ? 0 : x > S.rawClampMax ? S.rawClampMax : x;
  return S.rawScale * Math.pow(c, S.rawExp);
}

/** Feedback magnitude of a strike or graze. */
export function magnitudeOf(raw: number): number {
  const m = raw / S.rawRef;
  return m < 0 ? 0 : m > 1 ? 1 : m;
}

export function zoneMul(link: LinkId): number { return S.zone[link]; }
export function toolMul(link: LinkId): number { return S.tool[link]; }

/** Stock scoring: raw × zone × tool. Also the `physicalDamage` of every Arcade strike. */
export function physicalDamage(raw: number, victimLink: LinkId, attackerLink: LinkId | null): number {
  return raw * zoneMul(victimLink) * (attackerLink ? toolMul(attackerLink) : 1);
}

/** EMOTION_BIBLE 11 WP5: match-1 round 1 is sparring (0 dealt / 0 taken); the SPARRING tier lands at ×0.6. */
export type SparringMode = "round1" | "tier" | null;
export function sparringMul(mode: SparringMode): number {
  return mode === "round1" ? 0 : mode === "tier" ? S.sparringTierMul : 1;
}

export interface ArcadeDamageInput {
  raw: number; victimLink: LinkId; attackerLink: LinkId | null; attackerLoadout: LoadoutId;
  heavyC: number | null;                 // charge of a heavy-tagged release, null when not tagged
  guarded: boolean; bulwark: boolean; staggered: boolean; cutout: boolean; armoured: boolean;
  followUpIndex: number;                 // k ≥ 1 for the k-th follow-up inside one Stagger, 0 otherwise
  cubeThrow: boolean;
  whip: boolean;                         // landed inside the 300 ms whip carry after a reversal (+10 %)
  sparring: SparringMode;
}

/** Full-profile damage before the combo caps, capped at 45 (4.3). */
export function arcadeDamage(i: ArcadeDamageInput): number {
  const st = tuning.arcade;
  let state = 1;
  if (i.guarded) state *= i.bulwark ? st.abilities.bulwark.chip : st.guard.chip;
  if (i.staggered) state *= st.states.stagger.incoming;
  if (i.cutout) state *= st.states.cutout.incoming;
  if (i.armoured) state *= st.charge.armourMul;
  const heavy = i.heavyC === null ? 1 : 1 + st.charge.heavyPerC * i.heavyC;
  const decay = i.followUpIndex > 0 ? Math.pow(st.states.stagger.decay, i.followUpIndex) : 1;
  const cube = i.cubeThrow ? S.cubeMul : 1;
  const whip = i.whip ? S.whipMul : 1;
  const dmg = physicalDamage(i.raw, i.victimLink, i.attackerLink) * LOADOUTS[i.attackerLoadout].dmg * heavy * state * decay * cube * whip;
  return Math.min(S.damageCap, dmg) * sparringMul(i.sparring);
}

/** Reference-hook damage for a loadout at ν ≈ 1 against a gripper-zone victim with a gripper tool (balance table, 4.3). */
export function referenceHookDamage(loadout: LoadoutId, nu = 1): number {
  return rawDamage(nu) * LOADOUTS[loadout].dmg;
}

export { vRefFor };
