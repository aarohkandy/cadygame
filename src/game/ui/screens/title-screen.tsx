// src/game/ui/screens/title-screen.tsx (WP6)
// The first 60 seconds start here (EMOTION_BIBLE 2): the arena shell and the silent attract match play under the
// wordmark; the CTA slot reads `LOADING 43 %` in mono until the boot finishes, then slams to `CLICK TO FIGHT`.
// The click is t₀: audio unlocks (the relay clack is WP8's, on this gesture), pointer lock is requested, and the
// match starts. No lobby, no cockpit prompt, no settings, no dataset line. Match 1 for a fresh profile, today's
// bout after that. Esc, `L` and `S` reach the green room, entrants and settings for the people who want them.
"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import type { GameHandle } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { nextMatchConfig } from "../../match/match-config.ts";
import { useUi } from "../hud/hud.tsx";
import { sharedProfile } from "../meta/profile.ts";
import { randomSeed } from "./green-room.tsx";

const SHOW_LINE = "REAL PHYSICS · REAL ROBOT ARMS · IN YOUR BROWSER";

/** The CTA copy for a boot state: mono percentage while loading, the slam once ready. */
export function ctaLabel(loading: { progress: number } | null, coarse: boolean): string {
  if (loading) return `LOADING ${Math.round(Math.min(1, Math.max(0, loading.progress)) * 100)} %`;
  return coarse ? "TAP TO FIGHT" : "CLICK TO FIGHT";
}

export function TitleScreen(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const loading = useUi(game, (s) => s.loading);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const ready = loading === null;

  useEffect(() => {
    if (!ready) return;
    const fight = () => {
      if (done.current) return;
      done.current = true;
      setArmed(true);
      void game.feedback.audio.unlock();
      if (!coarse) void game.pilot.requestLock();
      const cfg = nextMatchConfig(randomSeed(), game.settings.get(), sharedProfile().totals(), new Date());
      game.director.startMatch(cfg).catch((err: unknown) => {
        done.current = false;
        setArmed(false);
        setError(err instanceof Error ? err.message.toUpperCase() : "COULD NOT START");
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") { game.director.enterGreenRoom(); return; }
      if (e.key === "l" || e.key === "L") { game.director.enterGreenRoom(); game.ui.set({ screen: "entrants" }); return; }
      if (e.key === "s" || e.key === "S") { game.director.enterGreenRoom(); game.ui.set({ screen: "settings" }); return; }
      if (e.key === "Enter" || e.key === " ") fight();
    };
    const onDown = (e: PointerEvent) => { if (e.button === 0 || e.pointerType !== "mouse") fight(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [game, ready, coarse]);

  return (
    <div className="title" role="dialog" aria-label="TORQUE LIMIT">
      <div className="title__lockup">
        <span className="inline-block tl-anim-stamp" style={{ animationDelay: "300ms" }}>
          <Wordmark className="title__mark" />
        </span>
        <p className="title__tagline t-label tl-anim-fade" style={{ animationDelay: "700ms" }}>{SHOW_LINE}</p>
      </div>
      <div className="grid justify-items-center">
        <div
          key={ready ? "ready" : "loading"}
          className={`tl-plate ${ready ? "tl-plate--paper tl-anim-slam" : "tl-plate--ink"} title__prompt ${ready ? "t-plate" : "t-mono"}`}
          data-armed={armed ? "true" : "false"}
          aria-live="polite"
        >
          {ctaLabel(loading, coarse)}
        </div>
        {error ? <p className="t-label" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
        {/* A phone has no Esc key, so naming one is worse than saying nothing. Touch players reach the green
            room from the pause menu once a match is live (the PAUSE plate in the touch layer). */}
        {coarse ? null : (
          <div className="title__foot" aria-hidden="true">
            <span className="t-label">ESC · GREEN ROOM</span>
          </div>
        )}
      </div>
    </div>
  );
}
