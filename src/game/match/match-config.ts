// src/game/match/match-config.ts (WP1)
// Building, validating, and interpreting MatchConfig. Every entry point that starts a match (quick
// fight, warm up, tutorial, attract, Lab, smoke suite, headless runner) goes through buildMatchConfig,
// so defaults (timestep from the preset, fair delay only where it applies, decision rate) are decided
// in one place. Also derives the per-round RulesConfig (lock-in, underdog, sudden death) and the
// episode meta header the recorder begins with.

import {
  CONTRACTS_VERSION, EPISODE_FORMAT, OBS_SCHEMA, SEATS, VIOLATION_TOLERANCE_RAD, otherSeat,
  type ChunkExecute, type ControlHz, type DriverSpec, type EpisodeMeta, type InputDevice, type InputShapingFlags,
  type JigBehavior, type LoadoutId, type MatchConfig, type MatchPreset, type ModelInfo, type PersonalityId,
  type RulesConfig, type Seat, type SeatConfig, type SeatMeta, type Settings, type StatsTolerances, type TierId,
} from "../contracts.ts";
import { FAIR_DELAY_DEFAULT_MS, FAIR_DELAY_MAX_MS, PRESETS, timestepFor } from "./presets.ts";
import { substream, toSeed } from "../core/rng.ts";

export const ROUND_LENGTH_S = 45;
export const SUDDEN_DEATH_LENGTH_S = 20;
export const LOCK_IN_S = 8;
export const UNDERDOG_LOCK_IN_S = 6;
export const SUDDEN_DEATH_LOCK_IN_S = 4;
export const CORE_INCOMING_AT_S = 12;
export const CORE_DROP_AT_S = 15;
/** Time-up with an Integrity difference at or below this goes to Sudden Death (2.4). */
export const SUDDEN_DEATH_INTEGRITY_MARGIN = 5;
/** Default decisions per control tick for non-human seats (5.3). */
export const DEFAULT_DECIMATION = 2;
/** Fast show turns on automatically after this many matches (2.2). */
export const FAST_SHOW_AUTO_MATCHES = 5;
/** Abilities and Overdrive unlock after this many matches (4.8 onboarding gate). */
export const SHOW_KIT_MATCHES = 3;
/** Match 1 rounds 2–3 (EMOTION_BIBLE 2): 30 s, no Sudden Death. Round 1 is the sparring script. */
export const FIRST_MATCH_ROUND_LENGTH_S = 30;
/** Lock-in in the match-1 sparring round: the Sudden Death value, so `HOLD IT · 4` counts down (2, t₀+25 s). */
export const FIRST_MATCH_LOCK_IN_S = SUDDEN_DEATH_LOCK_IN_S;
/** SYSTEMS CHECK drill (bible 9, WP6): a 20 s DOCK drill under stock physics, no shaping. */
export const DRILL_LENGTH_S = 20;
/** The Core drops this long into the drill. */
export const DRILL_CORE_DROP_S = 0.5;
/** `meta.rounds[i].task` for the drill (9): 25–50 chars, pose and zone from the seed's 8 × 4 grid. */
export function drillTask(seed: number): string {
  const s = toSeed(seed);
  return `dock the core from pose ${(s % 8) + 1} zone ${"ABCD"[(s >>> 3) % 4]}`;
}

/* ───────────────────────── showKit gate table (EMOTION_BIBLE section 2) ───────────────────────── */

/** Per-element gates keyed on `matchesPlayed` at match start. WP6 and WP7 build from this and nothing else. */
export interface ShowKit {
  /** Timer and round pips. */
  timer: boolean;
  /** DEFLECT caption, OPEN / WHIP / PUNISH tags. */
  tags: boolean;
  /** Sudden Death with its entry caption; dock siren. */
  suddenDeath: boolean;
  /** Heat gauge (HEAT captioned once at 60 %). */
  heat: boolean;
  /** Abilities, loadout choice, kit panel. */
  abilities: boolean;
  /** NEW PB stamps, PB ghost swing, `vs PB` round-card deltas. */
  pbStamps: boolean;
  /** VALE number lines (before: coaching only). */
  numbers: boolean;
  /** Verdict buttons beyond REMATCH; SHARE; auto-clip. */
  share: boolean;
  /** Medal stamps count. */
  medals: boolean;
  /** The once-ever STABLE camera hint sits under this match's verdict. */
  stableHint: boolean;
}

export function showKitFor(matchesPlayed: number): ShowKit {
  const m = Math.max(0, Math.floor(matchesPlayed));
  return {
    timer: m >= 1, tags: m >= 1, suddenDeath: m >= 1,
    heat: m >= 2,
    abilities: m >= SHOW_KIT_MATCHES,
    pbStamps: m >= 1,
    numbers: m >= SHOW_KIT_MATCHES,
    share: m >= 2,
    medals: m >= 1,
    stableHint: m === 0,
  };
}

export const PERSONALITY_NAMES: Readonly<Record<PersonalityId, string>> =
  { overshoot: "OVERSHOOT", backlash: "BACKLASH", deadband: "DEADBAND", jig: "JIG" };
export const TIER_NAMES: Readonly<Record<TierId, string>> =
  { rookie: "ROOKIE", contender: "CONTENDER", pro: "PRO", champion: "CHAMPION" };

/** Built-in entrants always fight with their own loadout (4.8). */
export const BUILTIN_LOADOUTS: Readonly<Record<PersonalityId, LoadoutId>> =
  { overshoot: "whip", backlash: "anvil", deadband: "pivot", jig: "pivot" };

/* ───────────────────────── seat helpers ───────────────────────── */

/** Seats whose ctrl comes from a PilotController (human or proxy bot). */
export function isPilotDriven(spec: DriverSpec): boolean {
  return spec.kind === "human" || spec.kind === "proxy";
}

export function humanSeatOf(cfg: Pick<MatchConfig, "seats">): Seat | null {
  for (const s of SEATS) if (cfg.seats[s].driver.kind === "human") return s;
  return null;
}

export function pilotSeatOf(cfg: Pick<MatchConfig, "seats">): Seat | null {
  for (const s of SEATS) if (isPilotDriven(cfg.seats[s].driver)) return s;
  return null;
}

/** Driver kinds that face an external observation delay when a human or proxy is seated (5.3 "Fair delay"). */
export function isExternalPolicy(spec: DriverSpec): boolean {
  return spec.kind === "module" || spec.kind === "trajectory" || spec.kind === "bridge";
}

/** Observation delay actually applied to a seat's observations. */
export function fairDelayFor(cfg: MatchConfig, seat: Seat): number {
  const opp = cfg.seats[otherSeat(seat)].driver;
  return isExternalPolicy(cfg.seats[seat].driver) && isPilotDriven(opp) ? cfg.fairDelayMs : 0;
}

/** Control ticks between decisions for a policy seat. */
export function decimationFor(cfg: MatchConfig, seat: Seat): number {
  const hz = cfg.seats[seat].decisionHz;
  if (!(hz > 0)) return DEFAULT_DECIMATION;
  return Math.max(1, Math.round(cfg.controlHz / hz));
}

export function hasBridgeSeat(cfg: MatchConfig): boolean {
  return SEATS.some((s) => cfg.seats[s].driver.kind === "bridge");
}

/** Display name for a driver (nameplates, captions, episode meta). User models appear under their file name. */
export function driverDisplayName(spec: DriverSpec, callsign: string): string {
  switch (spec.kind) {
    case "human": return callsign;
    case "proxy": return "HUMAN PROXY";
    case "builtin": return PERSONALITY_NAMES[spec.personality];
    case "module": case "trajectory": return spec.fileName;
    case "bridge": return "BRIDGE";
  }
}

/* ───────────────────────── building ───────────────────────── */

export interface SeatInput {
  driver: DriverSpec;
  loadout?: LoadoutId;
  displayName?: string;
  decisionHz?: number;
  chunkExecute?: ChunkExecute;
  temporalEnsembleM?: number | null;
}

export interface MatchInput {
  preset: MatchPreset;
  seats: Record<Seat, SeatInput>;
  context: MatchConfig["context"];
  seed: number;
  timing?: MatchConfig["timing"];
  turbo?: boolean;
  controlHz?: ControlHz;
  bestOf?: MatchConfig["bestOf"];
  actionDelayTicks?: MatchConfig["actionDelayTicks"];
  fairDelayMs?: number;
  strictLimits?: boolean;
  record?: boolean;
  keepEpisodes?: boolean;
  tutorial?: boolean;
  fastShow?: boolean;
  showKit?: boolean;
  callsign?: string;
  /** Wall-clock time for the id; tests pass a fixed date. */
  now?: Date;
}

/** `2026-09-16T12:00:00.000Z-9f2c`: ISO time plus 4 hex digits derived from the seed. */
export function matchIdFor(now: Date, seed: number): string {
  const hex = (substream(seed, "matchId", now.getTime() % 0x7fffffff) & 0xffff).toString(16).padStart(4, "0");
  return `${now.toISOString()}-${hex}`;
}

export function buildMatchConfig(input: MatchInput): MatchConfig {
  const def = PRESETS[input.preset];
  const controlHz = input.controlHz ?? def.controlHz[0];
  const seed = toSeed(input.seed);
  const callsign = input.callsign ?? "PILOT";
  const seats = {} as Record<Seat, SeatConfig>;
  for (const s of SEATS) {
    const si = input.seats[s];
    seats[s] = {
      seat: s,
      displayName: si.displayName ?? driverDisplayName(si.driver, callsign),
      driver: si.driver,
      loadout: si.loadout ?? (si.driver.kind === "builtin" ? BUILTIN_LOADOUTS[si.driver.personality] : "pivot"),
      decisionHz: si.decisionHz ?? controlHz / DEFAULT_DECIMATION,
      chunkExecute: si.chunkExecute ?? "until_next_decision",
      temporalEnsembleM: si.temporalEnsembleM ?? null,
    };
  }
  const anyPilot = SEATS.some((s) => isPilotDriven(seats[s].driver));
  const timing = input.timing ?? (anyPilot ? "live" : "eval");
  return {
    id: matchIdFor(input.now ?? new Date(), seed),
    preset: input.preset,
    timing,
    turbo: timing === "eval" && (input.turbo ?? false),
    controlHz,
    timestep: timestepFor(input.preset, controlHz),
    seed,
    bestOf: input.bestOf ?? 3,
    roundLengthS: ROUND_LENGTH_S,
    seats,
    actionDelayTicks: input.actionDelayTicks ?? 1,
    fairDelayMs: Math.min(FAIR_DELAY_MAX_MS, Math.max(0, input.fairDelayMs ?? FAIR_DELAY_DEFAULT_MS)),
    strictLimits: input.strictLimits ?? false,
    record: input.record ?? true,
    keepEpisodes: input.keepEpisodes ?? true,
    tutorial: input.tutorial ?? input.context === "tutorial",
    fastShow: input.fastShow ?? false,
    showKit: input.showKit ?? true,
    context: input.context,
  };
}

/** Problems that make a config unrunnable, as short uppercase reasons for the Lab. Empty when valid. */
export function validateMatchConfig(cfg: MatchConfig): string[] {
  const errors: string[] = [];
  const def = PRESETS[cfg.preset];
  const pilots = SEATS.filter((s) => isPilotDriven(cfg.seats[s].driver));
  const humans = SEATS.filter((s) => cfg.seats[s].driver.kind === "human");
  if (!def.controlHz.includes(cfg.controlHz)) errors.push(`${def.label} RUNS AT ${def.controlHz.join(" OR ")} HZ`);
  else if (Math.abs(cfg.timestep - timestepFor(cfg.preset, cfg.controlHz)) > 1e-12) errors.push("TIMESTEP DOES NOT MATCH PRESET");
  if (humans.length > 0 && !def.humanAllowed) errors.push(`${def.label} FORBIDS A HUMAN SEAT`);
  if (pilots.length > 1) errors.push("ONE PILOT SEAT AT MOST");
  if (humans.length > 0 && cfg.timing === "eval") errors.push("EVAL NEEDS NO HUMAN");
  if (cfg.turbo && cfg.timing !== "eval") errors.push("TURBO NEEDS EVAL TIMING");
  if (![1, 3, 5].includes(cfg.bestOf)) errors.push("BEST OF 1, 3 OR 5");
  if (!(cfg.fairDelayMs >= 0 && cfg.fairDelayMs <= FAIR_DELAY_MAX_MS)) errors.push("FAIR DELAY 0 TO 200 MS");
  for (const s of SEATS) {
    const sc = cfg.seats[s];
    if (!(sc.decisionHz > 0 && sc.decisionHz <= cfg.controlHz)) errors.push(`${s.toUpperCase()} DECISION RATE OUT OF RANGE`);
    if (typeof sc.chunkExecute === "object" && !(Number.isInteger(sc.chunkExecute.nSteps) && sc.chunkExecute.nSteps >= 1)) {
      errors.push(`${s.toUpperCase()} CHUNK STEPS MUST BE 1 OR MORE`);
    }
  }
  return errors;
}

/* ───────────────────────── settings-derived flags ───────────────────────── */

export function fastShowFrom(settings: Readonly<Settings>): boolean {
  const mode = settings.show.fast;
  return mode === "on" || (mode === "auto" && settings.profile.matchesPlayed >= FAST_SHOW_AUTO_MATCHES);
}

export function showKitFrom(settings: Readonly<Settings>): boolean {
  return settings.profile.matchesPlayed >= SHOW_KIT_MATCHES;
}

/* ───────────────────────── canned matches ───────────────────────── */

export interface QuickFightInput {
  opponent: DriverSpec;
  loadout: LoadoutId;
  preset: MatchPreset;
  seed: number;
  settings: Readonly<Settings>;
  context?: "quick" | "warmup";
  bestOf?: MatchConfig["bestOf"];
  /** Streamer fields (8.4, zero backend): NAME THE CHALLENGER puts a name on the opponent's plate; CHAT SEED fixes the scatter. */
  challengerName?: string;
  chatSeed?: string;
}

/** CHAT SEED → a uint32 seed (empty or blank → null, the caller keeps its random seed). */
export function chatSeedFor(text: string | undefined): number | null {
  const t = (text ?? "").trim();
  return t ? substream(toSeed(0x5eed), "chat", t.toUpperCase()) : null;
}

/** FIGHT from the green room: the pilot in atlas against an entrant in blaze (2.2, 7.3.3). */
export function quickFightConfig(q: QuickFightInput): MatchConfig {
  const name = (q.challengerName ?? "").trim().toUpperCase().slice(0, 16);
  return buildMatchConfig({
    preset: q.preset, context: q.context ?? "quick", seed: chatSeedFor(q.chatSeed) ?? q.seed, bestOf: q.bestOf ?? 3,
    callsign: q.settings.profile.callsign,
    seats: { atlas: { driver: { kind: "human" }, loadout: q.loadout }, blaze: name ? { driver: q.opponent, displayName: name } : { driver: q.opponent } },
    fastShow: fastShowFrom(q.settings), showKit: showKitFrom(q.settings),
  });
}

/** WARM UP: free sparring against JIG with the full HUD, best of 1 (7.3.3). */
export function warmupConfig(seed: number, loadout: LoadoutId, settings: Readonly<Settings>): MatchConfig {
  return quickFightConfig({
    opponent: jigSpec("sparring"), loadout, preset: "arcade", seed, settings, context: "warmup", bestOf: 1,
  });
}

export function jigSpec(behavior: JigBehavior, parkOffsetM?: number): DriverSpec {
  return parkOffsetM === undefined
    ? { kind: "builtin", personality: "jig", tier: "rookie", dda: false, behavior }
    : { kind: "builtin", personality: "jig", tier: "rookie", dda: false, behavior, parkOffsetM };
}

/**
 * Match 1 (EMOTION_BIBLE 2): a real best-of-3 vs BACKLASH Rookie. `tutorial: true` means round 1 is the sparring
 * script (tutorial-script.ts drives BACKLASH, 0 damage both ways, ends only by the pilot's lock); rounds 2–3 are
 * real at 30 s with no Sudden Death. Counts as a played match. No kit, no fast show, mouse only.
 */
export function firstMatchConfig(seed: number, settings: Readonly<Settings>): MatchConfig {
  return buildMatchConfig({
    preset: "arcade", context: "quick", tutorial: true, seed, bestOf: 3, callsign: settings.profile.callsign,
    seats: {
      atlas: { driver: { kind: "human" }, loadout: "pivot" },
      blaze: { driver: { kind: "builtin", personality: "backlash", tier: "rookie", dda: true, behavior: "parked_in_reach" } },
    },
    fastShow: false, showKit: false,
  });
}

/** `tutorial` on a quick match marks match 1: the sparring round, the 30 s rounds, no Sudden Death. */
export function isFirstMatch(cfg: Pick<MatchConfig, "tutorial" | "context">): boolean {
  return cfg.tutorial && cfg.context === "quick";
}

/** Live round length: match 1 plays 30 s rounds; everything else the contract's 45. */
export function roundLengthFor(cfg: MatchConfig): number {
  return isFirstMatch(cfg) ? FIRST_MATCH_ROUND_LENGTH_S : cfg.roundLengthS;
}

/** Sudden Death exists from match 2 (showKit table); match 1 resolves a time-up tie by the rules' tiebreak. */
export function suddenDeathAllowed(cfg: MatchConfig): boolean {
  return !isFirstMatch(cfg);
}
/** A builtin seated in the SPARRING cadence (8.4: two straight losses below Rookie) faces a human. */
export function sparringTier(cfg: MatchConfig): boolean {
  const h = humanSeatOf(cfg);
  if (!h) return false;
  const d = cfg.seats[otherSeat(h)].driver;
  return d.kind === "builtin" && d.behavior === "sparring" && !cfg.tutorial;
}
/**
 * EMOTION_BIBLE 11 WP5 show flags on the RulesConfig, match-level: match 1 round 1 is sparring (0 dealt / 0 taken,
 * the director applies it to round 1 only), the SPARRING cadence lands at ×0.6, and match 1 never sees Sudden Death.
 * Recorded in EpisodeMeta.rules so a re-simulation runs the same rules (determinism.ts showRulesFromMeta).
 */
export function showRulesFor(cfg: MatchConfig): { sparring: "round1" | "tier" | null; noSuddenDeath: boolean } {
  return { sparring: isFirstMatch(cfg) ? "round1" : sparringTier(cfg) ? "tier" : null, noSuddenDeath: !suddenDeathAllowed(cfg) };
}
/** The flags for one round from the recorded match-level value ("round1" applies to round 1 alone). */
export function showRulesFromMeta(rules: { sparring?: "round1" | "tier" | null; noSuddenDeath?: boolean }, round: number): { sparring: "round1" | "tier" | null; noSuddenDeath: boolean } {
  const s = rules.sparring ?? null;
  return { sparring: s === "round1" ? (round === 1 ? "round1" : null) : s, noSuddenDeath: rules.noSuddenDeath === true };
}

/**
 * The daily bout (8.3): the same seed, opponent and scatter for everyone who plays today, so two people can compare
 * Bout Cards. Seed = hash(date); the opponent rotates by day; the tier follows the pilot's record against it.
 */
export interface DailyBout { seed: number; number: number; personality: Exclude<PersonalityId, "jig">; tier: TierId }
const DAILY_ROTATION: readonly Exclude<PersonalityId, "jig">[] = ["backlash", "overshoot", "deadband"];

export function dailyBout(date: Date, record: { w: number; l: number }): DailyBout {
  const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  const seed = substream(toSeed(0x7c11), "daily", day);
  const dayIndex = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const net = record.w - record.l;
  const tier: TierId = net >= 6 ? "champion" : net >= 3 ? "pro" : net >= 1 ? "contender" : "rookie";
  return { seed, number: seed % 10_000, personality: DAILY_ROTATION[((dayIndex % 3) + 3) % 3], tier };
}

/** The match the CLICK TO FIGHT click starts: match 1 for a fresh profile, otherwise today's bout (8.3, 8.4 LLL is the director's). */
export function nextMatchConfig(seed: number, settings: Readonly<Settings>, record: { w: number; l: number }, now: Date): MatchConfig {
  if (settings.profile.matchesPlayed === 0) return firstMatchConfig(seed, settings);
  const bout = dailyBout(now, record);
  return quickFightConfig({
    opponent: { kind: "builtin", personality: bout.personality, tier: bout.tier, dda: true },
    loadout: "pivot", preset: "arcade", seed: bout.seed, settings, bestOf: 3,
  });
}

/**
 * SYSTEMS CHECK (bible 9, WP6): the one drill after match 2. Stock physics (PROVING GROUND), BACKLASH parked in
 * reach, best of 1, recorded with its task string so the exporter can find it. Warm-up context: it counts as no match.
 */
export function systemsCheckConfig(seed: number, settings: Readonly<Settings>): MatchConfig {
  return buildMatchConfig({
    preset: "proving_ground", context: "warmup", seed, bestOf: 1, callsign: settings.profile.callsign,
    seats: {
      atlas: { driver: { kind: "human" }, loadout: "pivot" },
      blaze: { driver: { kind: "builtin", personality: "backlash", tier: "rookie", dda: false, behavior: "parked_in_reach" } },
    },
    fastShow: true, showKit: false,
  });
}

/** Title attract match: OVERSHOOT Pro vs BACKLASH Pro, Arcade, DDA off, unrecorded (2.2). */
export function attractConfig(seed: number): MatchConfig {
  return buildMatchConfig({
    preset: "arcade", context: "attract", seed, timing: "live", bestOf: 3, record: false, keepEpisodes: false,
    fastShow: true, showKit: true,
    seats: {
      atlas: { driver: { kind: "builtin", personality: "overshoot", tier: "pro", dda: false } },
      blaze: { driver: { kind: "builtin", personality: "backlash", tier: "pro", dda: false } },
    },
  });
}

/* ───────────────────────── rules per round ───────────────────────── */

/** RulesConfig for a round: underdog lock-in in Arcade for the seat down a round, 4 s everywhere in sudden death (2.4, 2.5). */
export function rulesConfigFor(cfg: MatchConfig, roundsWon: Readonly<Record<Seat, number>>, suddenDeath: boolean): RulesConfig {
  const comebacks = PRESETS[cfg.preset].comebacks;
  const lockInS = {} as Record<Seat, number>;
  for (const s of SEATS) {
    const down = roundsWon[s] < roundsWon[otherSeat(s)];
    lockInS[s] = suddenDeath ? SUDDEN_DEATH_LOCK_IN_S : comebacks && down ? UNDERDOG_LOCK_IN_S : LOCK_IN_S;
  }
  return {
    preset: cfg.preset,
    roundLengthS: roundLengthFor(cfg),
    suddenDeathLengthS: SUDDEN_DEATH_LENGTH_S,
    loadouts: { atlas: cfg.seats.atlas.loadout, blaze: cfg.seats.blaze.loadout },
    lockInS,
    comebacks,
    coreIncomingAtS: suddenDeath ? 0 : CORE_INCOMING_AT_S,
    coreDropAtS: suddenDeath ? 0 : CORE_DROP_AT_S,
  };
}

/** Round wins needed to take the match. */
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/* ───────────────────────── episode meta ───────────────────────── */

export const STATS_TOLERANCES: StatsTolerances = {
  attackOnsetSpeed: 0.35, attackOnsetMs: 40, debounceMs: 150, reactionDv: 0.25, reactionWindowMs: 800,
  anticipationMarginMs: 100, jerkH: 0.02, chatterMin: 0.01, nearLimit: 0.03, violationTol: VIOLATION_TOLERANCE_RAD,
};

/** Facts about the build and the loaded tuning that only the integrator knows. */
export interface EpisodeProvenanceSource {
  tuning: unknown;
  tuningSha256: string;
  servoParamsHash: string;
  obsSchemaHash: string;
  harnessCommit: string;
  userAgent: string;
}

export interface SeatDriverFacts {
  name: string;
  sha256: string | null;
  claimedSha256: string | null;
  provenance: Record<string, unknown> | null;
  policyDeterministic: boolean | "unchecked";
  inputDevice: InputDevice | null;
}

export function buildEpisodeMeta(
  cfg: MatchConfig, info: ModelInfo, facts: Record<Seat, SeatDriverFacts>,
  shaping: Record<Seat, InputShapingFlags | null>, prov: EpisodeProvenanceSource, now: Date,
): EpisodeMeta {
  const seats = {} as Record<Seat, SeatMeta>;
  const seedStreams: Record<string, number> = {};
  for (const s of SEATS) {
    const sc = cfg.seats[s];
    const d = sc.driver;
    const f = facts[s];
    const meta: SeatMeta = {
      driver: d.kind, name: f.name || sc.displayName, loadout: sc.loadout,
      policySha256: f.sha256, claimedSha256: f.claimedSha256, provenance: f.provenance,
      policyDeterministic: f.policyDeterministic,
      decisionHz: sc.decisionHz, chunkExecute: sc.chunkExecute, temporalEnsembleM: sc.temporalEnsembleM,
      inputDevice: isPilotDriven(d) ? f.inputDevice : null,
    };
    if (d.kind === "builtin") { meta.personality = d.personality; meta.tier = d.tier; }
    if (d.kind === "proxy") meta.proxyBot = d.bot;
    seats[s] = meta;
    for (let r = 1; r <= cfg.bestOf; r++) seedStreams[`seat/${s}/${r}`] = substream(cfg.seed, "seat", s, r);
  }
  for (let r = 1; r <= cfg.bestOf; r++) seedStreams[`physicsInit/${r}`] = substream(cfg.seed, "physicsInit", r);
  return {
    format: EPISODE_FORMAT, episodeId: cfg.id, created: now.toISOString(),
    controlHz: cfg.controlHz, timestep: cfg.timestep, seed: cfg.seed, seedStreams,
    preset: cfg.preset, physics: PRESETS[cfg.preset].physics, scoring: PRESETS[cfg.preset].scoring, timing: cfg.timing,
    actionDelayTicks: cfg.actionDelayTicks, fairDelayMs: SEATS.some((s) => fairDelayFor(cfg, s) > 0) ? cfg.fairDelayMs : 0,
    strictLimits: cfg.strictLimits, seats, inputShaping: shaping,
    rules: { roundLengthS: cfg.roundLengthS, bestOf: cfg.bestOf, ...showRulesFor(cfg) },
    tuning: prov.tuning, tuningSha256: prov.tuningSha256, servoParamsHash: prov.servoParamsHash, tolerances: STATS_TOLERANCES,
    provenance: {
      mujoco: info.mujocoVersion, modelFile: info.modelFile, modelSha256: info.modelSha256, so101Sha256: info.so101Sha256,
      harnessCommit: prov.harnessCommit, userAgent: prov.userAgent, contracts: CONTRACTS_VERSION,
      obsSchemaHash: prov.obsSchemaHash || OBS_SCHEMA,
    },
  };
}
