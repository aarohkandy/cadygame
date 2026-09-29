// WP7: brand marks (BUILD_PLAN 4 WP7.8): every mark has parseable path data inside its frame, TokenColor fills only,
// and the hosts and slant constants are the fixed decisions of SCOPE 1.2 and 1.3.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TOKEN_HEX } from "../src/game/contracts.ts";
import { BRAND_MARK_IDS, MARKS, SHOW_NAME, SHOW_TAGLINE, WORDMARK_LOCKUP, markSize } from "../src/game/brand/marks.ts";
import { HOSTS, HOST_IDS, pickHostVoice } from "../src/game/brand/hosts.ts";
import { HAZARD_STRIPE_DEG, SLANT_PANEL_DEG, SLANT_PANEL_K, SLANT_STAMP_DEG, STICKER_TILT_DEG, slantCut } from "../src/game/brand/slant.ts";
import { OHMSTEAD_NAME, OHMSTEAD_TAGLINE, PULPO_POP_NAME, BLOCK_GLYPHS, circleD, polygonD, setBlockText } from "../src/game/brand/sponsors.ts";
import { BIT_MARK, BIT_NAME } from "../src/game/brand/mascot.ts";

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Parses SVG path data; throws on anything malformed. Returns every absolute x/y it visits. */
export function parsePath(d) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const rest = d.replace(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[\s,]/g, "");
  if (rest.length > 0) throw new Error(`unexpected characters: ${rest.slice(0, 20)}`);
  const pts = [];
  let i = 0, cmd = null, x = 0, y = 0, commands = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[A-Za-z]$/.test(tok)) {
      const up = tok.toUpperCase();
      if (!(up in ARGS)) throw new Error(`unknown command ${tok}`);
      cmd = tok; i++; commands++;
      if (up === "Z") continue;
    } else if (cmd === null) {
      throw new Error("path data must start with a command");
    }
    const up = cmd.toUpperCase();
    if (up === "Z") throw new Error("numbers after Z");
    const n = ARGS[up];
    const nums = tokens.slice(i, i + n).map(Number);
    if (nums.length !== n || nums.some((v) => !Number.isFinite(v))) throw new Error(`${cmd} needs ${n} numbers`);
    i += n;
    const rel = cmd !== up;
    switch (up) {
      case "H": x = rel ? x + nums[0] : nums[0]; break;
      case "V": y = rel ? y + nums[0] : nums[0]; break;
      case "A": x = rel ? x + nums[5] : nums[5]; y = rel ? y + nums[6] : nums[6]; break;
      default: x = rel ? x + nums[n - 2] : nums[n - 2]; y = rel ? y + nums[n - 1] : nums[n - 1];
    }
    pts.push([x, y]);
  }
  if (commands === 0) throw new Error("empty path");
  return pts;
}

describe("brand marks", () => {
  test("the registry has every mark with a positive frame", () => {
    assert.deepEqual(Object.keys(MARKS).sort(), [...BRAND_MARK_IDS].sort());
    for (const id of BRAND_MARK_IDS) {
      const { x, y, width, height } = markSize(id);
      assert.equal(x, 0); assert.equal(y, 0);
      assert.ok(width > 0 && height > 0, id);
    }
    assert.equal(MARKS.bit, BIT_MARK);
  });

  test("every path parses, uses only TokenColor fills, and stays inside its frame", () => {
    for (const id of BRAND_MARK_IDS) {
      const mark = MARKS[id];
      const { width, height } = markSize(id);
      assert.ok(mark.paths.length >= 3, `${id} has real art`);
      for (const p of mark.paths) {
        assert.ok(p.fill in TOKEN_HEX, `${id} fill ${p.fill}`);
        if (p.stroke) assert.ok(p.stroke in TOKEN_HEX);
        const pts = parsePath(p.d);
        assert.ok(pts.length >= 3, `${id} path has geometry`);
        for (const [px, py] of pts) {
          assert.ok(px >= -1 && px <= width + 1 && py >= -1 && py <= height + 1, `${id} point ${px},${py} outside ${width}x${height}`);
        }
      }
    }
  });

  test("the wordmark plate comes first and spans the frame", () => {
    const plate = MARKS.torqueLimit.paths[WORDMARK_LOCKUP.plateIndex];
    assert.equal(plate.fill, "ink");
    const xs = parsePath(plate.d).map((p) => p[0]);
    assert.equal(Math.max(...xs), WORDMARK_LOCKUP.width);
    assert.equal(Math.min(...xs), 0);
    assert.equal(SHOW_NAME, "TORQUE LIMIT");
    assert.equal(SHOW_TAGLINE, "Live from the benchtop.");
  });

  test("sponsors, mascot and the letter kit", () => {
    assert.equal(OHMSTEAD_NAME, "OHMSTEAD");
    assert.equal(OHMSTEAD_TAGLINE, "Keeping you grounded");
    assert.equal(PULPO_POP_NAME, "PULPO POP");
    assert.equal(BIT_NAME, "BIT");
    for (const ch of "TORQUELIMOHMSTEADPULPO") assert.ok(BLOCK_GLYPHS.includes(ch), `kit draws ${ch}`);
    const t = setBlockText("TL", { x: 0, y: 0, capHeight: 100 });
    assert.ok(t.width > 0);
    assert.doesNotThrow(() => parsePath(t.d));
    assert.equal(polygonD([[0, 0], [1, 0], [1, 1]]), "M0 0 L1 0 L1 1 Z");
    assert.doesNotThrow(() => parsePath(circleD(5, 5, 2)));
  });

  test("hosts and slant are the fixed decisions", () => {
    assert.deepEqual(HOST_IDS, ["rook", "vale"]);
    assert.equal(HOSTS.rook.tag, "ROOK");
    assert.equal(HOSTS.rook.role, "hype");
    assert.equal(HOSTS.vale.tag, "DR. VALE");
    assert.equal(HOSTS.vale.role, "analyst");
    for (const id of HOST_IDS) {
      assert.ok(HOSTS[id].lip in TOKEN_HEX);
      assert.ok(HOSTS[id].speech.pitch > 0 && HOSTS[id].speech.pitch <= 2);
      assert.ok(HOSTS[id].speech.rate >= 0.5 && HOSTS[id].speech.rate <= 2);
      assert.ok(HOSTS[id].speech.preferredVoiceNames.length > 0);
    }
    assert.notDeepEqual(HOSTS.rook.speech, HOSTS.vale.speech);
    assert.equal(SLANT_PANEL_DEG, 12);
    assert.equal(SLANT_STAMP_DEG, 10);
    assert.equal(STICKER_TILT_DEG, -4);
    assert.equal(HAZARD_STRIPE_DEG, -45);
    assert.ok(Math.abs(SLANT_PANEL_K - 0.2126) < 1e-4);
    assert.ok(Math.abs(slantCut(44) - 9.353) < 1e-3);
  });

  test("host voices: preferred names first, distinct fallbacks, null with no voices", () => {
    const voices = [{ name: "Samantha", lang: "en-US" }, { name: "Daniel", lang: "en-GB" }, { name: "Amelie", lang: "fr-CA" }];
    assert.equal(pickHostVoice("rook", voices).name, "Daniel");
    assert.equal(pickHostVoice("vale", voices).name, "Samantha");
    const plain = [{ name: "Voice A", lang: "en-US" }, { name: "Voice B", lang: "en-US" }];
    assert.notEqual(pickHostVoice("rook", plain).name, pickHostVoice("vale", plain).name);
    assert.equal(pickHostVoice("rook", []), null);
  });
});
