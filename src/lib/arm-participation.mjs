// The SO-101 actuator limits are kept beside the human and uploaded-policy
// controls so every input path is subject to the same safety envelope.
export const JOINT_CONTROLS = [
  { name: "Base yaw", negative: "LEFT", positive: "RIGHT", negativeKey: "KeyA", positiveKey: "KeyD", keyHint: "A / D", min: -1.91986, max: 1.91986, speed: 1.2 },
  { name: "Shoulder", negative: "DOWN", positive: "UP", negativeKey: "KeyS", positiveKey: "KeyW", keyHint: "S / W", min: -1.74533, max: 1.74533, speed: 1.05 },
  { name: "Elbow", negative: "FOLD", positive: "REACH", negativeKey: "ArrowDown", positiveKey: "ArrowUp", keyHint: "↓ / ↑", min: -1.69, max: 1.69, speed: 1.05 },
  { name: "Wrist pitch", negative: "DOWN", positive: "UP", negativeKey: "KeyQ", positiveKey: "KeyE", keyHint: "Q / E", min: -1.65806, max: 1.65806, speed: 1.2 },
  { name: "Wrist roll", negative: "CCW", positive: "CW", negativeKey: "KeyZ", positiveKey: "KeyC", keyHint: "Z / C", min: -2.74385, max: 2.74385, speed: 1.55 },
  { name: "Gripper", negative: "CLOSE", positive: "OPEN", negativeKey: "KeyG", positiveKey: "KeyH", keyHint: "G / H", min: -0.17453, max: 1.74533, speed: 1.35 },
];

export const POLICY_FILE_ACCEPT = ".js,.mjs,.json,application/json,text/javascript";
export const MANUAL_HOME_TARGET = [-0.01124, -0.00098, 0.18442];
export const MANUAL_HEIGHTS = { lowered: 0.064, lifted: 0.18 };
export const MANUAL_GRIPPER_TARGETS = { closed: 0.04, open: 1.15 };

const DEFAULT_ACTION = [0, -0.62, 1.08, -0.48, 0, 0.72];
const MAX_TRAJECTORY_FRAMES = 100_000;
const ATLAS_BASE = [-0.32, 0];
const MANUAL_X_RANGE = [-0.075, 0.035];
const MANUAL_Y_RANGE = [-0.14, 0.14];
const MANUAL_REACH_RANGE = [0.245, 0.355];
const JOYSTICK_SPEED = 0.28;

/**
 * @param {unknown} action
 * @param {string} [label]
 * @returns {number[]}
 */
export function validatePolicyAction(action, label = "Policy action") {
  if (!Array.isArray(action) || action.length !== JOINT_CONTROLS.length) {
    throw new Error(`${label} must contain exactly six joint targets`);
  }
  return action.map((value, index) => {
    const number = typeof value === "number" ? value : Number.NaN;
    const joint = JOINT_CONTROLS[index];
    if (!Number.isFinite(number)) throw new Error(`${label} has a non-finite ${joint.name} target`);
    if (number < joint.min || number > joint.max) {
      throw new Error(`${label} ${joint.name} target ${number} is outside ${joint.min}…${joint.max} rad`);
    }
    return number;
  });
}

/**
 * @param {string | unknown} source
 * @param {string} [fallbackName]
 */
export function parseTrajectoryPolicy(source, fallbackName = "Uploaded trajectory") {
  const value = typeof source === "string" ? JSON.parse(source) : source;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON policy must be an object");
  }
  const policy = /** @type {{ name?: unknown, fps?: unknown, loop?: unknown, actions?: unknown }} */ (value);
  if (!Array.isArray(policy.actions) || policy.actions.length === 0) {
    throw new Error("JSON policy needs a non-empty actions array");
  }
  if (policy.actions.length > MAX_TRAJECTORY_FRAMES) {
    throw new Error(`JSON policy is limited to ${MAX_TRAJECTORY_FRAMES.toLocaleString()} actions`);
  }
  const fps = policy.fps === undefined ? 20 : Number(policy.fps);
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) {
    throw new Error("JSON policy fps must be between 1 and 240");
  }
  if (policy.loop !== undefined && typeof policy.loop !== "boolean") {
    throw new Error("JSON policy loop must be true or false");
  }
  return {
    name: typeof policy.name === "string" && policy.name.trim() ? policy.name.trim().slice(0, 80) : fallbackName,
    fps,
    loop: policy.loop ?? true,
    actions: policy.actions.map((action, index) => validatePolicyAction(action, `Action ${index}`)),
  };
}

/**
 * Smoothly samples a trajectory to avoid introducing artificial impact spikes
 * at the policy frame rate.
 * @param {{ fps: number, loop: boolean, actions: number[][] }} policy
 * @param {number} elapsed
 */
export function sampleTrajectoryPolicy(policy, elapsed) {
  if (policy.actions.length === 1) return [...policy.actions[0]];
  const rawFrame = Math.max(0, elapsed) * policy.fps;
  const frame = policy.loop ? rawFrame % policy.actions.length : Math.min(rawFrame, policy.actions.length - 1);
  const firstIndex = Math.floor(frame);
  const secondIndex = policy.loop
    ? (firstIndex + 1) % policy.actions.length
    : Math.min(firstIndex + 1, policy.actions.length - 1);
  const blend = frame - firstIndex;
  return policy.actions[firstIndex].map(
    (value, index) => value + (policy.actions[secondIndex][index] - value) * blend,
  );
}

/**
 * @param {number[]} target
 * @param {{ x: number, y: number }} joystick
 * @param {number} deltaSeconds
 * @param {boolean} lifted
 */
export function stepTaskSpaceTarget(target, joystick, deltaSeconds, lifted) {
  const magnitude = Math.hypot(joystick.x, joystick.y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const next = [
    target[0] + joystick.x * scale * JOYSTICK_SPEED * deltaSeconds,
    target[1] + joystick.y * scale * JOYSTICK_SPEED * deltaSeconds,
    target[2],
  ];
  next[0] = Math.min(MANUAL_X_RANGE[1], Math.max(MANUAL_X_RANGE[0], next[0]));
  next[1] = Math.min(MANUAL_Y_RANGE[1], Math.max(MANUAL_Y_RANGE[0], next[1]));

  const dx = next[0] - ATLAS_BASE[0];
  const dy = next[1] - ATLAS_BASE[1];
  const reach = Math.hypot(dx, dy);
  if (reach < MANUAL_REACH_RANGE[0] || reach > MANUAL_REACH_RANGE[1]) {
    const constrainedReach = Math.min(MANUAL_REACH_RANGE[1], Math.max(MANUAL_REACH_RANGE[0], reach));
    const reachScale = constrainedReach / Math.max(reach, 0.0001);
    next[0] = ATLAS_BASE[0] + dx * reachScale;
    next[1] = ATLAS_BASE[1] + dy * reachScale;
  }

  const desiredHeight = lifted ? MANUAL_HEIGHTS.lifted : MANUAL_HEIGHTS.lowered;
  const heightStep = 0.28 * deltaSeconds;
  next[2] += Math.min(heightStep, Math.max(-heightStep, desiredHeight - next[2]));
  return next;
}

const POLICY_WORKER_SOURCE = `
let policy;
let requestQueue = Promise.resolve();
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
async function handleRequest(request) {
  try {
    if (request.type === "init") {
      policy = await import(request.moduleUrl);
      if (typeof policy.act !== "function") throw new Error("Policy module must export an act(observation) function");
      self.postMessage({ type: "ready", name: typeof policy.policyName === "string" ? policy.policyName : request.fallbackName });
      return;
    }
    if (!policy) throw new Error("Policy is not initialized");
    if (request.type === "reset") {
      if (typeof policy.reset === "function") await policy.reset(request.context);
      self.postMessage({ type: "reset-complete" });
      return;
    }
    if (request.type === "act") {
      const action = await policy.act(request.observation);
      self.postMessage({ type: "action", requestId: request.requestId, action });
    }
  } catch (error) {
    self.postMessage({ type: "policy-error", requestId: request.requestId, message: message(error) });
  }
}
self.onmessage = (event) => {
  requestQueue = requestQueue.then(() => handleRequest(event.data));
};
`;

export class UploadedPolicyRunner {
  /**
   * @param {string} name
   * @param {{ fps: number, loop: boolean, actions: number[][] } | null} trajectory
   * @param {Worker | null} worker
   */
  constructor(name, trajectory, worker) {
    this.name = name;
    this.kind = trajectory ? "trajectory" : "module";
    this.trajectory = trajectory;
    this.worker = worker;
    this.lastAction = [...DEFAULT_ACTION];
    this.requestSequence = 0;
    this.pendingRequest = 0;
    this.timeout = undefined;
    this.failed = false;
    /** @type {((message: string) => void) | null} */
    this.errorHandler = null;
    if (worker) {
      worker.addEventListener("message", (event) => this.handleWorkerMessage(event));
      worker.addEventListener("error", () => this.fail("Policy worker crashed; Atlas is holding its last safe pose"));
    }
  }

  /** @param {File} file */
  static async fromFile(file) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const fallbackName = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Uploaded policy";
    if (extension === "json" || file.type === "application/json") {
      const trajectory = parseTrajectoryPolicy(await file.text(), fallbackName);
      return new UploadedPolicyRunner(trajectory.name, trajectory, null);
    }
    if (extension !== "js" && extension !== "mjs" && file.type !== "text/javascript") {
      throw new Error("Choose a .js, .mjs, or .json policy file");
    }

    const moduleUrl = URL.createObjectURL(new Blob([await file.text()], { type: "text/javascript" }));
    const workerUrl = URL.createObjectURL(new Blob([POLICY_WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(workerUrl, { type: "module", name: "roboarena-policy" });
    URL.revokeObjectURL(workerUrl);
    try {
      const name = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Policy initialization timed out after 4 seconds")), 4_000);
        const onMessage = (event) => {
          if (event.data?.type !== "ready" && event.data?.type !== "policy-error") return;
          clearTimeout(timeout);
          worker.removeEventListener("message", onMessage);
          if (event.data.type === "ready") resolve(event.data.name || fallbackName);
          else reject(new Error(event.data.message || "Policy failed to initialize"));
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ type: "init", moduleUrl, fallbackName });
      });
      return new UploadedPolicyRunner(String(name), null, worker);
    } catch (error) {
      worker.terminate();
      throw error;
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  }

  /** @param {(message: string) => void} handler */
  onError(handler) {
    this.errorHandler = handler;
  }

  /** @param {Record<string, unknown>} context */
  reset(context) {
    this.lastAction = [...DEFAULT_ACTION];
    this.pendingRequest = 0;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.worker && !this.failed) this.worker.postMessage({ type: "reset", context });
  }

  /** @param {{ time: number } & Record<string, unknown>} observation */
  nextTargets(observation) {
    if (this.trajectory) return sampleTrajectoryPolicy(this.trajectory, observation.time);
    if (!this.worker || this.failed || this.pendingRequest !== 0) return [...this.lastAction];
    const requestId = ++this.requestSequence;
    this.pendingRequest = requestId;
    this.worker.postMessage({ type: "act", requestId, observation });
    this.timeout = setTimeout(() => {
      if (this.pendingRequest === requestId) this.fail("Policy act() timed out after 500 ms; Atlas is holding its last safe pose");
    }, 500);
    return [...this.lastAction];
  }

  /** @param {MessageEvent} event */
  handleWorkerMessage(event) {
    const response = event.data;
    if (response?.type === "policy-error") {
      if (!response.requestId || response.requestId === this.pendingRequest) {
        this.pendingRequest = 0;
        if (this.timeout !== undefined) clearTimeout(this.timeout);
        this.timeout = undefined;
      }
      this.errorHandler?.(response.message || "Uploaded policy failed");
      return;
    }
    if (response?.type !== "action" || response.requestId !== this.pendingRequest) return;
    this.pendingRequest = 0;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    try {
      this.lastAction = validatePolicyAction(response.action);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  /** @param {string} message */
  fail(message) {
    this.failed = true;
    this.pendingRequest = 0;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.worker?.terminate();
    this.worker = null;
    this.errorHandler?.(message);
  }

  dispose() {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.worker?.terminate();
    this.worker = null;
  }
}
