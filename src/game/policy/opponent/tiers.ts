// src/game/policy/opponent/tiers.ts (WP4)
// Difficulty tiers of the built-in opponent as data (GAME_DESIGN 5.5.5, EMOTION_BIBLE 4.3, 8.4). Tiers change
// perception, timing, precision, judgement and which social behaviours are allowed. They never touch servos,
// damage, reach, or IK. SPARRING_TIER is the sub-Rookie churn guard (8.4): dda.ts hands it out, never a config.

import type { TierId } from "../../contracts.ts";

export interface TierParams {
  id: TierId;
  /** Reaction ex-Gaussian (ms), measured from the true event time; perception lag is included. */
  reaction: { mu: number; sigma: number; tau: number };
  perceptionLagMs: number;
  thinkMs: number;
  /** Execution noise σ = posBaseMm + posPerMpsMm · demanded speed (mm), sampled once per primitive. */
  noise: { posBaseMm: number; posPerMpsMm: number; timingCv: number };
  whiffPunishProb: number;
  feintRecognition: number;
  /** Habit prediction needed to pre-commit a counter; null = never reads. */
  readThreshold: number | null;
  habitHalfLife: number;
  parry: boolean;
  ability: boolean;
  burstProb: number;
  /** Rolling heavy-parry success fraction above which guesses get a deliberate error; null = no parries. */
  heavyParryCap: number | null;
  flawAdaptation: boolean;
  recoverScale: number;
  tempMul: number;
  /** Invisible DDA: ±band around the tier and the AI-side performance target; null = off (Champion). */
  dda: { band: number; target: number } | null;
  /** Rookie's signature mistakes (5.5.5). */
  rookieMistakes: boolean;
  /**
   * Heat discipline (5.5.2 "Heat awareness"): costly moves only start below this heat, heavies and throws 15 below
   * it, and the Core race 20 above it. Idle then cools at −20/s, so better tiers pace themselves and rarely cut out;
   * a Rookie spends to the cutout.
   */
  heatAttackMax: number;
  /** How long after the Core lands (or comes loose) the entrant commits to the race, uniform range in ms. */
  coreHesitationMs: readonly [number, number];
  /**
   * Objective sense, 0..1: how hard the entrant defends its own docked Core (strikes a hand reaching for it) and
   * how early it goes to steal the opponent's. Rookies watch the fight and forget the Core.
   */
  objectiveSense: number;
  /** Opening grace (4.5): nothing that can deal damage starts for this long after the round starts. */
  openingGraceS: number;
  /** Probability that a close call becomes a hesitation or hover (4.3); never at Champion. */
  hesitation: number;
  /** Taunt cooldown (4.3): 16 s at Rookie, 8 s at Champion. */
  tauntCooldownS: number;
  /** SPARRING tier: no SLAM at all. */
  noSlam: boolean;
}

export const TIERS: Readonly<Record<TierId, TierParams>> = {
  rookie: {
    id: "rookie",
    reaction: { mu: 330, sigma: 45, tau: 140 }, perceptionLagMs: 110, thinkMs: 200,
    noise: { posBaseMm: 18, posPerMpsMm: 22, timingCv: 0.18 },
    whiffPunishProb: 0.25, feintRecognition: 0.10, readThreshold: null, habitHalfLife: 8,
    parry: false, ability: false, burstProb: 0, heavyParryCap: null, flawAdaptation: false,
    recoverScale: 1.45, tempMul: 1.6, dda: { band: 0.25, target: -0.15 }, rookieMistakes: true, heatAttackMax: 92, coreHesitationMs: [900, 1800], objectiveSense: 0.1,
    openingGraceS: 3, hesitation: 0.22, tauntCooldownS: 16, noSlam: false,
  },
  contender: {
    id: "contender",
    reaction: { mu: 260, sigma: 35, tau: 90 }, perceptionLagMs: 90, thinkMs: 110,
    noise: { posBaseMm: 9, posPerMpsMm: 12, timingCv: 0.12 },
    whiffPunishProb: 0.50, feintRecognition: 0.35, readThreshold: 0.75, habitHalfLife: 15,
    parry: true, ability: true, burstProb: 0.3, heavyParryCap: 0.40, flawAdaptation: false,
    recoverScale: 1.10, tempMul: 1.0, dda: { band: 0.15, target: -0.05 }, rookieMistakes: false, heatAttackMax: 68, coreHesitationMs: [300, 700], objectiveSense: 0.6,
    openingGraceS: 3, hesitation: 0.18, tauntCooldownS: 13, noSlam: false,
  },
  pro: {
    id: "pro",
    reaction: { mu: 215, sigma: 28, tau: 55 }, perceptionLagMs: 70, thinkMs: 90,
    noise: { posBaseMm: 6, posPerMpsMm: 8, timingCv: 0.08 },
    whiffPunishProb: 0.75, feintRecognition: 0.60, readThreshold: 0.60, habitHalfLife: 25,
    parry: true, ability: true, burstProb: 0.6, heavyParryCap: 0.55, flawAdaptation: true,
    recoverScale: 1.00, tempMul: 0.8, dda: { band: 0.10, target: 0 }, rookieMistakes: false, heatAttackMax: 60, coreHesitationMs: [120, 350], objectiveSense: 0.85,
    openingGraceS: 3, hesitation: 0.08, tauntCooldownS: 10, noSlam: false,
  },
  champion: {
    id: "champion",
    reaction: { mu: 185, sigma: 22, tau: 35 }, perceptionLagMs: 60, thinkMs: 70,
    noise: { posBaseMm: 4, posPerMpsMm: 6, timingCv: 0.06 },
    whiffPunishProb: 0.90, feintRecognition: 0.75, readThreshold: 0.50, habitHalfLife: 40,
    parry: true, ability: true, burstProb: 0.8, heavyParryCap: 0.70, flawAdaptation: true,
    recoverScale: 0.95, tempMul: 0.7, dda: null, rookieMistakes: false, heatAttackMax: 62, coreHesitationMs: [0, 180], objectiveSense: 1,
    openingGraceS: 3, hesitation: 0, tauntCooldownS: 8, noSlam: false,
  },
};

/**
 * The SPARRING tier (8.4): below Rookie for the LLL guard. Rookie's numbers with the sparring cadence: no SLAM,
 * opening grace 5 s, a slower think, and no punishes worth the name. Strike damage ×0.6 is WP5's (damage.ts) and
 * the GUARD caption on every heavy tell is WP7's; both key on `dda.ts` reporting this tier.
 */
export const SPARRING_TIER: TierParams = {
  ...TIERS.rookie,
  reaction: { mu: 380, sigma: 50, tau: 160 }, thinkMs: 220, whiffPunishProb: 0.1, recoverScale: 1.5, tempMul: 1.8,
  openingGraceS: 5, hesitation: 0.4, tauntCooldownS: 16, noSlam: true,
};

/** Heavy-guess deliberate error range once a tier is at its cap (ms, direction random). */
export const HEAVY_GUESS_ERROR_MS: readonly [number, number] = [180, 300];
/** Heavy parry attempts kept in the rolling window. */
export const HEAVY_GUESS_WINDOW = 10;
