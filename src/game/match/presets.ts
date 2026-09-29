// src/game/match/presets.ts (WP1)
// GAME_DESIGN 4.10 as data, with DEMO removed (BUILD_PLAN D4). A preset fixes the physics mode, the
// scoring profile, the timestep for a control rate, what the human command layer may do, whether hit
// stop and dilation exist, the default observation fair delay, comeback rules, how much juice plays,
// and which stamp a model report carries. Everything that differs between ARCADE, PROVING GROUND,
// and HARNESS is read from here; nothing else branches on the preset name for these rules.

import {
  PRESET_PHYSICS, PRESET_SCORING,
  type ControlHz, type MatchPreset, type PhysicsMode, type PilotRules, type ScoringProfile,
} from "../contracts.ts";

export const ARCADE_TIMESTEP = 0.0025;
export const STOCK_TIMESTEP = 0.005;
export const STOCK_FINE_TIMESTEP = 1 / 600;
/** Default observation fair delay when a human or proxy seat faces a module, trajectory, or bridge seat (5.3). */
export const FAIR_DELAY_DEFAULT_MS = 120;
export const FAIR_DELAY_MAX_MS = 200;

/** Juice profile (4.10 "Juice" row): what the feedback layer may play. */
export type JuiceProfile = "full" | "honest" | "spectator";

export interface PresetDefinition {
  preset: MatchPreset;
  label: "ARCADE" | "PROVING GROUND" | "HARNESS";
  physics: PhysicsMode;
  scoring: ScoringProfile;
  modelFile: "arena-arcade.xml" | "arena.xml";
  /** Control rates the preset accepts; the first is the default. */
  controlHz: readonly ControlHz[];
  /** A human (or proxy) may sit in this preset. */
  humanAllowed: boolean;
  /** A human must sit in this preset (none today; kept explicit for the Lab validator). */
  humanRequired: boolean;
  hitstop: boolean;
  dilation: boolean;
  comebacks: boolean;
  juice: JuiceProfile;
  /** Camera shake and kick multiplier for the juice layer. */
  cameraShakeScale: number;
  /** Stamp on any model report: Arcade reports never verify a policy. */
  resultStamp: "arcade_physics" | "verdict";
  /** Human input shaping allowed by the preset, before the onboarding gate (showKit). */
  pilot: Omit<PilotRules, "showKit">;
}

export const PRESETS: Readonly<Record<MatchPreset, PresetDefinition>> = {
  arcade: {
    preset: "arcade", label: "ARCADE", physics: PRESET_PHYSICS.arcade, scoring: PRESET_SCORING.arcade,
    modelFile: "arena-arcade.xml", controlHz: [50], humanAllowed: true, humanRequired: false,
    hitstop: true, dilation: true, comebacks: true, juice: "full", cameraShakeScale: 1, resultStamp: "arcade_physics",
    pilot: { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: true },
  },
  proving_ground: {
    preset: "proving_ground", label: "PROVING GROUND", physics: PRESET_PHYSICS.proving_ground, scoring: PRESET_SCORING.proving_ground,
    modelFile: "arena.xml", controlHz: [50], humanAllowed: true, humanRequired: false,
    hitstop: false, dilation: false, comebacks: false, juice: "honest", cameraShakeScale: 0.5, resultStamp: "verdict",
    pilot: { jabMacro: false, chargeMacro: false, leash: true, guardBlend: true, assists: true, aimAssist: false },
  },
  harness: {
    preset: "harness", label: "HARNESS", physics: PRESET_PHYSICS.harness, scoring: PRESET_SCORING.harness,
    modelFile: "arena.xml", controlHz: [50, 30, 60], humanAllowed: false, humanRequired: false,
    hitstop: false, dilation: false, comebacks: false, juice: "spectator", cameraShakeScale: 0, resultStamp: "verdict",
    pilot: { jabMacro: false, chargeMacro: false, leash: false, guardBlend: false, assists: false, aimAssist: false },
  },
};

export const MATCH_PRESETS: readonly MatchPreset[] = ["arcade", "proving_ground", "harness"];

export function isMatchPreset(v: unknown): v is MatchPreset {
  return typeof v === "string" && (MATCH_PRESETS as readonly string[]).includes(v);
}

/** Physics timestep for a preset at a control rate (4.10 "Timestep"). Throws on a combination the preset does not allow. */
export function timestepFor(preset: MatchPreset, controlHz: ControlHz): number {
  const def = PRESETS[preset];
  if (!def.controlHz.includes(controlHz)) {
    throw new RangeError(`${def.label} runs at ${def.controlHz.join(" or ")} Hz control, not ${controlHz} Hz`);
  }
  if (def.physics === "arcade") return ARCADE_TIMESTEP;
  return controlHz === 50 ? STOCK_TIMESTEP : STOCK_FINE_TIMESTEP;
}

/** Physics steps per control tick: 8 in Arcade, 4 at 5 ms, 20 or 10 at 1/600 s. Always an exact integer. */
export function stepsPerControlTick(timestep: number, controlHz: number): number {
  const n = Math.round(1 / (timestep * controlHz));
  if (n < 1 || Math.abs(n * timestep * controlHz - 1) > 1e-9) {
    throw new RangeError(`timestep ${timestep} s does not divide a ${controlHz} Hz control tick`);
  }
  return n;
}

/** Human command rules for the pilot controller, with the onboarding gate applied (4.8). */
export function pilotRulesFor(preset: MatchPreset, showKit: boolean, opponentIsPolicyOrBuiltin = true): PilotRules {
  const p = PRESETS[preset].pilot;
  return {
    jabMacro: p.jabMacro, chargeMacro: p.chargeMacro, leash: p.leash, guardBlend: p.guardBlend, assists: p.assists,
    aimAssist: p.aimAssist && opponentIsPolicyOrBuiltin,
    showKit: showKit && preset === "arcade",
  };
}

export interface PresetRulesResult {
  physics: PhysicsMode;
  scoring: ScoringProfile;
  timestep: number;
  stepsPerControlTick: number;
  pilotRules: PilotRules;
  hitstop: boolean;
  dilation: boolean;
  comebacks: boolean;
  fairDelayDefaultMs: number;
  definition: PresetDefinition;
}

/** Everything the loop needs from a preset at one control rate (BUILD_PLAN 3 stub table signature, extended). */
export function presetRules(preset: MatchPreset, controlHz: ControlHz = 50, showKit = true): PresetRulesResult {
  const def = PRESETS[preset];
  const timestep = timestepFor(preset, controlHz);
  return {
    physics: def.physics,
    scoring: def.scoring,
    timestep,
    stepsPerControlTick: stepsPerControlTick(timestep, controlHz),
    pilotRules: pilotRulesFor(preset, showKit),
    hitstop: def.hitstop,
    dilation: def.dilation,
    comebacks: def.comebacks,
    fairDelayDefaultMs: def.humanAllowed ? FAIR_DELAY_DEFAULT_MS : 0,
    definition: def,
  };
}
