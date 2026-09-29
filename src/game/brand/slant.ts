// src/game/brand/slant.ts (WP7)
// The fixed angles of the TORQUE LIMIT shape language (SCOPE 1.3, BUILD_PLAN D11). There is no measurement
// script: these are decisions. globals.css mirrors them as --slant-panel, --slant-k, --slant-stamp and
// --sticker-tilt, and tests/styles-tokens.test.mjs fails if the two ever disagree. WP6 imports these for the
// deck border, sponsor boards, and jumbotron frame so world graphics and DOM graphics share one slant.

/** Panel slant in degrees (angled plates, wipes, deck hazard border). */
export const SLANT_PANEL_DEG = 12;
/** Anton stamp slant in degrees, rendered as skewX(-SLANT_STAMP_DEG). */
export const SLANT_STAMP_DEG = 10;
/** Sticker tilt in degrees. */
export const STICKER_TILT_DEG = -4;
/** Hazard stripe angle in degrees (danger, contested, fault). */
export const HAZARD_STRIPE_DEG = -45;

/** tan(12°): the horizontal cut of a plate is its height times this. */
export const SLANT_PANEL_K = Math.tan((SLANT_PANEL_DEG * Math.PI) / 180);

/** Horizontal offset of a slanted edge for a plate of height h (px or metres). */
export function slantCut(height: number): number {
  return height * SLANT_PANEL_K;
}
