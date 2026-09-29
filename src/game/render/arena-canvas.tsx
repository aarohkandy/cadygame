// src/game/render/arena-canvas.tsx (WP1)
// The R3F canvas (GAME_DESIGN 10.3, EMOTION_BIBLE 10.2): canvas configuration, frame priorities, game.view
// writes, the quality controller, pre-warm (and the re-prewarm plus program-count check after a tier change),
// the compile log, and the stage runtime every world component shares.
//   −3  frame timing begins, renderer counters reset
//   −2  game.frameTick(dt)
//   −1  CameraDirector
//    0  world components (arms, cubes, set, crowd, VFX update), tier changes at safe phases
//  0.4  shadow map marked for this frame, before any pass that draws shadow-receiving materials
//  0.5  jumbotron feed (≤ 15 Hz)
//  0.9  post uniforms from juice
//   +1  EffectComposer renders
//  1.2  ?debug readbacks
//  1.5  reticle overlay pass
//   +2  game.runAfterRender() (HUD runtime), frame timing ends
// The world root maps sim (x, y, z) to render (x·2.05, z·2.05, −y·2.05); everything under it is authored in
// sim metres.
"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { PCFShadowMap, type Camera, type Scene, type WebGLRenderer } from "three";
import { RENDER_SCALE, type GameHandle } from "../contracts.ts";
import { gpuTierOf } from "../game-handle.ts";
import { createTurboGate, type TurboGate } from "../loop/turbo-gate.ts";
import { MARKS } from "../brand/marks.ts";
import { createBlobShadows, type BlobShadows } from "./blob-shadows.ts";
import { BOOT_RESIZE } from "./boot-resize.ts";
import { createBitSticker } from "./brand-textures.ts";
import { CameraDirector } from "./camera-director.tsx";
import { CAMERA_FAR, COCKPIT_FOV_DEG, COCKPIT_NEAR } from "./camera-math.ts";
import { CubesView } from "./cubes-view.tsx";
import { DebugPanel, DebugScenes, useDebugMode } from "./debug-scenes.tsx";
import { frameTiming, type FrameTiming } from "./frame-timing.ts";
import { GhostArm } from "./ghost-arm.tsx";
import { StudioLighting } from "./lighting.tsx";
import { POST_PREWARM_FRAMES, PostStack } from "./post-stack.tsx";
import { prewarmScene } from "./prewarm.ts";
import { createQualityController, initialTierFor, LOCAL_LAYER, SCREEN_LAYER, tierDpr, type QualityController } from "./quality.ts";
import { ReticleOverlay } from "./reticle-overlay.tsx";
import { peekRobotAssets } from "./robot-assets.ts";
import { RobotView } from "./robot-view.tsx";
import { Stage } from "./stage.tsx";
import { createVfxSystem, type VfxSystem } from "./vfx/vfx-system.ts";

/** Everything a world component needs, created once per canvas. */
export interface StageRuntime {
  readonly game: GameHandle;
  readonly vfx: VfxSystem;
  readonly quality: QualityController;
  readonly blobs: BlobShadows;
  readonly timing: FrameTiming;
  /** Wall clock (ms) sampled once at the start of the frame. */
  wallMs(): number;
  colorblind(): boolean;
  /** Camera position and view direction in sim space, updated by the camera director. */
  readonly cameraSim: Float64Array;
  readonly forwardSim: Float64Array;
  /** Scenes drawn outside the main graph (the reticle overlay) that the prewarm must compile too. */
  readonly prewarmExtra: { scene: Scene; camera: Camera }[];
}

function createStageRuntime(game: GameHandle): StageRuntime & { setWall(ms: number): void; dispose(): void } {
  let wall = typeof performance !== "undefined" ? performance.now() : 0;
  const quality = createQualityController(game.settings.get().video.quality);
  const vfx = createVfxSystem({
    bus: game.bus, clock: game.clock, settings: game.settings,
    frame: () => game.engine.frame, combat: () => game.rules.state, phase: () => game.director.phase,
    nowMs: () => wall,
  });
  const sticker = createBitSticker(MARKS);
  vfx.confetti.setAtlas(sticker);
  const blobs = createBlobShadows();
  // The page-wide timing instance outlives a runtime (a new game handle, dev Fast Refresh): start its baseline over.
  frameTiming.reset();
  frameTiming.programsAfterPrewarm = -1;
  const unsubscribe = game.settings.subscribe(() => quality.syncSettings(game.settings.get().video.quality));
  return {
    game, vfx, quality, blobs, timing: frameTiming, prewarmExtra: [],
    wallMs: () => wall,
    setWall(ms: number) { wall = ms; },
    colorblind: () => game.settings.get().access.colorblind,
    cameraSim: new Float64Array(3),
    forwardSim: new Float64Array([1, 0, 0]),
    dispose() {
      unsubscribe();
      vfx.dispose();
      blobs.dispose();
      sticker?.dispose();
    },
  };
}

/** Programs in `gl.info.programs` not seen before, by name; remembers them. */
function newProgramNames(gl: WebGLRenderer, seen: Set<number>): string[] {
  const names: string[] = [];
  for (const p of gl.info.programs ?? []) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    // `name` is material.name (empty on most scene materials); `type` is the material class.
    names.push(p.name || (p as { type?: string }).type || "?");
  }
  return names;
}

/** The frame-priority callbacks, as methods so the canvas component only calls them. */
function createFrameLoop(rt: ReturnType<typeof createStageRuntime>) {
  let prewarmed = false;
  let readyFrames = 0;
  /** Frame index at which the program count is re-baselined after a prewarm (−1: none pending). */
  let baselineAt = -1;
  let frame = 0;
  let lastPhase = "";
  let warmReason = "boot";
  const seen = new Set<number>();
  const warm = (gl: WebGLRenderer, scene: Scene, camera: Camera, reason: string) => {
    rt.vfx.prewarmDraw();   // every pool draws one live instance so no VFX program compiles on first fire (11.9 Prewarmable)
    prewarmScene(gl, scene, camera, rt.prewarmExtra);
    baselineAt = frame + POST_PREWARM_FRAMES;
    warmReason = reason;
  };
  return {
    setup(gl: WebGLRenderer, camera: Camera): void {
      gl.shadowMap.autoUpdate = false;
      gl.info.autoReset = false;
      camera.layers.enable(LOCAL_LAYER);
      camera.layers.enable(SCREEN_LAYER);
    },
    begin(gl: WebGLRenderer): void {
      const now = performance.now();
      rt.setWall(now);
      rt.timing.beginFrame(now);
      gl.info.reset();
    },
    tick(dt: number): void {
      rt.game.frameTick(Math.min(dt, 0.1));
    },
    world(gl: WebGLRenderer, scene: Scene, camera: Camera, dt: number): void {
      frame++;
      const phase = rt.game.director.phase;
      if (phase !== lastPhase) {
        if (phase === "fight") rt.timing.markFight();
        if (phase === "round_intro" || phase === "boot_ritual") rt.timing.resetRound();
        lastPhase = phase;
      }
      // A tier that applied compiles nothing by design (post-stack.tsx); the re-prewarm covers whatever the tier
      // made visible for the first time, and the count is checked before the next round starts.
      if (rt.quality.applyIfSafe(phase) && prewarmed) warm(gl, scene, camera, `tier ${rt.quality.tier.id}`);
      rt.vfx.update(Math.min(dt, 0.1), rt.wallMs(), rt.cameraSim, rt.forwardSim, rt.quality.tier.confetti);
      if (!prewarmed && peekRobotAssets()) {
        readyFrames++;
        if (readyFrames === 2) {
          warm(gl, scene, camera, "boot");
          prewarmed = true;
        }
      }
    },
    // Marked before the jumbotron feed pass (0.5), not after it: shadow maps are created lazily inside
    // WebGLShadowMap.render(), and with autoUpdate off a pass that draws before the first update would bind
    // three's empty shadow texture to a sampler2DShadow without a compare mode, which ANGLE rejects.
    markShadows(gl: WebGLRenderer): void {
      gl.shadowMap.needsUpdate = true;
    },
    end(gl: WebGLRenderer): void {
      rt.game.runAfterRender();
      const info = gl.info;
      const programs = info.programs?.length ?? 0;
      const t = rt.timing;
      if (baselineAt >= 0 && frame >= baselineAt) {
        // Baseline (10.2 step 1): after prewarm + POST_PREWARM_FRAMES nothing may compile until the next safe phase.
        // A re-baseline after a tier change must find nothing new: what it does find is logged by name.
        const grew = newProgramNames(gl, seen);
        if (t.programsAfterPrewarm >= 0 && grew.length) {
          t.logCompile(`${lastPhase} ${warmReason}`, grew);
          if (process.env.NODE_ENV !== "production") console.warn(`[post] ${grew.length} program(s) compiled around the ${warmReason} prewarm: ${grew.join(", ")}`);
        }
        t.programsAfterPrewarm = programs;
        baselineAt = -1;
      } else if (baselineAt < 0 && t.programsAfterPrewarm >= 0 && programs > t.counters.programs) {
        const grew = newProgramNames(gl, seen);
        if (grew.length) {
          t.logCompile(lastPhase, grew);
          if (process.env.NODE_ENV !== "production") console.warn(`[post] program(s) compiled after prewarm in ${lastPhase}: ${grew.join(", ")}`);
        }
      }
      const j = rt.game.feedback.juice;
      t.sampleCamera((j.roll * 180) / Math.PI, j.fovOffsetDeg, j.trauma);
      t.endFrame(performance.now(), { calls: info.render.calls, triangles: info.render.triangles, programs });
    },
  };
}

function FrameLoop(props: { rt: ReturnType<typeof createStageRuntime> }): null {
  const { rt } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const setDpr = useThree((s) => s.setDpr);
  const loop = useMemo(() => createFrameLoop(rt), [rt]);

  useEffect(() => {
    loop.setup(gl, camera);
    // Development only: the headless probes on the server and the ?debug panels read the live scene graph.
    if (process.env.NODE_ENV !== "production") (globalThis as Record<string, unknown>).__tlR3F = { gl, scene, camera };
    // Seed the auto tier from the GPU before the first world frame; software and integrated parts start LOW.
    const ctx = gl.getContext();
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    rt.quality.seed(initialTierFor(gpuTierOf(ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "")));
    // The tier's pixel budget is a function of the canvas size, so re-derive on resize as well as on tier change.
    const apply = () => {
      const c = gl.domElement;
      setDpr(tierDpr(rt.quality.tier, window.devicePixelRatio, c.clientWidth, c.clientHeight));
    };
    apply();
    window.addEventListener("resize", apply);
    const un = rt.quality.subscribe(apply);
    return () => { window.removeEventListener("resize", apply); un(); };
  }, [gl, camera, scene, rt, setDpr, loop]);

  useFrame(() => loop.begin(gl), -3);
  useFrame((_, dt) => loop.tick(dt), -2);
  useFrame((_, dt) => loop.world(gl, scene, camera, dt), 0);
  useFrame(() => loop.markShadows(gl), 0.4);
  useFrame(() => loop.end(gl), 2);
  return null;
}

/**
 * The turbo render gate (`../loop/turbo-gate.ts`, which carries the reasoning and the measurements).
 *
 * The gate is switched imperatively through the R3F root the canvas hands back from `onCreated`, so it shuts
 * in the same turn as the ui change that opened the match instead of waiting for a React commit; the returned
 * flag only keeps the `frameloop` prop in step with the store the gate already switched. Nothing here starts a
 * match or steps the sim - the gate owns the pump.
 */
function useTurbo(game: GameHandle): { turbo: boolean; onCreated: (state: RootState) => void } {
  const [turbo, setTurbo] = useState(false);
  const root = useRef<RootState | null>(null);
  const gate = useRef<TurboGate | null>(null);
  useEffect(() => {
    const g = createTurboGate({
      game,
      setFrameloop: (mode) => root.current?.setFrameloop(mode),
      onChange: setTurbo,
    });
    gate.current = g;
    return () => { gate.current = null; g.dispose(); };
  }, [game]);
  // R3F re-applies the `frameloop` prop whenever the Canvas re-renders, so a commit that was already in flight
  // when the gate shut would hand the store back to "always". Re-assert the gate's answer after every commit:
  // it converges in the same frame and costs a comparison.
  useEffect(() => {
    const g = gate.current;
    if (g) root.current?.setFrameloop(g.turbo ? "never" : "always");
  });
  const onCreated = useCallback((state: RootState) => {
    root.current = state;
    // The canvas can be created while a turbo match is already up (a hot reload, a remount): adopt the gate's
    // current answer rather than leaving the fresh root drawing.
    if (gate.current?.turbo) state.setFrameloop("never");
  }, []);
  return { turbo, onCreated };
}

export function ArenaCanvas(props: { game: GameHandle }): JSX.Element {
  const { game } = props;
  const debug = useDebugMode();
  const rt = useMemo(() => createStageRuntime(game), [game]);
  useEffect(() => () => rt.dispose(), [rt]);
  const [dpr] = useState(() => tierDpr(rt.quality.tier, typeof window === "undefined" ? 1 : window.devicePixelRatio));
  // PostStack chooses which passes to mount from the tier, so a tier change has to remount it.
  const tierId = useSyncExternalStore(rt.quality.subscribe, () => rt.quality.tier.id, () => rt.quality.tier.id);
  const { turbo, onCreated } = useTurbo(game);

  return (
    <div className="absolute inset-0 bg-[#07081A]">
      <Canvas
        flat
        dpr={dpr}
        shadows={{ type: PCFShadowMap }}
        frameloop={turbo ? "never" : "always"}
        onCreated={onCreated}
        resize={BOOT_RESIZE}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false, depth: true }}
        camera={{ fov: COCKPIT_FOV_DEG, near: COCKPIT_NEAR, far: CAMERA_FAR, position: [0, 1, 2] }}
        className="absolute inset-0 touch-none"
      >
        <FrameLoop rt={rt} />
        <PerformanceMonitor
          bounds={(refresh) => (refresh > 100 ? [refresh * 0.72, refresh * 0.95] : [50, 58])}
          onDecline={() => rt.quality.decline()}
          onIncline={() => rt.quality.incline()}
        />
        <CameraDirector rt={rt} />
        <StudioLighting rt={rt} />
        <group scale={RENDER_SCALE} rotation={[-Math.PI / 2, 0, 0]} name="world-root">
          <Stage rt={rt} />
          <RobotView rt={rt} />
          <CubesView rt={rt} />
          <GhostArm rt={rt} />
          <primitive object={rt.vfx.group} />
          {debug ? <DebugScenes rt={rt} mode={debug} /> : null}
        </group>
        <PostStack key={tierId} rt={rt} />
        <ReticleOverlay rt={rt} />
      </Canvas>
      {debug ? <DebugPanel /> : null}
    </div>
  );
}
