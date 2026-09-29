// src/game/ui/screens/click-to-fight.tsx (WP7)
// Pointer lock lost mid-match (7.3.10). When pause is allowed the match waits behind a CLICK TO FIGHT plate. With a
// bridge seat the sim keeps running and the human seat is protected for up to 3 s: the plate shows the countdown bar,
// then the round is forfeited. A re-lock the browser rejects shows RE-ARMING while the pilot retries.
"use client";

import { useEffect, useSyncExternalStore, type JSX } from "react";
import type { GameHandle } from "../../contracts.ts";
import { useUi } from "../hud/hud.tsx";
import { Hazard } from "../kit/hazard.tsx";
import { useUiCue } from "../kit/slant-button.tsx";

const HOLD_MS = 3000;

function useRearming(game: GameHandle): boolean {
  return useSyncExternalStore(
    (fn) => { const id = window.setInterval(fn, 150); return () => window.clearInterval(id); },
    () => game.pilot.rearming,
    () => false,
  );
}

export function ClickToFight(props: { game: GameHandle; mode: "click_to_fight" | "hold_guard" }): JSX.Element {
  const game = props.game;
  const play = useUiCue();
  const remaining = useUi(game, (s) => s.lockHoldRemainingMs);
  const rearming = useRearming(game);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    document.documentElement.dataset.uiPaused = props.mode === "click_to_fight" ? "true" : "false";
    return () => { delete document.documentElement.dataset.uiPaused; };
  }, [props.mode]);

  function engage(): void {
    play("engage");
    if (coarse) { game.director.resume(); return; }
    // game-root forwards the resulting pointerlockchange to the director, which resumes or ends the hold.
    void game.pilot.requestLock();
  }

  const hold = props.mode === "hold_guard";
  const frac = hold && remaining !== null ? Math.min(1, Math.max(0, remaining / HOLD_MS)) : 0;

  return (
    <div className="ctf" data-mode={props.mode} onPointerDown={engage} role="button" tabIndex={0} aria-label="CLICK TO FIGHT"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); engage(); } }}>
      {hold ? null : <div className="tl-scrim ctf__scrim" />}
      <div className="ctf__plate tl-anim-slam">
        {hold ? <Hazard moving className="ctf__stripes" /> : null}
        <span className="t-display-l t-slant">{rearming ? "RE-ARMING" : coarse ? "TAP TO FIGHT" : "CLICK TO FIGHT"}</span>
        {hold ? (
          <>
            <span className="t-label">SEAT PROTECTED{remaining !== null ? ` · ${(remaining / 1000).toFixed(1)} S` : ""}</span>
            <span className="ctf__track"><i style={{ transform: `scaleX(${frac.toFixed(3)})` }} /></span>
          </>
        ) : <span className="t-label">THE MATCH IS PAUSED</span>}
      </div>
    </div>
  );
}
