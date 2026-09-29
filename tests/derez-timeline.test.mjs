// WP6 acceptance 12: the de-rez never hides the slump. It starts only after the servo brownout settles
// (joint speed < 0.05 rad/s once the droop has begun, or 1100 ms), runs 900 ms, and the round re-render
// scan restores the arm at round_intro.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createDerezTimeline, DEREZ_MS, KO_FLASH_MS, KO_SLOWMO_HOLD_MS, KO_SLOWMO_RAMP_MS, KO_SLOWMO_RATE, LED_START_MS, LED_STEP_MS,
  SCAN_MS, SETTLE_MAX_MS, SETTLE_MIN_MS,
} from "../src/game/render/vfx/derez.ts";

const still = () => 0;
const moving = () => 1.2;

describe("de-rez timeline", () => {
  test("waits for the slump to settle before dissolving", () => {
    const t = createDerezTimeline();
    t.onKo("blaze", 1000);
    // Drooping arm: joint speed high for 800 ms.
    for (let ms = 1000; ms < 1800; ms += 16) {
      t.update(ms, moving);
      assert.equal(t.derez("blaze", ms), 0, `no dissolve while slumping at ${ms - 1000} ms`);
    }
    t.update(1816, still);
    assert.equal(t.settledAtMs("blaze"), 1816);
    assert.ok(t.settledAtMs("blaze") - t.koAtMs("blaze") >= SETTLE_MIN_MS);
    assert.equal(t.derez("blaze", 1816), 0);
    assert.ok(Math.abs(t.derez("blaze", 1816 + DEREZ_MS / 2) - 0.5) < 1e-9);
    assert.equal(t.derez("blaze", 1816 + DEREZ_MS + 1), 1);
    assert.equal(t.derez("atlas", 2500), 0);
  });

  test("a still arm right after the hit does not count as settled before 400 ms", () => {
    const t = createDerezTimeline();
    t.onKo("atlas", 0);
    for (let ms = 0; ms < SETTLE_MIN_MS; ms += 10) {
      t.update(ms, still);
      assert.equal(t.settledAtMs("atlas"), -1);
    }
    t.update(SETTLE_MIN_MS, still);
    assert.equal(t.settledAtMs("atlas"), SETTLE_MIN_MS);
  });

  test("settle is forced at 1100 ms even if the arm keeps swinging", () => {
    const t = createDerezTimeline();
    t.onKo("blaze", 500);
    for (let ms = 500; ms <= 500 + SETTLE_MAX_MS + 40; ms += 20) t.update(ms, moving);
    assert.equal(t.settledAtMs("blaze"), 500 + SETTLE_MAX_MS);
  });

  test("the volt cube burst fires once at the dissolve start", () => {
    const t = createDerezTimeline();
    t.onKo("blaze", 0);
    t.update(200, moving);
    assert.equal(t.takeBurst(), null);
    t.update(1200, moving);
    assert.equal(t.takeBurst(), "blaze");
    assert.equal(t.takeBurst(), null);
  });

  test("servo LEDs die base to gripper 40 ms apart from 150 ms", () => {
    const t = createDerezTimeline();
    t.onKo("atlas", 0);
    assert.equal(t.ledsDead("atlas", LED_START_MS - 1), 0);
    assert.equal(t.ledsDead("atlas", LED_START_MS), 1);
    assert.equal(t.ledsDead("atlas", LED_START_MS + LED_STEP_MS), 2);
    assert.equal(t.ledsDead("atlas", LED_START_MS + 5 * LED_STEP_MS), 6);
    assert.equal(t.ledsDead("atlas", 5000), 6);
  });

  test("replays show the arm intact and the dissolve returns after", () => {
    const t = createDerezTimeline();
    t.onKo("blaze", 0);
    t.update(1100, moving);
    t.onPhase("round_replay", 1800);
    assert.equal(t.derez("blaze", 2500), 0);
    assert.equal(t.ledsDead("blaze", 2500), 0);
    t.onKo("blaze", 2600);                    // a replayed ko never restarts the timeline
    t.onPhase("round_summary", 5300);
    assert.equal(t.derez("blaze", 5300), 1);
    assert.equal(t.koAtMs("blaze"), 0);
  });

  test("round_intro runs the 400 ms re-render scan and restores the arm", () => {
    const t = createDerezTimeline();
    t.onKo("blaze", 0);
    t.update(1100, moving);
    assert.equal(t.derez("blaze", 3000), 1);
    t.onPhase("round_intro", 4000);
    assert.equal(t.derez("blaze", 4000), 0);
    assert.equal(t.ledsDead("blaze", 4000), 0);
    assert.equal(t.scan(4000), 0);
    assert.ok(Math.abs(t.scan(4000 + SCAN_MS / 2) - 0.5) < 1e-9);
    assert.equal(t.scan(4000 + SCAN_MS), -1);
    t.onKo("blaze", 6000);
    assert.equal(t.koAtMs("blaze"), 6000, "a new round accepts a new KO");
  });

  test("the KO flashes white and opens a slow-motion window that eases back to full speed", () => {
    const t = createDerezTimeline();
    assert.equal(t.koFlash(500), 0);
    assert.equal(t.timeScale(500), 1);
    t.onKo("blaze", 1000);
    assert.equal(t.koFlash(1000), 1);
    assert.ok(t.koFlash(1000 + KO_FLASH_MS / 2) < 1 && t.koFlash(1000 + KO_FLASH_MS / 2) > 0);
    assert.equal(t.koFlash(1000 + KO_FLASH_MS), 0);
    assert.equal(t.timeScale(1000 + 10), KO_SLOWMO_RATE);
    const mid = t.timeScale(1000 + KO_SLOWMO_HOLD_MS + KO_SLOWMO_RAMP_MS / 2);
    assert.ok(mid > KO_SLOWMO_RATE && mid < 1, `easing back ${mid}`);
    assert.equal(t.timeScale(1000 + KO_SLOWMO_HOLD_MS + KO_SLOWMO_RAMP_MS), 1);
    t.onPhase("round_replay", 1100);
    assert.equal(t.koFlash(1100), 0, "replays never flash");
  });
});
