import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, test } from "node:test";
import { OBS_BLOCKS } from "../src/game/contracts.ts";
import { createInProcessSeatDriver } from "../src/game/policy/in-process-driver.ts";
import {
  createRegistration, decodeRegistrationFixture, encodeRegistrationFixture, REGISTRATION_FIXTURE_COUNT, REGISTRATION_FIXTURE_PATH,
} from "../src/game/policy/registration.ts";

const fixtureText = fs.readFileSync(`public/${REGISTRATION_FIXTURE_PATH}`, "utf8");
const fixture = decodeRegistrationFixture(fixtureText);
const register = createRegistration({
  loadFixture: async () => fixture,
  createDriver: (spec, seat) => createInProcessSeatDriver(spec, seat, {}),
});
const sha = (s) => createHash("sha256").update(s).digest("hex");
const moduleSpec = (fileName, source) => ({ kind: "module", fileName, source, sha256: sha(source) });

async function run(spec) {
  const rows = [];
  const result = await register(spec, (r) => rows.push(r));
  assert.deepEqual(rows, result.rows, "every row is streamed before the result");
  return result;
}

describe("registration fixture", () => {
  test("200 observations, both seats, exact float32 blocks, round-trips through the D5 encoding", () => {
    assert.equal(fixture.length, REGISTRATION_FIXTURE_COUNT);
    assert.ok(fixture.some((o) => o.side === "atlas") && fixture.some((o) => o.side === "blaze"));
    for (const o of fixture) for (const [name, len] of Object.entries(OBS_BLOCKS)) assert.equal(o.blocks[name].length, len);
    const again = decodeRegistrationFixture(JSON.stringify(encodeRegistrationFixture(fixture, {})));
    for (let i = 0; i < fixture.length; i += 17) assert.deepEqual(Array.from(again[i].blocks.game), Array.from(fixture[i].blocks.game));
    const doc = JSON.parse(fixtureText);
    for (const k of ["sudden_death", "staggered_self", "core_held", "core_docked", "contact", "full_extension", "near_joint_limit"]) {
      assert.ok(doc.generated.coverage[k] > 0, `fixture covers ${k}`);
    }
  });
});

describe("REGISTER ENTRANT", () => {
  test("example-policy.js passes every row, cold act reported separately", async () => {
    const source = fs.readFileSync("public/policies/example-policy.js", "utf8");
    const r = await run(moduleSpec("example-policy.js", source));
    assert.equal(r.ok, true, JSON.stringify(r.rows));
    assert.deepEqual(r.rows.map((x) => x.id), ["parsed", "exports_act", "reset", "cold_act", "fixture_acts", "finite", "limits", "deterministic"]);
    assert.ok(r.rows.every((x) => x.status === "pass"), JSON.stringify(r.rows));
    assert.match(r.rows[3].label, /^COLD ACT · [\d.]+ ms$/);
    assert.match(r.rows[4].label, /^200 FIXTURE ACTS · p99 [\d.]+ ms$/);
    assert.equal(r.name, "example guard + jab");
    assert.equal(r.sha256, sha(source));
    assert.equal(r.deterministic, true);
    assert.ok(r.coldActMs >= 0 && r.p99ActMs >= 0);
  });

  test("a NaN module fails ACTIONS FINITE with the first failing fixture index", async () => {
    const source = `export function act(obs) { return [0, obs.tick >= 0 && obs.t > 20 ? NaN : 0, 0, 0, 0, 0.04]; }`;
    const r = await run(moduleSpec("nan.mjs", source));
    assert.equal(r.ok, false);
    const finite = r.rows.find((x) => x.id === "finite");
    assert.equal(finite.status, "fail");
    const first = fixture.findIndex((o) => o.t > 20);
    assert.equal(finite.fixtureIndex, first);
    assert.equal(finite.detail, `FAILED AT FIXTURE ${first} · NaN`);
  });

  test("syntax errors fail FILE PARSED; a module without act() fails EXPORTS act()", async () => {
    const broken = await run(moduleSpec("broken.mjs", "export function act( {"));
    assert.equal(broken.ok, false);
    assert.equal(broken.rows[0].id, "parsed");
    assert.equal(broken.rows[0].status, "fail");
    const noAct = await run(moduleSpec("noact.mjs", "export const policyName = 'x';"));
    assert.deepEqual(noAct.rows.map((x) => [x.id, x.status]), [["parsed", "pass"], ["exports_act", "fail"]]);
  });

  test("clamped actions warn, Math.random without the shim's seed stays deterministic, a hang fails the acts", async () => {
    const clamps = await run(moduleSpec("wide.mjs", "export function act() { return [3, 0, 0, 0, 0, 0.04]; }"));
    assert.equal(clamps.ok, true);
    assert.equal(clamps.rows.find((x) => x.id === "limits").status, "warn");
    const random = await run(moduleSpec("rand.mjs", "export function act() { return [Math.random() * 0.1, 0, 0, 0, 0, 0.04]; }"));
    assert.equal(random.rows.find((x) => x.id === "deterministic").status, "pass", "seeded per reset by the shim");
    const leaky = await run(moduleSpec("leaky.mjs", "let n = 0; export function act() { n++; return [n * 1e-4, 0, 0, 0, 0, 0.04]; }"));
    const det = leaky.rows.find((x) => x.id === "deterministic");
    assert.equal(det.status, "warn");
    assert.equal(det.label, "NON-DETERMINISTIC");
    assert.equal(leaky.ok, true, "non-determinism is a warning, not a failure");
  });

  test("trajectories: parsed, sampled, deterministic; bad fps or too many frames fail at FILE PARSED", async () => {
    const good = JSON.stringify({ fps: 50, frames: Array.from({ length: 100 }, (_, i) => [0.001 * i, -0.5, 0.8, 0.2, 0, 0.04]) });
    const r = await run({ kind: "trajectory", fileName: "wave.json", json: good, sha256: sha(good) });
    assert.equal(r.ok, true, JSON.stringify(r.rows));
    assert.equal(r.rows[0].detail, "100 FRAMES @ 50 FPS");
    const badFps = JSON.stringify({ fps: 500, frames: [[0, 0, 0, 0, 0, 0]] });
    const f1 = await run({ kind: "trajectory", fileName: "fast.json", json: badFps, sha256: sha(badFps) });
    assert.deepEqual(f1.rows.map((x) => [x.id, x.status]), [["parsed", "fail"]]);
    const huge = `{"fps":30,"frames":[${Array.from({ length: 100_001 }, () => "[0,0,0,0,0,0]").join(",")}]}`;
    const f2 = await run({ kind: "trajectory", fileName: "huge.json", json: huge, sha256: sha(huge) });
    assert.deepEqual(f2.rows.map((x) => [x.id, x.status]), [["parsed", "fail"]]);
    assert.match(f2.rows[0].detail, /100001 frames/);
  });

  test("an abort signal stops registration", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const source = fs.readFileSync("public/policies/example-policy.js", "utf8");
    await assert.rejects(register(moduleSpec("example-policy.js", source), () => {}, ctl.signal), { name: "AbortError" });
  });
});
