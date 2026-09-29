import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { createPilotController } from "../src/game/input/pilot-controller.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createInProcessSeatDriver } from "../src/game/policy/in-process-driver.ts";
import { createObservationBuilder } from "../src/game/policy/observation.ts";
import { createProxyBot, PROXY_BOT_IDS } from "../src/game/policy/proxy-bots/index.ts";
import { createFakeRecorder } from "../src/game/testing/fakes.ts";

const ROOT = process.cwd();

async function playProxyMatch(seed) {
  const probe = await createPhysicsEngine({ mode: "harness", nodeFsRoot: ROOT });
  const observations = createObservationBuilder(probe.info);
  probe.dispose();
  const bots = [];
  let recorder = null;
  const runner = createHeadlessMatchRunner({
    createEngine: (o) => createPhysicsEngine({ ...o, nodeFsRoot: ROOT }), createRules: createCombatRules, kinematics: createKinematics(),
    observations, createSeatDriver: createInProcessSeatDriver,
    createPilot: createPilotController,
    createProxyBot: (id) => { const b = createProxyBot(id); bots.push(b); return b; },
    createRecorder: () => { recorder = createFakeRecorder(); return recorder; },
  });
  const cfg = buildMatchConfig({
    preset: "proving_ground", context: "suite", seed, bestOf: 1, now: new Date("2026-09-16T12:00:00Z"),
    seats: { atlas: { driver: { kind: "proxy", bot: "human_proxy" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } } },
  });
  const ep = await runner.run(cfg);
  return { ep, rows: recorder.rows, bot: bots[0] };
}

describe("proxy bots", () => {
  test("only human_proxy ships (BUILD_PLAN D3)", () => {
    assert.deepEqual(PROXY_BOT_IDS, ["human_proxy"]);
    const bot = createProxyBot("human_proxy");
    assert.equal(typeof bot.reset, "function");
    assert.equal(typeof bot.update, "function");
  });

  test("human_proxy completes a Proving Ground match against BACKLASH Contender through the real PilotController, identically twice", async () => {
    const a = await playProxyMatch(4040);
    assert.ok(a.ep.meta.result.winner, "the match finished");
    assert.ok(a.bot.inputCount > 100, `proxy sent ${a.bot.inputCount} inputs`);
    const fight = a.rows.filter((r) => r.phase === "fight");
    const pans = new Set(fight.map((r) => r.applied.atlas[0].toFixed(3)));
    assert.ok(pans.size > 20, "the proxy actually moved the arm");
    assert.equal(a.ep.meta.seats.atlas.inputDevice, "synthetic");

    const b = await playProxyMatch(4040);
    assert.equal(b.bot.inputDigest, a.bot.inputDigest, "same synthetic input stream");
    assert.equal(b.rows.length, a.rows.length);
    for (let i = 0; i < a.rows.length; i++) assert.deepEqual(b.rows[i].applied.atlas, a.rows[i].applied.atlas, `ctrl differs at row ${i}`);
    assert.deepEqual(b.ep.meta.result, a.ep.meta.result);
  });
});
