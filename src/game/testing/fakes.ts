// src/game/testing/fakes.ts (WP1)
// Deterministic stand-ins for every cross-package interface a test needs (GAME_DESIGN 11.1 rule 4),
// so each package's tests run without the others: physics frames and an engine with real save/restore
// and checksums, a scriptable rules object, event builders, seat drivers with controllable latency,
// a recording feedback system, and a pilot. Pure TypeScript, Node-safe, no DOM, no Math.random.

import {
  CLUTTER_CUBES, GRIP_OPEN, JOINT_LIMITS, LINK_IDS, SEATS,
  type ActionResult, type ArmFrame, type AudioControl, type CombatRules, type CombatSnapshot, type CommandState,
  type CoreMutationRequest, type EngineResetOptions, type EventBus, type FeedbackContext, type FeedbackSystem,
  type GameEvent, type GhostPose, type InputDevice, type InputShapingFlags, type Intents, type LinkId,
  type MatchPhase, type MatchPreset, type ModelInfo, type MusicState, type Observation, type PhysicsEngine,
  type PhysicsFrame, type PhysicsMode, type PilotController, type PilotMode, type PilotRules, type PolicyAction,
  type RangeCue, type ResetContext, type RulesConfig, type RulesStepInput, type Seat, type SeatCombatState,
  type SeatDriver, type ServoProfile, type SimState, type So101Kinematics, type SyntheticInput, type TouchInput,
  type UiCue, type Vec3, IDENTITY_PROFILE, noIntents,
  EPISODE_FORMAT, INTENT_BITS, OBS_BLOCKS, OBS_SCHEMA,
  type ChunkExecutor, type ChunkSample, type CreateChunkExecutor, type Episode, type EpisodeMeta, type HitstopMsFor,
  type MatchResultRecord, type MomentBuffer, type MomentClip, type ObsBlockName, type ObservationBuilder,
  type ObservationDelayLine, type Recorder, type SimMutation, type TickRecord,
} from "../contracts.ts";
import { createJuiceOutput } from "../core/hud-frame.ts";

/* ───────────────────────── model shape ───────────────────────── */

export const FAKE_NQ = 12 + 9 * 7;          // two 6-DoF arms + nine free cubes
export const FAKE_NV = 12 + 9 * 6;
export const FAKE_NU = 12;
const BODY_SUFFIX: Readonly<Record<LinkId, string>> = {
  base: "base", shoulder: "shoulder", upper_arm: "upper_arm", lower_arm: "lower_arm", wrist: "wrist",
  gripper: "gripper", camera_mount: "camera_mount", moving_jaw: "moving_jaw_so101_v1",
};

export function fakeModelInfo(mode: PhysicsMode = "arcade"): ModelInfo {
  const bodyNames: string[] = ["world"];
  const bodyId = { atlas: {}, blaze: {} } as Record<Seat, Record<LinkId, number>>;
  for (const seat of SEATS) {
    for (const link of LINK_IDS) {
      bodyId[seat][link] = bodyNames.length;
      bodyNames.push(`${seat}_${BODY_SUFFIX[link]}`);
    }
  }
  const cubeBodyIds: number[] = [];
  for (let i = 0; i < 9; i++) { cubeBodyIds.push(bodyNames.length); bodyNames.push(`cube_${i}`); }
  return {
    mujocoVersion: "3.12.0-fake",
    modelFile: mode === "arcade" ? "arena-arcade.xml" : "arena.xml",
    modelSha256: "0".repeat(64), so101Sha256: "0".repeat(64),
    nq: FAKE_NQ, nv: FAKE_NV, nu: FAKE_NU, nbody: bodyNames.length,
    bodyNames, bodyId, cubeBodyIds, hullScoring: mode === "arcade",
  };
}

/* ───────────────────────── frames ───────────────────────── */

function fakeArm(): ArmFrame {
  return {
    q: new Float64Array(6), qd: new Float64Array(6), qacc: new Float64Array(6),
    tau: new Float64Array(6), ctrl: new Float64Array(6), forceRange: new Float64Array(6).fill(2.94),
    eePos: new Float64Array(3), eeVel: new Float64Array(3), eeQuat: new Float64Array([1, 0, 0, 0]),
    elbowPos: new Float64Array(3), wristPos: new Float64Array(3),
    shoulderPos: new Float64Array(3), cameraMountPos: new Float64Array(3),
  };
}

/** A zeroed PhysicsFrame with every typed array at its contract length. */
export function fakeFrame(opts: { mode?: PhysicsMode; dt?: number; nbody?: number } = {}): PhysicsFrame {
  const mode = opts.mode ?? "arcade";
  const nbody = opts.nbody ?? fakeModelInfo(mode).nbody;
  const quats = (n: number) => { const a = new Float64Array(n * 4); for (let i = 0; i < n; i++) a[i * 4] = 1; return a; };
  return {
    mode, dt: opts.dt ?? (mode === "arcade" ? 0.0025 : 0.005), step: 0, simTime: 0,
    arms: { atlas: fakeArm(), blaze: fakeArm() },
    cubes: { pos: new Float64Array(27), quat: quats(9), linvel: new Float64Array(27) },
    docks: new Float64Array([-0.12, 0, 0, 0.12, 0, 0]),
    nbody,
    bodyPosPrev: new Float64Array(nbody * 3), bodyPosCurr: new Float64Array(nbody * 3),
    bodyQuatPrev: quats(nbody), bodyQuatCurr: quats(nbody),
    onsets: [],
    active: {
      armArmTouching: false, maxArmForce: 0,
      lastCrossContactT: { atlas: -1, blaze: -1 },
      gripperOnCube: { atlas: -1, blaze: -1 }, bothJawsOnCube: { atlas: -1, blaze: -1 },
      lastGripperTouch: { cube: new Int32Array(9).fill(-1), t: new Float64Array(9).fill(-1) },
      opticsImpulse: { atlas: 0, blaze: 0 },
    },
  };
}

/* ───────────────────────── combat ───────────────────────── */

export function fakeSeatCombat(overrides: Partial<SeatCombatState> = {}): SeatCombatState {
  return {
    loadout: "pivot", integrity: 100, integrityMax: 100, heat: 0,
    servoState: "normal", servoStateRemainingMs: 0, servoStateTotalMs: 0,
    staggerImmuneMs: 0, staggerFollowUps: 0, burstUsed: false,
    guardHeld: false, deflectLockoutMs: 0,
    charging: false, charge: 0, chargeHoldMs: 0, armoured: false,
    releaseBoostMs: 0, heavyTagMs: 0, heavyTagC: 0, overdrive: false,
    ability: { id: "recoil_coil", charges: 1, maxCharges: 1, cooldownMs: 0, cooldownTotalMs: 0, activeMs: 0 },
    protected: false, comboCount: 0, lastStrikeT: -1,
    damageDealtRound: 0, physicalDamageDealtRound: 0, firstStrikeT: -1,
    ...overrides,
  };
}

export function fakeCombat(preset: MatchPreset = "arcade", overrides: Partial<CombatSnapshot> = {}): CombatSnapshot {
  return {
    preset, scoring: preset === "arcade" ? "full" : "physical", round: 1, suddenDeath: false,
    fightTimeS: 0, roundLengthS: 45,
    seats: { atlas: fakeSeatCombat(), blaze: fakeSeatCombat() },
    core: {
      phase: "dormant", owner: null, dockedIn: null, lockInRemainingS: 8, lockInTotalS: 8,
      contested: false, loose: false, stolenFrom: null, lastTouchedBy: null,
    },
    outcome: null,
    ...overrides,
  };
}

/* ───────────────────────── events ───────────────────────── */

type EventOf<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;
type EventInit<T extends GameEvent["type"]> = Partial<Omit<EventOf<T>, "type">>;
const ZERO: Vec3 = [0, 0, 0];
const UP: Vec3 = [1, 0, 0];

/** Builders for well-formed events; every field has a plausible default and can be overridden. */
export const fakeEvents = {
  contact: (o: EventInit<"contact"> = {}): EventOf<"contact"> =>
    ({ type: "contact", t: 0, step: 0, pos: [...ZERO], magnitude: 0.2, ...o }),
  strike: (o: EventInit<"strike"> = {}): EventOf<"strike"> =>
    ({ type: "strike", t: 0, step: 0, tier: "strike", attacker: "atlas", victim: "blaze", raw: 20, damage: 20, physicalDamage: 20,
       nu: 1, vN: 2, zone: "upper_arm", tool: "gripper", crit: false, guarded: false, heavyC: 0, armoured: false,
       pos: [...ZERO], normal: [...UP], magnitude: 1, lethal: false, upgrade: false, thrownCube: -1, ...o }),
  deflect: (o: EventInit<"deflect"> = {}): EventOf<"deflect"> =>
    ({ type: "deflect", t: 0, step: 0, defender: "blaze", attacker: "atlas", hard: false, pressLeadMs: 60, pos: [...ZERO], normal: [...UP], ...o }),
  clash: (o: EventInit<"clash"> = {}): EventOf<"clash"> =>
    ({ type: "clash", t: 0, step: 0, pos: [...ZERO], normal: [...UP], magnitude: 0.6, heavyWinner: null, ...o }),
  whiff: (o: EventInit<"whiff"> = {}): EventOf<"whiff"> => ({ type: "whiff", t: 0, step: 0, seat: "atlas", ...o }),
  ko: (o: EventInit<"ko"> = {}): EventOf<"ko"> => ({ type: "ko", t: 0, step: 0, victim: "blaze", attacker: "atlas", pos: [...ZERO], ...o }),
  core: (o: EventInit<"core"> = {}): EventOf<"core"> =>
    ({ type: "core", t: 0, step: 0, stage: "lock_in_start", seat: "atlas", from: null, remainingS: 8, late: false, inherited: false, ...o }),
  phase: (o: EventInit<"phase"> = {}): EventOf<"phase"> =>
    ({ type: "phase", t: 0, step: 0, phase: "fight" as MatchPhase, round: 1, finalRound: false, ...o }),
  roundEnd: (o: EventInit<"round_end"> = {}): EventOf<"round_end"> =>
    ({ type: "round_end", t: 0, step: 0, winner: "atlas", reason: "ko", roundsWon: { atlas: 1, blaze: 0 }, ...o }),
  matchEnd: (o: EventInit<"match_end"> = {}): EventOf<"match_end"> =>
    ({ type: "match_end", t: 0, step: 0, winner: "atlas", roundsWon: { atlas: 2, blaze: 0 }, ...o }),
  servoState: (o: EventInit<"servo_state"> = {}): EventOf<"servo_state"> =>
    ({ type: "servo_state", t: 0, step: 0, seat: "blaze", state: "stagger", durationMs: 600, cause: "strike", ...o }),
  policyFault: (o: EventInit<"policy_fault"> = {}): EventOf<"policy_fault"> =>
    ({ type: "policy_fault", t: 0, step: 0, seat: "blaze", status: "timeout", detail: "no action within budget", ...o }),
  tableHit: (o: EventInit<"table_hit"> = {}): EventOf<"table_hit"> =>
    ({ type: "table_hit", t: 0, step: 0, seat: "atlas", force: 4, pos: [...ZERO], ...o }),
};

/** Stamps t and step onto a batch of events (script helpers). */
export function atStep<T extends GameEvent>(e: T, step: number, dt: number): T {
  return { ...e, step, t: (step + 1) * dt };
}

/* ───────────────────────── engine ───────────────────────── */

export const FAKE_SERVO_GAIN = 25;           // 1/s: joints approach ctrl as a first-order lag
const QPOS_ARM = 12;

export interface FakeEngine extends PhysicsEngine {
  readonly resets: EngineResetOptions[];
  readonly placements: { index: number; pos: Vec3 | null; step: number }[];
  readonly profiles: { seat: Seat; profile: ServoProfile; step: number }[];
  /** Profiles refused because harness mode only accepts Offline (tauScale 0). */
  rejectedProfiles: number;
  /** Called after every step with the frame, so tests can inject onsets or move cubes. */
  onStep: ((frame: PhysicsFrame) => void) | null;
  readonly disposed: boolean;
  /** Raw qpos (arms 0..11, then cube i at 12 + 7i as pos xyz, quat wxyz). */
  readonly qpos: Float64Array;
}

export function createFakeEngine(opts: { mode?: PhysicsMode; timestep?: number } = {}): FakeEngine {
  let mode: PhysicsMode = opts.mode ?? "arcade";
  const info = fakeModelInfo(mode);
  const frame = fakeFrame({ mode, dt: opts.timestep, nbody: info.nbody });
  const qpos = new Float64Array(FAKE_NQ);
  const qvel = new Float64Array(FAKE_NV);
  const ctrl = new Float64Array(FAKE_NU);
  const warm = new Float64Array(FAKE_NV);
  const servo = new Float64Array(FAKE_NU * 3);
  const resets: EngineResetOptions[] = [];
  const placements: FakeEngine["placements"] = [];
  const profiles: FakeEngine["profiles"] = [];
  let disposed = false;

  function initServo(): void {
    for (let a = 0; a < FAKE_NU; a++) { servo[a * 3] = 998.22; servo[a * 3 + 1] = 2.731; servo[a * 3 + 2] = 2.94; }
  }
  function parkCube(i: number): void {
    const o = QPOS_ARM + i * 7;
    qpos[o] = 2.0 + 0.1 * i; qpos[o + 1] = 0; qpos[o + 2] = 0.02;
    qpos[o + 3] = 1; qpos[o + 4] = 0; qpos[o + 5] = 0; qpos[o + 6] = 0;
  }
  function syncFrame(slot: "prev" | "curr" | "both"): void {
    for (let s = 0; s < 2; s++) {
      const arm = frame.arms[SEATS[s]];
      for (let j = 0; j < 6; j++) {
        arm.q[j] = qpos[s * 6 + j]; arm.qd[j] = qvel[s * 6 + j]; arm.ctrl[j] = ctrl[s * 6 + j];
        arm.forceRange[j] = j < 5 ? servo[(s * 6 + j) * 3 + 2] : 2.94;
      }
      const mount = s === 0 ? -0.32 : 0.32;
      const dir = s === 0 ? 1 : -1;
      const reach = 0.2 + 0.1 * Math.sin(arm.q[2]);
      arm.eePos[0] = mount + dir * reach * Math.cos(arm.q[0]);
      arm.eePos[1] = reach * Math.sin(arm.q[0]);
      arm.eePos[2] = 0.12 + 0.05 * arm.q[1];
      arm.wristPos.set(arm.eePos);
    }
    for (let i = 0; i < 9; i++) {
      const o = QPOS_ARM + i * 7;
      frame.cubes.pos[i * 3] = qpos[o]; frame.cubes.pos[i * 3 + 1] = qpos[o + 1]; frame.cubes.pos[i * 3 + 2] = qpos[o + 2];
      for (let k = 0; k < 4; k++) frame.cubes.quat[i * 4 + k] = qpos[o + 3 + k];
    }
    const writeCurr = slot !== "prev";
    const writePrev = slot !== "curr";
    for (let b = 0; b < info.nbody; b++) {
      const src = b >= info.cubeBodyIds[0] ? (b - info.cubeBodyIds[0]) * 3 : -1;
      for (let k = 0; k < 3; k++) {
        const v = src >= 0 ? frame.cubes.pos[src + k] : 0;
        if (writeCurr) frame.bodyPosCurr[b * 3 + k] = v;
        if (writePrev) frame.bodyPosPrev[b * 3 + k] = v;
      }
    }
  }

  initServo();
  for (let i = 0; i < 9; i++) parkCube(i);
  syncFrame("both");

  const engine: FakeEngine = {
    info, frame, resets, placements, profiles, rejectedProfiles: 0, onStep: null, qpos,
    get disposed() { return disposed; },

    infoFor(m: PhysicsMode): ModelInfo {
      const f = fakeModelInfo(m);
      return { ...info, modelFile: f.modelFile, modelSha256: f.modelSha256, so101Sha256: f.so101Sha256, hullScoring: f.hullScoring };
    },

    reset(o: EngineResetOptions): void {
      resets.push(o);
      mode = o.mode;
      frame.mode = o.mode;
      frame.dt = o.timestep;
      frame.step = 0;
      frame.simTime = 0;
      qpos.fill(0); qvel.fill(0); ctrl.fill(0); warm.fill(0);
      for (let s = 0; s < 2; s++) {
        const home = o.homePose[SEATS[s]];
        for (let j = 0; j < 6; j++) { qpos[s * 6 + j] = home[j] ?? 0; ctrl[s * 6 + j] = home[j] ?? 0; }
      }
      initServo();
      for (let i = 0; i < 9; i++) parkCube(i);
      for (const i of CLUTTER_CUBES) {
        const o7 = QPOS_ARM + i * 7;
        qpos[o7] = -0.2 + 0.1 * (i % 5); qpos[o7 + 1] = 0.15; qpos[o7 + 2] = 0.02;
      }
      frame.onsets.length = 0;
      syncFrame("both");
    },

    setTargets(seat: Seat, targets: ArrayLike<number>): void {
      const s = seat === "atlas" ? 0 : 1;
      for (let j = 0; j < 6; j++) {
        const [lo, hi] = JOINT_LIMITS[j];
        const v = Number(targets[j]);
        ctrl[s * 6 + j] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : ctrl[s * 6 + j];
      }
    },

    applyServoProfile(seat: Seat, profile: ServoProfile): void {
      if (mode === "harness" && profile.tauScale !== 0) { engine.rejectedProfiles++; return; }
      profiles.push({ seat, profile: { ...profile }, step: frame.step });
      const s = seat === "atlas" ? 0 : 1;
      for (let j = 0; j < 5; j++) {
        const a = (s * 6 + j) * 3;
        servo[a] = 998.22 * profile.kpScale; servo[a + 1] = 2.731 * profile.kvScale; servo[a + 2] = Math.min(8, 2.94 * profile.tauScale);
      }
    },

    placeCube(index: number, pos: Vec3 | null): void {
      placements.push({ index, pos: pos ? [pos[0], pos[1], pos[2]] : null, step: frame.step });
      if (pos === null) { parkCube(index); } else {
        const o = QPOS_ARM + index * 7;
        qpos[o] = pos[0]; qpos[o + 1] = pos[1]; qpos[o + 2] = pos[2];
      }
      syncFrame("curr");
    },

    step(): void {
      frame.bodyPosPrev.set(frame.bodyPosCurr);
      frame.bodyQuatPrev.set(frame.bodyQuatCurr);
      frame.onsets.length = 0;
      const dt = frame.dt;
      for (let i = 0; i < 12; i++) {
        const offline = i % 6 < 5 && servo[i * 3 + 2] === 0;
        const v = offline ? qvel[i] * 0.9 : (ctrl[i] - qpos[i]) * FAKE_SERVO_GAIN;
        qvel[i] = v;
        qpos[i] += v * dt;
      }
      frame.step++;
      frame.simTime = frame.step * dt;
      syncFrame("curr");
      engine.onStep?.(frame);
    },

    saveState(out?: SimState): SimState {
      const s = out ?? { time: 0, qpos: new Float64Array(FAKE_NQ), qvel: new Float64Array(FAKE_NV), ctrl: new Float64Array(FAKE_NU), qacc_warmstart: new Float64Array(FAKE_NV), servo: new Float64Array(FAKE_NU * 3) };
      s.time = frame.simTime;
      s.qpos.set(qpos); s.qvel.set(qvel); s.ctrl.set(ctrl); s.qacc_warmstart.set(warm); s.servo.set(servo);
      return s;
    },

    restoreState(state: SimState, slot: "prev" | "curr" | "both"): void {
      qpos.set(state.qpos); qvel.set(state.qvel); ctrl.set(state.ctrl); warm.set(state.qacc_warmstart); servo.set(state.servo);
      frame.simTime = state.time;
      frame.step = Math.round(state.time / frame.dt);
      syncFrame(slot);
    },

    checksum(): number {
      let h = 0x811c9dc5;
      for (const arr of [qpos, qvel, ctrl]) {
        const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
        for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
      }
      return h >>> 0;
    },

    dispose(): void { disposed = true; },
  };
  return engine;
}

/* ───────────────────────── rules ───────────────────────── */

export interface FakeRules extends CombatRules {
  readonly state: CombatSnapshot;
  readonly live: boolean;
  readonly config: RulesConfig | null;
  /** Returns events for a step (t and step are stamped by the fake). Called only while live. */
  script: ((step: number, t: number, state: CombatSnapshot) => GameEvent[] | null) | null;
  /** Placements handed out on the next requestPlacements call. */
  readonly pendingPlacements: CoreMutationRequest[];
  /** Changes a seat's profile and bumps its revision, like a servo state transition. */
  setProfile(seat: Seat, profile: ServoProfile): void;
  readonly stepCalls: number;
}

export function createFakeRules(): FakeRules {
  const state = fakeCombat();
  const profile: Record<Seat, ServoProfile> = { atlas: { ...IDENTITY_PROFILE }, blaze: { ...IDENTITY_PROFILE } };
  const revision: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const pendingPlacements: CoreMutationRequest[] = [];
  let live = false;
  let config: RulesConfig | null = null;
  let stepCalls = 0;

  const rules: FakeRules = {
    state, pendingPlacements, script: null,
    get live() { return live; },
    get config() { return config; },
    get stepCalls() { return stepCalls; },

    reset(cfg: RulesConfig, round: number, suddenDeath: boolean, carry): void {
      config = cfg;
      const fresh = fakeCombat(cfg.preset);
      Object.assign(state, fresh);
      state.round = round;
      state.suddenDeath = suddenDeath;
      state.roundLengthS = suddenDeath ? cfg.suddenDeathLengthS : cfg.roundLengthS;
      for (const seat of SEATS) {
        state.seats[seat].loadout = cfg.loadouts[seat];
        if (carry) state.seats[seat].integrity = carry.integrity[seat];
      }
      state.core.lockInTotalS = cfg.lockInS.atlas;
      state.core.lockInRemainingS = cfg.lockInS.atlas;
    },
    setLive(on: boolean): void { live = on; },
    setProtected(seat: Seat, on: boolean): void { state.seats[seat].protected = on; },

    step(input: RulesStepInput, out: GameEvent[]): void {
      stepCalls++;
      if (!live) return;
      const { frame } = input;
      state.fightTimeS += frame.dt;
      const produced = rules.script?.(frame.step - 1, frame.simTime, state);
      if (produced) for (const e of produced) out.push({ ...e, step: frame.step - 1, t: frame.simTime });
      if (!state.outcome && state.fightTimeS >= state.roundLengthS) {
        const winner: Seat = state.seats.atlas.integrity >= state.seats.blaze.integrity ? "atlas" : "blaze";
        state.outcome = { winner, reason: "time", t: frame.simTime };
      }
    },

    servoProfile: (seat: Seat) => profile[seat],
    profileRevision: (seat: Seat) => revision[seat],
    requestPlacements(out: CoreMutationRequest[]): number {
      const n = pendingPlacements.length;
      for (const p of pendingPlacements) out.push(p);
      pendingPlacements.length = 0;
      return n;
    },
    setProfile(seat: Seat, p: ServoProfile): void { profile[seat] = { ...p }; revision[seat]++; },
  };
  return rules;
}

/* ───────────────────────── seat driver ───────────────────────── */

export interface FakeSeatDriverOptions {
  kind?: SeatDriver["kind"];
  name?: string;
  /** Pure policy: targets for an observation. Default holds the home guard. */
  act?: (obs: Observation, tick: number) => PolicyAction;
  /** Live mode: number of poll() calls after a request before its result is ready (0 = instant). */
  latencyPolls?: number;
  /** Eval mode: wall milliseconds waitForResult takes (real timer). */
  waitMs?: number;
  /** Never answers: poll stays null and waitForResult rejects with "hang" after hardAbortMs. */
  hang?: boolean;
  /** Reported compute time on each result. */
  computeMs?: number;
}

export interface FakeSeatDriver extends SeatDriver {
  readonly requests: { tick: number; frameIndex: number; t: number }[];
  readonly resetContexts: ResetContext[];
  readonly warmups: number;
  readonly disposed: boolean;
}

export const FAKE_HOME_TARGETS: readonly number[] = [0, -0.62, 1.08, -0.48, 0, GRIP_OPEN];

export function createFakeSeatDriver(seat: Seat, opts: FakeSeatDriverOptions = {}): FakeSeatDriver {
  const act = opts.act ?? (() => ({ targets: [...FAKE_HOME_TARGETS] }));
  const requests: FakeSeatDriver["requests"] = [];
  const resetContexts: ResetContext[] = [];
  let warmups = 0;
  let disposed = false;
  let inFlight: { result: ActionResult; pollsLeft: number } | null = null;
  let ready: ActionResult | null = null;
  let chunkId = 0;

  function compute(obs: Observation, tick: number): ActionResult {
    return { tick, requestFrameIndex: obs.frame_index, chunkId: chunkId++, action: act(obs, tick), computeMs: opts.computeMs ?? 1, status: "ok" };
  }

  return {
    kind: opts.kind ?? "module",
    name: opts.name ?? `fake-${seat}`,
    sha256: "f".repeat(64), claimedSha256: null, provenance: null,
    requests, resetContexts,
    get warmups() { return warmups; },
    get disposed() { return disposed; },

    async reset(ctx: ResetContext): Promise<void> {
      resetContexts.push(ctx);
      inFlight = null; ready = null; chunkId = 0;
    },
    async warmup(fixture: readonly Observation[]): Promise<void> {
      warmups += Math.min(8, fixture.length);
    },
    request(obs: Observation, tick: number): void {
      requests.push({ tick, frameIndex: obs.frame_index, t: obs.t });
      if (opts.hang) return;
      inFlight = { result: compute(obs, tick), pollsLeft: opts.latencyPolls ?? 0 };
    },
    poll(): ActionResult | null {
      if (inFlight) {
        if (inFlight.pollsLeft <= 0) { ready = inFlight.result; inFlight = null; } else { inFlight.pollsLeft--; }
      }
      const out = ready;
      ready = null;
      return out;
    },
    waitForResult(hardAbortMs: number): Promise<ActionResult> {
      return new Promise((resolve, reject) => {
        if (opts.hang || !inFlight) {
          setTimeout(() => reject(new Error("hang")), hardAbortMs);
          return;
        }
        const result = inFlight.result;
        inFlight = null;
        const wait = opts.waitMs ?? 0;
        if (wait >= hardAbortMs) { setTimeout(() => reject(new Error("hang")), hardAbortMs); return; }
        if (wait <= 0) resolve(result); else setTimeout(() => resolve(result), wait);
      });
    },
    dispose(): void { disposed = true; },
  };
}

/* ───────────────────────── feedback ───────────────────────── */

export interface FakeAudio extends AudioControl {
  readonly musicStates: MusicState[];
  readonly uiCues: UiCue[];
  unlocked: boolean;
}

export interface FakeFeedback extends FeedbackSystem {
  readonly audio: FakeAudio;
  /** Every event delivered by the bus, in delivery order. */
  readonly received: GameEvent[];
  readonly contexts: FeedbackContext[];
  readonly updates: number;
  readonly disposed: boolean;
}

export function createFakeFeedback(bus?: EventBus): FakeFeedback {
  const received: GameEvent[] = [];
  const contexts: FeedbackContext[] = [];
  let updates = 0;
  let disposed = false;
  const audio: FakeAudio = {
    musicStates: [], uiCues: [], unlocked: false,
    hype: 0, latencyMs: 0, activeVoices: 0,
    async unlock() { audio.unlocked = true; },
    async prepare(onProgress) { onProgress(1, 1); },
    setMusic(state) { audio.musicStates.push(state); },
    playUi(cue) { audio.uiCues.push(cue); },
    setVolumes() { /* no graph in tests */ },
  };
  const unsubscribe = bus?.subscribe((events, ctx) => {
    for (const e of events) received.push(e);
    contexts.push(ctx);
  });
  return {
    juice: createJuiceOutput(), audio, received, contexts,
    frame: {
      vibration: { atlas: 0, blaze: 0 }, impactFrame: 0, lensSmear: 0, ledFlare: { atlas: null, blaze: null },
      deckFlash: { seat: null, ms: 0 }, hitLight: { on: false, seat: "atlas", ms: 0 }, hypeLean: 0,
    },
    get updates() { return updates; },
    get disposed() { return disposed; },
    update() { updates++; },
    dispose() { disposed = true; unsubscribe?.(); },
  };
}

export function fakeFeedbackContext(overrides: Partial<FeedbackContext> = {}): FeedbackContext {
  return {
    playerSeat: "atlas", preset: "arcade", phase: "fight", combat: fakeCombat(),
    names: { atlas: "PILOT", blaze: "BACKLASH" }, opponentIsUserModel: false, camera: null, fastShow: false,
    ...overrides,
  };
}

/* ───────────────────────── kinematics ───────────────────────── */

/** Linear stand-in: command fields map one-to-one onto joints. Round-trips exactly, never fails. */
export function createFakeKinematics(): So101Kinematics {
  return {
    fkTipEgo(q, out) { out[0] = 0.2 + 0.1 * q[2]; out[1] = 0.1 * q[0]; out[2] = 0.15 + 0.05 * q[1]; return out; },
    fkRollAxisEgo(q, out) { out[0] = 0.18 + 0.1 * q[2]; out[1] = 0.1 * q[0]; out[2] = 0.15 + 0.05 * q[1]; return out; },
    commandToJoints(cmd, out) {
      out[0] = cmd.yaw; out[1] = cmd.elev; out[2] = cmd.reach; out[3] = cmd.tool; out[4] = cmd.roll; out[5] = cmd.grip;
      return out;
    },
    jointsToCommand(q, out) {
      out.yaw = q[0]; out.elev = q[1]; out.reach = q[2]; out.tool = q[3]; out.roll = q[4]; out.grip = q[5];
      return out;
    },
    solveTipEgo(_target, _pitch, seed, out) { for (let i = 0; i < 6; i++) out[i] = seed[i] ?? 0; return { ok: true, errorM: 0 }; },
    homeCommand: () => ({ yaw: 0, elev: -0.62, reach: 1.08, tool: -0.48, roll: 0, grip: GRIP_OPEN }),
  };
}

/* ───────────────────────── pilot ───────────────────────── */

export interface FakePilot extends PilotController {
  /** Targets written by writeCommand (len 6). Tests set it to steer the human seat. */
  readonly targets: Float64Array;
  /** Mutable intents the test flips; exposed read-only to consumers as `intents`. */
  readonly heldIntents: Intents;
  readonly modes: PilotMode[];
  readonly rulesSet: PilotRules[];
  readonly synthetic_: { moves: [number, number][]; keys: [string, boolean][]; buttons: [0 | 2, boolean][] };
  readonly touch_: { calls: string[] };
  readonly sampled: { wallDtS: number; frozen: boolean }[];
  readonly writes: number;
  locked_: boolean;
}

export function createFakePilot(seat: Seat = "atlas", device: InputDevice = "keyboard_mouse"): FakePilot {
  const targets = new Float64Array(FAKE_HOME_TARGETS);
  const heldIntents = noIntents();
  const command: CommandState = { yaw: 0, elev: -0.62, reach: 1.08, tool: -0.48, roll: 0, grip: GRIP_OPEN };
  const ghost: GhostPose = { joints: new Float64Array(FAKE_HOME_TARGETS), tipWorld: new Float64Array(3), rollAxisWorld: new Float64Array(3), leashStretch: 0 };
  const rangeCue: RangeCue = { flick: false, jab: false, nearestM: 0.3, flickArcRadiusM: 0.24, jabArcRadiusM: 0.16 };
  const shaping: InputShapingFlags = { leash: false, guardBlend: false, jabMacro: false, chargeWindup: false, grabAssist: false, dockMagnet: false, aimAssist: false };
  const modes: PilotMode[] = [];
  const rulesSet: PilotRules[] = [];
  const synthetic_: FakePilot["synthetic_"] = { moves: [], keys: [], buttons: [] };
  const touch_: FakePilot["touch_"] = { calls: [] };
  const sampled: FakePilot["sampled"] = [];
  let writes = 0;

  const syntheticInput: SyntheticInput = {
    move(dx, dy) { synthetic_.moves.push([dx, dy]); },
    key(code, down) { synthetic_.keys.push([code, down]); },
    button(b, down) { synthetic_.buttons.push([b, down]); },
  };
  const touchInput: TouchInput = {
    swing(x, y) { touch_.calls.push(`swing ${x} ${y}`); },
    stance(x) { touch_.calls.push(`stance ${x}`); },
    reach(y) { touch_.calls.push(`reach ${y}`); },
    button(id, down) { touch_.calls.push(`button ${id} ${down}`); },
    release() { touch_.calls.push("release"); },
  };

  const pilot: FakePilot = {
    seat, device, command, ghost, rangeCue, shaping, targets, heldIntents, modes, rulesSet, synthetic_, touch_, sampled,
    intents: heldIntents,
    stance: { yaw: 0, elev: 0 },
    look: { yawOffset: 0, pitchOffset: 0 },
    reach01: 0.5,
    locked_: true,
    get locked() { return pilot.locked_; },
    rearming: false,
    edgeSimTimes: { guardPress: -1 },
    get writes() { return writes; },
    attach() { /* no DOM in tests */ },
    detach() { /* no DOM in tests */ },
    async requestLock() { pilot.locked_ = true; return true; },
    setMode(mode) { modes.push(mode); },
    setRules(rules) { rulesSet.push({ ...rules }); },
    setCursorTarget() { /* lobby cursor unused in tests */ },
    triggerJab() { heldIntents.charge = false; },
    resetCommand() { targets.set(FAKE_HOME_TARGETS); },
    synthetic: () => syntheticInput,
    touch: () => touchInput,
    sampleFrame(wallDtS, frozen) { sampled.push({ wallDtS, frozen }); },
    writeCommand(_frame, _combat, out) { out.set(targets); writes++; },
    dispose() { /* nothing held */ },
  };
  return pilot;
}

/* ───────────────────────── observations ───────────────────────── */

export interface FakeObservationBuilder extends ObservationBuilder {
  /** Every build call: seat, tick, sim time, and the events drained for it. */
  readonly builds: { seat: Seat; tick: number; t: number; events: GameEvent[]; phase: MatchPhase }[];
}

function blankArmObs(): Observation["self"] {
  return {
    q: [0, 0, 0, 0, 0, 0], qd: [0, 0, 0, 0, 0, 0], tau: [0, 0, 0, 0, 0, 0], ctrl: [0, 0, 0, 0, 0, 0],
    ee: { pos: [0, 0, 0], quat: [1, 0, 0, 0], linvel: [0, 0, 0] }, elbow_pos: [0, 0, 0], wrist_pos: [0, 0, 0], gripper_opening: 0,
    integrity: 100, integrity_max: 100, heat: 0, servo_state: "normal", servo_state_remaining_ms: 0,
    charge_public: 0, guard: false, loadout: null,
  };
}

/** Builds structurally complete observations; `state[0..5]` carries the seat's joint positions, `game[0]` the tick. */
export function createFakeObservationBuilder(): FakeObservationBuilder {
  const builds: FakeObservationBuilder["builds"] = [];
  return {
    builds,
    build(seat, frame, combat, match, lastApplied, status, tick, frameIndex, events, out) {
      builds.push({ seat, tick, t: frame.simTime, events: events.slice(), phase: match.phase });
      const blocks = out?.blocks ?? ({} as Record<ObsBlockName, Float32Array>);
      for (const name of Object.keys(OBS_BLOCKS) as ObsBlockName[]) {
        if (!blocks[name]) blocks[name] = new Float32Array(OBS_BLOCKS[name]);
      }
      const q = frame.arms[seat].q;
      for (let j = 0; j < 6; j++) blocks.state[j] = q[j];
      blocks.game[0] = tick;
      const obs: Observation = out ?? {
        schema: OBS_SCHEMA, tick, frame_index: frameIndex, t: frame.simTime, dt: frame.dt, side: seat, preset: combat.preset,
        self: blankArmObs(), opponent: blankArmObs(), cubes: [],
        core: { phase: combat.core.phase, owner: null, docked_in: null, lock_in_remaining: combat.core.lockInRemainingS, lock_in_full: combat.core.lockInTotalS, contested: false, loose: false },
        contacts: [],
        round: { index: match.round, best_of: match.bestOf, phase: match.phase, time_remaining: 0, phase_length: match.phaseLengthS, rounds_won: { self: 0, opponent: 0 }, sudden_death: combat.suddenDeath },
        last_action: [], status: { ...status }, blocks,
      };
      obs.tick = tick; obs.frame_index = frameIndex; obs.t = frame.simTime; obs.dt = frame.dt;
      obs.self.q = Array.from(q);
      obs.last_action = Array.from(lastApplied);
      obs.status = { ...status };
      obs.round.phase = match.phase; obs.round.index = match.round;
      obs.contacts = events.filter((e) => e.type === "strike").map((e) => ({
        kind: "strike" as const, attacker: null, damage_to_self: 0, damage_to_opponent: 0, normal_speed: 0, zone: null, pos: [0, 0, 0] as Vec3, t: e.t,
      }));
      return obs;
    },
  };
}

/** Keeps every pushed observation; read(delay) returns the newest one at least `delay` older than the newest. */
export function createFakeDelayLine(): ObservationDelayLine {
  const items: Observation[] = [];
  return {
    push(obs) { items.push(obs); if (items.length > 256) items.shift(); },
    read(delayMs) {
      const newest = items[items.length - 1];
      const cutoff = newest.t - delayMs / 1000 + 1e-9;
      for (let i = items.length - 1; i >= 0; i--) if (items[i].t <= cutoff) return items[i];
      return items[0];
    },
    clear() { items.length = 0; },
  };
}

/* ───────────────────────── chunk executor ───────────────────────── */

export interface FakeChunkExecutor extends ChunkExecutor {
  readonly accepted: { tick: number; obsT: number }[];
}

/** until_next_decision without chunks: the newest accepted action holds until replaced. */
export const createFakeChunkExecutor: CreateChunkExecutor = () => {
  let current: ActionResult | null = null;
  const accepted: FakeChunkExecutor["accepted"] = [];
  const exec: FakeChunkExecutor = {
    accepted,
    reset() { current = null; },
    accept(result, obsT) { current = result; accepted.push({ tick: result.tick, obsT }); },
    sample(_t, out: ChunkSample) {
      if (!current) return false;
      const tg = current.action.targets;
      for (let j = 0; j < 6; j++) out.targets[j] = tg[j] ?? 0;
      const i = current.action.intents ?? {};
      out.intents = (i.guard ? INTENT_BITS.guard : 0) | (i.charge ? INTENT_BITS.charge : 0) | (i.grip ? INTENT_BITS.grip : 0)
        | (i.overdrive ? INTENT_BITS.overdrive : 0) | (i.ability ? INTENT_BITS.ability : 0) | (i.burst ? INTENT_BITS.burst : 0);
      out.chunkId = current.chunkId; out.chunkIndex = -1; out.exhausted = true;
      return true;
    },
    wantsRequest: (isDecisionTick) => isDecisionTick,
  };
  return exec;
};

/* ───────────────────────── hit stop ───────────────────────── */

/** GAME_DESIGN 8.1 table shape: strikes 133·m², crit +17, guarded 50·m², deflect 90, clash 40, KO 150; stock presets 0. */
export const fakeHitstopMsFor: HitstopMsFor = (e, preset) => {
  if (preset !== "arcade") return 0;
  switch (e.type) {
    case "strike": {
      if (e.tier === "graze" || e.magnitude < 0.15) return 0;
      const m2 = e.magnitude * e.magnitude;
      if (e.guarded) return Math.round(50 * m2);
      return Math.min(150, Math.round(133 * m2) + (e.crit ? 17 : 0));
    }
    case "deflect": return 90;
    case "clash": return 40;
    case "ko": return 150;
    default: return 0;
  }
};

/* ───────────────────────── recorder + moments ───────────────────────── */

export interface FakeRecordedRow {
  frameIndex: number; t: number; round: number; phase: MatchPhase; discontinuity: number;
  applied: Record<Seat, number[]>; raw: Record<Seat, number[] | null>;
  requestFrameIndex: Record<Seat, number>; obsFrameIndex: Record<Seat, number>;
  deliveredTick: Record<Seat, number | null>; obsTick: Record<Seat, number>;
  intents: Record<Seat, number>; status: Record<Seat, string>; computeMs: Record<Seat, number>;
}

export interface FakeRecorder extends Recorder {
  readonly meta: EpisodeMeta | null;
  readonly rows: FakeRecordedRow[];
  readonly steps: { step: number; intents: Record<Seat, number> }[];
  readonly mutations: SimMutation[];
  readonly checkpoints: { step: number; checksum: number }[];
  readonly recordedEvents: GameEvent[];
  readonly sparseWrites: Record<string, { frame_index: number; value: unknown }[]>;
  readonly ended: MatchResultRecord | null;
}

export function createFakeRecorder(): FakeRecorder {
  let meta: EpisodeMeta | null = null;
  let ended: MatchResultRecord | null = null;
  const rows: FakeRecordedRow[] = [];
  const steps: FakeRecorder["steps"] = [];
  const mutations: SimMutation[] = [];
  const checkpoints: FakeRecorder["checkpoints"] = [];
  const recordedEvents: GameEvent[] = [];
  const sparseWrites: FakeRecorder["sparseWrites"] = {};
  const perSeat = <T>(f: (s: Seat) => T): Record<Seat, T> => ({ atlas: f("atlas"), blaze: f("blaze") });
  const rec: FakeRecorder = {
    rows, steps, mutations, checkpoints, recordedEvents, sparseWrites,
    get meta() { return meta; },
    get ended() { return ended; },
    get recording() { return meta !== null && ended === null; },
    begin(m) { meta = m; },
    tick(r: TickRecord) {
      rows.push({
        frameIndex: r.frameIndex, t: r.t, round: r.round, phase: r.phase, discontinuity: r.discontinuity,
        applied: perSeat((s) => Array.from(r.applied[s])),
        raw: perSeat((s) => (r.raw[s] ? Array.from(r.raw[s] as Float64Array) : null)),
        requestFrameIndex: { ...r.requestFrameIndex }, obsFrameIndex: { ...r.obsFrameIndex },
        deliveredTick: perSeat((s) => (r.delivered[s] ? (r.delivered[s] as Record<ObsBlockName, Float32Array>).game[0] : null)),
        obsTick: perSeat((s) => r.obs[s].game?.[0] ?? -1),
        intents: { ...r.intents }, status: { ...r.status }, computeMs: { ...r.computeMs },
      });
    },
    stepCtrl(step, _frame, intents) { steps.push({ step, intents: { ...intents } }); },
    mutation(m) { mutations.push(m); },
    checkpoint(step, _state, checksum) { checkpoints.push({ step, checksum }); },
    events(evts) { for (const e of evts) recordedEvents.push(e); },
    sparse(name, frameIndex, value) { (sparseWrites[name] ??= []).push({ frame_index: frameIndex, value }); },
    end(result): Episode {
      ended = result;
      if (!meta) throw new Error("recorder.end before begin");
      return {
        meta: { ...meta, format: EPISODE_FORMAT, result },
        columns: { timestamp: Float64Array.from(rows.map((r) => r.t)), frame_index: Uint32Array.from(rows.map((r) => r.frameIndex)) },
        shapes: {},
        steps: { ctrl: { steps: new Uint32Array(0), values: new Float64Array(0), width: 12 }, intents: { steps: new Uint32Array(0), values: new Uint8Array(0), width: 2 }, mutations: mutations.slice(), checkpoints: [] },
        sparse: { ...sparseWrites },
        events: recordedEvents.slice(),
      };
    },
  };
  return rec;
}

function cloneSimState(s: SimState): SimState {
  return { time: s.time, qpos: s.qpos.slice(), qvel: s.qvel.slice(), ctrl: s.ctrl.slice(), qacc_warmstart: s.qacc_warmstart.slice(), servo: s.servo.slice() };
}

/** Ring of the last `seconds` of SimState copies. */
export function createFakeMomentBuffer(seconds = 6): MomentBuffer & { readonly size: number } {
  const frames: SimState[] = [];
  const times: number[] = [];
  return {
    get size() { return frames.length; },
    push(t, sim) {
      frames.push(cloneSimState(sim)); times.push(t);
      while (times.length > 0 && t - times[0] > seconds + 1e-9) { frames.shift(); times.shift(); }
    },
    clip(eventT, beforeS, afterS): MomentClip {
      const out: MomentClip = { frames: [], times: [], eventT };
      for (let i = 0; i < times.length; i++) {
        if (times[i] >= eventT - beforeS - 1e-9 && times[i] <= eventT + afterS + 1e-9) { out.frames.push(frames[i]); out.times.push(times[i]); }
      }
      return out;
    },
    clear() { frames.length = 0; times.length = 0; },
  };
}
