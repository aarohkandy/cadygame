// WP3 crowd hype (GAME_DESIGN 8.7 with steal replacing pry, BUILD_PLAN 4 WP3.15): impulses, decay, floors,
// refractory, reactions, the home crowd, and the bed levels it drives.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HYPE_DECAY_PER_S, HYPE_REFRACTORY_MS, createHypeModel, hypeImpulsesFor } from "../src/game/feedback/hype.ts";
import { crowdBedLevels, fillApplause } from "../src/game/audio/crowd.ts";
import { dbToGain } from "../src/game/audio/synth.ts";
import { fakeEvents, fakeFeedbackContext } from "../src/game/testing/fakes.ts";

const live = fakeFeedbackContext({ phase: "fight" });

describe("crowd hype", () => {
  test("impulses: strike 0.04 + 0.1 m, crit +0.12, deflect +0.15, clash +0.06, steal +0.35, late steal +0.6, KO +0.7, lock +0.5", () => {
    const cases = [
      [fakeEvents.strike({ magnitude: 0.5, crit: false }), 0.09],
      [fakeEvents.deflect(), 0.15],
      [fakeEvents.clash(), 0.06],
      [fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", late: false }), 0.35],
      [fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", late: true }), 0.6],
      [fakeEvents.ko(), 0.7],
      [fakeEvents.core({ stage: "lock", seat: "atlas" }), 0.5],
      [{ type: "stalemate", t: 0, step: 0, seconds: 6 }, -0.1],
    ];
    for (const [e, amount] of cases) {
      const imp = hypeImpulsesFor(e, "atlas", []);
      assert.ok(Math.abs(imp.reduce((s, i) => s + i.amount, 0) - amount) < 1e-12, `${e.type} ${amount}`);
    }
    const critImp = hypeImpulsesFor(fakeEvents.strike({ magnitude: 1, crit: true }), "atlas", []);
    assert.ok(Math.abs(critImp.reduce((s, i) => s + i.amount, 0) - 0.26) < 1e-12);
    assert.equal(hypeImpulsesFor(fakeEvents.strike({ tier: "graze" }), "atlas", []).length, 0);
  });

  test("decay 0.12/s down to a 0.15 floor in a fight, 0.4 when spectating, none in menus; sudden death lifts to 0.6", () => {
    const h = createHypeModel();
    h.reset(0.5);
    for (let i = 0; i < 4; i++) h.update(0.25, live);
    assert.ok(Math.abs(h.h - (0.5 - HYPE_DECAY_PER_S)) < 1e-12);
    for (let i = 0; i < 100; i++) h.update(0.1, live);
    assert.equal(h.h, 0.15);
    const spectate = fakeFeedbackContext({ phase: "fight", playerSeat: null });
    h.update(0.1, spectate);
    assert.equal(h.h, 0.4);
    const menu = fakeFeedbackContext({ phase: "green_room" });
    for (let i = 0; i < 50; i++) h.update(0.1, menu);
    assert.equal(h.h, 0);
    h.onEvents([fakeEvents.phase({ phase: "sudden_death" })], live, 0);
    assert.equal(h.h, 0.6);
  });

  test("refractory: 700 ms per reaction type, types independent", () => {
    const h = createHypeModel();
    h.reset(0);
    h.onEvents([fakeEvents.deflect()], live, 0);
    h.onEvents([fakeEvents.deflect()], live, 300);
    assert.ok(Math.abs(h.h - 0.15) < 1e-12, "second deflect inside 700 ms ignored");
    h.onEvents([fakeEvents.clash()], live, 400);
    assert.ok(Math.abs(h.h - 0.21) < 1e-12, "a different type still lands");
    h.onEvents([fakeEvents.deflect()], live, HYPE_REFRACTORY_MS + 1);
    assert.ok(Math.abs(h.h - 0.36) < 1e-12);
  });

  test("reactions: roar for impulses >= 0.3, ohh on deflects, groan when the pilot is stolen from or knocked out", () => {
    const h = createHypeModel();
    assert.equal(h.onEvents([fakeEvents.deflect()], live, 0), "ohh");
    assert.equal(h.onEvents([fakeEvents.ko({ victim: "blaze", attacker: "atlas" })], live, 10), "roar");
    const h2 = createHypeModel();
    assert.equal(h2.onEvents([fakeEvents.ko({ victim: "atlas", attacker: "blaze" })], live, 0), "groan", "home crowd groans");
    assert.equal(h2.onEvents([fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas" })], live, 10), "groan");
    assert.equal(h2.onEvents([fakeEvents.core({ stage: "steal", seat: "atlas", from: "blaze" })], live, 900), "roar", "the pilot's steal is cheered");
    const spectator = createHypeModel();
    assert.equal(spectator.onEvents([fakeEvents.ko({ victim: "atlas" })], fakeFeedbackContext({ playerSeat: null }), 0), "roar");
    assert.equal(createHypeModel().onEvents([fakeEvents.strike({ magnitude: 0.5 })], live, 0), null, "a small hit gets no shout");
  });

  test("lean: the room swings to the pilot on a streak, a steal or a KO, to the AI on theirs, and relaxes with τ 4 s", () => {
    const h = createHypeModel();
    h.onEvents([{ type: "combo", t: 0, step: 0, seat: "atlas", count: 3 }], live, 0);
    assert.ok(h.lean > 0.3, `pilot streak ${h.lean}`);
    const before = h.lean;
    for (let i = 0; i < 16; i++) h.update(0.25, live);
    assert.ok(Math.abs(h.lean - before * Math.exp(-1)) < 1e-9, "τ 4 s");
    h.onEvents([fakeEvents.ko({ victim: "atlas", attacker: "blaze" })], live, 5000);
    assert.ok(h.lean < -0.5, `AI KO ${h.lean}`);
    assert.equal(h.onEvents([{ type: "combo", t: 0, step: 0, seat: "blaze", count: 3 }], live, 6000), "groan", "the AI's streak groans");
    assert.ok(h.lean >= -1 && h.lean <= 1);
    const spectator = createHypeModel();
    spectator.onEvents([fakeEvents.ko({ victim: "atlas", attacker: "blaze" })], fakeFeedbackContext({ playerSeat: null }), 0);
    assert.equal(spectator.lean, 0, "no home side while spectating");
    h.reset();
    assert.equal(h.lean, 0);
  });

  test("an average ARCADE match crosses hype 50 at least twice", () => {
    // Three 45 s rounds at 60 Hz: an exchange every ~2.5 s at mixed magnitudes, a streak per round, a Core drop with a
    // lock in round 1, a steal in round 2, a KO ending round 3, the between-round lull decaying the crowd back down.
    const h = createHypeModel();
    let ms = 0, ups = 0, above = false;
    const step = (dtS, events = [], ctx = live) => {
      ms += dtS * 1000;
      if (events.length) h.onEvents(events, ctx, ms);
      h.update(dtS, ctx);
      if (!above && h.h >= 0.5) { above = true; ups++; } else if (above && h.h < 0.5) above = false;
    };
    const lull = fakeFeedbackContext({ phase: "round_summary" });
    for (let round = 1; round <= 3; round++) {
      for (let f = 0; f < 45 * 60; f++) {
        const t = f / 60;
        const ev = [];
        if (f % 150 === 0 && f > 0) ev.push(fakeEvents.strike({ magnitude: 0.25 + 0.5 * ((f / 150) % 3) / 2, crit: f % 900 === 0, attacker: f % 300 === 0 ? "atlas" : "blaze" }));
        if (Math.abs(t - 20) < 1e-9) ev.push({ type: "combo", t, step: f, seat: "atlas", count: 3 });
        if (round === 1 && Math.abs(t - 35) < 1e-9) ev.push(fakeEvents.core({ stage: "lock", seat: "atlas" }));
        if (round === 2 && Math.abs(t - 30) < 1e-9) ev.push(fakeEvents.core({ stage: "steal", seat: "atlas", from: "blaze", late: false }));
        if (round === 3 && Math.abs(t - 40) < 1e-9) ev.push(fakeEvents.ko({ victim: "blaze", attacker: "atlas" }));
        step(1 / 60, ev);
      }
      for (let f = 0; f < 8 * 60; f++) step(1 / 60, [], lull);
    }
    assert.ok(ups >= 2, `crossed 50 upward ${ups} times`);
  });

  test("bed levels: murmur -22 dB during shows, cheer h^2 x -8 dB, applause density 20 h per second; silent in menus", () => {
    const out = { murmur: 0, cheer: 0, applause: 0, brightnessHz: 0 };
    crowdBedLevels(0.5, true, out);
    assert.ok(Math.abs(out.murmur - dbToGain(-22)) < 1e-12);
    assert.ok(Math.abs(out.cheer - 0.25 * dbToGain(-8)) < 1e-12);
    const a = out.applause;
    crowdBedLevels(1, true, out);
    assert.ok(out.applause > a && out.brightnessHz > 5000);
    crowdBedLevels(1, false, out);
    assert.deepEqual([out.murmur, out.cheer, out.applause], [0, 0, 0]);
  });

  test("the applause texture is deterministic, stereo, finite, and loop-safe", () => {
    const n = 48000;
    const l1 = new Float32Array(n), r1 = new Float32Array(n), l2 = new Float32Array(n), r2 = new Float32Array(n);
    fillApplause(l1, r1, 48000, 9);
    fillApplause(l2, r2, 48000, 9);
    assert.deepEqual(l1, l2);
    let peak = 0, diff = 0;
    for (let i = 0; i < n; i++) {
      assert.ok(Number.isFinite(l1[i]) && Number.isFinite(r1[i]));
      peak = Math.max(peak, Math.abs(l1[i]), Math.abs(r1[i]));
      diff += Math.abs(l1[i] - r1[i]);
    }
    assert.ok(peak > 0.02 && peak < 1, `peak ${peak}`);
    assert.ok(diff > 1, "claps are panned");
    assert.equal(l1[0], 0);
    assert.ok(Math.abs(l1[n - 1]) < 1e-6, "faded at the loop seam");
  });
});
