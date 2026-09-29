// src/game/harness/determinism.ts (WP5)
// Physics re-simulation of a recorded episode (GAME_DESIGN 5.9.2) and the policy determinism check (5.6).
//
// Re-sim mirrors the sim-driver's step order exactly: [tick start: checkpoint] -> Core placements (recorded
// place_cube mutations; the regenerated rules' requests are checked against them) -> servo profile changes
// from the regenerated rules -> recorded per-step ctrl -> engine.step -> rules.step with recorded intents.
// Rules gating (reset per round, live on/off, sudden death) is rebuilt from the recorded phase events, the
// same points at which the director called the rules. Checksums are compared at every checkpoint and the
// regenerated rules events against the recorded ones, in order.

import {
  DOCK_CENTER_X, DOCK_RADIUS, GRIP_OPEN, INTENT_BITS, JOINT_LIMITS, JOINT_NAMES, OBS_SCHEMA, SEATS,
  type CombatRules, type ControlHz, type CoreMutationRequest, type CreateCombatRules, type CreateInProcessSeatDriver,
  type CreatePhysicsEngine, type CreateSeatDriver, type DriverSpec, type Episode, type GameEvent, type Intents,
  type MatchConfig, type Observation, type ObservationBuilder, type PhysicsEngine, type PolicyAction, type ResetContext,
  type Seat, type SimMutation, type SimState, type VerifyResult,
} from "../contracts.ts";
import { rulesConfigFor, showRulesFromMeta } from "../match/match-config.ts";
import { stepsPerControlTick } from "../match/presets.ts";
import { SEGMENTS_COLUMN, type SegmentMark } from "./recorder.ts";

/** Event types the director and sim-driver emit; everything else in a recording came from rules.step. */
export const NON_RULES_EVENTS: ReadonlySet<GameEvent["type"]> = new Set(["phase", "round_end", "match_end", "policy_fault", "flaw", "dda", "show", "task_success"]);
/**
 * Optional sparse column a caller may record when rules gating happens at a moment no phase event marks
 * (live-timing sudden death going live after its intro, the pointer-lock protection hold):
 * value `{ step, round, live?: boolean, protected?: { seat, on } }`.
 */
export const RULES_CONTROL_COLUMN = "rules.control";

const LIVE_PHASES = new Set(["fight", "sudden_death"]);
/**
 * Phases that never change rules gating mid-segment. round_intro in particular is emitted just before the next
 * round's engine reset, so its step belongs to the previous segment's numbering; the segment start handles it.
 */
const IGNORED_PHASES = new Set(["paused", "title", "boot", "green_room", "match_intro", "rematch_intro", "round_intro"]);

export class ResimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResimError";
  }
}

/* ───────────────────────── episode index ───────────────────────── */

export type RulesOp =
  | { step: number; kind: "live"; on: boolean }
  | { step: number; kind: "sudden_death"; round: number }
  | { step: number; kind: "protected"; seat: Seat; on: boolean };

export interface SegmentInfo extends SegmentMark {
  index: number;
  reset: Extract<SimMutation, { kind: "reset" }>;
  ctrlEnd: number; intentsEnd: number; checkpointEnd: number; mutationEnd: number;
  /** Rows [firstTick, endTick). */
  endTick: number;
  ops: RulesOp[];
}

export interface EpisodeIndex {
  spt: number;
  rows: number;
  segments: SegmentInfo[];
  totalSteps: number;
  /** Recorded rules events in order (the verify comparison target). */
  rulesEvents: GameEvent[];
}

function sparseSegments(ep: Episode): SegmentMark[] {
  const entries = ep.sparse[SEGMENTS_COLUMN];
  if (!Array.isArray(entries) || entries.length === 0) throw new ResimError("episode has no round segment index (sim.segments)");
  return entries.map((e) => e.value as SegmentMark);
}

export function indexEpisode(ep: Episode): EpisodeIndex {
  const meta = ep.meta;
  const spt = stepsPerControlTick(meta.timestep, meta.controlHz);
  const rows = ep.columns.frame_index.length;
  const marks = sparseSegments(ep);
  const segments: SegmentInfo[] = marks.map((m, i) => {
    const next = marks[i + 1];
    const reset = ep.steps.mutations[m.mutationIndex];
    if (!reset || reset.kind !== "reset") throw new ResimError(`segment ${i + 1} does not start at a reset mutation`);
    if (m.steps > 0 && m.lastStep !== m.resetStep + m.steps - 1) throw new ResimError(`segment ${i + 1} steps are not contiguous`);
    return {
      ...m, index: i, reset,
      ctrlEnd: next ? next.ctrlIndex : ep.steps.ctrl.steps.length,
      intentsEnd: next ? next.intentsIndex : ep.steps.intents.steps.length,
      checkpointEnd: next ? next.checkpointIndex : ep.steps.checkpoints.length,
      mutationEnd: next ? next.mutationIndex : ep.steps.mutations.length,
      endTick: next ? next.firstTick : rows,
      ops: [],
    };
  });

  // Rules gating from phase events, attached to the first segment of the event's round.
  const firstOfRound = new Map<number, SegmentInfo>();
  for (const s of segments) if (!firstOfRound.has(s.round)) firstOfRound.set(s.round, s);
  let lastPhase: string | null = null;
  const rulesEvents: GameEvent[] = [];
  for (const e of ep.events) {
    if (!NON_RULES_EVENTS.has(e.type)) { rulesEvents.push(e); continue; }
    if (e.type !== "phase" || IGNORED_PHASES.has(e.phase)) continue;
    if (e.phase === lastPhase) continue;
    lastPhase = e.phase;
    const seg = firstOfRound.get(e.round);
    if (!seg) continue;
    if (e.phase === "sudden_death") {
      seg.ops.push({ step: e.step, kind: "sudden_death", round: e.round });
      if (meta.timing === "eval") seg.ops.push({ step: e.step, kind: "live", on: true });
    } else {
      seg.ops.push({ step: e.step, kind: "live", on: LIVE_PHASES.has(e.phase) });
    }
  }
  for (const entry of ep.sparse[RULES_CONTROL_COLUMN] ?? []) {
    const v = entry.value as { step?: number; round?: number; live?: boolean; protected?: { seat: Seat; on: boolean } };
    if (typeof v?.step !== "number" || typeof v.round !== "number") continue;
    const seg = firstOfRound.get(v.round);
    if (!seg) continue;
    if (typeof v.live === "boolean") seg.ops.push({ step: v.step, kind: "live", on: v.live });
    if (v.protected) seg.ops.push({ step: v.step, kind: "protected", seat: v.protected.seat, on: v.protected.on });
  }
  for (const s of segments) {
    const order = s.ops.map((op, i) => ({ op, i }));
    order.sort((a, b) => a.op.step - b.op.step || a.i - b.i);
    s.ops = order.map((o) => o.op);
  }
  let totalSteps = 0;
  for (const s of segments) totalSteps += s.steps;
  return { spt, rows, segments, totalSteps, rulesEvents };
}

/** Segment holding row `frame`, or null. */
export function segmentForFrame(index: EpisodeIndex, frame: number): SegmentInfo | null {
  for (const s of index.segments) if (frame >= s.firstTick && frame < s.endTick) return s;
  return null;
}

/* ───────────────────────── canonical comparison ───────────────────────── */

function canonicalReplacer(_k: string, v: unknown): unknown {
  if (typeof v !== "number") return v;
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  return Object.is(v, -0) ? "-0" : v;
}

export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, canonicalReplacer);
}

function describeEvent(e: GameEvent): string {
  const text = canonicalJson(e);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/* ───────────────────────── re-simulation ───────────────────────── */

export interface ResimFailure {
  kind: "checksum" | "state" | "event" | "mutation";
  frame: number;
  t: number;
  message: string;
  eventMismatch: string | null;
}

export interface Resim {
  readonly index: EpisodeIndex;
  /** Current segment, −1 before the first beginSegment. */
  readonly segment: number;
  /** Steps run in the current segment. */
  readonly segmentStep: number;
  readonly stepsDone: number;
  readonly failure: ResimFailure | null;
  /** Row of the next step when it starts a control tick, else −1. */
  readonly tickStart: number;
  readonly segmentDone: boolean;
  beginSegment(k: number): void;
  /** Runs one physics step of the current segment. Returns false when the segment has no steps left. */
  step(): boolean;
  /** After the last segment: recorded rules events that were never regenerated. */
  finish(): ResimFailure | null;
}

export interface ResimOptions {
  /** Regenerated rules. Null runs physics only (servo profile changes cannot be reproduced). */
  rules: CombatRules | null;
  /** Compare checksums and events (verify). Kinematic replay turns this off. */
  check: boolean;
}

const EMPTY_INTENTS = (): Record<Seat, Intents> => ({
  atlas: { guard: false, charge: false, grip: false, overdrive: false, ability: false, burst: false },
  blaze: { guard: false, charge: false, grip: false, overdrive: false, ability: false, burst: false },
});

function writeIntents(bits: number, out: Intents): void {
  out.guard = (bits & INTENT_BITS.guard) !== 0;
  out.charge = (bits & INTENT_BITS.charge) !== 0;
  out.grip = (bits & INTENT_BITS.grip) !== 0;
  out.overdrive = (bits & INTENT_BITS.overdrive) !== 0;
  out.ability = (bits & INTENT_BITS.ability) !== 0;
  out.burst = (bits & INTENT_BITS.burst) !== 0;
}

/** MatchConfig fields rulesConfigFor reads, rebuilt from meta. */
function rulesMatchConfig(ep: Episode): MatchConfig {
  const m = ep.meta;
  return {
    preset: m.preset, roundLengthS: m.rules.roundLengthS,
    seats: { atlas: { loadout: m.seats.atlas.loadout }, blaze: { loadout: m.seats.blaze.loadout } },
  } as unknown as MatchConfig;
}

function roundsWonBefore(ep: Episode, round: number): Record<Seat, number> {
  const won = { atlas: 0, blaze: 0 };
  for (const r of ep.meta.result.rounds) if (r.round < round) won[r.winner]++;
  return won;
}

export function createResim(ep: Episode, engine: PhysicsEngine, opts: ResimOptions): Resim {
  const index = indexEpisode(ep);
  const rules = opts.rules;
  const cfg = rulesMatchConfig(ep);
  const ctrl = ep.steps.ctrl;
  const intents = ep.steps.intents;
  const muts = ep.steps.mutations;
  const cps = ep.steps.checkpoints;
  const timestamp = ep.columns.timestamp;
  // Joint positions recorded at every tick start (observation.state[0..5] is q as float32, 5.4): a per-tick check
  // between checkpoints, so a divergence late in a round is caught before the next reset hides it.
  const stateCols = { atlas: ep.columns["observation.state.atlas"] as Float32Array | undefined, blaze: ep.columns["observation.state.blaze"] as Float32Array | undefined };

  let segIdx = -1;
  let seg: SegmentInfo | null = null;
  let s = 0;
  let stepsDone = 0;
  let ctrlPtr = -1, intentPtr = -1, mutPtr = 0, cpPtr = 0, opPtr = 0, evPtr = 0;
  let failure: ResimFailure | null = null;
  const lastRevision: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const stepIntents = EMPTY_INTENTS();
  const out: GameEvent[] = [];
  const placements: CoreMutationRequest[] = [];
  const targets = new Float64Array(6);

  const frameOfStep = (x: number) => (seg ? seg.firstTick + Math.floor((x - seg.resetStep) / index.spt) : 0);
  const timeOfFrame = (f: number) => (f >= 0 && f < timestamp.length ? timestamp[f] : Number.NaN);

  function fail(kind: ResimFailure["kind"], x: number, message: string, eventMismatch: string | null = null): void {
    if (failure) return;
    const frame = frameOfStep(x);
    failure = { kind, frame, t: timeOfFrame(frame), message, eventMismatch };
  }

  function applyOps(x: number): void {
    if (!seg || !rules) return;
    while (opPtr < seg.ops.length && seg.ops[opPtr].step <= x) {
      const op = seg.ops[opPtr++];
      if (op.kind === "live") rules.setLive(op.on);
      else if (op.kind === "protected") rules.setProtected(op.seat, op.on);
      else {
        const carry = { integrity: { atlas: rules.state.seats.atlas.integrity, blaze: rules.state.seats.blaze.integrity } };
        rules.reset(rulesConfigFor(cfg, roundsWonBefore(ep, op.round), true), op.round, true, carry);
        rules.setLive(false);
      }
    }
  }

  const resim: Resim = {
    index,
    get segment() { return segIdx; },
    get segmentStep() { return s; },
    get stepsDone() { return stepsDone; },
    get failure() { return failure; },
    get segmentDone() { return !seg || s >= seg.steps; },
    get tickStart() { return seg && s < seg.steps && s % index.spt === 0 ? seg.firstTick + s / index.spt : -1; },

    beginSegment(k: number): void {
      const next = index.segments[k];
      if (!next) throw new ResimError(`no segment ${k}`);
      segIdx = k; seg = next; s = 0;
      ctrlPtr = next.ctrlIndex - 1; intentPtr = next.intentsIndex - 1;
      mutPtr = next.mutationIndex + 1;
      cpPtr = next.checkpointIndex;
      opPtr = 0;
      const reset = next.reset;
      if (rules) {
        rules.reset({ ...rulesConfigFor(cfg, roundsWonBefore(ep, next.round), false), ...showRulesFromMeta(ep.meta.rules, next.round) }, next.round, false, null);
        rules.setLive(false);
        for (const seat of SEATS) rules.setProtected(seat, false);
      }
      const home = { atlas: reset.state.ctrl.slice(0, 6), blaze: reset.state.ctrl.slice(6, 12) };
      engine.reset({
        mode: ep.meta.physics, timestep: ep.meta.timestep, seed: reset.seed,
        loadouts: { atlas: ep.meta.seats.atlas.loadout, blaze: ep.meta.seats.blaze.loadout }, homePose: home, layout: "duel",
      });
      engine.restoreState(reset.state, "both");
      if (rules) for (const seat of SEATS) lastRevision[seat] = rules.profileRevision(seat);
    },

    step(): boolean {
      if (!seg || s >= seg.steps) return false;
      const x = seg.resetStep + s;

      if (opts.check) {
        while (cpPtr < seg.checkpointEnd && cps[cpPtr].step < x) cpPtr++;
        while (cpPtr < seg.checkpointEnd && cps[cpPtr].step === x && s % index.spt === 0) {
          const cp = cps[cpPtr++];
          const sum = engine.checksum();
          if (sum !== cp.checksum) fail("checksum", x, `checksum ${sum >>> 0} != recorded ${cp.checksum >>> 0}`);
        }
      }
      if (opts.check && s % index.spt === 0) {
        const row = seg.firstTick + s / index.spt;
        if (row < seg.endTick) {
          for (const seat of SEATS) {
            const col = stateCols[seat];
            if (!col) continue;
            const q = engine.frame.arms[seat].q;
            for (let j = 0; j < 6; j++) {
              const got = Math.fround(q[j]);
              const want = col[row * 12 + j];
              if (got !== want && !(got !== got && want !== want)) {
                fail("state", x, `${seat} ${j === 5 ? "gripper" : `joint ${j}`} is ${got} where the recording has ${want}`);
                break;
              }
            }
          }
        }
      }
      applyOps(x);

      // Core placements: recorded mutations drive physics; the regenerated rules must ask for the same ones.
      placements.length = 0;
      const requested = rules ? rules.requestPlacements(placements) : 0;
      let recordedPlacements = 0;
      while (mutPtr < seg.mutationEnd && muts[mutPtr].step < x) mutPtr++;
      const mutStart = mutPtr;
      while (mutPtr < seg.mutationEnd && muts[mutPtr].step === x) {
        const m = muts[mutPtr++];
        if (m.kind !== "place_cube") continue;
        engine.placeCube(m.index, m.pos);
        if (opts.check && rules) {
          const p = placements[recordedPlacements];
          if (!p || p.cube !== m.index || canonicalJson(p.pos) !== canonicalJson(m.pos)) {
            fail("mutation", x, `Core placement differs at step ${x}`, `place_cube ${m.index} ${canonicalJson(m.pos)} vs ${p ? `${p.cube} ${canonicalJson(p.pos)}` : "none"}`);
          }
        }
        recordedPlacements++;
      }
      if (opts.check && rules && requested !== recordedPlacements) {
        fail("mutation", x, `rules requested ${requested} placements, recording has ${recordedPlacements}`, `placements at step ${x}`);
      }

      // Servo profiles from the regenerated rules, checked against the recorded profile mutations.
      if (rules) {
        for (const seat of SEATS) {
          const rev = rules.profileRevision(seat);
          if (rev === lastRevision[seat]) continue;
          lastRevision[seat] = rev;
          const profile = rules.servoProfile(seat);
          engine.applyServoProfile(seat, profile);
          if (!opts.check) continue;
          const expectKind = ep.meta.physics === "harness" ? (profile.tauScale === 0 ? "offline" : null) : "servo_profile";
          if (!expectKind) continue;
          let found = false;
          for (let i = mutStart; i < mutPtr; i++) {
            const m = muts[i];
            if (m.kind === expectKind && m.seat === seat) { found = true; break; }
          }
          if (!found) fail("mutation", x, `${seat} servo profile changed at step ${x} but the recording has no ${expectKind}`, `${expectKind} ${seat}`);
        }
      }

      // Recorded per-step ctrl and intents.
      let moved = false;
      while (ctrlPtr + 1 < seg.ctrlEnd && ctrl.steps[ctrlPtr + 1] <= x) { ctrlPtr++; moved = true; }
      if (moved) {
        const o = ctrlPtr * ctrl.width;
        for (let si = 0; si < 2; si++) {
          for (let j = 0; j < 6; j++) targets[j] = ctrl.values[o + si * 6 + j];
          engine.setTargets(SEATS[si], targets);
        }
      }
      while (intentPtr + 1 < seg.intentsEnd && intents.steps[intentPtr + 1] <= x) intentPtr++;
      if (intentPtr >= seg.intentsIndex) {
        const o = intentPtr * intents.width;
        writeIntents(intents.values[o], stepIntents.atlas);
        writeIntents(intents.values[o + 1], stepIntents.blaze);
      } else {
        writeIntents(0, stepIntents.atlas);
        writeIntents(0, stepIntents.blaze);
      }

      engine.step();
      if (rules) {
        out.length = 0;
        rules.step({ frame: engine.frame, intents: stepIntents }, out);
        if (opts.check) {
          for (const e of out) {
            if (NON_RULES_EVENTS.has(e.type)) continue;
            const rec = index.rulesEvents[evPtr++];
            if (!rec) { fail("event", x, `extra ${e.type} event at step ${e.step}`, `unexpected ${describeEvent(e)}`); break; }
            const a = canonicalJson(e);
            const b = canonicalJson(rec);
            if (a !== b) { fail("event", x, `${e.type} event differs at step ${e.step}`, `recorded ${describeEvent(rec)} · regenerated ${describeEvent(e)}`); break; }
          }
        }
      }
      s++;
      stepsDone++;
      return true;
    },

    finish(): ResimFailure | null {
      if (!failure && opts.check && rules && evPtr < index.rulesEvents.length) {
        const rec = index.rulesEvents[evPtr];
        const last = index.segments[index.segments.length - 1];
        const frame = last ? last.endTick - 1 : 0;
        failure = { kind: "event", frame, t: timeOfFrame(frame), message: `${index.rulesEvents.length - evPtr} recorded events were not regenerated`, eventMismatch: `missing ${describeEvent(rec)}` };
      }
      return failure;
    },
  };
  return resim;
}

/* ───────────────────────── verify ───────────────────────── */

export interface VerifyDeps {
  createEngine: CreatePhysicsEngine;
  createRules: CreateCombatRules;
  /** Passed to createEngine in Node. */
  nodeFsRoot?: string;
}

const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const nowMs = () => globalThis.performance?.now() ?? Date.now();

export function formatDivergence(frame: number, t: number): string {
  return `DIVERGED AT t = ${Number.isFinite(t) ? t.toFixed(2) : "?"} s (frame ${frame})`;
}

export const VERIFIED_MESSAGE = "REPLAY VERIFIED · BIT-EXACT";

function errorResult(message: string): VerifyResult {
  return { verdict: "error", divergedFrame: null, divergedT: null, eventMismatch: null, checkedFrames: 0, message };
}

/** Re-simulates on the given engine and rules. Yields to the event loop every ~8 ms so a page stays responsive. */
export async function resimulate(ep: Episode, engine: PhysicsEngine, rules: CombatRules, onProgress: (f: number) => void, signal?: AbortSignal): Promise<VerifyResult> {
  let resim: Resim;
  try {
    resim = createResim(ep, engine, { rules, check: true });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message.toUpperCase() : String(err));
  }
  const prov = ep.meta.provenance;
  if (prov.modelSha256 && engine.info.modelSha256 && prov.modelSha256 !== engine.info.modelSha256) {
    return errorResult(`MODEL CHANGED · recorded ${prov.modelSha256.slice(0, 12)}, loaded ${engine.info.modelSha256.slice(0, 12)}`);
  }
  if (prov.mujoco && engine.info.mujocoVersion && prov.mujoco !== engine.info.mujocoVersion) {
    return errorResult(`MUJOCO ${engine.info.mujocoVersion} CANNOT VERIFY A ${prov.mujoco} EPISODE`);
  }
  const total = Math.max(1, resim.index.totalSteps);
  let sliceStart = nowMs();
  onProgress(0);
  for (let k = 0; k < resim.index.segments.length; k++) {
    resim.beginSegment(k);
    while (resim.step()) {
      if (resim.failure) break;
      if ((resim.stepsDone & 255) === 0 && nowMs() - sliceStart > 8) {
        onProgress(resim.stepsDone / total);
        await yieldToLoop();
        if (signal?.aborted) return errorResult("VERIFY CANCELLED");
        sliceStart = nowMs();
      }
    }
    if (resim.failure) break;
  }
  const failure = resim.finish();
  onProgress(1);
  if (failure) {
    return {
      verdict: "diverged", divergedFrame: failure.frame, divergedT: failure.t, eventMismatch: failure.eventMismatch,
      checkedFrames: failure.frame, message: `${formatDivergence(failure.frame, failure.t)} · ${failure.message}`,
    };
  }
  return { verdict: "bit_exact", divergedFrame: null, divergedT: null, eventMismatch: null, checkedFrames: resim.index.rows, message: VERIFIED_MESSAGE };
}

/** Verify on a fresh engine and rules, so the live game is never touched. */
export async function verifyEpisode(ep: Episode, deps: VerifyDeps, onProgress: (f: number) => void = () => {}, signal?: AbortSignal): Promise<VerifyResult> {
  let engine: PhysicsEngine | null = null;
  try {
    engine = await deps.createEngine({ mode: ep.meta.physics, nodeFsRoot: deps.nodeFsRoot });
    const rules = deps.createRules(engine.info);
    if (!rules) return errorResult("RULES UNAVAILABLE");
    return await resimulate(ep, engine, rules, onProgress, signal);
  } catch (err) {
    return errorResult(`VERIFY FAILED · ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    engine?.dispose();
  }
}

/** Replaces a VerifyResult's verdict into an episode result (stats and verdicts read it). */
export function withDeterminism(ep: Episode, v: VerifyResult): Episode {
  if (v.verdict === "error") return ep;
  return { ...ep, meta: { ...ep.meta, result: { ...ep.meta.result, determinism: v.verdict } } };
}

/* ───────────────────────── policy determinism ───────────────────────── */

export interface PolicyDeterminismDeps {
  createEngine: CreatePhysicsEngine;
  createRules: CreateCombatRules;
  createSeatDriver: CreateSeatDriver | CreateInProcessSeatDriver;
  observations: ObservationBuilder;
  nodeFsRoot?: string;
}

/** Observations fed per run (5.6: the registration check uses 200 acts). */
export const DETERMINISM_ACTS = 200;
/** Seed both runs reset with. */
export const DETERMINISM_SEED = 0x7e57_5eed;
const DETERMINISM_CONTROL_HZ: ControlHz = 50;
const DETERMINISM_TIMESTEP = 0.005;
/** Guard pose the probe sweep oscillates around (rad). */
const PROBE_CENTER = [0, -0.62, 1.08, -0.48, 0, GRIP_OPEN] as const;
const PROBE_AMPLITUDE = [0.9, 0.5, 0.5, 0.6, 1.2, 0.5] as const;

function cloneObservation(o: Observation): Observation {
  const blocks = {} as Observation["blocks"];
  for (const k of Object.keys(o.blocks) as (keyof Observation["blocks"])[]) blocks[k] = o.blocks[k].slice();
  const plain = JSON.parse(JSON.stringify({ ...o, blocks: null })) as Observation;
  plain.blocks = blocks;
  return plain;
}

/**
 * A deterministic, physically real observation stream: both arms sweep through reach, extension, and wrist roll
 * on the stock (harness) model while the opponent seat mirrors with a phase offset, so the stream crosses contact.
 */
export async function buildProbeObservations(deps: PolicyDeterminismDeps, seat: Seat, count = DETERMINISM_ACTS): Promise<{ observations: Observation[]; modelInfo: PhysicsEngine["info"] }> {
  const engine = await deps.createEngine({ mode: "harness", nodeFsRoot: deps.nodeFsRoot });
  try {
    const rules = deps.createRules(engine.info);
    const home = Float64Array.from(PROBE_CENTER);
    engine.reset({ mode: "harness", timestep: DETERMINISM_TIMESTEP, seed: DETERMINISM_SEED, loadouts: { atlas: "pivot", blaze: "pivot" }, homePose: { atlas: home, blaze: home }, layout: "duel" });
    rules.reset({
      preset: "harness", roundLengthS: 45, suddenDeathLengthS: 20, loadouts: { atlas: "pivot", blaze: "pivot" },
      lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 12, coreDropAtS: 15,
    }, 1, false, null);
    rules.setLive(true);
    const spt = stepsPerControlTick(DETERMINISM_TIMESTEP, DETERMINISM_CONTROL_HZ);
    const targets = new Float64Array(6);
    const applied = new Float64Array(6);
    const noIntents = EMPTY_INTENTS();
    const events: GameEvent[] = [];
    const observations: Observation[] = [];
    for (let tick = 0; tick < count; tick++) {
      const t = tick / DETERMINISM_CONTROL_HZ;
      observations.push(cloneObservation(deps.observations.build(
        seat, engine.frame, rules.state,
        { round: 1, bestOf: 3, phase: "fight", phaseLengthS: 45, roundsWon: { atlas: 0, blaze: 0 } },
        applied, { late_steps: 0, clamped_steps: 0, timeouts: 0 }, tick, tick, events,
      )));
      events.length = 0;
      for (let si = 0; si < 2; si++) {
        const phase = si === 0 ? 0 : 1.3;
        for (let j = 0; j < 6; j++) targets[j] = PROBE_CENTER[j] + PROBE_AMPLITUDE[j] * Math.sin(2 * Math.PI * (0.35 + 0.11 * j) * t + phase);
        engine.setTargets(SEATS[si], targets);
        if (SEATS[si] === seat) applied.set(targets);
      }
      for (let k = 0; k < spt; k++) {
        engine.step();
        rules.step({ frame: engine.frame, intents: noIntents }, events);
      }
    }
    return { observations, modelInfo: engine.info };
  } finally {
    engine.dispose();
  }
}

function probeResetContext(seat: Seat, spec: DriverSpec): ResetContext {
  const ctx: ResetContext = {
    schema: OBS_SCHEMA, protocol: "torquelimit.policy/3", obs_schema_hash: "",
    side: seat, seed: DETERMINISM_SEED, episode_id: "determinism-probe", round: 1,
    control_hz: DETERMINISM_CONTROL_HZ, decision_hz: DETERMINISM_CONTROL_HZ, action_delay_ticks: 0, fair_delay_ms: 0,
    mode: "eval", preset: "harness", physics: "harness", strict_limits: false,
    joint_names: JOINT_NAMES, joint_limits: JOINT_LIMITS,
    home_pose: Array.from(PROBE_CENTER),
    arena: { opponent_base: [0.64, 0, 0], midline_x: 0.32, dock_self: [0.32 + DOCK_CENTER_X.atlas, 0, 0], dock_opponent: [0.32 + DOCK_CENTER_X.blaze, 0, 0], dock_radius: DOCK_RADIUS },
    rules: { round_length: 45, best_of: 3, integrity_max: 100, loadout: null, scoring: "physical" },
  };
  if (spec.kind === "builtin") ctx.config = { personality: spec.personality, tier: spec.tier, dda: false };
  return ctx;
}

function actionFingerprint(a: PolicyAction | undefined): string {
  if (!a) return "null";
  return canonicalJson({ targets: a.targets, intents: a.intents ?? null, chunk: a.chunk ?? null, chunkHz: a.chunkHz ?? null, chunkStartT: a.chunkStartT ?? null, intentChunk: a.intentChunk ?? null });
}

/**
 * CHECK POLICY DETERMINISM (5.6): the same observation stream twice from the same seed, every returned number
 * compared exactly. Human and proxy seats have no policy and report false.
 */
export async function checkPolicyDeterminism(spec: DriverSpec, seat: Seat, deps: PolicyDeterminismDeps): Promise<boolean> {
  if (spec.kind === "human" || spec.kind === "proxy") return false;
  const { observations } = await buildProbeObservations(deps, seat);
  const runs: string[][] = [];
  for (let run = 0; run < 2; run++) {
    const create = deps.createSeatDriver as CreateInProcessSeatDriver;
    const driver = await create(spec, seat, { modulePath: spec.kind === "module" ? spec.fileName : undefined });
    const out: string[] = [];
    try {
      await driver.reset(probeResetContext(seat, spec));
      for (let i = 0; i < observations.length; i++) {
        driver.request(observations[i], i);
        const result = await driver.waitForResult(30_000);
        out.push(result.status === "error" ? `error:${result.error ?? ""}` : actionFingerprint(result.action));
      }
    } finally {
      driver.dispose();
    }
    runs.push(out);
  }
  const [a, b] = runs;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Tick-start SimState copies are what the replay player caches; shared helper. */
export function copySimState(src: SimState, dst?: SimState): SimState {
  if (!dst || dst.qpos.length !== src.qpos.length || dst.qvel.length !== src.qvel.length || dst.servo.length !== src.servo.length) {
    return { time: src.time, qpos: src.qpos.slice(), qvel: src.qvel.slice(), ctrl: src.ctrl.slice(), qacc_warmstart: src.qacc_warmstart.slice(), servo: src.servo.slice() };
  }
  dst.time = src.time;
  dst.qpos.set(src.qpos); dst.qvel.set(src.qvel); dst.ctrl.set(src.ctrl); dst.qacc_warmstart.set(src.qacc_warmstart); dst.servo.set(src.servo);
  return dst;
}
