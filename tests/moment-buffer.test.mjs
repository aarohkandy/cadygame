import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MOMENT_HZ, MOMENT_SECONDS, createMomentBuffer } from "../src/game/harness/moment-buffer.ts";

function state(t, n = 3) {
  return { time: t, qpos: new Float64Array(n).fill(t), qvel: new Float64Array(n).fill(-t), ctrl: new Float64Array(2).fill(t * 2), qacc_warmstart: new Float64Array(n), servo: new Float64Array(6).fill(1) };
}

describe("moment buffer", () => {
  test("holds the last 6.0 s at 50 Hz and drops older states", () => {
    const buf = createMomentBuffer();
    assert.equal(buf.capacity, MOMENT_SECONDS * MOMENT_HZ + 1);
    for (let i = 0; i <= 1000; i++) buf.push(i / 50, state(i / 50));
    assert.equal(buf.size, buf.capacity);
    const span = buf.span();
    assert.ok(Math.abs(span.to - 20) < 1e-12);
    assert.ok(Math.abs(span.to - span.from - 6) < 1e-9);
  });

  test("copies on push: the caller may reuse its SimState", () => {
    const buf = createMomentBuffer();
    const s = state(0);
    for (let i = 0; i < 10; i++) {
      s.time = i / 50; s.qpos.fill(i);
      buf.push(i / 50, s);
    }
    const clip = buf.clip(0.1, 1, 1);
    assert.deepEqual(clip.frames.map((f) => f.qpos[0]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("clip returns an ordered window around the event as independent copies", () => {
    const buf = createMomentBuffer();
    for (let i = 0; i < 600; i++) buf.push(i / 50, state(i / 50));
    const clip = buf.clip(9.0, 2.5, 1.2);
    assert.equal(clip.eventT, 9.0);
    assert.ok(Math.abs(clip.times[0] - 6.5) < 1e-9);
    assert.ok(Math.abs(clip.times.at(-1) - 10.2) < 1e-9);
    assert.equal(clip.frames.length, clip.times.length);
    for (let i = 1; i < clip.times.length; i++) assert.ok(clip.times[i] > clip.times[i - 1]);
    clip.frames[0].qpos[0] = 999;
    assert.notEqual(buf.clip(6.5, 0, 0).frames[0].qpos[0], 999);
  });

  test("a reset (time going backwards) starts a fresh window; clear empties it", () => {
    const buf = createMomentBuffer();
    for (let i = 0; i < 100; i++) buf.push(i / 50, state(i / 50));
    buf.push(0, state(0));
    assert.equal(buf.size, 1);
    buf.clear();
    assert.equal(buf.size, 0);
    assert.equal(buf.span(), null);
    assert.deepEqual(buf.clip(1, 1, 1).frames, []);
  });

  test("steady-state pushes reuse their slots", () => {
    const buf = createMomentBuffer(0.1, 50);
    const first = [];
    for (let i = 0; i < 40; i++) {
      buf.push(i / 50, state(i / 50));
      if (i === 6) first.push(buf.clip(0, 10, 10).frames.length);
    }
    assert.equal(buf.size, buf.capacity);
    assert.equal(first[0], buf.capacity);
  });
});
