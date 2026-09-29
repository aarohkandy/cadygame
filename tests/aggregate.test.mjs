import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aggregate, aggregateCells, bootstrapOverSeeds, formatWinRate, perSeedScores } from "../src/game/harness/aggregate.ts";

function stats(winner, { timeoutFrac = 0, violations = 0, hang = null } = {}) {
  const physical = { timeoutFrac, violationsPerJoint: [violations, 0, 0, 0, 0, 0] };
  return {
    seats: { atlas: { physical, arcade: null }, blaze: { physical, arcade: null } },
    result: { winner, roundsWon: { atlas: 0, blaze: 0 }, rounds: [], forfeit: hang, determinism: "unchecked", error: hang ? "policy_hang" : null },
    durationS: 60, verdict: {},
  };
}

describe("aggregates: the seed is the unit (5.10.3)", () => {
  test("per-seed score is the mean over that seed's cells", () => {
    const cells = [
      { stats: stats("atlas"), subject: "atlas", seed: 1, opponent: "X" },
      { stats: stats("atlas"), subject: "blaze", seed: 1, opponent: "X" },
      { stats: stats("blaze"), subject: "blaze", seed: 2, opponent: "X" },
      { stats: stats("blaze"), subject: "blaze", seed: 2, opponent: "Y" },
    ];
    assert.deepEqual(perSeedScores(cells), { seeds: [1, 2], scores: [0.5, 1] });
    const agg = aggregateCells(cells);
    assert.equal(agg.seeds, 2);
    assert.equal(agg.winRate, 0.75);
    assert.deepEqual(Object.keys(agg.perOpponent).sort(), ["X", "Y"]);
    assert.equal(agg.perOpponent.Y.winRate, 1);
    assert.equal(agg.perOpponent.X.seeds, 2);
  });

  test("bootstrap CI: degenerate cases are exact, and a 30/50 record gives the textbook interval", () => {
    assert.deepEqual(bootstrapOverSeeds([1, 1, 1]), { mean: 1, ciLow: 1, ciHigh: 1, n: 3 });
    assert.deepEqual(bootstrapOverSeeds([0.5]), { mean: 0.5, ciLow: 0.5, ciHigh: 0.5, n: 1 });
    assert.ok(Number.isNaN(bootstrapOverSeeds([]).mean));
    const scores = Array.from({ length: 50 }, (_, i) => (i < 30 ? 1 : 0));
    const b = bootstrapOverSeeds(scores);
    assert.equal(b.mean, 0.6);
    // Normal approximation: 0.6 ± 1.96·sqrt(0.24/50) = [0.464, 0.736]; percentile bootstrap lands on the 0.02 grid.
    assert.ok(Math.abs(b.ciLow - 0.464) <= 0.03, `low ${b.ciLow}`);
    assert.ok(Math.abs(b.ciHigh - 0.736) <= 0.03, `high ${b.ciHigh}`);
    assert.deepEqual(bootstrapOverSeeds(scores), b, "seeded: the same seeds give the same interval");
  });

  test("HarnessApi.aggregate: one subject seat, seeds from the callback, failure rates", () => {
    const eps = [stats("blaze"), stats("atlas", { timeoutFrac: 0.1 }), stats("blaze", { violations: 2 }), stats("atlas", { hang: "blaze" })];
    const agg = aggregate(eps, "blaze", (i) => 100 + i);
    assert.equal(agg.seeds, 4);
    assert.equal(agg.winRate, 0.5);
    assert.deepEqual(Object.keys(agg.perOpponent), ["VS ATLAS"]);
    assert.equal(agg.rates.timeout, 0.025);
    assert.equal(agg.rates.violation, 0.25);
    assert.equal(agg.rates.hang, 0.25);
  });

  test("the report line reads like the Lab card", () => {
    assert.equal(formatWinRate({ winRate: 0.63, ciLow: 0.54, ciHigh: 0.71, seeds: 50 }), "63% (54–71) · 50 SEEDS");
    assert.equal(formatWinRate({ winRate: 1, ciLow: 1, ciHigh: 1, seeds: 1 }), "100% (100–100) · 1 SEED");
    assert.equal(formatWinRate({ winRate: NaN, ciLow: NaN, ciHigh: NaN, seeds: 0 }), "NO SEEDS");
  });
});
