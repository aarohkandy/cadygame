// src/game/ui/kit/toggle.tsx (WP7)
// Segmented choice (OFF | ON, STANDARD | STABLE, ARCADE | PROVING GROUND): a radiogroup of slanted plates.
"use client";

import type { JSX, KeyboardEvent } from "react";
import { useUiCue } from "./slant-button.tsx";

export interface ToggleOption<T extends string | number> { value: T; label: string; disabled?: boolean }

export function Toggle<T extends string | number>(props: {
  options: readonly ToggleOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string; disabled?: boolean;
}): JSX.Element {
  const play = useUiCue();
  const enabled = props.options.filter((o) => !o.disabled && !props.disabled);

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = enabled.findIndex((o) => o.value === props.value);
    const next = enabled[(idx + (e.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (next && next.value !== props.value) { play("hover"); props.onChange(next.value); }
  }

  return (
    <div role="radiogroup" aria-label={props.label} className={`tl-toggle ${props.className ?? ""}`} onKeyDown={onKey}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          className="tl-toggle__opt"
          aria-checked={o.value === props.value}
          tabIndex={o.value === props.value ? 0 : -1}
          disabled={o.disabled || props.disabled}
          onClick={() => { if (o.value !== props.value) { play("select"); props.onChange(o.value); } }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
