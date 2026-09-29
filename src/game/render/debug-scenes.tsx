// src/game/render/debug-scenes.tsx (WP1)
// Verification scenes behind ?debug= (EMOTION_BIBLE 12.1), rendered inside the live game:
//   ?debug=feel       fps, frame and CPU p95, the worst frame since FIGHT, α, hit stop and budget, juice offsets,
//                     the per-round camera maxima (roll / FOV / trauma), stance and look, draw calls, triangles
//                     (incl. shadow and reflection), programs vs. the pre-warm baseline, the compile log
//                     (every program that appeared after the baseline, by name and phase), reticle error.
//   ?debug=greycard   an 18% grey card, a lit paper card, and a deck swatch on the deck under the calibrated
//                     rig; reads the displayed values back and checks 0.34 ± 0.03 and paper ≤ 0.75.
//   ?debug=contrast   fires a midline strike every 0.9 s and measures spark-to-background luminance
//                     contrast from the framebuffer (≥ 3:1).
//   ?debug=vfx        cycles every effect (strike, crit, graze, guarded, deflect, clash, lock, KO de-rez).
// The readout is a DOM panel updated imperatively at 4 Hz; nothing here commits React state per frame.
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useSyncExternalStore, type JSX } from "react";
import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, type Camera, type WebGLRenderer } from "three";
import { TOKEN_HEX, type GameEvent, type Vec3 } from "../contracts.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { createScreenPoint, projectSimToScreen } from "./camera-math.ts";
import type { NumArray } from "./interpolate.ts";
import { deckBaseHex } from "./deck-texture.ts";
import { reticleDebug } from "./reticle-overlay.tsx";
import { prewarmStatus } from "./prewarm.ts";
import { CALIBRATION, keyCosUpward, PAPER_ALBEDO_SCALE, predictDisplayValue, srgbDecode, srgbEncode } from "./quality.ts";

/** The calibration cards are 6 cm squares, which is a real object a viewer can size the deck against. */
const CARD_SIZE_M = 0.06;

export type DebugMode = "feel" | "greycard" | "contrast" | "vfx";
const MODES: readonly DebugMode[] = ["feel", "greycard", "contrast", "vfx"];

export function readDebugMode(search: string): DebugMode | null {
  const v = new URLSearchParams(search).get("debug");
  return v && (MODES as readonly string[]).includes(v) ? (v as DebugMode) : null;
}

export function useDebugMode(): DebugMode | null {
  return useSyncExternalStore(
    () => () => {},
    () => readDebugMode(window.location.search),
    () => null,
  );
}

/** Shared readout the DOM panel polls. */
export const debugReadout = { text: "" };

export function DebugPanel(): JSX.Element {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => { if (ref.current) ref.current.textContent = debugReadout.text; }, 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <pre
      ref={ref}
      className="pointer-events-none absolute top-[4vmin] left-[4vmin] z-50 max-w-[calc(100%-8vmin)] overflow-x-auto bg-[#0E0F14]/85 px-3 py-2 font-mono text-xs leading-5 text-[#F6F3EC]"
    />
  );
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

function luminanceAt(px: Uint8Array, i: number): number {
  return srgbDecode(px[i] / 255) * 0.2126 + srgbDecode(px[i + 1] / 255) * 0.7152 + srgbDecode(px[i + 2] / 255) * 0.0722;
}

export interface DebugView {
  readonly cards: readonly Mesh[];
  update(rt: StageRuntime, gl: WebGLRenderer, camera: Camera, size: { width: number; height: number }): void;
  dispose(): void;
}

export function createDebugView(mode: DebugMode): DebugView {
  const st = {
    lastText: 0, nextFire: 0, fireAt: -1, bg: 0, contrast: 0, contrastMin: Infinity, grey: NaN, paper: NaN, deck: NaN,
    px: new Uint8Array(21 * 21 * 4), sp: createScreenPoint(), sp2: createScreenPoint(), half: 10, gallery: 0,
  };
  const geo = new PlaneGeometry(CARD_SIZE_M, CARD_SIZE_M);
  const mats = mode === "greycard" ? [
    new MeshStandardMaterial({ color: new Color(0.18, 0.18, 0.18), roughness: 1, metalness: 0 }),
    new MeshStandardMaterial({ color: new Color(TOKEN_HEX.paper).multiplyScalar(PAPER_ALBEDO_SCALE), roughness: 1, metalness: 0 }),
    new MeshStandardMaterial({ color: new Color(deckBaseHex()), roughness: 1, metalness: 0 }),
  ] : [];
  const cardAt: Vec3[] = [[-0.08, -0.2, 0.001], [0, -0.2, 0.001], [0.08, -0.2, 0.001]];
  const meshes = mats.map((m, i) => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(cardAt[i][0], cardAt[i][1], cardAt[i][2]);
    mesh.name = `greycard-${i}`;
    return mesh;
  });
  const cards = mode === "greycard" ? { at: cardAt } : null;
  let gl: WebGLRenderer | null = null;
  let size = { width: 1, height: 1 };
  /**
   * Reads a square centred on (x, y) whose half-width is `st.half` device pixels. A fixed 21 × 21 block
   * overspills a 6 cm card seen from the cockpit camera — it then averages the deck behind it and reports
   * paper darker than grey, which is physically impossible and is why the cockpit reading disagreed with
   * the wide one. `st.half` is set from the card's projected size before each read.
   */
  const readSquare = (x: number, y: number, reduce: (a: number, b: number) => number, init: number): number => {
    if (!gl) return NaN;
    const ctx = gl.getContext();
    const dpr = gl.getPixelRatio();
    const h = st.half, side = h * 2 + 1, n = side * side;
    const cx = Math.round(x * dpr), cy = Math.round((size.height - y) * dpr);
    ctx.readPixels(cx - h, cy - h, side, side, ctx.RGBA, ctx.UNSIGNED_BYTE, st.px);
    let acc = init;
    for (let i = 0; i < n * 4; i += 4) acc = reduce(acc, luminanceAt(st.px, i));
    return acc;
  };
  const readBlock = (x: number, y: number): number =>
    readSquare(x, y, (a, b) => a + b, 0) / ((st.half * 2 + 1) ** 2);
  const readPeak = (x: number, y: number): number => readSquare(x, y, Math.max, 0);
  /** Half-width in device pixels of a block that stays inside a CARD_SIZE_M card, from its projected width. */
  const halfFor = (at: Vec3, view: NumArray, proj: NumArray): number => {
    if (!gl) return 10;
    projectSimToScreen([at[0] + CARD_SIZE_M * 0.30, at[1], at[2]], view, proj, size.width, size.height, st.sp2);
    const px = Math.abs(st.sp2.x - st.sp.x) * gl.getPixelRatio();
    return Math.max(2, Math.min(10, Math.floor(px)));
  };
  return {
    cards: meshes,
    update(rt, renderer, camera, viewport) {
      gl = renderer;
      size = viewport;
      const now = rt.wallMs();
      const view = camera.matrixWorldInverse.elements;
      const proj = camera.projectionMatrix.elements;
      if (mode === "greycard" && cards) {
        const vals: number[] = [];
        for (const at of cards.at) {
          projectSimToScreen(at, view, proj, size.width, size.height, st.sp);
          st.half = halfFor(at, view, proj);
          const lum = st.sp.visible ? readBlock(st.sp.x, st.sp.y) : NaN;
          vals.push(lum > 0 ? srgbEncode(lum) : NaN);
        }
        [st.grey, st.paper, st.deck] = vals;
      }
      if (mode === "contrast") {
        const mid: Vec3 = [0, 0, 0.12];
        projectSimToScreen(mid, view, proj, size.width, size.height, st.sp);
        st.half = 10;
        if (st.fireAt < 0 && now >= st.nextFire) {
          st.bg = readBlock(st.sp.x, st.sp.y);
          const strike: GameEvent = {
            type: "strike", t: 0, step: 0, tier: "strike", attacker: "atlas", victim: "blaze", raw: 30, damage: 30, physicalDamage: 30,
            nu: 1, vN: 2.4, zone: "upper_arm", tool: "gripper", crit: false, guarded: false, heavyC: 0, armoured: false,
            pos: mid, normal: [1, 0, 0], magnitude: 0.8, lethal: false, upgrade: false, thrownCube: -1,
          };
          rt.vfx.handle([strike], null);
          st.fireAt = now;
        } else if (st.fireAt >= 0 && now - st.fireAt > 50) {
          const peak = readPeak(st.sp.x, st.sp.y);
          st.contrast = (Math.max(peak, st.bg) + 0.05) / (Math.min(peak, st.bg) + 0.05);
          st.contrastMin = Math.min(st.contrastMin, st.contrast);
          st.fireAt = -1;
          st.nextFire = now + 900;
        }
      }
      if (mode === "vfx" && now >= st.nextFire) {
        st.nextFire = now + 700;
        const k = st.gallery++ % 8;
        const pos: Vec3 = [0.02 * ((k % 3) - 1), 0, 0.12];
        const base = { t: 0, step: 0 };
        const strike = (o: Partial<Extract<GameEvent, { type: "strike" }>>): GameEvent => ({
          ...base, type: "strike", tier: "strike", attacker: "atlas", victim: "blaze", raw: 20, damage: 20, physicalDamage: 20, nu: 1, vN: 2,
          zone: "wrist", tool: "gripper", crit: false, guarded: false, heavyC: 0, armoured: false, pos, normal: [1, 0, 0], magnitude: 0.7,
          lethal: false, upgrade: false, thrownCube: -1, ...o,
        });
        const events: GameEvent[] =
          k === 0 ? [strike({})] :
          k === 1 ? [strike({ crit: true, magnitude: 1 })] :
          k === 2 ? [strike({ tier: "graze", magnitude: 0.1 })] :
          k === 3 ? [strike({ guarded: true })] :
          k === 4 ? [{ ...base, type: "deflect", defender: "atlas", attacker: "blaze", hard: true, pressLeadMs: 60, pos, normal: [1, 0, 0] }] :
          k === 5 ? [{ ...base, type: "clash", pos, normal: [1, 0, 0], magnitude: 0.8, heavyWinner: null }] :
          k === 6 ? [{ ...base, type: "core", stage: "lock", seat: "atlas", from: null, remainingS: 0, late: false, inherited: false }] :
          [{ ...base, type: "ko", victim: "blaze", attacker: "atlas", pos }];
        rt.vfx.handle(events, "atlas");
        if (k === 7) window.setTimeout(() => rt.vfx.derez.onPhase("round_intro", rt.wallMs()), 2600);
      }

      if (now - st.lastText < 250) return;
      st.lastText = now;
      const game = rt.game;
      const t = rt.timing;
      const lines: string[] = [];
      lines.push(`DEBUG ${mode.toUpperCase()}  tier ${rt.quality.tier.id}  dpr ${fmt(gl.getPixelRatio(), 2)}`);
      lines.push(`fps ${fmt(t.fps, 0)}  frame p95 ${fmt(t.frameMsP95)} ms  worst since FIGHT ${fmt(t.worstFrameMs)} ms  cpu p95 ${fmt(t.cpuMsP95, 2)} ms  latency ${fmt(t.displayLatencyMs(), 0)} ms`);
      const flat = t.programsAfterPrewarm < 0 ? "" : t.counters.programs === t.programsAfterPrewarm ? "  FLAT" : "  GREW";
      lines.push(`draw calls ${t.counters.calls}  triangles ${t.counters.triangles}  programs ${t.counters.programs} (prewarm ${t.programsAfterPrewarm})${flat}  prewarm ${prewarmStatus.passes}× ${fmt(prewarmStatus.ms, 0)} ms ${prewarmStatus.ready ? "linked" : "linking"}`);
      if (mode === "feel" || mode === "contrast" || mode === "vfx") {
        const j = game.feedback.juice;
        const pilot = game.pilot;
        lines.push(`alpha ${fmt(game.clock.alpha, 3)}  hitstop ${fmt(game.clock.hitstopRemainingMs, 0)} ms  budget ${fmt(game.clock.hitstopBudgetUsedMs, 0)}/120 ms`);
        lines.push(`juice yaw ${fmt((j.yaw * 180) / Math.PI, 2)} pitch ${fmt((j.pitch * 180) / Math.PI, 2)} roll ${fmt((j.roll * 180) / Math.PI, 2)} fov ${fmt(j.fovOffsetDeg, 2)}`);
        const m = t.roundMax;
        lines.push(`round max roll ${fmt(m.rollDeg, 2)}° (≤ 3)  fov ${fmt(m.fovDeg, 2)}° (≤ 6)  trauma ${fmt(m.trauma, 2)} (≤ 0.35)`);
        for (const entry of t.compileLog.slice(-6)) lines.push(`compile ${entry}`);
        lines.push(`stance yaw ${fmt(pilot.stance.yaw, 3)} elev ${fmt(pilot.stance.elev, 3)}  look ${fmt(pilot.look.yawOffset, 3)} / ${fmt(pilot.look.pitchOffset, 3)}`);
        lines.push(`reticle error ${fmt(reticleDebug.errorPx, 3)} px  max ${fmt(reticleDebug.maxErrorPx, 3)} px`);
      }
      if (mode === "greycard") {
        const gc = CALIBRATION.greycard;
        const okGrey = Math.abs(st.grey - gc.target) <= gc.tolerance;
        lines.push(`grey card ${fmt(st.grey, 3)} (target ${gc.target} ± ${gc.tolerance}) ${okGrey ? "PASS" : "CHECK"}  predicted ${fmt(predictDisplayValue(0.18, keyCosUpward()), 3)}`);
        lines.push(`paper ${fmt(st.paper, 3)} (max 0.75) ${st.paper <= CALIBRATION.greycard.paperMax ? "PASS" : "CHECK"}  deck ${fmt(st.deck, 3)}`);
        lines.push(`tone mapping ${CALIBRATION.toneMapping}  key ${CALIBRATION.key.intensity}  hemi ${CALIBRATION.hemisphere.intensity}  env ${CALIBRATION.environmentIntensity}  bloom threshold ${CALIBRATION.bloom.threshold}`);
      }
      if (mode === "contrast") {
        lines.push(`spark contrast ${fmt(st.contrast, 2)}:1  min ${fmt(st.contrastMin, 2)}:1  ${st.contrastMin >= 3 ? "PASS" : "CHECK"}`);
      }
      debugReadout.text = lines.join("\n");
    },
    dispose() { geo.dispose(); for (const m of mats) m.dispose(); },
  };
}

export function DebugScenes(props: { rt: StageRuntime; mode: DebugMode }): JSX.Element {
  const { rt, mode } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const view = useMemo(() => createDebugView(mode), [mode]);
  useEffect(() => () => view.dispose(), [view]);
  // Readbacks run after the composer (priority 1) and before the reticle overlay (1.5).
  useFrame(() => view.update(rt, gl, camera, size), 1.2);
  return <>{view.cards.map((m) => <primitive key={m.name} object={m} />)}</>;
}
