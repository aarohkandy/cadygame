// WP7: IP guard (SCOPE 1.1, BUILD_PLAN 4 WP7.8). The reference game's name, studio, typefaces, sponsors, hosts, mascot,
// catchphrases and arena names must never appear in shipped source, public assets, STYLES.md or README.md.
// The research notes under docs/ name them on purpose and are not scanned.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Case-insensitive patterns: distinctive names that are never ordinary words. */
const DISTINCTIVE = [
  /the[\s_-]*finals/i, /\bembark\s+studios?\b/i, /\bsaira\b/i, /\bdharma\s+gothic\b/i,
  /\bospuze\b/i, /\biseul-?t\b/i, /\bholtow\b/i, /\bvaiiya\b/i, /\bengimo\b/i, /\bdissun\b/i, /\balfa\s+acta\b/i,
  /\bmultico\b/i, /\bivada\b/i, /\btrentila\b/i, /\bnama\s+tama\b/i, /sys\$horizon/i, /\bskyway\s+stadium\b/i,
  /\bfortune\s+stadium\b/i, /\breachthefinals\b/i,
];
/** Case-sensitive patterns: names that are also ordinary words, flagged only in their proper-noun or brand form. */
const PROPER = [/\bEmbark\b/, /\bVOLPE\b/, /\bVolpe\b/, /\bCOMETA\b/, /\bScotty\b/, /\bJune\b/, /\bBernal\b/, /\bMonaco\b/, /\bSeoul\b/, /\bKyoto\b/, /\bLas Vegas\b/];

const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".md", ".svg", ".txt", ".html", ".xml", ".py", ".webmanifest"]);
/** Vendored or generated files that are not ours to author (the MuJoCo Emscripten runtime). */
const SKIP = new Set(["public/mujoco.js"]);

function collect(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (TEXT_EXT.has(path.extname(name).toLowerCase()) && !SKIP.has(path.relative(root, full)) && st.size < 8 * 1024 * 1024) out.push(full);
  }
  return out;
}

describe("ip guard", () => {
  const files = [
    ...collect(path.join(root, "src"), []),
    ...collect(path.join(root, "public"), []),
    ...["STYLES.md", "README.md"].map((f) => path.join(root, f)).filter((f) => existsSync(f)),
  ];

  test("scans source, public assets, STYLES.md and README.md", () => {
    assert.ok(files.length > 50, `found ${files.length} files`);
    assert.ok(files.some((f) => f.endsWith("STYLES.md")), "STYLES.md exists and is scanned");
    assert.ok(files.some((f) => f.endsWith("globals.css")));
  });

  test("no reference-game names, marks, typefaces, sponsors, hosts, or arenas", () => {
    const hits = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of [...DISTINCTIVE, ...PROPER]) {
        const m = text.match(re);
        if (m) {
          const line = text.slice(0, m.index).split("\n").length;
          hits.push(`${path.relative(root, f)}:${line} ${JSON.stringify(m[0])}`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });

  test("the guard itself catches a planted name", () => {
    const planted = "const sponsor = 'OSPUZE'; // Saira Condensed";
    assert.ok(DISTINCTIVE.some((re) => re.test(planted)));
    assert.equal(DISTINCTIVE.some((re) => re.test("TORQUE LIMIT · OHMSTEAD · PULPO POP · ROOK · DR. VALE")), false);
  });
});
