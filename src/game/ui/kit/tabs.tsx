// src/game/ui/kit/tabs.tsx (WP7)
// Slanted tab strip with roving focus (arrow keys, Home/End) and Q/E (LB/RB) cycling handled by the owning screen.
"use client";

import { useRef, type JSX, type KeyboardEvent } from "react";
import { useUiCue } from "./slant-button.tsx";

export interface TabItem<T extends string> { id: T; label: string; disabled?: boolean }

export function Tabs<T extends string>(props: { items: readonly TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }): JSX.Element {
  const play = useUiCue();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = props.items.filter((i) => !i.disabled);

  function move(delta: number): void {
    const idx = enabled.findIndex((i) => i.id === props.value);
    const next = enabled[(idx + delta + enabled.length) % enabled.length];
    if (!next) return;
    play("hover");
    props.onChange(next.id);
    refs.current[props.items.indexOf(next)]?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    else if (e.key === "Home" && enabled[0]) { e.preventDefault(); props.onChange(enabled[0].id); }
    else if (e.key === "End" && enabled.length) { e.preventDefault(); props.onChange(enabled[enabled.length - 1].id); }
  }

  return (
    <div role="tablist" aria-label={props.label} className={`tl-tabs ${props.className ?? ""}`} onKeyDown={onKey}>
      {props.items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          type="button"
          className="tl-tab"
          aria-selected={item.id === props.value}
          tabIndex={item.id === props.value ? 0 : -1}
          disabled={item.disabled}
          onClick={() => { if (item.id !== props.value) { play("select"); props.onChange(item.id); } }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
