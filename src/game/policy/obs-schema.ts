// src/game/policy/obs-schema.ts (WP4)
// The torquelimit.obs/3 flat layout as data (GAME_DESIGN 5.4): one name, unit, and description per index
// of every float32 block, the JSON Schema published at public/schemas/torquelimit.obs-3.json, and the
// schema hash sent to policies and bridges (obs_schema_hash = "sha256:" + SHA-256 of that file's bytes).
// tests/obs-schema.test.mjs regenerates the file text from this module and checks the pinned hash.

import { CORE_CUBE_INDEX, JOINT_NAMES, LINK_IDS, OBS_BLOCKS, OBS_SCHEMA, type ObsBlockName } from "../contracts.ts";

export interface ObsField { name: string; unit: string; description: string; }

const XYZ = ["x", "y", "z"] as const;
const WXYZ = ["w", "x", "y", "z"] as const;

function joints(prefix: string, unit: string, what: string): ObsField[] {
  return JOINT_NAMES.map((j) => ({ name: `${prefix}.${j}`, unit, description: `${what} of ${j}` }));
}
function vec(prefix: string, unit: string, what: string): ObsField[] {
  return XYZ.map((a) => ({ name: `${prefix}.${a}`, unit, description: `${what}, ego ${a}` }));
}
function quat(prefix: string, what: string): ObsField[] {
  return WXYZ.map((a) => ({ name: `${prefix}.${a}`, unit: "1", description: `${what} quaternion ${a} (wxyz, w >= 0)` }));
}

/** Contact kinds in the `contacts` block (index 0 of each record). */
export const OBS_CONTACT_KIND = { none: 0, strike: 1, graze: 2, deflect: 3, clash: 4, contact: 5, cube_hit: 6, table_hit: 7 } as const;
export const OBS_CONTACT_SLOTS = 4;
export const OBS_CONTACT_WIDTH = 5;
export const OBS_CUBE_COUNT = 9;
export const OBS_CUBE_WIDTH = 9;

function buildLayout(): Record<ObsBlockName, ObsField[]> {
  const state = [...joints("self.q", "rad", "joint position"), ...joints("self.qd", "rad/s", "joint velocity")];
  const selfExt = [
    ...vec("self.ee.pos", "m", "gripperframe site position"),
    ...quat("self.ee.quat", "gripperframe site"),
    ...vec("self.ee.linvel", "m/s", "gripperframe site linear velocity"),
    ...vec("self.wrist_pos", "m", "gripper body origin (wrist_roll axis point)"),
    ...joints("self.tau", "N*m", "actuator force (clamped to forcerange)"),
    ...joints("self.ctrl", "rad", "servo target now"),
    ...joints("last_action", "rad", "targets applied at the previous control tick"),
    { name: "self.gripper_opening", unit: "1", description: "(q5 - 0.04) / (1.15 - 0.04)" },
  ];
  const opp = [
    ...joints("opp.q", "rad", "opponent joint position"),
    ...joints("opp.qd", "rad/s", "opponent joint velocity"),
    ...vec("opp.ee.pos", "m", "opponent gripperframe site position"),
    ...quat("opp.ee.quat", "opponent gripperframe site"),
    ...vec("opp.ee.linvel", "m/s", "opponent gripperframe site linear velocity"),
    ...vec("opp.elbow_pos", "m", "opponent lower_arm body origin"),
    ...vec("opp.wrist_pos", "m", "opponent gripper body origin"),
  ];
  const game: ObsField[] = [
    { name: "self.integrity_frac", unit: "1", description: "integrity / integrity_max" },
    { name: "opp.integrity_frac", unit: "1", description: "opponent integrity / integrity_max" },
    { name: "phase.time_remaining_frac", unit: "1", description: "time remaining / current phase length; 0 outside fight phases" },
    { name: "phase.is_fight", unit: "bool", description: "1 in fight or sudden_death" },
    { name: "phase.sudden_death", unit: "bool", description: "1 in sudden death" },
    { name: "round.rounds_won_diff_frac", unit: "1", description: "(self - opponent rounds won) / ceil(best_of / 2)" },
    { name: "core.lock_in_signed_frac", unit: "1", description: "+remaining / owner's full lock-in if self owns the Core, - if the opponent owns it, 0 otherwise" },
    { name: "core.lock_in_full", unit: "1", description: "owner's full lock-in / 8; 0 when unowned" },
    { name: "core.live", unit: "bool", description: "1 while the Core is live" },
    { name: "contact.touching", unit: "bool", description: "1 if the arms touch with more than 0.3 N this step" },
    { name: "self.heat_frac", unit: "1", description: "heat / 100; Arcade only, 0 in physical scoring" },
    { name: "opp.charge_public", unit: "1", description: "opponent charge c when c >= 0.25, else 0; Arcade only" },
    { name: "self.servo_state_code", unit: "1", description: "servo state code / 5 (normal 0, micro 1, stagger 2, stun 3, cutout 4, offline 5); physical scoring reports offline only" },
    { name: "opp.servo_state_code", unit: "1", description: "opponent servo state code / 5, same rule" },
    { name: "self.servo_state_remaining_s", unit: "s", description: "time left in the current servo state; Arcade only" },
    { name: "self.guard_active", unit: "bool", description: "guard intent accepted by the rules; Arcade only" },
  ];
  const env: ObsField[] = [];
  for (let i = 0; i < OBS_CUBE_COUNT; i++) {
    const p = `cube${i}`;
    const what = i === CORE_CUBE_INDEX ? `cube ${i} (the Core)` : `cube ${i}`;
    env.push(...vec(`${p}.pos`, "m", `${what} position`), ...quat(`${p}.quat`, what),
      { name: `${p}.parked`, unit: "bool", description: `1 while ${what} is parked off the table` },
      { name: `${p}.held_by`, unit: "1", description: `+1 held by self, -1 by the opponent, 0 none (${what})` });
  }
  const contacts: ObsField[] = [];
  for (let i = 0; i < OBS_CONTACT_SLOTS; i++) {
    const p = `contact${i}`;
    const order = i === 0 ? "newest" : `${i + 1}th newest`;
    contacts.push(
      { name: `${p}.kind`, unit: "enum", description: `${order} contact event kind: 0 none, 1 strike, 2 graze, 3 deflect, 4 clash, 5 contact, 6 cube_hit, 7 table_hit` },
      { name: `${p}.attacker`, unit: "1", description: "+1 self, -1 opponent, 0 none" },
      { name: `${p}.zone`, unit: "enum", description: `struck link index + 1 in LINK_IDS order (${LINK_IDS.join(", ")}), 0 none` },
      { name: `${p}.normal_speed`, unit: "m/s", description: "approach speed along the contact normal" },
      { name: `${p}.age_s`, unit: "s", description: "observation t minus event t" },
    );
  }
  return { state, self_ext: selfExt, opponent_state: opp, game, environment_state: env, contacts };
}

/** Per-index field names for every flat block. Lengths equal OBS_BLOCKS (asserted at module load). */
export const OBS_LAYOUT: Readonly<Record<ObsBlockName, readonly ObsField[]>> = buildLayout();
for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) {
  if (OBS_LAYOUT[name].length !== OBS_BLOCKS[name]) {
    throw new Error(`obs layout ${name} has ${OBS_LAYOUT[name].length} fields, contract says ${OBS_BLOCKS[name]}`);
  }
}

/** Index of a named field inside its block, e.g. obsIndex("game", "core.live") === 8. */
export function obsIndex(block: ObsBlockName, name: string): number {
  const i = OBS_LAYOUT[block].findIndex((f) => f.name === name);
  if (i < 0) throw new RangeError(`no field ${name} in block ${block}`);
  return i;
}

/** The JSON Schema document (draft 2020-12) published at public/schemas/torquelimit.obs-3.json. */
export function obsSchemaDocument(): Record<string, unknown> {
  const blocks: Record<string, unknown> = {};
  for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) {
    blocks[name] = {
      type: "array", minItems: OBS_BLOCKS[name], maxItems: OBS_BLOCKS[name],
      items: { type: "number" },
      "x-dtype": "float32",
      "x-fields": OBS_LAYOUT[name].map((f, index) => ({ index, name: f.name, unit: f.unit, description: f.description })),
    };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "torquelimit.obs/3",
    title: OBS_SCHEMA,
    description: "TORQUE LIMIT observation, ego frame of the observing seat: origin at its mount on the table plane, +x toward the opponent base, +z up, +y = z cross x. Quaternions are wxyz with w >= 0. Joint order follows joint_names.",
    type: "object",
    "x-joint-names": [...JOINT_NAMES],
    "x-link-ids": [...LINK_IDS],
    "x-core-cube-index": CORE_CUBE_INDEX,
    required: Object.keys(OBS_BLOCKS),
    properties: blocks,
    additionalProperties: true,
  };
}

/** Exact bytes of the published schema file (2-space JSON plus a trailing newline). */
export function obsSchemaText(): string {
  return `${JSON.stringify(obsSchemaDocument(), null, 2)}\n`;
}

/**
 * SHA-256 of public/schemas/torquelimit.obs-3.json, pinned here so the browser and Worker need no hashing
 * at boot. tests/obs-schema.test.mjs fails if the file, this module, or this constant drift apart;
 * `node scripts/gen-registration-fixture.mjs --schema` rewrites the file and prints the new value.
 */
export const OBS_SCHEMA_HASH = "sha256:42d22408e373aa0282c82f75221f3aee5a059db04db5edc5b10864e34d673c46";
