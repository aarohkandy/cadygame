// src/game/brand/wordmark.tsx (WP7)
// DOM renderers for the brand marks. Fills resolve to the palette CSS variables (never raw hex), so colourblind
// mode and the token test cover the marks too. Every mark is an inline SVG with a real <title> for assistive tech.

import type { JSX } from "react";
import type { BrandMarkId, TokenColor } from "../contracts.ts";
import { MARKS, SHOW_NAME, WORDMARK_LOCKUP } from "./marks.ts";

const TOKEN_VAR: Readonly<Record<TokenColor, string>> = {
  ink: "var(--ink)", paper: "var(--paper)", signal: "var(--signal)", volt: "var(--volt)", cobalt: "var(--cobalt)",
  magenta: "var(--magenta)", strike: "var(--strike)", crit: "var(--crit)", block: "var(--block)",
};

export interface BrandMarkProps {
  id: BrandMarkId;
  /** Rendered height in CSS px (width follows the viewBox). Omit to size with CSS. */
  height?: number;
  className?: string;
  /** Accessible name. Decorative marks pass null. */
  title?: string | null;
  /** Swap token fills (e.g. { ink: "paper" } to set a mark on a dark surface). */
  recolor?: Partial<Record<TokenColor, TokenColor>>;
  /** Drop paths by index (the wordmark's plate is WORDMARK_LOCKUP.plateIndex). */
  omit?: readonly number[];
}

export function BrandMarkSvg(props: BrandMarkProps): JSX.Element {
  const mark = MARKS[props.id];
  const [, , w, h] = mark.viewBox.split(/\s+/).map(Number);
  const title = props.title === undefined ? props.id.toUpperCase() : props.title;
  const width = props.height !== undefined ? (props.height * w) / h : undefined;
  return (
    <svg
      viewBox={mark.viewBox}
      width={width}
      height={props.height}
      className={props.className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {mark.paths.map((p, i) =>
        props.omit?.includes(i) ? null : (
          <path
            key={i}
            d={p.d}
            fill={TOKEN_VAR[props.recolor?.[p.fill] ?? p.fill]}
            stroke={p.stroke ? TOKEN_VAR[props.recolor?.[p.stroke] ?? p.stroke] : undefined}
            strokeWidth={p.strokeWidth}
          />
        ),
      )}
    </svg>
  );
}

export interface WordmarkProps {
  height?: number;
  className?: string;
  /**
   * plate:  the full lockup, letters knocked out of the ink plate (default; works on any ground).
   * bare:   letters only, paper TORQUE and signal LIMIT, for ink grounds that already are a plate.
   * light:  letters only in ink and signal, for paper grounds.
   */
  variant?: "plate" | "bare" | "light";
  title?: string | null;
}

export function Wordmark(props: WordmarkProps): JSX.Element {
  const variant = props.variant ?? "plate";
  return (
    <BrandMarkSvg
      id="torqueLimit"
      height={props.height}
      className={props.className}
      title={props.title === undefined ? SHOW_NAME : props.title}
      omit={variant === "plate" ? undefined : [WORDMARK_LOCKUP.plateIndex]}
      recolor={variant === "light" ? { paper: "ink" } : undefined}
    />
  );
}
