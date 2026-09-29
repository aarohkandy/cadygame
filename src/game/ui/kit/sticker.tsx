// src/game/ui/kit/sticker.tsx (WP7)
// Sticker badges (SCOPE 1.3): tilted -4°, 3 px border, hard 4 px offset shadow, Barlow Condensed 800 italic caps.
// `prize` is volt on ink text and is reserved for the Core and winning (NEW PB, LOCKED); everything else is signal,
// paper, ink, or hazard.
import type { JSX, ReactNode } from "react";

export interface StickerProps {
  children: ReactNode;
  tone?: "signal" | "paper" | "ink" | "prize" | "hazard";
  size?: "md" | "lg";
  animate?: boolean;
  delayMs?: number;
  className?: string;
}

export function Sticker(props: StickerProps): JSX.Element {
  const tone = props.tone ?? "signal";
  const cls = ["tl-sticker", tone === "signal" ? "" : `tl-sticker--${tone}`, props.size === "lg" ? "tl-sticker--lg" : "", props.className ?? ""]
    .filter(Boolean).join(" ");
  const el = <span className={cls}>{props.children}</span>;
  if (!props.animate) return el;
  return (
    <span className="inline-block tl-anim-stamp" style={props.delayMs ? { animationDelay: `${props.delayMs}ms` } : undefined}>
      {el}
    </span>
  );
}
