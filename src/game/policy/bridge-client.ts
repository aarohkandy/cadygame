// src/game/policy/bridge-client.ts (WP4)
// Client side of the local bridge protocol torquelimit.bridge/2 (GAME_DESIGN 5.7), shared by the bridge Worker
// in the browser and the in-process driver under Node (global WebSocket in Node ≥ 22).
//
//  - WebSocket to ws://127.0.0.1:<port> with JSON text frames; loopback only unless Allow LAN is on.
//  - HTTP fallback when the socket cannot open: POST http://<host>:<port>/v1/{hello,reset,warmup,act}, same bodies.
//  - hello → hello_ok (policy name, version, claimed sha, provenance, chunk support); reset/reset_ok per round per
//    seat; warmup (8 acts flagged warmup); act → action with the same id; stale ids are dropped; ping → pong; bye.
//  - This build sends no image request and no binary frames (policy image cameras are cut, BUILD_PLAN 2.1).

import {
  JOINT_LIMITS, JOINT_NAMES, OBS_BLOCKS, OBS_SCHEMA,
  type BridgeHello, type ObsBlockName, type Observation, type ResetContext, type Seat,
} from "../contracts.ts";
import { OBS_SCHEMA_HASH } from "./obs-schema.ts";

export const BRIDGE_PROTOCOL = "torquelimit.bridge/2";
export const BRIDGE_DEFAULT_PORT = 8765;
export const BRIDGE_HELLO_TIMEOUT_MS = 5000;
export const BRIDGE_RESET_TIMEOUT_MS = 30_000;
export const BRIDGE_WARMUP_BUDGET_MS = 60_000;
export const BRIDGE_WARMUP_COUNT = 8;

export class BridgeError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal = true) {
    super(message);
    this.name = "BridgeError";
    this.fatal = fatal;
  }
}

/** The subset of WebSocket this client needs (browser WebSocket and Node's global both fit). */
export interface BridgeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}
export type BridgeSocketFactory = (url: string) => BridgeSocket;
export type BridgeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Parses and checks a bridge address. Accepts ws://, wss://, http:// or a bare host:port. */
export function checkBridgeUrl(raw: string, allowLan: boolean): URL {
  const text = raw.trim();
  if (!text) throw new BridgeError("NO ADDRESS");
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `ws://${text}`);
  } catch {
    throw new BridgeError(`BAD ADDRESS · ${text}`);
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new BridgeError(`UNSUPPORTED SCHEME · ${url.protocol}`);
  if (!url.port) url.port = String(BRIDGE_DEFAULT_PORT);
  if (!allowLan && !LOOPBACK_HOSTS.has(url.hostname)) throw new BridgeError(`LOOPBACK ONLY · ${url.hostname} (turn on ALLOW LAN)`);
  return url;
}

export interface BridgeClientOptions {
  url: string;
  allowLan: boolean;
  seat: Seat | null;
  sessionId: string;
  socketFactory?: BridgeSocketFactory | null;
  fetchFn?: BridgeFetch | null;
  obsSchemaHash?: string;
}

export interface BridgeHelloParams { controlHz: number; decisionHz: number; }

export interface BridgeActReply { raw: unknown; info: unknown; roundTripMs: number; }

export interface BridgeClient {
  readonly hello: BridgeHello | null;
  readonly obsFormat: "flat" | "dict";
  readonly transport: "websocket" | "http" | null;
  connect(params: BridgeHelloParams): Promise<BridgeHello>;
  reset(ctx: ResetContext, episodeId: string): Promise<void>;
  warmup(fixture: readonly Observation[]): Promise<void>;
  act(obs: Observation, tick: number, warmup?: boolean): Promise<BridgeActReply>;
  close(): void;
}

type Pending = { resolve: (msg: Record<string, unknown>) => void; reject: (err: BridgeError) => void; sentAt: number; expect: string };

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}

/** Flat blocks as plain arrays, the dict (without blocks) only when the server asked for dict. */
export function actBody(obs: Observation, id: number, seat: Seat | null, tick: number, warmup: boolean, format: "flat" | "dict"): Record<string, unknown> {
  const body: Record<string, unknown> = { type: "act", id, seat, tick, t: obs.t, warmup };
  for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) body[name] = Array.from(obs.blocks[name]);
  if (format === "dict") {
    const { blocks: _blocks, ...dict } = obs;
    void _blocks;
    body.obs = dict;
  }
  return body;
}

/** Translates a bridge `action` message into a PolicyAction-shaped object for validateAction. */
export function actionFromMessage(msg: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {};
  if (msg.action !== undefined) out.targets = msg.action;
  if (msg.chunk !== undefined) out.chunk = msg.chunk;
  if (msg.chunk_hz !== undefined) out.chunkHz = msg.chunk_hz;
  if (msg.chunk_start_t !== undefined) out.chunkStartT = msg.chunk_start_t;
  if (msg.intent_chunk !== undefined) out.intentChunk = msg.intent_chunk;
  if (msg.intents !== undefined) out.intents = msg.intents;
  if (msg.info !== undefined) out.info = msg.info;
  return out;
}

export function createBridgeClient(opts: BridgeClientOptions): BridgeClient {
  const url = checkBridgeUrl(opts.url, opts.allowLan);
  const socketFactory: BridgeSocketFactory | null = opts.socketFactory !== undefined ? opts.socketFactory : defaultSocketFactory();
  const fetchFn: BridgeFetch | null = opts.fetchFn !== undefined ? opts.fetchFn : defaultFetch();
  const schemaHash = opts.obsSchemaHash ?? OBS_SCHEMA_HASH;

  let socket: BridgeSocket | null = null;
  let transport: "websocket" | "http" | null = null;
  let helloOk: BridgeHello | null = null;
  let format: "flat" | "dict" = "flat";
  let nextId = 1;
  let closed = false;
  let fatal: BridgeError | null = null;
  const pending = new Map<number, Pending>();

  function failAll(err: BridgeError): void {
    fatal = err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }

  function onMessage(data: unknown): void {
    if (typeof data !== "string") return;          // binary frames are not part of this build's protocol
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(data) as Record<string, unknown>; } catch { return; }
    const type = msg.type;
    if (type === "ping") { sendRaw({ type: "pong", id: msg.id }); return; }
    if (type === "bye") { failAll(new BridgeError("SERVER SAID BYE")); return; }
    const id = typeof msg.id === "number" ? msg.id : null;
    if (type === "error") {
      const err = new BridgeError(typeof msg.message === "string" ? msg.message : "bridge error", msg.fatal === true);
      if (id !== null && pending.has(id)) { const p = pending.get(id) as Pending; pending.delete(id); p.reject(err); }
      if (err.fatal) { failAll(err); socket?.close(); }
      return;
    }
    if (id === null) return;
    const p = pending.get(id);
    if (!p) return;                                  // stale id: dropped (the driver logs late)
    pending.delete(id);
    p.resolve(msg);
  }

  function sendRaw(body: Record<string, unknown>): void {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(body));
  }

  async function openSocket(): Promise<boolean> {
    if (!socketFactory) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let s: BridgeSocket;
      try {
        s = socketFactory(url.toString());
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => { if (!settled) { settled = true; try { s.close(); } catch { /* already closing */ } resolve(false); } }, BRIDGE_HELLO_TIMEOUT_MS);
      s.onopen = () => { if (settled) return; settled = true; clearTimeout(timer); socket = s; resolve(true); };
      s.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(false); };
      s.onmessage = (ev) => onMessage(ev.data);
      s.onclose = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(false); return; }
        if (socket === s) { socket = null; if (!closed) failAll(new BridgeError("CONNECTION LOST")); }
      };
    });
  }

  async function request(body: Record<string, unknown>, expect: string, timeoutMs: number): Promise<Record<string, unknown>> {
    if (fatal) throw fatal;
    if (closed) throw new BridgeError("CLOSED");
    const id = typeof body.id === "number" ? body.id : nextId++;
    body.id = id;
    if (transport === "http") {
      if (!fetchFn) throw new BridgeError("NO HTTP TRANSPORT");
      const httpUrl = `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}/v1/${String(body.type)}`;
      const t0 = nowMs();
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = timeoutMs > 0 ? setTimeout(() => ctl?.abort(), timeoutMs) : null;
      try {
        const res = await fetchFn(httpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(ctl ? { signal: ctl.signal } : {}) } as Parameters<BridgeFetch>[1]);
        if (!res.ok) throw new BridgeError(`HTTP ${res.status}`, res.status >= 500 ? false : true);
        const msg = (await res.json()) as Record<string, unknown>;
        if (msg.type === "error") throw new BridgeError(typeof msg.message === "string" ? msg.message : "bridge error", msg.fatal === true);
        if (msg.type !== expect) throw new BridgeError(`EXPECTED ${expect} · GOT ${String(msg.type)}`);
        msg.__rtt = nowMs() - t0;
        return msg;
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        // fetch rejects only on network failure or abort: nothing is listening, or it stopped answering.
        throw new BridgeError(ctl?.signal.aborted ? `NO ${expect.toUpperCase()} IN ${Math.round(timeoutMs / 1000)} S` : `NO BRIDGE AT ${url.host}`, !ctl?.signal.aborted);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!socket) throw new BridgeError("NOT CONNECTED");
    const sentAt = nowMs();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        if (pending.delete(id)) reject(new BridgeError(`NO ${expect.toUpperCase()} IN ${Math.round(timeoutMs / 1000)} S`, false));
      }, timeoutMs) : null;
      pending.set(id, {
        sentAt, expect,
        resolve: (msg) => {
          if (timer) clearTimeout(timer);
          if (msg.type !== expect) { reject(new BridgeError(`EXPECTED ${expect} · GOT ${String(msg.type)}`)); return; }
          msg.__rtt = nowMs() - sentAt;
          resolve(msg);
        },
        reject: (err) => { if (timer) clearTimeout(timer); reject(err); },
      });
      (socket as BridgeSocket).send(JSON.stringify(body));
    });
  }

  const client: BridgeClient = {
    get hello() { return helloOk; },
    get obsFormat() { return format; },
    get transport() { return transport; },

    async connect(params) {
      if (helloOk) return helloOk;
      if (await openSocket()) transport = "websocket";
      else if (fetchFn) transport = "http";
      else throw new BridgeError(`NO BRIDGE AT ${url.host}`);
      const body = {
        type: "hello", protocol: BRIDGE_PROTOCOL, observation_schema: OBS_SCHEMA, obs_schema_hash: schemaHash,
        session_id: opts.sessionId, seats: opts.seat ? [opts.seat] : [],
        control_hz: params.controlHz, decision_hz: params.decisionHz,
        joint_names: [...JOINT_NAMES], joint_limits: JOINT_LIMITS.map((l) => [l[0], l[1]]),
        units: "rad", formats: ["dict", "flat"],
      };
      const msg = await request(body, "hello_ok", BRIDGE_HELLO_TIMEOUT_MS);
      if (typeof msg.obs_schema_hash === "string" && msg.obs_schema_hash !== schemaHash) {
        client.close();
        throw new BridgeError(`SCHEMA MISMATCH · server ${msg.obs_schema_hash.slice(0, 19)}`);
      }
      const policy = (msg.policy && typeof msg.policy === "object" ? msg.policy : {}) as Record<string, unknown>;
      format = msg.obs_format === "dict" ? "dict" : "flat";
      helloOk = {
        name: typeof policy.name === "string" && policy.name ? policy.name : "bridge policy",
        version: typeof policy.version === "string" ? policy.version : null,
        claimedSha256: typeof policy.claimed_sha256 === "string" ? policy.claimed_sha256 : null,
        provenance: policy.provenance && typeof policy.provenance === "object" ? policy.provenance as Record<string, unknown> : null,
        supportsChunks: msg.supports_chunks === true,
        maxChunk: typeof msg.max_chunk === "number" ? msg.max_chunk : 1,
        chunkHz: typeof msg.chunk_hz === "number" ? msg.chunk_hz : params.controlHz,
      };
      return helloOk;
    },

    async reset(ctx, episodeId) {
      await request({ type: "reset", seat: opts.seat, session_id: opts.sessionId, episode_id: episodeId, round: ctx.round, seed: ctx.seed, context: ctx }, "reset_ok", BRIDGE_RESET_TIMEOUT_MS);
    },

    async warmup(fixture) {
      const deadline = nowMs() + BRIDGE_WARMUP_BUDGET_MS;
      const count = Math.min(BRIDGE_WARMUP_COUNT, fixture.length);
      if (transport === "websocket") sendRaw({ type: "warmup", id: nextId++, seat: opts.seat, count });
      for (let i = 0; i < count; i++) {
        const left = deadline - nowMs();
        if (left <= 0) throw new BridgeError("WARM-UP OVER 60 S", false);
        await request(actBody(fixture[i], nextId++, opts.seat, -1 - i, true, format), "action", left);
      }
    },

    async act(obs, tick, warmup = false) {
      const msg = await request(actBody(obs, nextId++, opts.seat, tick, warmup, format), "action", 0);
      return { raw: actionFromMessage(msg), info: msg.info, roundTripMs: typeof msg.__rtt === "number" ? msg.__rtt : 0 };
    },

    close() {
      if (closed) return;
      closed = true;
      if (socket && socket.readyState === 1) {
        try { socket.send(JSON.stringify({ type: "bye" })); } catch { /* socket already closing */ }
      }
      try { socket?.close(1000, "bye"); } catch { /* already closed */ }
      socket = null;
      for (const p of pending.values()) p.reject(new BridgeError("CLOSED", false));
      pending.clear();
    },
  };
  return client;
}

function defaultSocketFactory(): BridgeSocketFactory | null {
  const WS = (globalThis as { WebSocket?: new (url: string) => BridgeSocket }).WebSocket;
  return WS ? (u) => new WS(u) : null;
}

function defaultFetch(): BridgeFetch | null {
  const f = (globalThis as { fetch?: BridgeFetch }).fetch;
  return f ? (u, init) => f(u, init) : null;
}
