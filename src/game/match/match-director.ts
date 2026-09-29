// src/game/match/match-director.ts (WP6)
// The phase machine (EMOTION_BIBLE 2, 8, 11.9 on top of GAME_DESIGN 2.2): the silent attract loop, the show
// intro (entrance → boot ritual → count-in → ignite → FIGHT, 4.0 s; 2.4 s for round 2+ and rematches), fight,
// KO / lock / time-up, sudden death (match 2+), earned replays (8.6), the 3 s round card, outro with the GG-tap
// window, the verdict; match 1 = best-of-3 vs BACKLASH with round 1 driven by tutorial-script.ts; the SYSTEMS
// CHECK drill after match 2; the LLL guard on rematch; opponent memory in and out of profile.ts; pause and the
// pointer-lock hold rule (7.3.10); single-press skip and 400 ms hold-to-skip; episode finalisation.
// Presentation runs on wall time; in eval timing every non-fight phase runs a fixed number of physics steps.

import {
  SEATS, otherSeat,
  type BestScoreTile, type CameraMode, type CombatSnapshot, type EpisodeStats, type FeedbackContext, type GameEvent,
  type Episode, type EpisodeStore, type LoadoutId, type MatchConfig, type MatchDirector, type MatchPhase, type MomentBuffer,
  type MomentClip, type PhysicsEngine, type PhysicsFrame, type PilotController, type Recorder, type ReplayPlayer,
  type RoundEndReason, type RoundResultRecord, type Seat, type SettingsStore, type SimState, type UiStore,
  type CombatRules, type DriverSpec, type MatchResultRecord, type OneTapLabel, type OpponentMemory, type ResetContext,
  type SessionMeta, type TierId,
  EMPTY_OPPONENT_MEMORY,
} from "../contracts.ts";
import type { DrivenGameClock } from "../loop/game-clock.ts";
import type { MatchContextInfo, SeatBinding, SimDriver, SimListener } from "../loop/sim-driver.ts";
import {
  DRILL_CORE_DROP_S, DRILL_LENGTH_S, FIRST_MATCH_LOCK_IN_S, SUDDEN_DEATH_INTEGRITY_MARGIN, SUDDEN_DEATH_LENGTH_S, attractConfig, buildEpisodeMeta,
  fastShowFrom, hasBridgeSeat, humanSeatOf, isExternalPolicy, isFirstMatch, pilotSeatOf, roundLengthFor, rulesConfigFor, showRulesFor, showRulesFromMeta,
  showKitFrom, suddenDeathAllowed, systemsCheckConfig, validateMatchConfig, winsNeeded,
  type EpisodeProvenanceSource, type SeatDriverFacts,
} from "./match-config.ts";
import { PRESETS, pilotRulesFor, stepsPerControlTick } from "./presets.ts";
import { KO_SLOWMO } from "../camera/juice.ts";
import type { PilotControllerExt } from "../input/pilot-controller.ts";
import { MATCH_REPLAY_S, ROUND_REPLAY_S, planReplay, selectReplayMoment, type ReplayPlan, CLIP_AFTER_S, CLIP_BEFORE_S } from "./replay-moments.ts";
import { createDrillScript, createTutorialScript, type DrillScript, type TutorialScript } from "./tutorial-script.ts";

/* ───────────────────────── timings (2.2) ───────────────────────── */

export const PHASE_MS = {
  matchIntro: { standard: 6000, fast: 2500, skipAfter: 1000 },
  rematchIntro: 1000,
  roundIntro: { standard: { engage: 2400, total: 2900 }, fast: { engage: 1200, total: 1600 } },
  /**
   * The show intro (EMOTION_BIBLE 2, 11.9) for a person in the seat: lights-out + reveal (entrance), the power-on
   * ritual whose last 870 ms are the count-in, then the ignite beat that carries the FIGHT slam. Match intro
   * 1800 + 930 + 870 + 400 = 4.0 s; round 2+ and rematches 1400 + 600 + 400 = 2.4 s (the same arm standing up).
   */
  show: { entrance: 1800, entranceShort: 1400, ritual: 930, countIn: 870, countInShort: 600, ignite: 400 },
  /** GG-tap window at the top of the outro: a click here is a handshake, not a skip (bible WP6). */
  ggTap: 1500,
  ko: 1800,
  koDilationAt: 150,
  lock: { standard: 1500, fast: 1200 },
  timeUp: { standard: 1200, fast: 800 },
  suddenDeathIntro: 1600,
  roundReplay: ROUND_REPLAY_S * 1000,
  /** The round card (11.9): 3 s, `HARDEST HIT · SOLID 1.4 m/s`. */
  roundSummary: 3000,
  matchReplay: MATCH_REPLAY_S * 1000,
  outro: { standard: { win: 4500, loss: 3000 }, fast: { win: 2500, loss: 1500 }, skipAfter: 800 },
  holdSkip: 400,
  lockHold: 3000,
} as const;

/** What the verdict, the memory and the bout card read back from a match (bounded: no contact or servo spam). */
const MATCH_EVENT_TYPES: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "strike", "deflect", "whiff", "late_guard", "core", "ko", "round_end", "match_end", "first_strike", "low_integrity", "combo", "phase",
]);

/** The frozen `TutorialStepId` names carry the sparring steps as a change tick for the UI store. */
const SPAR_UI_STEP = { hit: "flick", guard: "guard", grab: "hook", hold: "dock", locked: "calibrated" } as const;

/** The sparring round's clock (never reached: the round ends only by the pilot's lock, or restarts). */
export const SPARRING_ROUND_LENGTH_S = 180;

/** Eval timing: physics steps per non-fight phase (2.2 "Eval steps"). Phases not listed take 0 steps. */
export const EVAL_STEPS = { koArcade: 720, ko: 360, lock: 300 } as const;

/** KO dilation in Arcade (8.3): a real slow-motion beat, 0.2× for 650 ms, easing back to 1.0 by 1350 ms (KO is 1800). */
export const KO_DILATION = { scale: KO_SLOWMO.scale, holdMs: KO_SLOWMO.ms, easeMs: 650 } as const;

const BETWEEN_ROUND_PHASES: ReadonlySet<MatchPhase> = new Set(["ko", "lock", "time_up", "round_replay", "round_summary", "match_replay", "outro"]);
const LIVE_PHASES: ReadonlySet<MatchPhase> = new Set(["fight", "sudden_death", "systems_check"]);
/** Phases where the pilot is seated but control is not yet live: losing pointer lock here pauses too. */
const INTRO_PHASES: ReadonlySet<MatchPhase> = new Set(["entrance", "boot_ritual", "count_in", "round_intro"]);
/** Match end reasons → the verdict's cause slab (8.2): never a bare DEFEAT. */
export type VerdictCause = "victory" | "shorted_out" | "out_locked" | "out_pointed";
export function verdictCause(won: boolean, reason: RoundEndReason | null): VerdictCause {
  if (won) return "victory";
  if (reason === "ko" || reason === "sudden_death_strike") return "shorted_out";
  if (reason === "lock") return "out_locked";
  return "out_pointed";
}
/** LLL (8.4): one tier down after two straight losses; below Rookie the SPARRING cadence. */
export function tierBelow(tier: TierId): TierId | null {
  switch (tier) {
    case "champion": return "pro";
    case "pro": return "contender";
    case "contender": return "rookie";
    case "rookie": return null;
  }
}

/* ───────────────────────── deps ───────────────────────── */

export interface SeatBindingFactory {
  /** Creates drivers (Workers, in-process modules, bridge sockets, proxy bots) for a config. */
  create(cfg: MatchConfig): Promise<Record<Seat, SeatBinding>>;
  dispose(bindings: Record<Seat, SeatBinding>): void;
}

export interface DirectorHarness {
  createRecorder(): Recorder;
  /** Last seconds of SimState for earned replays; null disables replays (headless). */
  readonly moments: MomentBuffer | null;
  /** Where finished episodes are saved; null keeps them only in whenMatchEnds (headless). */
  readonly store: EpisodeStore | null;
  computeStats: ((ep: Episode) => EpisodeStats) | null;
}

export interface MatchDirectorDeps {
  sim: SimDriver;
  engine: PhysicsEngine;
  rules: CombatRules;
  clock: DrivenGameClock;
  ui: UiStore;
  settings: SettingsStore;
  pilot: PilotController | null;
  seats: SeatBindingFactory;
  harness: DirectorHarness | null;
  replay: ReplayPlayer | null;
  provenance: EpisodeProvenanceSource;
  /** Fresh uint32 seeds for attract, quick fights, and rematches. */
  nextSeed(): number;
  now(): Date;
  /**
   * Opponent memory (bible 4.5, 11.9): WP6 profile.ts owns it. `read` at match start (null = EMPTY_OPPONENT_MEMORY),
   * `write` at the end of every counted human match; `lossStreak` feeds the LLL rule on rematch.
   */
  memory?: {
    read(opponent: DriverSpec): OpponentMemory;
    write(opponent: DriverSpec, events: readonly GameEvent[], player: Seat, won: boolean): void;
    lossStreak(opponent: DriverSpec): number;
  };
  /** Episode /4 session block (9, 11.9), built by game-handle from settings, the frame timing and the device. */
  session?: (cfg: MatchConfig) => SessionMeta;
}

export interface MatchDirectorExtras {
  /** Wall-time phases, replays, hold rules, tutorial. The sim-driver's frame calls this after stepping. */
  update(wallDtS: number): void;
  /** Resolves with the finished episode (null when unrecorded) when the current match reaches post-match or aborts. */
  whenMatchEnds(): Promise<Episode | null>;
  readonly roundsWon: Readonly<Record<Seat, number>>;
  readonly round: number;
  readonly winner: Seat | null;
  /** The match-1 round-1 sparring script while it drives round 1; null otherwise. */
  readonly tutorial: TutorialScript | null;
  /** The SYSTEMS CHECK drill while it runs; null otherwise. */
  readonly drill: DrillScript | null;
  /** The reason the match ended (the verdict's cause slab). */
  readonly finalReason: RoundEndReason | null;
  /** The opponent memory this match runs with (the rematch intro's caption reads it). */
  readonly opponentMemory: OpponentMemory;
  /** True when the pilot tapped GG in the outro window. */
  readonly gg: boolean;
  /** Every strike, deflect, whiff, core and round event of the current match (the verdict reads it). */
  readonly matchEvents: readonly GameEvent[];
  /** Once ever after match 2: the next REMATCH runs the SYSTEMS CHECK drill first. */
  readonly drillPending: boolean;
  /** The GG-tap (outro) or ignore; the click in the FIGHT window is the pilot's, not a skip. */
  ggTap(): void;
  /** A one-tap label (9) while the recorder is live (the round card's "What were you going for?"). */
  label(kind: OneTapLabel["kind"], value: OneTapLabel["value"], shownMs: number): void;
  feedbackContext(camera: FeedbackContext["camera"]): FeedbackContext;
  dispose(): void;
}

/* ───────────────────────── helpers ───────────────────────── */

type Outcome = { winner: Seat; reason: RoundEndReason; t: number };

interface ReplayRun {
  plan: ReplayPlan;
  clip: MomentClip;
  saved: SimState;
  elapsedMs: number;
  lengthMs: number;
}

function opponentKey(cfg: MatchConfig): string {
  const d = cfg.seats.blaze.driver;
  switch (d.kind) {
    case "builtin": return `builtin:${d.personality}:${d.tier}`;
    case "module": case "trajectory": return `${d.kind}:${d.sha256}`;
    case "bridge": return `bridge:${d.url}`;
    default: return d.kind;
  }
}

function formatSeconds(s: number): string {
  return `${s.toFixed(1)} s`;
}

/** Best Score strip (7.4.3) from one round's events. Tiles without a real value are left out. */
export function bestScoreTiles(events: readonly GameEvent[], combat: CombatSnapshot, scoring: "full" | "physical"): BestScoreTile[] | null {
  let hardest: Extract<GameEvent, { type: "strike" }> | null = null;
  let fastest: Extract<GameEvent, { type: "strike" }> | null = null;
  const steals: Record<Seat, number> = { atlas: 0, blaze: 0 };
  for (const e of events) {
    if (e.type === "strike" && e.tier === "strike") {
      const dmg = scoring === "full" ? e.damage : e.physicalDamage;
      const best = hardest ? (scoring === "full" ? hardest.damage : hardest.physicalDamage) : -1;
      if (dmg > best) hardest = e;
      if (!fastest || e.vN > fastest.vN) fastest = e;
    }
    if (e.type === "core" && e.stage === "steal" && e.seat) steals[e.seat]++;
  }
  const tiles: BestScoreTile[] = [];
  if (hardest) {
    const dmg = scoring === "full" ? hardest.damage : hardest.physicalDamage;
    tiles.push({ label: "HARDEST HIT", seat: hardest.attacker, value: `${Math.round(dmg)}`, detail: `IMPACT ${hardest.vN.toFixed(1)} m/s` });
  }
  if (fastest) tiles.push({ label: "FASTEST STRIKE", seat: fastest.attacker, value: fastest.vN.toFixed(2), detail: "m/s" });
  const core = combat.core;
  const heldS = core.owner ? core.lockInTotalS - core.lockInRemainingS : 0;
  if (core.owner && heldS > 0) {
    tiles.push({ label: "OBJECTIVE", seat: core.owner, value: formatSeconds(heldS), detail: "LOCK-IN HELD" });
  } else {
    const stealer: Seat | null = steals.atlas > steals.blaze ? "atlas" : steals.blaze > steals.atlas ? "blaze" : steals.atlas > 0 ? "atlas" : null;
    if (stealer) tiles.push({ label: "OBJECTIVE", seat: stealer, value: `${steals[stealer]}`, detail: steals[stealer] === 1 ? "STEAL" : "STEALS" });
  }
  return tiles.length > 0 ? tiles : null;
}

/* ───────────────────────── director ───────────────────────── */

export function createMatchDirector(deps: MatchDirectorDeps): MatchDirector & MatchDirectorExtras {
  const { sim, engine, rules, clock, ui, settings, pilot } = deps;

  let phase: MatchPhase = "boot";
  let paused = false;
  let config: MatchConfig | null = null;
  let bindings: Record<Seat, SeatBinding> | null = null;
  let recorder: Recorder | null = null;
  let round = 0;
  /** The LOADOUT card the lobby arm wears; the picker pushes it here so the green room arm retunes live. */
  let lobbyLoadout: LoadoutId = "pivot";
  const roundsWon: Record<Seat, number> = { atlas: 0, blaze: 0 };
  let results: RoundResultRecord[] = [];
  let roundEvents: GameEvent[] = [];
  let frameEventsForTutorial: GameEvent[] = [];
  let outcome: Outcome | null = null;
  let pendingSuddenDeath = false;
  let suddenDeathLive = false;
  let matchWinner: Seat | null = null;
  let forfeitSeat: Seat | null = null;
  let finalRoundDecision: Outcome | null = null;
  let finalRoundEvents: GameEvent[] = [];
  let phaseElapsedMs = 0;
  let phaseSteps = 0;
  let koDilated = false;
  let preparedRound = 0;
  let replayRun: ReplayRun | null = null;
  let viewerSaved: SimState | null = null;
  let viewerReturnPhase: MatchPhase = "green_room";
  let holdHeld = false;
  let holdMs = 0;
  let lockHoldMs: number | null = null;
  let tutorial: TutorialScript | null = null;
  let tutorialRevision = 0;
  let tutorialRedrops = 0;
  let drill: DrillScript | null = null;
  let drillSuccessEmitted = false;
  let drillPending = false;
  let afterDrill: MatchConfig | null = null;
  let shortIntro = false;
  let gg = false;
  let memory: OpponentMemory = EMPTY_OPPONENT_MEMORY;
  let matchEvents: GameEvent[] = [];
  let lastOpponent: string | null = null;
  let startToken = 0;
  let matchEnd: { promise: Promise<Episode | null>; resolve: (ep: Episode | null) => void } | null = null;
  let lastUiHoldProgress = 0;
  let lastUiLockHold: number | null = null;
  let lastConfig: MatchConfig | null = null;

  const fast = () => config?.fastShow === true;
  const evalTiming = () => config?.timing === "eval";
  const attract = () => config?.context === "attract";
  const humanSeat = () => (config ? humanSeatOf(config) : null);
  /** The show intro and verdict run for a person in a quick fight, a warm-up or the drill; the Lab keeps the old cards. */
  const showFlow = () => humanSeat() !== null && !evalTiming() && (config?.context === "quick" || config?.context === "warmup");
  const publicPhase = (): MatchPhase => (paused ? "paused" : attract() && phase !== "replay_viewer" ? "attract" : phase);

  function newMatchEnd(): void {
    let resolve!: (ep: Episode | null) => void;
    const promise = new Promise<Episode | null>((r) => { resolve = r; });
    matchEnd = { promise, resolve };
  }

  /** Director-emitted events go to the bus and, for the ones the verdict and memory read, into the match log. */
  /** 3.4 boot ritual pose + LED BOOT on the pilot's arm; null ends it. */
  function ritual(elapsedMs: number | null, totalMs?: number): void {
    (pilot as PilotControllerExt | null)?.setRitual?.(elapsedMs, totalMs);
  }

  function emitMatch(e: GameEvent): void {
    sim.emit(e);
    if (MATCH_EVENT_TYPES.has(e.type) && (e.type !== "phase" || e.phase === "round_intro")) matchEvents.push(e);
  }

  function emitPhase(): void {
    if (attract() && phase !== "title") return;
    const frame = engine.frame;
    emitMatch({
      type: "phase", t: frame.simTime, step: frame.step, phase: publicPhase(), round,
      finalRound: config !== null && round >= 3 && round === config.bestOf,
    });
  }

  function pilotMode(): void {
    if (!pilot) return;
    const seat = config ? pilotSeatOf(config) : null;
    if (!config) { pilot.setMode(phase === "green_room" ? "lobby_cursor" : "frozen"); return; }
    if (!seat) return;
    if (lockHoldMs !== null) pilot.setMode("hold_guard");
    else if (!paused && LIVE_PHASES.has(phase) && (phase !== "sudden_death" || suddenDeathLive)) pilot.setMode("fight");
    else pilot.setMode("frozen");
  }

  function syncUi(): void {
    ui.set({ phase: publicPhase(), round, roundsWon: { atlas: roundsWon.atlas, blaze: roundsWon.blaze } });
  }

  function enter(next: MatchPhase): void {
    phase = next;
    phaseElapsedMs = 0;
    phaseSteps = 0;
    emitPhase();
    syncUi();
    pilotMode();
    onEnter(next);
  }

  /* ── match lifecycle ── */

  function disposeMatch(): void {
    if (replayRun) finishReplay();
    sim.endMatch();
    if (bindings) deps.seats.dispose(bindings);
    bindings = null;
    recorder = null;
    tutorial = null;
    lockHoldMs = null;
    clock.paused = false;
    paused = false;
  }

  function abortMatch(): void {
    const end = matchEnd;
    matchEnd = null;
    disposeMatch();
    config = null;
    end?.resolve(null);
  }

  function prepareRound(r: number): void {
    const cfg = config as MatchConfig;
    round = r;
    rules.reset(tutorialRulesConfig() ?? drillRulesConfig() ?? roundRules(cfg, roundsWon, false, r), r, false, null);
    rules.setLive(false);
    for (const s of SEATS) rules.setProtected(s, false);
    sim.setControlLive(false);
    sim.resetRound(r, attract() ? "attract" : "duel");
    const overrides: Partial<Record<Seat, ResetContext["config"]>> = {};
    // A built-in facing a person learns how new that person is (5.5.5 new-player ramp); DDA decides what to do with it.
    const player = humanSeatOf(cfg);
    if (player) overrides[otherSeat(player)] = { matchesPlayed: settings.get().profile.matchesPlayed };
    if (tutorial && player) overrides[otherSeat(player)] = { ...overrides[otherSeat(player)], behavior: tutorial.behavior, parkOffsetM: tutorial.parkOffsetM };
    tutorialRevision = tutorial?.revision ?? 0;
    tutorialRedrops = tutorial?.redrops ?? 0;
    void sim.resetDrivers(r, overrides, memory);
    pilot?.resetCommand();
    roundEvents = [];
    outcome = null;
    pendingSuddenDeath = false;
    suddenDeathLive = false;
    preparedRound = r;
  }

  /**
   * The sparring round's rules: the Core drops only when the script asks, the pilot's lock-in is the 4.0 s Sudden
   * Death value (`HOLD IT · 4`), and the clock is long enough never to end the round (only the lock does).
   */
  /** The DOCK drill's rules (9): the Core drops at 0.5 s, the round is the 20 s cap. */
  function drillRulesConfig() {
    if (!config || !drill) return null;
    const base = rulesConfigFor(config, { atlas: 0, blaze: 0 }, false);
    return { ...base, roundLengthS: DRILL_LENGTH_S, coreIncomingAtS: 0, coreDropAtS: DRILL_CORE_DROP_S };
  }

  function tutorialRulesConfig() {
    if (!config || !tutorial) return null;
    const base = rulesConfigFor(config, { atlas: 0, blaze: 0 }, false);
    const drop = tutorial.step.coreDrop;
    const never = SPARRING_ROUND_LENGTH_S + 1;
    const h = humanSeatOf(config);
    const lockInS = h ? { ...base.lockInS, [h]: FIRST_MATCH_LOCK_IN_S } : base.lockInS;
    return { ...base, roundLengthS: SPARRING_ROUND_LENGTH_S, lockInS, coreIncomingAtS: drop ? 0 : never, coreDropAtS: drop ? 0.5 : never, sparring: "round1" as const };
  }

  /** The live rules for a round: the preset's config plus the recorded show flags (round 1 sparring is the script's). */
  function roundRules(cfg: MatchConfig, won: Readonly<Record<Seat, number>>, suddenDeath: boolean, r: number) {
    return { ...rulesConfigFor(cfg, won, suddenDeath), ...showRulesFromMeta(showRulesFor(cfg), r) };
  }

  function driverFacts(): Record<Seat, SeatDriverFacts> {
    const cfg = config as MatchConfig;
    const facts = {} as Record<Seat, SeatDriverFacts>;
    for (const s of SEATS) {
      const b = bindings?.[s];
      const d = b?.kind === "policy" ? b.driver : null;
      facts[s] = {
        name: d?.name ?? cfg.seats[s].displayName,
        sha256: d?.sha256 ?? null, claimedSha256: d?.claimedSha256 ?? null, provenance: d?.provenance ?? null,
        policyDeterministic: "unchecked",
        inputDevice: b?.kind === "pilot" ? (b.proxy ? "synthetic" : pilot?.device ?? null) : null,
      };
    }
    return facts;
  }

  async function startMatchImpl(cfg: MatchConfig, rematch: boolean): Promise<void> {
    const errors = validateMatchConfig(cfg);
    if (errors.length > 0) {
      ui.set({ error: errors.join(" · ") });
      throw new Error(`invalid match config: ${errors.join("; ")}`);
    }
    const token = ++startToken;
    if (matchEnd) abortMatch(); else disposeMatch();
    newMatchEnd();
    const created = await deps.seats.create(cfg);
    if (token !== startToken) { deps.seats.dispose(created); return; }

    config = cfg;
    bindings = created;
    round = 0;
    roundsWon.atlas = 0; roundsWon.blaze = 0;
    results = [];
    matchWinner = null;
    forfeitSeat = null;
    finalRoundDecision = null;
    finalRoundEvents = [];
    const player = humanSeatOf(cfg);
    tutorial = isFirstMatch(cfg) && player ? createTutorialScript(player) : null;
    drill = cfg.context === "warmup" && cfg.preset === "proving_ground" && player ? createDrillScript(player, cfg.seed) : null;
    drillSuccessEmitted = false;
    gg = false;
    matchEvents = [];
    shortIntro = rematch;
    const opp = player ? cfg.seats[otherSeat(player)].driver : null;
    memory = opp && deps.memory && cfg.context === "quick" ? deps.memory.read(opp) : EMPTY_OPPONENT_MEMORY;
    recorder = cfg.record && deps.harness ? deps.harness.createRecorder() : null;
    const moments = deps.harness?.moments ?? null;
    moments?.clear();
    sim.configureMatch({ config: cfg, bindings: created, recorder, moments, playerSeat: player, lockstep: cfg.timing === "eval" });
    sim.setRunning(true);
    clock.paused = false;
    paused = false;
    const pSeat = pilotSeatOf(cfg);
    if (pilot && pSeat) {
      const opp = cfg.seats[otherSeat(pSeat)].driver;
      const rules = pilotRulesFor(cfg.preset, cfg.showKit, opp.kind === "builtin");
      // The drill records robot data: no shaping at all (9), so every tick is an unassisted demonstration.
      pilot.setRules(drill ? { ...rules, assists: false, leash: false, guardBlend: false, aimAssist: false, jabMacro: false, chargeMacro: false } : rules);
    }
    ui.set({
      screen: attract() ? "title" : cfg.tutorial ? "tutorial" : "match",
      overlay: null, match: cfg, error: null, bestScore: null, replayMomentLabel: null,
      tutorialStep: null, lockHoldRemainingMs: null, holdSkipProgress: 0,
    });
    if (recorder) {
      const shaping = { atlas: null, blaze: null } as Record<Seat, ReturnType<typeof shapingOf>>;
      if (pSeat) shaping[pSeat] = shapingOf();
      // The first round reset has not run yet, so the engine is still in the mode the lobby left it in
      // (Arcade). Stamp the model this match will actually run on, or VERIFY LAST EPISODE rejects every
      // Proving Ground and Harness episode with MODEL CHANGED.
      const matchModel = engine.infoFor(PRESETS[cfg.preset].physics);
      recorder.begin(buildEpisodeMeta(cfg, matchModel, driverFacts(), shaping, deps.provenance, deps.now()));
      // Episode /4 (11.9): the session block, the memory this match runs with, and the drill's task string on its round.
      const session = player && deps.session ? deps.session(cfg) : undefined;
      recorder.annotate?.({ ...(session ? { session } : {}), opponentMemory: memory, ...(drill ? { tasks: { 1: drill.task } } : {}) });
    }
    prepareRound(1);
    const key = opponentKey(cfg);
    const showIntro = !rematch && key !== lastOpponent && (cfg.context === "quick" || cfg.context === "lab");
    lastOpponent = key;
    // The show flow always plays its intro (4.0 s new, 2.4 s rematch); the Lab keeps the old opponent-changed rule.
    enter(rematch ? "rematch_intro" : showIntro || showFlow() ? "match_intro" : "round_intro");
  }

  function shapingOf() {
    return pilot ? { ...pilot.shaping } : null;
  }

  /* ── phase entry ── */

  function evalStepsFor(p: MatchPhase): number {
    if (!config) return 0;
    if (p === "ko") return PRESETS[config.preset].physics === "arcade" ? EVAL_STEPS.koArcade : EVAL_STEPS.ko;
    if (p === "lock") return EVAL_STEPS.lock;
    return 0;
  }

  function onEnter(next: MatchPhase): void {
    switch (next) {
      case "match_intro":
      case "rematch_intro":
        if (evalTiming()) enter("round_intro");
        else if (showFlow()) enter("entrance");
        return;
      case "entrance":
        if (preparedRound !== round) prepareRound(round);
        return;
      case "round_intro":
        if (preparedRound !== round) prepareRound(round);
        if (evalTiming()) enter("fight");
        return;
      case "fight":
        rules.setLive(true);
        sim.setControlLive(true);
        return;
      case "systems_check":
        rules.setLive(true);
        sim.setControlLive(true);
        return;
      case "sudden_death": {
        const cfg = config as MatchConfig;
        const carry = { integrity: { atlas: rules.state.seats.atlas.integrity, blaze: rules.state.seats.blaze.integrity } };
        rules.reset(roundRules(cfg, roundsWon, true, round), round, true, carry);
        rules.setLive(false);
        suddenDeathLive = false;
        pendingSuddenDeath = false;
        outcome = null;
        if (evalTiming()) goLiveSuddenDeath();
        return;
      }
      case "ko":
        koDilated = false;
        return;
      case "lock":
      case "time_up":
        if (evalTiming() && evalStepsFor(next) === 0) finishResolution();
        return;
      case "outro":
        if (evalTiming()) enter("post_match");
        return;
      case "post_match":
      case "verdict":
        finalize();
        return;
      default:
        return;
    }
  }

  function goLiveSuddenDeath(): void {
    suddenDeathLive = true;
    rules.setLive(true);
    sim.setControlLive(true);
    pilotMode();
  }

  /* ── resolution ── */

  function resolveRound(o: Outcome): void {
    const cfg = config as MatchConfig;
    outcome = o;
    rules.setLive(false);
    sim.setControlLive(false);
    const h = humanSeat();
    if (lockHoldMs !== null && h) { rules.setProtected(h, false); ui.set({ overlay: null, lockHoldRemainingMs: null }); }
    lockHoldMs = null;
    const frame = engine.frame;
    if (o.reason === "time" && !rules.state.suddenDeath && suddenDeathAllowed(cfg) && !drill) {
      const gap = Math.abs(rules.state.seats.atlas.integrity - rules.state.seats.blaze.integrity);
      if (gap <= SUDDEN_DEATH_INTEGRITY_MARGIN) {
        pendingSuddenDeath = true;
        enter("time_up");
        return;
      }
    }
    roundsWon[o.winner]++;
    results.push({ round, winner: o.winner, reason: o.reason, tEnd: o.t });
    emitMatch({ type: "round_end", t: frame.simTime, step: frame.step, winner: o.winner, reason: o.reason, roundsWon: { ...roundsWon } });
    if (roundsWon[o.winner] >= winsNeeded(cfg.bestOf)) declareMatch(o.winner, o);
    const next: MatchPhase = o.reason === "ko" || o.reason === "sudden_death_strike" ? "ko" : o.reason === "lock" ? "lock" : "time_up";
    enter(next);
  }

  function declareMatch(winner: Seat, decision: Outcome | null): void {
    const frame = engine.frame;
    matchWinner = winner;
    finalRoundDecision = decision;
    finalRoundEvents = roundEvents;
    emitMatch({ type: "match_end", t: frame.simTime, step: frame.step, winner, roundsWon: { ...roundsWon } });
  }

  function finishResolution(): void {
    if (pendingSuddenDeath) { enter("sudden_death"); return; }
    if (drill) { enter("post_match"); return; }        // the drill has no replay, outro or verdict: NOMINAL, then the intro
    if (matchWinner) {
      if (startReplay("match_replay")) enter("match_replay");
      else goOutro();
      return;
    }
    if (startReplay("round_replay")) enter("round_replay");
    else goSummaryOrNext();
  }

  function goSummaryOrNext(): void {
    if (!evalTiming() && !fast() && config) {
      ui.set({ bestScore: bestScoreTiles(roundEvents, rules.state, PRESETS[config.preset].scoring) });
      enter("round_summary");
    } else {
      nextRound();
    }
  }

  function nextRound(): void {
    ui.set({ bestScore: null });
    round++;
    tutorial = null;                       // the sparring script drives round 1 only; rounds 2–3 are real
    shortIntro = true;                     // the round-2 intro is the same arm standing up (2.4 s)
    if (showFlow()) { prepareRound(round); enter("entrance"); } else enter("round_intro");
  }

  function goOutro(): void {
    enter(evalTiming() ? "post_match" : "outro");
  }

  function goVerdict(): void {
    enter(showFlow() ? "verdict" : "post_match");
  }

  /* ── earned replays ── */

  function startReplay(kind: "round_replay" | "match_replay"): boolean {
    const moments = deps.harness?.moments;
    if (evalTiming() || !moments) return false;
    const decision = kind === "round_replay" ? outcome : finalRoundDecision;
    const events = kind === "round_replay" ? roundEvents : finalRoundEvents;
    if (!decision) return false;
    const moment = selectReplayMoment(events, decision);
    if (!moment) return false;
    const clip = moments.clip(moment.eventT, CLIP_BEFORE_S, CLIP_AFTER_S);
    if (clip.frames.length < 2) return false;
    const lengthMs = kind === "round_replay" ? PHASE_MS.roundReplay : PHASE_MS.matchReplay;
    const plan = planReplay(moment.eventT, clip.times[0], clip.times[clip.times.length - 1], lengthMs / 1000);
    replayRun = { plan, clip, saved: engine.saveState(), elapsedMs: 0, lengthMs };
    clock.setExternalDrive(true);
    ui.set({ replayMomentLabel: moment.label });
    applyReplayFrame(replayRun);
    return true;
  }

  function applyReplayFrame(run: ReplayRun): void {
    const t = run.plan.clipTimeAt(run.elapsedMs / 1000);
    const { times, frames } = run.clip;
    let i = 0;
    while (i < times.length - 2 && times[i + 1] <= t) i++;
    const span = times[i + 1] - times[i];
    engine.restoreState(frames[i], "prev");
    engine.restoreState(frames[i + 1], "curr");
    clock.setRenderAlpha(span > 0 ? Math.min(1, Math.max(0, (t - times[i]) / span)) : 1);
  }

  function finishReplay(): void {
    const run = replayRun;
    if (!run) return;
    replayRun = null;
    engine.restoreState(run.saved, "both");
    clock.setExternalDrive(false);
    ui.set({ replayMomentLabel: null });
  }

  function endReplayPhase(): void {
    const kind = phase;
    finishReplay();
    if (kind === "match_replay") goOutro(); else goSummaryOrNext();
  }

  /* ── finish ── */

  function finalize(): void {
    const cfg = config as MatchConfig;
    sim.setControlLive(false);
    rules.setLive(false);
    const result: MatchResultRecord = {
      winner: matchWinner, roundsWon: { ...roundsWon }, rounds: results.slice(), forfeit: forfeitSeat,
      determinism: "unchecked", error: sim.error,
    };
    sim.flushEvents();
    const ep = recorder && recorder.recording ? recorder.end(result) : null;
    const end = matchEnd;
    matchEnd = null;
    sim.endMatch();
    if (bindings) deps.seats.dispose(bindings);
    bindings = null;
    recorder = null;
    lastConfig = cfg;

    const player = humanSeatOf(cfg);
    if (player && cfg.context === "quick") {
      const played = settings.get().profile.matchesPlayed + 1;
      settings.set({ profile: { matchesPlayed: played } });
      // The one drill (bible 9): after match 2, before the next REMATCH.
      if (played === 2) drillPending = true;
      deps.memory?.write(cfg.seats[otherSeat(player)].driver, matchEvents, player, matchWinner === player);
    }
    if (drill) { afterDrillDone(); return; }
    if (!attract()) ui.set({ screen: "post_match", overlay: null, bestScore: null });

    const harness = deps.harness;
    if (ep && harness && cfg.context !== "suite") {
      const stats = harness.computeStats ? harness.computeStats(ep) : null;
      ui.set({ lastStats: stats });
      if (harness.store) {
        harness.store.save(ep).then(
          (id) => ui.set({ lastEpisodeId: id }),
          (err: unknown) => ui.set({ error: `EPISODE NOT SAVED · ${err instanceof Error ? err.message : String(err)}` }),
        );
      }
    }
    end?.resolve(ep);
    if (attract()) {
      startMatchImpl(attractConfig(deps.nextSeed()), false).catch((err: unknown) => {
        ui.set({ error: err instanceof Error ? err.message : String(err) });
      });
    }
  }


  /* ── tutorial ── */

  /**
   * The sparring round (bible 2): the script's step change or Core re-drop resets the rules (the drop is a rules
   * config), and its behaviour cue (step, nudge) re-resets BACKLASH's driver. `ui.tutorialStep` is only the
   * change tick; the overlay reads the caption off the script.
   */
  function tutorialFrame(wallDtS: number): void {
    if (!tutorial || !config || phase !== "fight") return;
    const player = humanSeat();
    const changed = tutorial.update(frameEventsForTutorial, rules.state, wallDtS);
    frameEventsForTutorial = [];
    const redrop = tutorial.redrops !== tutorialRedrops;
    if (changed || redrop) {
      tutorialRedrops = tutorial.redrops;
      ui.set({ tutorialStep: SPAR_UI_STEP[tutorial.step.id] });
      if (!tutorial.finished) {
        const carry = { integrity: { atlas: rules.state.seats.atlas.integrity, blaze: rules.state.seats.blaze.integrity } };
        rules.reset(tutorialRulesConfig() ?? roundRules(config, roundsWon, false, round), round, false, carry);
        rules.setLive(true);
      }
    }
    if (tutorial.revision !== tutorialRevision && player) {
      tutorialRevision = tutorial.revision;
      void sim.resetDrivers(round, { [otherSeat(player)]: { behavior: tutorial.behavior, parkOffsetM: tutorial.parkOffsetM } });
    }
  }

  /** The sparring round ends only by the pilot's lock: a KO or the clock resets the bench and the step continues. */
  function restartTutorialRound(reason: RoundEndReason): void {
    if (reason === "ko") sim.resetRound(round, "duel");
    rules.reset(tutorialRulesConfig() ?? roundRules(config as MatchConfig, roundsWon, false, round), round, false, null);
    rules.setLive(true);
    sim.setControlLive(true);
  }

  /* ── SYSTEMS CHECK drill (bible 9) ── */

  /** The drill's lock resolves through the rules like any round; the script's cap ends a timed-out drill. */
  function drillFrame(wallDtS: number): void {
    if (!drill) return;
    // The lock that ends the drill resolves the round on the same step; the script still reads that event.
    const live = phase === "systems_check";
    drill.update(frameEventsForTutorial, live ? wallDtS : 0);
    frameEventsForTutorial = [];
    if (drill.result === "TIMEOUT" && live && !outcome) {
      const h = humanSeat();
      ui.set({ tutorialStep: "calibrated" });
      resolveRound({ winner: otherSeat(h ?? "atlas"), reason: "time", t: engine.frame.simTime });
    } else if (drill.result === "NOMINAL") {
      ui.set({ tutorialStep: "calibrated" });
      if (!drillSuccessEmitted) {
        drillSuccessEmitted = true;   // the recorder's round outcome and the exporter's +1 reward key on this row
        const h = humanSeat() ?? "atlas";
        emitMatch({ type: "task_success", t: engine.frame.simTime, step: engine.frame.step, seat: h, task: drill.task });
      }
    }
  }

  function afterDrillDone(): void {
    const next = afterDrill;
    afterDrill = null;
    drill = null;
    if (next) startMatchImpl(next, true).catch((err: unknown) => { ui.set({ error: err instanceof Error ? err.message : String(err) }); });
    else director.enterTitle();
  }

  /* ── hold rules and skipping ── */

  function holdSkipChain(): void {
    holdMs = 0;
    ui.set({ holdSkipProgress: 0 });
    lastUiHoldProgress = 0;
    finishReplay();
    if (pendingSuddenDeath) enter("sudden_death");
    else if (matchWinner) goVerdict();
    else nextRound();
  }

  function pauseAllowed(): boolean {
    const cfg = config;
    if (!cfg || !humanSeatOf(cfg)) return false;
    return !hasBridgeSeat(cfg) && !(cfg.context === "lab" && cfg.timing === "eval");
  }

  function forfeitBy(loser: Seat): void {
    if (paused) { paused = false; clock.paused = false; ui.set({ overlay: null }); }
    resolveRound({ winner: otherSeat(loser), reason: "forfeit", t: engine.frame.simTime });
  }

  /* ── sim listener ── */

  const listener: SimListener = {
    matchContext(): MatchContextInfo {
      const cfg = config;
      return {
        round, bestOf: cfg?.bestOf ?? 1, phase,
        phaseLengthS: rules.state.suddenDeath ? SUDDEN_DEATH_LENGTH_S : cfg ? roundLengthFor(cfg) : 0,
        roundsWon: { atlas: roundsWon.atlas, blaze: roundsWon.blaze },
      };
    },

    onSimStep(_frame: PhysicsFrame, combat: CombatSnapshot, events: readonly GameEvent[], firstNew: number): void {
      if (!config) return;
      for (let i = firstNew; i < events.length; i++) {
        const e = events[i];
        roundEvents.push(e);
        if (tutorial || drill) frameEventsForTutorial.push(e);
        if (MATCH_EVENT_TYPES.has(e.type)) matchEvents.push(e);
      }
      phaseSteps++;
      if (LIVE_PHASES.has(phase) && !outcome && combat.outcome) {
        const o = combat.outcome;
        const lockedIt = o.reason === "lock" && o.winner === humanSeat();
        if (tutorial && !lockedIt) restartTutorialRound(o.reason);
        else resolveRound({ winner: o.winner, reason: o.reason, t: o.t });
        return;
      }
      if (evalTiming()) {
        const need = evalStepsFor(phase);
        if (need > 0 && phaseSteps >= need) finishResolution();
      }
    },

    onPolicyFault(seat: Seat, kind: "hang" | "disconnect" | "strict"): void {
      const cfg = config;
      if (!cfg || phase === "post_match") return;
      if (kind === "disconnect") {
        if (cfg.context === "lab" && LIVE_PHASES.has(phase) && !outcome) forfeitBy(seat);
        return;
      }
      forfeitSeat = seat;
      if (!matchWinner) declareMatch(otherSeat(seat), null);
      rules.setLive(false);
      sim.setControlLive(false);
      finishReplay();
      if (kind === "hang") goVerdict();
      else goOutro();
    },
  };
  sim.setListener(listener);

  /* ── wall-time update ── */

  function update(wallDtS: number): void {
    const ms = Math.max(0, wallDtS) * 1000;
    if (phase === "replay_viewer") { deps.replay?.update(wallDtS); return; }
    if (paused || !config) return;

    tutorialFrame(wallDtS);
    drillFrame(wallDtS);
    if (!config) return;

    if (lockHoldMs !== null) {
      lockHoldMs -= ms;
      const h = humanSeat();
      if (lockHoldMs <= 0 && h) {
        forfeitBy(h);
      } else {
        const shown = Math.ceil(lockHoldMs / 100) * 100;
        if (shown !== lastUiLockHold) { lastUiLockHold = shown; ui.set({ lockHoldRemainingMs: shown }); }
      }
    }

    if (holdHeld && BETWEEN_ROUND_PHASES.has(phase) && (outcome || matchWinner)) {
      holdMs += ms;
      const progress = Math.min(1, holdMs / PHASE_MS.holdSkip);
      if (Math.abs(progress - lastUiHoldProgress) >= 0.05 || progress === 1) {
        lastUiHoldProgress = progress;
        ui.set({ holdSkipProgress: progress });
      }
      if (holdMs >= PHASE_MS.holdSkip) { holdSkipChain(); return; }
    }

    if (evalTiming()) return;
    phaseElapsedMs += ms;
    const f = fast();
    const show = PHASE_MS.show;
    switch (phase) {
      case "match_intro":
        if (phaseElapsedMs >= (f ? PHASE_MS.matchIntro.fast : PHASE_MS.matchIntro.standard)) enter("round_intro");
        break;
      case "rematch_intro":
        if (phaseElapsedMs >= PHASE_MS.rematchIntro) enter("round_intro");
        break;
      case "entrance":
        if (phaseElapsedMs >= (shortIntro ? show.entranceShort : show.entrance)) enter(shortIntro ? "count_in" : "boot_ritual");
        break;
      case "boot_ritual":
        // 3.4: the six-joint self-test then the slam to LOWERED runs across the ritual and the count-in (1800 ms).
        ritual(phaseElapsedMs, show.ritual + show.countIn);
        if (phaseElapsedMs >= show.ritual) enter("count_in");
        break;
      case "count_in":
        if (shortIntro) ritual(phaseElapsedMs, show.countInShort); else ritual(show.ritual + phaseElapsedMs, show.ritual + show.countIn);
        if (phaseElapsedMs >= (shortIntro ? show.countInShort : show.countIn)) { ritual(null); enter("round_intro"); }
        break;
      case "round_intro":
        if (showFlow()) { if (phaseElapsedMs >= show.ignite) enter(drill ? "systems_check" : "fight"); }
        else if (phaseElapsedMs >= (f ? PHASE_MS.roundIntro.fast.engage : PHASE_MS.roundIntro.standard.engage)) enter("fight");
        break;
      case "sudden_death":
        if (!suddenDeathLive && phaseElapsedMs >= PHASE_MS.suddenDeathIntro) goLiveSuddenDeath();
        break;
      case "ko":
        if (!koDilated && phaseElapsedMs >= PHASE_MS.koDilationAt) {
          koDilated = true;
          if (PRESETS[config.preset].dilation) clock.requestDilation(KO_DILATION.scale, KO_DILATION.holdMs, KO_DILATION.easeMs);
        }
        if (phaseElapsedMs >= PHASE_MS.ko) finishResolution();
        break;
      case "lock":
        if (phaseElapsedMs >= (f ? PHASE_MS.lock.fast : PHASE_MS.lock.standard)) finishResolution();
        break;
      case "time_up":
        if (phaseElapsedMs >= (f ? PHASE_MS.timeUp.fast : PHASE_MS.timeUp.standard)) finishResolution();
        break;
      case "round_replay":
      case "match_replay":
        if (replayRun) {
          replayRun.elapsedMs = Math.min(replayRun.lengthMs, replayRun.elapsedMs + ms);
          applyReplayFrame(replayRun);
          if (replayRun.elapsedMs >= replayRun.lengthMs) endReplayPhase();
        }
        break;
      case "round_summary":
        if (phaseElapsedMs >= PHASE_MS.roundSummary) nextRound();
        break;
      case "outro": {
        const won = humanSeat() === null || matchWinner === humanSeat();
        const table = f ? PHASE_MS.outro.fast : PHASE_MS.outro.standard;
        if (phaseElapsedMs >= (won ? table.win : table.loss)) goVerdict();
        break;
      }
      default:
        break;
    }
  }

  /* ── public surface ── */

  const director: MatchDirector & MatchDirectorExtras = {
    get phase() { return publicPhase(); },
    get config() { return config; },
    get phaseElapsedMs() { return phaseElapsedMs; },
    get roundsWon() { return roundsWon; },
    get round() { return round; },
    get winner() { return matchWinner; },
    get tutorial() { return tutorial; },
    get drill() { return drill; },
    get finalReason() { return finalRoundDecision?.reason ?? null; },
    get opponentMemory() { return memory; },
    get gg() { return gg; },
    get matchEvents() { return matchEvents; },
    get drillPending() { return drillPending; },

    get cameraMode(): CameraMode {
      if (attract()) return "broadcast";
      switch (phase) {
        case "boot": case "title": case "post_match": case "verdict": case "attract": return "broadcast";
        case "green_room": return "lobby";
        case "match_intro": case "rematch_intro": return showFlow() ? "cockpit" : "intro";
        // The reveal and the ritual are seen from the seat (3.4: the ritual is the embark).
        case "entrance": case "boot_ritual": case "count_in": return "cockpit";
        case "round_replay": case "match_replay": case "replay_viewer": return "replay";
        case "outro": return "outro";
        default:
          if (humanSeat()) return "cockpit";
          return config?.context === "lab" ? "lab_overview" : "broadcast";
      }
    },

    get cameraSeat(): Seat {
      if (phase === "outro" && matchWinner) return matchWinner;
      return humanSeat() ?? "atlas";
    },

    enterTitle(): void {
      startToken++;
      if (matchEnd) abortMatch(); else disposeMatch();
      config = null;
      phase = "title";
      phaseElapsedMs = 0;
      emitPhase();
      ui.set({ screen: "title", overlay: null, match: null, phase: "title", loading: null });
      startMatchImpl(attractConfig(deps.nextSeed()), false).catch((err: unknown) => {
        ui.set({ error: err instanceof Error ? err.message : String(err) });
      });
    },

    setLobbyLoadout(id: LoadoutId): void {
      if (id === lobbyLoadout) return;
      lobbyLoadout = id;
      // Only the idle green room arm is retuned; a live match owns its own loadouts.
      if (phase === "green_room") sim.configureLobby("atlas", lobbyLoadout);
    },

    enterGreenRoom(): void {
      startToken++;
      if (matchEnd) abortMatch(); else disposeMatch();
      config = null;
      round = 0;
      roundsWon.atlas = 0; roundsWon.blaze = 0;
      sim.configureLobby("atlas", lobbyLoadout);
      enter("green_room");
      ui.set({
        screen: "green_room",                 // no cockpit prompt on the way to a fight (bible 2); the mount is a pause toggle
        overlay: null, match: null, tutorialStep: null, bestScore: null, replayMomentLabel: null,
        holdSkipProgress: 0, lockHoldRemainingMs: null, loading: null,
      });
    },

    startMatch(cfg: MatchConfig): Promise<void> {
      return startMatchImpl(cfg, false);
    },

    async rematch(): Promise<void> {
      const prev = lastConfig;
      if (!prev || prev.context === "attract" || prev.context === "tutorial") return;
      const seed = deps.nextSeed() >>> 0;
      const now = deps.now();
      const hex = (seed & 0xffff).toString(16).padStart(4, "0");
      const prof = settings.get();
      const player = humanSeatOf(prev);
      const seats = { ...prev.seats };
      // LLL guard (8.4): two straight losses to this opponent → one tier down; below Rookie, the sparring cadence.
      if (player && deps.memory) {
        const oppSeat = otherSeat(player);
        const d = prev.seats[oppSeat].driver;
        if (d.kind === "builtin" && deps.memory.lossStreak(d) >= 2) {
          const below = tierBelow(d.tier);
          const driver: DriverSpec = below ? { ...d, tier: below } : { ...d, behavior: "sparring" };
          seats[oppSeat] = { ...prev.seats[oppSeat], driver };
        }
      }
      const next: MatchConfig = {
        ...prev, seats, seed, id: `${now.toISOString()}-${hex}`,
        tutorial: false, showKit: showKitFrom(prof), fastShow: fastShowFrom(prof),
      };
      if (drillPending && player) {
        drillPending = false;
        afterDrill = next;
        await startMatchImpl(systemsCheckConfig(deps.nextSeed() >>> 0, prof), true);
        return;
      }
      await startMatchImpl(next, true);
    },

    ggTap(): void {
      if (phase === "outro" && phaseElapsedMs <= PHASE_MS.ggTap && !gg) gg = true;
    },

    label(kind, value, shownMs): void {
      const cfg = config;
      const player = humanSeat();
      if (!cfg || !recorder?.recording || !player) return;
      const d = cfg.seats[otherSeat(player)].driver;
      const label: OneTapLabel = {
        kind, round: kind === "intent" ? round : null, value, skipped: value === null, shownMs: Math.round(shownMs),
        opponentBuild: {
          personality: d.kind === "builtin" ? d.personality : null, tier: d.kind === "builtin" ? d.tier : null,
          ddaKMean: 0, cornerVersion: null, cornerSha: d.kind === "module" || d.kind === "trajectory" ? d.sha256 : null,
        },
      };
      recorder.sparse("labels", Math.floor(engine.frame.step / stepsPerControlTick(cfg.timestep, cfg.controlHz)), label);
    },

    pause(): void {
      if (paused || !config || attract()) return;
      if (!LIVE_PHASES.has(phase) && !INTRO_PHASES.has(phase)) return;
      if (!pauseAllowed()) return;
      paused = true;
      clock.paused = true;
      emitPhase();
      syncUi();
      pilotMode();
      ui.set({ overlay: "pause" });
    },

    resume(): void {
      if (!paused) return;
      paused = false;
      clock.paused = false;
      emitPhase();
      syncUi();
      pilotMode();
      ui.set({ overlay: null });
    },

    forfeitRound(): void {
      const h = humanSeat();
      if (!config || !h || outcome) return;
      if (!LIVE_PHASES.has(phase) && !INTRO_PHASES.has(phase)) return;
      if (lockHoldMs !== null) { lockHoldMs = null; rules.setProtected(h, false); ui.set({ lockHoldRemainingMs: null }); }
      forfeitBy(h);
    },

    quitToGreenRoom(): void {
      director.enterGreenRoom();
    },

    onPointerLockChange(locked: boolean): void {
      const h = humanSeat();
      if (!config || !h || attract()) return;
      if (!locked) {
        const inPlay = (LIVE_PHASES.has(phase) || INTRO_PHASES.has(phase)) && !outcome;
        if (!inPlay || paused || lockHoldMs !== null) return;
        if (pauseAllowed()) {
          director.pause();
          ui.set({ overlay: "click_to_fight" });
        } else {
          lockHoldMs = PHASE_MS.lockHold;
          lastUiLockHold = PHASE_MS.lockHold;
          rules.setProtected(h, true);
          pilotMode();
          ui.set({ overlay: "hold_guard", lockHoldRemainingMs: PHASE_MS.lockHold });
        }
        return;
      }
      if (lockHoldMs !== null) {
        lockHoldMs = null;
        rules.setProtected(h, false);
        pilotMode();
        ui.set({ overlay: null, lockHoldRemainingMs: null });
      } else if (paused && ui.get().overlay === "click_to_fight") {
        director.resume();
      }
    },

    skip(): void {
      if (!config || paused) return;
      switch (phase) {
        case "match_intro":
          if (phaseElapsedMs >= PHASE_MS.matchIntro.skipAfter) enter("round_intro");
          return;
        case "round_replay":
          finishReplay();
          goSummaryOrNext();
          return;
        case "match_replay":
          finishReplay();
          goOutro();
          return;
        case "round_summary":
          nextRound();
          return;
        case "outro":
          // The first beat of the outro is the GG-tap window (bible WP6); a click there is a handshake, not a skip.
          if (phaseElapsedMs <= PHASE_MS.ggTap) { director.ggTap(); return; }
          if (phaseElapsedMs >= PHASE_MS.outro.skipAfter) goVerdict();
          return;
        default:
          return;
      }
    },

    setHoldSkip(held: boolean): void {
      holdHeld = held;
      if (!held && holdMs > 0) {
        holdMs = 0;
        lastUiHoldProgress = 0;
        ui.set({ holdSkipProgress: 0 });
      }
    },

    skipTutorial(): void {
      // The sparring round has no skip (bible 2: every step caps on its own); the contract keeps the call.
      if (!tutorial || phase !== "fight") return;
    },

    async openReplay(episodeId: string): Promise<void> {
      const store = deps.harness?.store;
      const player = deps.replay;
      if (!store || !player) throw new Error("replays need an episode store and a replay player");
      if (phase === "replay_viewer") director.closeReplay();
      const ep = await store.load(episodeId);
      viewerSaved = engine.saveState();
      viewerReturnPhase = phase;
      clock.setExternalDrive(true);
      player.load(ep);
      phase = "replay_viewer";
      phaseElapsedMs = 0;
      emitPhase();
      ui.set({ screen: "replay_viewer", phase: "replay_viewer", overlay: null });
    },

    closeReplay(): void {
      if (phase !== "replay_viewer") return;
      if (viewerSaved) engine.restoreState(viewerSaved, "both");
      viewerSaved = null;
      clock.setExternalDrive(false);
      phase = viewerReturnPhase;
      phaseElapsedMs = 0;
      emitPhase();
      ui.set({ screen: "replays", phase: publicPhase() });
    },

    update,

    whenMatchEnds(): Promise<Episode | null> {
      return matchEnd ? matchEnd.promise : Promise.resolve(null);
    },

    feedbackContext(camera: FeedbackContext["camera"]): FeedbackContext {
      const cfg = config;
      const player = humanSeat();
      const opponent = player ? cfg?.seats[otherSeat(player)].driver : undefined;
      return {
        playerSeat: player,
        preset: cfg?.preset ?? "arcade",
        phase: publicPhase(),
        combat: rules.state,
        names: { atlas: cfg?.seats.atlas.displayName ?? "", blaze: cfg?.seats.blaze.displayName ?? "" },
        opponentIsUserModel: opponent ? isExternalPolicy(opponent) : false,
        camera,
        fastShow: fast(),
      };
    },

    dispose(): void {
      startToken++;
      abortMatch();
      sim.setListener(null);
    },
  };
  return director;
}
