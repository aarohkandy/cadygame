import type { MainModule, MjData, MjModel, MjVFS } from "@mujoco/mujoco";
import { JOINT_CONTROLS } from "@/lib/arm-participation.mjs";
import { solvePositionIK } from "@/lib/task-space-ik.mjs";

export type Competitor = "atlas" | "blaze";
export type CollisionKind = "none" | "block" | "strike";

export type PhysicsCube = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

export type DuelCollision = {
  kind: CollisionKind;
  attacker: Competitor | null;
  force: number;
  impulse: number;
  position: [number, number, number];
  atlasLink: string;
  blazeLink: string;
  eventId: number;
};

export type PhysicsSnapshot = {
  joints: number[];
  opponentJoints: number[];
  cubes: PhysicsCube[];
  contacts: number;
  armContacts: number;
  cubeContacts: number;
  collision: DuelCollision;
  atlasEndEffector: [number, number, number];
  simTime: number;
};

export type ResetOptions = {
  cubesEnabled?: boolean;
  randomizeCubes?: boolean;
};

export const START_POSE = [0, -0.62, 1.08, -0.48, 0, 0.72] as const;
export const CUBE_COUNT = 9;

const JOINTS_PER_ARM = 6;
const MODEL_ROOT = "/models/robotstudio_so101";
const STRIKE_FORCE_THRESHOLD = 0.65;
const STRIKE_SPEED_THRESHOLD = 0.08;
const STRIKE_SPEED_ADVANTAGE = 0.05;
const EMPTY_COLLISION: DuelCollision = {
  kind: "none",
  attacker: null,
  force: 0,
  impulse: 0,
  position: [0, 0, 0],
  atlasLink: "",
  blazeLink: "",
  eventId: 0,
};

const ASSET_FILES = [
  "base_motor_holder_so101_v1.stl",
  "base_so101_v2.stl",
  "motor_holder_so101_base_v1.stl",
  "motor_holder_so101_wrist_v1.stl",
  "moving_jaw_so101_gripper_part0_v1.stl",
  "moving_jaw_so101_gripper_part1_v1.stl",
  "moving_jaw_so101_gripper_v1.stl",
  "moving_jaw_so101_v1.stl",
  "rotation_pitch_so101_v1.stl",
  "sts3215_03a_no_horn_v1.stl",
  "sts3215_03a_v1.stl",
  "under_arm_so101_v1.stl",
  "upper_arm_so101_v1.stl",
  "waveshare_mounting_plate_so101_v2.stl",
  "wrist_roll_follower_so101_camera_mount.stl",
  "wrist_roll_follower_so101_gripper_part0_v1.stl",
  "wrist_roll_follower_so101_gripper_v1.stl",
  "wrist_roll_follower_so101_v1.stl",
  "wrist_roll_pitch_so101_v2.stl",
] as const;

type ContactSummary = {
  total: number;
  armContacts: number;
  cubeContacts: number;
  collision: DuelCollision;
};

function competitorForBody(bodyName: string): Competitor | null {
  if (bodyName.startsWith("atlas_")) return "atlas";
  if (bodyName.startsWith("blaze_")) return "blaze";
  return null;
}

function readableLink(bodyName: string) {
  return bodyName.replace(/^(atlas|blaze)_/, "").replaceAll("_", " ");
}

export class MujocoEngine {
  readonly version: string;
  private module: MainModule;
  private model: MjModel;
  private data: MjData;
  private ikData: MjData;
  private vfs: MjVFS;
  private atlasGripperSiteId: number;
  private bodyNames: string[];
  private geomCompetitors: (Competitor | null)[];
  private geomIsCube: boolean[];
  private cubeQposAddresses: number[];
  private contactSummary: ContactSummary = {
    total: 0,
    armContacts: 0,
    cubeContacts: 0,
    collision: EMPTY_COLLISION,
  };
  private eventSequence = 0;
  private crossContactActive = false;

  private constructor(module: MainModule, model: MjModel, data: MjData, vfs: MjVFS) {
    this.module = module;
    this.model = model;
    this.data = data;
    this.ikData = new module.MjData(model);
    this.vfs = vfs;
    this.version = module.mj_versionString();
    this.atlasGripperSiteId = module.mj_name2id(
      model,
      module.mjtObj.mjOBJ_SITE.value,
      "atlas_gripperframe",
    );
    if (this.atlasGripperSiteId < 0) throw new Error("MuJoCo atlas_gripperframe site is missing");
    this.bodyNames = Array.from({ length: model.nbody }, (_, bodyId) =>
      module.mj_id2name(model, module.mjtObj.mjOBJ_BODY.value, bodyId) ?? "",
    );
    this.geomCompetitors = Array.from({ length: model.ngeom }, (_, geomId) =>
      competitorForBody(this.bodyNames[model.geom_bodyid[geomId]] ?? ""),
    );
    this.geomIsCube = Array.from({ length: model.ngeom }, (_, geomId) =>
      (this.bodyNames[model.geom_bodyid[geomId]] ?? "").startsWith("cube_"),
    );
    this.cubeQposAddresses = Array.from({ length: CUBE_COUNT }, (_, index) => {
      const jointId = module.mj_name2id(model, module.mjtObj.mjOBJ_JOINT.value, `cube_${index}_joint`);
      if (jointId < 0) throw new Error(`MuJoCo cube_${index}_joint is missing`);
      return model.jnt_qposadr[jointId];
    });
  }

  static async create(): Promise<MujocoEngine> {
    // MuJoCo's Emscripten bundle contains a Node-only branch that client
    // bundlers still try to resolve. Loading the first-party module from the
    // public runtime keeps that unreachable branch out of the Next.js graph.
    const importRuntime = new Function("url", "return import(url)") as (
      url: string,
    ) => Promise<{ default: (options?: unknown) => Promise<MainModule> }>;
    const [{ default: loadMujoco }, sceneResponse, robotResponse, ...assetResponses] = await Promise.all([
      importRuntime("/mujoco.js"),
      fetch(`${MODEL_ROOT}/arena.xml`, { cache: "no-store" }),
      fetch(`${MODEL_ROOT}/so101.xml`, { cache: "force-cache" }),
      ...ASSET_FILES.map((file) => fetch(`${MODEL_ROOT}/assets/${file}`, { cache: "force-cache" })),
    ]);

    const failedResponse = [sceneResponse, robotResponse, ...assetResponses].find((response) => !response.ok);
    if (failedResponse) {
      throw new Error(`SO-101 duel model failed to load (${failedResponse.status})`);
    }

    const [xml, robotXml, ...assetBuffers] = await Promise.all([
      sceneResponse.text(),
      robotResponse.arrayBuffer(),
      ...assetResponses.map((response) => response.arrayBuffer()),
    ]);
    const mujoco = await loadMujoco({
      locateFile: (path: string) => path.endsWith(".wasm") ? "/mujoco.wasm" : path,
    });
    const vfs = new mujoco.MjVFS();
    vfs.addBuffer("so101.xml", new Uint8Array(robotXml));
    ASSET_FILES.forEach((file, index) => {
      vfs.addBuffer(`assets/${file}`, new Uint8Array(assetBuffers[index]));
    });
    const model = mujoco.MjModel.from_xml_string(xml, vfs);
    if (model.nu !== JOINTS_PER_ARM * 2) {
      model.delete();
      vfs.delete();
      throw new Error(`SO-101 duel expected 12 actuators, received ${model.nu}`);
    }
    const data = new mujoco.MjData(model);
    const engine = new MujocoEngine(mujoco, model, data, vfs);
    engine.reset();
    return engine;
  }

  reset(options: ResetOptions = {}): PhysicsSnapshot {
    const { cubesEnabled = true, randomizeCubes = false } = options;
    this.module.mj_resetData(this.model, this.data);
    this.module.mj_resetData(this.model, this.ikData);
    for (let arm = 0; arm < 2; arm += 1) {
      START_POSE.forEach((value, index) => {
        this.data.qpos[arm * JOINTS_PER_ARM + index] = value;
        this.data.ctrl[arm * JOINTS_PER_ARM + index] = value;
        this.ikData.qpos[arm * JOINTS_PER_ARM + index] = value;
      });
    }
    this.cubeQposAddresses.forEach((address, index) => {
      if (!cubesEnabled) {
        this.data.qpos[address] = 2 + index * 0.08;
        this.data.qpos[address + 1] = 0;
        this.data.qpos[address + 2] = 0.0205;
        return;
      }
      if (randomizeCubes) {
        this.data.qpos[address] += (Math.random() - 0.5) * 0.012;
        this.data.qpos[address + 1] += (Math.random() - 0.5) * 0.012;
      }
    });
    this.eventSequence = 0;
    this.crossContactActive = false;
    this.module.mj_forward(this.model, this.data);
    this.contactSummary = this.readContacts();
    return this.snapshot();
  }

  step(atlasTargets: number[], blazeTargets: number[], substeps = 4): PhysicsSnapshot {
    this.writeControls(atlasTargets, 0);
    this.writeControls(blazeTargets, JOINTS_PER_ARM);

    let frameSummary: ContactSummary | null = null;
    for (let index = 0; index < substeps; index += 1) {
      this.module.mj_step(this.model, this.data);
      const substepSummary = this.readContacts();
      if (!frameSummary) {
        frameSummary = substepSummary;
      } else {
        frameSummary.total = substepSummary.total;
        frameSummary.armContacts = Math.max(frameSummary.armContacts, substepSummary.armContacts);
        frameSummary.cubeContacts = Math.max(frameSummary.cubeContacts, substepSummary.cubeContacts);
        if (substepSummary.collision.force > frameSummary.collision.force) {
          frameSummary.collision = substepSummary.collision;
        }
      }
    }

    const hasCrossContact = Boolean(frameSummary && frameSummary.armContacts > 0);
    if (hasCrossContact && !this.crossContactActive) this.eventSequence += 1;
    this.crossContactActive = hasCrossContact;
    this.contactSummary = frameSummary ?? this.readContacts();
    this.contactSummary.collision.eventId = hasCrossContact ? this.eventSequence : 0;
    return this.snapshot();
  }

  snapshot(): PhysicsSnapshot {
    return {
      joints: Array.from({ length: JOINTS_PER_ARM }, (_, index) => this.data.qpos[index] ?? 0),
      opponentJoints: Array.from(
        { length: JOINTS_PER_ARM },
        (_, index) => this.data.qpos[JOINTS_PER_ARM + index] ?? 0,
      ),
      cubes: this.cubeQposAddresses.map((address) => ({
        position: [
          this.data.qpos[address] ?? 0,
          this.data.qpos[address + 1] ?? 0,
          this.data.qpos[address + 2] ?? 0,
        ],
        quaternion: [
          this.data.qpos[address + 4] ?? 0,
          this.data.qpos[address + 5] ?? 0,
          this.data.qpos[address + 6] ?? 0,
          this.data.qpos[address + 3] ?? 1,
        ],
      })),
      contacts: this.contactSummary.total,
      armContacts: this.contactSummary.armContacts,
      cubeContacts: this.contactSummary.cubeContacts,
      collision: { ...this.contactSummary.collision },
      atlasEndEffector: this.readAtlasEndEffector(this.data),
      simTime: this.data.time,
    };
  }

  solveAtlasIK(target: [number, number, number], seed: number[], gripper: number, wristRoll?: number) {
    const jointLimits = JOINT_CONTROLS.slice(0, 4).map(({ min, max }) => ({ min, max }));
    const gripperTarget = Math.min(
      JOINT_CONTROLS[5].max,
      Math.max(JOINT_CONTROLS[5].min, gripper),
    );
    const rollJoint = JOINT_CONTROLS[4];
    const rollSeed = wristRoll ?? seed[4] ?? 0;
    const rollTarget = Math.min(rollJoint.max, Math.max(rollJoint.min, rollSeed));
    const solution = solvePositionIK({
      seed: Array.from({ length: 4 }, (_, index) => seed[index] ?? START_POSE[index]),
      target,
      limits: jointLimits,
      positionFor: (joints) => {
        joints.forEach((value, index) => {
          this.ikData.qpos[index] = value;
        });
        this.ikData.qpos[4] = rollTarget;
        this.ikData.qpos[5] = gripperTarget;
        this.module.mj_kinematics(this.model, this.ikData);
        return this.readAtlasEndEffector(this.ikData);
      },
    });
    return [...solution.joints, rollTarget, gripperTarget];
  }

  private writeControls(targets: number[], offset: number) {
    for (let index = 0; index < Math.min(targets.length, JOINTS_PER_ARM); index += 1) {
      this.data.ctrl[offset + index] = targets[index];
    }
  }

  private readAtlasEndEffector(data: MjData): [number, number, number] {
    const offset = this.atlasGripperSiteId * 3;
    return [
      data.site_xpos[offset] ?? 0,
      data.site_xpos[offset + 1] ?? 0,
      data.site_xpos[offset + 2] ?? 0,
    ];
  }

  private readContacts(): ContactSummary {
    const contacts = this.data.contact;
    let armContacts = 0;
    let cubeContacts = 0;
    let strongest: DuelCollision = { ...EMPTY_COLLISION };
    try {
      for (let index = 0; index < contacts.size(); index += 1) {
        const contact = contacts.get(index);
        if (!contact) continue;
        try {
          const side1 = this.geomCompetitors[contact.geom1];
          const side2 = this.geomCompetitors[contact.geom2];
          const cube1 = this.geomIsCube[contact.geom1];
          const cube2 = this.geomIsCube[contact.geom2];
          if ((side1 && cube2) || (side2 && cube1)) cubeContacts += 1;
          if (!side1 || !side2 || side1 === side2) continue;

          armContacts += 1;
          const constraintAddress = contact.efc_address;
          const force = constraintAddress >= 0
            ? Math.abs(this.data.efc_force[constraintAddress] ?? 0)
            : 0;
          if (force < strongest.force && strongest.kind !== "none") continue;

          const bodyId1 = this.model.geom_bodyid[contact.geom1];
          const bodyId2 = this.model.geom_bodyid[contact.geom2];
          const body1 = this.bodyNames[bodyId1] ?? "";
          const body2 = this.bodyNames[bodyId2] ?? "";
          const speed1 = this.contactPointSpeed(bodyId1, contact.pos);
          const speed2 = this.contactPointSpeed(bodyId2, contact.pos);
          const atlasSpeed = side1 === "atlas" ? speed1 : speed2;
          const blazeSpeed = side1 === "blaze" ? speed1 : speed2;
          const speedDifference = Math.abs(atlasSpeed - blazeSpeed);
          const fasterSide: Competitor = atlasSpeed >= blazeSpeed ? "atlas" : "blaze";
          const isStrike = force >= STRIKE_FORCE_THRESHOLD
            && Math.max(atlasSpeed, blazeSpeed) >= STRIKE_SPEED_THRESHOLD
            && speedDifference >= STRIKE_SPEED_ADVANTAGE;
          const atlasBody = side1 === "atlas" ? body1 : body2;
          const blazeBody = side1 === "blaze" ? body1 : body2;
          strongest = {
            kind: isStrike ? "strike" : "block",
            attacker: isStrike ? fasterSide : null,
            force,
            impulse: force * this.model.opt.timestep,
            position: [contact.pos[0] ?? 0, contact.pos[1] ?? 0, contact.pos[2] ?? 0],
            atlasLink: readableLink(atlasBody),
            blazeLink: readableLink(blazeBody),
            eventId: 0,
          };
        } finally {
          contact.delete();
        }
      }
    } finally {
      contacts.delete();
    }

    return {
      total: this.data.ncon,
      armContacts,
      cubeContacts,
      collision: armContacts > 0 ? strongest : { ...EMPTY_COLLISION },
    };
  }

  private contactPointSpeed(
    bodyId: number,
    point: ArrayLike<number>,
  ) {
    // cvel is a world-aligned spatial velocity around the kinematic tree's
    // center of mass. Translate it to the exact contact point so a stationary
    // upstream link cannot inherit an attack from a different moving joint.
    const velocityOffset = bodyId * 6;
    const rootId = this.model.body_rootid[bodyId];
    const centerOffset = rootId * 3;
    const rx = (point[0] ?? 0) - (this.data.subtree_com[centerOffset] ?? 0);
    const ry = (point[1] ?? 0) - (this.data.subtree_com[centerOffset + 1] ?? 0);
    const rz = (point[2] ?? 0) - (this.data.subtree_com[centerOffset + 2] ?? 0);
    const wx = this.data.cvel[velocityOffset] ?? 0;
    const wy = this.data.cvel[velocityOffset + 1] ?? 0;
    const wz = this.data.cvel[velocityOffset + 2] ?? 0;
    const vx = (this.data.cvel[velocityOffset + 3] ?? 0) + wy * rz - wz * ry;
    const vy = (this.data.cvel[velocityOffset + 4] ?? 0) + wz * rx - wx * rz;
    const vz = (this.data.cvel[velocityOffset + 5] ?? 0) + wx * ry - wy * rx;
    return Math.hypot(vx, vy, vz);
  }

  dispose() {
    this.ikData.delete();
    this.data.delete();
    this.model.delete();
    this.vfs.delete();
  }
}
