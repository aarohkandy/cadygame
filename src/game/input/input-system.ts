// src/game/input/input-system.ts (WP3)
// Raw keyboard and mouse input: pointer lock with unadjustedMovement, pointerrawupdate deltas, the RE-ARMING retry,
// key and button edges resolved through the binding map (GAME_DESIGN 3.3). This layer never shapes a command. It
// accumulates deltas and queues edges; the pilot controller drains them once per sampled frame, so a delta that
// arrives before sampleFrame is in that frame's command, and deltas that arrive during a hit stop simply wait.
// Synthetic input (proxy bots) calls the same handle* entry points, so both paths produce identical commands.

import type { InputDevice } from "../contracts.ts";
import { resolveBindings, type ActionId, type ResolvedBindings } from "./bindings.ts";

/** Everything the pilot can hold or press. Mouse LMB and the strike key both map to "strike". */
export type CommandInput =
  | "strike" | "guard" | "reach_out" | "reach_in" | "stance_left" | "stance_right"
  | "grip" | "overdrive" | "ability" | "roll_neg" | "roll_pos";

export type UiInput = "stats" | "pause" | "rematch";

export interface RawEdge { input: CommandInput; down: boolean; atMs: number; device: InputDevice }

const ACTION_TO_INPUT: Partial<Record<ActionId, CommandInput>> = {
  reach_out: "reach_out", reach_in: "reach_in", stance_left: "stance_left", stance_right: "stance_right",
  grip: "grip", overdrive: "overdrive", ability: "ability", roll_neg: "roll_neg", roll_pos: "roll_pos",
  strike_key: "strike", guard_key: "guard",
};
const ACTION_TO_UI: Partial<Record<ActionId, UiInput>> = { stats: "stats", pause: "pause", rematch: "rematch" };

/** Pointer-lock retry delay after a rejected request (Chrome refuses a re-lock for about 1 s after a user exit). */
export const RELOCK_RETRY_MS = 1100;
const LOCK_WAIT_MS = 1500;

export interface InputSystem {
  readonly locked: boolean;
  readonly rearming: boolean;
  /** Device that produced the most recent meaningful input through this system. */
  readonly lastDevice: InputDevice;
  /** Milliseconds on the pilot's sampled wall clock; edges are stamped with it. */
  nowMs: number;

  handleKey(code: string, down: boolean, device?: InputDevice): boolean;   // true when the code is bound
  handleButton(button: number, down: boolean, device?: InputDevice): void;
  handleMove(dx: number, dy: number, device?: InputDevice): void;
  handleWheel(deltaY: number, device?: InputDevice): void;
  /** Gamepad and touch buttons: a held source named by device and input, same edge path as keys. */
  handleVirtual(input: CommandInput, down: boolean, device: InputDevice): void;
  /** A UI press with no hold behind it (a pad's Menu button, a synthetic tap). Counts once. */
  handleUi(input: UiInput): void;
  /**
   * A UI input held down by a device, so `isUiHeld` reports it for as long as the button is down. The press
   * edge also counts for `consumeUi`, so a hold is a press to anything that only wants the tap.
   */
  handleUiHold(input: UiInput, down: boolean, device: InputDevice): void;
  /** Releases every held source of one device (a pad disconnects, all touches end). */
  releaseDevice(device: InputDevice): void;
  releaseAll(): void;

  isHeld(input: CommandInput): boolean;
  /** Takes accumulated pointer counts since the last take. */
  takeMove(out: { dx: number; dy: number }): { dx: number; dy: number };
  /** Takes accumulated wheel notches (positive = wheel down = tool pitch down). */
  takeWheel(): number;
  /** Moves queued edges into `out` (appends) and clears the queue. */
  drainEdges(out: RawEdge[]): RawEdge[];
  /** Drops accumulated pointer counts and wheel notches (mode changes, lock regained). */
  discardMotion(): void;
  /** UI presses since the last consume (Esc, Tab, Enter/R). */
  consumeUi(input: UiInput): number;
  /** True while any device holds this UI input down (STATS is a hold, not a tap). */
  isUiHeld(input: UiInput): boolean;

  setBindings(overrides: Readonly<Record<string, string>>): void;
  attach(target: HTMLElement): void;
  detach(): void;
  requestLock(): Promise<boolean>;
  onLockChange(fn: (locked: boolean) => void): () => void;
  /**
   * Called synchronously inside every pointer motion event with the counts moved and whether the horizontal
   * direction reversed (EMOTION_BIBLE section 6 "Command": the servo whine starts here, ≤ 5 ms, never on the
   * next rAF; the reversal is the 12 ms haptic tick).
   */
  onMotion(fn: (counts: number, reversed: boolean) => void): () => void;
}

interface DomRefs {
  target: HTMLElement;
  doc: Document | null;
  win: (Window & typeof globalThis) | null;
  cleanup: (() => void)[];
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el !== "object" || !("tagName" in el)) return false;
  const tag = String(el.tagName).toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export function createInputSystem(overrides: Readonly<Record<string, string>> = {}): InputSystem {
  let bindings: ResolvedBindings = resolveBindings(overrides);
  const sources = new Map<string, CommandInput>();       // "key:KeyW" | "btn:0" -> input
  const heldCount = new Map<CommandInput, number>();
  const edges: RawEdge[] = [];
  const ui: Record<UiInput, number> = { stats: 0, pause: 0, rematch: 0 };
  // UI inputs are held the same way commands are, so the STATS overlay follows the button rather than
  // guessing from a press count, and a pad that disconnects mid-hold releases it like any other source.
  const uiSources = new Map<string, UiInput>();
  const uiHeldCount = new Map<UiInput, number>();
  let dx = 0;
  let dy = 0;
  let wheel = 0;
  let locked = false;
  let rearming = false;
  let dropNextMove = false;
  let lastDevice: InputDevice = "keyboard_mouse";
  let dom: DomRefs | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const lockListeners = new Set<(locked: boolean) => void>();
  const motionListeners = new Set<(counts: number, reversed: boolean) => void>();
  let lastDxSign = 0;

  function press(source: string, input: CommandInput, device: InputDevice): void {
    if (sources.has(source)) return;                     // key repeat or duplicate down
    sources.set(source, input);
    const n = (heldCount.get(input) ?? 0) + 1;
    heldCount.set(input, n);
    lastDevice = device;
    if (n === 1) edges.push({ input, down: true, atMs: sys.nowMs, device });
  }

  function uiPress(source: string, input: UiInput, device: InputDevice): void {
    if (uiSources.has(source)) return;                   // key repeat or duplicate down
    uiSources.set(source, input);
    const n = (uiHeldCount.get(input) ?? 0) + 1;
    uiHeldCount.set(input, n);
    lastDevice = device;
    if (n === 1) ui[input]++;
  }

  function uiRelease(source: string): void {
    const input = uiSources.get(source);
    if (!input) return;
    uiSources.delete(source);
    uiHeldCount.set(input, Math.max(0, (uiHeldCount.get(input) ?? 0) - 1));
  }

  function release(source: string, device: InputDevice): void {
    const input = sources.get(source);
    if (!input) return;
    sources.delete(source);
    const n = Math.max(0, (heldCount.get(input) ?? 0) - 1);
    heldCount.set(input, n);
    if (n === 0) edges.push({ input, down: false, atMs: sys.nowMs, device });
  }

  function setLocked(on: boolean): void {
    if (locked === on) return;
    locked = on;
    if (on) {
      rearming = false;
      dropNextMove = true;                                 // 3.3: the first event after a lock is dropped
      dx = 0; dy = 0; wheel = 0;
    } else {
      sys.releaseAll();
    }
    for (const fn of lockListeners) fn(on);
  }

  const sys: InputSystem = {
    get locked() { return locked; },
    get rearming() { return rearming; },
    get lastDevice() { return lastDevice; },
    nowMs: 0,

    handleKey(code, down, device = "keyboard_mouse") {
      const action = bindings.byCode.get(code);
      if (!action) return false;
      const input = ACTION_TO_INPUT[action];
      const source = `key:${code}`;
      if (input) {
        if (down) press(source, input, device); else release(source, device);
        return true;
      }
      const uiInput = ACTION_TO_UI[action];
      if (uiInput) { if (down) uiPress(source, uiInput, device); else uiRelease(source); }
      return true;
    },

    handleButton(button, down, device = "keyboard_mouse") {
      const input: CommandInput | null = button === 0 ? "strike" : button === 2 ? "guard" : null;
      if (!input) return;
      const source = `btn:${button}`;
      if (down) press(source, input, device); else release(source, device);
    },

    handleMove(mx, my, device = "keyboard_mouse") {
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
      if (dropNextMove) { dropNextMove = false; return; }
      dx += mx; dy += my;
      if (mx === 0 && my === 0) return;
      lastDevice = device;
      const sign = Math.sign(mx);
      const reversed = sign !== 0 && lastDxSign !== 0 && sign !== lastDxSign;
      if (sign !== 0) lastDxSign = sign;
      if (motionListeners.size > 0) for (const fn of motionListeners) fn(Math.abs(mx) + Math.abs(my), reversed);
    },

    handleWheel(deltaY, device = "keyboard_mouse") {
      if (!Number.isFinite(deltaY) || deltaY === 0) return;
      wheel += deltaY > 0 ? 1 : -1;
      lastDevice = device;
    },

    handleVirtual(input, down, device) {
      const source = `v:${device}:${input}`;
      if (down) press(source, input, device); else release(source, device);
    },

    handleUi(input) { ui[input]++; },

    handleUiHold(input, down, device) {
      const source = `v:${device}:ui:${input}`;
      if (down) uiPress(source, input, device); else uiRelease(source);
    },

    releaseDevice(device) {
      const prefix = `v:${device}:`;
      for (const source of [...sources.keys()]) if (source.startsWith(prefix)) release(source, device);
      for (const source of [...uiSources.keys()]) if (source.startsWith(prefix)) uiRelease(source);
    },

    releaseAll() {
      for (const source of [...sources.keys()]) release(source, lastDevice);
      for (const source of [...uiSources.keys()]) uiRelease(source);
    },

    isHeld(input) { return (heldCount.get(input) ?? 0) > 0; },

    takeMove(out) {
      out.dx = dx; out.dy = dy;
      dx = 0; dy = 0;
      return out;
    },

    takeWheel() {
      const n = wheel;
      wheel = 0;
      return n;
    },

    drainEdges(out) {
      for (const e of edges) out.push(e);
      edges.length = 0;
      return out;
    },

    discardMotion() { dx = 0; dy = 0; wheel = 0; },

    consumeUi(input) {
      const n = ui[input];
      ui[input] = 0;
      return n;
    },

    isUiHeld(input) { return (uiHeldCount.get(input) ?? 0) > 0; },

    setBindings(next) {
      sys.releaseAll();
      bindings = resolveBindings(next);
    },

    attach(target) {
      if (dom) sys.detach();
      const doc = (target.ownerDocument ?? (globalThis as { document?: Document }).document ?? null) as Document | null;
      const win = (doc?.defaultView ?? null) as (Window & typeof globalThis) | null;
      const refs: DomRefs = { target, doc, win, cleanup: [] };
      const on = (el: EventTarget | null | undefined, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
        if (!el) return;
        el.addEventListener(type, fn, opts);
        refs.cleanup.push(() => el.removeEventListener(type, fn, opts));
      };

      const moveType = "onpointerrawupdate" in target ? "pointerrawupdate" : "pointermove";
      on(target, moveType, (e) => {
        if (!locked) return;
        const pe = e as PointerEvent;
        sys.handleMove(pe.movementX ?? 0, pe.movementY ?? 0);
      });
      on(target, "mousedown", (e) => {
        // A click on the arena is the universal way back into control, whether the lock was never granted or was lost.
        if (!locked) { void sys.requestLock(); return; }
        const me = e as MouseEvent;
        me.preventDefault();
        sys.handleButton(me.button, true);
      });
      on(doc ?? target, "mouseup", (e) => {
        const me = e as MouseEvent;
        sys.handleButton(me.button, false);
      });
      on(target, "contextmenu", (e) => { e.preventDefault(); });
      on(target, "wheel", (e) => {
        if (!locked) return;
        e.preventDefault();
        sys.handleWheel((e as WheelEvent).deltaY);
      }, { passive: false });
      on(doc ?? target, "keydown", (e) => {
        const ke = e as KeyboardEvent;
        if (ke.repeat || isEditable(ke.target)) return;
        const bound = sys.handleKey(ke.code, true);
        if (bound && locked && ke.code !== "Escape") ke.preventDefault();
      });
      on(doc ?? target, "keyup", (e) => {
        const ke = e as KeyboardEvent;
        sys.handleKey(ke.code, false);
      });
      on(doc, "pointerlockchange", () => { setLocked(doc?.pointerLockElement === target); });
      on(doc, "pointerlockerror", () => { if (!locked) rearming = true; });
      on(win, "blur", () => { sys.releaseAll(); });
      dom = refs;
      if (doc) setLocked(doc.pointerLockElement === target);
    },

    detach() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (!dom) return;
      for (const fn of dom.cleanup) fn();
      dom = null;
      sys.releaseAll();
      locked = false;
      rearming = false;
    },

    async requestLock() {
      const refs = dom;
      if (!refs || !refs.doc) return false;
      if (locked) return true;
      const attempt = async (): Promise<boolean> => {
        const el = refs.target as HTMLElement & { requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void };
        const waitForResult = new Promise<boolean>((resolve) => {
          const doc = refs.doc as Document;
          const done = (ok: boolean) => {
            doc.removeEventListener("pointerlockchange", onChange);
            doc.removeEventListener("pointerlockerror", onError);
            clearTimeout(timer);
            resolve(ok);
          };
          const onChange = () => { if (doc.pointerLockElement === refs.target) done(true); };
          const onError = () => done(false);
          const timer = setTimeout(() => done(doc.pointerLockElement === refs.target), LOCK_WAIT_MS);
          doc.addEventListener("pointerlockchange", onChange);
          doc.addEventListener("pointerlockerror", onError);
        });
        try {
          const r = el.requestPointerLock({ unadjustedMovement: true });
          if (r && typeof (r as Promise<void>).then === "function") await r;
        } catch (err) {
          // Raw input unsupported on this platform (Linux, some Safari builds): fall back to a plain lock.
          if ((err as { name?: string })?.name === "NotSupportedError") {
            try {
              const r2 = el.requestPointerLock();
              if (r2 && typeof (r2 as Promise<void>).then === "function") await r2;
            } catch { return false; }
          } else {
            return false;
          }
        }
        return waitForResult;
      };
      if (await attempt()) return true;
      if (!dom) return false;
      rearming = true;
      return new Promise<boolean>((resolve) => {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void attempt().then((ok) => {
            rearming = false;
            // ponytail: some hosts (embedded webviews, iframes, locked-down browsers) refuse pointer lock
            // outright. Rather than leave the player unable to fight, take input unlocked: movementX/Y
            // still arrive on pointermove over the canvas, the cursor just stays visible.
            if (!ok && dom) { setLocked(true); ok = true; }
            resolve(ok);
          });
        }, RELOCK_RETRY_MS);
      });
    },

    onLockChange(fn) {
      lockListeners.add(fn);
      return () => { lockListeners.delete(fn); };
    },

    onMotion(fn) {
      motionListeners.add(fn);
      return () => { motionListeners.delete(fn); };
    },
  };
  return sys;
}
