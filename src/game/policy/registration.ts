// src/game/policy/registration.ts (WP4)
// REGISTER ENTRANT (GAME_DESIGN 5.6, 7.3.4): runs an uploaded module or trajectory through the checks the Entrants
// screen shows, one row at a time, against the 200-observation registration fixture:
//   FILE PARSED · EXPORTS act() · RESET OK · COLD ACT (first act, alone) · 200 FIXTURE ACTS (warm p99) ·
//   ACTIONS FINITE · WITHIN LIMITS · DETERMINISTIC (a warning, not a failure)
// A failure names the first failing fixture ("FAILED AT FIXTURE 137 · NaN"). Uploaded code never runs on the main
// thread in the browser: modules load in the same policy Worker a match uses. Also the bridge probe for the
// Entrants bridge card and the Lab (hello → hello_ok → bye).

import {
  DOCK_CENTER_X, DOCK_RADIUS, JOINT_LIMITS, JOINT_NAMES, MOUNT_X, OBS_BLOCKS, OBS_SCHEMA, otherSeat,
  type ActionResult, type DriverSpec, type EncodedTyped, type ObsBlockName, type Observation, type ProbeBridge,
  type RegistrationCheckId, type RegistrationResult, type RegistrationRow, type ResetContext, type RunRegistration,
  type Seat, type SeatDriver, type Vec3,
} from "../contracts.ts";
import { createKinematics } from "../kinematics/so101-kinematics.ts";
import { createBridgeClient } from "./bridge-client.ts";
import { OBS_SCHEMA_HASH } from "./obs-schema.ts";
import { realNow } from "./policy-rng-shim.ts";
import { createSeatDriver } from "./seat-drivers.ts";
import { parseTrajectory, TrajectoryFormatError } from "./trajectory.ts";

export const REGISTRATION_FIXTURE_FORMAT = "torquelimit.registration-fixture/1";
export const REGISTRATION_FIXTURE_PATH = "policies/fixtures/registration-obs-3.json";
export const REGISTRATION_FIXTURE_COUNT = 200;
export const REGISTRATION_SEED = 0x7e57_5eed;
const ACT_TIMEOUT_MS = 5000;
const RESET_TIMEOUT_MS = 10_000;

type EntrantSpec = Extract<DriverSpec, { kind: "module" } | { kind: "trajectory" }>;

/* ───────────────────────── fixture encoding (D5 typed arrays) ───────────────────────── */

export interface RegistrationFixtureFile {
  format: typeof REGISTRATION_FIXTURE_FORMAT;
  schema: typeof OBS_SCHEMA;
  obs_schema_hash: string;
  generated: Record<string, unknown>;
  observations: (Omit<Observation, "blocks"> & { blocks: Record<ObsBlockName, EncodedTyped> })[];
}

function f32ToB64(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) view.setFloat32(i * 4, a[i], true);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToF32(e: EncodedTyped): Float32Array {
  if (e.dtype !== "f32") throw new Error(`fixture block dtype ${e.dtype}, expected f32`);
  const bin = atob(e.b64);
  if (bin.length !== e.length * 4) throw new Error(`fixture block has ${bin.length} bytes, expected ${e.length * 4}`);
  const out = new Float32Array(e.length);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  for (let i = 0; i < e.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function encodeRegistrationFixture(observations: readonly Observation[], generated: Record<string, unknown>): RegistrationFixtureFile {
  return {
    format: REGISTRATION_FIXTURE_FORMAT, schema: OBS_SCHEMA, obs_schema_hash: OBS_SCHEMA_HASH, generated,
    observations: observations.map((o) => {
      const blocks = {} as Record<ObsBlockName, EncodedTyped>;
      for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) blocks[name] = { dtype: "f32", length: o.blocks[name].length, b64: f32ToB64(o.blocks[name]) };
      return { ...o, blocks };
    }),
  };
}

export function decodeRegistrationFixture(text: string): Observation[] {
  const doc = JSON.parse(text) as RegistrationFixtureFile;
  if (doc.format !== REGISTRATION_FIXTURE_FORMAT) throw new Error(`fixture format ${String(doc.format)}`);
  if (doc.schema !== OBS_SCHEMA) throw new Error(`fixture schema ${String(doc.schema)}`);
  return doc.observations.map((o) => {
    const blocks = {} as Record<ObsBlockName, Float32Array>;
    for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) {
      const b = b64ToF32(o.blocks[name]);
      if (b.length !== OBS_BLOCKS[name]) throw new Error(`fixture block ${name} has ${b.length} values`);
      blocks[name] = b;
    }
    return { ...o, blocks } as Observation;
  });
}

/* ───────────────────────── reset context ───────────────────────── */

function egoX(seat: Seat, worldX: number): Vec3 {
  return seat === "atlas" ? [worldX - MOUNT_X.atlas, 0, 0] : [-(worldX - MOUNT_X.blaze), 0, 0];
}

/** The ResetContext registration (and CHECK POLICY DETERMINISM) gives a policy: Proving Ground timing, eval clock. */
export function registrationContext(seat: Seat, seed: number): ResetContext {
  const kin = createKinematics();
  const home = kin.commandToJoints(kin.homeCommand(), new Float64Array(6));
  return {
    schema: OBS_SCHEMA, protocol: "torquelimit.policy/3", obs_schema_hash: OBS_SCHEMA_HASH,
    side: seat, seed, episode_id: "registration", round: 1,
    control_hz: 50, decision_hz: 25, action_delay_ticks: 1, fair_delay_ms: 0,
    mode: "eval", preset: "proving_ground", physics: "harness", strict_limits: false,
    joint_names: JOINT_NAMES, joint_limits: JOINT_LIMITS, home_pose: Array.from(home),
    arena: {
      opponent_base: egoX(seat, MOUNT_X[otherSeat(seat)]), midline_x: 0.32,
      dock_self: egoX(seat, DOCK_CENTER_X[seat]), dock_opponent: egoX(seat, DOCK_CENTER_X[otherSeat(seat)]), dock_radius: DOCK_RADIUS,
    },
    rules: { round_length: 45, best_of: 3, integrity_max: 100, loadout: null, scoring: "physical" },
  };
}

/* ───────────────────────── runner ───────────────────────── */

export interface RegistrationDeps {
  loadFixture(): Promise<Observation[]>;
  createDriver(spec: EntrantSpec, seat: Seat): Promise<SeatDriver>;
}

class AbortedError extends Error {
  constructor() { super("registration aborted"); this.name = "AbortError"; }
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return "";
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took over ${Math.round(ms / 1000)} s`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

function fmtMs(ms: number): string {
  return ms >= 100 ? `${Math.round(ms)} ms` : ms >= 10 ? `${ms.toFixed(0)} ms` : `${ms.toFixed(1)} ms`;
}

/** Nearest-rank quantile. */
function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

function shortError(msg: string | undefined): string {
  if (!msg) return "invalid action";
  if (/NaN/.test(msg)) return "NaN";
  if (/Infinity/.test(msg)) return "Infinity";
  return msg.length > 60 ? `${msg.slice(0, 57)}...` : msg;
}

/** Everything an action returned that registration compares for determinism. */
function actionKey(r: ActionResult): string {
  const a = r.action;
  return JSON.stringify([r.status, a.targets, a.chunk ?? null, a.chunkHz ?? null, a.chunkStartT ?? null, a.intentChunk ?? null, a.intents ?? null]);
}

export function createRegistration(deps: RegistrationDeps): RunRegistration {
  return async (spec, onRow, signal) => {
    const rows: RegistrationRow[] = [];
    const emit = (id: RegistrationCheckId, label: string, status: RegistrationRow["status"], detail: string | null = null, fixtureIndex: number | null = null) => {
      const row: RegistrationRow = { id, label, status, detail, fixtureIndex };
      rows.push(row);
      onRow(row);
    };
    const checkAbort = () => { if (signal?.aborted) throw new AbortedError(); };
    const source = spec.kind === "module" ? spec.source : spec.json;
    const sha = (await sha256Hex(source)) || spec.sha256;
    let name = spec.fileName;
    let coldActMs = 0, p99ActMs = 0, deterministic = false;
    const finish = (): RegistrationResult => ({
      ok: rows.length > 0 && rows.every((r) => r.status !== "fail") && rows.some((r) => r.id === "fixture_acts"),
      rows, name, sha256: sha, coldActMs, p99ActMs, deterministic,
    });

    checkAbort();
    // FILE PARSED / EXPORTS act()
    let frameInfo = "";
    if (spec.kind === "trajectory") {
      try {
        const tr = parseTrajectory(spec.json);
        if (tr.name) name = tr.name;
        frameInfo = `${tr.frameCount} FRAMES @ ${tr.fps} FPS`;
      } catch (err) {
        emit("parsed", "FILE PARSED", "fail", err instanceof TrajectoryFormatError ? err.message : String(err));
        return finish();
      }
    }
    const seat: Seat = "blaze";
    let driver: SeatDriver;
    try {
      driver = await deps.createDriver({ ...spec, sha256: sha }, seat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/does not export act/.test(msg)) {
        emit("parsed", "FILE PARSED", "pass", `${Math.round(source.length / 1024 * 10) / 10} KB`);
        emit("exports_act", "EXPORTS act()", "fail", "no act() export");
      } else {
        emit("parsed", "FILE PARSED", "fail", shortError(msg.replace(/^import failed: /, "")));
      }
      return finish();
    }

    try {
      if (spec.kind === "module") {
        name = driver.name || spec.fileName;
        emit("parsed", "FILE PARSED", "pass", `${Math.max(0.1, Math.round(source.length / 102.4) / 10)} KB`);
        emit("exports_act", "EXPORTS act()", "pass", name);
      } else {
        emit("parsed", "FILE PARSED", "pass", frameInfo);
        emit("exports_act", "SAMPLER READY", "pass", "linear interpolation");
      }

      let fixture: Observation[];
      try {
        fixture = await deps.loadFixture();
      } catch (err) {
        emit("reset", "FIXTURE UNAVAILABLE", "fail", shortError(err instanceof Error ? err.message : String(err)));
        return finish();
      }
      checkAbort();

      // RESET OK
      checkAbort();
      const ctx = registrationContext(seat, REGISTRATION_SEED);
      const r0 = realNow();
      try {
        await withTimeout(driver.reset(ctx), RESET_TIMEOUT_MS, "reset()");
      } catch (err) {
        emit("reset", "RESET", "fail", shortError(err instanceof Error ? err.message : String(err)));
        return finish();
      }
      emit("reset", "RESET OK", "pass", fmtMs(realNow() - r0));

      // Acts: fixture[0] alone first (cold), then the whole fixture warm.
      const act = async (i: number): Promise<ActionResult> => {
        const obs = fixture[i];
        driver.request(obs, i);
        return driver.waitForResult(ACT_TIMEOUT_MS);
      };
      const firstRun: string[] = [];
      let cold: ActionResult;
      try {
        cold = await act(0);
      } catch {
        emit("cold_act", "COLD ACT", "fail", `no action in ${ACT_TIMEOUT_MS / 1000} s`, 0);
        return finish();
      }
      coldActMs = cold.computeMs;
      emit("cold_act", `COLD ACT · ${fmtMs(coldActMs)}`, cold.status === "error" ? "fail" : "pass", cold.status === "error" ? shortError(cold.error) : null, cold.status === "error" ? 0 : null);

      const times: number[] = [];
      let firstError: { i: number; msg: string } | null = cold.status === "error" ? { i: 0, msg: shortError(cold.error) } : null;
      let firstClamp: { i: number; msg: string } | null = cold.status === "clamped" ? { i: 0, msg: cold.error ?? "" } : null;
      let hung = -1;
      for (let i = 0; i < fixture.length; i++) {
        checkAbort();
        let res: ActionResult;
        try {
          res = i === 0 ? cold : await act(i);
        } catch {
          hung = i;
          break;
        }
        if (i > 0) times.push(res.computeMs);
        firstRun.push(actionKey(res));
        if (res.status === "error" && !firstError) firstError = { i, msg: shortError(res.error) };
        if (res.status === "clamped" && !firstClamp) firstClamp = { i, msg: res.error ?? "" };
      }
      p99ActMs = quantile(times, 0.99);
      if (hung >= 0) {
        emit("fixture_acts", `${fixture.length} FIXTURE ACTS`, "fail", `TIMED OUT AT FIXTURE ${hung}`, hung);
        return finish();
      }
      emit("fixture_acts", `${fixture.length} FIXTURE ACTS · p99 ${fmtMs(p99ActMs)}`, "pass", `median ${fmtMs(quantile(times, 0.5))}`);
      if (firstError) emit("finite", "ACTIONS FINITE", "fail", `FAILED AT FIXTURE ${firstError.i} · ${firstError.msg}`, firstError.i);
      else emit("finite", "ACTIONS FINITE", "pass", null);
      if (firstClamp) emit("limits", "WITHIN LIMITS", "warn", `CLAMPED AT FIXTURE ${firstClamp.i} · ${firstClamp.msg}`, firstClamp.i);
      else emit("limits", "WITHIN LIMITS", "pass", null);

      // DETERMINISTIC: the same seed and fixture stream again, compared number for number.
      checkAbort();
      await withTimeout(driver.reset(ctx), RESET_TIMEOUT_MS, "reset()");
      let divergedAt = -1;
      for (let i = 0; i < fixture.length; i++) {
        checkAbort();
        let res: ActionResult;
        try { res = await act(i); } catch { divergedAt = i; break; }
        if (actionKey(res) !== firstRun[i]) { divergedAt = i; break; }
      }
      deterministic = divergedAt < 0;
      if (deterministic) emit("deterministic", "DETERMINISTIC", "pass", `${fixture.length} acts, seed ${REGISTRATION_SEED}`);
      else emit("deterministic", "NON-DETERMINISTIC", "warn", `DIFFERS AT FIXTURE ${divergedAt}`, divergedAt);
      return finish();
    } finally {
      driver.dispose();
    }
  };
}

/* ───────────────────────── browser bindings ───────────────────────── */

let fixtureCache: Promise<Observation[]> | null = null;

/** The fixture from the page's origin (browser), or from public/ under the working directory (Node CLI and tests). */
function loadFixtureFromOrigin(): Promise<Observation[]> {
  if (!fixtureCache) {
    const doc = (globalThis as { document?: { baseURI: string } }).document;
    const text: Promise<string> = doc
      ? fetch(new URL(REGISTRATION_FIXTURE_PATH, doc.baseURI).toString()).then((r) => { if (!r.ok) throw new Error(`fixture HTTP ${r.status}`); return r.text(); })
      : readPublicFile(REGISTRATION_FIXTURE_PATH);
    fixtureCache = text.then(decodeRegistrationFixture).catch((err: unknown) => { fixtureCache = null; throw err; });
  }
  return fixtureCache;
}

async function readPublicFile(rel: string): Promise<string> {
  const proc = (globalThis as { process?: { cwd(): string } }).process;
  if (!proc) throw new Error("no fixture source in this environment");
  // A computed specifier keeps the browser bundle from ever trying to resolve a Node built-in.
  const specifier = ["node", "fs/promises"].join(":");
  const fs = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier)) as { readFile(p: string, enc: "utf8"): Promise<string> };
  return fs.readFile(`${proc.cwd()}/public/${rel}`, "utf8");
}

export const runRegistration: RunRegistration = createRegistration({
  loadFixture: loadFixtureFromOrigin,
  createDriver: (spec, seat) => createSeatDriver(spec, seat),
});

export const probeBridge: ProbeBridge = async (url, allowLan) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const client = createBridgeClient({ url, allowLan, seat: null, sessionId: `probe-${stamp}` });
  try {
    return await client.connect({ controlHz: 50, decisionHz: 25 });
  } finally {
    client.close();
  }
};
