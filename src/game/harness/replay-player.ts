// src/game/harness/replay-player.ts (WP5)
// Replay viewer playback (GAME_DESIGN 5.9.1): scrub, 0.25x to 4x, frame step, target ghost, brain panel, VERIFY.
// Poses are exact: the player re-simulates the episode through the same step path as verify and caches the
// SimState at every control tick, a few milliseconds per rendered frame, so the scrubber fills in while the
// viewer watches. Until a tick is computed the nearest earlier exact state (a recorded checkpoint or an
// already computed tick) is shown. Each rendered frame restores ticks k and k+1 into the engine's prev/curr
// slots and sets the render alpha between them.

import {
  type CombatRules, type CreateCombatRules, type CreatePhysicsEngine, type Episode, type GameClock, type PhysicsEngine,
  type PolicyDebug, type ReplayPlayer, type Seat, type SimState, type VerifyResult,
} from "../contracts.ts";
import { copySimState, createResim, indexEpisode, segmentForFrame, verifyEpisode, type EpisodeIndex, type Resim } from "./determinism.ts";

export const REPLAY_RATES = [0.25, 0.5, 1, 2, 4] as const;
/** Main-thread budget per update for filling the pose cache. */
export const PRECOMPUTE_BUDGET_MS = 6;

export interface ReplayPlayerDeps {
  engine: PhysicsEngine;
  clock: GameClock;
  rules: CombatRules | null;
  /** Fresh engine and rules for VERIFY, so verification never shares state with the viewer. */
  createEngine?: CreatePhysicsEngine;
  createRules?: CreateCombatRules;
  nodeFsRoot?: string;
  /** Called with a finished verify so the stored episode can record its determinism. */
  onVerified?: (ep: Episode, result: VerifyResult) => void;
}

export interface ReplayPlayerExtras {
  readonly episode: Episode | null;
  /** Fraction of ticks with exact cached poses (0..1). */
  readonly cached: number;
  /** Row currently shown (floor of the playhead). */
  readonly frame: number;
  /** Timeline time of a recorded event, for markers: seconds from the start of the episode. */
  eventTime(eventIndex: number): number;
  /** Runs the pose cache to completion synchronously (tests, exports). */
  precomputeAll(): void;
  unload(): void;
}

const nowMs = () => globalThis.performance?.now() ?? Date.now();

function errorResult(message: string): VerifyResult {
  return { verdict: "error", divergedFrame: null, divergedT: null, eventMismatch: null, checkedFrames: 0, message };
}

/**
 * Timeline seconds for every recorded event. Rounds are tracked through the phase events so steps from
 * different engine resets never mix.
 */
export function computeEventTimes(ep: Episode, index: EpisodeIndex): Float64Array {
  const out = new Float64Array(ep.events.length);
  const hz = ep.meta.controlHz;
  const rows = ep.columns.frame_index.length;
  let round = index.segments[0]?.round ?? 1;
  let seg = index.segments[0] ?? null;
  for (let i = 0; i < ep.events.length; i++) {
    const e = ep.events[i];
    if (e.type === "phase" && e.round > round) {
      round = e.round;
      seg = index.segments.find((s) => s.round === round) ?? seg;
    }
    if (!seg) continue;
    const f = seg.firstTick + Math.floor((e.step - seg.resetStep) / index.spt);
    out[i] = Math.min(Math.max(0, f), rows) / hz;
  }
  return out;
}

export function createReplayPlayer(deps: ReplayPlayerDeps): ReplayPlayer & ReplayPlayerExtras {
  const { engine, clock } = deps;
  let ep: Episode | null = null;
  let index: EpisodeIndex | null = null;
  let hz = 50;
  let rows = 0;
  let t = 0;
  let playing = false;
  let rate: (typeof REPLAY_RATES)[number] = 1;

  let states: (SimState | null)[] = [];
  let computedCount = 0;
  let resim: Resim | null = null;
  let resimSegment = -1;
  let working: SimState | null = null;        // resim engine state between slices
  let resimFailed = false;
  let shown: { a: number; b: number; alpha: number } | null = null;
  let debugCache: Record<Seat, { frame_index: number; value: unknown }[]> = { atlas: [], blaze: [] };
  let eventTimes: Float64Array | null = null;

  function frameOfStep(stepIdx: number, segFirstTick: number, resetStep: number): number {
    return segFirstTick + Math.floor((stepIdx - resetStep) / (index as EpisodeIndex).spt);
  }

  function seedCacheFromRecording(): void {
    if (!ep || !index) return;
    for (const seg of index.segments) {
      if (seg.firstTick < rows && !states[seg.firstTick]) { states[seg.firstTick] = copySimState(seg.reset.state); }
      for (let c = seg.checkpointIndex; c < seg.checkpointEnd; c++) {
        const cp = ep.steps.checkpoints[c];
        if ((cp.step - seg.resetStep) % index.spt !== 0) continue;
        const f = frameOfStep(cp.step, seg.firstTick, seg.resetStep);
        if (f >= seg.firstTick && f < seg.endTick && !states[f]) states[f] = copySimState(cp.state);
      }
    }
  }

  /** Advances the re-simulation within a time budget, caching every tick-start state. */
  function precompute(budgetMs: number): void {
    if (!ep || !index || resimFailed || computedCount >= rows) return;
    const start = nowMs();
    try {
      if (!resim) {
        resim = createResim(ep, engine, { rules: deps.rules, check: false });
        resimSegment = -1;
      } else if (working) {
        engine.restoreState(working, "both");
      }
      let n = 0;
      while (computedCount < rows) {
        if (resimSegment < 0 || resim.segmentDone) {
          if (resimSegment + 1 >= index.segments.length) break;
          resimSegment++;
          resim.beginSegment(resimSegment);
        }
        const f = resim.tickStart;
        if (f >= 0) {
          const existing = states[f];
          states[f] = copySimState(engine.saveState(), existing ?? undefined);
          computedCount = Math.max(computedCount, f + 1);
        }
        resim.step();
        if ((++n & 63) === 0 && nowMs() - start > budgetMs) break;
      }
      working = copySimState(engine.saveState(), working ?? undefined);
    } catch {
      // A damaged episode cannot be re-simulated; recorded checkpoints still play.
      resimFailed = true;
    }
    shown = null;
  }

  function nearestState(f: number): SimState | null {
    for (let i = Math.min(f, rows - 1); i >= 0; i--) if (states[i]) return states[i];
    return null;
  }

  function display(): void {
    if (!ep || rows === 0) return;
    const pos = Math.min(Math.max(0, t * hz), rows - 1);
    const a = Math.floor(pos);
    const b = Math.min(rows - 1, a + 1);
    const exactB = states[b] ? b : a;
    const alpha = exactB === a ? 1 : pos - a;
    if (shown && shown.a === a && shown.b === exactB && Math.abs(shown.alpha - alpha) < 1e-6) { clock.setRenderAlpha(alpha); return; }
    const sa = states[a] ?? nearestState(a);
    const sb = exactB === a ? sa : states[exactB];
    if (!sa || !sb) return;
    engine.restoreState(sa, "prev");
    engine.restoreState(sb, "curr");
    clock.setRenderAlpha(alpha);
    shown = { a, b: exactB, alpha };
  }

  function lastAtOrBefore<T extends { frame_index: number }>(list: readonly T[], frame: number): T | null {
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].frame_index <= frame) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found >= 0 ? list[found] : null;
  }

  const player: ReplayPlayer & ReplayPlayerExtras = {
    get durationS() { return hz > 0 ? rows / hz : 0; },
    get t() { return t; },
    get playing() { return playing; },
    get rate() { return rate; },
    get episode() { return ep; },
    get cached() { return rows > 0 ? computedCount / rows : 0; },
    get frame() { return Math.min(Math.max(0, Math.floor(t * hz)), Math.max(0, rows - 1)); },

    load(next: Episode): void {
      ep = next;
      hz = next.meta.controlHz;
      rows = next.columns.frame_index.length;
      t = 0; playing = false; rate = 1;
      states = new Array<SimState | null>(rows).fill(null);
      computedCount = 0; resim = null; resimSegment = -1; working = null; resimFailed = false; shown = null; eventTimes = null;
      try {
        index = indexEpisode(next);
      } catch {
        index = null;
        resimFailed = true;
      }
      debugCache = { atlas: [], blaze: [] };
      for (const seat of ["atlas", "blaze"] as const) {
        const list = next.sparse[`policy.debug.${seat}`];
        if (Array.isArray(list)) debugCache[seat] = list.slice().sort((x, y) => x.frame_index - y.frame_index);
      }
      seedCacheFromRecording();
      display();
    },

    unload(): void {
      ep = null; index = null; rows = 0; states = []; resim = null; working = null; playing = false; t = 0; shown = null;
    },

    seek(time: number): void {
      t = Math.min(Math.max(0, Number.isFinite(time) ? time : 0), player.durationS);
      display();
    },

    play(): void {
      if (!ep) return;
      if (t >= player.durationS - 1e-9) t = 0;
      playing = true;
    },

    pause(): void { playing = false; },

    setRate(r): void { if ((REPLAY_RATES as readonly number[]).includes(r)) rate = r; },

    stepFrames(n: number): void {
      if (!ep) return;
      playing = false;
      const f = Math.min(Math.max(0, Math.round(t * hz) + Math.trunc(n)), Math.max(0, rows - 1));
      t = f / hz;
      display();
    },

    update(wallDtS: number): void {
      if (!ep) return;
      if (playing) {
        t += Math.max(0, wallDtS) * rate;
        if (t >= player.durationS) { t = player.durationS; playing = false; }
      }
      precompute(PRECOMPUTE_BUDGET_MS);
      display();
    },

    precomputeAll(): void {
      while (ep && !resimFailed && computedCount < rows) {
        const before = computedCount;
        precompute(Number.POSITIVE_INFINITY);
        if (computedCount === before) break;
      }
      display();
    },

    targetGhost(seat: Seat, out: Float64Array): Float64Array {
      if (!ep || !index || rows === 0) { out.fill(0); return out; }
      const f = player.frame;
      const seg = segmentForFrame(index, f);
      if (!seg) { out.fill(0); return out; }
      const step = seg.resetStep + (f - seg.firstTick) * index.spt;
      const ctrl = ep.steps.ctrl;
      let lo = seg.ctrlIndex, hi = seg.ctrlEnd - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ctrl.steps[mid] <= step) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (found < 0) { out.set(seg.reset.state.ctrl.subarray(seat === "atlas" ? 0 : 6, seat === "atlas" ? 6 : 12)); return out; }
      const o = found * ctrl.width + (seat === "atlas" ? 0 : 6);
      for (let j = 0; j < 6; j++) out[j] = ctrl.values[o + j];
      return out;
    },

    debugAt(seat: Seat): PolicyDebug | null {
      const hit = lastAtOrBefore(debugCache[seat], player.frame);
      return hit ? (hit.value as PolicyDebug) : null;
    },

    eventTime(eventIndex: number): number {
      if (!ep || !index) return 0;
      if (!eventTimes) eventTimes = computeEventTimes(ep, index);
      return eventTimes[eventIndex] ?? 0;
    },

    async verify(onProgress: (f: number) => void): Promise<VerifyResult> {
      const episode = ep;
      if (!episode) return errorResult("NO EPISODE LOADED");
      if (!deps.createEngine || !deps.createRules) return errorResult("VERIFY NEEDS A PHYSICS ENGINE");
      const result = await verifyEpisode(episode, { createEngine: deps.createEngine, createRules: deps.createRules, nodeFsRoot: deps.nodeFsRoot }, onProgress);
      if (result.verdict !== "error") deps.onVerified?.(episode, result);
      return result;
    },
  };
  return player;
}
