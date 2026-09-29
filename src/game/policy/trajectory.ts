// src/game/policy/trajectory.ts (WP4)
// JSON trajectory entrants (GAME_DESIGN 5.2): `{ "fps": 1–240, "frames": [[6 joint targets], …] }` with at most
// 100,000 frames, sampled by linear interpolation on round time (sim time since the round's first observation)
// and holding the last frame after the end. The sampler answers every decision with a chunk at the control
// rate covering the decision period plus one tick, so a 240 fps recording is not decimated to 25 Hz.

import type { Observation, PolicyAction, ResetContext } from "../contracts.ts";

export const TRAJECTORY_MAX_FRAMES = 100_000;
export const TRAJECTORY_FPS_RANGE: readonly [number, number] = [1, 240];

export interface Trajectory {
  fps: number;
  /** Flat, 6 per frame. */
  frames: Float64Array;
  frameCount: number;
  name: string | null;
  durationS: number;
}

export class TrajectoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrajectoryFormatError";
  }
}

/** Parses and validates a trajectory file. Throws TrajectoryFormatError with a short, specific reason. */
export function parseTrajectory(json: string): Trajectory {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (err) {
    throw new TrajectoryFormatError(`not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new TrajectoryFormatError("expected an object with fps and frames");
  const o = doc as Record<string, unknown>;
  const fps = o.fps;
  if (typeof fps !== "number" || !Number.isFinite(fps)) throw new TrajectoryFormatError("fps is missing or not a number");
  if (fps < TRAJECTORY_FPS_RANGE[0] || fps > TRAJECTORY_FPS_RANGE[1]) throw new TrajectoryFormatError(`fps ${fps} is outside ${TRAJECTORY_FPS_RANGE[0]}–${TRAJECTORY_FPS_RANGE[1]}`);
  const frames = o.frames;
  if (!Array.isArray(frames)) throw new TrajectoryFormatError("frames is missing or not an array");
  if (frames.length === 0) throw new TrajectoryFormatError("frames is empty");
  if (frames.length > TRAJECTORY_MAX_FRAMES) throw new TrajectoryFormatError(`${frames.length} frames, max ${TRAJECTORY_MAX_FRAMES}`);
  const flat = new Float64Array(frames.length * 6);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!Array.isArray(f) || f.length !== 6) throw new TrajectoryFormatError(`frame ${i} has ${Array.isArray(f) ? f.length : 0} values, expected 6`);
    for (let j = 0; j < 6; j++) {
      const v = f[j];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new TrajectoryFormatError(`frame ${i} joint ${j} is not a finite number`);
      flat[i * 6 + j] = v;
    }
  }
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 64) : null;
  return { fps, frames: flat, frameCount: frames.length, name, durationS: (frames.length - 1) / fps };
}

/** Linear interpolation at time t (s) from the start; clamps to the first and last frames. */
export function sampleTrajectory(tr: Trajectory, t: number, out: number[] | Float64Array): void {
  const x = Math.max(0, t) * tr.fps;
  const i0 = Math.min(tr.frameCount - 1, Math.floor(x));
  const i1 = Math.min(tr.frameCount - 1, i0 + 1);
  const a = i1 === i0 ? 0 : x - i0;
  for (let j = 0; j < 6; j++) {
    const v0 = tr.frames[i0 * 6 + j], v1 = tr.frames[i1 * 6 + j];
    out[j] = v0 + (v1 - v0) * a;
  }
}

/** A trajectory as a policy: reset marks the round start, act returns the chunk for the coming decision period. */
export function createTrajectoryPolicy(tr: Trajectory): { reset(ctx: ResetContext): void; act(obs: Observation): PolicyAction } {
  let roundStartT: number | null = null;
  let controlHz = 50;
  let decisionHz = 25;
  return {
    reset(ctx) {
      roundStartT = null;
      controlHz = ctx.control_hz;
      decisionHz = ctx.decision_hz > 0 ? ctx.decision_hz : ctx.control_hz;
    },
    act(obs) {
      if (roundStartT === null || obs.t < roundStartT) roundStartT = obs.t;
      const n = Math.max(2, Math.round(controlHz / decisionHz) + 1);
      const chunk: number[][] = new Array(n);
      for (let k = 0; k < n; k++) {
        const row = [0, 0, 0, 0, 0, 0];
        sampleTrajectory(tr, obs.t - roundStartT + k / controlHz, row);
        chunk[k] = row;
      }
      return { targets: chunk[0].slice(), chunk, chunkHz: controlHz, chunkStartT: obs.t };
    },
  };
}
