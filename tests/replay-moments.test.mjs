import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { selectReplayMoment, planReplay, replaySpeedAt, ROUND_REPLAY_S, MATCH_REPLAY_S } from "../src/game/match/replay-moments.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";

const at = (e, t) => ({ ...e, t, step: Math.round(t / 0.0025) });

describe("earned replay selection (8.6, pry read as steal)", () => {
  test("1: a KO whose lethal strike had m ≥ 0.8 earns a replay labelled with its real numbers", () => {
    const events = [at(fakeEvents.strike({ magnitude: 0.85, lethal: true, vN: 2.74, damage: 31.4 }), 20), at(fakeEvents.ko(), 20)];
    const m = selectReplayMoment(events, { winner: "atlas", reason: "ko", t: 20 });
    assert.deepEqual(m, { reason: "ko_impact", priority: 1, eventT: 20, label: "IMPACT 2.7 m/s · 31" });
  });

  test("1: a crit KO qualifies below m 0.8; an ordinary light KO does not", () => {
    const crit = [at(fakeEvents.strike({ magnitude: 0.4, lethal: true, crit: true }), 9)];
    assert.equal(selectReplayMoment(crit, { winner: "atlas", reason: "ko", t: 9 })?.reason, "ko_impact");
    const light = [at(fakeEvents.strike({ magnitude: 0.5, lethal: true }), 9)];
    assert.equal(selectReplayMoment(light, { winner: "atlas", reason: "ko", t: 9 }), null);
  });

  test("2: a late steal by the round winner", () => {
    const events = [at(fakeEvents.core({ stage: "steal", seat: "blaze", from: "atlas", remainingS: 1.6, late: true }), 30)];
    const m = selectReplayMoment(events, { winner: "blaze", reason: "lock", t: 38 });
    assert.equal(m.reason, "late_steal");
    assert.equal(m.eventT, 30);
    assert.equal(m.label, "LATE STEAL · 1.6 s LEFT");
    assert.equal(selectReplayMoment(events, { winner: "atlas", reason: "time", t: 45 }), null, "the loser's late steal decided nothing");
  });

  test("3: a lock within 3 s after a steal", () => {
    const events = [at(fakeEvents.core({ stage: "steal", seat: "blaze", remainingS: 5 }), 30)];
    assert.equal(selectReplayMoment(events, { winner: "blaze", reason: "lock", t: 32.5 })?.reason, "lock_after_steal");
    assert.equal(selectReplayMoment(events, { winner: "blaze", reason: "lock", t: 33.5 }), null);
  });

  test("4: a winner's deflect within 2 s before the deciding hit", () => {
    const hit = at(fakeEvents.strike({ attacker: "blaze", victim: "atlas", magnitude: 0.5, lethal: true, vN: 1.9, damage: 12 }), 15);
    const deflect = at(fakeEvents.deflect({ defender: "blaze", attacker: "atlas" }), 13.5);
    const m = selectReplayMoment([deflect, hit], { winner: "blaze", reason: "ko", t: 15 });
    assert.equal(m.reason, "deflect_punish");
    assert.equal(m.eventT, 15);
    const early = at(fakeEvents.deflect({ defender: "blaze", attacker: "atlas" }), 12.5);
    assert.equal(selectReplayMoment([early, hit], { winner: "blaze", reason: "ko", t: 15 }), null);
  });

  test("priority 1 > 2 > 3 > 4 when several qualify", () => {
    const events = [
      at(fakeEvents.deflect({ defender: "atlas", attacker: "blaze" }), 19.5),
      at(fakeEvents.core({ stage: "steal", seat: "atlas", remainingS: 1.2, late: true }), 19.6),
      at(fakeEvents.strike({ magnitude: 0.9, lethal: true }), 20),
    ];
    assert.equal(selectReplayMoment(events, { winner: "atlas", reason: "ko", t: 20 }).priority, 1);
    events[2] = at(fakeEvents.strike({ magnitude: 0.3, lethal: true }), 20);
    assert.equal(selectReplayMoment(events, { winner: "atlas", reason: "ko", t: 20 }).priority, 2);
  });

  test("nothing qualifying means no replay", () => {
    assert.equal(selectReplayMoment([], { winner: "atlas", reason: "time", t: 45 }), null);
    assert.equal(selectReplayMoment([at(fakeEvents.strike({ magnitude: 1 }), 3)], { winner: "atlas", reason: "time", t: 45 }), null);
  });
});

describe("replay clip plan", () => {
  test("speed curve: 1× lead-in, 0.25× through the event, 0.6× after", () => {
    assert.equal(replaySpeedAt(9, 10), 1);
    assert.equal(replaySpeedAt(10, 10), 0.25);
    assert.equal(replaySpeedAt(10.14, 10), 0.25);
    assert.equal(replaySpeedAt(11, 10), 0.6);
    assert.ok(replaySpeedAt(9.75, 10) < 1 && replaySpeedAt(9.75, 10) > 0.25);
  });

  for (const duration of [ROUND_REPLAY_S, MATCH_REPLAY_S]) {
    test(`fits ${duration} s of wall by trimming the lead-in, keeping the tail`, () => {
      const plan = planReplay(20, 14, 21.2, duration);
      assert.ok(Math.abs(plan.endT - 21.2) < 1e-9, "tail kept");
      assert.ok(plan.startT > 17.5 && plan.startT < 20, `start ${plan.startT}`);
      assert.ok(Math.abs(plan.clipTimeAt(duration) - plan.endT) < 0.005);
      assert.equal(plan.clipTimeAt(0), plan.startT);
      let prev = -Infinity;
      for (let w = 0; w <= duration; w += 0.05) { const t = plan.clipTimeAt(w); assert.ok(t >= prev); prev = t; }
      // The event plays at quarter speed: 0.1 s of clip takes 0.4 s of wall.
      let wEvent = 0; while (plan.clipTimeAt(wEvent) < 20) wEvent += 0.001;
      assert.ok(Math.abs(plan.clipTimeAt(wEvent + 0.4) - 20.1) < 0.01);
    });
  }

  test("a short buffer keeps the whole clip", () => {
    const plan = planReplay(1.0, 0.5, 1.2, 2.5);
    assert.equal(plan.startT, 0.5);
    assert.equal(plan.endT, 1.2);
  });
});
