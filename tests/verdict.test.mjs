import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACTION_STATUS_CODE, JOINT_LIMITS } from "../src/game/contracts.ts";
import {
  ARCADE_STICKER, CLEARED_STAMP, episodeVerdicts, reliabilityCounts, seatVerdict, stampLabel, summaryVerdict,
} from "../src/game/harness/verdict.ts";

const ROWS = 400;

/** blaze is a module policy deciding every other row; atlas is `atlasDriver`. */
function episode({ physics = "harness", timing = "eval", atlasDriver = "builtin", edit = () => {} } = {}) {
  const status = new Uint8Array(ROWS);
  const compute = new Float32Array(ROWS).fill(NaN);
  const raw = new Float64Array(ROWS * 6).fill(NaN);
  const req = new Int32Array(ROWS).fill(-1);
  for (let i = 0; i < ROWS; i += 2) { compute[i] = 2; req[i] = i; raw.set([0, -0.5, 0.9, -0.3, 0, 1], i * 6); }
  const seat = (driver) => ({ driver, name: driver, loadout: "pivot", policySha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", decisionHz: 25, chunkExecute: "until_next_decision", temporalEnsembleM: null, inputDevice: null });
  const ep = {
    meta: {
      format: "torquelimit.episode/3", episodeId: "v", created: "", controlHz: 50, timestep: 0.005, seed: 1, seedStreams: {},
      preset: physics === "arcade" ? "arcade" : "harness", physics, scoring: physics === "arcade" ? "full" : "physical", timing,
      actionDelayTicks: 1, fairDelayMs: 0, strictLimits: false, seats: { atlas: seat(atlasDriver), blaze: seat("module") },
      inputShaping: { atlas: null, blaze: null }, rules: { roundLengthS: 45, bestOf: 1 }, tuning: null, tuningSha256: "", servoParamsHash: "", tolerances: {},
      provenance: {}, result: { winner: "blaze", roundsWon: { atlas: 0, blaze: 1 }, rounds: [], forfeit: null, determinism: "unchecked", error: null },
    },
    columns: {
      timestamp: new Float64Array(ROWS), frame_index: new Uint32Array(ROWS).map((_, i) => i),
      "policy.status.blaze": status, "policy.compute_ms.blaze": compute, "action_raw.blaze": raw, "policy.request_frame_index.blaze": req,
    },
    shapes: {}, steps: {}, sparse: {}, events: [],
  };
  edit(ep, { status, compute, raw });
  return ep;
}

const reason = (ep) => seatVerdict(ep, "blaze");

describe("verdict: CLEARED FOR BROADCAST / POLICY FAULT (5.10.3)", () => {
  test("a clean stock episode is cleared", () => {
    const ep = episode();
    assert.deepEqual(reason(ep), { stamp: "cleared", reason: null });
    assert.equal(stampLabel(reason(ep)), CLEARED_STAMP);
    const c = reliabilityCounts(ep, "blaze");
    assert.equal(c.decisions, 200);
    assert.equal(c.arrivals, 200);
  });

  test("errors fault first", () => {
    const ep = episode({ edit: (_e, { status }) => { status[4] = ACTION_STATUS_CODE.error; status[6] = ACTION_STATUS_CODE.error; } });
    assert.deepEqual(reason(ep), { stamp: "fault", reason: "2 ERRORS" });
    assert.equal(stampLabel(reason(ep)), "POLICY FAULT: 2 ERRORS");
  });

  test("a timeout faults a live match; a hang faults an eval match", () => {
    const live = episode({ timing: "live", edit: (_e, { status, compute }) => { status[3] = ACTION_STATUS_CODE.timeout; compute[3] = NaN; } });
    assert.deepEqual(reason(live), { stamp: "fault", reason: "1 TIMEOUT" });
    const hang = episode({ edit: (e) => { e.meta.result.error = "policy_hang"; e.meta.result.forfeit = "blaze"; } });
    assert.deepEqual(reason(hang), { stamp: "fault", reason: "POLICY HANG" });
    const hangEvent = episode({ edit: (e) => { e.events.push({ type: "policy_fault", t: 1, step: 200, seat: "blaze", status: "hang", detail: "no action within 30 s" }); } });
    assert.deepEqual(reason(hangEvent), { stamp: "fault", reason: "POLICY HANG" });
    const disconnect = episode({ timing: "live", edit: (e) => { e.events.push({ type: "policy_fault", t: 1, step: 200, seat: "blaze", status: "disconnect", detail: "3 timeouts" }); } });
    assert.deepEqual(reason(disconnect), { stamp: "fault", reason: "DISCONNECTED" });
  });

  test("a disconnect faults an eval match too: eval records no timeouts, so nothing else would catch it", () => {
    // A bridge policy whose process is killed mid-round, and one that was never running at all.
    const midRound = episode({ edit: (e) => { e.events.push({ type: "policy_fault", t: 9.3, step: 1860, seat: "blaze", status: "disconnect", detail: "CONNECTION LOST" }); } });
    assert.deepEqual(reason(midRound), { stamp: "fault", reason: "DISCONNECTED" });
    assert.equal(stampLabel(reason(midRound)), "POLICY FAULT: DISCONNECTED");
    const neverConnected = episode({
      edit: (e, { status, compute, raw }) => {
        status.fill(0); compute.fill(NaN); raw.fill(NaN);          // the seat never returned a decision
        e.events.push({ type: "policy_fault", t: 0, step: 0, seat: "blaze", status: "disconnect", detail: "reset failed: NO BRIDGE AT 127.0.0.1:8765" });
      },
    });
    assert.equal(reliabilityCounts(neverConnected, "blaze").decisions, 0);
    assert.deepEqual(reason(neverConnected), { stamp: "fault", reason: "DISCONNECTED" });
  });

  test("late fraction at 2% faults; just under clears", () => {
    const late = (n) => episode({ edit: (_e, { status, compute }) => { for (let i = 0; i < n; i++) { status[2 * i + 1] = ACTION_STATUS_CODE.late; compute[2 * i + 1] = NaN; } } });
    assert.equal(reason(late(3)).stamp, "cleared");             // 3 / 203 = 1.48%
    assert.deepEqual(reason(late(5)), { stamp: "fault", reason: "LATE 2.4%" });   // 5 / 205
  });

  test("a returned target beyond a joint limit by more than 1e-5 rad is a violation; within tolerance is not", () => {
    const hi = JOINT_LIMITS[2][1];
    const within = episode({ edit: (_e, { raw }) => { raw[10 * 6 + 2] = hi + 5e-6; } });
    assert.equal(reason(within).stamp, "cleared");
    const over = episode({ edit: (_e, { raw }) => { raw[10 * 6 + 2] = hi + 2e-5; raw[20 * 6 + 0] = JOINT_LIMITS[0][0] - 0.3; } });
    assert.deepEqual(reason(over), { stamp: "fault", reason: "2 LIMIT VIOLATIONS" });
    const c = reliabilityCounts(over, "blaze");
    assert.deepEqual(c.violationsPerJoint, [1, 0, 1, 0, 0, 0]);
    assert.ok(Math.abs(c.maxOvershoot - 0.3) < 1e-9);
  });

  test("five table hits over 3 N fault; softer taps do not count", () => {
    const hits = (forces) => episode({ edit: (e) => { for (const f of forces) e.events.push({ type: "table_hit", t: 1, step: 1, seat: "blaze", force: f, pos: [0, 0, 0] }); } });
    assert.equal(reason(hits([4, 4, 4, 4, 2.9, 3])).stamp, "cleared");
    assert.deepEqual(reason(hits([4, 5, 6, 7, 8])), { stamp: "fault", reason: "5 TABLE HITS" });
  });

  test("table hits are telemetry for a built-in seat, but every contract check still applies to it", () => {
    const builtin = (edit) => episode({ edit: (e, cols) => { e.meta.seats.blaze.driver = "builtin"; edit(e, cols); } });
    const hits = (n) => builtin((e) => { for (let i = 0; i < n; i++) e.events.push({ type: "table_hit", t: 1, step: 1, seat: "blaze", force: 6, pos: [0, 0, 0] }); });
    // The house opponent swings for the Core and lands on the deck; that is the game, not a policy fault.
    assert.equal(reason(hits(7)).stamp, "cleared");
    assert.equal(reliabilityCounts(hits(7), "blaze").tableHits, 7, "the count is still recorded for the report");
    // Everything that says the seat broke the policy contract still faults a built-in.
    assert.deepEqual(reason(builtin((_e, { status }) => { status[4] = ACTION_STATUS_CODE.error; })), { stamp: "fault", reason: "1 ERROR" });
    assert.deepEqual(reason(builtin((_e, { raw }) => { raw[10 * 6 + 0] = JOINT_LIMITS[0][1] + 0.3; })), { stamp: "fault", reason: "1 LIMIT VIOLATION" });
    assert.deepEqual(reason(builtin((e) => { e.meta.result.determinism = "diverged"; })), { stamp: "fault", reason: "REPLAY DIVERGED" });
    // An uploaded model in the same seat is still held to the table.
    assert.deepEqual(reason(episode({ edit: (e) => { for (let i = 0; i < 7; i++) e.events.push({ type: "table_hit", t: 1, step: 1, seat: "blaze", force: 6, pos: [0, 0, 0] }); } })), { stamp: "fault", reason: "7 TABLE HITS" });
  });

  test("a diverged determinism check faults; unchecked does not", () => {
    assert.deepEqual(reason(episode({ edit: (e) => { e.meta.result.determinism = "diverged"; } })), { stamp: "fault", reason: "REPLAY DIVERGED" });
    assert.equal(reason(episode({ edit: (e) => { e.meta.result.determinism = "bit_exact"; } })).stamp, "cleared");
  });

  test("the first failing reason wins", () => {
    const ep = episode({ edit: (e, { status, raw }) => { status[0] = ACTION_STATUS_CODE.error; raw[12] = 99; e.meta.result.determinism = "diverged"; } });
    assert.equal(reason(ep).reason, "1 ERROR");
  });

  test("Arcade reports always carry the Arcade sticker; human seats get no stamp", () => {
    const arcade = episode({ physics: "arcade", atlasDriver: "human", edit: (_e, { status }) => { status[0] = ACTION_STATUS_CODE.error; } });
    const v = episodeVerdicts(arcade);
    assert.deepEqual(v.blaze, { stamp: "arcade", reason: ARCADE_STICKER });
    assert.deepEqual(v.atlas, { stamp: "none", reason: null });
    assert.equal(summaryVerdict(v), "arcade");
    assert.equal(stampLabel(v.blaze), "ARCADE PHYSICS · NOT VERIFICATION");
  });

  test("summary stamp: any fault, else cleared when a policy played, else none", () => {
    const fault = { stamp: "fault", reason: "x" }, ok = { stamp: "cleared", reason: null }, none = { stamp: "none", reason: null };
    assert.equal(summaryVerdict({ atlas: ok, blaze: fault }), "fault");
    assert.equal(summaryVerdict({ atlas: none, blaze: ok }), "cleared");
    assert.equal(summaryVerdict({ atlas: none, blaze: none }), "none");
  });
});
