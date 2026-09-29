// src/game/render/vfx/rerender-scan.ts (WP6)
// The round re-render scan (finals-visual 2.10, acceptance 12): at round_intro a signal-orange voxel scan
// plane sweeps up through the stage in 400 ms. Everything below the plane is "rendered": the arm shells
// reappear pristine under it (their shader discards fragments above uScanY), scuffs and dissolve state are
// already wiped. The plane itself is a faint voxel grid with a bright leading edge. One draw.
import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import {
  type Prewarmable, RENDER_SCALE, TOKEN_HEX } from "../../contracts.ts";
import { easeInOutCubic } from "../interpolate.ts";
import { linearColor } from "./sparks.ts";

/** Sim height the scan travels (deck to above both arms at full reach). */
export const SCAN_TOP_M = 0.46;
const PLANE_HALF_M = 1.3;

const VERT = /* glsl */ `
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
varying vec2 vXY;
void main() {
  float r = length(vXY);
  float falloff = 1.0 - smoothstep(0.45, ${PLANE_HALF_M.toFixed(2)}, r);
  vec2 cell = abs(fract(vXY / 0.012) - 0.5);
  float grid = 1.0 - smoothstep(0.40, 0.48, max(cell.x, cell.y));
  float flick = step(0.35, fract(sin(dot(floor(vXY / 0.012), vec2(12.9898, 78.233))) * 43758.5453));
  float a = (0.10 + grid * 0.35 * flick) * falloff * (1.0 - smoothstep(0.75, 1.0, uK));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * 5.0, a);
}
`;

export interface RerenderScan extends Prewarmable {
  readonly mesh: Mesh;
  /** k: 0..1 scan progress or −1 idle. Returns the render-space scan height for the arm shaders (1e3 idle). */
  update(k: number): number;
  dispose(): void;
}

/** Scan height (sim metres) at progress k. */
export function scanHeightM(k: number): number {
  return easeInOutCubic(k) * SCAN_TOP_M;
}

export function createRerenderScan(): RerenderScan {
  const geometry = new PlaneGeometry(PLANE_HALF_M * 2, PLANE_HALF_M * 2, 1, 1);
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uColor: { value: linearColor(TOKEN_HEX.signal).clone() }, uK: { value: 0 } },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 14;
  mesh.name = "rerender-scan";
  const self: RerenderScan = {
    mesh,
    update(k) {
      if (k < 0) { mesh.visible = false; return 1e3; }
      const h = scanHeightM(k);
      mesh.visible = true;
      mesh.position.set(0, 0, h);
      material.uniforms.uK.value = k;
      return h * RENDER_SCALE;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.update(0); },
  };
  return self;
}
