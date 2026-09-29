// src/game/policy/opponent/personalities.ts (WP4)
// The four entrants as data (GAME_DESIGN 5.5.6, EMOTION_BIBLE 4.3–4.4). OVERSHOOT presses, BACKLASH
// counter-punches, DEADBAND tricks; JIG is the lab's test rig (scripted behaviours only, the same scripts every
// entrant runs when ResetContext.config.behavior names one). "pry" is "steal" everywhere (BUILD_PLAN D8).

import type { AbilityId, LoadoutId, PersonalityId } from "../../contracts.ts";

export const ACTION_IDS = [
  "POKE", "JAB", "HOOK", "SLAM", "WHIFF_PUNISH", "GUARD", "PARRY", "FEINT",
  "CORE_GRAB", "CORE_DOCK", "STEAL", "GRAB_THROW", "ADVANCE", "RETREAT", "CIRCLE", "IDLE_SWAY",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type FlawId = "chains_jabs" | "bites_feints" | "panics";

/** Taunt variants (4.3): each is a primitive in primitives.ts; wave-off is BACKLASH's alone. */
export type TauntId = "BECKON" | "CHATTER" | "SHRUG" | "SLOW_REGUARD" | "WAVE_OFF";

/**
 * Target-shaping temperament (4.4): how the same commanded path is filtered per entrant. The physical PD never
 * changes; everything here shapes the command before it leaves the policy. Jitter is per primitive, never per tick.
 */
export interface Temperament {
  /** Command overshoot as a fraction of the travel of each joint move. */
  overshoot: number;
  /** Ring damping at ringHz: 0.35 is visible, 0.9 is dead; the settle time follows from ζω (4.4's 70 / 140 / 90 ms). */
  ringZeta: number;
  ringHz: number;
  ease: "out" | "inout" | "asym";
  onsetJitterMs: readonly [number, number];
  ampJitter: number;
  /** wrist_roll and jaw trail the rest of the arm by this much. */
  followLagMs: number;
  /** The next primitive may start at this fraction of the recover phase (a range: DEADBAND varies per primitive). */
  overlap: readonly [number, number];
  breathHz: number;
  /** 1 = ±0.012 rad of shoulder_lift; BACKLASH breathes deep and slow. */
  breathDepth: number;
  breathIrregular: boolean;
  gazeTauMs: number;
  /** Fraction of glances that go to the wrong target (DEADBAND 15 %). */
  wrongTargetGlance: number;
  arousalGain: number;
  /** Affect impulse on being hit. */
  onHit: { valence: number; stance: number; composure: number };
}

export interface PersonalityParams {
  id: PersonalityId;
  displayName: string;
  loadout: LoadoutId;
  ability: AbilityId | null;
  preferredGuardX: number;
  weights: Readonly<Partial<Record<ActionId, number>>>;
  baseAggression: number;
  /** Mood tilt when hit: + angrier, − more careful. */
  tilt: number;
  /** Extra weight on score difference in mood (DEADBAND reads the scoreboard twice as hard). */
  scoreWeight: number;
  moodTauS: number;
  temperature: number;
  noiseMul: number;
  windupMul: number;
  slamWindupMul: number;
  reactionMuAddMs: number;
  habitWeight: number;
  habitHalfLifeMul: number;
  flaw: FlawId | null;
  /**
   * Idle sway style: frequency (Hz) and amplitude (m); `circles` swaps the Lissajous for a slow orbit. Amplitudes sit at
   * the low end of 5.5.2's 5–15 mm: faster idle motion steps the servo past its 2.9 mrad saturation every tick and heats.
   */
  idle: { hz: number; ampM: number; circles: boolean };
  throwAffinity: number;
  feintRate: number;
  /** Breath between committed actions (ms), before heat adds its own. Sets the entrant's tempo. */
  restMs: number;
  /**
   * Arcade only: how hard the entrant presses once it has gone a beat without swinging (decision.ts "pressure").
   * 0 never presses; 1 turns a long lull into near-certain offence. Stock presets never read it.
   */
  pressure: number;
  temperament: Temperament;
  /** Taunt group (4.3), drawn without repeating the last one. */
  taunts: readonly TauntId[];
  celebration: "big" | "cool" | "manic";
  dejection: "sink" | "slam_first" | "laugh_off";
  /** After the fear retreat: rally (valence flips to anger) or turtle (guards high). */
  fear: "rally" | "turtle";
}

const TEMPER_OVERSHOOT: Temperament = {
  overshoot: 0.12, ringZeta: 0.35, ringHz: 7.5, ease: "out", onsetJitterMs: [0, 30], ampJitter: 0.08,
  followLagMs: 40, overlap: [0.7, 0.7], breathHz: 0.6, breathDepth: 0.8, breathIrregular: false, gazeTauMs: 120, wrongTargetGlance: 0,
  arousalGain: 1.4, onHit: { valence: -0.2, stance: 0, composure: 0 },
};
const TEMPER_BACKLASH: Temperament = {
  overshoot: 0.03, ringZeta: 0.9, ringHz: 6.5, ease: "inout", onsetJitterMs: [40, 90], ampJitter: 0.03,
  followLagMs: 80, overlap: [0.85, 0.85], breathHz: 0.3, breathDepth: 1.3, breathIrregular: false, gazeTauMs: 220, wrongTargetGlance: 0,
  arousalGain: 0.7, onHit: { valence: 0, stance: -0.4, composure: 0 },
};
const TEMPER_DEADBAND: Temperament = {
  overshoot: 0.08, ringZeta: 0.5, ringHz: 8, ease: "asym", onsetJitterMs: [0, 120], ampJitter: 0.12,
  followLagMs: 60, overlap: [0.6, 0.8], breathHz: 0.45, breathDepth: 1, breathIrregular: true, gazeTauMs: 150, wrongTargetGlance: 0.15,
  arousalGain: 1.0, onHit: { valence: 0, stance: 0, composure: -0.3 },
};

const BASE = {
  noiseMul: 1, windupMul: 1, slamWindupMul: 1, reactionMuAddMs: 0, habitWeight: 1, habitHalfLifeMul: 1, scoreWeight: 1,
};

export const PERSONALITIES: Readonly<Record<PersonalityId, PersonalityParams>> = {
  overshoot: {
    ...BASE,
    id: "overshoot", displayName: "OVERSHOOT", loadout: "whip", ability: "snap",
    preferredGuardX: 0.26,
    weights: { POKE: 1.5, JAB: 1.45, FEINT: 1.2, HOOK: 0.9, SLAM: 0.5, STEAL: 1.2, CORE_GRAB: 1.0, CORE_DOCK: 1.0, GRAB_THROW: 0.3, GUARD: 0.7, PARRY: 0.7, WHIFF_PUNISH: 1.1, ADVANCE: 1.2, RETREAT: 0.6, CIRCLE: 0.8 },
    baseAggression: 0.75, tilt: 0.25, moodTauS: 4, temperature: 1.1,
    noiseMul: 1.15, windupMul: 0.85,
    flaw: "chains_jabs",
    idle: { hz: 0.6, ampM: 0.006, circles: false },
    throwAffinity: 0.3, feintRate: 0.35, restMs: 140, pressure: 1.0,
    temperament: TEMPER_OVERSHOOT, taunts: ["CHATTER", "BECKON", "SHRUG", "SLOW_REGUARD"], celebration: "manic", dejection: "slam_first", fear: "rally",
  },
  backlash: {
    ...BASE,
    id: "backlash", displayName: "BACKLASH", loadout: "anvil", ability: "bulwark",
    preferredGuardX: 0.18,
    weights: { GUARD: 1.5, PARRY: 1.3, WHIFF_PUNISH: 1.6, SLAM: 1.3, CORE_GRAB: 1.2, CORE_DOCK: 1.2, STEAL: 0.6, JAB: 0.9, FEINT: 0.3, POKE: 0.5, HOOK: 0.8, GRAB_THROW: 0.5, ADVANCE: 0.7, RETREAT: 1.0, CIRCLE: 0.7 },
    baseAggression: 0.36, tilt: -0.15, moodTauS: 8, temperature: 0.7,
    noiseMul: 0.8, reactionMuAddMs: 15, slamWindupMul: 1.15,
    flaw: "bites_feints",
    idle: { hz: 0.3, ampM: 0.005, circles: false },
    throwAffinity: 0.5, feintRate: 0.1, restMs: 320, pressure: 0.8,
    temperament: TEMPER_BACKLASH, taunts: ["WAVE_OFF", "SLOW_REGUARD", "BECKON", "SHRUG"], celebration: "cool", dejection: "sink", fear: "turtle",
  },
  deadband: {
    ...BASE,
    id: "deadband", displayName: "DEADBAND", loadout: "pivot", ability: "recoil_coil",
    preferredGuardX: 0.22,
    weights: { FEINT: 1.5, GRAB_THROW: 1.6, STEAL: 1.5, CIRCLE: 1.4, HOOK: 1.2, JAB: 0.9, SLAM: 0.7, GUARD: 0.9, PARRY: 0.9, POKE: 1.0, WHIFF_PUNISH: 1.0, CORE_GRAB: 1.1, CORE_DOCK: 1.1, ADVANCE: 0.9, RETREAT: 0.9 },
    baseAggression: 0.50, tilt: 0, moodTauS: 5, temperature: 1.3,
    scoreWeight: 2, habitWeight: 1.5, habitHalfLifeMul: 1.3,
    flaw: "panics",
    idle: { hz: 0.45, ampM: 0.006, circles: true },
    throwAffinity: 1.0, feintRate: 0.5, restMs: 240, pressure: 0.9,
    temperament: TEMPER_DEADBAND, taunts: ["SHRUG", "CHATTER", "BECKON", "SLOW_REGUARD"], celebration: "big", dejection: "laugh_off", fear: "rally",
  },
  jig: {
    ...BASE,
    id: "jig", displayName: "JIG", loadout: "pivot", ability: null,
    preferredGuardX: 0.20,
    weights: {},
    baseAggression: 0.2, tilt: 0, moodTauS: 5, temperature: 1,
    flaw: null,
    idle: { hz: 0, ampM: 0, circles: false },
    throwAffinity: 0, feintRate: 0, restMs: 0, pressure: 0,
    temperament: TEMPER_BACKLASH, taunts: ["BECKON"], celebration: "cool", dejection: "sink", fear: "turtle",
  },
};

export function weightOf(p: PersonalityParams, a: ActionId): number {
  return p.weights[a] ?? 1;
}

/** Flaw behaviour and adaptation numbers (5.5.6). */
export const FLAW_RULES = {
  chains_jabs: { chainChance: 0.30, punishWindowMs: 500, patchedThreatMax: 0.3 },
  bites_feints: { recognitionMul: 0.6, throwReactionAddMs: 120, feintPunishWindowMs: 700 },
  panics: { composureDecayMul: 2, panicBelow: 0.3, wildNoiseMul: 1.6 },
  exploitsToPatch: 3,
} as const;
