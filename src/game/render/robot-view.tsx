// src/game/render/robot-view.tsx (WP1)
// Both SO-101 arms. One flat group per MuJoCo link, posed every frame from the engine's body buffers with
// α interpolation (10.3), or from forward kinematics on the joint angles when the engine exposes no body
// buffers. Visuals are the Menagerie STLs merged per (link, slot) at two LODs and shared by both arms: LOD0
// draws on the arm the camera favours (director.cameraSeat), LOD1 on the other arm and, on REFLECTION_LAYER,
// in the deck reflection (EMOTION_BIBLE 5.4, 10.2 step 4); shadows come from collision proxies on the shadow
// layer (D10). Per frame, with no allocation: colorway, rival rim, team
// charge glow, pilot heat strip, deflect rim and hand flashes, victim vibration, the near-plane own-arm dither gate, servo LEDs
// and flank LED strips (measured servo effort, white flare on impact, stagger flicker, KO die-off
// base → gripper), decals, the de-rez dissolve, the re-render scan, and the gripper motion trail.
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState, type JSX } from "react";
import {
  Bone, Color, Group, Matrix4, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Vector3,
  type BufferGeometry, type IUniform, type InstancedMesh, type Texture,
  type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from "three";
import { LINK_IDS, otherSeat, REFLECTION_LAYER, RENDER_SCALE, SEATS, type DriverKind, type GameHandle, type LedFrame, type LinkId, type Seat } from "../contracts.ts";
import { MARKS } from "../brand/marks.ts";
import type { StageRuntime } from "./arena-canvas.tsx";
import {
  createPointHistory, hasBody, interpolateBody, rotateVecXyzw, samplePointHistory, wxyzToXyzw,
} from "./interpolate.ts";
import {
  createLinkPoses, forwardKinematics, linkIndexMap, linkSlotGeometries, loadRobotAssets, peekRobotAssets, skinnedMerge,
  type LinkSlotGeometry, type MaterialSlot, type RobotAssets, type SkinnedMergeResult,
} from "./robot-assets.ts";
import {
  bandsFor, createArmUniforms, createShellMaterial, OWN_ARM_DITHER_BAND, recolorShellMaterial, RIM_GAIN, setArmLed, setArmLinkLed, setArmTeam,
  shellLinkConstants, teamHex,
  type ArmUniforms, type Colorway, type ShellMaterialHandle,
} from "./robot-materials.ts";
import {
  buildDecalPlacements, buildLedPlacements, createDecalAtlas, createDecalMesh, createLedMesh, servoEffort, setDecalCells,
  type DecalPlacement, type LedPlacement,
} from "./robot-decals.ts";
import { buildShadowProxies, SHADOW_LAYER } from "./shadow-proxies.ts";
import { CALIBRATION } from "./quality.ts";
import { COCKPIT_NEAR } from "./camera-math.ts";
import { linearColor } from "./vfx/sparks.ts";
import { createGripperTrail, type GripperTrail } from "./trails.ts";

/** LED level at rest (fraction of full) and the effort follow rates (1/s) up and down. */
const LED_IDLE = 0.14;
/** Linear radiance caps on a status-LED bead, against the 0.98 bloom threshold: hot, with a tight core. */
const LED_CAP = 1.6, LED_FLARE_CAP = 4;
const EFFORT_RISE = 30;
const EFFORT_FALL = 5;
/** A tip jump this far in one frame (sim m) is a teleport (round reset), not a flick. */
const TRAIL_TELEPORT_M = 0.15;
/**
 * Own-arm dither gate (3.2), sim metres of view depth: a link whose bounding sphere reaches closer to the eye
 * plane than this can have fragments inside the near-plane band, and only those fragments dither (the shader
 * fades the screen door by view depth). Everything else on the viewmodel is solid.
 */
export const OWN_ARM_DITHER_DEPTH_M = (COCKPIT_NEAR + OWN_ARM_DITHER_BAND) / RENDER_SCALE;
/**
 * Links hidden on the pilot's own arm in the cockpit: everything behind the forearm. They sit beside or
 * behind the eye and swept past the lens as a dithered smear, so the viewmodel is forearm, wrist and gripper.
 */
export const COCKPIT_HIDDEN_LINKS: ReadonlySet<LinkId> = new Set<LinkId>(["base", "shoulder", "upper_arm"]);
const ZERO_SCALE = new Matrix4().makeScale(0, 0, 0);
/** Layer mask of the deck mirror's own merge: the reflection pass and nothing else. */
const REFLECTION_MASK = 1 << REFLECTION_LAYER;

/* ───────────────────────── shared per-page resources ───────────────────────── */

interface SharedArmResources {
  decals: DecalPlacement[];
  leds: LedPlacement[];
  proxies: Map<LinkId, import("three").BufferGeometry>;
  atlas: Texture | null;
}
const sharedCache = new WeakMap<RobotAssets, Partial<Record<Seat, SharedArmResources>>>();
/** Per (assets, seat): the decal placements carry the seat's team number (01 / 02); the atlas holds both. */
function sharedFor(assets: RobotAssets, seat: Seat): SharedArmResources {
  let bySeat = sharedCache.get(assets);
  if (!bySeat) { bySeat = {}; sharedCache.set(assets, bySeat); }
  let s = bySeat[seat];
  if (!s) {
    const other = bySeat[otherSeat(seat)];
    s = { decals: buildDecalPlacements(assets, seat), leds: other?.leds ?? buildLedPlacements(assets), proxies: other?.proxies ?? buildShadowProxies(assets), atlas: other?.atlas ?? createDecalAtlas(MARKS) };
    bySeat[seat] = s;
  }
  return s;
}

export function colorwayFor(kind: DriverKind | null, seat: Seat): Colorway {
  if (kind === null) return seat === "atlas" ? "pilot" : "rival";
  if (kind === "human" || kind === "proxy") return "pilot";
  if (kind === "builtin") return "rival";
  return "user_model";
}

/** Loads the robot assets once; re-renders a single time when they are ready. */
export function useRobotAssets(game: GameHandle): RobotAssets | null {
  const [assets, setAssets] = useState<RobotAssets | null>(() => peekRobotAssets());
  useEffect(() => {
    if (assets) return;
    let live = true;
    loadRobotAssets().then(
      (a) => { if (live) setAssets(a); },
      (err: unknown) => { if (live) game.ui.set({ error: `robot meshes failed to load: ${err instanceof Error ? err.message : String(err)}` }); },
    );
    return () => { live = false; };
  }, [assets, game]);
  return assets;
}

/* ───────────────────────── one arm ───────────────────────── */

interface MaterialEntry { handle: ShellMaterialHandle; slot: MaterialSlot; }
/** One material class at both LODs; the meshes share one material, so a LOD swap compiles nothing. */
interface ShellDraw { lod0: SkinnedMesh; lod1: SkinnedMesh; cockpitStart: number; indexCount: number; }

/* ───────────────────────── the skinned merge (10.2 step 6) ───────────────────────── */

/**
 * One draw per material class per arm instead of one per (link, slot). Every shell of a class goes into one
 * SkinnedMesh with a rigid bone per link — the bones *are* the link objects the engine already poses, so the
 * shells follow their MuJoCo bodies exactly — and the per-link constants WP2's shell shader took as uniforms
 * move into `uLinkP`, a vec4 array the fragment shader indexes by the link's bone. Everything keyed on the
 * link keeps working: the per-link LED uniform (uLinkIndex), the near-plane dither gate (uDither), the
 * base-to-tip gradient, the jaw pads, the cockpit hidden links (a bone-order prefix of the index buffer, so
 * one setDrawRange), the REFLECTION_LAYER subset (its own merge) and the LOD swap (two meshes, one material).
 */
const LINK_STRIDE = 4;                                   // vec4s of per-link data in uLinkP
const LINK_P_LENGTH = LINK_IDS.length * LINK_STRIDE;
/** Float offset of a link's dither gate inside its uLinkP block: the w of vec4 slot 2. */
const DITHER_OFFSET = 2 * 4 + 3;

const MERGE_VERTEX_LINK = /* glsl */ `
#ifdef USE_SKINNING
  vLinkIdx = skinIndex.x;
#else
  vLinkIdx = 0.0;
#endif
`;
/** The brushed servo streak runs along the link's own z, which after the merge only the bone still knows. */
const JOINT_AXIS_SOURCE = "vJointAxisView = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));";
const MERGE_VERTEX_JOINT_AXIS = /* glsl */ `
#ifdef USE_SKINNING
  vJointAxisView = normalize(normalMatrix * (skinMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
#else
  ${JOINT_AXIS_SOURCE}
#endif
`;
const MERGE_FRAGMENT_LINK = /* glsl */ `
  int tlLinkP = int(vLinkIdx + 0.5) * ${LINK_STRIDE};
  uGradAxis = uLinkP[tlLinkP].xyz;
  uGradUnit = uLinkP[tlLinkP + 1].xyz;
  uGradT = vec2(uLinkP[tlLinkP].w, uLinkP[tlLinkP + 1].w);
  uJawInner = uLinkP[tlLinkP + 2].xyz;
  uDither = uLinkP[tlLinkP + 2].w;
  uJawTip = uLinkP[tlLinkP + 3].xyz;
  uLinkIndex = vLinkIdx;
`;

/** Fails loudly rather than silently rendering the wrong thing when the shell shader drifts under us. */
function swap(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`skinned merge: the shell shader no longer emits ${JSON.stringify(from)}`);
  return src.replace(from, to);
}

/**
 * Chains a link-binding pass onto WP2's shell patch: the per-link uniforms become plain globals read out of
 * `uLinkP` at the top of main(), and the link index rides in on `skinIndex.x`. One program variant per
 * material class, all constructed at mount and compiled by the prewarm, so nothing compiles during play.
 */
function bindMergedLinks(handle: ShellMaterialHandle, linkP: IUniform<Float32Array>): void {
  const material = handle.material;
  const base = material.onBeforeCompile.bind(material);
  const baseKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    base(shader, renderer);
    shader.uniforms.uLinkP = linkP;
    let v = swap(shader.vertexShader, "attribute float edge;", "attribute float edge;\nvarying float vLinkIdx;");
    v = swap(v, "vEdge = edge;", `vEdge = edge;${MERGE_VERTEX_LINK}`);
    // Three's skinning overwrites objectNormal with the posed normal; the jaw's inner face and the print
    // axis want the link-local one, which is the untouched attribute.
    v = swap(v, "vObjNormal = objectNormal;", "vObjNormal = normal;");
    shader.vertexShader = swap(v, JOINT_AXIS_SOURCE, MERGE_VERTEX_JOINT_AXIS);
    let f = swap(shader.fragmentShader, "uniform float uDither;",
      `uniform vec4 uLinkP[${LINK_P_LENGTH}];\nvarying float vLinkIdx;\nfloat uDither;`);
    f = swap(f, "uniform float uLinkIndex;", "float uLinkIndex;");
    f = swap(f, "uniform vec3 uGradAxis;", "vec3 uGradAxis;");
    f = swap(f, "uniform vec3 uGradUnit;", "vec3 uGradUnit;");
    f = swap(f, "uniform vec2 uGradT;", "vec2 uGradT;");
    f = swap(f, "uniform vec3 uJawInner;", "vec3 uJawInner;");
    f = swap(f, "uniform vec3 uJawTip;", "vec3 uJawTip;");
    shader.fragmentShader = swap(f, "void main() {", `void main() {${MERGE_FRAGMENT_LINK}`);
  };
  material.customProgramCacheKey = () => `${baseKey()}-merged`;
}

/** One link's slice of `uLinkP`: the shell shader's per-link uniforms packed as four vec4s. */
function packLinkConstants(slot: MaterialSlot, link: LinkId): { kind: number; data: Float32Array } {
  const c = shellLinkConstants(slot, link);
  const data = new Float32Array(LINK_STRIDE * 4);
  c.gradAxis.toArray(data, 0); data[3] = c.gradT[0];
  c.gradUnit.toArray(data, 4); data[7] = c.gradT[1];
  c.jawInner.toArray(data, 8);                  // data[11] is the dither gate, written per frame
  c.jawTip.toArray(data, 12);
  return { kind: c.kind, data };
}

interface MergedGroup {
  slot: MaterialSlot;
  /** A link of the group: the material class and uLinkKind are keyed on (slot, link) and equal across it. */
  link: LinkId;
  lod0: SkinnedMergeResult;
  lod1: SkinnedMergeResult;
  /** LOD0 index offset of the first link the cockpit keeps (COCKPIT_HIDDEN_LINKS are a bone-order prefix). */
  cockpitStart: number;
  /** Static uLinkP for this class: per-link gradient and jaw geometry, dither slots left at 0. */
  linkConst: Float32Array;
}
interface MergedArm { groups: MergedGroup[]; reflection: SkinnedMergeResult | null; reflectionGroup: number; }
const mergedArmCache = new WeakMap<RobotAssets, MergedArm>();

/**
 * Only the two biggest masses go into the deck mirror. It is 480 × 270, read as a vertical streak down three
 * mips: a servo block, a lens or a shoulder adds nothing there that the base and the forearm do not already
 * put in the smear.
 */
const reflectsInMirror = (e: LinkSlotGeometry) => e.slot === "shell_body" && (e.link === "base" || e.link === "lower_arm");

function buildMergedArm(assets: RobotAssets): MergedArm {
  const boneOf = linkIndexMap(assets.model);
  const byClass = new Map<string, { slot: MaterialSlot; link: LinkId; entries: LinkSlotGeometry[]; linkConst: Float32Array }>();
  for (const entry of linkSlotGeometries(assets)) {
    const c = packLinkConstants(entry.slot, entry.link);
    const key = `${entry.slot}|${c.kind}`;
    let g = byClass.get(key);
    if (!g) { g = { slot: entry.slot, link: entry.link, entries: [], linkConst: new Float32Array(LINK_P_LENGTH * 4) }; byClass.set(key, g); }
    g.entries.push(entry);
    g.linkConst.set(c.data, boneOf[entry.link] * LINK_STRIDE * 4);
  }
  const groups: MergedGroup[] = [];
  let reflection: SkinnedMergeResult | null = null;
  let reflectionGroup = -1;
  for (const g of byClass.values()) {
    const lod0 = skinnedMerge(g.entries, "lod0", (l) => boneOf[l]);
    const kept = [...g.entries].sort((a, b) => boneOf[a.link] - boneOf[b.link]).find((e) => !COCKPIT_HIDDEN_LINKS.has(e.link));
    groups.push({
      slot: g.slot, link: g.link, lod0, lod1: skinnedMerge(g.entries, "lod1", (l) => boneOf[l]),
      cockpitStart: kept ? lod0.indexStart.get(kept.link) ?? 0 : lod0.indexCount, linkConst: g.linkConst,
    });
    const mirrored = g.entries.filter(reflectsInMirror);
    if (mirrored.length) { reflection = skinnedMerge(mirrored, "lod1", (l) => boneOf[l]); reflectionGroup = groups.length - 1; }
  }
  return { groups, reflection, reflectionGroup };
}

/** Merged geometry is identical for both arms (link-local, one bone per link), so it is built once. */
function mergedArmFor(assets: RobotAssets): MergedArm {
  let hit = mergedArmCache.get(assets);
  if (!hit) { hit = buildMergedArm(assets); mergedArmCache.set(assets, hit); }
  return hit;
}

export interface ArmRig {
  readonly seat: Seat;
  readonly group: Group;
  readonly decals: InstancedMesh;
  readonly leds: InstancedMesh;
  readonly trail: GripperTrail;
  readonly uniforms: ArmUniforms;
  /** Link bones in model order (sim space); they are the merged shells' skeleton. */
  readonly links: readonly Bone[];
  update(rt: StageRuntime, dtS: number, nowMs: number): void;
  dispose(): void;
}

const ONE = new Vector3(1, 1, 1);

export function createArmRig(assets: RobotAssets, seat: Seat, colorblind: boolean): ArmRig {
  const shared = sharedFor(assets, seat);
  const model = assets.model;
  const uniforms = createArmUniforms();
  setArmTeam(uniforms, seat, colorblind);
  const group = new Group();
  group.name = `arm-${seat}`;
  // The link objects are the skeleton's bones: one rigid bone per MuJoCo body, posed below exactly as before.
  const links: Bone[] = model.links.map((l) => {
    const b = new Bone();
    b.name = `${seat}_${l.link}`;
    group.add(b);
    return b;
  });
  const linkIndex = new Map<LinkId, number>(model.links.map((l, i) => [l.link, i]));
  let colorway: Colorway = seat === "atlas" ? "pilot" : "rival";
  const merged = mergedArmFor(assets);
  // Bind pose is the identity: every vertex is already link-local, and three keeps bindMatrixInverse at the
  // world root's inverse for an attached SkinnedMesh, so a vertex lands at bone.matrixWorld × position.
  const skeleton = new Skeleton(links, links.map(() => new Matrix4()));
  const bindMatrix = new Matrix4();
  const materials: MaterialEntry[] = [];
  const linkP: IUniform<Float32Array>[] = [];
  const shells: ShellDraw[] = [];
  const skinned = (geometry: BufferGeometry, handle: ShellMaterialHandle, name: string, mask: number): SkinnedMesh => {
    const mesh = new SkinnedMesh(geometry, handle.material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;   // the bind pose is link-local, so three's bounds would cull the arm away
    mesh.layers.mask = mask;
    group.add(mesh);
    mesh.bind(skeleton, bindMatrix);
    return mesh;
  };
  for (const g of merged.groups) {
    const handle = createShellMaterial(g.slot, g.link, colorway, seat, colorblind, uniforms);
    const p: IUniform<Float32Array> = { value: new Float32Array(g.linkConst) };
    bindMergedLinks(handle, p);
    linkP.push(p);
    materials.push({ handle, slot: g.slot });
    shells.push({
      lod0: skinned(g.lod0.geometry, handle, `${seat}_${g.slot}_${g.link}`, 1),
      lod1: skinned(g.lod1.geometry, handle, `${seat}_${g.slot}_${g.link}_lod1`, 1),
      cockpitStart: g.cockpitStart, indexCount: g.lod0.indexCount,
    });
  }
  if (merged.reflection) {
    skinned(merged.reflection.geometry, materials[merged.reflectionGroup].handle, `${seat}_mirror`, REFLECTION_MASK);
  }
  const shadowMaterial = new MeshBasicMaterial({ colorWrite: false });
  for (const [link, geometry] of shared.proxies) {
    const proxy = new Mesh(geometry, shadowMaterial);
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.layers.set(SHADOW_LAYER);
    proxy.name = `${seat}_${link}_shadow`;
    links[linkIndex.get(link) ?? 0].add(proxy);
  }
  const decals = createDecalMesh(shared.decals.length, shared.atlas);
  setDecalCells(decals, shared.decals);
  decals.receiveShadow = true;
  const leds = createLedMesh(shared.leds.length);
  const decalLink = shared.decals.map((d) => linkIndex.get(d.link) ?? 0);
  const ledLink = shared.leds.map((d) => linkIndex.get(d.link) ?? 0);
  const trail = createGripperTrail();
  trail.prewarmDraw();   // visible for the boot prewarm pass (11.9 Prewarmable)
  group.add(trail.mesh);

  // Scratch state (allocated once).
  const poses = createLinkPoses(model);
  const linkMatrices = model.links.map(() => new Matrix4());
  const linkHidden = model.links.map(() => false);
  const pos = new Float64Array(3);
  const quat = new Float64Array(4);
  const scratchQ = new Float64Array(4);
  const center = new Float64Array(3);
  const m = new Matrix4();
  const ledColor = new Color();
  const white = new Color(1, 1, 1);
  const tipHistory = createPointHistory();
  const tip = new Float64Array(3);
  const lastTip = new Float64Array(3);
  const effort = new Float32Array(6);
  let wasCharging = false;
  let lastKind: DriverKind | null | undefined;
  let lastColorblind = colorblind;

  const recolor = (cb: boolean) => {
    for (const e of materials) recolorShellMaterial(e.handle, e.slot, colorway, seat, cb);
    setArmTeam(uniforms, seat, cb);
    uniforms.uRim.value = colorway === "pilot" ? RIM_GAIN.pilot : RIM_GAIN.rival;
  };
  recolor(colorblind);

  return {
    seat, group, decals, leds, trail, uniforms, links,
    update(rt, dtS, nowMs) {
      const game = rt.game;
      const frame = game.engine.frame;
      const info = game.engine.info;
      const director = game.director;
      const cues = rt.vfx.cues;
      const cb = rt.colorblind();
      const cfg = director.config;
      const kind = cfg ? cfg.seats[seat].driver.kind : null;
      if (kind !== lastKind || cb !== lastColorblind) {
        lastKind = kind;
        lastColorblind = cb;
        colorway = colorwayFor(kind, seat);
        recolor(cb);
        const drv = cfg?.seats[seat].driver;
        uniforms.uBands.value = drv ? bandsFor(drv.kind, drv.kind === "builtin" ? drv.personality : null) : 0;
        uniforms.uBandColor.value.copy(linearColor(colorway === "pilot" ? "#0E0F14" : "#F6F3EC"));
      }

      // Link poses: body buffers with α interpolation, or FK on the joint angles.
      const ids = info.bodyId[seat];
      let useBodies = true;
      for (let i = 0; i < model.links.length; i++) {
        if (!hasBody(frame, ids[model.links[i].link])) { useBodies = false; break; }
      }
      if (!useBodies) forwardKinematics(model, seat, frame.arms[seat].q, poses);
      const alpha = game.clock.alpha;
      const vib = game.feedback.juice.victimVibration;
      // FeedbackFrame.vibration (11.9): mm of render-only life on the upper links at 30 Hz (the pilot's hold tremor and
      // heat, the victim's flinch held through the freeze). The struck link keeps juice's directed contact-frame offset.
      const feel = game.feedback.frame;
      const tremorM = feel.vibration[seat] * 1e-3;
      const wob = tremorM > 0 ? Math.sin(nowMs * (Math.PI * 2 * 30) / 1000) * tremorM : 0;
      let topZ = 0;
      for (let i = 0; i < model.links.length; i++) {
        const g = links[i];
        const link = model.links[i].link;
        if (useBodies) {
          interpolateBody(frame, ids[link], alpha, pos, quat, scratchQ);
        } else {
          pos[0] = poses.pos[i * 3]; pos[1] = poses.pos[i * 3 + 1]; pos[2] = poses.pos[i * 3 + 2];
          wxyzToXyzw(poses.quat, i * 4, quat, 0);
        }
        if (vib.seat === seat && vib.link === link) {
          pos[0] += vib.offset[0]; pos[1] += vib.offset[1]; pos[2] += vib.offset[2];
        } else if (wob !== 0 && i >= 2) {
          pos[1] += wob; pos[2] += wob * 0.5;
        }
        g.position.set(pos[0], pos[1], pos[2]);
        g.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
        linkMatrices[i].compose(g.position, g.quaternion, ONE);
        if (pos[2] > topZ) topZ = pos[2];
      }

      // Own-arm dither in the cockpit (3.2): gate a link only when its bounding sphere crosses the near-plane
      // band along the view direction; the shader then dithers just the fragments inside that band.
      const ditherOn = director.cameraMode === "cockpit" && director.cameraSeat === seat && game.view.lastPose !== null;
      const eye = rt.cameraSim, fwd = rt.forwardSim;
      // LOD0 only on the arm the camera favours; LOD1 stands in on the other arm and always feeds the reflection,
      // where the whole body stays visible (5.4): a hidden link keeps its LOD1 on REFLECTION_LAYER alone.
      const favoured = director.cameraSeat === seat;
      for (let i = 0; i < model.links.length; i++) {
        let d = 0;
        const hidden = ditherOn && COCKPIT_HIDDEN_LINKS.has(model.links[i].link);
        linkHidden[i] = hidden;
        if (ditherOn && !hidden) {
          const b = assets.linkBounds[model.links[i].link];
          const g = links[i];
          quat[0] = g.quaternion.x; quat[1] = g.quaternion.y; quat[2] = g.quaternion.z; quat[3] = g.quaternion.w;
          rotateVecXyzw(quat, 0, b.center, 0, center, 0);
          const depth = (g.position.x + center[0] - eye[0]) * fwd[0] + (g.position.y + center[1] - eye[1]) * fwd[1] + (g.position.z + center[2] - eye[2]) * fwd[2];
          d = depth - b.radius < OWN_ARM_DITHER_DEPTH_M && depth + b.radius > 0 ? 1 : 0;
        }
        const o = i * LINK_STRIDE * 4 + DITHER_OFFSET;
        for (let k = 0; k < linkP.length; k++) linkP[k].value[o] = d;
      }
      // One draw per material class. Only the shells go: the shadow proxy stays, so the arm still casts its
      // full shadow on the deck, and the mirror keeps the whole body (it has its own merge). The cockpit's
      // hidden links are a bone-order prefix of the index buffer, so the viewmodel is a draw range — and
      // since both arms share the LOD0 geometry, only the one arm that draws it may write that range.
      for (const s of shells) {
        s.lod0.visible = favoured && (!ditherOn || s.cockpitStart < s.indexCount);
        s.lod1.visible = !favoured;
        if (favoured) s.lod0.geometry.setDrawRange(ditherOn ? s.cockpitStart : 0, ditherOn ? s.indexCount - s.cockpitStart : Infinity);
      }

      // Shell uniforms.
      const combat = game.rules.state;
      const cs = combat.seats[seat];
      const t = nowMs / 1000;
      const c = cs.charging ? cs.charge : 0;
      let charge = c >= 0.25 ? (2 + 8 * c) * (c >= 1 ? 1 : 0.75 + 0.25 * Math.sin(t * Math.PI * 8)) : 0;
      charge += cues.handFlash(seat, nowMs) * 6;
      uniforms.uCharge.value = charge;
      uniforms.uRimFlash.value = cues.rimFlash(seat, nowMs);
      const playerSeat = game.hud.playerSeat;
      uniforms.uHeatStrip.value = playerSeat === seat && combat.scoring === "full" ? 1 : 0;
      uniforms.uHeat.value = cs.heat;
      uniforms.uCutout.value = cs.servoState === "cutout" ? 1 : 0;
      uniforms.uWear.value = Math.min(1, combat.fightTimeS / 45);
      uniforms.uTime.value = t % 1000;
      uniforms.uDerez.value = rt.vfx.derez.derez(seat, nowMs);
      uniforms.uDerezBottom.value = 0;
      uniforms.uDerezTop.value = (topZ + 0.08) * 2.05;
      uniforms.uScanY.value = rt.vfx.scanRenderY;

      // Decals follow their links.
      for (let k = 0; k < shared.decals.length; k++) {
        decals.setMatrixAt(k, linkHidden[decalLink[k]] ? ZERO_SCALE : m.multiplyMatrices(linkMatrices[decalLink[k]], shared.decals[k].matrix));
      }
      decals.instanceMatrix.needsUpdate = true;
      decals.visible = uniforms.uDerez.value < 0.35 && rt.vfx.scanRenderY > 100;

      // Servo LEDs and flank strips: measured effort per joint (fast attack, slow release), a show pulse
      // rippling base → gripper, white flare on impact (taken or landed).
      const arm = frame.arms[seat];
      const rise = Math.min(1, dtS * EFFORT_RISE), fall = Math.min(1, dtS * EFFORT_FALL);
      for (let j = 0; j < 6; j++) {
        const e = servoEffort(arm.tau[j], arm.forceRange[j], arm.qd[j]);
        effort[j] += (e - effort[j]) * (e > effort[j] ? rise : fall);
      }
      const dead = rt.vfx.derez.ledsDead(seat, nowMs);
      const flash = Math.max(cues.victimLedFlash(seat, nowMs), cues.handFlash(seat, nowMs) * 0.7);
      const flicker = cues.ledFlicker(seat, nowMs);
      const offline = cs.servoState === "offline";
      const team = linearColor(teamHex(seat, cb));
      // Per-link LED on the shells (5.4 uLed): the pilot's 3.3 state machine for the pilot's seat, servo effort in the
      // team colour for the opponent; FeedbackFrame.ledFlare paints the striking / struck link white for 250 ms.
      const pilotLed = playerSeat === seat ? (game.pilot as Partial<{ led: LedFrame }>).led ?? null : null;
      if (pilotLed) setArmLed(uniforms, pilotLed);
      const flareLink = feel.ledFlare[seat];
      const lowFlicker = cs.integrity > 0 && cs.integrity <= 25 && seat !== playerSeat ? (Math.floor(nowMs / 90) % 3 === 0 ? 0.25 : 1) : 1;
      for (let k = 0; k < shared.leds.length; k++) {
        const led = shared.leds[k];
        leds.setMatrixAt(k, linkHidden[ledLink[k]] ? ZERO_SCALE : m.multiplyMatrices(linkMatrices[ledLink[k]], led.matrix));
        if (led.joint < dead || (offline && dead === 0 && rt.vfx.derez.koAtMs(seat) < 0)) {
          ledColor.setRGB(0.01, 0.01, 0.012);
          if (!pilotLed) setArmLinkLed(uniforms, led.link, 0, 0, 0, 0);
        } else {
          const pulse = 0.85 + 0.15 * Math.sin(t * 5 - led.joint * 0.9);
          const b = (LED_IDLE + (1 - LED_IDLE) * effort[led.joint]) * pulse * flicker * lowFlicker;
          if (pilotLed) {
            const o = LINK_IDS.indexOf(led.link) * 4;
            const p = pilotLed.perLink;
            ledColor.setRGB(p[o], p[o + 1], p[o + 2]).multiplyScalar(CALIBRATION.emissive.led * Math.max(LED_IDLE * 0.5, p[o + 3]) * flicker * lowFlicker);
          } else {
            ledColor.copy(team).multiplyScalar(CALIBRATION.emissive.led * b);
            setArmLinkLed(uniforms, led.link, team.r, team.g, team.b, b);
          }
          const f = led.link === flareLink ? 1 : flash;
          if (f > 0) ledColor.lerp(white, f).multiplyScalar(1 + f * 8);
          // A 3 mm status LED does not flare wider than the gripper that holds it. Its quad is LED_SIZE_M
          // across; the drive above reaches 9–10 linear against a 0.98 bloom threshold, which painted two
          // colourless ~50 px blobs in front of the machine in every frame. Cap the bead a little over the
          // threshold so it reads as a hot LED with a tight core, and let only the 250 ms impact flare go
          // higher — that one is meant to be a flash.
          const cap = f > 0 ? LED_FLARE_CAP : LED_CAP;
          const peak = Math.max(ledColor.r, ledColor.g, ledColor.b);
          if (peak > cap) ledColor.multiplyScalar(cap / peak);
        }
        if (led.link === flareLink) setArmLinkLed(uniforms, led.link, 1, 1, 1, 4);
        leds.setColorAt(k, ledColor);
      }
      leds.instanceMatrix.needsUpdate = true;
      if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
      leds.visible = decals.visible;

      // Gripper motion trail (interpolated tip, speed from the frame); a charge release forces it on.
      samplePointHistory(tipHistory, arm.eePos, 0, frame.step, alpha, tip);
      const speed = Math.hypot(arm.eeVel[0], arm.eeVel[1], arm.eeVel[2]);
      if (uniforms.uDerez.value > 0 || Math.hypot(tip[0] - lastTip[0], tip[1] - lastTip[1], tip[2] - lastTip[2]) > TRAIL_TELEPORT_M) trail.clear();
      lastTip.set(tip);
      if (wasCharging && !cs.charging) trail.force();
      wasCharging = cs.charging;
      trail.setColor(team);
      if (uniforms.uDerez.value === 0) trail.push(tip[0], tip[1], tip[2], speed, dtS);
    },
    dispose() {
      for (const e of materials) e.handle.material.dispose();
      shadowMaterial.dispose();
      decals.geometry.dispose();
      (decals.material as MeshBasicMaterial).dispose();
      leds.geometry.dispose();
      (leds.material as MeshBasicMaterial).dispose();
      trail.dispose();
      group.clear();
    },
  };
}

/* ───────────────────────── component ───────────────────────── */

export function RobotView(props: { rt: StageRuntime; onRigs?: (rigs: Record<Seat, ArmRig> | null) => void }): JSX.Element | null {
  const { rt, onRigs } = props;
  const assets = useRobotAssets(rt.game);
  const rigs = useMemo(() => {
    if (!assets) return null;
    const cb = rt.colorblind();
    return { atlas: createArmRig(assets, "atlas", cb), blaze: createArmRig(assets, "blaze", cb) } as Record<Seat, ArmRig>;
  }, [assets, rt]);
  useEffect(() => {
    onRigs?.(rigs);
    return () => {
      onRigs?.(null);
      if (rigs) { rigs.atlas.dispose(); rigs.blaze.dispose(); }
    };
  }, [rigs, onRigs]);
  useFrame((_, dt) => {
    if (!rigs) return;
    const now = rt.wallMs();
    for (const seat of SEATS) rigs[seat].update(rt, dt, now);
  }, 0);
  if (!rigs) return null;
  return (
    <>
      {SEATS.map((seat) => (
        <group key={seat}>
          <primitive object={rigs[seat].group} />
          <primitive object={rigs[seat].decals} />
          <primitive object={rigs[seat].leds} />
        </group>
      ))}
    </>
  );
}
