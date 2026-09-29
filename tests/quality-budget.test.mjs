// The renderer is fill-rate bound (measured on an Apple M5: ~4-6 ms per megapixel, post-processing ~60 % of
// it), so what keeps a large window honest is the per-tier pixel budget, not the dpr ratio. These pin the
// clamp, the ratio-only path, the floor, and the auto ladder's two rules: seed from the GPU, and never flap.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createQualityController, initialTierFor, MIN_DPR, QUALITY_TIERS, tierDpr,
} from "../src/game/render/quality.ts";

const px = (tier, w, h) => {
  const d = tierDpr(tier, 2, w, h);
  return { dpr: d, mpx: (w * d * h * d) / 1e6 };
};

describe("tier pixel budget", () => {
  test("a window small enough to fit the budget renders at the tier's own ratio", () => {
    assert.equal(tierDpr(QUALITY_TIERS.default, 2, 1280, 720), 1.25);
    assert.equal(tierDpr(QUALITY_TIERS.low, 2, 1280, 720), 1.0);
  });

  test("a large window is clamped to the budget, unless the legibility floor binds first", () => {
    for (const tier of Object.values(QUALITY_TIERS)) {
      for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
        const { dpr, mpx } = px(tier, w, h);
        const withinBudget = mpx <= tier.maxPixels / 1e6 + 1e-6;
        assert.ok(withinBudget || dpr === MIN_DPR,
          `${tier.id} at ${w}x${h} drew ${mpx.toFixed(2)} Mpx over ${tier.maxPixels / 1e6} at dpr ${dpr}`);
      }
    }
  });

  test("4K at DEFAULT is bounded — the case that used to ask for 13 Mpx", () => {
    // Before the budget: 3840*1.25 x 2160*1.25 = 12.96 Mpx. That is ~60 ms/frame on an M5.
    assert.ok(px(QUALITY_TIERS.default, 3840, 2160).mpx <= 2.4);
  });

  test("the clamp never goes below the legibility floor, however large the window", () => {
    assert.equal(tierDpr(QUALITY_TIERS.low, 2, 7680, 4320), MIN_DPR);
  });

  test("with no canvas size (SSR, pre-layout) it is the ratio alone", () => {
    assert.equal(tierDpr(QUALITY_TIERS.default, 2), 1.25);
    // A sub-1x device is lifted to 1, never supersampled to the tier's ratio.
    assert.equal(tierDpr(QUALITY_TIERS.default, 0.75, 0, 0), 1);
  });

  test("the ratio never exceeds the device's own, so a 1x screen is never supersampled", () => {
    assert.equal(tierDpr(QUALITY_TIERS.default, 1, 1280, 720), 1);
  });
});

describe("auto tier ladder", () => {
  test("integrated and software GPUs start at LOW, everything else at DEFAULT", () => {
    assert.equal(initialTierFor("integrated"), "low");
    assert.equal(initialTierFor("apple"), "default");
    assert.equal(initialTierFor("discrete"), "default");
    assert.equal(initialTierFor("unknown"), "default");
  });

  test("auto never climbs to HIGH: a vsync-capped 60 fps is a ceiling, not headroom", () => {
    const q = createQualityController("auto");
    for (let i = 0; i < 5; i++) q.incline();
    assert.equal(q.queued, null);
    assert.equal(q.tier.id, "default");
  });

  test("a decline latches, so the controller converges downward and cannot oscillate", () => {
    const q = createQualityController("auto");
    q.decline();
    assert.equal(q.queued, "low");
    assert.ok(q.applyIfSafe("title"));
    assert.equal(q.tier.id, "low");
    for (let i = 0; i < 5; i++) q.incline();
    assert.equal(q.queued, null, "an inclined verdict must not undo a latched decline");
    assert.equal(q.tier.id, "low");
  });

  test("seed applies straight away — it runs before the first world frame", () => {
    const q = createQualityController("auto");
    q.seed("low");
    assert.equal(q.tier.id, "low");
    assert.equal(q.queued, null);
  });

  test("an explicit tier choice ignores both the probe and the monitor", () => {
    const q = createQualityController("high");
    q.seed("low");
    q.decline();
    assert.equal(q.tier.id, "high");
    assert.equal(q.queued, null);
  });

  test("a tier change can land while paused — when the player actually reaches for it", () => {
    const q = createQualityController("auto");
    q.decline();
    assert.ok(q.applyIfSafe("paused"), "pause must be a safe phase to apply a tier");
    assert.equal(q.tier.id, "low");
  });

  test("a tier change never lands mid-round", () => {
    const q = createQualityController("auto");
    q.decline();
    assert.equal(q.applyIfSafe("live"), false);
    assert.equal(q.tier.id, "default");
  });
});

describe("tier knobs actually differ", () => {
  test("LOW draws no volumetric cones; the shafts budget covers the team sweeps too", () => {
    assert.equal(QUALITY_TIERS.low.shafts, 0);
    assert.ok(QUALITY_TIERS.default.shafts >= 4, "DEFAULT keeps the two team sweeps and two overheads");
  });

  test("each step down is a real reduction in pixels", () => {
    assert.ok(QUALITY_TIERS.low.maxPixels < QUALITY_TIERS.default.maxPixels);
    assert.ok(QUALITY_TIERS.default.maxPixels < QUALITY_TIERS.high.maxPixels);
  });
});
