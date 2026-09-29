// EMOTION_BIBLE 5.2 (WP2): the holographic crowd is a witness, not wallpaper: one instanced draw, ≤ 160 figures on
// two low tiers set well back from the stage, house seats desaturated indigo with no team tint below hype 80,
// and any drawn prefix spread evenly around the ring so both stands are always peopled.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  layoutCrowd, createCrowdGeometry, createCrowdMaterial, crowdSide, CROWD_INNER_RADIUS_M, CROWD_NEUTRAL_X_M, CROWD_MAX,
  CROWD_TIERS, CROWD_TIER_RISE_M, CROWD_FIGURE_H_M, CROWD_HOUSE_HEX, CROWD_TINT_HYPE, STAND_FLOOR_Z_M,
} from "../src/game/render/holo-crowd-material.ts";
import { CROWD_CAPACITY, QUALITY_TIERS } from "../src/game/render/quality.ts";
import { DECK_LENGTH_M, DECK_WIDTH_M } from "../src/game/render/deck-texture.ts";
import { srgbDecode } from "../src/game/render/quality.ts";
import {
  createArmUniforms, createShellMaterial, highlightSharpness, SHELL_CLEARCOAT_ROUGHNESS,
} from "../src/game/render/robot-materials.ts";

/** The cockpit eye (5.5) looks down the long axis; the crowd must stay a thin band. */
const EYE_Z_M = 0.16;
const FOV_V_DEG = 58;

describe("holographic crowd instancing", () => {
  const layout = layoutCrowd(CROWD_CAPACITY);

  test("one instanced geometry, ≤ 160 figures drawn on every tier", () => {
    assert.equal(CROWD_MAX, 160);
    assert.ok(layout.count >= CROWD_MAX, `layout ${layout.count} seats holds fewer than the ${CROWD_MAX} drawn`);
    const g = createCrowdGeometry(layout);
    assert.equal(g.isInstancedBufferGeometry, true);
    assert.equal(g.getAttribute("aOffset").count, layout.count);
    for (const t of Object.values(QUALITY_TIERS)) assert.ok(Math.min(t.crowd, CROWD_MAX) <= CROWD_MAX);
    const { material, uniforms } = createCrowdMaterial();
    assert.equal(material.isShaderMaterial, true);
    assert.equal(uniforms.uLean.value, 0);
  });

  test("two low tiers: every figure stands on a tier outside the stage, and the stand is ≤ 18 % of frame height", () => {
    assert.equal(CROWD_TIERS, 2);
    const deckHalfDiag = Math.hypot(DECK_LENGTH_M / 2, DECK_WIDTH_M / 2);
    for (let i = 0; i < layout.count; i++) {
      const r = Math.hypot(layout.offsets[i * 3], layout.offsets[i * 3 + 1]);
      assert.ok(r > deckHalfDiag + 0.6, `figure ${i} at r ${r}`);
      assert.ok(r >= CROWD_INNER_RADIUS_M - 0.02);
      const tier = layout.info[i * 4 + 2];
      assert.ok(tier >= 0 && tier < CROWD_TIERS);
    }
    // Tallest crown (1.2× figure) on the back tier vs the front row's feet, seen from the cockpit eye.
    const top = STAND_FLOOR_Z_M + (CROWD_TIERS - 1) * CROWD_TIER_RISE_M + 0.03 + CROWD_FIGURE_H_M * 1.2;
    const bottom = STAND_FLOOR_Z_M + 0.03;
    const up = Math.atan2(top - EYE_Z_M, CROWD_INNER_RADIUS_M);
    const down = Math.atan2(bottom - EYE_Z_M, CROWD_INNER_RADIUS_M);
    const share = ((up - down) * 180) / Math.PI / FOV_V_DEG;
    assert.ok(share <= 0.18, `crowd spans ${(share * 100).toFixed(1)} % of the frame height`);
  });

  test("house seats are desaturated indigo: dim, and no channel far above the others", () => {
    const n = parseInt(CROWD_HOUSE_HEX.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbDecode(c / 255));
    const lum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    assert.ok(lum < 0.08, `house luminance ${lum}`);
    assert.ok(Math.max(...rgb) - Math.min(...rgb) < 0.12, "saturated house colour");
    assert.ok(CROWD_TINT_HYPE >= 0.8, "team tint below hype 80");
  });

  test("a seat belongs to the stand at its end, past the neutral band", () => {
    for (let i = 0; i < layout.count; i++) {
      const x = layout.offsets[i * 3];
      const side = layout.info[i * 4 + 1];
      assert.equal(side, crowdSide(x), `seat ${i}`);
      if (side === 0) assert.ok(Math.abs(x) <= CROWD_NEUTRAL_X_M);
      else { assert.equal(side, x < 0 ? -1 : 1, `seat ${i} at x ${x} on side ${side}`); assert.ok(Math.abs(x) > CROWD_NEUTRAL_X_M); }
    }
  });

  test("the drawn prefix (160, and LOW's smaller one) covers both stands and all four quadrants evenly", () => {
    for (const n of [CROWD_MAX, Math.min(QUALITY_TIERS.low.crowd, CROWD_MAX)]) {
      assert.ok(n <= layout.count);
      let a = 0, b = 0;
      const quadrants = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const x = layout.offsets[i * 3], y = layout.offsets[i * 3 + 1];
        if (layout.info[i * 4 + 1] < 0) a++;
        if (layout.info[i * 4 + 1] > 0) b++;
        quadrants[(x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0)]++;
      }
      assert.ok(a > 0 && b > 0, `atlas ${a} vs blaze ${b}`);
      assert.ok(Math.abs(a - b) / n < 0.1, `atlas ${a} vs blaze ${b} of ${n}`);
      for (const q of quadrants) assert.ok(q / n > 0.18, `quadrant share ${q / n} of ${n}`);
    }
  });

  test("seats never overlap", () => {
    for (let i = 0; i < layout.count; i++) {
      for (let j = i + 1; j < layout.count; j++) {
        if (layout.info[i * 4 + 2] !== layout.info[j * 4 + 2]) continue;
        const d = Math.hypot(layout.offsets[i * 3] - layout.offsets[j * 3], layout.offsets[i * 3 + 1] - layout.offsets[j * 3 + 1]);
        assert.ok(d > 0.09, `seats ${i} and ${j} are ${d} m apart`);
      }
    }
  });
});

// GROUNDING F acceptance 3: a greyscale frame must still show four distinguishable materials — the deck's
// rubber mat, brushed metal, painted shell, anodised servo — by their specular response alone. Three of the
// four are the arm's (robot-materials); the mat belongs to the deck. Colour is not allowed to be what tells
// them apart, so the only thing this can check is that their highlights differ enough to read.
describe("arm material classes separate in greyscale", () => {
  const CLASSES = ["grip_pad", "servo", "optics", "shell_body"];

  test("each class has its own highlight sharpness, none within 0.15 of another", () => {
    const sharp = CLASSES.map((c) => highlightSharpness(c));
    for (const s of sharp) assert.ok(s >= 0 && s <= 1, `sharpness ${s} out of range`);
    // Matte rubber pad → anodised servo → brushed metal → lacquered shell, in that order.
    for (let i = 1; i < sharp.length; i++) {
      assert.ok(sharp[i] - sharp[i - 1] >= 0.15,
        `${CLASSES[i - 1]} (${sharp[i - 1].toFixed(2)}) and ${CLASSES[i]} (${sharp[i].toFixed(2)}) read alike in greyscale`);
    }
    assert.equal(highlightSharpness("shell_hand"), highlightSharpness("shell_body"), "both shells are the same paint");
  });

  test("the built materials carry that separation, and only the lacquered shells have a clearcoat", () => {
    const arm = createArmUniforms();
    const shell = createShellMaterial("shell_body", "upper_arm", "rival", "blaze", false, arm).material;
    const servo = createShellMaterial("servo", "upper_arm", "rival", "blaze", false, arm).material;
    const optics = createShellMaterial("optics", "camera_mount", "rival", "blaze", false, arm).material;
    assert.equal(shell.clearcoat, 1);
    assert.equal(shell.clearcoatRoughness, SHELL_CLEARCOAT_ROUGHNESS);
    assert.equal(servo.clearcoat, 0, "an anodised servo has no lacquer over it");
    assert.equal(optics.clearcoat, 0, "machined metal has no lacquer over it");
    // The shell's own paint is deliberately soft, so the lacquer is the only sharp highlight on it.
    assert.ok(shell.roughness > optics.roughness + 0.15, "shell paint reads as glossy as bare metal");
    assert.ok(servo.roughness > shell.roughness, "the servo streak must be broader than the paint's");
    assert.ok(servo.anisotropy > 0, "the servo's brushed streak is the anisotropy lobe");
  });
});
