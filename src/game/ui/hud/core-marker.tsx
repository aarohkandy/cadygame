// src/game/ui/hud/core-marker.tsx (WP7)
// World-anchored Core marker (7.4): an 18 px diamond in volt (owner team colour once owned), clamped to the screen edge
// with an arrow when off-screen, and at 60% opacity when the player's gripper is within 0.1 m.
import type { JSX } from "react";

export function CoreMarker(): JSX.Element {
  return (
    <div className="hud-core-marker" data-h="core-marker" data-show="false" data-owner="none" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="hud-core-marker__diamond"><path d="M12 1 23 12 12 23 1 12Z" /></svg>
      <span className="hud-core-marker__arrow" data-h="core-marker-arrow">
        <svg viewBox="0 0 12 12"><path d="M2 1 11 6 2 11Z" /></svg>
      </span>
    </div>
  );
}
