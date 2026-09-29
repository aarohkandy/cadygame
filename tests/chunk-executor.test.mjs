import assert from "node:assert/strict";
import { test } from "node:test";
import { createChunkExecutor } from "../src/game/policy/chunk-executor.ts";

const DT = 0.02;
const row = (v) => [v, 0, 0, 0, 0, 0.04];
const sample = () => ({ targets: new Float64Array(6), intents: 0, chunkId: -1, chunkIndex: -1, exhausted: false });

function result(action, chunkId = -1, tick = 0) {
  return { tick, requestFrameIndex: tick, chunkId, action, computeMs: 1, status: "ok" };
}

test("full_chunk: a 100-step chunk runs all 100 entries with no requests in between", () => {
  const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "full_chunk", temporalEnsembleM: null });
  const chunk = Array.from({ length: 100 }, (_, i) => row(i / 100));
  const out = sample();
  let requests = 0;
  const seen = [];
  ex.accept(result({ targets: chunk[0], chunk, chunkHz: 50, chunkStartT: 0 }, 7), 0);
  for (let tick = 0; tick < 100; tick++) {
    if (tick > 0 && ex.wantsRequest(tick % 2 === 0)) requests++;
    assert.equal(ex.sample(tick * DT, out), true);
    seen.push(out.chunkIndex);
    assert.equal(out.targets[0], tick / 100);
    assert.equal(out.chunkId, 7);
  }
  assert.equal(requests, 0);
  assert.deepEqual(seen, Array.from({ length: 100 }, (_, i) => i));
  assert.equal(out.exhausted, true);
  assert.equal(ex.wantsRequest(false), true, "consumed: ask right away");
  assert.equal(ex.wantsRequest(false), false, "then only on decision ticks while waiting");
  assert.equal(ex.wantsRequest(true), true);
});

test("entries older than the tick are skipped by chunkStartT (a late arrival)", () => {
  const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "until_next_decision", temporalEnsembleM: null });
  const chunk = Array.from({ length: 10 }, (_, i) => row(i));
  const out = sample();
  ex.accept(result({ targets: chunk[0], chunk, chunkHz: 50, chunkStartT: 1.0 }, 1), 1.0);
  ex.sample(1.06, out);
  assert.equal(out.chunkIndex, 3);
  assert.equal(out.targets[0], 3);
  ex.sample(1.5, out);
  assert.equal(out.chunkIndex, 9, "past the end holds the last entry");
});

test("chunks at another rate are resampled to the control rate by time (nearest older)", () => {
  const ex = createChunkExecutor({ controlHz: 60, chunkExecute: "until_next_decision", temporalEnsembleM: null });
  const chunk = Array.from({ length: 30 }, (_, i) => row(i));
  const out = sample();
  ex.accept(result({ targets: chunk[0], chunk, chunkHz: 30, chunkStartT: 0 }, 2), 0);
  const idx = [];
  for (let k = 0; k < 6; k++) { ex.sample(k / 60, out); idx.push(out.chunkIndex); }
  assert.deepEqual(idx, [0, 0, 1, 1, 2, 2]);
});

test("a chunk that starts in the future keeps applying the previous action", () => {
  const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "until_next_decision", temporalEnsembleM: null });
  const out = sample();
  ex.accept(result({ targets: row(5) }), 0);
  ex.sample(0, out);
  assert.equal(out.targets[0], 5);
  assert.equal(out.chunkId, -1);
  ex.accept(result({ targets: row(9), chunk: [row(9), row(10)], chunkHz: 50, chunkStartT: 0.1 }, 3), 0.02);
  ex.sample(0.04, out);
  assert.equal(out.targets[0], 5);
  ex.sample(0.12, out);
  assert.equal(out.targets[0], 10);
});

test("until_next_decision requests on decision ticks; n_steps after k ticks", () => {
  const until = createChunkExecutor({ controlHz: 50, chunkExecute: "until_next_decision", temporalEnsembleM: null });
  assert.equal(until.wantsRequest(true), true);
  assert.equal(until.wantsRequest(false), false);
  const n = createChunkExecutor({ controlHz: 50, chunkExecute: { nSteps: 3 }, temporalEnsembleM: null });
  const out = sample();
  const chunk = Array.from({ length: 20 }, (_, i) => row(i));
  n.accept(result({ targets: chunk[0], chunk, chunkHz: 50, chunkStartT: 0 }, 4), 0);
  const wants = [];
  for (let k = 0; k < 5; k++) { wants.push(n.wantsRequest(false)); n.sample(k * DT, out); }
  assert.deepEqual(wants, [false, false, false, true, false]);
});

test("intent bits follow the intent chunk; grip bits never pass", () => {
  const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "until_next_decision", temporalEnsembleM: null });
  const out = sample();
  ex.accept(result({ targets: row(0), chunk: [row(0), row(0), row(0)], chunkHz: 50, chunkStartT: 0, intentChunk: [0, 1 | 4, 2] }, 5), 0);
  const bits = [0, 1, 2].map((k) => { ex.sample(k * DT, out); return out.intents; });
  assert.deepEqual(bits, [0, 1, 2]);
  ex.accept(result({ targets: row(0), intents: { guard: true, burst: true } }), 0.06);
  ex.sample(0.06, out);
  assert.equal(out.intents, 1 | 32);
});

test("temporal ensemble: exp(-m*i) weights over every chunk covering the tick, oldest first", () => {
  const m = 0.5;
  const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "until_next_decision", temporalEnsembleM: m });
  const out = sample();
  ex.accept(result({ targets: row(0), chunk: Array.from({ length: 10 }, () => row(0)), chunkHz: 50, chunkStartT: 0 }, 1), 0);
  ex.accept(result({ targets: row(1), chunk: Array.from({ length: 10 }, () => row(1)), chunkHz: 50, chunkStartT: 0.04 }, 2), 0.04);
  ex.sample(0.06, out);
  const w0 = 1, w1 = Math.exp(-m);
  assert.ok(Math.abs(out.targets[0] - w1 / (w0 + w1)) < 1e-12);
  assert.equal(out.chunkId, 2);
  ex.sample(0.3, out);
  assert.equal(out.targets[0], 1, "the older chunk has ended");
});

test("reset forgets everything; sample returns false until an action arrives", () => {
  const ex = createChunkExecutor({ controlHz: 50, chunkExecute: "full_chunk", temporalEnsembleM: null });
  const out = sample();
  assert.equal(ex.sample(0, out), false);
  ex.accept(result({ targets: row(1) }), 0);
  assert.equal(ex.sample(0, out), true);
  ex.reset();
  assert.equal(ex.sample(0.02, out), false);
});
