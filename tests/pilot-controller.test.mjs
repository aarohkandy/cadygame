// WP3 pilot controller (GAME_DESIGN 3.1–3.5, BUILD_PLAN 4 WP3 criteria 1–6): same-frame command, flick gain and
// leash, reach spring and stance creep, jab / charge / cancel, grab assist, frozen sampling, modes.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { GRIP_CLOSED, GRIP_OPEN } from "../src/game/contracts.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createPilot, LEASH_RAD } from "../src/game/input/pilot-controller.ts";
import { egoToWorld, grabRoll, worldYawToEgo, cubeYawWorld } from "../src/game/input/assists.ts";
import { fakeCombat, fakeFrame } from "../src/game/testing/fakes.ts";

const DT = 1 / 60;
const ARCADE_RULES = { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: false, showKit: true };

function setup(opts = {}) {
  const kinematics = createKinematics();
  const settings = createSettingsStore({ storage: null });
  const clock = createGameClock();
  const pilot = createPilot({ kinematics, settings, clock, profileMatchesPlayed: () => 10 }, { getPads: () => [] });
  pilot.setRules({ ...ARCADE_RULES, ...(opts.rules ?? {}) });
  const frame = fakeFrame();
  for (let i = 0; i < 9; i++) { frame.cubes.pos[i * 3] = 2 + 0.1 * i; frame.cubes.pos[i * 3 + 2] = 0.02; }
  // Opponent arm parked far across the table so the range cue and guard line have real geometry.
  const opp = frame.arms.blaze;
  opp.elbowPos.set([0.2, 0, 0.2]); opp.wristPos.set([0.12, 0, 0.16]); opp.eePos.set([0.08, 0, 0.14]); opp.cameraMountPos.set([0.13, 0, 0.19]);
  opp.shoulderPos.set([0.28, 0, 0.1]);
  frame.arms.atlas.shoulderPos.set([-0.28, 0, 0.1]);
  const combat = fakeCombat();
  const out = new Float64Array(6);
  /** Moves the physical arm onto the current command so the leash does not engage. */
  const settle = () => {
    pilot.writeCommand(frame, combat, out);
    kinematics.commandToJoints(pilot.shaped, out);
    frame.arms.atlas.q.set(out);
    pilot.writeCommand(frame, combat, out);
  };
  pilot.setMode("fight");
  pilot.sampleFrame(DT, false);
  settle();
  pilot.sampleFrame(DT, false);
  return { kinematics, settings, clock, pilot, frame, combat, out, settle, input: pilot.synthetic() };
}

function frames(pilot, n, frozen = false) {
  for (let i = 0; i < n; i++) pilot.sampleFrame(DT, frozen);
}

describe("pilot controller", () => {
  test("a pointer delta before sampleFrame changes command, ghost, and range cue in that call; look moves only through the stance filter", () => {
    const { pilot, input } = setup();
    const yaw0 = pilot.command.yaw;
    const ghost0 = pilot.ghost.joints[0];
    const arc0 = pilot.rangeCue.flickArcRadiusM;
    const look0 = pilot.look.yawOffset;
    input.move(300, -150);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.command.yaw - yaw0 - 0.45) < 1e-9, "yaw jumps by K * counts in the same call");
    assert.notEqual(pilot.ghost.joints[0], ghost0, "ghost pan follows in the same call");
    assert.notEqual(pilot.rangeCue.flickArcRadiusM, arc0, "range cue is recomputed in the same call");
    assert.ok(Math.abs(pilot.look.yawOffset - look0) < 0.01, "look barely moves on the flick frame");
    frames(pilot, 90);
    assert.ok(pilot.stance.yaw > pilot.command.yaw - 0.02, "stance settles on a held aim within 1.5 s");
    assert.ok(pilot.look.yawOffset > look0 + 0.1, "look follows the settled stance");
  });

  test("flick: 400 counts at sensitivity 1.0 is a 0.600 rad yaw step and the pan target is leashed to q + 0.60", () => {
    const { pilot, input, frame, combat, out } = setup();
    const yaw0 = pilot.command.yaw;
    input.move(400, 0);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.command.yaw - yaw0 - 0.6) < 1e-12);
    input.move(200, 0);
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    assert.ok(Math.abs(out[0] - (frame.arms.atlas.q[0] + LEASH_RAD)) < 1e-12, "pan target clamped to q + 0.60");
    assert.equal(pilot.shaping.leash, true);
    assert.ok(pilot.ghost.leashStretch > 1);
  });

  test("reach spring: W adds 0.12 m on the press frame, releases on the release frame, and a 1.0 s hold creeps the stance 0.15 m", () => {
    const { pilot, input } = setup();
    const r0 = pilot.aim.reach;
    input.key("KeyW", true);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - r0 - 0.12) < 1e-9);
    input.key("KeyW", false);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - r0) < 1e-9);
    input.key("KeyW", true);
    frames(pilot, 60);
    input.key("KeyW", false);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - r0 - 0.15) < 1e-6, `stance crept ${pilot.aim.reach - r0}`);
    input.key("KeyS", true);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.reach - (r0 + 0.15 - 0.08)) < 1e-6, "S pulls in by 0.08 m");
  });

  test("jab: a 150 ms press extends the arm command 0.10 m for 160 ms and never charges", () => {
    const { pilot, input } = setup();
    input.button(0, true);
    for (let i = 0; i < 9; i++) { pilot.sampleFrame(DT, false); assert.equal(pilot.intents.charge, false); }
    input.button(0, false);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.shaped.reach - pilot.aim.reach - 0.1) < 1e-9, "jab offset on the release frame");
    assert.equal(pilot.shaping.jabMacro, true);
    frames(pilot, 10);
    assert.ok(Math.abs(pilot.shaped.reach - pilot.aim.reach) < 1e-9, "back after 160 ms");
  });

  test("charge: a 400 ms press charges from 180 ms with the wind-up on the arm command only; release snaps the heavy", () => {
    const { pilot, input } = setup();
    input.key("KeyW", true);                 // step the stance out so the 6 cm wind-up has room above the 0.12 m floor
    frames(pilot, 60);
    input.key("KeyW", false);
    pilot.sampleFrame(DT, false);
    const aim0 = { ...pilot.aim };
    const tip0 = Array.from(pilot.ghost.tipWorld);
    const joints0 = Array.from(pilot.ghost.joints);
    input.button(0, true);
    let chargedAt = -1;
    for (let i = 1; i <= 24; i++) {
      pilot.sampleFrame(DT, false);
      if (pilot.intents.charge && chargedAt < 0) chargedAt = i * DT * 1000;
    }
    assert.ok(chargedAt >= 180 && chargedAt < 200, `charge started at ${chargedAt} ms`);
    assert.ok(Math.abs(pilot.shaped.reach - (pilot.aim.reach - 0.06)) < 1e-9, "reach wound back 6 cm");
    assert.ok(Math.abs(pilot.shaped.tool - (pilot.aim.tool - 0.5)) < 1e-9, "tool wound back 0.5 rad");
    assert.equal(pilot.aim.reach, aim0.reach, "the aim (reticle anchor) keeps the un-wound reach");
    assert.equal(pilot.aim.yaw, aim0.yaw);
    assert.ok(Math.abs(pilot.stance.yaw - aim0.yaw) < 1e-6, "stance does not see the wind-up");
    assert.equal(pilot.shaping.chargeWindup, true);
    assert.deepEqual(Array.from(pilot.ghost.tipWorld), tip0, "the reticle anchor holds the aim");
    assert.notDeepEqual(Array.from(pilot.ghost.joints), joints0, "the ghost arm visibly winds up");
    input.button(0, false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.charge, false);
    assert.ok(Math.abs(pilot.shaped.tool - (pilot.aim.tool + 0.5)) < 1e-9, "heavy release snaps the tool forward");
  });

  test("cancel: a guard press while charging cancels with no deflect stamp and no heavy", () => {
    const { pilot, input, frame, combat, out } = setup();
    input.button(0, true);
    frames(pilot, 20);
    assert.equal(pilot.intents.charge, true);
    const stamp0 = pilot.edgeSimTimes.guardPress;
    input.button(2, true);
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    assert.equal(pilot.intents.charge, false);
    assert.equal(pilot.intents.guard, true, "guard is still held");
    assert.equal(pilot.edgeSimTimes.guardPress, stamp0, "the cancelling press is not a deflect edge");
    input.button(0, false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.chargeWindup, false, "no heavy release after a cancel");
  });

  test("grab assist: Space with a cube 3 cm from the tip squares the roll (±0.05) and puts the jaws over the cube (±2 mm) that frame", () => {
    const { pilot, input, frame, combat, out, kinematics } = setup();
    const tip = pilot.ghost.tipWorld;
    frame.arms.atlas.eePos.set(tip);
    const cube = 4;
    frame.cubes.pos.set([tip[0] + 0.03, tip[1], tip[2]], cube * 3);
    const yaw = 0.35;
    frame.cubes.quat.set([Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)], cube * 4);
    pilot.writeCommand(frame, combat, out);
    input.key("Space", true);
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    assert.equal(pilot.shaping.grabAssist, true);
    const expectedRoll = grabRoll(kinematics, worldYawToEgo("atlas", cubeYawWorld(frame, cube)), pilot.shaped.yaw);
    assert.ok(Math.abs(pilot.shaped.roll - expectedRoll) <= 0.05);
    const j = new Float64Array(6);
    kinematics.commandToJoints(pilot.shaped, j);
    const tipEgo = kinematics.fkTipEgo(j, new Float64Array(3));
    const tipW = egoToWorld("atlas", tipEgo[0], tipEgo[1], tipEgo[2], new Float64Array(3));
    assert.ok(Math.hypot(tipW[0] - frame.cubes.pos[cube * 3], tipW[1] - frame.cubes.pos[cube * 3 + 1]) <= 0.002, "jaws over the cube");
    assert.equal(pilot.shaped.grip, GRIP_OPEN, "jaws open for the first 120 ms");
    frames(pilot, 8);
    pilot.writeCommand(frame, combat, out);
    assert.equal(pilot.shaped.grip, GRIP_CLOSED, "then close");
  });

  test("frozen sampling: the ghost holds during a freeze, deltas apply on the first post-freeze frame, and a guard press carries the post-freeze step time", () => {
    const { pilot, input, frame, combat, out } = setup({ rules: { guardBlend: false } });
    const ghost0 = Float64Array.from(pilot.ghost.joints);
    const yaw0 = pilot.command.yaw;
    frame.simTime = 3.2;
    input.move(200, 0);
    input.button(2, true);
    frames(pilot, 5, true);
    assert.deepEqual(Array.from(pilot.ghost.joints), Array.from(ghost0));
    assert.equal(pilot.command.yaw, yaw0);
    assert.equal(pilot.intents.guard, false, "no edge applied during the freeze");
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.command.yaw - yaw0 - 0.3) < 1e-9, "accumulated delta applies at once");
    assert.equal(pilot.intents.guard, true);
    pilot.writeCommand(frame, combat, out);
    assert.ok(Math.abs(pilot.edgeSimTimes.guardPress - (3.2 + frame.dt)) < 1e-12, "stamped with the post-freeze step time");
  });

  test("guard blend moves the command 60% toward the guard line and caps yaw rate at 2 rad/s", () => {
    const { pilot, input, frame, combat, out } = setup();
    input.button(2, true);
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    assert.equal(pilot.shaping.guardBlend, true);
    assert.equal(pilot.shaped.grip, GRIP_CLOSED);
    const yaw0 = pilot.aim.yaw;
    input.move(600, 0);
    pilot.sampleFrame(DT, false);
    assert.ok(Math.abs(pilot.aim.yaw - yaw0 - 2 * DT) < 1e-9, "yaw rate capped while guarding");
  });

  test("hold_guard freezes the command at home with no intents; frozen mode clears intents", () => {
    const { pilot, input, kinematics } = setup();
    input.move(300, 0);
    input.button(2, true);
    pilot.sampleFrame(DT, false);
    pilot.setMode("hold_guard");
    pilot.sampleFrame(DT, false);
    const home = kinematics.homeCommand();
    assert.ok(Math.abs(pilot.shaped.yaw - home.yaw) < 1e-12);
    assert.equal(pilot.intents.guard, false);
    pilot.setMode("frozen");
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.guard, false);
  });

  test("ENGAGE replays edges from the last 150 ms; an older strike press must be pressed again", () => {
    const { pilot, input } = setup();
    pilot.setMode("frozen");
    input.button(0, true);
    frames(pilot, 15);                       // 250 ms before ENGAGE
    pilot.setMode("fight");
    input.button(0, false);
    frames(pilot, 2);
    assert.equal(pilot.shaping.jabMacro, false, "stale press does not jab");
    pilot.setMode("frozen");
    frames(pilot, 2);
    input.button(0, true);
    frames(pilot, 4);                        // 67 ms before ENGAGE
    pilot.setMode("fight");
    input.button(0, false);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.jabMacro, true, "recent press replays into a jab");
  });

  test("kit inputs are gated by showKit; burst is a buffered Shift press while staggered", () => {
    const { pilot, input, frame, combat, out } = setup({ rules: { showKit: false } });
    input.key("ShiftLeft", true);
    input.key("KeyF", true);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.overdrive, false);
    assert.equal(pilot.intents.ability, false);
    input.key("ShiftLeft", false);
    input.key("KeyF", false);
    pilot.setRules(ARCADE_RULES);
    input.key("ShiftLeft", true);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.overdrive, true);
    assert.equal(pilot.intents.burst, false, "not staggered yet");
    combat.seats.atlas.servoState = "stagger";
    pilot.writeCommand(frame, combat, out);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.intents.burst, true, "press 17 ms earlier is still inside the 100 ms buffer");
    frames(pilot, 8);
    assert.equal(pilot.intents.burst, false, "buffer expires");
  });

  test("lobby cursor: the arm points at the cursor, drifts into idle sway after 3 s, and a tile click jabs", () => {
    const { pilot, kinematics } = setup();
    pilot.setMode("lobby_cursor");
    pilot.setCursorTarget([0.26, 0.08, 0.15]);
    frames(pilot, 60);
    const j = new Float64Array(6);
    kinematics.commandToJoints(pilot.aim, j);
    const p = kinematics.fkRollAxisEgo(j, new Float64Array(3));
    assert.ok(Math.hypot(p[0] - 0.26, p[1] - 0.08, p[2] - 0.15) < 0.01, "roll axis on the cursor");
    pilot.triggerJab();
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.shaping.jabMacro, true);
    frames(pilot, 240);
    const idle = pilot.aim.yaw;
    frames(pilot, 60);
    assert.notEqual(pilot.aim.yaw, idle, "idle sway keeps the arm alive");
    assert.equal(pilot.intents.guard, false);
  });

  test("device reflects the last input source", () => {
    const { pilot, input } = setup();
    assert.equal(pilot.device, "keyboard_mouse");
    input.move(5, 0);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.device, "synthetic");
    pilot.touch().button("guard", true);
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.device, "touch");
  });
});

/* ───────── EMOTION_BIBLE 3.2 life, 3.3 LED, 3.4 ritual, section 6 streamlining, match-1 assists ───────── */

import { CORE_CUBE_INDEX, JOINT_LIMITS, LINK_IDS } from "../src/game/contracts.ts";
import {
  BREATH_JAW_RAD, BREATH_WRIST_RAD, FREEZE_EDGE_BUFFER_MS, LED_COMMIT_FLARE_MS, LED_COMMIT_RAMP_MS, MAGNET_MAX_RAD, applyLife, computeLed,
  createLedFrame, createLifeState, hexToLinear, ritualJoints, tremorMm,
} from "../src/game/input/pilot-controller.ts";

describe("the pilot's body", () => {
  test("breath is command-side on wrist_flex and the jaw only, sub-degree, gated by command speed, and never in human.command", () => {
    const { pilot, frame, combat, out, kinematics } = setup();
    frames(pilot, 30);
    const cmd = { ...pilot.command };
    pilot.writeCommand(frame, combat, out);
    const pure = kinematics.commandToJoints(pilot.shaped, new Float64Array(6));
    for (const j of [0, 1, 2]) assert.equal(out[j], pure[j], `joint ${j}: never pan, lift or elbow`);
    assert.ok(Math.abs(out[3] - pure[3]) <= BREATH_WRIST_RAD + 1e-9 && Math.abs(out[5] - pure[5]) <= BREATH_JAW_RAD + 1e-9);
    assert.deepEqual({ ...pilot.command }, cmd, "the recorded command is captured before the life layer");
    // Written joints move with time while the command does not: the breath is alive at 0.28 Hz.
    const a = out[3];
    frames(pilot, 60);
    pilot.writeCommand(frame, combat, out);
    assert.notEqual(out[3], a);
    assert.deepEqual({ ...pilot.command }, cmd);
    // HARNESS zeroes all of it (the one preset with the leash off).
    pilot.setRules({ ...ARCADE_RULES, leash: false, jabMacro: false, chargeMacro: false, assists: false });
    frames(pilot, 7);
    pilot.writeCommand(frame, combat, out);
    kinematics.commandToJoints(pilot.shaped, pure);
    assert.deepEqual(Array.from(out), Array.from(pure));
  });

  test("applyLife: breath gates out at command speed, idle breaks never touch pan or lift, joints stay inside their limits", () => {
    const life = createLifeState();
    const q = new Float64Array(6);
    life.tS = 0.9; life.cmdVel = 0;
    applyLife(life, 0, false, q);
    assert.ok(Math.abs(q[3]) > 0 && Math.abs(q[5]) > 0 && q[0] === 0 && q[1] === 0 && q[2] === 0 && q[4] === 0);
    q.fill(0); life.cmdVel = 5;
    applyLife(life, 0, false, q);
    assert.deepEqual(Array.from(q), [0, 0, 0, 0, 0, 0], "a moving command has no breath");
    q.fill(0); life.cmdVel = 0;
    applyLife(life, 0, true, q);
    assert.equal(q[5], 0, "no jaw breath while gripping");
    life.idleBreak = { kind: "jaw", startS: life.tS - 0.35 };
    q.fill(0); applyLife(life, 0, false, q);
    assert.ok(q[5] > 0.3, "jaw-check opens the jaw about 20°");
    q.set([0, 0, 0, JOINT_LIMITS[3][1], 0, JOINT_LIMITS[5][1]]);
    life.actionBreakAtMs = -260;
    applyLife(life, 0, false, q);
    assert.ok(q[3] <= JOINT_LIMITS[3][1] && q[5] <= JOINT_LIMITS[5][1]);
  });

  test("LED machine: one colour, one meaning; COMMIT flares white for 60 ms then ramps back; GRIP is volt on the gripper only", () => {
    const led = createLedFrame();
    const base = { nowMs: 1000, power: "ready", bootSteady: false, guard: false, grip: false, gripForce01: 0, gripTarget: false, heat01: 0, integrity01: 1,
      inStrikeRange: true, commitAtMs: -Infinity, whiffAtMs: -Infinity, staggerAtMs: -Infinity, shortAtMs: -Infinity };
    computeLed(base, led);
    assert.equal(led.state, "ready");
    assert.deepEqual(led.colour, hexToLinear("#2A6BFF"));
    assert.equal(led.intensity, 1, "steady inside strike range: stillness is tension");
    computeLed({ ...base, inStrikeRange: false, nowMs: 1000 + 1000 / 0.28 * 0.75 }, led);
    assert.ok(led.intensity < 1 && led.intensity >= 0.75, "breathing 0.75 → 1.0 outside range");
    computeLed({ ...base, guard: true }, led);
    assert.equal(led.state, "guard"); assert.deepEqual(led.colour, hexToLinear("#3DE0FF"));
    computeLed({ ...base, grip: true, gripForce01: 1 }, led);
    assert.equal(led.state, "grip");
    const g = LINK_IDS.indexOf("gripper"), w = LINK_IDS.indexOf("wrist");
    const rgb = (l) => [led.perLink[l * 4], led.perLink[l * 4 + 1], led.perLink[l * 4 + 2]];
    const near3 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    assert.ok(near3(rgb(g), hexToLinear("#FFD60A")), "volt on the gripper");
    assert.ok(near3(rgb(w), hexToLinear("#2A6BFF")), "other links keep team");
    computeLed({ ...base, gripTarget: true }, led);
    assert.equal(led.state, "ready");
    assert.ok(rgb(g)[1] > hexToLinear("#2A6BFF")[1] && near3(rgb(w), hexToLinear("#2A6BFF")), "target stage: the gripper LED tints toward volt");
    computeLed({ ...base, heat01: 0.9 }, led);
    assert.equal(led.state, "hot");
    computeLed({ ...base, commitAtMs: 1000 - 10 }, led);
    assert.equal(led.state, "commit"); assert.deepEqual(led.colour, [1, 1, 1]);
    computeLed({ ...base, commitAtMs: 1000 - LED_COMMIT_FLARE_MS - LED_COMMIT_RAMP_MS / 2 }, led);
    assert.ok(led.colour[0] > hexToLinear("#2A6BFF")[0] && led.colour[0] < 1, "halfway down the 300 ms ramp");
    computeLed({ ...base, commitAtMs: 1000 - LED_COMMIT_FLARE_MS - LED_COMMIT_RAMP_MS - 1 }, led);
    assert.equal(led.state, "ready");
    computeLed({ ...base, whiffAtMs: 1000 - 100 }, led);
    assert.deepEqual(led.colour, hexToLinear("#FFB020"), "whiff: amber = behind the command");
    computeLed({ ...base, staggerAtMs: 1000 - 100, guard: true, heat01: 1 }, led);
    assert.equal(led.state, "stagger", "stagger outranks hot and guard");
    computeLed({ ...base, shortAtMs: 1000 - 100 }, led);
    assert.equal(led.state, "shorted"); assert.ok(led.intensity >= 0 && led.intensity < 0.4, "all to 0 over 150 ms");
    computeLed({ ...base, shortAtMs: 1000 - 900 }, led);
    assert.ok(led.intensity > 0 && led.state === "shorted", "one last amber blip at +900 ms");
    computeLed({ ...base, power: "boot" }, led);
    assert.equal(led.state, "boot"); assert.deepEqual(led.colour, hexToLinear("#FFB020"));
    computeLed({ ...base, power: "off" }, led);
    assert.equal(led.state, "off");
    assert.equal(led.perLink[w * 4 + 3], 0, "off: every link dark but the base blip");
    computeLed({ ...base, integrity01: 0.3, nowMs: 2000 }, led);
    let dark = 0;
    for (let l = 0; l < LINK_IDS.length; l++) if (led.perLink[l * 4 + 3] === 0) dark++;
    assert.ok(dark <= 1, "below 40 % at most one link is out at a time");
  });

  test("boot ritual: six-joint self-test then the slam to LOWERED; the written ctrl is the ritual pose and the LED plays BOOT", () => {
    const { pilot, frame, combat, out, kinematics } = setup();
    const home = kinematics.commandToJoints({ ...kinematics.homeCommand(), grip: GRIP_CLOSED }, new Float64Array(6));
    const q = new Float64Array(6);
    assert.equal(ritualJoints(50, 1800, home, q), false);
    assert.ok(Math.abs(q[0] - home[0]) > 0.1 && q[1] === home[1], "base first, alone");
    assert.equal(ritualJoints(5 * 110 + 55, 1800, home, q), false);
    assert.ok(Math.abs(q[5] - home[5]) > 0.1, "gripper last");
    assert.equal(ritualJoints(1500, 1800, home, q), true);
    assert.deepEqual(Array.from(q), Array.from(home), "then LOWERED = home");
    pilot.setMode("frozen");
    pilot.setRitual(300, 1800);
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    assert.ok(Math.abs(out[2] - home[2]) > 0.1, "elbow self-test at 300 ms is what the servos chase");
    assert.equal(pilot.led.state, "boot");
    assert.equal(pilot.eyesOpen, 0);
    pilot.setRitual(1700, 1800);
    assert.ok(pilot.eyesOpen > 0.7 && pilot.eyesOpen < 0.8);
    pilot.setRitual(null);
    assert.equal(pilot.led.state, "lowered");
    pilot.setMode("fight");
    pilot.sampleFrame(DT, false);
    assert.equal(pilot.led.state, "ready");
  });

  test("reticle magnetism (ARCADE): ≤ 3° toward the opponent's gripper within 12° while the mouse is slow, flagged as aimAssist, and held by the aim-brake", () => {
    const { pilot, frame, kinematics, combat, out } = setup({ rules: { aimAssist: true } });
    // Park the opponent's gripper 6° to the left of the aim.
    const yaw = pilot.aim.yaw + 6 * Math.PI / 180;
    const p = new Float64Array(3);
    kinematics.commandToJoints({ ...pilot.aim, yaw }, out);
    kinematics.fkTipEgo(out, p);
    egoToWorld("atlas", p[0], p[1], p[2], frame.arms.blaze.eePos);
    pilot.writeCommand(frame, combat, new Float64Array(6));
    const yaw0 = pilot.command.yaw;
    const { input } = { input: pilot.synthetic() };
    // A slow wobble (60 counts/s, net zero) is under the 200 counts/s gate: the magnet pulls the aim across.
    for (let i = 0; i < 60; i++) { input.move(i % 2 ? 1 : -1, 0); pilot.sampleFrame(DT, false); pilot.writeCommand(frame, combat, new Float64Array(6)); }
    const drift = pilot.command.yaw - yaw0;
    assert.ok(drift > 0.5 * MAGNET_MAX_RAD && drift <= MAGNET_MAX_RAD + 1e-9, `drifts toward the gripper (${drift})`);
    assert.equal(pilot.shaping.aimAssist, true);
    assert.ok(pilot.reticle.magnetism > 0.5);
    frames(pilot, 5);                                    // the brake engages 40 ms after the mouse stops
    const held = pilot.command.yaw;
    frames(pilot, 30);
    assert.ok(Math.abs(pilot.command.yaw - held) < 1e-6, "aim-brake: a stopped mouse holds the command");
    // A fast mouse (over 200 counts/s) gets no help.
    for (let i = 0; i < 30; i++) { input.move(i % 2 ? 8 : -8, 0); pilot.sampleFrame(DT, false); }
    assert.ok(pilot.command.yaw - yaw0 < drift + 1e-9 && pilot.reticle.magnetism < 0.2, "fast aim: the pull withdraws, never grows");
    pilot.setRules({ ...ARCADE_RULES, aimAssist: false });
    frames(pilot, 30);
    assert.ok(Math.abs(pilot.command.yaw - yaw0) < 1e-6, "Proving Ground: no magnetism");
  });

  test("match-1 assists: reach tracks the target depth (τ 150 ms) and the gripper auto-locks on Core contact, both flagged in shaping", () => {
    const kinematics = createKinematics();
    const settings = createSettingsStore({ storage: null });
    const pilot = createPilot({ kinematics, settings, clock: createGameClock(), profileMatchesPlayed: () => 0 }, { getPads: () => [] });
    pilot.setRules(ARCADE_RULES);
    const frame = fakeFrame();
    for (let i = 0; i < 9; i++) { frame.cubes.pos[i * 3] = 2 + 0.1 * i; frame.cubes.pos[i * 3 + 2] = 0.02; }
    const combat = fakeCombat();
    const out = new Float64Array(6);
    // Opponent gripper 6 cm further out than the tip along the aim.
    const p = new Float64Array(3);
    kinematics.commandToJoints({ ...kinematics.homeCommand(), grip: GRIP_CLOSED }, out);
    kinematics.fkTipEgo(out, p);
    const r = Math.hypot(p[0], p[1]);
    egoToWorld("atlas", p[0] * (r + 0.06) / r, p[1] * (r + 0.06) / r, p[2], frame.arms.blaze.eePos);
    pilot.setMode("fight");
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    const reach0 = pilot.command.reach;
    for (let i = 0; i < 60; i++) { pilot.sampleFrame(DT, false); pilot.writeCommand(frame, combat, out); }
    assert.ok(pilot.command.reach - reach0 > 0.04, `reach tracked out (${pilot.command.reach - reach0})`);
    assert.equal(pilot.shaping.aimAssist, true);
    // Core touches the gripper: auto-grip closes and grab-assists, and lets go 300 ms after it is over the own dock.
    frame.active.gripperOnCube.atlas = CORE_CUBE_INDEX;
    const c = CORE_CUBE_INDEX * 3;
    frame.cubes.pos[c] = frame.arms.atlas.eePos[0]; frame.cubes.pos[c + 1] = frame.arms.atlas.eePos[1]; frame.cubes.pos[c + 2] = 0.03;
    pilot.sampleFrame(DT, false);
    pilot.writeCommand(frame, combat, out);
    assert.equal(pilot.intents.grip, true);
    assert.equal(pilot.command.grip, GRIP_CLOSED);
    assert.equal(pilot.shaping.grabAssist, true);
    frame.active.bothJawsOnCube.atlas = CORE_CUBE_INDEX;
    frame.cubes.pos[c] = frame.docks[0]; frame.cubes.pos[c + 1] = frame.docks[1]; frame.cubes.pos[c + 2] = 0.03;
    frames(pilot, 40);                                   // 300 ms hold, 150 ms dock magnet, then the 250 ms open
    assert.equal(pilot.intents.grip, false, "released over the own dock");
    assert.equal(pilot.command.grip, GRIP_OPEN, "then the jaws open like a Space release");
  });

  test("strike buffer: 100 ms, 150 ms across a freeze", () => {
    const { pilot, input } = setup({ rules: { chargeMacro: false } });
    input.button(0, true); input.button(0, false);
    frames(pilot, Math.round(0.12 / DT), true);       // 120 ms frozen: the input clock stops
    pilot.sampleFrame(DT, false);
    assert.ok(pilot.shaped.reach > pilot.command.reach + 0.05, "the tap survives the freeze");
    assert.equal(FREEZE_EDGE_BUFFER_MS, 150);
  });

  test("motion hook fires inside the event with the counts and the direction reversal; tremor needs an open servo error", () => {
    const { pilot, input } = setup();
    const seen = [];
    const off = pilot.onMotion((counts, reversed) => seen.push([counts, reversed]));
    input.move(10, 0); input.move(5, 2); input.move(-3, 0);
    assert.deepEqual(seen, [[10, false], [7, false], [3, true]]);
    off();
    input.move(1, 0);
    assert.equal(seen.length, 3);
    assert.equal(tremorMm(0.01, 0), 0);
    assert.equal(tremorMm(0.1, 0), 0.1);
    assert.equal(tremorMm(0.1, 1), 0.6);
  });
});
