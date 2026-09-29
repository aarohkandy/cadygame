// src/game/ui/kit/one-tap-label.tsx (WP7)
// One-tap labels (EMOTION_BIBLE 9), never mandatory: on the round card "What were you going for?" (RUSH / BAIT /
// TURTLE / CORE / MESSING AROUND, gone after 2 s), on the verdict from match 3 one of "Did BACKLASH feel like a
// person?" (1 to 5 hearts) or "Rate your run" (CLEAN / SLOPPY). Markup and copy only: WP6 mounts it, times it and
// picks the question; WP8 stores `{skipped, shownMs}` with the opponent build.
"use client";

import type { JSX } from "react";
import { Glyph } from "./glyphs.tsx";

export type IntentLabel = "rush" | "bait" | "turtle" | "core" | "messing";
export const INTENT_OPTIONS: readonly { value: IntentLabel; label: string }[] = [
  { value: "rush", label: "RUSH" }, { value: "bait", label: "BAIT" }, { value: "turtle", label: "TURTLE" },
  { value: "core", label: "CORE" }, { value: "messing", label: "MESSING AROUND" },
];
export const RUN_OPTIONS: readonly { value: "clean" | "sloppy"; label: string }[] = [
  { value: "clean", label: "CLEAN" }, { value: "sloppy", label: "SLOPPY" },
];

export type OneTapQuestion =
  | { kind: "intent"; onAnswer(v: IntentLabel): void }
  | { kind: "person"; opponent: string; onAnswer(hearts: 1 | 2 | 3 | 4 | 5): void }
  | { kind: "run"; onAnswer(v: "clean" | "sloppy"): void };

export interface OneTapLabelProps {
  question: OneTapQuestion;
  /** The verdict's Enter belongs to REMATCH; the options answer clicks and Space only. */
  className?: string;
}

function questionText(q: OneTapQuestion): string {
  switch (q.kind) {
    case "intent": return "What were you going for?";
    case "person": return `Did ${q.opponent} feel like a person?`;
    case "run": return "Rate your run";
  }
}

export function OneTapLabel(props: OneTapLabelProps): JSX.Element {
  const q = props.question;
  return (
    <div className={`tl-onetap ${props.className ?? ""}`} role="group" aria-label={questionText(q)}>
      <span className="tl-onetap__q">{questionText(q)}</span>
      <span className="tl-onetap__options">
        {q.kind === "intent" ? INTENT_OPTIONS.map((o) => (
          <button key={o.value} type="button" className="tl-onetap__opt t-label" onClick={() => q.onAnswer(o.value)}>{o.label}</button>
        )) : null}
        {q.kind === "run" ? RUN_OPTIONS.map((o) => (
          <button key={o.value} type="button" className="tl-onetap__opt t-label" onClick={() => q.onAnswer(o.value)}>{o.label}</button>
        )) : null}
        {q.kind === "person" ? ([1, 2, 3, 4, 5] as const).map((n) => (
          <button key={n} type="button" className="tl-onetap__heart" aria-label={`${n} OF 5`} onClick={() => q.onAnswer(n)}><Glyph name="diamond" /></button>
        )) : null}
      </span>
    </div>
  );
}
