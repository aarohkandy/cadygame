// src/game/ui/kit/hazard.tsx (WP7)
// Hazard stripes: ink/paper at -45°, 10 px bands. They mean danger, contested, or fault, and nothing else.
import type { CSSProperties, JSX } from "react";

export function Hazard(props: { moving?: boolean; className?: string; style?: CSSProperties }): JSX.Element {
  return <span aria-hidden="true" className={`tl-hazard ${props.moving ? "tl-hazard--moving" : ""} ${props.className ?? ""}`} style={props.style} />;
}
