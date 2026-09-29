// WP7: style tokens and colour semantics (SCOPE 1.3, GAME_DESIGN 6.2.1, BUILD_PLAN 4 WP7.7).
// Parses src/app/globals.css: token values, the fixed slants, no backdrop-filter, no rounded corners, volt/strike/
// crit/block only inside the selectors their one meaning allows, ink text on the light semantic colours, paper text
// on the saturated ones, and reduced-motion fades for the impact and celebration tiers. Also scans the UI source for
// raw semantic hex values that would bypass the tokens.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { TOKEN_HEX } from "../src/game/contracts.ts";
import { SLANT_PANEL_DEG, SLANT_PANEL_K, SLANT_STAMP_DEG, STICKER_TILT_DEG } from "../src/game/brand/slant.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Flat list of { selectors, body, context } for every style rule, with at-rule context. */
function parseRules(text) {
  const rules = [];
  let i = 0;
  function block(context) {
    let buf = "";
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") {
        i++;
        const head = buf.trim();
        buf = "";
        if (head.startsWith("@")) {
          if (/^@keyframes|^@font-face/.test(head)) skip();
          else block([...context, head]);
        } else {
          const start = i;
          skip();
          rules.push({ selectors: head.split(",").map((s) => s.trim()), body: text.slice(start, i - 1), context });
        }
      } else if (ch === "}") {
        i++;
        return;
      } else {
        buf += ch;
        if (ch === ";" && buf.trim().startsWith("@")) buf = "";
        i++;
      }
    }
  }
  function skip() {
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
  }
  block([]);
  return rules;
}

const rules = parseRules(css);
const isTokenBlock = (r) => r.context.some((c) => c.startsWith("@theme")) || r.selectors.every((s) => s.startsWith(":root"));

const ALLOWED = {
  volt: [".hud-core", ".tl-prize", ".tl-stamp--gold", ".tl-sticker--prize", '.hud-banner[data-kind="victory"]'],
  strike: [".hud-hit", ".hud-dmg__num", '[data-hit="true"]'],
  crit: ['[data-kind="crit"]', '[data-tone="crit"]'],
  block: ['[data-tone="block"]'],
};

function decl(body, prop) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

describe("styles tokens", () => {
  test("palette tokens equal the contract hex values", () => {
    const rootRule = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === ":root");
    assert.ok(rootRule, ":root block exists");
    for (const [name, hex] of Object.entries(TOKEN_HEX)) {
      assert.equal(decl(rootRule.body, `--${name}`)?.toUpperCase(), hex, `--${name}`);
    }
  });

  test("slants in CSS equal brand/slant.ts", () => {
    const rootRule = rules.find((r) => r.selectors[0] === ":root");
    assert.equal(decl(rootRule.body, "--slant-panel"), `${SLANT_PANEL_DEG}deg`);
    assert.equal(decl(rootRule.body, "--slant-stamp"), `${SLANT_STAMP_DEG}deg`);
    assert.equal(decl(rootRule.body, "--sticker-tilt"), `${STICKER_TILT_DEG}deg`);
    assert.ok(Math.abs(Number(decl(rootRule.body, "--slant-k")) - SLANT_PANEL_K) < 1e-3);
  });

  test("no backdrop-filter and no rounded corners", () => {
    assert.equal(/backdrop-filter/.test(css), false);
    for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.match(m[1].trim(), /^0(px)?$/, `border-radius ${m[1]}`);
  });

  test("volt, strike, crit and block appear only where their meaning allows", () => {
    for (const r of rules) {
      if (isTokenBlock(r)) continue;
      for (const [token, allowed] of Object.entries(ALLOWED)) {
        if (!new RegExp(`var\\(--${token}(?:-\\d+)?\\)`).test(r.body)) continue;
        for (const sel of r.selectors) {
          assert.ok(allowed.some((a) => sel.includes(a)), `--${token} used by "${sel}"`);
        }
      }
    }
  });

  test("text on light semantic colours is ink; text on saturated colours is paper", () => {
    let checked = 0;
    for (const r of rules) {
      if (isTokenBlock(r)) continue;
      const bg = decl(r.body, "background") ?? decl(r.body, "background-color");
      const color = decl(r.body, "color");
      if (!bg || !color) continue;
      if (/^var\(--(volt|strike|crit|block)\)$/.test(bg)) { assert.equal(color, "var(--ink)", r.selectors.join(", ")); checked++; }
      if (/^var\(--(signal|cobalt|magenta)\)$/.test(bg)) { assert.equal(color, "var(--paper)", r.selectors.join(", ")); checked++; }
    }
    assert.ok(checked >= 4, `contrast rules checked (${checked})`);
  });

  test("reduced motion turns impact and celebration tiers into 120 ms fades", () => {
    const reduced = rules.filter((r) => r.selectors.some((s) => s.includes('[data-reduced-motion="true"]')));
    const fade = reduced.find((r) => r.selectors.some((s) => s.includes(".tl-anim-slam")));
    assert.ok(fade, "impact tier covered");
    assert.ok(fade.selectors.some((s) => s.includes(".tl-anim-stamp")), "celebration tier covered");
    assert.match(fade.body, /tl-fade-in 120ms/);
  });

  test("motion tier tokens match the design", () => {
    const rootRule = rules.find((r) => r.selectors[0] === ":root");
    assert.equal(decl(rootRule.body, "--dur-slam"), "240ms");
    assert.equal(decl(rootRule.body, "--dur-slide"), "200ms");
    assert.equal(decl(rootRule.body, "--dur-exit"), "140ms");
    assert.equal(decl(rootRule.body, "--dur-pop"), "80ms");
    assert.equal(decl(rootRule.body, "--ease-impact"), "cubic-bezier(0.2, 1.5, 0.35, 1)");
  });

  test("UI source never hard-codes a semantic colour", () => {
    const semantic = ["volt", "strike", "crit", "block"].map((t) => TOKEN_HEX[t].toLowerCase());
    const files = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.tsx?$/.test(n)) files.push(f); } };
    walk(path.join(root, "src/game/ui"));
    walk(path.join(root, "src/game/brand"));
    for (const f of files) {
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const hex of semantic) assert.equal(text.includes(hex), false, `${path.relative(root, f)} hard-codes ${hex}`);
      if (!f.endsWith("wordmark.tsx")) assert.equal(/var\(--(volt|strike|crit|block)\)/.test(text), false, `${path.relative(root, f)} references a semantic token directly`);
    }
  });

  // GROUNDING part 2 item 7 / acceptance 8: no caption or prompt taller than 6% of frame height during a fight.
  // The two straps are the tutorial prompt (Anton line + key cap on an ink plate) and the host caption at its
  // loudest ramp. Both are sized in vh/vw, so the gate is arithmetic on the stylesheet, not a screenshot.
  test("the in-fight prompt and caption straps stay under 6% of frame height", () => {
    const extra = readFileSync(path.join(root, "src/game/ui/hud/hud-extra.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const extraRules = parseRules(extra);
    const find = (list, sel) => list.find((r) => r.selectors.includes(sel));
    /** `clamp(Apx, min(Bvh, Cvw), Dpx)` in real pixels. */
    const px = (value, w, h) => {
      const m = value.match(/clamp\(\s*([\d.]+)px\s*,\s*min\(\s*([\d.]+)vh\s*,\s*([\d.]+)vw\s*\)\s*,\s*([\d.]+)px\s*\)/);
      assert.ok(m, `not a clamp(px, min(vh, vw), px): ${value}`);
      return Math.min(Math.max(Number(m[1]), Math.min((Number(m[2]) / 100) * h, (Number(m[3]) / 100) * w)), Number(m[4]));
    };
    /** Vertical padding of a shorthand `a b c` / `a b`. */
    const padY = (body) => {
      const parts = decl(body, "padding").split(/\s+/).map((v) => Number(v.replace("px", "")));
      return parts[0] + (parts.length >= 3 ? parts[2] : parts[0]);
    };

    const rootRule = rules.find((r) => r.selectors[0] === ":root");
    const promptFs = decl(find(rules, ".tut__line.t-display-l").body, "font-size");
    const plateFs = decl(rootRule.body, "--fs-plate");
    const promptPad = padY(find(rules, ".tut__line").body);
    const captionPad = padY(find(extraRules, ".hud-caption__body").body);
    // The key cap is the tallest thing in the prompt row: 1.6 em of its own 0.62 em font.
    const keyEm = Number(decl(find(rules, ".tut__line .tl-key").body, "font-size").replace("em", ""))
      * Number(decl(find(rules, ".tl-key").body, "height").replace("em", ""));
    const antonLh = Number(decl(rules.find((r) => r.selectors.includes(".t-display-l")).body, "line-height") ?? 0.86);
    const captionLh = Number(decl(find(extraRules, ".hud-caption__body").body, "line-height"));
    const ramp3 = Number(decl(find(extraRules, '.hud-caption[data-ramp="3"]').body, "--ramp-scale"));

    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      const prompt = Math.max(keyEm, antonLh) * px(promptFs, w, h) + promptPad;
      const caption = captionLh * ramp3 * px(plateFs, w, h) + captionPad;
      assert.ok(prompt / h < 0.06, `tutorial prompt is ${(100 * prompt / h).toFixed(1)}% of a ${w}x${h} frame`);
      assert.ok(caption / h < 0.06, `caption at ramp 3 is ${(100 * caption / h).toFixed(1)}% of a ${w}x${h} frame`);
      // And the prompt clears the caption strap under it rather than stacking on it.
      const lane = px(plateFs, w, h);
      const gap = (69 + 1.5 * lane) - (46 + caption);
      assert.ok(gap >= 8, `prompt sits ${gap.toFixed(1)}px above the caption at ${w}x${h}`);
    }
  });

  // The HUD is authored at 1920x1080 and rides --hud-scale down. The tote is the largest element on screen, so a
  // size hard-coded in px there costs a 720p frame half again as much of its height as a 1080p one. This asserts
  // the seat plate and the tote hold the same fraction of the frame at both, which is what a re-hardcode breaks.
  test("the tote holds the same fraction of the frame at 720p and 1080p", () => {
    const find = (sel) => rules.find((r) => r.selectors.includes(sel));
    const scaleOf = (w, h) => {
      const m = decl(find(".hud").body, "--hud-scale")
        .match(/clamp\(\s*([\d.]+)\s*,\s*min\(\s*100vh\s*\/\s*(\d+)px\s*,\s*100vw\s*\/\s*(\d+)px\s*\)[^,]*,\s*([\d.]+)\s*\)/);
      assert.ok(m, "--hud-scale is a clamp(min, min(100vh/Hpx, 100vw/Wpx), max)");
      return Math.min(Math.max(Number(m[1]), Math.min(h / Number(m[2]), w / Number(m[3]))), Number(m[4]));
    };
    /** `calc(Npx * var(--hud-scale))`, or a bare px value, in real pixels. */
    const scaled = (value, scale) => {
      const m = value.match(/^calc\(\s*([\d.]+)px\s*\*\s*var\(--hud-scale\)\s*\)$/) ?? value.match(/^([\d.]+)px$/);
      assert.ok(m, `not a px length, scaled or plain: ${value}`);
      return Number(m[1]) * (value.startsWith("calc") ? scale : 1);
    };
    // --safe is 4vmin, and both frames here are landscape, so vmin is the height.
    const totePx = (value, w, h, scale) => {
      const m = value.match(/^min\(\s*([^,]+?)\s*,\s*calc\(100vw - 2 \* var\(--safe\)\)\s*\)$/);
      assert.ok(m, `tote width is not min(<authored>, calc(100vw - 2 * var(--safe))): ${value}`);
      return Math.min(scaled(m[1], scale), w - 2 * 0.04 * h);
    };
    const plateH = decl(find(".hud-seat").body, "--plate-h");
    const toteW = decl(find(".hud-tote").body, "width");
    const frac = [[1280, 720], [1920, 1080]].map(([w, h]) => {
      const scale = scaleOf(w, h);
      return { h: scaled(plateH, scale) / h, w: totePx(toteW, w, h, scale) / w };
    });
    assert.ok(Math.abs(frac[0].h - frac[1].h) < 0.002, `seat plate is ${(100 * frac[0].h).toFixed(1)}% of a 720p frame and ${(100 * frac[1].h).toFixed(1)}% of a 1080p one`);
    assert.ok(Math.abs(frac[0].w - frac[1].w) < 0.01, `tote is ${(100 * frac[0].w).toFixed(1)}% of a 720p frame and ${(100 * frac[1].w).toFixed(1)}% of a 1080p one`);
  });

  // STYLES.md 10, "Clipping text boxes": Barlow Condensed's italic caps draw a glyph box about 1.12 em
  // tall, so a single-line box that clips its own overflow shaves the baseline off at the plate's own
  // line height of 1. Anything that ellipsises has to buy the line that room, or be set in Chivo Mono,
  // whose .t-mono line height already clears it. A new clipping box that forgets fails here.
  test("every clipping text box gives its glyphs room for the baseline", () => {
    const MONO_CLIPPERS = new Set([".hud-policy-chip span.t-mono", ".gr__sheet-line", ".gr__sheet-h2h"]);
    const clippers = [];
    for (const r of rules) {
      if (!/text-overflow:\s*ellipsis/.test(r.body)) continue;
      for (const s of r.selectors) clippers.push(s);
    }
    assert.ok(clippers.length >= 6, `expected the known clipping boxes, found ${clippers.length}`);

    const lineHeight = new Map();
    for (const r of rules) {
      const m = r.body.match(/line-height:\s*([\d.]+)\s*[;}]/);
      if (!m) continue;
      for (const s of r.selectors) lineHeight.set(s, Number(m[1]));
    }
    assert.equal(lineHeight.get(".t-mono"), 1.3, ".t-mono no longer sets the line height the mono clippers rely on");

    for (const sel of clippers) {
      if (MONO_CLIPPERS.has(sel)) continue;
      const lh = lineHeight.get(sel);
      assert.notEqual(lh, undefined, `${sel} clips its own text but sets no line-height (STYLES.md 10)`);
      assert.ok(lh >= 1.2, `${sel} clips its own text at line-height ${lh}; italic caps need at least 1.2`);
    }
    // The exemption list may not outlive the rules it excuses.
    for (const sel of MONO_CLIPPERS) {
      assert.ok(clippers.includes(sel), `${sel} is exempted as a mono clipper but no longer clips`);
    }
  });
});
