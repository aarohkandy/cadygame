// src/game/game-handle.ts (WP6)
// createGame(): wires every package factory into one GameHandle (GAME_DESIGN 10.2, 11.3; BUILD_PLAN section 5).
// The browser loop lives here: WP6 calls frameTick at useFrame priority -2 and runAfterRender at +2.
// Order per frame: sim steps (events queued on the bus) -> director wall-time update -> bus flush with the
// frame's FeedbackContext (feedback, VFX, HUD subscribers) -> feedback update -> HudFrame fill. No allocation
// in the steady state apart from the director's context object.

import {
  SEATS,
  type GameHandle, type GameView, type HudFrame, type MatchConfig, type PhysicsEngine, type Seat, type SessionMeta, type SettingsStore,
} from "./contracts.ts";
import type { SettingsStoreExtras } from "./core/settings.ts";
import type { PilotController } from "./contracts.ts";
import { createGameClock } from "./loop/game-clock.ts";
import { createSimDriver, type SeatBinding } from "./loop/sim-driver.ts";
import { createHeadlessMatchRunner } from "./loop/headless-runner.ts";
import { createMatchDirector, type SeatBindingFactory } from "./match/match-director.ts";
import { humanSeatOf, type EpisodeProvenanceSource } from "./match/match-config.ts";
import { createEventBus } from "./core/event-bus.ts";
import { createUiStore } from "./core/ui-store.ts";
import { createSettingsStore } from "./core/settings.ts";
import { createHudFrame, fillHudFrame, noteHudEvents, type HudFrameSource } from "./core/hud-frame.ts";
import { createPhysicsEngine } from "./physics/engine.ts";
import { createCombatRules } from "./combat/combat-rules.ts";
import { hitstopMsFor, tuning } from "./combat/tuning.ts";
import { createKinematics } from "./kinematics/so101-kinematics.ts";
import { createPilotController, type PilotControllerExt } from "./input/pilot-controller.ts";
import { createCockpitRig } from "./camera/cockpit-rig.ts";
import { createFeedbackSystem } from "./feedback/feedback-system.ts";
import { createSeatDriver } from "./policy/seat-drivers.ts";
import { createProxyBot } from "./policy/proxy-bots/index.ts";
import { createObservationBuilder, createObservationDelayLine } from "./policy/observation.ts";
import { createChunkExecutor } from "./policy/chunk-executor.ts";
import { OBS_SCHEMA_HASH } from "./policy/obs-schema.ts";
import { probeBridge, runRegistration } from "./policy/registration.ts";
import { createHarnessApi } from "./harness/harness-api.ts";
import { createEpisodeStore } from "./harness/episode-store.ts";
import { createEntrantStore } from "./harness/entrant-store.ts";
import { buildProvenanceSource } from "./harness/provenance.ts";
import { frameTiming } from "./render/frame-timing.ts";
import { memoryFrom, sharedProfile } from "./ui/meta/profile.ts";

/** Boot stages reported while the handle is built (GAME_DESIGN 7.3.1: labels come from real work). */
export interface CreateGameProgress { progress: number; label: string; }

export interface CreateGameOptions {
  onProgress?: (p: CreateGameProgress) => void;
}

function randomSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

function userAgent(): string {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  return nav?.userAgent ?? "unknown";
}

/** FNV-1a over a string: a stable, cheap fingerprint for the input mapping (never a secret). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** GPU class from the unmasked renderer string: a bucket, never the exact device (9: the block must not fingerprint). */
export function gpuTierOf(renderer: string): SessionMeta["device"]["gpuTier"] {
  if (/apple/i.test(renderer)) return "apple";
  if (/nvidia|geforce|rtx|radeon|\brx\b|arc\b/i.test(renderer)) return "discrete";
  if (/intel|iris|uhd|mali|adreno|powervr|llvmpipe|swiftshader/i.test(renderer)) return "integrated";
  return "unknown";
}

export function viewportBucketOf(heightPx: number): SessionMeta["device"]["viewportBucket"] {
  return heightPx <= 720 ? "≤720p" : heightPx <= 1080 ? "1080p" : heightPx <= 1440 ? "1440p" : ">1440p";
}

function rendererOf(canvas: HTMLCanvasElement | null): string {
  try {
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  } catch { return ""; }
}

/**
 * Episode /4 session block (bible 9, 11.9): who (random pilot id, callsign, consent), a non-fingerprinting device
 * block (buckets and rounded numbers only), the build, and the session index from the settings store.
 */
function buildSessionMeta(settings: SettingsStore & SettingsStoreExtras, pilot: PilotController, view: GameView): SessionMeta {
  const s = settings.get();
  const idx = settings.beginMatch();
  const win = (globalThis as { window?: Window }).window;
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const fps = frameTiming.fps;
  const p95 = frameTiming.frameMsP95 > 0 ? 1000 / frameTiming.frameMsP95 : fps;
  const to5 = (v: number) => (Number.isFinite(v) ? Math.round(v / 5) * 5 : 0);
  const standalone = win?.matchMedia?.("(display-mode: standalone)").matches === true;
  const form: SessionMeta["build"]["form"] = (globalThis as { Capacitor?: unknown }).Capacitor ? "capacitor"
    : /electron/i.test(nav?.userAgent ?? "") ? "electron" : standalone ? "pwa" : "web";
  return {
    pilotId: s.data.pilotId, callsign: s.profile.callsign,
    consent: { ...s.data.consent },
    device: {
      input: pilot.device === "gamepad" ? "gamepad" : pilot.device === "touch" ? "touch" : "mouse",
      pointerLock: (globalThis as { document?: Document }).document?.pointerLockElement != null,
      viewportBucket: viewportBucketOf(win?.innerHeight ?? 720),
      dpr: Math.round((win?.devicePixelRatio ?? 1) * 2) / 2,
      fpsP50: to5(fps), fpsP95: to5(p95),
      gpuTier: gpuTierOf(rendererOf(view.canvas)),
      mouseSensitivity: s.controls.sensitivity, invertY: s.controls.invertY, gamepadDeadzone: s.controls.padDeadzone,
    },
    build: {
      gitSha: process.env.NEXT_PUBLIC_GIT_SHA ?? "dev", appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev", form,
      inputMappingSha: fnv1a(JSON.stringify(s.controls.bindings)),
    },
    sessionIndex: idx.sessionIndex, matchIndexInSession: idx.matchIndexInSession, skillPrior: null,
  };
}

function browserSeats(pilotProxy: typeof createProxyBot): SeatBindingFactory {
  const factory: SeatBindingFactory = {
    async create(cfg: MatchConfig) {
      const out = {} as Record<Seat, SeatBinding>;
      try {
        for (const s of SEATS) {
          const spec = cfg.seats[s].driver;
          if (spec.kind === "human") out[s] = { kind: "pilot", proxy: null };
          else if (spec.kind === "proxy") out[s] = { kind: "pilot", proxy: pilotProxy(spec.bot) };
          else out[s] = { kind: "policy", driver: await createSeatDriver(spec, s) };
        }
      } catch (err) {
        factory.dispose(out);
        throw err;
      }
      return out;
    },
    dispose(bindings) {
      for (const s of SEATS) {
        const b = bindings[s];
        if (b?.kind === "policy") b.driver.dispose();
      }
    },
  };
  return factory;
}

export async function createGame(opts: CreateGameOptions = {}): Promise<GameHandle> {
  const report = (progress: number, label: string) => opts.onProgress?.({ progress, label });

  report(0.05, "loading mujoco.wasm");
  // The bar used to sit at 0.05 for the whole model download and then jump to 0.6, which reads as a hang —
  // and "it doesn't load right" is mostly what a frozen bar feels like. Walk it across the fetch instead.
  const engine: PhysicsEngine = await createPhysicsEngine({
    mode: "arcade",
    onFile: (done, total) => report(0.05 + 0.5 * (done / Math.max(1, total)), `loading arena · ${done}/${total}`),
  });
  report(0.6, `compiled ${engine.info.modelFile || "arena model"}`);

  const rules = createCombatRules(engine.info);
  const kinematics = createKinematics();
  const clock = createGameClock();
  const bus = createEventBus();
  const ui = createUiStore();
  const settings = createSettingsStore();
  const hud: HudFrame = createHudFrame();
  const view: GameView = { camera: null, canvas: null, lastPose: null };

  const pilot = createPilotController({
    kinematics, settings, clock, profileMatchesPlayed: () => settings.get().profile.matchesPlayed,
  });
  const cockpit = createCockpitRig();
  const feedback = createFeedbackSystem({ clock, ui, settings, bus, pilot, policy: () => sim.policy });
  feedback.audio.setVolumes(settings.get().audio);
  settings.subscribe(() => feedback.audio.setVolumes(settings.get().audio));
  bus.subscribe((events) => noteHudEvents(hud, events));
  // 3.2 / 3.3: strikes, clashes, whiffs, stagger and KO reach the pilot's body (action break, COMMIT flare, LED states).
  bus.subscribe((events) => (pilot as PilotControllerExt).onEvents(events));

  const observations = createObservationBuilder(engine.info);
  const store = createEpisodeStore("indexeddb");
  const entrants = createEntrantStore("indexeddb");
  const runner = createHeadlessMatchRunner({
    createEngine: createPhysicsEngine, createRules: createCombatRules, kinematics, observations,
    createSeatDriver, createPilot: createPilotController, createProxyBot,
    createRecorder: () => harness.createRecorder(),
  });
  const harness = createHarnessApi({
    createEngine: createPhysicsEngine, createRules: createCombatRules, createSeatDriver, observations, runner, store, entrants,
  });
  const replay = harness.createReplayPlayer(engine, clock, rules);
  report(0.75, "wiring match director");

  const sim = createSimDriver({
    engine, rules, clock, kinematics, observations,
    createDelayLine: createObservationDelayLine, createChunkExecutor, hitstopMsFor,
    pilot, bus,
    // WP6's arena-canvas drives this singleton; episodes record the real present-to-photon estimate.
    displayLatencyMs: () => frameTiming.displayLatencyMs(),
    obsSchemaHash: OBS_SCHEMA_HASH,
  });

  const provenance: EpisodeProvenanceSource = {
    tuning, tuningSha256: "", servoParamsHash: "", obsSchemaHash: OBS_SCHEMA_HASH,
    harnessCommit: process.env.NEXT_PUBLIC_GIT_SHA ?? "dev",
    userAgent: userAgent(),
  };
  // Hashing is async and nothing before the first match reads these; buildProvenanceSource fills the object in
  // place, so the director's reference stays valid. A failure here must never stop the game from booting.
  void buildProvenanceSource(
    { tuning, engine, obsSchemaHash: OBS_SCHEMA_HASH, harnessCommit: provenance.harnessCommit, userAgent: provenance.userAgent },
    provenance,
  ).catch(() => { /* provenance stays partially filled; episodes still record what is known */ });

  const director = createMatchDirector({
    sim, engine, rules, clock, ui, settings, pilot,
    seats: browserSeats(createProxyBot),
    harness: {
      createRecorder: () => harness.createRecorder(), moments: harness.moments, store,
      computeStats: (ep) => harness.computeStats(ep),
    },
    replay,
    provenance,
    nextSeed: randomSeed,
    now: () => new Date(),
    // Opponent memory (bible 4.5): profile.ts owns it; the director reads it at match start and writes it at the end.
    memory: {
      read: (opp) => sharedProfile().memory(opp),
      write: (opp, events, player, won) => sharedProfile().remember(opp, memoryFrom(events, player, won, sharedProfile().memory(opp))),
      lossStreak: (opp) => sharedProfile().lossStreak(opp),
    },
    session: () => buildSessionMeta(settings, pilot, view),
  });

  const hudSource: HudFrameSource = {
    phase: director.phase, round: 0, roundsWon: director.roundsWon, config: null, playerSeat: null,
    combat: rules.state, frame: engine.frame, pilot, juice: feedback.juice, clock,
    policies: sim.policy, matchesPlayed: 0,
  };

  const afterRender: (() => void)[] = [];

  const handle: GameHandle = {
    engine, rules, kinematics, clock, director, bus, pilot, cockpit, feedback, harness, observations,
    createSeatDriver, ui, settings, hud, view, replay, runRegistration, probeBridge,

    frameTick(wallDtS: number): void {
      const wall = Number.isFinite(wallDtS) && wallDtS > 0 ? wallDtS : 0;
      sim.frameTick(wall);
      director.update(wall);
      const ctx = director.feedbackContext(view.lastPose);
      bus.flush(ctx);
      feedback.update(wall, ctx, engine.frame);

      const cfg = director.config;
      hudSource.phase = director.phase;
      hudSource.round = director.round;
      hudSource.roundsWon = director.roundsWon;
      hudSource.config = cfg;
      hudSource.playerSeat = cfg ? humanSeatOf(cfg) : null;
      hudSource.combat = rules.state;
      hudSource.frame = engine.frame;
      hudSource.policies = sim.policy;
      hudSource.matchesPlayed = settings.get().profile.matchesPlayed;
      fillHudFrame(hud, hudSource, wall);
    },

    onAfterRender(fn: () => void): () => void {
      afterRender.push(fn);
      return () => {
        const i = afterRender.indexOf(fn);
        if (i >= 0) afterRender.splice(i, 1);
      };
    },

    runAfterRender(): void {
      for (let i = 0; i < afterRender.length; i++) afterRender[i]();
    },
  };

  report(0.8, "game ready");
  return handle;
}
