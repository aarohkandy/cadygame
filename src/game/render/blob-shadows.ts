// src/game/render/blob-shadows.ts (WP6, tightened for GROUNDING B)
// Contact grounding on every tier (GAME_DESIGN 6.5): one InstancedMesh, pool 24, one draw, under every cube,
// both arm bases and both grippers, sized and faded by height above the deck.
// Two lobes per blob, which is what makes an object look planted rather than pasted on: a tight, dark contact
// core that dies within ~2 cm of the footprint, and a wide, faint ambient skirt under it. A single soft
// gaussian reads as a smudge; the hard core is the part the eye takes as contact.
// The opponent hand shadow (3.1.3) is the gripper entry: the depth cue for a 4 cm target 30–45 cm away.
import {
  DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3,
} from "three";

export const BLOB_POOL = 24;
/** Ink at 45% (6.8) for the ambient skirt; the contact core goes darker, but only where the object touches. */
export const BLOB_MAX_OPACITY = 0.45;
export const BLOB_CORE_OPACITY = 0.68;
/** Deck surface height (sim metres) the blobs sit on. */
export const BLOB_Z = 0.0008;

/**
 * Radius and opacity of a blob for an object whose lowest point is `heightM` above the deck: the blob
 * widens and softens with height and is gone by 0.30 m.
 */
export function blobFor(heightM: number, baseRadiusM: number): { radius: number; opacity: number } {
  const h = Math.max(0, heightM);
  const fade = Math.max(0, 1 - h / 0.3);
  return { radius: baseRadiusM * (1 + h * 3.2), opacity: BLOB_MAX_OPACITY * fade * fade };
}

const VERT = /* glsl */ `
attribute float aOpacity;
varying vec2 vUv;
varying float vOpacity;
void main() {
  vUv = uv;
  vOpacity = aOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vOpacity;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  // Core: hard at the footprint, gone by ~0.45 of the blob radius. Skirt: the wide ambient darkening.
  float core = 1.0 - smoothstep(0.30, 0.62, d);
  float skirt = 1.0 - smoothstep(0.18, 1.0, d);
  float a = min(1.0, core * ${(BLOB_CORE_OPACITY / BLOB_MAX_OPACITY).toFixed(4)} + skirt) * vOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.035, 0.037, 0.046, a);
}
`;

export interface BlobShadows {
  readonly mesh: InstancedMesh;
  /** Starts a frame: every slot not set again is hidden. */
  begin(): void;
  /** Places one blob at sim (x, y) for an object at height `heightM`; `stretch` elongates along yaw. */
  set(x: number, y: number, heightM: number, baseRadiusM: number, yaw?: number, stretch?: number): void;
  end(): void;
  dispose(): void;
}

export function createBlobShadows(): BlobShadows {
  const geometry = new PlaneGeometry(1, 1);
  const opacity = new InstancedBufferAttribute(new Float32Array(BLOB_POOL), 1);
  opacity.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aOpacity", opacity);
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new InstancedMesh(geometry, material, BLOB_POOL);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = "blob-shadows";
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  let used = 0;
  return {
    mesh,
    begin() { used = 0; },
    set(x, y, heightM, baseRadiusM, yaw = 0, stretch = 1) {
      if (used >= BLOB_POOL) return;
      const b = blobFor(heightM, baseRadiusM);
      if (b.opacity <= 0.002) return;
      q.setFromAxisAngle(zAxis, yaw);
      p.set(x, y, BLOB_Z);
      s.set(b.radius * 2 * stretch, b.radius * 2, 1);
      mesh.setMatrixAt(used, m.compose(p, q, s));
      opacity.array[used] = b.opacity;
      used++;
    },
    end() {
      for (let i = used; i < BLOB_POOL; i++) opacity.array[i] = 0;
      mesh.count = BLOB_POOL;
      mesh.instanceMatrix.needsUpdate = true;
      opacity.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
