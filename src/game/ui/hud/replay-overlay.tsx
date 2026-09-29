// src/game/ui/hud/replay-overlay.tsx (WP7)
// Earned replays (8.6): 8% letterbox bars, a REPLAY sticker top left, and one readout slammed in on the impact
// (`IMPACT 2.7 m/s · 31`, from the director's real event). No sponsor, no zone codes.
"use client";

import type { JSX } from "react";
import type { GameHandle } from "../../contracts.ts";
import { Sticker } from "../kit/sticker.tsx";
import { useUi } from "./hud.tsx";

export function ReplayOverlay(props: { game: GameHandle }): JSX.Element | null {
  const phase = useUi(props.game, (s) => s.phase);
  const label = useUi(props.game, (s) => s.replayMomentLabel);
  if (phase !== "round_replay" && phase !== "match_replay") return null;
  return (
    <div className="hud-replay" data-kind={phase}>
      <i className="hud-replay__bar hud-replay__bar--top" />
      <i className="hud-replay__bar hud-replay__bar--bottom" />
      <div className="hud-replay__sticker">
        <Sticker tone="signal" size="lg" animate>{phase === "match_replay" ? "MATCH REPLAY" : "REPLAY"}</Sticker>
      </div>
      {label ? (
        <div className="hud-replay__readout tl-anim-slam" style={{ animationDelay: "900ms" }}>
          <span className="t-num-m">{label}</span>
        </div>
      ) : null}
    </div>
  );
}
