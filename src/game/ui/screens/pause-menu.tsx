// src/game/ui/screens/pause-menu.tsx (WP6)
// Pause (7.3.10, EMOTION_BIBLE 3.4/3.5): the canvas freezes at 70% grayscale (a filter on the canvas, never
// backdrop-filter) under a hard 80% ink scrim, with RESUME · STABLE CAMERA (the mount toggle, 3.5) · SETTINGS ·
// FORFEIT ROUND · QUIT TO LOBBY, and the control map. The sim clock is already stopped by the director;
// resuming re-arms pointer lock from the click.
"use client";

import { useEffect, useState, type JSX } from "react";
import type { GameHandle } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { useUi } from "../hud/hud.tsx";
import { ActionGlyph } from "../kit/glyphs.tsx";
import { SlantButton } from "../kit/slant-button.tsx";
import { CockpitToggle } from "./cockpit-choice.tsx";
import { SettingsScreen } from "./settings-screen.tsx";

/** The control map on the pause plate (2: the control map lives here, never as in-match captions). */
export const CONTROL_MAP: readonly (readonly [string, string])[] = [
  ["MOUSE", "AIM · FLICK"], ["LMB", "JAB · HOLD TO CHARGE"], ["RMB", "GUARD"], ["W / S", "REACH"], ["SPACE", "GRIP"], ["Q / E", "ROLL"],
];

export function resumeMatch(game: GameHandle): void {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  game.director.resume();
  if (!coarse) void game.pilot.requestLock();
}

export function PauseMenu(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const match = useUi(game, (s) => s.match);
  const [view, setView] = useState<"menu" | "settings" | "camera" | "confirm_forfeit" | "confirm_quit">("menu");

  useEffect(() => {
    document.documentElement.dataset.uiPaused = "true";
    return () => { delete document.documentElement.dataset.uiPaused; };
  }, []);

  if (view === "settings") {
    return (
      <div className="pause pause--settings">
        <div className="tl-scrim" />
        <SettingsScreen game={game} embedded onBack={() => setView("menu")} />
      </div>
    );
  }

  const human = match ? match.seats.atlas.driver.kind === "human" || match.seats.blaze.driver.kind === "human" : false;

  if (view === "camera") {
    return (
      <div className="pause" role="dialog" aria-modal="true" aria-label="CAMERA">
        <div className="tl-scrim" />
        <div className="pause__inner">
          <span className="t-display-l t-slant pause__title">CAMERA</span>
          <CockpitToggle game={game} onChange={() => setView("menu")} />
          <nav className="pause__stack" aria-label="CAMERA">
            <SlantButton label="BACK" block cue="back" onClick={() => setView("menu")} />
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="pause" role="dialog" aria-modal="true" aria-label="PAUSED">
      <div className="tl-scrim" />
      <div className="pause__inner">
        <Wordmark className="pause__mark" />
        <span className="t-display-l t-slant pause__title">PAUSED</span>
        <nav className="pause__stack" aria-label="PAUSE">
          {view === "confirm_forfeit" ? (
            <>
              <span className="t-label pause__ask">GIVE UP THIS ROUND</span>
              <SlantButton label="FORFEIT" variant="primary" block autoFocus cue="back" onClick={() => { game.director.forfeitRound(); resumeMatch(game); }} />
              <SlantButton label="KEEP FIGHTING" block onClick={() => setView("menu")} />
            </>
          ) : view === "confirm_quit" ? (
            <>
              <span className="t-label pause__ask">LEAVE THE MATCH</span>
              <SlantButton label="QUIT" variant="primary" block autoFocus cue="back" onClick={() => game.director.quitToGreenRoom()} />
              <SlantButton label="KEEP FIGHTING" block onClick={() => setView("menu")} />
            </>
          ) : (
            <>
              <SlantButton label="RESUME" variant="primary" block autoFocus onClick={() => resumeMatch(game)} />
              <SlantButton label="STABLE CAMERA" block onClick={() => setView("camera")} />
              <SlantButton label="SETTINGS" block onClick={() => setView("settings")} />
              {human ? <SlantButton label="FORFEIT ROUND" block onClick={() => setView("confirm_forfeit")} /> : null}
              <SlantButton label="QUIT TO LOBBY" block cue="back" onClick={() => setView("confirm_quit")} />
              <dl className="tl-hintbar pause__hints" aria-label="CONTROLS">
                {CONTROL_MAP.map(([k, v]) => <span key={k} className="tl-hint t-label">{k} · {v}</span>)}
              </dl>
            </>
          )}
        </nav>
        <div className="tl-hintbar pause__hints">
          <span className="tl-hint t-label"><ActionGlyph action="confirm" device={game.pilot.device} /> SELECT</span>
          <span className="tl-hint t-label"><ActionGlyph action="back" device={game.pilot.device} /> RESUME</span>
        </div>
      </div>
    </div>
  );
}
