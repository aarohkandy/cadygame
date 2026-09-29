// src/game/render/robot-decals.ts (WP2)
// Printed-part details (EMOTION_BIBLE 5.4: team number, SO-101 plate, OHMSTEAD mark at the shoulder, ≤ 15 %
// coverage, readable at 1 m or not at all): a procedural decal atlas drawn at load (servo ID pips 1–6,
// Phillips screw heads, calibration witness marks, the BIT sticker and the OHMSTEAD mark from WP7's marks, the
// SO-101 plate and the team numbers set live in the HUD faces) placed as mesh-local quads from a fixed table,
// plus the servo status LEDs and the LED accent strips down the arm's flanks, which glow with measured servo
// effort. Decals and LEDs are one InstancedMesh each per arm; robot-view.tsx composes their matrices from
// the link poses per frame. Every printed cell is then aged by `drawWear` (GROUNDING F): grime at the border
// of anything stuck to a machine, ink scratched back to the substrate, and a dirt ring around each screw
// head. The LEDs are the only emitters on the arm.
import {
  type BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, Raycaster, Vector3, CanvasTexture, SRGBColorSpace, DynamicDrawUsage,
  type Texture,
} from "three";
import { RENDER_SCALE, TOKEN_HEX, type BrandMark, type BrandMarkId, type LinkId, type Seat } from "../contracts.ts";
import { createCanvas, cssFont, drawMark, drawWear } from "./brand-textures.ts";
import { linkGeometry, type RobotAssets } from "./robot-assets.ts";

/* ───────────────────────── atlas ───────────────────────── */

export const DECAL_ATLAS_CELLS = 4;          // 4 × 4 grid
export const DECAL_CELL = {
  id1: 0, id2: 1, id3: 2, id4: 3, id5: 4, id6: 5, screw: 6, witness: 7, bit: 8, ohmstead: 9, plate: 10, numberA: 11, numberB: 12,
} as const;

export function createDecalAtlas(marks: Readonly<Record<BrandMarkId, BrandMark>>): Texture | null {
  const S = 128, N = DECAL_ATLAS_CELLS;
  const canvas = createCanvas(S * N, S * N);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;
  ctx.clearRect(0, 0, S * N, S * N);
  const cell = (i: number) => ({ x: (i % N) * S, y: Math.floor(i / N) * S });
  // Servo ID pips: a paper label with 1–6 ink dots.
  for (let id = 1; id <= 6; id++) {
    const { x, y } = cell(id - 1);
    ctx.fillStyle = "#C9C4B8";
    ctx.fillRect(x + 10, y + 34, S - 20, S - 68);
    ctx.fillStyle = TOKEN_HEX.ink;
    const spacing = (S - 40) / 6;
    for (let d = 0; d < id; d++) {
      ctx.beginPath();
      ctx.arc(x + 20 + spacing * (d + 0.5), y + S / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Phillips screw head.
  {
    const { x, y } = cell(DECAL_CELL.screw);
    const g = ctx.createRadialGradient(x + S * 0.42, y + S * 0.4, 4, x + S / 2, y + S / 2, S * 0.42);
    g.addColorStop(0, "#9AA0A8"); g.addColorStop(0.7, "#5E636C"); g.addColorStop(1, "#2B2E35");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2, S * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1C1F29";
    ctx.fillRect(x + S / 2 - 6, y + S * 0.22, 12, S * 0.56);
    ctx.fillRect(x + S * 0.22, y + S / 2 - 6, S * 0.56, 12);
    // The dirt ring a countersunk head collects where it meets the shell.
    ctx.strokeStyle = "rgba(16,18,24,0.92)";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2, S * 0.455, 0, Math.PI * 2); ctx.stroke();
  }
  // Calibration witness mark: a paint-pen tick in volt with an ink keyline.
  {
    const { x, y } = cell(DECAL_CELL.witness);
    ctx.fillStyle = TOKEN_HEX.ink;
    ctx.fillRect(x + S / 2 - 12, y + 8, 24, S - 16);
    ctx.fillStyle = TOKEN_HEX.volt;
    ctx.fillRect(x + S / 2 - 7, y + 12, 14, S - 24);
  }
  // BIT sticker and TORQUE LIMIT sticker from the brand marks on sticker plates.
  {
    const { x, y } = cell(DECAL_CELL.bit);
    ctx.fillStyle = TOKEN_HEX.ink; ctx.fillRect(x + 6, y + 6, S - 12, S - 12);
    ctx.fillStyle = TOKEN_HEX.volt; ctx.fillRect(x + 12, y + 12, S - 24, S - 24);
    drawMark(ctx, marks.bit, x + 18, y + 18, S - 36, S - 36);
  }
  // OHMSTEAD mark at the shoulder: paper on an ink plate.
  {
    const { x, y } = cell(DECAL_CELL.ohmstead);
    ctx.fillStyle = TOKEN_HEX.ink; ctx.fillRect(x + 2, y + 34, S - 4, S - 68);
    drawMark(ctx, marks.ohmstead, x + 10, y + 40, S - 20, S - 80, 0, { remap: { ink: TOKEN_HEX.paper } });
  }
  // SO-101 plate on the base, and the team numbers: set live in the HUD faces, never baked.
  {
    const { x, y } = cell(DECAL_CELL.plate);
    ctx.fillStyle = "#C9C4B8"; ctx.fillRect(x + 4, y + 40, S - 8, S - 80);
    ctx.fillStyle = TOKEN_HEX.ink;
    ctx.font = `700 40px ${cssFont("--font-chivo", "ui-monospace, monospace")}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("SO-101", x + S / 2, y + S / 2 + 2);
  }
  for (const [c, n, color] of [[DECAL_CELL.numberA, "01", TOKEN_HEX.cobalt], [DECAL_CELL.numberB, "02", TOKEN_HEX.magenta]] as const) {
    const { x, y } = cell(c);
    ctx.fillStyle = TOKEN_HEX.paper; ctx.fillRect(x + 8, y + 8, S - 16, S - 16);
    ctx.fillStyle = color;
    ctx.font = `italic 800 88px ${cssFont("--font-barlow", "'Arial Narrow', sans-serif")}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(n, x + S / 2, y + S / 2 + 4);
  }
  // Nothing on a machine that has been through a match is factory-fresh: every printed cell gets grime at
  // its border and the ink scratched back toward the substrate (GROUNDING F). Amounts per cell class.
  const WEAR: Readonly<Record<number, number>> = {
    [DECAL_CELL.screw]: 0.30, [DECAL_CELL.witness]: 0.22, [DECAL_CELL.bit]: 0.60,
    [DECAL_CELL.ohmstead]: 0.50, [DECAL_CELL.plate]: 0.42, [DECAL_CELL.numberA]: 0.38, [DECAL_CELL.numberB]: 0.38,
  };
  for (let i = 0; i <= DECAL_CELL.numberB; i++) {
    const { x, y } = cell(i);
    drawWear(ctx, x, y, S, S, i * 9781 + 17, WEAR[i] ?? 0.34);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* ───────────────────────── placement ───────────────────────── */

export interface DecalPlacement {
  link: LinkId;
  /** Link-local transform of a unit quad facing +Z (decal plane). */
  matrix: Matrix4;
  cell: number;
}

export interface LedPlacement {
  link: LinkId;
  matrix: Matrix4;
  /** Joint index (0..5) whose tracking error drives brightness; the chain order base → gripper. */
  joint: number;
}

/** Servo visual geoms in chain order (base servo drives shoulder_pan, …, gripper servo drives the jaw). */
function servoGeoms(assets: RobotAssets): { link: LinkId; pos: Vector3; quat: Quaternion }[] {
  const out: { link: LinkId; pos: Vector3; quat: Quaternion }[] = [];
  for (const l of assets.model.links) {
    for (const v of l.visuals) {
      if (v.slot !== "servo") continue;
      out.push({ link: l.link, pos: new Vector3(...v.pos), quat: new Quaternion(v.quat[1], v.quat[2], v.quat[3], v.quat[0]) });
    }
  }
  return out;
}

const SERVO_HALF = new Vector3(0.0227, 0.0124, 0.0202);
/** Servo status LED quad size (sim metres). */
export const LED_SIZE_M = new Vector3(0.0045, 0.0022, 1);
/**
 * Nearest distance (sim metres) at which a bead is drawn at its true size.
 *
 * The beads are sized in world metres, so the identical 4.5 × 2.2 mm quad that is a tight ~2 px point on the
 * opponent at 0.8 m subtends tens of pixels on the pilot's own gripper at ~0.15 m — and at `LED_CAP` 1.6,
 * well over the 0.98 bloom gate, that much area blooms into a colourless ~120 px blob over the viewmodel.
 * Closer than this the quad is scaled about its centre by `distance / LED_MIN_DIST_M` in the vertex shader,
 * so a near bead keeps the angular size of a bead at 0.55 m: a small bright point, still at full radiance.
 * Lowering `LED_CAP` instead would dim the opponent's beads, which are already right and carry the 250 ms
 * LED tell.
 */
export const LED_MIN_DIST_M = 0.55;
/**
 * An LED instance no wider than this is a servo bead; anything wider is a flank strip. Both families share
 * one instanced mesh, and this is what tells them apart inside the shader: a bead is clamped to its
 * `LED_MIN_DIST_M` angular size, a strip never is, because shrinking a strip would break the line it draws
 * down the link. `tests/vfx-pools.test.mjs` pins both families against this threshold.
 */
export const LED_BEAD_MAX_W_M = LED_SIZE_M.x * 3;

/** Quad on a servo face: local point on the servo, face normal axis, size (m). */
function onServo(servo: { pos: Vector3; quat: Quaternion }, local: Vector3, normal: Vector3, size: number, roll = 0): Matrix4 {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal);
  if (roll) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll));
  const inner = new Matrix4().compose(local.clone().addScaledVector(normal, 0.0003), q, new Vector3(size, size, size));
  return new Matrix4().compose(servo.pos, servo.quat, new Vector3(1, 1, 1)).multiply(inner);
}

/**
 * Casts a ray at a link's merged visual geometry from outside toward `aim` (link-local; default the bounds
 * centre), returning a surface-aligned quad matrix. With `tangent`, the quad's X runs along it (strips).
 */
function onShell(
  assets: RobotAssets, link: LinkId, dir: Vector3, size: number | Vector3, lift = 0, aim?: Vector3, tangent?: Vector3,
): Matrix4 | null {
  const g = linkGeometry(assets, link);
  const bounds = assets.linkBounds[link];
  if (!g || !bounds.radius) return null;
  const mesh = new Mesh(g);
  const center = (aim ? aim.clone() : new Vector3(...bounds.center)).add(new Vector3(0, 0, lift));
  const origin = center.clone().addScaledVector(dir.clone().normalize(), bounds.radius * 1.6);
  const ray = new Raycaster(origin, dir.clone().normalize().negate(), 0, bounds.radius * 3.2);
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit?.face) return null;
  const n = hit.face.normal.clone().normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
  if (tangent) {
    const t = tangent.clone().addScaledVector(n, -tangent.dot(n));
    if (t.lengthSq() > 1e-8) {
      const x = new Vector3(1, 0, 0).applyQuaternion(q);
      const angle = Math.atan2(x.clone().cross(t.normalize()).dot(n), x.dot(t));
      q.premultiply(new Quaternion().setFromAxisAngle(n, angle));
    }
  }
  const scale = typeof size === "number" ? new Vector3(size, size, size) : size;
  return new Matrix4().compose(hit.point.clone().addScaledVector(n, 0.0005), q, scale);
}

/** The fixed decal table for one arm (link-local); only the team number differs by seat. */
export function buildDecalPlacements(assets: RobotAssets, seat: Seat = "atlas"): DecalPlacement[] {
  const out: DecalPlacement[] = [];
  const servos = servoGeoms(assets);
  servos.forEach((s, i) => {
    const id = Math.min(6, i + 1);
    out.push({ link: s.link, cell: id - 1, matrix: onServo(s, new Vector3(-0.009, SERVO_HALF.y, 0.006), new Vector3(0, 1, 0), 0.016) });
    out.push({ link: s.link, cell: DECAL_CELL.screw, matrix: onServo(s, new Vector3(0.017, SERVO_HALF.y, 0.014), new Vector3(0, 1, 0), 0.0034) });
    out.push({ link: s.link, cell: DECAL_CELL.screw, matrix: onServo(s, new Vector3(0.017, SERVO_HALF.y, -0.013), new Vector3(0, 1, 0), 0.0034) });
    out.push({ link: s.link, cell: DECAL_CELL.witness, matrix: onServo(s, new Vector3(0.0, 0.0, SERVO_HALF.z), new Vector3(0, 0, 1), 0.006, Math.PI / 2) });
  });
  const plate = onShell(assets, "base", new Vector3(1, 0, 0.25), 0.03);
  if (plate) out.push({ link: "base", cell: DECAL_CELL.plate, matrix: plate });
  const ohm = onShell(assets, "shoulder", new Vector3(1, 0, 0.3), 0.024);
  if (ohm) out.push({ link: "shoulder", cell: DECAL_CELL.ohmstead, matrix: ohm });
  // Team number on the outer flank of the upper arm, the BIT sticker on the inner.
  const number = onShell(assets, "upper_arm", new Vector3(0, 0, 1), 0.016);
  if (number) out.push({ link: "upper_arm", cell: seat === "atlas" ? DECAL_CELL.numberA : DECAL_CELL.numberB, matrix: number });
  const bit = onShell(assets, "upper_arm", new Vector3(0, 0, -1), 0.014);
  if (bit) out.push({ link: "upper_arm", cell: DECAL_CELL.bit, matrix: bit });
  return out;
}

/** Links that carry an LED accent strip down each flank (the pitch links: their joint axis is the flank normal). */
export const STRIP_LINKS: readonly LinkId[] = ["upper_arm", "lower_arm"];
/** LED strip width (sim metres); length is 62% of the link's joint-to-joint span. */
export const STRIP_WIDTH_M = 0.0026;

/**
 * Status LEDs, two per servo (one on each broad face) in chain order, then an LED accent strip down each
 * flank of the pitch links, driven by that link's own joint.
 */
export function buildLedPlacements(assets: RobotAssets): LedPlacement[] {
  const out: LedPlacement[] = [];
  servoGeoms(assets).forEach((s, i) => {
    for (const side of [1, -1]) {
      out.push({
        link: s.link, joint: Math.min(5, i),
        matrix: onServo(s, new Vector3(0.0165, SERVO_HALF.y * side, -0.004), new Vector3(0, side, 0), 1)
          .multiply(new Matrix4().makeScale(LED_SIZE_M.x, LED_SIZE_M.y, 1)),
      });
    }
  });
  const links = assets.model.links;
  for (const link of STRIP_LINKS) {
    const li = links.findIndex((l) => l.link === link);
    const child = links.find((l) => l.parent === li);
    if (li < 0 || !child || links[li].jointIndex < 0) continue;
    const span = new Vector3(...child.pos);
    const axis = new Vector3(...links[li].axis).normalize();
    const size = new Vector3(span.length() * 0.62, STRIP_WIDTH_M, 1);
    // Aim at the span's midpoint, sliding toward the shell's bounds centre until the ray finds the flank
    // (a link's joint-to-joint line can run through a gap between its side plates).
    const mid = span.clone().multiplyScalar(0.5);
    const center = new Vector3(...assets.linkBounds[link].center);
    for (const side of [1, -1]) {
      for (const f of [0, 0.5, 1]) {
        const m = onShell(assets, link, axis.clone().multiplyScalar(side), size, 0, mid.clone().lerp(center, f), span);
        if (m) { out.push({ link, joint: links[li].jointIndex, matrix: m }); break; }
      }
    }
  }
  return out;
}

/* ───────────────────────── meshes ───────────────────────── */

export function createDecalMesh(count: number, atlas: Texture | null): InstancedMesh {
  const geometry: BufferGeometry = new PlaneGeometry(1, 1);
  const cells = new InstancedBufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute("aCell", cells);
  const material = new MeshStandardMaterial({
    map: atlas, transparent: false, alphaTest: 0.5, roughness: 0.5, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aCell;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = (vec2(mod(aCell, ${DECAL_ATLAS_CELLS}.0), ${DECAL_ATLAS_CELLS - 1}.0 - floor(aCell / ${DECAL_ATLAS_CELLS}.0)) + uv) / ${DECAL_ATLAS_CELLS}.0;
#endif`);
  };
  material.customProgramCacheKey = () => "tl-robot-decal";
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.name = "robot-decals";
  return mesh;
}

/** Instance cell indices must be written once after creation. */
export function setDecalCells(mesh: InstancedMesh, placements: readonly DecalPlacement[]): void {
  const attr = mesh.geometry.getAttribute("aCell") as InstancedBufferAttribute;
  placements.forEach((p, i) => { attr.array[i] = p.cell; });
  attr.needsUpdate = true;
}

export function createLedMesh(count: number): InstancedMesh {
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  // Near beads are drawn at their LED_MIN_DIST_M angular size (see the constant). Both quantities are read
  // through modelViewMatrix, so both are in render units and the sim-metre constants scale once here; the
  // arm's own space is sim metres. One boot-time patch on the one LED material: no new program.
  const nearM = (LED_MIN_DIST_M * RENDER_SCALE).toFixed(4);
  const beadM = (LED_BEAD_MAX_W_M * RENDER_SCALE).toFixed(5);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
  if (length((modelViewMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xyz) <= ${beadM}) {
    float tlDepth = -(modelViewMatrix * instanceMatrix[3]).z;
    transformed *= clamp(tlDepth / ${nearM}, 0.1, 1.0);
  }
#endif`);
  };
  material.customProgramCacheKey = () => "tl-servo-led";
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setColorAt(0, new Color(0, 0, 0));
  mesh.instanceColor?.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.name = "servo-leds";
  return mesh;
}

/** Joint speed (rad/s) that reads as full effort on its own. */
export const EFFORT_FULL_QD = 3;
/**
 * Measured servo effort 0..1 from the physics frame: the larger of actuator force over its current force
 * range and joint speed over EFFORT_FULL_QD. A servo straining against a block and one whipping free both glow.
 */
export function servoEffort(tau: number, forceRange: number, qd: number): number {
  const v = Math.max(forceRange > 1e-6 ? Math.abs(tau) / forceRange : 0, Math.abs(qd) / EFFORT_FULL_QD);
  return v > 1 ? 1 : v;
}
