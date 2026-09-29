// src/game/ui/hud/hud-runtime.ts (WP7)
// The HUD's per-frame writer (EMOTION_BIBLE 2, 5.7, 6, 8.1). React mounts the HUD tree once; every value that changes
// during a fight reaches the DOM from here, through textContent, transforms, CSS variables, and data attributes.
// update() is registered with game.onAfterRender, so it runs after WP6's composer with the same frame's camera and
// HudFrame. Bus events (callouts, receipts, damage numbers, tags) and caption changes are handled here too, so a
// fight produces zero React commits.
//
// In a fight the HUD is six elements until match 2 (crosshair with its receipt, opponent plate, own bar that slides
// in on the first damage taken, Core marker, one caption, wordmark); everything else is gated by the showKit table
// (format.ts showKitFor) as data attributes on the root, keyed on matchesPlayed at match start.
//
// Elements are found once at mount by their data-h attribute. This module never touches the DOM at import time
// and exports its pure models (damage number merging, projection, gates) for tests.

import {
  RENDER_SCALE, SEATS, otherSeat,
  type GameEvent, type GameHandle, type HudFrame, type MatchConfig, type MatchPhase, type ReticleState, type Seat, type Vec3,
} from "../../contracts.ts";
import { HOSTS } from "../../brand/hosts.ts";
import { resolveBindings } from "../../input/bindings.ts";
import type { PilotControllerExt } from "../../input/pilot-controller.ts";
import { captionProsody } from "../../announcer/announcer.ts";
import { prosodyFor } from "../../audio/prosody.ts";
import {
  BANNER_LETTERS, CALLOUT_LETTERS, createBannerQueue, createCalloutSlot,
  type Banner, type BannerQueue, type Callout, type CalloutTone,
} from "./banner-queue.ts";
import {
  ABILITY_LABEL, RECEIPT_HOLD_MS, SEP, TIMER_URGENT_S, comboLabel, coreChip, damageNumberPx, formatClock,
  formatInt, formatLockIn, formatSpeed, grazeTag, heatState, impactTag, integritySegments, receiptCopy,
  resultSlab, roundToLabel, showKitFor, type ShowKit,
} from "./format.ts";

/* ───────────────────────── damage numbers (pure) ───────────────────────── */

export const DAMAGE_POOL_SIZE = 16;
export const DAMAGE_MERGE_MS = 400;
export const DAMAGE_MERGE_MS_MERGED = 1200;
/** How long a damage node stays on screen after its last pop (pops 1.4 to 1 in 80 ms, holds 700, bible 6). */
export const DAMAGE_LIFE_MS = 700;

export type DamageMode = "on" | "merged" | "off";

export interface DamageSlot {
  active: boolean;
  victim: Seat;
  value: number;
  crit: boolean;
  guarded: boolean;
  graze: boolean;
  magnitude: number;
  vN: number;
  pos: Vec3;
  jitterPx: number;
  bornMs: number;
  popMs: number;
  /** Increments on every spawn or merge (renderers restart the pop when it changes). */
  revision: number;
}

export interface DamageStrike {
  tier: "graze" | "strike"; victim: Seat; damage: number; crit: boolean; guarded: boolean; magnitude: number; vN: number; pos: Vec3;
}

export interface DamageNumberModel {
  readonly slots: readonly DamageSlot[];
  /** Returns the slot index touched and whether it merged, or null when numbers are off. */
  hit(strike: DamageStrike, nowMs: number, mode: DamageMode, jitter01: number): { index: number; merged: boolean } | null;
  /** Frees slots whose life ended. Returns how many were freed. */
  expire(nowMs: number): number;
  clear(): void;
}

export function createDamageNumberModel(size = DAMAGE_POOL_SIZE): DamageNumberModel {
  const slots: DamageSlot[] = Array.from({ length: size }, () => ({
    active: false, victim: "blaze" as Seat, value: 0, crit: false, guarded: false, graze: false,
    magnitude: 0, vN: 0, pos: [0, 0, 0] as Vec3, jitterPx: 0, bornMs: 0, popMs: 0, revision: 0,
  }));

  return {
    slots,
    hit(s, nowMs, mode, jitter01) {
      if (mode === "off") return null;
      const window = mode === "merged" ? DAMAGE_MERGE_MS_MERGED : DAMAGE_MERGE_MS;
      const graze = s.tier === "graze";
      if (!graze) {
        let best = -1;
        for (let i = 0; i < slots.length; i++) {
          const sl = slots[i];
          if (sl.active && !sl.graze && sl.victim === s.victim && nowMs - sl.popMs <= window && (best < 0 || sl.popMs > slots[best].popMs)) best = i;
        }
        if (best >= 0) {
          const sl = slots[best];
          sl.value += s.damage;
          sl.crit = sl.crit || s.crit;
          sl.guarded = sl.guarded && s.guarded;
          sl.magnitude = Math.max(sl.magnitude, s.magnitude);
          sl.vN = Math.max(sl.vN, s.vN);
          sl.pos[0] = s.pos[0]; sl.pos[1] = s.pos[1]; sl.pos[2] = s.pos[2];
          sl.popMs = nowMs;
          sl.revision++;
          return { index: best, merged: true };
        }
      }
      let index = -1;
      for (let i = 0; i < slots.length; i++) if (!slots[i].active) { index = i; break; }
      if (index < 0) {
        index = 0;
        for (let i = 1; i < slots.length; i++) if (slots[i].popMs < slots[index].popMs) index = i;
      }
      const sl = slots[index];
      sl.active = true; sl.victim = s.victim; sl.value = graze ? 0 : s.damage; sl.crit = s.crit && !graze; sl.guarded = s.guarded;
      sl.graze = graze; sl.magnitude = s.magnitude; sl.vN = s.vN;
      sl.pos[0] = s.pos[0]; sl.pos[1] = s.pos[1]; sl.pos[2] = s.pos[2];
      sl.jitterPx = (Math.min(1, Math.max(0, jitter01)) * 2 - 1) * 10;
      sl.bornMs = nowMs; sl.popMs = nowMs; sl.revision++;
      return { index, merged: false };
    },
    expire(nowMs) {
      let n = 0;
      for (const sl of slots) if (sl.active && nowMs - sl.popMs >= DAMAGE_LIFE_MS) { sl.active = false; n++; }
      return n;
    },
    clear() { for (const sl of slots) sl.active = false; },
  };
}

/* ───────────────────────── label declustering (pure) ───────────────────────── */

/** Two damage labels closer than this on screen are the same unreadable blob (screens/INDEX.md, note 3). */
export const LABEL_GAP_X = 92;
export const LABEL_GAP_Y = 46;

/**
 * Pushes overlapping screen-space labels apart along y so two hits landing a few pixels apart stay readable.
 *
 * `order` lists the indices in priority order: the first keeps the exact contact point it was given, and every
 * later one is moved clear of the labels already placed. Later labels only ever move UP: they are the older
 * numbers, already rising on tl-rise, so stacking them above keeps them drifting apart (a label pushed below the
 * newest one rose straight back into it). Moving one way only also means the pass terminates and the same input
 * always produces the same output. x and y are CSS pixels; only y is written. Allocates nothing.
 */
export function spreadLabels(
  x: Float64Array, y: Float64Array, order: Int32Array, count: number, gapX = LABEL_GAP_X, gapY = LABEL_GAP_Y,
): void {
  for (let k = 1; k < count; k++) {
    const i = order[k];
    for (let pass = 0; pass <= k; pass++) {
      let hit = -1;
      for (let m = 0; m < k; m++) {
        const j = order[m];
        if (Math.abs(x[i] - x[j]) < gapX && Math.abs(y[i] - y[j]) < gapY) { hit = j; break; }
      }
      if (hit < 0) break;
      y[i] = Math.min(y[i], y[hit]) - gapY;
    }
  }
}

/**
 * Keep a damage label inside the viewport. The label is centred on its contact point, so a hit near either
 * edge pushes half a label's width off screen — at 390 px that was up to 43 px, clipped away by `.hud`'s
 * overflow. When the label is wider than the space it has, it centres instead of hugging one edge.
 */
export const LABEL_EDGE_PX = 6;
/** Half the Core marker's diamond (18 px in globals.css). */
const CORE_MARKER_HALF_PX = 9;
/** How far a label drifts up over its life (tl-rise in globals.css). */
export const DAMAGE_RISE_PX = 28;
/** The number's pop-in scale (tl-pop in globals.css). */
export const DAMAGE_POP_SCALE = 1.4;
export function clampLabelX(x: number, halfWidth: number, viewportWidth: number, edge = LABEL_EDGE_PX): number {
  const lo = edge + halfWidth;
  const hi = viewportWidth - edge - halfWidth;
  if (hi <= lo) return viewportWidth / 2;
  return x < lo ? lo : x > hi ? hi : x;
}

/* ───────────────────────── centre tags (pure) ───────────────────────── */

/** A centre tag holds this long, then clears. Two may be on screen at once. */
export const TAG_LIFE_MS = 900;
export const TAG_SLOTS = 2;

export interface TagSlot {
  label: string;
  tone: string;
  /** Wall time the tag clears at; 0 when the slot is free. */
  until: number;
  /** Increments on every push into this slot, so a renderer can restart the slam. */
  revision: number;
}

export interface TagSlots {
  readonly slots: readonly TagSlot[];
  /** Shows a tag. Returns the slot it went to, and whether it was a repeat of one already up. */
  push(label: string, tone: string, nowMs: number): { index: number; repeat: boolean };
  /** Clears tags whose life ended. Returns a bitmask of the slots that changed. */
  expire(nowMs: number): number;
  clear(): void;
}

/**
 * Arbitration for the two centre tags (CLASH, BLOCKED, STAGGERED, BURST, STUNNED).
 *
 * The rule that matters is the repeat rule: two staggers inside a second used to fill both slots with the same
 * word, which reads as a rendering fault rather than as two events. A repeat re-pops the tag that is already up
 * and leaves the other slot for something that says a different thing.
 */
export function createTagSlots(lifeMs = TAG_LIFE_MS, count = TAG_SLOTS): TagSlots {
  const slots: TagSlot[] = Array.from({ length: count }, () => ({ label: "", tone: "neutral", until: 0, revision: 0 }));
  return {
    slots,
    push(label, tone, nowMs) {
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].until > nowMs && slots[i].label === label) {
          slots[i].until = nowMs + lifeMs;
          slots[i].tone = tone;
          slots[i].revision++;
          return { index: i, repeat: true };
        }
      }
      let index = 0;
      for (let i = 1; i < slots.length; i++) if (slots[i].until < slots[index].until) index = i;
      const sl = slots[index];
      sl.label = label; sl.tone = tone; sl.until = nowMs + lifeMs; sl.revision++;
      return { index, repeat: false };
    },
    expire(nowMs) {
      let changed = 0;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].until !== 0 && slots[i].until <= nowMs) { slots[i].until = 0; slots[i].label = ""; changed |= 1 << i; }
      }
      return changed;
    },
    clear() { for (const sl of slots) { sl.until = 0; sl.label = ""; } },
  };
}

/* ───────────────────────── kit strip (pure) ───────────────────────── */

/** How long the kit strip stays up after one of its values changes. */
export const KIT_HOLD_MS = 1800;

export interface KitStrip {
  /**
   * Feeds this frame's content and returns whether the strip is up. `key` is everything the strip shows (ability,
   * charges, readiness, overdrive, grip, heat state) folded into one string: a change raises the strip for the
   * hold; `live` keeps it up while a state that needs watching (hot arm, overdrive, active ability) is on.
   */
  update(key: string, live: boolean, nowMs: number): boolean;
  clear(): void;
}

/** The kit strip earns its corner only when it has news: an idle fight shows nothing there. */
export function createKitStrip(holdMs = KIT_HOLD_MS): KitStrip {
  let lastKey = "";
  let until = 0;
  return {
    update(key, live, nowMs) {
      if (key !== lastKey) { lastKey = key; until = nowMs + holdMs; }
      return live || nowMs < until;
    },
    clear() { lastKey = ""; until = 0; },
  };
}

/* ───────────────────────── projection (pure) ───────────────────────── */

export interface ProjectionCamera {
  matrixWorldInverse: { elements: ArrayLike<number> };
  projectionMatrix: { elements: ArrayLike<number> };
}

/**
 * Projects a sim-world point (metres) to CSS pixels. Render space is (x·s, z·s, −y·s) (contracts RENDER_SCALE).
 * out = [x, y, onScreen (1/0), inFront (1/0)]. Allocates nothing.
 */
export function projectSimPoint(p: ArrayLike<number>, cam: ProjectionCamera, width: number, height: number, out: Float64Array): Float64Array {
  const rx = p[0] * RENDER_SCALE, ry = p[2] * RENDER_SCALE, rz = -p[1] * RENDER_SCALE;
  const v = cam.matrixWorldInverse.elements, m = cam.projectionMatrix.elements;
  const vx = v[0] * rx + v[4] * ry + v[8] * rz + v[12];
  const vy = v[1] * rx + v[5] * ry + v[9] * rz + v[13];
  const vz = v[2] * rx + v[6] * ry + v[10] * rz + v[14];
  const vw = v[3] * rx + v[7] * ry + v[11] * rz + v[15];
  const cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12] * vw;
  const cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13] * vw;
  const cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15] * vw;
  const front = cw > 1e-6;
  const w = front ? cw : Math.max(1e-6, -cw);
  let nx = cx / w, ny = cy / w;
  if (!front) { nx = -nx; ny = -ny; }
  out[0] = (nx * 0.5 + 0.5) * width;
  out[1] = (1 - (ny * 0.5 + 0.5)) * height;
  out[2] = front && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1 ? 1 : 0;
  out[3] = front ? 1 : 0;
  return out;
}

/* ───────────────────────── live match stats (Tab) ───────────────────────── */

export interface LiveSeatStats {
  damage: number; strikes: number; crits: number; grazes: number; guarded: number; deflects: number; clashes: number;
  steals: number; fastest: number; hardest: number; staggers: number; faults: number;
}

export function emptyLiveStats(): Record<Seat, LiveSeatStats> {
  const one = (): LiveSeatStats => ({ damage: 0, strikes: 0, crits: 0, grazes: 0, guarded: 0, deflects: 0, clashes: 0, steals: 0, fastest: 0, hardest: 0, staggers: 0, faults: 0 });
  return { atlas: one(), blaze: one() };
}

export function accumulateLiveStats(stats: Record<Seat, LiveSeatStats>, e: GameEvent): void {
  switch (e.type) {
    case "strike": {
      const a = stats[e.attacker];
      if (e.tier === "graze") { a.grazes++; break; }
      const dmg = e.damage > 0 ? e.damage : e.physicalDamage;
      if (e.guarded) a.guarded++; else a.strikes++;
      if (e.crit) a.crits++;
      a.damage += dmg;
      if (e.vN > a.fastest) a.fastest = e.vN;
      if (dmg > a.hardest) a.hardest = dmg;
      break;
    }
    case "deflect": stats[e.defender].deflects++; break;
    case "clash": stats.atlas.clashes++; stats.blaze.clashes++; break;
    case "core": if (e.stage === "steal" && e.seat) stats[e.seat].steals++; break;
    case "servo_state": if (e.state === "stagger") stats[e.seat === "atlas" ? "blaze" : "atlas"].staggers++; break;
    case "policy_fault": stats[e.seat].faults++; break;
    default: break;
  }
}

/* ───────────────────────── phase visibility ───────────────────────── */

/** Phases with the plates up: from the entrance slam (bible 2, t0 + 0.3 s) to the round summary. */
const MATCH_HUD_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>([
  "entrance", "boot_ritual", "count_in", "round_intro", "fight", "ko", "lock", "time_up", "sudden_death", "round_summary",
  "paused", "rematch_intro", "systems_check",
]);
const LIVE_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["fight", "sudden_death", "systems_check"]);
/** Phases where the crosshair receipt and the one caption are drawn without any plate: the silent attract loop. */
const RECEIPT_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>([...LIVE_PHASES, "attract", "ko", "lock"]);

export function hudVisibleIn(phase: MatchPhase): boolean {
  return MATCH_HUD_PHASES.has(phase);
}

export function receiptVisibleIn(phase: MatchPhase): boolean {
  return RECEIPT_PHASES.has(phase);
}

/**
 * Phases where holding STATS shows the overlay.
 *
 * Every phase the HUD is up in, except `paused`: the pause menu owns the keyboard while it is open, and the
 * default STATS key is Tab, so intercepting it there would trap focus traversal on the one screen a keyboard
 * player most needs it. Stats are still one key away the moment the match resumes.
 */
export function statsHoldAllowed(phase: MatchPhase): boolean {
  return MATCH_HUD_PHASES.has(phase) && phase !== "paused";
}

/**
 * Round 1 of match 1 is BACKLASH's sparring round (bible 2): the plate carries a SPARRING tag and no bar. The
 * tutorial script drives that round, so a tutorial config in round 1 is the sparring signal; a config that names
 * it outright (`sparring`) wins when WP6 adds one.
 */
export function isSparringRound(cfg: Pick<MatchConfig, "tutorial"> & { sparring?: boolean } | null, round: number): boolean {
  if (!cfg) return false;
  if (typeof cfg.sparring === "boolean") return cfg.sparring && round === 1;
  return cfg.tutorial && round === 1;
}

/**
 * Range ring state for the crosshair. WP3 publishes `ReticleState` on the pilot; until it does, the frame's
 * range cue gives the same answer: in range when either arc reaches the nearest target, fill rising as the
 * target closes into the sweet band (within the jab arc is full).
 */
export function reticleFromCue(cue: HudFrame["reticle"]["rangeCue"]): ReticleState {
  const inRange = cue.flick || cue.jab;
  const outer = Math.max(1e-6, cue.flickArcRadiusM);
  const inner = Math.min(outer, Math.max(0, cue.jabArcRadiusM));
  const d = Math.max(0, cue.nearestM);
  let fill: number;
  if (d <= inner) fill = 1;
  else if (d >= outer * 2) fill = 0;
  else fill = 1 - (d - inner) / (outer * 2 - inner);
  return { fill: Math.min(1, Math.max(0, fill)), inRange, magnetism: 0 };
}

/** A caption's mouse glyph: `HIT IT` with the LMB glyph, `GUARD · HOLD RMB` with RMB. The token leaves the text. */
export type CaptionGlyph = "left" | "right" | "move" | null;
export function captionGlyph(text: string): { text: string; glyph: CaptionGlyph } {
  const m = text.match(/\s*(?:·\s*)?\b(LMB|RMB|MOUSE)\b\s*/);
  if (!m) return { text, glyph: null };
  const glyph: CaptionGlyph = m[1] === "LMB" ? "left" : m[1] === "RMB" ? "right" : "move";
  const stripped = text.replace(m[0], m.index === 0 || m.index === undefined ? "" : " ").replace(/\s*·\s*$/, "").trim();
  return { text: stripped, glyph };
}

/** True for a focused text field, where a key press belongs to the field and not to the HUD. */
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el !== "object" || !("tagName" in el)) return false;
  const tag = String(el.tagName).toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/* ───────────────────────── runtime ───────────────────────── */

export interface HudRuntimeOptions {
  /** ?debug=feel overlay. */
  debug?: boolean;
  /** Injected for tests; defaults to performance.now. */
  now?: () => number;
  /** Seeded jitter source for damage numbers; defaults to Math.random. */
  random?: () => number;
  /** Receipt count and PB live here (per viewer); defaults to localStorage, null disables. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

export interface HudRuntime {
  /** Finds the HUD's elements under root and starts writing. Returns the unmount function. */
  mount(root: HTMLElement): () => void;
}

/** Per-viewer receipt count (the word band leaves after ten) and the personal-best contact speed. */
export const RECEIPTS_KEY = "torquelimit.receipts.v1";
export const PB_KEY = "torquelimit.pb.v1";

const PATCHED_MS = 1500;
const FAULT_LIP_MS = 1500;
const KO_SETTLE_SPEED = 0.05;
const KO_SETTLE_MIN_MS = 150;
const KO_SETTLE_MAX_MS = 1100;
const LOCK_BANNER_DELAY_MS = 150;
const OUTRO_BANNER_DELAY_MS = 400;
const CORE_NEAR_M = 0.1;
const LOW_RATE_MS = 250;
const EDGE_MARGIN_PX = 44;
const INTEGRITY_SEGMENTS = 10;
const HIT_HOLD_MS = 120;
/** The lost slice drains as a red ghost over 900 ms (bible 6, heavy hit dealt). */
const HIT_DRAIN_MS = 900;
const CORE_DROP_S = 15;
/** OPEN over the opponent's gripper after a whiff, PUNISH if you land inside this window (bible 6, match 2+). */
const GRIP_TAG_MS = 300;
const PUNISH_WINDOW_MS = 400;
/** `-31` under your plate holds as long as a receipt. */
const TAKEN_HOLD_MS = 700;
/** The FIGHT slam is one word, 240 ms in (bible 2). */
const FIGHT_SLAM_MS = 900;
/** The GG-tap window on the outro (match-director PHASE_MS.ggTap). */
const GG_TAP_MS = 1500;

type Tone = CalloutTone | "strike";
const teamTone = (s: Seat): "team-atlas" | "team-blaze" => (s === "atlas" ? "team-atlas" : "team-blaze");

function readStorage(): HudRuntimeOptions["storage"] {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
}

export function createHudRuntime(game: GameHandle, opts: HudRuntimeOptions = {}): HudRuntime {
  const now = opts.now ?? (() => performance.now());
  const random = opts.random ?? Math.random;
  const storage = opts.storage === undefined ? readStorage() : opts.storage;
  const readNumber = (key: string): number | null => {
    try { const v = storage?.getItem(key); const n = v === null || v === undefined ? NaN : Number(v); return Number.isFinite(n) ? n : null; } catch { return null; }
  };
  const writeNumber = (key: string, n: number): void => { try { storage?.setItem(key, String(n)); } catch { /* blocked or full */ } };

  return {
    mount(root: HTMLElement): () => void {
      const els = new Map<string, HTMLElement>();
      root.querySelectorAll<HTMLElement>("[data-h]").forEach((el) => { if (el.dataset.h) els.set(el.dataset.h, el); });
      const $ = (k: string): HTMLElement | null => els.get(k) ?? null;
      const cache = new WeakMap<HTMLElement, Map<string, string>>();

      function put(el: HTMLElement | null, kind: string, value: string, write: (el: HTMLElement) => void): void {
        if (!el) return;
        let m = cache.get(el);
        if (!m) { m = new Map(); cache.set(el, m); }
        if (m.get(kind) === value) return;
        m.set(kind, value);
        write(el);
      }
      const text = (el: HTMLElement | null, v: string) => put(el, "#text", v, (e) => { e.textContent = v; });
      const data = (el: HTMLElement | null, name: string, v: string) => put(el, `data-${name}`, v, (e) => { e.setAttribute(`data-${name}`, v); });
      const cssVar = (el: HTMLElement | null, name: string, v: string) => put(el, name, v, (e) => { e.style.setProperty(name, v); });
      const style = (el: HTMLElement | null, prop: "transform" | "opacity" | "fontSize", v: string) => put(el, prop, v, (e) => { e.style[prop] = v; });
      /** Restarts a CSS animation without a forced reflow: flips data-anim between two identical keyframe sets. */
      const replay = (el: HTMLElement | null) => {
        if (!el) return;
        const next = el.getAttribute("data-anim") === "a" ? "b" : "a";
        el.setAttribute("data-anim", next);
        const m = cache.get(el);
        if (m) m.set("data-anim", next);
      };

      let width = root.clientWidth || 1920;
      let height = root.clientHeight || 1080;
      /** Bottom of the top bar in HUD pixels: damage labels never rise into it. Hidden chips still take layout
       *  space (visibility, not display), so one read on resize covers the tallest the bar gets. */
      let topZone = 0;
      /** Label sizes follow --hud-scale, so a resize invalidates every measured label. */
      let dmgStale = false;
      const onResize = () => {
        width = root.clientWidth || width; height = root.clientHeight || height;
        dmgStale = true;
        const tote = root.querySelector(".hud-tote");
        if (tote) topZone = tote.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
      };
      window.addEventListener("resize", onResize);
      const sizeWatch = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
      sizeWatch?.observe(root);

      // Precomputed keys so the frame loop concatenates no strings.
      const seatKeys = Object.fromEntries(SEATS.map((s) => [s, {
        name: `${s}-name`, num: `${s}-num`, bar: `${s}-bar`, plate: `${s}-plate`, policy: `${s}-policy`, policyText: `${s}-policy-text`,
        patched: `${s}-patched`, tag: `${s}-tag`,
        seg: Array.from({ length: INTEGRITY_SEGMENTS }, (_, i) => `${s}-seg-${i}`),
        pip: Array.from({ length: 3 }, (_, i) => `${s}-round-${i}`),
      }])) as Record<Seat, { name: string; num: string; bar: string; plate: string; policy: string; policyText: string; patched: string; tag: string; seg: string[]; pip: string[] }>;
      const dmgKeys = Array.from({ length: DAMAGE_POOL_SIZE }, (_, i) => ({ node: `dmg-${i}`, num: `dmg-${i}-num`, tag: `dmg-${i}-tag` }));
      const dmgX = new Float64Array(DAMAGE_POOL_SIZE);
      const dmgY = new Float64Array(DAMAGE_POOL_SIZE);
      const dmgOrder = new Int32Array(DAMAGE_POOL_SIZE);
      const dmgPlaced = new Int32Array(DAMAGE_POOL_SIZE);
      let dmgPlacedCount = 0;
      const segFill = new Float32Array(INTEGRITY_SEGMENTS);
      const segGhost = new Float32Array(INTEGRITY_SEGMENTS);
      const proj = new Float64Array(4);

      const model = createDamageNumberModel();
      const dmgRevision = new Int32Array(DAMAGE_POOL_SIZE).fill(-1);
      const dmgHalfW = new Float64Array(DAMAGE_POOL_SIZE).fill(40);
      const dmgH = new Float64Array(DAMAGE_POOL_SIZE).fill(LABEL_GAP_Y - 4);
      const banners: BannerQueue = createBannerQueue();
      const callouts = createCalloutSlot();
      let calloutRevision = -1;
      const bannerLetterKeys = Array.from({ length: BANNER_LETTERS }, (_, i) => `banner-l-${i}`);
      const calloutLetterKeys = Array.from({ length: CALLOUT_LETTERS }, (_, i) => `callout-l-${i}`);
      let bannerRevision = -1;
      const kitStrip = createKitStrip();
      let liveStats = emptyLiveStats();

      const ghost: Record<Seat, { frac: number; lastFrac: number; holdUntil: number; drainFrom: number; drainStart: number }> = {
        atlas: { frac: 1, lastFrac: 1, holdUntil: 0, drainFrom: 1, drainStart: 0 },
        blaze: { frac: 1, lastFrac: 1, holdUntil: 0, drainFrom: 1, drainStart: 0 },
      };
      const patchedUntil: Record<Seat, number> = { atlas: 0, blaze: 0 };
      const faultUntil: Record<Seat, number> = { atlas: 0, blaze: 0 };
      const tags = createTagSlots();
      let pendingKo: { victim: Seat; attacker: Seat; at: number } | null = null;
      let pendingLock: { seat: Seat; at: number } | null = null;
      let pendingOutro: { at: number } | null = null;
      let lastRoundReason: Extract<GameEvent, { type: "round_end" }>["reason"] | null = null;
      let slamLabel = "";
      let slamShownAt = 0;
      let lastBeatSecond = -1;
      let lastLowRate = 0;
      let captionHideAt = 0;
      let lastCaption: unknown = null;
      // Typewriter state. The reveal is a per-character SUBSTRING WRITE, not a CSS clip: `clip-path` with
      // `steps(n, end)` steps by a fraction of the span's WIDTH while n is its CHARACTER count, and Barlow
      // Condensed is proportional — so a boundary lands inside a glyph and the player reads "LET US SEE I1"
      // or "MA1". Writing text can only ever produce whole glyphs.
      let capShownAt = 0, capBody = "", capLast = "", capHeadLen = 0, capCps = 1, capShownChars = -1;
      let statsOpen = false;
      const frameTimes = new Float32Array(120);
      let frameIdx = 0;
      let lastFrame = now();
      let lastMagnitude = 0;

      /* ── show kit and per-match state (bible 2) ── */
      let kit: ShowKit = showKitFor(game.settings.get().profile.matchesPlayed);
      let ownBarUp = false;
      let receiptsSoFar = readNumber(RECEIPTS_KEY) ?? 0;
      let pbMs: number | null = readNumber(PB_KEY);
      let bestThisMatch = 0;
      let receiptUntil = 0;
      let takenUntil = 0;
      let gripTagUntil = 0;
      let opponentWhiffAt = -Infinity;
      let whiffPlateUntil = 0;

      const nameOf = (s: Seat): string => game.director.config?.seats[s].displayName ?? (game.hud.seats[s].name || s.toUpperCase());
      const player = (): Seat | null => game.hud.playerSeat;

      function applyKit(): void {
        kit = showKitFor(game.settings.get().profile.matchesPlayed);
        data(root, "timer", kit.timer ? "true" : "false");
        data(root, "tags", kit.tags ? "true" : "false");
        data(root, "heat", kit.heat ? "true" : "false");
        data(root, "kit", kit.kit ? "true" : "false");
      }

      /* ── banners (between rounds only: KNOCKOUT, LOCKED, ROUND TO, TIME, SUDDEN DEATH, the result slab) ── */

      function pushBanner(b: Banner): void { banners.push(b, now()); }

      function renderBanner(): void {
        const band = $("banner");
        const b = banners.current;
        if (!band) return;
        if (!b) { data(band, "show", "false"); return; }
        text($("banner-title"), b.title);
        writeLetters(bannerLetterKeys, b.title);
        cssVar($("banner-letters"), "--banner-len", String(Math.max(4, b.title.length)));
        text($("banner-sub"), b.sub ?? "");
        data($("banner-sub"), "empty", b.sub ? "false" : "true");
        text($("banner-sticker"), b.sticker ?? "");
        data($("banner-sticker"), "empty", b.sticker ? "false" : "true");
        data(band, "kind", b.kind);
        data(band, "tier", b.tier);
        data(band, "team", b.team ?? "none");
        data(band, "show", "true");
        replay(band);
        const splash = $("splash");
        data(splash, "kind", b.kind);
        data(splash, "team", b.team ?? "none");
        replay(splash);
      }

      /** One glyph per letter slot, spaces kept as a fixed gap; the last slot takes any remainder. */
      function writeLetters(keys: readonly string[], word: string): void {
        const last = keys.length - 1;
        for (let i = 0; i < keys.length; i++) {
          const ch = i < last ? (word[i] ?? "") : word.slice(last);
          text($(keys[i]), ch === " " ? " " : ch);
        }
      }

      /* ── callout slams (bible 5.7): FIRST BLOOD, CRIT, DEFLECT, STREAK, STEAL ── */

      function pushCallout(c: Callout): void {
        if (callouts.push(c, now())) renderCallout();
      }

      function renderCallout(): void {
        calloutRevision = callouts.revision;
        const el = $("callout");
        const c = callouts.current;
        if (!c) { data(el, "show", "false"); return; }
        writeLetters(calloutLetterKeys, c.word);
        text($("callout-sub"), c.sub ?? "");
        data(el, "kind", c.kind);
        data(el, "tone", c.tone);
        data(el, "show", "true");
        replay(el);
      }

      /* ── centre tags (match 2+), the gripper tag, the receipt, and the number under your plate ── */

      function clearTags(): void {
        tags.clear();
        for (let i = 0; i < TAG_SLOTS; i++) data($(`tag-${i}`), "show", "false");
        gripTagUntil = 0; data($("grip-tag"), "show", "false");
      }

      function pushTag(label: string, tone: Tone): void {
        if (!kit.tags) return;
        const { index } = tags.push(label, tone, now());
        const el = $(`tag-${index}`);
        text(el, label);
        data(el, "tone", tone);
        data(el, "show", "true");
        replay(el);
      }

      /** OPEN / PUNISH / WHIP over the opponent's gripper for 300 ms (bible 6, match 2+). */
      function pushGripTag(word: "OPEN" | "PUNISH" | "WHIP", t: number): void {
        if (!kit.tags) return;
        const el = $("grip-tag");
        text(el, word);
        data(el, "kind", word.toLowerCase());
        data(el, "show", "true");
        gripTagUntil = t + GRIP_TAG_MS;
        replay(el);
      }

      function pushReceipt(vN: number, guarded: boolean, t: number): void {
        const copy = receiptCopy({ vN, guarded, receiptsSoFar, pbMs: kit.pb ? pbMs : null });
        if (!guarded) {
          receiptsSoFar++;
          writeNumber(RECEIPTS_KEY, receiptsSoFar);
          if (vN > bestThisMatch) bestThisMatch = vN;
        }
        const el = $("receipt");
        text($("receipt-text"), copy.text);
        text($("receipt-pb"), copy.pb);
        data($("receipt-pb"), "empty", copy.pb ? "false" : "true");
        data(el, "band", copy.band);
        data(el, "receipt", "true");
        receiptUntil = t + RECEIPT_HOLD_MS;
        replay($("receipt-text"));
      }

      function pushTaken(dmg: number, attacker: Seat, t: number): void {
        const el = $("own-taken");
        text(el, `-${formatInt(dmg)}`);
        data(el, "team", attacker);
        data(el, "show", "true");
        takenUntil = t + TAKEN_HOLD_MS;
        replay(el);
      }

      /* ── the Lab feed (policy seats only) ── */

      const feedRows: { text: string; seat: Seat | "none"; tone: Tone }[] = [];
      function pushFeed(label: string, seat: Seat | null, tone: Tone): void {
        if (!game.hud.showPolicyUi) return;
        feedRows.unshift({ text: label, seat: seat ?? "none", tone });
        if (feedRows.length > 4) feedRows.length = 4;
        for (let i = 0; i < 4; i++) {
          const row = $(`feed-${i}`);
          const r = feedRows[i];
          if (!row) continue;
          if (!r) { data(row, "show", "false"); continue; }
          text($(`feed-${i}-text`), r.text);
          data(row, "seat", r.seat);
          data(row, "tone", r.tone);
          data(row, "show", "true");
          if (i === 0) replay(row);
        }
      }

      /* ── events ── */

      function resetMatch(): void {
        applyKit();
        liveStats = emptyLiveStats(); banners.clear(); model.clear(); clearTags(); feedRows.length = 0;
        callouts.clear(); kitStrip.clear();
        pendingKo = null; pendingLock = null; pendingOutro = null; lastRoundReason = null;
        ownBarUp = false; bestThisMatch = 0; receiptUntil = 0; takenUntil = 0; opponentWhiffAt = -Infinity; whiffPlateUntil = 0;
        pbMs = readNumber(PB_KEY);
        data(root, "ownbar", "false");
        data($("receipt"), "receipt", "false");
        data($("own-taken"), "show", "false");
      }

      const onEvents = (events: readonly GameEvent[]) => {
        const t = now();
        const p = player();
        const mode = game.settings.get().video.damageNumbers;
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          accumulateLiveStats(liveStats, e);
          switch (e.type) {
            case "phase":
              if (e.phase === "match_intro" || e.phase === "rematch_intro" || e.phase === "attract") {
                resetMatch();
              } else if (e.phase === "entrance") {
                applyKit();
              } else if (e.phase === "round_intro" || e.phase === "boot_ritual") {
                model.clear(); clearTags(); callouts.clear(); pendingKo = null; pendingLock = null;
                ghost.atlas.frac = ghost.blaze.frac = 1;
              } else if (e.phase === "fight") {
                // The show flow (a person in a quick / warm-up match) gets its one FIGHT slam from match-intro.tsx at
                // round_intro + 240 ms; the Lab and policy-only matches slam here on the bell.
                const ctx = game.director.config?.context;
                if (p === null || (ctx !== "quick" && ctx !== "warmup")) showSlam("FIGHT", "engage", t);
              } else if (e.phase === "time_up") {
                pushBanner({ kind: "time", title: "TIME", sub: null, sticker: null, tier: "impact", team: null, holdMs: 900 });
              } else if (e.phase === "sudden_death") {
                pushBanner({ kind: "sudden_death", title: "SUDDEN DEATH", sub: "NEXT CLEAN HIT", sticker: null, tier: "impact", team: null, holdMs: 1400 });
              } else if (e.phase === "outro") {
                pendingOutro = { at: t + OUTRO_BANNER_DELAY_MS };
                // GG-tap window (bible 8.2): one tap inside the first 1.5 s of the outro skips to the verdict.
                if (p !== null && (game.director.config?.context === "quick" || game.director.config?.context === "warmup")) {
                  game.ui.set({ captions: { speaker: "rook", lineId: "prompt.gg", text: "GG? TAP · LMB", priority: 1, durationMs: GG_TAP_MS } });
                }
              }
              break;
            case "strike": {
              if (e.magnitude > 0) lastMagnitude = e.magnitude;
              // Physical damage stands in only where the scoring is physical (PROVING GROUND / HARNESS): an ARCADE strike
              // with damage 0 (the sparring round) shows no number, no `-31`, and never slides the own bar in.
              const dmg = e.damage > 0 ? e.damage : game.rules.state.scoring === "full" ? 0 : e.physicalDamage;
              const mine = p === null || e.attacker === p;
              if (mine) {
                pushReceipt(e.vN, e.guarded && e.tier === "strike", t);
                if (dmg > 0 && e.tier === "strike") {
                  model.hit({ tier: e.tier, victim: e.victim, damage: dmg, crit: e.crit, guarded: e.guarded, magnitude: e.magnitude, vN: e.vN, pos: e.pos }, t, mode, random());
                }
                if (e.crit && e.tier === "strike" && !e.guarded) pushCallout({ kind: "crit", word: "CRIT", sub: formatSpeed(e.vN), tone: "crit" });
                if (e.tier === "strike" && !e.guarded && t - opponentWhiffAt <= PUNISH_WINDOW_MS) pushGripTag("PUNISH", t);
                else if (e.tier === "strike" && !e.guarded && e.whip) pushGripTag("WHIP", t);
              }
              if (p !== null && e.victim === p && e.tier === "strike") {
                if (e.guarded) pushReceipt(e.vN, true, t);
                else if (dmg > 0) { pushTaken(dmg, e.attacker, t); if (!ownBarUp) { ownBarUp = true; data(root, "ownbar", "true"); } }
              }
              if (e.tier === "strike") {
                pushFeed(`${nameOf(e.attacker)} ${formatInt(dmg)}${e.crit ? " CRIT" : e.guarded ? " BLOCKED" : ""}`, e.attacker, e.crit ? "crit" : e.guarded ? "block" : "strike");
              }
              break;
            }
            case "whiff":
              if (p !== null && e.seat !== p) { opponentWhiffAt = t; whiffPlateUntil = t + GRIP_TAG_MS; pushGripTag("OPEN", t); }
              break;
            case "show": {
              // 11.9 ShowEvents: the SPARRING cadence coaches the guard on every heavy tell (bible 8.4); the tags above
              // come from the strike / whiff events themselves so nothing here doubles them.
              const s = e.show;
              if (s.kind === "tell" && s.primitive === "slam" && p !== null && s.seat !== p && game.hud.seats[s.seat].policy?.tier === "sparring") {
                game.ui.set({ captions: { speaker: "vale", lineId: "prompt.guard", text: "GUARD · HOLD RMB", priority: 1, durationMs: Math.max(900, s.ms) } });
              }
              break;
            }
            case "first_strike":
              pushCallout({ kind: "first_strike", word: "FIRST BLOOD", sub: null, tone: teamTone(e.seat) });
              break;
            case "deflect":
              if (p === null || e.defender === p) pushCallout({ kind: "deflect", word: "DEFLECT", sub: null, tone: "block" });
              else if (e.attacker === p) pushTag("STUNNED", "neutral");
              pushFeed(`${nameOf(e.defender)} DEFLECT`, e.defender, "block");
              break;
            case "late_guard":
              if (e.defender === p) pushTag(`LATE GUARD +${formatInt(e.refund)}`, "neutral");
              break;
            case "clash":
              pushTag("CLASH", "neutral");
              pushFeed("CLASH", null, "neutral");
              break;
            case "servo_state":
              if (e.state === "stagger") pushTag(e.seat === p ? "SHORTED" : "STAGGERED", "neutral");
              break;
            case "burst":
              if (e.seat === p) pushTag("BURST", teamTone(e.seat));
              break;
            case "combo":
              // The streak slam marks the run at five and every four after; the bar carries the rest.
              if ((p === null || e.seat === p) && e.count >= 5 && (e.count - 5) % 4 === 0) pushCallout({ kind: "streak", word: "STREAK", sub: comboLabel(e.count), tone: teamTone(e.seat) });
              break;
            case "ko":
              pendingKo = { victim: e.victim, attacker: e.attacker, at: t };
              pushFeed(`${nameOf(e.victim)} SHORTED OUT`, e.attacker, "neutral");
              break;
            case "core":
              if (e.stage === "steal" && e.seat) {
                pushCallout({ kind: "steal", word: "STEAL", sub: e.late ? `${formatLockIn(e.remainingS)} LEFT` : nameOf(e.seat), tone: teamTone(e.seat) });
                pushFeed(`${nameOf(e.seat)} STOLEN`, e.seat, "neutral");
              } else if (e.stage === "lock" && e.seat) {
                pendingLock = { seat: e.seat, at: t + LOCK_BANNER_DELAY_MS };
              }
              break;
            case "flaw":
              if (e.stage === "patched") { patchedUntil[e.seat] = t + PATCHED_MS; replay($(seatKeys[e.seat].patched)); }
              break;
            case "policy_fault":
              faultUntil[e.seat] = t + FAULT_LIP_MS;
              pushFeed(`POLICY FAULT${SEP}${e.status.toUpperCase()}`, e.seat, "neutral");
              break;
            case "round_end":
              lastRoundReason = e.reason;
              if (e.reason !== "ko" && e.reason !== "lock") {
                pushBanner({ kind: "round_to", title: roundToLabel(nameOf(e.winner)), sub: null, sticker: null, tier: "impact", team: e.winner, holdMs: 1000 });
              }
              break;
            case "match_end":
              if (bestThisMatch > (pbMs ?? 0)) writeNumber(PB_KEY, bestThisMatch);
              break;
            default:
              break;
          }
        }
      };

      /* ── frame ── */

      function updateSeats(hud: HudFrame, t: number): void {
        const sparring = isSparringRound(game.director.config, hud.round);
        data(root, "sparring", sparring ? "true" : "false");
        for (let si = 0; si < SEATS.length; si++) {
          const s = SEATS[si];
          const k = seatKeys[s];
          const h = hud.seats[s];
          text($(k.name), h.name || nameOf(s));
          text($(k.num), formatInt(h.integrity));
          data($(k.bar), "low", h.lowIntegrity ? "true" : "false");
          data($(k.plate), "whiff", s !== hud.playerSeat && t < whiffPlateUntil ? "true" : "false");

          const frac = h.integrityMax > 0 ? Math.min(1, Math.max(0, h.integrity / h.integrityMax)) : 0;
          const g = ghost[s];
          if (frac < g.lastFrac - 1e-6) {
            // A hit: the lost slice holds in strike colour for 120 ms, then drains as a red ghost over 900 ms.
            if (g.frac < g.lastFrac) g.frac = g.lastFrac;
            g.holdUntil = t + HIT_HOLD_MS;
            g.drainFrom = g.frac;
            g.drainStart = g.holdUntil;
          }
          g.lastFrac = frac;
          if (g.frac <= frac) g.frac = frac;
          else if (t >= g.drainStart) {
            const u = Math.min(1, (t - g.drainStart) / HIT_DRAIN_MS);
            g.frac = u >= 1 ? frac : g.drainFrom + (frac - g.drainFrom) * u;
          }
          integritySegments(frac, 1, segFill);
          integritySegments(g.frac, 1, segGhost);
          for (let i = 0; i < INTEGRITY_SEGMENTS; i++) {
            const seg = $(k.seg[i]);
            cssVar(seg, "--f", segFill[i].toFixed(3));
            cssVar(seg, "--g", segGhost[i].toFixed(3));
          }
          data($(k.plate), "hit", t < g.holdUntil ? "true" : "false");
          for (let i = 0; i < k.pip.length; i++) data($(k.pip[i]), "on", i < h.roundsWon ? "true" : "false");

          const pol = h.policy;
          const chip = $(k.policy);
          if (pol && hud.showPolicyUi) {
            data(chip, "show", "true");
            text($(k.policyText), `${pol.label}${SEP}${formatInt(pol.hz)} HZ${SEP}${formatInt(pol.computeMs)} MS${pol.faults > 0 ? `${SEP}${pol.faults} FAULTS` : ""}`);
            const bad = pol.status === "late" || pol.status === "timeout" || pol.status === "error";
            if (bad && faultUntil[s] < t) faultUntil[s] = t + FAULT_LIP_MS;
            data(chip, "fault", t < faultUntil[s] ? "true" : "false");
          } else {
            data(chip, "show", "false");
          }
          data($(k.patched), "show", t < patchedUntil[s] ? "true" : "false");
        }
      }

      function updateClockAndCore(hud: HudFrame): void {
        const phase = hud.phase;
        const live = LIVE_PHASES.has(phase);
        const cfg = game.director.config;
        const shown = phase === "round_intro" || phase === "rematch_intro" || phase === "boot_ritual" || phase === "entrance" || phase === "count_in"
          ? (hud.suddenDeath ? hud.timeLeftS : cfg?.roundLengthS ?? hud.timeLeftS)
          : hud.timeLeftS;
        text($("timer-text"), formatClock(shown));
        const urgent = live && shown <= TIMER_URGENT_S;
        const box = $("timer");
        data(box, "urgent", urgent ? "true" : "false");
        data(box, "sudden", hud.suddenDeath ? "true" : "false");
        if (urgent) {
          const sec = Math.ceil(shown);
          if (sec !== lastBeatSecond) { lastBeatSecond = sec; replay(box); }
        } else {
          lastBeatSecond = -1;
        }

        const chip = $("core-chip");
        const core = hud.core;
        const rs = game.rules.state;
        // The Core chip appears the first time the Core is live in any match (gate table), never for the countdown to it.
        const showChip = core.visible && rs.core.phase !== "incoming" && (live || phase === "lock" || phase === "ko" || phase === "time_up");
        data(chip, "show", showChip ? "true" : "false");
        if (!showChip) return;
        const copy = coreChip({
          visible: true, incoming: false, dropInS: (rs.suddenDeath ? 0 : CORE_DROP_S) - rs.fightTimeS,
          owner: core.owner, docked: rs.core.dockedIn === core.owner && core.owner !== null,
          contested: core.contested, loose: core.loose, remainingS: core.remainingS,
        });
        data(chip, "owner", core.owner ?? "none");
        data(chip, "contested", core.contested ? "true" : "false");
        data(chip, "loose", core.loose ? "true" : "false");
        data(chip, "state", copy.state);
        data(chip, "urgent", copy.urgent ? "true" : "false");
        text($("core-chip-label"), copy.label);
        text($("core-chip-value"), copy.value);
      }

      function updatePlayer(hud: HudFrame, t: number): void {
        const p = hud.playerSeat;
        if (!p || (!kit.kit && !kit.heat)) { data($("kit"), "up", "false"); return; }
        const h = hud.seats[p];
        const hs = heatState(h.heat, h.servoState === "cutout");
        const hot = hs === "hot" || hs === "cutout";
        const ready = h.abilityCharges > 0 && h.abilityCooldown01 <= 0;
        const kitKey = `${kit.kit ? h.abilityId : ""}|${kit.kit ? h.abilityCharges : 0}|${ready}|${h.abilityActive}|${h.overdrive}|${h.grip}|${hs}`;
        const up = LIVE_PHASES.has(hud.phase) && kitStrip.update(kitKey, hot || h.overdrive || h.abilityActive, t);
        data($("kit"), "up", up ? "true" : "false");
        if (!up) return;
        data($("kit"), "showkit", kit.kit ? "true" : "false");
        text($("kit-ability"), ABILITY_LABEL[h.abilityId]);
        text($("kit-charges"), h.abilityMaxCharges > 0 ? `${h.abilityCharges}/${h.abilityMaxCharges}` : "");
        cssVar($("kit-cooldown"), "--cd", h.abilityCooldown01.toFixed(3));
        data($("kit-ability-row"), "active", h.abilityActive ? "true" : "false");
        data($("kit-ability-row"), "ready", ready ? "true" : "false");
        data($("kit-overdrive"), "on", h.overdrive ? "true" : "false");
        text($("kit-grip"), h.grip === "closed" ? "CLOSED" : "OPEN");
        data($("kit-grip-row"), "closed", h.grip === "closed" ? "true" : "false");
        data($("kit"), "hot", hot ? "true" : "false");
        cssVar($("kit-heat"), "--heat", (Math.min(100, Math.max(0, h.heat)) / 100).toFixed(3));
        data($("kit-heat-row"), "state", hs);
        text($("kit-heat-value"), formatInt(h.heat));
      }

      function updateEdges(hud: HudFrame): void {
        const j = hud.juice.edge;
        cssVar($("edges"), "--edge-color", j.color);
        style($("edge-left"), "opacity", Math.min(1, Math.max(0, j.left)).toFixed(3));
        style($("edge-right"), "opacity", Math.min(1, Math.max(0, j.right)).toFixed(3));
        style($("edge-top"), "opacity", Math.min(1, Math.max(0, j.top)).toFixed(3));
      }

      function updateDamage(t: number): void {
        model.expire(t);
        const cam = game.view.camera;
        let shown = 0;
        dmgPlacedCount = 0;
        for (let i = 0; i < DAMAGE_POOL_SIZE; i++) {
          const sl = model.slots[i];
          const node = $(dmgKeys[i].node);
          if (!node) continue;
          if (!sl.active || !cam) { data(node, "show", "false"); continue; }
          projectSimPoint(sl.pos, cam, width, height, proj);
          if (proj[3] === 0) { data(node, "show", "false"); continue; }
          dmgX[i] = proj[0] + sl.jitterPx;
          dmgY[i] = proj[1] - 16;
          dmgOrder[shown++] = i;
        }
        for (let a = 1; a < shown; a++) {
          const v = dmgOrder[a];
          let b = a - 1;
          while (b >= 0 && model.slots[dmgOrder[b]].popMs < model.slots[v].popMs) { dmgOrder[b + 1] = dmgOrder[b]; b--; }
          dmgOrder[b + 1] = v;
        }
        for (let k = 0; k < shown; k++) {
          const i = dmgOrder[k];
          const sl = model.slots[i];
          const changed = dmgRevision[i] !== sl.revision;
          if (!changed && !dmgStale) continue;
          const keys = dmgKeys[i];
          const node = $(keys.node);
          if (changed) {
            const merged = dmgRevision[i] >= 0 && sl.bornMs !== sl.popMs;
            dmgRevision[i] = sl.revision;
            text($(keys.num), sl.graze ? "" : formatInt(sl.value));
            text($(keys.tag), sl.graze ? grazeTag(sl.vN) : sl.crit ? `CRIT${SEP}${formatSpeed(sl.vN)}` : impactTag(sl.vN));
            style($(keys.num), "fontSize", `calc(${damageNumberPx(sl.magnitude, sl.crit, sl.guarded)}px * var(--hud-scale))`);
            data(node, "kind", sl.graze ? "graze" : sl.guarded ? "guarded" : sl.crit ? "crit" : "hit");
            data(node, "merge", merged ? "true" : "false");
            replay(node);
          }
          // The only layout read in the HUD, and only when a label's text or the HUD's size changed.
          const box = node?.getBoundingClientRect();
          if (box && box.width > 0) { dmgHalfW[i] = box.width / 2; dmgH[i] = box.height; }
        }
        dmgStale = false;
        let maxW = 0, maxH = 0;
        for (let k = 0; k < shown; k++) { const i = dmgOrder[k]; maxW = Math.max(maxW, dmgHalfW[i] * 2); maxH = Math.max(maxH, dmgH[i]); }
        spreadLabels(dmgX, dmgY, dmgOrder, shown, Math.max(LABEL_GAP_X, maxW + 4), Math.max(LABEL_GAP_Y, maxH * DAMAGE_POP_SCALE + 4));
        for (let k = 0; k < shown; k++) {
          const i = dmgOrder[k];
          const node = $(dmgKeys[i].node);
          const lo = topZone + dmgH[i] + DAMAGE_RISE_PX, hi = height - LABEL_EDGE_PX;
          if (k > 0 && dmgY[i] < lo) { data(node, "show", "false"); continue; }
          dmgY[i] = Math.min(hi, Math.max(lo, dmgY[i]));
          dmgX[i] = clampLabelX(dmgX[i], dmgHalfW[i], width);
          dmgPlaced[dmgPlacedCount++] = i;
          data(node, "show", "true");
          style(node, "transform", `translate3d(${dmgX[i].toFixed(1)}px, ${dmgY[i].toFixed(1)}px, 0)`);
        }
      }

      /** Whether a screen point (with a margin) falls inside any damage label placed this frame. */
      function underDamageLabel(x: number, y: number, margin: number): boolean {
        for (let k = 0; k < dmgPlacedCount; k++) {
          const i = dmgPlaced[k];
          if (Math.abs(x - dmgX[i]) < dmgHalfW[i] + margin && y > dmgY[i] - dmgH[i] - DAMAGE_RISE_PX - margin && y < dmgY[i] + margin) return true;
        }
        return false;
      }

      function updateCoreMarker(hud: HudFrame): void {
        const marker = $("core-marker");
        const cam = game.view.camera;
        const live = hud.core.visible && game.rules.state.core.phase === "live" && LIVE_PHASES.has(hud.phase) && cam !== null;
        if (!live || !cam) { data(marker, "show", "false"); return; }
        projectSimPoint(hud.core.worldPos, cam, width, height, proj);
        let x = proj[0], y = proj[1];
        const on = proj[2] === 1;
        data(marker, "show", on && underDamageLabel(x, y, CORE_MARKER_HALF_PX) ? "false" : "true");
        if (!on) {
          const cx = width / 2, cy = height / 2;
          const dx = x - cx, dy = y - cy;
          const sx = (width / 2 - EDGE_MARGIN_PX) / Math.max(1e-6, Math.abs(dx));
          const sy = (height / 2 - EDGE_MARGIN_PX) / Math.max(1e-6, Math.abs(dy));
          const k = Math.min(sx, sy);
          x = cx + dx * k; y = cy + dy * k;
          style($("core-marker-arrow"), "transform", `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`);
        }
        data(marker, "edge", on ? "false" : "true");
        style(marker, "transform", `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
        data(marker, "owner", hud.core.owner ?? "none");
        const p = hud.playerSeat;
        let near = false;
        if (p) {
          const ee = game.engine.frame.arms[p].eePos, c = hud.core.worldPos;
          near = Math.hypot(ee[0] - c[0], ee[1] - c[1], ee[2] - c[2]) < CORE_NEAR_M;
        }
        data(marker, "near", near ? "true" : "false");
      }

      /**
       * The crosshair node: the range ring from ReticleState (WP3's pilot publishes it; the frame's range cue is the
       * fallback) and the receipt under it, anchored on the projected ghost tip so the number lands where the
       * contact was aimed. The ring is a stroke-dasharray fill; nothing here allocates.
       */
      const pilotExt = game.pilot as Partial<Pick<PilotControllerExt, "reticle">>;
      function updateReceipt(hud: HudFrame, t: number): void {
        const el = $("receipt");
        const cam = game.view.camera;
        const show = receiptVisibleIn(hud.phase) && game.director.cameraMode === "cockpit";
        data(el, "show", show ? "true" : "false");
        if (!show) return;
        let x = width / 2, y = height / 2;
        if (hud.reticle.visible && cam) {
          projectSimPoint(hud.reticle.ghostTipWorld, cam, width, height, proj);
          if (proj[3] === 1) { x = proj[0]; y = proj[1]; }
        }
        style(el, "transform", `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
        const r = pilotExt.reticle ?? reticleFromCue(hud.reticle.rangeCue);
        cssVar(el, "--fill", r.fill.toFixed(3));
        data(el, "inrange", r.inRange ? "true" : "false");
        data(el, "guard", hud.reticle.guard ? "true" : "false");
        if (receiptUntil !== 0 && t >= receiptUntil) { receiptUntil = 0; data(el, "receipt", "false"); }
      }

      function updateGripTag(hud: HudFrame): void {
        const el = $("grip-tag");
        const p = hud.playerSeat;
        const cam = game.view.camera;
        if (gripTagUntil === 0 || !p || !cam) return;
        if (now() >= gripTagUntil) { gripTagUntil = 0; data(el, "show", "false"); return; }
        projectSimPoint(game.engine.frame.arms[otherSeat(p)].eePos, cam, width, height, proj);
        if (proj[3] === 0) { data(el, "show", "false"); return; }
        style(el, "transform", `translate3d(${proj[0].toFixed(1)}px, ${proj[1].toFixed(1)}px, 0)`);
      }

      /** One word dead centre: FIGHT on the bell, ROUND N / FINAL ROUND under the round intro. */
      function showSlam(label: string, kind: "engage" | "round" | "final", t: number): void {
        const el = $("countdown");
        slamLabel = label; slamShownAt = t;
        text($("countdown-text"), label);
        data(el, "kind", kind);
        data(el, "show", "true");
        replay(el);
      }

      function updateSlam(hud: HudFrame, t: number): void {
        const el = $("countdown");
        if (hud.phase === "round_intro" && game.director.config) {
          const roundWord = hud.bestOf > 1 && hud.finalRound ? "FINAL ROUND" : `ROUND ${hud.round}`;
          if (slamLabel !== roundWord) showSlam(roundWord, roundWord === "FINAL ROUND" ? "final" : "round", t);
          return;
        }
        if (slamLabel && t - slamShownAt >= FIGHT_SLAM_MS) { slamLabel = ""; data(el, "show", "false"); }
      }

      function updatePending(t: number): void {
        if (pendingKo) {
          const qd = game.engine.frame.arms[pendingKo.victim].qd;
          let speed = 0;
          for (let i = 0; i < 5; i++) speed = Math.max(speed, Math.abs(qd[i]));
          const age = t - pendingKo.at;
          if ((age >= KO_SETTLE_MIN_MS && speed < KO_SETTLE_SPEED) || age >= KO_SETTLE_MAX_MS) {
            pushBanner({ kind: "knockout", title: "KNOCKOUT", sub: nameOf(pendingKo.attacker), sticker: "SHORTED OUT", tier: "celebration", team: pendingKo.attacker, holdMs: 1100 });
            pendingKo = null;
          }
        }
        if (pendingLock && t >= pendingLock.at) {
          pushBanner({ kind: "locked", title: "LOCKED", sub: roundToLabel(nameOf(pendingLock.seat)), sticker: null, tier: "celebration", team: pendingLock.seat, holdMs: 1150 });
          pendingLock = null;
        }
        if (pendingOutro && t >= pendingOutro.at) {
          pendingOutro = null;
          const cfg = game.director.config;
          const ui = game.ui.get();
          const w = ui.roundsWon;
          const winner: Seat = w.atlas >= w.blaze ? "atlas" : "blaze";
          const p = cfg ? game.hud.playerSeat : null;
          if (p) {
            const won = winner === p;
            // The result slab names the cause (bible 8.2): never a bare DEFEAT.
            pushBanner({ kind: won ? "victory" : "defeat", title: resultSlab(won, lastRoundReason), sub: `${w[p]} - ${w[p === "atlas" ? "blaze" : "atlas"]}`, sticker: null, tier: "celebration", team: won ? p : null, holdMs: 2000 });
          } else {
            pushBanner({ kind: "victory", title: nameOf(winner), sub: "TAKES THE MATCH", sticker: null, tier: "celebration", team: winner, holdMs: 2000 });
          }
        }
        if (banners.update(t) || banners.revision !== bannerRevision) {
          bannerRevision = banners.revision;
          renderBanner();
        }
        if (takenUntil !== 0 && t >= takenUntil) { takenUntil = 0; data($("own-taken"), "show", "false"); }
        const clearedTags = tags.expire(t);
        for (let i = 0; i < TAG_SLOTS; i++) if (clearedTags & (1 << i)) data($(`tag-${i}`), "show", "false");
        if (callouts.update(t) || callouts.revision !== calloutRevision) renderCallout();
      }

      /**
       * One caption at a time, with prosody as data (bible 7): ramp 0..3 sets the weight, size and reveal speed;
       * a release line stretches its final word. Prompts (`prompt.*` line ids, WP6's tutorial script) carry a mouse
       * glyph instead of a host tag.
       */
      function updateCaption(t: number): void {
        const ui = game.ui.get();
        const settings = game.settings.get();
        const cap = ui.captions;
        const el = $("caption");
        cssVar(root, "--caption-scale", String(settings.access.captionScale));
        // The sparring round renders its one caption through WP6's tutorial overlay: host units stay off while it drives.
        const tutorialDriving = (game.director as Partial<{ tutorial: unknown }>).tutorial != null;
        const allowed = cap !== null && settings.audio.captions !== "off" && (settings.audio.captions === "full" || cap.priority <= 2)
          && (!tutorialDriving || cap.lineId.startsWith("prompt."));
        if (cap !== lastCaption) {
          lastCaption = cap;
          if (cap && allowed) {
            const host = HOSTS[cap.speaker];
            const prompt = cap.lineId.startsWith("prompt.");
            const { text: body, glyph } = captionGlyph(cap.text);
            const words = body.split(" ");
            const last = words.length > 1 ? words.pop() as string : "";
            const pro = captionProsody(cap);
            text($("caption-tag"), host.tag);
            data(el, "host", prompt ? "false" : "true");
            data(el, "glyph", glyph ?? "none");
            data(el, "lip", host.lip);
            data(el, "priority", String(cap.priority));
            data(el, "ramp", String(pro.ramp));
            data(el, "release", pro.release ? "true" : "false");
            const cps = prosodyFor(pro.ramp, pro.release).revealCps;
            const headLen = Math.max(0, body.length - last.length);
            // The head reveals first, then the last word picks up where it stopped: one typewriter, two spans.
            capShownAt = t; capBody = body; capLast = last; capHeadLen = headLen; capCps = cps; capShownChars = -1;
            data(el, "show", "true");
            replay(el);
            captionHideAt = t + Math.max(1200, cap.durationMs);
          } else {
            data(el, "show", "false");
          }
        } else if (cap && (!allowed || t > captionHideAt)) {
          data(el, "show", "false");
        }
        if (!cap || !allowed) return;
        // Reduced motion gets the whole line at once rather than a slower typewriter.
        const n = settings.access.reducedMotion
          ? capBody.length
          : Math.max(0, Math.floor(((t - capShownAt) * capCps) / 1000));
        const shown = Math.min(n, capBody.length);
        if (shown === capShownChars) return;
        capShownChars = shown;
        const head = capBody.slice(0, Math.min(shown, capHeadLen));
        text($("caption-text"), capLast && shown >= capHeadLen ? `${head} ` : head);
        text($("caption-last"), capLast.slice(0, Math.max(0, shown - capHeadLen)));
      }

      const STAT_FIELDS: readonly (keyof LiveSeatStats)[] = ["damage", "strikes", "crits", "guarded", "grazes", "deflects", "steals", "staggers", "fastest", "hardest", "faults"];
      const statKeys = Object.fromEntries(SEATS.map((s) => [s, Object.fromEntries(STAT_FIELDS.map((f) => [f, `stats-${s}-${f}`]))])) as Record<Seat, Record<keyof LiveSeatStats, string>>;

      function updateLowRate(hud: HudFrame, t: number): void {
        if (t - lastLowRate < LOW_RATE_MS) return;
        lastLowRate = t;
        if (statsOpen) {
          for (const s of SEATS) {
            text($(`stats-${s}-name`), nameOf(s));
            const st = liveStats[s];
            for (const f of STAT_FIELDS) {
              const v = st[f];
              text($(statKeys[s][f]), f === "fastest" ? formatSpeed(v) : formatInt(v));
            }
            text($(`stats-${s}-heat`), formatInt(hud.seats[s].heat));
          }
        }
        if (opts.debug) {
          let sum = 0, worst = 0;
          for (let i = 0; i < frameTimes.length; i++) { sum += frameTimes[i]; worst = Math.max(worst, frameTimes[i]); }
          const avg = sum / frameTimes.length;
          const clock = game.clock;
          const pilot = game.pilot;
          const audio = game.feedback.audio;
          text($("debug-text"), [
            `fps ${avg > 0 ? (1000 / avg).toFixed(1) : "0.0"}  frame ${avg.toFixed(2)} ms  worst ${worst.toFixed(1)} ms`,
            `phase ${hud.phase}  sim ${clock.simTime.toFixed(3)} s  alpha ${clock.alpha.toFixed(2)}  scale ${clock.timeScale.toFixed(2)}`,
            `hitstop ${clock.hitstopRemainingMs.toFixed(0)} ms  budget ${clock.hitstopBudgetUsedMs.toFixed(0)}/120 ms`,
            `stance ${pilot.stance.yaw.toFixed(3)} ${pilot.stance.elev.toFixed(3)}  look ${pilot.look.yawOffset.toFixed(3)} ${pilot.look.pitchOffset.toFixed(3)}`,
            `reach ${pilot.reach01.toFixed(2)}  device ${pilot.device}  last m ${lastMagnitude.toFixed(2)}  receipts ${receiptsSoFar}  pb ${pbMs === null ? "-" : pbMs.toFixed(2)}`,
            `juice yaw ${hud.juice.yaw.toFixed(4)} pitch ${hud.juice.pitch.toFixed(4)} fov ${hud.juice.fovOffsetDeg.toFixed(2)}`,
            `audio ${audio.latencyMs.toFixed(1)} ms  voices ${audio.activeVoices}  hype ${audio.hype.toFixed(2)}`,
          ].join("\n"));
        }
      }

      function update(): void {
        const t = now();
        const dt = t - lastFrame;
        lastFrame = t;
        frameTimes[frameIdx] = dt;
        frameIdx = (frameIdx + 1) % frameTimes.length;

        const hud = game.hud;
        const phase = hud.phase;
        data(root, "phase", phase);
        const visible = hudVisibleIn(phase);
        data(root, "tote", visible ? "true" : "false");
        data(root, "policyui", hud.showPolicyUi ? "true" : "false");
        const me = hud.playerSeat;
        data(root, "low", visible && me !== null && hud.seats[me].lowIntegrity ? "true" : "false");
        data(root, "sudden", visible && hud.suddenDeath ? "true" : "false");
        pollStatsHold();
        if (statsOpen && !statsHoldAllowed(phase)) closeStats();

        if (visible) {
          updateSeats(hud, t);
          updateClockAndCore(hud);
          updatePlayer(hud, t);
        }
        updateEdges(hud);
        updateDamage(t);
        updateCoreMarker(hud);
        updateReceipt(hud, t);
        updateGripTag(hud);
        updateSlam(hud, t);
        updatePending(t);
        updateCaption(t);
        updateLowRate(hud, t);
      }

      // The STATS key is rebindable (input/bindings.ts), so the overlay follows whatever the player bound it to.
      let statsCodes: readonly string[] = ["Tab"];
      const readStatsCodes = () => {
        statsCodes = resolveBindings(game.settings.get().controls.bindings).codesOf.get("stats") ?? [];
      };
      readStatsCodes();
      const offSettings = game.settings.subscribe(readStatsCodes);

      const pilotHolds = game.pilot as Partial<PilotControllerExt>;
      let statsKeyHeld = false;
      let statsPadHeld = false;

      const applyStats = () => {
        const open = (statsKeyHeld || statsPadHeld) && statsHoldAllowed(game.hud.phase);
        if (open === statsOpen) return;
        statsOpen = open;
        lastLowRate = 0;
        data($("stats"), "show", open ? "true" : "false");
      };
      const closeStats = () => { statsKeyHeld = false; statsPadHeld = false; applyStats(); };
      const pollStatsHold = () => {
        const held = pilotHolds.isUiHeld?.("stats") ?? false;
        if (held === statsPadHeld) return;
        statsPadHeld = held;
        applyStats();
      };

      const onKey = (ev: KeyboardEvent) => {
        if (!statsCodes.includes(ev.code) || isEditableTarget(ev.target)) return;
        if (!statsHoldAllowed(game.hud.phase)) { closeStats(); return; }
        ev.preventDefault();
        statsKeyHeld = ev.type === "keydown";
        applyStats();
      };
      const onBlur = () => { closeStats(); };

      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", onBlur);
      const offBus = game.bus.subscribe(onEvents);
      const offFrame = game.onAfterRender(update);
      applyKit();
      update();

      return () => {
        offFrame();
        offBus();
        offSettings();
        window.removeEventListener("resize", onResize);
        sizeWatch?.disconnect();
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        window.removeEventListener("blur", onBlur);
      };
    },
  };
}
