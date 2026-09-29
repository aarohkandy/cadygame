// src/game/ui/hud/stats-overlay.tsx (WP7)
// Hold STATS (Tab by default, rebindable in SETTINGS) mid-match: live physical numbers for both seats, counted from
// this match's events. Figures are Chivo Mono (machine truth); labels are Barlow caps. Refreshed by hud-runtime at
// 4 Hz while open, and never while the game is paused - the pause menu owns the keyboard there.
import type { JSX } from "react";
import type { Seat } from "../../contracts.ts";

const ROWS: readonly { field: string; label: string }[] = [
  { field: "damage", label: "DAMAGE" },
  { field: "strikes", label: "STRIKES" },
  { field: "crits", label: "CRITS" },
  { field: "guarded", label: "BLOCKED" },
  { field: "grazes", label: "GRAZES" },
  { field: "deflects", label: "DEFLECTS" },
  { field: "steals", label: "STEALS" },
  { field: "staggers", label: "STAGGERS" },
  { field: "fastest", label: "TOP SPEED" },
  { field: "hardest", label: "HARDEST HIT" },
  { field: "heat", label: "HEAT" },
  { field: "faults", label: "FAULTS" },
];

const SEAT_ORDER: readonly Seat[] = ["atlas", "blaze"];

export function StatsOverlay(): JSX.Element {
  return (
    <div className="hud-stats" data-h="stats" data-show="false">
      <div className="hud-stats__head">
        <span className="t-label hud-stats__title">MATCH STATS</span>
        {SEAT_ORDER.map((s) => <span key={s} className={`t-plate hud-stats__name hud-stats__name--${s}`} data-h={`stats-${s}-name`} />)}
      </div>
      {ROWS.map((r) => (
        <div key={r.field} className="hud-stats__row">
          <span className="t-label">{r.label}</span>
          {SEAT_ORDER.map((s) => <span key={s} className="t-mono hud-stats__cell" data-h={`stats-${s}-${r.field}`} />)}
        </div>
      ))}
    </div>
  );
}
