import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import {
  createFakeEngine, createFakeRules, createFakeObservationBuilder, createFakeDelayLine, createFakeChunkExecutor,
  createFakeKinematics, createFakePilot, createFakeRecorder, createFakeSeatDriver, fakeHitstopMsFor,
} from "../src/game/testing/fakes.ts";

const NOW = new Date("2026-09-16T12:00:00Z");

function makeRunner(opts = {}) {
  const recorders = [];
  const engines = [];
  const drivers = [];
  const proxies = [];
  const create = defineHeadlessMatchRunner({
    createChunkExecutor: createFakeChunkExecutor, createDelayLine: createFakeDelayLine, hitstopMsFor: fakeHitstopMsFor,
    hardAbortMs: opts.hardAbortMs,
  });
  const runner = create({
    createEngine: async ({ mode }) => { const e = createFakeEngine({ mode }); engines.push(e); return e; },
    createRules: () => { const r = createFakeRules(); opts.onRules?.(r); return r; },
    kinematics: createFakeKinematics(),
    observations: createFakeObservationBuilder(),
    createSeatDriver: async (spec, seat) => {
      const d = createFakeSeatDriver(seat, { kind: spec.kind, ...(opts.policy?.[seat] ?? {}) });
      drivers.push(d);
      return d;
    },
    createPilot: opts.noPilot ? null : () => createFakePilot("atlas"),
    createProxyBot: opts.noPilot ? null : () => {
      const bot = { updates: 0, reset() {}, update(obs, pilot) { bot.updates++; pilot.targets[0] = Math.sin(obs.t); } };
      proxies.push(bot);
      return bot;
    },
    createRecorder: () => { const r = createFakeRecorder(); recorders.push(r); return r; },
  });
  return { runner, recorders, engines, drivers, proxies };
}

function botConfig(overrides = {}) {
  return buildMatchConfig({
    preset: "harness", context: "suite", seed: 11, bestOf: 1, now: NOW,
    seats: {
      atlas: { driver: { kind: "module", fileName: "public/policies/example-policy.js", source: "", sha256: "e" } },
      blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } },
    },
    ...overrides,
  });
}

describe("headless runner", () => {
  test("runs a full best-of-1 through time-up and sudden death to an episode", async () => {
    const h = makeRunner();
    const ep = await h.runner.run(botConfig());
    assert.equal(ep.meta.result.winner, "atlas");
    assert.deepEqual(ep.meta.result.rounds.map((r) => r.reason), ["time"]);
    assert.equal(ep.meta.timing, "eval");
    assert.equal(ep.meta.preset, "harness");
    const phases = ep.events.filter((e) => e.type === "phase").map((e) => e.phase);
    assert.deepEqual(phases, ["round_intro", "fight", "time_up", "sudden_death", "time_up", "post_match"]);
    assert.ok(h.engines[0].disposed);
    assert.ok(h.drivers.every((d) => d.disposed));
    assert.equal(h.recorders[0].rows[0].discontinuity & 1, 1);
    // 45 s + 20 s of 5 ms steps, one row per 4 steps.
    assert.equal(h.recorders[0].rows.length, (45 + 20) / 0.005 / 4);
  });

  test("the same seed gives the same rows and events", async () => {
    const act = (obs, tick) => ({ targets: [Math.sin(tick / 7), -0.4, 0.9, 0.1, 0, 1] });
    const a = makeRunner({ policy: { atlas: { act } } });
    const b = makeRunner({ policy: { atlas: { act, waitMs: 1 } } });
    const cfg = botConfig();
    await a.runner.run(cfg);
    await b.runner.run(cfg);
    assert.equal(a.engines[0].checksum(), b.engines[0].checksum());
    assert.deepEqual(a.recorders[0].rows.slice(0, 600), b.recorders[0].rows.slice(0, 600));
  });

  test("a hanging policy ends the episode with policy_hang", async () => {
    const h = makeRunner({ policy: { blaze: { hang: true } }, hardAbortMs: 50 });
    const ep = await h.runner.run(botConfig());
    assert.equal(ep.meta.result.error, "policy_hang");
    assert.equal(ep.meta.result.forfeit, "blaze");
    assert.equal(ep.meta.result.winner, "atlas");
    assert.ok(ep.events.some((e) => e.type === "policy_fault" && e.status === "hang"));
  });

  test("abort rejects with AbortError and releases the engine", async () => {
    const ac = new AbortController();
    const h = makeRunner({ policy: { atlas: { act: (obs, tick) => { if (tick === 100) ac.abort(); return { targets: [0, 0, 0, 0, 0, 0] }; } } } });
    await assert.rejects(h.runner.run(botConfig({ bestOf: 5 }), ac.signal), { name: "AbortError" });
    assert.ok(h.engines[0].disposed);
    assert.ok(h.drivers.every((d) => d.disposed));
    assert.equal(h.recorders[0].ended, null);
  });

  test("a proxy seat drives the pilot controller every control tick", async () => {
    const h = makeRunner();
    const ep = await h.runner.run(botConfig({
      preset: "proving_ground",
      seats: { atlas: { driver: { kind: "proxy", bot: "human_proxy" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } } },
    }));
    assert.equal(ep.meta.seats.atlas.driver, "proxy");
    assert.equal(ep.meta.seats.atlas.inputDevice, "synthetic");
    assert.equal(h.proxies[0].updates, h.recorders[0].rows.length);
    assert.ok(h.recorders[0].rows.some((r) => r.applied.atlas[0] !== 0));
  });

  test("refuses human seats and proxy seats without a pilot factory", async () => {
    const h = makeRunner({ noPilot: true });
    await assert.rejects(h.runner.run(botConfig({
      preset: "arcade",
      seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "builtin", personality: "jig", tier: "rookie", dda: false } } },
    })), /HEADLESS NEEDS NO HUMAN/);
    await assert.rejects(h.runner.run(botConfig({
      seats: { atlas: { driver: { kind: "proxy", bot: "human_proxy" } }, blaze: { driver: { kind: "builtin", personality: "jig", tier: "rookie", dda: false } } },
      preset: "proving_ground",
    })), /pilot controller/);
  });
});
