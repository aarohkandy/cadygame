// src/game/ui/kit/count-up.tsx (WP7)
// Tabular count-up (7.2 broadcast tier): digits roll from 0 over 350 ms on --ease-snap, then pop to 1.15 and back.
// Frames write textContent directly; React renders once.
"use client";

import { useEffect, useRef, type JSX } from "react";

function easeSnap(t: number): number {
  // cubic-bezier(.3,0,0,1) approximated by a quartic ease-out; indistinguishable at 350 ms.
  return 1 - Math.pow(1 - t, 4);
}

export function CountUp(props: { value: number; decimals?: number; suffix?: string; durationMs?: number; delayMs?: number; className?: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const decimals = props.decimals ?? 0;
  const final = `${props.value.toFixed(decimals)}${props.suffix ?? ""}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = document.documentElement.dataset.reducedMotion === "true";
    const duration = reduced ? 0 : props.durationMs ?? 350;
    const delay = reduced ? 0 : props.delayMs ?? 0;
    if (duration <= 0) { el.textContent = final; return; }
    let raf = 0;
    const start = performance.now() + delay;
    el.textContent = `${(0).toFixed(decimals)}${props.suffix ?? ""}`;
    const tick = (t: number) => {
      const u = Math.min(1, Math.max(0, (t - start) / duration));
      el.textContent = `${(props.value * easeSnap(u)).toFixed(decimals)}${props.suffix ?? ""}`;
      if (u < 1) raf = requestAnimationFrame(tick);
      else el.animate([{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 120, easing: "ease-out" });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.value, decimals, props.suffix, props.durationMs, props.delayMs, final]);

  return <span ref={ref} className={`inline-block t-tab ${props.className ?? ""}`}>{final}</span>;
}
