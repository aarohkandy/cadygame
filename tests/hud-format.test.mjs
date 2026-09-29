// WP7: HUD formatting and colour semantics (GAME_DESIGN 6.2.1, 7.4; SCOPE 1.3).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TOKEN_HEX } from "../src/game/contracts.ts";
import {
  CORE_URGENT_S, HEAT_HOT, HEAT_WARM, PRESET_LABEL, comboLabel, coreChip, damageNumberPx, driverTag, eventToken, formatBytes,
  formatClock, formatDuration, formatLockIn, formatRateCi, formatRecord, formatSpeed, grazeTag, heatState, impactTag,
  integritySegments, linkPip, seatToken, servoStateTag, shortSha, timerUrgent, turboLine, verdictLabel,
} from "../src/game/ui/hud/format.ts";
import { fakeEvents } from "../src/game/testing/fakes.ts";

describe("hud format", () => {
  test("round clock rounds up to whole seconds and never goes negative", () => {
    assert.equal(formatClock(45), "0:45");
    assert.equal(formatClock(31.2), "0:32");
    assert.equal(formatClock(0.2), "0:01");
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(-3), "0:00");
    assert.equal(formatClock(75), "1:15");
    assert.equal(formatClock(Number.NaN), "0:00");
    assert.equal(formatDuration(87.9), "1:27");
  });

  test("urgent timer from 10 s", () => {
    assert.equal(timerUrgent(10), true);
    assert.equal(timerUrgent(10.4), false);
    assert.equal(timerUrgent(0), true);
  });

  test("speeds, lock-in, tags", () => {
    assert.equal(formatSpeed(2.7), "2.7 m/s");
    assert.equal(formatSpeed(0.314), "0.31 m/s");
    assert.equal(formatSpeed(12.4), "12 m/s");
    assert.equal(impactTag(2.7), "IMPACT 2.7 m/s");
    assert.equal(grazeTag(0.31), "GRAZE · 0.31 m/s");
    assert.equal(formatLockIn(5.23), "5.2");
    assert.equal(formatLockIn(-1), "0.0");
    assert.equal(formatRecord(12, 7), "W 12 · L 7");
    assert.equal(formatRateCi(0.63, 0.54, 0.71), "63% (54–71)");
    assert.equal(formatBytes(17 * 1024 * 1024), "17.0 MB");
    assert.equal(shortSha("9F2C1A77"), "9f2c1a");
  });

  test("damage number size is (28 + 16·m) px, ×1.3 crit, ×0.85 guarded", () => {
    assert.equal(damageNumberPx(0, false, false), 28);
    assert.equal(damageNumberPx(1, false, false), 44);
    assert.equal(damageNumberPx(0.5, false, false), 36);
    assert.equal(damageNumberPx(1, true, false), 57);
    assert.equal(damageNumberPx(1, false, true), 37);
    assert.equal(damageNumberPx(3, false, false), 44, "magnitude clamps to 1");
  });

  test("integrity splits into ten segments", () => {
    const out = new Float32Array(10);
    integritySegments(72, 100, out);
    assert.deepEqual(Array.from(out.slice(0, 7)), [1, 1, 1, 1, 1, 1, 1]);
    assert.ok(Math.abs(out[7] - 0.2) < 1e-6);
    assert.equal(out[8], 0);
    integritySegments(0, 100, out);
    assert.equal(out.reduce((a, b) => a + b, 0), 0);
    integritySegments(115, 115, out);
    assert.equal(out.reduce((a, b) => a + b, 0), 10);
  });

  test("one colour, one meaning", () => {
    assert.equal(seatToken("atlas"), "cobalt");
    assert.equal(seatToken("blaze"), "magenta");
    const strike = fakeEvents.strike({ attacker: "atlas", victim: "blaze" });
    assert.equal(eventToken(strike), "strike");
    assert.equal(eventToken({ ...strike, crit: true }), "crit");
    assert.equal(eventToken({ ...strike, guarded: true }), "block");
    assert.equal(eventToken({ ...strike, tier: "graze" }), null, "a graze gets no hit colour");
    assert.equal(eventToken(fakeEvents.deflect({ defender: "blaze", attacker: "atlas" })), "block");
    assert.equal(eventToken(fakeEvents.core({ stage: "lock", seat: "atlas" })), "volt");
    for (const t of ["strike", "crit", "block", "volt", "cobalt", "magenta"]) assert.match(TOKEN_HEX[t], /^#[0-9A-F]{6}$/);
  });

  test("servo state tags and silhouette pips", () => {
    assert.equal(servoStateTag("normal"), null);
    assert.equal(servoStateTag("stun"), "STUNNED");
    assert.equal(servoStateTag("offline"), "OFFLINE");
    assert.equal(linkPip("base"), 0);
    assert.equal(linkPip("camera_mount"), 0);
    assert.equal(linkPip("moving_jaw"), 5);
    assert.equal(linkPip("lower_arm"), 3);
  });

  test("driver tags and verdicts", () => {
    assert.equal(driverTag({ kind: "builtin", personality: "overshoot", tier: "pro", dda: true }), "BUILT-IN · PRO");
    assert.equal(driverTag({ kind: "module", fileName: "act_v3.mjs", source: "", sha256: "9f2c1a0000" }), "USER MODEL · act_v3.mjs · sha 9f2c1a");
    assert.equal(verdictLabel("cleared", null), "CLEARED FOR BROADCAST");
    assert.equal(verdictLabel("fault", "timeout"), "POLICY FAULT · TIMEOUT");
    assert.equal(verdictLabel("arcade", null), "ARCADE PHYSICS · NOT VERIFICATION");
    assert.equal(PRESET_LABEL.proving_ground, "PROVING GROUND");
  });

  test("the Core chip names every state the objective can be in", () => {
    const base = { visible: true, incoming: false, dropInS: 0, owner: null, docked: false, contested: false, loose: false, remainingS: 0 };
    assert.deepEqual(coreChip({ ...base, visible: false }), { state: "hidden", label: "", value: "", urgent: false });
    assert.deepEqual(coreChip({ ...base, incoming: true, dropInS: 4.2 }), { state: "incoming", label: "DROP", value: "5", urgent: false });
    assert.equal(coreChip({ ...base, incoming: true, dropInS: -1 }).value, "0", "never counts past the drop");
    assert.deepEqual(coreChip(base), { state: "live", label: "CORE", value: "LIVE", urgent: false });
    assert.deepEqual(coreChip({ ...base, loose: true, remainingS: 6.44 }), { state: "loose", label: "LOOSE", value: "6.4", urgent: false });
    assert.deepEqual(coreChip({ ...base, owner: "atlas", remainingS: 6 }), { state: "carried", label: "CARRIED", value: "6.0", urgent: false });
    assert.deepEqual(coreChip({ ...base, owner: "atlas", docked: true, remainingS: 6 }), { state: "docked", label: "LOCK-IN", value: "6.0", urgent: false });
  });

  test("the Core chip turns urgent when the round is about to be decided or taken", () => {
    const docked = { visible: true, incoming: false, dropInS: 0, owner: "blaze", docked: true, contested: false, loose: false, remainingS: CORE_URGENT_S };
    assert.equal(coreChip(docked).urgent, true, "at the threshold");
    assert.equal(coreChip({ ...docked, remainingS: CORE_URGENT_S + 0.1 }).urgent, false);
    // Carrying it is not the same as locking it in: the clock is paused, so there is nothing to be urgent about.
    assert.equal(coreChip({ ...docked, docked: false, remainingS: 0.5 }).urgent, false);
    const contested = coreChip({ ...docked, contested: true, remainingS: 9 });
    assert.equal(contested.state, "contested");
    assert.equal(contested.urgent, true, "contested outranks everything: the Core is changing hands");
  });

  test("heat states follow the arc thresholds, and a cutout outranks the number", () => {
    assert.equal(heatState(0, false), "cool");
    assert.equal(heatState(HEAT_WARM - 1, false), "cool");
    assert.equal(heatState(HEAT_WARM, false), "warm");
    assert.equal(heatState(HEAT_HOT - 0.1, false), "warm");
    assert.equal(heatState(HEAT_HOT, false), "hot");
    assert.equal(heatState(100, false), "hot");
    assert.equal(heatState(0, true), "cutout");
    assert.equal(heatState(Number.NaN, false), "cool");
  });

  test("combo bracket copy", () => {
    assert.equal(comboLabel(1), "1 HIT");
    assert.equal(comboLabel(3), "3 HITS");
    assert.equal(comboLabel(12), "12 HITS");
  });

  test("the TURBO plate's line carries three numbers that have to move", () => {
    assert.equal(turboLine(2, 31.2, 74.28), "ROUND 2 · 0:32 · SIM 74.3 S");
    assert.equal(turboLine(1, 0, 0), "ROUND 1 · 0:00 · SIM 0.0 S");
    assert.equal(turboLine(0, -5, -3), "ROUND 1 · 0:00 · SIM 0.0 S", "never reads as a round or a clock that cannot exist");
    assert.equal(turboLine(Number.NaN, Number.NaN, Number.NaN), "ROUND 1 · 0:00 · SIM 0.0 S");
  });
});
