import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONSENT_VERSION, METRICS_KEY, METRICS_RING_SIZE, PILOT_HISTORY_KEY, SETTINGS_KEY, SETTINGS_RANGES, LEGACY_SETTINGS_KEYS,
  buildSessionMeta, callsignRejection, createMetricsRing, createSettingsStore, defaultSettings, sanitizeSettings, viewportBucket,
} from "../src/game/core/settings.ts";
import { createUiStore, defaultUiState } from "../src/game/core/ui-store.ts";

/** Settings minus the per-profile identity (generated on first load). */
function withoutIdentity(s) {
  return { ...s, profile: { ...s.profile, callsign: "" }, data: { ...s.data, pilotId: "" } };
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("settings defaults (7.3.8 with SCOPE 3 and BUILD_PLAN 2.2)", () => {
  test("new keys have their decided defaults", () => {
    const s = defaultSettings();
    assert.equal(s.audio.hostVoice, false);
    assert.deepEqual(s.controls.touch, { mode: "auto", stickRadiusPx: 96, opacity01: 0.8 });
    assert.equal(s.camera.motion01, 0.6);
    assert.equal(s.camera.fovDeg, 58);
    assert.equal(s.controls.sensitivity, 1);
    assert.equal(s.controls.verticalMul, 0.8);
    assert.equal(s.show.fast, "auto");
    assert.ok(!("operatorVoice" in s.audio) && !("screenReaderVoice" in s.audio));
  });

  test("reduced motion defaults camera motion and screen effects to 30%", () => {
    const s = defaultSettings({ reducedMotion: true });
    assert.equal(s.camera.motion01, 0.3);
    assert.equal(s.video.effects01, 0.3);
    assert.equal(s.access.reducedMotion, true);
  });

  test("every default sits inside its declared range", () => {
    const s = defaultSettings();
    for (const [path, [lo, hi]] of Object.entries(SETTINGS_RANGES)) {
      const v = path.split(".").reduce((o, k) => o[k], s);
      assert.ok(typeof v === "number" && v >= lo && v <= hi, `${path} = ${v}`);
    }
  });
});

describe("settings store", () => {
  test("persists to torquelimit.settings.v2 and reloads", () => {
    const storage = memoryStorage();
    const a = createSettingsStore({ storage });
    a.set({ audio: { music: 0.25 }, camera: { cockpit: "stable" } });
    assert.ok(storage.map.has(SETTINGS_KEY));
    const b = createSettingsStore({ storage });
    assert.equal(b.get().audio.music, 0.25);
    assert.equal(b.get().camera.cockpit, "stable");
    assert.equal(b.get().audio.master, defaultSettings().audio.master, "untouched siblings keep defaults");
    assert.equal(a.persistent, true);
  });

  test("migrates an older key set: drops removed keys, adds hostVoice and controls.touch", () => {
    const v1 = {
      controls: { sensitivity: 1.6, verticalMul: 0.9, invertY: true, padDeadzone: 0.15, bindings: { guard: "KeyQ" } },
      camera: { cockpit: "stable", fovDeg: 70, motion01: 0.4, ghostOpacity01: 0.2 },
      audio: { master: 0.5, sfx: 0.9, music: 0.3, crowd: 0.6, voice: 0.7, captions: "big", operatorVoice: true, screenReaderVoice: true },
      profile: { callsign: "VOLTA", tutorialDone: true, cockpitChosen: true, matchesPlayed: 12, rep: 4000, medals: ["x"] },
      league: { tier: 3 },
    };
    const storage = memoryStorage({ [LEGACY_SETTINGS_KEYS[0]]: JSON.stringify(v1) });
    const s = createSettingsStore({ storage }).get();
    assert.equal(s.controls.sensitivity, 1.6);
    assert.equal(s.controls.invertY, true);
    assert.deepEqual(s.controls.bindings, { guard: "KeyQ" });
    assert.deepEqual(s.controls.touch, defaultSettings().controls.touch);
    assert.equal(s.audio.captions, "big");
    assert.equal(s.audio.hostVoice, false);
    assert.ok(!("operatorVoice" in s.audio) && !("screenReaderVoice" in s.audio));
    assert.ok(!("rep" in s.profile) && !("medals" in s.profile) && !("league" in s));
    assert.equal(s.profile.matchesPlayed, 12);
    const stored = JSON.parse(storage.map.get(SETTINGS_KEY));
    assert.equal(stored.audio.hostVoice, false);
    assert.ok(!storage.map.has(LEGACY_SETTINGS_KEYS[0]), "legacy key removed after migration");
  });

  test("a v2 document from an older build is sanitized the same way", () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ audio: { operatorVoice: true, voice: 0.4 } }) });
    const s = createSettingsStore({ storage }).get();
    assert.equal(s.audio.voice, 0.4);
    assert.ok(!("operatorVoice" in s.audio));
    assert.equal(s.audio.hostVoice, false);
  });

  test("corrupt JSON, throwing storage, and quota errors fall back without breaking", () => {
    const corrupt = createSettingsStore({ storage: memoryStorage({ [SETTINGS_KEY]: "{not json" }) });
    assert.deepEqual(withoutIdentity(corrupt.get()), withoutIdentity(defaultSettings()));

    const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {} };
    const blocked = createSettingsStore({ storage: throwing });
    assert.deepEqual(withoutIdentity(blocked.get()), withoutIdentity(defaultSettings()));
    blocked.set({ audio: { sfx: 0.5 } });
    assert.equal(blocked.get().audio.sfx, 0.5, "keeps working in memory");
    assert.equal(blocked.persistent, false);

    const full = memoryStorage();
    full.setItem = () => { throw new Error("QuotaExceededError"); };
    const q = createSettingsStore({ storage: full });
    q.set({ camera: { fovDeg: 70 } });
    assert.equal(q.get().camera.fovDeg, 70);
    assert.equal(q.persistent, false);

    const none = createSettingsStore({ storage: null });
    none.set({ show: { fast: "on" } });
    assert.equal(none.get().show.fast, "on");
  });

  test("invalid values are clamped or rejected", () => {
    const store = createSettingsStore({ storage: null });
    store.set({ camera: { fovDeg: 200, motion01: -1 }, controls: { sensitivity: Number.NaN, touch: { stickRadiusPx: 99.6, mode: "sometimes" } } });
    const s = store.get();
    assert.equal(s.camera.fovDeg, 80);
    assert.equal(s.camera.motion01, 0);
    assert.equal(s.controls.sensitivity, 1);
    assert.equal(s.controls.touch.stickRadiusPx, 100);
    assert.equal(s.controls.touch.mode, "auto");
    const generated = store.get().profile.callsign;
    assert.match(generated, /^PILOT-[0-9A-F]{4}$/, "the default callsign is generated");
    store.set({ profile: { callsign: "   " } });
    assert.equal(store.get().profile.callsign, generated);
    store.set({ profile: { callsign: "  a-very-long-callsign-name  " } });
    assert.equal(store.get().profile.callsign, "a-very-long-call");
    const odd = sanitizeSettings({ audio: { captions: 3, hostVoice: "yes" }, video: "high" });
    assert.equal(odd.audio.captions, "full");
    assert.equal(odd.audio.hostVoice, false);
    assert.deepEqual(odd.video, defaultSettings().video);
  });

  test("bindings are replaced as a whole, not merged", () => {
    const store = createSettingsStore({ storage: null });
    store.set({ controls: { bindings: { guard: "KeyQ", grip: "KeyF" } } });
    store.set({ controls: { bindings: { guard: "KeyE" } } });
    assert.deepEqual(store.get().controls.bindings, { guard: "KeyE" });
  });

  test("useSyncExternalStore contract: stable snapshot until a real change, then one notification", () => {
    const store = createSettingsStore({ storage: null });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const before = store.get();
    store.set({ audio: { master: before.audio.master } });
    assert.equal(store.get(), before, "no-op set keeps identity");
    assert.equal(calls, 0);
    store.set({ audio: { master: 0.1 } });
    assert.notEqual(store.get(), before);
    assert.equal(calls, 1);
    assert.ok(Object.isFrozen(store.get()) && Object.isFrozen(store.get().audio));
    off();
    store.set({ audio: { master: 0.2 } });
    assert.equal(calls, 1);
  });

  test("resetToDefaults restores every value", () => {
    const store = createSettingsStore({ storage: memoryStorage() });
    store.set({ audio: { hostVoice: true }, profile: { matchesPlayed: 3 } });
    const pilotId = store.get().data.pilotId;
    store.resetToDefaults();
    assert.deepEqual(withoutIdentity(store.get()), withoutIdentity(defaultSettings()));
    assert.equal(store.get().data.pilotId, pilotId, "the pilot id survives a settings reset");
  });
});

describe("data product settings (EMOTION_BIBLE 9)", () => {
  test("identity: a random 128-bit pilot id, the PILOT-XXXX callsign from it, persisted at once, and the reject list", () => {
    const storage = memoryStorage();
    const store = createSettingsStore({ storage });
    const { pilotId } = store.get().data;
    assert.match(pilotId, /^[0-9a-f]{32}$/);
    assert.equal(store.get().profile.callsign, `PILOT-${pilotId.slice(0, 4).toUpperCase()}`);
    assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).data.pilotId, pilotId, "persisted on first load");
    assert.equal(createSettingsStore({ storage }).get().data.pilotId, pilotId, "stable across loads");
    assert.equal(callsignRejection("someone@example.com"), "email");
    assert.equal(callsignRejection("jane.doe"), "email");
    assert.equal(callsignRejection("Jane Doe"), "two_words");
    assert.equal(callsignRejection("   "), "empty");
    assert.equal(callsignRejection("NEEDLE_7"), null);
    store.set({ profile: { callsign: "Jane Doe" } });
    assert.equal(store.get().profile.callsign, `PILOT-${pilotId.slice(0, 4).toUpperCase()}`, "a two-word name is refused: the callsign is published");
    store.set({ profile: { callsign: "NEEDLE_7" } });
    assert.equal(store.get().profile.callsign, "NEEDLE_7");
  });

  test("consent: a decision under 800 ms is stored as local and the strip returns at match 5; a real answer is final", () => {
    const store = createSettingsStore({ storage: memoryStorage() });
    assert.equal(store.consentStripDue(1), false, "never on the first verdict");
    assert.equal(store.consentStripDue(2), true, "the match-2 verdict");
    store.consentStripShown(2);
    assert.equal(store.consentStripDue(2), false, "once per session");
    const fast = store.recordConsent({ scope: "share", decisionMs: 300, inputMethod: "pointer", at: new Date("2026-09-26T10:00:00Z") });
    assert.equal(fast.scope, "local");
    assert.equal(fast.decisionMs, 300);
    assert.equal(fast.inputMethod, "pointer");
    assert.equal(fast.grantedAt, "2026-09-26T10:00:00.000Z");
    assert.equal(fast.version, CONSENT_VERSION);
    store.beginMatch(new Date("2026-09-26T12:00:00Z"));               // a new session
    assert.equal(store.consentStripDue(3), false);
    assert.equal(store.consentStripDue(5), true, "back at match 5 after a fast answer");
    const real = store.recordConsent({ scope: "share", decisionMs: 1400, inputMethod: "keyboard" });
    assert.equal(real.scope, "share");
    assert.equal(store.consentStripDue(5), false);
    assert.equal(store.consentStripDue(9), false, "final");
    assert.equal(store.get().data.consent.scope, "share");
  });

  test("RESET PILOT ID is refused until DELETE MY DATA is acknowledged; prior ids go to torquelimit.pilot.history", () => {
    const storage = memoryStorage();
    const store = createSettingsStore({ storage });
    const first = store.get().data.pilotId;
    assert.equal(store.resetPilotId(), false);
    assert.equal(store.get().data.pilotId, first);
    store.acknowledgeDelete(new Date("2026-09-26T10:00:00Z"));
    assert.equal(store.get().data.deleteAckedAt, "2026-09-26T10:00:00.000Z");
    assert.equal(store.resetPilotId(), true);
    const second = store.get().data.pilotId;
    assert.notEqual(second, first);
    assert.equal(store.get().profile.callsign, `PILOT-${second.slice(0, 4).toUpperCase()}`);
    assert.deepEqual(store.pilotHistory(), [first]);
    assert.deepEqual(JSON.parse(storage.getItem(PILOT_HISTORY_KEY)), [first]);
    assert.equal(store.get().data.deleteAckedAt, null, "a fresh id needs a fresh delete before the next reset");
  });

  test("sessions: a 30-minute gap starts a new session; the session block buckets the device and never carries exact numbers", () => {
    const store = createSettingsStore({ storage: null });
    assert.deepEqual(store.beginMatch(new Date("2026-09-26T10:00:00Z")), { sessionIndex: 1, matchIndexInSession: 1 });
    assert.deepEqual(store.beginMatch(new Date("2026-09-26T10:05:00Z")), { sessionIndex: 1, matchIndexInSession: 2 });
    assert.deepEqual(store.beginMatch(new Date("2026-09-26T11:00:00Z")), { sessionIndex: 2, matchIndexInSession: 1 });
    const meta = buildSessionMeta(store.get(), { input: "mouse", pointerLock: true, viewportH: 803, dpr: 1.7, fpsP50: 58.4, fpsP95: 71, gpuTier: "apple" }, { gitSha: "abc", appVersion: "0.1.0", form: "web", inputMappingSha: "m" }, 2);
    assert.equal(meta.device.viewportBucket, "1080p");
    assert.equal(meta.device.dpr, 1.5);
    assert.equal(meta.device.fpsP50, 60);
    assert.equal(meta.device.fpsP95, 70);
    assert.equal(meta.sessionIndex, 2);
    assert.equal(meta.matchIndexInSession, 1);
    assert.equal(meta.skillPrior, 2);
    assert.equal(meta.pilotId, store.get().data.pilotId);
    assert.deepEqual(Object.keys(meta.device).sort(), ["dpr", "fpsP50", "fpsP95", "gamepadDeadzone", "gpuTier", "input", "invertY", "mouseSensitivity", "pointerLock", "viewportBucket"]);
    assert.deepEqual([viewportBucket(720), viewportBucket(1440), viewportBucket(2160)], ["≤720p", "1440p", ">1440p"]);
  });

  test("the metrics ring keeps 256 entries in torquelimit.metrics.v1 and survives blocked storage", () => {
    const storage = memoryStorage();
    let n = 0;
    const ring = createMetricsRing(storage, () => new Date(Date.UTC(2026, 8, 26, 0, 0, n++)));
    for (let i = 0; i < 300; i++) ring.push("frame", i, { fps: 59 });
    const list = ring.list();
    assert.equal(list.length, METRICS_RING_SIZE);
    assert.equal(list[0].value, 300 - METRICS_RING_SIZE);
    assert.equal(list.at(-1).extra.fps, 59);
    assert.equal(JSON.parse(storage.getItem(METRICS_KEY)).length, METRICS_RING_SIZE);
    const blocked = createMetricsRing({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} });
    blocked.push("conversion");
    assert.equal(blocked.list().length, 1);
    ring.clear();
    assert.equal(ring.list().length, 0);
  });
});

describe("ui store (useSyncExternalStore-compatible)", () => {
  test("snapshot identity changes only when a field changes", () => {
    const ui = createUiStore();
    const s0 = ui.get();
    assert.deepEqual({ ...s0 }, defaultUiState());
    let calls = 0;
    const off = ui.subscribe(() => calls++);
    ui.set({ screen: "boot", overlay: null });
    assert.equal(ui.get(), s0);
    assert.equal(calls, 0);
    ui.set({ screen: "title", loading: null });
    assert.notEqual(ui.get(), s0);
    assert.equal(ui.get().screen, "title");
    assert.equal(calls, 1);
    assert.ok(Object.isFrozen(ui.get()));
    off();
    ui.set({ screen: "green_room" });
    assert.equal(calls, 1);
  });

  test("a listener may unsubscribe itself while being notified", () => {
    const ui = createUiStore();
    const order = [];
    const offA = ui.subscribe(() => { order.push("a"); offA(); });
    ui.subscribe(() => order.push("b"));
    ui.set({ round: 1 });
    ui.set({ round: 2 });
    assert.deepEqual(order, ["a", "b", "b"]);
  });

  test("reset replaces the whole state and notifies", () => {
    const ui = createUiStore({ screen: "match", round: 2 });
    let calls = 0;
    ui.subscribe(() => calls++);
    ui.reset();
    assert.equal(ui.get().screen, "boot");
    assert.equal(calls, 1);
  });
});
