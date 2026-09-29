// src/game/policy/seat-drivers.ts (WP4)
// Browser seat drivers (GAME_DESIGN 5.2):
//   builtin, module  a module Worker running policy-worker.ts (built-in brain, or the upload from a Blob URL)
//   trajectory       the main-thread sampler (same code as Node)
//   bridge           a proxy Worker (bridge-worker.ts) that owns the WebSocket
// Every reply is validated on this side by action-validation.ts, stale replies are dropped, and the newest result
// is handed to the sim-driver through poll() (live) or waitForResult() (lockstep).
//
// Built-in Workers are kept warm between matches, one per entrant and tier, so the invisible DDA's history (k and
// the player's loss streak) survives from one match to the next, and a rematch starts without an import.
// A Worker is only reused if it went idle cleanly; a hung or failed Worker is terminated.
// Where Workers do not exist (Node), every kind falls back to the in-process driver.

import type {
  CreateSeatDriver, DriverSpec, Observation, ResetContext, Seat, SeatDriver, WorkerRequest, WorkerResponse,
} from "../contracts.ts";
import type { BridgeWorkerRequest, BridgeWorkerResponse } from "./bridge-worker.ts";
import { builtinDisplayName, createInProcessSeatDriver, createResultMailbox, errorResult, resultFor, schemaHashOf } from "./in-process-driver.ts";

type PolicySpec = Exclude<DriverSpec, { kind: "human" } | { kind: "proxy" }>;

export const WORKER_LOAD_TIMEOUT_MS = 20_000;
export const WORKER_RESET_TIMEOUT_MS = 30_000;
export const WARMUP_BUDGET_MS = 60_000;
export const WARMUP_ACTS = 8;
/** A built-in Worker goes back to the pool only if nothing it was asked has been pending longer than this. */
const POOL_MAX_INFLIGHT_MS = 1000;

export class SeatDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatDriverError";
  }
}

function hasWorkers(): boolean {
  return typeof (globalThis as { Worker?: unknown }).Worker === "function";
}

/* ───────────────────────── policy Workers ───────────────────────── */

interface PolicyWorker {
  worker: Worker;
  name: string;
  provenance: Record<string, unknown> | null;
  listener: ((msg: WorkerResponse) => void) | null;
  dead: string | null;
  /** Message ids never repeat for a Worker, so a late reply to a previous match can't answer a new request. */
  nextId: number;
}

const builtinPool = new Map<string, PolicyWorker>();

function spawnPolicyWorker(): Worker {
  return new Worker(new URL("./policy-worker.ts", import.meta.url), { type: "module", name: "torquelimit-policy" });
}

function wire(pw: PolicyWorker): void {
  pw.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => pw.listener?.(ev.data);
  pw.worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    const message = ev.message || "policy worker crashed";
    pw.dead = message;
    pw.listener?.({ type: "error", id: null, message, fatal: true });
  };
  pw.worker.onmessageerror = () => pw.listener?.({ type: "error", id: null, message: "unreadable message from policy", fatal: false });
}

async function loadPolicyWorker(spec: Extract<PolicySpec, { kind: "builtin" | "module" }>): Promise<PolicyWorker> {
  const pw: PolicyWorker = { worker: spawnPolicyWorker(), name: "", provenance: null, listener: null, dead: null, nextId: 0 };
  wire(pw);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { pw.listener = null; reject(new SeatDriverError("policy took over 20 s to load")); }, WORKER_LOAD_TIMEOUT_MS);
    pw.listener = (msg) => {
      if (msg.type === "loaded") { clearTimeout(timer); pw.listener = null; pw.name = msg.name; pw.provenance = msg.provenance; resolve(); }
      else if (msg.type === "error" && msg.id === null && msg.fatal) { clearTimeout(timer); pw.listener = null; reject(new SeatDriverError(msg.message)); }
    };
    const req: WorkerRequest = spec.kind === "builtin"
      ? { type: "load", kind: "builtin" }
      : { type: "load", kind: "module", source: spec.source, fileName: spec.fileName };
    pw.worker.postMessage(req);
  }).catch((err: unknown) => {
    pw.worker.terminate();
    throw err;
  });
  return pw;
}

function createWorkerDriver(spec: Extract<PolicySpec, { kind: "builtin" | "module" }>, pw: PolicyWorker, poolKey: string | null): SeatDriver {
  const mailbox = createResultMailbox();
  let controlHz = 50;
  let hold: number[] = [0, 0, 0, 0, 0, 0];
  let disposed = false;
  let lastResetCtx: ResetContext | null = null;
  const acts = new Map<number, { seq: number; obs: Observation; tick: number; warm: ((ok: boolean) => void) | null; sentAt: number }>();
  const resets = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

  pw.listener = (msg) => {
    switch (msg.type) {
      case "reset_ok": {
        const r = resets.get(msg.id);
        if (r) { resets.delete(msg.id); r.resolve(); }
        return;
      }
      case "action": {
        const a = acts.get(msg.id);
        if (!a) return;
        acts.delete(msg.id);
        if (a.warm) { a.warm(true); return; }
        const res = resultFor(msg.action, a.obs, a.tick, a.seq, msg.computeMs, controlHz, hold);
        if (res.status !== "error") hold = res.action.targets.slice();
        mailbox.deliver(a.seq, res);
        return;
      }
      case "error": {
        if (msg.id !== null) {
          const r = resets.get(msg.id);
          if (r) { resets.delete(msg.id); r.reject(new SeatDriverError(msg.message)); return; }
          const a = acts.get(msg.id);
          if (a) {
            acts.delete(msg.id);
            if (a.warm) { a.warm(false); return; }
            mailbox.deliver(a.seq, errorResult(new Error(msg.message), a.obs, a.tick, 0, hold));
          }
          return;
        }
        if (msg.fatal) {
          pw.dead = msg.message;
          for (const [id, r] of resets) { resets.delete(id); r.reject(new SeatDriverError(msg.message)); }
          for (const [id, a] of acts) {
            acts.delete(id);
            if (a.warm) a.warm(false);
            else mailbox.deliver(a.seq, errorResult(new Error(msg.message), a.obs, a.tick, 0, hold));
          }
        }
        return;
      }
      default:
        return;
    }
  };

  function post(req: WorkerRequest): void {
    if (!disposed) pw.worker.postMessage(req);
  }

  return {
    kind: spec.kind,
    name: spec.kind === "builtin" ? builtinDisplayName(spec.personality, spec.tier) : pw.name || spec.fileName,
    sha256: spec.kind === "module" ? spec.sha256 : null,
    claimedSha256: null,
    provenance: spec.kind === "module" ? pw.provenance : null,

    reset(ctx) {
      controlHz = ctx.control_hz;
      hold = ctx.home_pose.slice(0, 6);
      lastResetCtx = ctx;
      mailbox.clear();
      if (pw.dead) return Promise.reject(new SeatDriverError(pw.dead));
      const id = ++pw.nextId;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { if (resets.delete(id)) reject(new SeatDriverError("reset() took over 30 s")); }, WORKER_RESET_TIMEOUT_MS);
        resets.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        post({ type: "reset", id, ctx, evalClock: ctx.mode === "eval" });
      });
    },

    async warmup(fixture) {
      const deadline = performance.now() + WARMUP_BUDGET_MS;
      for (const obs of fixture.slice(0, WARMUP_ACTS)) {
        if (pw.dead) throw new SeatDriverError(pw.dead);
        const left = deadline - performance.now();
        if (left <= 0) throw new SeatDriverError("warm-up over 60 s");
        const id = ++pw.nextId;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { acts.delete(id); reject(new SeatDriverError("warm-up over 60 s")); }, left);
          acts.set(id, { seq: -1, obs, tick: -1, warm: () => { clearTimeout(timer); resolve(); }, sentAt: performance.now() });
          post({ type: "act", id, tick: -1, obs, simTimeMs: obs.t * 1000, warmup: true });
        });
      }
    },

    request(obs, tick) {
      if (disposed) return;
      const seq = mailbox.begin();
      if (pw.dead) { mailbox.deliver(seq, errorResult(new Error(pw.dead), obs, tick, 0, hold)); return; }
      const id = ++pw.nextId;
      // Only the newest request can still matter; older in-flight ids are forgotten (their replies are stale).
      for (const [oldId, a] of acts) if (!a.warm) acts.delete(oldId);
      acts.set(id, { seq, obs, tick, warm: null, sentAt: performance.now() });
      post({ type: "act", id, tick, obs, simTimeMs: obs.t * 1000, warmup: false });
    },

    poll: () => mailbox.poll(),
    waitForResult: (hardAbortMs) => mailbox.wait(hardAbortMs),

    dispose() {
      if (disposed) return;
      disposed = true;
      mailbox.clear();
      // A decision still in flight when a match ends is normal; one stuck for a second means the Worker is busy or hung.
      const now = performance.now();
      let stuck = false;
      for (const a of acts.values()) if (now - a.sentAt > POOL_MAX_INFLIGHT_MS) stuck = true;
      const idle = !stuck && resets.size === 0 && !pw.dead;
      pw.listener = null;
      acts.clear(); resets.clear();
      if (poolKey && idle) {
        const pooled = builtinPool.get(poolKey);
        // Keep the Worker whose history matters: a DDA match replaces a pooled Worker, anything else yields to it.
        const keepThis = !pooled || (spec.kind === "builtin" && spec.dda && lastResetCtx?.mode === "live");
        if (keepThis) {
          if (pooled && pooled !== pw) pooled.worker.terminate();
          builtinPool.set(poolKey, pw);
          return;
        }
      }
      if (poolKey && builtinPool.get(poolKey) === pw) builtinPool.delete(poolKey);
      pw.worker.terminate();
    },
  };
}

/* ───────────────────────── bridge Worker ───────────────────────── */

function createBridgeWorkerDriver(spec: Extract<PolicySpec, { kind: "bridge" }>, seat: Seat): SeatDriver {
  const worker = new Worker(new URL("./bridge-worker.ts", import.meta.url), { type: "module", name: "torquelimit-bridge" });
  const mailbox = createResultMailbox();
  let nextId = 0;
  let controlHz = 50;
  let hold: number[] = [0, 0, 0, 0, 0, 0];
  let opened: Promise<void> | null = null;
  let name = spec.url;
  let claimed: string | null = null;
  let provenance: Record<string, unknown> | null = null;
  let dead: string | null = null;
  const waits = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  const acts = new Map<number, { seq: number; obs: Observation; tick: number }>();
  let helloWait: { resolve: () => void; reject: (e: Error) => void } | null = null;

  worker.onmessage = (ev: MessageEvent<BridgeWorkerResponse>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "hello":
        name = msg.hello.version ? `${msg.hello.name} ${msg.hello.version}` : msg.hello.name;
        claimed = msg.hello.claimedSha256; provenance = msg.hello.provenance;
        helloWait?.resolve(); helloWait = null;
        return;
      case "reset_ok":
      case "warmup_ok": {
        const w = waits.get(msg.id);
        if (w) { waits.delete(msg.id); w.resolve(); }
        return;
      }
      case "action": {
        const a = acts.get(msg.id);
        if (!a) return;
        acts.delete(msg.id);
        const res = resultFor(msg.raw, a.obs, a.tick, a.seq, msg.roundTripMs, controlHz, hold);
        if (res.status !== "error") hold = res.action.targets.slice();
        mailbox.deliver(a.seq, res);
        return;
      }
      case "error": {
        const err = new SeatDriverError(msg.message);
        if (msg.id === null) {
          if (helloWait) { helloWait.reject(err); helloWait = null; }
          if (msg.fatal) dead = msg.message;
          return;
        }
        const w = waits.get(msg.id);
        if (w) { waits.delete(msg.id); w.reject(err); }
        const a = acts.get(msg.id);
        if (a) { acts.delete(msg.id); mailbox.deliver(a.seq, errorResult(err, a.obs, a.tick, 0, hold)); }
        if (msg.fatal) dead = msg.message;
        return;
      }
    }
  };
  worker.onerror = (ev: ErrorEvent) => { ev.preventDefault(); dead = ev.message || "bridge worker crashed"; helloWait?.reject(new SeatDriverError(dead)); helloWait = null; };

  function send(req: BridgeWorkerRequest): void { worker.postMessage(req); }

  function awaitReply(id: number, req: BridgeWorkerRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      waits.set(id, { resolve, reject });
      send(req);
    });
  }

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
      if (!opened) {
        opened = new Promise<void>((resolve, reject) => {
          helloWait = { resolve, reject };
          send({ type: "open", url: spec.url, allowLan: spec.allowLan, seat, sessionId: spec.sessionId, obsSchemaHash: schemaHashOf(ctx), controlHz: ctx.control_hz, decisionHz: ctx.decision_hz });
        });
      }
      await opened;
      if (dead) throw new SeatDriverError(dead);
      const id = ++nextId;
      await awaitReply(id, { type: "reset", id, ctx });
    },

    async warmup(fixture) {
      const id = ++nextId;
      await awaitReply(id, { type: "warmup", id, fixture: fixture.slice(0, WARMUP_ACTS) });
    },

    request(obs, tick) {
      const seq = mailbox.begin();
      if (dead) { mailbox.deliver(seq, errorResult(new Error(dead), obs, tick, 0, hold)); return; }
      const id = ++nextId;
      acts.clear();
      acts.set(id, { seq, obs, tick });
      send({ type: "act", id, tick, obs });
    },

    poll: () => mailbox.poll(),
    waitForResult: (hardAbortMs) => mailbox.wait(hardAbortMs),

    dispose() {
      mailbox.clear();
      try { send({ type: "close" }); } catch { /* worker already gone */ }
      // Give the Worker a moment to say bye before it is terminated.
      setTimeout(() => worker.terminate(), 250);
    },
  };
}

/* ───────────────────────── factory ───────────────────────── */

export const createSeatDriver: CreateSeatDriver = async (spec: PolicySpec, seat: Seat) => {
  if (!hasWorkers() || spec.kind === "trajectory") {
    return createInProcessSeatDriver(spec, seat, {});
  }
  switch (spec.kind) {
    case "builtin": {
      const key = `${spec.personality}:${spec.tier}`;
      const pooled = builtinPool.get(key);
      if (pooled && !pooled.dead) {
        builtinPool.delete(key);
        return createWorkerDriver(spec, pooled, key);
      }
      const pw = await loadPolicyWorker(spec);
      return createWorkerDriver(spec, pw, key);
    }
    case "module": {
      const pw = await loadPolicyWorker(spec);
      return createWorkerDriver(spec, pw, null);
    }
    case "bridge":
      return createBridgeWorkerDriver(spec, seat);
  }
};
