// WP3 synthetic input (BUILD_PLAN 4 WP3.14): a SyntheticInput sequence produces the same ctrl stream as the
// equivalent real DOM events delivered through pointer lock, bindings, and the edge buffer.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSettingsStore } from "../src/game/core/settings.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createKinematics } from "../src/game/kinematics/so101-kinematics.ts";
import { createPilot } from "../src/game/input/pilot-controller.ts";
import { createInputSystem } from "../src/game/input/input-system.ts";
import { resolveBindings } from "../src/game/input/bindings.ts";
import { fakeCombat, fakeFrame } from "../src/game/testing/fakes.ts";

const RULES = { jabMacro: true, chargeMacro: true, leash: true, guardBlend: true, assists: true, aimAssist: false, showKit: true };

/** A pointer-locked element in a fake document, both plain EventTargets. */
function fakeDom() {
  const doc = new EventTarget();
  const target = new EventTarget();
  target.ownerDocument = doc;
  doc.pointerLockElement = target;
  doc.defaultView = null;
  const fire = (on, type, props) => {
    const e = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
    on.dispatchEvent(e);
  };
  return {
    doc, target,
    move: (dx, dy) => fire(target, "pointermove", { movementX: dx, movementY: dy }),
    key: (code, down) => fire(doc, down ? "keydown" : "keyup", { code, repeat: false }),
    button: (b, down) => fire(down ? target : doc, down ? "mousedown" : "mouseup", { button: b }),
  };
}

function makePilot() {
  const pilot = createPilot(
    { kinematics: createKinematics(), settings: createSettingsStore({ storage: null }), clock: createGameClock(), profileMatchesPlayed: () => 10 },
    { getPads: () => [] },
  );
  pilot.setRules(RULES);
  pilot.setMode("fight");
  return pilot;
}

/** A script of inputs per control tick: [tick, kind, ...args]. */
const SCRIPT = [
  [2, "move", 120, -40], [3, "key", "KeyW", true], [5, "button", 0, true], [8, "button", 0, false],
  [10, "move", -300, 10], [12, "key", "KeyA", true], [20, "key", "KeyA", false], [22, "button", 2, true],
  [26, "button", 2, false], [30, "button", 0, true], [60, "button", 0, false], [62, "key", "KeyW", false],
  [64, "key", "Space", true], [70, "key", "Space", false], [72, "move", 50, 50], [74, "key", "KeyQ", true], [80, "key", "KeyQ", false],
];

function run(pilot, apply) {
  const frame = fakeFrame();
  for (let i = 0; i < 9; i++) frame.cubes.pos.set([2 + 0.1 * i, 0, 0.02], i * 3);
  const combat = fakeCombat();
  const out = new Float64Array(6);
  const stream = [];
  for (let tick = 0; tick < 90; tick++) {
    for (const [at, kind, ...args] of SCRIPT) if (at === tick) apply(kind, args);
    pilot.sampleFrame(1 / 50, false);
    for (let step = 0; step < 8; step++) {
      frame.simTime += 0.0025;
      pilot.writeCommand(frame, combat, out);
      stream.push(...out, pilot.intents.charge ? 1 : 0, pilot.intents.guard ? 1 : 0);
    }
  }
  return stream;
}

describe("synthetic input", () => {
  test("a synthetic sequence and the same real DOM events produce an identical ctrl stream", () => {
    const real = makePilot();
    const dom = fakeDom();
    real.attach(dom.target);
    assert.equal(real.locked, true);
    dom.move(7, 7);                           // the first event after a lock is dropped (3.3)
    const realStream = run(real, (kind, args) => dom[kind](...args));

    const proxy = makePilot();
    const synth = proxy.synthetic();
    const synthStream = run(proxy, (kind, args) => synth[kind](...args));

    assert.equal(realStream.length, synthStream.length);
    assert.deepEqual(synthStream, realStream);
    assert.equal(proxy.device, "synthetic");
    real.dispose();
  });

  test("the first pointer event after a lock is dropped; unbound keys and key repeats are ignored", () => {
    const input = createInputSystem();
    const dom = fakeDom();
    input.attach(dom.target);
    dom.move(50, 0);
    dom.move(10, 0);
    const m = input.takeMove({ dx: 0, dy: 0 });
    assert.equal(m.dx, 10);
    assert.equal(input.handleKey("KeyZ", true), false);
    input.handleKey("KeyW", true);
    input.handleKey("KeyW", true);
    const edges = input.drainEdges([]);
    assert.equal(edges.length, 1);
    assert.equal(input.isHeld("reach_out"), true);
    input.releaseAll();
    assert.equal(input.isHeld("reach_out"), false);
    input.detach();
  });

  test("rebinding: an override takes the key from its previous owner", () => {
    const b = resolveBindings({ grip: "KeyW" });
    assert.equal(b.byCode.get("KeyW"), "grip");
    assert.equal(b.byCode.get("ArrowUp"), "reach_out", "reach keeps its secondary");
    assert.equal(b.byCode.get("Space"), undefined);
    const ignored = resolveBindings({ pause: "KeyP", grip: "Escape" });
    assert.equal(ignored.byCode.get("Escape"), "pause");
  });
});
