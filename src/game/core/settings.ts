// src/game/core/settings.ts (WP1)
// Player settings (GAME_DESIGN 7.3.8 with SCOPE 3 and BUILD_PLAN 2.2 applied), persisted in
// localStorage under `torquelimit.settings.v2`. Every read and write is wrapped in try/catch: private
// windows, blocked storage, quota errors, and corrupt JSON all fall back to defaults without breaking
// the game. Loading sanitizes against the schema below, which is also the migration: keys that no
// longer exist (operatorVoice, screenReaderVoice, ...) are dropped, new keys (hostVoice,
// controls.touch, data.*) get defaults, out-of-range numbers are clamped, and unknown enum values reset.
//
// EMOTION_BIBLE 9 (WP8): the `data` group holds consent and share settings; the pilot id is random and
// resettable only after DELETE MY DATA was acknowledged; prior ids live in `torquelimit.pilot.history`
// so a later delete can name them; the default callsign is generated (`PILOT-7F3A`) and a reject list
// refuses email-like or two-word names because the callsign is published. The playtest metrics ring
// (`torquelimit.metrics.v1`) lives here too: the exact device numbers never leave localStorage.

import type { DeepPartial, SessionMeta, Settings, SettingsStore } from "../contracts.ts";

export const SETTINGS_KEY = "torquelimit.settings.v2";
export const PILOT_HISTORY_KEY = "torquelimit.pilot.history";
export const METRICS_KEY = "torquelimit.metrics.v1";
export const METRICS_RING_SIZE = 256;
export const CONSENT_VERSION = "1";
/** A consent decision faster than this is not a decision (9): stored as `local`, the strip returns at match 5. */
export const CONSENT_MIN_DECISION_MS = 800;
export const CONSENT_STRIP_RETURN_MATCH = 5;
/** Keys written by earlier builds, read once for migration and then removed. */
export const LEGACY_SETTINGS_KEYS: readonly string[] = ["torquelimit.settings.v1", "torquelimit.settings"];

export type SettingsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SettingsDefaultsOptions {
  /** `prefers-reduced-motion: reduce`: camera motion and screen effects default to 30% (GAME_DESIGN 7.2). */
  reducedMotion?: boolean;
}

export function defaultSettings(opts: SettingsDefaultsOptions = {}): Settings {
  const reduced = opts.reducedMotion === true;
  return {
    controls: {
      sensitivity: 1.0,
      verticalMul: 0.8,
      invertY: false,
      padDeadzone: 0.12,
      bindings: {},                       // overrides only: action id → KeyboardEvent.code; empty uses input/bindings.ts
      touch: { mode: "auto", stickRadiusPx: 96, opacity01: 0.8 },
    },
    camera: { cockpit: "standard", fovDeg: 58, motion01: reduced ? 0.3 : 0.6, ghostOpacity01: 0.5 },
    audio: { master: 0.8, sfx: 1, music: 0.7, crowd: 0.8, voice: 0.9, captions: "full", hostVoice: false },
    video: { quality: "auto", effects01: reduced ? 0.3 : 1, damageNumbers: "on" },
    show: { fast: "auto" },
    access: { colorblind: false, reducedMotion: reduced, captionScale: 1 },
    profile: { callsign: "PILOT", tutorialDone: false, cockpitChosen: false, matchesPlayed: 0 },
    data: {
      pilotId: "",                        // generated on first load (see createSettingsStore)
      consent: { version: CONSENT_VERSION, grantedAt: null, scope: "local", decisionMs: null, inputMethod: null },
      shareUrl: false,
      deleteAckedAt: null,
      stripShownMatches: [],
      sessionIndex: 0, matchIndexInSession: 0, sessionStartedAt: null,
    },
  };
}

/* ───────────────────────── identity (9) ───────────────────────── */

function randomHex(bytes: number): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const buf = new Uint8Array(bytes);
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(buf);
  else for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < bytes; i++) out += buf[i].toString(16).padStart(2, "0");
  return out;
}

/** 128-bit random pilot id, hex. Never derived from the device. */
export function generatePilotId(): string {
  return randomHex(16);
}

/** `PILOT-7F3A`: the published default callsign, from the pilot id's first four hex digits. */
export function generateCallsign(pilotId: string): string {
  const tag = (pilotId.length >= 4 ? pilotId.slice(0, 4) : randomHex(2)).toUpperCase();
  return `PILOT-${tag}`;
}

export type CallsignRejection = "email" | "two_words" | "empty" | "too_long";

/** The reject list (9): the callsign is published, so it must not be an email address or a first-and-last name. */
export function callsignRejection(raw: string): CallsignRejection | null {
  const s = raw.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (s.length === 0) return "empty";
  if (/@/.test(s) || /\.[a-z]{2,}$/i.test(s)) return "email";
  if (/[A-Za-z]{2,}[\s._][A-Za-z]{2,}/.test(s)) return "two_words";
  if (s.length > CALLSIGN_MAX) return "too_long";
  return null;
}

/** Numeric ranges by dotted path. Every numeric setting has an entry. */
export const SETTINGS_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  "controls.sensitivity": [0.25, 3],
  "controls.verticalMul": [0.4, 1.2],
  "controls.padDeadzone": [0.05, 0.3],
  "controls.touch.stickRadiusPx": [56, 160],
  "controls.touch.opacity01": [0.2, 1],
  "camera.fovDeg": [50, 80],
  "camera.motion01": [0, 1],
  "camera.ghostOpacity01": [0, 1],
  "audio.master": [0, 1],
  "audio.sfx": [0, 1],
  "audio.music": [0, 1],
  "audio.crowd": [0, 1],
  "audio.voice": [0, 1],
  "video.effects01": [0, 1],
  "access.captionScale": [0.75, 2],
  "profile.matchesPlayed": [0, Number.MAX_SAFE_INTEGER],
  "data.sessionIndex": [0, Number.MAX_SAFE_INTEGER],
  "data.matchIndexInSession": [0, Number.MAX_SAFE_INTEGER],
};

/** Allowed values for every string-enum setting. */
export const SETTINGS_ENUMS: Readonly<Record<string, readonly string[]>> = {
  "controls.touch.mode": ["auto", "on", "off"],
  "camera.cockpit": ["standard", "stable"],
  "audio.captions": ["full", "big", "off"],
  "video.quality": ["auto", "high", "default", "low"],
  "video.damageNumbers": ["on", "merged", "off"],
  "show.fast": ["auto", "on", "off"],
  "data.consent.scope": ["local", "share"],
  "data.consent.version": [CONSENT_VERSION],
};

const INTEGER_PATHS = new Set(["profile.matchesPlayed", "controls.touch.stickRadiusPx", "data.sessionIndex", "data.matchIndexInSession"]);
const NULLABLE: Readonly<Record<string, "iso" | "ms" | "input">> = {
  "data.consent.grantedAt": "iso", "data.deleteAckedAt": "iso", "data.sessionStartedAt": "iso",
  "data.consent.decisionMs": "ms", "data.consent.inputMethod": "input",
};
const CALLSIGN_MAX = 16;
const BINDINGS_MAX = 64;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Rebuilds `base` from `input`, taking only known keys with valid values. Values in `input` that are
 * missing or invalid keep the value from `base`. Returns a fresh object tree.
 */
function sanitizeInto(base: Record<string, unknown>, input: unknown, path: string): Record<string, unknown> {
  const src = isRecord(input) ? input : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const p = path ? `${path}.${key}` : key;
    const def = base[key];
    const val = src[key];
    if (p === "controls.bindings") {
      const bindings: Record<string, string> = {};
      const from = isRecord(val) ? val : (def as Record<string, string>);
      let n = 0;
      for (const [action, code] of Object.entries(from)) {
        if (typeof code !== "string" || code.length === 0 || code.length > 32 || action.length > 32) continue;
        if (n++ >= BINDINGS_MAX) break;
        bindings[action] = code;
      }
      out[key] = bindings;
    } else if (NULLABLE[p]) {
      // Nullable fields (consent.grantedAt / decisionMs / inputMethod, deleteAckedAt, sessionStartedAt): the base may
      // hold a value while the patch clears it, so these are typed by the table, not by the base's current type.
      const kind = NULLABLE[p];
      if (val === undefined) out[key] = def;
      else if (val === null) out[key] = null;
      else if (kind === "iso") out[key] = typeof val === "string" && Number.isFinite(Date.parse(val)) ? val : def;
      else if (kind === "ms") out[key] = typeof val === "number" && Number.isFinite(val) && val >= 0 ? Math.round(val) : def;
      else out[key] = val === "pointer" || val === "keyboard" ? val : def;
    } else if (isRecord(def)) {
      out[key] = sanitizeInto(def, val, p);
    } else if (typeof def === "number") {
      const range = SETTINGS_RANGES[p];
      if (typeof val === "number" && Number.isFinite(val)) {
        let v = range ? Math.min(range[1], Math.max(range[0], val)) : val;
        if (INTEGER_PATHS.has(p)) v = Math.round(v);
        out[key] = v;
      } else {
        out[key] = def;
      }
    } else if (typeof def === "boolean") {
      out[key] = typeof val === "boolean" ? val : def;
    } else if (Array.isArray(def)) {
      out[key] = Array.isArray(val) ? val.filter((x) => typeof x === "number" && Number.isInteger(x) && x >= 0).slice(0, 64) : def.slice();
    } else if (typeof def === "string") {
      const allowed = SETTINGS_ENUMS[p];
      if (allowed) {
        out[key] = typeof val === "string" && allowed.includes(val) ? val : def;
      } else if (p === "profile.callsign") {
        const cleaned = typeof val === "string" ? val.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, CALLSIGN_MAX) : "";
        out[key] = cleaned.length > 0 && callsignRejection(cleaned) === null ? cleaned : def;
      } else if (p === "data.pilotId") {
        out[key] = typeof val === "string" && /^[0-9a-f]{32}$/.test(val) ? val : def;
      } else {
        out[key] = typeof val === "string" ? val : def;
      }
    } else {
      out[key] = def;
    }
  }
  return out;
}

/** Validates any parsed JSON (current or legacy shape) into complete Settings. */
export function sanitizeSettings(input: unknown, defaults: Settings = defaultSettings()): Settings {
  return sanitizeInto(defaults as unknown as Record<string, unknown>, input, "") as unknown as Settings;
}

/** Deep-merges a partial patch over settings. Records (bindings) are replaced, not merged. */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>, path: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const key of Object.keys(patch)) {
    const p = path ? `${path}.${key}` : key;
    const v = patch[key];
    if (v === undefined) continue;
    if (p !== "controls.bindings" && isRecord(v) && isRecord(target[key])) {
      out[key] = mergePatch(target[key] as Record<string, unknown>, v, p);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function deepFreeze<T>(obj: T): T {
  if (isRecord(obj)) {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

function defaultStorage(): SettingsStorage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;                          // SecurityError when storage is blocked
  }
}

export interface CreateSettingsStoreOptions extends SettingsDefaultsOptions {
  /** Defaults to globalThis.localStorage when reachable; null keeps settings in memory only. */
  storage?: SettingsStorage | null;
}

export interface ConsentDecision { scope: "local" | "share"; decisionMs: number; inputMethod: "pointer" | "keyboard"; at?: Date }

export interface SettingsStoreExtras {
  /** Restores every default (keeps nothing) and persists. The pilot id survives: only resetPilotId() replaces it. */
  resetToDefaults(): void;
  /** Whether the last load or save reached storage. False in private or blocked contexts. */
  readonly persistent: boolean;
  /** Records the consent strip's answer (9). Under 800 ms it is not a decision: stored as `local`, strip returns at match 5. */
  recordConsent(d: ConsentDecision): SessionMeta["consent"];
  /** Whether the consent strip should be shown on this verdict (match 2, then at most once per session, match 5 after a fast answer). */
  consentStripDue(matchesPlayed: number): boolean;
  /** Marks the strip as shown for this matchesPlayed value (once per session). */
  consentStripShown(matchesPlayed: number): void;
  /** The delete request was sent and acknowledged; RESET PILOT ID unlocks. */
  acknowledgeDelete(at?: Date): void;
  /** New random pilot id and callsign; refused (returns false) until DELETE MY DATA was acknowledged. The old id joins the history. */
  resetPilotId(): boolean;
  /** Prior pilot ids (oldest first), for a later delete request to name. */
  pilotHistory(): string[];
  /** Session bookkeeping: a new session after `gapMs` (default 30 min) without a match. */
  beginMatch(now?: Date, gapMs?: number): { sessionIndex: number; matchIndexInSession: number };
}

export function createSettingsStore(opts: CreateSettingsStoreOptions = {}): SettingsStore & SettingsStoreExtras {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const defaults = defaultSettings(opts);
  const listeners = new Set<() => void>();
  let persistent = storage !== null;

  function load(): Settings {
    if (!storage) return defaults;
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      if (raw !== null) return sanitizeSettings(JSON.parse(raw), defaults);
      for (const legacyKey of LEGACY_SETTINGS_KEYS) {
        const legacy = storage.getItem(legacyKey);
        if (legacy === null) continue;
        let migrated = defaults;
        try { migrated = sanitizeSettings(JSON.parse(legacy), defaults); } catch { /* corrupt legacy data: defaults */ }
        storage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
        for (const k of LEGACY_SETTINGS_KEYS) storage.removeItem(k);
        return migrated;
      }
      return defaults;
    } catch {
      // Corrupt JSON or storage that throws on read. Start from defaults; the next set() rewrites the key.
      persistent = false;
      return defaults;
    }
  }

  function save(s: Settings): void {
    if (!storage) return;
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(s));
      persistent = true;
    } catch {
      persistent = false;                 // quota exceeded or blocked: keep working in memory
    }
  }

  let shownThisSession = false;
  let lastMatchAt = Number.NEGATIVE_INFINITY;
  const loaded = load();
  const identified = withIdentity(loaded);
  let current: Readonly<Settings> = deepFreeze(identified);
  let serialized = JSON.stringify(current);
  if (identified !== loaded) save(current);                             // the generated id and callsign persist at once

  /** A fresh profile gets its random id and the callsign derived from it; a legacy "PILOT" default is upgraded the same way. */
  function withIdentity(s: Settings): Settings {
    if (s.data.pilotId.length === 32 && s.profile.callsign !== "PILOT") return s;
    const pilotId = s.data.pilotId.length === 32 ? s.data.pilotId : generatePilotId();
    const callsign = s.profile.callsign === "PILOT" ? generateCallsign(pilotId) : s.profile.callsign;
    return { ...s, profile: { ...s.profile, callsign }, data: { ...s.data, pilotId } };
  }

  function readHistory(): string[] {
    if (!storage) return memoryHistory;
    try {
      const raw = storage.getItem(PILOT_HISTORY_KEY);
      const list: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    } catch { return memoryHistory; }
  }
  const memoryHistory: string[] = [];
  function writeHistory(list: string[]): void {
    memoryHistory.length = 0; memoryHistory.push(...list);
    if (!storage) return;
    try { storage.setItem(PILOT_HISTORY_KEY, JSON.stringify(list)); } catch { /* blocked: memory copy stands */ }
  }

  function commit(next: Settings): void {
    const text = JSON.stringify(next);
    if (text === serialized) return;
    current = deepFreeze(next);
    serialized = text;
    save(current);
    for (const fn of Array.from(listeners)) fn();
  }

  const api: SettingsStore & SettingsStoreExtras = {
    get: () => current,

    set(patch: DeepPartial<Settings>): void {
      if (!isRecord(patch)) return;
      const merged = mergePatch(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, "");
      commit(sanitizeSettings(merged, current as Settings));
    },

    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    resetToDefaults(): void {
      const d = defaultSettings(opts);
      commit({ ...d, profile: { ...d.profile, callsign: generateCallsign(current.data.pilotId) }, data: { ...d.data, pilotId: current.data.pilotId } });
    },

    get persistent(): boolean {
      return persistent;
    },

    recordConsent(d) {
      const at = (d.at ?? new Date()).toISOString();
      const fast = !(d.decisionMs >= CONSENT_MIN_DECISION_MS);
      const consent: SessionMeta["consent"] = {
        version: CONSENT_VERSION, grantedAt: at, scope: fast ? "local" : d.scope,
        decisionMs: Math.max(0, Math.round(d.decisionMs)), inputMethod: d.inputMethod,
      };
      api.set({ data: { consent } });
      return current.data.consent;
    },

    consentStripDue(matchesPlayed) {
      const c = current.data.consent;
      if (c.grantedAt !== null && (c.decisionMs ?? 0) >= CONSENT_MIN_DECISION_MS) return false;     // a real answer is final
      if (c.grantedAt !== null && matchesPlayed < CONSENT_STRIP_RETURN_MATCH) return false;        // a fast answer: back at match 5
      if (matchesPlayed < 2) return false;
      return !current.data.stripShownMatches.includes(matchesPlayed) && !shownThisSession;
    },

    consentStripShown(matchesPlayed) {
      shownThisSession = true;
      if (current.data.stripShownMatches.includes(matchesPlayed)) return;
      api.set({ data: { stripShownMatches: [...current.data.stripShownMatches, matchesPlayed].slice(-64) } });
    },

    acknowledgeDelete(at = new Date()) {
      api.set({ data: { deleteAckedAt: at.toISOString() } });
    },

    resetPilotId() {
      if (current.data.deleteAckedAt === null) return false;
      const history = readHistory();
      if (!history.includes(current.data.pilotId)) history.push(current.data.pilotId);
      writeHistory(history.slice(-32));
      const pilotId = generatePilotId();
      const d = defaultSettings(opts).data;
      api.set({ profile: { callsign: generateCallsign(pilotId) }, data: { ...d, pilotId } });
      return true;
    },

    pilotHistory() {
      return readHistory().slice();
    },

    beginMatch(now = new Date(), gapMs = 30 * 60 * 1000) {
      const d = current.data;
      const last = d.sessionStartedAt === null ? Number.NaN : Date.parse(d.sessionStartedAt);
      const newSession = !Number.isFinite(last) || now.getTime() - lastMatchAt > gapMs;
      lastMatchAt = now.getTime();
      const sessionIndex = newSession ? d.sessionIndex + 1 : d.sessionIndex;
      const matchIndexInSession = newSession ? 1 : d.matchIndexInSession + 1;
      if (newSession) shownThisSession = false;
      api.set({ data: { sessionIndex, matchIndexInSession, sessionStartedAt: newSession ? now.toISOString() : d.sessionStartedAt } });
      return { sessionIndex, matchIndexInSession };
    },
  };
  return api;
}

/* ───────────────────────── playtest metrics ring (8.5) ───────────────────────── */

export interface MetricsEvent { t: string; name: string; value?: number; extra?: Record<string, number | string | boolean> }

export interface MetricsRing {
  push(name: string, value?: number, extra?: MetricsEvent["extra"]): void;
  list(): MetricsEvent[];
  clear(): void;
}

/**
 * `torquelimit.metrics.v1`: a 256-entry ring in localStorage, read from the console during playtests
 * (`JSON.parse(localStorage["torquelimit.metrics.v1"])`). The exact device numbers (fps, viewport, dpr) may
 * live here and only here; the episode's device block is bucketed (SessionMeta).
 */
export function createMetricsRing(storage: SettingsStorage | null = defaultStorage(), now: () => Date = () => new Date()): MetricsRing {
  let mem: MetricsEvent[] = [];
  const read = (): MetricsEvent[] => {
    if (!storage) return mem;
    try {
      const raw = storage.getItem(METRICS_KEY);
      const list: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(list) ? (list as MetricsEvent[]) : [];
    } catch { return mem; }
  };
  const write = (list: MetricsEvent[]): void => {
    mem = list;
    if (!storage) return;
    try { storage.setItem(METRICS_KEY, JSON.stringify(list)); } catch { /* blocked or full: memory copy stands */ }
  };
  return {
    push(name, value, extra) {
      const e: MetricsEvent = { t: now().toISOString(), name };
      if (value !== undefined && Number.isFinite(value)) e.value = value;
      if (extra) e.extra = extra;
      const list = read();
      list.push(e);
      write(list.length > METRICS_RING_SIZE ? list.slice(list.length - METRICS_RING_SIZE) : list);
    },
    list() { return read().slice(); },
    clear() { write([]); },
  };
}

/* ───────────────────────── the session block (9, 11.9) ───────────────────────── */

export interface DeviceSample { input: SessionMeta["device"]["input"]; pointerLock: boolean; viewportH: number; dpr: number; fpsP50: number; fpsP95: number; gpuTier: SessionMeta["device"]["gpuTier"] }
export interface BuildFacts { gitSha: string; appVersion: string; form: SessionMeta["build"]["form"]; inputMappingSha: string }

export function viewportBucket(h: number): SessionMeta["device"]["viewportBucket"] {
  return h <= 720 ? "≤720p" : h <= 1080 ? "1080p" : h <= 1440 ? "1440p" : ">1440p";
}

/**
 * The non-fingerprinting session block: buckets, not numbers. dpr to 0.5, fps to 5, viewport in four buckets,
 * gpu as a class. Everything else is the player's own settings and consent.
 */
export function buildSessionMeta(s: Readonly<Settings>, device: DeviceSample, build: BuildFacts, skillPrior: SessionMeta["skillPrior"] = null): SessionMeta {
  const r5 = (v: number) => (Number.isFinite(v) ? Math.round(v / 5) * 5 : 0);
  return {
    pilotId: s.data.pilotId, callsign: s.profile.callsign,
    consent: { ...s.data.consent },
    device: {
      input: device.input, pointerLock: device.pointerLock, viewportBucket: viewportBucket(device.viewportH),
      dpr: Number.isFinite(device.dpr) ? Math.round(device.dpr * 2) / 2 : 1, fpsP50: r5(device.fpsP50), fpsP95: r5(device.fpsP95),
      gpuTier: device.gpuTier, mouseSensitivity: s.controls.sensitivity, invertY: s.controls.invertY, gamepadDeadzone: s.controls.padDeadzone,
    },
    build: { ...build },
    sessionIndex: s.data.sessionIndex, matchIndexInSession: s.data.matchIndexInSession, skillPrior,
  };
}
