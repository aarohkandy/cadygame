// src/game/contracts.ts
// TORQUE LIMIT shared contracts. Dependency root for every work package.
// Source: GAME_DESIGN 11.2 with BUILD_PLAN section 2 applied (CONTRACTS_VERSION 3.0.0).
// Erasable TypeScript only (no enums/namespaces). verbatimModuleSyntax: import types with `import type`.
import type { BufferGeometry, PerspectiveCamera } from "three";

export const CONTRACTS_VERSION = "3.0.0";

/* ───────────────────────── primitives ───────────────────────── */
export type Seat = "atlas" | "blaze";
export const SEATS: readonly Seat[] = ["atlas", "blaze"];
export function otherSeat(s: Seat): Seat { return s === "atlas" ? "blaze" : "atlas"; }
export type HostId = "rook" | "vale";
export type InputDevice = "keyboard_mouse" | "gamepad" | "touch" | "synthetic";

export type Vec3 = [number, number, number];
export type QuatWxyz = [number, number, number, number];

export const JOINT_NAMES = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"] as const;
export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_LIMITS: readonly (readonly [number, number])[] = [
  [-1.91986, 1.91986], [-1.7453293, 1.7453293], [-1.69, 1.69],
  [-1.658063, 1.658063], [-2.7438473, 2.7438473], [-0.174533, 1.7453292],
];
export const VIOLATION_TOLERANCE_RAD = 1e-5;
export const GRIP_OPEN = 1.15;
export const GRIP_CLOSED = 0.04;

export const RENDER_SCALE = 2.05;                 // render = sim (x, y, z) → (x·s, z·s, −y·s)
export const MOUNT_X: Readonly<Record<Seat, number>> = { atlas: -0.32, blaze: 0.32 };
export const DOCK_CENTER_X: Readonly<Record<Seat, number>> = { atlas: -0.12, blaze: 0.12 };  // provisional until scripts/probe-dock-geometry.mjs (WP2) passes (GAME_DESIGN 2.5)
export const DOCK_RADIUS = 0.07;                                                              // provisional until scripts/probe-dock-geometry.mjs (WP2) passes (GAME_DESIGN 2.5)
export const CORE_CUBE_INDEX = 4;
export const CLUTTER_CUBES: readonly number[] = [0, 2, 6, 8];
export const HOME_TIP_EGO: Vec3 = [0.20, 0.0, 0.15];        // wrist_roll axis point
export const GUARD_VOLUME_RADIUS = 0.06;                      // capsule camera_mount → shoulder (5.5.3)

export type PhysicsMode = "arcade" | "harness";              // harness = stock Menagerie parameters
export type MatchPreset = "arcade" | "proving_ground" | "harness";
export const PRESET_PHYSICS: Readonly<Record<MatchPreset, PhysicsMode>> =
  { arcade: "arcade", proving_ground: "harness", harness: "harness" };
export type ScoringProfile = "full" | "physical";
export const PRESET_SCORING: Readonly<Record<MatchPreset, ScoringProfile>> =
  { arcade: "full", proving_ground: "physical", harness: "physical" };
export type ControlHz = 30 | 50 | 60;
export type LoadoutId = "whip" | "pivot" | "anvil";
export type AbilityId = "snap" | "recoil_coil" | "bulwark";
export const LINK_IDS = ["base", "shoulder", "upper_arm", "lower_arm", "wrist", "gripper", "camera_mount", "moving_jaw"] as const;
export type LinkId = (typeof LINK_IDS)[number];
export type ServoStateId = "normal" | "micro_stagger" | "stagger" | "stun" | "cutout" | "offline";
export const SERVO_STATE_CODE: Readonly<Record<ServoStateId, number>> =
  { normal: 0, micro_stagger: 1, stagger: 2, stun: 3, cutout: 4, offline: 5 };

export interface Intents { guard: boolean; charge: boolean; grip: boolean; overdrive: boolean; ability: boolean; burst: boolean; }
export const INTENT_BITS: Readonly<Record<keyof Intents, number>> = { guard: 1, charge: 2, grip: 4, overdrive: 8, ability: 16, burst: 32 };
export function noIntents(): Intents { return { guard: false, charge: false, grip: false, overdrive: false, ability: false, burst: false }; }

/* ───────────────────────── physics (WP2) ───────────────────────── */
export interface ServoProfile { tauScale: number; kpScale: number; kvScale: number; }   // multiplies loadout base; engine caps |τ| ≤ 8.0
export const IDENTITY_PROFILE: Readonly<ServoProfile> = { tauScale: 1, kpScale: 1, kvScale: 1 };

export interface ArmFrame {
  q: Float64Array; qd: Float64Array; qacc: Float64Array;   // len 6
  tau: Float64Array; ctrl: Float64Array;                    // len 6 (actuator_force, ctrl)
  forceRange: Float64Array;                                 // len 6, current |forcerange|
  eePos: Float64Array; eeVel: Float64Array;                 // len 3, world, gripperframe site
  eeQuat: Float64Array;                                     // len 4, world, wxyz, w ≥ 0
  elbowPos: Float64Array;                                   // len 3, world, lower_arm body origin
  wristPos: Float64Array;                                   // len 3, world, gripper body origin (wrist_roll axis point)
  shoulderPos: Float64Array; cameraMountPos: Float64Array;  // len 3, world (guard volume ends)
}
export interface CubesFrame { pos: Float64Array; quat: Float64Array; linvel: Float64Array; }   // 9×3, 9×4 (wxyz), 9×3, world

export interface ArmContactOnset {
  kind: "arm_arm"; t: number; step: number;
  atlasLink: LinkId; blazeLink: LinkId;
  aN: number; bN: number; vN: number;                       // m/s, pre-impulse, along normal (4.1)
  efcForce: number; pos: Vec3; normal: Vec3;                // world; normal points atlas → blaze
}
export interface CubeContactOnset { kind: "cube_arm"; t: number; step: number; cube: number; seat: Seat; link: LinkId; vN: number; pos: Vec3; normal: Vec3; }
export interface TableContactOnset { kind: "arm_table"; t: number; step: number; seat: Seat; link: LinkId; vN: number; efcForce: number; pos: Vec3; }
export interface SelfContactOnset { kind: "self"; t: number; step: number; seat: Seat; linkA: LinkId; linkB: LinkId; }
export type ContactOnset = ArmContactOnset | CubeContactOnset | TableContactOnset | SelfContactOnset;

export interface ActiveContacts {
  armArmTouching: boolean; maxArmForce: number;
  lastCrossContactT: Record<Seat, number>;                  // sim time of the last arm-arm or cube contact on that seat, −1 none
  gripperOnCube: Record<Seat, number>;                      // any gripper geom touching cube index, −1 none
  bothJawsOnCube: Record<Seat, number>;                     // both jaws on the same cube, −1 none
  lastGripperTouch: { cube: Int32Array /* 9, Seat index 0/1 or −1 */; t: Float64Array /* 9 */ };
  opticsImpulse: Record<Seat, number>;                      // Σ normal impulse this step on that seat's camera_mount
}

export interface PhysicsFrame {
  mode: PhysicsMode; dt: number; step: number; simTime: number;
  arms: Record<Seat, ArmFrame>;
  cubes: CubesFrame;
  docks: Float64Array;                                      // 2×3, world dock centres (atlas, blaze), static
  nbody: number;
  bodyPosPrev: Float64Array; bodyPosCurr: Float64Array;     // nbody×3, world, sim metres
  bodyQuatPrev: Float64Array; bodyQuatCurr: Float64Array;   // nbody×4, world, wxyz
  onsets: ContactOnset[];                                   // onsets produced by THIS step only (array reused)
  active: ActiveContacts;
}

export interface ModelInfo {
  mujocoVersion: string; modelFile: string; modelSha256: string; so101Sha256: string;
  nq: number; nv: number; nu: number; nbody: number;
  bodyNames: readonly string[];
  bodyId: Readonly<Record<Seat, Readonly<Record<LinkId, number>>>>;
  cubeBodyIds: readonly number[];                           // len 9
  hullScoring: boolean;                                     // true for arena-arcade models (4.1)
}

export interface EngineResetOptions {
  mode: PhysicsMode;
  timestep: 0.0025 | 0.005 | number;                        // 1/600 allowed in harness mode (4.10)
  seed: number;                                             // physicsInit substream for this round (cube jitter ±6 mm, start pose ±0.02 rad)
  loadouts: Record<Seat, LoadoutId>;                        // ignored in harness
  homePose: Record<Seat, Float64Array>;                     // len 6
  layout: "duel" | "lobby" | "attract";
}

export interface SimState {
  time: number; qpos: Float64Array; qvel: Float64Array; ctrl: Float64Array;
  qacc_warmstart: Float64Array;
  servo: Float64Array;                                      // per-actuator [kp, kv, forcerangeHi] ×12 (restores Arcade runtime edits)
}

export interface PhysicsEngine {
  readonly info: ModelInfo;
  readonly frame: PhysicsFrame;
  /**
   * `info` as it will read once the engine is reset into `mode`. The engine owns both compiled models, so a
   * caller that must name the model a match will run on - episode provenance, before the first round reset
   * has switched modes - reads it here instead of from the mode the engine happens to be in.
   */
  infoFor(mode: PhysicsMode): ModelInfo;
  reset(opts: EngineResetOptions): void;
  setTargets(seat: Seat, targets: ArrayLike<number>): void; // clamps exactly to JOINT_LIMITS; writes data.ctrl
  applyServoProfile(seat: Seat, profile: ServoProfile): void; // arm actuators 0–4; harness: only the Offline profile is accepted
  placeCube(index: number, pos: Vec3 | null): void;         // null → parked (2.0 + 0.1·index, 0, 0.02)
  step(): void;                                             // one mj_step; swaps prev/curr; fills onsets/active/docks
  saveState(out?: SimState): SimState;
  restoreState(state: SimState, slot: "prev" | "curr" | "both"): void; // mj_forward; fills body buffers of that slot
  checksum(): number;                                       // FNV-1a 32 over qpos ∥ qvel ∥ ctrl bytes
  dispose(): void;
}
/** `onFile` reports model-fetch progress during boot (done, total), so the loading bar can move through the
 *  download instead of sitting at one number until the whole thing lands. Optional; Node callers omit it. */
export type CreatePhysicsEngine = (opts: {
  mode: PhysicsMode; modelBaseUrl?: string; nodeFsRoot?: string; onFile?: (done: number, total: number) => void;
}) => Promise<PhysicsEngine>;

/* ───────────────────────── kinematics (WP2) ───────────────────────── */
export interface CommandState { yaw: number; elev: number; reach: number; tool: number; roll: number; grip: number; }
export interface So101Kinematics {
  fkTipEgo(q: ArrayLike<number>, out: Float64Array): Float64Array;              // gripperframe site, full FK incl. roll, ego frame
  fkRollAxisEgo(q: ArrayLike<number>, out: Float64Array): Float64Array;         // wrist_roll axis point (gripper body origin), ego
  commandToJoints(cmd: CommandState, out: Float64Array): Float64Array;           // closed-form planar IK on the roll-axis point, clamped
  jointsToCommand(q: ArrayLike<number>, out: CommandState): CommandState;
  solveTipEgo(target: Vec3, pitch: number, seed: ArrayLike<number>, out: Float64Array): { ok: boolean; errorM: number };
  homeCommand(): CommandState;                                                    // roll-axis point at HOME_TIP_EGO
}

/* ───────────────────────── combat (WP2) ───────────────────────── */
export interface AbilityState { id: AbilityId; charges: number; maxCharges: number; cooldownMs: number; cooldownTotalMs: number; activeMs: number; }
export interface SeatCombatState {
  loadout: LoadoutId;
  integrity: number; integrityMax: number;
  heat: number;                                             // 0..100 (telemetry only in physical scoring)
  servoState: ServoStateId; servoStateRemainingMs: number; servoStateTotalMs: number;
  staggerImmuneMs: number; staggerFollowUps: number;
  burstUsed: boolean;
  guardHeld: boolean; deflectLockoutMs: number;
  charging: boolean; charge: number; chargeHoldMs: number;  // charge 0..1
  armoured: boolean;
  releaseBoostMs: number; heavyTagMs: number; heavyTagC: number;
  overdrive: boolean;
  ability: AbilityState;
  protected: boolean;                                       // pointer-lock hold rule (7.3.10): takes no damage
  comboCount: number; lastStrikeT: number;
  damageDealtRound: number; physicalDamageDealtRound: number; firstStrikeT: number;   // −1 when none
}
export interface CoreState {
  phase: "dormant" | "incoming" | "live";
  owner: Seat | null;                  // seat whose countdown runs while docked in its own dock; null before the first dock
  dockedIn: Seat | null;               // dock currently holding the Core (only a seat's own dock counts)
  lockInRemainingS: number;            // the Core's countdown; paused while undocked; inherited on steal (D8)
  lockInTotalS: number;                // full lock-in of the current owner (8, 6 underdog, 4 sudden death), for the ring UI
  contested: boolean;
  loose: boolean;                      // true after a steal until someone docks it
  stolenFrom: Seat | null;             // owner at the moment of the last steal; cleared on the next dock
  lastTouchedBy: Seat | null;
}
export type RoundEndReason = "ko" | "lock" | "time" | "sudden_death_strike" | "sudden_death_tiebreak" | "forfeit";
export interface RoundOutcome { winner: Seat; reason: RoundEndReason; t: number; }
export interface CombatSnapshot {
  preset: MatchPreset; scoring: ScoringProfile; round: number; suddenDeath: boolean;
  fightTimeS: number; roundLengthS: number;
  seats: Record<Seat, SeatCombatState>;
  core: CoreState;
  outcome: RoundOutcome | null;
}
export interface RulesConfig {
  preset: MatchPreset; roundLengthS: number; suddenDeathLengthS: number;
  loadouts: Record<Seat, LoadoutId>;
  lockInS: Record<Seat, number>;                            // 8 or 6 (underdog)
  comebacks: boolean;
  coreIncomingAtS: number; coreDropAtS: number;             // 12, 15 (0, 0 in sudden death)
  sparring?: "round1" | "tier" | null;                     // EMOTION_BIBLE 11 WP5: 0 dealt / 0 taken (match-1 round 1) or ×0.6 (SPARRING tier)
  noSuddenDeath?: boolean;                                  // match 1: a time-up inside the tie margin goes first strike → damage → integrity
}
export interface CarryOver { integrity: Record<Seat, number>; }
export interface RulesStepInput { frame: PhysicsFrame; intents: Record<Seat, Intents>; }
export interface CoreMutationRequest { cube: number; pos: Vec3 | null; }
export interface CombatRules {
  readonly state: CombatSnapshot;
  reset(cfg: RulesConfig, round: number, suddenDeath: boolean, carry: CarryOver | null): void;
  setLive(live: boolean): void;                             // false outside fight/sudden_death: no timers, no damage
  setProtected(seat: Seat, on: boolean): void;
  step(input: RulesStepInput, out: GameEvent[]): void;      // once per physics step; every emitted event carries t and step
  servoProfile(seat: Seat): ServoProfile;                   // current composed profile (Arcade; Offline in every preset)
  profileRevision(seat: Seat): number;                      // increments when servoProfile(seat) changes
  requestPlacements(out: CoreMutationRequest[]): number;    // drop/park commands for the driver to apply this step; returns count
}
export type CreateCombatRules = (info: ModelInfo) => CombatRules;
/** combat/tuning.ts exports this; juice and sim-driver both call it (8.1). */
export type HitstopMsFor = (event: GameEvent, preset: MatchPreset, playerSeat: Seat | null) => number;

/* ───────────────────────── events ───────────────────────── */
export const MATCH_PHASES = [
  "boot", "title", "green_room", "match_intro", "rematch_intro", "round_intro", "fight",
  "ko", "lock", "time_up", "sudden_death", "round_replay", "round_summary",
  "match_replay", "outro", "post_match", "paused", "replay_viewer", "lab_run",
  // EMOTION_BIBLE 11.9 show phases (Phase 0): attract loop, boot ritual 1800 / 600 ms, entrance 1500 ms,
  // count-in 870 ms inside the ritual, verdict screen, SYSTEMS CHECK drill after match 2.
  "attract", "boot_ritual", "entrance", "count_in", "verdict", "systems_check",
] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export interface EvBase { t: number; step: number; }                  // sim seconds, physics step index
export type GameEvent =
  | (EvBase & { type: "contact"; pos: Vec3; magnitude: number })
  | (EvBase & { type: "strike"; tier: "graze" | "strike"; attacker: Seat; victim: Seat; raw: number; damage: number; physicalDamage: number;
                nu: number; vN: number; zone: LinkId; tool: LinkId; crit: boolean; guarded: boolean; heavyC: number; armoured: boolean;
                pos: Vec3; normal: Vec3; magnitude: number; lethal: boolean; upgrade: boolean; thrownCube: number /* −1 */;
                whip?: boolean /* landed inside the 300 ms tip-reversal carry (+10 %) */ })
  | (EvBase & { type: "late_guard"; defender: Seat; attacker: Seat; refund: number; pressLagMs: number })
  | (EvBase & { type: "deflect"; defender: Seat; attacker: Seat; hard: boolean; pressLeadMs: number; pos: Vec3; normal: Vec3 })
  | (EvBase & { type: "clash"; pos: Vec3; normal: Vec3; magnitude: number; heavyWinner: Seat | null })
  | (EvBase & { type: "whiff"; seat: Seat })
  | (EvBase & { type: "charge"; seat: Seat; stage: "start" | "public" | "full" | "release" | "cancel"; c: number })
  | (EvBase & { type: "servo_state"; seat: Seat; state: ServoStateId; durationMs: number; cause: "strike" | "guard_break" | "knockback" | "deflect" | "clash" | "heat" | "ko" | "end" | "second_strike" | "burst" })
  | (EvBase & { type: "burst"; seat: Seat })
  | (EvBase & { type: "heat_warning"; seat: Seat; on: boolean })
  | (EvBase & { type: "overheat"; seat: Seat })
  | (EvBase & { type: "ability"; seat: Seat; ability: AbilityId; phase: "start" | "end" })
  | (EvBase & { type: "table_hit"; seat: Seat; force: number; pos: Vec3 })
  | (EvBase & { type: "combo"; seat: Seat; count: number })
  | (EvBase & { type: "first_strike"; seat: Seat })
  | (EvBase & { type: "low_integrity"; seat: Seat })
  | (EvBase & { type: "ko"; victim: Seat; attacker: Seat; pos: Vec3 })
  | (EvBase & { type: "core"; stage: "incoming" | "drop" | "lock_in_start" | "lock_in_resume" | "contested_on" | "contested_off" | "steal" | "lock";
                seat: Seat | null; from: Seat | null; remainingS: number; late: boolean; inherited: boolean })
  | (EvBase & { type: "flaw"; seat: Seat; flaw: "chains_jabs" | "bites_feints" | "panics"; stage: "exploited" | "patched"; count: number })
  | (EvBase & { type: "stalemate"; seconds: number })
  | (EvBase & { type: "phase"; phase: MatchPhase; round: number; finalRound: boolean })
  | (EvBase & { type: "round_end"; winner: Seat; reason: RoundEndReason; roundsWon: Record<Seat, number> })
  | (EvBase & { type: "match_end"; winner: Seat; roundsWon: Record<Seat, number> })
  | (EvBase & { type: "policy_fault"; seat: Seat; status: ActionStatus | "disconnect" | "hang"; detail: string })
  | (EvBase & { type: "joint_limit_violation"; seat: Seat; joint: number; overshoot: number })
  | (EvBase & { type: "dda"; seat: Seat; k: number; reason: "exchange" | "loss_streak" | "post_loss_clamp" })
  // EMOTION_BIBLE 9: a drill round's task completed (WP6 tutorial/drill script emits; the exporter's +1 reward row).
  | (EvBase & { type: "task_success"; seat: Seat; task: string })
  | (EvBase & { type: "show"; show: ShowEvent });                  // 11.9 ShowEvent carrier: WP4 (via sim-driver) and WP5 emit; captions, audio, VFX read
export type GameEventType = GameEvent["type"];

export interface EventBus {
  emit(e: GameEvent): void;                                 // queues for this frame (director and drivers use this)
  pushStepEvents(events: readonly GameEvent[], from: number): void; // sim-driver hands over rules events
  flush(ctx: FeedbackContext): void;                        // delivers the frame's events once, in step order, then clears
  subscribe(fn: (events: readonly GameEvent[], ctx: FeedbackContext) => void): () => void;
}
/** loop/event-ring.ts (WP1): per-seat ring of events since that seat's last observation. */
export interface SeatEventRing { push(events: readonly GameEvent[], from: number): void; drain(seat: Seat, out: GameEvent[]): number; clear(): void; }

/* ───────────────────────── clock (WP1) ───────────────────────── */
export interface GameClock {
  readonly simTime: number; readonly wallTime: number;
  readonly alpha: number;                                   // render interpolation 0..1
  readonly timeScale: number; readonly hitstopRemainingMs: number;
  readonly hitstopBudgetUsedMs: number;                     // freeze used in the rolling 600 ms window
  readonly externalDrive: boolean;
  paused: boolean;
  requestHitstop(ms: number): number;                       // max-merge, single cap 150, budget 120 per 600 ms wall; returns ms granted; arcade only
  requestDilation(scale: number, holdMs: number, easeMs: number): void;  // arcade only
  setRenderAlpha(a: number): void;
  setExternalDrive(on: boolean): void;                      // true: sim-driver skips stepping (replay player drives the engine)
}

/* ───────────────────────── match config (WP1) ───────────────────────── */
export type PersonalityId = "overshoot" | "backlash" | "deadband" | "jig";
export type TierId = "rookie" | "contender" | "pro" | "champion";
export type JigBehavior = "parked_in_reach" | "idle" | "hold_guard" | "slow_heavy" | "sparring";
export type ProxyBotId = "human_proxy";
export type DriverSpec =
  | { kind: "human" }
  | { kind: "proxy"; bot: ProxyBotId }
  | { kind: "builtin"; personality: PersonalityId; tier: TierId; dda: boolean; behavior?: JigBehavior; parkOffsetM?: number }
  | { kind: "module"; fileName: string; source: string; sha256: string }
  | { kind: "trajectory"; fileName: string; json: string; sha256: string }
  | { kind: "bridge"; url: string; allowLan: boolean; sessionId: string };
export type DriverKind = DriverSpec["kind"];
export type ChunkExecute = "until_next_decision" | "full_chunk" | { nSteps: number };
export interface SeatConfig {
  seat: Seat; displayName: string; driver: DriverSpec; loadout: LoadoutId;
  decisionHz: number;                                       // controlHz / decimation
  chunkExecute: ChunkExecute; temporalEnsembleM: number | null;
}
export interface MatchConfig {
  id: string;                                               // ISO time + 4 hex
  preset: MatchPreset; timing: "live" | "eval"; turbo: boolean;
  controlHz: ControlHz; timestep: number;                   // derived by match/presets.ts (4.10)
  seed: number;                                             // uint32
  bestOf: 1 | 3 | 5; roundLengthS: 45;
  seats: Record<Seat, SeatConfig>;
  actionDelayTicks: 0 | 1 | 2 | 3 | 4 | 5;
  fairDelayMs: number;                                      // applied only when a human/proxy seat faces module/trajectory/bridge
  strictLimits: boolean;
  record: boolean; keepEpisodes: boolean;
  tutorial: boolean;
  fastShow: boolean;
  showKit: boolean;                                         // abilities/overdrive visible (profile.matchesPlayed ≥ 3)
  context: "quick" | "lab" | "tutorial" | "warmup" | "attract" | "suite";
}

/* ───────────────────────── policy / observation (WP4) ───────────────────────── */
export type ActionStatus = "ok" | "held" | "late" | "timeout" | "clamped" | "error" | "slow";
export const ACTION_STATUS_CODE: Readonly<Record<ActionStatus, number>> = { ok: 0, held: 1, late: 2, timeout: 3, clamped: 4, error: 5, slow: 6 };

export interface PolicyDebug {
  state?: string; primitive?: string; phase?: string; intent?: string;
  mood?: { aggression: number; composure: number; focus: number };
  utilities?: Record<string, number>; dda?: number;
  parryGuess?: { expectedReleaseT: number; errorMs: number; capped: boolean };
  flaw?: { flaw: "chains_jabs" | "bites_feints" | "panics"; stage: "exploited" | "patched"; count: number };   // sim-driver turns this into a `flaw` GameEvent
  // 11.9: the opponent's character channel (WP4 mind/decision). sim-driver puts `show` on the bus and keeps affect/tier per seat.
  affect?: OpponentAffect;
  show?: ShowEvent[];
  gaze?: { t: number; target: "gripper" | "camera" | "core" | "away"; kind: "glance" | "look" | "track"; onAim: boolean }[];
  tier?: TierId | "sparring";
}
export interface PolicyAction {
  targets: number[];                                        // len 6, absolute joint targets (rad)
  intents?: Partial<Intents>;
  chunk?: number[][]; chunkHz?: number; chunkStartT?: number;
  intentChunk?: number[];                                   // INTENT_BITS per chunk step, same length and rate as chunk
  debug?: PolicyDebug; info?: unknown;
}
export interface ActionResult { tick: number; requestFrameIndex: number; chunkId: number; action: PolicyAction; computeMs: number; status: ActionStatus; error?: string; }

/**
 * policy/chunk-executor.ts (WP4): turns accepted ActionResults into per-control-tick targets (5.3).
 * sim-driver owns one per policy seat; entries are applied by sim time and skipped when already past.
 */
export interface ChunkSample {
  targets: Float64Array;                                    // len 6, written by sample()
  intents: number;                                          // INTENT_BITS for this tick
  chunkId: number; chunkIndex: number;                      // −1 when the action carries no chunk
  exhausted: boolean;                                       // full_chunk / n_steps: the chunk is consumed, a request may go out
}
export interface ChunkExecutor {
  reset(): void;
  accept(result: ActionResult, obsT: number): void;         // obsT: t of the observation the policy was given (default chunkStartT)
  sample(t: number, out: ChunkSample): boolean;             // false while no action has ever been accepted
  wantsRequest(isDecisionTick: boolean): boolean;           // until_next_decision: the decision tick; full_chunk / n_steps: suppress until consumed
}
export type CreateChunkExecutor = (opts: { controlHz: ControlHz; chunkExecute: ChunkExecute; temporalEnsembleM: number | null }) => ChunkExecutor;

export const OBS_SCHEMA = "torquelimit.obs/3";
export const OBS_BLOCKS = { state: 12, self_ext: 32, opponent_state: 28, game: 16, environment_state: 81, contacts: 20 } as const;
export type ObsBlockName = keyof typeof OBS_BLOCKS;

export interface ArmObservation {
  q: number[]; qd: number[]; tau: number[]; ctrl: number[];
  ee: { pos: Vec3; quat: QuatWxyz; linvel: Vec3 };          // gripperframe site; quat w ≥ 0
  elbow_pos: Vec3; wrist_pos: Vec3; gripper_opening: number;
  integrity: number; integrity_max: number;
  heat: number; servo_state: ServoStateId; servo_state_remaining_ms: number;  // arcade only; 0 / "normal" otherwise (offline always reported)
  charge_public: number; guard: boolean; loadout: LoadoutId | null;
}
export interface ObsContactEvent {
  kind: "strike" | "graze" | "deflect" | "clash" | "contact" | "cube_hit" | "table_hit";
  attacker: "self" | "opponent" | null; damage_to_self: number; damage_to_opponent: number;
  normal_speed: number; zone: LinkId | null; pos: Vec3; t: number;
}
export interface Observation {
  schema: typeof OBS_SCHEMA;
  tick: number; frame_index: number; t: number; dt: number; side: Seat; preset: MatchPreset;
  self: ArmObservation; opponent: ArmObservation;           // opponent.ctrl is always zeros
  cubes: { pos: Vec3; quat: QuatWxyz; linvel: Vec3; is_core: boolean; parked: boolean; held_by: "self" | "opponent" | null }[];
  core: { phase: CoreState["phase"]; owner: "self" | "opponent" | null; docked_in: "self" | "opponent" | null;
          lock_in_remaining: number; lock_in_full: number; contested: boolean; loose: boolean };
  contacts: ObsContactEvent[];                              // events since this seat's previous observation
  round: { index: number; best_of: number; phase: MatchPhase; time_remaining: number; phase_length: number;
           rounds_won: { self: number; opponent: number }; sudden_death: boolean };
  last_action: number[];                                    // applied at the previous control tick
  status: { late_steps: number; clamped_steps: number; timeouts: number };
  blocks: { [K in ObsBlockName]: Float32Array };            // section 5.4, exact layouts
}
export interface ResetContext {
  schema: typeof OBS_SCHEMA; protocol: "torquelimit.policy/3"; obs_schema_hash: string;
  side: Seat; seed: number; episode_id: string; round: number;
  control_hz: ControlHz; decision_hz: number; action_delay_ticks: number; fair_delay_ms: number;
  mode: "live" | "eval"; preset: MatchPreset; physics: PhysicsMode; strict_limits: boolean;
  joint_names: readonly string[]; joint_limits: readonly (readonly [number, number])[];
  home_pose: number[];
  arena: { opponent_base: Vec3; midline_x: 0.32; dock_self: Vec3; dock_opponent: Vec3; dock_radius: number };
  rules: { round_length: number; best_of: number; integrity_max: number; loadout: LoadoutId | null; scoring: ScoringProfile };
  config?: { personality?: PersonalityId; tier?: TierId; dda?: boolean; behavior?: JigBehavior; parkOffsetM?: number;
             matchesPlayed?: number };                      // the facing human profile's finished matches (DDA new-player ramp)
  opponentMemory?: OpponentMemory;                          // 11.9: WP6 profile.ts passes it; absent (HARNESS) = EMPTY_OPPONENT_MEMORY
}
export interface SeatDriver {
  readonly kind: DriverKind; readonly name: string;
  readonly sha256: string | null; readonly claimedSha256: string | null; readonly provenance: Record<string, unknown> | null;
  reset(ctx: ResetContext): Promise<void>;
  warmup(fixture: readonly Observation[]): Promise<void>;   // 8 acts, 60 s budget, not recorded
  request(obs: Observation, tick: number): void;            // non-blocking
  poll(): ActionResult | null;                              // newest completed result not yet returned
  waitForResult(hardAbortMs: number): Promise<ActionResult>; // eval lockstep: no outcome timeout; rejects with "hang" after hardAbortMs
  dispose(): void;
}
export type CreateSeatDriver = (spec: Exclude<DriverSpec, { kind: "human" } | { kind: "proxy" }>, seat: Seat) => Promise<SeatDriver>;
/** policy/in-process-driver.ts (WP4): same contract without Workers or bundler syntax, for Node. */
export type CreateInProcessSeatDriver = (spec: Exclude<DriverSpec, { kind: "human" } | { kind: "proxy" }>, seat: Seat, opts: { modulePath?: string }) => Promise<SeatDriver>;

/** policy/proxy-driver.ts (WP4) drives a PilotController through SyntheticInput (WP3). */
export interface SyntheticInput { move(dx: number, dy: number): void; key(code: string, down: boolean): void; button(b: 0 | 2, down: boolean): void; }
export interface ProxyBot { reset(seed: number): void; update(obs: Observation, pilot: PilotController, input: SyntheticInput, wallDtS: number): void; }
export type CreateProxyBot = (id: ProxyBotId) => ProxyBot;

export interface ObservationBuilder {
  build(seat: Seat, frame: PhysicsFrame, combat: CombatSnapshot,
        match: { round: number; bestOf: number; phase: MatchPhase; phaseLengthS: number; roundsWon: Record<Seat, number> },
        lastApplied: Float64Array, status: Observation["status"], tick: number, frameIndex: number,
        events: readonly GameEvent[], out?: Observation): Observation;
}
export interface ObservationDelayLine { push(obs: Observation): void; read(delayMs: number): Observation; clear(): void; }

export type RegistrationCheckId = "parsed" | "exports_act" | "reset" | "cold_act" | "fixture_acts" | "finite" | "limits" | "deterministic";
export interface RegistrationRow {
  id: RegistrationCheckId; label: string;              // label e.g. "COLD ACT · 41 ms", caps, ≤ 3 words before the mono detail
  status: "pass" | "fail" | "warn"; detail: string | null; fixtureIndex: number | null;
}
export interface RegistrationResult { ok: boolean; rows: RegistrationRow[]; name: string; sha256: string; coldActMs: number; p99ActMs: number; deterministic: boolean; }
export type RunRegistration = (spec: Extract<DriverSpec, { kind: "module" } | { kind: "trajectory" }>, onRow: (row: RegistrationRow) => void, signal?: AbortSignal) => Promise<RegistrationResult>;
export interface BridgeHello { name: string; version: string | null; claimedSha256: string | null; provenance: Record<string, unknown> | null; supportsChunks: boolean; maxChunk: number; chunkHz: number; }
export type ProbeBridge = (url: string, allowLan: boolean) => Promise<BridgeHello>;   // hello → hello_ok → bye

export interface EntrantRecord { id: string; kind: "module" | "trajectory"; fileName: string; name: string; source: string; sha256: string; created: string; }
export interface EntrantStore { list(): Promise<EntrantRecord[]>; save(e: Omit<EntrantRecord, "id" | "created">): Promise<EntrantRecord>; remove(id: string): Promise<void>; }

export type WorkerRequest =
  | { type: "load"; kind: "builtin" | "module"; source?: string; fileName?: string }
  | { type: "reset"; id: number; ctx: ResetContext; evalClock: boolean }   // worker reseeds Math.random from ctx.seed; evalClock stubs Date/performance
  | { type: "act"; id: number; tick: number; obs: Observation; simTimeMs: number; warmup: boolean };
export type WorkerResponse =
  | { type: "loaded"; name: string; provenance: Record<string, unknown> | null }
  | { type: "reset_ok"; id: number }
  | { type: "action"; id: number; action: PolicyAction; computeMs: number }
  | { type: "error"; id: number | null; message: string; fatal: boolean };

/* ───────────────────────── pilot + camera (WP3) ───────────────────────── */
export interface GhostPose { joints: Float64Array; tipWorld: Float64Array; rollAxisWorld: Float64Array; leashStretch: number; }
export interface RangeCue { flick: boolean; jab: boolean; nearestM: number; flickArcRadiusM: number; jabArcRadiusM: number; }
export type PilotMode = "fight" | "lobby_cursor" | "frozen" | "hold_guard";
export interface InputShapingFlags { leash: boolean; guardBlend: boolean; jabMacro: boolean; chargeWindup: boolean; grabAssist: boolean; dockMagnet: boolean; aimAssist: boolean; }
export interface PilotRules { jabMacro: boolean; chargeMacro: boolean; leash: boolean; guardBlend: boolean; assists: boolean; aimAssist: boolean; showKit: boolean; }
export interface TouchInput {
  swing(x: number, y: number): void;         // absolute swing stick, each in [−1, 1] after the radial deadzone; maps like RS (GAME_DESIGN 3.4)
  stance(x: number): void;                   // [−1, 1] stance drift, like LS x
  reach(y: number): void;                    // [−1, 1] reach spring, like LS y (up = out)
  button(id: "strike" | "guard" | "grip" | "overdrive" | "ability", down: boolean): void;  // strike: tap = jab, hold = charge, release = heavy
  release(): void;                           // all touches ended (app backgrounded, lock lost)
}
export interface PilotController {
  readonly seat: Seat;
  readonly command: Readonly<CommandState>;                 // pre-shaping command
  readonly ghost: GhostPose;
  readonly intents: Readonly<Intents>;
  readonly stance: { readonly yaw: number; readonly elev: number };   // 250 ms low-pass (3.2)
  readonly look: { readonly yawOffset: number; readonly pitchOffset: number };  // radians, from stance
  readonly rangeCue: Readonly<RangeCue>;
  readonly shaping: Readonly<InputShapingFlags>;            // what shaped the last written ctrl
  readonly reach01: number;
  readonly device: InputDevice;
  readonly locked: boolean; readonly rearming: boolean;
  readonly edgeSimTimes: { guardPress: number };            // sim time stamps (post-freeze rule, 3.5)
  attach(target: HTMLElement): void;
  detach(): void;
  requestLock(): Promise<boolean>;
  setMode(mode: PilotMode): void;
  setRules(rules: PilotRules): void;                        // from the preset (4.10)
  setCursorTarget(egoPoint: Vec3 | null): void;             // lobby: arm points at this ego point
  triggerJab(): void;                                       // lobby tile click
  resetCommand(): void;                                     // home guard
  synthetic(): SyntheticInput;                              // proxy bots
  touch(): TouchInput;                                      // same command path as the gamepad; recorded as device "touch"
  sampleFrame(wallDtS: number, frozen: boolean): void;
  writeCommand(frame: PhysicsFrame, combat: CombatSnapshot, out: Float64Array): void;
  dispose(): void;
}
export type CreatePilotController = (deps: { kinematics: So101Kinematics; settings: SettingsStore; clock: GameClock; profileMatchesPlayed: () => number }) => PilotController;

export interface CameraPose { position: Vec3; quaternion: [number, number, number, number] /* three xyzw */; fovDeg: number; }
export interface JuiceOutput {
  yaw: number; pitch: number; roll: number;                 // radians, additive
  fovOffsetDeg: number;
  chromaticOffset: number; vignetteBoost: number; desaturate: number;
  edge: { left: number; right: number; top: number; color: string };   // color: one of the TokenColor hex values (BUILD_PLAN 2.2 brand)
  victimVibration: { seat: Seat | null; link: LinkId | null; offset: Vec3 };  // sim metres
  koFocus: { seat: Seat | null; weight: number };           // KO camera hold toward the loser's gripper (8.3)
  trauma: number;                                           // 0..1 current shake trauma (3.5 cap 0.35 outside KO); ?debug=feel reads the round max
}
export interface CockpitRig {
  compute(seat: Seat, pilot: PilotController | null, juice: JuiceOutput, frame: PhysicsFrame, settings: Settings, out: CameraPose): CameraPose;
}
export type CreateCockpitRig = () => CockpitRig;

/* ───────────────────────── feedback: juice + audio + hosts (WP3) ───────────────────────── */
export type MusicState = "off" | "title" | "lobby" | "match" | "between_rounds" | "victory" | "defeat";
export type UiCue = "hover" | "select" | "back" | "slam" | "stamp" | "sticker" | "countdown_beat" | "engage" | "tick" | "shutter";
export interface FeedbackContext {
  playerSeat: Seat | null; preset: MatchPreset; phase: MatchPhase;
  combat: CombatSnapshot; names: Record<Seat, string>; opponentIsUserModel: boolean;
  camera: CameraPose | null;                                // last rendered pose (render space)
  fastShow: boolean;
}
export interface AudioControl {
  unlock(): Promise<void>;
  prepare(onProgress: (done: number, total: number) => void): Promise<void>;   // builds the graph and pre-synthesizes noise/impulse/wavetable buffers during boot
  setMusic(state: MusicState): void;
  playUi(cue: UiCue, whenMs?: number): void;
  setVolumes(v: Settings["audio"]): void;
  readonly hype: number;
  readonly latencyMs: number;
  readonly activeVoices: number;            // ?debug=audio
}
export interface Caption { speaker: HostId; lineId: string; text: string; priority: 1 | 2 | 3; durationMs: number; }
export interface FeedbackSystem {
  readonly juice: JuiceOutput;
  readonly audio: AudioControl;
  readonly frame: FeedbackFrame;                            // 11.9: written every update(); robot-view, post-stack, led-strips, crowd read it
  update(wallDtS: number, ctx: FeedbackContext, frame: PhysicsFrame): void;
  dispose(): void;
}
/** feedback-system.ts subscribes itself to the bus inside the factory. Nobody else delivers events to it. */
export type CreateFeedbackSystem = (deps: {
  clock: GameClock; ui: UiStore; settings: SettingsStore; bus: EventBus;
  pilot?: PilotController;                                  // 3.2 tremor into FeedbackFrame.vibration, haptics tick on an aim reversal
  policy?: () => Readonly<Record<Seat, { affect?: OpponentAffect | null } | null>>;   // WP4 affect at 10 Hz → the hosts' menace gates
}) => FeedbackSystem;

/* ───────────────────────── harness (WP5) ───────────────────────── */
export interface TickRecord {
  frameIndex: number; t: number; round: number; phase: MatchPhase; discontinuity: number;
  obs: Record<Seat, { [K in ObsBlockName]: Float32Array }>;
  delivered: Record<Seat, { [K in ObsBlockName]: Float32Array } | null>;
  applied: Record<Seat, Float64Array>; raw: Record<Seat, Float64Array | null>;
  requestFrameIndex: Record<Seat, number>; obsFrameIndex: Record<Seat, number>;
  chunkId: Record<Seat, number>; chunkIndex: Record<Seat, number>;
  intents: Record<Seat, number>;                            // INTENT_BITS bitfield
  status: Record<Seat, ActionStatus>; computeMs: Record<Seat, number>;   // NaN when not a decision tick
  human: Record<Seat, { command: Float32Array; shaping: number;
                         raw?: Float32Array;             // 9: f32[8] mouse dx/dy, buttons, keys, sticks (WP3 fills; absent = NaN)
                         active?: number;                // u8: 1 when the pilot moved this tick
                         gazeHint?: Float32Array } | null>;  // f32[2]
  displayLatencyMs: number;
}
export type SimMutation =
  | { kind: "reset"; step: number; seed: number; round: number; state: SimState }
  | { kind: "place_cube"; step: number; index: number; pos: Vec3 | null }
  | { kind: "servo_profile"; step: number; seat: Seat; kp: number[]; kv: number[]; forcerange: number[] }
  | { kind: "timestep"; step: number; dt: number }
  | { kind: "offline"; step: number; seat: Seat }
  // EMOTION_BIBLE 11.9: drills vary objects, servos and friction only through these so every episode re-simulates.
  | { kind: "geom_friction"; step: number; geom: string; friction: [number, number, number] }
  | { kind: "object_variant"; step: number; core: 0 | 1 | 2; cubes: 0 | 1 | 2 };
export interface SeatMeta {
  driver: DriverKind; name: string; loadout: LoadoutId; personality?: PersonalityId; tier?: TierId; proxyBot?: ProxyBotId;
  policySha256: string | null; claimedSha256: string | null; provenance: Record<string, unknown> | null;
  policyDeterministic: boolean | "unchecked";
  decisionHz: number; chunkExecute: ChunkExecute; temporalEnsembleM: number | null;
  inputDevice: InputDevice | null;                          // null for policy seats
}
export interface StatsTolerances { attackOnsetSpeed: 0.35; attackOnsetMs: 40; debounceMs: 150; reactionDv: 0.25; reactionWindowMs: 800; anticipationMarginMs: 100; jerkH: 0.02; chatterMin: 0.01; nearLimit: 0.03; violationTol: typeof VIOLATION_TOLERANCE_RAD; }
export const EPISODE_FORMAT = "torquelimit.episode/4";
/** Older documents the codec still imports (EMOTION_BIBLE 9: /4 is additive over /3). */
export const EPISODE_FORMATS_READABLE: readonly string[] = ["torquelimit.episode/3", EPISODE_FORMAT];
export interface EpisodeMeta {
  format: typeof EPISODE_FORMAT; episodeId: string; created: string;
  controlHz: ControlHz; timestep: number;
  seed: number; seedStreams: Record<string, number>;
  preset: MatchPreset; physics: PhysicsMode; scoring: ScoringProfile; timing: "live" | "eval";
  actionDelayTicks: number; fairDelayMs: number; strictLimits: boolean;
  seats: Record<Seat, SeatMeta>;
  inputShaping: Record<Seat, InputShapingFlags | null>;
  rules: { roundLengthS: number; bestOf: number;
           sparring?: "round1" | "tier" | null; noSuddenDeath?: boolean };   // 11 WP5 show flags the live rules ran with (re-sim rebuilds them)
  tuning: unknown; tuningSha256: string; servoParamsHash: string; tolerances: StatsTolerances;
  provenance: { mujoco: string; modelFile: string; modelSha256: string; so101Sha256: string; harnessCommit: string; userAgent: string; contracts: string; obsSchemaHash: string };
  // EMOTION_BIBLE 9 / 11.9 (episode /4, WP8 recorder writes these; absent in a /3 document):
  session?: SessionMeta;                                    // recorder.annotate({ session }) from WP6 profile.ts
  opponentMemory?: OpponentMemory;                          // the ResetContext.opponentMemory the match ran with
  rounds?: RoundMeta[];                                     // per-round task string, physics, outcome and segments
  quality?: QualityMeta;                                    // stats.ts qualityMeta() at match end (director calls computeStats before save)
}
/** Per-round data-product block (9): drills carry a task string under stock physics; duels carry "duel vs …". */
export interface RoundMeta {
  round: number; task: string; physics: PhysicsMode; preset: MatchPreset;
  outcome: "success" | "fail" | "timeout" | null;           // drills: success on task_success; duels: null
  durationS: number;
  segments: RoundSegment[];                                 // drill: approach|grasp|lift|transport|place|retract|recover; duel: carry|contest|guard|attack|idle
}
export type DrillSegmentLabel = "approach" | "grasp" | "lift" | "transport" | "place" | "retract" | "recover";
export type DuelSegmentLabel = "carry" | "contest" | "guard" | "attack" | "idle";
export interface RoundSegment { label: DrillSegmentLabel | DuelSegmentLabel; firstTick: number; endTick: number; }
/** One-tap label (9), stored in `sparse.labels` by the recorder; never mandatory. */
export interface OneTapLabel {
  kind: "intent" | "person" | "run";                        // per-round RUSH/BAIT/…; per-match hearts 1–5; per-match CLEAN/SLOPPY
  round: number | null; value: string | number | null; skipped: boolean; shownMs: number;
  opponentBuild: { personality: PersonalityId | null; tier: TierId | null; ddaKMean: number; cornerVersion: string | null; cornerSha: string | null };
}
export interface RoundResultRecord { round: number; winner: Seat; reason: RoundEndReason; tEnd: number; }
export interface MatchResultRecord {
  winner: Seat | null; roundsWon: Record<Seat, number>; rounds: RoundResultRecord[]; forfeit: Seat | null;
  determinism: "unchecked" | "bit_exact" | "diverged"; error: "policy_hang" | null;
}
export interface RleStream { steps: Uint32Array; values: Float64Array | Uint8Array; width: number; }
export interface Episode {
  meta: EpisodeMeta & { result: MatchResultRecord };
  columns: { timestamp: Float64Array; frame_index: Uint32Array; [name: string]: Float64Array | Float32Array | Uint32Array | Int32Array | Int16Array | Uint8Array };
  shapes: Record<string, number[]>;
  steps: { ctrl: RleStream; intents: RleStream; mutations: SimMutation[]; checkpoints: { step: number; state: SimState; checksum: number }[] };
  sparse: Record<string, { frame_index: number; value: unknown }[]>;
  events: GameEvent[];                                      // each carries step; frame_index = floor(step / stepsPerControlTick)
}
export interface EpisodeSummary { id: string; created: string; names: Record<Seat, string>; preset: MatchPreset; winner: Seat | null; durationS: number; bytes: number; verdict: "cleared" | "fault" | "arcade" | "none"; pinned: boolean; human: boolean; }
export interface Recorder {
  readonly recording: boolean;
  begin(meta: EpisodeMeta): void;
  tick(rec: TickRecord): void;                              // copies data; caller reuses buffers
  stepCtrl(step: number, frame: PhysicsFrame, intents: Record<Seat, number>): void;   // RLE per physics step
  mutation(m: SimMutation): void;
  checkpoint(step: number, state: SimState, checksum: number): void;
  events(events: readonly GameEvent[]): void;
  sparse(column: string, frameIndex: number, value: unknown): void;
  /** Episode /4 meta the recorder cannot see from the sim: session block, opponent memory, round tasks. Merged at end(). */
  annotate?(extra: Partial<Pick<EpisodeMeta, "session" | "opponentMemory">> & { tasks?: Record<number, string> }): void;
  end(result: MatchResultRecord): Episode;
}
export type TypedDtype = "f64" | "f32" | "u32" | "i32" | "i16" | "u8";
export interface EncodedTyped { dtype: TypedDtype; length: number; b64: string; }   // exact little-endian bytes, base64
export interface EncodedSimState { time: number; qpos: EncodedTyped; qvel: EncodedTyped; ctrl: EncodedTyped; qacc_warmstart: EncodedTyped; servo: EncodedTyped; }
export interface EpisodeJson {
  format: typeof EPISODE_FORMAT;
  meta: EpisodeMeta & { result: MatchResultRecord };
  columns: Record<string, EncodedTyped>;
  shapes: Record<string, number[]>;
  steps: {
    ctrl: { steps: EncodedTyped; values: EncodedTyped; width: number };
    intents: { steps: EncodedTyped; values: EncodedTyped; width: number };
    mutations: (Exclude<SimMutation, { kind: "reset" }> | { kind: "reset"; step: number; seed: number; round: number; state: EncodedSimState })[];
    checkpoints: { step: number; state: EncodedSimState; checksum: number }[];
  };
  sparse: Record<string, { frame_index: number; value: unknown }[]>;
  events: GameEvent[];
}
export interface EpisodeCodec {
  encode(ep: Episode): Blob;                 // application/json, EpisodeJson
  decode(text: string): Episode;             // throws EpisodeFormatError on a wrong format string, unknown dtype, or length mismatch
}
export interface MomentClip { frames: SimState[]; times: number[]; eventT: number; }
export interface MomentBuffer { push(t: number, sim: SimState): void; clip(eventT: number, beforeS: number, afterS: number): MomentClip; clear(): void; }
export interface VerifyResult { verdict: "bit_exact" | "diverged" | "error"; divergedFrame: number | null; divergedT: number | null; eventMismatch: string | null; checkedFrames: number; message: string; }
export interface ReplayPlayer {
  readonly durationS: number; readonly t: number; readonly playing: boolean; readonly rate: number;
  load(ep: Episode): void;
  seek(t: number): void; play(): void; pause(): void; setRate(r: 0.25 | 0.5 | 1 | 2 | 4): void; stepFrames(n: number): void;
  update(wallDtS: number): void;                            // restores prev/curr frames; clock.setRenderAlpha; requires clock.externalDrive
  targetGhost(seat: Seat, out: Float64Array): Float64Array; // recorded sim.ctrl at t
  debugAt(seat: Seat): PolicyDebug | null;
  verify(onProgress: (f: number) => void): Promise<VerifyResult>;
}
export interface PhysicalSeatStats {
  physicalDamageDealt: number; physicalDamageTaken: number; opticsImpulse: number;
  approachSpeed: { median: number; p90: number };
  strikesLanded: number; strikesTaken: number; grazesLanded: number; grazesTaken: number; crits: number;
  attackAttempts: number; accuracy: number; physicalBlockRate: number;
  reactionMs: { rawMedian: number; netMedian: number; p10: number; p90: number; n: number; anticipations: number; noReaction: number; structuralMs: number };
  lockInHeldS: number; steals: number; lateSteals: number; locks: number;
  computeMs: { median: number; p99: number; max: number }; slowDecisions: number;
  lateFrac: number; timeoutFrac: number; errorFrac: number; clampedFrac: number; reliability: number;
  violationsPerJoint: number[]; maxOvershoot: number; nearLimitDwell: number; torqueSaturationFrac: number;
  actionJerk: number; actionChatter: number; ldlj: number; energyJ: number;
  tableHits: number; selfCollisions: number;
}
export interface ArcadeSeatStats {
  damageDealt: number; damageTaken: number; guardedChips: number; deflects: number; hardDeflects: number; lateGuards: number;
  whiffs: number; whiffPunishes: number; meanHeat: number; cutouts: number; staggersDealt: number; staggersTaken: number; bursts: number;
  heavyAttempts: number; heavySuccesses: number; aiHeavyParryAttempts: number; aiHeavyParrySuccesses: number;
}
export interface EpisodeStats {
  seats: Record<Seat, { physical: PhysicalSeatStats; arcade: ArcadeSeatStats | null }>;
  result: MatchResultRecord; durationS: number;
  verdict: Record<Seat, { stamp: "cleared" | "fault" | "arcade" | "none"; reason: string | null }>;
  quality: QualityMeta;                                     // 9: tier A–D per the frozen v1 rules (stats.ts)
}
export interface AggregateStats {
  seeds: number; winRate: number; ciLow: number; ciHigh: number;
  perOpponent: Record<string, { seeds: number; winRate: number; ciLow: number; ciHigh: number }>;
  rates: { timeout: number; violation: number; hang: number };
}
export type SuiteId = "smoke-v1";
/** The seat a suite cell was run to judge, with that seat's stamp: a cell reports on its policy, not on the episode. */
export interface SuiteSubject { seat: Seat; stamp: EpisodeStats["verdict"][Seat]; }
export interface SuiteOptions { suite: SuiteId; policySeat: Seat | "both"; policy: DriverSpec; seeds?: [number, number]; keepEpisodes: boolean; onProgress: (done: number, total: number, last: EpisodeSummary, subject: SuiteSubject) => void; signal?: AbortSignal; }
export interface SuiteResult { suite: SuiteId; episodes: string[]; aggregate: AggregateStats; gates: { name: string; value: number; pass: boolean }[]; }
export interface StorageInfo {
  humanBytes: number; otherBytes: number; capBytes: number; wouldEvict: (bytes: number) => number;
  humanCapBytes: number;                                    // 9: 200 MB for `episodes_human` (oldest evicted, even `local`)
  humanWarning: string | null;                              // the one toast at 150 MB ("… · EXPORT"); null below it
}
export interface EpisodeStore {
  save(ep: Episode, opts?: { confirmEvict?: (n: number) => Promise<boolean> }): Promise<string>;
  list(): Promise<EpisodeSummary[]>;
  load(id: string): Promise<Episode>;
  remove(id: string): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  storage(): Promise<StorageInfo>;
  exportBlob(id: string): Promise<Blob>;                    // application/json, EpisodeJson (.tlep.json)
  importFile(file: File | Blob): Promise<string>;
}
export type CreateEpisodeStore = (kind: "indexeddb" | { fsRoot: string }) => EpisodeStore;   // fs for the Node CLI
export type CreateEntrantStore = (kind: "indexeddb" | { fsRoot: string }) => EntrantStore;
export type CreateEpisodeCodec = () => EpisodeCodec;
export interface HeadlessMatchRunner { run(cfg: MatchConfig, signal?: AbortSignal): Promise<Episode>; }
export type CreateHeadlessMatchRunner = (deps: {
  createEngine: CreatePhysicsEngine; createRules: CreateCombatRules; kinematics: So101Kinematics;
  observations: ObservationBuilder; createSeatDriver: CreateSeatDriver | CreateInProcessSeatDriver;
  createPilot: CreatePilotController | null; createProxyBot: CreateProxyBot | null;
  createRecorder: () => Recorder;
}) => HeadlessMatchRunner;
export interface HarnessApi {
  readonly recorder: Recorder; readonly moments: MomentBuffer;
  readonly store: EpisodeStore; readonly entrants: EntrantStore; readonly codec: EpisodeCodec;
  createRecorder(): Recorder;
  createReplayPlayer(engine: PhysicsEngine, clock: GameClock, rules: CombatRules): ReplayPlayer;
  computeStats(ep: Episode): EpisodeStats;
  aggregate(eps: readonly EpisodeStats[], subjectSeat: Seat, seedOf: (i: number) => number): AggregateStats;
  runSuite(opts: SuiteOptions): Promise<SuiteResult>;
  checkDeterminism(ep: Episode): Promise<VerifyResult>;
  checkPolicyDeterminism(driverSpec: DriverSpec, seat: Seat): Promise<boolean>;
}
export type CreateHarnessApi = (deps: {
  createEngine: CreatePhysicsEngine; createRules: CreateCombatRules; createSeatDriver: CreateSeatDriver | CreateInProcessSeatDriver;
  observations: ObservationBuilder; runner: HeadlessMatchRunner; store: EpisodeStore; entrants: EntrantStore;
}) => HarnessApi;

/* ───────────────────────── UI store, HUD frame, settings (WP1) ───────────────────────── */
export type Screen = "boot" | "title" | "green_room" | "entrants" | "lab" | "replays" | "replay_viewer" | "settings" | "match" | "post_match" | "tutorial" | "cockpit_choice";
export type Overlay = null | "pause" | "click_to_fight" | "hold_guard";
export type TutorialStepId = "flick" | "reach" | "hook" | "guard" | "dock" | "calibrated";   // GAME_DESIGN 7.3.9 (1, 1b, 2, 3, 4, stamp)
export interface BestScoreTile { label: "HARDEST HIT" | "FASTEST STRIKE" | "OBJECTIVE"; seat: Seat; value: string; detail: string; }
export interface UiState {
  screen: Screen; overlay: Overlay; phase: MatchPhase;
  loading: { progress: number; label: string } | null;      // boot stages, driven by real work (7.3.1)
  match: MatchConfig | null; round: number; roundsWon: Record<Seat, number>;
  captions: Caption | null;                                  // one host line at a time (announcer, WP3)
  bestScore: BestScoreTile[] | null;                         // round_summary strip (7.4.3)
  lastEpisodeId: string | null; lastStats: EpisodeStats | null;   // set by the director when a recorded match is saved
  replayMomentLabel: string | null;                          // e.g. "IMPACT 2.7 m/s · 31"
  holdSkipProgress: number;                                  // 0..1 (2.2)
  lockHoldRemainingMs: number | null;                        // pointer-lock hold rule
  tutorialStep: TutorialStepId | null;                       // Calibration step in progress (tutorial context only)
  error: string | null;
}
export interface UiStore {
  get(): Readonly<UiState>;
  set(patch: Partial<UiState>): void;
  subscribe(fn: () => void): () => void;                    // useSyncExternalStore-compatible
}
export interface HudSeat {
  name: string; integrity: number; integrityMax: number; heat: number;
  servoState: ServoStateId; stateRemaining01: number; charge: number; charging: boolean; guard: boolean; overdrive: boolean;
  abilityId: AbilityId; abilityCharges: number; abilityMaxCharges: number; abilityCooldown01: number; abilityActive: boolean;
  grip: "open" | "closed"; roundsWon: number; lowIntegrity: boolean; struckLink: LinkId | null; struckAgeMs: number;
  policy: { label: string; hz: number; computeMs: number; status: ActionStatus; faults: number; tier?: TierId | "sparring" | null } | null;
}
export interface HudFrame {
  phase: MatchPhase; round: number; bestOf: number; finalRound: boolean; suddenDeath: boolean;
  timeLeftS: number; playerSeat: Seat | null; preset: MatchPreset; showKit: boolean; showPolicyUi: boolean;
  seats: Record<Seat, HudSeat>;
  core: { visible: boolean; owner: Seat | null; remainingS: number; contested: boolean; loose: boolean; worldPos: Vec3 };
  reticle: { visible: boolean; ghostTipWorld: Vec3; physicalTipWorld: Vec3; reach01: number; leashStretch: number;
             guard: boolean; deflectLocked: boolean; rangeCue: RangeCue; matchesPlayed: number };
  juice: JuiceOutput;
  hitstop: { remainingMs: number; budgetUsedMs: number };
}
export interface Settings {
  controls: { sensitivity: number; verticalMul: number; invertY: boolean; padDeadzone: number; bindings: Record<string, string>;
              touch: { mode: "auto" | "on" | "off"; stickRadiusPx: number; opacity01: number } };
  camera: { cockpit: "standard" | "stable"; fovDeg: number; motion01: number; ghostOpacity01: number };
  audio: { master: number; sfx: number; music: number; crowd: number; voice: number; captions: "full" | "big" | "off"; hostVoice: boolean };
  video: { quality: "auto" | "high" | "default" | "low"; effects01: number; damageNumbers: "on" | "merged" | "off" };
  show: { fast: "auto" | "on" | "off" };
  access: { colorblind: boolean; reducedMotion: boolean; captionScale: number };
  profile: { callsign: string; tutorialDone: boolean; cockpitChosen: boolean; matchesPlayed: number };
  /** EMOTION_BIBLE 9: consent and share settings (WP8 settings.ts owns the logic; WP6/WP7 render the strip). */
  data: {
    pilotId: string;                                        // random, resettable only after DELETE MY DATA is acknowledged
    consent: SessionMeta["consent"];
    shareUrl: boolean;                                      // Bout Card carries a URL only when on
    deleteAckedAt: string | null;                           // ISO time the delete was acknowledged; gates RESET PILOT ID
    stripShownMatches: number[];                            // matchesPlayed values at which the consent strip was shown
    sessionIndex: number; matchIndexInSession: number; sessionStartedAt: string | null;
  };
}
export interface SettingsStore { get(): Readonly<Settings>; set(patch: DeepPartial<Settings>): void; subscribe(fn: () => void): () => void; }
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/* ───────────────────────── director + game handle (WP1) ───────────────────────── */
export type CameraMode = "cockpit" | "broadcast" | "intro" | "replay" | "lobby" | "lab_overview" | "outro";
export interface MatchDirector {
  readonly phase: MatchPhase;
  readonly config: MatchConfig | null;
  readonly cameraMode: CameraMode;
  readonly cameraSeat: Seat;
  readonly phaseElapsedMs: number;
  enterTitle(): void;
  enterGreenRoom(): void;
  setLobbyLoadout(id: LoadoutId): void;                      // LOADOUT picker: retunes the green room arm live
  startMatch(cfg: MatchConfig): Promise<void>;              // quick fight, warm up, tutorial (cfg.tutorial), Lab runs
  rematch(): Promise<void>;
  pause(): void; resume(): void; forfeitRound(): void; quitToGreenRoom(): void;
  onPointerLockChange(locked: boolean): void;               // pause or hold rule (7.3.10)
  skip(): void;                                             // skips the current skippable phase
  setHoldSkip(held: boolean): void;                         // 400 ms hold skips the between-round chain
  skipTutorial(): void;                                     // Esc → SKIP: lands in the BACKLASH Rookie best-of-1 (7.3.9)
  openReplay(episodeId: string): Promise<void>;             // saves live SimState first; restores on exit
  closeReplay(): void;
}
export interface GameView { camera: PerspectiveCamera | null; canvas: HTMLCanvasElement | null; lastPose: CameraPose | null; }
export interface GameHandle {
  readonly engine: PhysicsEngine; readonly rules: CombatRules; readonly kinematics: So101Kinematics;
  readonly clock: GameClock; readonly director: MatchDirector; readonly bus: EventBus;
  readonly pilot: PilotController; readonly cockpit: CockpitRig; readonly feedback: FeedbackSystem;
  readonly harness: HarnessApi; readonly observations: ObservationBuilder; readonly createSeatDriver: CreateSeatDriver;
  readonly ui: UiStore; readonly settings: SettingsStore; readonly hud: HudFrame;
  readonly view: GameView;                                  // WP6 writes camera/canvas/lastPose
  readonly replay: ReplayPlayer;
  readonly runRegistration: RunRegistration;                // WP4, used by register-entrant.tsx
  readonly probeBridge: ProbeBridge;                        // WP4, used by the entrants bridge card and the Lab
  frameTick(wallDtS: number): void;                         // WP6 calls at useFrame priority −2
  onAfterRender(fn: () => void): () => void;                // WP7 hud-runtime registers
  runAfterRender(): void;                                   // WP6 calls at useFrame priority +2, after the composer
}

/* ───────────────────────── show contracts (EMOTION_BIBLE 11.9, Phase 0) ───────────────────────── */
/** Render structure. WP1 sets it on the arms; WP2 on the LED line and cubes; WP5 on the hit light. */
export const REFLECTION_LAYER = 5;
export interface LodGeometries { lod0: BufferGeometry; lod1: BufferGeometry }  // per (link, slot), from robot-assets (WP1)

/** Per-render-frame feel state, written by WP5 feedback-system, read by WP1 robot-view/post-stack and WP3 juice. */
export interface FeedbackFrame {
  vibration: { atlas: number; blaze: number };   // mm of render-only link vibration remaining (0..1.5): victim flinch, pilot tremor + heat
  impactFrame: number;                            // 0..1, GradeEffect uImpact, 2 frames then 0.5
  lensSmear: number;                              // 0..1, screen-space smear opacity, τ 6 s
  ledFlare: { atlas: LinkId | null; blaze: LinkId | null };  // link flashing white, 250 ms
  deckFlash: { seat: Seat | null; ms: number };   // edge strip flood
  hitLight: { on: boolean; seat: Seat; ms: number }; // PointLight intensity pulse (light stays mounted)
  hypeLean: number;                               // -1..1 from hype.ts, drives crowd tint above 80
}

/** Pilot LED state machine (WP3) → per-link LED uniform (WP2 robot-materials). */
export type LedState = "off" | "boot" | "lowered" | "ready" | "commit" | "guard" | "grip" | "hot" | "stagger" | "shorted";
export interface LedFrame { state: LedState; intensity: number; colour: [number, number, number]; perLink: Float32Array /* 8 × (r,g,b,i) */ }

/** Opponent affect, published at 10 Hz by WP4 mind.ts through the policy status channel; read by WP8 audio and WP7 hosts. */
export interface OpponentAffect { arousal: number; valence: number; stance: number; composure: number; menace: number }

/** Opponent memory: main thread (WP6 profile.ts) owns it, passes it in ResetContext; recorder stamps it; WP4 reads ctx only; HARNESS passes {}. */
export interface OpponentMemory { bestMove: string | null; hurtSide: -1 | 0 | 1; timeToFirstAttackS: number | null; feintsWorked: number; grudge: number }
/** The "nothing remembered" value: what a fresh profile and the HARNESS preset pass. */
export const EMPTY_OPPONENT_MEMORY: Readonly<OpponentMemory> = { bestMove: null, hurtSide: 0, timeToFirstAttackS: null, feintsWorked: 0, grudge: 0 };

/** New show events on the bus (WP4 emits the first six, WP5 the rest). Captions, audio and VFX subscribe. No twist event. */
export type ShowEvent =
  | { kind: "tell"; seat: Seat; primitive: "poke" | "jab" | "hook" | "slam" | "grab" | "feint"; ms: number }
  | { kind: "flinch"; seat: Seat; m: number }
  | { kind: "taunt" | "celebrate" | "dejected" | "curious" | "fear"; seat: Seat; variant: number }
  | { kind: "backstage"; seat: Seat; ms: number }
  | { kind: "open"; seat: Seat; ms: number }       // whiff recovery window
  | { kind: "whip" | "punish" | "late_guard"; seat: Seat }
  | { kind: "near_ko"; seat: Seat; u: number }
  | { kind: "steal_contact"; owner: Seat }
  | { kind: "cube_off_deck"; count: number }
  | { kind: "tutorial_step"; step: "hit" | "guard" | "grab" | "dock" | "hold"; done: boolean; capped: boolean };

/** Reticle range state, WP3 → WP7 crosshair. */
export interface ReticleState { fill: number /* 0..1 sweet band */; inRange: boolean; magnetism: number }

/** Every VFX pool (WP5) and set piece (WP2) exposes this so WP1 prewarm can draw it once. */
export interface Prewarmable { prewarmDraw(): void }

/** Episode /4 additions (WP8). Other packages never write these. No exact device numbers: this block must not fingerprint. */
export interface SessionMeta {
  pilotId: string; callsign: string;
  consent: { version: string; grantedAt: string | null; scope: "local" | "share"; decisionMs: number | null; inputMethod: "pointer" | "keyboard" | null };
  device: { input: "mouse" | "gamepad" | "touch"; pointerLock: boolean; viewportBucket: "≤720p" | "1080p" | "1440p" | ">1440p"; dpr: number /* to 0.5 */; fpsP50: number /* to 5 */; fpsP95: number; gpuTier: "apple" | "integrated" | "discrete" | "unknown"; mouseSensitivity: number; invertY: boolean; gamepadDeadzone: number };
  build: { gitSha: string; appVersion: string; form: "web" | "pwa" | "electron" | "capacitor"; inputMappingSha: string };
  sessionIndex: number; matchIndexInSession: number; skillPrior: 0 | 1 | 2 | 3 | 4 | null;
}
export interface QualityMeta { clean: boolean; tier: "A" | "B" | "C" | "D"; version: number; reasons: string[] }

/* ───────────────────────── brand (WP7) ───────────────────────── */
export type TokenColor = "ink" | "paper" | "signal" | "volt" | "cobalt" | "magenta" | "strike" | "crit" | "block";
export const TOKEN_HEX: Readonly<Record<TokenColor, string>> = {
  ink: "#0E0F14", paper: "#F6F3EC", signal: "#FF4A1C", volt: "#FFD60A", cobalt: "#2A6BFF",
  magenta: "#FF2E7E", strike: "#FFF36B", crit: "#B6FF2E", block: "#3DE0FF",
};
export type BrandMarkId = "torqueLimit" | "needle" | "ohmstead" | "pulpoPop" | "bit";
export interface BrandMark { viewBox: string; paths: { d: string; fill: TokenColor; stroke?: TokenColor; strokeWidth?: number }[]; }
export interface HostProfile { id: HostId; tag: "ROOK" | "DR. VALE"; role: "hype" | "analyst"; lip: TokenColor; speech: { pitch: number; rate: number; preferredVoiceNames: readonly string[] }; }
