// src/game/core/ui-store.ts (WP1)
// Low-rate UI state for React (GAME_DESIGN 10.5). Compatible with useSyncExternalStore: get() returns
// the same object until a set() actually changes a field, and every change produces a new object.
// Per-frame numbers never go through here; they live in the mutable HudFrame.

import type { UiState, UiStore } from "../contracts.ts";

export function defaultUiState(): UiState {
  return {
    screen: "boot",
    overlay: null,
    phase: "boot",
    loading: { progress: 0, label: "" },
    match: null,
    round: 0,
    roundsWon: { atlas: 0, blaze: 0 },
    captions: null,
    bestScore: null,
    lastEpisodeId: null,
    lastStats: null,
    replayMomentLabel: null,
    holdSkipProgress: 0,
    lockHoldRemainingMs: null,
    tutorialStep: null,
    error: null,
  };
}

export interface UiStoreExtras {
  /** Replaces the whole state (director teardown). Notifies once. */
  reset(state?: UiState): void;
}

export function createUiStore(initial?: Partial<UiState>): UiStore & UiStoreExtras {
  let state: Readonly<UiState> = Object.freeze({ ...defaultUiState(), ...initial });
  const listeners = new Set<() => void>();

  function notify(): void {
    // Copy so a listener that unsubscribes (or subscribes) during notification is handled cleanly.
    for (const fn of Array.from(listeners)) fn();
  }

  return {
    get: () => state,

    set(patch: Partial<UiState>): void {
      let changed = false;
      for (const key in patch) {
        const k = key as keyof UiState;
        if (!Object.is(state[k], patch[k])) { changed = true; break; }
      }
      if (!changed) return;
      state = Object.freeze({ ...state, ...patch });
      notify();
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    reset(next?: UiState): void {
      state = Object.freeze({ ...(next ?? defaultUiState()) });
      notify();
    },
  };
}
