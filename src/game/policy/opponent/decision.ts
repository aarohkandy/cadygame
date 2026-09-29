// src/game/policy/opponent/decision.ts (WP4)
// Commitment FSM and utility selector of the built-in opponent (GAME_DESIGN 5.5.1, 5.5.4), the reactive layer
// that turns released perception events into guards, parries, whiff punishes and heavy guesses (5.5.5), the
// personality flaws with their scouting and adaptation (5.5.6), and the character work of EMOTION_BIBLE 4:
// gaze that leads every attack (4.1), tells with floors (4.2), hesitation, taunts, celebration, dejection,
// curiosity and fear as animation groups gated by tier (4.3), the temperament's onset and amplitude jitter and
// overlap (4.4), the menace gauge, the opponent's memory and the show events that say what it decided (4.5).
// The scripted behaviours (ResetContext.config.behavior: the tutorial's sparring cues and the lab's test rig)
// run through the same primitives, so a sparring BACKLASH is the same arm that fights round 2.
//
// The controller runs on a 20 ms grid of sim time. `onObservation` handles what arrived with an observation
// (contacts felt, own servo state); `step` advances the FSM to a tick; `output` is the pose and intents for that
// tick. Randomness only comes from the seeded Rng passed in, in a fixed call order, so a seed replays exactly.

import {
  CLUTTER_CUBES, CORE_CUBE_INDEX, INTENT_BITS,
  type JigBehavior, type Observation, type OpponentMemory, type ResetContext, type Seat, type ShowEvent,
} from "../../contracts.ts";
import { gaussian, type Rng } from "../../core/rng.ts";
import type { DdaScales } from "./dda.ts";
import type { MotionLayers, MotionState } from "./layers.ts";
import { MENACE_BACKSTAGE, MENACE_PROBE, type Mind } from "./mind.ts";
import type { Perception, PerceptEvent } from "./perception.ts";
import { FLAW_RULES, weightOf, type ActionId, type FlawId, type PersonalityParams, type TauntId } from "./personalities.ts";
import {
  ATTACK_ACTIONS, GUARD_PITCH, GUARD_Z, PRIMITIVES, PrimitiveInstance, TIP_FROM_ROLL_AXIS_M, guardPose, samplePrimitiveNoise,
  type BeatId, type Pose, type PrimitiveContext, type PrimitiveDef, type PrimitiveId,
} from "./primitives.ts";
import { HEAVY_GUESS_ERROR_MS, HEAVY_GUESS_WINDOW, type TierParams } from "./tiers.ts";

export const TICK_S = 0.02;
export type FsmState = "NEUTRAL" | "COMMITTED" | "RATTLED" | "RESET_SPACING" | "ROUND_TRANSITION" | "BEAT";

export interface BrainEnv {
  obs: Observation;
  ctx: ResetContext;
  rng: Rng;
  perception: Perception;
  mind: Mind;
  layers: MotionLayers;
  scales: DdaScales;
  tier: TierParams;
  personality: PersonalityParams;
  /** Read from ctx only (4.5); HARNESS and a fresh profile pass the empty record. */
  memory: OpponentMemory;
}

export interface TickOutput { pose: Pose; intents: number; }

export interface FlawReport { flaw: FlawId; stage: "exploited" | "patched"; count: number; }
export interface ParryGuess { expectedReleaseT: number; errorMs: number; capped: boolean; }

/* ───────────────────────── helpers ───────────────────────── */

const SOFTMAX_SCALE = 0.12;
const TOP_K = 4;
const NOVELTY_WINDOW_S = 10;
const RESET_SPACING_CONTACTS = 3;
const RESET_SPACING_WINDOW_S = 2;
const WHIFF_RECOVERY_S = 0.35;
const PARRY_PRESS_LEAD_S = 0.06;
const HEAVY_TRAVEL_S = 0.15;
/**
 * Opening grace (EMOTION_BIBLE 4.5 "tough = smart"): after the round starts (ENGAGE, and the Sudden Death restart)
 * nothing that can deal damage is started for the tier's grace (3 s; 5 s in the SPARRING tier). The opponent lives
 * long enough to have a mood, and a new player's first input always lands before they can be hit. Both seats get
 * it, so builtin mirrors stay even. Tiers carry the number; this is the default they all use.
 */
export const OPENING_GRACE_S = 3.0;
/** Hand speed (m/s) that counts as the other side's input; idle sway and servo hum stay well under it. */
const FIRST_INPUT_SPEED = 0.12;
/**
 * Arcade pressure: after PRESSURE_AFTER_S without starting an attack, offence and closing distance gain weight over
 * PRESSURE_RAMP_S, up to ×(1 + PRESSURE_GAIN · personality.pressure), while waiting options lose half as much. The
 * heat budget and the opening grace still veto, so a pressing entrant visibly stops to breathe when it runs hot.
 */
const PRESSURE_AFTER_S = 0.9;
const PRESSURE_RAMP_S = 1.4;
const PRESSURE_GAIN = 1.6;
const PRESSED: ReadonlySet<ActionId> = new Set<ActionId>([...ATTACK_ACTIONS, "FEINT", "ADVANCE", "GRAB_THROW"]);
const WAITING: ReadonlySet<ActionId> = new Set<ActionId>(["GUARD", "RETREAT", "CIRCLE", "IDLE_SWAY"]);
/** What the opening grace holds back: everything that can land damage (strikes, feints that chain, throws). */
const GRACE_HELD: ReadonlySet<ActionId> = new Set<ActionId>([...ATTACK_ACTIONS, "FEINT", "GRAB_THROW"]);
/** Public charge (c = 0.25) to full charge: the last 450 ms of the 600 ms ramp (4.7). */
const HEAVY_FULL_S = 0.45;
const ABILITY_COOLDOWN_S = 8;
const TAUNT_WINDOW_S = 0.6;
const GUARD_TRACK_GAIN = 0.6;
const GUARD_TRACK_TAU_S = 0.15;
const OU_THETA = 2;
const OU_SIGMA_M = 0.004;
const TREMOR_SMOOTH_S = 0.3;
const REST_PER_HEAT_MS = 12;
const HEAT_EASE_FROM = 45;
const HEAT_STILL_FROM = 40;
/** Gaze lead (4.1): the gripper snaps to the target this long before the strike phase, per primitive class. */
const GAZE_LEAD_FAST_S: readonly [number, number] = [0.15, 0.25];
const GAZE_LEAD_HEAVY_S: readonly [number, number] = [0.25, 0.40];
/** Memory (4.5): guard bias toward the side that hurt it (0.08 rad of pan ≈ this much lateral at the guard). */
const MEMORY_GUARD_BIAS_M = 0.02;
const MEMORY_TELL_SHORTEN = 0.85;
/** Sparring (4.3): re-approach this long after every hit; wind-up hold on cue. */
const SPAR_REAPPROACH_S = 1.5;
const SPAR_HOLD_MAX_S = 3.0;
const SPAR_REPEAT_S = 1.5;
const SPAR_BECKON_EVERY_S: readonly [number, number] = [2.5, 4.0];
/** The parked hand sits on the pilot's flick arc: this tip radius from the pilot's base, 0.3 rad off centre. */
const PARK_PILOT_R = 0.30;
const PARK_PILOT_ANGLE = 0.3;
/** Curiosity (4.3): every 12–25 s in a quiet stretch. */
const CURIOSITY_EVERY_S: readonly [number, number] = [12, 25];
const QUIET_S = 6;
/** Probe (4.5): menace under 0.2 for this long with a passive player. */
const PROBE_AFTER_S = 4;
const TAUNT_IDLE_S = 3;
/** Heavies and throws: the most heat per use. */
const HEAT_HEAVY: ReadonlySet<ActionId> = new Set<ActionId>(["SLAM", "GRAB_THROW", "FEINT"]);
/** The Core race: allowed hotter than fighting, because a lock wins the round. */
const HEAT_OBJECTIVE: ReadonlySet<ActionId> = new Set<ActionId>(["CORE_GRAB", "STEAL"]);
/** Actions that saturate the servos for long stretches; they wait for heat to come down (4.5). */
const HEAT_COSTLY: ReadonlySet<ActionId> = new Set<ActionId>(["POKE", "JAB", "HOOK", "SLAM", "FEINT", "GRAB_THROW", "ADVANCE", "RETREAT", "CIRCLE"]);
const TELL_OF: Readonly<Partial<Record<PrimitiveId, NonNullable<MotionState["tell"]>>>> = {
  POKE: "POKE", JAB: "JAB", WHIFF_PUNISH: "JAB", HOOK: "HOOK", SLAM: "SLAM", CORE_GRAB: "GRAB", STEAL: "GRAB", GRAB_THROW: "GRAB",
};
const SHOW_TELL_OF: Readonly<Partial<Record<PrimitiveId, Extract<ShowEvent, { kind: "tell" }>["primitive"]>>> = {
  POKE: "poke", JAB: "jab", WHIFF_PUNISH: "jab", HOOK: "hook", SLAM: "slam", CORE_GRAB: "grab", STEAL: "grab", GRAB_THROW: "grab",
};

/** Beat primitives (4.3, 4.5): never usage for the novelty window, never an ActionId. */
const BEATS = {
  BECKON: true, CHATTER: true, SHRUG: true, SLOW_REGUARD: true, WAVE_OFF: true, HESITATE: true, HOVER: true,
  CELEBRATE_BIG: true, CELEBRATE_COOL: true, CELEBRATE_MANIC: true, DEJECT: true, DECK_SLAM: true, SNIFF: true, FEAR: true, BACKSTAGE: true,
} as const satisfies Record<BeatId, true>;

/** True when starting `a` at this heat breaks the tier's heat discipline. Before the drop, save heat for the race. */
function overHeatBudget(a: ActionId, heat: number, attackMax: number, coreIncoming: boolean): boolean {
  if (HEAT_OBJECTIVE.has(a)) return heat > attackMax + 20;
  if (!HEAT_COSTLY.has(a)) return false;
  const max = (HEAT_HEAVY.has(a) ? attackMax - 15 : attackMax) - (coreIncoming ? 20 : 0);
  return heat > max;
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function logistic(x: number): number { return 1 / (1 + Math.exp(-x)); }
/** Falling logistic: 1 well inside `centre`, 0 well outside. */
function inReach(d: number, centre: number): number { return logistic((centre - d) / 0.02); }
function dist3(a: ArrayLike<number>, b: ArrayLike<number>): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

function distToSegment(p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let s = len2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return Math.hypot(p[0] - (a[0] + abx * s), p[1] - (a[1] + aby * s), p[2] - (a[2] + abz * s));
}

/** IAUS compensation: each consideration is lifted toward 1 by (1 − 1/n)·(1 − c)·c, then multiplied. */
function compensated(cs: readonly number[]): number {
  const n = cs.length;
  if (n === 0) return 1;
  const mod = 1 - 1 / n;
  let prod = 1;
  for (const c0 of cs) {
    const c = clamp01(c0);
    prod *= c + (1 - c) * mod * c;
  }
  return prod;
}

/** Draws from a group without repeating the last pick (4.3 "never the same one twice running"). */
function pickVariant<T>(rng: Rng, group: readonly T[], last: T | null): T {
  if (group.length <= 1) return group[0];
  const pool = group.filter((x) => x !== last);
  return pool[rng.int(pool.length)];
}

interface HeavyAttempt { pressT: number; impactT: number; success: boolean | null; }
/** A SLAM instance stretched for the sparring hold: the Kabuki top waits up to SPAR_HOLD_MAX_S, the strike is slow. */
const SLAM_SPAR: PrimitiveDef = {
  ...PRIMITIVES.SLAM,
  phases: PRIMITIVES.SLAM.phases.map((ph) => (ph.kind === "active" ? { ...ph, ms: 420 } : ph)),
};

/* ───────────────────────── the brain ───────────────────────── */

export class Decision {
  state: FsmState = "ROUND_TRANSITION";
  current: PrimitiveInstance | null = null;
  currentAction: PrimitiveId | null = null;
  private stateUntil = 0;
  private nextThinkT = 0;
  private lastT = -1;
  private seat: Seat = "blaze";
  /** Scripted behaviour (the tutorial's cues, the lab's rig) or null for the full brain. */
  private behavior: JigBehavior | null = null;
  private parkOffset = 0;

  // Guard pose state
  private guardX = 0.2;
  private spacingOffset = 0;
  private yTrack = 0;
  private ouX = 0;
  private ouY = 0;
  private ouRawX = 0;
  private ouRawY = 0;
  private swayPhase1 = 0;
  private swayPhase2 = 0;
  private guardYBias = 0;
  private readonly guard: Pose = guardPose(0.2, 0);
  private readonly lastPose: Pose = guardPose(0.2, 0);

  // Threat and reactions
  threat = 0;
  private activeThreat: PerceptEvent | null = null;
  private whiffUntil = -1;
  private scheduledReaction: { atT: number; kind: "guard" | "parry"; e: PerceptEvent; pressT: number; heavy: boolean } | null = null;
  private lastBiteT = -10;
  private lastReactT = -10;
  private oppGuardHoldStart = -1;
  private coreFreeSinceT = -1;
  private graceUntil = -1;
  private lastOffenceT = -10;
  private lastAttackEndT = -10;

  // Bookkeeping
  private readonly usage: { a: ActionId; t: number }[] = [];
  private readonly contactTimes: number[] = [];
  private lastSuccessAction: ActionId | null = null;
  private guardDropUntil = -1;
  private lastBigHitT = -10;
  private abilityReadyT = 0;
  private abilityPulseUntil = -1;
  private burstPulseUntil = -1;
  private staggerRolled = false;
  private feintCancelT = -1;
  private feintChainTo: ActionId | null = null;
  private windups = 0;
  private windupGuardResponses = 0;
  private lastWindupT = -10;
  private currentBlocked = false;
  private currentLanded = false;
  private pendingChainJab = false;
  private overlapT = Infinity;
  private tellEmitted = false;
  private pendingGaze: { atT: number; onAim: boolean; wrong: boolean } | null = null;
  private lastContactT = -10;
  private lastOppMoveT = 0;

  // Character (4.3, 4.5)
  private lastTaunt: TauntId | null = null;
  private tauntReadyT = 0;
  private hesitations = 0;
  private lastHesitation: PrimitiveId | null = null;
  private nextCuriosityT = 0;
  private fearPlayed = false;
  private roundBeatPlayed = false;
  private lastRoundsKey = "";
  private backstageUntil = -1;
  private lowMenaceSince = -1;
  private eyeContactDue = false;
  private tellShortenLeft = false;
  private sparNextT = 0;
  private sparReapproachT = -1;
  private readonly showQueue: ShowEvent[] = [];

  // Flaws
  private flawCount = 0;
  private flawPatched = false;
  private chainedJabT = -10;
  /** Flaw reports not yet handed out; one goes out per act (policy debug carries a single flaw). */
  private readonly flawReports: FlawReport[] = [];

  // Heavy guess (5.5.5)
  private readonly heavyAttempts: HeavyAttempt[] = [];
  parryGuess: ParryGuess | null = null;

  utilities: Record<string, number> = {};
  intentLabel = "";
  private readonly ctxScratch: PrimitiveContext = {
    guard: guardPose(0.2, 0), aim: [0.44, 0, 0.15], side: 1, core: [0.32, 0, 0.02], dockSelf: [0.2, 0, 0], dockOpponent: [0.44, 0, 0],
    cube: [0.3, 0, 0.02], throwTarget: [0.44, 0, 0.12], from: guardPose(0.2, 0),
  };
  private readonly motionState: MotionState = { phase: "transition", tell: null, side: 1 };

  get primitive(): string { return this.currentAction ?? (this.behavior === "parked_in_reach" || this.behavior === "sparring" ? "PARK" : "GUARD"); }
  get phase(): string { return this.current && this.lastT >= 0 ? this.current.kindAt(this.lastT) : "neutral"; }
  get scripted(): boolean { return this.behavior !== null; }

  reset(env: BrainEnv, newMatch: boolean): void {
    const p = env.personality;
    this.seat = env.ctx.side;
    this.behavior = env.ctx.config?.behavior ?? (p.id === "jig" ? "idle" : null);
    this.parkOffset = Math.max(-0.06, Math.min(0.12, env.ctx.config?.parkOffsetM ?? 0));
    this.state = "ROUND_TRANSITION";
    this.current = null; this.currentAction = null;
    this.stateUntil = 0; this.nextThinkT = 0; this.lastT = -1;
    this.guardX = p.preferredGuardX; this.spacingOffset = 0; this.yTrack = 0; this.ouX = 0; this.ouY = 0; this.ouRawX = 0; this.ouRawY = 0;
    this.swayPhase1 = env.rng.range(0, Math.PI * 2);
    this.swayPhase2 = env.rng.range(0, Math.PI * 2);
    Object.assign(this.guard, guardPose(this.guardX, 0));
    Object.assign(this.lastPose, this.guard);
    this.threat = 0; this.activeThreat = null; this.whiffUntil = -1; this.scheduledReaction = null;
    this.lastBiteT = -10; this.lastReactT = -10; this.oppGuardHoldStart = -1; this.coreFreeSinceT = -1; this.graceUntil = -1;
    this.lastOffenceT = -10; this.lastAttackEndT = -10;
    this.usage.length = 0; this.contactTimes.length = 0; this.lastSuccessAction = null; this.guardDropUntil = -1;
    this.lastBigHitT = -10; this.abilityReadyT = 0; this.abilityPulseUntil = -1; this.burstPulseUntil = -1; this.staggerRolled = false;
    this.feintCancelT = -1; this.feintChainTo = null; this.lastWindupT = -10; this.currentBlocked = false; this.currentLanded = false;
    this.pendingChainJab = false; this.overlapT = Infinity; this.tellEmitted = false; this.pendingGaze = null; this.lastContactT = -10; this.lastOppMoveT = 0;
    this.chainedJabT = -10; this.flawReports.length = 0; this.parryGuess = null; this.utilities = {}; this.intentLabel = "";
    this.hesitations = 0; this.lastHesitation = null; this.nextCuriosityT = 0; this.fearPlayed = false; this.roundBeatPlayed = false; this.lastRoundsKey = "";
    this.backstageUntil = -1; this.lowMenaceSince = -1; this.sparNextT = 0; this.sparReapproachT = -1; this.showQueue.length = 0;
    this.motionState.phase = "transition"; this.motionState.tell = null; this.motionState.side = 1;
    if (newMatch) {
      this.windups = 0; this.windupGuardResponses = 0;
      this.flawCount = 0; this.flawPatched = false;
      this.heavyAttempts.length = 0;
      this.lastTaunt = null; this.tauntReadyT = 0;
      // Memory (4.5), read from ctx only: what it remembers changes deterministically what it does.
      const mem = env.memory;
      this.guardYBias = MEMORY_GUARD_BIAS_M * mem.hurtSide;
      this.tellShortenLeft = mem.bestMove !== null && mem.bestMove in PRIMITIVES;
      if (mem.grudge > 0) env.mind.holdGrudge(mem.grudge);
      if (mem.timeToFirstAttackS !== null && mem.timeToFirstAttackS < 2) env.mind.kick(0.2, 0, -0.4);
    }
    this.eyeContactDue = env.memory.grudge <= 0;
    const a = env.ctx.arena;
    this.ctxScratch.dockSelf = [a.dock_self[0], a.dock_self[1], a.dock_self[2]];
    this.ctxScratch.dockOpponent = [a.dock_opponent[0], a.dock_opponent[1], a.dock_opponent[2]];
    this.applyFlawModifiers(env);
  }

  /** Flaw effects that live outside this class (composure decay lives in Mind). */
  private applyFlawModifiers(env: BrainEnv): void {
    env.mind.composureDecayMul = env.personality.flaw === "panics" && !this.flawPatched ? FLAW_RULES.panics.composureDecayMul : 1;
  }

  /** Feint recognition after personality flaw, patch, memory and DDA. */
  private recognition(env: BrainEnv): number {
    let r = env.tier.feintRecognition;
    if (env.personality.flaw === "bites_feints" && !this.flawPatched) r *= FLAW_RULES.bites_feints.recognitionMul;
    if (env.memory.feintsWorked >= 2) r *= 1.25;          // it learned (4.5)
    return clamp01(r * env.scales.recognitionMul);
  }

  /** Show events since the last drain (index.ts publishes them through the policy status channel). */
  takeShow(): ShowEvent[] {
    if (this.showQueue.length === 0) return [];
    return this.showQueue.splice(0, this.showQueue.length);
  }

  private show(e: ShowEvent): void {
    this.showQueue.push(e);
    if (this.showQueue.length > 32) this.showQueue.shift();
  }

  /** What the body is doing at t, for the motion layers (attenuation and the tell pose). */
  motion(t: number): MotionState {
    const m = this.motionState;
    const cur = this.current;
    const fight = this.state !== "ROUND_TRANSITION";
    if (!fight && this.state !== "BEAT") { m.phase = "transition"; m.tell = null; return m; }
    if (!cur || t >= cur.endT) { m.phase = "idle"; m.tell = null; return m; }
    if (t < cur.startT) { m.phase = "idle"; m.tell = null; return m; }
    const k = cur.kindAt(t);
    m.phase = k === "done" ? "idle" : k;
    m.tell = k === "windup" ? TELL_OF[cur.def.id] ?? null : null;
    m.side = this.ctxScratch.side;
    return m;
  }

  /* ───────── flaws ───────── */

  private exploit(env: BrainEnv, flaw: FlawId): void {
    if (env.personality.flaw !== flaw || this.flawPatched) return;
    this.flawCount++;
    this.flawReports.push({ flaw, stage: "exploited", count: this.flawCount });
    if (env.tier.flawAdaptation && this.flawCount >= FLAW_RULES.exploitsToPatch) {
      this.flawPatched = true;
      this.flawReports.push({ flaw, stage: "patched", count: this.flawCount });
      this.applyFlawModifiers(env);
    }
  }

  /* ───────── observation-rate input ───────── */

  onObservation(env: BrainEnv): void {
    const obs = env.obs;
    const mind = env.mind;
    const fight = obs.round.phase === "fight" || obs.round.phase === "sudden_death";
    for (const c of env.perception.felt) {
      const onsetKind = c.kind === "strike" || c.kind === "graze" || c.kind === "deflect" || c.kind === "clash" || c.kind === "contact";
      if (onsetKind) {
        this.contactTimes.push(c.t);
        while (this.contactTimes.length > 0 && c.t - this.contactTimes[0] > RESET_SPACING_WINDOW_S) this.contactTimes.shift();
        this.lastContactT = c.t;
        mind.noteContact(c.t);
      }
      if (c.attacker === "opponent" && onsetKind) {
        // Commanded flinch (4.1) on the first decision tick after the contact: the render shiver (WP5) is on the
        // contact frame, this lands ≤ 40 ms of sim time after the freeze. Light contact 40 %, blocked 60 %.
        const m = clamp01(c.damageToSelf > 0 ? c.damageToSelf / 40 : 0.15);
        const kind = c.kind === "deflect" || c.kind === "clash" ? "blocked" : c.damageToSelf <= 0 || c.kind === "graze" || c.kind === "contact" ? "light" : "hit";
        const side = (env.perception.view.oppEe[1] >= this.guard.y ? 1 : -1);
        env.layers.flinch(obs.t, m, side, kind, env.rng);
        mind.noteFlinch(m);
        this.show({ kind: "flinch", seat: this.seat, m: Math.round(m * 100) / 100 });
        if (fight && this.behavior !== null) this.sparReapproachT = obs.t + SPAR_REAPPROACH_S;
        this.eyeContactDue = true;
      }
      if (c.attacker === "opponent" && c.kind === "cube_hit") env.layers.flinch(obs.t, 0.3, 1, "core", env.rng);
      if (c.attacker === "opponent" && c.damageToSelf > 0) {
        const composureBefore = mind.mood.composure;
        mind.noteDamage(c.damageToSelf, 0);
        if (c.t - this.chainedJabT <= FLAW_RULES.chains_jabs.punishWindowMs / 1000) { this.chainedJabT = -10; this.exploit(env, "chains_jabs"); }
        if (c.t - this.lastBiteT <= FLAW_RULES.bites_feints.feintPunishWindowMs / 1000 && this.lastBiteT > 0) { this.lastBiteT = -10; this.exploit(env, "bites_feints"); }
        if (composureBefore < FLAW_RULES.panics.panicBelow) this.exploit(env, "panics");
        for (const h of this.heavyAttempts) if (h.success === null && Math.abs(c.t - h.impactT) < 0.5) h.success = false;
        this.lastSuccessAction = null;
        if (c.damageToSelf >= 10 && c.kind === "strike" && this.behavior === null) this.rattle(c.t, c.damageToSelf, env);
      }
      if (c.attacker === "self" && onsetKind) this.currentLanded = true;
      if (c.attacker === "self" && c.damageToOpponent > 0) {
        mind.noteDamage(0, c.damageToOpponent);
        mind.noteHitOnPlayer(c.t);
        if (this.currentAction && this.isAction(this.currentAction)) this.lastSuccessAction = this.currentAction;
        if (env.tier.rookieMistakes) this.guardDropUntil = c.t + 0.3;
        if (c.damageToOpponent >= 25) this.lastBigHitT = c.t;
        this.eyeContactDue = true;
      }
      if (c.kind === "deflect") {
        if (c.attacker === "opponent") {
          // We deflected their attack: resolves the newest open heavy guess as a success.
          for (let i = this.heavyAttempts.length - 1; i >= 0; i--) {
            const h = this.heavyAttempts[i];
            if (h.success === null && c.t - h.pressT > -0.05 && c.t - h.pressT < 0.5) { h.success = true; break; }
          }
        } else if (c.attacker === "self" && this.currentAction === "JAB") {
          this.currentBlocked = true;
        }
      }
    }
    // Unresolved heavy guesses whose impact passed long ago count as misses.
    for (const h of this.heavyAttempts) if (h.success === null && obs.t - h.impactT > 1.0) h.success = false;

    if (this.contactTimes.length >= RESET_SPACING_CONTACTS && this.state === "NEUTRAL" && this.behavior === null) {
      this.contactTimes.length = 0;
      this.state = "RESET_SPACING";
      this.stateUntil = obs.t + env.rng.range(0.4, 0.9);
      this.current = null; this.currentAction = null;
    }

    // Burst out of a stagger (4.6), rolled once per stagger.
    const self = obs.self;
    if (self.servo_state === "stagger") {
      if (!this.staggerRolled) {
        this.staggerRolled = true;
        if (obs.preset === "arcade" && self.heat <= 65 && self.servo_state_remaining_ms > 200 && env.rng.next() < env.tier.burstProb) {
          this.burstPulseUntil = obs.t + 0.06;
        }
      }
    } else {
      this.staggerRolled = false;
    }

    // Opponent guard hold, for SLAM and HOOK considerations.
    const v = env.perception.view;
    if (v.oppGuard || (Math.hypot(v.oppVel[0], v.oppVel[1], v.oppVel[2]) < 0.12 && v.oppEe[0] > 0.40)) {
      if (this.oppGuardHoldStart < 0) this.oppGuardHoldStart = v.t;
    } else {
      this.oppGuardHoldStart = -1;
    }
    // Did our last wind-up draw a guard? (FEINT consideration.)
    if (this.lastWindupT > 0 && obs.t - this.lastWindupT <= 0.3 && v.oppGuard) {
      this.windupGuardResponses++;
      this.lastWindupT = -10;
    }
    if (Math.hypot(v.oppVel[0], v.oppVel[1], v.oppVel[2]) > FIRST_INPUT_SPEED) this.lastOppMoveT = obs.t;
    mind.threat = this.threat;
  }

  private rattle(t: number, damage: number, env: BrainEnv): void {
    if (this.current) {
      const kind = this.current.kindAt(t);
      if (kind === "active" || kind === "follow") return;     // committed strikes can't be interrupted
    }
    const ms = 150 + (350 - 150) * clamp01((damage - 10) / 29);
    this.startPrimitive(PRIMITIVES.RATTLED, "RATTLED", t, env, { durationScale: ms / 250 });
    this.state = "RATTLED";
    this.stateUntil = this.current ? this.current.endT : t + ms / 1000;
  }

  /* ───────── primitives ───────── */

  private startPrimitive(def: PrimitiveDef, action: PrimitiveId, t: number, env: BrainEnv,
    o: { durationScale?: number; pressT?: number; chargeHoldMs?: number; delayS?: number } = {}): void {
    const tier = env.tier, p = env.personality, mind = env.mind, tm = p.temperament;
    this.pendingFeint = false;
    const speed = def.attack ? 1.6 : 0.4;
    const panic = p.flaw === "panics" && !this.flawPatched && mind.mood.composure < FLAW_RULES.panics.panicBelow;
    const noiseMul = p.noiseMul * (panic ? FLAW_RULES.panics.wildNoiseMul : 1);
    const { noise, durationScale } = samplePrimitiveNoise(env.rng, tier.noise.posBaseMm, tier.noise.posPerMpsMm, speed, mind.mood.composure, noiseMul, tier.noise.timingCv);
    let windupScale = p.windupMul;
    if (def.id === "SLAM") windupScale *= p.slamWindupMul * env.scales.slamWindupMul;
    // Memory (4.5): the tell of the move that beat it shortens 15 %, once.
    if (this.tellShortenLeft && def.attack && action === env.memory.bestMove) { windupScale *= MEMORY_TELL_SHORTEN; this.tellShortenLeft = false; }
    // Temperament (4.4): onset jitter and amplitude jitter per primitive, never per tick; ease per entrant.
    let delayS = o.delayS ?? 0;
    if (def.attack) delayS += env.rng.range(tm.onsetJitterMs[0], tm.onsetJitterMs[1]) / 1000;
    const ampScale = 1 + env.rng.range(-tm.ampJitter, tm.ampJitter);
    const easeExp = tm.ease === "out" ? 0.75 : tm.ease === "inout" ? 1 : env.rng.range(0.7, 1.4);
    // Arousal is a speed multiplier on every behaviour (the Luxo principle): up to 25 % quicker at full arousal.
    const arousalSpeed = def.attack || def.id === "RATTLED" ? 1 : 1 / (1 + 0.25 * mind.arousal);
    const opts = {
      durationScale: (o.durationScale ?? 1) * durationScale * arousalSpeed,
      windupScale,
      recoverScale: tier.recoverScale,
      noise,
      pressT: o.pressT ?? -1,
      chargeHoldMs: o.chargeHoldMs ?? 0,
      easeExp, ampScale,
    };
    // Gaze leads the action (4.1): the gripper snaps to the target 150–400 ms before the strike. A short tell
    // (JAB) waits in guard for the difference so the look always comes first; POKE gives nothing away.
    let lead = 0;
    if (def.attack && def.id !== "POKE") {
      const heavy = def.id === "SLAM";
      lead = env.rng.range(heavy ? GAZE_LEAD_HEAVY_S[0] : GAZE_LEAD_FAST_S[0], heavy ? GAZE_LEAD_HEAVY_S[1] : GAZE_LEAD_FAST_S[1]);
      const probe = new PrimitiveInstance(def, t + delayS, opts);
      const windup = probe.activeStartT - probe.startT;
      if (windup < lead) delayS += lead - windup;
    }
    this.current = new PrimitiveInstance(def, t + delayS, opts);
    this.currentAction = action;
    this.currentBlocked = false; this.currentLanded = false; this.tellEmitted = false;
    this.state = "COMMITTED";
    this.fillContext(env);
    this.current.resolve(t, this.ctxScratch, this.lastPose);
    // Overlap (4.4): the next primitive may start this far into the recover phase.
    const rec = this.current.phases.find((ph) => ph.def.kind === "recover");
    this.overlapT = rec && (def.attack || def.id in TELL_OF) ? rec.startT + env.rng.range(tm.overlap[0], tm.overlap[1]) * (rec.endT - rec.startT) : this.current.endT;
    if (def.attack) {
      this.lastWindupT = t; this.lastOffenceT = t;
      if (lead > 0) this.pendingGaze = { atT: Math.max(t, this.current.activeStartT - lead), onAim: true, wrong: false };
      mind.noteStrikeAttempt(dist3(env.obs.self.ee.pos, env.perception.view.oppEe) < 0.3);
    }
    if (this.isAction(action)) {
      this.usage.push({ a: action, t });
      if (def.attack) this.windups++;
    }
  }

  private pendingFeint = false;

  private isAction(id: PrimitiveId): id is ActionId {
    return id !== "RATTLED" && id !== "GUARD_HOLD" && !(id in BEATS);
  }

  private fillContext(env: BrainEnv): void {
    const c = this.ctxScratch;
    const obs = env.obs;
    const v = env.perception.view;
    Object.assign(c.guard, this.guard);
    // Aim: the lagged opponent hand and wrist midpoint, led by its velocity over the active phase, clamped to reach.
    const lead = 0.12;
    c.aim[0] = (v.oppEe[0] + v.oppWrist[0]) / 2 + v.oppVel[0] * lead;
    c.aim[1] = (v.oppEe[1] + v.oppWrist[1]) / 2 + v.oppVel[1] * lead;
    c.aim[2] = Math.max(0.04, Math.min(0.24, (v.oppEe[2] + v.oppWrist[2]) / 2 + v.oppVel[2] * lead));
    c.side = v.oppEe[1] >= this.guard.y ? 1 : -1;
    const core = obs.cubes[CORE_CUBE_INDEX];
    if (core) { c.core[0] = core.pos[0]; c.core[1] = core.pos[1]; c.core[2] = core.pos[2]; }
    const cube = this.nearestClutterCube(obs);
    if (cube >= 0) { const q = obs.cubes[cube].pos; c.cube[0] = q[0]; c.cube[1] = q[1]; c.cube[2] = q[2]; }
    c.throwTarget[0] = v.oppEe[0]; c.throwTarget[1] = v.oppEe[1]; c.throwTarget[2] = v.oppEe[2];
  }

  private nearestClutterCube(obs: Observation): number {
    let best = -1, bestD = Infinity;
    for (const i of CLUTTER_CUBES) {
      const c = obs.cubes[i];
      if (!c || c.parked || c.held_by === "opponent") continue;
      const p = c.pos;
      if (p[0] < 0.12 || p[0] > 0.34 || Math.abs(p[1]) > 0.22 || p[2] > 0.05) continue;
      const d = dist3(p, obs.self.ee.pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ───────── the 20 ms tick ───────── */

  step(t: number, env: BrainEnv): void {
    const dt = this.lastT < 0 ? TICK_S : Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    const obs = env.obs;
    const v = env.perception.view;
    const fight = obs.round.phase === "fight" || obs.round.phase === "sudden_death";

    this.updateGuard(t, dt, env);
    const proximity = 0.15 / Math.max(0.05, v.guardDistance + 0.06);
    this.threat = logistic((Math.max(0, v.closingSpeed) * proximity - 0.6) / 0.12);
    if (this.activeThreat && t > this.activeThreat.impactT + 0.25) this.activeThreat = null;

    if (!fight) {
      if (this.state !== "ROUND_TRANSITION" && this.state !== "BEAT") {
        this.state = "ROUND_TRANSITION"; this.current = null; this.currentAction = null; this.pendingGaze = null;
        this.roundBeatPlayed = false;
      }
      this.roundEndBeat(t, env);
      if (this.state === "BEAT" && this.current) {
        this.fillContext(env);
        this.current.resolve(t, this.ctxScratch, this.lastPose);
        if (t >= this.current.endT) {
          const slammed = this.currentAction === "DECK_SLAM";
          this.state = "ROUND_TRANSITION"; this.current = null; this.currentAction = null;
          // OVERSHOOT slams the deck first, then sinks like everyone else (4.3).
          if (slammed) { this.startPrimitive(PRIMITIVES.DEJECT, "DEJECT", t, env); this.state = "BEAT"; }
        }
      }
      return;
    }
    if (this.state === "ROUND_TRANSITION" || this.state === "BEAT") {
      this.state = "NEUTRAL"; this.current = null; this.currentAction = null;
      this.nextThinkT = t + env.tier.thinkMs * env.scales.thinkMul / 1000;
      this.graceUntil = t + env.tier.openingGraceS;
      this.lastOffenceT = t + env.tier.openingGraceS;
      this.fearPlayed = false; this.hesitations = 0;
      this.nextCuriosityT = t + env.rng.range(CURIOSITY_EVERY_S[0], CURIOSITY_EVERY_S[1]);
      this.sparNextT = t + (this.behavior === "sparring" ? Math.max(env.tier.openingGraceS, env.rng.range(SPAR_BECKON_EVERY_S[0], SPAR_BECKON_EVERY_S[1])) : env.tier.openingGraceS);
      this.lowMenaceSince = t;
      // Round start: eye contact (600–1200 ms, jaws +10 %) unless it holds a grudge (4.5).
      if (this.eyeContactDue) env.layers.eyeContact(t, env.rng); else env.layers.glance(t, "gripper", env.rng);
      this.eyeContactDue = false;
    }

    // Gaze snap scheduled by an attack (4.1) and the tell event (4.2) when the wind-up begins.
    const pg = this.pendingGaze;
    if (pg && t >= pg.atT) {
      this.pendingGaze = null;
      env.layers.glance(t, pg.wrong ? (env.rng.next() < 0.5 ? "camera" : "away") : "gripper", env.rng, pg.onAim, 0.5);
    }
    const cur = this.current;
    if (cur && !this.tellEmitted && t >= cur.startT && cur.def.attack) {
      this.tellEmitted = true;
      const prim = this.pendingFeint ? "feint" : SHOW_TELL_OF[cur.def.id];
      const tellS = Math.min(cur.activeStartT - cur.startT, this.behavior === "slow_heavy" ? SPAR_HOLD_MAX_S : Infinity);
      if (prim) this.show({ kind: "tell", seat: this.seat, primitive: prim, ms: Math.round(tellS * 1000) });
    }
    if (this.eyeContactDue && this.state === "NEUTRAL" && t - this.lastContactT > 0.5) { this.eyeContactDue = false; env.layers.eyeContact(t, env.rng); }

    if (this.behavior !== null) { this.stepScripted(t, env); return; }

    // 1. Released perception events.
    for (let e = env.perception.popReleased(t); e; e = env.perception.popReleased(t)) this.onReleased(e, t, env);
    if (this.scheduledReaction && t >= this.scheduledReaction.atT) {
      const s = this.scheduledReaction;
      this.scheduledReaction = null;
      if (this.canInterrupt(t)) {
        if (s.kind === "parry") this.startParry(s.e, t, s.pressT, env);
        else this.startPrimitive(PRIMITIVES.GUARD_HOLD, "GUARD_HOLD", t, env);
        if (t > s.e.impactT) this.show({ kind: "late_guard", seat: this.seat });
      }
    }

    // 2. FSM.
    this.interruptBeat(t, env);
    if (this.state === "NEUTRAL" && this.current && t >= this.current.endT) { this.current = null; this.currentAction = null; }
    switch (this.state) {
      case "COMMITTED": this.advanceCommitted(t, env); break;
      case "RATTLED":
      case "RESET_SPACING":
        if (t >= this.stateUntil) { this.state = "NEUTRAL"; this.current = null; this.currentAction = null; this.nextThinkT = t; }
        break;
      default: break;
    }

    // 3. Character beats that pre-empt the selector (4.3, 4.5).
    if (this.state === "NEUTRAL" && this.characterBeat(t, env)) return;

    // 4. Think.
    if (this.state === "NEUTRAL" && t >= this.nextThinkT) {
      this.nextThinkT = t + (env.tier.thinkMs * env.scales.thinkMul + env.rng.range(-20, 20)) / 1000;
      if (this.pendingChainJab) {
        this.pendingChainJab = false;
        this.chainedJabT = t;
        this.intentLabel = "chain";
        this.startPrimitive(PRIMITIVES.JAB, "JAB", t, env);
      } else {
        this.think(t, env);
      }
    }
  }

  /**
   * Scripted behaviours (4.3 sparring, the lab's rig): parked_in_reach tracks and flinches and re-approaches 1.5 s
   * after every hit; sparring adds a beckon when the player is passive; slow_heavy winds up a SLAM-class hold of
   * up to 3 s (released early when the player's guard goes up) and strikes slowly, again 1.5 s later; hold_guard
   * keeps the guard up; idle waits at home and looks at the Core, then at you. No selector, no punishes, no POKE.
   */
  private stepScripted(t: number, env: BrainEnv): void {
    const v = env.perception.view;
    if (this.state === "COMMITTED" && this.current) {
      const cur = this.current;
      this.fillContext(env);
      cur.resolve(t, this.ctxScratch, this.lastPose);
      // The held SLAM releases as soon as the player guards (the tutorial's GUARD step completes on the block), and
      // never waits past SPAR_HOLD_MAX_S from the first frame of the tell.
      if (cur.def.id === "SLAM" && (v.oppGuard || t - cur.startT >= SPAR_HOLD_MAX_S)) cur.releaseHold(t);
      if (t >= cur.endT) {
        if (cur.def.attack && !this.currentLanded) this.show({ kind: "open", seat: this.seat, ms: 300 });
        this.state = "NEUTRAL"; this.current = null; this.currentAction = null;
        this.sparNextT = t + (this.behavior === "slow_heavy" ? SPAR_REPEAT_S : env.rng.range(SPAR_BECKON_EVERY_S[0], SPAR_BECKON_EVERY_S[1]));
      }
      return;
    }
    if (this.state !== "NEUTRAL") { if (t >= this.stateUntil) { this.state = "NEUTRAL"; this.current = null; this.currentAction = null; } else return; }
    if (t < this.graceUntil || t < this.sparNextT) return;
    switch (this.behavior) {
      case "slow_heavy": {
        this.intentLabel = "spar:windup";
        this.startPrimitive(SLAM_SPAR, "SLAM", t, env, { chargeHoldMs: SPAR_HOLD_MAX_S * 1000 });
        return;
      }
      case "sparring":
        if (t - this.lastOppMoveT > TAUNT_IDLE_S) { this.beat(env, t, "BECKON", "taunt", 0); this.intentLabel = "spar:beckon"; }
        else this.sparNextT = t + 0.5;
        return;
      case "idle":
        if (env.obs.core.phase === "live" && env.obs.cubes[CORE_CUBE_INDEX] && !env.obs.cubes[CORE_CUBE_INDEX].parked) {
          env.layers.look(t, "core", env.rng, 0.8); this.show({ kind: "curious", seat: this.seat, variant: 0 });
          this.sparNextT = t + env.rng.range(6, 10); this.eyeContactDue = true;
        } else this.sparNextT = t + 1;
        return;
      default:
        this.sparNextT = t + 0.5;
        return;
    }
  }

  private updateGuard(t: number, dt: number, env: BrainEnv): void {
    const v = env.perception.view;
    const p = env.personality;
    const g = this.guard;
    if (this.behavior === "parked_in_reach" || this.behavior === "sparring") {
      // Parked on the pilot's flick arc (bible 2: inside your reach from the first frame), backing off 1.5 s after a hit.
      const back = t < this.sparReapproachT ? 0.05 : 0;
      const r = PARK_PILOT_R + this.parkOffset + back;
      const a = 1 - Math.exp(-dt / 0.6);
      const tx = 0.64 - r * Math.cos(PARK_PILOT_ANGLE), ty = -r * Math.sin(PARK_PILOT_ANGLE);
      g.x += (tx - g.x) * a; g.y += (ty - g.y) * a; g.z = GUARD_Z; g.pitch = GUARD_PITCH;
      return;
    }
    // Catching breath: a still servo cools at −20/s instead of −5/s (4.5), so as heat builds the hand stops swaying
    // and tracks lazily. Fully calm below 20 heat, fully still from 40.
    const heat = env.obs.preset === "arcade" ? env.obs.self.heat : 0;
    const calm = clamp01((HEAT_STILL_FROM - heat) / 20);
    const a = 1 - Math.exp(-dt / (GUARD_TRACK_TAU_S + (1 - calm) * 0.45));
    const trackGain = this.behavior === "idle" ? 0 : GUARD_TRACK_GAIN;
    this.yTrack += (Math.max(-0.12, Math.min(0.12, trackGain * v.oppEe[1])) - this.yTrack) * a;
    this.spacingOffset *= Math.exp(-dt / 1.5);
    // Ornstein–Uhlenbeck drift (θ = 2/s, stationary σ = 4 mm), seen through a 300 ms low-pass: a hand wanders, it
    // does not buzz. Unfiltered, each 20 ms innovation is a millimetre step, and at kp ≈ 1000 a few milliradians of
    // step saturate the servo, so an idle guard would overheat.
    const k = OU_SIGMA_M * Math.sqrt(2 * OU_THETA * dt);
    this.ouRawX += -OU_THETA * this.ouRawX * dt + k * gaussian(env.rng);
    this.ouRawY += -OU_THETA * this.ouRawY * dt + k * gaussian(env.rng);
    const lp = 1 - Math.exp(-dt / TREMOR_SMOOTH_S);
    this.ouX += (this.ouRawX - this.ouX) * lp;
    this.ouY += (this.ouRawY - this.ouY) * lp;
    const w = 2 * Math.PI * p.idle.hz * t;
    let sx: number, sy: number;
    if (p.idle.circles) { sx = p.idle.ampM * Math.cos(w + this.swayPhase1); sy = p.idle.ampM * Math.sin(w + this.swayPhase1); }
    else { sx = 0.5 * p.idle.ampM * Math.sin(w + this.swayPhase1); sy = p.idle.ampM * Math.sin(1.25 * w + this.swayPhase2); }
    const sz = 0.5 * p.idle.ampM * Math.sin(0.7 * w + this.swayPhase2);
    const panicking = p.flaw === "panics" && !this.flawPatched && env.mind.mood.composure < FLAW_RULES.panics.panicBelow;
    this.guardX = p.preferredGuardX + this.spacingOffset - (panicking ? 0.04 : 0) - (this.state === "RESET_SPACING" ? 0.04 : 0);
    g.x = this.guardX + TIP_FROM_ROLL_AXIS_M + calm * (sx + this.ouX);
    g.y = this.yTrack + this.guardYBias + calm * (sy + this.ouY);
    g.z = GUARD_Z + calm * sz - (t < this.guardDropUntil ? 0.05 : 0);
    g.pitch = GUARD_PITCH;
  }

  private canInterrupt(t: number): boolean {
    if (this.state === "NEUTRAL" || this.state === "RESET_SPACING") return true;
    if (this.state !== "COMMITTED" || !this.current) return false;
    const cur = this.current;
    const kind = cur.kindAt(t);
    if (kind === "windup") return cur.def.cancelable && cur.windupProgress(t) < cur.def.cancelWindow;
    if (kind === "recover") {
      if (cur.def.attack) return t >= this.overlapT;            // overlap (4.4)
      if (cur.def.cancelable) return true;
      const rec = cur.phases.find((ph) => ph.def.kind === "recover");
      return !rec || t - rec.startT >= 0.6 * (rec.endT - rec.startT);
    }
    return kind === "done" || cur.def.id === "GUARD_HOLD" || !cur.def.attack && cur.def.cancelable;
  }

  private onReleased(e: PerceptEvent, t: number, env: BrainEnv): void {
    switch (e.kind) {
      case "attack_onset":
      case "charge_public": {
        this.activeThreat = e;
        if (!this.canInterrupt(t)) return;
        if (e.feint) {
          // The motion already stopped short. Reading it as a feint is a skill; missing it is a bite.
          if (env.rng.next() < this.recognition(env)) { this.activeThreat = null; this.intentLabel = "read feint"; return; }
          this.lastBiteT = t;
          this.intentLabel = "bit feint";
        }
        this.react(e, t, env);
        return;
      }
      case "feint_suspect":
        // Seen only after we already committed to that motion: that commit was a bite too.
        if (t - this.lastReactT < 0.35 && this.lastBiteT < this.lastReactT) this.lastBiteT = this.lastReactT;
        return;
      case "whiff": {
        this.whiffUntil = e.t + WHIFF_RECOVERY_S;
        const window = this.whiffUntil - t;
        const t90 = 0.18;
        if (window > t90 && t >= this.graceUntil && this.canInterrupt(t) && env.rng.next() < clamp01(env.tier.whiffPunishProb * env.scales.punishMul)) {
          this.intentLabel = "punish";
          this.startPrimitive(PRIMITIVES.WHIFF_PUNISH, "WHIFF_PUNISH", t, env);
          this.show({ kind: "punish", seat: this.seat });
        } else this.intentLabel = "waiting for a miss";
        return;
      }
      case "throw": {
        const slow = env.personality.flaw === "bites_feints" && !this.flawPatched ? FLAW_RULES.bites_feints.throwReactionAddMs / 1000 : 0;
        this.scheduledReaction = { atT: t + slow, kind: "guard", e, pressT: -1, heavy: false };
        return;
      }
    }
  }

  /** Commit a defensive answer to an attack or a public charge. */
  private react(e: PerceptEvent, t: number, env: BrainEnv): void {
    const tier = env.tier, p = env.personality;
    this.lastReactT = t;
    const parryOk = tier.parry && env.mind.mood.composure > 0.5 && env.obs.preset === "arcade";
    const wParry = parryOk ? weightOf(p, "PARRY") : 0;
    const wGuard = weightOf(p, "GUARD");
    const parry = wParry > 0 && env.rng.next() < wParry / (wParry + wGuard);
    if (e.kind === "charge_public") {
      if (!parry) {
        this.intentLabel = "react:brace";
        this.startPrimitive(PRIMITIVES.RETREAT, "RETREAT", t, env);
        return;
      }
      // Heavy guess rule: press from the habit model's release delay, deliberately off once at the cap.
      const delayMs = env.perception.expectedReleaseDelayMs(env.rng);
      const expectedReleaseT = e.t + HEAVY_FULL_S + delayMs / 1000;
      const impactT = expectedReleaseT + HEAVY_TRAVEL_S;
      let errorMs = gaussian(env.rng, 0, 150 * tier.noise.timingCv);
      const cap = tier.heavyParryCap ?? 0;
      const resolved = this.heavyAttempts.filter((h) => h.success !== null).slice(-HEAVY_GUESS_WINDOW);
      const successes = resolved.filter((h) => h.success).length;
      const capped = resolved.length > 0 && successes / resolved.length >= cap;
      if (capped) errorMs = (env.rng.next() < 0.5 ? -1 : 1) * env.rng.range(HEAVY_GUESS_ERROR_MS[0], HEAVY_GUESS_ERROR_MS[1]);
      const pressT = impactT - PARRY_PRESS_LEAD_S + errorMs / 1000;
      this.parryGuess = { expectedReleaseT, errorMs, capped };
      this.heavyAttempts.push({ pressT, impactT, success: null });
      if (this.heavyAttempts.length > 3 * HEAVY_GUESS_WINDOW) this.heavyAttempts.shift();
      this.intentLabel = "react:heavy_guess";
      const startT = Math.max(t, pressT - 0.03);
      if (startT <= t) this.startParry(e, t, Math.max(t, pressT), env);
      else {
        // Wait in guard without the guard intent (so the press is a fresh edge) and without starting anything else.
        this.current = null; this.currentAction = null; this.state = "NEUTRAL";
        this.nextThinkT = Math.max(this.nextThinkT, pressT + 0.3);
        this.scheduledReaction = { atT: startT, kind: "parry", e, pressT, heavy: true };
      }
      return;
    }
    if (parry) {
      const pressT = Math.max(t, e.impactT - PARRY_PRESS_LEAD_S + gaussian(env.rng, 0, 150 * tier.noise.timingCv) / 1000);
      this.intentLabel = "react:parry";
      this.startParry(e, t, pressT, env);
    } else {
      this.intentLabel = "react:guard";
      this.startPrimitive(PRIMITIVES.GUARD_HOLD, "GUARD_HOLD", t, env);
    }
    if (t > e.impactT) this.show({ kind: "late_guard", seat: this.seat });
    // BACKLASH answers heavy threats with BULWARK.
    if (env.personality.ability === "bulwark" && this.threat > 0.7 && env.obs.self.heat < 40) this.fireAbility(t, env);
  }

  private startParry(e: PerceptEvent, t: number, pressT: number, env: BrainEnv): void {
    this.startPrimitive(PRIMITIVES.PARRY, "PARRY", t, env, { pressT });
    const side = e.vel[1] !== 0 ? Math.sign(e.vel[1]) : e.pos[1] >= this.guard.y ? 1 : -1;
    this.ctxScratch.side = side;
  }

  private fireAbility(t: number, env: BrainEnv): void {
    if (!env.tier.ability || !env.personality.ability || env.obs.preset !== "arcade" || t < this.abilityReadyT) return;
    this.abilityReadyT = t + ABILITY_COOLDOWN_S;
    this.abilityPulseUntil = t + 0.06;
  }

  private advanceCommitted(t: number, env: BrainEnv): void {
    const cur = this.current;
    if (!cur) { this.state = "NEUTRAL"; return; }
    this.fillContext(env);
    const before = cur.phaseIndexAt(t - TICK_S);
    cur.resolve(t, this.ctxScratch, this.lastPose);
    const idx = cur.phaseIndexAt(t);
    if (idx !== before && idx < cur.phaseCount && cur.phases[idx].def.kind === "active" && cur.def.attack && env.personality.ability === "snap") {
      this.fireAbility(t, env);
    }
    if (this.feintCancelT >= 0 && t >= this.feintCancelT) {
      this.feintCancelT = -1;
      const chain = this.feintChainTo;
      this.feintChainTo = null;
      const slamFeint = cur.def.id === "SLAM";
      this.current = null; this.currentAction = null; this.pendingFeint = false;
      if (chain) {
        this.startPrimitive(PRIMITIVES[chain], chain, t, env);
      } else {
        // Snap back with 15 % overshoot (4.2): the retreat runs short and hot.
        this.startPrimitive(PRIMITIVES.RETREAT, "RETREAT", t, env, { durationScale: 0.10 / 0.65 });
        if (slamFeint) this.guardPulseUntil = t + 0.06;   // a charge cancel is a guard press (3.1.2)
      }
      return;
    }
    // A whiff (4.2): the arm hangs in overshoot, OPEN for 300 ms; the recover is what the player punishes.
    if (cur.def.attack && idx !== before && before < cur.phaseCount && cur.phases[before].def.kind === "active" && !this.currentLanded) {
      this.show({ kind: "open", seat: this.seat, ms: 300 });
      this.intentLabel = "whiffed";
    }
    if (t >= this.overlapT || t >= cur.endT) {
      const wasJab = cur.def.id === "JAB";
      const blocked = this.currentBlocked;
      if (cur.def.attack) this.lastAttackEndT = cur.endT;
      if (t >= cur.endT) { this.current = null; this.currentAction = null; }
      this.state = "NEUTRAL";
      this.overlapT = Infinity;
      if (wasJab && blocked && env.personality.flaw === "chains_jabs") {
        if (!this.flawPatched && env.rng.next() < FLAW_RULES.chains_jabs.chainChance) {
          this.pendingChainJab = true;
          this.nextThinkT = t;
          return;
        }
        if (this.flawPatched) this.jabAfterBlockHold = true;
      }
      // An attack flows into the next move through its recover overlap (4.4); anything else breathes for the
      // entrant's rest first, longer as heat builds (servos saturate, heat climbs).
      const heat = env.obs.preset === "arcade" ? env.obs.self.heat : 0;
      this.nextThinkT = t + ((cur.def.attack ? 0 : env.personality.restMs * env.scales.thinkMul) + REST_PER_HEAT_MS * heat) / 1000;
    }
  }

  private guardPulseUntil = -1;
  private jabAfterBlockHold = false;

  /* ───────── character beats (4.3, 4.5) ───────── */

  /** Starts a beat primitive (a taunt, a reaction, a round-end beat) and announces it. */
  private beat(env: BrainEnv, t: number, id: keyof typeof BEATS, kind: "taunt" | "celebrate" | "dejected" | "curious" | "fear", variant: number, o: { durationScale?: number } = {}): void {
    this.startPrimitive(PRIMITIVES[id], id, t, env, o);
    this.show({ kind, seat: this.seat, variant });
  }

  /** Beats that pre-empt the selector while NEUTRAL; returns true when one started. */
  private characterBeat(t: number, env: BrainEnv): boolean {
    const obs = env.obs, mind = env.mind, tier = env.tier, p = env.personality;
    const v = env.perception.view;
    if (!this.canInterrupt(t) || t < this.graceUntil) return false;
    const quiet = t - this.lastContactT > QUIET_S && this.threat < 0.2;
    const inReachNow = dist3(obs.self.ee.pos, v.oppEe) < 0.3;
    // Fear (4.3): health < 25 %, composure < 0.3, once a round.
    if (!this.fearPlayed && obs.self.integrity / Math.max(1, obs.self.integrity_max) < 0.25 && mind.mood.composure < 0.3) {
      this.fearPlayed = true;
      this.beat(env, t, "FEAR", "fear", p.fear === "rally" ? 0 : 1, { durationScale: env.rng.range(0.8, 1.4) });
      mind.kick(0.4, p.fear === "rally" ? -0.5 : -0.2, -0.6);
      if (p.fear === "rally") mind.holdGrudge(1);
      this.intentLabel = p.fear === "rally" ? "hurt and angry" : "covering up";
      return true;
    }
    // The director (4.5) manages a person's experience: it advises only when a pilot sits in the other seat (the
    // match director passes matchesPlayed for that seat); bots fighting bots in the suite are never throttled.
    const directed = env.ctx.config?.matchesPlayed !== undefined;
    // Menace (4.5): sent backstage above 0.8 for 1.5–3 s; ends early if the player advances.
    if (directed && mind.menace > MENACE_BACKSTAGE && t > this.backstageUntil) {
      const holdS = env.rng.range(1.5, 3.0);
      this.startPrimitive(PRIMITIVES.BACKSTAGE, "BACKSTAGE", t, env, { durationScale: holdS / 2.75 });
      this.backstageUntil = t + holdS + 4;
      this.show({ kind: "backstage", seat: this.seat, ms: Math.round(holdS * 1000) });
      env.layers.look(t + 0.001, "core", env.rng, holdS * 0.4);
      this.eyeContactDue = true;
      mind.menace = 0.5;
      this.intentLabel = "backstage";
      return true;
    }
    if (mind.menace < MENACE_PROBE) { if (this.lowMenaceSince < 0) this.lowMenaceSince = t; } else this.lowMenaceSince = -1;
    // Probe (4.5): menace low for 4 s with a passive player: a POKE from match 2, a beckon in match 1.
    const passive = t - this.lastOppMoveT > PROBE_AFTER_S;
    if (directed && this.lowMenaceSince >= 0 && t - this.lowMenaceSince > PROBE_AFTER_S && passive && t >= this.tauntReadyT) {
      this.lowMenaceSince = t;
      const firstMatch = (env.ctx.config?.matchesPlayed ?? 1) < 1;
      if (firstMatch || tier.noSlam) { this.tauntReadyT = t + 4; this.beat(env, t, "BECKON", "taunt", 0); this.intentLabel = "beckon"; }
      else { this.intentLabel = "probe"; this.startPrimitive(PRIMITIVES.POKE, "POKE", t, env); }
      return true;
    }
    // Taunts (4.3): only when ahead or after a whiff punish; 400–900 ms of real vulnerability; tier cooldown.
    const ahead = mind.integrityGap > 10 || this.lastSuccessAction === "WHIFF_PUNISH";
    const idleAtReach = inReachNow && t - this.lastOppMoveT > TAUNT_IDLE_S;
    if (ahead && t >= this.tauntReadyT && (t - this.lastBigHitT <= TAUNT_WINDOW_S || idleAtReach) && this.threat < 0.3) {
      const id = pickVariant(env.rng, p.taunts, this.lastTaunt);
      this.lastTaunt = id;
      this.tauntReadyT = t + tier.tauntCooldownS;
      this.beat(env, t, id, "taunt", p.taunts.indexOf(id));
      if (id === "SLOW_REGUARD") env.layers.eyeContact(t + 0.001, env.rng);
      mind.kick(0.1, 0.2, 0.3);
      this.intentLabel = `taunt:${id.toLowerCase()}`;
      return true;
    }
    // Curiosity (4.3): every 12–25 s in a quiet stretch, a sniff over the Core.
    const core = obs.cubes[CORE_CUBE_INDEX];
    if (quiet && t >= this.nextCuriosityT && core && obs.core.phase === "live" && !core.parked && core.held_by === null && obs.core.docked_in === null && Math.hypot(core.pos[0], core.pos[1]) < 0.42) {
      this.nextCuriosityT = t + env.rng.range(CURIOSITY_EVERY_S[0], CURIOSITY_EVERY_S[1]);
      this.beat(env, t, "SNIFF", "curious", env.rng.int(2));
      env.layers.look(t + 0.001, "core", env.rng, 1.2);
      this.intentLabel = "curious";
      return true;
    }
    return false;
  }

  /** Beats that end early (4.3, 4.5): backstage ends when the player advances; a rushed sniff drops with a flinch. */
  private interruptBeat(t: number, env: BrainEnv): void {
    if (this.state !== "COMMITTED" || !this.current) return;
    const v = env.perception.view;
    if (this.currentAction === "BACKSTAGE" && v.oppEe[0] < 0.36 && t - this.current.startT > 0.5) {
      this.current = null; this.currentAction = null; this.state = "NEUTRAL"; this.nextThinkT = t;
      env.layers.glance(t, "gripper", env.rng);
    } else if (this.currentAction === "SNIFF" && this.threat > 0.6) {
      // Rushed during the sniff: the flinch fires and the sniff is dropped. Its fault.
      this.current = null; this.currentAction = null; this.state = "NEUTRAL"; this.nextThinkT = t;
      env.layers.flinch(t, 0.3, this.ctxScratch.side, "light", env.rng);
      this.show({ kind: "flinch", seat: this.seat, m: 0.3 });
    }
  }

  /** Celebration or dejection when a round ends (4.3), once per round, chosen by who took it. */
  private roundEndBeat(t: number, env: BrainEnv): void {
    const obs = env.obs, p = env.personality;
    const ph = obs.round.phase;
    if (this.roundBeatPlayed || !(ph === "ko" || ph === "lock" || ph === "time_up" || ph === "round_summary")) return;
    const key = `${obs.round.index}|${obs.round.rounds_won.self}|${obs.round.rounds_won.opponent}`;
    if (key === this.lastRoundsKey) return;
    let won: boolean | null = null;
    if (obs.opponent.integrity <= 0) won = true; else if (obs.self.integrity <= 0) won = false;
    else if (ph === "lock") won = obs.core.docked_in === "self";
    else if (ph === "time_up" || ph === "round_summary") won = obs.self.integrity >= obs.opponent.integrity;
    if (won === null) return;
    this.roundBeatPlayed = true;
    this.lastRoundsKey = key;
    this.state = "BEAT";
    if (won) {
      const id = p.celebration === "big" ? "CELEBRATE_BIG" : p.celebration === "cool" ? "CELEBRATE_COOL" : "CELEBRATE_MANIC";
      this.startPrimitive(PRIMITIVES[id], id, t, env);
      this.show({ kind: "celebrate", seat: this.seat, variant: p.celebration === "big" ? 0 : p.celebration === "cool" ? 1 : 2 });
      env.mind.kick(0.3, 0.5, 0.4);
      env.layers.eyeContact(t + 0.001, env.rng);
    } else {
      const scale = p.dejection === "laugh_off" ? 1.2 / 4.5 : p.dejection === "sink" ? 1.3 : 1;
      const delay = p.dejection === "slam_first" ? 0.6 : 0;
      if (delay > 0) this.startPrimitive(PRIMITIVES.DECK_SLAM, "DECK_SLAM", t, env);
      else this.startPrimitive(PRIMITIVES.DEJECT, "DEJECT", t, env, { durationScale: scale });
      this.show({ kind: "dejected", seat: this.seat, variant: p.dejection === "sink" ? 0 : p.dejection === "slam_first" ? 1 : 2 });
      env.mind.kick(-0.2, -0.5, -0.4);
      env.layers.look(t + 0.001, "away", env.rng, 1.5);
      this.eyeContactDue = true;
    }
    this.state = "BEAT";
  }

  /* ───────── utility selector (5.5.4) ───────── */

  private think(t: number, env: BrainEnv): void {
    const obs = env.obs, p = env.personality, tier = env.tier, mind = env.mind;
    const v = env.perception.view;
    const own = obs.self.ee.pos;
    const aggr = mind.mood.aggression;
    const threat = this.threat;
    const arcade = obs.preset === "arcade";
    const dEE = dist3(own, v.oppEe);
    const dForearm = distToSegment(own, v.oppElbow, v.oppWrist);
    const oppActive = this.activeThreat ? 1 : 0;
    const oppExtended = logistic((0.36 - v.oppEe[0]) / 0.02);
    const oppGuardHeld = this.oppGuardHoldStart >= 0 && v.t - this.oppGuardHoldStart >= 0.3 ? 1 : 0;
    const oppState = obs.opponent.servo_state;
    const oppRecovering = t < this.whiffUntil || (oppState !== "normal" && oppState !== "offline") ? 1 : 0;
    const lateralOpening = clamp01(Math.abs(v.oppEe[1]) / 0.08);
    const core = obs.cubes[CORE_CUBE_INDEX];
    const coreLive = obs.core.phase === "live" && core && !core.parked;
    const coreSettled = !!core && core.pos[2] < 0.08 && Math.hypot(core.linvel[0], core.linvel[1], core.linvel[2]) < 0.3;
    const holdingCore = !!core && core.held_by === "self";
    const heatHigh = arcade && obs.self.heat > 70;

    const u: Partial<Record<ActionId, number>> = {};
    u.POKE = compensated([inReach(dForearm, 0.09), oppExtended, Math.sqrt(aggr)]);
    u.JAB = compensated([inReach(dEE, 0.16), 1 - oppActive, Math.pow(aggr, 0.7), 1 - threat]);
    u.HOOK = compensated([lateralOpening, inReach(dEE, 0.20), 1 - oppGuardHeld, aggr]);
    if (!tier.noSlam) u.SLAM = compensated([Math.max(oppRecovering, oppGuardHeld, 0.08), aggr * aggr, inReach(dEE, 0.26)]) * (1 + mind.desperation) * (1 + mind.clutch);
    // Guarding answers a threat that was perceived and released (reaction time applies), not raw lagged motion.
    const reactedThreat = this.activeThreat?.kind === "attack_onset" ? threat : 0;
    u.GUARD = compensated([Math.max(reactedThreat, 0.12), Math.sqrt(1 - aggr)]);
    if (t < this.whiffUntil) u.WHIFF_PUNISH = compensated([inReach(dEE, 0.22), clamp01(tier.whiffPunishProb * env.scales.punishMul)]);
    const guardResponse = (this.windupGuardResponses + 0.9) / (this.windups + 3);
    u.FEINT = compensated([p.feintRate * 2, guardResponse, aggr, inReach(dEE, 0.24)]);
    const coreHomeDocked = obs.core.docked_in === "self";
    const coreFree = obs.core.phase === "live" && obs.core.docked_in === null && !!core && core.held_by === null;
    if (coreFree && this.coreFreeSinceT < 0) this.coreFreeSinceT = t + env.rng.range(tier.coreHesitationMs[0], tier.coreHesitationMs[1]) / 1000;
    if (!coreFree) this.coreFreeSinceT = -1;
    const raceReady = this.coreFreeSinceT >= 0 && t >= this.coreFreeSinceT;
    if (coreLive && coreSettled && raceReady && !holdingCore && core.held_by !== "opponent" && !coreHomeDocked && obs.core.docked_in !== "opponent") {
      // A loose Core we can reach past; the rake draws it home (primitives.ts CORE_GRAB).
      const reachable = inReach(Math.hypot(core.pos[0] + 0.045, core.pos[1]), 0.46);
      u.CORE_GRAB = compensated([reachable, inReach(dist3(own, core.pos), 0.30), 1 - threat]) * (obs.core.owner === "self" && obs.core.loose ? 1.5 : 1);
    }
    if (holdingCore) u.CORE_DOCK = 3;
    if (coreLive && obs.core.docked_in === "opponent") {
      const dock = this.ctxScratch.dockOpponent;
      const guardNearDock = clamp01((0.10 - dist3(v.oppEe, [dock[0], dock[1], 0.05])) / 0.06);
      const urgency = obs.core.lock_in_remaining < 4 ? 1 : 0.4 + 0.5 * tier.objectiveSense;
      u.STEAL = compensated([urgency, 1 - guardNearDock]) * (obs.core.lock_in_remaining < 2.5 ? 2 : 1) * (0.5 + 0.5 * tier.objectiveSense);
    }
    // Dock defence: our Core is ticking and their hand is reaching for it. Hit the hand.
    if (coreLive && obs.core.owner === "self" && obs.core.docked_in === "self") {
      const dock = this.ctxScratch.dockSelf;
      const reaching = clamp01((0.16 - dist3(v.oppEe, [dock[0], dock[1], 0.04])) / 0.1);
      if (reaching > 0) {
        const defend = 1 + 2.5 * reaching * tier.objectiveSense;
        u.POKE = (u.POKE ?? 0) * defend + 0.25 * reaching * tier.objectiveSense;
        u.JAB = (u.JAB ?? 0) * defend + 0.2 * reaching * tier.objectiveSense;
      }
    }
    // Rake denial: their hand is down on a loose Core. Knock it off before it reaches their dock.
    if (coreLive && core && obs.core.docked_in === null && !holdingCore && v.oppEe[2] < 0.07 && dist3(v.oppEe, core.pos) < 0.09) {
      const deny = tier.objectiveSense * inReach(dEE, 0.2);
      if (deny > 0.05) {
        u.POKE = (u.POKE ?? 0) * (1 + 2 * deny) + 0.2 * deny;
        u.JAB = (u.JAB ?? 0) * (1 + 2 * deny) + 0.25 * deny;
      }
    }
    const cube = this.nearestClutterCube(obs);
    if (cube >= 0 && p.throwAffinity > 0) {
      const oppDistracted = v.oppEe[2] < 0.08 || v.oppVel[0] > 0.1 ? 1 : 0.3;
      u.GRAB_THROW = compensated([inReach(dist3(own, obs.cubes[cube].pos), 0.2), 1 - threat, p.throwAffinity, oppDistracted]);
    }
    const gapWant = 0.64 - p.preferredGuardX - 0.20 - 2 * TIP_FROM_ROLL_AXIS_M;
    const spacingErr = (v.oppEe[0] - own[0]) - gapWant;
    u.ADVANCE = compensated([clamp01(spacingErr / 0.08), aggr]);
    u.RETREAT = compensated([clamp01(-spacingErr / 0.06), Math.max(threat, 1 - aggr)]);
    u.CIRCLE = compensated([0.3, 1 - threat]);
    u.IDLE_SWAY = 0.05 * (arcade && obs.self.heat > HEAT_EASE_FROM ? 1 + (obs.self.heat - HEAT_EASE_FROM) / 4 : 1);

    // Reads: a confident habit prediction pre-commits the counter (5.5.3 "anticipation").
    const read = tier.readThreshold === null ? null : env.perception.habit.predict();
    const readOn = read !== null && tier.readThreshold !== null && read.evidence >= 3 && read.p >= tier.readThreshold;
    const readBonus: Partial<Record<ActionId, number>> = {};
    if (readOn && read) {
      switch (read.symbol) {
        case "J": case "H": readBonus.GUARD = 1.5; readBonus.CIRCLE = 1.3; break;
        case "S": readBonus.RETREAT = 1.6; readBonus.JAB = 1.3; break;
        case "G": readBonus.SLAM = 1.7; readBonus.HOOK = 1.3; readBonus.FEINT = 1.3; break;
        case "F": readBonus.JAB = 1.4; readBonus.POKE = 1.3; break;
        case "T": readBonus.STEAL = 1.5; readBonus.CORE_GRAB = 1.4; readBonus.JAB = 1.3; break;
        case "A": readBonus.POKE = 1.5; break;
        case "R": readBonus.ADVANCE = 1.5; break;
      }
      // DEADBAND's coil is a counter to a predicted swing.
      if (p.ability === "recoil_coil" && (read.symbol === "H" || read.symbol === "J") && read.p > 0.5) this.fireAbility(t, env);
    }

    const recent = this.usage;
    while (recent.length > 0 && t - recent[0].t > NOVELTY_WINDOW_S) recent.shift();
    const panicking = p.flaw === "panics" && !this.flawPatched && mind.mood.composure < FLAW_RULES.panics.panicBelow;
    // Tempo (4.4): the entrant's rest between attacks, longer with heat; the recover overlap lets it think earlier.
    const restS = (p.restMs * env.scales.thinkMul) / 1000;
    const resting = t < this.lastAttackEndT + restS;

    const pressure = arcade ? p.pressure * env.scales.pressureMul * clamp01((t - this.lastOffenceT - PRESSURE_AFTER_S) / PRESSURE_RAMP_S) : 0;
    const scored: { a: ActionId; s: number }[] = [];
    for (const key of Object.keys(u) as ActionId[]) {
      let s = (u[key] as number) * weightOf(p, key);
      let uses = 0;
      for (const r of recent) if (r.a === key) uses++;
      s *= Math.exp(-uses / 2);
      s *= readBonus[key] ?? 1;
      if (heatHigh && ATTACK_ACTIONS.has(key)) s *= 0.4;
      if (arcade && HEAT_COSTLY.has(key) && obs.self.heat > HEAT_EASE_FROM) s *= Math.max(0.15, 1 - (obs.self.heat - HEAT_EASE_FROM) / 40);
      if (arcade && overHeatBudget(key, obs.self.heat, tier.heatAttackMax, obs.core.phase === "incoming")) s = 0;
      if (heatHigh && key === "GUARD" && threat <= 0.8) s *= 0.3;
      if (tier.rookieMistakes && key === this.lastSuccessAction) s *= 1.5;
      if (panicking && (key === "RETREAT" || key === "GRAB_THROW")) s *= 1.8;
      if (key === "JAB" && this.jabAfterBlockHold && threat >= FLAW_RULES.chains_jabs.patchedThreatMax) s = 0;
      if (!arcade && key === "SLAM") s *= 0.6;
      if (pressure > 0) s *= PRESSED.has(key) ? 1 + PRESSURE_GAIN * pressure : WAITING.has(key) ? 1 - 0.5 * pressure : 1;
      if ((t < this.graceUntil || resting) && GRACE_HELD.has(key)) s = 0;
      scored.push({ a: key, s });
    }
    scored.sort((x, y) => y.s - x.s || (x.a < y.a ? -1 : 1));
    // A zero score is a veto (heat budget, opening grace, a patched flaw), never a softmax candidate.
    const top = scored.filter((c) => c.s > 0).slice(0, TOP_K);
    const temp = Math.max(0.05, p.temperature * tier.tempMul * (1.3 - 0.6 * mind.mood.composure) * env.scales.tempMul) * SOFTMAX_SCALE;
    let z = 0;
    const maxS = top[0]?.s ?? 0;
    for (const c of top) z += Math.exp((c.s - maxS) / temp);
    let pick = env.rng.next() * z;
    let chosen: ActionId = top[0]?.a ?? "IDLE_SWAY";
    for (const c of top) {
      pick -= Math.exp((c.s - maxS) / temp);
      if (pick <= 0) { chosen = c.a; break; }
    }
    this.utilities = {};
    for (const c of scored) this.utilities[c.a] = Math.round(c.s * 1000) / 1000;
    // Hesitation (4.3): a close call (top two within 10 %), low composure, or the flaw at Rookie; never at Champion.
    const closeCall = top.length >= 2 && top[1].s >= 0.9 * top[0].s;
    if (tier.hesitation > 0 && ATTACK_ACTIONS.has(chosen) && this.hesitations < 3 && (closeCall || mind.mood.composure < 0.4 || panicking || tier.rookieMistakes) && env.rng.next() < tier.hesitation) {
      this.hesitations++;
      const id = pickVariant(env.rng, ["HESITATE", "HOVER"] as const, this.lastHesitation as "HESITATE" | "HOVER" | null);
      this.lastHesitation = id;
      this.startPrimitive(PRIMITIVES[id], id, t, env, { durationScale: id === "HOVER" ? env.rng.range(0.6, 1.2) : env.rng.range(0.85, 1.3) });
      env.layers.glance(t + 0.001, env.rng.next() < 0.5 ? "gripper" : "camera", env.rng);
      this.intentLabel = id === "HOVER" ? "hover" : "hesitate";
      return;
    }
    if (ATTACK_ACTIONS.has(chosen) || chosen === "FEINT") this.hesitations = 0;
    this.intentLabel = readOn && read && (readBonus[chosen] ?? 1) > 1 ? `anticipation:${read.symbol}` : chosen === "GUARD" && oppRecovering ? "waiting for a miss" : chosen.toLowerCase();
    if (chosen === "JAB") this.jabAfterBlockHold = false;
    this.begin(chosen, t, env);
  }

  private begin(a: ActionId, t: number, env: BrainEnv): void {
    switch (a) {
      case "IDLE_SWAY": return;
      case "GUARD": this.startPrimitive(PRIMITIVES.GUARD_HOLD, "GUARD_HOLD", t, env); return;
      case "FEINT": {
        const base: ActionId = env.rng.next() < 0.6 || env.tier.noSlam ? "JAB" : "SLAM";
        this.startPrimitive(PRIMITIVES[base], base, t, env);
        // A feint looks at the wrong target (4.1) and tells as a feint.
        this.pendingFeint = true;
        if (this.pendingGaze) { this.pendingGaze.onAim = false; this.pendingGaze.wrong = true; }
        const cur = this.current as PrimitiveInstance;
        const wind = cur.phases.filter((ph) => ph.def.kind === "windup");
        const w0 = wind[0].startT, w1 = wind[wind.length - 1].endT;
        // Abort at 60–80 % of the tell (4.2).
        this.feintCancelT = w0 + (w1 - w0) * env.rng.range(0.6, 0.8);
        this.feintChainTo = env.rng.next() < 0.3 ? (base === "JAB" ? "SLAM" : "JAB") : null;
        if (this.feintChainTo === "SLAM" && env.tier.noSlam) this.feintChainTo = "JAB";
        this.usage.push({ a: "FEINT", t });
        return;
      }
      case "SLAM": {
        // 20% of slams hold past full charge before releasing (5.5.2).
        const hold = env.rng.next() < 0.2 ? env.rng.range(150, 500) : 0;
        this.startPrimitive(PRIMITIVES.SLAM, "SLAM", t, env, { chargeHoldMs: hold });
        return;
      }
      case "ADVANCE": this.spacingOffset = Math.min(0.05, this.spacingOffset + 0.03); break;
      case "RETREAT": this.spacingOffset = Math.max(-0.05, this.spacingOffset - 0.03); break;
      default: break;
    }
    const def = PRIMITIVES[a];
    if (def) this.startPrimitive(def, a, t, env);
  }

  /* ───────── output ───────── */

  output(t: number, env: BrainEnv, out: TickOutput, commit = true): void {
    const obs = env.obs;
    const fight = obs.round.phase === "fight" || obs.round.phase === "sudden_death";
    let intents = 0;
    const cur = this.current;
    const live = cur && t >= cur.startT && t < cur.endT + 1e-9;
    if (cur && live && (this.state === "COMMITTED" || this.state === "RATTLED" || this.state === "BEAT" || this.state === "NEUTRAL")) {
      const lead = cur.def.attack ? cur.def.leadMs / 1000 : 0;
      cur.sample(Math.min(cur.endT, t + lead), out.pose);
      intents |= cur.intentsAt(t);
    } else {
      Object.assign(out.pose, this.guard);
      if (this.behavior === null) {
        // Guard goes up only for a threat that has been perceived and reacted to (a released event), never on raw
        // lagged motion: that would be a reaction faster than the tier's reaction time.
        // A public charge is answered by the heavy guess, not by guarding the lunge on sight.
        if (fight && this.state === "NEUTRAL" && this.activeThreat?.kind === "attack_onset" && this.threat > 0.5 && t >= this.guardDropUntil) intents |= INTENT_BITS.guard;
      } else if (fight && this.behavior === "hold_guard") intents |= INTENT_BITS.guard;
    }
    if (t < this.abilityPulseUntil) intents |= INTENT_BITS.ability;
    if (t < this.burstPulseUntil) intents |= INTENT_BITS.burst;
    if (t < this.guardPulseUntil) intents |= INTENT_BITS.guard;
    if (t < this.guardDropUntil) intents &= ~INTENT_BITS.guard;
    out.intents = fight ? intents : 0;
    if (commit) {
      Object.assign(this.lastPose, out.pose);
      this.guardUp = (out.intents & INTENT_BITS.guard) !== 0;
    }
  }

  /** Guard intent was on at the last committed tick ("guard is up", 5.5.3 block reactions). */
  guardUp = false;

  /** Heavy parry success over the rolling window (debug and tests). */
  heavyParryRecord(): { attempts: number; successes: number } {
    const resolved = this.heavyAttempts.filter((h) => h.success !== null);
    return { attempts: resolved.length, successes: resolved.filter((h) => h.success).length };
  }

  get flaw(): { count: number; patched: boolean } { return { count: this.flawCount, patched: this.flawPatched }; }

  /** The oldest flaw report not yet handed out (exploited or patched), or null. */
  takeFlawReport(): FlawReport | null {
    return this.flawReports.shift() ?? null;
  }
}
