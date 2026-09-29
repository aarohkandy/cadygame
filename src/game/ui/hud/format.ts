// src/game/ui/hud/format.ts (WP7)
// Every string and number the broadcast UI prints goes through here, so copy rules (caps labels, units, the
// middle-dot separator, tabular digits) and colour semantics (seat → team token, event → one meaning) live in
// one tested place (tests/hud-format.test.mjs). Pure functions; nothing here touches the DOM.

import type {
  AbilityId, ActionStatus, DriverSpec, EpisodeStats, GameEvent, LinkId, LoadoutId, MatchPreset, PersonalityId, RoundEndReason,
  Seat, ServoStateId, TierId, TokenColor,
} from "../../contracts.ts";

export const SEP = " · ";

/* ───────────────────────── numbers ───────────────────────── */

/** Round clock: whole seconds rounded up, m:ss. 0.2 s left still reads 0:01; exactly 0 reads 0:00. */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds - 1e-9)) : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Match or episode duration, m:ss from whole seconds (truncated). */
export function formatDuration(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Lock-in countdown: one decimal, never negative. */
export function formatLockIn(seconds: number): string {
  return (Number.isFinite(seconds) ? Math.max(0, seconds) : 0).toFixed(1);
}

/** Contact speed in m/s, 1 dp below 10 and 2 dp below 1 so grazes stay readable (0.31, 2.7, 12). */
export function formatSpeed(ms: number): string {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return `${v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0)} m/s`;
}

export function formatMs(ms: number): string {
  return `${Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0} ms`;
}

export function formatInt(n: number): string {
  return String(Number.isFinite(n) ? Math.round(n) : 0);
}

export function formatPercent(frac01: number, digits = 0): string {
  return `${(Number.isFinite(frac01) ? frac01 * 100 : 0).toFixed(digits)}%`;
}

/** Win rate with its bootstrap CI: `63% (54–71)`. */
export function formatRateCi(rate: number, lo: number, hi: number): string {
  const p = (x: number) => Math.round((Number.isFinite(x) ? x : 0) * 100);
  return `${p(rate)}% (${p(lo)}–${p(hi)})`;
}

export function formatBytes(bytes: number): string {
  const b = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/** Short hash for plates: first 6 hex digits, lower case. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 6).toLowerCase() : "------";
}

export function formatRecord(wins: number, losses: number): string {
  return `W ${formatInt(wins)}${SEP}L ${formatInt(losses)}`;
}

/** Local date and time for episode rows: `2026-09-16 14:05`. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "----------";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/* ───────────────────────── in-match tags ───────────────────────── */

export function impactTag(vN: number): string {
  return `IMPACT ${formatSpeed(vN)}`;
}

export function grazeTag(vN: number): string {
  return `GRAZE${SEP}${formatSpeed(vN)}`;
}

/** Damage number font size in px at the 1080p reference (7.4.2): (28 + 16·m), ×1.3 crit, ×0.85 guarded. */
export function damageNumberPx(magnitude: number, crit: boolean, guarded: boolean): number {
  const m = Math.min(1, Math.max(0, Number.isFinite(magnitude) ? magnitude : 0));
  const base = 28 + 16 * m;
  return Math.round(base * (crit ? 1.3 : 1) * (guarded ? 0.85 : 1));
}

export function servoStateTag(state: ServoStateId): string | null {
  switch (state) {
    case "stagger": case "micro_stagger": return "STAGGER";
    case "stun": return "STUNNED";
    case "cutout": return "CUTOUT";
    case "offline": return "OFFLINE";
    default: return null;
  }
}

/** Silhouette pip index (0 base … 5 gripper) for a struck link; the camera mount sits at the base. */
export function linkPip(link: LinkId): number {
  switch (link) {
    case "base": case "camera_mount": return 0;
    case "shoulder": return 1;
    case "upper_arm": return 2;
    case "lower_arm": return 3;
    case "wrist": return 4;
    case "gripper": case "moving_jaw": return 5;
  }
}

/** Ten integrity segments as fill fractions 0..1 (left to right). Writes into `out`. */
export function integritySegments(integrity: number, max: number, out: Float32Array): Float32Array {
  const n = out.length;
  const f = max > 0 ? Math.min(1, Math.max(0, integrity / max)) * n : 0;
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, f - i));
  return out;
}

/** The clock turns urgent (hazard edges, one beat per second) at 10 s and below. */
export const TIMER_URGENT_S = 10;
export function timerUrgent(seconds: number): boolean {
  return seconds <= TIMER_URGENT_S + 1e-9;
}

/* ───────────────────────── colour semantics ───────────────────────── */

/** Team token per seat: atlas (the pilot side) is cobalt, blaze (the AI side) is magenta. Always. */
export function seatToken(seat: Seat): Extract<TokenColor, "cobalt" | "magenta"> {
  return seat === "atlas" ? "cobalt" : "magenta";
}

/** The one token an event may colour a HUD element with (null: neutrals only). */
export function eventToken(e: GameEvent): TokenColor | null {
  switch (e.type) {
    case "strike":
      if (e.tier === "graze") return null;
      if (e.guarded) return "block";
      return e.crit ? "crit" : "strike";
    case "deflect": case "late_guard": return "block";
    case "core": return "volt";
    case "ko": return "strike";
    default: return null;
  }
}

/* ───────────────────────── names and labels ───────────────────────── */

export const PRESET_LABEL: Readonly<Record<MatchPreset, string>> = {
  arcade: "ARCADE", proving_ground: "PROVING GROUND", harness: "HARNESS",
};
export const TIER_LABEL: Readonly<Record<TierId, string>> = {
  rookie: "ROOKIE", contender: "CONTENDER", pro: "PRO", champion: "CHAMPION",
};
export const PERSONALITY_LABEL: Readonly<Record<PersonalityId, string>> = {
  overshoot: "OVERSHOOT", backlash: "BACKLASH", deadband: "DEADBAND", jig: "JIG",
};
export const PERSONALITY_STYLE: Readonly<Record<PersonalityId, string>> = {
  overshoot: "PRESSURE", backlash: "COUNTER-PUNCHER", deadband: "TRICKSTER", jig: "TEST RIG",
};
export const LOADOUT_LABEL: Readonly<Record<LoadoutId, string>> = { whip: "WHIP", pivot: "PIVOT", anvil: "ANVIL" };
export const ABILITY_LABEL: Readonly<Record<AbilityId, string>> = { snap: "SNAP", recoil_coil: "RECOIL COIL", bulwark: "BULWARK" };
export const REASON_LABEL: Readonly<Record<RoundEndReason, string>> = {
  ko: "KNOCKOUT", lock: "LOCKED", time: "TIME", sudden_death_strike: "SUDDEN DEATH", sudden_death_tiebreak: "TIEBREAK", forfeit: "FORFEIT",
};
export const STATUS_LABEL: Readonly<Record<ActionStatus | "disconnect" | "hang", string>> = {
  ok: "OK", held: "HELD", late: "LATE", timeout: "TIMEOUT", clamped: "CLAMPED", error: "ERROR", slow: "SLOW",
  disconnect: "DISCONNECT", hang: "HANG",
};

/** Nameplate driver tag (2.3): `BUILT-IN · PRO`, `USER MODEL · act_v3.mjs · sha 9f2c1a`, `LOCAL BRIDGE`. */
export function driverTag(spec: DriverSpec): string {
  switch (spec.kind) {
    case "human": return "PILOT";
    case "proxy": return "HUMAN PROXY";
    case "builtin": return `BUILT-IN${SEP}${TIER_LABEL[spec.tier]}`;
    case "module": return `USER MODEL${SEP}${spec.fileName}${SEP}sha ${shortSha(spec.sha256)}`;
    case "trajectory": return `TRAJECTORY${SEP}${spec.fileName}${SEP}sha ${shortSha(spec.sha256)}`;
    case "bridge": return `LOCAL BRIDGE${SEP}${spec.url}`;
  }
}

export type VerdictStamp = EpisodeStats["verdict"][Seat]["stamp"];

export function verdictLabel(stamp: VerdictStamp, reason: string | null): string {
  switch (stamp) {
    case "cleared": return "CLEARED FOR BROADCAST";
    case "fault": return reason ? `POLICY FAULT${SEP}${reason.toUpperCase()}` : "POLICY FAULT";
    case "arcade": return `ARCADE PHYSICS${SEP}NOT VERIFICATION`;
    case "none": return "NOT RATED";
  }
}

/** A round result line: `ROUND TO PILOT`. */
export function roundToLabel(name: string): string {
  return `ROUND TO ${name.toUpperCase()}`;
}

/* ───────────────────────── Core chip copy ───────────────────────── */

/** Every state the Core chip can be in, in the order the round reaches them. */
export type CoreChipState = "hidden" | "incoming" | "loose" | "contested" | "docked" | "carried" | "live";

export interface CoreChipInput {
  /** The Core exists on the deck this round. */
  visible: boolean;
  /** Rules phase: before the chute opens it is `incoming`. */
  incoming: boolean;
  /** Seconds until the Core drops, counted down for `incoming`. */
  dropInS: number;
  /** Seat holding the Core, or null while it is loose or still in the chute. */
  owner: Seat | null;
  /** True when the owner has it on their dock ring, so the countdown is running. */
  docked: boolean;
  contested: boolean;
  /** Nobody is holding it and it is on the deck. */
  loose: boolean;
  /** Lock-in seconds left. */
  remainingS: number;
}

export interface CoreChipCopy {
  state: CoreChipState;
  /** Caps word on the chip. */
  label: string;
  /** The number beside it, already formatted. */
  value: string;
  /** Hazard treatment: the round is about to be decided or taken. */
  urgent: boolean;
}

/** Lock-in inside this many seconds makes the chip urgent, the same beat the announcer calls. */
export const CORE_URGENT_S = 3;

/**
 * The one place that decides what the Core chip says (7.4). Every state the objective can be in gets its own
 * word, because "the Core is somewhere" is the single most common thing a viewer loses track of.
 */
export function coreChip(i: CoreChipInput): CoreChipCopy {
  if (!i.visible) return { state: "hidden", label: "", value: "", urgent: false };
  if (i.incoming) {
    return { state: "incoming", label: "DROP", value: formatInt(Math.max(0, Math.ceil(i.dropInS - 1e-9))), urgent: false };
  }
  const left = formatLockIn(i.remainingS);
  if (i.contested) return { state: "contested", label: "CONTESTED", value: left, urgent: true };
  if (i.loose) return { state: "loose", label: "LOOSE", value: left, urgent: false };
  if (i.owner) {
    const urgent = i.docked && i.remainingS <= CORE_URGENT_S + 1e-9;
    return i.docked
      ? { state: "docked", label: "LOCK-IN", value: left, urgent }
      : { state: "carried", label: "CARRIED", value: left, urgent: false };
  }
  return { state: "live", label: "CORE", value: "LIVE", urgent: false };
}

/* ───────────────────────── heat ───────────────────────── */

/** Heat reads as one of four states; 40 is where the arc appears, 70 is the warning, 100 is a cutout (4.6, 6.7). */
export type HeatState = "cool" | "warm" | "hot" | "cutout";
export const HEAT_WARM = 40;
export const HEAT_HOT = 70;

export function heatState(heat: number, cutout: boolean): HeatState {
  if (cutout) return "cutout";
  const h = Number.isFinite(heat) ? heat : 0;
  if (h >= HEAT_HOT) return "hot";
  if (h >= HEAT_WARM) return "warm";
  return "cool";
}

/** Combo bracket text: the multiplier reads as a count of unanswered hits. */
export function comboLabel(count: number): string {
  return `${formatInt(count)} HIT${count === 1 ? "" : "S"}`;
}

/**
 * The TURBO plate's proof-of-life line: `ROUND 2 · 0:31 · SIM 74.2 S`. In turbo the arena stops drawing, so
 * these three numbers moving are the only thing that separates a fast match from a hang (4.10, 5.9).
 */
export function turboLine(round: number, timeLeftS: number, simTimeS: number): string {
  const r = Number.isFinite(round) ? Math.max(1, Math.round(round)) : 1;
  const sim = Number.isFinite(simTimeS) ? Math.max(0, simTimeS) : 0;
  return `ROUND ${r}${SEP}${formatClock(timeLeftS)}${SEP}SIM ${sim.toFixed(1)} S`;
}

/* ───────────────────────── receipts (EMOTION_BIBLE 8.1) ───────────────────────── */

/** Word bands for the first receipts of a profile: SOFT below 1.0 m/s, SOLID to 1.8, HARD above. */
export const RECEIPT_SOLID_MS = 1.0;
export const RECEIPT_HARD_MS = 1.8;
/** How many receipts of a profile carry the word band before the number stands alone. */
export const RECEIPT_WORD_COUNT = 10;
/** A receipt stays under the crosshair this long. */
export const RECEIPT_HOLD_MS = 700;

export type ReceiptBand = "soft" | "solid" | "hard";

export function receiptBand(vN: number): ReceiptBand {
  const v = Number.isFinite(vN) ? vN : 0;
  return v > RECEIPT_HARD_MS ? "hard" : v >= RECEIPT_SOLID_MS ? "solid" : "soft";
}

export interface ReceiptCopy {
  /** Main text: `SOLID 1.4 m/s`, `1.4 m/s`, or `BLOCKED`. */
  text: string;
  band: ReceiptBand | "blocked";
  /** `+0.3` in volt beside the number when the contact beat the personal best; empty otherwise. */
  pb: string;
}

/**
 * The receipt every contact prints (8.1): a word plus the number for the first `RECEIPT_WORD_COUNT` receipts of a
 * profile, the number alone after; a guard prints BLOCKED alone; once a PB exists (one completed match) the delta
 * beside the number says by how much it was beaten.
 */
export function receiptCopy(i: { vN: number; guarded: boolean; receiptsSoFar: number; pbMs: number | null }): ReceiptCopy {
  if (i.guarded) return { text: "BLOCKED", band: "blocked", pb: "" };
  const band = receiptBand(i.vN);
  const speed = formatSpeed(i.vN);
  const text = i.receiptsSoFar < RECEIPT_WORD_COUNT ? `${band.toUpperCase()} ${speed}` : speed;
  const pb = i.pbMs !== null && Number.isFinite(i.pbMs) && i.vN > i.pbMs + 0.05 ? `+${(i.vN - i.pbMs).toFixed(1)}` : "";
  return { text, band, pb };
}

/* ───────────────────────── showKit gate table (EMOTION_BIBLE 2) ───────────────────────── */

/** Which HUD furniture a profile has earned, keyed on `matchesPlayed` at match start. The six base elements are always on. */
export interface ShowKit {
  /** Timer and round pips: match 2. */
  timer: boolean;
  /** OPEN / WHIP / PUNISH tags, DEFLECT caption, centre tags beyond the receipt: match 2. */
  tags: boolean;
  /** Heat gauge: match 3. */
  heat: boolean;
  /** Abilities and the kit panel: match 4. */
  kit: boolean;
  /** VALE's number lines: match 4 (matches 1 to 3 are coaching only). */
  valeNumbers: boolean;
  /** NEW PB stamps and the PB delta on receipts: after one completed match. */
  pb: boolean;
}

export function showKitFor(matchesPlayed: number): ShowKit {
  const n = Number.isFinite(matchesPlayed) ? Math.max(0, Math.floor(matchesPlayed)) : 0;
  return { timer: n >= 1, tags: n >= 1, heat: n >= 2, kit: n >= 3, valeNumbers: n >= 3, pb: n >= 1 };
}

/* ───────────────────────── verdict copy (EMOTION_BIBLE 8.2) ───────────────────────── */

/** The result slab names the cause; a loss is never a bare DEFEAT. */
export function resultSlab(won: boolean, reason: RoundEndReason | "time" | null): string {
  if (won) return "VICTORY";
  switch (reason) {
    case "ko": return "SHORTED OUT";
    case "lock": return "OUT-LOCKED";
    case "forfeit": return "FORFEIT";
    default: return "OUT-POINTED";
  }
}

export type GapKind = "lock" | "integrity" | "unguarded" | "hits" | "margin";

/** The gap line on a loss verdict: one named number, e.g. `LOCK 6.8 / 8.0 s`, `INTEGRITY 4 LEFT`, `2 UNGUARDED HOOKS`. */
export function gapLine(kind: GapKind, a: number, b = 0): string {
  switch (kind) {
    case "lock": return `LOCK ${formatLockIn(a)} / ${formatLockIn(b)} s`;
    case "integrity": return `INTEGRITY ${formatInt(a)} LEFT`;
    case "unguarded": return `${formatInt(a)} UNGUARDED HOOK${Math.round(a) === 1 ? "" : "S"}`;
    case "hits": return `${formatInt(a)} OF ${formatInt(b)} LANDED`;
    case "margin": return `LOST BY ${formatInt(a)}`;
  }
}
