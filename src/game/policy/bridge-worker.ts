// src/game/policy/bridge-worker.ts (WP4)
// Proxy Worker for a bridge seat in the browser (GAME_DESIGN 5.2): owns the WebSocket (or HTTP fallback) so a
// busy main thread never delays a reply's arrival timestamp, and relays hello, reset, warm-up, and act for one
// seat. Protocol details live in bridge-client.ts; this file only moves messages.

import type { BridgeHello, Observation, ResetContext, Seat } from "../contracts.ts";
import { BridgeError, createBridgeClient, type BridgeClient } from "./bridge-client.ts";

export type BridgeWorkerRequest =
  | { type: "open"; url: string; allowLan: boolean; seat: Seat; sessionId: string; obsSchemaHash: string; controlHz: number; decisionHz: number }
  | { type: "reset"; id: number; ctx: ResetContext }
  | { type: "warmup"; id: number; fixture: Observation[] }
  | { type: "act"; id: number; tick: number; obs: Observation }
  | { type: "close" };

export type BridgeWorkerResponse =
  | { type: "hello"; hello: BridgeHello; transport: "websocket" | "http" }
  | { type: "reset_ok"; id: number }
  | { type: "warmup_ok"; id: number }
  | { type: "action"; id: number; raw: unknown; roundTripMs: number }
  | { type: "error"; id: number | null; message: string; fatal: boolean };

interface Scope {
  postMessage(msg: BridgeWorkerResponse): void;
  addEventListener(type: "message", fn: (ev: { data: BridgeWorkerRequest }) => void): void;
}

const scope = globalThis as unknown as Scope;
let client: BridgeClient | null = null;
let opening: Promise<void> | null = null;

function post(msg: BridgeWorkerResponse): void { scope.postMessage(msg); }

function fail(id: number | null, err: unknown): void {
  const fatal = err instanceof BridgeError ? err.fatal : false;
  post({ type: "error", id, message: err instanceof Error ? err.message : String(err), fatal });
}

async function handle(req: BridgeWorkerRequest): Promise<void> {
  switch (req.type) {
    case "open": {
      try {
        client = createBridgeClient({ url: req.url, allowLan: req.allowLan, seat: req.seat, sessionId: req.sessionId, obsSchemaHash: req.obsSchemaHash });
        const hello = await client.connect({ controlHz: req.controlHz, decisionHz: req.decisionHz });
        post({ type: "hello", hello, transport: client.transport ?? "websocket" });
      } catch (err) {
        fail(null, err instanceof BridgeError ? err : new BridgeError(String(err)));
      }
      return;
    }
    case "reset":
      if (opening) await opening;
      if (!client) { fail(req.id, new BridgeError("NOT CONNECTED")); return; }
      try { await client.reset(req.ctx, req.ctx.episode_id); post({ type: "reset_ok", id: req.id }); } catch (err) { fail(req.id, err); }
      return;
    case "warmup":
      if (!client) { fail(req.id, new BridgeError("NOT CONNECTED")); return; }
      try { await client.warmup(req.fixture); post({ type: "warmup_ok", id: req.id }); } catch (err) { fail(req.id, err); }
      return;
    case "act":
      if (!client) { fail(req.id, new BridgeError("NOT CONNECTED")); return; }
      try {
        const reply = await client.act(req.obs, req.tick);
        post({ type: "action", id: req.id, raw: reply.raw, roundTripMs: reply.roundTripMs });
      } catch (err) {
        fail(req.id, err);
      }
      return;
    case "close":
      client?.close();
      client = null;
      return;
  }
}

const inWorker = typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined" && typeof scope.addEventListener === "function";

if (inWorker) {
  scope.addEventListener("message", (ev) => {
    const req = ev.data;
    if (req.type === "open") {
      opening = handle(req).finally(() => { opening = null; });
      return;
    }
    void handle(req);
  });
}
