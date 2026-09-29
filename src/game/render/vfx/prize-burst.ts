// src/game/render/vfx/prize-burst.ts (WP6)
// Cash-style prize bursts (SCOPE 1.1/1.2, acceptance 13): volt prize cubes and paper-and-volt "bills"
// fountaining out of a point with tumble and deck bounce. Fired on player locks (from the dock) and player
// match wins (over the winner's dock), and as the team-colour shatter of the de-rez (acceptance 12).
// Two instanced ballistic pools sharing the chips integrator; they never grow past their size.
import { BoxGeometry } from "three";
import {
  type Prewarmable, TOKEN_HEX } from "../../contracts.ts";
import { createChipPool, type ChipPool } from "./chips.ts";
import { createVfxRandom } from "./sparks.ts";

export const PRIZE_CUBE_POOL = 72;
export const PRIZE_BILL_POOL = 48;
export const PRIZE_LIFE_S = 1.9;

export interface PrizeBurst extends Prewarmable {
  readonly cubes: ChipPool;
  readonly bills: ChipPool;
  /** A fountain of `cubes` cubes and `bills` bills from sim (x, y, z). */
  fire(nowS: number, x: number, y: number, z: number, cubes: number, bills: number, power?: number): void;
  /** The de-rez shatter: 40 team-colour and volt cubes sprayed out of the dissolving arm's height range. */
  derezBurst(nowS: number, x: number, y: number, zLow: number, zHigh: number, teamHex: string): void;
  update(nowS: number, dtS: number, frozen: boolean): void;
  clear(): void;
  dispose(): void;
}

export function createPrizeBurst(): PrizeBurst {
  const cubes = createChipPool(PRIZE_CUBE_POOL, {
    geometry: new BoxGeometry(0.01, 0.01, 0.01), lifeS: PRIZE_LIFE_S, name: "prize-cubes", emissive: 0.9, spin: [6, 16],
  });
  const bills = createChipPool(PRIZE_BILL_POOL, {
    geometry: new BoxGeometry(0.024, 0.011, 0.0006), lifeS: PRIZE_LIFE_S, name: "prize-bills", spin: [10, 26],
  });
  const rand = createVfxRandom(0xb111);
  const self: PrizeBurst = {
    cubes, bills,
    fire(nowS, x, y, z, nCubes, nBills, power = 1) {
      for (let i = 0; i < nCubes; i++) {
        const a = rand() * Math.PI * 2, sp = (0.25 + rand() * 0.55) * power;
        cubes.spawn(nowS, x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, (1.1 + rand() * 1.0) * power, TOKEN_HEX.volt, 0.7 + rand() * 0.5);
      }
      for (let i = 0; i < nBills; i++) {
        const a = rand() * Math.PI * 2, sp = (0.2 + rand() * 0.45) * power;
        bills.spawn(nowS, x, y, z + 0.01, Math.cos(a) * sp, Math.sin(a) * sp, (1.3 + rand() * 0.9) * power, rand() < 0.6 ? TOKEN_HEX.paper : TOKEN_HEX.volt, 0.9 + rand() * 0.3);
      }
    },
    derezBurst(nowS, x, y, zLow, zHigh, teamHex) {
      // The shatter: the arm bursts into voxels of its own team colour, flecked with volt.
      for (let i = 0; i < 40; i++) {
        const a = rand() * Math.PI * 2, sp = 0.25 + rand() * 0.7;
        const z = zLow + (zHigh - zLow) * rand();
        cubes.spawn(nowS, x + Math.cos(a) * 0.02, y + Math.sin(a) * 0.02, z, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + rand() * 1.1,
          i % 4 === 3 ? TOKEN_HEX.volt : teamHex, 0.6 + rand() * 0.7);
      }
    },
    update(nowS, dtS, frozen) {
      cubes.update(nowS, dtS, frozen);
      bills.update(nowS, dtS, frozen);
    },
    clear() { cubes.clear(); bills.clear(); },
    dispose() { cubes.dispose(); bills.dispose(); },
    prewarmDraw() { cubes.prewarmDraw(); bills.prewarmDraw(); },
  };
  return self;
}
