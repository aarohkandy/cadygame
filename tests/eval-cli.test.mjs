import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { UsageError, main, parseArgs, resolvePolicy } from "../scripts/eval.mjs";
import { decodeEpisodeText } from "../src/game/harness/episode-format.ts";
import {
  createFakeChunkExecutor, createFakeDelayLine, createFakeEngine, createFakeKinematics, createFakeObservationBuilder, createFakeRules,
  createFakeSeatDriver, fakeHitstopMsFor,
} from "../src/game/testing/fakes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The fake engine only mirrors setTargets into frame ctrl on step; the real engine does it at once. */
function liveCtrl(engine) {
  const set = engine.setTargets.bind(engine);
  engine.setTargets = (seat, t) => { set(seat, t); const s = engine.saveState(); engine.frame.arms[seat].ctrl.set(s.ctrl.subarray(seat === "atlas" ? 0 : 6, seat === "atlas" ? 6 : 12)); };
  return engine;
}

const fakeServices = () => ({
  createEngine: async ({ mode }) => liveCtrl(createFakeEngine({ mode })),
  createRules: () => createFakeRules(),
  hitstopMsFor: fakeHitstopMsFor, tuning: { fake: true },
  kinematics: createFakeKinematics(),
  createObservationBuilder: () => createFakeObservationBuilder(),
  createDelayLine: createFakeDelayLine,
  createSeatDriver: async (spec, seat) => createFakeSeatDriver(seat, { kind: spec.kind, act: (_o, tick) => ({ targets: [Math.sin(tick / 5), -0.5, 0.9, 0, 0, 1] }) }),
  createPilot: null, createProxyBot: null,
  createChunkExecutor: createFakeChunkExecutor,
  obsSchemaHash: "sha256:fake",
});

describe("eval CLI arguments", () => {
  test("parses flags, inline values, and seed ranges", () => {
    const o = parseArgs(["--suite", "smoke-v1", "--policy=builtin:overshoot:pro", "--seat", "blaze", "--seeds", "2-4", "--out", "x", "--no-verify", "--quiet"]);
    assert.equal(o.suite, "smoke-v1");
    assert.equal(o.policy, "builtin:overshoot:pro");
    assert.equal(o.seat, "blaze");
    assert.deepEqual(o.seeds, [2, 4]);
    assert.equal(o.out, path.resolve("x"));
    assert.equal(o.verify, false);
    assert.deepEqual(parseArgs(["--suite", "smoke-v1", "--policy", "p.js", "--seeds", "5"]).seeds, [5, 5]);
    assert.equal(parseArgs(["--suite", "smoke-v1", "--policy", "p.js"]).out, path.resolve(".eval/smoke-v1"));
  });

  test("rejects bad usage with a UsageError", () => {
    for (const argv of [[], ["--suite", "gauntlet-v2", "--policy", "p.js"], ["--suite", "smoke-v1"], ["--suite", "smoke-v1", "--policy", "p.js", "--seat", "left"],
      ["--suite", "smoke-v1", "--policy", "p.js", "--seeds", "4-2"], ["--suite", "smoke-v1", "--policy", "p.js", "--bogus"], ["--suite"]]) {
      assert.throws(() => parseArgs(argv), UsageError, argv.join(" "));
    }
  });

  test("resolves every policy kind into a driver spec", async () => {
    assert.deepEqual(await resolvePolicy("builtin:deadband"), { kind: "builtin", personality: "deadband", tier: "contender", dda: false });
    const bridge = await resolvePolicy("ws://127.0.0.1:8765");
    assert.equal(bridge.kind, "bridge");
    assert.equal(bridge.allowLan, false);
    assert.equal((await resolvePolicy("ws://192.168.1.20:8765")).allowLan, true);
    const mod = await resolvePolicy("public/policies/example-policy.js", ROOT);
    const text = await readFile(path.join(ROOT, "public/policies/example-policy.js"), "utf8");
    assert.equal(mod.kind, "module");
    assert.equal(mod.fileName, path.join(ROOT, "public/policies/example-policy.js"));
    assert.equal(mod.sha256, createHash("sha256").update(text).digest("hex"));
    await assert.rejects(resolvePolicy("builtin:nobody"), UsageError);
    await assert.rejects(resolvePolicy("proxy:human_proxy"), UsageError);
    await assert.rejects(resolvePolicy("missing-file.js"), UsageError);
    await assert.rejects(resolvePolicy("README.md", ROOT), UsageError);
  });
});

describe("eval CLI run", () => {
  test("writes 6 episodes and results.json with the seed-bootstrap win rate, exit 0", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "tl-eval-"));
    const lines = [];
    try {
      const code = await main(["--suite", "smoke-v1", "--policy", "builtin:backlash", "--out", out], {
        services: fakeServices(), stdout: (l) => lines.push(l), stderr: (l) => lines.push(`ERR ${l}`), harnessCommit: "test",
      });
      assert.equal(code, 0, lines.join("\n"));
      const files = await readdir(out);
      const episodes = files.filter((f) => f.endsWith(".tlep.json"));
      assert.equal(episodes.length, 6);
      assert.ok(files.includes("results.json"));
      const results = JSON.parse(await readFile(path.join(out, "results.json"), "utf8"));
      assert.equal(results.format, "torquelimit.eval-results/1");
      assert.equal(results.suite, "smoke-v1");
      assert.equal(results.aggregate.seeds, 3);
      assert.ok(typeof results.aggregate.ciLow === "number" && typeof results.aggregate.ciHigh === "number");
      assert.match(results.winRate, /^\d+% \(\d+–\d+\) · 3 SEEDS$/);
      assert.equal(results.pass, true);
      assert.equal(results.cells.length, 6);
      assert.equal(results.provenance.harnessCommit, "test");
      assert.equal(results.verify.verdict, "bit_exact");
      assert.equal(results.provenance.tuningSha256.length, 64);
      const ep = decodeEpisodeText(await readFile(path.join(out, episodes[0]), "utf8"));
      assert.equal(ep.meta.timing, "eval");
      assert.ok(lines.some((l) => l.startsWith("SMOKE PASSED")), lines.join("\n"));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  test("exit 2 on bad arguments, exit 1 when a gate fails", async () => {
    const err = [];
    assert.equal(await main(["--suite", "nope", "--policy", "x"], { stderr: (l) => err.push(l), stdout: () => {} }), 2);
    assert.match(err[0], /unknown suite/);
    const out = await mkdtemp(path.join(tmpdir(), "tl-eval-"));
    try {
      const services = fakeServices();
      services.createEngine = async ({ mode }) => createFakeEngine({ mode });   // without live ctrl the replay cannot verify
      const code = await main(["--suite", "smoke-v1", "--policy", "builtin:backlash", "--seeds", "1", "--seat", "atlas", "--out", out, "--quiet"], {
        services, stdout: () => {}, stderr: () => {}, harnessCommit: "test",
      });
      assert.equal(code, 1);
      const results = JSON.parse(await readFile(path.join(out, "results.json"), "utf8"));
      assert.equal(results.pass, false);
      assert.equal(results.gates.find((g) => g.name === "REPLAY BIT-EXACT").pass, false);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  const stubbed = spawnSync(process.execPath, ["scripts/check-stubs.mjs"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "";
  const gameBuilt = !/src\/game\/(physics|combat|policy|input\/pilot-controller|kinematics)/.test(stubbed);

  test("the real command: node scripts/eval.mjs --suite smoke-v1 --policy public/policies/example-policy.js", { skip: gameBuilt ? false : "physics, rules, or policy runtime still stubbed", timeout: 170_000 }, async () => {
    const out = await mkdtemp(path.join(tmpdir(), "tl-smoke-"));
    try {
      const run = spawnSync(process.execPath, ["scripts/eval.mjs", "--suite", "smoke-v1", "--policy", "public/policies/example-policy.js", "--out", out], { cwd: ROOT, encoding: "utf8", timeout: 160_000 });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
      const files = await readdir(out);
      assert.equal(files.filter((f) => f.endsWith(".tlep.json")).length, 6);
      const results = JSON.parse(await readFile(path.join(out, "results.json"), "utf8"));
      assert.equal(results.pass, true);
      assert.equal(results.verify.verdict, "bit_exact");
      assert.match(run.stdout, /SMOKE PASSED/);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
