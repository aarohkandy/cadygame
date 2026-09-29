import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createObservationBuilder, createObservationDelayLine, emptyObservation, worldToEgoPoint, worldToEgoQuat,
} from "../src/game/policy/observation.ts";
import { OBS_BLOCKS } from "../src/game/contracts.ts";
import { createRng } from "../src/game/core/rng.ts";
import { fakeCombat, fakeEvents, fakeFrame, fakeModelInfo, fakeSeatCombat } from "../src/game/testing/fakes.ts";

const info = fakeModelInfo("arcade");

function randomQuat(rng) {
  const q = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
}

/** Rz(π) ⊗ q for world orientations, and (−x, −y, z) for positions and vectors. */
const rotP = (p, o, out) => { out[o] = -p[o]; out[o + 1] = -p[o + 1]; out[o + 2] = p[o + 2]; };
const rotQ = (q, o, out) => { const w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3]; out[o] = -z; out[o + 1] = -y; out[o + 2] = x; out[o + 3] = w; };

function randomArm(rng, arm) {
  for (let j = 0; j < 6; j++) {
    arm.q[j] = rng.range(-1.5, 1.5); arm.qd[j] = rng.range(-8, 8); arm.tau[j] = rng.range(-4, 4); arm.ctrl[j] = rng.range(-1.5, 1.5);
  }
  for (const k of ["eePos", "eeVel", "elbowPos", "wristPos"]) for (let i = 0; i < 3; i++) arm[k][i] = rng.range(-0.5, 0.5);
  arm.eePos[2] = rng.range(0.02, 0.3);
  arm.eeQuat.set(randomQuat(rng));
}

function copyArmRotated(src, dst) {
  for (const k of ["q", "qd", "tau", "ctrl", "forceRange"]) dst[k].set(src[k]);
  rotP(src.eePos, 0, dst.eePos); rotP(src.eeVel, 0, dst.eeVel); rotP(src.elbowPos, 0, dst.elbowPos); rotP(src.wristPos, 0, dst.wristPos);
  rotQ(src.eeQuat, 0, dst.eeQuat);
}

function scenario(seed, opts = {}) {
  const rng = createRng(seed);
  const a = fakeFrame();
  a.simTime = 3.2; a.step = 1280;
  randomArm(rng, a.arms.atlas);
  randomArm(rng, a.arms.blaze);
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < 3; k++) { a.cubes.pos[i * 3 + k] = rng.range(-0.3, 0.3); a.cubes.linvel[i * 3 + k] = rng.range(-1, 1); }
    a.cubes.quat.set(randomQuat(rng), i * 4);
  }
  if (opts.parked) a.cubes.pos[2 * 3] = 2.2;   // cube 2 parked (parked poses are world poses: not seat-symmetric)
  a.active.armArmTouching = true; a.active.maxArmForce = 1.2;
  a.active.bothJawsOnCube.atlas = 4;

  const b = fakeFrame();
  b.simTime = a.simTime; b.step = a.step;
  copyArmRotated(a.arms.atlas, b.arms.blaze);
  copyArmRotated(a.arms.blaze, b.arms.atlas);
  for (let i = 0; i < 9; i++) { rotP(a.cubes.pos, i * 3, b.cubes.pos); rotP(a.cubes.linvel, i * 3, b.cubes.linvel); rotQ(a.cubes.quat, i * 4, b.cubes.quat); }
  b.active.armArmTouching = true; b.active.maxArmForce = 1.2;
  b.active.bothJawsOnCube.blaze = 4;

  const atlasCombat = fakeSeatCombat({ integrity: 61, heat: 44, servoState: "stagger", servoStateRemainingMs: 320, guardHeld: true, charging: true, charge: 0.6, loadout: "whip" });
  const blazeCombat = fakeSeatCombat({ integrity: 83, heat: 12, charging: true, charge: 0.2, loadout: "anvil" });
  const core = { phase: "live", owner: "atlas", dockedIn: "atlas", lockInRemainingS: 5.5, lockInTotalS: 8, contested: false, loose: false, stolenFrom: null, lastTouchedBy: "atlas" };
  const ca = fakeCombat("arcade", { fightTimeS: 20, seats: { atlas: atlasCombat, blaze: blazeCombat }, core });
  const cb = fakeCombat("arcade", { fightTimeS: 20, seats: { atlas: blazeCombat, blaze: atlasCombat }, core: { ...core, owner: "blaze", dockedIn: "blaze", lastTouchedBy: "blaze" } });

  const evA = [
    fakeEvents.strike({ t: 3.15, step: 1260, attacker: "atlas", victim: "blaze", pos: [0.05, 0.02, 0.1], vN: 2.1, damage: 22, physicalDamage: 18, zone: "wrist" }),
    fakeEvents.deflect({ t: 3.18, step: 1272, defender: "atlas", attacker: "blaze", pos: [0.01, -0.03, 0.12] }),
  ];
  const evB = [
    fakeEvents.strike({ t: 3.15, step: 1260, attacker: "blaze", victim: "atlas", pos: [-0.05, -0.02, 0.1], vN: 2.1, damage: 22, physicalDamage: 18, zone: "wrist" }),
    fakeEvents.deflect({ t: 3.18, step: 1272, defender: "blaze", attacker: "atlas", pos: [-0.01, 0.03, 0.12] }),
  ];
  const match = (won) => ({ round: 2, bestOf: 3, phase: "fight", phaseLengthS: 45, roundsWon: won });
  return { a, b, ca, cb, evA, evB, matchA: match({ atlas: 1, blaze: 0 }), matchB: match({ atlas: 0, blaze: 1 }) };
}

function deepClose(x, y, path = "obs") {
  if (typeof x === "number") {
    assert.ok(Math.abs(x - y) <= 1e-9, `${path}: ${x} vs ${y}`);
    return;
  }
  if (x instanceof Float32Array) return;   // blocks compared separately
  if (Array.isArray(x)) {
    assert.equal(x.length, y.length, `${path} length`);
    x.forEach((v, i) => deepClose(v, y[i], `${path}[${i}]`));
    return;
  }
  if (x && typeof x === "object") {
    for (const k of Object.keys(x)) {
      if (k === "blocks" || k === "side") continue;
      deepClose(x[k], y[k], `${path}.${k}`);
    }
    return;
  }
  assert.equal(x, y, path);
}

describe("observation builder", () => {
  test("seat rotation symmetry: blaze in the rotated world sees what atlas sees (dict 1e-9, blocks fround)", () => {
    for (const seed of [1, 2, 3, 99]) {
      const s = scenario(seed);
      const last = new Float64Array([0.1, -0.2, 0.3, -0.4, 0.5, 0.6]);
      const status = { late_steps: 2, clamped_steps: 1, timeouts: 0 };
      const oa = createObservationBuilder(info).build("atlas", s.a, s.ca, s.matchA, last, status, 64, 64, s.evA);
      const ob = createObservationBuilder(info).build("blaze", s.b, s.cb, s.matchB, last, status, 64, 64, s.evB);
      deepClose(oa, ob);
      for (const name of Object.keys(OBS_BLOCKS)) {
        const x = oa.blocks[name], y = ob.blocks[name];
        for (let i = 0; i < x.length; i++) assert.equal(x[i], y[i], `${name}[${i}] seed ${seed}`);
        for (let i = 0; i < x.length; i++) assert.ok(Number.isFinite(x[i]));
      }
    }
  });

  test("ego transforms: atlas translates, blaze rotates 180 degrees about z (not a mirror)", () => {
    const p = [0, 0, 0];
    worldToEgoPoint("atlas", 0.1, 0.05, 0.2, p);
    assert.ok(Math.abs(p[0] - 0.42) < 1e-12 && p[1] === 0.05 && p[2] === 0.2);
    const q = worldToEgoPoint("blaze", 0.1, 0.05, 0.2, [0, 0, 0]);
    assert.ok(Math.abs(q[0] - 0.22) < 1e-12 && Math.abs(q[1] + 0.05) < 1e-12 && q[2] === 0.2);
    // Opponent base in ego is (0.64, 0, 0) for both seats.
    assert.ok(Math.abs(worldToEgoPoint("atlas", 0.32, 0, 0, [0, 0, 0])[0] - 0.64) < 1e-12);
    assert.ok(Math.abs(worldToEgoPoint("blaze", -0.32, 0, 0, [0, 0, 0])[0] - 0.64) < 1e-12);
    // A world yaw of +90° seen from blaze is still a proper rotation (det +1), canonical w >= 0.
    const out = worldToEgoQuat("blaze", Math.SQRT1_2, 0, 0, Math.SQRT1_2, [0, 0, 0, 0]);
    assert.ok(out[0] >= 0);
    assert.ok(Math.abs(Math.hypot(...out) - 1) < 1e-12);
  });

  test("schema layout: block lengths, canonical quaternions, contacts newest first", () => {
    const s = scenario(5, { parked: true });
    const obs = createObservationBuilder(info).build("atlas", s.a, s.ca, s.matchA, new Float64Array(6), { late_steps: 0, clamped_steps: 0, timeouts: 0 }, 1, 1, s.evA);
    for (const [name, len] of Object.entries(OBS_BLOCKS)) assert.equal(obs.blocks[name].length, len);
    assert.ok(obs.self.ee.quat[0] >= 0 && obs.opponent.ee.quat[0] >= 0);
    for (const c of obs.cubes) assert.ok(c.quat[0] >= 0);
    for (let i = 0; i < 9; i++) assert.ok(obs.blocks.environment_state[i * 9 + 3] >= 0);
    const ct = obs.blocks.contacts;
    assert.equal(ct[0], 3, "newest contact first: deflect");
    assert.equal(ct[1], -1, "deflect attacker is the opponent");
    assert.equal(ct[5], 1, "then the strike");
    assert.equal(ct[6], 1, "strike by self");
    assert.equal(ct[7], 5, "zone wrist = LINK index 4 + 1");
    assert.equal(ct[8], Math.fround(2.1));
    assert.ok(Math.abs(ct[9] - Math.fround(0.05)) < 1e-6, "age");
    assert.equal(obs.opponent.ctrl.every((v) => v === 0), true, "opponent ctrl is never observable");
    assert.equal(obs.cubes[2].parked, true);
    assert.equal(obs.cubes[4].held_by, "self");
    assert.equal(obs.blocks.game[6], Math.fround(5.5 / 8));
    assert.equal(obs.blocks.game[5], Math.fround(0.5));
    assert.equal(obs.blocks.game[9], 1);
    assert.equal(obs.blocks.game[11], 0, "blaze charges at 0.2: below the public threshold");
    assert.equal(obs.blocks.game[12], Math.fround(2 / 5));
  });

  test("physical scoring zeroes the Arcade-only game fields and dict fields", () => {
    const s = scenario(8);
    const combat = { ...s.ca, preset: "proving_ground", scoring: "physical" };
    const obs = createObservationBuilder(info).build("blaze", s.a, combat, s.matchA, new Float64Array(6), { late_steps: 0, clamped_steps: 0, timeouts: 0 }, 1, 1, s.evA);
    for (let i = 10; i < 16; i++) assert.equal(obs.blocks.game[i], 0, `game[${i}]`);
    assert.equal(obs.opponent.heat, 0);
    assert.equal(obs.opponent.servo_state, "normal");
    assert.equal(obs.opponent.charge_public, 0);
    assert.equal(obs.opponent.loadout, null);
    // Strike damage in physical scoring is the physical damage.
    const strike = obs.contacts.find((c) => c.kind === "strike");
    assert.equal(strike.damage_to_self, 18);
  });

  test("reuses every array when given out, and fills dt from tick spacing", () => {
    const s = scenario(9);
    const b = createObservationBuilder(info);
    const out = emptyObservation("atlas");
    const self = out.self.q, blocks = out.blocks.state;
    const status = { late_steps: 0, clamped_steps: 0, timeouts: 0 };
    b.build("atlas", s.a, s.ca, s.matchA, new Float64Array(6), status, 10, 10, [], out);
    s.a.simTime += 0.04;
    b.build("atlas", s.a, s.ca, s.matchA, new Float64Array(6), status, 12, 12, [], out);
    assert.equal(out.self.q, self);
    assert.equal(out.blocks.state, blocks);
    assert.ok(Math.abs(out.dt - 0.02) < 1e-9);
  });
});

describe("fair-delay line", () => {
  const obsAt = (t) => { const o = emptyObservation(); o.t = t; return o; };

  test("returns the nearest older observation and keeps 1.5 s", () => {
    const line = createObservationDelayLine();
    for (let i = 0; i <= 200; i++) line.push(obsAt(i * 0.02));
    assert.equal(line.read(0).t, 4);
    assert.ok(Math.abs(line.read(120).t - 3.88) < 1e-9);
    assert.ok(Math.abs(line.read(130).t - 3.86) < 1e-9, "130 ms falls between ticks: the older one");
    assert.ok(Math.abs(line.read(1500).t - 2.5) < 1e-9);
    assert.ok(line.read(5000).t >= 2.48, "never older than the kept history");
  });

  test("before enough history it returns the oldest, and a new round clears it", () => {
    const line = createObservationDelayLine();
    line.push(obsAt(1)); line.push(obsAt(1.02));
    assert.equal(line.read(120).t, 1);
    line.push(obsAt(0));
    assert.equal(line.read(120).t, 0);
    line.clear();
    assert.equal(line.read(0).t, 0);
  });
});
