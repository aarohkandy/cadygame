// src/game/policy/in-process-driver.ts (WP4)
// SeatDriver without Workers (GAME_DESIGN 5.2, "Transport (Node)"): the eval CLI, the smoke suite, tests, and
// the browser's main-thread samplers (trajectory) all use it. Same contract and the same validation as the
// Worker driver:
//   builtin     a fresh opponent instance per seat (two built-in seats never share state)
//   module      imported from `opts.modulePath` (file path or URL) or, without a path, from its source as a data:
//               URL; each seat gets its own module instance, and every call runs under the seat's determinism
//               shim (Math.random seeded per round; Date.now/performance.now = sim time in eval)
//   trajectory  the linear-interpolation sampler
//   bridge      torquelimit.bridge/2 over Node's global WebSocket (HTTP fallback)
// Each seat's shim is swapped in only while that seat's code runs synchronously, so seats never share a generator.

import type { ActionResult, CreateInProcessSeatDriver, DriverSpec, Observation, PersonalityId, PolicyAction, ResetContext, Seat, SeatDriver, TierId } from "../contracts.ts";
import { validateAction } from "./action-validation.ts";
import { createBridgeClient, type BridgeClient } from "./bridge-client.ts";
import { OBS_SCHEMA_HASH } from "./obs-schema.ts";
import { createOpponent } from "./opponent/index.ts";
import { PERSONALITIES } from "./opponent/personalities.ts";
import { createPolicyRngShim, realNow, type PolicyRngShim } from "./policy-rng-shim.ts";
import { createTrajectoryPolicy, parseTrajectory } from "./trajectory.ts";

type PolicySpec = Exclude<DriverSpec, { kind: "human" } | { kind: "proxy" }>;

export class PolicyHangError extends Error {
  constructor(ms: number) {
    super(`no action within ${Math.round(ms / 1000)} s`);
    this.name = "PolicyHangError";
  }
}

/* ───────────────────────── mailbox ───────────────────────── */

export interface ResultMailbox {
  /** Starts request `seq`; results for older requests are dropped when they land. */
  begin(): number;
  deliver(seq: number, result: ActionResult): void;
  poll(): ActionResult | null;
  wait(hardAbortMs: number): Promise<ActionResult>;
  readonly latest: number;
  clear(): void;
}

/** Newest-result mailbox shared by every driver: poll() for live, wait() for lockstep. */
export function createResultMailbox(): ResultMailbox {
  let seq = 0;
  let ready: ActionResult | null = null;
  let waiter: { resolve: (r: ActionResult) => void; timer: ReturnType<typeof setTimeout> | null } | null = null;
  return {
    begin() { seq++; return seq; },
    deliver(s, result) {
      if (s !== seq) return;
      if (waiter) {
        const w = waiter;
        waiter = null;
        if (w.timer) clearTimeout(w.timer);
        w.resolve(result);
        return;
      }
      ready = result;
    },
    poll() {
      const r = ready;
      ready = null;
      return r;
    },
    wait(hardAbortMs) {
      if (ready) { const r = ready; ready = null; return Promise.resolve(r); }
      return new Promise<ActionResult>((resolve, reject) => {
        const timer = hardAbortMs > 0 && Number.isFinite(hardAbortMs)
          ? setTimeout(() => { if (waiter?.resolve === resolve) waiter = null; reject(new PolicyHangError(hardAbortMs)); }, hardAbortMs)
          : null;
        waiter = { resolve, timer };
      });
    },
    get latest() { return seq; },
    clear() {
      ready = null;
      if (waiter?.timer) clearTimeout(waiter.timer);
      waiter = null;
      seq++;
    },
  };
}

/** Builds the ActionResult for a raw policy output, validated exactly as every transport does. */
export function resultFor(raw: unknown, obs: Observation, tick: number, seq: number, computeMs: number, controlHz: number, hold: readonly number[]): ActionResult {
  const v = validateAction(raw, { defaultChunkHz: controlHz });
  if (v.status === "error" || !v.action) {
    return { tick, requestFrameIndex: obs.frame_index, chunkId: -1, action: { targets: hold.slice() }, computeMs, status: "error", error: v.error ?? "invalid action" };
  }
  const action: PolicyAction = v.action;
  if (action.chunk && action.chunkStartT === undefined) action.chunkStartT = obs.t;
  const res: ActionResult = { tick, requestFrameIndex: obs.frame_index, chunkId: action.chunk ? seq : -1, action, computeMs, status: v.status };
  if (v.status === "clamped" && v.error) res.error = v.error;
  return res;
}

export function errorResult(err: unknown, obs: Observation, tick: number, computeMs: number, hold: readonly number[]): ActionResult {
  const message = err instanceof Error ? err.message : String(err);
  return { tick, requestFrameIndex: obs.frame_index, chunkId: -1, action: { targets: hold.slice() }, computeMs, status: "error", error: message.slice(0, 200) };
}

/* ───────────────────────── module imports ───────────────────────── */

let importChain: Promise<unknown> = Promise.resolve();

/** Module imports run one at a time: a module's top-level code sees only its own seeded Math.random. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = importChain.then(fn, fn);
  importChain = next.then(() => undefined, () => undefined);
  return next;
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return !!x && typeof (x as { then?: unknown }).then === "function";
}

/* ───────────────────────── local policy driver ───────────────────────── */

export interface LocalPolicy {
  reset?(ctx: ResetContext): unknown;
  act(obs: Observation): unknown;
}

let moduleInstanceCounter = 0;

/** Imports a policy module for one seat (a unique query string gives every seat its own module instance). */
export async function importPolicyModule(spec: Extract<DriverSpec, { kind: "module" }>, modulePath: string | undefined, shim: PolicyRngShim): Promise<{ policy: LocalPolicy; name: string; provenance: Record<string, unknown> | null }> {
  const n = ++moduleInstanceCounter;
  const load = (url: string) => serialized(() => shim.runAsync(() => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<Record<string, unknown>>));
  const fromSource = () => load(`data:text/javascript;base64,${base64Utf8(`${spec.source}\n//# seat_instance=${n}`)}`);
  let mod: Record<string, unknown>;
  if (modulePath) {
    const url = toModuleUrl(modulePath);
    try {
      mod = await load(`${url}${url.includes("?") ? "&" : "?"}seat_instance=${n}`);
    } catch (err) {
      // An entrant's file name is not always a path on this machine; its stored source is the same module.
      if (!spec.source) throw err;
      mod = await fromSource();
    }
  } else {
    mod = await fromSource();
  }
  const act = mod.act ?? (mod.default as Record<string, unknown> | undefined)?.act;
  if (typeof act !== "function") throw new Error("module does not export act()");
  const reset = mod.reset ?? (mod.default as Record<string, unknown> | undefined)?.reset;
  const name = typeof mod.policyName === "string" && mod.policyName ? mod.policyName : spec.fileName;
  const provenance = mod.provenance && typeof mod.provenance === "object" ? mod.provenance as Record<string, unknown> : null;
  return {
    policy: { act: act as LocalPolicy["act"], reset: typeof reset === "function" ? reset as LocalPolicy["reset"] : undefined },
    name, provenance,
  };
}

function toModuleUrl(path: string): string {
  if (/^(file|data|https?|blob):/i.test(path)) return path;
  const proc = (globalThis as { process?: { cwd(): string; platform?: string } }).process;
  let abs = path;
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) {
    const cwd = proc ? proc.cwd() : "/";
    abs = `${cwd.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
  }
  abs = abs.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(abs)) abs = `/${abs}`;
  return `file://${abs.split("/").map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join("/")}`;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

interface LocalDriverOptions {
  kind: SeatDriver["kind"];
  name: string;
  sha256: string | null;
  provenance: Record<string, unknown> | null;
  policy: LocalPolicy;
  shim: PolicyRngShim | null;
}

/** A SeatDriver around a policy that runs in this realm. */
export function createLocalDriver(o: LocalDriverOptions): SeatDriver {
  const mailbox = createResultMailbox();
  let controlHz = 50;
  let hold: number[] = [0, 0, 0, 0, 0, 0];
  let disposed = false;

  function call<T>(fn: () => T): T {
    return o.shim ? o.shim.run(fn) : fn();
  }

  // The shim is swapped in only around the synchronous part of a call, so seats never see each other's generator,
  // and an async policy that never settles cannot hold up any other seat.
  async function runAct(obs: Observation): Promise<{ raw: unknown; ms: number }> {
    if (o.shim) o.shim.setSimTimeMs(obs.t * 1000);
    const t0 = realNow();
    let raw = call(() => o.policy.act(obs));
    if (isThenable(raw)) raw = await raw;
    return { raw, ms: realNow() - t0 };
  }

  return {
    kind: o.kind, name: o.name, sha256: o.sha256, claimedSha256: null, provenance: o.provenance,

    async reset(ctx) {
      controlHz = ctx.control_hz;
      hold = ctx.home_pose.slice(0, 6);
      mailbox.clear();
      if (o.shim) { o.shim.reseed(ctx.seed); o.shim.setEvalClock(ctx.mode === "eval"); o.shim.setSimTimeMs(0); }
      if (o.policy.reset) {
        const r = call(() => o.policy.reset?.(ctx));
        if (isThenable(r)) await r;
      }
    },

    async warmup(fixture) {
      const deadline = realNow() + 60_000;
      for (const obs of fixture.slice(0, 8)) {
        if (realNow() > deadline) throw new Error("warm-up over 60 s");
        await runAct(obs).catch(() => undefined);
      }
    },

    request(obs, tick) {
      if (disposed) return;
      const seq = mailbox.begin();
      runAct(obs).then(
        ({ raw, ms }) => {
          const res = resultFor(raw, obs, tick, seq, ms, controlHz, hold);
          if (res.status !== "error") hold = res.action.targets.slice();
          mailbox.deliver(seq, res);
        },
        (err: unknown) => mailbox.deliver(seq, errorResult(err, obs, tick, 0, hold)),
      );
    },

    poll: () => mailbox.poll(),
    waitForResult: (hardAbortMs) => mailbox.wait(hardAbortMs),
    dispose() { disposed = true; mailbox.clear(); },
  };
}

/* ───────────────────────── bridge ───────────────────────── */

/** The schema hash to announce: the context's when it is a real hash, else this build's pinned one. */
export function schemaHashOf(ctx: ResetContext): string {
  return ctx.obs_schema_hash.startsWith("sha256:") ? ctx.obs_schema_hash : OBS_SCHEMA_HASH;
}

export function createBridgeDriver(spec: Extract<DriverSpec, { kind: "bridge" }>, seat: Seat, client: BridgeClient | null = null): SeatDriver {
  const mailbox = createResultMailbox();
  let bridge: BridgeClient | null = client;
  let controlHz = 50;
  let hold: number[] = [0, 0, 0, 0, 0, 0];
  let name = spec.url;
  let claimed: string | null = null;
  let provenance: Record<string, unknown> | null = null;
  let episode = "";

  return {
    kind: "bridge",
    get name() { return name; },
    sha256: null,
    get claimedSha256() { return claimed; },
    get provenance() { return provenance; },

    async reset(ctx) {
      controlHz = ctx.control_hz;
      hold = ctx.home_pose.slice(0, 6);
      mailbox.clear();
      if (!bridge) bridge = createBridgeClient({ url: spec.url, allowLan: spec.allowLan, seat, sessionId: spec.sessionId, obsSchemaHash: schemaHashOf(ctx) });
      const hello = await bridge.connect({ controlHz: ctx.control_hz, decisionHz: ctx.decision_hz });
      name = hello.version ? `${hello.name} ${hello.version}` : hello.name;
      claimed = hello.claimedSha256;
      provenance = hello.provenance;
      episode = ctx.episode_id;
      await bridge.reset(ctx, episode);
    },

    async warmup(fixture) {
      if (!bridge) throw new Error("bridge warm-up before reset");
      await bridge.warmup(fixture);
    },

    request(obs, tick) {
      const b = bridge;
      const seq = mailbox.begin();
      if (!b) { mailbox.deliver(seq, errorResult(new Error("bridge not connected"), obs, tick, 0, hold)); return; }
      b.act(obs, tick).then(
        (reply) => {
          const res = resultFor(reply.raw, obs, tick, seq, reply.roundTripMs, controlHz, hold);
          if (res.status !== "error") hold = res.action.targets.slice();
          mailbox.deliver(seq, res);
        },
        (err: unknown) => mailbox.deliver(seq, errorResult(err, obs, tick, 0, hold)),
      );
    },

    poll: () => mailbox.poll(),
    waitForResult: (hardAbortMs) => mailbox.wait(hardAbortMs),
    dispose() { mailbox.clear(); bridge?.close(); bridge = null; },
  };
}

/** "BACKLASH PRO": how a built-in entrant is labelled in telemetry and episodes. */
export function builtinDisplayName(personality: PersonalityId, tier: TierId): string {
  return `${PERSONALITIES[personality].displayName} ${tier.toUpperCase()}`;
}

/* ───────────────────────── factory ───────────────────────── */

export const createInProcessSeatDriver: CreateInProcessSeatDriver = async (spec: PolicySpec, seat: Seat, opts: { modulePath?: string }) => {
  switch (spec.kind) {
    case "builtin": {
      const brain = createOpponent();
      return createLocalDriver({
        kind: "builtin", name: builtinDisplayName(spec.personality, spec.tier), sha256: null, provenance: null,
        policy: { reset: (ctx) => brain.reset(ctx), act: (obs) => brain.act(obs) }, shim: null,
      });
    }
    case "module": {
      const shim = createPolicyRngShim(0);
      const loaded = await importPolicyModule(spec, opts.modulePath, shim);
      return createLocalDriver({ kind: "module", name: loaded.name, sha256: spec.sha256, provenance: loaded.provenance, policy: loaded.policy, shim });
    }
    case "trajectory": {
      const tr = parseTrajectory(spec.json);
      return createLocalDriver({
        kind: "trajectory", name: tr.name ?? spec.fileName, sha256: spec.sha256, provenance: null,
        policy: createTrajectoryPolicy(tr), shim: null,
      });
    }
    case "bridge":
      return createBridgeDriver(spec, seat);
  }
};
