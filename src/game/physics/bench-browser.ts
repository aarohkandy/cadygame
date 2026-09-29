// src/game/physics/bench-browser.ts (WP2)
// The physics cost bench (GAME_DESIGN 4.10 bench gate): wall ms per 16.7 ms of sim with both arms pressed together,
// so the contact walk runs every step. `?debug=bench` runs it in the browser; scripts/bench-physics.mjs runs the same
// function in Node.
import type { CreatePhysicsEngine, PhysicsMode, So101Kinematics } from "../contracts.ts";
import { createKinematics } from "../kinematics/so101-kinematics.ts";
import { createPhysicsEngine } from "./engine.ts";

export const BENCH_GATE_P95_MS = 1.2;
export const BENCH_FRAME_SIM_S = 1 / 60;

export interface BenchModeResult {
  mode: PhysicsMode; timestep: number; stepsPerFrame: number; frames: number;
  p50Ms: number; p95Ms: number; maxMs: number; contactFrac: number; pass: boolean;
}

export interface BenchReport {
  bench: "torquelimit.physics-bench/1";
  gateP95Ms: number; pass: boolean;
  modes: BenchModeResult[];
  mujoco: string; userAgent: string; date: string;
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Times one physics mode with both grippers driven into the same point between the mounts. */
export async function benchEngineCost(
  createEngine: CreatePhysicsEngine, kinematics: So101Kinematics, mode: PhysicsMode,
  opts: { frames?: number; nodeFsRoot?: string } = {},
): Promise<BenchModeResult & { mujoco: string }> {
  const frames = opts.frames ?? 600;
  const timestep = mode === "arcade" ? 0.0025 : 0.005;
  const engine = await createEngine({ mode, nodeFsRoot: opts.nodeFsRoot });
  try {
    const home = kinematics.commandToJoints(kinematics.homeCommand(), new Float64Array(6));
    engine.reset({ mode, timestep, seed: 1, loadouts: { atlas: "pivot", blaze: "pivot" }, homePose: { atlas: home, blaze: home }, layout: "duel" });
    const press = new Float64Array(6);
    kinematics.solveTipEgo([0.33, 0, 0.14], 0, home, press);
    engine.setTargets("atlas", press);
    engine.setTargets("blaze", press);
    for (let i = 0; i < Math.round(0.5 / timestep); i++) engine.step();
    const stepsPerFrame = BENCH_FRAME_SIM_S / timestep;
    const batch = Math.floor(stepsPerFrame * 3);
    const samples: number[] = [];
    let touching = 0;
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      for (let i = 0; i < batch; i++) engine.step();
      samples.push(((performance.now() - t0) / batch) * stepsPerFrame);
      if (engine.frame.active.armArmTouching) touching++;
      if (f % 60 === 59) await yieldToEventLoop();
    }
    samples.sort((a, b) => a - b);
    const p95 = percentile(samples, 0.95);
    return {
      mode, timestep, stepsPerFrame, frames,
      p50Ms: percentile(samples, 0.5), p95Ms: p95, maxMs: samples[samples.length - 1],
      contactFrac: touching / frames, pass: p95 <= BENCH_GATE_P95_MS, mujoco: engine.info.mujocoVersion,
    };
  } finally {
    engine.dispose();
  }
}

export async function runBrowserBench(): Promise<BenchReport> {
  const kinematics = createKinematics();
  const arcade = await benchEngineCost(createPhysicsEngine, kinematics, "arcade");
  const harness = await benchEngineCost(createPhysicsEngine, kinematics, "harness");
  const strip = ({ mujoco: _m, ...rest }: BenchModeResult & { mujoco: string }): BenchModeResult => { void _m; return rest; };
  return {
    bench: "torquelimit.physics-bench/1",
    gateP95Ms: BENCH_GATE_P95_MS,
    pass: arcade.pass && harness.pass,
    modes: [strip(arcade), strip(harness)],
    mujoco: arcade.mujoco,
    userAgent: typeof navigator === "undefined" ? "node" : navigator.userAgent,
    date: new Date().toISOString(),
  };
}
