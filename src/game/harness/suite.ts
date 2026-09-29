// src/game/harness/suite.ts (WP5)
// The smoke-v1 suite (GAME_DESIGN 5.10.4; BUILD_PLAN D2 keeps only this one): seeds 1-3 x Contender x both
// seats = 6 matches, HARNESS preset, eval timing, best of 3, DDA off. Each seed faces a different built-in
// personality (1 OVERSHOOT, 2 BACKLASH, 3 DEADBAND) so six matches cover all three styles.
// Runs through the headless runner (the same sim-driver and director as the browser) and reports the
// seed-bootstrap win rate plus pass/fail gates: every match completes, no hangs, no policy errors, and the
// first episode re-simulates bit-exact.

import {
  SEATS, otherSeat,
  type DriverSpec, type Episode, type EpisodeStats, type HeadlessMatchRunner, type PersonalityId, type Seat, type SuiteId,
  type SuiteOptions, type SuiteResult, type VerifyResult,
} from "../contracts.ts";
import { PERSONALITY_NAMES, TIER_NAMES, buildMatchConfig, driverDisplayName } from "../match/match-config.ts";
import { aggregateCells, type AggregateCell } from "./aggregate.ts";
import { summarize, type ExtendedEpisodeStore } from "./episode-store.ts";
import { reliabilityCounts } from "./verdict.ts";
import type { EpisodeStore } from "../contracts.ts";

export interface SuiteDefinition {
  id: SuiteId;
  label: string;
  seeds: [number, number];
  opponents: readonly PersonalityId[];
  tier: "contender";
  bestOf: 3;
  preset: "harness";
}

export const SUITES: Readonly<Record<SuiteId, SuiteDefinition>> = {
  "smoke-v1": {
    id: "smoke-v1", label: "SMOKE", seeds: [1, 3], opponents: ["overshoot", "backlash", "deadband"],
    tier: "contender", bestOf: 3, preset: "harness",
  },
};

export interface SuiteCellSpec {
  index: number;
  seed: number;
  policySeat: Seat;
  opponent: Extract<DriverSpec, { kind: "builtin" }>;
  opponentLabel: string;
}

export interface SuiteCellResult {
  episodeId: string;
  seed: number;
  seat: Seat;
  opponent: string;
  winner: Seat | null;
  roundsWon: Record<Seat, number>;
  durationS: number;
  stamp: EpisodeStats["verdict"][Seat];
}

export interface SuiteRunResult extends SuiteResult {
  cells: SuiteCellResult[];
  verify: VerifyResult | null;
}

export interface SuiteDeps {
  runner: HeadlessMatchRunner;
  store: EpisodeStore | ExtendedEpisodeStore | null;
  computeStats: (ep: Episode) => EpisodeStats;
  /** Bit-exact re-simulation of the first episode (a gate). Omit to skip the gate. */
  verify?: (ep: Episode) => Promise<VerifyResult>;
  now?: () => Date;
  /** Receives each finished episode (the CLI writes files from here when no store keeps them). */
  onEpisode?: (ep: Episode, cell: SuiteCellSpec) => Promise<void> | void;
}

export function suiteCells(opts: Pick<SuiteOptions, "suite" | "policySeat" | "seeds">): SuiteCellSpec[] {
  const def = SUITES[opts.suite];
  if (!def) throw new Error(`unknown suite ${String(opts.suite)}`);
  const [a, b] = opts.seeds ?? def.seeds;
  if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a)) throw new Error(`seed range ${a}-${b} is not valid`);
  const seats: Seat[] = opts.policySeat === "both" ? [...SEATS] : [opts.policySeat];
  const cells: SuiteCellSpec[] = [];
  for (let seed = a; seed <= b; seed++) {
    const personality = def.opponents[(((seed - 1) % def.opponents.length) + def.opponents.length) % def.opponents.length];
    for (const policySeat of seats) {
      cells.push({
        index: cells.length, seed, policySeat,
        opponent: { kind: "builtin", personality, tier: def.tier, dda: false },
        opponentLabel: `${PERSONALITY_NAMES[personality]} ${TIER_NAMES[def.tier]}`,
      });
    }
  }
  return cells;
}

function runStamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function runSuite(opts: SuiteOptions, deps: SuiteDeps): Promise<SuiteRunResult> {
  if (opts.policy.kind === "human") throw new Error("a suite cannot seat a human");
  const def = SUITES[opts.suite];
  const cells = suiteCells(opts);
  const now = deps.now ?? (() => new Date());
  const runId = `${opts.suite}-${runStamp(now())}`;
  const aggregateInput: AggregateCell[] = [];
  const results: SuiteCellResult[] = [];
  const episodes: string[] = [];
  let hangs = 0;
  let errors = 0;
  let disconnects = 0;
  let verify: VerifyResult | null = null;

  for (const cell of cells) {
    if (opts.signal?.aborted) throw Object.assign(new Error("suite aborted"), { name: "AbortError" });
    const other = otherSeat(cell.policySeat);
    const seats = {} as Record<Seat, { driver: DriverSpec }>;
    seats[cell.policySeat] = { driver: opts.policy };
    seats[other] = { driver: cell.opponent };
    const cfg = buildMatchConfig({
      preset: def.preset, context: "suite", seed: cell.seed, bestOf: def.bestOf, timing: "eval",
      keepEpisodes: opts.keepEpisodes, record: true, now: now(), seats,
    });
    cfg.id = `${runId}-s${cell.seed}-${cell.policySeat}`;
    const ep = await deps.runner.run(cfg, opts.signal);
    const stats = deps.computeStats(ep);
    await deps.onEpisode?.(ep, cell);
    if (opts.keepEpisodes && deps.store) await deps.store.save(ep, { confirmEvict: async () => true });
    episodes.push(ep.meta.episodeId);

    const counts = reliabilityCounts(ep, cell.policySeat);
    errors += counts.errors;
    disconnects += counts.disconnects;
    if (ep.meta.result.error === "policy_hang" || counts.hangs > 0) hangs++;
    if (!verify && deps.verify) verify = await deps.verify(ep);

    aggregateInput.push({ stats, subject: cell.policySeat, seed: cell.seed, opponent: cell.opponentLabel });
    results.push({
      episodeId: ep.meta.episodeId, seed: cell.seed, seat: cell.policySeat, opponent: cell.opponentLabel,
      winner: ep.meta.result.winner, roundsWon: { ...ep.meta.result.roundsWon }, durationS: stats.durationS,
      stamp: stats.verdict[cell.policySeat],
    });
    const summary = summarize(ep, 0, false);
    opts.onProgress(results.length, cells.length, {
      id: summary.id, created: summary.created, names: summary.names, preset: summary.preset, winner: summary.winner,
      durationS: summary.durationS, bytes: summary.bytes, verdict: summary.verdict, pinned: false, human: summary.human,
    }, { seat: cell.policySeat, stamp: stats.verdict[cell.policySeat] });
  }

  const gates: SuiteResult["gates"] = [
    { name: "MATCHES COMPLETE", value: results.length, pass: results.length === cells.length },
    { name: "POLICY HANGS", value: hangs, pass: hangs === 0 },
    { name: "POLICY ERRORS", value: errors, pass: errors === 0 },
    // A seat that never connected plays the whole suite as a dead seat and records no errors at all,
    // so without this gate a policy that was not running could still pass.
    { name: "POLICY DISCONNECTS", value: disconnects, pass: disconnects === 0 },
  ];
  if (deps.verify) gates.push({ name: "REPLAY BIT-EXACT", value: verify?.verdict === "bit_exact" ? 1 : 0, pass: verify?.verdict === "bit_exact" });

  return { suite: opts.suite, episodes, aggregate: aggregateCells(aggregateInput), gates, cells: results, verify };
}

/** Human-readable policy label for reports: file name, builtin name, or bridge URL. */
export function policyLabel(spec: DriverSpec): string {
  if (spec.kind === "bridge") return spec.url;
  return driverDisplayName(spec, "PILOT");
}
