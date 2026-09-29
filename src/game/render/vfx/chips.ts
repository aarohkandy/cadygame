// src/game/render/vfx/chips.ts (WP6)
// Print flakes (GAME_DESIGN 6.8): instanced 6 mm chips with a ballistic flight, spin, and a damped bounce
// on the deck, used by crits (paper or team chips) and lobby tile breaks (paper, team, volt). Pool 128,
// 1.2 s life. Simulated in JS because of the bounce; only live chips are touched each frame.
import {
  BoxGeometry, type BufferGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3,
} from "three";
import type { Prewarmable } from "../../contracts.ts";
import { GRAVITY_SIM, createRingPool, linearColor, type RingPool } from "./sparks.ts";

export const CHIP_POOL = 128;
export const CHIP_LIFE_S = 1.2;
const CHIP_SIZE_M = 0.006;
const DECK_Z = 0.0015;
const RESTITUTION = 0.35;
const FRICTION = 0.6;

export interface ChipPool extends Prewarmable {
  readonly mesh: InstancedMesh;
  readonly pool: RingPool;
  spawn(nowS: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, hex: string, sizeScale?: number): void;
  /** Integrates live chips; `frozen` holds them in place during hit stop. */
  update(nowS: number, dtS: number, frozen: boolean): void;
  clear(): void;
  dispose(): void;
  readonly liveCount: number;
}

export interface BallisticPoolOptions {
  /** Instance geometry (defaults to a 6 mm print flake). */
  geometry?: BufferGeometry;
  lifeS?: number;
  name?: string;
  /** Emissive boost of the instance colour (volt prize cubes glow just under the bloom threshold). */
  emissive?: number;
  /** Tumble rate range (rad/s). */
  spin?: readonly [number, number];
}

/** Instanced ballistic pieces with deck bounce: print chips here, prize cubes and bills in prize-burst.ts. */
export function createChipPool(capacity = CHIP_POOL, opts: BallisticPoolOptions = {}): ChipPool {
  const geometry = opts.geometry ?? new BoxGeometry(CHIP_SIZE_M, CHIP_SIZE_M * 0.72, CHIP_SIZE_M * 0.22);
  const LIFE = opts.lifeS ?? CHIP_LIFE_S;
  const spinRange = opts.spin ?? [18, 48];
  const material = new MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  const emissive = opts.emissive ?? 0;
  if (emissive > 0) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor * ${emissive.toFixed(2)};\n#endif`,
      );
    };
    material.customProgramCacheKey = () => `tl-ballistic-emissive-${emissive}`;
  }
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setColorAt(0, new Color(1, 1, 1));
  mesh.instanceColor?.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.name = opts.name ?? "chips";
  const pool = createRingPool(capacity);
  const state = new Float64Array(capacity * 13); // pos3 vel3 axis3 angle spin birth scale
  const live = new Uint8Array(capacity);
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), axis = new Vector3();
  const hidden = new Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, hidden);
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let liveCount = 0;
  let dirty = true;
  const self: ChipPool = {
    mesh, pool,
    get liveCount() { return liveCount; },
    spawn(nowS, x, y, z, vx, vy, vz, hex, sizeScale = 1) {
      const i = pool.alloc(nowS, LIFE);
      const o = i * 13;
      state[o] = x; state[o + 1] = y; state[o + 2] = z;
      state[o + 3] = vx; state[o + 4] = vy; state[o + 5] = vz;
      axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      state[o + 6] = axis.x; state[o + 7] = axis.y; state[o + 8] = axis.z;
      state[o + 9] = rand() * Math.PI * 2; state[o + 10] = spinRange[0] + rand() * (spinRange[1] - spinRange[0]);
      state[o + 11] = nowS; state[o + 12] = sizeScale;
      mesh.setColorAt(i, linearColor(hex));
      if (!live[i]) { live[i] = 1; liveCount++; }
      dirty = true;
    },
    update(nowS, dtS, frozen) {
      mesh.visible = liveCount > 0;
      if (liveCount === 0 && !dirty) return;
      const dt = frozen ? 0 : Math.min(dtS, 1 / 20);
      for (let i = 0; i < capacity; i++) {
        if (!live[i]) continue;
        const o = i * 13;
        const age = nowS - state[o + 11];
        if (age > LIFE || age < 0) {
          live[i] = 0; liveCount--;
          mesh.setMatrixAt(i, hidden);
          dirty = true;
          continue;
        }
        if (dt > 0) {
          state[o + 5] -= GRAVITY_SIM * dt;
          state[o] += state[o + 3] * dt; state[o + 1] += state[o + 4] * dt; state[o + 2] += state[o + 5] * dt;
          if (state[o + 2] < DECK_Z && state[o + 5] < 0) {
            state[o + 2] = DECK_Z;
            state[o + 5] = -state[o + 5] * RESTITUTION;
            state[o + 3] *= FRICTION; state[o + 4] *= FRICTION;
            state[o + 10] *= 0.5;
          }
          state[o + 9] += state[o + 10] * dt;
        }
        const shrink = age > LIFE - 0.25 ? (LIFE - age) / 0.25 : 1;
        const sc = state[o + 12] * shrink;
        axis.set(state[o + 6], state[o + 7], state[o + 8]);
        q.setFromAxisAngle(axis, state[o + 9]);
        mesh.setMatrixAt(i, m.compose(p.set(state[o], state[o + 1], state[o + 2]), q, s.set(sc, sc, sc)));
        dirty = true;
      }
      if (dirty) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        dirty = false;
      }
    },
    clear() {
      pool.clear();
      for (let i = 0; i < capacity; i++) { live[i] = 0; mesh.setMatrixAt(i, hidden); }
      liveCount = 0; dirty = true;
    },
    dispose() { geometry.dispose(); material.dispose(); },
    /** One tiny live instance so WP1's prewarm draw compiles this program before the show (Prewarmable). */
    prewarmDraw() { self.spawn(0, 0, 0, 0.01, 0, 0, 0, "#FFFFFF", 0.05); self.update(0, 0, true); },
  };
  return self;
}
