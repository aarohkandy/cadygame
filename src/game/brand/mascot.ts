// src/game/brand/mascot.ts (WP7)
// BIT, the show mascot (SCOPE 1.2): a smiling 4 cm foam cube. Drawn as a three-quarter cube with a volt front
// face (BIT is prize-coloured because it rides on the Core decal and in prize confetti), a paper top, an ink
// side, and a small ink face. Used on the boot screen, the Core decal (WP6), confetti, and the sponsor boards.

import type { BrandMark } from "../contracts.ts";
import { circleD, polygonD } from "./sponsors.ts";

export const BIT_NAME = "BIT";

export const BIT_MARK: BrandMark = {
  viewBox: "0 0 64 64",
  paths: [
    // Silhouette and outline: the whole cube in ink, faces inset 2.5 units so an ink edge shows everywhere.
    { d: polygonD([[4, 18], [18, 4], [60, 4], [60, 46], [46, 60], [4, 60]]), fill: "ink" },
    // Top face.
    { d: polygonD([[9.5, 17], [19.5, 7], [53, 7], [43, 17]]), fill: "paper" },
    // Side face stays ink (the shadow side); a paper sheen strip keeps it reading as foam.
    { d: polygonD([[50, 14], [55, 9], [55, 20], [50, 25]]), fill: "paper" },
    // Front face.
    { d: polygonD([[7, 20.5], [43.5, 20.5], [43.5, 57], [7, 57]]), fill: "volt" },
    // Eyes.
    { d: `${circleD(18, 34, 3.2)} ${circleD(32.5, 34, 3.2)}`, fill: "ink" },
    // Smile: a crescent.
    { d: "M15 42 Q25.25 52.5 35.5 42 L33 40.5 Q25.25 47.5 17.5 40.5 Z", fill: "ink" },
    // Cheek dots.
    { d: `${circleD(12.5, 43, 1.6)} ${circleD(38, 43, 1.6)}`, fill: "signal" },
  ],
};
