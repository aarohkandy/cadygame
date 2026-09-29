// WP3 juice (EMOTION_BIBLE section 6 camera column, 3.5 rules): per-event channel budgets, post effects only for
// KO, Stagger taken, and Stun taken, trauma decay, springs on wall time, settings scaling, preset profiles, edges,
// victim vibration, and the 3.5 caps (roll 3°, FOV punch 6°, trauma 0.35 outside a KO).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TOKEN_HEX } from "../src/game/contracts.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { hitstopMsFor } from "../src/game/combat/tuning.ts";
import {
  FOV_OFFSET_MAX_DEG, KO_SLOWMO, ROLL_MAX_DEG, TIER_BUDGET, TRAUMA_DECAY_PER_S, TRAUMA_MAX_LIVE, applyProfile, createJuice,
  juiceProfileFor, koTimeScale, planFeedback,
} from "../src/game/camera/juice.ts";
import { fakeCombat, fakeEvents, fakeFeedbackContext } from "../src/game/testing/fakes.ts";
import { createGameClock, HITSTOP_BUDGET_MS, HITSTOP_WINDOW_MS } from "../src/game/loop/game-clock.ts";
import { RUMBLE_MERGE_MS, mergeRumble, rumbleFor } from "../src/game/input/haptics.ts";

const strike = (o) => fakeEvents.strike({ tier: "strike", attacker: "atlas", victim: "blaze", magnitude: 0.5, crit: false, guarded: false, pos: [0, 0.05, 0.15], normal: [1, 0, 0], ...o });

function allEvents() {
  const list = [];
  for (const m of [0.1, 0.3, 0.39, 0.4, 0.7, 1]) {
    for (const who of [{ attacker: "atlas", victim: "blaze" }, { attacker: "blaze", victim: "atlas" }]) {
      list.push(strike({ magnitude: m, ...who }));
      list.push(strike({ magnitude: m, crit: true, ...who }));
      list.push(strike({ magnitude: m, guarded: true, ...who }));
      list.push(strike({ magnitude: m, tier: "graze", ...who }));
    }
  }
  list.push(fakeEvents.deflect({ defender: "atlas", attacker: "blaze" }), fakeEvents.deflect({ defender: "blaze", attacker: "atlas", hard: true }));
  list.push(fakeEvents.clash({ magnitude: 0.6 }), fakeEvents.contact({ magnitude: 0.3 }), fakeEvents.whiff({ seat: "atlas" }));
  for (const stage of ["start", "public", "full", "release", "cancel"]) list.push({ type: "charge", t: 0, step: 0, seat: "atlas", stage, c: 0.8 });
  for (const state of ["stagger", "stun", "cutout", "micro_stagger", "offline"]) {
    list.push(fakeEvents.servoState({ seat: "atlas", state }), fakeEvents.servoState({ seat: "blaze", state }));
  }
  list.push({ type: "burst", t: 0, step: 0, seat: "atlas" }, { type: "overheat", t: 0, step: 0, seat: "atlas" });
  list.push({ type: "ability", t: 0, step: 0, seat: "atlas", ability: "snap", phase: "start" });
  for (const stage of ["incoming", "drop", "lock_in_start", "steal", "lock"]) list.push(fakeEvents.core({ stage, seat: "atlas", from: "blaze" }));
  list.push(fakeEvents.ko({ victim: "blaze", attacker: "atlas" }), fakeEvents.ko({ victim: "atlas", attacker: "blaze" }));
  return list;
}

describe("juice", () => {
  test("every event stays inside its tier budget, and post is used only by KO, Stagger taken, and Stun taken", () => {
    for (const preset of ["arcade", "proving_ground", "harness"]) {
      for (const player of ["atlas", null]) {
        for (const e of allEvents()) {
          const plan = applyProfile(planFeedback(e, player, hitstopMsFor(e, preset, player)), juiceProfileFor(preset, player));
          assert.ok(plan.channels.size <= TIER_BUDGET[plan.tier], `${e.type} ${plan.tier} uses ${[...plan.channels]}`);
          if (plan.channels.has("P")) {
            const allowed = e.type === "ko" || (e.type === "servo_state" && e.state === "stagger" && e.seat === player) || (e.type === "deflect" && e.attacker === player);
            assert.ok(allowed, `${e.type} must not use post`);
          }
          if (e.type === "strike") assert.equal(plan.chromatic, 0, "ordinary strikes never set chromatic aberration");
          if (preset !== "arcade") assert.equal(plan.channels.has("S"), false, "no hit stop outside Arcade");
          if (player === null || preset === "harness") {
            assert.equal(plan.channels.has("C"), false, "spectators get no camera effects");
          }
        }
      }
    }
  });

  test("tier boundaries: light below m 0.4, heavy from 0.4 or on a crit", () => {
    assert.equal(planFeedback(strike({ magnitude: 0.39 }), "atlas", 20).tier, "light");
    assert.equal(planFeedback(strike({ magnitude: 0.4 }), "atlas", 21).tier, "heavy");
    assert.equal(planFeedback(strike({ magnitude: 0.2, crit: true }), "atlas", 22).tier, "heavy");
  });

  test("a heavy hit taken adds trauma, a kick, and an attacker-coloured edge; trauma decays 1.6 per second on wall time", () => {
    const settings = createSettingsStore({ storage: null });
    settings.set({ camera: { motion01: 1 } });
    const juice = createJuice(hitstopMsFor);
    const ctx = fakeFeedbackContext();
    juice.onEvents([strike({ attacker: "blaze", victim: "atlas", magnitude: 0.8, pos: [-0.2, 0.2, 0.15] })], ctx);
    const t0 = juice.trauma;
    assert.ok(Math.abs(t0 - (0.15 + 0.2 * 0.8)) < 1e-9, "section 6: trauma 0.15 + 0.20·m taken");
    juice.update(1 / 60, ctx, settings.get());
    assert.ok(Math.abs(juice.out.yaw) + Math.abs(juice.out.pitch) > 0, "the camera moves");
    assert.equal(juice.out.edge.color, TOKEN_HEX.magenta, "edge in the attacker's team colour");
    assert.ok(juice.out.edge.left > 0 && juice.out.edge.right === 0, "contact on the left lights the left edge");
    juice.update(0.1, ctx, settings.get());
    assert.ok(Math.abs(juice.trauma - (t0 - TRAUMA_DECAY_PER_S * (0.1 + 1 / 60))) < 1e-9);
    for (let i = 0; i < 60; i++) juice.update(1 / 60, ctx, settings.get());
    assert.equal(juice.out.edge.left, 0, "edge gone after 450 ms");
    assert.ok(Math.abs(juice.out.yaw) < 1e-3, "kick spring settled");
  });

  test("Arcade plays the section 6 table as written; Proving Ground halves the camera; Harness zeroes it", () => {
    const heavyTaken = () => strike({ attacker: "blaze", victim: "atlas", magnitude: 0.8, pos: [-0.2, 0.2, 0.15] });
    const koTaken = () => fakeEvents.ko({ victim: "atlas", attacker: "blaze" });
    const koDealt = () => fakeEvents.ko({ victim: "blaze", attacker: "atlas" });
    const played = (e, preset) => applyProfile(planFeedback(e, "atlas", hitstopMsFor(e, preset, "atlas")), juiceProfileFor(preset, "atlas"));
    const arcade = played(heavyTaken(), "arcade");
    assert.ok(near(arcade.trauma, 0.15 + 0.2 * 0.8) && near(kickDeg(arcade), 1.5 + 3 * 0.8), "table numbers, no multiplier");
    assert.ok(near(arcade.fovDeg, 3 * 0.8), `heavy taken knocks the view wide (${arcade.fovDeg})`);
    assert.ok(played(koTaken(), "arcade").fovDeg >= 5 && played(koDealt(), "arcade").fovDeg <= -4, "KO punches the FOV");
    for (const e of [heavyTaken(), koTaken(), koDealt()]) {
      const table = planFeedback(e, "atlas", 0);
      const pg = played(e, "proving_ground");
      assert.equal(pg.fovDeg, table.fovDeg * 0.5, "Proving Ground: the table at half");
      assert.equal(pg.trauma, table.trauma * 0.5);
      const h = played(e, "harness");
      assert.equal(h.fovDeg, 0); assert.equal(h.trauma, 0); assert.equal(kickDeg(h), 0);
    }
  });

  test("3.5 caps: roll ≤ 3°, FOV punch ≤ 6°, trauma ≤ 0.35 outside a KO; the maxima are kept per round", () => {
    const settings = createSettingsStore({ storage: null });
    settings.set({ camera: { motion01: 1 } });
    const juice = createJuice(hitstopMsFor);
    const ctx = fakeFeedbackContext();
    const hits = [];
    for (let i = 0; i < 6; i++) hits.push(strike({ attacker: "blaze", victim: "atlas", magnitude: 1, pos: [-0.2, 0.2, 0.15] }));
    juice.onEvents(hits, ctx);
    assert.ok(juice.trauma <= TRAUMA_MAX_LIVE + 1e-12, `trauma ${juice.trauma} capped at 0.35 outside a KO`);
    assert.ok(juice.stats.capHits > 0, "the attempts over the cap are counted for ?debug=feel");
    for (let i = 0; i < 120; i++) {
      juice.update(1 / 240, ctx, settings.get());
      assert.ok(Math.abs(juice.out.roll) <= ROLL_MAX_DEG * Math.PI / 180 + 1e-12);
      assert.ok(Math.abs(juice.out.fovOffsetDeg) <= FOV_OFFSET_MAX_DEG + 1e-12);
    }
    assert.ok(juice.stats.maxRollDeg <= ROLL_MAX_DEG && juice.stats.maxFovDeg <= FOV_OFFSET_MAX_DEG && juice.stats.maxTrauma <= TRAUMA_MAX_LIVE + 1e-12);
    const koCtx = fakeFeedbackContext({ phase: "ko", combat: fakeCombat() });
    juice.onEvents([fakeEvents.ko({ victim: "atlas", attacker: "blaze" })], koCtx);
    assert.ok(juice.trauma > TRAUMA_MAX_LIVE, "the KO row is the one event allowed over the cap");
    juice.onEvents([{ type: "phase", t: 0, step: 0, phase: "round_intro", round: 2, finalRound: false }], ctx);
    assert.equal(juice.stats.maxTrauma, 0, "a new round starts the maxima again");
    assert.equal(koTimeScale(0), KO_SLOWMO.scale);
    assert.equal(koTimeScale(KO_SLOWMO.ms - 1), 0.3);
    assert.equal(koTimeScale(KO_SLOWMO.ms), 1);
  });

  test("0% camera motion disables shake, kick, and FOV; stable cockpit halves shake and kick", () => {
    const off = createSettingsStore({ storage: null });
    off.set({ camera: { motion01: 0 } });
    const juice = createJuice(hitstopMsFor);
    const ctx = fakeFeedbackContext();
    juice.onEvents([strike({ attacker: "blaze", victim: "atlas", magnitude: 1 }), fakeEvents.clash({ magnitude: 1 })], ctx);
    juice.update(1 / 60, ctx, off.get());
    assert.equal(juice.out.yaw, 0);
    assert.equal(juice.out.pitch, 0);
    assert.equal(juice.out.fovOffsetDeg, 0);

    const measure = (cockpit) => {
      const s = createSettingsStore({ storage: null });
      s.set({ camera: { motion01: 1, cockpit } });
      const j = createJuice(hitstopMsFor);
      j.onEvents([fakeEvents.deflect({ attacker: "atlas", defender: "blaze" })], ctx);
      let peak = 0;
      for (let i = 0; i < 20; i++) { j.update(1 / 120, ctx, s.get()); peak = Math.max(peak, Math.abs(j.out.pitch)); }
      return peak;
    };
    assert.ok(Math.abs(measure("stable") - measure("standard") * 0.5) < 1e-9);
  });

  test("stagger taken pulses chromatic aberration (tau 90 ms); stun taken desaturates for the stun; effects % scales post", () => {
    const settings = createSettingsStore({ storage: null });
    const juice = createJuice(hitstopMsFor);
    const ctx = fakeFeedbackContext();
    juice.onEvents([fakeEvents.servoState({ seat: "atlas", state: "stagger", durationMs: 300 })], ctx);
    juice.update(1 / 1000, ctx, settings.get());
    assert.ok(juice.out.chromaticOffset > 0.0019);
    juice.update(0.09, ctx, settings.get());
    assert.ok(Math.abs(juice.out.chromaticOffset - 0.002 * Math.exp(-(0.091) / 0.09)) < 2e-5);
    juice.onEvents([fakeEvents.deflect({ attacker: "atlas", defender: "blaze", hard: false })], ctx);
    for (let i = 0; i < 6; i++) juice.update(0.1, ctx, settings.get());
    assert.equal(juice.out.desaturate, 0.3, "held for the 650 ms stun");
    juice.update(0.1, ctx, settings.get());
    assert.ok(juice.out.desaturate < 0.3, "then fades");
    settings.set({ video: { effects01: 0 } });
    juice.onEvents([fakeEvents.servoState({ seat: "atlas", state: "stagger" })], ctx);
    juice.update(0.001, ctx, settings.get());
    assert.equal(juice.out.chromaticOffset, 0);
  });

  test("victim vibration runs for the hit stop at 30 Hz and clears after; KO focus eases in during the KO beat", () => {
    const settings = createSettingsStore({ storage: null });
    settings.set({ camera: { motion01: 1 } });
    const juice = createJuice(hitstopMsFor);
    const ctx = fakeFeedbackContext();
    const hit = strike({ magnitude: 1, zone: "gripper" });
    const ms = hitstopMsFor(hit, "arcade", "atlas");
    juice.onEvents([hit], ctx);
    juice.update(0.005, ctx, settings.get());
    assert.equal(juice.out.victimVibration.seat, "blaze");
    assert.equal(juice.out.victimVibration.link, "gripper");
    assert.ok(Math.abs(juice.out.victimVibration.offset[0]) > 0.001);
    juice.update(0.1, ctx, settings.get());
    juice.update(ms / 1000 - 0.1, ctx, settings.get());
    assert.equal(juice.out.victimVibration.seat, null);

    const koCtx = fakeFeedbackContext({ phase: "ko", combat: fakeCombat() });
    juice.onEvents([fakeEvents.ko({ victim: "blaze", attacker: "atlas" })], koCtx);
    juice.update(0.1, koCtx, settings.get());
    assert.equal(juice.out.koFocus.weight, 0, "holds still for the first 150 ms");
    for (let i = 0; i < 60; i++) juice.update(1 / 60, koCtx, settings.get());
    assert.ok(juice.out.koFocus.weight > 0.99);
    const after = fakeFeedbackContext({ phase: "round_summary" });
    for (let i = 0; i < 30; i++) juice.update(1 / 60, after, settings.get());
    assert.equal(juice.out.koFocus.weight, 0);
  });
});

/* ───────── the 8.1 event → response table, row by row ───────── */

const plan = (e, me = "atlas") => planFeedback(e, me, hitstopMsFor(e, "arcade", me));
const chans = (p) => [...p.channels].sort().join("");
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const kickDeg = (p) => Math.hypot(p.kickYawDeg, p.kickPitchDeg);

// Every row is EMOTION_BIBLE section 6 read from the pilot's seat (atlas). stop is hitstopMsFor in ARCADE (50 + 125·m).
const TABLE = [
  { row: "contact (shove)", e: fakeEvents.contact({ magnitude: 0.3 }), tier: "none", chans: "AV", stop: 0 },
  { row: "strike graze", e: strike({ magnitude: 0.9, tier: "graze" }), tier: "light", chans: "AV", stop: 0,
    check: (p) => assert.equal(p.vibration, null, "a graze has no freeze, so nothing to feel") },
  { row: "strike dealt m<0.4", e: strike({ magnitude: 0.3 }), tier: "light", chans: "ASV", stop: 88,
    check: (p) => { assert.equal(p.trauma, 0); assert.equal(p.vibration.seat, "blaze"); assert.equal(p.vibration.durationMs, 88); } },
  { row: "strike dealt m>=0.4", e: strike({ magnitude: 0.7 }), tier: "heavy", chans: "ACSV", stop: 138,
    check: (p) => {
      assert.ok(near(p.trauma, 0.1 + 0.15 * 0.7)); assert.equal(p.traumaHz, 24); assert.equal(p.rollBias, true);
      assert.equal(p.kickPitchDeg, -0.8, "recoil"); assert.ok(near(p.fovDeg, -2.5 * (0.5 + 0.7)));
    } },
  { row: "strike dealt crit", e: strike({ magnitude: 0.7, crit: true }), tier: "heavy", chans: "ACSV", stop: 150,
    check: (p) => assert.ok(near(p.trauma, 0.1 + 0.15 * 0.7 + 0.05)) },
  { row: "strike dealt guarded (block: you hit their guard)", e: strike({ magnitude: 0.7, guarded: true }), tier: "light", chans: "ACSV", stop: 45,  // 33 + 17·0.7
    // No shake, a 0.5° push back along the normal; the freeze still reaches the victim's hand.
    check: (p) => {
      assert.equal(p.trauma, 0);
      assert.ok(near(kickDeg(p), 0.5));
      assert.equal(p.fovDeg, 0);
      assert.equal(p.vibration.seat, "blaze");
      assert.equal(p.vibration.durationMs, 60);
    } },
  { row: "strike taken guarded (you blocked: a wall does not move)", e: strike({ magnitude: 0.7, guarded: true, attacker: "blaze", victim: "atlas" }), tier: "light", chans: "ASV", stop: 45,
    check: (p) => { assert.equal(p.trauma, 0); assert.equal(kickDeg(p), 0); assert.equal(p.vibration.seat, "atlas"); assert.equal(p.vibration.durationMs, 60); } },
  { row: "strike taken m<0.4", e: strike({ magnitude: 0.3, attacker: "blaze", victim: "atlas" }), tier: "light", chans: "ASV", stop: 88 },
  { row: "strike taken m>=0.4", e: strike({ magnitude: 0.7, attacker: "blaze", victim: "atlas" }), tier: "heavy", chans: "ACESV", stop: 138,
    check: (p) => {
      assert.ok(near(p.trauma, 0.15 + 0.2 * 0.7));
      assert.equal(p.traumaHz, 18);
      assert.equal(p.rollBias, false);
      assert.ok(near(kickDeg(p), 1.5 + 3 * 0.7, 1e-9));
      assert.ok(near(p.fovDeg, 3 * 0.7));
      assert.ok(near(p.edge.strength, 0.3 * 0.7));
      assert.equal(p.edge.color, TOKEN_HEX.magenta);
    } },
  { row: "late_guard", e: { type: "late_guard", t: 0, step: 0, defender: "atlas", attacker: "blaze", refund: 9, pressLagMs: 40 }, tier: "light", chans: "AV", stop: 0 },
  { row: "deflect dealt", e: fakeEvents.deflect({ defender: "atlas", attacker: "blaze" }), tier: "heavy", chans: "ACSV", stop: 110,
    check: (p) => { assert.equal(p.fovDeg, -2); assert.equal(p.trauma, 0, "no shake on a deflect you land"); } },
  { row: "deflect taken (stunned)", e: fakeEvents.deflect({ defender: "blaze", attacker: "atlas" }), tier: "heavy", chans: "ACPSV", stop: 110,
    check: (p) => { assert.equal(p.kickPitchDeg, 2.5); assert.equal(p.desaturate, 0.3); assert.equal(p.desaturateMs, 650); assert.equal(p.chromatic, 0); } },
  { row: "deflect taken (hard)", e: fakeEvents.deflect({ defender: "blaze", attacker: "atlas", hard: true }), tier: "heavy", chans: "ACPSV", stop: 110,
    check: (p) => assert.equal(p.desaturateMs, 900) },
  { row: "clash", e: fakeEvents.clash({ magnitude: 0.6 }), tier: "heavy", chans: "ACSV", stop: 55,
    check: (p) => { assert.equal(p.trauma, 0, "a kick, no shake"); assert.ok(near(kickDeg(p), 1.5)); } },
  { row: "whiff (yours)", e: fakeEvents.whiff({ seat: "atlas" }), tier: "light", chans: "ACV", stop: 0,
    check: (p) => { assert.equal(p.kickRollDeg, 0.6, "roll into the swing"); assert.equal(p.kickPitchDeg, -0.4, "stumble dip"); assert.equal(p.trauma, 0); } },
  { row: "whiff (theirs)", e: fakeEvents.whiff({ seat: "blaze" }), tier: "light", chans: "AV", stop: 0 },
  { row: "charge release", e: { type: "charge", t: 0, step: 0, seat: "atlas", stage: "release", c: 1 }, tier: "light", chans: "ACV", stop: 0,
    check: (p) => assert.equal(p.fovDeg, -1.5) },
  { row: "stagger (you)", e: fakeEvents.servoState({ seat: "atlas", state: "stagger", durationMs: 600 }), tier: "heavy", chans: "ACPV", stop: 0,
    check: (p) => { assert.equal(p.trauma, 0, "no shake: the arm's brownout is the show"); assert.equal(p.fovDeg, 0); assert.equal(p.kickPitchDeg, -0.6, "0.6° dip"); assert.equal(p.chromatic, 0.002); } },
  { row: "stagger (opponent)", e: fakeEvents.servoState({ seat: "blaze", state: "stagger" }), tier: "light", chans: "AV", stop: 0 },
  { row: "burst (you)", e: { type: "burst", t: 0, step: 0, seat: "atlas" }, tier: "heavy", chans: "ACV", stop: 0,
    check: (p) => assert.equal(p.fovDeg, -2) },
  { row: "overheat", e: { type: "overheat", t: 0, step: 0, seat: "atlas" }, tier: "light", chans: "AV", stop: 0 },
  { row: "ability SNAP", e: { type: "ability", t: 0, step: 0, seat: "atlas", ability: "snap", phase: "start" }, tier: "light", chans: "ACV", stop: 0,
    check: (p) => assert.equal(p.fovDeg, -1.5) },
  { row: "core drop", e: fakeEvents.core({ stage: "drop" }), tier: "light", chans: "ACV", stop: 0,
    check: (p) => assert.equal(p.trauma, 0.05) },
  { row: "core steal (yours)", e: fakeEvents.core({ stage: "steal", seat: "atlas", from: "blaze" }), tier: "heavy", chans: "ACV", stop: 0,
    check: (p) => assert.equal(p.trauma, 0.15) },
  { row: "core lock", e: fakeEvents.core({ stage: "lock", seat: "atlas" }), tier: "ko", chans: "AV", stop: 0,
    check: (p) => assert.equal(p.chromatic, 0, "the lock beat is KO-class with no post") },
  { row: "KO dealt", e: fakeEvents.ko({ victim: "blaze", attacker: "atlas" }), tier: "ko", chans: "ACPSV", stop: 150,
    check: (p) => { assert.equal(p.trauma, 0.3); assert.equal(p.vignette, 0.2); assert.equal(p.koFocus, "blaze"); assert.equal(p.chromatic, 0); } },
  { row: "KO taken", e: fakeEvents.ko({ victim: "atlas", attacker: "blaze" }), tier: "ko", chans: "ACPSV", stop: 150,
    check: (p) => { assert.equal(p.trauma, 0.45); assert.equal(p.chromatic, 0.004); assert.equal(p.vignette, 0.35); } },
];

describe("event → response table (8.1)", () => {
  for (const r of TABLE) {
    test(`${r.row}: ${r.tier}, channels ${r.chans}, hit stop ${r.stop} ms`, () => {
      const p = plan(r.e);
      assert.equal(p.tier, r.tier);
      assert.equal(chans(p), r.chans);
      assert.equal(hitstopMsFor(r.e, "arcade", "atlas"), r.stop);
      assert.ok(p.channels.size <= TIER_BUDGET[p.tier], `${[...p.channels]} over the ${p.tier} budget`);
      r.check?.(p);
    });
  }

  test("every row is covered and no row leaks post outside KO, stagger taken, and the stun you cause", () => {
    const seen = new Set(TABLE.map((r) => r.e.type));
    for (const t of ["contact", "strike", "late_guard", "deflect", "clash", "whiff", "charge", "servo_state", "burst", "overheat", "ability", "core", "ko"]) {
      assert.ok(seen.has(t), `no table row for ${t}`);
    }
    const post = TABLE.filter((r) => chans(plan(r.e)).includes("P")).map((r) => r.row);
    assert.deepEqual(post, ["deflect taken (stunned)", "deflect taken (hard)", "stagger (you)", "KO dealt", "KO taken"]);
  });
});

/* ───────── response scales with the hit ───────── */

// One scalar for "how much did that land", normalised so every channel contributes about 1 at its ceiling.
function felt(m, { crit = false, taken = false } = {}) {
  const e = taken
    ? strike({ magnitude: m, crit, attacker: "blaze", victim: "atlas" })
    : strike({ magnitude: m, crit });
  const stop = hitstopMsFor(e, "arcade", "atlas");
  const p = planFeedback(e, "atlas", stop);
  const r = rumbleFor(e, { playerSeat: "atlas" }) ?? { durationMs: 0, strong: 0, weak: 0 };
  return {
    stop,
    trauma: p.trauma,
    kick: kickDeg(p),
    fov: Math.abs(p.fovDeg),
    edge: p.edge ? p.edge.strength : 0,
    rumble: (r.durationMs / 140) * (r.strong + r.weak),
    total: stop / 133 + p.trauma + kickDeg(p) / 4.5 + Math.abs(p.fovDeg) / 2 + (p.edge ? p.edge.strength / 0.3 : 0),
  };
}

const CHANNELS = ["stop", "trauma", "kick", "fov", "edge", "rumble", "total"];

describe("response scales with hit strength", () => {
  for (const taken of [false, true]) {
    test(`${taken ? "taken" : "dealt"}: no channel ever weakens as the hit gets stronger`, () => {
      let prev = felt(0, { taken });
      for (let m = 0.01; m <= 1.0001; m += 0.01) {
        const cur = felt(Math.min(1, m), { taken });
        for (const k of CHANNELS) assert.ok(cur[k] >= prev[k] - 1e-9, `${k} fell from ${prev[k]} to ${cur[k]} at m ${m.toFixed(2)}`);
        prev = cur;
      }
    });

    test(`${taken ? "taken" : "dealt"}: above the heavy line every 0.01 of strength is felt`, () => {
      let prev = felt(0.4, { taken });
      for (let m = 0.41; m <= 1.0001; m += 0.01) {
        const cur = felt(Math.min(1, m), { taken });
        assert.ok(cur.total > prev.total, `total flat at m ${m.toFixed(2)}: ${cur.total}`);
        prev = cur;
      }
    });
  }

  test("a fast flick reads far heavier than a slow drag", () => {
    const drag = felt(0.2, { taken: true });
    const flick = felt(0.8, { taken: true });
    assert.ok(flick.total > 2 * drag.total, `flick ${flick.total.toFixed(2)} vs drag ${drag.total.toFixed(2)}`);
    assert.equal(flick.stop, 150); assert.equal(drag.stop, 75);
    assert.equal(drag.kick, 0, "a drag never kicks the view");
    assert.ok(flick.kick >= 3.9, "a flick throws the view nearly 4°");
    assert.equal(drag.edge, 0);
    assert.ok(flick.edge > 0);
  });

  test("a crit is unmistakable: it promotes the tier, adds 20 ms of freeze (inside the cap) and 0.05 of trauma", () => {
    for (const m of [0.2, 0.5, 0.9]) {
      const plain = felt(m);
      const crit = felt(m, { crit: true });
      assert.equal(crit.stop, Math.min(150, plain.stop + 20));
      assert.ok(crit.total > plain.total, `crit at m ${m} must out-read the plain hit`);
      assert.equal(planFeedback(strike({ magnitude: m, crit: true }), "atlas", crit.stop).tier, "heavy");
    }
    assert.ok(felt(0.2, { crit: true }).total > felt(0.39).total, "a light crit out-reads the heaviest non-crit light hit");
  });

  test("taking a hit reads heavier than landing the same one", () => {
    for (const m of [0.4, 0.7, 1]) {
      const dealt = felt(m);
      const taken = felt(m, { taken: true });
      assert.ok(taken.trauma > dealt.trauma, `m ${m}: ${taken.trauma} vs ${dealt.trauma}`);
      assert.ok(taken.rumble > dealt.rumble);
      assert.ok(taken.total > dealt.total);
      assert.equal(taken.stop, dealt.stop, "the freeze itself is symmetric (8.1)");
    }
  });

  test("haptics follow the section 6 table, merge inside 75 ms, and cost nothing against the budget", () => {
    const me = { playerSeat: "atlas" };
    assert.deepEqual(rumbleFor(strike({ magnitude: 0.2 }), me), { durationMs: 50, strong: 0.15, weak: 0.25 }, "light dealt");
    const dealt = rumbleFor(strike({ magnitude: 0.5 }), me);
    assert.deepEqual(dealt, { durationMs: 50 + 70 * 0.5, strong: 0.15, weak: 0.25 + 0.4 * 0.5 });
    const taken = rumbleFor(strike({ magnitude: 0.5, attacker: "blaze", victim: "atlas" }), me);
    assert.deepEqual(taken, { durationMs: 60 + 80 * 0.5, strong: 0.4 + 0.5 * 0.5, weak: 0.3 + 0.4 * 0.5 });
    assert.deepEqual(rumbleFor(strike({ magnitude: 0.5, guarded: true }), me), { durationMs: 40, strong: 0.5, weak: 0 }, "thud into their guard");
    assert.deepEqual(rumbleFor(strike({ magnitude: 0.5, guarded: true, attacker: "blaze", victim: "atlas" }), me), { durationMs: 40, strong: 0.3, weak: 0 }, "you blocked");
    assert.deepEqual(rumbleFor(fakeEvents.whiff({ seat: "atlas" }), me), { durationMs: 30, strong: 0, weak: 0.2 }, "air pulse");
    assert.deepEqual(rumbleFor(fakeEvents.deflect({ defender: "atlas", attacker: "blaze" }), me), { durationMs: 80, strong: 0.6, weak: 0.6 });
    assert.deepEqual(rumbleFor(fakeEvents.clash(), me), { durationMs: 80, strong: 0.6, weak: 0.6 });
    assert.deepEqual(rumbleFor(fakeEvents.core({ stage: "steal", seat: "atlas", from: "blaze" }), me), { durationMs: 60, strong: 0.4, weak: 0.4 });
    assert.deepEqual(rumbleFor(fakeEvents.servoState({ seat: "atlas", state: "stagger" }), me), { durationMs: 140, strong: 1, weak: 0.2 });
    assert.deepEqual(rumbleFor(fakeEvents.ko({ victim: "atlas", attacker: "blaze" }), me), { durationMs: 250, strong: 1, weak: 0.6 }, "the only pulse over 250 ms is the KO");
    assert.equal(rumbleFor(strike({ magnitude: 1 }), { playerSeat: null }), null, "spectators feel nothing");
    const merged = mergeRumble(taken, 20, rumbleFor(fakeEvents.clash(), me));
    assert.deepEqual(merged, { durationMs: taken.durationMs - 20, strong: 0.65, weak: 0.6 }, "inside 75 ms: max of each motor, the longer remaining duration");
    assert.deepEqual(mergeRumble(taken, RUMBLE_MERGE_MS + 1, dealt), dealt, "outside the window the new pulse plays as itself");
    for (const e of [strike({ magnitude: 1 }), fakeEvents.clash(), fakeEvents.ko()]) {
      const p = plan(e);
      assert.ok(!p.channels.has("X"), "haptics are never a counted channel");
      assert.ok(p.channels.size <= TIER_BUDGET[p.tier]);
    }
  });
});

/* ───────── a synthetic 20-second exchange, every ceiling checked every frame ───────── */

describe("synthetic event stream", () => {
  test("twenty seconds of fighting stays inside the budget, the window, and the post rule", () => {
    const settings = createSettingsStore({ storage: null });
    settings.set({ camera: { motion01: 1 } });
    const juice = createJuice(hitstopMsFor);
    const clock = createGameClock();
    const ctx = fakeFeedbackContext();
    const FRAME = 1 / 60;
    const grants = [];
    let seed = 20260918;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let frozenWall = 0;
    let strikes = 0;

    for (let f = 0; f < 60 * 20; f++) {
      clock.advanceWall(FRAME);
      if (clock.hitstopRemainingMs > 0) frozenWall += FRAME;
      const events = [];
      if (f % 5 === 0) {
        const m = rand();
        const attacker = rand() < 0.5 ? "atlas" : "blaze";
        events.push(strike({
          magnitude: m,
          attacker,
          victim: attacker === "atlas" ? "blaze" : "atlas",
          crit: rand() < 0.08,
          guarded: rand() < 0.15,
          tier: rand() < 0.1 ? "graze" : "strike",
          pos: [(rand() - 0.5) * 0.4, 0.02 + rand() * 0.1, 0.1 + rand() * 0.1],
        }));
        strikes++;
      }
      if (f % 37 === 0) events.push(fakeEvents.contact({ magnitude: rand() * 0.4 }));
      if (f % 91 === 0) events.push(fakeEvents.clash({ magnitude: rand() }));
      if (f % 149 === 0) events.push(fakeEvents.deflect({ defender: "atlas", attacker: "blaze" }));
      if (f % 173 === 0) events.push({ type: "charge", t: 0, step: 0, seat: "atlas", stage: "release", c: 1 });
      if (events.length === 0) { juice.update(FRAME, ctx, settings.get()); continue; }

      let stop = 0;
      for (const e of events) stop = Math.max(stop, hitstopMsFor(e, "arcade", "atlas"));
      if (stop > 0) {
        const granted = clock.requestHitstop(stop);
        assert.ok(granted <= stop && granted <= 150, `granted ${granted} for a ${stop} ms request`);
        if (granted > 0) grants.push([clock.wallTime * 1000, granted]);
      }

      juice.onEvents(events, ctx);
      for (let i = 0; i < juice.lastPlans.length; i++) {
        const p = juice.lastPlans[i];
        assert.ok(p.channels.size <= TIER_BUDGET[p.tier], `frame ${f}: ${p.tier} used ${[...p.channels]}`);
        assert.equal(p.channels.has("S"), hitstopMsFor(events[i], "arcade", "atlas") > 0, `frame ${f}: S must track the freeze`);
        assert.equal(p.chromatic, 0, `frame ${f}: ordinary fighting never touches chromatic aberration`);
      }
      juice.update(FRAME, ctx, settings.get());

      const o = juice.out;
      for (const v of [o.yaw, o.pitch, o.roll, o.fovOffsetDeg, o.chromaticOffset, o.vignetteBoost, o.desaturate, o.edge.left, o.edge.right, o.edge.top]) {
        assert.ok(Number.isFinite(v), `frame ${f}: ${v}`);
      }
      assert.ok(juice.trauma <= 1);
      assert.ok(Math.abs(o.yaw) < 8 * (Math.PI / 180) && Math.abs(o.pitch) < 8 * (Math.PI / 180) && Math.abs(o.roll) < 8 * (Math.PI / 180));
      assert.ok(Math.abs(o.fovOffsetDeg) <= 6);
      assert.ok(o.edge.left <= 1 && o.edge.right <= 1 && o.edge.top <= 1);
      assert.equal(o.chromaticOffset, 0, `frame ${f}: no aberration from ordinary hits`);
    }

    assert.ok(strikes > 200, `only ${strikes} strikes in the stream`);
    for (let i = 0; i < grants.length; i++) {
      let sum = 0;
      for (let j = i; j < grants.length && grants[j][0] - grants[i][0] < HITSTOP_WINDOW_MS; j++) sum += grants[j][1];
      assert.ok(sum <= HITSTOP_BUDGET_MS + 1e-9, `the 600 ms window at ${grants[i][0]} ms holds ${sum} ms of freeze`);
    }
    const frozenFraction = frozenWall / 20;
    assert.ok(frozenFraction > 0.05 && frozenFraction < 0.2, `frozen ${(frozenFraction * 100).toFixed(1)}% of the fight`);
  });

  test("the same stream does fire post the moment a KO lands, so the rule above is not vacuous", () => {
    const settings = createSettingsStore({ storage: null });
    const juice = createJuice(hitstopMsFor);
    const koCtx = fakeFeedbackContext({ phase: "ko", combat: fakeCombat() });
    juice.onEvents([fakeEvents.ko({ victim: "atlas", attacker: "blaze" })], koCtx);
    juice.update(1 / 60, koCtx, settings.get());
    assert.ok(juice.out.chromaticOffset > 0.003, "a KO taken bends the light");
    assert.ok(juice.out.vignetteBoost > 0.3);
    assert.equal(juice.out.koFocus.seat, "atlas");
  });
});
