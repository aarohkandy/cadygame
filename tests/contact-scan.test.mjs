// WP2: contact onsets and active contacts (GAME_DESIGN 4.1).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createActiveContacts, createContactScanner } from "../src/game/physics/contact-scan.ts";
import { createPhysicsEngine, engineInternals } from "../src/game/physics/engine.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { LINK_IDS } from "../src/game/contracts.ts";

const kin = createKinematics();
const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
const toEgo = (seat, p) => (seat === "atlas" ? [p[0] + 0.32, p[1], p[2]] : [-(p[0] - 0.32), -p[1], p[2]]);

/* ───────── a scripted contact list, to pin the onset bookkeeping exactly ───────── */

const G = { floor: 0, atlasGrip: 1, blazeGrip: 2, core: 3, atlasJaw: 4, clutter: 5 };
function fakeIndex() {
  const links = Object.fromEntries(LINK_IDS.map((l, i) => [l, i + 1]));
  const blazeLinks = Object.fromEntries(LINK_IDS.map((l, i) => [l, i + 11]));
  const geomSeat = Int8Array.of(-1, 0, 1, -1, 0, -1);
  const geomLink = Int8Array.of(-1, LINK_IDS.indexOf("gripper"), LINK_IDS.indexOf("gripper"), -1, LINK_IDS.indexOf("moving_jaw"), -1);
  return {
    ngeom: 6, bodyId: { atlas: links, blaze: blazeLinks }, bodyRootId: new Int32Array(30),
    geomSeat, geomLink, geomCube: Int8Array.of(-1, -1, -1, 4, -1, 0), geomFloor: Uint8Array.of(1, 0, 0, 0, 0, 0),
    geomHull: new Uint8Array(6), geomJaw: Int8Array.of(-1, 0, -1, -1, 1, -1), geomCollides: new Uint8Array(6).fill(1),
  };
}
function fakeFrame(dt) {
  const bodyPosCurr = new Float64Array(30 * 3);
  for (let b = 0; b < 30; b++) bodyPosCurr[b * 3 + 2] = 0.2;       // everything clustered: the walk always runs
  const cubes = { pos: new Float64Array(27), quat: new Float64Array(36), linvel: new Float64Array(27) };
  return { mode: "harness", dt, step: 0, simTime: 0, bodyPosCurr, cubes, onsets: [], active: createActiveContacts() };
}
function scripted(contacts) {
  const list = contacts.map((c, i) => ({ ...c, efc_address: i, pos: Float64Array.from(c.pos ?? [0, 0, 0.2]), frame: Float64Array.of(...(c.n ?? [1, 0, 0]), 0, 1, 0, 0, 0, 1), delete() {} }));
  return {
    model: { geom_bodyid: Int32Array.of(0, 7, 17, 25, 9, 26) },
    data: {
      ncon: list.length, efc_force: Float64Array.from(contacts.map((c) => c.force)),
      cvel: new Float64Array(30 * 6), subtree_com: new Float64Array(30 * 3),
      contact: { size: () => list.length, get: (i) => list[i], delete() {} },
    },
  };
}

describe("contact scan: onset bookkeeping", () => {
  test("a held pair is one onset; a gap under 30 ms merges; a longer gap starts a new episode", () => {
    const scanner = createContactScanner(null, fakeIndex());
    const frame = fakeFrame(0.005);
    const touch = scripted([{ geom1: G.atlasGrip, geom2: G.blazeGrip, force: 2 }]);
    const apart = scripted([]);
    const onsetsAt = [];
    const plan = [1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1];   // 5 ms steps: gaps of 25 ms and 35 ms
    plan.forEach((on, i) => {
      frame.step = i + 1; frame.simTime = (i + 1) * 0.005;
      const s = on ? touch : apart;
      scanner.scan(s.model, s.data, frame);
      if (frame.onsets.length) onsetsAt.push(i);
    });
    assert.deepEqual(onsetsAt, [0, 17]);
  });

  test("the force gate: under 0.3 N arm-arm (and 3 N arm-table) the pair is not active at all", () => {
    const scanner = createContactScanner(null, fakeIndex());
    const frame = fakeFrame(0.0025);
    const weak = scripted([{ geom1: G.atlasGrip, geom2: G.blazeGrip, force: 0.29 }, { geom1: G.floor, geom2: G.atlasGrip, force: 2.9 }]);
    frame.step = 1; frame.simTime = 0.0025;
    scanner.scan(weak.model, weak.data, frame);
    assert.equal(frame.onsets.length, 0);
    assert.equal(frame.active.armArmTouching, true, "still touching, just not scored");
    const strong = scripted([{ geom1: G.atlasGrip, geom2: G.blazeGrip, force: 0.31 }, { geom1: G.floor, geom2: G.atlasGrip, force: 3.1 }]);
    frame.step = 2; frame.simTime = 0.005;
    scanner.scan(strong.model, strong.data, frame);
    assert.deepEqual(frame.onsets.map((o) => o.kind).sort(), ["arm_arm", "arm_table"]);
  });

  test("arm-arm normals are oriented atlas → blaze whichever geom MuJoCo lists first; step is the step that ran", () => {
    const scanner = createContactScanner(null, fakeIndex());
    const frame = fakeFrame(0.0025);
    const s = scripted([{ geom1: G.blazeGrip, geom2: G.atlasGrip, force: 5, n: [-1, 0, 0] }]);
    frame.step = 8; frame.simTime = 0.02;
    scanner.scan(s.model, s.data, frame);
    const o = frame.onsets[0];
    assert.equal(o.kind, "arm_arm");
    assert.deepEqual(o.normal.map((v) => v + 0), [1, 0, 0]);
    assert.equal(o.step, 7);
    assert.equal(o.atlasLink, "gripper");
    assert.equal(o.blazeLink, "gripper");
  });

  test("jaws on a cube: gripperOnCube, bothJawsOnCube, last gripper touch", () => {
    const scanner = createContactScanner(null, fakeIndex());
    const frame = fakeFrame(0.0025);
    const s = scripted([{ geom1: G.atlasGrip, geom2: G.core, force: 1 }, { geom1: G.core, geom2: G.atlasJaw, force: 1 }]);
    frame.step = 4; frame.simTime = 0.01;
    scanner.scan(s.model, s.data, frame);
    assert.equal(frame.active.gripperOnCube.atlas, 4);
    assert.equal(frame.active.bothJawsOnCube.atlas, 4);
    assert.equal(frame.active.lastGripperTouch.cube[4], 0);
    assert.equal(frame.active.lastGripperTouch.t[4], 0.01);
    assert.equal(frame.active.lastCrossContactT.atlas, 0.01);
    assert.equal(frame.active.bothJawsOnCube.blaze, -1);
  });
});

describe("contact scan: in MuJoCo", () => {
  let engine;
  before(async () => { engine = await createPhysicsEngine({ mode: "harness" }); });
  after(() => engine?.dispose());

  function reset(mode = "harness", layout = "lobby") {
    engine.reset({ mode, timestep: mode === "arcade" ? 0.0025 : 0.005, seed: 3, loadouts: { atlas: "pivot", blaze: "pivot" }, homePose: { atlas: home, blaze: home }, layout });
  }

  test("a jab straight into a still opponent: atlas attacks, normal points at blaze, one onset per pair while pressed", () => {
    for (const mode of ["harness", "arcade"]) {
      reset(mode);
      const target = engine.frame.arms.blaze.wristPos;
      const aim = toEgo("atlas", [target[0] + 0.03, target[1], target[2]]);
      const back = new Float64Array(6), jab = new Float64Array(6);
      kin.solveTipEgo([aim[0] - 0.12, aim[1], aim[2]], 0, home, back);
      kin.solveTipEgo(aim, 0, home, jab);
      engine.setTargets("atlas", back);
      engine.setTargets("blaze", home);
      for (let i = 0; i < Math.round(0.8 / engine.frame.dt); i++) engine.step();
      engine.setTargets("atlas", jab);
      const onsets = [];
      for (let i = 0; i < Math.round(0.6 / engine.frame.dt); i++) {
        engine.step();
        for (const o of engine.frame.onsets) if (o.kind === "arm_arm") onsets.push(o);
      }
      assert.ok(onsets.length >= 1, `${mode}: the jab landed`);
      const first = onsets[0];
      assert.ok(first.aN > first.bN, `${mode}: atlas is the faster side`);
      // The surfaces decide the normal's tilt; its sense must still point from atlas toward blaze.
      assert.ok(first.normal[0] > 0, `${mode}: normal ${first.normal}`);
      assert.ok(first.vN > 0.2 && first.efcForce > 0.3);
      const keys = new Set(onsets.map((o) => `${o.atlasLink}|${o.blazeLink}|${o.t}`));
      assert.equal(keys.size, onsets.length, "no duplicate onsets for one pair on one step");
    }
  });

  test("driving a gripper into the table produces an arm_table onset", () => {
    reset("harness");
    const down = new Float64Array(6);
    kin.solveTipEgo([0.2, 0.08, -0.03], -1.2, home, down);
    engine.setTargets("atlas", down);
    let hit = null;
    for (let i = 0; i < 300 && !hit; i++) {
      engine.step();
      hit = engine.frame.onsets.find((o) => o.kind === "arm_table") ?? null;
    }
    assert.ok(hit, "table onset");
    assert.equal(hit.seat, "atlas");
    assert.ok(hit.efcForce > 3);
  });

  test("the walk is skipped while the arms are folded apart with nothing on the table", () => {
    reset("harness", "lobby");
    const folded = Float64Array.of(1.9, -1.7, 1.6, 0, 0, 0.04);
    engine.setTargets("atlas", folded);
    engine.setTargets("blaze", folded);
    for (let i = 0; i < 300; i++) engine.step();
    const before = engineInternals(engine).walkedSteps;
    for (let i = 0; i < 100; i++) engine.step();
    assert.equal(engineInternals(engine).walkedSteps, before);
    assert.equal(engine.frame.onsets.length, 0);
  });
});
