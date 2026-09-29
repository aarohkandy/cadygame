// src/game/input/bindings.ts (WP3)
// Keyboard and mouse action map (GAME_DESIGN 3.3). Settings store only overrides (action id -> KeyboardEvent.code);
// an empty map means these defaults. Every gameplay action has a primary and an optional secondary code. Mouse
// buttons are not rebindable: LMB is always STRIKE and RMB is always GUARD, which keeps the flick hand's muscle memory
// identical across machines.

export const ACTION_IDS = [
  "reach_out", "reach_in", "stance_left", "stance_right",
  "grip", "overdrive", "ability", "roll_neg", "roll_pos",
  "strike_key", "guard_key",
  "stats", "pause", "rematch",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

/**
 * Actions that drive the arm. UI actions (stats, pause, rematch) are read by the UI layer, never by the pilot.
 * GAME_DESIGN 3.3 also lists C for the Optics picture-in-picture; that view is a render target off the arm's
 * camera mount, which SCOPE 2.2 cuts along with the policy image cameras, and 2.2 asks for no dead buttons
 * left behind for a cut feature - so there is no OPTICS row to rebind in SETTINGS and no key that does nothing.
 */
export const COMMAND_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>([
  "reach_out", "reach_in", "stance_left", "stance_right", "grip", "overdrive", "ability", "roll_neg", "roll_pos",
  "strike_key", "guard_key",
]);

export interface BindingDef {
  id: ActionId;
  label: string;               // caps, <= 3 words (settings rebinding table)
  primary: string;             // KeyboardEvent.code
  secondary: string | null;
  rebindable: boolean;
}

export const DEFAULT_BINDINGS: readonly BindingDef[] = [
  { id: "reach_out", label: "REACH OUT", primary: "KeyW", secondary: "ArrowUp", rebindable: true },
  { id: "reach_in", label: "REACH IN", primary: "KeyS", secondary: "ArrowDown", rebindable: true },
  { id: "stance_left", label: "STANCE LEFT", primary: "KeyA", secondary: "ArrowLeft", rebindable: true },
  { id: "stance_right", label: "STANCE RIGHT", primary: "KeyD", secondary: "ArrowRight", rebindable: true },
  { id: "grip", label: "GRIP", primary: "Space", secondary: null, rebindable: true },
  { id: "overdrive", label: "OVERDRIVE", primary: "ShiftLeft", secondary: "ShiftRight", rebindable: true },
  { id: "ability", label: "ABILITY", primary: "KeyF", secondary: null, rebindable: true },
  { id: "roll_neg", label: "ROLL LEFT", primary: "KeyQ", secondary: null, rebindable: true },
  { id: "roll_pos", label: "ROLL RIGHT", primary: "KeyE", secondary: null, rebindable: true },
  // Keyboard fallbacks for players without a two-button mouse (trackpads): same command path as LMB / RMB.
  { id: "strike_key", label: "STRIKE KEY", primary: "KeyJ", secondary: null, rebindable: true },
  { id: "guard_key", label: "GUARD KEY", primary: "KeyK", secondary: null, rebindable: true },
  { id: "stats", label: "STATS", primary: "Tab", secondary: null, rebindable: true },
  { id: "pause", label: "PAUSE", primary: "Escape", secondary: null, rebindable: false },
  { id: "rematch", label: "REMATCH", primary: "Enter", secondary: "KeyR", rebindable: true },
];

const BY_ID: ReadonlyMap<ActionId, BindingDef> = new Map(DEFAULT_BINDINGS.map((b) => [b.id, b]));

export function isActionId(v: string): v is ActionId {
  return (ACTION_IDS as readonly string[]).includes(v);
}

export function bindingDef(id: ActionId): BindingDef {
  const def = BY_ID.get(id);
  if (!def) throw new RangeError(`unknown action ${id}`);
  return def;
}

/** Codes that must never be bound to a gameplay action (the browser or OS owns them). */
export const RESERVED_CODES: ReadonlySet<string> = new Set(["Escape", "MetaLeft", "MetaRight", "F5", "F11", "F12"]);

export interface ResolvedBindings {
  /** KeyboardEvent.code -> action ids (a code may serve one action; overrides replace the primary). */
  readonly byCode: ReadonlyMap<string, ActionId>;
  /** Action -> codes, for the settings table and the controls legend. */
  readonly codesOf: ReadonlyMap<ActionId, readonly string[]>;
}

/**
 * Applies overrides on top of the defaults. An override replaces the primary code; if another action used that code
 * as its primary or secondary, that action loses the code (last writer wins, like every PC rebinding screen).
 * Invalid overrides (unknown action, reserved code, non-rebindable action) are ignored.
 */
export function resolveBindings(overrides: Readonly<Record<string, string>>): ResolvedBindings {
  const codes = new Map<ActionId, string[]>();
  for (const b of DEFAULT_BINDINGS) codes.set(b.id, b.secondary ? [b.primary, b.secondary] : [b.primary]);
  for (const [id, code] of Object.entries(overrides)) {
    if (!isActionId(id) || typeof code !== "string" || code.length === 0) continue;
    if (!bindingDef(id).rebindable || RESERVED_CODES.has(code)) continue;
    for (const [other, list] of codes) {
      if (other === id) continue;
      const i = list.indexOf(code);
      if (i >= 0) list.splice(i, 1);
    }
    const list = codes.get(id) as string[];
    const secondary = list.length > 1 ? list[1] : null;
    codes.set(id, secondary && secondary !== code ? [code, secondary] : [code]);
  }
  const byCode = new Map<string, ActionId>();
  for (const [id, list] of codes) for (const c of list) if (!byCode.has(c)) byCode.set(c, id);
  return { byCode, codesOf: codes };
}

/** Human-readable key name for legends: "KeyW" -> "W", "ShiftLeft" -> "SHIFT", "ArrowUp" -> "UP". */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase();
  if (code.startsWith("Shift")) return "SHIFT";
  if (code.startsWith("Control")) return "CTRL";
  if (code.startsWith("Alt")) return "ALT";
  if (code === "Space") return "SPACE";
  if (code === "Escape") return "ESC";
  return code.toUpperCase();
}
