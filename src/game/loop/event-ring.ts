// src/game/loop/event-ring.ts (WP1)
// Per-seat queue of events since that seat's last observation (GAME_DESIGN 10.3, WP1 acceptance 6).
// The sim-driver pushes every step's rules events; the observation builder drains one seat at its
// control tick. Events from steps after a seat's last tick of frame N are therefore delivered at
// frame N+1, and a seat with a slower decision rate still sees every event exactly once.
// Storage is a circular buffer per seat that doubles when full, so nothing is ever dropped and the
// steady state allocates nothing.

import type { GameEvent, Seat, SeatEventRing } from "../contracts.ts";

const INITIAL_CAPACITY = 64;

interface Ring { buf: (GameEvent | undefined)[]; head: number; size: number; }

function makeRing(capacity: number): Ring {
  return { buf: new Array<GameEvent | undefined>(capacity).fill(undefined), head: 0, size: 0 };
}

function pushOne(r: Ring, e: GameEvent): void {
  if (r.size === r.buf.length) {
    const grown = new Array<GameEvent | undefined>(r.buf.length * 2).fill(undefined);
    for (let i = 0; i < r.size; i++) grown[i] = r.buf[(r.head + i) % r.buf.length];
    r.buf = grown;
    r.head = 0;
  }
  r.buf[(r.head + r.size) % r.buf.length] = e;
  r.size++;
}

export interface SeatEventRingExtras {
  /** Events waiting for a seat's next observation. */
  pending(seat: Seat): number;
}

export function createSeatEventRing(capacity = INITIAL_CAPACITY): SeatEventRing & SeatEventRingExtras {
  const cap = Math.max(1, Math.floor(capacity));
  const rings: Record<Seat, Ring> = { atlas: makeRing(cap), blaze: makeRing(cap) };

  return {
    push(events: readonly GameEvent[], from: number): void {
      for (let i = Math.max(0, from); i < events.length; i++) {
        const e = events[i];
        pushOne(rings.atlas, e);
        pushOne(rings.blaze, e);
      }
    },

    drain(seat: Seat, out: GameEvent[]): number {
      const r = rings[seat];
      const n = r.size;
      for (let i = 0; i < n; i++) {
        const idx = (r.head + i) % r.buf.length;
        out.push(r.buf[idx] as GameEvent);
        r.buf[idx] = undefined;
      }
      r.head = 0;
      r.size = 0;
      return n;
    },

    clear(): void {
      for (const seat of ["atlas", "blaze"] as const) {
        const r = rings[seat];
        r.buf.fill(undefined);
        r.head = 0;
        r.size = 0;
      }
    },

    pending: (seat: Seat) => rings[seat].size,
  };
}
