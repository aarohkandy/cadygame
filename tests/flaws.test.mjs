import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clearDdaLedger } from "../src/game/policy/opponent/dda.ts";
import { createOpponent } from "../src/game/policy/opponent/index.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

function ctx(personality, tier, seed) {
  const c = registrationContext("blaze", seed);
  return { ...c, mode: "live", preset: "arcade", physics: "arcade", episode_id: `flaw-${personality}-${tier}-${seed}`, rules: { ...c.rules, scoring: "full" }, config: { personality, tier, dda: false } };
}

function baseObs(t, hand, vel = [0, 0, 0]) {
  const o = emptyObservation("blaze");
  o.t = t; o.dt = 0.02; o.preset = "arcade";
  o.self.ee.pos = [0.26, 0, 0.15]; o.self.wrist_pos = [0.23, 0, 0.15]; o.self.integrity = 100; o.self.integrity_max = 100; o.self.heat = 10;
  o.opponent.ee.pos = [...hand]; o.opponent.ee.linvel = [...vel];
  o.opponent.wrist_pos = [hand[0] + 0.03, hand[1], hand[2]]; o.opponent.elbow_pos = [hand[0] + 0.12, hand[1], 0.2];
  o.opponent.integrity = 100; o.opponent.integrity_max = 100;
  o.round.phase = "fight"; o.round.best_of = 3; o.round.time_remaining = 40; o.round.phase_length = 45;
  o.blocks.game[0] = 1; o.blocks.game[1] = 1;
  return o;
}

const hit = (t, dmg) => ({ kind: "strike", attacker: "opponent", damage_to_self: dmg, damage_to_opponent: 0, normal_speed: 1.8, zone: "wrist", pos: [0.3, 0, 0.15], t });

/** Collects every flaw report the policy emits. */
function flawLog(actions) {
  return actions.map((a) => a.debug.flaw).filter(Boolean).map((f) => `${f.stage}:${f.count}`);
}

describe("personality flaws, scouting signals, adaptation", () => {
  for (const [tier, adapts] of [["pro", true], ["contender", false]]) {
    test(`DEADBAND panics (${tier}): strikes landed while composure < 0.3 are exploits; ${adapts ? "patched after 3" : "never patched"}`, () => {
      clearDdaLedger();
      const brain = createOpponent();
      brain.reset(ctx("deadband", tier, 4));
      const acts = [];
      for (let i = 0; i < 400; i++) {
        const t = 0.04 * (i + 1);
        const o = baseObs(t, [0.5, 0, 0.15]);
        if (i % 20 === 5) o.contacts.push(hit(t - 0.01, 16));
        acts.push(brain.act(o));
      }
      const log = flawLog(acts);
      assert.deepEqual(log.slice(0, 3), ["exploited:1", "exploited:2", "exploited:3"]);
      if (adapts) {
        assert.equal(log[3], "patched:3");
        assert.equal(log.length, 4, "no exploit reports after the patch");
      } else {
        assert.ok(!log.some((x) => x.startsWith("patched")));
        assert.ok(log.length > 3);
      }
    });
  }

  test("BACKLASH bites feints (pro): a feint that draws a guard or parry and is then punished is an exploit, patched after 3", () => {
    clearDdaLedger();
    const brain = createOpponent();
    brain.reset(ctx("backlash", "pro", 9));
    const acts = [];
    const PERIOD = 1.6;
    for (let i = 0; i < 1500; i++) {
      const t = 0.04 * (i + 1);
      const local = t % PERIOD;
      // Lunge in for 120 ms, freeze (the feint), then the real hit lands 600 ms after the feint began.
      let hand = [0.5, 0, 0.15], vel = [0, 0, 0];
      if (local < 0.12) { hand = [0.5 - 1.5 * local, 0, 0.15]; vel = [-1.5, 0, 0]; }
      else if (local < 0.6) { hand = [0.32, 0, 0.15]; }
      const o = baseObs(t, hand, vel);
      if (Math.abs(local - 0.62) < 0.02) o.contacts.push(hit(t - 0.01, 6));
      acts.push(brain.act(o));
    }
    const log = flawLog(acts);
    assert.ok(log.includes("exploited:1") && log.includes("exploited:3"), log.join(" "));
    assert.ok(log.includes("patched:3"), log.join(" "));
    assert.equal(brain.inspect().flaw.patched, true);
  });

  test("OVERSHOOT chains jabs (pro): a chained jab punished within 500 ms is an exploit; after the patch it stops chaining", () => {
    clearDdaLedger();
    const brain = createOpponent();
    brain.reset(ctx("overshoot", "pro", 21));
    const acts = [];
    let pendingBlock = false, chainAt = -1, chainsAfterPatch = 0, patched = false, prevIntent = "";
    for (let i = 0; i < 6000 && !(patched && i > 5000); i++) {
      const t = 0.04 * (i + 1);
      const o = baseObs(t, [0.36, 0, 0.15]);
      if (pendingBlock) { o.contacts.push({ kind: "deflect", attacker: "self", damage_to_self: 0, damage_to_opponent: 0, normal_speed: 1.2, zone: null, pos: [0.3, 0, 0.15], t: t - 0.01 }); pendingBlock = false; }
      if (chainAt > 0 && t - chainAt > 0.2) { o.contacts.push(hit(t - 0.01, 8)); chainAt = -1; }
      const a = brain.act(o);
      acts.push(a);
      const d = a.debug;
      if (d.primitive === "JAB" && d.phase === "active") pendingBlock = true;
      const chainStarted = d.intent === "chain" && prevIntent !== "chain";
      prevIntent = d.intent;
      if (chainStarted) { chainAt = t; if (patched) chainsAfterPatch++; }
      if (d.flaw?.stage === "patched") patched = true;
    }
    const log = flawLog(acts);
    assert.ok(log.includes("exploited:1"), log.join(" "));
    assert.ok(patched, `never patched: ${log.join(" ")}`);
    assert.equal(chainsAfterPatch, 0);
  });
});
