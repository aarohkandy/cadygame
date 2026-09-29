// src/game/render/robot-assets.ts (WP1)
// Robot render assets (EMOTION_BIBLE 10.2 step 3). so101.xml is parsed for the body tree, visual geoms and
// collision primitives. The meshes come from the bake when it is served (`arms.bake`, written by
// scripts/bake-meshes.mjs: every (link, material slot) merged, cut to LOD0 35 % / LOD1 15 % with meshopt,
// quantized to ≈ 1.6 MB) and otherwise from the 17 MB Menagerie STLs, the dev fallback: each STL parsed, welded
// (1e-4 m), given crease normals at 35°, a signed per-vertex edge mask and a print axis, merged and simplified
// in the page. Both paths produce the same LodGeometries per (link, slot): LOD0 and LOD1 share one vertex buffer,
// index only. Everything is cached in a module-level promise cache so Strict Mode double mounts and a second
// createGame() fetch nothing twice. The parsing, geometry and bake codecs are pure and run in Node for tests
// and the bake script; only `loadRobotAssets` touches fetch.
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three";
// @ts-expect-error three ships the meshopt simplifier without a declaration file (typed below, MeshoptSimplifierApi).
import { MeshoptSimplifier as MeshoptSimplifierUntyped } from "three/examples/jsm/libs/meshopt_simplifier.module.js";
import { LINK_IDS, type LinkId, type LodGeometries, type Seat, MOUNT_X } from "../contracts.ts";

/* ───────────────────────── minimal XML ───────────────────────── */

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; }

/** A small, strict-enough XML reader for MJCF: elements, attributes, comments, declarations. No text nodes. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const attrRe = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (src.startsWith("<!--", lt)) { const end = src.indexOf("-->", lt + 4); i = end < 0 ? src.length : end + 3; continue; }
    if (src.startsWith("<?", lt)) { const end = src.indexOf("?>", lt + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (src.startsWith("<!", lt)) { const end = src.indexOf(">", lt + 2); i = end < 0 ? src.length : end + 1; continue; }
    const gt = src.indexOf(">", lt);
    if (gt < 0) throw new Error("xml: unterminated tag");
    const body = src.slice(lt + 1, gt);
    i = gt + 1;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`xml: mismatched </${name}>`);
      continue;
    }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^\s*([A-Za-z_][\w:.-]*)/.exec(inner);
    if (!nameMatch) throw new Error("xml: bad tag");
    const node: XmlNode = { name: nameMatch[1], attrs: {}, children: [] };
    attrRe.lastIndex = nameMatch[0].length;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(inner)) !== null) node.attrs[m[1]] = m[3] ?? m[4] ?? "";
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("xml: unclosed element");
  return root;
}

function child(n: XmlNode, name: string): XmlNode | undefined { return n.children.find((c) => c.name === name); }
function nums(s: string | undefined, count: number, fallback: readonly number[]): number[] {
  if (!s) return fallback.slice();
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length < count || v.some((x) => !Number.isFinite(x))) return fallback.slice();
  return v.slice(0, count);
}

/* ───────────────────────── MJCF model description ───────────────────────── */

export type MaterialSlot = "shell_body" | "shell_hand" | "optics" | "servo";

/** GAME_DESIGN 6.7 mesh → material slot table. */
export const MESH_SLOTS: Readonly<Record<string, MaterialSlot>> = {
  base_so101_v2: "shell_body", rotation_pitch_so101_v1: "shell_body", upper_arm_so101_v1: "shell_body",
  under_arm_so101_v1: "shell_body", motor_holder_so101_base_v1: "shell_body", base_motor_holder_so101_v1: "shell_body",
  waveshare_mounting_plate_so101_v2: "shell_body",
  wrist_roll_pitch_so101_v2: "shell_hand", motor_holder_so101_wrist_v1: "shell_hand", wrist_roll_follower_so101_v1: "shell_hand",
  moving_jaw_so101_v1: "shell_hand",
  wrist_roll_follower_so101_camera_mount: "optics",
  sts3215_03a_v1: "servo", sts3215_03a_no_horn_v1: "servo",
};

/** Body name suffix → LinkId (GAME_DESIGN 10.4). */
export const BODY_LINK: Readonly<Record<string, LinkId>> = {
  base: "base", shoulder: "shoulder", upper_arm: "upper_arm", lower_arm: "lower_arm", wrist: "wrist",
  gripper: "gripper", camera_mount: "camera_mount", moving_jaw_so101_v1: "moving_jaw",
};

export interface VisualGeom { mesh: string; slot: MaterialSlot; pos: [number, number, number]; quat: [number, number, number, number] /* wxyz */; }
export interface ColliderGeom { type: "box" | "sphere" | "capsule"; size: number[]; pos: [number, number, number]; quat: [number, number, number, number] /* wxyz */; }
export interface LinkDesc {
  link: LinkId; bodyName: string; parent: number;               // index into links, −1 for the root
  pos: [number, number, number]; quat: [number, number, number, number];   // wxyz, relative to the parent body
  jointIndex: number;                                           // 0..5 into JOINT_NAMES order, −1 fixed
  axis: [number, number, number];
  visuals: VisualGeom[]; colliders: ColliderGeom[];
}
export interface RobotModelDesc { links: LinkDesc[]; meshFiles: Record<string, string>; }

const JOINT_ORDER = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];

function normQuat(q: number[]): [number, number, number, number] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** MuJoCo default eulerseq "xyz" (intrinsic), radians → wxyz. */
function eulerXyzToQuat(e: number[]): [number, number, number, number] {
  const [a, b, c] = e;
  const ca = Math.cos(a / 2), sa = Math.sin(a / 2), cb = Math.cos(b / 2), sb = Math.sin(b / 2), cc = Math.cos(c / 2), sc = Math.sin(c / 2);
  // q = qx(a) ⊗ qy(b) ⊗ qz(c)
  const w = ca * cb * cc - sa * sb * sc;
  const x = sa * cb * cc + ca * sb * sc;
  const y = ca * sb * cc - sa * cb * sc;
  const z = ca * cb * sc + sa * sb * cc;
  return normQuat([w, x, y, z]);
}

function geomQuat(g: XmlNode): [number, number, number, number] {
  if (g.attrs.euler) return eulerXyzToQuat(nums(g.attrs.euler, 3, [0, 0, 0]));
  return normQuat(nums(g.attrs.quat, 4, [1, 0, 0, 0]));
}

/** Smallest collision geoms (the 0.75 mm tip spheres) add nothing to a shadow and are skipped. */
const MIN_COLLIDER_EXTENT = 0.002;

export function parseSo101(xml: string): RobotModelDesc {
  const doc = parseXml(xml);
  const mujoco = child(doc, "mujoco");
  if (!mujoco) throw new Error("so101.xml: no <mujoco> root");
  const meshFiles: Record<string, string> = {};
  const asset = child(mujoco, "asset");
  for (const m of asset?.children ?? []) {
    if (m.name !== "mesh" || !m.attrs.file) continue;
    const name = m.attrs.name ?? m.attrs.file.replace(/\.stl$/i, "");
    meshFiles[name] = m.attrs.file;
  }
  const world = child(mujoco, "worldbody");
  const baseBody = world?.children.find((c) => c.name === "body");
  if (!baseBody) throw new Error("so101.xml: no base body");
  const links: LinkDesc[] = [];
  const visit = (body: XmlNode, parent: number) => {
    const bodyName = body.attrs.name ?? "";
    const link = BODY_LINK[bodyName];
    if (!link) throw new Error(`so101.xml: unmapped body ${bodyName}`);
    const joint = body.children.find((c) => c.name === "joint");
    const desc: LinkDesc = {
      link, bodyName, parent,
      pos: nums(body.attrs.pos, 3, [0, 0, 0]) as [number, number, number],
      quat: normQuat(nums(body.attrs.quat, 4, [1, 0, 0, 0])),
      jointIndex: joint ? JOINT_ORDER.indexOf(joint.attrs.name ?? "") : -1,
      axis: nums(joint?.attrs.axis, 3, [0, 0, 1]) as [number, number, number],
      visuals: [], colliders: [],
    };
    for (const g of body.children) {
      if (g.name !== "geom") continue;
      const cls = g.attrs.class ?? "";
      const pos = nums(g.attrs.pos, 3, [0, 0, 0]) as [number, number, number];
      if (cls === "visual" && g.attrs.mesh) {
        const slot = MESH_SLOTS[g.attrs.mesh];
        if (slot) desc.visuals.push({ mesh: g.attrs.mesh, slot, pos, quat: geomQuat(g) });
      } else if ((cls === "collision" || cls === "collision_gripper") && (g.attrs.type === "box" || g.attrs.type === "sphere" || g.attrs.type === "capsule")) {
        const size = nums(g.attrs.size, g.attrs.type === "sphere" ? 1 : g.attrs.type === "capsule" ? 2 : 3, [0, 0, 0]);
        if (Math.max(...size) < MIN_COLLIDER_EXTENT) continue;
        desc.colliders.push({ type: g.attrs.type, size, pos, quat: geomQuat(g) });
      }
    }
    const index = links.length;
    links.push(desc);
    for (const c of body.children) if (c.name === "body") visit(c, index);
  };
  visit(baseBody, -1);
  for (const id of LINK_IDS) if (!links.some((l) => l.link === id)) throw new Error(`so101.xml: missing link ${id}`);
  return { links, meshFiles };
}

/* ───────────────────────── forward kinematics (render fallback, ghost) ───────────────────────── */

function mulWxyz(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, out: Float64Array, oo: number): void {
  const aw = a[ao], ax = a[ao + 1], ay = a[ao + 2], az = a[ao + 3];
  const bw = b[bo], bx = b[bo + 1], by = b[bo + 2], bz = b[bo + 3];
  out[oo] = aw * bw - ax * bx - ay * by - az * bz;
  out[oo + 1] = aw * bx + ax * bw + ay * bz - az * by;
  out[oo + 2] = aw * by - ax * bz + ay * bw + az * bx;
  out[oo + 3] = aw * bz + ax * by - ay * bx + az * bw;
}
function rotWxyz(q: ArrayLike<number>, qo: number, x: number, y: number, z: number, out: Float64Array, oo: number): void {
  const w = q[qo], qx = q[qo + 1], qy = q[qo + 2], qz = q[qo + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[oo] = x + w * tx + (qy * tz - qz * ty);
  out[oo + 1] = y + w * ty + (qz * tx - qx * tz);
  out[oo + 2] = z + w * tz + (qx * ty - qy * tx);
}

export interface LinkPoses { pos: Float64Array; quat: Float64Array; }   // links×3, links×4 (wxyz), sim world
export function createLinkPoses(model: RobotModelDesc): LinkPoses {
  return { pos: new Float64Array(model.links.length * 3), quat: new Float64Array(model.links.length * 4) };
}

const jointQ = new Float64Array(4);
const tmpQ = new Float64Array(4);
const tmpV = new Float64Array(3);

/**
 * Sim-world pose of every link for joint angles `q` (JOINT_NAMES order) on `seat`'s mount (atlas at
 * MOUNT_X.atlas, blaze yawed π). Used by the ghost arm and when the engine does not expose body buffers.
 */
export function forwardKinematics(model: RobotModelDesc, seat: Seat, q: ArrayLike<number>, out: LinkPoses): LinkPoses {
  const links = model.links;
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const o3 = i * 3, o4 = i * 4;
    if (l.parent < 0) {
      out.pos[o3] = MOUNT_X[seat] + l.pos[0] * (seat === "atlas" ? 1 : -1);
      out.pos[o3 + 1] = l.pos[1] * (seat === "atlas" ? 1 : -1);
      out.pos[o3 + 2] = l.pos[2];
      if (seat === "atlas") { tmpQ[0] = 1; tmpQ[1] = 0; tmpQ[2] = 0; tmpQ[3] = 0; }
      else { tmpQ[0] = 0; tmpQ[1] = 0; tmpQ[2] = 0; tmpQ[3] = 1; }
      mulWxyz(tmpQ, 0, l.quat, 0, out.quat, o4);
    } else {
      const p3 = l.parent * 3, p4 = l.parent * 4;
      rotWxyz(out.quat, p4, l.pos[0], l.pos[1], l.pos[2], tmpV, 0);
      out.pos[o3] = out.pos[p3] + tmpV[0];
      out.pos[o3 + 1] = out.pos[p3 + 1] + tmpV[1];
      out.pos[o3 + 2] = out.pos[p3 + 2] + tmpV[2];
      mulWxyz(out.quat, p4, l.quat, 0, out.quat, o4);
    }
    if (l.jointIndex >= 0) {
      const angle = q[l.jointIndex] ?? 0;
      const s = Math.sin(angle / 2);
      jointQ[0] = Math.cos(angle / 2); jointQ[1] = l.axis[0] * s; jointQ[2] = l.axis[1] * s; jointQ[3] = l.axis[2] * s;
      tmpQ[0] = out.quat[o4]; tmpQ[1] = out.quat[o4 + 1]; tmpQ[2] = out.quat[o4 + 2]; tmpQ[3] = out.quat[o4 + 3];
      mulWxyz(tmpQ, 0, jointQ, 0, out.quat, o4);
    }
  }
  return out;
}

/* ───────────────────────── STL ───────────────────────── */

/** Parses a binary or ASCII STL into a flat triangle soup (xyz × 3 per triangle, float32, metres). */
export function parseStl(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (buffer.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === buffer.byteLength) {
      const out = new Float32Array(count * 9);
      let o = 0;
      for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) out[o++] = view.getFloat32(base + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const values: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (values.length === 0 || values.length % 9 !== 0) throw new Error("stl: unreadable file");
  return Float32Array.from(values);
}

/* ───────────────────────── weld, crease normals, edge mask ───────────────────────── */

export interface RenderGeometryData {
  position: Float32Array; normal: Float32Array;
  edge: Float32Array;                  // per vertex, signed: + convex crease, − concave crease, 0 smooth
  index: Uint32Array;
  printAxis: [number, number, number]; // normal of the largest planar face cluster (the printed base)
  triangles: number; weldedVertices: number;
}

export const WELD_TOLERANCE_M = 1e-4;
export const CREASE_ANGLE_DEG = 35;

/**
 * Welds a triangle soup (tolerance 1e-4 m), splits normals at creases sharper than 35°, and computes the
 * signed edge mask the shell shader uses for edge highlight and wear. Degenerate triangles are dropped.
 * Output stays indexed: a vertex is duplicated only where a crease splits its normal.
 */
export function buildRenderGeometry(soup: Float32Array, creaseAngleDeg = CREASE_ANGLE_DEG, tolerance = WELD_TOLERANCE_M): RenderGeometryData {
  const triCount = Math.floor(soup.length / 9);
  const cornerCount = triCount * 3;
  // Weld through an open-addressing hash on quantized coordinates.
  let cap = 1; while (cap < cornerCount * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1);
  const wpos = new Float32Array(cornerCount * 3);
  const qkey = new Int32Array(cornerCount * 3);
  const cornerVertex = new Uint32Array(cornerCount);
  let welded = 0;
  const inv = 1 / tolerance;
  for (let c = 0; c < cornerCount; c++) {
    const x = soup[c * 3], y = soup[c * 3 + 1], z = soup[c * 3 + 2];
    const ix = Math.round(x * inv), iy = Math.round(y * inv), iz = Math.round(z * inv);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (cap - 1);
    for (;;) {
      const v = table[h];
      if (v < 0) {
        table[h] = welded;
        wpos[welded * 3] = x; wpos[welded * 3 + 1] = y; wpos[welded * 3 + 2] = z;
        qkey[welded * 3] = ix; qkey[welded * 3 + 1] = iy; qkey[welded * 3 + 2] = iz;
        cornerVertex[c] = welded++;
        break;
      }
      if (qkey[v * 3] === ix && qkey[v * 3 + 1] === iy && qkey[v * 3 + 2] === iz) { cornerVertex[c] = v; break; }
      h = (h + 1) & (cap - 1);
    }
  }
  // Face normals (unit) and areas; drop degenerate faces.
  const faceN = new Float32Array(triCount * 3);
  const faceArea = new Float32Array(triCount);
  const faceCentroid = new Float32Array(triCount * 3);
  const faceOk = new Uint8Array(triCount);
  let kept = 0;
  for (let t = 0; t < triCount; t++) {
    const a = cornerVertex[t * 3], b = cornerVertex[t * 3 + 1], cc = cornerVertex[t * 3 + 2];
    if (a === b || b === cc || a === cc) continue;
    const ax = wpos[a * 3], ay = wpos[a * 3 + 1], az = wpos[a * 3 + 2];
    const e1x = wpos[b * 3] - ax, e1y = wpos[b * 3 + 1] - ay, e1z = wpos[b * 3 + 2] - az;
    const e2x = wpos[cc * 3] - ax, e2y = wpos[cc * 3 + 1] - ay, e2z = wpos[cc * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-14) continue;
    faceN[t * 3] = nx / len; faceN[t * 3 + 1] = ny / len; faceN[t * 3 + 2] = nz / len;
    faceArea[t] = len * 0.5;
    faceCentroid[t * 3] = ax + (e1x + e2x) / 3;
    faceCentroid[t * 3 + 1] = ay + (e1y + e2y) / 3;
    faceCentroid[t * 3 + 2] = az + (e1z + e2z) / 3;
    faceOk[t] = 1; kept++;
  }
  // Vertex → incident corners (CSR).
  const start = new Uint32Array(welded + 1);
  for (let t = 0; t < triCount; t++) if (faceOk[t]) for (let k = 0; k < 3; k++) start[cornerVertex[t * 3 + k] + 1]++;
  for (let v = 0; v < welded; v++) start[v + 1] += start[v];
  const fill = start.slice(0, welded);
  const incident = new Uint32Array(kept * 3);
  for (let t = 0; t < triCount; t++) if (faceOk[t]) for (let k = 0; k < 3; k++) incident[fill[cornerVertex[t * 3 + k]]++] = t * 3 + k;
  // Cluster corners at each welded vertex by normal angle; each cluster becomes one output vertex.
  const cosCrease = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const cornerOut = new Uint32Array(cornerCount);
  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outEdge: number[] = [];
  const clusterSeed: number[] = [];
  const clusterSum: number[] = [];
  const clusterOf = new Int32Array(64);
  for (let v = 0; v < welded; v++) {
    const s0 = start[v], s1 = start[v + 1];
    if (s1 === s0) continue;
    clusterSeed.length = 0; clusterSum.length = 0;
    for (let i = s0; i < s1; i++) {
      const t = (incident[i] / 3) | 0;
      const nx = faceN[t * 3], ny = faceN[t * 3 + 1], nz = faceN[t * 3 + 2], w = faceArea[t];
      let found = -1;
      for (let c = 0; c < clusterSeed.length / 3; c++) {
        if (nx * clusterSeed[c * 3] + ny * clusterSeed[c * 3 + 1] + nz * clusterSeed[c * 3 + 2] >= cosCrease) { found = c; break; }
      }
      if (found < 0) {
        found = clusterSeed.length / 3;
        clusterSeed.push(nx, ny, nz);
        clusterSum.push(0, 0, 0);
      }
      clusterSum[found * 3] += nx * w; clusterSum[found * 3 + 1] += ny * w; clusterSum[found * 3 + 2] += nz * w;
      if (i - s0 < clusterOf.length) clusterOf[i - s0] = found;
    }
    const clusters = clusterSeed.length / 3;
    const firstOut = outPos.length / 3;
    for (let c = 0; c < clusters; c++) {
      let nx = clusterSum[c * 3], ny = clusterSum[c * 3 + 1], nz = clusterSum[c * 3 + 2];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      clusterSum[c * 3] = nx; clusterSum[c * 3 + 1] = ny; clusterSum[c * 3 + 2] = nz;
    }
    for (let c = 0; c < clusters; c++) {
      const nx = clusterSum[c * 3], ny = clusterSum[c * 3 + 1], nz = clusterSum[c * 3 + 2];
      // Signed edge strength: sharpest dihedral against the other clusters, + when the neighbour folds away (convex).
      let edge = 0;
      for (let o = 0; o < clusters; o++) {
        if (o === c) continue;
        const d = nx * clusterSum[o * 3] + ny * clusterSum[o * 3 + 1] + nz * clusterSum[o * 3 + 2];
        const strength = Math.min(1, (1 - d) / 1.0);
        // A convex fold: the neighbour cluster's normal leans away from this cluster's side.
        let convex = 0;
        for (let i = s0; i < s1; i++) {
          const idx = i - s0 < clusterOf.length ? clusterOf[i - s0] : -1;
          if (idx !== o) continue;
          const t = (incident[i] / 3) | 0;
          const dx = faceCentroid[t * 3] - wpos[v * 3], dy = faceCentroid[t * 3 + 1] - wpos[v * 3 + 1], dz = faceCentroid[t * 3 + 2] - wpos[v * 3 + 2];
          convex += dx * nx + dy * ny + dz * nz;
        }
        const signed = convex <= 0 ? strength : -strength;
        if (Math.abs(signed) > Math.abs(edge)) edge = signed;
      }
      outPos.push(wpos[v * 3], wpos[v * 3 + 1], wpos[v * 3 + 2]);
      outNrm.push(nx, ny, nz);
      outEdge.push(edge);
    }
    for (let i = s0; i < s1; i++) {
      const c = i - s0 < clusterOf.length ? clusterOf[i - s0] : nearestCluster(faceN, (incident[i] / 3) | 0, clusterSum, clusters);
      cornerOut[incident[i]] = firstOut + c;
    }
  }
  const index = new Uint32Array(kept * 3);
  let o = 0;
  for (let t = 0; t < triCount; t++) {
    if (!faceOk[t]) continue;
    index[o++] = cornerOut[t * 3]; index[o++] = cornerOut[t * 3 + 1]; index[o++] = cornerOut[t * 3 + 2];
  }
  return {
    position: Float32Array.from(outPos), normal: Float32Array.from(outNrm), edge: Float32Array.from(outEdge), index,
    printAxis: detectPrintAxis(faceN, faceArea, faceOk), triangles: kept, weldedVertices: welded,
  };
}

function nearestCluster(faceN: Float32Array, t: number, clusters: number[], count: number): number {
  let best = 0, bestDot = -2;
  for (let c = 0; c < count; c++) {
    const d = faceN[t * 3] * clusters[c * 3] + faceN[t * 3 + 1] * clusters[c * 3 + 1] + faceN[t * 3 + 2] * clusters[c * 3 + 2];
    if (d > bestDot) { bestDot = d; best = c; }
  }
  return best;
}

/** Normal of the largest coplanar area (normals bucketed at ~5°), folded to a positive axis. */
export function detectPrintAxis(faceN: Float32Array, faceArea: Float32Array, faceOk: Uint8Array): [number, number, number] {
  const buckets = new Map<number, { a: number; x: number; y: number; z: number }>();
  for (let t = 0; t < faceArea.length; t++) {
    if (!faceOk[t]) continue;
    const nx = faceN[t * 3], ny = faceN[t * 3 + 1], nz = faceN[t * 3 + 2];
    const key = (Math.round(nx * 12) + 12) * 625 + (Math.round(ny * 12) + 12) * 25 + (Math.round(nz * 12) + 12);
    const b = buckets.get(key);
    if (b) { b.a += faceArea[t]; b.x += nx * faceArea[t]; b.y += ny * faceArea[t]; b.z += nz * faceArea[t]; }
    else buckets.set(key, { a: faceArea[t], x: nx * faceArea[t], y: ny * faceArea[t], z: nz * faceArea[t] });
  }
  let best: { a: number; x: number; y: number; z: number } | null = null;
  for (const b of buckets.values()) if (!best || b.a > best.a) best = b;
  if (!best) return [0, 0, 1];
  const len = Math.hypot(best.x, best.y, best.z) || 1;
  const ax = Math.abs(best.x / len), ay = Math.abs(best.y / len), az = Math.abs(best.z / len);
  return [ax, ay, az];
}

/* ───────────────────────── loader and cache ───────────────────────── */

export const ROBOT_MODEL_BASE_URL = "/models/robotstudio_so101/";

export interface RobotAssets {
  readonly model: RobotModelDesc;
  /** Whether the meshopt simplifier produced the LODs; false (LOD0 = LOD1 = full mesh) only without WebAssembly. */
  readonly simplified: boolean;
  /** Loaded from the bake (no STL touched) or built in the page from the STLs. */
  readonly source: "bake" | "stl";
  /** One shared, indexed geometry per mesh name (attributes position, normal, edge); empty when loaded from the bake. */
  readonly geometries: ReadonlyMap<string, BufferGeometry>;
  readonly printAxes: ReadonlyMap<string, readonly [number, number, number]>;
  /** Link-local bounding sphere of each link's visual meshes (own-arm dither, 3.2). */
  readonly linkBounds: Readonly<Record<LinkId, { center: [number, number, number]; radius: number }>>;
  /** Visual triangles for one arm (each placement counted), unsimplified. */
  readonly trianglesPerArm: number;
  /** Visual triangles for one arm at each LOD, after simplification (10.1 budget: ≤ 0.45 M for the whole frame). */
  readonly lodTrianglesPerArm: Readonly<Record<keyof LodGeometries, number>>;
}

export interface LoadRobotAssetsOptions {
  baseUrl?: string;
  /** Try the served bake first (default true); false forces the STL path (the bake script, tests). */
  bake?: boolean;
  fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;
  onProgress?: (done: number, total: number, label: string) => void;
}

interface CacheEntry { promise: Promise<RobotAssets>; value: RobotAssets | null; listeners: Set<(d: number, t: number, l: string) => void>; }
const assetCache = new Map<string, CacheEntry>();
const fileCache = new Map<string, Promise<ArrayBuffer>>();

/** Number of network fetches issued per URL (tests assert each STL is fetched once). */
export const robotAssetFetchCounts = new Map<string, number>();

/** Per-attempt ceiling, mirroring the physics loader: a stalled fetch must reject rather than hang the boot. */
export const ASSET_FETCH_TIMEOUT_MS = 30_000;

function defaultFetch(url: string) {
  return fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(ASSET_FETCH_TIMEOUT_MS) });
}

function fetchBuffer(url: string, impl: NonNullable<LoadRobotAssetsOptions["fetchImpl"]>): Promise<ArrayBuffer> {
  const hit = fileCache.get(url);
  if (hit) return hit;
  robotAssetFetchCounts.set(url, (robotAssetFetchCounts.get(url) ?? 0) + 1);
  const p = impl(url).then((r) => {
    if (!r.ok) throw new Error(`robot assets: ${url} returned ${r.status}`);
    return r.arrayBuffer();
  });
  p.catch(() => { fileCache.delete(url); });
  fileCache.set(url, p);
  return p;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function toBufferGeometry(data: RenderGeometryData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(data.position, 3));
  g.setAttribute("normal", new BufferAttribute(data.normal, 3));
  g.setAttribute("edge", new BufferAttribute(data.edge, 1));
  g.setIndex(new BufferAttribute(data.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

async function buildAssets(baseUrl: string, impl: NonNullable<LoadRobotAssetsOptions["fetchImpl"]>, useBake: boolean, report: (d: number, t: number, l: string) => void): Promise<RobotAssets> {
  const xmlBuf = await fetchBuffer(`${baseUrl}so101.xml`, impl);
  const xml = new TextDecoder().decode(new Uint8Array(xmlBuf));
  const model = parseSo101(xml);
  if (useBake) {
    const baked = await loadBake(`${baseUrl}${BAKE_FILE}`, impl, model, bakeKey(xml), report);
    if (baked) return baked;
  }
  const meshNames = [...new Set(model.links.flatMap((l) => l.visuals.map((v) => v.mesh)))];
  const total = meshNames.length;
  report(0, total, "parsing so101.xml");
  const buffers = meshNames.map((name) => fetchBuffer(`${baseUrl}assets/${model.meshFiles[name] ?? `${name}.stl`}`, impl));
  const geometries = new Map<string, BufferGeometry>();
  const printAxes = new Map<string, readonly [number, number, number]>();
  let done = 0;
  for (let i = 0; i < meshNames.length; i++) {
    const buf = await buffers[i];
    const data = buildRenderGeometry(parseStl(buf));
    geometries.set(meshNames[i], toBufferGeometry(data));
    printAxes.set(meshNames[i], data.printAxis);
    done++;
    report(done, total, `welding ${meshNames[i]} · ${data.triangles} tris`);
    await yieldToMain();
  }
  const linkBounds = {} as Record<LinkId, { center: [number, number, number]; radius: number }>;
  let trianglesPerArm = 0;
  const v = new Vector3();
  for (const link of model.links) {
    let sphere: Sphere | null = null;
    for (const vis of link.visuals) {
      const g = geometries.get(vis.mesh);
      if (!g?.boundingSphere) continue;
      trianglesPerArm += (g.index?.count ?? 0) / 3;
      const c = g.boundingSphere.center;
      const q = vis.quat;
      const tmp = new Float64Array(3);
      rotWxyz(q, 0, c.x, c.y, c.z, tmp, 0);
      const s = new Sphere(v.set(tmp[0] + vis.pos[0], tmp[1] + vis.pos[1], tmp[2] + vis.pos[2]).clone(), g.boundingSphere.radius);
      sphere = sphere ? sphere.union(s) : s;
    }
    linkBounds[link.link] = sphere
      ? { center: [sphere.center.x, sphere.center.y, sphere.center.z], radius: sphere.radius }
      : { center: [0, 0, 0], radius: 0 };
  }
  const simplified = await simplifierReady();
  const assets: RobotAssets = { model, source: "stl", geometries, printAxes, linkBounds, trianglesPerArm, simplified, lodTrianglesPerArm: { lod0: 0, lod1: 0 } };
  // Merge per (link, slot) and cut the LODs now, one link per task, so the first arm frame never pays for it.
  const merged: MergedGeometries = { bySlot: [], byLink: new Map() };
  for (const l of model.links) {
    mergeLink(assets, l, merged);
    report(total, total, `simplifying ${l.link}`);
    await yieldToMain();
  }
  finishMerged(assets, merged);
  return assets;
}

/** Fills the per-link ghost geometry and the LOD triangle totals once every (link, slot) is merged. */
function finishMerged(assets: RobotAssets, merged: MergedGeometries): void {
  for (const l of assets.model.links) {
    const own = merged.bySlot.filter((e) => e.link === l.link);
    if (own.length) merged.byLink.set(l.link, concatLod(own, "lod1"));
  }
  mergedCache.set(assets, merged);
  const lodTris = assets.lodTrianglesPerArm as Record<keyof LodGeometries, number>;
  lodTris.lod0 = 0; lodTris.lod1 = 0;
  for (const e of merged.bySlot) { lodTris.lod0 += triangleCount(e.lods.lod0); lodTris.lod1 += triangleCount(e.lods.lod1); }
}

/**
 * Loads and processes the robot render assets once per base URL. Concurrent and repeated calls share one
 * promise and every file is fetched at most once per page. Progress reports are fanned out to every caller.
 */
export function loadRobotAssets(opts: LoadRobotAssetsOptions = {}): Promise<RobotAssets> {
  const baseUrl = opts.baseUrl ?? ROBOT_MODEL_BASE_URL;
  let entry = assetCache.get(baseUrl);
  if (!entry) {
    const listeners = new Set<(d: number, t: number, l: string) => void>();
    const created: CacheEntry = { promise: Promise.resolve(null as unknown as RobotAssets), value: null, listeners };
    created.promise = buildAssets(baseUrl, opts.fetchImpl ?? defaultFetch, opts.bake ?? true, (d, t, l) => { for (const fn of listeners) fn(d, t, l); })
      .then((assets) => { created.value = assets; listeners.clear(); return assets; });
    created.promise.catch(() => { assetCache.delete(baseUrl); });
    entry = created;
    assetCache.set(baseUrl, entry);
  }
  if (opts.onProgress && !entry.value) entry.listeners.add(opts.onProgress);
  return entry.promise;
}

/** The loaded assets when ready, else null (render components poll this without suspending). */
export function peekRobotAssets(baseUrl: string = ROBOT_MODEL_BASE_URL): RobotAssets | null {
  return assetCache.get(baseUrl)?.value ?? null;
}

/* ───────────────────────── link-merged geometry (fewer draw calls) ───────────────────────── */

export interface LinkSlotGeometry { link: LinkId; slot: MaterialSlot; lods: LodGeometries; }
interface MergedGeometries { bySlot: LinkSlotGeometry[]; byLink: Map<LinkId, BufferGeometry>; }

/**
 * Triangle share kept per LOD (10.2 step 3: 296 k → 104 k per arm at LOD0, 15 % for the reflection and the
 * unfavoured arm) and the meshopt target error as a fraction of the mesh extent.
 */
export const LOD_RATIO: Readonly<Record<keyof LodGeometries, number>> = { lod0: 0.35, lod1: 0.15 };
export const LOD_TARGET_ERROR = 0.01;

interface MeshoptSimplifierApi {
  supported: boolean;
  ready: Promise<void>;
  simplify(indices: Uint32Array, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number, flags?: readonly string[]): [Uint32Array, number];
}
const MeshoptSimplifier = MeshoptSimplifierUntyped as MeshoptSimplifierApi;
let simplifierUp = false;

/** Resolves true once the simplifier's WebAssembly is instantiated; false where WebAssembly is unavailable. */
export async function simplifierReady(): Promise<boolean> {
  if (simplifierUp) return true;
  if (!MeshoptSimplifier.supported) return false;
  await MeshoptSimplifier.ready;
  simplifierUp = true;
  return true;
}

export function triangleCount(g: BufferGeometry): number {
  return ((g.index?.count ?? g.attributes.position.count) / 3) | 0;
}

/**
 * The same vertices with a shorter index: meshopt collapses edges toward `ratio` of the triangles (locked
 * borders, error ≤ LOD_TARGET_ERROR of the extent). Attribute buffers are shared with `full`, so a LOD costs
 * one index buffer on the GPU. Without the simplifier the full geometry is returned as is.
 */
export function simplifyGeometry(full: BufferGeometry, ratio: number, targetError = LOD_TARGET_ERROR): BufferGeometry {
  const index = full.index?.array;
  if (!simplifierUp || !(index instanceof Uint32Array) || ratio >= 1) return full;
  const target = Math.floor((index.length * ratio) / 3) * 3;
  const [lodIndex] = MeshoptSimplifier.simplify(index, full.attributes.position.array as Float32Array, 3, target, targetError, ["LockBorder"]);
  const g = new BufferGeometry();
  for (const name of Object.keys(full.attributes)) g.setAttribute(name, full.attributes[name]);
  g.setIndex(new BufferAttribute(lodIndex, 1));
  g.boundingBox = full.boundingBox?.clone() ?? null;
  g.boundingSphere = full.boundingSphere?.clone() ?? null;
  return g;
}

const mergedCache = new WeakMap<RobotAssets, MergedGeometries>();

function mergeVisuals(assets: RobotAssets, visuals: readonly VisualGeom[]): BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const vis of visuals) {
    const g = assets.geometries.get(vis.mesh);
    if (!g) continue;
    vCount += g.attributes.position.count;
    iCount += g.index?.count ?? 0;
  }
  const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), edge = new Float32Array(vCount);
  const axis = new Float32Array(vCount * 3);
  const index = new Uint32Array(iCount);
  const tmp = new Float64Array(3);
  let vo = 0, io = 0;
  for (const vis of visuals) {
    const g = assets.geometries.get(vis.mesh);
    if (!g) continue;
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal.array as Float32Array;
    const e = g.attributes.edge.array as Float32Array;
    const idx = g.index?.array as Uint32Array | undefined;
    const pa = assets.printAxes.get(vis.mesh) ?? [0, 0, 1];
    rotWxyz(vis.quat, 0, pa[0], pa[1], pa[2], tmp, 0);
    const ax = Math.abs(tmp[0]), ay = Math.abs(tmp[1]), az = Math.abs(tmp[2]);
    const count = g.attributes.position.count;
    for (let i = 0; i < count; i++) {
      rotWxyz(vis.quat, 0, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], tmp, 0);
      pos[(vo + i) * 3] = tmp[0] + vis.pos[0]; pos[(vo + i) * 3 + 1] = tmp[1] + vis.pos[1]; pos[(vo + i) * 3 + 2] = tmp[2] + vis.pos[2];
      rotWxyz(vis.quat, 0, n[i * 3], n[i * 3 + 1], n[i * 3 + 2], tmp, 0);
      nrm[(vo + i) * 3] = tmp[0]; nrm[(vo + i) * 3 + 1] = tmp[1]; nrm[(vo + i) * 3 + 2] = tmp[2];
      edge[vo + i] = e[i];
      axis[(vo + i) * 3] = ax; axis[(vo + i) * 3 + 1] = ay; axis[(vo + i) * 3 + 2] = az;
    }
    if (idx) for (let k = 0; k < idx.length; k++) index[io + k] = idx[k] + vo;
    vo += count; io += idx?.length ?? 0;
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nrm, 3));
  out.setAttribute("edge", new BufferAttribute(edge, 1));
  out.setAttribute("printAxis", new BufferAttribute(axis, 3));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function mergeLink(assets: RobotAssets, l: LinkDesc, out: MergedGeometries): void {
  const slots = [...new Set(l.visuals.map((v) => v.slot))];
  for (const slot of slots) {
    const full = mergeVisuals(assets, l.visuals.filter((v) => v.slot === slot));
    out.bySlot.push({ link: l.link, slot, lods: { lod0: simplifyGeometry(full, LOD_RATIO.lod0), lod1: simplifyGeometry(full, LOD_RATIO.lod1) } });
  }
}

const SHELL_ATTRIBUTES = ["position", "normal", "edge", "printAxis"] as const;

/** One geometry holding the given LOD of several (link, slot) entries: copied attributes, offset indices. */
function concatLod(entries: readonly LinkSlotGeometry[], lod: keyof LodGeometries): BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const e of entries) { vCount += e.lods[lod].attributes.position.count; iCount += e.lods[lod].index?.count ?? 0; }
  const out = new BufferGeometry();
  for (const name of SHELL_ATTRIBUTES) {
    const size = entries[0].lods[lod].attributes[name].itemSize;
    const arr = new Float32Array(vCount * size);
    let vo = 0;
    for (const e of entries) { const a = e.lods[lod].attributes[name]; arr.set(a.array as Float32Array, vo * size); vo += a.count; }
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  const index = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const e of entries) {
    const g = e.lods[lod];
    const idx = g.index?.array as Uint32Array | Uint16Array | undefined;
    if (idx) for (let k = 0; k < idx.length; k++) index[io + k] = idx[k] + vo;
    vo += g.attributes.position.count; io += idx?.length ?? 0;
  }
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Several (link, slot) entries of one material class merged into a single geometry with one rigid bone per
 * link (10.2 step 6): `skinIndex.x` carries the link's bone and `skinWeight.x` is 1, so every vertex stays in
 * link-local space and the shell still follows its MuJoCo body exactly — `vLocalPos`, the link bounds and the
 * decal placements are all unchanged. Entries are concatenated in bone order, so any prefix of links (the
 * cockpit-hidden ones) is a prefix of the index buffer and hiding them costs one `setDrawRange`.
 */
export interface SkinnedMergeResult {
  geometry: BufferGeometry;
  /** First index of each link's triangles in the merged index buffer. */
  indexStart: Map<LinkId, number>;
  indexCount: number;
}
export function skinnedMerge(
  entries: readonly LinkSlotGeometry[], lod: keyof LodGeometries, boneOf: (link: LinkId) => number,
): SkinnedMergeResult {
  const sorted = [...entries].sort((a, b) => boneOf(a.link) - boneOf(b.link));
  const geometry = concatLod(sorted, lod);
  const vertexCount = geometry.attributes.position.count;
  const skinIndex = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);
  const indexStart = new Map<LinkId, number>();
  let vo = 0, io = 0;
  for (const e of sorted) {
    const g = e.lods[lod];
    const bone = boneOf(e.link);
    const n = g.attributes.position.count;
    for (let i = 0; i < n; i++) { skinIndex[(vo + i) * 4] = bone; skinWeight[(vo + i) * 4] = 1; }
    if (!indexStart.has(e.link)) indexStart.set(e.link, io);
    vo += n; io += g.index?.count ?? 0;
  }
  geometry.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
  return { geometry, indexStart, indexCount: io };
}

/** Visual meshes merged per (link, material slot) in link-local space, at both LODs; shared by both arms. */
export function linkSlotGeometries(assets: RobotAssets): readonly LinkSlotGeometry[] {
  return mergedFor(assets).bySlot;
}

/**
 * Every visual of one link merged into one geometry at LOD1 (ghost arm, decal placement raycasts): the ghost
 * stays inside the 0.45 M budget and a decal lands within LOD_TARGET_ERROR of the shell either way.
 */
export function linkGeometry(assets: RobotAssets, link: LinkId): BufferGeometry | null {
  return mergedFor(assets).byLink.get(link) ?? null;
}

function mergedFor(assets: RobotAssets): MergedGeometries {
  let hit = mergedCache.get(assets);
  if (hit) return hit;
  hit = { bySlot: [], byLink: new Map() };
  for (const l of assets.model.links) mergeLink(assets, l, hit);
  finishMerged(assets, hit);
  return hit;
}

/** Index of each LinkId in `model.links`. */
export function linkIndexMap(model: RobotModelDesc): Record<LinkId, number> {
  const out = {} as Record<LinkId, number>;
  model.links.forEach((l, i) => { out[l.link] = i; });
  return out;
}

/* ───────────────────────── the bake (10.2 step 3) ───────────────────────── */

/** Served next to so101.xml; written by scripts/bake-meshes.mjs, read before any STL. */
export const BAKE_FILE = "arms.bake";
export const BAKE_MAGIC = 0x31424c54;   // "TLB1"
export const BAKE_VERSION = 1;

/** FNV-1a of the model file plus every constant the pipeline depends on: a stale bake falls back to the STLs. */
export function bakeKey(xml: string): string {
  const src = `${xml}|v${BAKE_VERSION}|${LOD_RATIO.lod0}|${LOD_RATIO.lod1}|${LOD_TARGET_ERROR}|${CREASE_ANGLE_DEG}|${WELD_TOLERANCE_M}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

interface BakeEntry {
  link: LinkId; slot: MaterialSlot; vertexCount: number; lod0Count: number; lod1Count: number;
  min: [number, number, number]; max: [number, number, number]; index16: boolean;
  /** Byte offsets into the binary region: uint16 position ×3, int8 normal ×3, int8 edge, uint8 printAxis ×3, LOD indices. */
  at: { position: number; normal: number; edge: number; axis: number; lod0: number; lod1: number };
}
interface BakeManifest {
  version: number; key: string; trianglesPerArm: number;
  linkBounds: Record<LinkId, { center: [number, number, number]; radius: number }>;
  entries: BakeEntry[];
}

const align4 = (n: number) => (n + 3) & ~3;

/** Serialises the merged, simplified (link, slot) geometries: compact vertex set per entry, quantized attributes. */
export function encodeBake(assets: RobotAssets, xml: string): ArrayBuffer {
  const entries: BakeEntry[] = [];
  const blobs: { at: number; data: ArrayBufferView }[] = [];
  let cursor = 0;
  const put = (data: ArrayBufferView) => { const at = cursor; blobs.push({ at, data }); cursor = align4(cursor + data.byteLength); return at; };
  for (const e of linkSlotGeometries(assets)) {
    const full = e.lods.lod0.attributes;
    const pos = full.position.array as Float32Array, nrm = full.normal.array as Float32Array;
    const edge = full.edge.array as Float32Array, axis = full.printAxis.array as Float32Array;
    const lod0 = e.lods.lod0.index!.array as Uint32Array, lod1 = e.lods.lod1.index!.array as Uint32Array;
    // Compact to the vertices either LOD references, in first-use order.
    const remap = new Int32Array(full.position.count).fill(-1);
    let n = 0;
    for (const idx of [lod0, lod1]) for (let k = 0; k < idx.length; k++) if (remap[idx[k]] < 0) remap[idx[k]] = n++;
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < remap.length; v++) {
      if (remap[v] < 0) continue;
      for (let c = 0; c < 3; c++) { const x = pos[v * 3 + c]; if (x < min[c]) min[c] = x; if (x > max[c]) max[c] = x; }
    }
    const qp = new Uint16Array(n * 3), qn = new Int8Array(n * 3), qe = new Int8Array(n), qa = new Uint8Array(n * 3);
    for (let v = 0; v < remap.length; v++) {
      const o = remap[v];
      if (o < 0) continue;
      for (let c = 0; c < 3; c++) {
        const span = max[c] - min[c];
        qp[o * 3 + c] = span > 0 ? Math.round(((pos[v * 3 + c] - min[c]) / span) * 65535) : 0;
        qn[o * 3 + c] = Math.round(Math.max(-1, Math.min(1, nrm[v * 3 + c])) * 127);
        qa[o * 3 + c] = Math.round(Math.max(0, Math.min(1, axis[v * 3 + c])) * 255);
      }
      qe[o] = Math.round(Math.max(-1, Math.min(1, edge[v])) * 127);
    }
    const index16 = n <= 65535;
    const pack = (idx: Uint32Array) => { const out = index16 ? new Uint16Array(idx.length) : new Uint32Array(idx.length); for (let k = 0; k < idx.length; k++) out[k] = remap[idx[k]]; return out; };
    entries.push({
      link: e.link, slot: e.slot, vertexCount: n, lod0Count: lod0.length, lod1Count: lod1.length, min, max, index16,
      at: { position: put(qp), normal: put(qn), edge: put(qe), axis: put(qa), lod0: put(pack(lod0)), lod1: put(pack(lod1)) },
    });
  }
  const manifest: BakeManifest = { version: BAKE_VERSION, key: bakeKey(xml), trianglesPerArm: assets.trianglesPerArm, linkBounds: assets.linkBounds, entries };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const head = 8 + align4(json.byteLength);
  const out = new ArrayBuffer(head + cursor);
  const dv = new DataView(out);
  dv.setUint32(0, BAKE_MAGIC, true);
  dv.setUint32(4, json.byteLength, true);
  new Uint8Array(out, 8, json.byteLength).set(json);
  const bytes = new Uint8Array(out);
  for (const b of blobs) bytes.set(new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength), head + b.at);
  return out;
}

/** Parses a bake into per-(link, slot) LodGeometries and the manifest, or throws when it is not one. */
export function decodeBake(buf: ArrayBuffer): { manifest: BakeManifest; bySlot: LinkSlotGeometry[] } {
  const dv = new DataView(buf);
  if (buf.byteLength < 8 || dv.getUint32(0, true) !== BAKE_MAGIC) throw new Error("arms.bake: not a bake");
  const jsonBytes = dv.getUint32(4, true);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonBytes))) as BakeManifest;
  if (manifest.version !== BAKE_VERSION) throw new Error(`arms.bake: version ${manifest.version}, expected ${BAKE_VERSION}`);
  const head = 8 + align4(jsonBytes);
  const bySlot: LinkSlotGeometry[] = [];
  for (const e of manifest.entries) {
    const n = e.vertexCount;
    const qp = new Uint16Array(buf, head + e.at.position, n * 3), qn = new Int8Array(buf, head + e.at.normal, n * 3);
    const qe = new Int8Array(buf, head + e.at.edge, n), qa = new Uint8Array(buf, head + e.at.axis, n * 3);
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), edge = new Float32Array(n), axis = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      for (let c = 0; c < 3; c++) {
        pos[v * 3 + c] = e.min[c] + (qp[v * 3 + c] / 65535) * (e.max[c] - e.min[c]);
        nrm[v * 3 + c] = qn[v * 3 + c] / 127;
        axis[v * 3 + c] = qa[v * 3 + c] / 255;
      }
      edge[v] = qe[v] / 127;
    }
    const lod0 = new BufferGeometry();
    lod0.setAttribute("position", new BufferAttribute(pos, 3));
    lod0.setAttribute("normal", new BufferAttribute(nrm, 3));
    lod0.setAttribute("edge", new BufferAttribute(edge, 1));
    lod0.setAttribute("printAxis", new BufferAttribute(axis, 3));
    const index = (at: number, count: number) => e.index16 ? new Uint16Array(buf, head + at, count).slice() : new Uint32Array(buf, head + at, count).slice();
    lod0.setIndex(new BufferAttribute(index(e.at.lod0, e.lod0Count), 1));
    lod0.computeBoundingBox();
    lod0.computeBoundingSphere();
    const lod1 = new BufferGeometry();
    for (const name of SHELL_ATTRIBUTES) lod1.setAttribute(name, lod0.attributes[name]);
    lod1.setIndex(new BufferAttribute(index(e.at.lod1, e.lod1Count), 1));
    lod1.boundingBox = lod0.boundingBox!.clone();
    lod1.boundingSphere = lod0.boundingSphere!.clone();
    bySlot.push({ link: e.link, slot: e.slot, lods: { lod0, lod1 } });
  }
  return { manifest, bySlot };
}

/** Fetches and decodes the served bake; null when it is missing, unreadable or stale (the STL path then runs). */
async function loadBake(url: string, impl: NonNullable<LoadRobotAssetsOptions["fetchImpl"]>, model: RobotModelDesc, key: string, report: (d: number, t: number, l: string) => void): Promise<RobotAssets | null> {
  report(0, 1, "arms bake");
  let buf: ArrayBuffer;
  try { buf = await fetchBuffer(url, impl); } catch { return null; }
  let baked: ReturnType<typeof decodeBake>;
  try { baked = decodeBake(buf); } catch (err) {
    if (process.env.NODE_ENV !== "production") console.warn(`[robot-assets] ${url}: ${err instanceof Error ? err.message : String(err)}; using the STLs`);
    return null;
  }
  if (baked.manifest.key !== key) {
    if (process.env.NODE_ENV !== "production") console.warn(`[robot-assets] ${url} is stale (key ${baked.manifest.key} ≠ ${key}); using the STLs. Run: node scripts/bake-meshes.mjs`);
    return null;
  }
  const assets: RobotAssets = {
    model, source: "bake", geometries: new Map(), printAxes: new Map(), linkBounds: baked.manifest.linkBounds,
    trianglesPerArm: baked.manifest.trianglesPerArm, simplified: true, lodTrianglesPerArm: { lod0: 0, lod1: 0 },
  };
  finishMerged(assets, { bySlot: baked.bySlot, byLink: new Map() });
  report(1, 1, "arms bake");
  return assets;
}
