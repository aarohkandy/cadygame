// src/game/render/truss-rig.tsx (ROLE LIGHT, GROUNDING E)
// The fixture that makes the light. Every pool on the deck used to arrive from nowhere; this is the rig that
// throws it, and it answers the three questions GROUNDING asks of anything on screen:
//   made of — 50 mm aluminium chord / 20 mm brace box truss, 290 mm section, the ordinary 12" square truss any
//             studio hangs; black-anodised LED par cans; steel C-clamps, drop bolts and yokes; 4 mm wire rope.
//   held up by — four wire ropes from the studio ceiling at the truss corners, running up out of frame.
//   installed by — the same rigger who clamped each can to the bottom chord, panned it, tilted it in the yoke
//             and dropped a safety bond. Cans are FIXED: a par can does not wander. They are LED pars, so they
//             change colour on a KO cue (lighting.tsx writes TRUSS_LENS) but never move.
//
// Scale is the point as much as the light is: a 200 mm can 1.7 m over a 1.10 m table, next to a 30 cm arm, is
// the cue that tells a first-time viewer the deck is a metre across (GROUNDING G).
//
// Budget: measured +3 draw calls and +4 984 triangles when the rig is in frame, 0 when it is not — one instanced tube (chords, braces, ropes,
// clamps, yokes), one instanced can body, one instanced lens. Two boot-time programs (standard, basic +
// instance colour); nothing compiles after prewarm, nothing is added or removed at runtime. The tube and can
// matrices are written once at mount and never touched again; only the lens colours change per frame.
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type JSX } from "react";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CircleGeometry, Color, CylinderGeometry, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry,
} from "three";
import { MOUNT_X, RENDER_SCALE, type Seat, type Vec3 } from "../contracts.ts";

/** Box truss (sim metres): chord centreline height, plan half-extents, 290 mm section, 50 / 20 mm tube. */
export const TRUSS = {
  z: 2.05, halfX: 1.45, halfY: 1.55, section: 0.29,
  chordR: 0.025, braceR: 0.010, bayM: 0.29, ropeR: 0.004, ceilingZ: 3.6,
} as const;

/** Par can (sim metres): 200 mm barrel on a 105 mm yoke, clamped under the bottom chord. */
const CAN = { barrelR: 0.098, barrelL: 0.30, trimR: 0.106, yokeHalf: 0.105, yokeDrop: 0.16, clampDrop: 0.09 } as const;

/**
 * A rigged fixture: where it is clamped on the bottom chord (plan x, y) and the point on the deck it was
 * aimed at. `lit` fixtures are the four the show actually drives; the rest are dark spares, which is what a
 * real rig looks like and what stops the four lit ones reading as magic.
 */
interface Rigged { chord: readonly [number, number]; target: Vec3; lit: boolean }

const CHORD_BOTTOM_Z = TRUSS.z - TRUSS.section / 2;

const RIG: readonly Rigged[] = [
  // Lit, in the order lighting.tsx expects: the two team key-fills, then the two overhead shafts.
  { chord: [-TRUSS.halfX, 1.05], target: [MOUNT_X.atlas - 0.35, 0, 0.15], lit: true },
  { chord: [TRUSS.halfX, -1.05], target: [MOUNT_X.blaze + 0.35, 0, 0.15], lit: true },
  // The key's own lamp. quality.ts calibrates the key at elevation 48°, azimuth 110°, i.e. arriving from
  // (−0.23, +0.63, +0.74); this can throws along (+0.47, −0.53, −0.71), 14° off that axis, so the hard white
  // shaft in the haze and the shadow direction on the deck come from the same place. Move one, move the other.
  { chord: [-1.05, TRUSS.halfY], target: [0.05, 0.3, 0], lit: true },
  { chord: [-0.6, -TRUSS.halfY], target: [-0.1, -0.5, 0], lit: true },
  // Dark spares, hung and aimed but not struck.
  { chord: [-TRUSS.halfX, -0.35], target: [-0.5, -0.2, 0], lit: false },
  { chord: [-TRUSS.halfX, -1.25], target: [-0.3, -0.6, 0], lit: false },
  { chord: [TRUSS.halfX, 0.35], target: [0.5, 0.2, 0], lit: false },
  { chord: [TRUSS.halfX, 1.25], target: [0.3, 0.6, 0], lit: false },
  { chord: [0.95, TRUSS.halfY], target: [0.4, 0.3, 0], lit: false },
  { chord: [0.3, TRUSS.halfY], target: [0.15, 0.35, 0], lit: false },
  { chord: [0.6, -TRUSS.halfY], target: [0.25, -0.4, 0], lit: false },
  { chord: [1.05, -TRUSS.halfY], target: [0.45, -0.3, 0], lit: false },
];

export const LIT_FIXTURE_COUNT = RIG.filter((f) => f.lit).length;

/** Aperture (beam apex) and aim of fixture `i`, sim metres — derived from where it is clamped, not guessed. */
function apertureOf(f: Rigged): { pivot: Vector3; aim: Vector3; aperture: Vector3 } {
  const pivot = new Vector3(f.chord[0], f.chord[1], CHORD_BOTTOM_Z - CAN.clampDrop - CAN.yokeDrop);
  const aim = new Vector3(f.target[0], f.target[1], f.target[2]).sub(pivot).normalize();
  const aperture = pivot.clone().addScaledVector(aim, CAN.barrelL / 2);
  return { pivot, aim, aperture };
}

/**
 * The four lit apertures and their aim directions (sim), in RIG order. lighting.tsx hangs its beams and deck
 * pools off these, so the cone apex is inside the can that throws it by construction rather than by eye.
 */
export const LIT_FIXTURES: readonly { lamp: Vec3; aim: Vec3; seat?: Seat }[] = RIG.filter((f) => f.lit).map((f, i) => {
  const { aim, aperture } = apertureOf(f);
  return {
    lamp: [aperture.x, aperture.y, aperture.z] as Vec3,
    aim: [aim.x, aim.y, aim.z] as Vec3,
    seat: i === 0 ? ("atlas" as Seat) : i === 1 ? ("blaze" as Seat) : undefined,
  };
});

/**
 * Lens colours, linear, written by lighting.tsx each frame (the same values its beams carry) and read here.
 * A dark spare stays at 0. This is the one thing about the rig that changes at runtime.
 */
export const TRUSS_LENS: { readonly color: Color[] } = { color: RIG.filter((f) => f.lit).map(() => new Color()) };

/* ───────────────────────── geometry ───────────────────────── */

/** One unit tube along +Y, open-ended: 16 triangles. Every metal member of the rig is an instance of this. */
function tubeGeometry(): BufferGeometry {
  return new CylinderGeometry(1, 1, 1, 8, 1, true);
}

/**
 * The can body in its own frame: aperture down −Z, yoke pin through the origin, so a pan about Z and a tilt
 * about the pin are exactly the two rotations a rigger has.
 */
function canGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const push = (g: BufferGeometry, z: number) => { g.rotateX(Math.PI / 2); g.translate(0, 0, z); parts.push(g); };
  push(new CylinderGeometry(CAN.barrelR, CAN.barrelR, CAN.barrelL, 14, 1, true), 0);
  // Front trim ring: the lip that holds the lens and the barn-door slot.
  push(new CylinderGeometry(CAN.trimR, CAN.trimR, 0.035, 14, 1, true), -CAN.barrelL / 2 + 0.017);
  // Rear housing, tapering to the cable gland.
  push(new CylinderGeometry(0.062, CAN.barrelR, 0.07, 14, 1, false), CAN.barrelL / 2 + 0.034);
  // Yoke pin bosses, one each side, on the pin axis (local X).
  for (const s of [-1, 1]) {
    const boss = new CylinderGeometry(0.019, 0.019, 0.022, 10, 1, false);
    boss.rotateZ(Math.PI / 2);
    boss.translate(s * (CAN.yokeHalf - 0.008), 0, 0);
    parts.push(boss);
  }
  return mergeGeometries(parts, false) ?? parts[0];
}

/** Writes one tube instance spanning a→b with radius r (the unit tube runs along +Y). */
const TUBE_AXIS = new Vector3(0, 1, 0);
function setTube(mesh: InstancedMesh, i: number, s: readonly number[], m: Matrix4, q: Quaternion, v: Vector3, scale: Vector3): void {
  v.set(s[3] - s[0], s[4] - s[1], s[5] - s[2]);
  const len = v.length();
  q.setFromUnitVectors(TUBE_AXIS, v.multiplyScalar(1 / Math.max(1e-6, len)));
  mesh.setMatrixAt(i, m.compose(v.set((s[0] + s[3]) / 2, (s[1] + s[4]) / 2, (s[2] + s[5]) / 2), q, scale.set(s[6], len, s[6])));
}

/** Pan-then-tilt: the quaternion taking local −Z onto `aim`, keeping the yoke upright the way a clamp does. */
function yokeQuat(aim: Vector3, q: Quaternion, qz: Quaternion, up: Vector3): Quaternion {
  const tilt = Math.acos(Math.min(1, Math.max(-1, -aim.z)));
  const pan = Math.atan2(-aim.x, aim.y);
  q.setFromAxisAngle(up.set(1, 0, 0), tilt);
  qz.setFromAxisAngle(up.set(0, 0, 1), pan);
  return q.premultiply(qz);
}

/** Every tube in the rig: 16 chords, the zigzag bracing on both faces of all four runs, 4 ropes, 5 per fixture. */
function buildTubes(): { mesh: InstancedMesh; dispose(): void } {
  const spans: number[][] = [];
  const h = TRUSS.section / 2;
  // Four runs: two along y at x = ±halfX, two along x at y = ±halfY. Each is a box truss with four chords and
  // a zigzag brace on each vertical face.
  const runs: { along: "x" | "y"; at: number; from: number; to: number }[] = [
    { along: "y", at: -TRUSS.halfX, from: -TRUSS.halfY, to: TRUSS.halfY },
    { along: "y", at: TRUSS.halfX, from: -TRUSS.halfY, to: TRUSS.halfY },
    { along: "x", at: -TRUSS.halfY, from: -TRUSS.halfX, to: TRUSS.halfX },
    { along: "x", at: TRUSS.halfY, from: -TRUSS.halfX, to: TRUSS.halfX },
  ];
  for (const run of runs) {
    const pt = (s: number, off: number, dz: number): [number, number, number] =>
      run.along === "y" ? [run.at + off, s, TRUSS.z + dz] : [s, run.at + off, TRUSS.z + dz];
    for (const off of [-h, h]) {
      for (const dz of [-h, h]) spans.push([...pt(run.from, off, dz), ...pt(run.to, off, dz), TRUSS.chordR]);
      // Zigzag: one diagonal per bay, alternating top→bottom, the way a ladder face is braced.
      const bays = Math.max(1, Math.round(Math.abs(run.to - run.from) / TRUSS.bayM));
      for (let b = 0; b < bays; b++) {
        const s0 = run.from + ((run.to - run.from) * b) / bays;
        const s1 = run.from + ((run.to - run.from) * (b + 1)) / bays;
        const up = b % 2 === 0;
        spans.push([...pt(s0, off, up ? -h : h), ...pt(s1, off, up ? h : -h), TRUSS.braceR]);
      }
    }
  }
  // Wire rope to the ceiling at the four corners.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    spans.push([sx * TRUSS.halfX, sy * TRUSS.halfY, TRUSS.z + h, sx * TRUSS.halfX, sy * TRUSS.halfY, TRUSS.ceilingZ, TRUSS.ropeR]);
  }
  // Per fixture: C-clamp body on the bottom chord, drop bolt, yoke cross-piece, two yoke arms.
  for (const f of RIG) {
    const { pivot, aim } = apertureOf(f);
    const [cx, cy] = f.chord;
    const yokeZ = pivot.z + CAN.yokeDrop;
    const onY = Math.abs(cx) === TRUSS.halfX;
    const ax = onY ? 0.045 : 0, ay = onY ? 0 : 0.045;
    spans.push([cx - ax, cy - ay, CHORD_BOTTOM_Z, cx + ax, cy + ay, CHORD_BOTTOM_Z, 0.036]);
    spans.push([cx, cy, CHORD_BOTTOM_Z, cx, cy, yokeZ, 0.008]);
    // The pin axis: horizontal and square to the aim, so the yoke reads as holding the barrel it carries.
    let ux = -aim.y, uy = aim.x;
    const ul = Math.hypot(ux, uy) || 1;
    ux = (ux / ul) * CAN.yokeHalf; uy = (uy / ul) * CAN.yokeHalf;
    spans.push([cx - ux, cy - uy, yokeZ, cx + ux, cy + uy, yokeZ, 0.011]);
    for (const s of [-1, 1]) spans.push([cx + s * ux, cy + s * uy, yokeZ, pivot.x + s * ux, pivot.y + s * uy, pivot.z, 0.011]);
  }

  const geometry = tubeGeometry();
  // Mill-finish aluminium, dirty from a decade of load-ins: satin, not chrome. A high-metalness tube has no
  // diffuse term at all and, seen from underneath with the key overhead and a dark bowl to reflect, renders
  // as a black wire. 0.3 / 0.55 is what an oxidised extrusion actually does and what lets the rig read.
  const material = new MeshStandardMaterial({ color: "#9AA0A8", metalness: 0.3, roughness: 0.55 });
  const mesh = new InstancedMesh(geometry, material, spans.length);
  mesh.name = "truss-tubes";
  const m = new Matrix4(), q = new Quaternion(), v = new Vector3(), scale = new Vector3();
  spans.forEach((s, i) => setTube(mesh, i, s, m, q, v, scale));
  mesh.instanceMatrix.needsUpdate = true;
  // Static matrices, so a real bounding sphere is free and frustum culling can have the rig back: from the
  // cockpit the truss is overhead and out of frame most of the time, and these draws should not be paid for.
  mesh.computeBoundingSphere();
  return { mesh, dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); } };
}

/** The can bodies and their lenses, pan/tilted in their yokes. */
function buildCans(): { cans: InstancedMesh; lenses: InstancedMesh; dispose(): void } {
  const canGeo = canGeometry();
  // Black textured paint on a die-cast housing: dark enough to stay a silhouette, matte enough that the key
  // finds its top edge so the barrel reads as a cylinder and not as a hole.
  const canMat = new MeshStandardMaterial({ color: "#212430", metalness: 0.25, roughness: 0.55 });
  const cans = new InstancedMesh(canGeo, canMat, RIG.length);
  cans.name = "truss-cans";

  const lensGeo = new CircleGeometry(CAN.barrelR * 0.95, 14);
  // The lens is the only emitter on the rig, and the only thing here that ignores fog: a struck par can reads
  // through the haze that the aluminium around it sinks into.
  const lensMat = new MeshBasicMaterial({ toneMapped: true, fog: false });
  const lenses = new InstancedMesh(lensGeo, lensMat, LIT_FIXTURE_COUNT);
  lenses.name = "truss-lenses";

  const m = new Matrix4(), q = new Quaternion(), qz = new Quaternion(), v = new Vector3(), aim = new Vector3();
  const one = new Vector3(1, 1, 1);
  const flip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  let lit = 0;
  RIG.forEach((f, i) => {
    const d = apertureOf(f);
    aim.copy(d.aim);
    yokeQuat(aim, q, qz, v);
    cans.setMatrixAt(i, m.compose(d.pivot, q, one));
    if (!f.lit) return;
    // The lens sits a millimetre inside the trim ring, facing the same way.
    v.copy(d.pivot).addScaledVector(aim, CAN.barrelL / 2 - 0.002);
    // CircleGeometry faces +Z; the can's aperture is −Z, so flip it into the opening.
    lenses.setMatrixAt(lit, m.compose(v, qz.copy(q).multiply(flip), one));
    lenses.setColorAt(lit, TRUSS_LENS.color[lit]);
    lit++;
  });
  cans.instanceMatrix.needsUpdate = true;
  lenses.instanceMatrix.needsUpdate = true;
  cans.computeBoundingSphere();
  lenses.computeBoundingSphere();
  // setColorAt allocates instanceColor on first use; it exists by here.
  lenses.instanceColor?.setUsage(DynamicDrawUsage);
  return {
    cans, lenses,
    dispose() { canGeo.dispose(); canMat.dispose(); lensGeo.dispose(); lensMat.dispose(); cans.dispose(); lenses.dispose(); },
  };
}

/** The one thing on the rig that changes: what each struck lens is putting out this frame. */
function pushLensColors(lenses: InstancedMesh): void {
  const ic = lenses.instanceColor;
  if (!ic) return;
  for (let i = 0; i < LIT_FIXTURE_COUNT; i++) lenses.setColorAt(i, TRUSS_LENS.color[i]);
  ic.needsUpdate = true;
}

/**
 * The rig. Authored in sim metres under the same root transform the rest of the world uses, so a fixture's
 * coordinates are the ones the beams and the deck pools are computed from.
 */
export function TrussRig(): JSX.Element {
  const built = useMemo(() => {
    const tubes = buildTubes();
    const cans = buildCans();
    return { tubes, cans };
  }, []);
  useEffect(() => () => { built.tubes.dispose(); built.cans.dispose(); }, [built]);

  useFrame(() => pushLensColors(built.cans.lenses), 0.1);

  return (
    <group scale={RENDER_SCALE} rotation={[-Math.PI / 2, 0, 0]} name="truss-rig">
      <primitive object={built.tubes.mesh} />
      <primitive object={built.cans.cans} />
      <primitive object={built.cans.lenses} />
    </group>
  );
}

/**
 * Lens drive (linear) the show writes into TRUSS_LENS for a struck par. 5.0 is five times the bloom gate, so a
 * struck can is a blown-white disc with a real flare around it rather than a slightly bright grey circle: it is
 * a filament behind glass, and it is the only thing on the rig allowed to flare (GROUNDING acceptance 6 and 7).
 */
export const LENS_GAIN = 5.0;
