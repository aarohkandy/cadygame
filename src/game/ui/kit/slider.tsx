// src/game/ui/kit/slider.tsx (WP7)
// Range control: a signal fill on an ink track with a slanted paper thumb, and the live value in Chivo Mono.
"use client";

import type { CSSProperties, JSX } from "react";

export function Slider(props: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
  format?: (v: number) => string; disabled?: boolean; id?: string;
}): JSX.Element {
  const span = props.max - props.min;
  const pct = span > 0 ? ((props.value - props.min) / span) * 100 : 0;
  return (
    <div className="tl-slider">
      <input
        id={props.id}
        type="range"
        className="tl-slider__input"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        style={{ "--v": `${pct}%` } as CSSProperties}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span className="tl-slider__value t-mono">{props.format ? props.format(props.value) : String(props.value)}</span>
    </div>
  );
}
