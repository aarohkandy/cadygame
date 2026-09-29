// GROUNDING A (WP2): the deck is a built object, so its layout has to survive as one. An 18 mm plate, a
// 25 mm brushed-aluminium trim extrusion capping the perimeter with countersunk bolts at the corners and
// ~0.25 m apart, and two matte ESD rubber mat panels inside the trim meeting at a 3 mm centre seam. The mat
// carries the worn printed graphics, the milled dock recesses with their painted rings, seat gaffer tape and
// the show wordmark at each seat end, with nothing printed over the docks or the drop point. The surface map
// (roughness / AO / scuff) uses the same layout at half resolution.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DOCK_CENTER_X, DOCK_RADIUS, MOUNT_X } from "../src/game/contracts.ts";
import {
  CUBE_ABS_HEX, deckLayout, deckBaseHex, deckBoltsM, simToDeckPx, BOLT_HEAD_M, BOLT_SPACING_M, DECK_LENGTH_M, DECK_WIDTH_M,
  DECK_THICKNESS_M, DECK_TEXTURE_W, DECK_TEXTURE_H, DECK_SURFACE_W, DECK_SURFACE_H, DOCK_RECESS_M, DOCK_TAPE_M,
  MAT_LENGTH_M, MAT_SEAM_M, MAT_WIDTH_M, TRIM_RISE_M, TRIM_W_M, ZONE_ALPHA,
} from "../src/game/render/deck-texture.ts";
import { srgbDecode } from "../src/game/render/quality.ts";

const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const circleBox = (c) => ({ x: c.cx - c.rOuter, y: c.cy - c.rOuter, w: c.rOuter * 2, h: c.rOuter * 2 });
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return srgbDecode(((n >> 16) & 255) / 255) * 0.2126 + srgbDecode(((n >> 8) & 255) / 255) * 0.7152
    + srgbDecode((n & 255) / 255) * 0.0722;
};

describe("deck texture layout", () => {
  const L = deckLayout();

  test("the mat panels sit inside the trim, and the texture covers them at a single scale", () => {
    assert.equal(TRIM_W_M, 0.025);
    assert.ok(Math.abs(MAT_LENGTH_M - (DECK_LENGTH_M - 2 * TRIM_W_M)) < 1e-9);
    assert.ok(Math.abs(MAT_WIDTH_M - (DECK_WIDTH_M - 2 * TRIM_W_M)) < 1e-9);
    assert.equal(L.width, DECK_TEXTURE_W);
    assert.equal(L.height, DECK_TEXTURE_H);
    assert.ok(Math.abs(L.pxPerM * MAT_LENGTH_M - L.width) < 1);
    assert.ok(L.pxPerM * MAT_WIDTH_M <= L.height + 1);
    // The trim stands proud of the mat but is a fraction of the plate: it is a trim, not a wall.
    assert.ok(TRIM_RISE_M > 0 && TRIM_RISE_M < DECK_THICKNESS_M / 4);
  });

  test("the two mat panels meet at a 3 mm seam on the centreline", () => {
    assert.equal(MAT_SEAM_M, 0.003);
    assert.ok(Math.abs(L.seam.x - L.width / 2) < 1e-6);
    assert.ok(Math.abs(L.seam.w - MAT_SEAM_M * L.pxPerM) < 1e-6);
    // Each half runs from its own outer edge to its side of the seam; neither crosses it.
    assert.ok(Math.abs(L.zones.atlas.x) < 1e-6);
    assert.ok(Math.abs(L.zones.atlas.x + L.zones.atlas.w - (L.seam.x - L.seam.w / 2)) < 1e-6);
    assert.ok(Math.abs(L.zones.blaze.x - (L.seam.x + L.seam.w / 2)) < 1e-6);
    assert.ok(Math.abs(L.zones.blaze.x + L.zones.blaze.w - L.width) < 1e-6);
  });

  test("the print is worn ink over the rubber, not a covering", () => {
    assert.equal(L.zones.alpha, ZONE_ALPHA);
    assert.ok(ZONE_ALPHA > 0 && ZONE_ALPHA <= 0.2);
  });

  test("bolts land on every corner of the trim, about 0.25 m apart, on the trim's centre line", () => {
    const bolts = deckBoltsM();
    const hx = DECK_LENGTH_M / 2 - TRIM_W_M / 2;
    const hy = DECK_WIDTH_M / 2 - TRIM_W_M / 2;
    assert.ok(bolts.length >= 12 && bolts.length <= 24, `${bolts.length} bolts`);
    for (const c of [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]) {
      assert.ok(bolts.some((b) => Math.abs(b.x - c[0]) < 1e-9 && Math.abs(b.y - c[1]) < 1e-9), `corner ${c}`);
    }
    for (const b of bolts) {
      // Every bolt is on the trim run: one coordinate is pinned to the centre line of a side.
      const onX = Math.abs(Math.abs(b.x) - hx) < 1e-9, onY = Math.abs(Math.abs(b.y) - hy) < 1e-9;
      assert.ok(onX || onY, `${b.x},${b.y} off the trim`);
      assert.ok(Math.abs(b.x) <= hx + 1e-9 && Math.abs(b.y) <= hy + 1e-9, "bolt past a corner");
    }
    // The gap between neighbours round the run stays near the nominal spacing, and the head fits the face.
    const ordered = bolts.map((b, i) => [b, bolts[(i + 1) % bolts.length]]);
    for (const [a, b] of ordered) {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(d > BOLT_SPACING_M * 0.7 && d < BOLT_SPACING_M * 1.3, `spacing ${d}`);
      assert.ok(d > BOLT_HEAD_M * 3, "heads would crowd");
    }
    assert.ok(BOLT_HEAD_M * 2.2 < TRIM_W_M, "the bolt and its dirt ring must fit on the trim face");
  });

  test("dock rings are painted on a milled recess rim, centred on the real docks", () => {
    for (const seat of ["atlas", "blaze"]) {
      const d = L.docks[seat];
      const [cx, cy] = simToDeckPx(DOCK_CENTER_X[seat], 0, L);
      assert.ok(Math.abs(d.cx - cx) < 1e-6 && Math.abs(d.cy - cy) < 1e-6, seat);
      assert.ok(Math.abs((d.rOuter + d.rInner) / 2 - DOCK_RADIUS * L.pxPerM) < 1e-6);
      assert.ok(Math.abs(d.rOuter - d.rInner - DOCK_TAPE_M * L.pxPerM) < 1e-6);
      assert.ok(inside(circleBox(d), L.width, L.height));
      // The recess is wider than the ring painted on its rim, and both stay on the mat.
      assert.ok(L.recess[seat] > d.rOuter, `${seat} recess inside its own ring`);
      assert.ok(Math.abs(L.recess[seat] - DOCK_RECESS_M * L.pxPerM) < 1e-6);
      assert.ok(inside({ x: d.cx - L.recess[seat], y: d.cy - L.recess[seat], w: L.recess[seat] * 2, h: L.recess[seat] * 2 },
        L.width, L.height), `${seat} recess off the mat`);
    }
  });

  test("the mount footprints sit under the real arm mounts, clear of the dock recesses", () => {
    for (const seat of ["atlas", "blaze"]) {
      const m = L.mounts[seat];
      const [cx, cy] = simToDeckPx(MOUNT_X[seat], 0, L);
      assert.ok(Math.abs(m.cx - cx) < 1e-6 && Math.abs(m.cy - cy) < 1e-6, seat);
      const gap = Math.abs(MOUNT_X[seat] - DOCK_CENTER_X[seat]) * L.pxPerM;
      assert.ok(gap > L.mounts.radius + L.recess[seat] * 0.5, `${seat} mount on top of its dock`);
    }
  });

  test("the show wordmark sits at each seat end, on the mat, clear of the docks and the seat tape", () => {
    for (const seat of ["atlas", "blaze"]) {
      const w = L.wordmarks[seat];
      assert.ok(inside(w, L.width, L.height), seat);
      assert.ok(!overlap(w, circleBox(L.docks.atlas)) && !overlap(w, circleBox(L.docks.blaze)), `${seat} over a dock`);
      assert.ok(!overlap(w, L.seatTape.atlas) && !overlap(w, L.seatTape.blaze), `${seat} over seat tape`);
      assert.equal(Math.sign(w.x + w.w / 2 - L.width / 2), seat === "atlas" ? -1 : 1);
    }
  });

  test("the drop X sits on the drop point, between the dock rings", () => {
    const [cx, cy] = simToDeckPx(0, 0, L);
    assert.ok(Math.abs(L.dropX.cx - cx) < 1e-6 && Math.abs(L.dropX.cy - cy) < 1e-6);
    // The X's tape (arm length along a 45° diagonal) never reaches either recess.
    const reach = L.dropX.arm * Math.SQRT1_2 + L.dropX.tape;
    assert.ok(L.dropX.cx + reach < L.docks.blaze.cx - L.recess.blaze);
    assert.ok(L.dropX.cx - reach > L.docks.atlas.cx + L.recess.atlas);
  });

  test("seat tape stays on the mat and clear of the dock rings", () => {
    for (const r of [L.seatTape.atlas, L.seatTape.blaze]) {
      assert.ok(inside(r, L.width, L.height), JSON.stringify(r));
      assert.ok(!overlap(r, circleBox(L.docks.atlas)), "clear of atlas dock");
      assert.ok(!overlap(r, circleBox(L.docks.blaze)), "clear of blaze dock");
    }
  });

  test("the mat is matte black rubber: dark, but light enough to carry a contact shadow", () => {
    const l = lum(deckBaseHex());
    // A shadow on a surface below ~1.2 % linear has nowhere to go, which is why nothing looked planted.
    assert.ok(l > 0.012, `mat luminance ${l} cannot show a contact shadow`);
    assert.ok(l < 0.045, `mat luminance ${l} is no longer black rubber`);
  });

  // THEATRE 2 item 5: the props have to be visible on the surface they lie on. They were moulded in ink at
  // about a quarter of the mat's value, so nine cubes and the Core vanished into it. Value separation is
  // what fixes that, and it is a property of two constants, so it is checkable here.
  test("clutter cubes read against the mat by value", () => {
    const mat = lum(deckBaseHex());
    const cube = lum(CUBE_ABS_HEX);
    assert.ok(cube > mat * 3, `cube ${cube.toFixed(4)} is not clear of mat ${mat.toFixed(4)}`);
    // And not so light that a prop out-shines the machines: the arms are the brightest things on the deck.
    assert.ok(cube < 0.20, `cube ${cube.toFixed(4)} is brighter than painted shell`);
  });

  test("the team field is a wash on rubber, not a colour cast over the room", () => {
    // Part 2: saturated colour lives on the machines and the printed objects. Half a deck of flat team
    // colour is the "smeared over the room" failure, and it is what made the mat muddy.
    assert.ok(ZONE_ALPHA <= 0.12, `field wash ${ZONE_ALPHA} is a covering`);
  });

  test("the surface map is the same layout at half resolution", () => {
    const S = deckLayout(DECK_SURFACE_W, DECK_SURFACE_H);
    assert.ok(Math.abs(S.pxPerM * 2 - L.pxPerM) < 1e-6);
    assert.ok(Math.abs(S.docks.blaze.cx * 2 - L.docks.blaze.cx) < 1e-6);
    assert.ok(Math.abs(S.seam.w * 2 - L.seam.w) < 1e-6);
  });
});
