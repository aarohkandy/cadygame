// src/game/policy/policy-rng-shim.ts (WP4)
// Determinism shim for uploaded policy modules (GAME_DESIGN 5.2). Before a module is imported and again on
// every reset, Math.random becomes sfc32 seeded from ctx.seed. In eval timing, Date.now() and
// performance.now() return sim time in ms while policy code runs, so a policy that reads the clock is
// reproducible. The runner keeps a captured real clock to measure compute time.
//
// Two ways to use it:
//  - A policy Worker installs it once for its whole realm (`install()`), because only one policy lives there.
//  - The in-process driver shares one realm between seats, so it wraps each policy call in `run()`, which
//    swaps the seat's generator and clock in and restores the host's afterwards.

import { createRng, type Rng } from "../core/rng.ts";

type NowFn = () => number;

interface Globals {
  random: () => number;
  dateNow: NowFn;
  perfNow: NowFn | null;
}

function captureGlobals(): Globals {
  const perf = (globalThis as { performance?: { now: NowFn } }).performance;
  return {
    random: Math.random,
    dateNow: Date.now,
    perfNow: perf ? perf.now.bind(perf) : null,
  };
}

/** A real monotonic clock captured before any shim is installed. */
export const realNow: NowFn = (() => {
  const perf = (globalThis as { performance?: { now: NowFn } }).performance;
  if (perf) {
    const bound = perf.now.bind(perf);
    return () => bound();
  }
  const dateNow = Date.now;
  return () => dateNow();
})();

export interface PolicyRngShim {
  /** Reseeds the policy's Math.random (called before import with seed 0, and on every reset). */
  reseed(seed: number): void;
  /** Eval timing: Date.now/performance.now return sim time while policy code runs. */
  setEvalClock(on: boolean): void;
  /** Sim time in ms reported by the stubbed clocks. */
  setSimTimeMs(ms: number): void;
  readonly evalClock: boolean;
  readonly rng: Rng;
  /** Replaces the realm's globals permanently (Worker realms). */
  install(): void;
  /** Restores the globals captured at creation. */
  uninstall(): void;
  /** Runs fn with this shim's globals in place and restores the previous globals afterwards (shared realms). */
  run<T>(fn: () => T): T;
  /** As run(), holding the swap until the returned promise settles (module import). */
  runAsync<T>(fn: () => Promise<T>): Promise<T>;
}

export function createPolicyRngShim(seed = 0): PolicyRngShim {
  const host = captureGlobals();
  let rng = createRng(seed);
  let evalClock = false;
  let simMs = 0;

  const random = () => rng.next();
  const dateNow: NowFn = () => (evalClock ? Math.floor(simMs) : host.dateNow());
  const perfNow: NowFn = () => (evalClock ? simMs : host.perfNow ? host.perfNow() : host.dateNow());

  function apply(): Globals {
    const before = captureGlobals();
    Math.random = random;
    Date.now = dateNow;
    const perf = (globalThis as { performance?: { now: NowFn } }).performance;
    if (perf) {
      try { perf.now = perfNow; } catch { /* read-only performance.now: eval clock falls back to Date.now only */ }
    }
    return before;
  }

  function restore(g: Globals): void {
    Math.random = g.random;
    Date.now = g.dateNow;
    const perf = (globalThis as { performance?: { now: NowFn } }).performance;
    if (perf && g.perfNow) {
      try { perf.now = g.perfNow; } catch { /* see apply */ }
    }
  }

  return {
    reseed(s: number) { rng = createRng(s); },
    setEvalClock(on: boolean) { evalClock = on; },
    setSimTimeMs(ms: number) { simMs = ms; },
    get evalClock() { return evalClock; },
    get rng() { return rng; },
    install() { apply(); },
    uninstall() { restore(host); },
    run<T>(fn: () => T): T {
      const before = apply();
      try {
        return fn();
      } finally {
        restore(before);
      }
    },
    async runAsync<T>(fn: () => Promise<T>): Promise<T> {
      const before = apply();
      try {
        return await fn();
      } finally {
        restore(before);
      }
    },
  };
}
