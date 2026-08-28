import type { MainModule, MjData, MjModel, MjVFS } from "@mujoco/mujoco";

export type PhysicsSnapshot = {
  joints: number[];
  cube: [number, number, number];
  contacts: number;
  simTime: number;
};

const START_POSE = [0, -0.62, 1.08, -0.48, 0, 0.72];
const MODEL_ROOT = "/models/robotstudio_so101";
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

export class MujocoEngine {
  readonly version: string;
  private module: MainModule;
  private model: MjModel;
  private data: MjData;
  private vfs: MjVFS;

  private constructor(module: MainModule, model: MjModel, data: MjData, vfs: MjVFS) {
    this.module = module;
    this.model = model;
    this.data = data;
    this.vfs = vfs;
    this.version = module.mj_versionString();
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
      throw new Error(`SO-101 Menagerie model failed to load (${failedResponse.status})`);
    }

    const [xml, robotXml, ...assetBuffers] = await Promise.all([
      sceneResponse.text(),
      robotResponse.arrayBuffer(),
      ...assetResponses.map((response) => response.arrayBuffer()),
    ]);
    const module = await loadMujoco({
      locateFile: (path: string) => path.endsWith(".wasm") ? "/mujoco.wasm" : path,
    });
    const vfs = new module.MjVFS();
    vfs.addBuffer("so101.xml", new Uint8Array(robotXml));
    ASSET_FILES.forEach((file, index) => {
      vfs.addBuffer(`assets/${file}`, new Uint8Array(assetBuffers[index]));
    });
    const model = module.MjModel.from_xml_string(xml, vfs);
    const data = new module.MjData(model);
    const engine = new MujocoEngine(module, model, data, vfs);
    engine.reset();
    return engine;
  }

  reset(): PhysicsSnapshot {
    this.module.mj_resetData(this.model, this.data);
    START_POSE.forEach((value, index) => {
      this.data.qpos[index] = value;
      this.data.ctrl[index] = value;
    });
    this.module.mj_forward(this.model, this.data);
    return this.snapshot();
  }

  step(targets: number[], substeps = 4): PhysicsSnapshot {
    for (let index = 0; index < Math.min(targets.length, this.model.nu); index += 1) {
      this.data.ctrl[index] = targets[index];
    }
    for (let index = 0; index < substeps; index += 1) {
      this.module.mj_step(this.model, this.data);
    }
    return this.snapshot();
  }

  snapshot(): PhysicsSnapshot {
    return {
      joints: Array.from({ length: 6 }, (_, index) => this.data.qpos[index] ?? 0),
      cube: [this.data.qpos[6] ?? 0.22, this.data.qpos[7] ?? -0.04, this.data.qpos[8] ?? 0.04],
      contacts: this.data.ncon,
      simTime: this.data.time,
    };
  }

  dispose() {
    this.data.delete();
    this.model.delete();
    this.vfs.delete();
  }
}
