import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";

export type PhysicsSnapshot = {
  joints: number[];
  cube: [number, number, number];
  contacts: number;
  simTime: number;
};

const START_POSE = [0, -0.62, 1.08, -0.48, 0, 0.72];

export class MujocoEngine {
  readonly version: string;
  private module: MainModule;
  private model: MjModel;
  private data: MjData;

  private constructor(module: MainModule, model: MjModel, data: MjData) {
    this.module = module;
    this.model = model;
    this.data = data;
    this.version = module.mj_versionString();
  }

  static async create(): Promise<MujocoEngine> {
    // MuJoCo's Emscripten bundle contains a Node-only branch that client
    // bundlers still try to resolve. Loading the first-party module from the
    // public runtime keeps that unreachable branch out of the Next.js graph.
    const importRuntime = new Function("url", "return import(url)") as (
      url: string,
    ) => Promise<{ default: (options?: unknown) => Promise<MainModule> }>;
    const [{ default: loadMujoco }, modelResponse] = await Promise.all([
      importRuntime("/mujoco.js"),
      fetch("/models/so101_arena.xml", { cache: "no-store" }),
    ]);

    if (!modelResponse.ok) {
      throw new Error(`SO-101 model failed to load (${modelResponse.status})`);
    }

    const xml = await modelResponse.text();
    const module = await loadMujoco({
      locateFile: (path: string) => path.endsWith(".wasm") ? "/mujoco.wasm" : path,
    });
    const model = module.MjModel.from_xml_string(xml);
    const data = new module.MjData(model);
    const engine = new MujocoEngine(module, model, data);
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
  }
}
