// src/game/ui/hud/kit-panel.tsx (WP7)
// Bottom right, one thin line (7.4): ability with charges and a cooldown sweep, HEAT once the arm is warm, OVERDRIVE
// while held, and the grip. The strip is contextual: hud-runtime raises it for a moment whenever one of those values
// changes and keeps it up while a live state (hot arm, overdrive, active ability) needs watching; an idle fight shows
// nothing here. Ability and Overdrive cells stay hidden before the kit unlocks (match 3). The loadout lives in the
// green room.
import type { JSX } from "react";

export function KitPanel(): JSX.Element {
  return (
    <div className="hud-kit" data-h="kit" data-up="false" data-showkit="false">
      <span className="hud-kit__cell hud-kit__cell--ability" data-h="kit-ability-row">
        <span className="t-label" data-h="kit-ability" />
        <span className="hud-kit__cooldown" data-h="kit-cooldown"><i /></span>
        <span className="t-mono hud-kit__charges" data-h="kit-charges" />
      </span>
      <span className="hud-kit__cell hud-kit__cell--heat" data-h="kit-heat-row" data-state="cool">
        <span className="t-label">HEAT</span>
        <span className="hud-kit__heat" data-h="kit-heat"><i /></span>
        <span className="t-mono hud-kit__heat-value" data-h="kit-heat-value" />
      </span>
      <span className="hud-kit__cell hud-kit__cell--overdrive t-label" data-h="kit-overdrive" data-on="false">OVERDRIVE</span>
      <span className="hud-kit__cell" data-h="kit-grip-row" data-closed="false">
        <span className="t-label">GRIP</span>
        <span className="t-label hud-kit__grip" data-h="kit-grip" />
      </span>
    </div>
  );
}
