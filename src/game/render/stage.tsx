// src/game/render/stage.tsx (WP6, re-grounded)
// The TORQUE LIMIT stage set (GROUNDING, which overrides EMOTION_BIBLE 5.x), composed in sim space under the
// world root. The physical story, outward from the fight: a 1.10 × 0.70 m deck bolted down in the middle of a
// television studio; an 80 mm brushed-aluminium apron capping it with the LED tape recessed in its channel;
// mount plates, bolts, earth straps and a cable harness that leaves each arm and runs off the deck in a tray;
// a 220 mm acrylic safety screen on posts; a polished concrete floor with taped cable runs and floor boxes;
// human-scale camera positions, a monitor and a rolling case past the barrier that tell the eye how big the
// deck is; one jumbotron behind the opponent; and, last and darkest, the bowl with its crowd.
//
// Draw order matters here: the floor and the rigging are static opaques, the acrylic is the one transparent
// pane, and the cyclorama draws after the opaques (renderOrder 10) so it only fills what the set leaves.
// The fight's own spectacle is vfx/**; the set's lights all key off the same show envelope
// (led-strips.tsx `readShowPulse`), so the deck, its edge and the ribbon breathe, slam and flash together.
"use client";

import type { JSX } from "react";
import type { StageRuntime } from "./arena-canvas.tsx";
import { Cyclorama } from "./cyclorama.tsx";
import { HoloCrowd } from "./holo-crowd.tsx";
import { Jumbotron } from "./jumbotron.tsx";
import { LedStrips } from "./led-strips.tsx";
import { Rigging } from "./rigging.tsx";
import { StageDeck } from "./stage-deck.tsx";
import { StudioFloor } from "./studio-floor.tsx";

export function Stage(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  return (
    <group name="stage">
      <Cyclorama />
      <StudioFloor />
      <StageDeck rt={rt} />
      <Rigging />
      <LedStrips rt={rt} />
      <Jumbotron rt={rt} />
      <HoloCrowd rt={rt} />
    </group>
  );
}
