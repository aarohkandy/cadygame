// src/game/ui/hud/hold-skip-bar.tsx (WP7)
// Between rounds (2.2): the hint to tap or hold skip, and a thin ink bar that fills while Space, Enter, or pad A is held
// (400 ms skips the chain). Progress comes from UiState.holdSkipProgress in 0.05 steps.
"use client";

import type { JSX } from "react";
import type { GameHandle, MatchPhase } from "../../contracts.ts";
import { ActionGlyph } from "../kit/glyphs.tsx";
import { useUi } from "./hud.tsx";

const SKIPPABLE: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["ko", "lock", "time_up", "round_replay", "round_summary", "match_replay", "outro", "match_intro"]);

export function HoldSkipBar(props: { game: GameHandle }): JSX.Element | null {
  const phase = useUi(props.game, (s) => s.phase);
  const progress = useUi(props.game, (s) => s.holdSkipProgress);
  const screen = useUi(props.game, (s) => s.screen);
  if (!SKIPPABLE.has(phase) || screen !== "match") return null;
  const device = props.game.pilot.device;
  return (
    <div className="hud-holdskip">
      <span className="tl-hint t-plate">
        <ActionGlyph action="skip" device={device} /> SKIP
      </span>
      {phase !== "match_intro" ? (
        <span className="tl-hint t-plate">
          <ActionGlyph action="hold_skip" device={device} /> SKIP ROUNDS
        </span>
      ) : null}
      <span className="hud-holdskip__track" aria-hidden="true">
        <i className="hud-holdskip__fill" style={{ transform: `scaleX(${progress})` }} />
      </span>
    </div>
  );
}
