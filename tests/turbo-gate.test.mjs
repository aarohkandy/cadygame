// The turbo render gate (src/game/loop/turbo-gate.ts). The regression these guard: the gate used to be a React
// prop fed by useState, so the canvas kept drawing full arena frames until a commit landed - measured headless
// on homebase as two rAF callbacks of 6.7 s and 4.4 s at the start of a turbo match, during which the sim
// advanced 0.04 s in four seconds. The gate must shut in the same turn as the ui change, and reopen when the
// match stops owning the screen.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTurboGate, turboOwnsScreen, PAUSED_POLL_MS } from "../src/game/loop/turbo-gate.ts";

/** A ui store with the same contract as the real one: set() notifies subscribers synchronously. */
function fakeUi(state) {
  const subs = new Set();
  let current = { screen: "green_room", overlay: null, ...state };
  return {
    get: () => current,
    set(patch) { current = { ...current, ...patch }; for (const fn of Array.from(subs)) fn(); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** A task loop the test steps by hand, so "posted, not called inline" is observable. */
function manualLoop() {
  const loops = [];
  const delays = [];
  const taskLoop = (beat) => {
    const entry = { beat, live: true };
    loops.push(entry);
    return () => { entry.live = false; };
  };
  return {
    taskLoop,
    delays,
    get live() { return loops.filter((l) => l.live).length; },
    beat(n = 1) { for (let i = 0; i < n; i++) for (const l of loops) if (l.live) delays.push(l.beat()); },
  };
}

function harness(opts = {}) {
  const ui = fakeUi();
  const calls = { frameTick: [], afterRender: 0, frameloop: [], errors: [] };
  let t = 1000;
  const game = {
    ui,
    clock: { paused: false },
    director: { config: null },
    frameTick(dt) { calls.frameTick.push(dt); if (opts.throwOnTick) throw new Error("boom"); },
    runAfterRender() { calls.afterRender++; },
  };
  const loop = manualLoop();
  const gate = createTurboGate({
    game,
    setFrameloop: (mode) => calls.frameloop.push(mode),
    onChange: (on) => calls.frameloop.push(on ? "change:on" : "change:off"),
    now: () => (t += 16),
    taskLoop: loop.taskLoop,
    onError: (err) => calls.errors.push(String(err)),
  });
  const startTurbo = () => { game.director.config = { turbo: true }; ui.set({ screen: "match" }); };
  return { ui, game, calls, loop, gate, startTurbo };
}

describe("turbo render gate", () => {
  test("a turbo match shuts the render loop in the same turn as the ui change, before the pump starts", () => {
    const h = harness();
    assert.deepEqual(h.calls.frameloop, []);
    assert.equal(h.gate.turbo, false);

    h.startTurbo();

    // No await, no commit, no extra turn: by the time ui.set() returns the canvas is already off.
    assert.deepEqual(h.calls.frameloop, ["never", "change:on"], "the gate did not shut synchronously");
    assert.equal(h.gate.turbo, true);
    assert.equal(h.loop.live, 1, "the pump did not start");
    assert.deepEqual(h.calls.frameTick, [], "the first beat must be posted, not run inline");
  });

  test("the pump drives frameTick and runAfterRender with real wall deltas", () => {
    const h = harness();
    h.startTurbo();
    h.loop.beat(3);
    assert.equal(h.calls.frameTick.length, 3);
    assert.equal(h.calls.afterRender, 3);
    for (const dt of h.calls.frameTick) assert.ok(dt > 0 && dt < 1, `beat delta out of range: ${dt}`);
  });

  test("leaving the match stops the pump and reopens the render loop", () => {
    const h = harness();
    h.startTurbo();
    h.loop.beat(2);
    h.ui.set({ screen: "post_match" });
    assert.equal(h.gate.turbo, false);
    assert.equal(h.loop.live, 0, "the pump kept running after the match left the screen");
    assert.deepEqual(h.calls.frameloop.slice(-2), ["always", "change:off"]);
    const ticks = h.calls.frameTick.length;
    h.loop.beat(2);
    assert.equal(h.calls.frameTick.length, ticks, "a stopped pump still stepped");
  });

  test("a non-turbo match never shuts the render loop", () => {
    const h = harness();
    h.game.director.config = { turbo: false };
    h.ui.set({ screen: "match" });
    assert.equal(h.gate.turbo, false);
    assert.deepEqual(h.calls.frameloop, []);
    assert.equal(h.loop.live, 0);
  });

  test("repeated ui changes neither restart the pump nor re-switch the loop", () => {
    const h = harness();
    h.startTurbo();
    h.ui.set({ overlay: "pause" });
    h.ui.set({ overlay: null });
    assert.equal(h.loop.live, 1);
    assert.deepEqual(h.calls.frameloop, ["never", "change:on"]);
  });

  test("a frame that throws is reported and the pump keeps going", () => {
    const h = harness({ throwOnTick: true });
    h.startTurbo();
    h.loop.beat(3);
    assert.equal(h.calls.errors.length, 3, "the pump stopped on the first throw");
    assert.equal(h.loop.live, 1, "the pump did not survive a throwing frame");
  });

  test("dispose stops the pump and unsubscribes", () => {
    const h = harness();
    h.startTurbo();
    h.gate.dispose();
    assert.equal(h.loop.live, 0);
    h.ui.set({ screen: "green_room" });
    h.ui.set({ screen: "match" });
    assert.equal(h.gate.turbo, false, "a disposed gate still reacted to the ui");
  });

  test("a paused clock idles the pump, and resuming returns it to the rate it had", () => {
    const h = harness();
    h.startTurbo();
    h.loop.beat(8);
    assert.equal(h.calls.frameTick.length, 8);
    assert.deepEqual(h.loop.delays, [0, 0, 0, 0, 0, 0, 0, 0], "a running pump must repost immediately");

    // The regression this guards: with the clock paused the pump kept reposting as fast as the event loop
    // allowed - 30-40k empty frames a second measured headless - running a whole browser frame each time.
    h.game.clock.paused = true;
    h.loop.delays.length = 0;
    h.loop.beat(8);
    assert.equal(h.calls.frameTick.length, 8, "a paused clock still drove the frame");
    assert.equal(h.calls.afterRender, 8, "a paused clock still ran the after-render slot");
    assert.deepEqual(h.loop.delays, Array(8).fill(PAUSED_POLL_MS), "the paused pump did not back off");
    assert.equal(h.loop.live, 1, "the pump must stay alive across the pause");
    assert.equal(h.gate.turbo, true, "a paused turbo match still owns the screen");
    assert.deepEqual(h.calls.frameloop, ["never", "change:on"], "the pause re-switched the render loop");

    h.game.clock.paused = false;
    h.loop.delays.length = 0;
    h.loop.beat(8);
    assert.equal(h.calls.frameTick.length, 16, "the pump did not come back at its old rate");
    assert.deepEqual(h.loop.delays, Array(8).fill(0));
    // Idle beats re-base the wall clock, so the resumed frame is one beat long, not one pause long.
    for (const dt of h.calls.frameTick.slice(8)) assert.ok(dt > 0 && dt < 0.1, `resumed beat delta ${dt}`);
  });

  test("turboOwnsScreen is exactly turbo plus the match screen", () => {
    const ui = fakeUi();
    const game = { ui, clock: { paused: false }, director: { config: null } };
    assert.equal(turboOwnsScreen(game), false);
    game.director.config = { turbo: true };
    assert.equal(turboOwnsScreen(game), false, "turbo alone is not enough; the match must own the screen");
    ui.set({ screen: "match" });
    assert.equal(turboOwnsScreen(game), true);
    game.director.config = { turbo: false };
    assert.equal(turboOwnsScreen(game), false);
  });
});
