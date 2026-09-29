// src/game/combat/core-objective.ts (WP5)
// The Core (GAME_DESIGN 2.5 as amended by BUILD_PLAN D8): incoming, drop, dock, lock-in, contested, steal, lock.
//
// The countdown belongs to the Core, not the seat. A steal pauses it and marks the Core loose; whoever next docks it in
// their own dock owns it and resumes from the remaining time, clamped to that seat's full lock-in (8 / 6 underdog /
// 4 sudden death). The first dock of an unowned Core starts a fresh lock-in.
//
// Steal tests:
//   (a) the design's pry test, unchanged: the owner's docked Core (progress > 0) leaves the dock (outside the radius or
//       above 35 mm for ≥ 100 ms) and the last gripper geom to touch it within 300 ms was the opponent's;
//   (b) an owned Core with progress that is already outside its owner's dock is grabbed by the opponent (both jaws).
//       Without (b) a Core the owner fumbled out of its own dock could never change hands, and a grab is the steal
//       players read anyway.
import type {
  CoreMutationRequest, CoreState, GameEvent, PhysicsFrame, RulesConfig, Seat,
} from "../contracts.ts";
import { otherSeat } from "../contracts.ts";
import { tuning } from "./tuning.ts";

const C = tuning.core;
const SEAT_OF_INDEX: readonly Seat[] = ["atlas", "blaze"];

export interface CoreObjective {
  readonly state: CoreState;
  reset(cfg: RulesConfig, suddenDeath: boolean): void;
  /**
   * One live step. `integrity` feeds the Arcade Core bias at the drop. Returns the seat that locked this step, or null.
   */
  step(frame: PhysicsFrame, fightTimeS: number, integrity: Readonly<Record<Seat, number>>, t: number, step: number,
       emit: (e: GameEvent) => void, place: (r: CoreMutationRequest) => void): Seat | null;
  readonly lockInHeldS: Readonly<Record<Seat, number>>;   // round totals of countdown time run per owner
}

export function createCoreObjective(): CoreObjective {
  const state: CoreState = {
    phase: "dormant", owner: null, dockedIn: null, lockInRemainingS: 0, lockInTotalS: 0,
    contested: false, loose: false, stolenFrom: null, lastTouchedBy: null,
  };
  let cfg: RulesConfig | null = null;
  const holdS: Record<Seat, number> = { atlas: 0, blaze: 0 };
  let leaveS = 0;
  const lockInHeldS: Record<Seat, number> = { atlas: 0, blaze: 0 };

  function event(stage: Extract<GameEvent, { type: "core" }>["stage"], t: number, step: number, seat: Seat | null, from: Seat | null,
                 extra: { late?: boolean; inherited?: boolean } = {}): GameEvent {
    return { type: "core", t, step, stage, seat, from, remainingS: state.lockInRemainingS, late: extra.late ?? false, inherited: extra.inherited ?? false };
  }

  function steal(by: Seat, t: number, step: number, emit: (e: GameEvent) => void): void {
    const from = state.owner;
    state.loose = true;
    state.stolenFrom = from;
    state.dockedIn = null;
    holdS.atlas = 0; holdS.blaze = 0;
    leaveS = 0;
    if (state.contested) { state.contested = false; emit(event("contested_off", t, step, by, from)); }
    emit(event("steal", t, step, by, from, { late: state.lockInRemainingS <= C.lateStealS + 1e-9 }));
  }

  return {
    state,
    lockInHeldS,
    reset(c, suddenDeath) {
      cfg = c;
      state.phase = "dormant"; state.owner = null; state.dockedIn = null;
      state.lockInRemainingS = 0; state.lockInTotalS = 0;
      state.contested = false; state.loose = false; state.stolenFrom = null; state.lastTouchedBy = null;
      holdS.atlas = 0; holdS.blaze = 0; leaveS = 0;
      if (!suddenDeath) { lockInHeldS.atlas = 0; lockInHeldS.blaze = 0; }
    },
    step(frame, fightTimeS, integrity, t, step, emit, place) {
      if (!cfg) return null;
      const dt = frame.dt;
      if (state.phase === "dormant") {
        if (cfg.coreIncomingAtS < cfg.coreDropAtS && fightTimeS >= cfg.coreIncomingAtS) {
          state.phase = "incoming";
          emit(event("incoming", t, step, null, null));
        } else if (fightTimeS >= cfg.coreDropAtS) {
          state.phase = "incoming";
        } else {
          return null;
        }
      }
      if (state.phase === "incoming") {
        if (fightTimeS < cfg.coreDropAtS) return null;
        let biasX = 0;
        if (cfg.comebacks && Math.abs(integrity.atlas - integrity.blaze) >= C.biasIntegrityGap) {
          biasX = integrity.atlas < integrity.blaze ? -C.biasM : C.biasM;
        }
        place({ cube: C.cube, pos: [biasX, 0, C.dropZ] });
        state.phase = "live";
        emit(event("drop", t, step, null, null));
        return null;
      }

      const i3 = C.cube * 3;
      const px = frame.cubes.pos[i3], py = frame.cubes.pos[i3 + 1], pz = frame.cubes.pos[i3 + 2];
      const vx = frame.cubes.linvel[i3], vy = frame.cubes.linvel[i3 + 1], vz = frame.cubes.linvel[i3 + 2];
      const speed = Math.hypot(vx, vy, vz);
      const touch = frame.active.lastGripperTouch;
      if (touch.cube[C.cube] >= 0) state.lastTouchedBy = SEAT_OF_INDEX[touch.cube[C.cube]];

      const inDock = (s: Seat) => {
        const k = s === "atlas" ? 0 : 3;
        return Math.hypot(px - frame.docks[k], py - frame.docks[k + 1]) <= C.dockRadius && pz < C.dockZMax;
      };

      // Leaving the dock that holds it.
      if (state.dockedIn) {
        const holder = state.dockedIn;
        if (inDock(holder)) {
          leaveS = 0;
        } else {
          leaveS += dt;
          if (leaveS >= C.leaveHoldMs / 1000 - 1e-9) {
            const opp = otherSeat(holder);
            const progress = state.lockInRemainingS < state.lockInTotalS - 1e-9;
            const oppTouched = touch.cube[C.cube] === (opp === "atlas" ? 0 : 1) && t - touch.t[C.cube] <= C.stealTouchWindowMs / 1000 + 1e-9;
            if (holder === state.owner && !state.loose && progress && oppTouched) {
              steal(opp, t, step, emit);
            } else {
              state.dockedIn = null;
              leaveS = 0;
              if (state.contested) { state.contested = false; emit(event("contested_off", t, step, holder, null)); }
            }
          }
        }
      }

      // Grab steal outside the owner's dock.
      if (state.owner && !state.loose && state.dockedIn !== state.owner && state.lockInRemainingS < state.lockInTotalS - 1e-9) {
        const opp = otherSeat(state.owner);
        if (frame.active.bothJawsOnCube[opp] === C.cube) steal(opp, t, step, emit);
      }

      // Settling into a dock.
      for (const s of ["atlas", "blaze"] as const) {
        if (state.dockedIn === s) continue;
        if (inDock(s) && speed < C.dockSpeedMax) holdS[s] += dt; else holdS[s] = 0;
        if (holdS[s] < C.dockHoldMs / 1000 - 1e-9 || state.dockedIn) continue;
        state.dockedIn = s;
        leaveS = 0;
        if (state.owner === null) {
          state.owner = s;
          state.lockInTotalS = cfg.lockInS[s];
          state.lockInRemainingS = state.lockInTotalS;
          emit(event("lock_in_start", t, step, s, null));
        } else if (state.loose) {
          const previousOwner = state.stolenFrom ?? state.owner;
          state.owner = s;
          state.lockInTotalS = cfg.lockInS[s];
          state.lockInRemainingS = Math.min(state.lockInRemainingS, state.lockInTotalS);
          state.loose = false;
          state.stolenFrom = null;
          emit(event("lock_in_resume", t, step, s, previousOwner, { inherited: s !== previousOwner }));
        } else if (s === state.owner) {
          emit(event("lock_in_resume", t, step, s, s, { inherited: false }));
        }
      }

      // Countdown and contest.
      // The clock stops the moment the Core is out of the dock zone; the 100 ms hold only decides whether it has "left".
      const running = state.dockedIn !== null && state.dockedIn === state.owner && !state.loose && inDock(state.dockedIn);
      if (running && state.owner) {
        const opp = otherSeat(state.owner);
        const ee = frame.arms[opp].eePos;
        const near = Math.hypot(ee[0] - px, ee[1] - py, ee[2] - pz) <= C.contestRadius;
        if (near !== state.contested) {
          state.contested = near;
          emit(event(near ? "contested_on" : "contested_off", t, step, opp, state.owner));
        }
        const before = state.lockInRemainingS;
        state.lockInRemainingS = Math.max(0, before - dt);
        lockInHeldS[state.owner] += before - state.lockInRemainingS;
        if (state.lockInRemainingS <= 1e-9) {
          state.lockInRemainingS = 0;
          if (state.contested) { state.contested = false; emit(event("contested_off", t, step, opp, state.owner)); }
          emit(event("lock", t, step, state.owner, null));
          return state.owner;
        }
      } else if (state.contested) {
        state.contested = false;
        emit(event("contested_off", t, step, state.owner ? otherSeat(state.owner) : null, state.owner));
      }
      return null;
    },
  };
}
