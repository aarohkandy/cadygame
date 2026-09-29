// src/game/render/jumbotron.tsx (WP6)
// One jumbotron on a ballasted floor stand, behind the opponent's end of the stage, facing the deck
// (SCOPE 1.2, acceptance 10; GROUNDING D — a screen with nothing holding it up fails the grounding test).
// It shows the live broadcast feed (the phone camera, or the replay camera during replays) rendered into a
// 512 × 288 target at the tier's rate (≤ 15 Hz), under an LED pixel grid, inside the TORQUE LIMIT bezel
// rasterized from WP7's marks, with a live-info strip across its foot (names, integrity, round wins, clock)
// repainted only when a shown value changes. The screen sits on SCREEN_LAYER so the feed camera never
// films itself.
//
// The feed never re-renders the scene during a live round (EMOTION_BIBLE 5.2): it shows the tote and, during
// `ko`, the instant replay; between rounds the broadcast cameras see it. The feed is also only rendered while
// the screen is in the main camera's frustum: from the cockpit it sits above the frame, and an extra full-scene
// render nobody sees was the most expensive thing in the set.
"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type JSX } from "react";
import {
  BoxGeometry, CanvasTexture, Color, Frustum, SRGBColorSpace, HalfFloatType, Matrix4, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, ShaderMaterial,
  WebGLRenderTarget, type BufferGeometry, type Camera, type Group, type Light, type LightShadow, type Mesh, type Scene,
  type WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MOUNT_X, TOKEN_HEX } from "../contracts.ts";
import { MARKS } from "../brand/marks.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import {
  createCanvas, createJumbotronFrame, INFO_STRIP_H, INFO_STRIP_W, paintInfoStrip, type InfoStripState,
} from "./brand-textures.ts";
import { cameraMath, createCameraPose } from "./camera-math.ts";
import { CALIBRATION, SCREEN_LAYER } from "./quality.ts";
import { RIG_FLOOR_Z_M } from "./rigging.tsx";
import { teamHex } from "./robot-materials.ts";

export const JUMBOTRON_X_M = 2.3;
export const JUMBOTRON_W_M = 1.44;
export const JUMBOTRON_H_M = 0.9;
export const JUMBOTRON_Z_M = 1.22;       // screen centre height
/** What holds it up: a ballasted floor stand, the same kit the floor monitor stands on. */
export const JUMBOTRON_COLUMN_M = 0.080;
export const JUMBOTRON_BASE_L_M = 0.560;
export const JUMBOTRON_BASE_W_M = 0.900;
export const FEED_W = 512;
export const FEED_H = 288;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG = /* glsl */ `
uniform sampler2D uFeed;
uniform sampler2D uFrame;
uniform float uHasFrame;
uniform sampler2D uInfo;
uniform float uHasInfo;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uFlood;
uniform float uFloodAmt;
varying vec2 vUv;
void main() {
  // Feed occupies the bezel's inner window (frame texture: 1024 × 640, 72 px top bar, 40 px bottom, 28 px sides).
  vec2 inner0 = vec2(28.0 / 1024.0, 40.0 / 640.0);
  vec2 inner1 = vec2(1.0 - 28.0 / 1024.0, 1.0 - 72.0 / 640.0);
  vec2 fuv = (vUv - inner0) / (inner1 - inner0);
  vec3 col = texture2D(uFeed, clamp(fuv, 0.0, 1.0)).rgb;
  vec2 cell = fract(fuv * vec2(${FEED_W}.0, ${FEED_H}.0));
  // Live info across the foot of the feed (bottom 24%).
  if (uHasInfo > 0.5 && fuv.y < 0.24) {
    vec4 info = texture2D(uInfo, vec2(fuv.x, fuv.y / 0.24));
    col = mix(col, info.rgb * 1.3, info.a);
  }
  float led = smoothstep(0.0, 0.25, cell.x) * smoothstep(1.0, 0.75, cell.x) * smoothstep(0.0, 0.25, cell.y) * smoothstep(1.0, 0.75, cell.y);
  float resolved = clamp(1.6 - max(fwidth(fuv.x * ${FEED_W}.0), fwidth(fuv.y * ${FEED_H}.0)) * 2.0, 0.0, 1.0);
  col *= mix(0.78, 0.55 + 0.45 * led, resolved);
  // A refresh bar rolling down the panel.
  col *= 1.0 + 0.12 * smoothstep(0.96, 1.0, fract(fuv.y - uTime * 0.35));
  col = mix(col, uFlood, uFloodAmt * 0.35);
  col *= uIntensity;
  if (uHasFrame > 0.5) {
    vec4 f = texture2D(uFrame, vUv);
    col = mix(col, f.rgb * 1.2, f.a);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * True once every shadow caster in the scene has an allocated shadow map.
 *
 * The feed pass suppresses the shadow refresh so it does not pay for a second shadow render, but suppressing
 * it before the first shadow map exists leaves `light.shadow.map` null. three then binds its shared empty
 * shadow texture, and `setValueT1Array` (the path array uniforms like `directionalShadowMap[0]` take) never
 * gives that texture a compare function — so a `sampler2DShadow` samples a depth texture with compare mode
 * off and ANGLE fails every lit draw in the pass with GL_INVALID_OPERATION.
 */
function createShadowPrimeGate(): (scene: Scene) => boolean {
  let casters: LightShadow[] | null = null;
  return (scene: Scene) => {
    if (casters === null || casters.length === 0) {
      const found: LightShadow[] = [];
      scene.traverse((o) => {
        const light = o as Light & { shadow?: LightShadow };
        if (light.isLight && light.castShadow && light.shadow) found.push(light.shadow);
      });
      casters = found;
    }
    for (const shadow of casters) if (shadow.map === null) return false;
    return true;
  };
}

export interface JumbotronView {
  readonly material: ShaderMaterial;
  readonly geometry: PlaneGeometry;
  readonly housingGeo: PlaneGeometry;
  readonly housingMat: MeshBasicMaterial;
  update(rt: StageRuntime, gl: WebGLRenderer, scene: Scene, mainCamera: Camera, screen: Mesh | null): void;
  dispose(): void;
}

export function createJumbotronView(): JumbotronView {
  const target = new WebGLRenderTarget(FEED_W, FEED_H, { type: HalfFloatType, depthBuffer: true });
  const frame = createJumbotronFrame(MARKS);
  const infoCanvas = createCanvas(INFO_STRIP_W, INFO_STRIP_H);
  const info = infoCanvas ? new CanvasTexture(infoCanvas) : null;
  if (info) info.colorSpace = SRGBColorSpace;
  const shown: InfoStripState = {
    nameA: "", nameB: "", integrityA: -1, integrityB: -1, winsA: -1, winsB: -1, round: -1, bestOf: -1, timeLeftS: -1,
    suddenDeath: false, teamB: "",
  };
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uFeed: { value: target.texture }, uFrame: { value: frame }, uHasFrame: { value: frame ? 1 : 0 },
      uInfo: { value: info }, uHasInfo: { value: info ? 1 : 0 }, uTime: { value: 0 },
      uIntensity: { value: CALIBRATION.emissive.jumbotron * 0.55 }, uFlood: { value: new Color() }, uFloodAmt: { value: 0 },
    },
  });
  const geometry = new PlaneGeometry(JUMBOTRON_W_M, JUMBOTRON_H_M);
  const housingGeo = new PlaneGeometry(JUMBOTRON_W_M + 0.06, JUMBOTRON_H_M + 0.06);
  const housingMat = new MeshBasicMaterial({ color: TOKEN_HEX.ink });
  const feedCamera = new PerspectiveCamera(38, FEED_W / FEED_H, 0.004, 40);
  feedCamera.layers.set(0);
  const pose = createCameraPose();
  const u = material.uniforms;
  const shadowsPrimed = createShadowPrimeGate();
  const frustum = new Frustum();
  const viewProj = new Matrix4();
  let lastFeedMs = -1e9;
  /** Repaints the info strip when a value it shows has changed (the clock ticks once a second). */
  function refreshInfo(rt: StageRuntime, tex: CanvasTexture, canvas: HTMLCanvasElement): void {
    const hud = rt.game.hud;
    const a = hud.seats.atlas, b = hud.seats.blaze;
    const ia = Math.round((a.integrity / Math.max(1, a.integrityMax)) * 50) / 50;
    const ib = Math.round((b.integrity / Math.max(1, b.integrityMax)) * 50) / 50;
    const clock = Math.ceil(hud.timeLeftS);
    const teamB = teamHex("blaze", rt.colorblind());
    if (shown.nameA === a.name && shown.nameB === b.name && shown.integrityA === ia && shown.integrityB === ib
      && shown.winsA === a.roundsWon && shown.winsB === b.roundsWon && shown.round === hud.round && shown.bestOf === hud.bestOf
      && shown.timeLeftS === clock && shown.suddenDeath === hud.suddenDeath && shown.teamB === teamB) return;
    shown.nameA = a.name; shown.nameB = b.name; shown.integrityA = ia; shown.integrityB = ib;
    shown.winsA = a.roundsWon; shown.winsB = b.roundsWon; shown.round = hud.round; shown.bestOf = hud.bestOf;
    shown.timeLeftS = clock; shown.suddenDeath = hud.suddenDeath; shown.teamB = teamB;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintInfoStrip(ctx, shown);
    tex.needsUpdate = true;
  }
  return {
    material, geometry, housingGeo, housingMat,
    update(rt, gl, scene, mainCamera, screen) {
      const now = rt.wallMs();
      const f = rt.vfx.cues.flood(now);
      u.uFloodAmt.value = f;
      if (f > 0) (u.uFlood.value as Color).copy(rt.vfx.cues.floodColor);
      u.uTime.value = (now / 1000) % 3600;
      if (info && infoCanvas) refreshInfo(rt, info, infoCanvas);
      if (now - lastFeedMs < 1000 / rt.quality.tier.jumbotronHz) return;
      const phase = rt.game.director.phase;
      if (phase === "fight" || phase === "sudden_death" || phase === "paused") return;
      if (screen) {
        viewProj.multiplyMatrices(mainCamera.projectionMatrix, mainCamera.matrixWorldInverse);
        if (!frustum.setFromProjectionMatrix(viewProj).intersectsObject(screen)) return;
      }
      lastFeedMs = now;
      const director = rt.game.director;
      if (director.cameraMode === "replay" && mainCamera instanceof PerspectiveCamera) {
        feedCamera.position.copy(mainCamera.position);
        feedCamera.quaternion.copy(mainCamera.quaternion);
        feedCamera.fov = mainCamera.fov;
      } else {
        cameraMath.broadcast(director.cameraSeat, pose, { timeMs: now });
        feedCamera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        feedCamera.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
        feedCamera.fov = pose.fovDeg;
      }
      feedCamera.updateProjectionMatrix();
      feedCamera.updateMatrixWorld();
      // The feed never refreshes the shadow map (the main pass does, once per frame) — but only once every
      // caster has one, because rendering shadow receivers against a null shadow map is a GL error.
      const prevTarget = gl.getRenderTarget();
      const shadowNeeds = gl.shadowMap.needsUpdate;
      const primed = shadowsPrimed(scene);
      if (primed) gl.shadowMap.needsUpdate = false;
      gl.setRenderTarget(target);
      gl.clear();
      gl.render(scene, feedCamera);
      gl.setRenderTarget(prevTarget);
      gl.shadowMap.needsUpdate = primed ? shadowNeeds : true;
    },
    dispose() {
      target.dispose(); frame?.dispose(); info?.dispose(); material.dispose(); geometry.dispose(); housingGeo.dispose(); housingMat.dispose();
    },
  };
}

/**
 * The stand (GROUNDING D, the "what holds it up" test). A 1.44 m screen 0.77 m off the studio floor is not
 * hanging in the air: it is bolted to a cross-arm on an 80 mm square steel column, standing on a ballasted
 * 560 × 900 mm base plate, braced both ways. Authored in sim metres, z up, unrotated — the screen's own group
 * is turned to face the deck, this is not. One merged draw, and only while the screen itself is shown.
 */
function createJumbotronStand(): { geometry: BufferGeometry; material: MeshStandardMaterial } {
  const parts: BufferGeometry[] = [];
  const at = (g: BufferGeometry, x: number, y: number, z: number): BufferGeometry => (g.translate(x, y, z), g);
  const rise = JUMBOTRON_Z_M - JUMBOTRON_H_M / 2 - RIG_FLOOR_Z_M;   // floor to the screen's bottom edge
  const c = JUMBOTRON_COLUMN_M;
  parts.push(at(new BoxGeometry(JUMBOTRON_BASE_L_M, JUMBOTRON_BASE_W_M, 0.022), 0, 0, 0.011));
  parts.push(at(new BoxGeometry(c, c, rise), 0, 0, rise / 2));
  // Cross-arm the screen bolts to, and a short boom holding it off the column. Local −x is deckward: the
  // group sits 55 mm behind the screen plane and is turned by π when the jumbotron is on the other side.
  parts.push(at(new BoxGeometry(0.055, JUMBOTRON_W_M * 0.76, 0.055), -0.055, 0, rise + 0.03));
  parts.push(at(new BoxGeometry(0.070, 0.055, 0.055), -0.020, 0, rise + 0.03));
  // Diagonal braces, one each way, from the base plate to two thirds up the column.
  for (const [sy, sx] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const g = new BoxGeometry(0.030, 0.030, rise * 0.78);
    g.rotateX(sy * 0.42);
    g.rotateY(sx * -0.36);
    parts.push(at(g, sx * 0.145, sy * 0.235, rise * 0.38));
  }
  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return {
    geometry,
    // The same dark satin steel as rigging.tsx's STEEL_DIRTY: studio kit, not a showpiece.
    material: new MeshStandardMaterial({ color: "#31343A", roughness: 0.68, metalness: 0.86, envMapIntensity: 0.42 }),
  };
}

export function Jumbotron(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const mainCamera = useThree((s) => s.camera);
  const view = useMemo(() => createJumbotronView(), []);
  const stand = useMemo(() => createJumbotronStand(), []);
  const screen = useRef<Mesh | null>(null);
  const root = useRef<Group | null>(null);
  useEffect(() => () => view.dispose(), [view]);
  useEffect(() => () => { stand.geometry.dispose(); stand.material.dispose(); }, [stand]);
  useFrame(() => {
    // Out of the cockpit composition: the cockpit looks 18° down, so only the screen's bottom edge would
    // peek into the HUD's top band. The broadcast, lobby and replay cameras see it.
    const show = rt.game.director.cameraMode !== "cockpit";
    if (root.current) root.current.visible = show;
    if (show) view.update(rt, gl, scene, mainCamera, screen.current);
  }, 0.5);
  // Behind the opponent: the end of the stage opposite the pilot's mount.
  const side = Math.sign(MOUNT_X[rt.game.pilot.seat === "atlas" ? "blaze" : "atlas"]);

  return (
    <group ref={root} name="jumbotron">
      <mesh
        geometry={stand.geometry}
        material={stand.material}
        name="jumbotron-stand"
        position={[side * (JUMBOTRON_X_M + 0.055), 0, RIG_FLOOR_Z_M]}
        rotation={[0, 0, side > 0 ? 0 : Math.PI]}
        receiveShadow
      />
      <group
        position={[side * JUMBOTRON_X_M, 0, JUMBOTRON_Z_M]}
        rotation={[Math.PI / 2, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
      >
        <mesh geometry={view.housingGeo} material={view.housingMat} position={[0, 0, -0.01]} layers={SCREEN_LAYER} />
        <mesh ref={screen} geometry={view.geometry} material={view.material} layers={SCREEN_LAYER} />
      </group>
    </group>
  );
}
