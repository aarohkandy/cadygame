// src/game/ui/hud/debug-overlay.tsx (WP7)
// ?debug=feel (7.4): frame timing, sim clock, hit stop and its budget, stance and look offsets, the last event
// magnitude, juice offsets, and audio latency. hud-runtime refreshes it four times a second.
import type { JSX } from "react";

export function DebugOverlay(): JSX.Element {
  return (
    <div className="hud-debug">
      <span className="t-label">DEBUG FEEL</span>
      <pre className="t-mono" data-h="debug-text" />
    </div>
  );
}
