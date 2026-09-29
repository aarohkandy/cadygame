// src/game/harness/aggregate.ts (WP5)
// Aggregates over episodes (GAME_DESIGN 5.10.3 as cut by BUILD_PLAN D2). The seed is the unit: a seed's score
// is the mean match result over its cells, the win rate is the mean over seeds, and the 95% interval is a
// bootstrap over seeds (10,000 resamples, seeded, so a report is reproducible), e.g. "63% (54–71) · 50 SEEDS".

import { otherSeat, type AggregateStats, type EpisodeStats, type Seat } from "../contracts.ts";
import { createRng } from "../core/rng.ts";

export const BOOTSTRAP_RESAMPLES = 10_000;
/** Fixed bootstrap seed: the same episodes always give the same interval. */
export const BOOTSTRAP_SEED = 0x5eed_c1;

export interface AggregateCell {
  stats: EpisodeStats;
  subject: Seat;
  seed: number;
  /** Opponent label for the per-opponent breakdown, e.g. "BACKLASH CONTENDER". */
  opponent: string;
}

export interface BootstrapResult { mean: number; ciLow: number; ciHigh: number; n: number; }

/** Mean of per-seed scores with a percentile bootstrap interval over seeds. */
export function bootstrapOverSeeds(scores: readonly number[], resamples = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED): BootstrapResult {
  const n = scores.length;
  if (n === 0) return { mean: Number.NaN, ciLow: Number.NaN, ciHigh: Number.NaN, n: 0 };
  let total = 0;
  for (const s of scores) total += s;
  const mean = total / n;
  if (n === 1) return { mean, ciLow: mean, ciHigh: mean, n };
  const rng = createRng(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += scores[rng.int(n)];
    means[r] = sum / n;
  }
  means.sort();
  const pick = (q: number) => {
    const pos = (resamples - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return means[lo] + (means[hi] - means[lo]) * (pos - lo);
  };
  return { mean, ciLow: pick(0.025), ciHigh: pick(0.975), n };
}

/** Per-seed mean result (1 win, 0 loss; no draws exist) in first-seen seed order. */
export function perSeedScores(cells: readonly AggregateCell[]): { seeds: number[]; scores: number[] } {
  const order: number[] = [];
  const sums = new Map<number, { sum: number; n: number }>();
  for (const c of cells) {
    let e = sums.get(c.seed);
    if (!e) { e = { sum: 0, n: 0 }; sums.set(c.seed, e); order.push(c.seed); }
    e.sum += c.stats.result.winner === c.subject ? 1 : 0;
    e.n++;
  }
  return { seeds: order, scores: order.map((s) => { const e = sums.get(s)!; return e.sum / e.n; }) };
}

function subjectHung(c: AggregateCell): boolean {
  return c.stats.result.error === "policy_hang" && c.stats.result.forfeit === c.subject;
}

export function aggregateCells(cells: readonly AggregateCell[]): AggregateStats {
  const overall = bootstrapOverSeeds(perSeedScores(cells).scores);
  const perOpponent: AggregateStats["perOpponent"] = {};
  const groups = new Map<string, AggregateCell[]>();
  for (const c of cells) {
    const g = groups.get(c.opponent);
    if (g) g.push(c); else groups.set(c.opponent, [c]);
  }
  for (const [name, group] of groups) {
    const b = bootstrapOverSeeds(perSeedScores(group).scores);
    perOpponent[name] = { seeds: b.n, winRate: b.mean, ciLow: b.ciLow, ciHigh: b.ciHigh };
  }
  let timeoutSum = 0, violations = 0, hangs = 0;
  for (const c of cells) {
    const p = c.stats.seats[c.subject].physical;
    timeoutSum += Number.isFinite(p.timeoutFrac) ? p.timeoutFrac : 0;
    if (p.violationsPerJoint.some((n) => n > 0)) violations++;
    if (subjectHung(c)) hangs++;
  }
  const n = cells.length;
  return {
    seeds: overall.n, winRate: overall.mean, ciLow: overall.ciLow, ciHigh: overall.ciHigh, perOpponent,
    rates: {
      timeout: n > 0 ? timeoutSum / n : 0,
      violation: n > 0 ? violations / n : 0,
      hang: n > 0 ? hangs / n : 0,
    },
  };
}

/** HarnessApi.aggregate: one subject seat throughout; the breakdown is by opponent seat. */
export function aggregate(eps: readonly EpisodeStats[], subjectSeat: Seat, seedOf: (i: number) => number): AggregateStats {
  const opponent = `VS ${otherSeat(subjectSeat).toUpperCase()}`;
  return aggregateCells(eps.map((stats, i) => ({ stats, subject: subjectSeat, seed: seedOf(i), opponent })));
}

const pct = (x: number) => Math.round(x * 100);

/** "63% (54–71) · 50 SEEDS" */
export function formatWinRate(a: Pick<AggregateStats, "winRate" | "ciLow" | "ciHigh" | "seeds">): string {
  if (!(a.seeds > 0)) return "NO SEEDS";
  return `${pct(a.winRate)}% (${pct(a.ciLow)}–${pct(a.ciHigh)}) · ${a.seeds} ${a.seeds === 1 ? "SEED" : "SEEDS"}`;
}
