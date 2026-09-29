// src/game/render/camera-director.tsx (WP3)
// Applies the director's camera mode every frame at useFrame priority −1 (after frameTick, before the world):
// cockpit from WP3's CockpitRig (juice included), everything else from camera-math.ts. Mode changes blend
// (position lerp, orientation slerp, FOV lerp) except TV cuts into and out of replays. Writes game.view
// (camera, canvas, lastPose) and the sim-space camera for effects. No allocation per frame.
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { PerspectiveCamera, type Camera } from "three";
import type { CameraMode, GameEvent, Seat, Vec3 } from "../contracts.ts";
import { PHASE_MS } from "../match/match-director.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import {
  CAMERA_FAR, COCKPIT_NEAR, blendPose, cameraMath, copyPose, createCameraPose, type CameraMathParams,
} from "./camera-math.ts";
import { easeInOutCubic, renderToSimPos } from "./interpolate.ts";

export const MODE_BLEND_MS = 520;
export const LOBBY_BLEND_MS = 650;

function blendMsFor(from: CameraMode, to: CameraMode): number {
  if (to === "replay" || from === "replay") return 0;
  if (from === "intro" && to === "cockpit") return 0;
  if (to === "intro") return 0;
  if (from === "lobby" || to === "lobby") return LOBBY_BLEND_MS;
  return MODE_BLEND_MS;
}

export interface CameraDirectorView {
  attach(rt: StageRuntime, camera: Camera, canvas: HTMLCanvasElement): () => void;
  onEvents(rt: StageRuntime, events: readonly GameEvent[]): void;
  update(rt: StageRuntime, camera: Camera): void;
}

export function createCameraDirectorView(): CameraDirectorView {
  const target = createCameraPose();
  const from = createCameraPose();
  const out = createCameraPose();
  const lastPose = createCameraPose();
  let mode: CameraMode | null = null;
  let modeStartMs = 0;
  let blendMs = 0;
  let hadPose = false;
  const params: CameraMathParams = { timeMs: 0, progress01: 0, fast: false, focusSim: null };
  const focus: Vec3 = [0, 0, 0.1];
  let hasFocus = false;
  let replaySeat: Seat = "blaze";
  const fwd = new Float64Array(3);
  return {
    attach(rt, camera, canvas) {
      rt.game.view.camera = camera instanceof PerspectiveCamera ? camera : null;
      rt.game.view.canvas = canvas;
      // The pilot's mouse/keyboard input lives on the canvas; without this nothing reaches the arm.
      rt.game.pilot.attach(canvas);
      return () => {
        rt.game.pilot.detach();
        rt.game.view.camera = null; rt.game.view.canvas = null; rt.game.view.lastPose = null;
      };
    },
    onEvents(rt, events) {
      // Remember the deciding moment for the replay orbit (victim side and position).
      for (const e of events) {
        if (e.type === "ko" || (e.type === "strike" && e.tier === "strike")) {
          replaySeat = e.victim; focus[0] = e.pos[0]; focus[1] = e.pos[1]; focus[2] = e.pos[2]; hasFocus = true;
        } else if (e.type === "core" && (e.stage === "steal" || e.stage === "lock") && e.seat) {
          replaySeat = e.stage === "steal" && e.from ? e.from : e.seat === "atlas" ? "blaze" : "atlas";
          const f = rt.game.engine.frame;
          const o = e.seat === "atlas" ? 0 : 3;
          focus[0] = f.docks[o]; focus[1] = f.docks[o + 1]; focus[2] = 0.05; hasFocus = true;
        } else if (e.type === "phase" && e.phase === "round_intro") {
          hasFocus = false;
        }
      }
    },
    update(rt, camera) {
      const game = rt.game;
      const director = game.director;
      const now = rt.wallMs();
      const nextMode = director.cameraMode;
      const seat = director.cameraSeat;
      if (nextMode !== mode) {
        blendMs = mode === null || !hadPose ? 0 : blendMsFor(mode, nextMode);
        copyPose(lastPose, from);
        mode = nextMode;
        modeStartMs = now;
      }
      const elapsed = now - modeStartMs;
      params.timeMs = elapsed;
      params.fast = director.config?.fastShow ?? false;
      params.focusSim = null;
      switch (nextMode) {
        case "cockpit": {
          const pilot = game.hud.playerSeat === seat ? game.pilot : null;
          game.cockpit.compute(seat, pilot, game.feedback.juice, game.engine.frame, game.settings.get(), target);
          if (Math.abs(target.position[0]) + Math.abs(target.position[1]) + Math.abs(target.position[2]) < 1e-9) cameraMath.cockpit(seat, target, params);
          break;
        }
        case "intro": {
          const phase = director.phase;
          const total = phase === "rematch_intro" ? PHASE_MS.rematchIntro : params.fast ? PHASE_MS.matchIntro.fast : PHASE_MS.matchIntro.standard;
          const k = Math.min(1, director.phaseElapsedMs / total);
          params.progress01 = phase === "rematch_intro" ? 0.8 + 0.2 * k : k;
          cameraMath.intro(seat, target, params);
          break;
        }
        case "replay": {
          const phase = director.phase;
          const total = phase === "match_replay" ? PHASE_MS.matchReplay : phase === "round_replay" ? PHASE_MS.roundReplay : 6000;
          params.progress01 = phase === "replay_viewer" ? (director.phaseElapsedMs % total) / total : Math.min(1, director.phaseElapsedMs / total);
          params.focusSim = hasFocus ? focus : null;
          cameraMath.replay(replaySeat, target, params);
          break;
        }
        default:
          cameraMath[nextMode](seat, target, params);
      }
      if (blendMs > 0 && elapsed < blendMs) blendPose(from, target, easeInOutCubic(elapsed / blendMs), out);
      else copyPose(target, out);

      camera.position.set(out.position[0], out.position[1], out.position[2]);
      camera.quaternion.set(out.quaternion[0], out.quaternion[1], out.quaternion[2], out.quaternion[3]);
      if (camera instanceof PerspectiveCamera && (Math.abs(camera.fov - out.fovDeg) > 1e-4 || camera.near !== COCKPIT_NEAR || camera.far !== CAMERA_FAR)) {
        camera.fov = out.fovDeg;
        camera.near = COCKPIT_NEAR;
        camera.far = CAMERA_FAR;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      copyPose(out, lastPose);
      game.view.lastPose = lastPose;
      hadPose = true;
      renderToSimPos(out.position[0], out.position[1], out.position[2], rt.cameraSim);
      const e = camera.matrixWorld.elements;
      // Camera −Z in render space → sim direction (x, −z, y).
      fwd[0] = -e[8]; fwd[1] = -e[9]; fwd[2] = -e[10];
      rt.forwardSim[0] = fwd[0]; rt.forwardSim[1] = -fwd[2]; rt.forwardSim[2] = fwd[1];
    },
  };
}

export function CameraDirector(props: { rt: StageRuntime }): null {
  const { rt } = props;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const view = useMemo(() => createCameraDirectorView(), []);
  useEffect(() => view.attach(rt, camera, gl.domElement), [view, rt, camera, gl]);
  useEffect(() => rt.game.bus.subscribe((events) => view.onEvents(rt, events)), [view, rt]);
  useFrame(() => view.update(rt, camera), -1);
  return null;
}
