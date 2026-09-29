// src/game/ui/hud/hud.tsx (WP7)
// The in-match HUD (EMOTION_BIBLE 2): six elements until match 2 (crosshair with its receipt, opponent plate, own bar
// that slides in on the first damage taken, Core marker, one caption, wordmark bottom-left); the timer, round pips,
// tags, heat and kit strip are mounted but gated by data attributes hud-runtime writes from the showKit table. The
// tree mounts once per match layout; hud-runtime writes every live value, so a fight commits nothing in React.
// Phase-level overlays (match intro, Best Score strip, replay letterbox, hold-to-skip) subscribe to their own UiState
// slices and only render when their phase comes up. Also exports the small store hooks every screen uses.
"use client";

// This area’s own rules for the elements globals.css does not carry; Next dedupes the import.
import "./hud-extra.css";
import { useEffect, useMemo, useRef, useSyncExternalStore, type JSX } from "react";
import type { GameHandle, Settings, UiState } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { BestScoreStrip } from "./best-score-strip.tsx";
import { Banners } from "./banners.tsx";
import { Captions } from "./captions.tsx";
import { CoreMarker } from "./core-marker.tsx";
import { Crosshair } from "./crosshair.tsx";
import { DamageEdges } from "./damage-edges.tsx";
import { DamageNumbers } from "./damage-numbers.tsx";
import { DebugOverlay } from "./debug-overlay.tsx";
import { EventFeed } from "./event-feed.tsx";
import { HoldSkipBar } from "./hold-skip-bar.tsx";
import { createHudRuntime } from "./hud-runtime.ts";
import { KitPanel } from "./kit-panel.tsx";
import { MatchIntro } from "./match-intro.tsx";
import { ReplayOverlay } from "./replay-overlay.tsx";
import { StatsOverlay } from "./stats-overlay.tsx";
import { ToteBoard } from "./tote-board.tsx";

/* ───────────────────────── store hooks ───────────────────────── */

/** Subscribes to one UiState field (or any stable derived value). Re-renders only when it changes. */
export function useUi<T>(game: GameHandle, select: (s: Readonly<UiState>) => T): T {
  return useSyncExternalStore(game.ui.subscribe, () => select(game.ui.get()), () => select(game.ui.get()));
}

/** Subscribes to one Settings value. Select primitives or stable nested objects. */
export function useSetting<T>(game: GameHandle, select: (s: Readonly<Settings>) => T): T {
  return useSyncExternalStore(game.settings.subscribe, () => select(game.settings.get()), () => select(game.settings.get()));
}

export function useDebugFlag(flag: string): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("debug") === flag,
    () => false,
  );
}

/* ───────────────────────── HUD ───────────────────────── */

export function Hud(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  const rootRef = useRef<HTMLDivElement>(null);
  const bestOf = useUi(game, (s) => s.match?.bestOf ?? 3);
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  const debug = useDebugFlag("feel");
  const runtime = useMemo(() => createHudRuntime(game, { debug }), [game, debug]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return runtime.mount(root);
  }, [runtime, winsNeeded]);

  return (
    <div ref={rootRef} className="hud" data-tote="false" data-timer="false" data-tags="false" data-heat="false" data-kit="false" data-ownbar="false" data-sparring="false" data-h="root">
      <DamageEdges />
      <ToteBoard winsNeeded={winsNeeded} />
      <CoreMarker />
      <DamageNumbers />
      <Crosshair />
      <EventFeed />
      <KitPanel />
      <Banners />
      <Captions />
      <Wordmark className="hud-mark" />
      <StatsOverlay />
      {debug ? <DebugOverlay /> : null}
      <BestScoreStrip game={game} />
      <ReplayOverlay game={game} />
      <HoldSkipBar game={game} />
      <MatchIntro game={game} />
    </div>
  );
}
