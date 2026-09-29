// src/game/render/holo-crowd.tsx (WP2, re-scaled by GROUNDING part 2 item 4)
// The holographic crowd and its stands (EMOTION_BIBLE 5.2): a two-row standing rake 14 m back behind a
// 1.05 m dasher board, a navy mass the light rakes across; ≤ 160 dim hologram billboards stand on it in one
// instanced draw, at 1.70 m — the same human scale as the tripods and the flight case inside the barrier.
// The LED ribbon on the dasher board and the two sponsor boards on the concourse rail (led-strips.tsx) sit
// on the faces this profile leaves for them.
// Per frame (uniforms only): hype leans the crowd in, strikes make the struck side's near rows jump, KOs
// throw arms up and surge the glow, the ENGAGE slam flares the bowl, and above hype 80 the leaning side's
// stand strobes its team colour (stage-cues `hypeLean`). Tiers draw an evenly spread prefix.
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type JSX } from "react";
import { DoubleSide, LatheGeometry, Mesh, MeshStandardMaterial, Vector2 } from "three";
import type { StageRuntime } from "./arena-canvas.tsx";
import {
  CONCOURSE_H_M, CROWD_MAX, CROWD_TIERS, CROWD_TIER_DEPTH_M, CROWD_TIER_RISE_M, DASHER_H_M, DASHER_R_M, STAND_BACK_R_M,
  STAND_FLOOR_Z_M, STAND_FRONT_R_M, STAND_TOP_Z_M, createCrowdGeometry, createCrowdMaterial, layoutCrowd,
} from "./holo-crowd-material.ts";
import { CROWD_CAPACITY } from "./quality.ts";
import { teamTintHex } from "./robot-materials.ts";
import { linearColor } from "./vfx/sparks.ts";
import { clamp01 } from "./interpolate.ts";

/** Stand mass: deep navy with a satin finish, so the sweeping lights and the ribbons catch its edges. */
const STAND_NAVY = "#0C0F22";

/**
 * Riser profile for a lathe around the stage (radius, height) in sim metres — read outward from the stage.
 * A dasher board ringing the floor, a shallow staircase of tiers behind it, and a low rail closing the back.
 */
export function riserProfile(): Vector2[] {
  const pts: Vector2[] = [];
  const floor = STAND_FLOOR_Z_M;
  const r0 = STAND_FRONT_R_M;
  // Dasher board: the front-row figures stand behind it, so they are cut off at the shin like a real front
  // row instead of hanging in the air on an invisible floor.
  pts.push(new Vector2(DASHER_R_M, floor), new Vector2(DASHER_R_M, floor + DASHER_H_M));
  pts.push(new Vector2(r0 - 0.04, floor + DASHER_H_M), new Vector2(r0 - 0.04, floor + 0.012));
  pts.push(new Vector2(r0, floor + 0.012));
  for (let t = 0; t < CROWD_TIERS; t++) {
    const h = floor + t * CROWD_TIER_RISE_M + 0.03;
    const r = r0 + t * CROWD_TIER_DEPTH_M;
    pts.push(new Vector2(r, Math.max(floor, h)), new Vector2(r + CROWD_TIER_DEPTH_M, Math.max(floor, h)));
  }
  const top = STAND_TOP_Z_M;
  pts.push(new Vector2(STAND_BACK_R_M + 0.02, top + 0.06), new Vector2(STAND_BACK_R_M + 0.02, top + CONCOURSE_H_M));
  pts.push(new Vector2(STAND_BACK_R_M + 0.09, top + CONCOURSE_H_M), new Vector2(STAND_BACK_R_M + 0.09, floor));
  return pts;
}

export interface HoloCrowdView { readonly objects: readonly import("three").Object3D[]; update(rt: StageRuntime, dtS: number): void; dispose(): void; }

export function createHoloCrowdView(): HoloCrowdView {
  const layout = layoutCrowd(CROWD_CAPACITY);
  const geometry = createCrowdGeometry(layout);
  const { material, uniforms } = createCrowdMaterial();
  const crowd = new Mesh(geometry, material);
  crowd.frustumCulled = false;
  crowd.name = "holo-crowd";
  const riserGeo = new LatheGeometry(riserProfile(), 96);
  riserGeo.rotateX(Math.PI / 2);
  // Two-sided: the profile doubles back on itself at the dasher board and the concourse rail, so half the
  // faces that matter are seen from behind. A lathe is one draw either way.
  // No scene fog (FOG.far is 3.4 m; the rake is 14 m out, so three's fog would paint the whole stand one
  // flat slab — part 2 item 3's dead grey wall, rebuilt in geometry). The stand is simply dark instead.
  const riserMat = new MeshStandardMaterial({
    color: STAND_NAVY, roughness: 0.72, metalness: 0.10, side: DoubleSide, fog: false, dithering: true,
  });
  const risers = new Mesh(riserGeo, riserMat);
  risers.receiveShadow = true;
  risers.name = "crowd-risers";
  return {
    objects: [risers, crowd],
    update(rt, dt) {
      const now = rt.wallMs();
      const u = uniforms;
      const cues = rt.vfx.cues;
      u.uTime.value = (now / 1000) % 3600;
      const hype = clamp01(rt.game.feedback.audio.hype);
      u.uHype.value += (hype - u.uHype.value) * clamp01(dt * 4);
      u.uJumpA.value = cues.crowdJump("atlas", now);
      u.uJumpB.value = cues.crowdJump("blaze", now);
      u.uCheer.value = cues.crowdCheer(now);
      u.uSurge.value = Math.max(u.uCheer.value, cues.slam(now), cues.ledPulse(now) * 0.8);
      const tint = linearColor(teamTintHex("blaze", rt.colorblind()));
      u.uColorB.value.copy(tint);
      u.uLean.value = rt.game.feedback.frame.hypeLean;   // 11.9: hype.ts lean (the room's side), tint above hype 80
      geometry.instanceCount = Math.min(layout.count, rt.quality.tier.crowd, CROWD_MAX);
    },
    dispose() {
      geometry.dispose(); material.dispose(); riserGeo.dispose(); riserMat.dispose();
    },
  };
}

export function HoloCrowd(props: { rt: StageRuntime }): JSX.Element {
  const { rt } = props;
  const view = useMemo(() => createHoloCrowdView(), []);
  useEffect(() => () => view.dispose(), [view]);
  useFrame((_, dt) => view.update(rt, dt), 0);
  return <>{view.objects.map((o) => <primitive key={o.name} object={o} />)}</>;
}
