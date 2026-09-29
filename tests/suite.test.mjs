import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { createRecorder } from "../src/game/harness/recorder.ts";
import { computeStats } from "../src/game/harness/stats.ts";
import { createEpisodeStoreOn } from "../src/game/harness/episode-store.ts";
import { createMemoryBackend } from "../src/game/harness/idb.ts";
import { SUITES, policyLabel, runSuite, suiteCells } from "../src/game/harness/suite.ts";
import { createHarnessApi } from "../src/game/harness/harness-api.ts";
import {
  createFakeChunkExecutor, createFakeDelayLine, createFakeEngine, createFakeKinematics, createFakeObservationBuilder, createFakeRules,
  createFakeSeatDriver, fakeHitstopMsFor,
} from "../src/game/testing/fakes.ts";

const POLICY = { kind: "module", fileName: "/abs/example-policy.js", source: "export function act(){}", sha256: "e".repeat(64) };

function fakeRunner(runs) {
  return defineHeadlessMatchRunner({ createChunkExecutor: createFakeChunkExecutor, createDelayLine: createFakeDelayLine, hitstopMsFor: fakeHitstopMsFor })({
    createEngine: async ({ mode }) => createFakeEngine({ mode }),
    createRules: () => {
      // The policy seat (whichever holds the module) wins by integrity at time.
      const r = createFakeRules();
      r.script = (step, _t, state) => { if (step === 10) state.seats[runs.at(-1).policySeat === "atlas" ? "blaze" : "atlas"].integrity = 60; return null; };
      return r;
    },
    kinematics: createFakeKinematics(), observations: createFakeObservationBuilder(),
    createSeatDriver: async (spec, seat) => {
      if (spec.kind === "module") runs.push({ policySeat: seat });
      return createFakeSeatDriver(seat, { kind: spec.kind });
    },
    createPilot: null, createProxyBot: null, createRecorder,
  });
}

describe("smoke-v1 suite", () => {
  test("cells: seeds 1-3 x Contender x both seats, one personality per seed", () => {
    const cells = suiteCells({ suite: "smoke-v1", policySeat: "both" });
    assert.equal(cells.length, 6);
    assert.deepEqual(cells.map((c) => `${c.seed}${c.policySeat[0]}:${c.opponentLabel}`), [
      "1a:OVERSHOOT CONTENDER", "1b:OVERSHOOT CONTENDER", "2a:BACKLASH CONTENDER", "2b:BACKLASH CONTENDER", "3a:DEADBAND CONTENDER", "3b:DEADBAND CONTENDER",
    ]);
    assert.ok(cells.every((c) => c.opponent.tier === "contender" && c.opponent.dda === false));
    assert.equal(suiteCells({ suite: "smoke-v1", policySeat: "blaze", seeds: [4, 7] }).length, 4);
    assert.equal(suiteCells({ suite: "smoke-v1", policySeat: "blaze", seeds: [4, 4] })[0].opponent.personality, "overshoot");
    assert.throws(() => suiteCells({ suite: "gauntlet-v2", policySeat: "both" }), /unknown suite/);
    assert.throws(() => suiteCells({ suite: "smoke-v1", policySeat: "both", seeds: [3, 1] }), /not valid/);
    assert.equal(SUITES["smoke-v1"].preset, "harness");
  });

  test("runs every cell headless in eval, keeps episodes, reports progress, aggregate, and gates", async () => {
    const runs = [];
    const store = createEpisodeStoreOn(createMemoryBackend());
    const progress = [];
    let verified = 0;
    const result = await runSuite({
      suite: "smoke-v1", policySeat: "both", policy: POLICY, keepEpisodes: true,
      onProgress: (done, total, summary) => progress.push([done, total, summary.id]),
    }, {
      runner: fakeRunner(runs), store, computeStats, now: () => new Date("2026-09-16T12:00:00Z"),
      verify: async () => { verified++; return { verdict: "bit_exact", divergedFrame: null, divergedT: null, eventMismatch: null, checkedFrames: 1, message: "ok" }; },
    });
    assert.equal(result.suite, "smoke-v1");
    assert.equal(result.episodes.length, 6);
    assert.equal(new Set(result.episodes).size, 6, "unique ids per cell");
    assert.match(result.episodes[0], /^smoke-v1-2026-09-16T12:00:00Z-s1-atlas$/);
    assert.deepEqual(progress.map((p) => p[0]), [1, 2, 3, 4, 5, 6]);
    assert.equal((await store.list()).length, 6);
    assert.equal(verified, 1);
    assert.equal(result.aggregate.seeds, 3);
    assert.equal(result.aggregate.winRate, 1);
    assert.deepEqual(result.cells.map((c) => c.winner === c.seat), [true, true, true, true, true, true]);
    assert.deepEqual(result.gates.map((g) => [g.name, g.pass]), [["MATCHES COMPLETE", true], ["POLICY HANGS", true], ["POLICY ERRORS", true], ["POLICY DISCONNECTS", true], ["REPLAY BIT-EXACT", true]]);
    const ep = await store.load(result.episodes[1]);
    assert.equal(ep.meta.timing, "eval");
    assert.equal(ep.meta.preset, "harness");
    assert.equal(ep.meta.seats.blaze.driver, "module");
  });

  test("a diverged verify fails its gate; a human policy and an aborted run are refused", async () => {
    const runs = [];
    const result = await runSuite({ suite: "smoke-v1", policySeat: "atlas", policy: POLICY, seeds: [1, 1], keepEpisodes: false, onProgress: () => {} }, {
      runner: fakeRunner(runs), store: null, computeStats,
      verify: async () => ({ verdict: "diverged", divergedFrame: 3, divergedT: 0.06, eventMismatch: null, checkedFrames: 3, message: "DIVERGED" }),
    });
    assert.equal(result.gates.find((g) => g.name === "REPLAY BIT-EXACT").pass, false);
    await assert.rejects(runSuite({ suite: "smoke-v1", policySeat: "atlas", policy: { kind: "human" }, keepEpisodes: false, onProgress: () => {} }, { runner: fakeRunner([]), store: null, computeStats }), /human/);
    const ctl = new AbortController();
    ctl.abort();
    await assert.rejects(runSuite({ suite: "smoke-v1", policySeat: "atlas", policy: POLICY, keepEpisodes: false, onProgress: () => {}, signal: ctl.signal }, { runner: fakeRunner([]), store: null, computeStats }), (e) => e.name === "AbortError");
  });

  test("HarnessApi.runSuite runs the suite through its runner and store", async () => {
    const runs = [];
    const store = createEpisodeStoreOn(createMemoryBackend());
    const api = createHarnessApi({
      createEngine: async ({ mode }) => createFakeEngine({ mode }), createRules: () => createFakeRules(), createSeatDriver: async () => null,
      observations: createFakeObservationBuilder(), runner: fakeRunner(runs), store, entrants: null,
    });
    const result = await api.runSuite({ suite: "smoke-v1", policySeat: "blaze", policy: POLICY, seeds: [2, 2], keepEpisodes: true, onProgress: () => {} });
    assert.equal(result.episodes.length, 1);
    assert.equal((await store.list()).length, 1);
    assert.equal(policyLabel(POLICY), "/abs/example-policy.js");
    assert.equal(policyLabel({ kind: "bridge", url: "ws://127.0.0.1:8765", allowLan: false, sessionId: "s" }), "ws://127.0.0.1:8765");
  });
});
