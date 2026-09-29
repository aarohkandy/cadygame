// src/game/ui/hud/turbo-plate.tsx (WP7)
// TURBO tells the renderer to stop drawing the arena so the sim runs as fast as the policies reply
// (GAME_DESIGN 4.10, 5.9). A canvas that has stopped drawing looks exactly like a hang, so the run says so
// itself: a plate over the frozen canvas naming the mode, what it stopped, and - the part a blinking lip
// cannot do - the match's own numbers moving. Round, clock and sim time are written straight to the DOM from
// the turbo pump's after-render slot, throttled to 10 Hz, so the plate commits nothing in React while a match
// that may be running thousands of sim steps a second proves it is alive.
"use client";

// This area’s own rules for the elements globals.css does not carry; Next dedupes the import.
import "./hud-extra.css";
import { useEffect, useRef, type JSX } from "react";
import type { GameHandle } from "../../contracts.ts";
import { turboLine } from "./format.ts";
import { useUi } from "./hud.tsx";

/** How often the proof-of-life numbers are written. Fast enough to read as moving, slow enough to cost nothing. */
export const TURBO_TICK_MS = 100;

/**
 * True while a turbo match owns the screen, which is exactly when the canvas stops drawing.
 * The director sets its config before it puts the match on screen, so the screen is the trigger.
 */
export function useTurboView(game: GameHandle): boolean {
  const screen = useUi(game, (s) => s.screen);
  const inMatch = screen === "match" || screen === "tutorial";
  return inMatch && game.director.config?.turbo === true;
}

export function TurboPlate(props: { game: GameHandle }): JSX.Element | null {
  const game = props.game;
  const turbo = useTurboView(game);
  const lineRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!turbo) return;
    const el = lineRef.current;
    if (!el) return;
    let last = -Infinity;
    let shown = "";
    const write = () => {
      const t = performance.now();
      if (t - last < TURBO_TICK_MS) return;
      last = t;
      const next = turboLine(game.hud.round, game.hud.timeLeftS, game.clock.simTime);
      if (next === shown) return;
      shown = next;
      el.textContent = next;
    };
    write();
    return game.onAfterRender(write);
  }, [game, turbo]);

  if (!turbo) return null;
  return (
    <div className="tl-turbo" role="status" aria-live="polite">
      <div className="tl-turbo__plate">
        <span className="tl-sticker tl-sticker--ink tl-turbo__tag">TURBO</span>
        <span className="t-display-l t-slant tl-turbo__word">VIEW PAUSED</span>
        <span className="t-label tl-turbo__line">THE ARENA IS NOT DRAWN WHILE THE MATCH RUNS AT FULL SPEED</span>
        {/* Ten writes a second: read once as part of the plate, then left alone by assistive tech. */}
        <span className="t-mono tl-turbo__clock" aria-hidden="true"><b>LIVE</b><span ref={lineRef} data-h="turbo-line" /></span>
        <span className="t-label tl-turbo__live"><i aria-hidden="true" />RUNNING</span>
      </div>
    </div>
  );
}
