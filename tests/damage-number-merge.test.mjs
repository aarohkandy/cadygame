// WP7: damage numbers (GAME_DESIGN 7.4.2): merge within 400 ms (1200 ms MERGED), graze is a tag only, pool of 16.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DAMAGE_LIFE_MS, DAMAGE_POOL_SIZE, LABEL_EDGE_PX, LABEL_GAP_X, LABEL_GAP_Y, accumulateLiveStats,
  captionGlyph, clampLabelX, createDamageNumberModel, emptyLiveStats, hudVisibleIn, isSparringRound, projectSimPoint,
  receiptVisibleIn, reticleFromCue, spreadLabels, statsHoldAllowed,
} from "../src/game/ui/hud/hud-runtime.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";
import { RENDER_SCALE } from "../src/game/contracts.ts";

const hit = (o = {}) => ({ tier: "strike", victim: "blaze", damage: 12, crit: false, guarded: false, magnitude: 0.4, vN: 2.1, pos: [0, 0, 0.1], ...o });

describe("damage number merge", () => {
  test("12 then 19 on the same victim within 400 ms re-pops one number at 31", () => {
    const m = createDamageNumberModel();
    const a = m.hit(hit({ damage: 12 }), 1000, "on", 0.5);
    assert.deepEqual(a, { index: 0, merged: false });
    const rev = m.slots[0].revision;
    const b = m.hit(hit({ damage: 19, vN: 2.7, magnitude: 0.7 }), 1350, "on", 0.5);
    assert.deepEqual(b, { index: 0, merged: true });
    assert.equal(m.slots[0].value, 31);
    assert.equal(m.slots[0].popMs, 1350);
    assert.equal(m.slots[0].revision, rev + 1, "re-popped");
    assert.equal(m.slots[0].vN, 2.7);
    assert.equal(m.slots.filter((s) => s.active).length, 1);
  });

  test("outside the window or on the other victim spawns a new number", () => {
    const m = createDamageNumberModel();
    m.hit(hit(), 0, "on", 0.5);
    assert.equal(m.hit(hit(), 401, "on", 0.5).merged, false);
    assert.equal(m.hit(hit({ victim: "atlas" }), 402, "on", 0.5).merged, false);
    assert.equal(m.slots.filter((s) => s.active).length, 3);
  });

  test("MERGED widens the window to 1200 ms; OFF shows nothing", () => {
    const m = createDamageNumberModel();
    m.hit(hit(), 0, "merged", 0.5);
    assert.equal(m.hit(hit(), 1150, "merged", 0.5).merged, true);
    assert.equal(m.hit(hit(), 0, "off", 0.5), null);
  });

  test("a graze is a tag with no number and never merges", () => {
    const m = createDamageNumberModel();
    m.hit(hit(), 0, "on", 0.5);
    const g = m.hit(hit({ tier: "graze", damage: 3, vN: 0.31 }), 100, "on", 0.5);
    assert.equal(g.merged, false);
    const slot = m.slots[g.index];
    assert.equal(slot.graze, true);
    assert.equal(slot.value, 0);
    assert.equal(m.slots[0].value, 12);
  });

  test("crit sticks through a merge; jitter stays within ±10 px", () => {
    const m = createDamageNumberModel();
    m.hit(hit({ crit: true }), 0, "on", 0);
    assert.equal(m.slots[0].jitterPx, -10);
    m.hit(hit({ crit: false }), 100, "on", 1);
    assert.equal(m.slots[0].crit, true);
    assert.equal(m.slots[0].jitterPx, -10, "a merge keeps its position jitter");
  });

  test("nodes expire 700 ms after their last pop; a full pool reuses the oldest", () => {
    const m = createDamageNumberModel();
    for (let i = 0; i < DAMAGE_POOL_SIZE; i++) m.hit(hit({ victim: i % 2 ? "atlas" : "blaze" }), i * 500, "on", 0.5);
    assert.equal(m.expire(7000), 13, "pops at 0 to 6000 ms are 700 ms old or more");
    assert.equal(m.slots.filter((s) => s.active).length, 3, "6500, 7000 and 7500 stay");
    const m2 = createDamageNumberModel(3);
    m2.hit(hit(), 0, "on", 0.5);
    m2.hit(hit(), 500, "on", 0.5);
    m2.hit(hit(), 1000, "on", 0.5);
    const r = m2.hit(hit(), 1100, "on", 0.5);
    assert.equal(r.merged, true, "within 400 ms of the 1000 ms pop");
    const r2 = createDamageNumberModel(2);
    r2.hit(hit({ victim: "atlas" }), 0, "on", 0.5);
    r2.hit(hit({ victim: "blaze" }), 10, "on", 0.5);
    assert.equal(r2.hit(hit({ victim: "atlas" }), 500, "on", 0.5).index, 0, "oldest slot reused");
    assert.equal(DAMAGE_LIFE_MS, 700, "pops 1.4 to 1 in 80 ms, holds 700 (EMOTION_BIBLE 6)");
  });
});

describe("hud runtime pure helpers", () => {
  test("projection maps sim space through render space and the camera", () => {
    const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    // A projection whose w is -z (camera looks down -z): point at render z = -1 lands at the centre.
    const proj = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0] };
    const out = new Float64Array(4);
    projectSimPoint([0, 1 / RENDER_SCALE, 0], { matrixWorldInverse: identity, projectionMatrix: proj }, 1000, 500, out);
    assert.deepEqual(Array.from(out), [500, 250, 1, 1]);
    projectSimPoint([0, -1 / RENDER_SCALE, 0], { matrixWorldInverse: identity, projectionMatrix: proj }, 1000, 500, out);
    assert.equal(out[3], 0, "behind the camera");
    assert.equal(out[2], 0);
  });

  test("live stats count real events", () => {
    const s = emptyLiveStats();
    accumulateLiveStats(s, fakeEvents.strike({ attacker: "atlas", damage: 20, vN: 2.5 }));
    accumulateLiveStats(s, fakeEvents.strike({ attacker: "atlas", damage: 0, physicalDamage: 9, crit: true, vN: 3 }));
    accumulateLiveStats(s, fakeEvents.strike({ attacker: "blaze", tier: "graze" }));
    accumulateLiveStats(s, fakeEvents.deflect({ defender: "blaze" }));
    accumulateLiveStats(s, fakeEvents.core({ stage: "steal", seat: "blaze" }));
    assert.equal(s.atlas.strikes, 2);
    assert.equal(s.atlas.damage, 29);
    assert.equal(s.atlas.crits, 1);
    assert.equal(s.atlas.fastest, 3);
    assert.equal(s.blaze.grazes, 1);
    assert.equal(s.blaze.deflects, 1);
    assert.equal(s.blaze.steals, 1);
  });

  test("the tote shows in match phases only", () => {
    assert.equal(hudVisibleIn("fight"), true);
    assert.equal(hudVisibleIn("round_intro"), true);
    assert.equal(hudVisibleIn("match_intro"), false);
    assert.equal(hudVisibleIn("post_match"), false);
    assert.equal(hudVisibleIn("green_room"), false);
  });

  test("the stats overlay answers its key everywhere the HUD is up, except while paused", () => {
    for (const phase of ["fight", "round_intro", "sudden_death", "ko", "lock", "time_up", "round_summary", "rematch_intro"]) {
      assert.equal(statsHoldAllowed(phase), true, phase);
    }
    // The pause menu owns the keyboard: Tab there has to move focus, not open stats.
    assert.equal(hudVisibleIn("paused"), true);
    assert.equal(statsHoldAllowed("paused"), false);
    // And nowhere the in-match HUD is not up at all.
    for (const phase of ["match_intro", "post_match", "green_room", "title"]) {
      assert.equal(statsHoldAllowed(phase), false, phase);
    }
  });
});

describe("damage label declustering", () => {
  /** Runs spreadLabels over plain arrays and hands back the resulting y values. */
  const spread = (points, order) => {
    const x = Float64Array.from(points.map((p) => p[0]));
    const y = Float64Array.from(points.map((p) => p[1]));
    spreadLabels(x, y, Int32Array.from(order), order.length);
    return Array.from(y);
  };

  test("two hits landing in the same place are pushed apart, newest keeps the contact point", () => {
    const y = spread([[600, 400], [604, 402]], [1, 0]);
    assert.equal(y[1], 402, "the newest label is the one the player is reading: it does not move");
    assert.ok(Math.abs(y[0] - y[1]) >= LABEL_GAP_Y, `separated by at least ${LABEL_GAP_Y}px, got ${Math.abs(y[0] - y[1])}`);
  });

  test("older labels stack above the newest, so their rise carries them further apart", () => {
    // The older number sits a little BELOW the new one; pushing it down would let its 28 px rise run it back in.
    const y = spread([[600, 410], [600, 400]], [1, 0]);
    assert.equal(y[1], 400);
    assert.ok(y[0] <= 400 - LABEL_GAP_Y, `older label moved up above the newest, got ${y[0]}`);
  });

  test("labels further apart than the gap are left exactly where they were", () => {
    const pts = [[100, 400], [100 + LABEL_GAP_X, 400], [600, 400 + LABEL_GAP_Y]];
    assert.deepEqual(spread(pts, [0, 1, 2]), [400, 400, 400 + LABEL_GAP_Y]);
  });

  test("a stack of four resolves with every pair readable", () => {
    const pts = [[500, 300], [500, 300], [502, 305], [498, 298]];
    const order = [3, 2, 1, 0];
    const y = spread(pts, order);
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const dx = Math.abs(pts[a][0] - pts[b][0]);
        if (dx >= LABEL_GAP_X) continue;
        assert.ok(Math.abs(y[a] - y[b]) >= LABEL_GAP_Y - 1e-9, `${a} and ${b} still overlap: ${y[a]} vs ${y[b]}`);
      }
    }
  });

  test("the same input always produces the same output, and nothing else is touched", () => {
    const pts = [[500, 300], [503, 301], [497, 299]];
    const first = spread(pts, [2, 0, 1]);
    assert.deepEqual(spread(pts, [2, 0, 1]), first);
    const x = Float64Array.from([500, 503, 497]);
    const y = Float64Array.from([300, 301, 299]);
    spreadLabels(x, y, Int32Array.from([2, 0, 1]), 3);
    assert.deepEqual(Array.from(x), [500, 503, 497], "x is never written");
  });

  test("one label, or none, is a no-op", () => {
    assert.deepEqual(spread([[10, 20]], [0]), [20]);
    const y = Float64Array.from([20, 21]);
    spreadLabels(Float64Array.from([10, 10]), y, Int32Array.from([0, 1]), 0);
    assert.deepEqual(Array.from(y), [20, 21], "count 0 writes nothing");
  });
});

describe("show gates (EMOTION_BIBLE 2)", () => {
  test("the plates are up from the entrance slam through the round summary, and in the SYSTEMS CHECK drill", () => {
    for (const phase of ["entrance", "boot_ritual", "count_in", "fight", "systems_check", "round_summary"]) assert.equal(hudVisibleIn(phase), true, phase);
    for (const phase of ["attract", "verdict", "match_intro", "outro"]) assert.equal(hudVisibleIn(phase), false, phase);
    // The attract loop shows the receipt and the caption with no plate.
    assert.equal(receiptVisibleIn("attract"), true);
    assert.equal(receiptVisibleIn("fight"), true);
    assert.equal(receiptVisibleIn("round_summary"), false);
  });

  test("round 1 of match 1 is the sparring round: SPARRING tag, no bar", () => {
    assert.equal(isSparringRound({ tutorial: true }, 1), true);
    assert.equal(isSparringRound({ tutorial: true }, 2), false, "rounds 2 and 3 are real");
    assert.equal(isSparringRound({ tutorial: false }, 1), false);
    assert.equal(isSparringRound({ tutorial: false, sparring: true }, 1), true, "an explicit flag wins");
    assert.equal(isSparringRound({ tutorial: true, sparring: false }, 1), false);
    assert.equal(isSparringRound(null, 1), false);
  });

  test("the range ring fills as the target closes into the sweet band", () => {
    const cue = { flick: false, jab: false, nearestM: 0.6, flickArcRadiusM: 0.24, jabArcRadiusM: 0.16 };
    assert.deepEqual(reticleFromCue(cue), { fill: 0, inRange: false, magnetism: 0 });
    assert.equal(reticleFromCue({ ...cue, nearestM: 0.1, jab: true }).fill, 1, "inside the jab arc is full");
    const mid = reticleFromCue({ ...cue, nearestM: 0.32, flick: true });
    assert.ok(mid.fill > 0 && mid.fill < 1 && mid.inRange);
    const closer = reticleFromCue({ ...cue, nearestM: 0.2, flick: true });
    assert.ok(closer.fill > mid.fill, "monotonic in distance");
  });

  test("captions hand their mouse glyph to the node and lose the token", () => {
    assert.deepEqual(captionGlyph("HIT IT LMB"), { text: "HIT IT", glyph: "left" });
    assert.deepEqual(captionGlyph("GUARD · HOLD RMB"), { text: "GUARD · HOLD", glyph: "right" });
    assert.deepEqual(captionGlyph("Swing the mouse across it."), { text: "Swing the mouse across it.", glyph: null });
    assert.deepEqual(captionGlyph("LOCKED"), { text: "LOCKED", glyph: null });
  });
});

describe("damage labels stay inside the viewport", () => {
  test("a label near the right edge is pulled back by its own half width", () => {
    assert.equal(clampLabelX(349 + 42, 42, 390), 390 - LABEL_EDGE_PX - 42);
    assert.equal(clampLabelX(2, 42, 390), LABEL_EDGE_PX + 42);
  });

  test("a label that already fits is not moved", () => {
    assert.equal(clampLabelX(195, 42, 390), 195);
    assert.equal(clampLabelX(960, 60, 1920), 960);
  });

  test("a label wider than the viewport centres instead of hugging an edge", () => {
    assert.equal(clampLabelX(10, 300, 390), 195);
  });
});
