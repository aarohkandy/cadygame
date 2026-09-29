// src/game/policy/policy-worker.ts (WP4)
// The policy Worker (GAME_DESIGN 5.2): one policy per Worker realm, built-in or uploaded, behind the
// WorkerRequest/WorkerResponse protocol in contracts.ts. Uploaded modules are imported from a Blob URL after the
// determinism shim is installed; every reset reseeds Math.random from ctx.seed, and in eval timing Date.now and
// performance.now report sim time while the policy runs. Compute time is measured with the real clock captured
// before the shim. Raw actions go back unvalidated: the main thread validates every transport the same way.

import type { Observation, PolicyAction, ResetContext, WorkerRequest, WorkerResponse } from "../contracts.ts";
import * as builtin from "./opponent/index.ts";
import { createPolicyRngShim, realNow } from "./policy-rng-shim.ts";

interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
  addEventListener(type: "message", fn: (ev: { data: WorkerRequest }) => void): void;
  addEventListener(type: "error" | "unhandledrejection", fn: (ev: { message?: string; reason?: unknown; preventDefault?: () => void }) => void): void;
}

interface LoadedPolicy {
  reset?: (ctx: ResetContext) => unknown;
  act: (obs: Observation) => unknown;
}

const scope = globalThis as unknown as WorkerScope;
const shim = createPolicyRngShim(0);
let policy: LoadedPolicy | null = null;
let loading: Promise<void> | null = null;

function post(msg: WorkerResponse): void {
  scope.postMessage(msg);
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name === "Error" ? "" : `${err.name}: `}${err.message}`.slice(0, 300);
  return String(err).slice(0, 300);
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
  return !!x && typeof (x as { then?: unknown }).then === "function";
}

async function load(req: Extract<WorkerRequest, { type: "load" }>): Promise<void> {
  shim.install();
  if (req.kind === "builtin") {
    policy = { reset: builtin.reset, act: builtin.act };
    post({ type: "loaded", name: builtin.policyName, provenance: { ...builtin.provenance } });
    return;
  }
  const source = req.source ?? "";
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as Record<string, unknown>;
    const def = (mod.default && typeof mod.default === "object" ? mod.default : {}) as Record<string, unknown>;
    const act = mod.act ?? def.act;
    const reset = mod.reset ?? def.reset;
    if (typeof act !== "function") {
      post({ type: "error", id: null, message: "module does not export act()", fatal: true });
      return;
    }
    policy = { act: act as LoadedPolicy["act"], reset: typeof reset === "function" ? reset as LoadedPolicy["reset"] : undefined };
    const name = typeof mod.policyName === "string" && mod.policyName ? mod.policyName : req.fileName ?? "policy";
    const provenance = mod.provenance && typeof mod.provenance === "object" ? structuredCloneSafe(mod.provenance) : null;
    post({ type: "loaded", name, provenance });
  } catch (err) {
    post({ type: "error", id: null, message: `import failed: ${describe(err)}`, fatal: true });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function structuredCloneSafe(x: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(JSON.stringify(x)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function reset(req: Extract<WorkerRequest, { type: "reset" }>): Promise<void> {
  if (loading) await loading;
  if (!policy) { post({ type: "error", id: req.id, message: "no policy loaded", fatal: true }); return; }
  shim.reseed(req.ctx.seed);
  shim.setEvalClock(req.evalClock);
  shim.setSimTimeMs(0);
  try {
    const r = policy.reset?.(req.ctx);
    if (isThenable(r)) await r;
    post({ type: "reset_ok", id: req.id });
  } catch (err) {
    post({ type: "error", id: req.id, message: `reset() threw: ${describe(err)}`, fatal: false });
  }
}

async function act(req: Extract<WorkerRequest, { type: "act" }>): Promise<void> {
  if (loading) await loading;
  if (!policy) { post({ type: "error", id: req.id, message: "no policy loaded", fatal: true }); return; }
  shim.setSimTimeMs(req.simTimeMs);
  const t0 = realNow();
  try {
    let raw = policy.act(req.obs);
    if (isThenable(raw)) raw = await raw;
    const computeMs = realNow() - t0;
    try {
      post({ type: "action", id: req.id, action: raw as PolicyAction, computeMs });
    } catch (err) {
      // Not structured-cloneable (functions, symbols): report it as the policy's error.
      post({ type: "error", id: req.id, message: `act() returned an uncloneable value: ${describe(err)}`, fatal: false });
    }
  } catch (err) {
    post({ type: "error", id: req.id, message: `act() threw: ${describe(err)}`, fatal: false });
  }
}

/** Only a dedicated Worker realm listens; importing this file elsewhere (Node import checks) does nothing. */
const inWorker = typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined" && typeof scope.addEventListener === "function";

if (inWorker) scope.addEventListener("message", (ev) => {
  const req = ev.data;
  switch (req.type) {
    case "load":
      loading = load(req).finally(() => { loading = null; });
      return;
    case "reset":
      void reset(req);
      return;
    case "act":
      void act(req);
      return;
  }
});

if (inWorker) scope.addEventListener("unhandledrejection", (ev) => {
  post({ type: "error", id: null, message: `unhandled rejection: ${describe(ev.reason)}`, fatal: false });
  ev.preventDefault?.();
});
