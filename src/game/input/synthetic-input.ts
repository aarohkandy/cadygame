// src/game/input/synthetic-input.ts (WP3)
// SyntheticInput for proxy bots (GAME_DESIGN 5.5.7): pointer counts, key codes, and mouse buttons fed into the exact
// entry points the DOM listeners use. A proxy therefore goes through bindings, edge buffering, the jab and charge
// macros, assists, the leash, and hit-stop sampling like a person does, and its commands are recorded as device
// "synthetic". Nothing here needs pointer lock or a document, so it runs in Node.

import type { SyntheticInput } from "../contracts.ts";
import type { InputSystem } from "./input-system.ts";

export function createSyntheticInput(input: InputSystem): SyntheticInput {
  return {
    move(dx, dy) {
      input.handleMove(dx, dy, "synthetic");
    },
    key(code, down) {
      input.handleKey(code, down, "synthetic");
    },
    button(b, down) {
      input.handleButton(b, down, "synthetic");
    },
  };
}
