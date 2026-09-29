// src/game/render/vfx/vfx-system.ts (WP5)
// The VFX system (GAME_DESIGN 6.8, 8.1 world channel V, SCOPE 1.2): subscribes itself to the game bus in
// its factory, turns GameEvents into pooled effects, and owns the stage cue envelopes, the KO de-rez
// timeline, the round re-render scan, and the pooled hit light. Everything lives in one sim-space group
// mounted under the world root. Everything is additive HDR light against the night arena and scales with hit
// strength: every scoring strike pops a white-hot contact flash with streaking sparks; heavy hits add a star
// flare, a shockwave racing across the deck, hot debris and electric arcs jumping down the victim's arm;
// deflects burst in a bright blue ring; clashes crackle with arcs between both grippers. The Core arrives down
// a column of volt light and lands with a deck ring; ENGAGE slams the stage lights on with a deck-wide ring.
// The KO: a white flash, a slow-motion window on the VFX clock, arcs shorting out the loser, then at settle a
// team-colour shatter, the winner's rings, and confetti cannons from the four stage corners.
// Particle physics runs on a VFX clock that freezes during hit stop and pause (and slows through the KO window);
// flash envelopes and cues run on wall time. Nothing here writes to MuJoCo or allocates per frame.
// Particle counts scale with the quality tier (its confetti budget over the pool size, per GAME_DESIGN 8.1).
import { Group, PointLight } from "three";
import {
  REFLECTION_LAYER, SEATS, TOKEN_HEX,
  type CombatSnapshot, type EventBus, type GameClock, type GameEvent, type MatchPhase, type PhysicsFrame, type Prewarmable, type Seat,
  type SettingsStore,
  CORE_CUBE_INDEX,
} from "../../contracts.ts";
import { teamHex } from "../robot-materials.ts";
import { createArcPool, type ArcPool } from "./arcs.ts";
import { createBurstPool, type BurstPool } from "./bursts.ts";
import { CHIP_POOL, createChipPool, type ChipPool } from "./chips.ts";
import { createCoreBeam, type CoreBeam } from "./core-beam.ts";
import { createCoreFace, type CoreFace } from "./core-face.ts";
import { CONFETTI_POOL, createConfettiPool, type ConfettiPool } from "./confetti.ts";
import { createScuffDecals, type ScuffDecals } from "./decals.ts";
import { createDerezTimeline, type DerezTimeline } from "./derez.ts";
import { createHaze, HAZE_HEAT_THRESHOLD, type HazeSprites } from "./haze.ts";
import { createLockPulse, type LockPulse } from "./lock-pulse.ts";
import { createPrizeBurst, type PrizeBurst } from "./prize-burst.ts";
import { createRerenderScan, type RerenderScan } from "./rerender-scan.ts";
import { createRipplePool, type RipplePool } from "./ripples.ts";
import { createSmearRibbons, type SmearRibbons } from "./smears.ts";
import { SPARK_REST_S, createStreakPool, createVfxRandom, linearColor, sparkCount, spreadDirection, type StreakPool } from "./sparks.ts";
import { createStageCues, type StageCues } from "./stage-cues.ts";

export interface VfxSystemDeps {
  bus: EventBus;
  clock: GameClock;
  settings: SettingsStore;
  frame: () => PhysicsFrame;
  combat: () => CombatSnapshot | null;
  phase: () => MatchPhase;
  /** Wall clock in ms (defaults to performance.now); events are stamped with it when the bus delivers them. */
  nowMs?: () => number;
}

export interface VfxPoolStats {
  sparks: { capacity: number; active: number; recycled: number };
  bursts: { capacity: number; active: number; recycled: number };
  arcs: { capacity: number; active: number; recycled: number };
  ripples: { capacity: number; active: number; recycled: number };
  chips: { capacity: number; active: number; recycled: number };
  confetti: { capacity: number; active: number; recycled: number };
  prizeCubes: { capacity: number; active: number; recycled: number };
  prizeBills: { capacity: number; active: number; recycled: number };
  decals: { capacity: number; active: number };
}

export interface VfxSystem extends Prewarmable {
  /** Sim-space group: mount under the world root. */
  readonly group: Group;
  readonly hitLight: PointLight;
  readonly cues: StageCues;
  readonly derez: DerezTimeline;
  readonly sparks: StreakPool;
  readonly bursts: BurstPool;
  readonly arcs: ArcPool;
  readonly ripples: RipplePool;
  readonly chips: ChipPool;
  readonly confetti: ConfettiPool;
  readonly prize: PrizeBurst;
  readonly decals: ScuffDecals;
  readonly smears: SmearRibbons;
  readonly haze: HazeSprites;
  readonly lockPulse: LockPulse;
  readonly scan: RerenderScan;
  readonly coreBeam: CoreBeam;
  readonly coreFace: CoreFace;
  /** Render-space Y of the re-render scan for the arm shaders (1e3 when idle). */
  readonly scanRenderY: number;
  /** KO white flash 0..1 (wall time) for the post stack's exposure punch. */
  readonly koFlash: number;
  /** VFX clock (s): wall time excluding hit stop and pause, slowed through the KO window. */
  readonly nowS: number;
  /** Handles a batch of events (the bus subscription calls this; debug scenes call it directly). */
  handle(events: readonly GameEvent[], playerSeat: Seat | null): void;
  /**
   * Per render frame. `cameraSim` / `forwardSim` are the camera position and view direction in sim space
   * (confetti origin); `confettiCount` comes from the quality tier.
   */
  update(wallDtS: number, wallNowMs: number, cameraSim: ArrayLike<number>, forwardSim: ArrayLike<number>, confettiCount: number): void;
  stats(): VfxPoolStats;
  dispose(): void;
}

const HIT_LIGHT_MS = 90;
/** Hit light peak scales with strike magnitude: 1.5 + 3·m (crits and clashes at the top). */
const HIT_LIGHT_BASE = 1.5;
const HIT_LIGHT_GAIN = 3;
const KO_LIGHT_PEAK = 9;
const KO_LIGHT_RANGE_M = 1.6;
const LOW_INTEGRITY = 25;
const LOW_SPARK_INTERVAL_S = 0.6;
const HIT_LIGHT_RANGE_M = 0.7;
/** ENGAGE: the hit light doubles as an overhead key punch over the contest centre. */
const SLAM_LIGHT_PEAK = 3.2;
const SLAM_LIGHT_RANGE_M = 2.4;
const SLAM_LIGHT_Z_M = 0.55;
/** The Core counts as landed when its centre drops below this (resting centre is 0.0205 m). */
const CORE_LANDED_Z_M = 0.03;
const CORE_LAND_TIMEOUT_S = 1.5;
const PARKED_X_M = 1.5;
/** Heavy strikes (arcs, debris, attacker ring) from this magnitude up, and every crit. */
const ARC_MAGNITUDE = 0.6;
/** Confetti cannon corners (sim m): the four deck corners, just outside the LED edge. */
const CANNON_X_M = 0.56;
const CANNON_Y_M = 0.36;
/** Share of the tier's confetti budget each of the four KO cannons fires. */
const CANNON_SHARE = 0.2;

export function createVfxSystem(deps: VfxSystemDeps): VfxSystem {
  const group = new Group();
  group.name = "vfx";
  const sparks = createStreakPool();
  const bursts = createBurstPool();
  const arcs = createArcPool();
  const ripples = createRipplePool();
  // Hot debris: the flakes glow (emissive) so they read as sparks of shell against the night deck.
  const chips = createChipPool(CHIP_POOL, { emissive: 1.6 });
  const confetti = createConfettiPool();
  const prize = createPrizeBurst();
  const decals = createScuffDecals();
  const smears = createSmearRibbons();
  const haze = createHaze();
  const lockPulse = createLockPulse();
  const scan = createRerenderScan();
  const cues = createStageCues();
  const derez = createDerezTimeline();
  const coreBeam = createCoreBeam();
  const coreFace = createCoreFace();
  group.add(coreBeam.ring, coreBeam.column, coreFace.mesh);
  group.add(
    decals.mesh, lockPulse.mesh, smears.mesh, ripples.mesh, sparks.mesh, arcs.mesh, bursts.mesh, chips.mesh,
    prize.cubes.mesh, prize.bills.mesh, confetti.mesh, haze.mesh, scan.mesh,
  );
  const hitLight = new PointLight(0xffffff, 0, HIT_LIGHT_RANGE_M, 2);
  hitLight.name = "hit-light";
  hitLight.castShadow = false;
  hitLight.layers.enable(REFLECTION_LAYER);                 // 11.9: the hit pulse shows in the deck reflection too
  group.add(hitLight);

  const now = deps.nowMs ?? (() => performance.now());
  const rand = createVfxRandom(0x5a17);
  const dir = new Float64Array(3);
  let nowS = 0;
  let wallMs = 0;
  let hitLightAtMs = -1;
  let hitLightPeak = HIT_LIGHT_BASE;
  let koFlash = 0;
  /** Quality-tier particle scale (tier confetti budget / pool), last seen in update(). */
  let tierScale = 1;
  let scanRenderY = 1e3;
  let pendingConfetti = 0;
  let playerSeatLast: Seat | null = null;
  let matchWonBy: Seat | null = null;    // confetti only on a match win (EMOTION_BIBLE 6, KO row)
  let slamFired = false;
  let coreLandBy = -1;              // VFX-clock deadline while waiting for the dropped Core to touch the mat
  let beamX = 0, beamY = 0;
  const nextLowSpark: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const bulwark: Record<Seat, boolean> = { atlas: false, blaze: false };
  let colorblind = deps.settings.get().access.colorblind;
  let reducedMotion = deps.settings.get().access.reducedMotion;
  cues.setColorblind(colorblind);
  const unsubscribeSettings = deps.settings.subscribe(() => {
    colorblind = deps.settings.get().access.colorblind;
    reducedMotion = deps.settings.get().access.reducedMotion;
    cues.setColorblind(colorblind);
  });

  const flashLight = (x: number, y: number, z: number, hex: string, peak = HIT_LIGHT_BASE + HIT_LIGHT_GAIN, range = HIT_LIGHT_RANGE_M) => {
    hitLight.position.set(x, y, z);
    hitLight.distance = range;
    hitLight.color.copy(linearColor(hex));
    hitLightPeak = peak;
    hitLightAtMs = wallMs;
  };
  /** Tier-scaled particle count (never below one). */
  const budget = (n: number) => Math.max(1, Math.round(n * tierScale));
  /** `n` arcs fanning from A to B. */
  const arcBetween = (n: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, life: number, hex: string, intensity?: number) => {
    for (let i = 0; i < n; i++) arcs.spawn(nowS, ax, ay, az, bx, by, bz, life * (0.8 + rand() * 0.4), hex, intensity);
  };

  const strikeSparks = (e: Extract<GameEvent, { type: "strike" }>) => {
    const [px, py, pz] = e.pos;
    // Sparks fly off the victim along the contact normal (normal points atlas → blaze).
    const sgn = e.victim === "blaze" ? 1 : -1;
    const nx = e.normal[0] * sgn, ny = e.normal[1] * sgn, nz = e.normal[2] * sgn;
    if (e.tier === "graze") {
      bursts.spawn(nowS, "flash", px, py, pz, { scale: 0.45, intensity: 5 });
      for (let i = 0; i < 4; i++) {
        spreadDirection(nx, ny, nz + 0.2, 0.9, rand, dir);
        const sp = 0.6 + rand() * 0.5;
        sparks.spawn(nowS, px, py, pz, dir[0] * sp, dir[1] * sp, dir[2] * sp, 0.14, "graze");
      }
      return;
    }
    if (e.guarded) {
      ripples.spawn(nowS, px, py, pz, -nx, -ny, -nz);
      bursts.spawn(nowS, "flash", px, py, pz, { scale: 0.6, hex: TOKEN_HEX.block, intensity: 6 });
      for (let i = 0; i < budget(6); i++) {
        spreadDirection(nx, ny, nz + 0.3, 1.1, rand, dir);
        const sp = 0.5 + rand() * 0.6;
        sparks.spawn(nowS, px, py, pz, dir[0] * sp, dir[1] * sp, dir[2] * sp, 0.18, "team", 0.8);
      }
      return;
    }
    const m = Math.max(0, Math.min(1, e.magnitude));
    const heavy = e.crit || m >= ARC_MAGNITUDE;
    const big = e.crit ? 1.35 : 1;
    const team = teamHex(e.attacker, colorblind);
    // Every scoring strike: a white-hot contact flash over a lingering hot glow, and streaking sparks.
    bursts.spawn(nowS, "flash", px, py, pz, { scale: (0.85 + m * 0.9) * big });
    bursts.spawn(nowS, "glow", px, py, pz, { scale: (0.45 + m * 0.5) * big, intensity: 0.8 + m * 1.2 });
    // Sparks that land and stay: each one that reaches the deck inside its flight glows there for 10 s.
    const n = budget(sparkCount(m, e.crit));
    for (let i = 0; i < n; i++) {
      spreadDirection(nx, ny, nz + 0.25, 1.25, rand, dir);
      const sp = (0.8 + rand() * 1.6) * (0.7 + m * 1.0) * big;
      sparks.spawn(nowS, px, py, pz, dir[0] * sp, dir[1] * sp, dir[2] * sp, 0.2 + rand() * 0.2, "hit", big, SPARK_REST_S);
    }
    if (e.thrownCube >= 0) {
      // A thrown cube connecting: edge glints off the cube itself, not the arm.
      const ci = e.thrownCube * 3;
      const cf = deps.frame().cubes.pos;
      for (let i = 0; i < 4; i++) {
        bursts.spawn(nowS, "glow", cf[ci] + (rand() - 0.5) * 0.03, cf[ci + 1] + (rand() - 0.5) * 0.03, cf[ci + 2] + (rand() - 0.5) * 0.03, { scale: 0.18, intensity: 2.5 });
      }
    }
    if (m >= 0.4 || e.crit) {
      // Heavy enough to see across the arena: a star flare and a shockwave racing out across the deck.
      bursts.spawn(nowS, "star", px, py, pz, { scale: (0.6 + m * 0.6) * big, rotation: rand() * 0.8 });
      bursts.spawn(nowS, "deck_ring", px, py, 0.003, { scale: (0.5 + m * 0.8) * big, hex: e.crit ? TOKEN_HEX.volt : "#FFFFFF" });
    }
    if (heavy) {
      // A ring in the attacker's colour, hot debris knocked off the victim's shell, and arcs jumping from the
      // attacker's gripper through the contact and down the victim's arm.
      bursts.spawn(nowS, "clash_ring", px, py, pz, { hex: team, scale: e.crit ? 1.1 : 0.8 });
      const flakes = budget(e.crit ? 7 : 3 + Math.round((m - ARC_MAGNITUDE) * 8));
      for (let i = 0; i < flakes; i++) {
        spreadDirection(nx, ny, nz + 0.6, 1.0, rand, dir);
        const sp = 0.6 + rand() * 0.8;
        chips.spawn(nowS, px, py, pz, dir[0] * sp, dir[1] * sp, dir[2] * sp + 0.5, i % 3 === 0 ? TOKEN_HEX.signal : i % 3 === 1 ? team : TOKEN_HEX.paper);
      }
      const f = deps.frame();
      const att = f.arms[e.attacker], vic = f.arms[e.victim];
      arcBetween(1, att.eePos[0], att.eePos[1], att.eePos[2], px, py, pz, 0.18, team);
      arcBetween(e.crit ? 2 : 1, px, py, pz, vic.wristPos[0], vic.wristPos[1], vic.wristPos[2], 0.22, team);
      if (e.crit) arcBetween(1, vic.wristPos[0], vic.wristPos[1], vic.wristPos[2], vic.elbowPos[0], vic.elbowPos[1], vic.elbowPos[2], 0.26, team);
    }
    if (m >= 0.3 || e.crit) flashLight(px, py, pz, "#FFFFFF", HIT_LIGHT_BASE + HIT_LIGHT_GAIN * (e.crit ? 1 : m));
    if (pz <= 0.02) decals.add(px, py, pz, Math.atan2(ny, nx), m);
  };

  /** The lethal hit: white flash, the loser shorting out, a big ring on the deck. The slow-mo is derez's. */
  const koImpact = (victim: Seat) => {
    const arm = deps.frame().arms[victim];
    const hex = teamHex(victim, colorblind);
    const [x, y, z] = arm.eePos;
    const flash = reducedMotion ? 0.5 : 1;
    bursts.spawn(nowS, "flash", x, y, z, { scale: 1.6 * flash, lifeScale: 1.8 });
    bursts.spawn(nowS, "star", x, y, z, { scale: 1.3 * flash, lifeScale: 1.6 });
    bursts.spawn(nowS, "glow", x, y, z, { scale: 1.3, hex, lifeScale: 2, intensity: 1.6 });
    bursts.spawn(nowS, "deck_ring", arm.shoulderPos[0], arm.shoulderPos[1], 0.003, { scale: 1.5, lifeScale: 1.4 });
    arcBetween(2, arm.shoulderPos[0], arm.shoulderPos[1], arm.shoulderPos[2], arm.elbowPos[0], arm.elbowPos[1], arm.elbowPos[2], 0.5, hex, 9);
    arcBetween(2, arm.elbowPos[0], arm.elbowPos[1], arm.elbowPos[2], arm.wristPos[0], arm.wristPos[1], arm.wristPos[2], 0.5, hex, 9);
    arcBetween(1, arm.wristPos[0], arm.wristPos[1], arm.wristPos[2], x, y, z, 0.45, "#FFFFFF", 9);
    for (let i = 0; i < budget(40); i++) {
      spreadDirection(0, 0, 1, 1.6, rand, dir);
      const sp = 0.8 + rand() * 1.8;
      sparks.spawn(nowS, x, y, z, dir[0] * sp, dir[1] * sp, dir[2] * sp, 0.3 + rand() * 0.3, "hit", 1.3);
    }
    flashLight(x, y, z + 0.1, "#FFFFFF", KO_LIGHT_PEAK * flash, KO_LIGHT_RANGE_M);
  };

  /** The de-rez shatter at settle: team-colour cubes and shards, the winner's rings; confetti cannons on a match win only. */
  const koShatter = (loser: Seat, confettiCount: number) => {
    const arm = deps.frame().arms[loser];
    const hex = teamHex(loser, colorblind);
    const winner: Seat = loser === "atlas" ? "blaze" : "atlas";
    const winHex = teamHex(winner, colorblind);
    const [sx, sy] = arm.shoulderPos;
    const mid = Math.max(0.08, arm.eePos[2]);
    prize.derezBurst(nowS, sx, sy, 0.02, mid, hex);
    for (let i = 0; i < budget(18); i++) {
      spreadDirection(0, 0, 1, 1.5, rand, dir);
      const sp = 0.5 + rand() * 0.9;
      chips.spawn(nowS, sx, sy, 0.02 + (mid - 0.02) * rand(), dir[0] * sp, dir[1] * sp, dir[2] * sp + 0.4, i % 4 === 3 ? "#FFFFFF" : hex, 1.4);
    }
    bursts.spawn(nowS, "deck_ring", sx, sy, 0.003, { hex, scale: 1.8, lifeScale: 1.3 });
    bursts.spawn(nowS, "shockwave", sx, sy, mid, { hex: winHex, scale: 1.4 });
    bursts.spawn(nowS, "clash_ring", sx, sy, mid, { hex: winHex, scale: 2.4 });
    bursts.spawn(nowS, "flash", sx, sy, mid, { scale: 1.3, hex: winHex });
    flashLight(sx, sy, mid + 0.1, winHex, KO_LIGHT_PEAK * 0.6, KO_LIGHT_RANGE_M);
    // Cannons from the four corners, up and in over the deck, in the winner's colour with volt and paper: only when
    // this KO won the match, and never for the AI beating the pilot (8.4: a loss is not a show).
    if (matchWonBy !== winner || (playerSeatLast !== null && winner !== playerSeatLast)) return;
    const per = Math.round(confettiCount * CANNON_SHARE);
    cannonPalette[0] = winHex; cannonPalette[1] = winHex;
    for (let c = 0; c < 4; c++) {
      const cx = c < 2 ? -CANNON_X_M : CANNON_X_M, cy = c % 2 === 0 ? -CANNON_Y_M : CANNON_Y_M;
      const l = Math.hypot(cx * 0.5, cy * 0.5, 1.2);
      confetti.cannon(nowS, per, cx, cy, 0.03, -cx * 0.5 / l, -cy * 0.5 / l, 1.2 / l, cannonPalette);
      bursts.spawn(nowS, "flash", cx, cy, 0.05, { scale: 1.2, hex: TOKEN_HEX.volt });
    }
  };
  const cannonPalette: string[] = ["", "", TOKEN_HEX.volt, TOKEN_HEX.paper, TOKEN_HEX.signal];

  const handleOne = (e: GameEvent, playerSeat: Seat | null) => {
    cues.handle(e, playerSeat, wallMs);
    switch (e.type) {
      case "contact":
        for (let i = 0; i < 4; i++) {
          bursts.spawn(nowS, "puff", e.pos[0] + (rand() - 0.5) * 0.012, e.pos[1] + (rand() - 0.5) * 0.012, e.pos[2], { scale: 0.7 + e.magnitude * 0.6, rotation: rand() * 6.28 });
        }
        break;
      case "table_hit":
        for (let i = 0; i < 3; i++) bursts.spawn(nowS, "puff", e.pos[0] + (rand() - 0.5) * 0.02, e.pos[1] + (rand() - 0.5) * 0.02, 0.004, { scale: 1.1 });
        break;
      case "strike":
        strikeSparks(e);
        break;
      case "deflect": {
        const [px, py, pz] = e.pos;
        // A bright blue ring burst: chevrons, a ring, a blue flash and a fan of blue streaks.
        bursts.spawn(nowS, "chevron", px, py, pz, { rotation: rand() * 1.05, scale: 1.2 });
        bursts.spawn(nowS, "clash_ring", px, py, pz, { hex: TOKEN_HEX.block, scale: 1.4 });
        bursts.spawn(nowS, "flash", px, py, pz, { hex: TOKEN_HEX.block, scale: 1.2 });
        bursts.spawn(nowS, "glow", px, py, pz, { hex: TOKEN_HEX.block, scale: 1.2, intensity: 3 });
        for (let i = 0; i < budget(16); i++) {
          spreadDirection(e.normal[0], e.normal[1], e.normal[2] + 0.2, 2.2, rand, dir);
          const sp = 1.0 + rand() * 1.2;
          sparks.spawn(nowS, px, py, pz, dir[0] * sp, dir[1] * sp, dir[2] * sp, 0.22 + rand() * 0.12, "deflect");
        }
        flashLight(px, py, pz, TOKEN_HEX.block);
        break;
      }
      case "clash": {
        const [px, py, pz] = e.pos;
        bursts.spawn(nowS, "clash_ring", px, py, pz, { scale: 1.3 });
        bursts.spawn(nowS, "star", px, py, pz, { scale: 1.1, rotation: rand() * 0.8 });
        bursts.spawn(nowS, "glow", px, py, pz, { hex: TOKEN_HEX.volt, scale: 1.2, intensity: 2.5 });
        // The two grippers crackle with arcs between them, in both team colours.
        const f = deps.frame();
        const a = f.arms.atlas.eePos, b = f.arms.blaze.eePos;
        arcBetween(1, a[0], a[1], a[2], b[0], b[1], b[2], 0.3, teamHex("atlas", colorblind));
        arcBetween(1, a[0], a[1], a[2], b[0], b[1], b[2], 0.3, teamHex("blaze", colorblind));
        arcBetween(1, a[0], a[1], a[2], b[0], b[1], b[2], 0.24, TOKEN_HEX.volt);
        for (let i = 0; i < budget(16); i++) {
          const a = (i / 16) * Math.PI * 2 + rand() * 0.2;
          // Radial fan perpendicular to the clash normal.
          spreadDirection(e.normal[0], e.normal[1], e.normal[2], 0, rand, dir);
          const tx = -dir[1], ty = dir[0];
          const tl = Math.hypot(tx, ty) || 1;
          const ux = tx / tl, uy = ty / tl;
          const sp = 1.1 + rand() * 0.6;
          sparks.spawn(nowS, px, py, pz, (ux * Math.cos(a)) * sp, (uy * Math.cos(a)) * sp, Math.sin(a) * sp, 0.25, "hit", 0.9);
        }
        flashLight(px, py, pz, "#FFFFFF");
        break;
      }
      case "charge":
        if (e.stage === "release") smears.force(e.seat === "atlas" ? 0 : 1);
        break;
      case "ability":
        if (e.ability === "bulwark") bulwark[e.seat] = e.phase === "start";
        break;
      case "ko":
        // Replays and repeat KOs leave the timeline alone; only a fresh KO goes off.
        if (derez.koAtMs(e.victim) < 0) {
          derez.onKo(e.victim, wallMs);
          if (derez.koAtMs(e.victim) >= 0) koImpact(e.victim);
        }
        break;
      case "core":
        if (e.stage === "drop") {
          coreLandBy = nowS + CORE_LAND_TIMEOUT_S;
        } else if (e.stage === "incoming") {
          beamX = 0; beamY = 0;
        }
        if (e.stage === "lock" && e.seat) {
          lockPulse.lock(e.seat === "atlas" ? 0 : 1, nowS);
          const f = deps.frame();
          const o = e.seat === "atlas" ? 0 : 3;
          bursts.spawn(nowS, "deck_ring", f.docks[o], f.docks[o + 1], 0.003, { scale: 0.9, hex: TOKEN_HEX.volt });
          if (playerSeat === null || e.seat === playerSeat) prize.fire(nowS, f.docks[o], f.docks[o + 1], 0.03, 26, 14);
        }
        break;
      case "match_end":
        matchWonBy = e.winner;
        if (playerSeat !== null && e.winner === playerSeat) {
          pendingConfetti = 1;
          const f = deps.frame();
          const o = e.winner === "atlas" ? 0 : 3;
          prize.fire(nowS, f.docks[o], f.docks[o + 1], 0.04, 40, 30, 1.2);
        }
        break;
      case "phase":
        derez.onPhase(e.phase, wallMs);
        if (e.phase === "round_intro" || e.phase === "rematch_intro" || e.phase === "match_intro" || e.phase === "green_room" || e.phase === "title") {
          coreLandBy = -1;
          matchWonBy = null;
          decals.clear(); lockPulse.clear(); smears.clear(); haze.clear(); arcs.clear(); bulwark.atlas = false; bulwark.blaze = false;
          if (e.phase !== "round_intro") { chips.clear(); prize.clear(); }
        }
        break;
      default:
        break;
    }
  };

  const system: VfxSystem = {
    group, hitLight, cues, derez, sparks, bursts, arcs, ripples, chips, confetti, prize, decals, smears, haze, lockPulse, scan, coreBeam, coreFace,
    get scanRenderY() { return scanRenderY; },
    get nowS() { return nowS; },
    get koFlash() { return koFlash; },
    handle(events, playerSeat) {
      playerSeatLast = playerSeat;
      wallMs = now();
      for (let i = 0; i < events.length; i++) handleOne(events[i], playerSeat);
    },
    update(wallDtS, wallNowMs, cameraSim, forwardSim, confettiCount) {
      wallMs = wallNowMs;
      tierScale = Math.min(1, confettiCount / CONFETTI_POOL);
      const frozen = deps.clock.hitstopRemainingMs > 0 || deps.clock.paused;
      if (!frozen) nowS += Math.min(wallDtS, 0.1) * derez.timeScale(wallMs);
      koFlash = reducedMotion ? derez.koFlash(wallMs) * 0.5 : derez.koFlash(wallMs);
      const frame = deps.frame();
      const combat = deps.combat();
      const phase = deps.phase();
      const fighting = phase === "fight" || phase === "sudden_death";

      // KO de-rez: settle detection from the loser's joint speeds.
      derez.update(wallMs, (seat) => {
        const qd = frame.arms[seat].qd;
        let m = 0;
        for (let j = 0; j < 5; j++) { const v = Math.abs(qd[j]); if (v > m) m = v; }
        return m;
      });
      const burstSeat = derez.takeBurst();
      if (burstSeat) koShatter(burstSeat, confettiCount);
      scanRenderY = scan.update(derez.scan(wallMs));

      // ENGAGE: a deck-wide ring from the contest centre as the stage lights slam on.
      const slam = cues.slam(wallMs);
      if (slam > 0 && !slamFired) {
        slamFired = true;
        bursts.spawn(nowS, "deck_ring", 0, 0, 0.003, { scale: 3.2, hex: "#FFFFFF", lifeScale: 1.5 });
        bursts.spawn(nowS, "deck_ring", 0, 0, 0.003, { scale: 1.8, hex: TOKEN_HEX.volt, lifeScale: 1.2 });
      } else if (slam <= 0) {
        slamFired = false;
      }

      // Hit light envelope (wall time): up in 20 ms, down by 90 ms (stretched 3x for KO-strength peaks).
      // Idle, it carries the ENGAGE slam.
      if (hitLightAtMs >= 0) {
        const t = wallMs - hitLightAtMs;
        const len = hitLightPeak > HIT_LIGHT_BASE + HIT_LIGHT_GAIN ? HIT_LIGHT_MS * 3 : HIT_LIGHT_MS;
        hitLight.intensity = t < 20 ? hitLightPeak * (t / 20) : t < len ? hitLightPeak * (1 - (t - 20) / (len - 20)) : 0;
        if (t >= len) hitLightAtMs = -1;
      } else if (slam > 0) {
        hitLight.position.set(0, 0, SLAM_LIGHT_Z_M);
        hitLight.distance = SLAM_LIGHT_RANGE_M;
        hitLight.color.setRGB(1, 1, 1);
        hitLight.intensity = SLAM_LIGHT_PEAK * slam;
      } else {
        hitLight.intensity = 0;
      }

      // The Core: a light column telegraphs the drop point, and the landing is marked the frame the
      // physical Core first touches the mat (a missed landing just times out quietly).
      const ci = CORE_CUBE_INDEX * 3;
      const coreX = frame.cubes.pos[ci], coreY = frame.cubes.pos[ci + 1], coreZ = frame.cubes.pos[ci + 2];
      if (coreLandBy >= 0) {
        if (coreX < PARKED_X_M) { beamX = coreX; beamY = coreY; }
        if (coreX < PARKED_X_M && coreZ < CORE_LANDED_Z_M) {
          coreLandBy = -1;
          bursts.spawn(nowS, "deck_ring", coreX, coreY, 0.003, { scale: 1.3, hex: TOKEN_HEX.volt });
          bursts.spawn(nowS, "flash", coreX, coreY, 0.03, { scale: 1.2, hex: TOKEN_HEX.volt });
          for (let i = 0; i < 4; i++) bursts.spawn(nowS, "puff", coreX + (rand() - 0.5) * 0.04, coreY + (rand() - 0.5) * 0.04, 0.004, { scale: 1.3 });
          flashLight(coreX, coreY, 0.1, TOKEN_HEX.volt);
        } else if (nowS > coreLandBy) {
          coreLandBy = -1;
        }
      }
      coreBeam.update(wallMs, cues.coreIncomingAtMs, cues.coreDropAtMs, beamX, beamY);

      // Continuous effects driven by combat state.
      for (let s = 0; s < 2; s++) {
        const seat = SEATS[s];
        const arm = frame.arms[seat];
        const cs = combat?.seats[seat];
        const hot = cs !== undefined && (cs.heat > 85 || cs.servoState === "cutout") && phase !== "green_room" && phase !== "title";
        const strength = hot && cs ? Math.min(1, cs.servoState === "cutout" ? 1 : (cs.heat - HAZE_HEAT_THRESHOLD) / 15 + 0.35) : 0;
        haze.set(s as 0 | 1, arm.shoulderPos[0], arm.shoulderPos[1], arm.shoulderPos[2], strength, nowS, bursts);
        const lowFor = playerSeatLast === null || playerSeatLast === seat;
        if (fighting && cs && cs.integrity > 0 && cs.integrity <= LOW_INTEGRITY && lowFor && nowS >= nextLowSpark[seat]) {
          nextLowSpark[seat] = nowS + LOW_SPARK_INTERVAL_S * (0.8 + rand() * 0.4);
          for (let i = 0; i < 5; i++) {
            spreadDirection(0, 0, 1, 1.4, rand, dir);
            const sp = 0.4 + rand() * 0.5;
            sparks.spawn(nowS, arm.shoulderPos[0], arm.shoulderPos[1], arm.shoulderPos[2] + 0.01, dir[0] * sp, dir[1] * sp, dir[2] * sp, 0.22, "ember");
          }
        }
        // BULWARK plane 6 cm in front of the gripper along wrist → tip.
        if (bulwark[seat]) {
          let fx = arm.eePos[0] - arm.wristPos[0], fy = arm.eePos[1] - arm.wristPos[1], fz = arm.eePos[2] - arm.wristPos[2];
          const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
          ripples.setBulwark(s as 0 | 1, arm.eePos[0] + fx * 0.06, arm.eePos[1] + fy * 0.06, arm.eePos[2] + fz * 0.06, fx, fy, fz, 1);
        } else {
          ripples.setBulwark(s as 0 | 1, 0, 0, 0, 0, 0, 1, 0);
        }
      }
      lockPulse.update(nowS, frame, combat, colorblind);
      coreFace.update(nowS, frame, combat, colorblind);

      if (pendingConfetti > 0) {
        pendingConfetti = 0;
        confetti.burst(nowS, confettiCount, cameraSim[0], cameraSim[1], cameraSim[2], forwardSim[0], forwardSim[1], forwardSim[2]);
      }

      sparks.update(nowS);
      bursts.update(nowS);
      arcs.update(nowS);
      ripples.update(nowS);
      chips.update(nowS, wallDtS, frozen);
      prize.update(nowS, wallDtS, frozen);
      confetti.update(nowS);
      decals.update();
      smears.update();
      haze.update(wallMs / 1000);
    },
    /** Every pool draws one tiny instance so WP1's prewarm compiles each program once at boot (Prewarmable). */
    prewarmDraw() {
      sparks.prewarmDraw(); bursts.prewarmDraw(); arcs.prewarmDraw(); ripples.prewarmDraw(); chips.prewarmDraw();
      confetti.prewarmDraw(); prize.prewarmDraw(); decals.prewarmDraw(); smears.prewarmDraw(); lockPulse.prewarmDraw();
      scan.prewarmDraw(); coreBeam.prewarmDraw(); coreFace.prewarmDraw();
      hitLight.intensity = 0.01;
    },
    stats() {
      const st = (p: { capacity: number; recycled: number; active(n: number): number }) => ({ capacity: p.capacity, active: p.active(nowS), recycled: p.recycled });
      return {
        sparks: st(sparks.pool), bursts: st(bursts.pool), arcs: st(arcs.pool), ripples: st(ripples.pool), chips: st(chips.pool),
        confetti: st(confetti.pool), prizeCubes: st(prize.cubes.pool), prizeBills: st(prize.bills.pool),
        decals: { capacity: 64, active: decals.count },
      };
    },
    dispose() {
      unsubscribeBus();
      unsubscribeSettings();
      sparks.dispose(); bursts.dispose(); arcs.dispose(); ripples.dispose(); chips.dispose(); confetti.dispose(); prize.dispose();
      decals.dispose(); smears.dispose(); haze.dispose(); lockPulse.dispose(); scan.dispose(); coreBeam.dispose(); coreFace.dispose();
      group.clear();
    },
  };
  const unsubscribeBus = deps.bus.subscribe((events, ctx) => system.handle(events, ctx.playerSeat));
  return system;
}
