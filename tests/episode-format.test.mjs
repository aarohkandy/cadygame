import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EPISODE_FORMAT } from "../src/game/contracts.ts";
import { buildEpisodeMeta, buildMatchConfig } from "../src/game/match/match-config.ts";
import { createRecorder } from "../src/game/harness/recorder.ts";
import {
  EpisodeFormatError, createEpisodeCodec, decodeEpisodeText, encodeEpisodeText, episodeFileName, episodeToJson,
} from "../src/game/harness/episode-format.ts";
import { bytesEqual } from "../src/game/harness/typed-b64.ts";
import { createFakeEngine, fakeFrame, fakeModelInfo } from "../src/game/testing/fakes.ts";

const NOW = new Date("2026-09-16T12:00:00Z");
const PROV = { tuning: { strike: { k: 1 } }, tuningSha256: "a".repeat(64), servoParamsHash: "b".repeat(64), obsSchemaHash: "sha256:c", harnessCommit: "dev", userAgent: "test" };
const blocks = (v) => ({ state: new Float32Array(12).fill(v), self_ext: new Float32Array(32).fill(v), opponent_state: new Float32Array(28).fill(v), game: new Float32Array(16).fill(v), environment_state: new Float32Array(81).fill(v), contacts: new Float32Array(20).fill(v) });

/** A two-round recording with every stream populated, NaN and -0 included. */
function recordSample() {
  const cfg = buildMatchConfig({
    preset: "proving_ground", context: "lab", seed: 42, bestOf: 3, now: NOW, fairDelayMs: 120,
    seats: { atlas: { driver: { kind: "human" } }, blaze: { driver: { kind: "module", fileName: "p.mjs", source: "x", sha256: "d".repeat(64) } } },
  });
  const facts = { atlas: { name: "PILOT", sha256: null, claimedSha256: null, provenance: null, policyDeterministic: "unchecked", inputDevice: "keyboard_mouse" },
    blaze: { name: "p.mjs", sha256: "d".repeat(64), claimedSha256: null, provenance: { run: "r1" }, policyDeterministic: true, inputDevice: null } };
  const rec = createRecorder();
  rec.begin(buildEpisodeMeta(cfg, fakeModelInfo("harness"), facts, { atlas: null, blaze: null }, PROV, NOW));
  const engine = createFakeEngine({ mode: "harness", timestep: 0.005 });
  const frame = fakeFrame({ mode: "harness", dt: 0.005 });
  for (let round = 1; round <= 2; round++) {
    const state = engine.saveState();
    state.qpos[3] = round === 1 ? -0 : NaN;
    if (round === 1) rec.mutation({ kind: "timestep", step: 0, dt: 0.005 });
    rec.mutation({ kind: "reset", step: 0, seed: 100 + round, round, state });
    for (let tick = 0; tick < 120; tick++) {
      if (tick % 50 === 0) rec.checkpoint(tick * 4, engine.saveState(), (tick * 2654435761) >>> 0);
      const row = {
        frameIndex: (round - 1) * 120 + tick, t: tick * 0.02, round, phase: tick < 100 ? "fight" : "ko", discontinuity: tick === 0 ? 1 : 0,
        obs: { atlas: blocks(tick), blaze: blocks(-tick) }, delivered: { atlas: null, blaze: tick > 3 ? blocks(tick - 6) : null },
        applied: { atlas: new Float64Array(6).fill(tick / 100), blaze: new Float64Array(6).fill(-tick / 100) },
        raw: { atlas: null, blaze: tick % 2 ? new Float64Array([NaN, -0, 1e-300, 0, 0, 1]) : null },
        requestFrameIndex: { atlas: -1, blaze: tick % 2 ? tick - 1 : -1 }, obsFrameIndex: { atlas: -1, blaze: tick - 7 },
        chunkId: { atlas: -1, blaze: tick >> 1 }, chunkIndex: { atlas: -1, blaze: -1 }, intents: { atlas: tick & 1, blaze: 0 },
        status: { atlas: "ok", blaze: tick === 9 ? "late" : "ok" }, computeMs: { atlas: NaN, blaze: tick % 2 ? 1.25 : NaN },
        human: { atlas: { command: new Float32Array([1, 2, 3, 4, 5, 6]), shaping: 5 }, blaze: null }, displayLatencyMs: 16.5,
      };
      rec.tick(row);
      for (let k = 0; k < 4; k++) {
        frame.arms.atlas.ctrl.fill(Math.sin((tick * 4 + k) / 9));
        frame.arms.blaze.ctrl.fill(tick);
        rec.stepCtrl(tick * 4 + k, frame, { atlas: tick & 1, blaze: 0 });
      }
      if (tick === 60) rec.mutation({ kind: "place_cube", step: tick * 4, index: 4, pos: [0, 0, 0.22] });
      if (tick === 70) rec.mutation({ kind: "offline", step: tick * 4, seat: "blaze" });
    }
    rec.events([{ type: "strike", t: 1, step: 200, tier: "strike", attacker: "atlas", victim: "blaze", raw: 20, damage: 0, physicalDamage: -0, nu: NaN,
      vN: 2.5, zone: "wrist", tool: "gripper", crit: false, guarded: false, heavyC: 0, armoured: false, pos: [0, 0, 0.1], normal: [1, 0, 0], magnitude: Infinity,
      lethal: false, upgrade: false, thrownCube: -1 }]);
  }
  rec.sparse("policy.info.blaze", 5, { entropy: 0.12 });
  return rec.end({ winner: "atlas", roundsWon: { atlas: 2, blaze: 0 }, rounds: [{ round: 1, winner: "atlas", reason: "ko", tEnd: 2 }, { round: 2, winner: "atlas", reason: "ko", tEnd: 2 }], forfeit: null, determinism: "unchecked", error: null });
}

function assertStatesEqual(a, b, label) {
  assert.ok(Object.is(a.time, b.time), `${label}.time`);
  for (const k of ["qpos", "qvel", "ctrl", "qacc_warmstart", "servo"]) assert.ok(bytesEqual(a[k], b[k]), `${label}.${k}`);
}

describe("episode format torquelimit.episode/3", () => {
  test("export then import is byte-identical: columns, RLE streams, checkpoints, mutations, events, sparse", async () => {
    const ep = recordSample();
    const codec = createEpisodeCodec();
    const blob = codec.encode(ep);
    assert.equal(blob.type, "application/json");
    const back = codec.decode(await blob.text());
    assert.deepEqual(Object.keys(back.columns).sort(), Object.keys(ep.columns).sort());
    for (const name of Object.keys(ep.columns)) assert.ok(bytesEqual(ep.columns[name], back.columns[name]), name);
    for (const s of ["ctrl", "intents"]) {
      assert.ok(bytesEqual(ep.steps[s].steps, back.steps[s].steps), `${s}.steps`);
      assert.ok(bytesEqual(ep.steps[s].values, back.steps[s].values), `${s}.values`);
      assert.equal(back.steps[s].width, ep.steps[s].width);
    }
    assert.equal(back.steps.checkpoints.length, ep.steps.checkpoints.length);
    ep.steps.checkpoints.forEach((c, i) => {
      assert.equal(back.steps.checkpoints[i].step, c.step);
      assert.equal(back.steps.checkpoints[i].checksum, c.checksum);
      assertStatesEqual(c.state, back.steps.checkpoints[i].state, `checkpoint ${i}`);
    });
    ep.steps.mutations.forEach((m, i) => {
      const b = back.steps.mutations[i];
      if (m.kind === "reset") assertStatesEqual(m.state, b.state, `reset ${i}`);
      else assert.deepEqual(b, m);
    });
    const ev = back.events[0];
    assert.ok(Number.isNaN(ev.nu));
    assert.ok(Object.is(ev.physicalDamage, -0));
    assert.equal(ev.magnitude, Infinity);
    assert.deepEqual(back.sparse, ep.sparse);
    assert.deepEqual(back.meta, ep.meta);
    assert.deepEqual(back.shapes, ep.shapes);
  });

  test("float32 observation columns keep float32 and float64 keeps float64", () => {
    const back = decodeEpisodeText(encodeEpisodeText(recordSample()));
    assert.ok(back.columns["observation.state.atlas"] instanceof Float32Array);
    assert.ok(back.columns["action.blaze"] instanceof Float64Array);
    assert.ok(back.columns["policy.chunk_index.blaze"] instanceof Int16Array);
    const json = episodeToJson(recordSample());
    assert.equal(json.format, EPISODE_FORMAT);
    assert.equal(json.columns["action_raw.blaze"].dtype, "f64");
    assert.equal(json.columns.timestamp.dtype, "f64");
  });

  test("import rejects a wrong format, an unknown dtype, and a length mismatch with named errors", () => {
    const text = encodeEpisodeText(recordSample());
    const expectError = (mutate, code, path) => {
      const doc = JSON.parse(text);
      mutate(doc);
      assert.throws(() => decodeEpisodeText(JSON.stringify(doc)), (e) => {
        assert.ok(e instanceof EpisodeFormatError, e.message);
        assert.equal(e.code, code);
        if (path) assert.equal(e.path, path);
        assert.ok(e.label.length > 0);
        return true;
      });
    };
    expectError((d) => { d.format = "torquelimit.episode/2"; }, "wrong_format", "format");
    expectError((d) => { d.columns["round"].dtype = "f16"; }, "unknown_dtype", "columns.round");
    expectError((d) => { d.columns["action.blaze"].length += 6; }, "length_mismatch", "columns.action.blaze");
    expectError((d) => { d.shapes["observation.game.atlas"] = [15]; }, "length_mismatch", "columns.observation.game.atlas");
    expectError((d) => { d.steps.ctrl.width = 11; }, "length_mismatch", "steps.ctrl.values");
    expectError((d) => { d.steps.checkpoints[0].state.qpos.dtype = "f32"; }, "length_mismatch", "steps.checkpoints.0.state.qpos");
    expectError((d) => { d.steps.checkpoints[0].state.qpos = { dtype: "f32", length: 4, b64: "AAAAAAAAAAAAAAAAAAAAAA==" }; }, "malformed", "steps.checkpoints.0.state.qpos");
    expectError((d) => { delete d.meta.result; }, "malformed", "meta.result");
    assert.throws(() => decodeEpisodeText("{ not json"), (e) => e instanceof EpisodeFormatError && e.code === "not_json");
    assert.throws(() => decodeEpisodeText("[]"), (e) => e instanceof EpisodeFormatError && e.code === "not_json");
  });

  test("a /3 document imports and is stamped /4; /4 meta (session, rounds, quality) round-trips", () => {
    const ep = recordSample();
    ep.meta.quality = { clean: true, tier: "B", version: 1, reasons: ["LDLJ n/a"] };
    const text = encodeEpisodeText(ep);
    const back = decodeEpisodeText(text);
    assert.equal(back.meta.format, EPISODE_FORMAT);
    assert.deepEqual(back.meta.quality, ep.meta.quality);
    assert.ok(Array.isArray(back.meta.rounds) && back.meta.rounds.length === 2);
    const legacy = JSON.parse(text);
    legacy.format = "torquelimit.episode/3"; legacy.meta.format = "torquelimit.episode/3";
    delete legacy.meta.rounds; delete legacy.meta.quality;
    const up = decodeEpisodeText(JSON.stringify(legacy));
    assert.equal(up.meta.format, EPISODE_FORMAT, "an older file is read and stamped /4");
    assert.equal(up.meta.rounds, undefined);
  });

  test("file names are safe on every file system", () => {
    assert.equal(episodeFileName("2026-09-16T12:00:00.000Z-9f2c"), "2026-09-16T12-00-00.000Z-9f2c.tlep.json");
  });
});
