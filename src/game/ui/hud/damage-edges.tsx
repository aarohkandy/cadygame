// src/game/ui/hud/damage-edges.tsx (WP7)
// Full-screen directional edges for heavy hits taken (8.1): left, right, and top gradients in the attacker's team
// colour. Opacity and colour come from JuiceOutput.edge each frame (WP3 decays them). The same layer carries the two
// round-state frames: a breathing signal ring while your own integrity is low, and volt rules top and bottom in
// Sudden Death. Both are driven by data attributes on the HUD root, so they cost nothing per frame.
import type { JSX } from "react";

export function DamageEdges(): JSX.Element {
  return (
    <div className="hud-edges" data-h="edges" aria-hidden="true">
      <i className="hud-edge hud-edge--left" data-h="edge-left" />
      <i className="hud-edge hud-edge--right" data-h="edge-right" />
      <i className="hud-edge hud-edge--top" data-h="edge-top" />
      <i className="hud-state hud-state--low" />
      <i className="hud-state hud-state--sudden" />
    </div>
  );
}
