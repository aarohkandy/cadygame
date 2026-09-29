// src/game/ui/screens/cockpit-choice.tsx (WP6)
// The cockpit mount (3.2, EMOTION_BIBLE 3.5): STANDARD lets the view carry shake and kick; STABLE halves both. The
// pre-fight full-screen prompt is gone (2: no cockpit prompt before the first click); the choice lives on the
// pause plate as a toggle and under CAMERA in settings. The `cockpit_choice` screen renders the same toggle over
// the lobby for anything that still routes there.
"use client";

import type { JSX } from "react";
import type { GameHandle, Settings } from "../../contracts.ts";
import { Wordmark } from "../../brand/wordmark.tsx";
import { useSetting } from "../hud/hud.tsx";
import { ActionGlyph } from "../kit/glyphs.tsx";
import { useUiCue } from "../kit/slant-button.tsx";

type Cockpit = Settings["camera"]["cockpit"];

const OPTIONS: readonly { id: Cockpit; title: string; lines: readonly string[] }[] = [
  { id: "standard", title: "STANDARD COCKPIT", lines: ["FULL CAMERA SHAKE AND KICK", "HITS YOU TAKE MOVE THE VIEW", "BUILT FOR FEEL"] },
  { id: "stable", title: "STABLE COCKPIT", lines: ["HALF SHAKE · HALF KICK", "THE HORIZON STAYS PUT", "BUILT FOR COMFORT"] },
];

function Diagram(props: { stable: boolean }): JSX.Element {
  const amp = props.stable ? 3 : 9;
  const wave = Array.from({ length: 13 }, (_, i) => `${i === 0 ? "M" : "L"}${20 + i * 25} ${60 + (i % 2 === 0 ? -amp : amp) * (1 - i / 16)}`).join(" ");
  return (
    <svg viewBox="0 0 360 120" className="cockpit__diagram" aria-hidden="true">
      <path d="M0 110h360" stroke="currentColor" strokeWidth="2" />
      <path d={wave} fill="none" stroke="var(--paper)" strokeWidth="5" strokeLinecap="square" />
      <path d="M20 60h320" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
    </svg>
  );
}

/** The two-card mount toggle, embedded by the pause menu (Esc → STABLE) and the settings screen. */
export function CockpitToggle(props: { game: GameHandle; onChange?: () => void }): JSX.Element {
  const game = props.game;
  const play = useUiCue();
  const current = useSetting(game, (s) => s.camera.cockpit);

  function choose(id: Cockpit): void {
    if (id === current) return;
    play("select");
    game.settings.set({ camera: { cockpit: id }, profile: { cockpitChosen: true } });
    props.onChange?.();
  }

  return (
    <div className="cockpit" role="radiogroup" aria-label="COCKPIT">
      {OPTIONS.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={current === o.id}
          className="cockpit__card tl-anim-slide-up"
          style={{ animationDelay: `${i * 40}ms` }}
          onMouseEnter={() => play("hover")}
          onClick={() => choose(o.id)}
        >
          <span className="cockpit__title t-display-l t-slant">
            {o.title.split(" ").map((word) => <span key={word} className="cockpit__word">{word}</span>)}
          </span>
          <Diagram stable={o.id === "stable"} />
          {o.lines.map((l) => <span key={l} className="cockpit__spec t-label">{l}</span>)}
        </button>
      ))}
    </div>
  );
}

export function CockpitChoice(props: { game: GameHandle }): JSX.Element {
  const game = props.game;
  return (
    <div className="tl-screen tl-screen--solid">
      <header className="tl-showbar">
        <Wordmark className="tl-showbar__mark" />
        <div className="tl-plate tl-plate--lip-signal tl-showbar__title t-plate">PICK YOUR MOUNT</div>
      </header>
      <div className="tl-screen__body grid">
        <CockpitToggle game={game} onChange={() => game.ui.set({ screen: "green_room" })} />
      </div>
      <footer className="tl-hintbar">
        <span className="tl-hint t-label"><ActionGlyph action="navigate" device={game.pilot.device} /> CHOOSE</span>
        <span className="tl-hint t-label"><ActionGlyph action="confirm" device={game.pilot.device} /> CONFIRM</span>
      </footer>
    </div>
  );
}
