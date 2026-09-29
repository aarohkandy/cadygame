import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HITSTOP } from "../src/game/combat/tuning.ts";
import { createGameClock, HITSTOP_BUDGET_MS, HITSTOP_WINDOW_MS } from "../src/game/loop/game-clock.ts";

// EMOTION_BIBLE 6 as tuned in tuning.ts: every strike freezes clamp(50 + 125·m, 50, 150); a flick at m 0.4 → 100 ms.
const strikeMs = (m) => Math.min(HITSTOP.cap, Math.round(HITSTOP.base + HITSTOP.perM * m));
const FRAME = 1 / 60;

describe("hit-stop budget: 120 ms of freeze per rolling 600 ms of wall time", () => {
  test("ten m = 1 strikes within 600 ms grant ≤ 120 ms in total", () => {
    const clock = createGameClock();
    let granted = 0;
    for (let i = 0; i < 10; i++) {
      granted += clock.requestHitstop(strikeMs(1));
      clock.advanceWall(0.055);                               // 10 strikes across 550 ms
    }
    assert.ok(granted <= HITSTOP_BUDGET_MS, `granted ${granted}`);
    assert.equal(granted, 120, "the first request is trimmed to the full budget");
  });

  test("the window rolls: budget returns once old grants are 600 ms old", () => {
    const clock = createGameClock();
    assert.equal(clock.requestHitstop(100), 100);
    clock.advanceWall(0.3);
    assert.equal(clock.requestHitstop(50), 20, "only 20 ms of budget left");
    assert.equal(clock.hitstopBudgetUsedMs, 120);
    clock.advanceWall(0.3);                                   // first grant is now exactly 600 ms old
    assert.equal(clock.hitstopBudgetUsedMs, 20);
    assert.equal(clock.requestHitstop(133), 100);
    clock.advanceWall(HITSTOP_WINDOW_MS / 1000);
    assert.equal(clock.hitstopBudgetUsedMs, 0);
  });

  test("no rolling 600 ms window ever holds more than 120 ms of grants under a strike storm", () => {
    const clock = createGameClock();
    const grants = [];
    for (let f = 0; f < 60 * 20; f++) {
      clock.advanceWall(FRAME);
      if (f % 3 === 0) {
        const m = 0.4 + 0.6 * ((f * 7919) % 101) / 100;
        const g = clock.requestHitstop(strikeMs(m));
        if (g > 0) grants.push([clock.wallTime * 1000, g]);
      }
    }
    for (let i = 0; i < grants.length; i++) {
      let sum = 0;
      for (let j = i; j < grants.length && grants[j][0] - grants[i][0] < HITSTOP_WINDOW_MS; j++) sum += grants[j][1];
      assert.ok(sum <= HITSTOP_BUDGET_MS + 1e-9, `window starting ${grants[i][0]} ms holds ${sum} ms`);
    }
  });

  test("a 4-per-second flick exchange stays inside the rolling budget (at most a fifth of wall time)", () => {
    const clock = createGameClock();
    const seconds = 10;
    let frozenWall = 0;
    for (let f = 0; f < seconds * 60; f++) {
      clock.advanceWall(FRAME);
      if (clock.hitstopRemainingMs > 0) frozenWall += FRAME;
      if (f % 15 === 0) clock.requestHitstop(strikeMs(0.4));
    }
    const fraction = frozenWall / seconds;
    assert.ok(fraction > 0.1 && fraction <= 0.2 + 1e-6, `frozen ${(fraction * 100).toFixed(1)}%`);
  });

  test("KO's 150 ms request in an already-spent window is trimmed, never exceeds the cap", () => {
    const clock = createGameClock();
    clock.requestHitstop(90);                                  // deflect
    clock.advanceWall(0.1);
    const ko = clock.requestHitstop(150);
    assert.equal(ko, 30);
    assert.ok(clock.hitstopRemainingMs <= 150);
  });
});

describe("hit-stop budget under a mixed storm", () => {
  test("a single request is trimmed to whatever the window has left, never past the 150 ms cap", () => {
    const clock = createGameClock();
    const granted = clock.requestHitstop(200);
    assert.equal(granted, HITSTOP_BUDGET_MS, "a fresh window grants the whole budget and no more");
    assert.ok(clock.hitstopRemainingMs <= 150);
  });

  test("the budget refills to full after 600 ms of quiet", () => {
    const clock = createGameClock();
    assert.equal(clock.requestHitstop(120), 120);
    assert.equal(clock.requestHitstop(133), 0, "the window is spent");
    clock.advanceWall(HITSTOP_WINDOW_MS / 1000);
    assert.equal(clock.hitstopBudgetUsedMs, 0);
    assert.equal(clock.requestHitstop(133), 120, "and a fresh window pays out again");
  });

  test("crits, deflects, clashes and a KO in one exchange never break the 600 ms window", () => {
    const clock = createGameClock();
    const requests = [strikeMs(1), HITSTOP.deflect, HITSTOP.clash, strikeMs(0.8), 150, strikeMs(0.5), 90, 150];
    const grants = [];
    for (let f = 0, i = 0; f < 60 * 12; f++) {
      clock.advanceWall(FRAME);
      if (f % 9 === 0) {
        const g = clock.requestHitstop(requests[i++ % requests.length]);
        if (g > 0) grants.push([clock.wallTime * 1000, g]);
      }
    }
    for (let i = 0; i < grants.length; i++) {
      let sum = 0;
      for (let j = i; j < grants.length && grants[j][0] - grants[i][0] < HITSTOP_WINDOW_MS; j++) sum += grants[j][1];
      assert.ok(sum <= HITSTOP_BUDGET_MS + 1e-9, `window at ${grants[i][0]} ms holds ${sum} ms`);
    }
    assert.ok(grants.length > 20, `only ${grants.length} freezes granted`);
  });

  test("even asking for a KO freeze every frame, the sim runs at least 80% of the time", () => {
    const clock = createGameClock();
    let frozen = 0;
    const seconds = 10;
    for (let f = 0; f < seconds * 60; f++) {
      clock.advanceWall(FRAME);
      if (clock.hitstopRemainingMs > 0) frozen += FRAME;
      clock.requestHitstop(150);
    }
    assert.ok(frozen / seconds <= 0.2 + 1e-6, `frozen ${(frozen / seconds * 100).toFixed(1)}% of wall time`);
  });

  test("a KO that lands in a spent window waits for the budget instead of being dropped", () => {
    const clock = createGameClock();
    clock.requestHitstop(120);
    assert.equal(clock.requestHitstop(150), 0, "nothing left this window");
    clock.advanceWall(0.3);
    assert.equal(clock.requestHitstop(150), 0, "still nothing 300 ms in");
    clock.advanceWall(0.31);
    assert.ok(clock.requestHitstop(150) >= 120, "the KO freezes as soon as the window rolls");
  });
});

/* ───────── FeedbackFrame (EMOTION_BIBLE 11.9): feel state written per render frame through and after the freeze ───────── */

import { FEEL, createFeelFrame } from "../src/game/feedback/feedback-system.ts";
import { fakeEvents, fakeFeedbackContext } from "../src/game/testing/fakes.ts";

function feelRig(playerSeat = "atlas") {
  let hitstop = 0;
  const feel = createFeelFrame(() => hitstop);
  const ctx = fakeFeedbackContext({ playerSeat, phase: "fight" });
  const frames = (n, dtS = 1 / 60) => { for (let i = 0; i < n; i++) feel.update(dtS, ctx, 0.25); };
  return { feel, ctx, frames, freeze: (ms) => { hitstop = ms; }, f: feel.frame };
}

describe("feedback frame", () => {
  test("a heavy hit: the victim vibrates 1.5 mm on the contact frame and through the whole freeze, then settles in τ 40 ms", () => {
    const r = feelRig();
    r.freeze(150);
    r.feel.onEvents([fakeEvents.strike({ magnitude: 0.8, attacker: "atlas", victim: "blaze", tool: "gripper", zone: "wrist" })], r.ctx);
    r.frames(1);
    assert.equal(r.f.vibration.blaze, FEEL.vibHeavyMm);
    assert.equal(r.f.vibration.atlas, 0);
    assert.deepEqual([r.f.deckFlash.seat, r.f.hitLight.on, r.f.hitLight.seat], ["blaze", true, "blaze"]);
    r.frames(8);                                              // 133 ms of wall time inside a 150 ms freeze
    assert.equal(r.f.vibration.blaze, FEEL.vibHeavyMm, "held through the freeze");
    assert.equal(r.f.ledFlare.atlas, "gripper", "the striking link flares white");
    assert.deepEqual([r.f.deckFlash.seat, r.f.hitLight.on], [null, false], "the 120 ms flash and light ran on wall time");
    r.freeze(0);
    r.frames(2);
    assert.ok(r.f.vibration.blaze < FEEL.vibHeavyMm, "decays once the world moves");
    r.frames(20);
    assert.equal(r.f.vibration.blaze, 0);
    assert.equal(r.f.ledFlare.atlas, null, "flare gone after 250 ms");
    assert.equal(r.f.hypeLean, 0.25, "lean passes through from hype");
  });

  test("a light hit: 0.8 mm on the victim, its struck link white for one frame, no deck flash or hit light", () => {
    const r = feelRig();
    r.freeze(60);
    r.feel.onEvents([fakeEvents.strike({ magnitude: 0.2, attacker: "blaze", victim: "atlas", zone: "lower_arm" })], r.ctx);
    r.frames(1);
    assert.equal(r.f.vibration.atlas, FEEL.vibLightMm);
    assert.equal(r.f.ledFlare.atlas, "lower_arm");
    assert.deepEqual([r.f.deckFlash.seat, r.f.hitLight.on, r.f.lensSmear], [null, false, 0]);
    r.frames(1);
    assert.equal(r.f.ledFlare.atlas, null, "one frame");
    const guarded = feelRig();
    guarded.feel.onEvents([fakeEvents.strike({ magnitude: 0.9, guarded: true, victim: "atlas" })], guarded.ctx);
    guarded.frames(1);
    assert.equal(guarded.f.vibration.atlas, 0, "a wall does not move");
  });

  test("crit and clash: the impact frame reads 1 for two frames, 0.5 for 60 ms, then 0; a KO doubles it", () => {
    const r = feelRig();
    r.feel.onEvents([fakeEvents.strike({ magnitude: 0.7, crit: true, victim: "blaze" })], r.ctx);
    r.frames(1); assert.equal(r.f.impactFrame, 1);
    r.frames(1); assert.equal(r.f.impactFrame, 1);
    r.frames(1); assert.equal(r.f.impactFrame, 0.5);
    r.frames(4); assert.equal(r.f.impactFrame, 0);
    r.feel.onEvents([fakeEvents.ko({ victim: "blaze", attacker: "atlas" })], r.ctx);
    for (let i = 0; i < 4; i++) { r.frames(1); assert.equal(r.f.impactFrame, 1, `KO frame ${i}`); }
    r.frames(1); assert.equal(r.f.impactFrame, 0.5);
    assert.equal(r.f.deckFlash.seat, "atlas", "deck edges go to the winner");
    const c = feelRig();
    c.feel.onEvents([fakeEvents.clash()], c.ctx);
    c.frames(1);
    assert.equal(c.f.impactFrame, 1);
    assert.equal(c.f.vibration.atlas, FEEL.vibLightMm);
    assert.equal(c.f.vibration.blaze, FEEL.vibLightMm);
  });

  test("a heavy hit taken by the pilot smears the lens, fading with τ 6 s; heat above 70 puts a tremor in the pilot's arm", () => {
    const r = feelRig("atlas");
    r.feel.onEvents([fakeEvents.strike({ magnitude: 0.6, attacker: "blaze", victim: "atlas" })], r.ctx);
    r.frames(1);
    assert.ok(r.f.lensSmear > 0.98);
    r.frames(6 * 60);
    assert.ok(Math.abs(r.f.lensSmear - Math.exp(-1)) < 0.02, `τ 6 s: ${r.f.lensSmear}`);
    const dealt = feelRig("atlas");
    dealt.feel.onEvents([fakeEvents.strike({ magnitude: 0.9, attacker: "atlas", victim: "blaze" })], dealt.ctx);
    dealt.frames(1);
    assert.equal(dealt.f.lensSmear, 0, "dealing a hit does not smear your own lens");
    const hot = feelRig("atlas");
    hot.ctx.combat.seats.atlas.heat = 100;
    hot.frames(1);
    assert.equal(hot.f.vibration.atlas, FEEL.tremorMaxMm);
    hot.ctx.combat.seats.atlas.heat = 60;
    hot.frames(1);
    assert.equal(hot.f.vibration.atlas, 0);
  });

  test("a steal floods the robbed owner's deck edge red for 300 ms", () => {
    const r = feelRig();
    r.feel.onEvents([fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas" })], r.ctx);
    r.frames(1);
    assert.equal(r.f.deckFlash.seat, "atlas");
    r.frames(20);
    assert.equal(r.f.deckFlash.seat, null);
  });
});
