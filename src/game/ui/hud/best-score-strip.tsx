// src/game/ui/hud/best-score-strip.tsx (WP6)
// The round card (EMOTION_BIBLE 2, 8.1, 9): 3 s between rounds. HARDEST HIT with its receipt word (`SOLID 1.4 m/s`),
// FASTEST STRIKE, OBJECTIVE, each with the winner's team lip; `vs PB` deltas only after one completed match
// (showKit.pbStamps). Under it the one-tap label, never mandatory: "WHAT WERE YOU GOING FOR?" RUSH / BAIT /
// TURTLE / CORE / MESSING AROUND, gone after 2 s; the answer (or the skip, with how long it was shown) goes to the
// recorder through the director while it is still live.
"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { GameHandle } from "../../contracts.ts";
import { showKitFor } from "../../match/match-config.ts";
import type { MatchDirectorExtras } from "../../match/match-director.ts";
import { sharedProfile } from "../meta/profile.ts";
import { useSetting, useUi } from "./hud.tsx";
import { OneTapLabel } from "../kit/one-tap-label.tsx";

/** The receipt word (8.1): bands 0–1.0 / 1.0–1.8 / > 1.8 m/s. */
export function receiptWord(vN: number): "SOFT" | "SOLID" | "HARD" {
  return vN > 1.8 ? "HARD" : vN >= 1.0 ? "SOLID" : "SOFT";
}
/** The label row is on screen this long (9). */
export const LABEL_MS = 2000;

type Extras = GameHandle["director"] & Partial<MatchDirectorExtras>;

function IntentLabel(props: { game: GameHandle }): JSX.Element | null {
  const shownAt = useRef(0);
  const answered = useRef(false);
  const [open, setOpen] = useState(true);
  const director = props.game.director as Extras;

  useEffect(() => {
    shownAt.current = performance.now();
    const id = window.setTimeout(() => {
      setOpen(false);
      if (!answered.current) { answered.current = true; director.label?.("intent", null, LABEL_MS); }
    }, LABEL_MS);
    return () => window.clearTimeout(id);
  }, [director]);

  if (!open) return null;
  // Markup is WP7's kit one-tap (9); the label store write and the 2 s skip stay here.
  return (
    <OneTapLabel
      className="hud-best__tiles"
      question={{
        kind: "intent",
        onAnswer: (v) => {
          if (answered.current) return;
          answered.current = true;
          director.label?.("intent", v, performance.now() - shownAt.current);
          setOpen(false);
        },
      }}
    />
  );
}

export function BestScoreStrip(props: { game: GameHandle }): JSX.Element | null {
  const phase = useUi(props.game, (s) => s.phase);
  const tiles = useUi(props.game, (s) => s.bestScore);
  const match = useUi(props.game, (s) => s.match);
  const played = useSetting(props.game, (s) => s.profile.matchesPlayed);
  const kit = showKitFor(played);
  const bests = useMemo(() => sharedProfile().get().bests, []);
  if (phase !== "round_summary" || !tiles || tiles.length === 0) return null;
  const human = match ? match.seats.atlas.driver.kind === "human" || match.seats.blaze.driver.kind === "human" : false;
  return (
    <div className="hud-best">
      <span className="hud-best__title t-label">ROUND BEST</span>
      <div className="hud-best__tiles">
        {tiles.map((tile, i) => {
          const speed = tile.label === "HARDEST HIT" ? Number(/([\d.]+) m\/s/.exec(tile.detail)?.[1] ?? "0") : tile.label === "FASTEST STRIKE" ? Number(tile.value) : 0;
          const pb = kit.pbStamps && tile.label === "FASTEST STRIKE" && bests.fastest_strike !== undefined ? speed - bests.fastest_strike : null;
          return (
            <div key={tile.label} className={`hud-best__tile hud-best__tile--${tile.seat} tl-anim-slide-up`} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="t-label hud-best__label">{tile.label}</span>
              <span className="t-num-m hud-best__value">{tile.label === "HARDEST HIT" && speed > 0 ? `${receiptWord(speed)} ${speed.toFixed(1)} m/s` : tile.value}</span>
              <span className="t-mono hud-best__detail">
                {tile.label === "HARDEST HIT" && speed > 0 ? `${tile.value} DMG` : tile.detail}
                {pb !== null ? ` · vs PB ${pb >= 0 ? "+" : ""}${pb.toFixed(2)}` : ""}
              </span>
              <span className="t-plate hud-best__name">{match?.seats[tile.seat].displayName ?? ""}</span>
            </div>
          );
        })}
      </div>
      {human && match?.context === "quick" ? <IntentLabel game={props.game} /> : null}
    </div>
  );
}
