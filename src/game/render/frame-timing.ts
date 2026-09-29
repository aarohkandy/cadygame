// src/game/render/frame-timing.ts (WP1)
// Frame timing for the recorder's display_latency_ms column and the ?debug=feel overlay: frame interval
// and CPU cost rings with p95, the longest frame since FIGHT, an estimate of sample-to-photon latency,
// renderer counters (draw calls, triangles incl. the shadow pass, program count after pre-warm), the compile
// log (every program that appeared after the baseline, by name and phase) and the per-round camera maxima
// (roll, FOV punch, trauma). No allocation per frame outside a logged compile.

export const TIMING_WINDOW = 300;
/** Compile-log entries kept (oldest dropped). */
export const COMPILE_LOG_SIZE = 24;

export interface RendererCounters { calls: number; triangles: number; programs: number; }
/** Per-round camera maxima from juice (12.1 item 1: roll ≤ 3°, FOV ≤ 6°, trauma ≤ 0.35). */
export interface RoundMaxima { rollDeg: number; fovDeg: number; trauma: number; }

export interface FrameTiming {
  /** Call at the very start of a frame (useFrame −3 or earlier) with the rAF timestamp in ms. */
  beginFrame(nowMs: number): void;
  /** Call after the frame has been rendered (useFrame +2). */
  endFrame(nowMs: number, counters: RendererCounters | null): void;
  /** Estimated ms from the frame's simulation sample to the display (EMA). NaN until measured. */
  displayLatencyMs(): number;
  readonly fps: number;
  readonly frameMsP95: number;
  readonly cpuMsP95: number;
  readonly counters: RendererCounters;
  /** Program count recorded right after pre-warm (−1 before). */
  programsAfterPrewarm: number;
  /** Longest frame interval (ms) since `markFight()`; 0 until a fight starts. */
  readonly worstFrameMs: number;
  markFight(): void;
  /** Programs that appeared after the baseline: "<phase> +n: name, name…" (newest last). */
  readonly compileLog: readonly string[];
  logCompile(phase: string, names: readonly string[]): void;
  readonly roundMax: RoundMaxima;
  /** Feeds the per-round maxima from the current juice output. */
  sampleCamera(rollDeg: number, fovDeg: number, trauma: number): void;
  resetRound(): void;
  reset(): void;
}

function p95(ring: Float32Array, count: number, scratch: Float32Array): number {
  if (count === 0) return 0;
  scratch.set(count === ring.length ? ring : ring.subarray(0, count));
  const view = scratch.subarray(0, count);
  view.sort();
  return view[Math.min(count - 1, Math.floor(count * 0.95))];
}

export function createFrameTiming(): FrameTiming {
  const intervals = new Float32Array(TIMING_WINDOW);
  const cpu = new Float32Array(TIMING_WINDOW);
  const scratch = new Float32Array(TIMING_WINDOW);
  let head = 0, count = 0;
  let lastBegin = -1, frameBegin = -1, prevFrameBegin = -1;
  let refreshMs = 1000 / 60;
  let latency = Number.NaN;
  let statsDirty = true;
  let cachedFrameP95 = 0, cachedCpuP95 = 0, statsAt = 0;
  const counters: RendererCounters = { calls: 0, triangles: 0, programs: 0 };
  const compileLog: string[] = [];
  const roundMax: RoundMaxima = { rollDeg: 0, fovDeg: 0, trauma: 0 };
  let fightAt = -1, worstFrameMs = 0;
  const refreshStats = () => {
    if (!statsDirty) return;
    cachedFrameP95 = p95(intervals, count, scratch);
    cachedCpuP95 = p95(cpu, count, scratch);
    statsDirty = false;
  };
  const timing: FrameTiming = {
    beginFrame(nowMs) {
      if (lastBegin >= 0) {
        const dt = nowMs - lastBegin;
        if (dt > 0 && dt < 250) {
          intervals[head] = dt;
          refreshMs += (Math.min(dt, 50) - refreshMs) * 0.05;
          if (fightAt >= 0 && lastBegin >= fightAt && dt > worstFrameMs) worstFrameMs = dt;
        }
        // The frame begun at prevFrameBegin was presented at about this vsync, plus one compositor interval.
        if (prevFrameBegin >= 0 && dt < 250) {
          const sample = nowMs - frameBegin + refreshMs;
          latency = Number.isNaN(latency) ? sample : latency + (sample - latency) * 0.1;
        }
      }
      prevFrameBegin = frameBegin;
      frameBegin = nowMs;
      lastBegin = nowMs;
    },
    endFrame(nowMs, c) {
      if (frameBegin < 0) return;
      cpu[head] = Math.max(0, nowMs - frameBegin);
      head = (head + 1) % TIMING_WINDOW;
      if (count < TIMING_WINDOW) count++;
      statsDirty = true;
      if (c) { counters.calls = c.calls; counters.triangles = c.triangles; counters.programs = c.programs; }
      if (nowMs - statsAt > 500) { refreshStats(); statsAt = nowMs; }
    },
    displayLatencyMs() { return latency; },
    get fps() { return refreshMs > 0 ? 1000 / refreshMs : 0; },
    get frameMsP95() { refreshStats(); return cachedFrameP95; },
    get cpuMsP95() { refreshStats(); return cachedCpuP95; },
    counters,
    programsAfterPrewarm: -1,
    get worstFrameMs() { return worstFrameMs; },
    markFight() { fightAt = lastBegin; worstFrameMs = 0; },
    compileLog,
    logCompile(phase, names) {
      compileLog.push(`${phase} +${names.length}: ${names.join(", ")}`);
      if (compileLog.length > COMPILE_LOG_SIZE) compileLog.splice(0, compileLog.length - COMPILE_LOG_SIZE);
    },
    roundMax,
    sampleCamera(rollDeg, fovDeg, trauma) {
      const r = Math.abs(rollDeg), f = Math.abs(fovDeg);
      if (r > roundMax.rollDeg) roundMax.rollDeg = r;
      if (f > roundMax.fovDeg) roundMax.fovDeg = f;
      if (trauma > roundMax.trauma) roundMax.trauma = trauma;
    },
    resetRound() { roundMax.rollDeg = 0; roundMax.fovDeg = 0; roundMax.trauma = 0; },
    reset() {
      head = 0; count = 0; lastBegin = -1; frameBegin = -1; prevFrameBegin = -1; latency = Number.NaN; statsDirty = true;
      fightAt = -1; worstFrameMs = 0; compileLog.length = 0; timing.resetRound();
    },
  };
  return timing;
}

/**
 * Page-wide instance: arena-canvas drives it, and game-handle.ts can pass `() => frameTiming.displayLatencyMs()`
 * as the sim-driver's displayLatencyMs dependency.
 */
export const frameTiming: FrameTiming = createFrameTiming();
