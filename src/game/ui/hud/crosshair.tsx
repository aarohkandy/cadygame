// src/game/ui/hud/crosshair.tsx (WP7)
// The crosshair node (EMOTION_BIBLE 2, 8.1): one element for the range ring and the receipt. hud-runtime anchors it on
// the projected ghost tip every frame, writes the ring's fill from ReticleState (--fill, data-inrange) and prints the
// receipt of every contact under it for 700 ms: `SOLID 1.4 m/s` (word band for the first ten receipts of a profile),
// `BLOCKED` alone for a guard, and once a PB exists the `+0.3` delta in volt. WP3's WebGL reticle draws the aim
// brackets; this node is the range and the receipt, so the number lands where the contact was aimed.
import type { JSX } from "react";

/** Ring radius in reference px; the dasharray fill is written by hud-runtime as --fill (0..1). */
export const RING_R = 22;
export const RING_C = Math.round(2 * Math.PI * RING_R * 100) / 100;

export function Crosshair(): JSX.Element {
  return (
    <div className="hud-xh" data-h="receipt" data-show="false" data-receipt="false" data-inrange="false" data-band="soft" aria-live="off">
      <svg viewBox="0 0 60 60" className="hud-xh__ring" aria-hidden="true">
        <circle cx="30" cy="30" r={RING_R} className="hud-xh__track" />
        <circle cx="30" cy="30" r={RING_R} className="hud-xh__fill" style={{ strokeDasharray: RING_C }} />
      </svg>
      <span className="hud-xh__receipt">
        <span className="hud-xh__text t-plate" data-h="receipt-text" />
        <span className="hud-xh__pb t-plate" data-h="receipt-pb" data-empty="true" />
      </span>
    </div>
  );
}
