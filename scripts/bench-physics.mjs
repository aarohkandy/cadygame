#!/usr/bin/env node
// Physics bench (GAME_DESIGN 4.2, 4.6, 4.10):
//   1. Cost: p50 / p95 wall ms per 16.7 ms of sim, both arms pressed together (contact walk every step), per preset.
//      Gate: p95 ≤ 1.2 ms.
//   2. vRef: peak gripperframe speed of the canonical hook (pan −0.7 → +0.7 step, lift 0.14, elbow 0.14) as it
//      crosses pan 0, per physics profile (whip, pivot, anvil in Arcade; stock).
//   3. v_free: free-space joint speed while |error| passes each bin, per profile and arm joint, from the home pose.
// With --write, (2) and (3) replace the measured block in src/game/combat/tuning.ts.
//
// Usage: node scripts/bench-physics.mjs [--write] [--frames 600] [--json]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
export const GATE_P95_MS = 1.2;
const ERROR_BINS = [0.35, 0.5, 0.7, 1.0, 1.4];

function argNum(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const profiles = [
  { id: "whip", mode: "arcade", loadout: "whip", dt: 0.0025 },
  { id: "pivot", mode: "arcade", loadout: "pivot", dt: 0.0025 },
  { id: "anvil", mode: "arcade", loadout: "anvil", dt: 0.0025 },
  { id: "stock", mode: "harness", loadout: "pivot", dt: 0.005 },
];

function resetFor(engine, p, home, layout = "duel") {
  engine.reset({ mode: p.mode, timestep: p.dt, seed: 1, loadouts: { atlas: p.loadout, blaze: p.loadout }, homePose: { atlas: home, blaze: home }, layout });
}

/** Wall cost per 16.7 ms of sim with both arms in contact (shared with the ?debug=bench page). */
export async function benchCost(engineMod, kin, frames) {
  const { benchEngineCost } = await imp("src/game/physics/bench-browser.ts");
  const out = {};
  for (const mode of ["arcade", "harness"]) out[mode] = await benchEngineCost(engineMod.createPhysicsEngine, kin, mode, { frames, nodeFsRoot: root });
  return out;
}

/** Peak tip speed of the canonical hook as pan crosses 0. */
export async function measureVRef(engineMod, kin, p) {
  const engine = await engineMod.createPhysicsEngine({ mode: p.mode, nodeFsRoot: root });
  try {
    const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
    resetFor(engine, p, home, "lobby");
    const away = Float64Array.of(1.9, -1.7, 1.6, 0, 0, 0.04);             // opponent folded out of the swing
    const start = Float64Array.of(-0.7, 0.14, 0.14, 0, 0, 0.04);
    engine.setTargets("atlas", start);
    engine.setTargets("blaze", away);
    for (let i = 0; i < Math.round(1.5 / p.dt); i++) engine.step();
    const hook = Float64Array.of(0.7, 0.14, 0.14, 0, 0, 0.04);
    engine.setTargets("atlas", hook);
    let best = 0, prevPan = engine.frame.arms.atlas.q[0], crossing = 0;
    for (let i = 0; i < Math.round(0.6 / p.dt); i++) {
      engine.step();
      const arm = engine.frame.arms.atlas;
      const speed = Math.hypot(arm.eeVel[0], arm.eeVel[1], arm.eeVel[2]);
      if (speed > best) best = speed;
      if (prevPan < 0 && arm.q[0] >= 0 && crossing === 0) crossing = speed;
      prevPan = arm.q[0];
    }
    return { peak: best, atPanZero: crossing };
  } finally {
    engine.dispose();
  }
}

/** Joint speed as |error| passes each bin in a free-space step, min over both directions. */
export async function measureVFree(engineMod, kin, p) {
  const engine = await engineMod.createPhysicsEngine({ mode: p.mode, nodeFsRoot: root });
  const { JOINT_LIMITS } = await imp("src/game/contracts.ts");
  try {
    const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
    const table = [];
    for (let j = 0; j < 5; j++) {
      const row = ERROR_BINS.map(() => Infinity);
      for (const dir of [1, -1]) {
        resetFor(engine, p, home, "lobby");
        const target = Float64Array.from(home);
        const lim = JOINT_LIMITS[j];
        target[j] = Math.max(lim[0], Math.min(lim[1], home[j] + dir * 1.6));
        const span = Math.abs(target[j] - home[j]);
        if (span < ERROR_BINS[ERROR_BINS.length - 1] + 0.05) continue;
        engine.setTargets("blaze", home);
        for (let i = 0; i < Math.round(0.3 / p.dt); i++) engine.step();
        engine.setTargets("atlas", target);
        let bin = ERROR_BINS.length - 1;
        for (let i = 0; i < Math.round(1.5 / p.dt) && bin >= 0; i++) {
          engine.step();
          const arm = engine.frame.arms.atlas;
          const e = Math.abs(arm.ctrl[j] - arm.q[j]);
          while (bin >= 0 && e <= ERROR_BINS[bin]) {
            row[bin] = Math.min(row[bin], Math.abs(arm.qd[j]));
            bin--;
          }
        }
      }
      table.push(row.map((v) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0)));
    }
    // A joint that could not sweep a bin in either direction inherits the nearest measured value in its row.
    for (const row of table) {
      for (let b = 0; b < row.length; b++) if (row[b] === 0) row[b] = row.find((v) => v > 0) ?? 0;
    }
    return table;
  } finally {
    engine.dispose();
  }
}

export function writeTuning(vref, vfree) {
  const file = path.join(root, "src", "game", "combat", "tuning.ts");
  const src = readFileSync(file, "utf8");
  const open = src.indexOf("// <bench:measured>"), close = src.indexOf("// </bench:measured>");
  if (open < 0 || close < 0) throw new Error("tuning.ts is missing the bench markers");
  const rows = (id) => `[${vfree[id].map((r) => `[${r.join(", ")}]`).join(", ")}]`;
  const block = [
    "// <bench:measured>",
    `/** Peak gripperframe speed (m/s) of the canonical hook per physics profile (4.2). */`,
    `export const MEASURED_VREF = { whip: ${vref.whip}, pivot: ${vref.pivot}, anvil: ${vref.anvil}, stock: ${vref.stock} } as const;`,
    "/** Free-space joint speed (rad/s) while |error| passes each bin (4.6 knockback), per profile, per arm joint 0–4. */",
    "export const MEASURED_VFREE = {",
    `  errorBins: [${ERROR_BINS.join(", ")}],`,
    ...profiles.map((p) => `  ${p.id}: ${rows(p.id)},`),
    "} as const;",
    "",
  ].join("\n");
  writeFileSync(file, src.slice(0, open) + block + src.slice(close));
}

async function main() {
  const engineMod = await imp("src/game/physics/engine.ts");
  const kin = (await imp("src/game/kinematics/so101-kinematics.ts")).createKinematics();
  const frames = argNum("--frames", 600);
  const cost = await benchCost(engineMod, kin, frames);
  const vref = {}, vrefDetail = {}, vfree = {};
  for (const p of profiles) {
    const v = await measureVRef(engineMod, kin, p);
    vrefDetail[p.id] = v;
    vref[p.id] = Number(v.atPanZero.toFixed(3));
    vfree[p.id] = await measureVFree(engineMod, kin, p);
  }
  const pass = cost.arcade.p95Ms <= GATE_P95_MS && cost.harness.p95Ms <= GATE_P95_MS;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ cost, vref, vrefDetail, vfree, pass }, null, 2));
  } else {
    for (const [mode, c] of Object.entries(cost)) {
      console.log(`${mode.padEnd(8)} p50 ${c.p50Ms.toFixed(3)} ms  p95 ${c.p95Ms.toFixed(3)} ms per 16.7 ms sim (${c.stepsPerFrame.toFixed(2)} steps)  arms touching ${(c.contactFrac * 100).toFixed(0)}% of frames`);
    }
    for (const p of profiles) {
      console.log(`vRef ${p.id.padEnd(6)} ${vref[p.id].toFixed(3)} m/s at pan 0 (peak ${vrefDetail[p.id].peak.toFixed(3)})`);
    }
    for (const p of profiles) console.log(`v_free ${p.id.padEnd(6)} ${JSON.stringify(vfree[p.id])}`);
    console.log(`Bench gate (p95 ≤ ${GATE_P95_MS} ms): ${pass ? "PASS" : "FAIL"}`);
  }
  if (process.argv.includes("--write")) {
    writeTuning(vref, vfree);
    console.log("wrote src/game/combat/tuning.ts measured block");
  }
  process.exit(pass ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
