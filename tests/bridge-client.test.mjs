import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { after, describe, test } from "node:test";
import { BridgeError, checkBridgeUrl, createBridgeClient } from "../src/game/policy/bridge-client.ts";
import { createInProcessSeatDriver } from "../src/game/policy/in-process-driver.ts";
import { OBS_SCHEMA_HASH } from "../src/game/policy/obs-schema.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";
import { registrationContext } from "../src/game/policy/registration.ts";

/** An in-memory bridge server behind a fake WebSocket. */
function fakeServer(opts = {}) {
  const log = [];
  const factory = (url) => {
    const sock = {
      readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, url,
      send(text) {
        const msg = JSON.parse(text);
        log.push(msg);
        const reply = (m) => queueMicrotask(() => sock.onmessage?.({ data: JSON.stringify(m) }));
        switch (msg.type) {
          case "hello":
            if (opts.expectHash && msg.obs_schema_hash !== opts.expectHash) { reply({ type: "error", id: msg.id, message: "obs_schema_hash mismatch", fatal: true }); return; }
            reply({ type: "hello_ok", id: msg.id, policy: { name: "act_so101_v3", version: "2026-09-10", claimed_sha256: "abc", provenance: { run: "r1" } }, obs_format: opts.dict ? "dict" : "flat", supports_chunks: true, max_chunk: 100, chunk_hz: 50 });
            return;
          case "reset": reply({ type: "reset_ok", id: msg.id }); return;
          case "act":
            if (opts.stale && !msg.warmup) reply({ type: "action", id: msg.id - 1, action: [9, 9, 9, 9, 9, 9] });
            if (opts.ping) reply({ type: "ping", id: 900 + msg.id });
            reply(opts.chunks
              ? { type: "action", id: msg.id, chunk: [[0.1, 0, 0, 0, 0, 0.04], [0.2, 0, 0, 0, 0, 0.04]], chunk_hz: 50, chunk_start_t: msg.t, intent_chunk: [1, 0], info: { entropy: 0.12 } }
              : { type: "action", id: msg.id, action: [0.01, -0.4, 0.9, -0.3, 0, 0.05], intents: { guard: true } });
            return;
          default: return;
        }
      },
      close() { sock.readyState = 3; queueMicrotask(() => sock.onclose?.({})); },
    };
    if (opts.refuse) queueMicrotask(() => sock.onerror?.({}));
    else queueMicrotask(() => { sock.readyState = 1; sock.onopen?.({}); });
    return sock;
  };
  return { factory, log };
}

describe("bridge client (in-memory server)", () => {
  test("loopback only unless ALLOW LAN; bare host:port gets ws:// and the default port", () => {
    assert.equal(checkBridgeUrl("127.0.0.1", false).toString(), "ws://127.0.0.1:8765/");
    assert.equal(checkBridgeUrl("http://localhost:9000", false).toString(), "ws://localhost:9000/");
    assert.throws(() => checkBridgeUrl("ws://192.168.1.20:8765", false), /LOOPBACK ONLY/);
    assert.equal(checkBridgeUrl("ws://192.168.1.20:8765", true).hostname, "192.168.1.20");
    assert.throws(() => checkBridgeUrl("ftp://127.0.0.1", false), /UNSUPPORTED SCHEME/);
  });

  test("hello carries the schema hash, seats, rates and limits, and no image request", async () => {
    const srv = fakeServer();
    const c = createBridgeClient({ url: "127.0.0.1:8765", allowLan: false, seat: "blaze", sessionId: "s1", socketFactory: srv.factory, fetchFn: null });
    const hello = await c.connect({ controlHz: 50, decisionHz: 25 });
    assert.deepEqual(hello, { name: "act_so101_v3", version: "2026-09-10", claimedSha256: "abc", provenance: { run: "r1" }, supportsChunks: true, maxChunk: 100, chunkHz: 50 });
    const h = srv.log[0];
    assert.equal(h.protocol, "torquelimit.bridge/2");
    assert.equal(h.observation_schema, "torquelimit.obs/3");
    assert.equal(h.obs_schema_hash, OBS_SCHEMA_HASH);
    assert.deepEqual(h.seats, ["blaze"]);
    assert.equal(h.control_hz, 50); assert.equal(h.decision_hz, 25);
    assert.equal(h.joint_limits.length, 6);
    assert.equal("images" in h, false);
    c.close();
    assert.equal(srv.log.at(-1).type, "bye");
  });

  test("a server that rejects the schema hash fails the connect with its message", async () => {
    const srv = fakeServer({ expectHash: "sha256:other" });
    const c = createBridgeClient({ url: "127.0.0.1", allowLan: false, seat: "atlas", sessionId: "s", socketFactory: srv.factory, fetchFn: null });
    await assert.rejects(c.connect({ controlHz: 50, decisionHz: 25 }), (e) => e instanceof BridgeError && /mismatch/.test(e.message) && e.fatal);
  });

  test("acts send all six flat blocks; stale ids are dropped; pings are answered; chunks translate", async () => {
    const srv = fakeServer({ stale: true, ping: true, chunks: true });
    const c = createBridgeClient({ url: "127.0.0.1", allowLan: false, seat: "atlas", sessionId: "s", socketFactory: srv.factory, fetchFn: null });
    await c.connect({ controlHz: 50, decisionHz: 25 });
    const obs = emptyObservation("atlas");
    obs.t = 2.2;
    obs.blocks.state[0] = 0.5;
    const r1 = await c.act(obs, 110);
    const sent = srv.log.find((m) => m.type === "act");
    for (const b of ["state", "self_ext", "opponent_state", "game", "environment_state", "contacts"]) assert.ok(Array.isArray(sent[b]), b);
    assert.equal(sent.state[0], 0.5);
    assert.equal(sent.obs, undefined, "flat format sends no dict");
    assert.deepEqual(r1.raw.chunk[1], [0.2, 0, 0, 0, 0, 0.04]);
    assert.equal(r1.raw.chunkStartT, 2.2);
    assert.deepEqual(r1.raw.intentChunk, [1, 0]);
    const r2 = await c.act(obs, 112);
    assert.notDeepEqual(r2.raw.chunk[0], [9, 9, 9, 9, 9, 9]);
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(srv.log.some((m) => m.type === "pong"));
    c.close();
  });

  test("falls back to HTTP POST /v1/<type> when the socket cannot open", async () => {
    const srv = fakeServer({ refuse: true });
    const posts = [];
    const fetchFn = async (url, init) => {
      const msg = JSON.parse(init.body);
      posts.push([url, msg.type]);
      const body = msg.type === "hello" ? { type: "hello_ok", id: msg.id, policy: { name: "http policy" } } : msg.type === "reset" ? { type: "reset_ok", id: msg.id } : { type: "action", id: msg.id, action: [0, 0, 0, 0, 0, 0.04] };
      return { ok: true, status: 200, json: async () => body };
    };
    const c = createBridgeClient({ url: "127.0.0.1:9100", allowLan: false, seat: "blaze", sessionId: "s", socketFactory: srv.factory, fetchFn });
    const hello = await c.connect({ controlHz: 50, decisionHz: 25 });
    assert.equal(c.transport, "http");
    assert.equal(hello.name, "http policy");
    await c.reset(registrationContext("blaze", 5), "ep");
    const reply = await c.act(emptyObservation("blaze"), 1);
    assert.deepEqual(reply.raw.targets, [0, 0, 0, 0, 0, 0.04]);
    assert.deepEqual(posts.map((p) => p[0]), ["http://127.0.0.1:9100/v1/hello", "http://127.0.0.1:9100/v1/reset", "http://127.0.0.1:9100/v1/act"]);
  });
});

/* ── the reference server (tools/bridge/torquelimit_bridge.py, standard library only) ── */

const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

async function startReference(extra = []) {
  const port = await freePort();
  const proc = spawn(python, ["tools/bridge/torquelimit_bridge.py", "--port", String(port), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  const deadline = Date.now() + 8000;
  for (;;) {
    const up = await new Promise((resolve) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); resolve(true); }); s.on("error", () => resolve(false)); });
    if (up) break;
    if (Date.now() > deadline) { proc.kill(); throw new Error("reference bridge did not start"); }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { port, proc };
}

describe("bridge against the reference server", { skip: python ? false : "python3 not installed" }, () => {
  const procs = [];
  after(() => { for (const p of procs) p.kill(); });

  test("hello → reset → warmup → 500 acts with two seats: 0 errors, median round trip < 5 ms", async () => {
    const { port, proc } = await startReference();
    procs.push(proc);
    const url = `ws://127.0.0.1:${port}`;
    const drivers = {};
    for (const seat of ["atlas", "blaze"]) {
      drivers[seat] = await createInProcessSeatDriver({ kind: "bridge", url, allowLan: false, sessionId: "two-seats" }, seat, {});
      const ctx = registrationContext(seat, 1234);
      await drivers[seat].reset(ctx);
      await drivers[seat].warmup(Array.from({ length: 8 }, () => emptyObservation(seat)));
    }
    const rtts = [];
    let errors = 0;
    for (let i = 0; i < 500; i++) {
      for (const seat of ["atlas", "blaze"]) {
        const obs = emptyObservation(seat);
        obs.t = i * 0.04;
        drivers[seat].request(obs, i * 2);
        const r = await drivers[seat].waitForResult(30_000);
        if (r.status === "error") errors++;
        rtts.push(r.computeMs);
      }
    }
    for (const d of Object.values(drivers)) d.dispose();
    rtts.sort((a, b) => a - b);
    assert.equal(errors, 0);
    assert.ok(rtts[Math.floor(rtts.length / 2)] < 5, `median ${rtts[Math.floor(rtts.length / 2)]} ms`);
  });

  test("a server started with a different schema hash rejects hello", async () => {
    const { port, proc } = await startReference(["--schema-hash", "sha256:0000"]);
    procs.push(proc);
    const c = createBridgeClient({ url: `ws://127.0.0.1:${port}`, allowLan: false, seat: "blaze", sessionId: "s" });
    await assert.rejects(c.connect({ controlHz: 50, decisionHz: 25 }), /obs_schema_hash/);
    c.close();
  });
});
