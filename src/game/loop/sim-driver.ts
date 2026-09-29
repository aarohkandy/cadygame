// src/game/loop/sim-driver.ts (WP1)
// The fixed-step loop (GAME_DESIGN 10.3) and everything that happens on a physics step or control tick:
// per-seat observations through the event ring and fair-delay line, decision scheduling, live and
// lockstep timing (5.3), the action-delay queue, chunk execution, human ctrl written every step,
// rules stepping, hit stop that freezes ON the impact step, catch-up capped with no spiral, render
// alpha, placements and servo profiles applied as recorded mutations, recorder rows and per-step RLE,
// checkpoints, the moment buffer, and policy debug → flaw / dda events.
//
// The same code runs in the browser (frameTick, wall-clock driven) and headless (advance, step-count
// driven, lockstep). Match flow lives in match-director.ts, which listens through SimListener.

import {
  DOCK_CENTER_X, DOCK_RADIUS, EMPTY_OPPONENT_MEMORY, INTENT_BITS, JOINT_LIMITS, JOINT_NAMES, MOUNT_X, OBS_SCHEMA,
  SEATS, otherSeat, type OpponentMemory,
  type ActionResult, type ActionStatus, type ChunkExecutor, type ChunkSample, type CreateChunkExecutor,
  type EngineResetOptions, type EventBus, type GameEvent, type HitstopMsFor, type Intents, type LoadoutId, type MatchConfig,
  type MatchPhase, type MomentBuffer, type Observation, type ObservationBuilder, type ObservationDelayLine,
  type PhysicsEngine, type PilotController, type PolicyDebug, type ProxyBot, type Recorder, type ResetContext,
  type Seat, type SeatDriver, type SimState, type So101Kinematics, type TickRecord, type Vec3, type CombatRules,
  type CombatSnapshot, type PhysicsFrame, type ObsBlockName,
} from "../contracts.ts";
import type { DrivenGameClock } from "./game-clock.ts";
import { createSeatEventRing } from "./event-ring.ts";
import { ARCADE_TIMESTEP, PRESETS, stepsPerControlTick as stepsPerTick } from "../match/presets.ts";
import { decimationFor, fairDelayFor, isPilotDriven } from "../match/match-config.ts";
import { substream } from "../core/rng.ts";
import type { HudPolicyTelemetry } from "../core/hud-frame.ts";

/** Frame delta guard for tab switches and debugger pauses (10.3). */
export const MAX_WALL_DT_S = 0.1;
/** Catch-up cap: ≤ 40 ms of sim per frame, beyond that time is dropped (10.3). */
export const MAX_STEPS_PER_FRAME: Readonly<Record<"arcade" | "harness", number>> = { arcade: 12, harness: 12 };
/** The attacker's ghost (pilot command) unfreezes this far through a freeze they dealt (section 6: 60 %). */
export const HITSTOP_ATTACKER_RELEASE = 0.6;
/** Live mode: a request with no reply after this long logs a timeout (5.3). */
export const LIVE_TIMEOUT_MS = 500;
/** Live mode: this many consecutive timeouts disconnect the seat (5.3). */
export const DISCONNECT_TIMEOUTS = 3;
/** Lockstep: a single act that takes longer than this errors the episode as policy_hang (5.3). */
export const HARD_ABORT_MS = 30_000;
/** Compute time above this is logged as a slow decision in lockstep, never an outcome change (5.3). */
export const SLOW_DECISION_MS = 500;
/** Warm-up acts before the first real act of a match (5.3). */
export const WARMUP_ACTS = 8;
/** Recorder checkpoint cadence in control ticks (5.8). */
export const CHECKPOINT_TICKS = 50;
/** Moment buffer sample period (5.8: 50 Hz). The buffer must copy what it is pushed: the driver reuses one SimState. */
export const MOMENT_PERIOD_S = 0.02;

/* ───────────────────────── public types ───────────────────────── */

/** How a seat produces ctrl this match. */
export type SeatBinding =
  | { kind: "pilot"; proxy: ProxyBot | null }   // human (proxy null) or proxy bot, through the PilotController
  | { kind: "policy"; driver: SeatDriver }      // builtin, module, trajectory, bridge
  | { kind: "idle" };                           // holds home pose (lobby opponent)

export interface MatchContextInfo {
  round: number; bestOf: number; phase: MatchPhase; phaseLengthS: number; roundsWon: Record<Seat, number>;
}

/** What the director gives the driver and hears back from it. */
export interface SimListener {
  matchContext(): MatchContextInfo;
  /** Once per physics step, after rules.step. `events[firstNew..]` came from this step. */
  onSimStep(frame: PhysicsFrame, combat: CombatSnapshot, events: readonly GameEvent[], firstNew: number): void;
  /** A seat failed in a way that ends its participation: lockstep hang, live disconnect, or a strict-limits fault. */
  onPolicyFault(seat: Seat, kind: "hang" | "disconnect" | "strict", detail: string): void;
}

export type PolicyFaultStatus = Extract<GameEvent, { type: "policy_fault" }>["status"];

export interface SimDriverDeps {
  engine: PhysicsEngine;
  rules: CombatRules;
  clock: DrivenGameClock;
  kinematics: So101Kinematics;
  observations: ObservationBuilder;
  createDelayLine: () => ObservationDelayLine;
  createChunkExecutor: CreateChunkExecutor;
  hitstopMsFor: HitstopMsFor;
  pilot: PilotController | null;
  bus: EventBus | null;
  /** WP6 frame timing: input sample → presented frame. NaN when unknown (Node). */
  displayLatencyMs?: () => number;
  /** Obs schema hash sent in ResetContext; WP4's obs-schema supplies it in the integrated game. */
  obsSchemaHash?: string;
  hardAbortMs?: number;
}

export interface MatchSetup {
  config: MatchConfig;
  bindings: Record<Seat, SeatBinding>;
  recorder: Recorder | null;
  moments: MomentBuffer | null;
  /** Local player for hit-stop perspective (8.1): the human seat, or null. */
  playerSeat: Seat | null;
  /** true: every decision waits for its reply (eval timing, headless). false: live polling with timeouts. */
  lockstep: boolean;
}

export interface SimDriver {
  readonly config: MatchConfig | null;
  /** Control ticks since the match began (the episode frame_index of the next row). */
  readonly tick: number;
  readonly stepsPerControlTick: number;
  /** Physics steps since the current round's engine reset. */
  readonly roundStep: number;
  /** Waiting for a lockstep reply or a driver reset. */
  readonly blocked: boolean;
  readonly running: boolean;
  readonly controlLive: boolean;
  readonly error: "policy_hang" | null;
  readonly policy: Readonly<Record<Seat, HudPolicyTelemetry | null>>;
  /** Events delivered this frame so far (rules, director, drivers), in step order after flush. */
  readonly frameEvents: readonly GameEvent[];
  setListener(listener: SimListener | null): void;
  /** Lobby: arcade engine, pilot in `seat`, the other arm idle; nothing recorded. */
  /** Green room: one idle arm per seat, tuned to `loadout` so the lobby arm matches the picker. */
  configureLobby(seat: Seat, loadout?: LoadoutId): void;
  configureMatch(setup: MatchSetup): void;
  /** Engine bench reset for a round (recorded as a `reset` mutation) and fresh per-round seat state. */
  resetRound(round: number, layout: EngineResetOptions["layout"]): void;
  /** Resets every policy seat's driver for the round (warm-up before the first round). Lockstep waits on it. */
  resetDrivers(round: number, overrides?: Partial<Record<Seat, ResetContext["config"]>>, opponentMemory?: OpponentMemory): Promise<void>;
  /** Physics stepping on or off (off in menus without a live scene). */
  setRunning(on: boolean): void;
  /** Policy requests and chunk sampling on (fight, sudden death) or off (seats hold home). */
  setControlLive(on: boolean): void;
  /** Queues a director or driver event for this frame's delivery and the recording. */
  emit(e: GameEvent): void;
  /** Browser loop at useFrame −2: wall-clock accumulator, steps, hit stop, alpha, event delivery. */
  frameTick(wallDtS: number): void;
  /** Headless: runs up to `maxSteps` steps with no wall clock. Returns steps run; stops early when blocked or stopped. */
  advance(maxSteps: number): number;
  /** Resolves when nothing blocks stepping (immediately when not blocked). */
  whenUnblocked(): Promise<void>;
  /** Hands this frame's events to the bus and the recorder (frameTick does this itself). */
  flushEvents(): void;
  /** Ends the match: drops seat bindings and recorder references. Does not dispose drivers (the caller owns them). */
  endMatch(): void;
}

/* ───────────────────────── per-seat state ───────────────────────── */

interface QueuedAction { applyTick: number; result: ActionResult; requestTick: number; obsFrameIndex: number; }

interface SeatRuntime {
  seat: Seat;
  binding: SeatBinding;
  executor: ChunkExecutor | null;
  delayLine: ObservationDelayLine | null;
  fairDelayMs: number;
  decimation: number;
  sample: ChunkSample;
  /** Targets written this tick (policy/idle) or at the tick's first step (pilot). */
  applied: Float64Array;
  home: Float64Array;
  hasAction: boolean;
  queue: QueuedAction[];
  outstanding: { tick: number; wallMs: number; obsFrameIndex: number; timedOut: boolean } | null;
  consecutiveTimeouts: number;
  disconnected: boolean;
  failed: boolean;
  warmedUp: boolean;
  lastObs: Observation | null;
  delivered: Observation | null;
  counters: Observation["status"];
  /** Row fields for the current tick. */
  rowStatus: ActionStatus;
  rowRaw: Float64Array | null;
  rawBuf: Float64Array;
  rowRequestFrame: number;
  rowObsFrame: number;
  rowComputeMs: number;
  intentBits: number;
  intents: Intents;
  commandBuf: Float32Array;
  lastDebug: { flawKey: string; dda: number | null };
  telemetry: HudPolicyTelemetry | null;
}

function intentsFromBits(bits: number, out: Intents): Intents {
  out.guard = (bits & INTENT_BITS.guard) !== 0;
  out.charge = (bits & INTENT_BITS.charge) !== 0;
  out.grip = (bits & INTENT_BITS.grip) !== 0;
  out.overdrive = (bits & INTENT_BITS.overdrive) !== 0;
  out.ability = (bits & INTENT_BITS.ability) !== 0;
  out.burst = (bits & INTENT_BITS.burst) !== 0;
  return out;
}

export function intentsToBits(i: Readonly<Intents>): number {
  return (i.guard ? INTENT_BITS.guard : 0) | (i.charge ? INTENT_BITS.charge : 0) | (i.grip ? INTENT_BITS.grip : 0)
    | (i.overdrive ? INTENT_BITS.overdrive : 0) | (i.ability ? INTENT_BITS.ability : 0) | (i.burst ? INTENT_BITS.burst : 0);
}

const SHAPING_BITS = { leash: 1, guardBlend: 2, jabMacro: 4, chargeWindup: 8, grabAssist: 16, dockMagnet: 32, aimAssist: 64 } as const;

/** Ego-frame point on the table axis for a seat (x toward the opponent). */
function egoX(seat: Seat, worldX: number): Vec3 {
  const dir = seat === "atlas" ? 1 : -1;
  return [dir * (worldX - MOUNT_X[seat]), 0, 0];
}

/** Home guard joints for both seats, from the kinematics home command. */
export function homePoseFrom(kinematics: So101Kinematics): Float64Array {
  return kinematics.commandToJoints(kinematics.homeCommand(), new Float64Array(6));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ───────────────────────── implementation ───────────────────────── */

type StepResult = "ok" | "halt" | "blocked" | "stopped";

function emptyMatchContext(): MatchContextInfo {
  return { round: 0, bestOf: 1, phase: "green_room", phaseLengthS: 0, roundsWon: { atlas: 0, blaze: 0 } };
}

export function createSimDriver(deps: SimDriverDeps): SimDriver {
  const { engine, rules, clock, kinematics, observations } = deps;
  const hardAbortMs = deps.hardAbortMs ?? HARD_ABORT_MS;
  const obsSchemaHash = deps.obsSchemaHash ?? OBS_SCHEMA;
  const ring = createSeatEventRing();
  const home = homePoseFrom(kinematics);

  let listener: SimListener | null = null;
  let config: MatchConfig | null = null;
  let recorder: Recorder | null = null;
  let moments: MomentBuffer | null = null;
  let playerSeat: Seat | null = null;
  let lockstep = false;
  let spt = 8;
  let tick = 0;
  let roundStep = 0;
  let round = 0;
  let running = false;
  let controlLive = false;
  let error: "policy_hang" | null = null;
  let tickStage: "idle" | "awaiting" | "ready" = "idle";
  let discontinuity = 0;
  /** The per-step physics sparse columns exist for this episode (see recordSparsePhysics). */
  let sparsePhysicsOpened = false;
  let lastMomentT = Number.NEGATIVE_INFINITY;
  let advancing = false;
  const blockers = new Set<Promise<unknown>>();
  const frameEvents: GameEvent[] = [];
  const drainBuf: GameEvent[] = [];
  const lastRevision: Record<Seat, number> = { atlas: -1, blaze: -1 };
  const placementBuf: { cube: number; pos: Vec3 | null }[] = [];
  const stepIntents: Record<Seat, Intents> = {
    atlas: intentsFromBits(0, {} as Intents), blaze: intentsFromBits(0, {} as Intents),
  };
  const stepIntentBits: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const policy: Record<Seat, HudPolicyTelemetry | null> = { atlas: null, blaze: null };
  let profileState: SimState | null = null;
  let momentState: SimState | null = null;
  /** Seat that dealt the current freeze (its ghost is released early), null when the player took it or none is live. */
  let hitstopAttacker: Seat | null = null;

  function makeRuntime(seat: Seat, binding: SeatBinding): SeatRuntime {
    const cfg = config;
    const isPolicy = binding.kind === "policy" && cfg !== null;
    const fair = cfg && isPolicy ? fairDelayFor(cfg, seat) : 0;
    const rt: SeatRuntime = {
      seat, binding,
      executor: isPolicy && cfg ? deps.createChunkExecutor({
        controlHz: cfg.controlHz, chunkExecute: cfg.seats[seat].chunkExecute, temporalEnsembleM: cfg.seats[seat].temporalEnsembleM,
      }) : null,
      delayLine: fair > 0 ? deps.createDelayLine() : null,
      fairDelayMs: fair,
      decimation: cfg ? decimationFor(cfg, seat) : 1,
      sample: { targets: new Float64Array(6), intents: 0, chunkId: -1, chunkIndex: -1, exhausted: false },
      applied: new Float64Array(home),
      home: new Float64Array(home),
      hasAction: false,
      queue: [],
      outstanding: null,
      consecutiveTimeouts: 0,
      disconnected: false,
      failed: false,
      warmedUp: false,
      lastObs: null,
      delivered: null,
      counters: { late_steps: 0, clamped_steps: 0, timeouts: 0 },
      rowStatus: "ok",
      rowRaw: null,
      rawBuf: new Float64Array(6),
      rowRequestFrame: -1,
      rowObsFrame: -1,
      rowComputeMs: Number.NaN,
      intentBits: 0,
      intents: intentsFromBits(0, {} as Intents),
      commandBuf: new Float32Array(6),
      lastDebug: { flawKey: "", dda: null },
      telemetry: null,
    };
    if (binding.kind === "policy" && cfg) {
      rt.telemetry = { label: binding.driver.name, hz: cfg.seats[seat].decisionHz, computeMs: 0, status: "ok", faults: 0 };
    }
    return rt;
  }

  let seats: Record<Seat, SeatRuntime> = {
    atlas: makeRuntime("atlas", { kind: "idle" }), blaze: makeRuntime("blaze", { kind: "idle" }),
  };
  const firstDecisionOfRound: Record<Seat, boolean> = { atlas: true, blaze: true };
  const ready: Record<Seat, boolean> = { atlas: true, blaze: true };

  function block<T>(p: Promise<T>): Promise<T> {
    blockers.add(p);
    const done = () => { blockers.delete(p); };
    p.then(done, done);
    return p;
  }

  function event<T extends GameEvent>(e: Omit<T, "t" | "step">): T {
    return { ...e, t: engine.frame.simTime, step: engine.frame.step } as T;
  }

  function fault(rt: SeatRuntime, status: PolicyFaultStatus, detail: string): void {
    driver.emit(event<Extract<GameEvent, { type: "policy_fault" }>>({ type: "policy_fault", seat: rt.seat, status, detail }));
    if (rt.telemetry) { rt.telemetry.faults++; rt.telemetry.status = status === "disconnect" || status === "hang" ? "error" : status; }
  }

  /* ── reset context ── */

  function resetContextFor(seat: Seat, r: number, override: ResetContext["config"] | undefined, memory?: OpponentMemory): ResetContext {
    const cfg = config as MatchConfig;
    const sc = cfg.seats[seat];
    const def = PRESETS[cfg.preset];
    const d = sc.driver;
    const ctx: ResetContext = {
      schema: OBS_SCHEMA, protocol: "torquelimit.policy/3", obs_schema_hash: obsSchemaHash,
      side: seat, seed: substream(cfg.seed, "seat", seat, r), episode_id: cfg.id, round: r,
      control_hz: cfg.controlHz, decision_hz: sc.decisionHz, action_delay_ticks: cfg.actionDelayTicks,
      fair_delay_ms: fairDelayFor(cfg, seat),
      mode: cfg.timing, preset: cfg.preset, physics: def.physics, strict_limits: cfg.strictLimits,
      joint_names: JOINT_NAMES, joint_limits: JOINT_LIMITS, home_pose: Array.from(home),
      arena: {
        opponent_base: egoX(seat, MOUNT_X[otherSeat(seat)]), midline_x: 0.32,
        dock_self: egoX(seat, DOCK_CENTER_X[seat]), dock_opponent: egoX(seat, DOCK_CENTER_X[otherSeat(seat)]),
        dock_radius: DOCK_RADIUS,
      },
      rules: {
        round_length: cfg.roundLengthS, best_of: cfg.bestOf, integrity_max: rules.state.seats[seat].integrityMax,
        loadout: def.physics === "arcade" ? sc.loadout : null, scoring: def.scoring,
      },
    };
    if (d.kind === "builtin") {
      ctx.config = { personality: d.personality, tier: d.tier, dda: d.dda };
      if (d.behavior !== undefined) ctx.config.behavior = d.behavior;
      if (d.parkOffsetM !== undefined) ctx.config.parkOffsetM = d.parkOffsetM;
    }
    if (override) ctx.config = { ...(ctx.config ?? {}), ...override };
    ctx.opponentMemory = memory ?? EMPTY_OPPONENT_MEMORY;   // 11.9: HARNESS and a fresh profile pass the empty memory
    return ctx;
  }

  function matchContext(): MatchContextInfo {
    return listener ? listener.matchContext() : emptyMatchContext();
  }

  /* ── mutations ── */

  function applyStepMutations(): void {
    const frame = engine.frame;
    if (!config) return;
    placementBuf.length = 0;
    const n = rules.requestPlacements(placementBuf);
    for (let i = 0; i < n; i++) {
      const p = placementBuf[i];
      engine.placeCube(p.cube, p.pos);
      recorder?.mutation({ kind: "place_cube", step: frame.step, index: p.cube, pos: p.pos ? [p.pos[0], p.pos[1], p.pos[2]] : null });
      discontinuity |= 2;
    }
    for (const seat of SEATS) {
      const rev = rules.profileRevision(seat);
      if (rev === lastRevision[seat]) continue;
      lastRevision[seat] = rev;
      const profile = rules.servoProfile(seat);
      engine.applyServoProfile(seat, profile);
      discontinuity |= 4;
      if (!recorder) continue;
      if (PRESETS[config.preset].physics === "harness") {
        if (profile.tauScale === 0) recorder.mutation({ kind: "offline", step: frame.step, seat });
        continue;
      }
      profileState = engine.saveState(profileState ?? undefined);
      const base = seat === "atlas" ? 0 : 6;
      const kp: number[] = [], kv: number[] = [], fr: number[] = [];
      for (let j = 0; j < 5; j++) {
        kp.push(profileState.servo[(base + j) * 3]);
        kv.push(profileState.servo[(base + j) * 3 + 1]);
        fr.push(profileState.servo[(base + j) * 3 + 2]);
      }
      recorder.mutation({ kind: "servo_profile", step: frame.step, seat, kp, kv, forcerange: fr });
    }
  }

  /* ── policy results ── */

  function noteDebug(rt: SeatRuntime, debug: PolicyDebug | undefined): void {
    if (!debug) return;
    if (debug.flaw) {
      const key = `${debug.flaw.flaw}|${debug.flaw.stage}|${debug.flaw.count}`;
      if (key !== rt.lastDebug.flawKey) {
        rt.lastDebug.flawKey = key;
        driver.emit(event<Extract<GameEvent, { type: "flaw" }>>({
          type: "flaw", seat: rt.seat, flaw: debug.flaw.flaw, stage: debug.flaw.stage, count: debug.flaw.count,
        }));
      }
    }
    if (typeof debug.dda === "number" && Number.isFinite(debug.dda)) {
      const prev = rt.lastDebug.dda;
      rt.lastDebug.dda = debug.dda;
      if (prev !== null && debug.dda !== prev) {
        // A change on the first decision of a round came from the between-rounds adjustment, not an exchange.
        const reason = firstDecisionOfRound[rt.seat] && debug.dda < prev ? (round <= 1 ? "loss_streak" : "post_loss_clamp") : "exchange";
        driver.emit(event<Extract<GameEvent, { type: "dda" }>>({ type: "dda", seat: rt.seat, k: debug.dda, reason }));
      }
    }
    // 11.9 character channel: ShowEvents go on the bus for captions, audio and VFX; affect and the effective tier
    // stay on the seat telemetry for the hosts' menace gates, the HUD's SPARRING tag and the ×0.6 damage rule.
    if (debug.show) for (const show of debug.show) driver.emit(event<Extract<GameEvent, { type: "show" }>>({ type: "show", show }));
    if (rt.telemetry) {
      if (debug.affect) rt.telemetry.affect = debug.affect;
      if (debug.tier !== undefined) rt.telemetry.tier = debug.tier;
    }
    firstDecisionOfRound[rt.seat] = false;
  }

  function acceptArrival(rt: SeatRuntime, result: ActionResult, delivered: Observation | null): void {
    const cfg = config as MatchConfig;
    const req = rt.outstanding;
    rt.outstanding = null;
    rt.consecutiveTimeouts = 0;
    const requestTick = req ? req.tick : result.tick;
    let status: ActionStatus = result.status;
    if (lockstep && status === "ok" && result.computeMs > SLOW_DECISION_MS) status = "slow";
    rt.rowStatus = status;
    rt.rowComputeMs = result.computeMs;
    rt.rowRequestFrame = requestTick;
    const targets = result.action?.targets;
    for (let j = 0; j < 6; j++) rt.rawBuf[j] = targets && j < targets.length ? Number(targets[j]) : Number.NaN;
    rt.rowRaw = rt.rawBuf;
    if (rt.telemetry) { rt.telemetry.computeMs = result.computeMs; rt.telemetry.status = status; }
    if (status === "clamped") rt.counters.clamped_steps++;
    noteDebug(rt, result.action?.debug);

    if (status === "error" || (status === "clamped" && cfg.strictLimits)) {
      const detail = result.error ?? (status === "clamped" ? "joint limit exceeded" : "invalid action");
      fault(rt, status, detail);
      if (cfg.strictLimits) {
        rt.failed = true;
        listener?.onPolicyFault(rt.seat, "strict", detail);
      }
      if (status === "error") return;          // lenient: hold the last action
    }
    rt.queue.push({
      applyTick: Math.max(requestTick + cfg.actionDelayTicks, tick),
      result, requestTick,
      obsFrameIndex: req ? req.obsFrameIndex : delivered?.frame_index ?? -1,
    });
  }

  /* ── control tick ── */

  function buildObservation(rt: SeatRuntime, ctx: MatchContextInfo): Observation {
    drainBuf.length = 0;
    ring.drain(rt.seat, drainBuf);
    const frame = engine.frame;
    // Policy seats get a fresh object (drivers and delay lines may keep it); others reuse theirs.
    const reuse = rt.binding.kind === "policy" ? undefined : rt.lastObs ?? undefined;
    return observations.build(rt.seat, frame, rules.state, ctx, rt.applied, rt.counters, tick, tick, drainBuf, reuse);
  }

  function beginTick(): void {
    const cfg = config as MatchConfig;
    const ctx = matchContext();
    const wallMs = clock.wallTime * 1000;
    const waits: Promise<void>[] = [];

    if (recorder && tick % CHECKPOINT_TICKS === 0) {
      recorder.checkpoint(engine.frame.step, engine.saveState(), engine.checksum());
    }

    for (const seat of SEATS) {
      const rt = seats[seat];
      rt.rowStatus = "ok";
      rt.rowRaw = null;
      rt.rowRequestFrame = -1;
      rt.rowComputeMs = Number.NaN;
      const obs = buildObservation(rt, ctx);
      rt.lastObs = obs;
      let delivered = obs;
      if (rt.delayLine) {
        rt.delayLine.push(obs);
        delivered = rt.delayLine.read(rt.fairDelayMs);
      }
      rt.delivered = delivered;

      if (rt.binding.kind === "pilot") {
        if (advancing && deps.pilot) deps.pilot.sampleFrame(1 / cfg.controlHz, false);
        if (rt.binding.proxy && deps.pilot) rt.binding.proxy.update(delivered, deps.pilot, deps.pilot.synthetic(), 1 / cfg.controlHz);
        rt.rowObsFrame = -1;
        continue;
      }
      if (rt.binding.kind !== "policy" || !rt.executor) continue;
      const drv = rt.binding.driver;
      const active = controlLive && ready[seat] && !rt.failed && !rt.disconnected;

      if (active) {
        const isDecision = tick % rt.decimation === 0;
        if (rt.executor.wantsRequest(isDecision)) {
          if (rt.outstanding) {
            rt.rowStatus = "late";
            rt.counters.late_steps++;
          } else {
            drv.request(delivered, tick);
            rt.outstanding = { tick, wallMs, obsFrameIndex: delivered.frame_index, timedOut: false };
            if (lockstep) {
              const pending = rt.outstanding;
              waits.push(drv.waitForResult(hardAbortMs).then(
                (result) => { if (rt.outstanding === pending) acceptArrival(rt, result, delivered); },
                (err: unknown) => {
                  rt.outstanding = null;
                  rt.failed = true;
                  error = "policy_hang";
                  rt.rowStatus = "error";
                  fault(rt, "hang", `no action within ${Math.round(hardAbortMs / 1000)} s: ${describeError(err)}`);
                  listener?.onPolicyFault(seat, "hang", describeError(err));
                },
              ));
            }
          }
        }
        if (!lockstep) {
          const result = drv.poll();
          if (result) acceptArrival(rt, result, delivered);
          else if (rt.outstanding && !rt.outstanding.timedOut && wallMs - rt.outstanding.wallMs > LIVE_TIMEOUT_MS) {
            rt.outstanding.timedOut = true;
            rt.outstanding = null;
            rt.rowStatus = "timeout";
            rt.counters.timeouts++;
            rt.consecutiveTimeouts++;
            fault(rt, "timeout", `no reply within ${LIVE_TIMEOUT_MS} ms`);
            if (rt.consecutiveTimeouts >= DISCONNECT_TIMEOUTS) {
              rt.disconnected = true;
              fault(rt, "disconnect", `${DISCONNECT_TIMEOUTS} timeouts in a row`);
              listener?.onPolicyFault(seat, "disconnect", `${DISCONNECT_TIMEOUTS} timeouts in a row`);
            }
          }
        }
      }
    }

    if (waits.length > 0) {
      tickStage = "awaiting";
      void block(Promise.all(waits).then(() => { tickStage = "ready"; }));
    } else {
      tickStage = "ready";
    }
  }

  function finishTick(): void {
    for (const seat of SEATS) {
      const rt = seats[seat];
      if (rt.binding.kind === "pilot") continue;
      if (rt.binding.kind === "policy" && rt.executor) {
        for (let i = 0; i < rt.queue.length; ) {
          const q = rt.queue[i];
          if (q.applyTick <= tick) {
            rt.executor.accept(q.result, q.result.action?.chunkStartT ?? rt.delivered?.t ?? engine.frame.simTime);
            rt.hasAction = true;
            rt.rowObsFrame = q.obsFrameIndex;
            rt.queue.splice(i, 1);
          } else {
            i++;
          }
        }
        if (controlLive && rt.hasAction && rt.executor.sample(engine.frame.simTime, rt.sample)) {
          rt.applied.set(rt.sample.targets);
          rt.intentBits = rt.sample.intents & ~INTENT_BITS.grip;   // grip is targets[5] for policies (4.9)
        } else if (!controlLive) {
          rt.intentBits = 0;
        }
        if (!rt.hasAction) rt.rowObsFrame = -1;
      }
      engine.setTargets(seat, rt.applied);
      intentsFromBits(rt.intentBits, stepIntents[seat]);
      stepIntentBits[seat] = rt.intentBits;
    }
  }

  const row: TickRecord = {
    frameIndex: 0, t: 0, round: 0, phase: "fight", discontinuity: 0,
    obs: { atlas: {} as Record<ObsBlockName, Float32Array>, blaze: {} as Record<ObsBlockName, Float32Array> },
    delivered: { atlas: null, blaze: null },
    applied: { atlas: new Float64Array(6), blaze: new Float64Array(6) },
    raw: { atlas: null, blaze: null },
    requestFrameIndex: { atlas: -1, blaze: -1 }, obsFrameIndex: { atlas: -1, blaze: -1 },
    chunkId: { atlas: -1, blaze: -1 }, chunkIndex: { atlas: -1, blaze: -1 },
    intents: { atlas: 0, blaze: 0 },
    status: { atlas: "ok", blaze: "ok" }, computeMs: { atlas: Number.NaN, blaze: Number.NaN },
    human: { atlas: null, blaze: null },
    displayLatencyMs: Number.NaN,
  };
  const humanRows: Record<Seat, { command: Float32Array; shaping: number }> = {
    atlas: { command: new Float32Array(6), shaping: 0 }, blaze: { command: new Float32Array(6), shaping: 0 },
  };

  function writeRow(): void {
    if (!recorder) return;
    const ctx = matchContext();
    row.frameIndex = tick;
    row.t = engine.frame.simTime;
    row.round = round;
    row.phase = ctx.phase;
    row.discontinuity = discontinuity;
    discontinuity = 0;
    const pilot = deps.pilot;
    for (const seat of SEATS) {
      const rt = seats[seat];
      if (rt.lastObs) row.obs[seat] = rt.lastObs.blocks;
      row.delivered[seat] = rt.delayLine && rt.delivered ? rt.delivered.blocks : null;
      row.applied[seat] = rt.applied;
      row.raw[seat] = rt.rowRaw;
      row.requestFrameIndex[seat] = rt.rowRequestFrame;
      row.obsFrameIndex[seat] = rt.rowObsFrame;
      const chunked = rt.binding.kind === "policy" && rt.hasAction && controlLive;
      row.chunkId[seat] = chunked ? rt.sample.chunkId : -1;
      row.chunkIndex[seat] = chunked ? rt.sample.chunkIndex : -1;
      row.intents[seat] = stepIntentBits[seat];
      row.status[seat] = rt.rowStatus;
      row.computeMs[seat] = rt.rowComputeMs;
      if (rt.binding.kind === "pilot" && pilot) {
        const h = humanRows[seat];
        const c = pilot.command;
        h.command[0] = c.yaw; h.command[1] = c.elev; h.command[2] = c.reach; h.command[3] = c.tool; h.command[4] = c.roll; h.command[5] = c.grip;
        const s = pilot.shaping;
        h.shaping = (s.leash ? SHAPING_BITS.leash : 0) | (s.guardBlend ? SHAPING_BITS.guardBlend : 0) | (s.jabMacro ? SHAPING_BITS.jabMacro : 0)
          | (s.chargeWindup ? SHAPING_BITS.chargeWindup : 0) | (s.grabAssist ? SHAPING_BITS.grabAssist : 0)
          | (s.dockMagnet ? SHAPING_BITS.dockMagnet : 0) | (s.aimAssist ? SHAPING_BITS.aimAssist : 0);
        row.human[seat] = h;
      } else {
        row.human[seat] = null;
      }
    }
    row.displayLatencyMs = deps.displayLatencyMs ? deps.displayLatencyMs() : Number.NaN;
    recorder.tick(row);
  }

  /**
   * Per-step physics facts the stats layer reads back out of the sparse channel: the normal impulse a seat's
   * camera mount took this step (`PhysicalSeatStats.opticsImpulse`, summed over the opponent's column) and every
   * self-collision onset (`selfCollisions`, a count). Sparse means only the steps that carry something are
   * stored - without this both figures come back as NaN from an otherwise complete episode.
   */
  function recordSparsePhysics(rec: Recorder): void {
    const frame = engine.frame;
    if (!sparsePhysicsOpened) {
      // Open the column with a zero so its absence means "this episode carries no such measurement" rather
      // than "nothing happened"; the stats layer reports NaN for the former and a real 0 for the latter.
      sparsePhysicsOpened = true;
      for (const seat of SEATS) rec.sparse(`physics.optics_impulse.${seat}`, tick, 0);
    }
    for (const seat of SEATS) {
      const impulse = frame.active.opticsImpulse[seat];
      if (impulse > 0) rec.sparse(`physics.optics_impulse.${seat}`, tick, impulse);
    }
    for (let i = 0; i < frame.onsets.length; i++) {
      const o = frame.onsets[i];
      if (o.kind === "self") rec.sparse(`physics.self_contacts.${o.seat}`, tick, `${o.linkA}/${o.linkB}`);
    }
  }

  /* ── one physics step ── */

  function stepOnce(allowHitstop: boolean): StepResult {
    if (!running) return "stopped";
    if (blockers.size > 0) return "blocked";
    const frame = engine.frame;
    const isTick = config !== null && roundStep % spt === 0;
    if (isTick) {
      if (tickStage === "idle") beginTick();
      if (tickStage === "awaiting") return "blocked";
      finishTick();
    }

    applyStepMutations();

    for (const seat of SEATS) {
      const rt = seats[seat];
      if (rt.binding.kind !== "pilot" || !deps.pilot) continue;
      deps.pilot.writeCommand(frame, rules.state, rt.applied);
      engine.setTargets(seat, rt.applied);
      rt.intentBits = intentsToBits(deps.pilot.intents);
      intentsFromBits(rt.intentBits, stepIntents[seat]);
      stepIntentBits[seat] = rt.intentBits;
    }

    if (isTick) {
      writeRow();
      if (moments && frame.simTime - lastMomentT >= MOMENT_PERIOD_S - 1e-9) {
        momentState = engine.saveState(momentState ?? undefined);   // MomentBuffer.push copies into its own ring
        moments.push(frame.simTime, momentState);
        lastMomentT = frame.simTime;
      }
      tick++;
      tickStage = "idle";
    }

    recorder?.stepCtrl(frame.step, frame, stepIntentBits);
    engine.step();
    if (recorder) recordSparsePhysics(recorder);
    roundStep++;
    clock.setSimTime(frame.simTime);
    if (!config) return "ok";

    const firstNew = frameEvents.length;
    rules.step({ frame, intents: stepIntents }, frameEvents);
    const rulesEnd = frameEvents.length;
    ring.push(frameEvents, firstNew);
    let stopMs = 0;
    let attacker: Seat | null = null;
    if (allowHitstop && clock.features.hitstop) {
      for (let i = firstNew; i < rulesEnd; i++) {
        const e = frameEvents[i];
        const ms = deps.hitstopMsFor(e, config.preset, playerSeat);
        if (ms > stopMs) { stopMs = ms; attacker = e.type === "strike" || e.type === "ko" ? e.attacker : null; }
      }
    }
    listener?.onSimStep(frame, rules.state, frameEvents, firstNew);
    if (stopMs > 0) {
      if (clock.requestHitstop(stopMs) > 0) hitstopAttacker = attacker;
      return "halt";
    }
    return "ok";
  }

  function resetSeatRound(rt: SeatRuntime): void {
    rt.executor?.reset();
    rt.delayLine?.clear();
    rt.queue.length = 0;
    rt.outstanding = null;
    rt.hasAction = false;
    rt.applied.set(rt.home);
    rt.intentBits = 0;
    rt.lastObs = null;
    rt.delivered = null;
    rt.consecutiveTimeouts = 0;
    firstDecisionOfRound[rt.seat] = true;
  }

  const driver: SimDriver = {
    get config() { return config; },
    get tick() { return tick; },
    get stepsPerControlTick() { return spt; },
    get roundStep() { return roundStep; },
    get blocked() { return blockers.size > 0; },
    get running() { return running; },
    get controlLive() { return controlLive; },
    get error() { return error; },
    get policy() { return policy; },
    get frameEvents() { return frameEvents; },

    setListener(l: SimListener | null): void { listener = l; },

    configureLobby(seat: Seat, loadout: LoadoutId = "pivot"): void {
      config = null; recorder = null; moments = null; playerSeat = seat; lockstep = false;
      clock.configure({ hitstop: false, dilation: false });
      spt = 1; tick = 0; roundStep = 0; round = 0; error = null; controlLive = false; tickStage = "idle";
      policy.atlas = null; policy.blaze = null;
      seats = {
        atlas: makeRuntime("atlas", seat === "atlas" ? { kind: "pilot", proxy: null } : { kind: "idle" }),
        blaze: makeRuntime("blaze", seat === "blaze" ? { kind: "pilot", proxy: null } : { kind: "idle" }),
      };
      engine.reset({
        mode: "arcade", timestep: ARCADE_TIMESTEP, seed: 0,
        loadouts: { atlas: loadout, blaze: loadout }, homePose: { atlas: home, blaze: home }, layout: "lobby",
      });
      clock.reset(engine.frame.simTime);
      for (const s of SEATS) if (seats[s].binding.kind === "idle") engine.setTargets(s, home);
      ring.clear();
      frameEvents.length = 0;
      running = true;
    },

    configureMatch(setup: MatchSetup): void {
      config = setup.config;
      recorder = setup.recorder;
      moments = setup.moments;
      playerSeat = setup.playerSeat;
      lockstep = setup.lockstep;
      const def = PRESETS[config.preset];
      clock.configure({ hitstop: def.hitstop && !lockstep, dilation: def.dilation && !lockstep });
      spt = stepsPerTick(config.timestep, config.controlHz);
      tick = 0; roundStep = 0; round = 0; error = null; controlLive = false; tickStage = "idle";
      discontinuity = 0;
      sparsePhysicsOpened = false;
      lastMomentT = Number.NEGATIVE_INFINITY;
      seats = { atlas: makeRuntime("atlas", setup.bindings.atlas), blaze: makeRuntime("blaze", setup.bindings.blaze) };
      for (const s of SEATS) {
        policy[s] = seats[s].telemetry;
        ready[s] = setup.bindings[s].kind !== "policy";
        if (isPilotDriven(config.seats[s].driver) && setup.bindings[s].kind !== "pilot") {
          throw new Error(`seat ${s} is ${config.seats[s].driver.kind} but was bound as ${setup.bindings[s].kind}`);
        }
      }
      ring.clear();
      frameEvents.length = 0;
      running = true;
    },

    resetRound(r: number, layout: EngineResetOptions["layout"]): void {
      const cfg = config;
      if (!cfg) throw new Error("resetRound needs a configured match");
      round = r;
      const seed = substream(cfg.seed, "physicsInit", r);
      engine.reset({
        mode: PRESETS[cfg.preset].physics, timestep: cfg.timestep, seed,
        loadouts: { atlas: cfg.seats.atlas.loadout, blaze: cfg.seats.blaze.loadout },
        homePose: { atlas: home, blaze: home }, layout,
      });
      clock.reset(engine.frame.simTime);
      roundStep = 0;
      tickStage = "idle";
      ring.clear();
      for (const s of SEATS) {
        resetSeatRound(seats[s]);
        engine.setTargets(s, home);
        lastRevision[s] = rules.profileRevision(s);
      }
      discontinuity |= 1;
      if (recorder) {
        if (tick === 0) recorder.mutation({ kind: "timestep", step: engine.frame.step, dt: cfg.timestep });
        recorder.mutation({ kind: "reset", step: engine.frame.step, seed, round: r, state: engine.saveState() });
      }
    },

    resetDrivers(r: number, overrides?: Partial<Record<Seat, ResetContext["config"]>>, opponentMemory?: OpponentMemory): Promise<void> {
      const cfg = config;
      if (!cfg) return Promise.resolve();
      const jobs: Promise<void>[] = [];
      for (const s of SEATS) {
        const rt = seats[s];
        if (rt.binding.kind !== "policy" || rt.failed) continue;
        const drv = rt.binding.driver;
        ready[s] = false;
        const ctx = resetContextFor(s, r, overrides?.[s], opponentMemory);
        const job = (async () => {
          await drv.reset(ctx);
          if (!rt.warmedUp) {
            const fixture: Observation[] = [];
            const matchCtx = matchContext();
            for (let i = 0; i < WARMUP_ACTS; i++) {
              fixture.push(observations.build(s, engine.frame, rules.state, matchCtx, rt.home, rt.counters, 0, 0, []));
            }
            await drv.warmup(fixture);
            rt.warmedUp = true;
          }
          ready[s] = true;
        })().catch((err: unknown) => {
          rt.failed = true;
          fault(rt, "disconnect", `reset failed: ${describeError(err)}`);
          listener?.onPolicyFault(s, "disconnect", describeError(err));
        });
        jobs.push(job);
      }
      const all = Promise.all(jobs).then(() => undefined);
      return lockstep ? block(all) : all;
    },

    setRunning(on: boolean): void { running = on; if (!on) clock.acc = 0; },

    setControlLive(on: boolean): void { controlLive = on; },

    emit(e: GameEvent): void { frameEvents.push(e); },

    frameTick(wallDtS: number): void {
      const wall = Math.min(Math.max(0, Number.isFinite(wallDtS) ? wallDtS : 0), MAX_WALL_DT_S);
      clock.advanceWall(wall);
      const frozen = clock.hitstopRemainingMs > 0;
      if (!frozen) hitstopAttacker = null;
      const pilotSeated = SEATS.some((s) => seats[s].binding.kind === "pilot");
      // The hand answers before the arm (3.1): the attacker's ghost is let go at 60 % of a freeze they dealt.
      const ghostFrozen = frozen && !(hitstopAttacker !== null && hitstopAttacker === playerSeat
        && clock.hitstopRemainingMs <= clock.hitstopTotalMs * (1 - HITSTOP_ATTACKER_RELEASE));
      if (pilotSeated && deps.pilot) deps.pilot.sampleFrame(wall, ghostFrozen);
      const dt = engine.frame.dt;
      const canStep = running && !clock.paused && !clock.externalDrive;
      if (canStep && !frozen) {
        if (config?.turbo) {
          const clockNow = globalThis.performance;
          const start = clockNow.now();
          while (clockNow.now() - start < 12) {
            let r: StepResult = "ok";
            for (let i = 0; i < 64 && r === "ok"; i++) r = stepOnce(false);
            if (r !== "ok") break;
          }
          clock.acc = 0;
        } else {
          clock.acc += wall * clock.timeScale;
          const max = MAX_STEPS_PER_FRAME[engine.frame.mode];
          let n = 0;
          while (clock.acc >= dt && n < max) {
            const r = stepOnce(!lockstep);
            if (r === "blocked" || r === "stopped") { clock.acc = Math.min(clock.acc, dt); break; }
            clock.acc -= dt;
            n++;
            if (r === "halt") { clock.acc = 0; break; }
          }
          if (n === max) clock.acc = 0;
        }
      }
      if (!clock.externalDrive) clock.setRenderAlpha(clock.hitstopRemainingMs > 0 ? 1 : clock.acc / dt);
      driver.flushEvents();
    },

    advance(maxSteps: number): number {
      advancing = true;
      let n = 0;
      try {
        while (n < maxSteps) {
          const r = stepOnce(false);
          if (r === "blocked" || r === "stopped") break;
          n++;
        }
      } finally {
        advancing = false;
      }
      return n;
    },

    async whenUnblocked(): Promise<void> {
      while (blockers.size > 0) await Promise.allSettled(Array.from(blockers));
    },

    flushEvents(): void {
      if (frameEvents.length === 0) return;
      deps.bus?.pushStepEvents(frameEvents, 0);
      recorder?.events(frameEvents);
      frameEvents.length = 0;
    },

    endMatch(): void {
      driver.flushEvents();
      config = null; recorder = null; moments = null; controlLive = false; tickStage = "idle";
      seats = { atlas: makeRuntime("atlas", { kind: "idle" }), blaze: makeRuntime("blaze", { kind: "idle" }) };
      policy.atlas = null; policy.blaze = null;
      ring.clear();
    },
  };
  return driver;
}
