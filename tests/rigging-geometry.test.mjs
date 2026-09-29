// tests/rigging-geometry.test.mjs (GROUNDING C, D, E, G)
// The one test the grounding pass needs: every object in the set has a real-world size, sits where something
// could hold it up, and does not glow. rigging.tsx and studio-floor.tsx are .tsx, which node cannot import, so
// the numbers are read out of the source — which is also the point: these constants ARE the scale argument,
// and a silent edit to one of them is exactly the regression worth catching.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { DECK_LENGTH_M, DECK_THICKNESS_M, DECK_WIDTH_M } from "../src/game/render/deck-texture.ts";
import { MOUNT_X } from "../src/game/contracts.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const RIGGING = read("src/game/render/rigging.tsx");
const FLOOR = read("src/game/render/studio-floor.tsx");
const LEDS = read("src/game/render/led-strips.tsx");

/** Every `export const NAME = <number literal>;` in a source file. */
function constants(src) {
  const out = {};
  for (const m of src.matchAll(/^export const (\w+) = (-?\d+(?:\.\d+)?);$/gm)) out[m[1]] = Number(m[2]);
  return out;
}

const R = constants(RIGGING);
const F = constants(FLOOR);
const L = constants(LEDS);

// Three of rigging's constants are derived rather than written out. Check the derivation once, here, so the
// rest of the file can treat them as numbers.
const derived = (re, compute) => {
  const m = RIGGING.match(re);
  assert.ok(m, `rigging.tsx no longer derives this the way the test expects: ${re}`);
  return compute(m);
};
R.RIG_FLOOR_Z_M = derived(/export const RIG_FLOOR_Z_M = -DECK_THICKNESS_M;/, () => -DECK_THICKNESS_M);
R.RIG_LED_U_M = derived(/export const RIG_LED_U_M = \(RIG_CHANNEL_U0_M \+ RIG_CHANNEL_U1_M\) \/ 2;/,
  () => (R.RIG_CHANNEL_U0_M + R.RIG_CHANNEL_U1_M) / 2);
R.RIG_LED_Z_M = derived(/export const RIG_LED_Z_M = RIG_APRON_TOP_Z_M - (0\.\d+);/,
  (m) => R.RIG_APRON_TOP_Z_M - Number(m[1]));

describe("scale cues are real objects (GROUNDING G)", () => {
  test("hardware is the size the hardware actually is", () => {
    // An M6 hex head is 10 mm across the flats and stands 4 mm proud; a 6 mm plate is 6 mm.
    assert.equal(R.RIG_BOLT_FLATS_M, 0.010);
    assert.ok(R.RIG_BOLT_HEAD_H_M >= 0.003 && R.RIG_BOLT_HEAD_H_M <= 0.006, "M6 head height");
    assert.equal(R.RIG_PLATE_THICK_M, 0.006);
    assert.ok(R.RIG_CABLE_DIA_M >= 0.006 && R.RIG_CABLE_DIA_M <= 0.014, "a braided servo-bus sleeve");
    assert.ok(R.RIG_FLYLEAD_DIA_M < R.RIG_CABLE_DIA_M, "the flylead is the thinner of the two");
    assert.equal(F.FLOOR_TAPE_W_M, 0.048, "gaffer comes on a 48 mm roll");
    assert.equal(R.RIG_APRON_W_M, 0.080, "GROUNDING D: an 80 mm apron");
    assert.ok(R.RIG_ACRYLIC_T_M >= 0.004 && R.RIG_ACRYLIC_T_M <= 0.012, "sheet acrylic thickness");
    assert.ok(R.RIG_POST_DIA_M >= 0.020 && R.RIG_POST_DIA_M <= 0.050, "an aluminium post you could grip");
    assert.equal(R.RIG_CALIPER_M, 0.100, "the printed scale bar is 100 mm");
  });

  test("concrete is laid in slabs a floor layer would cut", () => {
    assert.ok(F.FLOOR_JOINT_PITCH_M >= 1.0 && F.FLOOR_JOINT_PITCH_M <= 2.0, "control-joint spacing");
    assert.ok(F.FLOOR_JOINT_W_M <= 0.006, "a saw cut, not a trench");
    assert.ok(F.FLOOR_BOX_L_M > F.FLOOR_BOX_W_M && F.FLOOR_BOX_L_M <= 0.4, "a floor box you could stand on");
  });
});

describe("everything is held up by something (GROUNDING C, D)", () => {
  test("the mount plate is bigger than the arm base and smaller than the deck", () => {
    assert.ok(R.RIG_PLATE_L_M > 0.09 && R.RIG_PLATE_W_M > 0.08, "larger than the SO-101 footprint");
    assert.ok(R.RIG_PLATE_W_M < DECK_WIDTH_M, "and it fits on the deck");
    // Both plates sit on the deck, clear of each other and of the deck edge.
    const gap = MOUNT_X.blaze - MOUNT_X.atlas - R.RIG_PLATE_L_M;
    assert.ok(gap > 0.2, `plates must not meet in the middle of the fight area (gap ${gap.toFixed(3)} m)`);
    assert.ok(Math.abs(MOUNT_X.blaze) + R.RIG_PLATE_L_M / 2 < DECK_LENGTH_M / 2, "and neither overhangs");
  });

  test("the apron rests on the floor and reaches deck height", () => {
    assert.equal(R.RIG_FLOOR_Z_M, -DECK_THICKNESS_M, "the floor is the underside of the deck");
    assert.ok(R.RIG_APRON_TOP_Z_M < 0 && R.RIG_APRON_TOP_Z_M > -0.005, "the apron top sits just under the print");
    assert.ok(R.RIG_APRON_TOP_Z_M - R.RIG_CHANNEL_DEPTH_M > R.RIG_FLOOR_Z_M, "the channel does not cut through");
  });

  test("the LED tape fits inside the channel that holds it", () => {
    const tapeW = L.LED_TAPE_W_M, tapeH = L.LED_TAPE_H_M;
    const channelW = R.RIG_CHANNEL_U1_M - R.RIG_CHANNEL_U0_M;
    assert.ok(channelW > tapeW, `an 18 mm channel holds a ${tapeW * 1000} mm tape`);
    assert.ok(R.RIG_CHANNEL_U1_M < R.RIG_APRON_W_M, "the channel is milled into the apron, not past it");
    // The strip centre is on the channel centre line, and the tape is fully inside the channel's depth.
    assert.equal(R.RIG_LED_U_M, (R.RIG_CHANNEL_U0_M + R.RIG_CHANNEL_U1_M) / 2);
    const floorZ = R.RIG_APRON_TOP_Z_M - R.RIG_CHANNEL_DEPTH_M;
    assert.ok(R.RIG_LED_Z_M - tapeH / 2 >= floorZ - 1e-9, "the tape sits on the channel floor");
    assert.ok(R.RIG_LED_Z_M + tapeH / 2 <= R.RIG_APRON_TOP_Z_M, "and is recessed below the lip");
  });

  test("the safety screen stands outside the apron, and the furniture outside the screen", () => {
    assert.ok(R.RIG_BARRIER_PAD_M > R.RIG_APRON_W_M, "posts cannot be bolted through the apron");
    assert.ok(R.RIG_BARRIER_H_M >= 0.18 && R.RIG_BARRIER_H_M <= 0.30, "GROUNDING D: about 0.25 m");
    const bx = DECK_LENGTH_M / 2 + R.RIG_BARRIER_PAD_M, by = DECK_WIDTH_M / 2 + R.RIG_BARRIER_PAD_M;
    const pieces = [
      ["camera A", R.RIG_CAM_A_X_M, R.RIG_CAM_A_Y_M, R.RIG_TRIPOD_HEAD_M, 0.34],
      ["camera B", R.RIG_CAM_B_X_M, R.RIG_CAM_B_Y_M, R.RIG_TRIPOD_HEAD_M, 0.34],
      ["monitor", R.RIG_MONITOR_X_M, R.RIG_MONITOR_Y_M, R.RIG_MONITOR_TOP_M, 0.18],
      ["case", R.RIG_CASE_X_M, R.RIG_CASE_Y_M, R.RIG_CASE_H_M, 0.45],
    ];
    for (const [name, x, y, top, half] of pieces) {
      assert.ok(Math.abs(x) - half > bx || Math.abs(y) - half > by, `${name} stands clear of the safety screen`);
      // Human scale: a thing a person uses, between a knee-high case and a stood-up camera.
      assert.ok(top >= 0.5 && top <= 1.7, `${name} is at human scale (${top} m)`);
      assert.ok(top > DECK_THICKNESS_M * 10, `${name} must dwarf the deck's thickness`);
    }
    // The point of the furniture: it is taller than the deck is long, so the deck reads as table-sized.
    assert.ok(R.RIG_TRIPOD_HEAD_M > DECK_LENGTH_M, "a camera position out-tops the whole deck");
  });

  test("the harness leaves the deck and lands somewhere", () => {
    assert.ok(Math.abs(R.RIG_TRAY_X_M) > Math.abs(MOUNT_X.blaze), "the tray is behind the arm, out of play");
    assert.ok(R.RIG_TRAY_X_M < DECK_LENGTH_M / 2, "and still on the deck");
    assert.ok(R.RIG_TRAY_END_Y_M > DECK_WIDTH_M / 2 + R.RIG_APRON_W_M, "the run gets past the apron");
    assert.ok(R.RIG_TRAY_END_Y_M < DECK_WIDTH_M / 2 + R.RIG_BARRIER_PAD_M,
      "the tray stops short of the safety screen: the taped run goes under its gap, the tray cannot");
    assert.ok(R.RIG_HARNESS_END_Y_M > DECK_WIDTH_M / 2 + R.RIG_BARRIER_PAD_M, "and the run ends past it");
    assert.ok(R.RIG_TRAY_W_M > R.RIG_CABLE_DIA_M * 2, "the tray is wide enough for what it carries");
  });
});

describe("nothing in the set glows (GROUNDING E, acceptance 7)", () => {
  test("the installed hardware and the floor are lit, never emissive", () => {
    for (const [name, src] of [["rigging.tsx", RIGGING], ["studio-floor.tsx", FLOOR]]) {
      assert.ok(!/emissive/i.test(src), `${name} must not emit light`);
      assert.ok(!/MeshBasicMaterial/.test(src), `${name} must be lit by the rig, not unlit`);
      assert.ok(!/toneMapped:\s*false/.test(src), `${name} must stay inside the tone map`);
    }
  });

  test("the deck edge is a fixture, not a neon outline", () => {
    assert.ok(L.LED_INTENSITY <= 6, `resting LED emissive ${L.LED_INTENSITY} is decoration, not a fixture`);
    assert.ok(L.LED_TAPE_W_M <= 0.02 && L.LED_TAPE_H_M <= 0.01, "LED tape is tape-sized");
  });
});

describe("the set stays inside the draw budget (GROUNDING acceptance 8)", () => {
  test("rigging merges to one opaque draw plus the one acrylic pane", () => {
    // Two `new Mesh(` in the view is the budget: the merged static set, and the safety screen.
    const meshes = [...RIGGING.matchAll(/new Mesh\(/g)].length;
    assert.equal(meshes, 2, "every repeated part must be merged, not its own mesh");
    assert.equal([...FLOOR.matchAll(/new Mesh\(/g)].length, 1, "the studio floor is one draw");
    // One program each, keyed so a variant cannot appear after the prewarm.
    assert.match(RIGGING, /customProgramCacheKey/);
    assert.match(FLOOR, /customProgramCacheKey/);
  });
});
