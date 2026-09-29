// Episode provenance (src/game/harness/provenance.ts, GAME_DESIGN 5.8). What these guard: the canonical form
// must not depend on key order, the source object must be fillable in place (createGame hands the director a
// reference before the hashes resolve), and the servo table must be read before anything awaits - a loadout
// retune lands between tasks, and a hash that names a retuned arm is a lie about what the episode ran on.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildProvenanceSource, canonicalStringify, engineServoParamsHash, policySha256, servoParamsHash, sha256Hex, tuningSha256,
} from "../src/game/harness/provenance.ts";

/** Just enough PhysicsEngine for provenance: saveState() copies the servo table, as the real one does. */
function fakeEngine(values) {
  const servo = Float64Array.from(values);
  return {
    servo,
    saveState() { return { servo: Float64Array.from(servo) }; },
    retune(next) { servo.set(next); },
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

describe("provenance hashes", () => {
  test("sha256Hex matches the published vector for the empty string and for bytes", async () => {
    assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(await sha256Hex(new Uint8Array([0x61, 0x62, 0x63])), await sha256Hex("abc"));
  });

  test("canonicalStringify sorts keys at every level, so tuning hashes the same either way", async () => {
    const a = { z: 1, a: { d: 4, b: [3, 2] } };
    const b = { a: { b: [3, 2], d: 4 }, z: 1 };
    assert.equal(canonicalStringify(a), canonicalStringify(b));
    assert.equal(canonicalStringify(a), '{"a":{"b":[3,2],"d":4},"z":1}');
    assert.equal(await tuningSha256(a), await tuningSha256(b));
    // Non-finite numbers hash distinctly instead of collapsing into JSON's null.
    assert.notEqual(canonicalStringify({ v: Number.NaN }), canonicalStringify({ v: null }));
    assert.equal(canonicalStringify(undefined), "null");
    assert.equal(canonicalStringify({ keep: 1, drop: undefined, fn: () => 0 }), '{"keep":1}');
  });

  test("a different servo table is a different hash, and typed-array views hash their own bytes", async () => {
    const one = await servoParamsHash(Float64Array.from([1, 2, 3, 4]));
    const two = await servoParamsHash(Float64Array.from([1, 2, 3, 5]));
    assert.match(one, HEX64);
    assert.notEqual(one, two);
    assert.equal(await engineServoParamsHash(fakeEngine([1, 2, 3, 4])), one);
  });

  test("buildProvenanceSource fills the caller's object in place, so the director's reference stays valid", async () => {
    const into = {
      tuning: null, tuningSha256: "", servoParamsHash: "", obsSchemaHash: "",
      harnessCommit: "", userAgent: "",
    };
    const tuning = { strike: { k: 133 } };
    const returned = await buildProvenanceSource(
      { tuning, engine: fakeEngine([9, 8, 7]), obsSchemaHash: "sha256:obs", harnessCommit: "abc1234", userAgent: "node" },
      into,
    );
    assert.equal(returned, into, "the caller's object must be the one that is filled");
    assert.equal(into.tuning, tuning);
    assert.equal(into.obsSchemaHash, "sha256:obs");
    assert.equal(into.harnessCommit, "abc1234");
    assert.equal(into.userAgent, "node");
    assert.match(into.tuningSha256, HEX64);
    assert.match(into.servoParamsHash, HEX64);
    assert.equal(into.tuningSha256, await tuningSha256(tuning));
  });

  test("with no engine the servo hash is left alone rather than filled with a hash of nothing", async () => {
    const out = await buildProvenanceSource({ tuning: {}, engine: null, obsSchemaHash: "o", harnessCommit: "c", userAgent: "u" });
    assert.equal(out.servoParamsHash, "");
    assert.match(out.tuningSha256, HEX64);
  });

  test("the servo table is read before the first await, so a loadout retune cannot get into the hash", async () => {
    const engine = fakeEngine([1, 2, 3, 4]);
    const stock = await engineServoParamsHash(engine);
    // Not awaited: this is the boot path, where createGame starts the hashes and lets the game carry on.
    const pending = buildProvenanceSource(
      { tuning: { a: 1 }, engine, obsSchemaHash: "o", harnessCommit: "c", userAgent: "u" },
    );
    // A loadout lands in the very next task, the way configureLobby does when the green room opens.
    await Promise.resolve();
    engine.retune([10, 20, 30, 40]);
    const out = await pending;
    assert.equal(out.servoParamsHash, stock, "the hash named the retuned arm instead of the stock parameters");
    assert.notEqual(stock, await engineServoParamsHash(engine), "the retune must actually change the table");
  });

  test("policySha256 is the hash of the file text", async () => {
    assert.equal(await policySha256("export default {}\n"), await sha256Hex("export default {}\n"));
  });
});
