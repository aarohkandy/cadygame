// src/game/render/lobby-tiles.tsx (WP2)
// Where the pilot arm points while the Green Room rundown is browsed (GAME_DESIGN 7.3.3).
//
// This file used to build a cue-card caddy on the deck beside the pilot's mount: seven racked cards that
// repeated the DOM rundown's numbers a hand's width from it, with no collider inside the arm's reach. The
// declutter pass deleted it. The DOM rundown is the menu; the arm only gestures toward the highlighted row,
// fanning across the space in front of the mount from left (first row) to right (last row).
import type { Vec3 } from "../contracts.ts";

/** Number of rows in the Green Room rundown (green-room.tsx LOBBY_MENU_IDS). */
const ROWS = 7;
/** Bearing of the first and last row, in the pilot's ego frame (+y is left). */
const FAN_HALF_RAD = 0.55;
/** Reach and height of the gesture: inside the working envelope, clear of the deck. */
const CURSOR_REACH_M = 0.24;
const CURSOR_Z_M = 0.16;

/** The ego-frame point the arm reaches for when the rundown row at `index` is highlighted. */
export function lobbyCursorTargetEgo(index: number): Vec3 {
  const i = Math.max(0, Math.min(ROWS - 1, index));
  const yaw = FAN_HALF_RAD - (2 * FAN_HALF_RAD * i) / (ROWS - 1);
  return [Math.cos(yaw) * CURSOR_REACH_M, Math.sin(yaw) * CURSOR_REACH_M, CURSOR_Z_M];
}
