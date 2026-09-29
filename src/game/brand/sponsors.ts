// src/game/brand/sponsors.ts (WP7)
// The show's two original sponsors (SCOPE 1.2) and the block-letter kit every TORQUE LIMIT mark is drawn with.
//
// OHMSTEAD   power-utility megacorp, "Keeping you grounded": a signal chevron arch over an earth-ground symbol.
// PULPO POP  eight-armed octopus soda: an ink bubble with a paper octopus and a signal fizz drop.
//
// Letterforms are drawn here as polygons on a 100-unit cap-height grid (square corners, 10-unit chamfers,
// 16-unit strokes), then slanted by the panel slant. The kit lives in this file rather than marks.ts so
// marks.ts can import it without an import cycle (marks.ts re-exports these marks). Every mark uses only
// TokenColor fills, so WP6 can rasterize them through Path2D and recolour them per surface.

import type { BrandMark } from "../contracts.ts";
import { SLANT_PANEL_DEG } from "./slant.ts";

/* ───────────────────────── block-letter kit ───────────────────────── */

type Pt = readonly [number, number];
interface Glyph { advance: number; polys: readonly (readonly Pt[])[] }

/** Clockwise outlines add ink; counter-clockwise outlines (counters) cut it under the nonzero rule. */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: { advance: 52, polys: [
    [[14, 0], [38, 0], [52, 100], [36, 100], [32.5, 76], [19.5, 76], [16, 100], [0, 100]],
    [[26, 28.6], [21.3, 62], [30.7, 62]],
  ] },
  D: { advance: 50, polys: [
    [[0, 0], [36, 0], [50, 14], [50, 86], [36, 100], [0, 100]],
    [[16, 16], [16, 84], [30, 84], [34, 80], [34, 20], [30, 16]],
  ] },
  E: { advance: 44, polys: [
    [[0, 0], [44, 0], [44, 16], [16, 16], [16, 42], [38, 42], [38, 58], [16, 58], [16, 84], [44, 84], [44, 100], [0, 100]],
  ] },
  H: { advance: 50, polys: [
    [[0, 0], [16, 0], [16, 42], [34, 42], [34, 0], [50, 0], [50, 100], [34, 100], [34, 58], [16, 58], [16, 100], [0, 100]],
  ] },
  I: { advance: 16, polys: [[[0, 0], [16, 0], [16, 100], [0, 100]]] },
  L: { advance: 42, polys: [[[0, 0], [16, 0], [16, 84], [42, 84], [42, 100], [0, 100]]] },
  M: { advance: 62, polys: [
    [[0, 0], [16, 0], [31, 38], [46, 0], [62, 0], [62, 100], [46, 100], [46, 40], [35, 66], [27, 66], [16, 40], [16, 100], [0, 100]],
  ] },
  O: { advance: 50, polys: [
    [[10, 0], [40, 0], [50, 10], [50, 90], [40, 100], [10, 100], [0, 90], [0, 10]],
    [[20, 16], [16, 20], [16, 80], [20, 84], [30, 84], [34, 80], [34, 20], [30, 16]],
  ] },
  P: { advance: 50, polys: [
    [[0, 0], [40, 0], [50, 10], [50, 52], [40, 62], [16, 62], [16, 100], [0, 100]],
    [[16, 16], [16, 46], [30, 46], [34, 42], [34, 20], [30, 16]],
  ] },
  Q: { advance: 54, polys: [
    [[10, 0], [40, 0], [50, 10], [50, 90], [40, 100], [10, 100], [0, 90], [0, 10]],
    [[20, 16], [16, 20], [16, 80], [20, 84], [30, 84], [34, 80], [34, 20], [30, 16]],
    [[30, 84], [44, 84], [58, 106], [44, 106]],
  ] },
  R: { advance: 52, polys: [
    [[0, 0], [40, 0], [50, 10], [50, 50], [40, 60], [0, 60]],
    [[16, 16], [16, 44], [30, 44], [34, 40], [34, 20], [30, 16]],
    [[0, 40], [16, 40], [16, 100], [0, 100]],
    [[24, 56], [40, 56], [52, 100], [36, 100]],
  ] },
  S: { advance: 48, polys: [
    [[8, 0], [48, 0], [48, 16], [16, 16], [16, 42], [40, 42], [48, 50], [48, 92], [40, 100], [0, 100], [0, 84], [32, 84], [32, 58], [8, 58], [0, 50], [0, 8]],
  ] },
  T: { advance: 50, polys: [[[0, 0], [50, 0], [50, 16], [33, 16], [33, 100], [17, 100], [17, 16], [0, 16]]] },
  U: { advance: 50, polys: [
    [[0, 0], [16, 0], [16, 84], [34, 84], [34, 0], [50, 0], [50, 90], [40, 100], [10, 100], [0, 90]],
  ] },
};

const SPACE_ADVANCE = 22;

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Closed polygon as path data. */
export function polygonD(points: readonly Pt[]): string {
  let d = "";
  for (let i = 0; i < points.length; i++) d += `${i === 0 ? "M" : "L"}${fmt(points[i][0])} ${fmt(points[i][1])} `;
  return `${d}Z`;
}

/** Full circle as two arcs. `ccw` draws it counter-clockwise (a counter under the nonzero rule). */
export function circleD(cx: number, cy: number, r: number, ccw = false): string {
  const sweep = ccw ? 0 : 1;
  return `M${fmt(cx - r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 ${sweep} ${fmt(cx + r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 ${sweep} ${fmt(cx - r)} ${fmt(cy)} Z`;
}

export interface SetTextOptions {
  /** Left edge of the first glyph's baseline corner. */
  x: number;
  /** Top of the cap height. */
  y: number;
  capHeight: number;
  /** Extra space between glyphs in grid units (100 = one cap height). */
  tracking?: number;
  slantDeg?: number;
}

export interface SetText { d: string; width: number }

/** Sets uppercase text in the block-letter kit, slanted like a panel. Unknown characters are skipped. */
export function setBlockText(text: string, opts: SetTextOptions): SetText {
  const s = opts.capHeight / 100;
  const k = Math.tan(((opts.slantDeg ?? SLANT_PANEL_DEG) * Math.PI) / 180);
  const tracking = opts.tracking ?? 8;
  let pen = 0;
  const parts: string[] = [];
  let glyphs = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === " ") { pen += SPACE_ADVANCE; continue; }
    const g = GLYPHS[ch];
    if (!g) continue;
    if (glyphs > 0) pen += tracking;
    for (const poly of g.polys) {
      parts.push(polygonD(poly.map(([gx, gy]) => [opts.x + (pen + gx) * s + (100 - gy) * s * k, opts.y + gy * s] as const)));
    }
    pen += g.advance;
    glyphs++;
  }
  return { d: parts.join(" "), width: pen * s + 100 * s * k };
}

/** Characters the kit can draw (used by brand-marks tests and WP6 SDF fallbacks). */
export const BLOCK_GLYPHS: readonly string[] = Object.keys(GLYPHS);

/* ───────────────────────── OHMSTEAD ───────────────────────── */

export const OHMSTEAD_NAME = "OHMSTEAD";
export const OHMSTEAD_TAGLINE = "Keeping you grounded";

const ohmsteadText = setBlockText(OHMSTEAD_NAME, { x: 60, y: 17, capHeight: 30, tracking: 9 });

export const OHMSTEAD_MARK: BrandMark = {
  viewBox: `0 0 ${Math.ceil(60 + ohmsteadText.width + 4)} 64`,
  paths: [
    // The arch: one signal chevron standing over the ground.
    { d: polygonD([[4, 31], [26, 5], [48, 31], [38, 31], [26, 17], [14, 31]]), fill: "signal" },
    // Earth-ground symbol: three bars stepping down.
    { d: polygonD([[2, 37], [50, 37], [50, 43], [2, 43]]), fill: "ink" },
    { d: polygonD([[11, 48], [41, 48], [41, 54], [11, 54]]), fill: "ink" },
    { d: polygonD([[20, 59], [32, 59], [32, 64], [20, 64]]), fill: "ink" },
    { d: ohmsteadText.d, fill: "ink" },
  ],
};

/* ───────────────────────── PULPO POP ───────────────────────── */

export const PULPO_POP_NAME = "PULPO POP";
export const PULPO_POP_TAGLINE = "Eight arms. One fizz.";

function tentacles(cx: number, cy: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((20 + (140 * i) / 7) * Math.PI) / 180;           // spread under the head, left to right
    const ux = -Math.cos(a), uy = Math.sin(a);                    // outward direction (screen y down)
    const px = -uy, py = ux;                                      // perpendicular
    const bx = cx + ux * 7, by = cy + uy * 7;
    const tx = cx + ux * 22, ty = cy + uy * 20;
    const curl = i % 2 === 0 ? 4 : -4;
    parts.push(
      `M${fmt(bx + px * 2.6)} ${fmt(by + py * 2.6)} ` +
      `Q${fmt((bx + tx) / 2 + px * (2.6 + curl))} ${fmt((by + ty) / 2 + py * (2.6 + curl))} ${fmt(tx)} ${fmt(ty)} ` +
      `Q${fmt((bx + tx) / 2 - px * (2.6 - curl))} ${fmt((by + ty) / 2 - py * (2.6 - curl))} ${fmt(bx - px * 2.6)} ${fmt(by - py * 2.6)} Z`,
    );
  }
  return parts.join(" ");
}

const pulpoText = setBlockText(PULPO_POP_NAME, { x: 72, y: 20, capHeight: 26, tracking: 9 });

export const PULPO_POP_MARK: BrandMark = {
  viewBox: `0 0 ${Math.ceil(72 + pulpoText.width + 4)} 64`,
  paths: [
    { d: circleD(32, 32, 31), fill: "ink" },
    { d: tentacles(32, 30), fill: "paper" },
    { d: circleD(32, 26, 13), fill: "paper" },
    { d: `${circleD(27, 25, 2.6)} ${circleD(37, 25, 2.6)}`, fill: "ink" },
    { d: circleD(50, 13, 4.5), fill: "signal" },
    { d: pulpoText.d, fill: "ink" },
  ],
};
