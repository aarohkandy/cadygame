// src/game/ui/hud/tote-board.tsx (WP7)
// The plates (EMOTION_BIBLE 2, 6): pilot plate cut left with a cobalt lip, the clock box and Core chip (gated by the
// showKit table), and the AI plate mirrored with a magenta lip. Ten-segment integrity bars with a 120 ms strike slice
// and a 900 ms red ghost drain, `-31` under your plate in the attacker's colour, the SPARRING tag that replaces the
// opponent's bar in round 1 of match 1, round pips (match 2), the PATCHED stamp, and policy chips (Lab only).
// Static markup; hud-runtime writes every value.
import type { JSX } from "react";
import type { Seat } from "../../contracts.ts";
import { PolicyChip } from "./policy-chip.tsx";

const SEGMENTS = Array.from({ length: 10 }, (_, i) => i);

function SeatPlate(props: { seat: Seat; winsNeeded: number }): JSX.Element {
  const s = props.seat;
  return (
    <div className={`hud-seat hud-seat--${s}`}>
      <div className={`hud-seat-plate hud-seat-plate--${s}`} data-h={`${s}-plate`}>
        <span className="hud-seat-name t-plate" data-h={`${s}-name`} />
        <div className="hud-bar" data-h={`${s}-bar`} data-low="false">
          {SEGMENTS.map((i) => (
            <span key={i} className="hud-bar__seg" data-h={`${s}-seg-${i}`}>
              <i className="hud-bar__ghost hud-hit-slice" />
              <i className="hud-bar__fill" />
            </span>
          ))}
        </div>
        <span className="hud-seat-num t-num-m" data-h={`${s}-num`} />
        <span className="hud-seat-tag tl-sticker tl-sticker--paper" data-h={`${s}-tag`}>SPARRING</span>
        <span className="hud-seat-whiff t-label" aria-hidden="true">WHIFF</span>
      </div>
      <div className="hud-seat-sub">
        {s === "atlas" ? <span className="hud-taken t-num-m" data-h="own-taken" data-show="false" data-team="blaze" aria-hidden="true" /> : null}
        <div className="hud-rounds" aria-hidden="true">
          {Array.from({ length: props.winsNeeded }, (_, i) => (
            <svg key={i} viewBox="0 0 20 14" className={`hud-round-pip hud-round-pip--${s}`} data-h={`${s}-round-${i}`} data-on="false">
              <path d="M4 1h15l-3 12H1Z" />
            </svg>
          ))}
        </div>
        <span className="hud-patched tl-sticker tl-sticker--paper" data-h={`${s}-patched`} data-show="false">PATCHED</span>
      </div>
      <PolicyChip seat={s} />
    </div>
  );
}

export function ToteBoard(props: { winsNeeded: number }): JSX.Element {
  return (
    <div className="hud-tote">
      <SeatPlate seat="atlas" winsNeeded={props.winsNeeded} />
      <div className="hud-center">
        <div className="hud-timer" data-h="timer" data-urgent="false">
          <span className="hud-timer__text t-num-xl" data-h="timer-text" />
        </div>
        <div className="hud-core-chip" data-h="core-chip" data-show="false" data-owner="none">
          <svg viewBox="0 0 24 24" className="hud-core-chip__diamond" aria-hidden="true"><path d="M12 1 23 12 12 23 1 12Z" /></svg>
          <span className="hud-core-chip__label t-label" data-h="core-chip-label" />
          <span className="hud-core-chip__value t-num-m" data-h="core-chip-value" />
        </div>
      </div>
      <SeatPlate seat="blaze" winsNeeded={props.winsNeeded} />
    </div>
  );
}
