import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrajectoryPolicy, parseTrajectory, sampleTrajectory, TrajectoryFormatError } from "../src/game/policy/trajectory.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";

const frames = (n) => Array.from({ length: n }, (_, i) => [i, -i, i / 2, 0, 0, 0.04]);

test("parses fps and frames, keeps the optional name", () => {
  const tr = parseTrajectory(JSON.stringify({ fps: 10, frames: frames(11), name: "wave" }));
  assert.equal(tr.frameCount, 11);
  assert.equal(tr.durationS, 1);
  assert.equal(tr.name, "wave");
});

test("rejects bad files with a specific reason", () => {
  const bad = (doc, re) => assert.throws(() => parseTrajectory(typeof doc === "string" ? doc : JSON.stringify(doc)), (e) => e instanceof TrajectoryFormatError && re.test(e.message));
  bad("{nope", /not JSON/);
  bad({ frames: frames(2) }, /fps/);
  bad({ fps: 0.5, frames: frames(2) }, /outside 1–240/);
  bad({ fps: 241, frames: frames(2) }, /outside 1–240/);
  bad({ fps: 30, frames: [] }, /empty/);
  bad({ fps: 30, frames: [[1, 2, 3]] }, /frame 0 has 3 values/);
  bad({ fps: 30, frames: [[0, 0, 0, 0, 0, "x"]] }, /joint 5/);
  const big = `{"fps":30,"frames":[${Array.from({ length: 100_001 }, () => "[0,0,0,0,0,0]").join(",")}]}`;
  bad(big, /100001 frames, max 100000/);
});

test("linear interpolation, clamped at both ends", () => {
  const tr = parseTrajectory(JSON.stringify({ fps: 10, frames: frames(3) }));
  const out = new Float64Array(6);
  sampleTrajectory(tr, 0.05, out);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-12 && Math.abs(out[1] + 0.5) < 1e-12);
  sampleTrajectory(tr, -1, out);
  assert.equal(out[0], 0);
  sampleTrajectory(tr, 9, out);
  assert.equal(out[0], 2);
});

test("as a policy: round time from the first observation, chunk at the control rate", () => {
  const tr = parseTrajectory(JSON.stringify({ fps: 100, frames: frames(101) }));
  const p = createTrajectoryPolicy(tr);
  p.reset({ control_hz: 50, decision_hz: 25 });
  const obs = emptyObservation();
  obs.t = 7.0;
  let a = p.act(obs);
  assert.equal(a.chunk.length, 3);
  assert.equal(a.chunkHz, 50);
  assert.equal(a.chunkStartT, 7);
  assert.equal(a.targets[0], 0);
  obs.t = 7.5;
  a = p.act(obs);
  assert.ok(Math.abs(a.targets[0] - 50) < 1e-9);
  assert.ok(Math.abs(a.chunk[2][0] - 54) < 1e-9);
});
