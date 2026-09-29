import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSeatEventRing } from "../src/game/loop/event-ring.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";

describe("per-seat event ring", () => {
  test("each seat drains every event exactly once, in order", () => {
    const ring = createSeatEventRing();
    const batch = [fakeEvents.contact({ step: 1 }), fakeEvents.strike({ step: 2 }), fakeEvents.whiff({ step: 3 })];
    ring.push(batch, 0);
    const a = [], b = [];
    assert.equal(ring.drain("atlas", a), 3);
    assert.deepEqual(a.map((e) => e.step), [1, 2, 3]);
    assert.equal(ring.drain("atlas", a), 0, "draining clears only that seat");
    assert.equal(ring.drain("blaze", b), 3);
    assert.equal(b[1], batch[1], "events are shared by reference, not copied");
  });

  test("push honours `from` so the driver can hand over only new events", () => {
    const ring = createSeatEventRing();
    const events = [fakeEvents.contact({ step: 1 }), fakeEvents.contact({ step: 2 })];
    ring.push(events, 1);
    const out = [];
    ring.drain("atlas", out);
    assert.deepEqual(out.map((e) => e.step), [2]);
  });

  test("events after a seat's last control tick of frame N reach its observation at frame N+1", () => {
    // Arcade: 8 physics steps per 50 Hz control tick; several ticks may run per render frame.
    const STEPS_PER_TICK = 8;
    const ring = createSeatEventRing();
    const frameEvents = [];
    const observed = { atlas: [], blaze: [] };
    let step = 0;
    const runFrame = (steps, eventSteps) => {
      const obsThisFrame = [];
      for (let i = 0; i < steps; i++, step++) {
        if (step % STEPS_PER_TICK === 0) {
          const out = [];
          ring.drain("atlas", out);
          obsThisFrame.push({ tickStep: step, steps: out.map((e) => e.step) });
        }
        const firstNew = frameEvents.length;
        if (eventSteps.includes(step)) frameEvents.push(fakeEvents.strike({ step }));
        ring.push(frameEvents, firstNew);
      }
      frameEvents.length = 0;
      observed.atlas.push(obsThisFrame);
    };
    runFrame(10, [2, 9]);        // frame N: ticks at steps 0 and 8; strike on 2 (before tick 8) and on 9 (after it)
    runFrame(8, [12]);           // frame N+1: steps 10..17, tick at 16
    assert.deepEqual(observed.atlas[0], [{ tickStep: 0, steps: [] }, { tickStep: 8, steps: [2] }]);
    assert.deepEqual(observed.atlas[1], [{ tickStep: 16, steps: [9, 12] }], "step 9 lands at frame N+1's tick");
  });

  test("a seat with a slower decision rate still receives everything since its last observation", () => {
    const ring = createSeatEventRing();
    for (let s = 0; s < 30; s++) ring.push([fakeEvents.contact({ step: s })], 0);
    const fast = [];
    ring.drain("atlas", fast);
    for (let s = 30; s < 40; s++) ring.push([fakeEvents.contact({ step: s })], 0);
    const slow = [];
    ring.drain("blaze", slow);
    assert.equal(fast.length, 30);
    assert.deepEqual(slow.map((e) => e.step), Array.from({ length: 40 }, (_, i) => i));
  });

  test("grows past its capacity without dropping or reordering, including after wrap-around", () => {
    const ring = createSeatEventRing(4);
    const out = [];
    ring.push([fakeEvents.contact({ step: 0 }), fakeEvents.contact({ step: 1 }), fakeEvents.contact({ step: 2 })], 0);
    ring.drain("atlas", out);
    out.length = 0;
    for (let s = 3; s < 20; s++) ring.push([fakeEvents.contact({ step: s })], 0);
    assert.equal(ring.pending("atlas"), 17);
    ring.drain("atlas", out);
    assert.deepEqual(out.map((e) => e.step), Array.from({ length: 17 }, (_, i) => i + 3));
    const blaze = [];
    ring.drain("blaze", blaze);
    assert.equal(blaze.length, 20);
  });

  test("clear empties both seats (new round, replay entry)", () => {
    const ring = createSeatEventRing();
    ring.push([fakeEvents.ko()], 0);
    ring.clear();
    assert.equal(ring.drain("atlas", []), 0);
    assert.equal(ring.drain("blaze", []), 0);
  });
});
