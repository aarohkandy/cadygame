// src/game/policy/chunk-executor.ts (WP4)
// Turns accepted policy actions into one target vector and intent bitfield per control tick (GAME_DESIGN 5.3).
//
// Chunk entries are indexed by SIM TIME, never by tick count: entry i of a chunk applies from
// chunkStartT + i / chunkHz, so a late arrival skips entries already in the past and a chunk at any rate is
// resampled to the control rate (nearest older entry). Execution modes:
//   until_next_decision  request on every decision tick; the rest of the chunk is discarded by the next arrival
//   full_chunk           no requests until the chunk's last entry has been applied
//   { nSteps: k }        request after k control ticks of the current action
// temporalEnsembleM (ACT): every chunk covering t contributes exp(−m·i), i = 0 for the oldest, to the targets.

import {
  INTENT_BITS,
  type ActionResult, type ChunkExecute, type ChunkExecutor, type ChunkSample, type ControlHz, type CreateChunkExecutor,
} from "../contracts.ts";
import { intentBitsOf } from "./action-validation.ts";

/** Guards float drift when a tick time lands exactly on an entry boundary. */
const TIME_EPS = 1e-6;
/** Ensemble chunks kept at most (older ones fall out of coverage long before this). */
const MAX_ENSEMBLE = 64;

interface Held {
  id: number;
  startT: number;
  hz: number;
  rows: readonly (readonly number[])[] | null;   // null: a plain action (targets only)
  targets: readonly number[];
  intentRows: readonly number[] | null;
  intents: number;
}

function toHeld(result: ActionResult, obsT: number, id: number): Held {
  const a = result.action;
  const chunk = a.chunk && a.chunk.length > 0 ? a.chunk : null;
  return {
    id,
    startT: a.chunkStartT ?? obsT,
    hz: a.chunkHz && a.chunkHz > 0 ? a.chunkHz : 0,
    rows: chunk,
    targets: a.targets,
    intentRows: chunk && a.intentChunk && a.intentChunk.length === chunk.length ? a.intentChunk : null,
    intents: intentBitsOf(a.intents),
  };
}

/** Entry index applying at time t: −1 before the chunk starts, clamped to the last entry after it ends. */
function indexAt(h: Held, t: number): number {
  if (!h.rows) return 0;
  const raw = Math.floor((t - h.startT) * h.hz + TIME_EPS);
  if (raw < 0) return -1;
  return raw >= h.rows.length ? h.rows.length - 1 : raw;
}

function endT(h: Held): number {
  return h.rows ? h.startT + (h.rows.length - 1) / h.hz : Number.POSITIVE_INFINITY;
}

export const createChunkExecutor: CreateChunkExecutor = (opts: { controlHz: ControlHz; chunkExecute: ChunkExecute; temporalEnsembleM: number | null }) => {
  const mode = opts.chunkExecute;
  const nSteps = typeof mode === "object" ? Math.max(1, Math.floor(mode.nSteps)) : 0;
  const ensembleM = opts.temporalEnsembleM !== null && Number.isFinite(opts.temporalEnsembleM) && opts.temporalEnsembleM >= 0 ? opts.temporalEnsembleM : null;

  let current: Held | null = null;
  let previous: Held | null = null;           // shown while a new chunk has not started yet
  const ensemble: Held[] = [];
  let nextId = 0;
  let samplesSinceAccept = 0;
  let lastIndex = -1;
  let consumed = true;
  let requestedSinceConsumed = false;
  const lastTargets = new Float64Array(6);
  let lastIntents = 0;
  let haveLast = false;

  function writeFrom(h: Held, i: number, out: ChunkSample): void {
    const row = h.rows ? h.rows[i] : h.targets;
    for (let j = 0; j < 6; j++) out.targets[j] = row[j];
    out.intents = h.rows && h.intentRows ? h.intentRows[i] : h.intents;
    out.chunkId = h.rows ? h.id : -1;
    out.chunkIndex = h.rows ? i : -1;
  }

  const exec: ChunkExecutor = {
    reset() {
      current = null; previous = null; ensemble.length = 0;
      nextId = 0; samplesSinceAccept = 0; lastIndex = -1; consumed = true; requestedSinceConsumed = false;
      lastIntents = 0; haveLast = false; lastTargets.fill(0);
    },

    accept(result: ActionResult, obsT: number) {
      if (!result.action || !Array.isArray(result.action.targets) || result.action.targets.length !== 6) return;
      const id = result.chunkId >= 0 ? result.chunkId : nextId;
      nextId = Math.max(nextId, id) + 1;
      previous = current;
      current = toHeld(result, obsT, id);
      samplesSinceAccept = 0;
      lastIndex = -1;
      consumed = false;
      requestedSinceConsumed = false;
      if (ensembleM !== null && current.rows) {
        ensemble.push(current);
        if (ensemble.length > MAX_ENSEMBLE) ensemble.shift();
      }
    },

    sample(t: number, out: ChunkSample) {
      if (!current) {
        if (!haveLast) return false;
        for (let j = 0; j < 6; j++) out.targets[j] = lastTargets[j];
        out.intents = lastIntents; out.chunkId = -1; out.chunkIndex = -1; out.exhausted = true;
        return true;
      }
      let i = indexAt(current, t);
      if (i < 0) {
        // The new chunk starts in the future: keep applying what was applying (or its first entry if nothing was).
        if (previous) {
          const pi = indexAt(previous, t);
          writeFrom(previous, pi < 0 ? 0 : pi, out);
        } else {
          writeFrom(current, 0, out);
        }
        i = -1;
      } else {
        writeFrom(current, i, out);
        lastIndex = i;
        if (ensembleM !== null && current.rows) blendEnsemble(t, out);
      }
      samplesSinceAccept++;
      if (current.rows) {
        if (mode === "full_chunk") consumed = lastIndex >= current.rows.length - 1;
        else if (nSteps > 0) consumed = samplesSinceAccept >= nSteps;
        else consumed = lastIndex >= current.rows.length - 1;
      } else {
        consumed = nSteps > 0 ? samplesSinceAccept >= nSteps : true;
      }
      out.exhausted = consumed;
      for (let j = 0; j < 6; j++) lastTargets[j] = out.targets[j];
      lastIntents = out.intents & ~INTENT_BITS.grip;
      out.intents = lastIntents;
      haveLast = true;
      return true;
    },

    wantsRequest(isDecisionTick: boolean) {
      if (!current) return isDecisionTick;
      if (mode === "until_next_decision") return isDecisionTick;
      // full_chunk / n_steps: silent until consumed; then ask once right away, and afterwards on decision ticks.
      if (!consumed) return false;
      if (!current.rows && nSteps === 0) return isDecisionTick;
      if (!requestedSinceConsumed) { requestedSinceConsumed = true; return true; }
      return isDecisionTick;
    },
  };

  function blendEnsemble(t: number, out: ChunkSample): void {
    const m = ensembleM as number;
    // Drop chunks that ended before t; they can never cover a later tick.
    while (ensemble.length > 0 && endT(ensemble[0]) + TIME_EPS < t && ensemble[0] !== current) ensemble.shift();
    let wsum = 0;
    const acc = [0, 0, 0, 0, 0, 0];
    let order = 0;
    for (const h of ensemble) {
      if (!h.rows) continue;
      const raw = Math.floor((t - h.startT) * h.hz + TIME_EPS);
      if (raw < 0 || raw >= h.rows.length) continue;
      const w = Math.exp(-m * order);
      order++;
      const row = h.rows[raw];
      for (let j = 0; j < 6; j++) acc[j] += w * row[j];
      wsum += w;
    }
    if (wsum > 0) for (let j = 0; j < 6; j++) out.targets[j] = acc[j] / wsum;
  }

  return exec;
};
