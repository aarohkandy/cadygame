// src/game/ui/kit/stamp.tsx (WP7)
// Anton stamps (SCOPE 1.3): slanted skewX(-10deg), rotated a third of the slant, hard border. The celebration tier plays
// a 160 ms stamp-in with overshoot and an 80 ms parent shake. `gold` is the prize foil (VICTORY, NEW PB, MVP) and
// `chrome` the premium neutral foil; `fault` sits on hazard stripes.
import type { JSX, ReactNode } from "react";

export type StampTone = "ink" | "paper" | "signal" | "gold" | "chrome" | "fault" | "cobalt" | "magenta";

export interface StampProps {
  children: ReactNode;
  tone?: StampTone;
  /** Type size token. */
  size?: "xl" | "l" | "m" | "s";
  animate?: boolean;
  /** Delay before the stamp lands, ms (stagger siblings 40 ms apart). */
  delayMs?: number;
  /**
   * Shrink to the width of the box the stamp sits in when the text would otherwise run past it
   * (a long entrant name in a winner band). The size token stays the cap. Needs string children.
   */
  fit?: boolean;
  className?: string;
}

/**
 * Anton's average uppercase advance, in ems, plus the stamp's own padding, border cut and the
 * skew's horizontal spill: width ≈ (chars · K + PAD) · font-size.
 */
const FIT_K = 0.5;
const FIT_PAD = 0.9;

const SIZE: Readonly<Record<NonNullable<StampProps["size"]>, string>> = {
  xl: "var(--fs-display-xl)", l: "var(--fs-display-l)", m: "var(--fs-num-xl)", s: "var(--fs-plate)",
};

export function Stamp(props: StampProps): JSX.Element {
  const tone = props.tone ?? "ink";
  const toneClass = tone === "gold" ? "tl-stamp--gold" : tone === "chrome" ? "tl-stamp--chrome tl-foil-chrome" : tone === "ink" ? "" : `tl-stamp--${tone}`;
  const size = SIZE[props.size ?? "m"];
  const chars = props.fit && typeof props.children === "string" ? props.children.length : 0;
  const fits = chars > 0;
  const fontSize = fits ? `min(${size}, calc(100cqi / (${chars} * ${FIT_K} + ${FIT_PAD})))` : size;
  const outer = `${fits ? "tl-fit" : "inline-block"} ${props.className ?? ""}`;
  const inner = (
    <span className={`tl-stamp ${toneClass} ${tone === "fault" ? "tl-stamp--fault-hazard" : ""}`} style={{ fontSize }}>
      {props.children}
    </span>
  );
  if (!props.animate) return <span className={outer}>{inner}</span>;
  const delay = props.delayMs ? { animationDelay: `${props.delayMs}ms` } : undefined;
  return (
    <span className={`${outer} tl-anim-shake`} style={props.delayMs ? { animationDelay: `${props.delayMs + 160}ms` } : undefined}>
      <span className="inline-block tl-anim-stamp" style={delay}>{inner}</span>
    </span>
  );
}
