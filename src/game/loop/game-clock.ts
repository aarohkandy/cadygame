// src/game/loop/game-clock.ts (WP1)
// The game's two timelines (GAME_DESIGN 10.3): sim time, advanced only by physics steps through the
// fixed-step accumulator, and wall time, which drives hit-stop countdowns, the hit-stop budget window,
// and the dilation curve. Hit stop and dilation exist only in Arcade (4.10); the sim-driver enables
// them per match with configure(). No performance.now() in here: the driver feeds wall deltas, so a
// fake clock in tests is just this clock fed fixed deltas.

import type { GameClock } from "../contracts.ts";

/** A single freeze never exceeds this (8.1 Merge). */
export const HITSTOP_SINGLE_CAP_MS = 150;
/** At most this much freeze is granted in any rolling window (8.1 Budget). */
export const HITSTOP_BUDGET_MS = 120;
export const HITSTOP_WINDOW_MS = 600;
/** Slowest time scale a dilation may request. */
export const DILATION_MIN_SCALE = 0.05;

const GRANT_LOG_SIZE = 64;

export interface ClockFeatures { hitstop: boolean; dilation: boolean; }

/** The GameClock plus the members only the sim-driver (and tests) touch. */
export interface DrivenGameClock extends GameClock {
  /** Fixed-step accumulator in sim seconds (10.3). */
  acc: number;
  readonly features: Readonly<ClockFeatures>;
  /** Wall ms of the current freeze when it was granted (0 when none): remaining / total is how far through it is. */
  readonly hitstopTotalMs: number;
  /** Advances wall time: hit-stop countdown, budget window, dilation curve. Pause holds the countdowns. */
  advanceWall(wallS: number): void;
  setSimTime(t: number): void;
  /** Arcade: both on. Proving Ground, Harness: both off (requests return 0 and do nothing). */
  configure(features: ClockFeatures): void;
  /** New round or match: clears accumulator, sim time, freeze, dilation, and the budget window. */
  reset(simTime?: number): void;
}

export function createGameClock(features: ClockFeatures = { hitstop: true, dilation: true }): DrivenGameClock {
  let simTime = 0;
  let wallTime = 0;                        // seconds
  let alpha = 0;
  let hitstopRemainingMs = 0;
  /** Length of the current freeze at its last (re)grant; the attacker's ghost is released at 60 % of it. */
  let hitstopTotalMs = 0;
  let externalDrive = false;
  const enabled: ClockFeatures = { hitstop: features.hitstop, dilation: features.dilation };

  // Rolling budget: wall time (ms) and amount of each grant, as a ring.
  const grantAt = new Float64Array(GRANT_LOG_SIZE);
  const grantMs = new Float64Array(GRANT_LOG_SIZE);
  let grantHead = 0;                       // next write index
  let grantCount = 0;

  // Dilation: hold at `dilScale` for `dilHoldMs`, then smoothstep back to 1 over `dilEaseMs`.
  let dilActive = false;
  let dilScale = 1;
  let dilHoldMs = 0;
  let dilEaseMs = 0;
  let dilElapsedMs = 0;
  let timeScale = 1;

  function budgetUsedMs(): number {
    const nowMs = wallTime * 1000;
    let used = 0;
    for (let i = 0; i < grantCount; i++) {
      const idx = (grantHead - 1 - i + GRANT_LOG_SIZE) % GRANT_LOG_SIZE;
      if (nowMs - grantAt[idx] >= HITSTOP_WINDOW_MS) break;   // entries are in time order: the rest are older
      used += grantMs[idx];
    }
    return used;
  }

  function oldestGrantInWindow(): boolean {
    if (grantCount < GRANT_LOG_SIZE) return false;
    return wallTime * 1000 - grantAt[grantHead] < HITSTOP_WINDOW_MS;
  }

  function updateTimeScale(): void {
    if (!dilActive) { timeScale = 1; return; }
    if (dilElapsedMs <= dilHoldMs) { timeScale = dilScale; return; }
    if (dilEaseMs <= 0 || dilElapsedMs >= dilHoldMs + dilEaseMs) {
      dilActive = false;
      timeScale = 1;
      return;
    }
    const u = (dilElapsedMs - dilHoldMs) / dilEaseMs;
    const s = u * u * (3 - 2 * u);
    timeScale = dilScale + (1 - dilScale) * s;
  }

  function clearTransient(): void {
    hitstopRemainingMs = 0;
    hitstopTotalMs = 0;
    grantHead = 0;
    grantCount = 0;
    dilActive = false;
    dilElapsedMs = 0;
    timeScale = 1;
  }

  const clock: DrivenGameClock = {
    acc: 0,
    paused: false,

    get simTime() { return simTime; },
    get wallTime() { return wallTime; },
    get alpha() { return alpha; },
    get timeScale() { return timeScale; },
    get hitstopRemainingMs() { return hitstopRemainingMs; },
    get hitstopTotalMs() { return hitstopTotalMs; },
    get hitstopBudgetUsedMs() { return budgetUsedMs(); },
    get externalDrive() { return externalDrive; },
    get features() { return enabled; },

    requestHitstop(ms: number): number {
      if (!enabled.hitstop || !(ms > 0)) return 0;
      const target = Math.min(ms, HITSTOP_SINGLE_CAP_MS);
      const extension = target - hitstopRemainingMs;          // max-merge: only the part beyond the current freeze
      if (extension <= 0) return 0;
      if (oldestGrantInWindow()) return 0;                     // pathological burst of tiny grants: log full
      const granted = Math.min(extension, HITSTOP_BUDGET_MS - budgetUsedMs());
      if (granted <= 0) return 0;
      hitstopRemainingMs += granted;
      hitstopTotalMs = hitstopRemainingMs;
      grantAt[grantHead] = wallTime * 1000;
      grantMs[grantHead] = granted;
      grantHead = (grantHead + 1) % GRANT_LOG_SIZE;
      if (grantCount < GRANT_LOG_SIZE) grantCount++;
      return granted;
    },

    requestDilation(scale: number, holdMs: number, easeMs: number): void {
      if (!enabled.dilation || !Number.isFinite(scale)) return;
      const s = Math.min(1, Math.max(DILATION_MIN_SCALE, scale));
      if (s >= 1) return;
      dilActive = true;
      dilScale = s;
      dilHoldMs = Math.max(0, holdMs);
      dilEaseMs = Math.max(0, easeMs);
      dilElapsedMs = 0;
      updateTimeScale();
    },

    setRenderAlpha(a: number): void {
      alpha = a < 0 ? 0 : a > 1 ? 1 : a;
    },

    setExternalDrive(on: boolean): void {
      externalDrive = on;
      if (on) clock.acc = 0;
    },

    advanceWall(wallS: number): void {
      if (!(wallS > 0)) return;
      wallTime += wallS;
      if (clock.paused) return;
      const ms = wallS * 1000;
      if (hitstopRemainingMs > 0) {
        hitstopRemainingMs = Math.max(0, hitstopRemainingMs - ms);
        if (hitstopRemainingMs === 0) hitstopTotalMs = 0;
      }
      if (dilActive) {
        dilElapsedMs += ms;
        updateTimeScale();
      }
    },

    setSimTime(t: number): void {
      simTime = t;
    },

    configure(next: ClockFeatures): void {
      enabled.hitstop = next.hitstop;
      enabled.dilation = next.dilation;
      if (!next.hitstop) { hitstopRemainingMs = 0; hitstopTotalMs = 0; }
      if (!next.dilation) { dilActive = false; timeScale = 1; }
    },

    reset(t = 0): void {
      simTime = t;
      clock.acc = 0;
      alpha = 0;
      clearTransient();
    },
  };
  return clock;
}
