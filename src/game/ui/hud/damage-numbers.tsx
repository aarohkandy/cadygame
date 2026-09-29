// src/game/ui/hud/damage-numbers.tsx (WP7)
// A pool of 16 world-anchored damage numbers (7.4.2). Barlow Condensed 800 italic in strike colour with an ink stroke,
// crit in crit colour with a CRIT tag, guarded smaller in ink-500, grazes as a tag only. hud-runtime merges hits on the
// same victim within 400 ms (1200 ms MERGED), positions nodes on the projected contact point, and restarts the pop.
import type { JSX } from "react";
import { DAMAGE_POOL_SIZE } from "./hud-runtime.ts";

export function DamageNumbers(): JSX.Element {
  return (
    <div className="hud-dmg-layer" aria-hidden="true">
      {Array.from({ length: DAMAGE_POOL_SIZE }, (_, i) => (
        <div key={i} className="hud-dmg" data-h={`dmg-${i}`} data-show="false">
          <div className="hud-dmg__inner">
            <span className="hud-dmg__num" data-h={`dmg-${i}-num`} />
            <span className="hud-dmg__tag t-label" data-h={`dmg-${i}-tag`} />
          </div>
        </div>
      ))}
    </div>
  );
}
