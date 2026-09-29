import assert from "node:assert/strict";
import { test } from "node:test";
import { JOINT_LIMITS } from "../src/game/contracts.ts";
import { clampToLimits, intentBitsOf, MAX_INFO_BYTES, validateAction } from "../src/game/policy/action-validation.ts";

const opts = { defaultChunkHz: 50 };
const home = [0, -1.0, 1.0, 0.5, 0, 0.04];

test("legacy arrays and PolicyAction objects validate to the same targets", () => {
  const a = validateAction(home, opts);
  const b = validateAction({ targets: home }, opts);
  assert.equal(a.status, "ok");
  assert.deepEqual(a.action.targets, home);
  assert.deepEqual(b.action.targets, home);
  const typed = validateAction(new Float32Array(home), opts);
  assert.equal(typed.status, "ok");
});

test("NaN, Infinity, wrong length and junk are errors that name the problem", () => {
  assert.equal(validateAction([0, 0, NaN, 0, 0, 0], opts).status, "error");
  assert.match(validateAction([0, 0, NaN, 0, 0, 0], opts).error, /NaN at targets\[2\] \(elbow_flex\)/);
  assert.match(validateAction([0, 0, 0, Infinity, 0, 0], opts).error, /Infinity/);
  assert.match(validateAction([0, 0, 0, 0, 0, 0, 0], opts).error, /7 numbers, expected 6/);
  assert.equal(validateAction(undefined, opts).status, "error");
  assert.equal(validateAction("go", opts).status, "error");
  assert.equal(validateAction({ intents: { guard: true } }, opts).status, "error");
  assert.equal(validateAction({ targets: home, chunk: [[0, 0, 0]] }, opts).status, "error");
  assert.equal(validateAction({ targets: home, chunk: [home], chunkHz: 0 }, opts).status, "error");
  assert.equal(validateAction({ targets: home, chunk: [home, home], intentChunk: [1] }, opts).status, "error");
});

test("exact clamp: within 1e-5 rad is ok, beyond is clamped with the overshoot recorded", () => {
  const hi = JOINT_LIMITS[2][1];
  const tiny = validateAction([0, 0, hi + 5e-6, 0, 0, 0], opts);
  assert.equal(tiny.status, "ok");
  assert.equal(tiny.action.targets[2], hi);
  assert.ok(Math.abs(tiny.maxOvershoot - 5e-6) < 1e-12);
  const float32Limit = validateAction([0, 0, Math.fround(hi), 0, 0, 0], opts);
  assert.equal(float32Limit.status, "ok");
  const over = validateAction([0, 0, hi + 0.2, 0, 0, 0], opts);
  assert.equal(over.status, "clamped");
  assert.equal(over.action.targets[2], hi);
  assert.deepEqual(over.violations.map((v) => v.joint), [2]);
  assert.match(over.error, /elbow_flex \+0\.2000 rad/);
});

test("chunks are clamped entry by entry, targets default to chunk[0], grip intents are dropped", () => {
  const lo = JOINT_LIMITS[0][0];
  const r = validateAction({ chunk: [[lo - 1, 0, 0, 0, 0, 0], home], intentChunk: [1 | 4, 2], intents: { guard: true, grip: true, charge: true } }, opts);
  assert.equal(r.status, "clamped");
  assert.deepEqual(r.action.targets, [lo, 0, 0, 0, 0, 0]);
  assert.equal(r.action.chunk[0][0], lo);
  assert.equal(r.action.chunkHz, 50);
  assert.deepEqual(r.action.intentChunk, [1, 2]);
  assert.deepEqual(r.action.intents, { guard: true, charge: true });
  assert.equal(intentBitsOf({ guard: true, grip: true, burst: true }), 1 | 32);
});

test("does not mutate the policy's own arrays, caps info at 4 KB", () => {
  const raw = { targets: [9, 0, 0, 0, 0, 0], info: { big: "x".repeat(MAX_INFO_BYTES + 10) } };
  const r = validateAction(raw, opts);
  assert.equal(raw.targets[0], 9);
  assert.deepEqual(r.action.info, { truncated: true, bytes: JSON.stringify(raw.info).length });
  assert.deepEqual(validateAction({ targets: home, info: { entropy: 0.1 } }, opts).action.info, { entropy: 0.1 });
});

test("clampToLimits honours a margin", () => {
  const v = [5, -5, 0, 0, 0, 0];
  clampToLimits(v, 0.01);
  assert.ok(Math.abs(v[0] - (JOINT_LIMITS[0][1] - 0.01)) < 1e-12);
  assert.ok(Math.abs(v[1] - (JOINT_LIMITS[1][0] + 0.01)) < 1e-12);
});
