#!/usr/bin/env node
// scripts/app-icons.mjs (WP-D, SCOPE 4.2)
// Generates the installable-app icon set from the show wordmark. The wordmark is original path data in
// src/game/brand/marks.ts, so the icons are drawn from the same geometry the title screen uses — there is no
// second copy of the mark to drift, and the palette is read out of globals.css rather than re-typed.
//
//   node scripts/app-icons.mjs [--out public/icons] [--no-raster]
//
// SVG is written by Node alone. The PNGs need a rasteriser: this uses a headless Chromium through Playwright
// when one is reachable (TL_PLAYWRIGHT / TL_CHROME point at an install outside the repo), and otherwise
// writes the SVGs, says so, and exits 0 — the committed PNGs stay as they are.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKS, SHOW_NAME } from "../src/game/brand/marks.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let outDir = "public/icons";
let raster = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" || args[i] === "-o") outDir = args[++i];
  else if (args[i] === "--no-raster") raster = false;
  else throw new Error(`app-icons: unknown argument ${args[i]}`);
}
const out = resolve(repo, outDir);
mkdirSync(out, { recursive: true });

/** Palette hexes straight from the stylesheet, so an icon can never disagree with the running game. */
function palette() {
  const css = readFileSync(resolve(repo, "src/app/globals.css"), "utf8");
  const wanted = ["ink", "paper", "signal", "volt", "cobalt", "magenta", "strike", "crit", "block"];
  const map = {};
  for (const token of wanted) {
    const hit = new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
    if (!hit) throw new Error(`app-icons: globals.css has no --${token} colour token`);
    map[token] = hit[1];
  }
  return map;
}

const COLORS = palette();
const SIZE = 512;

/**
 * One icon as an SVG document. `purpose: "maskable"` keeps every drawn pixel inside the 80% safe circle a
 * launcher may crop to; `"any"` uses the full square. The ground is signal orange with the wordmark's own ink
 * plate on top, which is the show's sticker lockup and the only composition that stays legible at 48 px.
 */
function iconSvg(purpose) {
  const mark = MARKS.torqueLimit;
  const [, , vw, vh] = mark.viewBox.split(/\s+/).map(Number);
  // Maskable: the block's diagonal must fit the safe circle (d = 0.8 × size). Any: plain side margin.
  const markWidth = purpose === "maskable"
    ? Math.floor((0.8 * SIZE * vw) / Math.hypot(vw, vh)) - 8
    : Math.floor(SIZE * 0.88);
  const scale = markWidth / vw;
  const markHeight = vh * scale;
  const tx = (SIZE - markWidth) / 2;
  const ty = (SIZE - markHeight) / 2;
  const paths = mark.paths
    .map((p) => `<path d="${p.d}" fill="${COLORS[p.fill]}"${p.stroke ? ` stroke="${COLORS[p.stroke]}" stroke-width="${p.strokeWidth ?? 1}"` : ""}/>`)
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${SHOW_NAME}">`,
    `<title>${SHOW_NAME}</title>`,
    `<rect width="${SIZE}" height="${SIZE}" fill="${COLORS.signal}"/>`,
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(6)})">${paths}</g>`,
    `</svg>`,
  ].join("");
}

const SVGS = [
  { name: "icon.svg", purpose: "any" },
  { name: "icon-maskable.svg", purpose: "maskable" },
];
for (const s of SVGS) writeFileSync(resolve(out, s.name), iconSvg(s.purpose) + "\n");

const PNGS = [
  { name: "icon-192.png", purpose: "any", size: 192 },
  { name: "icon-512.png", purpose: "any", size: 512 },
  // electron-builder renders the mac .icns from this one; 1024 is the largest slot in an icns.
  { name: "icon-1024.png", purpose: "any", size: 1024 },
  { name: "icon-maskable-192.png", purpose: "maskable", size: 192 },
  { name: "icon-maskable-512.png", purpose: "maskable", size: 512 },
  // iOS never applies a maskable safe zone; it crops to a superellipse, which the "any" margin already clears.
  { name: "apple-touch-icon.png", purpose: "any", size: 180 },
];

if (!raster) {
  console.log(`app-icons: wrote ${SVGS.length} SVGs to ${out} (--no-raster, PNGs untouched)`);
  process.exit(0);
}

let chromium = null;
try {
  ({ chromium } = await import(process.env.TL_PLAYWRIGHT || "playwright"));
} catch {
  console.log("app-icons: no Playwright reachable — wrote SVGs only, committed PNGs left as they are.");
  console.log("  to regenerate the PNGs, point TL_PLAYWRIGHT at a playwright install and TL_CHROME at its chrome binary");
  process.exit(0);
}

const browser = await chromium.launch({
  ...(process.env.TL_CHROME ? { executablePath: process.env.TL_CHROME } : {}),
  args: ["--mute-audio", "--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  for (const png of PNGS) {
    const page = await browser.newPage({ viewport: { width: png.size, height: png.size }, deviceScaleFactor: 1 });
    const svg = iconSvg(png.purpose).replace(`width="${SIZE}" height="${SIZE}"`, `width="${png.size}" height="${png.size}"`);
    await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`, { waitUntil: "load" });
    await page.screenshot({ path: resolve(out, png.name), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`app-icons: wrote ${SVGS.length} SVGs and ${PNGS.length} PNGs to ${out}`);
