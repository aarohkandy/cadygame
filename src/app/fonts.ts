// src/app/fonts.ts (WP7)
// The three TORQUE LIMIT families (SCOPE 1.3, BUILD_PLAN D11), self-hosted at build by next/font/google and exposed
// as CSS variables that globals.css maps onto the type roles:
//   --font-anton    display and stamps (Anton has one weight; the slant is skewX(-10deg), never synthetic italic)
//   --font-barlow   HUD and menus (Barlow Condensed 500-900, real italics)
//   --font-chivo    numbers from physics and policies (Chivo Mono)
// WebGL SDF text (lobby tiles, deck, jumbotron) uses the same faces from public/fonts, written by
// scripts/sync-fonts.mjs from @fontsource.

import { Anton, Barlow_Condensed, Chivo_Mono } from "next/font/google";

export const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anton",
  fallback: ["Impact", "Arial Narrow", "sans-serif"],
});

export const barlowCondensed = Barlow_Condensed({
  weight: ["500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-barlow",
  fallback: ["Arial Narrow", "sans-serif"],
});

export const chivoMono = Chivo_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-chivo",
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

/** Class list for <html>: defines the three CSS variables. */
export const fontVariables = `${anton.variable} ${barlowCondensed.variable} ${chivoMono.variable}`;

/**
 * Every preloaded face, so layout.tsx can render a hidden warm-up line that uses each one during boot.
 * Without it the browser warns that preloaded fonts went unused while the loading screen is up.
 */
export const FONT_WARMUP: readonly { family: "anton" | "barlow" | "chivo"; weight: number; italic: boolean }[] = [
  { family: "anton", weight: 400, italic: false },
  ...[500, 600, 700, 800, 900].flatMap((weight) => [
    { family: "barlow" as const, weight, italic: false },
    { family: "barlow" as const, weight, italic: true },
  ]),
  { family: "chivo", weight: 400, italic: false },
  { family: "chivo", weight: 500, italic: false },
  { family: "chivo", weight: 700, italic: false },
];
