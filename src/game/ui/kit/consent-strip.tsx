// src/game/ui/kit/consent-strip.tsx (WP7)
// The consent strip (EMOTION_BIBLE 9): a two-button line at the bottom of the match-2 verdict. Markup and copy live
// here; WP6's verdict mounts it and owns the behaviour (the 1.5 s arming delay, the decision timing, never Enter),
// WP8 owns the storage. The two buttons answer only a pointer click or Tab focus + Space: they are plain buttons
// with `data-no-enter`, and the verdict's key handler leaves Enter to REMATCH. `armed` false renders them
// disabled so a decision under 1.5 s is impossible to make by accident.
"use client";

import { useState, type JSX, type KeyboardEvent } from "react";

export const CONSENT_COPY = {
  title: "HELP TRAIN THE ARM",
  share: "SHARE MY MATCHES",
  local: "KEEP LOCAL",
  more: "what is recorded?",
  detail:
    "Every match is recorded on your device as robot data (joint angles, your inputs, what happened). SHARE trains the "
    + "CORNER opponents everyone fights (from duels) and adds your drills to a public robot dataset under your callsign. "
    + "We never store your name, email or IP. This callsign is published. Opponents already trained and dataset versions "
    + "already published keep what they learned. Change your mind any time in Settings: SHARE OFF and DELETE MY DATA.",
} as const;

export interface ConsentStripProps {
  /** The buttons respond only once the verdict has been up for 1.5 s (WP6 flips this). */
  armed: boolean;
  onDecide(scope: "share" | "local", inputMethod: "pointer" | "keyboard"): void;
}

export function ConsentStrip(props: ConsentStripProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const decide = (scope: "share" | "local") => (e: { detail: number }) => props.onDecide(scope, e.detail === 0 ? "keyboard" : "pointer");
  // Space activates a focused button natively; Enter is swallowed so it can never answer for the player.
  const noEnter = (e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === "Enter") e.preventDefault(); };
  return (
    <div className="tl-consent" data-armed={props.armed ? "true" : "false"} role="group" aria-label={CONSENT_COPY.title}>
      <span className="t-label tl-consent__title">{CONSENT_COPY.title}</span>
      <button type="button" className="tl-btn tl-btn--primary tl-consent__btn" disabled={!props.armed} onClick={decide("share")} onKeyDown={noEnter} data-no-enter="true">
        <span className="t-plate">{CONSENT_COPY.share}</span>
      </button>
      <button type="button" className="tl-btn tl-consent__btn" disabled={!props.armed} onClick={decide("local")} onKeyDown={noEnter} data-no-enter="true">
        <span className="t-plate">{CONSENT_COPY.local}</span>
      </button>
      <button type="button" className="tl-consent__more" onClick={() => setOpen((v) => !v)} aria-expanded={open} onKeyDown={noEnter}>
        {CONSENT_COPY.more}
      </button>
      {open ? <p className="tl-consent__detail">{CONSENT_COPY.detail}</p> : null}
    </div>
  );
}
