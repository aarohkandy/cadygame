// WP5: the hit stop table (EMOTION_BIBLE 6), one pure function shared by the sim-driver and juice:
// clamp(50 + 125·m, 50, 150) for every strike, crit +20 inside the cap, guarded 33 + 17·m, deflect 110, clash 55, KO 150.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hitstopMsFor, HITSTOP } from "../src/game/combat/tuning.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";

const strike = (magnitude, o = {}) => fakeEvents.strike({ magnitude, tier: "strike", crit: false, guarded: false, ...o });
const ms = (m, o) => hitstopMsFor(strike(m, o), "arcade", "atlas");

describe("hitstop table", () => {
  test("anchors: 50 at m 0, 100 at 0.4, 150 at 0.8 and above", () => {
    assert.equal(ms(0), 50);
    assert.equal(ms(0.4), 100);
    assert.equal(ms(0.8), 150);
    assert.equal(ms(1), 150);
    assert.equal(ms(0.6), 125);
  });

  test("continuous: never a jump over 2 ms between adjacent m, never falling, clean, crit or guarded", () => {
    for (const kind of [{}, { crit: true }, { guarded: true }]) {
      let prev = ms(0, kind);
      for (let m = 0.01; m <= 1.0001; m += 0.01) {
        const v = ms(Math.min(1, m), kind);
        assert.ok(v >= prev && v - prev <= 2, `${JSON.stringify(kind)}: ${prev} → ${v} at m ${m.toFixed(2)}`);
        prev = v;
      }
    }
  });

  test("dealt and taken freeze alike, with or without a human seated", () => {
    const e = strike(0.7, { attacker: "blaze", victim: "atlas" });
    assert.equal(hitstopMsFor(e, "arcade", "atlas"), hitstopMsFor(e, "arcade", "blaze"));
    assert.equal(hitstopMsFor(e, "arcade", null), hitstopMsFor(e, "arcade", "blaze"));
  });

  test("crit adds 20 inside the 150 cap; guarded is 33 + 17·m on onset; grazes never freeze", () => {
    assert.equal(ms(0.4, { crit: true }), 120);
    assert.equal(ms(0.7, { crit: true }), 150);
    assert.equal(ms(1, { crit: true }), 150);
    assert.equal(ms(0, { guarded: true }), 33);
    assert.equal(ms(1, { guarded: true }), 50);
    assert.equal(ms(0.9, { tier: "graze" }), 0);
  });

  test("deflect 110, clash 55, KO 150, contact and everything else 0", () => {
    assert.equal(hitstopMsFor(fakeEvents.deflect(), "arcade", "atlas"), 110);
    assert.equal(hitstopMsFor(fakeEvents.clash(), "arcade", "atlas"), 55);
    assert.equal(hitstopMsFor(fakeEvents.ko(), "arcade", "atlas"), 150);
    assert.equal(hitstopMsFor(fakeEvents.contact(), "arcade", "atlas"), 0);
    assert.equal(hitstopMsFor(fakeEvents.whiff(), "arcade", "atlas"), 0);
    assert.equal(hitstopMsFor(fakeEvents.core(), "arcade", "atlas"), 0);
  });

  test("no freeze of any kind outside ARCADE", () => {
    for (const preset of ["proving_ground", "harness"]) {
      for (const e of [strike(1, { crit: true }), fakeEvents.deflect(), fakeEvents.clash(), fakeEvents.ko()]) {
        assert.equal(hitstopMsFor(e, preset, "atlas"), 0);
      }
    }
  });

  test("nothing freezes longer than the cap or the KO; magnitude outside 0..1 is clamped", () => {
    for (let m = -0.5; m <= 1.5; m += 0.05) {
      for (const crit of [false, true]) {
        const v = ms(m, { crit });
        assert.ok(v >= HITSTOP.base && v <= HITSTOP.cap, `${v} at m ${m}`);
      }
    }
    assert.equal(ms(-1), 50);
    assert.equal(ms(3), 150);
    assert.ok(HITSTOP.ko === HITSTOP.cap);
  });

  test("a guard takes most of the freeze out of the same hit, and a crit puts more back in", () => {
    for (const m of [0.2, 0.4, 0.6]) {
      const clean = ms(m), guarded = ms(m, { guarded: true }), crit = ms(m, { crit: true });
      assert.ok(guarded > 0 && guarded < clean * 0.6, `m ${m}: guarded ${guarded} vs clean ${clean}`);
      assert.ok(crit > clean && crit - clean <= 20, `m ${m}: crit ${crit} vs clean ${clean}`);
    }
  });
});
