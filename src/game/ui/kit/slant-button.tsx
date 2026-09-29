// src/game/ui/kit/slant-button.tsx (WP7)
// The show's button: a parallelogram plate at the panel slant that pushes 6 px along the slant on hover/focus and
// shows a signal lip. Also hosts the UI cue context every kit control uses for hover/select sounds (WP3 audio).
"use client";

import { createContext, useContext, type ButtonHTMLAttributes, type JSX, type ReactNode } from "react";
import type { UiCue } from "../../contracts.ts";

export type PlayUiCue = (cue: UiCue) => void;
const UiCueContext = createContext<PlayUiCue>(() => {});

export function UiCueProvider(props: { play: PlayUiCue; children: ReactNode }): JSX.Element {
  return <UiCueContext.Provider value={props.play}>{props.children}</UiCueContext.Provider>;
}

export function useUiCue(): PlayUiCue {
  return useContext(UiCueContext);
}

export interface SlantButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  variant?: "ink" | "primary" | "paper";
  size?: "lg" | "md" | "sm";
  block?: boolean;
  /** Right-aligned mono detail (a key hint, a count). */
  hint?: ReactNode;
  /** Leading element (glyph, index). */
  lead?: ReactNode;
  active?: boolean;
  /** Cue played on click. Defaults to select; pass "back" for dismissals. */
  cue?: UiCue | null;
}

export function SlantButton(props: SlantButtonProps): JSX.Element {
  const { label, variant = "ink", size = "lg", block, hint, lead, active, cue = "select", className, onClick, onMouseEnter, onFocus, type, ...rest } = props;
  const play = useUiCue();
  const cls = [
    "tl-btn",
    variant === "primary" ? "tl-btn--primary" : variant === "paper" ? "tl-btn--paper" : "",
    size === "md" ? "tl-btn--md" : size === "sm" ? "tl-btn--sm" : "",
    block ? "tl-btn--block" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={cls}
      data-active={active ? "true" : undefined}
      onMouseEnter={(e) => { if (!rest.disabled) play("hover"); onMouseEnter?.(e); }}
      onFocus={(e) => { onFocus?.(e); }}
      onClick={(e) => { if (cue) play(cue); onClick?.(e); }}
    >
      <span className="flex min-w-0 items-center gap-3">
        {lead}
        <span className="truncate">{label}</span>
      </span>
      {hint !== undefined && hint !== null ? <span className="tl-btn__hint">{hint}</span> : null}
    </button>
  );
}
