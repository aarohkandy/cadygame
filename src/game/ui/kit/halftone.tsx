// src/game/ui/kit/halftone.tsx (WP7)
// Halftone dot field in the current text colour, used at low opacity inside panels or as a fade toward a seam.
import type { CSSProperties, JSX } from "react";

export function Halftone(props: { fade?: boolean; opacity?: number; className?: string; style?: CSSProperties }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`tl-halftone pointer-events-none ${props.fade ? "tl-halftone--fade" : ""} ${props.className ?? ""}`}
      style={{ opacity: props.opacity ?? 0.12, ...props.style }}
    />
  );
}
