// WP2: the steal that inherits the countdown (BUILD_PLAN D8; BUILD_PLAN 4 WP2 #11).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createCombatRules } from "../src/game/combat/combat-rules.ts";
import { fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";
import { noIntents } from "../src/game/contracts.ts";
import { createPhysicsEngine } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";

const DT = 0.005;
const DOCK_X = 0.11;
const coreEvents = (events, stage) => events.filter((e) => e.type === "core" && (!stage || e.stage === stage));

function rig({ lockInS = { atlas: 8, blaze: 8 }, suddenDeath = false } = {}) {
  const frame = fakeFrame({ mode: "arcade", dt: DT });
  frame.docks.set([-DOCK_X, 0, 0, DOCK_X, 0, 0]);
  const rules = createCombatRules(fakeModelInfo("arcade"));
  rules.reset({ preset: "arcade", roundLengthS: 45, suddenDeathLengthS: 20, loadouts: { atlas: "pivot", blaze: "pivot" }, lockInS, comebacks: true,
    coreIncomingAtS: 0, coreDropAtS: 0 }, 1, suddenDeath, suddenDeath ? { integrity: { atlas: 50, blaze: 50 } } : null);
  rules.setLive(true);
  const intents = { atlas: noIntents(), blaze: noIntents() };
  const events = [];
  frame.arms.atlas.eePos.set([0.3, 0.3, 0.3]); frame.arms.blaze.eePos.set([0.3, 0.3, 0.3]);
  const core = (x, y = 0, z = 0.02) => { frame.cubes.pos[12] = x; frame.cubes.pos[13] = y; frame.cubes.pos[14] = z; };
  const step = () => {
    frame.step++;
    frame.simTime = frame.step * DT;
    rules.step({ frame, intents }, events);
  };
  const runS = (s) => { for (let i = 0; i < Math.round(s / DT); i++) step(); };
  const touch = (seat) => { frame.active.lastGripperTouch.cube[4] = seat === "atlas" ? 0 : 1; frame.active.lastGripperTouch.t[4] = frame.simTime; };
  /** Dock for `owner` and run its countdown down to `remaining`. */
  const dockUntil = (owner, remaining) => {
    core(owner === "atlas" ? -DOCK_X : DOCK_X);
    while (rules.state.core.dockedIn !== owner || rules.state.core.lockInRemainingS > remaining + 1e-9) step();
  };
  /** The opponent's gripper drags the docked Core out to the table centre. */
  const drag = (by) => {
    touch(by);
    core(0, 0.02, 0.05);
    for (let i = 0; i < 30 && !coreEvents(events, "steal").length; i++) { touch(by); step(); }
  };
  return { frame, rules, events, core, step, runS, touch, dockUntil, drag, c: rules.state.core };
}

describe("steal inherits the countdown", () => {
  test("dragging the docked Core out with the opponent's gripper emits steal and pauses the countdown", () => {
    const r = rig();
    r.dockUntil("atlas", 5.2);
    const before = r.c.lockInRemainingS;
    r.drag("blaze");
    const steal = coreEvents(r.events, "steal");
    assert.equal(steal.length, 1);
    assert.deepEqual([steal[0].seat, steal[0].from, steal[0].late], ["blaze", "atlas", false]);
    assert.deepEqual([r.c.loose, r.c.stolenFrom, r.c.owner], [true, "atlas", "atlas"]);
    r.runS(2);
    assert.ok(Math.abs(r.c.lockInRemainingS - before) < 1e-9, "paused");
  });

  test("with 5.2 s left the stealer docks in its own dock: lock_in_resume inherited, lock after 5.2 s ± 1 step", () => {
    const r = rig();
    r.dockUntil("atlas", 5.2);
    const remaining = r.c.lockInRemainingS;
    r.drag("blaze");
    r.core(DOCK_X);
    while (!coreEvents(r.events, "lock_in_resume").length) r.step();
    const resume = coreEvents(r.events, "lock_in_resume")[0];
    assert.deepEqual([resume.seat, resume.from, resume.inherited], ["blaze", "atlas", true]);
    assert.ok(Math.abs(resume.remainingS - remaining) < 1e-9);
    assert.deepEqual([r.c.owner, r.c.loose, r.c.stolenFrom, r.c.lockInTotalS], ["blaze", false, null, 8]);
    const t0 = r.frame.simTime;
    while (!r.rules.state.outcome) r.step();
    assert.deepEqual([r.rules.state.outcome.winner, r.rules.state.outcome.reason], ["blaze", "lock"]);
    assert.ok(Math.abs(r.frame.simTime - t0 - remaining) <= DT + 1e-9, `locked after ${r.frame.simTime - t0}`);
  });

  test("the original owner re-docking a stolen Core resumes the same value, not inherited", () => {
    const r = rig();
    r.dockUntil("atlas", 3.7);
    r.drag("blaze");
    r.core(-DOCK_X);
    while (!coreEvents(r.events, "lock_in_resume").length) r.step();
    const resume = coreEvents(r.events, "lock_in_resume")[0];
    assert.deepEqual([resume.seat, resume.inherited], ["atlas", false]);
    assert.ok(Math.abs(resume.remainingS - 3.7) < DT);
  });

  test("an underdog stealing an 8.0 s owner's Core at 7.0 s resumes at 6.0", () => {
    const r = rig({ lockInS: { atlas: 8, blaze: 6 } });
    r.dockUntil("atlas", 7.0);
    r.drag("blaze");
    r.core(DOCK_X);
    while (!coreEvents(r.events, "lock_in_resume").length) r.step();
    assert.equal(coreEvents(r.events, "lock_in_resume")[0].remainingS, 6);
    assert.equal(r.c.lockInTotalS, 6);
    assert.ok(r.c.lockInRemainingS <= 6 && r.c.lockInRemainingS > 6 - 2 * DT);
  });

  test("the underdog clamp never adds time: a steal at 3.0 s resumes at 3.0", () => {
    const r = rig({ lockInS: { atlas: 8, blaze: 6 } });
    r.dockUntil("atlas", 3.0);
    r.drag("blaze");
    r.core(DOCK_X);
    while (!coreEvents(r.events, "lock_in_resume").length) r.step();
    assert.ok(Math.abs(r.c.lockInRemainingS - 3.0) < DT);
  });

  test("sudden death clamps to 4.0", () => {
    const r = rig({ suddenDeath: true, lockInS: { atlas: 4, blaze: 4 } });
    r.dockUntil("atlas", 3.9);
    r.drag("blaze");
    r.core(DOCK_X);
    while (!coreEvents(r.events, "lock_in_resume").length) r.step();
    assert.equal(r.c.lockInTotalS, 4);
    assert.ok(r.c.lockInRemainingS <= 4);
    const early = rig({ suddenDeath: true, lockInS: { atlas: 4, blaze: 4 } });
    early.dockUntil("atlas", 4);
    assert.equal(early.c.lockInTotalS, 4, "a fresh sudden-death lock-in is 4.0");
  });

  test("a steal with ≤ 2.0 s left is late", () => {
    const r = rig();
    r.dockUntil("atlas", 2.0);
    r.drag("blaze");
    assert.equal(coreEvents(r.events, "steal")[0].late, true);
    const s = rig();
    s.dockUntil("atlas", 2.2);
    s.drag("blaze");
    assert.equal(coreEvents(s.events, "steal")[0].late, false);
  });

  test("no steal without progress, and none when the last gripper touch was the owner's or older than 300 ms", () => {
    const own = rig();
    own.dockUntil("atlas", 6);
    own.drag("atlas");
    assert.equal(coreEvents(own.events, "steal").length, 0);
    const stale = rig();
    stale.dockUntil("atlas", 6);
    stale.touch("blaze");
    stale.runS(0.35);
    stale.core(0, 0.02, 0.05);
    stale.runS(0.2);
    assert.equal(coreEvents(stale.events, "steal").length, 0);
  });

  test("grabbing an owned Core that is already out of its owner's dock is a steal", () => {
    const r = rig();
    r.dockUntil("atlas", 6);
    r.core(0, 0.05);
    r.runS(0.2);
    assert.equal(r.c.dockedIn, null);
    r.frame.active.bothJawsOnCube.blaze = 4;
    r.step();
    const steal = coreEvents(r.events, "steal");
    assert.equal(steal.length, 1);
    assert.equal(steal[0].seat, "blaze");
  });
});

describe("steal in MuJoCo", () => {
  let engine;
  before(async () => { engine = await createPhysicsEngine({ mode: "harness" }); });
  after(() => engine?.dispose());

  test("blaze grips atlas's docked Core and carries it off: steal, then blaze docks it and inherits", () => {
    const kin = createKinematics();
    const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
    const loadouts = { atlas: "pivot", blaze: "pivot" };
    const toEgo = (p) => [-(p[0] - 0.32), -p[1], p[2]];
    const grasp = toEgo([-DOCK_X, 0, 0.02]);
    const q = new Float64Array(6);
    const pitches = [];
    for (let k = 0; k <= 36 && pitches.length < 4; k++) {
      const p = -Math.PI / 2 + (k * Math.PI) / 72;
      if (kin.solveTipEgo(grasp, p, [0, 0, 0, 0, 0, 1.15], q).ok) pitches.push(p);
    }

    /** One attempt at a pitch and wrist roll: dock for atlas, grip, carry to blaze's dock, release. */
    const attempt = (pitch, roll) => {
      engine.reset({ mode: "harness", timestep: DT, seed: 4, loadouts, homePose: { atlas: home, blaze: home }, layout: "lobby" });
      const rules = createCombatRules(engine.info);
      rules.reset({ preset: "harness", roundLengthS: 45, suddenDeathLengthS: 20, loadouts, lockInS: { atlas: 8, blaze: 8 }, comebacks: false, coreIncomingAtS: 0, coreDropAtS: 0 }, 1, false, null);
      rules.setLive(true);
      const events = [], placements = [], intents = { atlas: noIntents(), blaze: noIntents() };
      let gripped = false;
      const stepFor = (seconds) => {
        for (let i = 0; i < Math.round(seconds / DT); i++) {
          placements.length = 0;
          rules.requestPlacements(placements);
          for (const p of placements) engine.placeCube(p.cube, p.pos);
          engine.step();
          rules.step({ frame: engine.frame, intents }, events);
          if (engine.frame.active.bothJawsOnCube.blaze === 4) gripped = true;
        }
      };
      const go = (world, grip, seconds, back = 0) => {
        const ego = toEgo(world);
        const target = [ego[0] - back * Math.cos(pitch), ego[1], ego[2] - back * Math.sin(pitch)];
        kin.solveTipEgo(target, pitch, [0, 0, 0, 0, roll, grip], q);
        q[4] = roll; q[5] = grip;
        engine.setTargets("blaze", q);
        stepFor(seconds);
      };
      engine.setTargets("atlas", Float64Array.of(-1.2, -1.2, 1.5, 0.6, 0, 0.04));
      engine.setTargets("blaze", home);
      stepFor(0.05);                                                   // consume the sudden drop placement
      engine.placeCube(4, [-DOCK_X, 0, 0.0205]);
      stepFor(2.0);
      const docked = { owner: rules.state.core.owner, remaining: rules.state.core.lockInRemainingS };
      go([-DOCK_X, 0, 0.02], 1.15, 0.8, 0.06);
      go([-DOCK_X, 0, 0.02], 1.15, 0.8);
      go([-DOCK_X, 0, 0.02], 0.04, 0.6);
      go([-DOCK_X, 0, 0.08], 0.04, 0.6);
      go([0.0, 0, 0.08], 0.04, 0.8);
      const stolenAt = rules.state.core.lockInRemainingS;
      go([DOCK_X, 0, 0.04], 0.04, 0.8);
      go([DOCK_X, 0, 0.04], 1.15, 0.3);
      go([DOCK_X, 0, 0.12], 1.15, 1.0, 0.06);
      return { events, gripped, docked, stolenAt };
    };

    let result = null;
    for (const pitch of pitches) {
      for (const roll of [0, Math.PI / 2, -Math.PI / 2]) {
        const r = attempt(pitch, roll);
        if (r.gripped && coreEvents(r.events, "steal").length) { result = r; break; }
      }
      if (result) break;
    }
    assert.ok(result, "an approach gripped and carried the Core");
    assert.equal(result.docked.owner, "atlas");
    assert.ok(result.docked.remaining < 8);
    const steal = coreEvents(result.events, "steal");
    assert.equal(steal.length, 1);
    assert.deepEqual([steal[0].seat, steal[0].from], ["blaze", "atlas"]);
    const resume = coreEvents(result.events, "lock_in_resume");
    assert.equal(resume.length, 1, `core events ${coreEvents(result.events).map((e) => e.stage)}`);
    assert.deepEqual([resume[0].seat, resume[0].inherited], ["blaze", true]);
    assert.ok(Math.abs(resume[0].remainingS - result.stolenAt) < 1e-9);
  });
});

describe("overtime (EMOTION_BIBLE 6): a steal begun inside the last 5 s holds the round open", () => {
  /** Dock atlas at t≈0 and let the clock run to `fightTimeS`, then have blaze drag the Core out. */
  function lateSteal(atS) {
    const r = rig({ lockInS: { atlas: 60, blaze: 60 } });
    r.core(-DOCK_X);
    while (r.rules.state.fightTimeS < atS) r.step();
    assert.equal(r.c.dockedIn, "atlas");
    r.drag("blaze");
    assert.equal(coreEvents(r.events, "steal").length, 1);
    return r;
  }

  test("a steal at 42 s keeps the round alive past 45 s while the Core is loose, and ends it once the Core is docked again", () => {
    const r = lateSteal(42);
    r.runS(4);
    assert.equal(r.rules.state.outcome, null, "45 s passed with the Core loose: no outcome");
    r.core(DOCK_X);
    while (!coreEvents(r.events, "lock_in_resume").length) r.step();
    r.runS(0.05);
    assert.ok(r.rules.state.outcome, "docked again after 45 s: the round ends");
    assert.equal(r.rules.state.outcome.reason, "time");
  });

  test("overtime is capped at 10 s: a Core still loose at 55 s ends the round on time", () => {
    const r = lateSteal(42);
    while (r.rules.state.fightTimeS < 54.9) r.step();
    assert.equal(r.rules.state.outcome, null);
    r.runS(0.2);
    assert.ok(r.rules.state.outcome && Math.abs(r.rules.state.outcome.t - 55) < 0.02, `ended at ${r.rules.state.outcome?.t}`);
  });

  test("a steal at 39 s (outside the window) does not extend the round", () => {
    const r = lateSteal(39);
    r.runS(6.1);
    assert.ok(r.rules.state.outcome && Math.abs(r.rules.state.outcome.t - 45) < 0.02, `ended at ${r.rules.state.outcome?.t}`);
  });
});
