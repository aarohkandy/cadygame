// src/game/loop/turbo-gate.ts (WP6 render gate, owned by the loop)
// TURBO (GAME_DESIGN 4.10 "RENDER ON | TURBO", 5.9 "turbo runs as fast as the policies reply"): an eval match
// with no human seat draws nothing at all, so the sim is limited by the policies and the physics rather than
// by the renderer. Two things have to happen the moment such a match owns the screen:
//
//   1. the render loop stops (R3F `frameloop: "never"`), and
//   2. something else drives the two frame priorities that are not drawing - `frameTick` (-2) and
//      `runAfterRender` (+2, the HUD runtime).
//
// Both are done here, synchronously, from the ui-store callback. That is the whole point of this module: the
// gate used to be a React prop (`frameloop={turbo ? "never" : "always"}`) fed by a `useState`, so it only shut
// after a render and a commit - and until it did, the canvas kept drawing full arena frames that the pump then
// had to wait behind. Measured headless on the homebase server (SwiftShader, one arena frame = seconds): a
// turbo match spent its first ~11 s drawing two frames, one rAF callback of 6.7 s and one of 4.4 s, during
// which the sim advanced 0.04 s in a 4 s window - a run that looks permanently crippled while it is only
// waiting for React. Switching the frameloop imperatively costs no round trip, so at most the one frame
// already in flight is drawn.
//
// The pump yields between bursts (a MessageChannel task by default; `setTimeout(0)` clamps to 4 ms once
// nested) so policy replies, aborts and UI events still land promptly. In turbo `frameTick` steps on a time
// budget, not on the delta it is given, so a long beat costs nothing but latency.
//
// A paused clock steps nothing, so the pump has nothing to do: a beat asks for `PAUSED_POLL_MS` before the
// next one instead of reposting immediately. Without that the pump spins the MessageChannel as fast as the
// event loop allows - measured headless on homebase at 30-40k empty frames a second, one core burned and the
// policy workers starved - while the match makes no progress at all. Each empty beat also ran the whole
// browser frame (director update, bus flush, feedback, HUD fill), so a pause cost far more than the match
// itself. The beat is skipped entirely rather than run with a zero delta: a paused clock freezes the frame,
// which is what pause means, and the wall delta is re-based each idle beat so resuming never delivers the
// length of the pause as one frame.

import type { GameHandle } from "../contracts.ts";

/** R3F's imperative frameloop switch, as `onCreated` hands it over. */
export type FrameloopMode = "always" | "never";

/** How often a pump with a paused clock looks again for the resume. */
export const PAUSED_POLL_MS = 50;

/**
 * Runs `beat` repeatedly, yielding to the event loop between beats, and returns a stop function. A beat
 * returns how many milliseconds to wait before the next one; 0 means "as soon as the event loop is free".
 * The first beat is always posted, never called inline: the gate can refresh from inside a `ui.set` the
 * director made from within `frameTick`, and a synchronous first beat would re-enter the loop it is being
 * started for.
 */
export type TaskLoop = (beat: () => number) => () => void;

export const messageChannelLoop: TaskLoop = (beat) => {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const channel = new MessageChannel();
  const post = () => channel.port2.postMessage(null);
  channel.port1.onmessage = () => {
    if (!live) return;
    let delay = 0;
    try {
      delay = beat();
    } finally {
      if (live) {
        if (delay > 0) timer = setTimeout(() => { timer = null; if (live) post(); }, delay);
        else post();
      }
    }
  };
  post();
  return () => {
    live = false;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
  };
};

export interface TurboGateDeps {
  game: GameHandle;
  /** Applied the instant the gate changes. A canvas that has not been created yet passes a no-op. */
  setFrameloop: (mode: FrameloopMode) => void;
  /** Mirrors the gate into React state so the Canvas prop agrees with the store it just switched. */
  onChange?: (turbo: boolean) => void;
  /** Wall clock in ms; tests pass their own. */
  now?: () => number;
  /** How the pump yields between beats. */
  taskLoop?: TaskLoop;
  /** A frame that throws is reported and the pump keeps going; the default writes to the console. */
  onError?: (err: unknown) => void;
}

export interface TurboGate {
  /** True while a turbo match owns the screen, which is exactly when the canvas stops drawing. */
  readonly turbo: boolean;
  /** Re-reads the game state and opens or shuts the gate. The ui subscription calls this. */
  refresh(): void;
  dispose(): void;
}

/** True when this game handle is showing a turbo match right now. */
export function turboOwnsScreen(game: GameHandle): boolean {
  return game.director.config?.turbo === true && game.ui.get().screen === "match";
}

export function createTurboGate(deps: TurboGateDeps): TurboGate {
  const { game } = deps;
  const now = deps.now ?? (() => performance.now());
  const taskLoop = deps.taskLoop ?? messageChannelLoop;
  // While the pump owns the loop nothing else drives the sim, so one throw used to end the match for good: the
  // next beat never ran, the frameloop was still "never", and the run sat at zero steps with no way back.
  // Report it and keep pumping; the next beat either recovers or throws again, visibly.
  const onError = deps.onError ?? ((err: unknown) => { console.error("turbo pump: frame failed", err); });

  let turbo = false;
  let stopPump: (() => void) | null = null;
  let disposed = false;
  let unsubscribe: () => void = () => {};

  function startPump(): () => void {
    let last = now();
    return taskLoop(() => {
      const t = now();
      if (game.clock.paused) { last = t; return PAUSED_POLL_MS; }
      try {
        game.frameTick((t - last) / 1000);
        game.runAfterRender();
      } catch (err) {
        onError(err);
      } finally {
        last = t;
      }
      return 0;
    });
  }

  const gate: TurboGate = {
    get turbo() { return turbo; },

    refresh(): void {
      if (disposed) return;
      const on = turboOwnsScreen(game);
      if (on === turbo) return;
      turbo = on;
      if (on) {
        // Shut the render loop first: a frame started between these two lines is a frame the pump waits behind.
        deps.setFrameloop("never");
        stopPump = startPump();
      } else {
        stopPump?.();
        stopPump = null;
        deps.setFrameloop("always");
      }
      deps.onChange?.(on);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      stopPump?.();
      stopPump = null;
      turbo = false;
    },
  };

  unsubscribe = game.ui.subscribe(() => gate.refresh());
  gate.refresh();
  return gate;
}
