import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { JOINT_LIMITS } from "../src/game/contracts.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createHeadlessMatchRunner } from "../src/game/loop/headless-runner.ts";
import { buildMatchConfig } from "../src/game/match/match-config.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { validateAction } from "../src/game/policy/action-validation.ts";
import { createInProcessSeatDriver } from "../src/game/policy/in-process-driver.ts";
import { createObservationBuilder, emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";
import { createFakeRecorder } from "../src/game/testing/fakes.ts";

const PATH = "public/policies/example-policy.js";
const policy = await import(`../${PATH}`);

describe("public/policies/example-policy.js", () => {
  test("obs/3 module contract: policyName, provenance, reset(ctx), act(obs) → valid actions", () => {
    assert.equal(typeof policy.policyName, "string");
    assert.equal(typeof policy.reset, "function");
    assert.equal(typeof policy.act, "function");
    policy.reset(registrationContext("atlas", 1));
    const o = emptyObservation("atlas");
    o.opponent.ee.pos = [0.36, 0.05, 0.15];
    o.self.ee.pos = [0.26, 0, 0.15];
    for (let i = 0; i < 100; i++) {
      o.t = i * 0.04;
      const v = validateAction(policy.act(o), { defaultChunkHz: 50 });
      assert.equal(v.status, "ok", v.error ?? "");
      for (let j = 0; j < 6; j++) assert.ok(v.action.targets[j] >= JOINT_LIMITS[j][0] && v.action.targets[j] <= JOINT_LIMITS[j][1]);
    }
  });

  test("guards, then jabs every 1.2 s aimed at the opponent's hand", () => {
    policy.reset(registrationContext("blaze", 1));
    const o = emptyObservation("blaze");
    o.self.ee.pos = [0.26, 0, 0.15];
    o.opponent.ee.pos = [0.4, 0.1, 0.15];
    const lifts = [];
    let jabs = 0, prevJab = false;
    for (let i = 0; i <= 150; i++) {
      o.t = 10 + i * 0.02;
      const a = policy.act(o);
      const jab = a.targets[1] > 0;
      if (jab && !prevJab) jabs++;
      prevJab = jab;
      lifts.push(a.targets[1]);
      assert.ok(a.targets[0] < 0, "pans toward +y (negative pan)");
      assert.equal(a.intents.guard, !jab && Math.hypot(0.14, 0.1) < 0.3);
    }
    assert.equal(jabs, 2, "two jabs in 3 s");
  });

  test("plays a full PROVING GROUND match against a built-in opponent", async () => {
    const probe = await createPhysicsEngine({ mode: "harness", nodeFsRoot: process.cwd() });
    const observations = createObservationBuilder(probe.info);
    probe.dispose();
    const recorders = [];
    const runner = createHeadlessMatchRunner({
      createEngine: (o) => createPhysicsEngine({ ...o, nodeFsRoot: process.cwd() }), createRules: createCombatRules, kinematics: createKinematics(),
      observations, createSeatDriver: createInProcessSeatDriver, createPilot: null, createProxyBot: null,
      createRecorder: () => { const r = createFakeRecorder(); recorders.push(r); return r; },
    });
    const source = fs.readFileSync(PATH, "utf8");
    const ep = await runner.run(buildMatchConfig({
      preset: "proving_ground", context: "lab", seed: 2026, bestOf: 3, now: new Date("2026-09-16T12:00:00Z"),
      seats: { atlas: { driver: { kind: "module", fileName: PATH, source, sha256: "example" } }, blaze: { driver: { kind: "builtin", personality: "backlash", tier: "contender", dda: false } } },
    }));
    assert.ok(ep.meta.result.winner);
    assert.ok(ep.meta.result.rounds.length >= 2);
    assert.equal(ep.meta.seats.atlas.name, "example guard + jab");
    const statuses = recorders[0].rows.map((r) => r.status.atlas);
    assert.ok(!statuses.includes("error") && !statuses.includes("clamped"), "never faults");
  });
});
