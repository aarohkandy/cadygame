// WP7: copy rules for the broadcast UI (GAME_DESIGN 1.4.5, 6.3; BUILD_PLAN 4 WP7.1): every label, button, tab, toggle,
// sticker and hint is caps and at most three words; no Unicode symbol glyphs anywhere in rendered strings (icons are SVG).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listFiles() {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.tsx?$/.test(n)) out.push(f); } };
  walk(path.join(root, "src/game/ui"));
  // The Bout Card (EMOTION_BIBLE 8.3) is clipboard text, not rendered UI: its round squares are the one symbol allowed.
  const bout = path.join(root, "src/game/ui/meta/superlatives.ts");
  const i = out.indexOf(bout);
  if (i >= 0) out.splice(i, 1);
  walk(path.join(root, "src/game/brand"));
  out.push(path.join(root, "src/app/layout.tsx"));
  return out;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

const WORD_SEPARATORS = new Set(["·", "|", "/", "-", "–"]);
function words(s) {
  return s.trim().split(/\s+/).filter((w) => w.length > 0 && !WORD_SEPARATORS.has(w));
}

/** Symbol blocks that must never be typed into UI copy (arrows, math, technical, shapes, dingbats, emoji). */
const SYMBOLS = /[×•←-⏿①-➿⤀-⯿\u{1F000}-\u{1FAFF}]/u;

const files = listFiles();
const sources = files.map((f) => ({ rel: path.relative(root, f), text: stripComments(readFileSync(f, "utf8")) }));

describe("copy labels", () => {
  test("scans the whole broadcast UI", () => {
    assert.ok(files.length >= 50, `found ${files.length} files`);
  });

  test("label props and option labels are caps and at most three words", () => {
    let n = 0;
    for (const { rel, text } of sources) {
      for (const m of text.matchAll(/\blabel(?:=|:\s*)"([^"]*)"/g)) {
        const s = m[1];
        n++;
        assert.equal(s, s.toUpperCase(), `${rel}: "${s}" is not caps`);
        assert.ok(words(s).length <= 3, `${rel}: "${s}" is longer than three words`);
      }
    }
    assert.ok(n >= 120, `checked ${n} labels`);
  });

  test("label, sticker, tab and hint text in JSX is caps; hints and stickers are at most three words", () => {
    let n = 0;
    for (const { rel, text } of sources) {
      for (const m of text.matchAll(/className="([^"]*)"[^>]*>([^<{}]+)</g)) {
        const cls = m[1];
        const body = m[2].trim();
        if (!body || !/(^|\s)(t-label|t-plate|tl-sticker|tl-hint|t-display-l|t-display-xl|tl-tab)(\s|$)/.test(cls)) continue;
        n++;
        assert.equal(body, body.toUpperCase(), `${rel}: "${body}" is not caps`);
        if (/(^|\s)(tl-sticker|tl-hint)(\s|$)/.test(cls)) assert.ok(words(body).length <= 3, `${rel}: "${body}" is longer than three words`);
      }
    }
    assert.ok(n >= 40, `checked ${n} text nodes`);
  });

  test("screen menu labels are caps and short", () => {
    const green = sources.find((s) => s.rel.endsWith("green-room.tsx")).text;
    const block = green.match(/MENU_LABEL[^=]*=\s*\{([\s\S]*?)\};/)[1];
    for (const m of block.matchAll(/"([^"]+)"/g)) {
      assert.equal(m[1], m[1].toUpperCase());
      assert.ok(words(m[1]).length <= 3, m[1]);
    }
  });

  test("boot tips are one caps line", () => {
    const boot = sources.find((s) => s.rel.endsWith("boot-screen.tsx")).text;
    const tips = [...boot.match(/BOOT_TIPS[^=]*=\s*\[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(tips.length >= 6);
    for (const t of tips) {
      assert.equal(t, t.toUpperCase());
      assert.ok(t.length <= 48, `tip fits one line: ${t}`);
      assert.equal(t.includes("!"), false);
    }
  });

  test("no Unicode symbol glyphs and no exclamation marks in UI strings", () => {
    for (const { rel, text } of sources) {
      // The once-ever STABLE camera hint is written with an arrow by the bible (8.2): `ESC → STABLE CAMERA`.
      const hit = text.replace(/ESC → STABLE/g, "ESC TO STABLE").match(SYMBOLS);
      assert.equal(hit, null, `${rel} contains a symbol glyph ${hit ? JSON.stringify(hit[0]) : ""}`);
      for (const m of text.matchAll(/"([^"\n]*)"/g)) {
        if (/^[A-Z0-9 .·,'%–-]+!/.test(m[1])) assert.fail(`${rel}: "${m[1]}" shouts`);
      }
    }
  });
});
