import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createInProcessSeatDriver, createResultMailbox, PolicyHangError } from "../src/game/policy/in-process-driver.ts";
import { createObservationBuilder, emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";
import { createSeatDriver } from "../src/game/policy/seat-drivers.ts";
import { createFakeRecorder } from "../src/game/testing/fakes.ts";

const moduleSpec = (fileName, source) => ({ kind: "module", fileName, source, sha256: "t" });
const ctx = (mode = "live") => ({ ...registrationContext("blaze", 5), mode });

async function actOnce(driver, t = 1, tick = 10) {
  const o = emptyObservation("blaze");
  o.t = t; o.tick = tick; o.frame_index = tick;
  driver.request(o, tick);
  return driver.waitForResult(5000);
}

describe("seat drivers: worker safety (the same validation on every transport)", () => {
  test("throw, NaN, and 7 numbers are errors that keep the last safe targets; the driver keeps serving", async () => {
    const source = `
      let n = 0;
      export function act(obs) {
        n++;
        if (n === 1) throw new Error("boom");
        if (n === 2) return [0, NaN, 0, 0, 0, 0.04];
        if (n === 3) return [0, 0, 0, 0, 0, 0.04, 1];
        return [0.1, -0.5, 0.9, 0.2, 0, 0.04];
      }`;
    const d = await createInProcessSeatDriver(moduleSpec("unsafe.mjs", source), "blaze", {});
    await d.reset(ctx());
    const home = ctx().home_pose;
    const thrown = await actOnce(d);
    assert.equal(thrown.status, "error");
    assert.match(thrown.error, /boom/);
    assert.deepEqual(thrown.action.targets, home.slice(0, 6));
    const nan = await actOnce(d, 1.04, 12);
    assert.equal(nan.status, "error");
    assert.match(nan.error, /NaN/);
    const seven = await actOnce(d, 1.08, 14);
    assert.equal(seven.status, "error");
    assert.match(seven.error, /7 numbers/);
    const ok = await actOnce(d, 1.12, 16);
    assert.equal(ok.status, "ok");
    assert.deepEqual(ok.action.targets, [0.1, -0.5, 0.9, 0.2, 0, 0.04]);
    d.dispose();
  });

  test("a 600 ms act: nothing to poll while it runs (live timeout is the sim-driver's), the slow reply still arrives", async () => {
    const source = `export async function act(obs) { await new Promise((r) => setTimeout(r, 600)); return [0, 0, 0, 0, 0, 0.04]; }`;
    const d = await createInProcessSeatDriver(moduleSpec("sleepy.mjs", source), "blaze", {});
    await d.reset(ctx());
    const o = emptyObservation("blaze");
    d.request(o, 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.poll(), null);
    const r = await d.waitForResult(5000);
    assert.equal(r.status, "ok");
    assert.ok(r.computeMs >= 590, `computeMs ${r.computeMs}`);
    d.dispose();
  });

  test("stale replies are dropped: only the newest request's result is delivered", () => {
    const box = createResultMailbox();
    const s1 = box.begin();
    const s2 = box.begin();
    box.deliver(s1, { tick: 1, status: "ok" });
    assert.equal(box.poll(), null);
    box.deliver(s2, { tick: 2, status: "ok" });
    assert.equal(box.poll().tick, 2);
    assert.equal(box.poll(), null, "each result is returned once");
  });

  test("lockstep waits indefinitely but aborts a hang after hardAbortMs", async () => {
    const d = await createInProcessSeatDriver(moduleSpec("hang.mjs", "export function act() { return new Promise(() => {}); }"), "blaze", {});
    await d.reset(ctx("eval"));
    d.request(emptyObservation("blaze"), 0);
    await assert.rejects(d.waitForResult(120), PolicyHangError);
    d.dispose();
  });

  test("chunk results carry an id and chunkStartT defaults to the observation time; policy grip intents never pass", async () => {
    const source = `export function act(obs) { return { chunk: [[0,0,0,0,0,0.04],[0,0,0,0,0,1.1]], intents: { grip: true, guard: true } }; }`;
    const d = await createInProcessSeatDriver(moduleSpec("chunky.mjs", source), "atlas", {});
    await d.reset(ctx());
    const r = await actOnce(d, 2.5, 20);
    assert.ok(r.chunkId > 0);
    assert.equal(r.action.chunkStartT, 2.5);
    assert.equal(r.action.chunkHz, 50);
    assert.deepEqual(r.action.intents, { guard: true });
    d.dispose();
  });

  test("two seats importing the same module file get separate module instances", async () => {
    const src = "let calls = 0; export function act() { calls++; return [calls * 0.01, 0, 0, 0, 0, 0.04]; }";
    const a = await createInProcessSeatDriver(moduleSpec("shared.mjs", src), "atlas", {});
    const b = await createInProcessSeatDriver(moduleSpec("shared.mjs", src), "blaze", {});
    await a.reset(ctx()); await b.reset(ctx());
    await actOnce(a); await actOnce(a);
    const rb = await actOnce(b);
    assert.equal(rb.action.targets[0], 0.01);
    a.dispose(); b.dispose();
  });

  test("without Worker (Node), createSeatDriver falls back to the in-process drivers for every kind", async () => {
    assert.equal(typeof globalThis.Worker, "undefined");
    const builtin = await createSeatDriver({ kind: "builtin", personality: "deadband", tier: "pro", dda: false }, "blaze");
    assert.equal(builtin.kind, "builtin");
    await builtin.reset({ ...ctx(), config: { personality: "deadband", tier: "pro", dda: false } });
    const r = await actOnce(builtin, 0.04, 2);
    assert.equal(r.status, "ok");
    assert.equal(r.action.chunk.length, 3);
    builtin.dispose();
    const tr = await createSeatDriver({ kind: "trajectory", fileName: "t.json", json: JSON.stringify({ fps: 10, frames: [[0, 0, 0, 0, 0, 0.04]] }), sha256: "x" }, "atlas");
    assert.equal(tr.kind, "trajectory");
    tr.dispose();
  });
});

describe("seat drivers in a real headless match", () => {
  test("a lenient Proving Ground match survives a module that throws, and an eval sleeper decides exactly like a fast twin", async () => {
    const recorders = [];
    const probe = await createPhysicsEngine({ mode: "harness", nodeFsRoot: process.cwd() });
    const obs = createObservationBuilder(probe.info);
    probe.dispose();
    const run = (source) => createHeadlessMatchRunner({
      createEngine: (o) => createPhysicsEngine({ ...o, nodeFsRoot: process.cwd() }), createRules: createCombatRules, kinematics: createKinematics(),
      observations: obs, createSeatDriver: createInProcessSeatDriver, createPilot: null, createProxyBot: null,
      createRecorder: () => { const r = createFakeRecorder(); recorders.push(r); return r; },
    }).run(buildMatchConfig({
      preset: "proving_ground", context: "lab", seed: 77, bestOf: 1, now: new Date("2026-09-16T12:00:00Z"),
      seats: { atlas: { driver: moduleSpec("m.mjs", source) }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "rookie", dda: false } } },
    }));
    const guard = "[0, -1.586, 1.302, 0.583, 0, 0.04]";
    const thrower = await run(`let n = 0; export function act() { n++; if (n % 25 === 0) throw new Error("flaky"); return ${guard}; }`);
    assert.ok(thrower.meta.result.winner, "the match finished");
    assert.ok(recorders.at(-1).rows.some((r) => r.status.atlas === "error"), "errors were recorded");

    const sleeper = await run(`let n = 0; export async function act() { n++; if (n === 3 || n === 40) await new Promise((r) => setTimeout(r, 600)); return ${guard}; }`);
    const sleeperRows = recorders.at(-1).rows;
    const fast = await run(`export function act() { return ${guard}; }`);
    assert.deepEqual(sleeper.meta.result.rounds, fast.meta.result.rounds, "same outcome");
    assert.ok(sleeperRows.some((r) => r.status.atlas === "slow"), "the sleeping decisions are marked slow");
  });
});
