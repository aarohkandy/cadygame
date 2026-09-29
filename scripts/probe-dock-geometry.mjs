#!/usr/bin/env node
// Dock geometry gate (GAME_DESIGN 2.5), run on the untouched stock arena and at every Arcade loadout:
//   (a) the owner's gripperframe reaches its own dock centre at ≤ 70% extension;
//   (b) the opponent's gripperframe reaches a point 2–3 cm past the dock centre (toward the owner's base) at ≤ 85%;
//   (c) the opponent closes both jaws on a Core resting at the dock centre (simulated grasp along the tool axis).
// Extension is the command reach r (shoulder-lift pivot → wrist_roll axis point, GAME_DESIGN 3.1.1) over its 0.42 m
// maximum, for the best IK solution over downward tool pitches.
//
// Usage: node scripts/probe-dock-geometry.mjs [--x 0.11] [--r 0.07] [--json]
// Exit code 0 when every check passes for the given dock values; the defaults are the committed ones, read from the
// atlas_dock / blaze_dock sites of arena.xml.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

export const OWNER_MAX_EXTENSION = 0.7;
export const OPPONENT_MAX_EXTENSION = 0.85;
export const PAST_CENTRE_M = [0.02, 0.03];
export const GRASP_Z = 0.02;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

/** Best (lowest) extension that puts the tip at `egoTarget`, searching tool pitches. */
export function reachExtension(kin, egoTarget) {
  const { REACH_MAX_M } = kin.internals;
  let best = { ok: false, extension: Infinity, pitch: 0, q: null, errorM: Infinity };
  const q = new Float64Array(6);
  const seed = [0, 0, 0, 0, 0, 1.15];
  const cmd = { yaw: 0, elev: 0, reach: 0, tool: 0, roll: 0, grip: 0 };
  for (let k = 0; k <= 36; k++) {
    const pitch = -Math.PI / 2 + (k * Math.PI) / 72;
    const r = kin.k.solveTipEgo(egoTarget, pitch, seed, q);
    if (!r.ok) continue;
    const ext = kin.k.jointsToCommand(q, cmd).reach / REACH_MAX_M;
    if (ext < best.extension) best = { ok: true, extension: ext, pitch, q: Float64Array.from(q), errorM: r.errorM };
  }
  return best;
}

/** World → ego for a seat (GAME_DESIGN 5.4). */
export function toEgo(seat, p) {
  return seat === "atlas" ? [p[0] + 0.32, p[1], p[2]] : [-(p[0] - 0.32), -p[1], p[2]];
}

/**
 * Simulated grasp: the opponent approaches a Core resting at the dock centre along its tool axis with open jaws, at the
 * steepest reachable pitch, then closes. Both wrist rolls that square the jaws to the cube faces are tried.
 */
export async function graspCheck(engineMod, kin, mode, loadout, dockX, owner) {
  const opp = owner === "atlas" ? "blaze" : "atlas";
  const engine = await engineMod.createPhysicsEngine({ mode, nodeFsRoot: root });
  try {
    const home = kin.k.commandToJoints(kin.k.homeCommand(), new Float64Array(6));
    const centre = [owner === "atlas" ? -dockX : dockX, 0, 0.0205];
    const ego = toEgo(opp, [centre[0], centre[1], GRASP_Z]);
    const q = new Float64Array(6);
    const pitches = [];
    for (let k = 0; k <= 36 && pitches.length < 4; k++) {
      const p = -Math.PI / 2 + (k * Math.PI) / 72;
      if (kin.k.solveTipEgo(ego, p, [0, 0, 0, 0, 0, 1.15], q).ok) pitches.push(p);
    }
    if (pitches.length === 0) return { ok: false, reachable: false, bothJaws: false, pitch: null };
    for (const pitch of pitches) for (const roll of [0, Math.PI / 2, -Math.PI / 2]) {
      engine.reset({ mode, timestep: mode === "arcade" ? 0.0025 : 0.005, seed: 7, loadouts: { atlas: loadout, blaze: loadout },
        homePose: { atlas: home, blaze: home }, layout: "lobby" });
      engine.placeCube(4, centre);
      const drive = (target, grip, seconds) => {
        const r = kin.k.solveTipEgo(target, pitch, [0, 0, 0, 0, roll, grip], q);
        q[4] = roll; q[5] = grip;
        engine.setTargets(opp, q);
        engine.setTargets(owner, home);
        const steps = Math.round(seconds / engine.frame.dt);
        for (let i = 0; i < steps; i++) engine.step();
        return r.ok;
      };
      const back = [ego[0] - 0.06 * Math.cos(pitch), ego[1], ego[2] - 0.06 * Math.sin(pitch)];
      let ok = drive(back, 1.15, 0.8);
      ok = drive(ego, 1.15, 0.8) && ok;
      ok = drive(ego, 0.04, 0.6) && ok;
      if (ok && engine.frame.active.bothJawsOnCube[opp] === 4) return { ok: true, reachable: true, bothJaws: true, pitch, roll };
    }
    return { ok: false, reachable: true, bothJaws: false, pitch: pitches[0] };
  } finally {
    engine.dispose();
  }
}

export async function probe(dockX, radius) {
  const kinMod = await imp("src/game/kinematics/so101-kinematics.ts");
  const engineMod = await imp("src/game/physics/engine.ts");
  const kin = { k: kinMod.createKinematics(), internals: { REACH_MAX_M: kinMod.REACH_MAX_M } };
  const rows = [];
  for (const owner of ["atlas", "blaze"]) {
    const opp = owner === "atlas" ? "blaze" : "atlas";
    const centre = [owner === "atlas" ? -dockX : dockX, 0, GRASP_Z];
    const a = reachExtension(kin, toEgo(owner, centre));
    rows.push({ check: "a", owner, extension: a.extension, pass: a.ok && a.extension <= OWNER_MAX_EXTENSION });
    for (const past of PAST_CENTRE_M) {
      const towardOwner = owner === "atlas" ? -past : past;
      const b = reachExtension(kin, toEgo(opp, [centre[0] + towardOwner, 0, GRASP_Z]));
      rows.push({ check: "b", owner, pastM: past, extension: b.extension, pass: b.ok && b.extension <= OPPONENT_MAX_EXTENSION });
    }
    for (const [mode, loadout] of [["harness", "pivot"], ["arcade", "whip"], ["arcade", "pivot"], ["arcade", "anvil"]]) {
      const c = await graspCheck(engineMod, kin, mode, loadout, dockX, owner);
      rows.push({ check: "c", owner, profile: mode === "harness" ? "stock" : loadout, ...c, pass: c.ok });
    }
  }
  return { dockX, radius, pass: rows.every((r) => r.pass), rows };
}

/** Committed dock centre |x| and radius, from the arena.xml sites. */
export async function committedDocks() {
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile(path.join(root, "public", "models", "robotstudio_so101", "arena.xml"), "utf8");
  const m = /<site name="blaze_dock" pos="([-\d.]+) [-\d.]+ [-\d.]+" size="([\d.]+)/.exec(xml);
  if (!m) throw new Error("arena.xml has no blaze_dock site");
  return { x: Math.abs(Number(m[1])), r: Number(m[2]) };
}

async function main() {
  const committed = await committedDocks();
  const x = arg("--x", committed.x);
  const r = arg("--r", committed.r);
  const result = await probe(x, r);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`dock centre ±${x.toFixed(3)} m, radius ${r.toFixed(3)} m`);
    for (const row of result.rows) {
      const detail = row.check === "c"
        ? `grasp ${row.profile.padEnd(5)} reachable ${row.reachable} both jaws ${row.bothJaws}`
        : `extension ${(row.extension * 100).toFixed(1)}%${row.pastM ? ` (${(row.pastM * 100).toFixed(0)} cm past centre)` : ""}`;
      console.log(`${row.pass ? "PASS" : "FAIL"}  (${row.check}) ${row.owner.padEnd(5)} dock  ${detail}`);
    }
    console.log(result.pass ? "Dock geometry gate: PASS" : "Dock geometry gate: FAIL (move docks inward in 0.01 m steps, min ±0.09, then grow the radius to 0.08)");
  }
  process.exit(result.pass ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
