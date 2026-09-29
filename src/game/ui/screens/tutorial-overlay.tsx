// src/game/ui/screens/tutorial-overlay.tsx (WP6)
// Match 1, round 1 (EMOTION_BIBLE 2): the one caption at a time, in Anton, with the mouse glyph when it names a
// button: HIT IT + the glyph for the device in the player's hands (LMB / RT / the STRIKE plate), GUARD · HOLD,
// GRAB IT, BRING IT HOME, HOLD IT · n, and the coaching fallbacks. It reads
// the caption off the director's sparring script (polled at 10 Hz; a primitive snapshot, so React commits only on
// a change). After match 2 the same node carries the SYSTEMS CHECK drill: the task string, the count, and the
// SYSTEMS NOMINAL stamp. Mounted by broadcast-ui while `match.tutorial` is set.
"use client";

import { useSyncExternalStore, type JSX } from "react";
import type { GameHandle, InputDevice, MatchPhase } from "../../contracts.ts";
import type { MatchDirectorExtras } from "../../match/match-director.ts";
import { KeyCap } from "../kit/glyphs.tsx";
import { Stamp } from "../kit/stamp.tsx";
import { useUi } from "../hud/hud.tsx";

const POLL_MS = 100;
// Phases that run a card of their own; the caption steps out of their way.
const CENTRE_BUSY: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["match_intro", "rematch_intro", "entrance", "boot_ritual", "count_in", "round_intro"]);

type Extras = GameHandle["director"] & Partial<MatchDirectorExtras>;

/** The caption line for this frame: the script's, or `HOLD IT · n` while the pilot's lock-in counts down. */
export function captionFor(director: Extras, lockRemainingS: number | null, docked: boolean): string {
  const d = director.drill;
  if (d) return d.result ? (d.result === "NOMINAL" ? "SYSTEMS NOMINAL" : "SYSTEMS CHECK · TIMED OUT") : d.task.toUpperCase();
  const t = director.tutorial;
  if (!t) return "";
  if (t.step.id === "hold" && docked && lockRemainingS !== null) return `HOLD IT · ${Math.max(1, Math.ceil(lockRemainingS))}`;
  return t.caption ?? "";
}

function useCaption(game: GameHandle): string {
  return useSyncExternalStore(
    (fn) => { const id = window.setInterval(fn, POLL_MS); return () => window.clearInterval(id); },
    () => {
      const director = game.director as Extras;
      const player = game.hud.playerSeat;
      const core = game.rules.state.core;
      const docked = player !== null && core.dockedIn === player;
      return captionFor(director, docked ? core.lockInRemainingS : null, docked);
    },
    () => "",
  );
}

/** Which action a caption names, if any (2: a glyph whenever the prompt names a button). */
export function glyphFor(caption: string): "strike" | "guard" | null {
  if (caption.startsWith("HIT IT")) return "strike";
  if (caption.includes("RMB")) return "guard";
  return null;
}

/**
 * The label for that action on the device actually in the player's hands. The game's one teaching moment used
 * to say "LMB" to a phone and to a controller, which is worse than saying nothing — it names hardware the
 * player does not have. Touch labels match the plates in touch-layer.tsx so the prompt points at a real button.
 */
export function glyphLabel(action: "strike" | "guard", device: InputDevice): string {
  if (device === "touch") return action === "strike" ? "STRIKE" : "GUARD";
  if (device === "gamepad") return action === "strike" ? "RT" : "LT";
  return action === "strike" ? "LMB" : "RMB";
}

export function TutorialOverlay(props: { game: GameHandle }): JSX.Element | null {
  const game = props.game;
  const phase = useUi(game, (s) => s.phase);
  const caption = useCaption(game);
  if (!caption || CENTRE_BUSY.has(phase)) return null;
  const director = game.director as Extras;
  const drill = director.drill;
  const stamp = drill?.result === "NOMINAL";
  const glyph = glyphFor(caption);
  // The caption's own text stays device-neutral; the glyph carries the device. "GUARD · HOLD RMB" therefore
  // sheds its " RMB" here on every device, not just the mouse.
  const text = glyph === "guard" ? caption.replace(" RMB", "") : caption;
  const label = glyph ? glyphLabel(glyph, game.pilot.device) : null;

  return (
    <div className="tut" data-yield="false" aria-live="polite">
      {drill ? <div className="tut__head"><span className="t-label tut__kicker">SYSTEMS CHECK</span></div> : null}
      <div key={caption} className="tut__goal">
        {stamp ? (
          <Stamp tone="gold" size="m" animate>SYSTEMS NOMINAL</Stamp>
        ) : (
          <span className="tut__line t-display-l t-slant tl-anim-slam">
            {text}
            {label ? <> <KeyCap label={label} /></> : null}
          </span>
        )}
      </div>
    </div>
  );
}
