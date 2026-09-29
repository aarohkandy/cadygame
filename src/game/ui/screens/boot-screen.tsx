// src/game/ui/screens/boot-screen.tsx (WP7)
// Boot and loading (7.3.1): flat ink with a slow slanted stripe field, the wordmark, a ten-segment bar with BIT riding
// the fill, a mono status line driven by real boot stages, rotating one-line tips, and the sponsors along the bottom.
// game-root (WP1) holds it for at least 900 ms; it can render before the GameHandle exists, so it takes plain props.
"use client";

import { useEffect, useState, type JSX } from "react";
import { BrandMarkSvg, Wordmark } from "../../brand/wordmark.tsx";

export const BOOT_TIPS: readonly string[] = [
  "FLICK FAST · ARM SPEED IS DAMAGE",
  "WAIT FOR IN RANGE · THEN SWING",
  "GUARD LATE TO DEFLECT A HEAVY",
  "TAP TO JAB · HOLD TO CHARGE",
  "DOCK THE CORE · THE CLOCK LOCKS THE ROUND",
  "STEAL THE CORE · KEEP THEIR COUNTDOWN",
  "EVERY FLICK BUILDS HEAT",
  "REGISTER YOUR OWN POLICY IN THE LAB",
];
const TIP_MS = 4000;
const SEGMENTS = 10;

export function BootScreen(props: { progress: number; label: string; error?: string | null }): JSX.Element {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % BOOT_TIPS.length), TIP_MS);
    return () => window.clearInterval(id);
  }, []);
  const p = Math.min(1, Math.max(0, props.progress));
  const filled = Math.floor(p * SEGMENTS + 1e-9);
  // BIT rides the segment the bar has just filled. The stylesheet owns the segment pitch (it narrows on a
  // phone), so the ride is expressed in it rather than in a hard-coded 34 px that walks off a small bar.
  const bitStep = Math.max(0, Math.min(SEGMENTS - 1, filled - 1));

  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__stripes" aria-hidden="true" />
      <div className="boot__inner">
        <Wordmark className="boot__mark" />
        <div className="boot__track" role="progressbar" aria-label="LOADING" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
          <span className="boot__bit" style={{ transform: `translateX(calc(var(--boot-pitch) * ${bitStep})) rotate(${filled * 90}deg)` }} aria-hidden="true">
            <BrandMarkSvg id="bit" title={null} className="h-full w-full" />
          </span>
          {Array.from({ length: SEGMENTS }, (_, i) => <span key={i} className="boot__seg" data-on={i < filled ? "true" : "false"} />)}
        </div>
        <p className="boot__status t-mono">{props.error ? `BOOT FAILED · ${props.error}` : props.label || "starting"}</p>
        {props.error ? null : <p key={tip} className="boot__tip t-label">{BOOT_TIPS[tip]}</p>}
      </div>
      <div className="boot__sponsors" aria-hidden="true">
        <BrandMarkSvg id="ohmstead" title={null} recolor={{ ink: "paper" }} />
        <span className="t-label">LIVE FROM THE BENCHTOP</span>
        <BrandMarkSvg id="pulpoPop" title={null} recolor={{ ink: "paper", paper: "ink" }} />
      </div>
    </div>
  );
}
