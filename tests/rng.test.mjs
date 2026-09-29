import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRng, exGaussian, EX_GAUSSIAN_FLOOR_MS, gaussian, substream, toSeed } from "../src/game/core/rng.ts";

describe("createRng (sfc32 seeded by SplitMix64)", () => {
  test("same seed gives the same sequence; different seeds diverge", () => {
    const a = createRng(1234), b = createRng(1234), c = createRng(1235);
    const sa = Array.from({ length: 64 }, () => a.nextU32());
    const sb = Array.from({ length: 64 }, () => b.nextU32());
    const sc = Array.from({ length: 64 }, () => c.nextU32());
    assert.deepEqual(sa, sb);
    assert.ok(sa.filter((v, i) => v === sc[i]).length <= 1);
  });

  test("known-answer vectors pin the generator and substream derivation (episodes depend on them)", () => {
    const r = createRng(0);
    assert.deepEqual([r.nextU32(), r.nextU32(), r.nextU32()], [2658987508, 2604259909, 2066695093]);
    assert.equal(substream(0xdeadbeef, "seat", "atlas", 1), 2058884974);
  });

  test("next() is uniform in [0, 1)", () => {
    const r = createRng(99);
    const bins = new Array(10).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const v = r.next();
      assert.ok(v >= 0 && v < 1);
      bins[Math.floor(v * 10)]++;
    }
    for (const n of bins) assert.ok(Math.abs(n - N / 10) < N * 0.006, `bin count ${n}`);
  });

  test("int and range stay inside their bounds", () => {
    const r = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const k = r.int(6);
      assert.ok(Number.isInteger(k) && k >= 0 && k < 6);
      const x = r.range(-2, 3);
      assert.ok(x >= -2 && x < 3);
    }
    assert.throws(() => r.int(0), RangeError);
  });

  test("getState / setState restores the exact stream", () => {
    const r = createRng(42);
    for (let i = 0; i < 17; i++) r.next();
    const saved = r.getState();
    const ahead = Array.from({ length: 20 }, () => r.nextU32());
    r.setState(saved);
    assert.deepEqual(Array.from({ length: 20 }, () => r.nextU32()), ahead);
    assert.throws(() => r.setState([1, 2, 3]), RangeError);
  });

  test("seeds coerce to uint32 and reject non-finite values", () => {
    assert.equal(toSeed(-1), 0xffffffff);
    assert.equal(toSeed(3.9), 3);
    assert.throws(() => createRng(Number.NaN), RangeError);
    assert.deepEqual(createRng(-1).getState(), createRng(0xffffffff).getState());
  });
});

describe("substream", () => {
  test("is deterministic and path-sensitive", () => {
    const seed = 0xdeadbeef;
    assert.equal(substream(seed, "seat", "atlas", 1), substream(seed, "seat", "atlas", 1));
    const ids = new Set([
      substream(seed, "seat", "atlas", 1), substream(seed, "seat", "blaze", 1),
      substream(seed, "seat", "atlas", 2), substream(seed, "physicsInit", 1),
      substream(seed, "physicsInit", 2), substream(seed, "dda"), substream(seed, "arena"),
      substream(seed + 1, "seat", "atlas", 1),
    ]);
    assert.equal(ids.size, 8, "two seats, rounds, and labels never share a seed");
  });

  test("a string label and a number with the same digits are different paths", () => {
    assert.notEqual(substream(5, "1"), substream(5, 1));
    assert.notEqual(substream(5, "ab", "c"), substream(5, "a", "bc"));
  });

  test("returns uint32 values with well-spread bits", () => {
    let ones = 0;
    const N = 2000;
    for (let round = 0; round < N; round++) {
      const s = substream(1, "physicsInit", round);
      assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
      ones += s.toString(2).split("").filter((c) => c === "1").length;
    }
    assert.ok(Math.abs(ones / N - 16) < 0.5, `mean popcount ${ones / N}`);
  });
});

describe("gaussian and exGaussian", () => {
  test("gaussian matches its mean and standard deviation", () => {
    const r = createRng(2024);
    const N = 50_000;
    let sum = 0, sq = 0;
    for (let i = 0; i < N; i++) { const v = gaussian(r, 3, 2); sum += v; sq += v * v; }
    const mean = sum / N;
    const sd = Math.sqrt(sq / N - mean * mean);
    assert.ok(Math.abs(mean - 3) < 0.05, `mean ${mean}`);
    assert.ok(Math.abs(sd - 2) < 0.05, `sd ${sd}`);
  });

  test("exGaussian mean is μ + τ and never drops below the 120 ms floor", () => {
    const r = createRng(11);
    const N = 50_000;
    let sum = 0, min = Infinity;
    for (let i = 0; i < N; i++) { const v = exGaussian(r, 260, 30, 80); sum += v; min = Math.min(min, v); }
    assert.ok(Math.abs(sum / N - 340) < 3, `mean ${sum / N}`);
    assert.ok(min >= EX_GAUSSIAN_FLOOR_MS);
    const low = createRng(3);
    for (let i = 0; i < 1000; i++) assert.ok(exGaussian(low, 50, 40, 10) >= 120);
    assert.equal(exGaussian(createRng(1), 10, 0, 0, 0), 10);
  });

  test("samples are reproducible from a restored state", () => {
    const r = createRng(8);
    const s = r.getState();
    const a = [gaussian(r), exGaussian(r, 200, 20, 50)];
    r.setState(s);
    assert.deepEqual([gaussian(r), exGaussian(r, 200, 20, 50)], a);
  });
});
