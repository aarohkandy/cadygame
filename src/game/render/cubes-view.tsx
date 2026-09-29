// src/game/render/cubes-view.tsx (WP2)
// The physics cubes as objects (GROUNDING F): 40 mm injection-moulded ABS blocks off one tool — a 0.3 mm
// flash line where the mould splits at the equator, a shallow sink at the centre of every face, two ejector
// witnesses on the underside, mould grain, and a sprayed volt chamfer on the arrises. The face graphic is
// pad-printed and rubbed thin at the rim. The Core is the volt one with an ink BIT print and its lock-in
// countdown, and the only cube that emits: an LED ring behind its edge seam. The clutter cubes are ink and
// emit nothing. Cubes stay where they fall. Parked cubes are hidden. One instanced draw: the face prints
// live in a 3 × 3 canvas atlas sampled by instance on the top face (the countdown cell repaints when the
// second changes, the team cells when colour-blind mode does). The cubes sit on REFLECTION_LAYER too.
// Also fills the blob shadows (6.5) for cubes, arm bases, and grippers.
//
// THEATRE 2 (Part 2 item 5, acceptance 7): the clutter was moulded in ink, four times darker than the mat it
// lay on, so nine props disappeared and the Core — the same 40 mm block in a different colour — did not read
// as anything worth fighting over. The clutter is now unpainted ABS (CUBE_ABS_HEX), five times the mat by
// value and semi-gloss against matte rubber, so it separates by value and by material. The Core separates by
// being a different kind of object: machined and lacquered rather than moulded, so it is the one small thing
// in the frame that answers the key with a hard highlight, with its diffuser seam bleeding volt onto the
// faces beside it. Its body is still lit paint — a prize, not a glowing decal.
//
// Then the frames showed that albedo was only half of it: a cube's *vertical* faces measured a flat 0.0,
// because the two par-can sweeps are analytic cones evaluated in the deck and floor shaders and nothing
// else in the scene read them. A prop standing inside a pool of light was the one object that pool did not
// light, so it read as a hole punched in a lit mat. The cubes now evaluate the same cones from the same
// lamps (DECK_POOL_GLSL), and carry a mat bounce (CUBE_MAT_BOUNCE) for the faces the key misses.
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type JSX } from "react";
import {
  CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshPhysicalMaterial, Quaternion,
  SRGBColorSpace, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CORE_CUBE_INDEX, MOUNT_X, REFLECTION_LAYER, RENDER_SCALE, SEATS, TOKEN_HEX } from "../contracts.ts";
import { CUBE_ABS_HEX } from "./deck-texture.ts";
import { DECK_POOL_GLSL, DECK_SWEEP_UNIFORMS } from "./stage-deck.tsx";
import { MARKS } from "../brand/marks.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import { canDraw, createCanvas, cssFont, drawMark } from "./brand-textures.ts";
import { hasBody, interpolateBody } from "./interpolate.ts";
import { TL_SURFACE_GLSL, teamHex } from "./robot-materials.ts";
import { linearColor } from "./vfx/sparks.ts";

export const CUBE_SIZE_M = 0.04;
/**
 * Light bounced up off the mat onto a prop's side and underside, as a fraction of the prop's own albedo.
 * The deck is the brightest surface in the room and a 40 mm block stands right on it, so in life its lower
 * faces are never black; with three lights and no GI nothing supplies that, which is why the clutter read
 * as holes. It falls off with height above the deck, the way a real form factor does, so it lifts the foot
 * of a prop and leaves its top to the key: that gradient is what reads as "standing on something bright".
 * ponytail: one constant for the whole deck rather than a per-cube sample of the mat's own brightness — if
 * a cube ever has to read differently in a dark corner than in a pool, sample the mat.
 */
export const CUBE_MAT_BOUNCE = 0.30;
/**
 * How hard the mould-release skin reflects the room. 1.3 was a prop in a dark studio reflecting nothing:
 * the softbox and the two horizon strips are the only things a vertical face has to catch, and catching
 * them is how plastic reads as plastic rather than as a hole. Same argument as the shells'
 * SHELL_ENV_INTENSITY, one step lower because a clutter cube must never out-read a machine.
 */
export const CUBE_ENV_INTENSITY = 2.2;
/** Volt edge chamfer (5.2): 2 mm. */
export const CUBE_CHAMFER_M = 0.002;
// Clutter cubes: natural ABS (CUBE_ABS_HEX, defined beside the mat value it has to read against). THEATRE 2
// item 5 — these were ink at about 0.4 % linear lying on a mat at 1.9 %, so the props were four times
// *darker* than the surface they sat on and the eye lost them. Unpainted ABS is five times the mat: they
// read by value, and the semi-gloss mould-release skin against matte rubber reads by material too. Nothing
// here emits — a clutter cube is lit, like everything else that is not a fixture.
/** Cubes parked by the engine sit at x ≥ 2 m (EngineResetOptions / placeCube(null)). */
const PARKED_X_M = 1.5;
const CUBE_COUNT = 9;
/** Face atlas: 3 × 3 cells of 128 px, one per cube. */
const ATLAS_N = 3;
const ATLAS_CELL = 128;

/** Paints cube `i`'s face: the Core's BIT print with the countdown, or a team-number decal on ink. */
export function paintCubeFace(ctx: CanvasRenderingContext2D, i: number, teamB: string, countdown: number | null): void {
  const x = (i % ATLAS_N) * ATLAS_CELL, y = Math.floor(i / ATLAS_N) * ATLAS_CELL, S = ATLAS_CELL;
  ctx.clearRect(x, y, S, S);
  if (i === CORE_CUBE_INDEX) {
    // Ink BIT print on the volt face, digits under it while the lock-in runs.
    drawMark(ctx, MARKS.bit, x + 30, y + 10, S - 60, S - 60, 0, { mono: "ink" });
    if (countdown !== null) {
      ctx.fillStyle = TOKEN_HEX.ink;
      ctx.font = `700 34px ${cssFont("--font-chivo", "ui-monospace, monospace")}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String(countdown), x + S / 2, y + S - 12);
    }
    return;
  }
  // Team number: cubes on the pilot's half count 1–4 in cobalt, the AI's 1–4 in its colour.
  const n = i < CORE_CUBE_INDEX ? i + 1 : i - CORE_CUBE_INDEX;
  ctx.fillStyle = i < CORE_CUBE_INDEX ? TOKEN_HEX.cobalt : teamB;
  ctx.font = `italic 800 84px ${cssFont("--font-barlow", "'Arial Narrow', sans-serif")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), x + S / 2, y + S / 2 + 4);
}

export interface CubesView { readonly objects: readonly import("three").Object3D[]; update(rt: StageRuntime): void; dispose(): void; }

export function createCubesView(): CubesView {
  const geometry = new RoundedBoxGeometry(CUBE_SIZE_M, CUBE_SIZE_M, CUBE_SIZE_M, 2, CUBE_CHAMFER_M);
  const kind = new InstancedBufferAttribute(new Float32Array(CUBE_COUNT), 1);
  for (let i = 0; i < CUBE_COUNT; i++) kind.array[i] = i;
  geometry.setAttribute("aCube", kind);
  const atlasCanvas = canDraw() ? createCanvas(ATLAS_N * ATLAS_CELL, ATLAS_N * ATLAS_CELL) : null;
  const atlas = atlasCanvas ? new CanvasTexture(atlasCanvas) : null;
  if (atlas) { atlas.colorSpace = SRGBColorSpace; atlas.anisotropy = 4; }
  // Injection-moulded ABS, not lacquer: semi-gloss, a thin mould-release sheen, no mirror.
  const material = new MeshPhysicalMaterial({ roughness: 0.46, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.14, envMapIntensity: CUBE_ENV_INTENSITY });
  const uniforms = {
    uCoreSeam: { value: 0 }, uVolt: { value: linearColor(TOKEN_HEX.volt) }, uAtlas: { value: atlas }, uHasAtlas: { value: atlas ? 1 : 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, DECK_SWEEP_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute float aCube;
varying float vCube;
varying vec3 vCubeLocal;
varying vec3 vPoolWorld;
varying vec3 vCubeWorldN;`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCube = aCube;\nvCubeLocal = position;")
      // World position and world normal of an *instance*: modelMatrix alone is the mesh's, so the cube's own
      // matrix has to go in too, or all nine sit at the origin as far as the par cans are concerned.
      .replace("#include <project_vertex>", `#include <project_vertex>
vPoolWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vCubeWorldN = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uCoreSeam;
uniform vec3 uVolt;
uniform sampler2D uAtlas;
uniform float uHasAtlas;
varying float vCube;
varying vec3 vCubeLocal;
varying vec3 vCubeWorldN;
${TL_SURFACE_GLSL}
${DECK_POOL_GLSL}
// Set in the colour chunk; the roughness and normal chunks run after it and read them back.
float tlFlash;   // 1 on the mould parting line that rings the cube at z = 0
float tlSink;    // 1 at the centre of a face, where the moulding cooled and pulled in
float tlInk;     // 1 where the pad-printed face graphic survives
float tlPin;     // 1 on an ejector-pin witness, on the underside only
float tlCore;    // 1 on the Core: the machined, lacquered prize, not a moulded clutter block
float tlSeam;    // 0..1 across the Core's diffuser seam, soft where the light bleeds under the shell`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  // An injection moulding: the tool splits on the z = 0 plane, so a 0.3 mm flash line rings the four side
  // faces; the thick centre of every face has pulled in a shallow sink; the ejector pins left two witnesses
  // on the underside. d is the distance from the centre of whichever face this fragment is on.
  vec3 a = abs(vCubeLocal);
  vec3 face = step(max(a.x, max(a.y, a.z)) - 1e-5, a);
  float d = length(vCubeLocal * (1.0 - face));
  tlCore = step(abs(vCube - ${CORE_CUBE_INDEX}.0), 0.5);
  // Distance in from the arris, in metres: the sprayed chamfer on a clutter cube and, on the Core, the
  // milled channel its diffuser seam sits in. Soft, because a lit channel bleeds under the shell edge.
  float arris = ${(CUBE_SIZE_M / 2).toFixed(3)} - max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z));
  tlSeam = 1.0 - smoothstep(${(CUBE_CHAMFER_M * 0.55).toFixed(5)}, ${(CUBE_CHAMFER_M * 3.2).toFixed(5)}, arris);
  tlFlash = (1.0 - face.z) * (1.0 - smoothstep(0.00010, 0.00034, abs(vCubeLocal.z)));
  tlSink = 1.0 - smoothstep(0.002, 0.014, d);
  tlPin = face.z * step(vCubeLocal.z, 0.0)
    * (1.0 - smoothstep(0.0026, 0.0031, min(length(vCubeLocal.xy - vec2(0.0092, 0.0)), length(vCubeLocal.xy + vec2(0.0092, 0.0)))));
  diffuseColor.rgb *= 1.0 - 0.24 * tlFlash - 0.07 * tlSink - 0.12 * tlPin;
  // The face print (BIT + countdown on the Core, the team number on the clutter) on the +z face only, pad-
  // printed and rubbed thin: the ink goes first at the rim of the face and in the scuffs.
  tlInk = 0.0;
  if (uHasAtlas > 0.5 && vCubeLocal.z > ${(CUBE_SIZE_M / 2 - 0.0005).toFixed(4)}) {
    vec2 fuv = clamp(vCubeLocal.xy / ${CUBE_SIZE_M.toFixed(3)} + 0.5, 0.0, 1.0);
    vec2 cell = vec2(mod(vCube, ${ATLAS_N}.0), ${ATLAS_N - 1}.0 - floor(vCube / ${ATLAS_N}.0));
    vec4 print = texture2D(uAtlas, (cell + vec2(fuv.x, fuv.y)) / ${ATLAS_N}.0);
    tlInk = print.a * (1.0 - 0.38 * smoothstep(0.55, 0.92, tlNoise3(vCubeLocal * 420.0)))
      * (0.55 + 0.45 * smoothstep(0.019, 0.012, d));
    diffuseColor.rgb = mix(diffuseColor.rgb, print.rgb, tlInk);
  }
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
// Mould-texture grain, the duller skin in the sink, the drag on the flash line, and matte print ink.
roughnessFactor = clamp(roughnessFactor + (tlNoise3(vCubeLocal * 1400.0) - 0.5) * 0.07
  + 0.10 * tlSink + 0.22 * tlFlash + 0.14 * tlPin + 0.20 * tlInk
  // The Core is not off the same tool as the clutter: it is a machined, lacquered trophy, and the one
  // small object in the frame that answers the key with a hard highlight. That is most of why it reads.
  - 0.22 * tlCore, 0.05, 1.0);`)
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
normal = tlBump(normal, tlNoise3(vCubeLocal * 1400.0) * 0.00006 - tlSink * 0.00022
  + tlFlash * 0.00024 - tlPin * 0.00016);`)
      // The mould-release sheen is a coat of its own, and three keeps the unperturbed normal for it: the
      // sink and the flash have to be put back into it or the highlight glides over them.
      .replace("#include <clearcoat_normal_fragment_begin>", `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
clearcoatNormal = tlBump(clearcoatNormal, tlFlash * 0.00024 - tlSink * 0.00026);
#endif`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
// One branch, one program: the Core carries a real lacquer (clearcoat 1 at 0.05) over the machined body;
// the clutter keeps the thin mould-release sheen the material was built with.
material.clearcoat = mix(material.clearcoat, 1.0, tlCore);
material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.06, tlCore);  // three floors this at 0.0525
#endif`)
      // A prop standing in a par-can pool is *in* that pool. The two sweeps are analytic cones the deck and
      // the studio floor already evaluate (stage-deck's DECK_POOL_GLSL); nothing else in the scene was
      // reading them, so a cube inside a pool of light was the one object the pool did not reach, and it
      // read as a black block on a lit mat. Same lamps, same falloff, no new light and no new program.
      // The mat under it is the brightest surface in the room and there is no GI, so the bounce off it is
      // added by hand: nothing else lifts a vertical face out of black once the key has missed it.
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
{
  float tlUnder = clamp(0.5 - 0.5 * vCubeWorldN.y, 0.0, 1.0);
  // Form factor: full at the foot of the prop, a third of that a cube-height up.
  float tlH = clamp(vPoolWorld.y / ${(CUBE_SIZE_M * RENDER_SCALE).toFixed(4)}, 0.0, 1.0);
  reflectedLight.directDiffuse += tlPoolLight() * diffuseColor.rgb;
  reflectedLight.indirectDiffuse += ${CUBE_MAT_BOUNCE.toFixed(3)} * tlUnder * (1.0 - 0.66 * tlH) * diffuseColor.rgb;
}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{
  vec3 a = abs(vCubeLocal);
  float edge = step(${(CUBE_SIZE_M / 2 - CUBE_CHAMFER_M * 0.75).toFixed(4)}, max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z)));
  if (tlCore > 0.5) {
    // The Core is the one lit prop: an LED ring behind a translucent diffuser, seated in a milled channel
    // that follows every arris. The strip itself is hot enough to bloom; what makes it read as a lit object
    // rather than a painted line is the bleed — light escaping under the shell edge onto the faces beside
    // it, falling off over about 6 mm. The body stays lit paint, so the Core never becomes a glowing decal.
    // The bleed stays under CALIBRATION.bloom.threshold (0.98) on purpose: only the strip itself is a
    // lens artefact, and a 6 mm halo of bloom is how a lit prop turns into a glowing decal.
    totalEmissiveRadiance += uVolt * uCoreSeam * (5.0 * edge + 0.90 * tlSeam);
  } else {
    // The 2 mm chamfer is masked and sprayed volt, not lit — and an arris is the first paint to go, so it
    // is chipped back to the grey moulding wherever the cube has been thrown into something. Against an ABS
    // body this is a bright accent rather than the only thing visible, which is what it was over ink.
    float chip = 1.0 - 0.75 * smoothstep(0.42, 0.78, tlNoise3(vCubeLocal * 380.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, uVolt * 0.72, edge * chip);
  }
}`);
  };
  material.customProgramCacheKey = () => "tl-cubes";
  const mesh = new InstancedMesh(geometry, material, CUBE_COUNT);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const abs = new Color(CUBE_ABS_HEX), volt = new Color(TOKEN_HEX.volt);
  for (let i = 0; i < CUBE_COUNT; i++) mesh.setColorAt(i, i === CORE_CUBE_INDEX ? volt : abs);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.layers.enable(REFLECTION_LAYER);
  mesh.name = "cubes";
  const pos = new Float64Array(3), quat = new Float64Array(4), wxyz = new Float64Array(4);
  const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3(1, 1, 1);
  const hidden = new Matrix4().makeScale(0, 0, 0);
  let paintedTeamB = "", paintedCountdown: number | null = -2;

  /** Repaints the atlas cells whose print changed (the countdown once a second, the team cells on a palette change). */
  function repaint(teamB: string, countdown: number | null): void {
    const ctx = atlasCanvas?.getContext("2d");
    if (!ctx || !atlas) return;
    if (teamB !== paintedTeamB) {
      for (let i = 0; i < CUBE_COUNT; i++) if (i !== CORE_CUBE_INDEX) paintCubeFace(ctx, i, teamB, null);
      paintedTeamB = teamB;
      paintedCountdown = -2;
    }
    if (countdown !== paintedCountdown) {
      paintCubeFace(ctx, CORE_CUBE_INDEX, teamB, countdown);
      paintedCountdown = countdown;
    }
    atlas.needsUpdate = true;
  }

  return {
    objects: [mesh],
    update(rt) {
      const game = rt.game;
      const frame = game.engine.frame;
      const info = game.engine.info;
      const alpha = game.clock.alpha;
      const blobs = rt.blobs;
      blobs.begin();
      for (let i = 0; i < CUBE_COUNT; i++) {
        const id = info.cubeBodyIds[i] ?? 0;
        if (hasBody(frame, id)) {
          interpolateBody(frame, id, alpha, pos, quat, wxyz);
        } else {
          pos[0] = frame.cubes.pos[i * 3]; pos[1] = frame.cubes.pos[i * 3 + 1]; pos[2] = frame.cubes.pos[i * 3 + 2];
          quat[0] = frame.cubes.quat[i * 4 + 1]; quat[1] = frame.cubes.quat[i * 4 + 2]; quat[2] = frame.cubes.quat[i * 4 + 3]; quat[3] = frame.cubes.quat[i * 4];
          if (quat[0] === 0 && quat[1] === 0 && quat[2] === 0 && quat[3] === 0) quat[3] = 1;
        }
        const parked = pos[0] > PARKED_X_M || (pos[0] === 0 && pos[1] === 0 && pos[2] === 0 && i !== CORE_CUBE_INDEX);
        if (parked) { mesh.setMatrixAt(i, hidden); continue; }
        p.set(pos[0], pos[1], pos[2]);
        q.set(quat[0], quat[1], quat[2], quat[3]);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        blobs.set(pos[0], pos[1], Math.max(0, pos[2] - CUBE_SIZE_M / 2), CUBE_SIZE_M * 0.72);
      }
      mesh.instanceMatrix.needsUpdate = true;
      const core = game.rules.state.core;
      const t = rt.wallMs() / 1000;
      uniforms.uCoreSeam.value = core.phase === "live" ? 0.75 + 0.25 * Math.sin(t * 9) : core.phase === "incoming" ? 0.35 + 0.3 * Math.sin(t * 14) : 0.18;
      const countdown = core.phase === "live" && core.dockedIn !== null ? Math.max(0, Math.ceil(core.lockInRemainingS)) : null;
      repaint(teamHex("blaze", rt.colorblind()), countdown);
      // Arm bases and grippers (the opponent hand shadow is the depth cue for a 4 cm target).
      for (const seat of SEATS) {
        const arm = frame.arms[seat];
        const baseX = MOUNT_X[seat];
        blobs.set(baseX, 0, 0, 0.055);
        blobs.set(arm.eePos[0], arm.eePos[1], Math.max(0, arm.eePos[2] - 0.01), 0.026, Math.atan2(arm.eePos[1] - arm.wristPos[1], arm.eePos[0] - arm.wristPos[0]), 1.35);
      }
      blobs.end();
    },
    dispose() {
      geometry.dispose(); material.dispose(); atlas?.dispose();
    },
  };
}

export function CubesView(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const view = useMemo(() => createCubesView(), []);
  useEffect(() => () => view.dispose(), [view]);
  useFrame(() => view.update(rt), 0);
  return (
    <>
      {view.objects.map((o) => <primitive key={o.name} object={o} />)}
      <primitive object={rt.blobs.mesh} />
    </>
  );
}
