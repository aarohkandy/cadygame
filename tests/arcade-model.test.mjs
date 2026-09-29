// WP2: the generated ARCADE model (GAME_DESIGN 4.10; BUILD_PLAN 4 WP2 #13).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  ARMOR_GEOMS, buildArcadeArena, buildArcadeRobot, HULL_LINKS, HULL_RADIUS_M, measureHulls, MODEL_DIR, stripArcadeArena, stripArcadeRobot,
} from "../scripts/gen-arcade-model.mjs";
import { createPhysicsEngine, engineInternals } from "../src/game/physics/engine.ts";
import { SEATS } from "../src/game/contracts.ts";

const read = (f) => readFileSync(path.join(MODEL_DIR, f), "utf8");
let engine;
before(async () => { engine = await createPhysicsEngine({ mode: "arcade" }); });
after(() => engine?.dispose());

describe("arcade model", () => {
  test("stripping the generated hulls reproduces the stock files byte for byte", () => {
    assert.equal(stripArcadeRobot(read("so101-arcade.xml")), read("so101.xml"));
    assert.equal(stripArcadeArena(read("arena-arcade.xml")), read("arena.xml"));
  });

  test("the committed Arcade files are exactly what the generator produces today", async () => {
    const hulls = await measureHulls();
    assert.equal(buildArcadeRobot(read("so101.xml"), hulls), read("so101-arcade.xml"));
    assert.equal(buildArcadeArena(read("arena.xml")), read("arena-arcade.xml"));
  });

  test("each seat carries five invisible, massless, non-colliding 9 mm capsules mapped to their links", () => {
    const { mujoco, model, index } = engineInternals(engine);
    assert.equal(index.hullCount, 10);
    for (let g = 0; g < model.ngeom; g++) {
      if (!index.geomHull[g]) continue;
      assert.equal(model.geom_type[g], mujoco.mjtGeom.mjGEOM_CAPSULE.value);
      assert.equal(model.geom_size[g * 3], HULL_RADIUS_M);
      assert.equal(model.geom_contype[g], 0);
      assert.equal(model.geom_conaffinity[g], 0);
      assert.equal(model.geom_rgba[g * 4 + 3], 0);
      assert.ok(index.geomSeat[g] >= 0 && index.geomLink[g] >= 0);
    }
    assert.equal(HULL_LINKS.length, 5);
  });

  test("explicit pairs: every atlas hull × every blaze hull, and every atlas armour geom × every blaze armour geom, all stiff", () => {
    const { mujoco, model, index } = engineInternals(engine);
    const name = (g) => mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM.value, g);
    assert.equal(model.npair, 25 + ARMOR_GEOMS.length ** 2);
    let hullPairs = 0;
    for (let p = 0; p < model.npair; p++) {
      const g1 = model.pair_geom1[p], g2 = model.pair_geom2[p];
      assert.equal(index.geomSeat[g1], 0);
      assert.equal(index.geomSeat[g2], 1);
      assert.equal(model.pair_solref[p * 2], 0.005);
      if (index.geomHull[g1]) {
        assert.ok(index.geomHull[g2]);
        hullPairs++;
      } else {
        assert.ok(ARMOR_GEOMS.includes(name(g1).slice(6)) && ARMOR_GEOMS.includes(name(g2).slice(6)), `${name(g1)} × ${name(g2)}`);
      }
    }
    assert.equal(hullPairs, 25);
  });

  test("the stock model has no hulls and the same bodies, dofs and actuators", () => {
    const { compileFresh } = engineInternals(engine);
    const stock = compileFresh("harness");
    const arcade = compileFresh("arcade");
    try {
      for (const k of ["nq", "nv", "nu", "nbody", "njnt", "nsite"]) assert.equal(stock[k], arcade[k], k);
      assert.equal(arcade.ngeom - stock.ngeom, 10);
      // Arcade adds contact pairs, never changes a stock geom's own contact parameters (grasping stays stock).
      const { mujoco } = engineInternals(engine);
      const kept = [];
      for (let g = 0; g < arcade.ngeom; g++) if (!/_hull_/.test(mujoco.mj_id2name(arcade, mujoco.mjtObj.mjOBJ_GEOM.value, g) ?? "")) kept.push(g);
      for (const k of ["geom_solref", "geom_solimp", "geom_friction", "geom_condim", "geom_margin", "geom_priority"]) {
        const w = arcade[k].length / arcade.ngeom;
        assert.deepEqual(kept.flatMap((g) => Array.from(arcade[k].slice(g * w, (g + 1) * w))), Array.from(stock[k]), k);
      }
      assert.equal(stock.npair, 0);
      for (const k of ["body_mass", "body_inertia", "dof_damping", "dof_armature", "actuator_gainprm", "actuator_biasprm", "actuator_forcerange"]) {
        assert.deepEqual(Array.from(arcade[k]), Array.from(stock[k]), k);
      }
    } finally {
      stock.delete();
      arcade.delete();
    }
  });

  test("hulls sit inside their links: each capsule lies within its link's collision bounding box", async () => {
    const hulls = await measureHulls();
    for (const link of HULL_LINKS) {
      const h = hulls[link];
      for (const end of [h.from, h.to]) for (let k = 0; k < 3; k++) {
        assert.ok(end[k] >= h.lo[k] - 1e-9 && end[k] <= h.hi[k] + 1e-9, `${link} axis ${k}`);
      }
    }
    void SEATS;
  });
});
