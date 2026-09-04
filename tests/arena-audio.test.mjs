import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clamp,
  contactScrapeLevels,
  gripperActivity,
  impactIntensity,
  motionEnergy,
} from "../src/lib/arena-audio.mjs";

test("impact intensity scales with force and is hotter for strikes", () => {
  assert.equal(impactIntensity(0, "none"), 0);
  const softBlock = impactIntensity(0.4, "block");
  const hardBlock = impactIntensity(2.2, "block");
  const softStrike = impactIntensity(0.7, "strike");
  const hardStrike = impactIntensity(2.4, "strike");
  assert.ok(hardBlock > softBlock);
  assert.ok(hardStrike > softStrike);
  assert.ok(softStrike > softBlock);
  assert.ok(hardStrike <= 1 && hardStrike > 0.9);
});

test("motion energy tracks joint-space speed", () => {
  assert.equal(motionEnergy([0, 0], [0, 0], 0.016), 0);
  assert.ok(Math.abs(motionEnergy([0, 0], [0.16, -0.08], 0.016) - 15) < 1e-9);
  assert.equal(motionEnergy(null, [1], 0.016), 0);
});

test("gripper activity detects open and close edges", () => {
  const closing = gripperActivity(0.9, 0.3, 0.016);
  assert.equal(closing.closingEdge, true);
  assert.equal(closing.openingEdge, false);
  assert.ok(closing.speed > 30);

  const opening = gripperActivity(0.2, 0.8, 0.016);
  assert.equal(opening.openingEdge, true);
  assert.equal(opening.closingEdge, false);

  const held = gripperActivity(0.2, 0.2, 0.016);
  assert.equal(held.closingEdge, false);
  assert.equal(held.openingEdge, false);
  assert.equal(held.speed, 0);
});

test("contact scrape is quiet when pressed still and louder when sliding", () => {
  const idle = contactScrapeLevels(false, 2, 8);
  assert.equal(idle.dry, 0);
  assert.equal(idle.grit, 0);

  const pressedStill = contactScrapeLevels(true, 2, 0);
  const sliding = contactScrapeLevels(true, 2, 8);
  assert.ok(pressedStill.body > 0);
  assert.ok(pressedStill.dry < 0.05);
  assert.ok(sliding.dry > pressedStill.dry);
  assert.ok(sliding.grit > pressedStill.grit);
  assert.ok(sliding.slip > pressedStill.slip);
});

test("clamp bounds values", () => {
  assert.equal(clamp(2, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});
