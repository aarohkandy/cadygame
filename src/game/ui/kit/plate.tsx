// src/game/ui/kit/plate.tsx (WP7)
// A slanted plate (GAME_DESIGN 6.4 as adjusted by SCOPE 1.3): ink body, optional 4 px lip on the leading edge in a team
// or show colour, paper text. `cut` picks which ends are slanted: both (default), left only (pilot side), right only (AI).
import type { CSSProperties, JSX, ReactNode } from "react";

export interface PlateProps {
  children?: ReactNode;
  tone?: "ink" | "ink-700" | "paper" | "signal" | "sheen";
  lip?: "signal" | "paper" | "cobalt" | "magenta" | "ink" | null;
  cut?: "both" | "left" | "right";
  /** Plate height in px (drives the slant cut). */
  height?: number;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "span" | "section" | "header";
  "data-h"?: string;
}

export function plateClass(p: Pick<PlateProps, "tone" | "lip" | "cut">): string {
  return [
    "tl-plate",
    p.tone && p.tone !== "ink" ? `tl-plate--${p.tone}` : "",
    p.lip ? `tl-plate--lip-${p.lip}` : "",
    p.cut === "left" ? "tl-plate--cut-left" : p.cut === "right" ? "tl-plate--cut-right" : "",
  ].filter(Boolean).join(" ");
}

export function Plate(props: PlateProps): JSX.Element {
  const Tag = props.as ?? "div";
  const style = props.height !== undefined ? { ...props.style, ["--plate-h" as string]: `${props.height}px` } : props.style;
  return (
    <Tag className={`${plateClass(props)} ${props.className ?? ""}`} style={style} data-h={props["data-h"]}>
      {props.children}
    </Tag>
  );
}
