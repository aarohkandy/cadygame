// src/game/render/shadow-proxies.ts (WP6)
// Shadow casters built from the MJCF collision primitives (BUILD_PLAN D10): the visual meshes are ~300k
// triangles per arm, so the key light's shadow pass renders one merged, low-poly proxy per link instead.
// Proxies live on SHADOW_LAYER only: the key light's shadow camera enables that layer and the main
// camera does not, so proxies cost nothing in the main pass.
import { BoxGeometry, type BufferGeometry, CapsuleGeometry, Matrix4, Quaternion, SphereGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { LinkId } from "../contracts.ts";
import type { ColliderGeom, RobotAssets } from "./robot-assets.ts";

/** Layer that only shadow cameras render. */
export const SHADOW_LAYER = 1;

/**
 * Hand-authored proxy for links whose MJCF body carries no collision primitive (the base): a footprint box
 * matching the printed base and its servo stack, in link-local metres.
 */
const EXTRA_PROXIES: Partial<Record<LinkId, ColliderGeom[]>> = {
  base: [
    { type: "box", size: [0.046, 0.042, 0.024], pos: [0.012, 0, 0.024], quat: [1, 0, 0, 0] },
    { type: "box", size: [0.024, 0.018, 0.014], pos: [0.026, 0, 0.056], quat: [1, 0, 0, 0] },
  ],
};

function primitive(c: ColliderGeom): BufferGeometry {
  if (c.type === "box") return new BoxGeometry(c.size[0] * 2, c.size[1] * 2, c.size[2] * 2).toNonIndexed();
  if (c.type === "sphere") return new SphereGeometry(c.size[0], 8, 6).toNonIndexed();
  // MuJoCo capsules run along local Z; three's along Y.
  const g = new CapsuleGeometry(c.size[0], c.size[1] * 2, 3, 8).toNonIndexed();
  g.rotateX(Math.PI / 2);
  return g;
}

/** One merged proxy geometry per link (link-local), or null when the link has nothing to cast. */
export function buildShadowProxies(assets: RobotAssets): Map<LinkId, BufferGeometry> {
  const out = new Map<LinkId, BufferGeometry>();
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const one = new Vector3(1, 1, 1);
  for (const link of assets.model.links) {
    const colliders = [...link.colliders, ...(EXTRA_PROXIES[link.link] ?? [])];
    if (colliders.length === 0) continue;
    const parts: BufferGeometry[] = [];
    for (const c of colliders) {
      const g = primitive(c);
      g.deleteAttribute("uv");
      g.deleteAttribute("normal");
      q.set(c.quat[1], c.quat[2], c.quat[3], c.quat[0]);
      p.set(c.pos[0], c.pos[1], c.pos[2]);
      g.applyMatrix4(m.compose(p, q, one));
      parts.push(g);
    }
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      out.set(link.link, merged);
    }
  }
  return out;
}

/** Triangles in a proxy set, for the D10 triangle budget. */
export function proxyTriangles(proxies: ReadonlyMap<LinkId, BufferGeometry>): number {
  let n = 0;
  for (const g of proxies.values()) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  return n;
}
