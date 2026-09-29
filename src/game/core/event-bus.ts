// src/game/core/event-bus.ts (WP1)
// Per-frame event delivery (GAME_DESIGN 10.3, 10.5). Rules events arrive from the sim-driver through
// pushStepEvents; the director and seat drivers queue their own with emit. flush(ctx) hands every
// subscriber the frame's events exactly once, ordered by physics step (stable for equal steps), then
// clears. The hot path allocates nothing: two reusable arrays are swapped around each delivery.

import type { EventBus, FeedbackContext, GameEvent } from "../contracts.ts";

type Listener = (events: readonly GameEvent[], ctx: FeedbackContext) => void;

/** Stable in-place insertion sort by step. Frame batches are small and almost always already ordered. */
function sortByStep(events: GameEvent[]): void {
  for (let i = 1; i < events.length; i++) {
    const e = events[i];
    let j = i - 1;
    if (events[j].step <= e.step) continue;
    while (j >= 0 && events[j].step > e.step) {
      events[j + 1] = events[j];
      j--;
    }
    events[j + 1] = e;
  }
}

export interface EventBusExtras {
  /** Events queued for the next flush (debug overlays and tests). */
  readonly pendingCount: number;
  /** Drops everything queued without delivering it (match teardown, replay entry). */
  clearPending(): void;
}

export function createEventBus(): EventBus & EventBusExtras {
  let pending: GameEvent[] = [];
  let delivering: GameEvent[] = [];
  const listeners: Listener[] = [];
  let snapshot: Listener[] = [];
  let snapshotDirty = false;
  let flushing = false;

  return {
    emit(e: GameEvent): void {
      pending.push(e);
    },

    pushStepEvents(events: readonly GameEvent[], from: number): void {
      for (let i = Math.max(0, from); i < events.length; i++) pending.push(events[i]);
    },

    flush(ctx: FeedbackContext): void {
      if (flushing) throw new Error("EventBus.flush is not re-entrant: a subscriber called flush");
      if (pending.length === 0) return;
      // Swap buffers so a subscriber that emits queues into the next frame instead of this delivery.
      const batch = pending;
      pending = delivering;
      delivering = batch;
      sortByStep(batch);
      if (snapshotDirty) {
        snapshot = listeners.slice();
        snapshotDirty = false;
      }
      const current = snapshot;
      flushing = true;
      let firstError: unknown = null;
      let failed = false;
      try {
        for (let i = 0; i < current.length; i++) {
          try {
            current[i](batch, ctx);
          } catch (err) {
            // One broken subscriber must not starve the others of this frame's events.
            if (!failed) { failed = true; firstError = err; }
          }
        }
      } finally {
        flushing = false;
        batch.length = 0;
      }
      if (failed) throw firstError;
    },

    subscribe(fn: Listener): () => void {
      listeners.push(fn);
      snapshotDirty = true;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
        snapshotDirty = true;
      };
    },

    get pendingCount(): number {
      return pending.length;
    },

    clearPending(): void {
      pending.length = 0;
    },
  };
}
