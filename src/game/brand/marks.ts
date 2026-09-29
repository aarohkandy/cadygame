// src/game/brand/marks.ts (WP7)
// Every TORQUE LIMIT brand mark as original SVG path data (BUILD_PLAN 3, 4 WP7.8). WP6 rasterizes these through
// Path2D for the deck, sponsor boards, jumbotron frame, and confetti decals; wordmark.tsx renders them in DOM.
//
// torqueLimit  the show wordmark: TORQUE in paper and LIMIT in signal, knocked out of an ink plate cut at the
//              12° panel slant. The crossbar of the final T is a gauge needle pinned at the top of its stem,
//              rotated to the slant and pointing at a small tick: the servo at its torque limit.
// needle       the standalone gauge: a half dial with a signal redline and the needle pinned against it.
// ohmstead, pulpoPop, bit  re-exported from sponsors.ts and mascot.ts.

import type { BrandMark, BrandMarkId } from "../contracts.ts";
import { BIT_MARK } from "./mascot.ts";
import { SLANT_PANEL_DEG, SLANT_PANEL_K } from "./slant.ts";
import { OHMSTEAD_MARK, PULPO_POP_MARK, circleD, polygonD, setBlockText } from "./sponsors.ts";

export const SHOW_NAME = "TORQUE LIMIT";
export const SHOW_TAGLINE = "Live from the benchtop.";

/* ───────────────────────── wordmark ───────────────────────── */

const WM_H = 128;
const WM_CAP = 72;
const WM_TOP = 28;
const WM_X = 36;
const WM_S = WM_CAP / 100;
const WORD_GAP = 30 * WM_S;

type Pt = readonly [number, number];

function buildWordmark(): { mark: BrandMark; lockup: WordmarkLockup } {
  const torque = setBlockText("TORQUE", { x: WM_X, y: WM_TOP, capHeight: WM_CAP });
  const overhang = 100 * WM_S * SLANT_PANEL_K;
  const limiX = WM_X + torque.width - overhang + WORD_GAP;
  const limi = setBlockText("LIMI", { x: limiX, y: WM_TOP, capHeight: WM_CAP });
  const tX = limiX + limi.width - overhang + 8 * WM_S;

  // Grid → mark space for the final T (same transform as the kit).
  const tf = (gx: number, gy: number): Pt => [tX + gx * WM_S + (100 - gy) * WM_S * SLANT_PANEL_K, WM_TOP + gy * WM_S];
  const stem = polygonD([tf(17, 16), tf(33, 16), tf(33, 100), tf(17, 100)]);

  // The needle crossbar, rotated up by the panel slant around the top of the stem.
  const a = (-SLANT_PANEL_DEG * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const px = 25, py = 10;
  const at = (along: number, across: number): Pt => tf(px + dx * along + nx * across, py + dy * along + ny * across);
  const needle = polygonD([at(-24, 6), at(0, 10), at(46, 1.8), at(46, -1.8), at(0, -10), at(-24, -6)]);
  const tick = polygonD([at(52, -11), at(59, -11), at(59, 11), at(52, 11)]);
  const [hx, hy] = tf(px, py);

  const right = tX + 64 * WM_S + 100 * WM_S * SLANT_PANEL_K + 22;
  const width = Math.ceil(right + 12);
  const cut = WM_H * SLANT_PANEL_K;
  const plate = polygonD([[cut, 0], [width, 0], [width - cut, WM_H], [0, WM_H]]);

  return {
    mark: {
      viewBox: `0 0 ${width} ${WM_H}`,
      paths: [
        { d: plate, fill: "ink" },
        { d: torque.d, fill: "paper" },
        { d: `${limi.d} ${stem}`, fill: "signal" },
        { d: tick, fill: "signal" },
        { d: needle, fill: "paper" },
        { d: circleD(hx, hy, 7), fill: "paper" },
        { d: circleD(hx, hy, 3), fill: "ink" },
      ],
    },
    lockup: { width, height: WM_H, plateIndex: 0 },
  };
}

/** Geometry facts about the wordmark for layout (the plate is paths[plateIndex]). */
export interface WordmarkLockup { width: number; height: number; plateIndex: number }

const wordmark = buildWordmark();
export const WORDMARK_LOCKUP: WordmarkLockup = wordmark.lockup;

/* ───────────────────────── needle gauge ───────────────────────── */

function annulus(cx: number, cy: number, r0: number, r1: number, fromDeg: number, toDeg: number, steps: number): string {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push([cx + r1 * Math.cos(t), cy + r1 * Math.sin(t)]);
  }
  for (let i = steps; i >= 0; i--) {
    const t = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push([cx + r0 * Math.cos(t), cy + r0 * Math.sin(t)]);
  }
  return polygonD(pts);
}

function buildNeedle(): BrandMark {
  const cx = 32, cy = 42;
  const ticks: string[] = [];
  for (let i = 0; i < 7; i++) {
    const deg = 192 + (i * 108) / 6;
    const t = (deg * Math.PI) / 180;
    const ux = Math.cos(t), uy = Math.sin(t), vx = -uy, vy = ux;
    const r0 = 22.5, r1 = 27.5, w = 1.1;
    ticks.push(polygonD([
      [cx + ux * r0 + vx * w, cy + uy * r0 + vy * w], [cx + ux * r1 + vx * w, cy + uy * r1 + vy * w],
      [cx + ux * r1 - vx * w, cy + uy * r1 - vy * w], [cx + ux * r0 - vx * w, cy + uy * r0 - vy * w],
    ]));
  }
  const na = ((360 - SLANT_PANEL_DEG) * Math.PI) / 180;
  const dx = Math.cos(na), dy = Math.sin(na), nx = -dy, ny = dx;
  const at = (along: number, across: number): Pt => [cx + dx * along + nx * across, cy + dy * along + ny * across];
  return {
    viewBox: "0 0 64 64",
    paths: [
      { d: annulus(cx, cy, 20, 30, 180, 312, 24), fill: "ink" },
      { d: annulus(cx, cy, 20, 30, 314, 360, 10), fill: "signal" },
      { d: ticks.join(" "), fill: "paper" },
      { d: polygonD([at(-7, 2.6), at(0, 4.2), at(27, 0.8), at(27, -0.8), at(0, -4.2), at(-7, -2.6)]), fill: "signal" },
      { d: circleD(cx, cy, 5.5), fill: "ink" },
      { d: circleD(cx, cy, 2), fill: "paper" },
      { d: polygonD([[0, 48], [64, 48], [64, 54], [0, 54]]), fill: "ink" },
    ],
  };
}

/* ───────────────────────── registry ───────────────────────── */

export const MARKS: Readonly<Record<BrandMarkId, BrandMark>> = {
  torqueLimit: wordmark.mark,
  needle: buildNeedle(),
  ohmstead: OHMSTEAD_MARK,
  pulpoPop: PULPO_POP_MARK,
  bit: BIT_MARK,
};

export const BRAND_MARK_IDS: readonly BrandMarkId[] = ["torqueLimit", "needle", "ohmstead", "pulpoPop", "bit"];

/** Parses a mark's viewBox into numbers. */
export function markSize(id: BrandMarkId): { x: number; y: number; width: number; height: number } {
  const [x, y, width, height] = MARKS[id].viewBox.split(/\s+/).map(Number);
  return { x, y, width, height };
}
