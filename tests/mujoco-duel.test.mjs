import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import loadMujoco from "@mujoco/mujoco";

const MODEL_ROOT = path.resolve("public/models/robotstudio_so101");
const START_POSE = [0, -0.62, 1.08, -0.48, 0, 0.72];

let mujoco;
let vfs;
let model;
let data;

before(async () => {
  mujoco = await loadMujoco();
  vfs = new mujoco.MjVFS();
  vfs.addBuffer("so101.xml", fs.readFileSync(path.join(MODEL_ROOT, "so101.xml")));
  for (const file of fs.readdirSync(path.join(MODEL_ROOT, "assets"))) {
    vfs.addBuffer(`assets/${file}`, fs.readFileSync(path.join(MODEL_ROOT, "assets", file)));
  }
  model = mujoco.MjModel.from_xml_string(
    fs.readFileSync(path.join(MODEL_ROOT, "arena.xml"), "utf8"),
    vfs,
  );
  data = new mujoco.MjData(model);
});

after(() => {
  data?.delete();
  model?.delete();
  vfs?.delete();
});

function bodyNameForGeom(geomId) {
  const bodyId = model.geom_bodyid[geomId];
  return mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, bodyId) ?? "";
}

function setArmState(atlasTargets, blazeTargets = START_POSE) {
  mujoco.mj_resetData(model, data);
  for (let index = 0; index < 6; index += 1) {
    data.qpos[index] = START_POSE[index];
    data.ctrl[index] = atlasTargets[index];
    data.qpos[index + 6] = START_POSE[index];
    data.ctrl[index + 6] = blazeTargets[index];
  }
  mujoco.mj_forward(model, data);
}

function inspectContacts() {
  const contacts = data.contact;
  let armContacts = 0;
  let maxArmForce = 0;
  let atlasContactSpeed = 0;
  let blazeContactSpeed = 0;
  const cubeBodies = new Set();
  try {
    for (let index = 0; index < contacts.size(); index += 1) {
      const contact = contacts.get(index);
      if (!contact) continue;
      try {
        const body1 = bodyNameForGeom(contact.geom1);
        const body2 = bodyNameForGeom(contact.geom2);
        const crossArm = (
          body1.startsWith("atlas_") && body2.startsWith("blaze_")
        ) || (
          body1.startsWith("blaze_") && body2.startsWith("atlas_")
        );
        if (crossArm) {
          armContacts += 1;
          if (contact.efc_address >= 0) {
            const force = Math.abs(data.efc_force[contact.efc_address] ?? 0);
            if (force >= maxArmForce) {
              maxArmForce = force;
              const bodyId1 = model.geom_bodyid[contact.geom1];
              const bodyId2 = model.geom_bodyid[contact.geom2];
              const speed1 = contactPointSpeed(bodyId1, contact.pos);
              const speed2 = contactPointSpeed(bodyId2, contact.pos);
              atlasContactSpeed = body1.startsWith("atlas_") ? speed1 : speed2;
              blazeContactSpeed = body1.startsWith("blaze_") ? speed1 : speed2;
            }
          }
        }
        if (body1.startsWith("atlas_") && body2.startsWith("cube_")) cubeBodies.add(body2);
        if (body2.startsWith("atlas_") && body1.startsWith("cube_")) cubeBodies.add(body1);
      } finally {
        contact.delete();
      }
    }
  } finally {
    contacts.delete();
  }
  return { armContacts, atlasContactSpeed, blazeContactSpeed, cubeBodies, maxArmForce };
}

function contactPointSpeed(bodyId, point) {
  const velocityOffset = bodyId * 6;
  const centerOffset = model.body_rootid[bodyId] * 3;
  const rx = point[0] - data.subtree_com[centerOffset];
  const ry = point[1] - data.subtree_com[centerOffset + 1];
  const rz = point[2] - data.subtree_com[centerOffset + 2];
  const wx = data.cvel[velocityOffset];
  const wy = data.cvel[velocityOffset + 1];
  const wz = data.cvel[velocityOffset + 2];
  const vx = data.cvel[velocityOffset + 3] + wy * rz - wz * ry;
  const vy = data.cvel[velocityOffset + 4] + wz * rx - wx * rz;
  const vz = data.cvel[velocityOffset + 5] + wx * ry - wy * rx;
  return Math.hypot(vx, vy, vz);
}

test("arena compiles as two independent arms and nine rigid cubes", () => {
  assert.equal(model.nu, 12);
  assert.equal(model.nq, 75);
  assert.equal(model.nv, 66);
  assert.ok(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, "atlas_gripper") >= 0);
  assert.ok(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, "blaze_gripper") >= 0);
  for (let index = 0; index < 9; index += 1) {
    assert.ok(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT.value, `cube_${index}_joint`) >= 0);
  }

  setArmState(START_POSE);
  assert.equal(inspectContacts().armContacts, 0, "reset pose must not start with interpenetrating arms");
});

test("simultaneous reach is physically blocked instead of passing through", () => {
  const contestedPose = [0, -0.6, 0.6, 0, 0, 0.72];
  setArmState(contestedPose, contestedPose);
  let observedContacts = 0;
  let peakForce = 0;
  for (let step = 0; step < 250; step += 1) {
    mujoco.mj_step(model, data);
    const contacts = inspectContacts();
    observedContacts += contacts.armContacts;
    peakForce = Math.max(peakForce, contacts.maxArmForce);
  }

  assert.ok(observedContacts > 0, "the opposing collision geoms should meet");
  assert.ok(peakForce > 1, "the solver should produce a blocking contact force");
  assert.ok(data.qpos[2] > 0.75, "Atlas must remain blocked before the penetrating elbow target");
  assert.ok(data.qpos[8] > 0.75, "Blaze must remain blocked before the penetrating elbow target");
  assert.ok(Array.from(data.qpos).every(Number.isFinite));
});

test("a moving arm can strike its opponent and can contact a contested cube", () => {
  setArmState([0, 0, 0, 0, 0, 0.72]);
  let peakForce = 0;
  let atlasContactSpeed = 0;
  let blazeContactSpeed = 0;
  for (let step = 0; step < 180; step += 1) {
    mujoco.mj_step(model, data);
    const contacts = inspectContacts();
    if (contacts.maxArmForce > peakForce) {
      peakForce = contacts.maxArmForce;
      atlasContactSpeed = contacts.atlasContactSpeed;
      blazeContactSpeed = contacts.blazeContactSpeed;
    }
  }
  assert.ok(peakForce > 1, "an attacking motion should transfer force to the rival arm");
  assert.ok(
    atlasContactSpeed > blazeContactSpeed + 0.05,
    `the attacking link should be faster at impact (${atlasContactSpeed} vs ${blazeContactSpeed})`,
  );

  setArmState([0, -0.0245, 0.935, -0.414, -0.35, 0.05]);
  const contactedCubes = new Set();
  for (let step = 0; step < 400; step += 1) {
    mujoco.mj_step(model, data);
    for (const cubeBody of inspectContacts().cubeBodies) contactedCubes.add(cubeBody);
  }
  assert.ok(contactedCubes.has("cube_4"), "the center cube must participate in arm contact");
});
