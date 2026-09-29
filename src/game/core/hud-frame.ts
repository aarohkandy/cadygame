// src/game/core/hud-frame.ts (WP1)
// The mutable per-frame HUD numbers (GAME_DESIGN 10.5). The sim-driver calls fillHudFrame once per
// frame after the bus flush; hud-runtime (WP7) and reticle-overlay (WP6) read it directly. Filling
// allocates nothing: every nested object and Vec3 is created once in createHudFrame and written in place.

import {
  CORE_CUBE_INDEX, GRIP_CLOSED, GRIP_OPEN, SEATS,
  type ActionStatus, type CombatSnapshot, type GameClock, type GameEvent, type HudFrame, type HudSeat,
  type JuiceOutput, type MatchConfig, type MatchPhase, type OpponentAffect, type PhysicsFrame, type PilotController, type Seat, type TierId, type Vec3,
} from "../contracts.ts";

/** GAME_DESIGN 8.1: low integrity is 25 or less. */
export const LOW_INTEGRITY_THRESHOLD = 25;
const GRIP_MID = (GRIP_OPEN + GRIP_CLOSED) / 2;
const RETICLE_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["fight", "sudden_death"]);

/** What the sim-driver knows about a policy seat this frame (null for human, proxy, and built-in seats with policy UI off). */
export interface HudPolicyTelemetry {
  label: string; hz: number; computeMs: number; status: ActionStatus; faults: number;
  /** 11.9: the opponent's affect (10 Hz) and effective tier from PolicyDebug; sim-driver keeps the latest. */
  affect?: OpponentAffect | null; tier?: TierId | "sparring" | null;
}

export interface HudFrameSource {
  phase: MatchPhase;
  round: number;
  roundsWon: Readonly<Record<Seat, number>>;
  config: MatchConfig | null;
  playerSeat: Seat | null;
  combat: CombatSnapshot | null;
  frame: PhysicsFrame | null;
  pilot: PilotController | null;
  juice: JuiceOutput;
  clock: GameClock;
  policies: Readonly<Record<Seat, HudPolicyTelemetry | null>>;
  matchesPlayed: number;
}

function vec3(): Vec3 { return [0, 0, 0]; }

export function createJuiceOutput(): JuiceOutput {
  return {
    yaw: 0, pitch: 0, roll: 0, fovOffsetDeg: 0,
    chromaticOffset: 0, vignetteBoost: 0, desaturate: 0,
    edge: { left: 0, right: 0, top: 0, color: "#FFF36B" },
    victimVibration: { seat: null, link: null, offset: vec3() },
    koFocus: { seat: null, weight: 0 },
    trauma: 0,
  };
}

function createHudSeat(): HudSeat {
  return {
    name: "", integrity: 0, integrityMax: 100, heat: 0,
    servoState: "normal", stateRemaining01: 0, charge: 0, charging: false, guard: false, overdrive: false,
    abilityId: "snap", abilityCharges: 0, abilityMaxCharges: 0, abilityCooldown01: 0, abilityActive: false,
    grip: "open", roundsWon: 0, lowIntegrity: false, struckLink: null, struckAgeMs: 0,
    policy: null,
  };
}

export function createHudFrame(): HudFrame {
  return {
    phase: "boot", round: 0, bestOf: 1, finalRound: false, suddenDeath: false,
    timeLeftS: 0, playerSeat: null, preset: "arcade", showKit: false, showPolicyUi: false,
    seats: { atlas: createHudSeat(), blaze: createHudSeat() },
    core: { visible: false, owner: null, remainingS: 0, contested: false, loose: false, worldPos: vec3() },
    reticle: {
      visible: false, ghostTipWorld: vec3(), physicalTipWorld: vec3(), reach01: 0, leashStretch: 0,
      guard: false, deflectLocked: false,
      rangeCue: { flick: false, jab: false, nearestM: 0, flickArcRadiusM: 0, jabArcRadiusM: 0 },
      matchesPlayed: 0,
    },
    juice: createJuiceOutput(),
    hitstop: { remainingMs: 0, budgetUsedMs: 0 },
  };
}

/** Marks the struck link on the victim's HUD seat. Call with each flushed batch (bus subscriber). */
export function noteHudEvents(hud: HudFrame, events: readonly GameEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === "strike" && e.tier === "strike") {
      const seat = hud.seats[e.victim];
      seat.struckLink = e.zone;
      seat.struckAgeMs = 0;
    }
  }
}

function copyJuice(src: JuiceOutput, dst: JuiceOutput): void {
  if (src === dst) return;
  dst.yaw = src.yaw; dst.pitch = src.pitch; dst.roll = src.roll; dst.fovOffsetDeg = src.fovOffsetDeg;
  dst.chromaticOffset = src.chromaticOffset; dst.vignetteBoost = src.vignetteBoost; dst.desaturate = src.desaturate;
  dst.edge.left = src.edge.left; dst.edge.right = src.edge.right; dst.edge.top = src.edge.top; dst.edge.color = src.edge.color;
  dst.victimVibration.seat = src.victimVibration.seat; dst.victimVibration.link = src.victimVibration.link;
  dst.victimVibration.offset[0] = src.victimVibration.offset[0];
  dst.victimVibration.offset[1] = src.victimVibration.offset[1];
  dst.victimVibration.offset[2] = src.victimVibration.offset[2];
  dst.koFocus.seat = src.koFocus.seat; dst.koFocus.weight = src.koFocus.weight;
}

function isPolicyDriver(cfg: MatchConfig, seat: Seat): boolean {
  const k = cfg.seats[seat].driver.kind;
  return k === "module" || k === "trajectory" || k === "bridge";
}

// One reusable telemetry object per seat so policy rows never allocate after the first frame.
const policySlots = new WeakMap<HudFrame, Record<Seat, HudPolicyTelemetry>>();

export function fillHudFrame(hud: HudFrame, src: HudFrameSource, wallDtS: number): void {
  const cfg = src.config;
  const combat = src.combat;
  hud.phase = src.phase;
  hud.round = src.round;
  hud.bestOf = cfg ? cfg.bestOf : 1;
  const winsNeeded = (hud.bestOf + 1) / 2;
  hud.finalRound = src.roundsWon.atlas === winsNeeded - 1 && src.roundsWon.blaze === winsNeeded - 1;
  hud.suddenDeath = combat ? combat.suddenDeath : false;
  hud.timeLeftS = combat ? Math.max(0, combat.roundLengthS - combat.fightTimeS) : 0;
  hud.playerSeat = src.playerSeat;
  hud.preset = cfg ? cfg.preset : combat ? combat.preset : "arcade";
  hud.showKit = cfg ? cfg.showKit : false;
  hud.showPolicyUi = cfg ? isPolicyDriver(cfg, "atlas") || isPolicyDriver(cfg, "blaze") : false;

  let slots = policySlots.get(hud);
  if (!slots) {
    slots = {
      atlas: { label: "", hz: 0, computeMs: 0, status: "ok", faults: 0 },
      blaze: { label: "", hz: 0, computeMs: 0, status: "ok", faults: 0 },
    };
    policySlots.set(hud, slots);
  }

  const ageMs = Math.max(0, wallDtS) * 1000;
  for (let i = 0; i < SEATS.length; i++) {
    const seat = SEATS[i];
    const h = hud.seats[seat];
    h.name = cfg ? cfg.seats[seat].displayName : "";
    h.roundsWon = src.roundsWon[seat];
    if (h.struckLink !== null) h.struckAgeMs += ageMs;
    if (combat) {
      const c = combat.seats[seat];
      h.integrity = c.integrity;
      h.integrityMax = c.integrityMax;
      h.heat = c.heat;
      h.servoState = c.servoState;
      h.stateRemaining01 = c.servoStateTotalMs > 0 ? Math.min(1, Math.max(0, c.servoStateRemainingMs / c.servoStateTotalMs)) : 0;
      h.charge = c.charge;
      h.charging = c.charging;
      h.guard = c.guardHeld;
      h.overdrive = c.overdrive;
      h.abilityId = c.ability.id;
      h.abilityCharges = c.ability.charges;
      h.abilityMaxCharges = c.ability.maxCharges;
      h.abilityCooldown01 = c.ability.cooldownTotalMs > 0 ? Math.min(1, Math.max(0, c.ability.cooldownMs / c.ability.cooldownTotalMs)) : 0;
      h.abilityActive = c.ability.activeMs > 0;
      h.lowIntegrity = c.integrity <= LOW_INTEGRITY_THRESHOLD;
    }
    if (src.pilot && src.pilot.seat === seat && src.playerSeat === seat) {
      h.grip = src.pilot.intents.grip ? "closed" : "open";
    } else if (src.frame) {
      h.grip = src.frame.arms[seat].q[5] < GRIP_MID ? "closed" : "open";
    }
    const tel = src.policies[seat];
    if (tel) {
      const slot = slots[seat];
      slot.label = tel.label; slot.hz = tel.hz; slot.computeMs = tel.computeMs; slot.status = tel.status; slot.faults = tel.faults; slot.tier = tel.tier ?? null;
      h.policy = slot;
    } else {
      h.policy = null;
    }
  }

  const core = hud.core;
  if (combat) {
    const cs = combat.core;
    core.visible = cs.phase !== "dormant";
    core.owner = cs.owner;
    core.remainingS = cs.lockInRemainingS;
    core.contested = cs.contested;
    core.loose = cs.loose;
  } else {
    core.visible = false; core.owner = null; core.remainingS = 0; core.contested = false; core.loose = false;
  }
  if (src.frame) {
    const p = src.frame.cubes.pos;
    const o = CORE_CUBE_INDEX * 3;
    core.worldPos[0] = p[o]; core.worldPos[1] = p[o + 1]; core.worldPos[2] = p[o + 2];
  }

  const r = hud.reticle;
  const pilot = src.pilot;
  const seat = src.playerSeat;
  r.visible = pilot !== null && seat !== null && RETICLE_PHASES.has(src.phase);
  r.matchesPlayed = src.matchesPlayed;
  if (pilot) {
    const g = pilot.ghost.tipWorld;
    r.ghostTipWorld[0] = g[0]; r.ghostTipWorld[1] = g[1]; r.ghostTipWorld[2] = g[2];
    r.reach01 = pilot.reach01;
    r.leashStretch = pilot.ghost.leashStretch;
    const rc = pilot.rangeCue;
    r.rangeCue.flick = rc.flick; r.rangeCue.jab = rc.jab; r.rangeCue.nearestM = rc.nearestM;
    r.rangeCue.flickArcRadiusM = rc.flickArcRadiusM; r.rangeCue.jabArcRadiusM = rc.jabArcRadiusM;
  }
  if (seat !== null) {
    if (src.frame) {
      const ee = src.frame.arms[seat].eePos;
      r.physicalTipWorld[0] = ee[0]; r.physicalTipWorld[1] = ee[1]; r.physicalTipWorld[2] = ee[2];
    }
    if (combat) {
      r.guard = combat.seats[seat].guardHeld;
      r.deflectLocked = combat.seats[seat].deflectLockoutMs > 0;
    }
  } else {
    r.guard = false;
    r.deflectLocked = false;
  }

  copyJuice(src.juice, hud.juice);
  hud.hitstop.remainingMs = src.clock.hitstopRemainingMs;
  hud.hitstop.budgetUsedMs = src.clock.hitstopBudgetUsedMs;
}
