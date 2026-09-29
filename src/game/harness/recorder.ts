// src/game/harness/recorder.ts (WP5)
// Records every column and per-step stream of GAME_DESIGN 5.8 (as adjusted by BUILD_PLAN D5 and D8).
// Rows go into fixed 30 s chunks, so a match never copies what it already recorded and a tick costs a
// handful of typed-array sets. Per-step ctrl and intents are run-length encoded. Round segments are
// written to the sparse column `sim.segments` so re-simulation can find each round's steps without
// assuming anything about how the engine numbers steps across resets.
// Episode /4 (EMOTION_BIBLE 9): raw input, command-before-life, active and gaze columns per pilot seat, `dda.k` per
// seat (tracked from `dda` events, so the sim writes nothing new), and `meta.rounds` (task string, physics, outcome,
// segments) built at end() from the segment marks, the result and the events. The session block and opponent memory
// arrive through annotate(); nobody but WP8 writes those fields.

import {
  EPISODE_FORMAT, MATCH_PHASES, OBS_BLOCKS, SEATS, ACTION_STATUS_CODE,
  type Episode, type EpisodeMeta, type GameEvent, type MatchResultRecord, type ObsBlockName, type PhysicsFrame,
  type Recorder, type RoundMeta, type RoundSegment, type Seat, type SimMutation, type SimState, type TickRecord,
} from "../contracts.ts";
import type { TypedColumn } from "./typed-b64.ts";

/** Sparse column holding one SegmentMark per engine reset (one per round in a normal match). */
export const SEGMENTS_COLUMN = "sim.segments";
/** Sparse values larger than this (JSON bytes) are replaced by a truncation marker (5.7: info ≤ 4 KB per step). */
export const SPARSE_VALUE_CAP_BYTES = 4096;
/** Row storage grows in chunks of this many seconds of control ticks (11.4 WP5). */
export const CHUNK_SECONDS = 30;

export const OBS_BLOCK_NAMES = Object.keys(OBS_BLOCKS) as ObsBlockName[];
export const PHASE_CODE: Readonly<Record<string, number>> = Object.fromEntries(MATCH_PHASES.map((p, i) => [p, i]));

/** Where one round's data starts in each stream. `steps` and `lastStep` are filled when the segment closes. */
export interface SegmentMark {
  round: number;
  seed: number;
  /** frame.step at the reset (the index of the first physics step of the segment). */
  resetStep: number;
  /** Row (control tick) that the segment's first tick writes. */
  firstTick: number;
  ctrlIndex: number;
  intentsIndex: number;
  checkpointIndex: number;
  mutationIndex: number;
  /** Physics steps recorded in the segment (stepCtrl calls). */
  steps: number;
  /** frame.step of the last recorded step, −1 when none. */
  lastStep: number;
}

type Ctor = { new (n: number): TypedColumn; readonly BYTES_PER_ELEMENT: number };

class ChunkedColumn {
  readonly chunks: TypedColumn[] = [];
  readonly name: string;
  readonly ctor: Ctor;
  readonly width: number;
  readonly fill: number;
  readonly chunkRows: number;
  readonly shape: number[];
  constructor(name: string, ctor: Ctor, width: number, fill: number, chunkRows: number, shape: number[]) {
    this.name = name; this.ctor = ctor; this.width = width; this.fill = fill; this.chunkRows = chunkRows; this.shape = shape;
  }

  /** Makes sure chunk `c` exists (earlier missing chunks are created filled). */
  chunk(c: number): TypedColumn {
    while (this.chunks.length <= c) {
      const arr = new this.ctor(this.chunkRows * this.width);
      if (this.fill !== 0) arr.fill(this.fill);
      this.chunks.push(arr);
    }
    return this.chunks[c];
  }

  /** Contiguous copy of the first `rows` rows. */
  collect(rows: number): TypedColumn {
    const out = new this.ctor(rows * this.width);
    if (this.fill !== 0) out.fill(this.fill);
    let o = 0;
    for (const ch of this.chunks) {
      const n = Math.min(ch.length, out.length - o);
      if (n <= 0) break;
      out.set(ch.subarray(0, n), o);
      o += n;
    }
    return out;
  }
}

/** Growable append-only typed buffer (RLE streams). */
class GrowBuffer {
  data: TypedColumn;
  length = 0;
  private readonly ctor: Ctor;
  constructor(ctor: Ctor, initial: number) { this.ctor = ctor; this.data = new ctor(initial); }
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    const next = new this.ctor(Math.max(this.data.length * 2, this.length + n));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  collect(): TypedColumn { return this.data.slice(0, this.length); }
}

interface SeatColumns {
  obs: Record<ObsBlockName, ChunkedColumn>;
  delivered: Record<ObsBlockName, ChunkedColumn> | null;
  action: ChunkedColumn;
  intents: ChunkedColumn;
  policy: {
    raw: ChunkedColumn; requestFrame: ChunkedColumn; obsFrame: ChunkedColumn; chunkId: ChunkedColumn;
    chunkIndex: ChunkedColumn; status: ChunkedColumn; computeMs: ChunkedColumn;
  } | null;
  human: { command: ChunkedColumn; shaping: ChunkedColumn; raw: ChunkedColumn; active: ChunkedColumn; gaze: ChunkedColumn } | null;
  ddaK: ChunkedColumn;
}

/** Width of `human.raw.<seat>` (9): mouse dx, dy, buttons, keys, left stick x/y, right stick x/y. */
export const HUMAN_RAW_WIDTH = 8;
export const GAZE_HINT_WIDTH = 2;

/** Task string a duel round carries (9); drills get theirs from annotate({ tasks }). */
export function duelTaskString(meta: EpisodeMeta, pilot: Seat): string {
  const opp = meta.seats[pilot === "atlas" ? "blaze" : "atlas"];
  const tier = opp.tier ? ` ${opp.tier.charAt(0).toUpperCase()}${opp.tier.slice(1)}` : "";
  return `duel vs ${opp.name}${tier} · ${meta.preset}`;
}

export function isPilotDriver(kind: string): boolean {
  return kind === "human" || kind === "proxy";
}

function cloneSimState(s: SimState): SimState {
  return { time: s.time, qpos: s.qpos.slice(), qvel: s.qvel.slice(), ctrl: s.ctrl.slice(), qacc_warmstart: s.qacc_warmstart.slice(), servo: s.servo.slice() };
}

function cloneMutation(m: SimMutation): SimMutation {
  switch (m.kind) {
    case "reset": return { kind: "reset", step: m.step, seed: m.seed, round: m.round, state: cloneSimState(m.state) };
    case "place_cube": return { kind: "place_cube", step: m.step, index: m.index, pos: m.pos ? [m.pos[0], m.pos[1], m.pos[2]] : null };
    case "servo_profile": return { kind: "servo_profile", step: m.step, seat: m.seat, kp: m.kp.slice(), kv: m.kv.slice(), forcerange: m.forcerange.slice() };
    case "timestep": return { kind: "timestep", step: m.step, dt: m.dt };
    case "offline": return { kind: "offline", step: m.step, seat: m.seat };
    case "geom_friction": return { kind: "geom_friction", step: m.step, geom: m.geom, friction: [m.friction[0], m.friction[1], m.friction[2]] };
    case "object_variant": return { kind: "object_variant", step: m.step, core: m.core, cubes: m.cubes };
  }
}

/** One-level copy of an event: producers reuse arrays (pos, normal) and objects (roundsWon). */
export function cloneEvent(e: GameEvent): GameEvent {
  const out = { ...e } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (Array.isArray(v)) out[k] = v.slice();
    else if (v && typeof v === "object") out[k] = { ...(v as Record<string, unknown>) };
  }
  return out as unknown as GameEvent;
}

function cloneSparse(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { truncated: true, reason: "unserializable" };
  }
  if (json === undefined) return null;
  if (json.length > SPARSE_VALUE_CAP_BYTES) return { truncated: true, bytes: json.length };
  return JSON.parse(json) as unknown;
}

const nanEq = (a: number, b: number) => a === b ? (a !== 0 || 1 / a === 1 / b) : (a !== a && b !== b);

export function createRecorder(): Recorder {
  let meta: EpisodeMeta | null = null;
  let chunkRows = 1500;
  let rows = 0;
  let columns: ChunkedColumn[] = [];
  let base: { timestamp: ChunkedColumn; frameIndex: ChunkedColumn; episodeIndex: ChunkedColumn; index: ChunkedColumn; round: ChunkedColumn; phase: ChunkedColumn; discontinuity: ChunkedColumn; displayLatency: ChunkedColumn | null } | null = null;
  let seatCols: Record<Seat, SeatColumns> | null = null;

  const ctrlSteps = new GrowBuffer(Uint32Array, 4096);
  const ctrlValues = new GrowBuffer(Float64Array, 4096 * 12);
  const intentSteps = new GrowBuffer(Uint32Array, 1024);
  const intentValues = new GrowBuffer(Uint8Array, 2048);
  const lastCtrl = new Float64Array(12);
  const lastIntents = new Uint8Array(2);
  let forceStep = true;

  let mutations: SimMutation[] = [];
  let checkpoints: { step: number; state: SimState; checksum: number }[] = [];
  let events: GameEvent[] = [];
  let sparse: Record<string, { frame_index: number; value: unknown }[]> = {};
  let segments: SegmentMark[] = [];
  const ddaK: Record<Seat, number> = { atlas: Number.NaN, blaze: Number.NaN };
  let extra: { session?: EpisodeMeta["session"]; opponentMemory?: EpisodeMeta["opponentMemory"]; tasks: Record<number, string> } = { tasks: {} };

  function column(name: string, ctor: Ctor, width: number, fill: number, shape: number[]): ChunkedColumn {
    const c = new ChunkedColumn(name, ctor, width, fill, chunkRows, shape);
    columns.push(c);
    return c;
  }

  function obsColumns(prefix: string, seat: Seat): Record<ObsBlockName, ChunkedColumn> {
    const out = {} as Record<ObsBlockName, ChunkedColumn>;
    for (const b of OBS_BLOCK_NAMES) out[b] = column(`${prefix}.${b}.${seat}`, Float32Array, OBS_BLOCKS[b], Number.NaN, [OBS_BLOCKS[b]]);
    return out;
  }

  const recorder: Recorder = {
    get recording() { return meta !== null; },

    begin(m: EpisodeMeta): void {
      meta = { ...m, format: EPISODE_FORMAT };
      chunkRows = Math.max(1, Math.round(CHUNK_SECONDS * m.controlHz));
      rows = 0;
      columns = [];
      ctrlSteps.length = 0; ctrlValues.length = 0; intentSteps.length = 0; intentValues.length = 0;
      lastCtrl.fill(0); lastIntents.fill(0); forceStep = true;
      mutations = []; checkpoints = []; events = []; sparse = {}; segments = [];
      ddaK.atlas = Number.NaN; ddaK.blaze = Number.NaN; extra = { tasks: {} };
      const anyPilot = SEATS.some((s) => isPilotDriver(m.seats[s].driver));
      base = {
        timestamp: column("timestamp", Float64Array, 1, 0, []),
        frameIndex: column("frame_index", Uint32Array, 1, 0, []),
        episodeIndex: column("episode_index", Uint32Array, 1, 0, []),
        index: column("index", Uint32Array, 1, 0, []),
        round: column("round", Uint8Array, 1, 0, []),
        phase: column("phase", Uint8Array, 1, 0, []),
        discontinuity: column("discontinuity", Uint8Array, 1, 0, []),
        displayLatency: anyPilot ? column("human.display_latency_ms", Float32Array, 1, Number.NaN, []) : null,
      };
      const cols = {} as Record<Seat, SeatColumns>;
      for (const s of SEATS) {
        const pilot = isPilotDriver(m.seats[s].driver);
        cols[s] = {
          obs: obsColumns("observation", s),
          delivered: null,
          action: column(`action.${s}`, Float64Array, 6, Number.NaN, [6]),
          intents: column(`intents.${s}`, Uint8Array, 1, 0, []),
          policy: pilot ? null : {
            raw: column(`action_raw.${s}`, Float64Array, 6, Number.NaN, [6]),
            requestFrame: column(`policy.request_frame_index.${s}`, Int32Array, 1, -1, []),
            obsFrame: column(`policy.obs_frame_index.${s}`, Int32Array, 1, -1, []),
            chunkId: column(`policy.chunk_id.${s}`, Int32Array, 1, -1, []),
            chunkIndex: column(`policy.chunk_index.${s}`, Int16Array, 1, -1, []),
            status: column(`policy.status.${s}`, Uint8Array, 1, 0, []),
            computeMs: column(`policy.compute_ms.${s}`, Float32Array, 1, Number.NaN, []),
          },
          human: pilot ? {
            command: column(`human.command.${s}`, Float32Array, 6, Number.NaN, [6]),
            shaping: column(`human.shaping.${s}`, Uint8Array, 1, 0, []),
            raw: column(`human.raw.${s}`, Float32Array, HUMAN_RAW_WIDTH, Number.NaN, [HUMAN_RAW_WIDTH]),
            active: column(`human.active.${s}`, Uint8Array, 1, 0, []),
            gaze: column(`human.gaze_hint.${s}`, Float32Array, GAZE_HINT_WIDTH, Number.NaN, [GAZE_HINT_WIDTH]),
          } : null,
          ddaK: column(`dda.k.${s}`, Float32Array, 1, Number.NaN, []),
        };
      }
      seatCols = cols;
    },

    tick(rec: TickRecord): void {
      if (!meta || !base || !seatCols) return;
      const r = rows;
      const c = Math.floor(r / chunkRows);
      const at = r - c * chunkRows;
      base.timestamp.chunk(c)[at] = rec.t;
      base.frameIndex.chunk(c)[at] = rec.frameIndex;
      base.episodeIndex.chunk(c);
      base.index.chunk(c)[at] = rec.frameIndex;
      base.round.chunk(c)[at] = rec.round;
      base.phase.chunk(c)[at] = PHASE_CODE[rec.phase] ?? 255;
      base.discontinuity.chunk(c)[at] = rec.discontinuity;
      if (base.displayLatency) base.displayLatency.chunk(c)[at] = rec.displayLatencyMs;

      for (const s of SEATS) {
        const sc = seatCols[s];
        const obs = rec.obs[s];
        for (const b of OBS_BLOCK_NAMES) {
          const src = obs?.[b];
          const w = OBS_BLOCKS[b];
          if (src) sc.obs[b].chunk(c).set(src.length === w ? src : src.subarray(0, w), at * w);
          else sc.obs[b].chunk(c);
        }
        const del = rec.delivered[s];
        if (del) {
          if (!sc.delivered) sc.delivered = obsColumns("observation.delivered", s);
          for (const b of OBS_BLOCK_NAMES) {
            const w = OBS_BLOCKS[b];
            const src = del[b];
            if (src) sc.delivered[b].chunk(c).set(src.length === w ? src : src.subarray(0, w), at * w);
            else sc.delivered[b].chunk(c);
          }
        } else if (sc.delivered) {
          for (const b of OBS_BLOCK_NAMES) sc.delivered[b].chunk(c);
        }
        sc.action.chunk(c).set(rec.applied[s], at * 6);
        sc.intents.chunk(c)[at] = rec.intents[s];
        if (sc.policy) {
          const p = sc.policy;
          const raw = rec.raw[s];
          if (raw) p.raw.chunk(c).set(raw, at * 6); else p.raw.chunk(c);
          p.requestFrame.chunk(c)[at] = rec.requestFrameIndex[s];
          p.obsFrame.chunk(c)[at] = rec.obsFrameIndex[s];
          p.chunkId.chunk(c)[at] = rec.chunkId[s];
          p.chunkIndex.chunk(c)[at] = rec.chunkIndex[s];
          p.status.chunk(c)[at] = ACTION_STATUS_CODE[rec.status[s]] ?? ACTION_STATUS_CODE.error;
          p.computeMs.chunk(c)[at] = rec.computeMs[s];
        }
        if (sc.human) {
          const h = rec.human[s];
          if (h) {
            sc.human.command.chunk(c).set(h.command, at * 6);
            sc.human.shaping.chunk(c)[at] = h.shaping;
            if (h.raw) sc.human.raw.chunk(c).set(h.raw.length === HUMAN_RAW_WIDTH ? h.raw : h.raw.subarray(0, HUMAN_RAW_WIDTH), at * HUMAN_RAW_WIDTH); else sc.human.raw.chunk(c);
            sc.human.active.chunk(c)[at] = h.active === undefined ? (h.raw ? (h.raw[0] !== 0 || h.raw[1] !== 0 || h.raw[2] !== 0 || h.raw[3] !== 0 ? 1 : 0) : 0) : h.active & 0xff;
            if (h.gazeHint) sc.human.gaze.chunk(c).set(h.gazeHint.subarray(0, GAZE_HINT_WIDTH), at * GAZE_HINT_WIDTH); else sc.human.gaze.chunk(c);
          } else {
            sc.human.command.chunk(c); sc.human.shaping.chunk(c); sc.human.raw.chunk(c); sc.human.active.chunk(c); sc.human.gaze.chunk(c);
          }
        }
        sc.ddaK.chunk(c)[at] = ddaK[s];
      }
      rows = r + 1;
    },

    stepCtrl(step: number, frame: PhysicsFrame, intents: Record<Seat, number>): void {
      if (!meta) return;
      const a = frame.arms.atlas.ctrl;
      const b = frame.arms.blaze.ctrl;
      let changed = forceStep;
      if (!changed) {
        for (let j = 0; j < 6; j++) {
          if (!nanEq(a[j], lastCtrl[j]) || !nanEq(b[j], lastCtrl[6 + j])) { changed = true; break; }
        }
      }
      if (changed) {
        for (let j = 0; j < 6; j++) { lastCtrl[j] = a[j]; lastCtrl[6 + j] = b[j]; }
        ctrlSteps.reserve(1); ctrlValues.reserve(12);
        ctrlSteps.data[ctrlSteps.length++] = step;
        ctrlValues.data.set(lastCtrl, ctrlValues.length);
        ctrlValues.length += 12;
      }
      const ia = intents.atlas & 0xff, ib = intents.blaze & 0xff;
      if (forceStep || ia !== lastIntents[0] || ib !== lastIntents[1]) {
        lastIntents[0] = ia; lastIntents[1] = ib;
        intentSteps.reserve(1); intentValues.reserve(2);
        intentSteps.data[intentSteps.length++] = step;
        intentValues.data[intentValues.length++] = ia;
        intentValues.data[intentValues.length++] = ib;
      }
      forceStep = false;
      const seg = segments[segments.length - 1];
      if (seg) { seg.steps++; seg.lastStep = step; }
    },

    mutation(m: SimMutation): void {
      if (!meta) return;
      if (m.kind === "reset") {
        segments.push({
          round: m.round, seed: m.seed, resetStep: m.step, firstTick: rows,
          ctrlIndex: ctrlSteps.length, intentsIndex: intentSteps.length,
          checkpointIndex: checkpoints.length, mutationIndex: mutations.length,
          steps: 0, lastStep: -1,
        });
        forceStep = true;
      }
      mutations.push(cloneMutation(m));
    },

    checkpoint(step: number, state: SimState, checksum: number): void {
      if (!meta) return;
      checkpoints.push({ step, state: cloneSimState(state), checksum });
    },

    events(evts: readonly GameEvent[]): void {
      if (!meta) return;
      for (let i = 0; i < evts.length; i++) {
        const e = evts[i];
        if (e.type === "dda") ddaK[e.seat] = e.k;
        events.push(cloneEvent(e));
      }
    },

    annotate(x): void {
      if (!meta) return;
      if (x.session) extra.session = { ...x.session, consent: { ...x.session.consent }, device: { ...x.session.device }, build: { ...x.session.build } };
      if (x.opponentMemory) extra.opponentMemory = { ...x.opponentMemory };
      if (x.tasks) for (const k of Object.keys(x.tasks)) extra.tasks[Number(k)] = x.tasks[Number(k)];
    },

    sparse(name: string, frameIndex: number, value: unknown): void {
      if (!meta) return;
      (sparse[name] ??= []).push({ frame_index: frameIndex, value: cloneSparse(value) });
    },

    end(result: MatchResultRecord): Episode {
      const m = meta;
      if (!m) throw new Error("recorder.end called before begin");
      const outColumns = {} as Episode["columns"];
      const shapes: Record<string, number[]> = {};
      for (const col of columns) {
        outColumns[col.name] = col.collect(rows);
        shapes[col.name] = col.shape;
      }
      const outSparse: Episode["sparse"] = { ...sparse };
      outSparse[SEGMENTS_COLUMN] = segments.map((s) => ({ frame_index: s.firstTick, value: { ...s } }));
      const rounds = buildRoundMeta(m, result, segments, events, outColumns, rows, extra.tasks);
      const ep: Episode = {
        meta: {
          ...m, format: EPISODE_FORMAT, result: { ...result, roundsWon: { ...result.roundsWon }, rounds: result.rounds.map((r) => ({ ...r })) },
          rounds, ...(extra.session ? { session: extra.session } : {}), ...(extra.opponentMemory ? { opponentMemory: extra.opponentMemory } : {}),
        },
        columns: outColumns,
        shapes,
        steps: {
          ctrl: { steps: ctrlSteps.collect() as Uint32Array, values: ctrlValues.collect() as Float64Array, width: 12 },
          intents: { steps: intentSteps.collect() as Uint32Array, values: intentValues.collect() as Uint8Array, width: 2 },
          mutations,
          checkpoints,
        },
        sparse: outSparse,
        events,
      };
      meta = null; base = null; seatCols = null; columns = [];
      mutations = []; checkpoints = []; events = []; sparse = {}; segments = []; extra = { tasks: {} };
      return ep;
    },
  };
  return recorder;
}

/* ───────────────────────── episode /4 round block ───────────────────────── */

const DUEL_PHASES = new Set(["fight", "sudden_death"].map((p) => PHASE_CODE[p]));

/**
 * meta.rounds (9): one entry per recorded segment. A drill round is one whose task was annotated (SYSTEMS CHECK);
 * its outcome is `success` when a `task_success` event fell inside it, `timeout` when the round ended by time and
 * `fail` otherwise. Duel rounds carry the generated task string and a null outcome. Segments come from the pilot's
 * recorded intents and Core state: a drill labels approach → grasp (grip held) → lift/transport (Core carried) →
 * place (docked) → retract; a duel labels carry / contest / guard / attack / idle from the same columns.
 */
export function buildRoundMeta(meta: EpisodeMeta, result: MatchResultRecord, segments: readonly SegmentMark[], events: readonly GameEvent[],
  columns: Episode["columns"], rows: number, tasks: Record<number, string>): RoundMeta[] {
  const pilot = SEATS.find((s) => isPilotDriver(meta.seats[s].driver)) ?? null;
  const phase = columns.phase as Uint8Array | undefined;
  const cols = pilot ? {
    phase, intents: columns[`intents.${pilot}`] as Uint8Array | undefined, game: columns[`observation.game.${pilot}`] as Float32Array | undefined,
    env: columns[`observation.environment_state.${pilot}`] as Float32Array | undefined, selfExt: columns[`observation.self_ext.${pilot}`] as Float32Array | undefined,
  } : { phase };
  const out: RoundMeta[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const endTick = i + 1 < segments.length ? segments[i + 1].firstTick : rows;
    const drill = tasks[seg.round] !== undefined;
    const task = drill ? tasks[seg.round] : pilot ? duelTaskString(meta, pilot) : `duel · ${meta.preset}`;
    const res = result.rounds.find((r) => r.round === seg.round);
    let outcome: RoundMeta["outcome"] = null;
    if (drill) {
      const success = events.some((e) => e.type === "task_success" && e.step >= seg.resetStep && (seg.lastStep < 0 || e.step <= seg.lastStep));
      outcome = success ? "success" : res?.reason === "time" ? "timeout" : "fail";
    }
    out.push({
      round: seg.round, task, physics: meta.physics, preset: meta.preset, outcome,
      durationS: meta.controlHz > 0 ? (endTick - seg.firstTick) / meta.controlHz : 0,
      segments: labelSegments(seg.firstTick, endTick, drill, cols),
    });
  }
  return out;
}

/**
 * Run-length labels over [firstTick, endTick) from the pilot's intents, the game block (core live g[8], own lock-in
 * g[6] > 0 while docked), the environment block (Core held_by = env[4·9+8]) and the EE speed (self_ext[7..9]).
 */
export function labelSegments(firstTick: number, endTick: number, drill: boolean, cols: {
  phase?: Uint8Array; intents?: Uint8Array; game?: Float32Array; env?: Float32Array; selfExt?: Float32Array;
}): RoundSegment[] {
  const out: RoundSegment[] = [];
  if (endTick <= firstTick) return out;
  const G = OBS_BLOCKS.game, E = OBS_BLOCKS.environment_state, S = OBS_BLOCKS.self_ext;
  const { phase, intents, game, env, selfExt } = cols;
  let current: RoundSegment | null = null;
  let placed = false;
  for (let r = firstTick; r < endTick; r++) {
    const live = !phase || DUEL_PHASES.has(phase[r]);
    const grip = intents ? (intents[r] & 4) !== 0 : false;                 // INTENT_BITS.grip
    const guard = intents ? (intents[r] & 1) !== 0 : false;                // INTENT_BITS.guard
    const coreLive = game ? game[r * G + 8] > 0.5 : false;
    const docked = game ? game[r * G + 6] > 0 : false;
    const held = env ? env[r * E + 4 * 9 + 8] > 0.5 : false;
    const speed = selfExt ? Math.hypot(selfExt[r * S + 7], selfExt[r * S + 8], selfExt[r * S + 9]) : 0;
    let label: RoundSegment["label"];
    if (drill) {
      if (!live) label = placed ? "recover" : "approach";
      else if (docked) { label = "place"; placed = true; }
      else if (held) label = speed > 0.1 ? "transport" : "lift";
      else if (grip && coreLive) label = "grasp";
      else label = placed ? "retract" : "approach";
    } else {
      if (!live) label = "idle";
      else if (held || docked) label = "carry";
      else if (guard) label = "guard";
      else if (coreLive && grip) label = "contest";
      else label = speed > 0.35 ? "attack" : "idle";
    }
    if (current && current.label === label) { current.endTick = r + 1; continue; }
    current = { label, firstTick: r, endTick: r + 1 };
    out.push(current);
  }
  return out;
}
