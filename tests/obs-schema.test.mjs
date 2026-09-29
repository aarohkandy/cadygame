import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { OBS_BLOCKS } from "../src/game/contracts.ts";
import { OBS_LAYOUT, OBS_SCHEMA_HASH, obsIndex, obsSchemaText } from "../src/game/policy/obs-schema.ts";

const FILE = "public/schemas/torquelimit.obs-3.json";

test("the published schema file is exactly what obs-schema.ts generates", () => {
  assert.equal(fs.readFileSync(FILE, "utf8"), obsSchemaText(), "run: node scripts/gen-registration-fixture.mjs --schema");
});

test("OBS_SCHEMA_HASH is the SHA-256 of the published file", () => {
  const hex = createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
  assert.equal(OBS_SCHEMA_HASH, `sha256:${hex}`);
});

test("every block's fields match the contract lengths, index by index, with unique names", () => {
  const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const seen = new Set();
  for (const [name, len] of Object.entries(OBS_BLOCKS)) {
    assert.equal(OBS_LAYOUT[name].length, len, name);
    const fields = doc.properties[name]["x-fields"];
    assert.equal(fields.length, len);
    fields.forEach((f, i) => {
      assert.equal(f.index, i);
      assert.equal(f.name, OBS_LAYOUT[name][i].name);
      assert.ok(!seen.has(f.name), `duplicate field ${f.name}`);
      seen.add(f.name);
    });
    assert.equal(doc.properties[name].minItems, len);
  }
});

test("GAME_DESIGN 5.4 anchor indices", () => {
  assert.equal(obsIndex("state", "self.qd.shoulder_pan"), 6);
  assert.equal(obsIndex("self_ext", "self.ee.quat.w"), 3);
  assert.equal(obsIndex("self_ext", "self.tau.shoulder_pan"), 13);
  assert.equal(obsIndex("self_ext", "last_action.shoulder_pan"), 25);
  assert.equal(obsIndex("self_ext", "self.gripper_opening"), 31);
  assert.equal(obsIndex("opponent_state", "opp.ee.pos.x"), 12);
  assert.equal(obsIndex("opponent_state", "opp.elbow_pos.x"), 22);
  assert.equal(obsIndex("opponent_state", "opp.wrist_pos.z"), 27);
  assert.equal(obsIndex("game", "core.lock_in_signed_frac"), 6);
  assert.equal(obsIndex("game", "contact.touching"), 9);
  assert.equal(obsIndex("game", "self.guard_active"), 15);
  assert.equal(obsIndex("environment_state", "cube4.held_by"), 44);
  assert.equal(obsIndex("contacts", "contact3.age_s"), 19);
});
