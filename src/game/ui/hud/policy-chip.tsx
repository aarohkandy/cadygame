// src/game/ui/hud/policy-chip.tsx (WP7)
// Under a policy seat's plate (7.4, Lab and user models only): tier or file, decision rate, last compute ms, in Chivo
// Mono. The lip turns to hazard stripes for 1.5 s after a late, timeout, or error. Text is written by hud-runtime.
import type { JSX } from "react";
import type { Seat } from "../../contracts.ts";

export function PolicyChip(props: { seat: Seat }): JSX.Element {
  return (
    <div className={`hud-policy-chip hud-policy-chip--${props.seat} tl-notch`} data-h={`${props.seat}-policy`} data-show="false">
      <span className="hud-policy-chip__lip" aria-hidden="true" />
      <span className="t-mono" data-h={`${props.seat}-policy-text`} />
    </div>
  );
}
