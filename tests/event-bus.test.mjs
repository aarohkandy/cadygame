import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEventBus } from "../src/game/core/event-bus.ts";
import { fakeEvents, fakeFeedbackContext } from "../src/game/testing/fakes.ts";

const ctx = fakeFeedbackContext();

describe("event bus", () => {
  test("delivers a frame's events once, in step order, stable for equal steps", () => {
    const bus = createEventBus();
    const got = [];
    bus.subscribe((events, c) => { assert.equal(c, ctx); got.push(events.map((e) => `${e.type}@${e.step}`)); });
    const stepEvents = [fakeEvents.contact({ step: 3 }), fakeEvents.strike({ step: 5 }), fakeEvents.whiff({ step: 5 })];
    bus.emit(fakeEvents.phase({ step: 4 }));
    bus.pushStepEvents(stepEvents, 0);
    bus.emit(fakeEvents.core({ step: 5 }));
    bus.flush(ctx);
    bus.flush(ctx);
    assert.deepEqual(got, [["contact@3", "phase@4", "strike@5", "whiff@5", "core@5"]]);
    assert.equal(bus.pendingCount, 0);
  });

  test("pushStepEvents starts at `from`", () => {
    const bus = createEventBus();
    const got = [];
    bus.subscribe((events) => got.push(...events.map((e) => e.step)));
    bus.pushStepEvents([fakeEvents.contact({ step: 1 }), fakeEvents.contact({ step: 2 }), fakeEvents.contact({ step: 3 })], 1);
    bus.flush(ctx);
    assert.deepEqual(got, [2, 3]);
  });

  test("every subscriber sees the same batch; unsubscribe is idempotent", () => {
    const bus = createEventBus();
    const a = [], b = [];
    const offA = bus.subscribe((ev) => a.push(ev.length));
    bus.subscribe((ev) => b.push(ev.length));
    bus.emit(fakeEvents.ko());
    bus.flush(ctx);
    offA(); offA();
    bus.emit(fakeEvents.ko()); bus.emit(fakeEvents.ko());
    bus.flush(ctx);
    assert.deepEqual(a, [1]);
    assert.deepEqual(b, [1, 2]);
  });

  test("events emitted by a subscriber during flush go to the next frame", () => {
    const bus = createEventBus();
    const frames = [];
    bus.subscribe((events) => {
      frames.push(events.map((e) => e.type));
      if (events.some((e) => e.type === "ko")) bus.emit(fakeEvents.roundEnd());
    });
    bus.emit(fakeEvents.ko());
    bus.flush(ctx);
    bus.flush(ctx);
    assert.deepEqual(frames, [["ko"], ["round_end"]]);
  });

  test("subscribing during a flush takes effect from the next frame", () => {
    const bus = createEventBus();
    const late = [];
    let added = false;
    bus.subscribe(() => { if (!added) { added = true; bus.subscribe((ev) => late.push(ev.length)); } });
    bus.emit(fakeEvents.whiff()); bus.flush(ctx);
    bus.emit(fakeEvents.whiff()); bus.flush(ctx);
    assert.deepEqual(late, [1]);
  });

  test("a throwing subscriber does not starve the others, and the error surfaces", () => {
    const bus = createEventBus();
    const seen = [];
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe((ev) => seen.push(ev.length));
    bus.emit(fakeEvents.clash());
    assert.throws(() => bus.flush(ctx), /boom/);
    assert.deepEqual(seen, [1]);
    bus.flush(ctx);
    assert.deepEqual(seen, [1], "the failed batch is cleared, not redelivered");
  });

  test("flush is not re-entrant", () => {
    const bus = createEventBus();
    bus.subscribe(() => bus.flush(ctx));
    bus.emit(fakeEvents.whiff());
    assert.throws(() => bus.flush(ctx), /re-entrant/);
  });

  test("clearPending drops queued events; empty frames call nobody", () => {
    const bus = createEventBus();
    let calls = 0;
    bus.subscribe(() => calls++);
    bus.emit(fakeEvents.whiff());
    bus.clearPending();
    bus.flush(ctx);
    assert.equal(calls, 0);
  });

  test("steady-state flushing reuses its buffers", () => {
    const bus = createEventBus();
    const batches = new Set();
    bus.subscribe((ev) => batches.add(ev));
    for (let i = 0; i < 20; i++) { bus.emit(fakeEvents.contact({ step: i })); bus.flush(ctx); }
    assert.ok(batches.size <= 2, `saw ${batches.size} distinct arrays`);
  });
});
