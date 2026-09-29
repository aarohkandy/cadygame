// POOL_COS in stage-deck.tsx is a hand-copied duplicate of POOL.angle / POOL.innerAngle in lighting.tsx: one
// is the volumetric haze cone, the other is the pool that cone lands on the deck. If they drift they stop
// being the same fixture and the light visibly misses its own beam. Nothing in the types stops that, so this
// does. Both are read out of the source text rather than imported, because node --test strips types from .ts
// but cannot transform the JSX in a .tsx — and reading the literals is the more direct check anyway.
// Deduplicating properly means a leaf module both files import; worth it if a third consumer ever appears.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const lightingSrc = read("../src/game/render/lighting.tsx");
const deckSrc = read("../src/game/render/stage-deck.tsx");

function pool() {
  const m = /export const POOL = \{([^}]*)\}/.exec(lightingSrc);
  assert.ok(m, "POOL not found in lighting.tsx — renamed, or moved to a shared module?");
  const num = (key) => {
    const hit = new RegExp(`${key}:\\s*([-\\d.]+)`).exec(m[1]);
    assert.ok(hit, `POOL.${key} no longer reads as a numeric literal`);
    return Number(hit[1]);
  };
  return { strength: num("strength"), angle: num("angle"), innerAngle: num("innerAngle") };
}

function poolCos() {
  const m = /const POOL_COS = \{([^}]*)\}/.exec(deckSrc);
  assert.ok(m, "POOL_COS not found in stage-deck.tsx — renamed, or moved to a shared module?");
  const num = (key) => {
    const hit = new RegExp(`${key}:\\s*Math\\.cos\\(([-\\d.]+)\\)`).exec(m[1]);
    assert.ok(hit, `POOL_COS.${key} no longer reads as Math.cos(<literal>)`);
    return Number(hit[1]);
  };
  return { outer: num("outer"), inner: num("inner") };
}

describe("deck pool and haze cone are one fixture", () => {
  test("POOL_COS uses exactly the angles the light is built with", () => {
    const p = pool();
    const c = poolCos();
    assert.equal(c.outer, p.angle, "stage-deck's outer cone drifted from lighting's POOL.angle");
    assert.equal(c.inner, p.innerAngle, "stage-deck's inner cone drifted from lighting's POOL.innerAngle");
  });

  test("the inner cone sits inside the outer one", () => {
    const p = pool();
    assert.ok(p.innerAngle > 0 && p.innerAngle < p.angle, `inner ${p.innerAngle} must sit inside outer ${p.angle}`);
  });

  test("the par can holds its flux: widening the lens is paid for in strength", () => {
    // A rigger trades peak for area at constant flux, strength x angle^2. The pool was flown from 0.20 rad
    // at 16 to 0.30 rad at 7.1 for exactly that reason: on a real GPU its hot centre measured 0.714 display
    // luma against an opponent of 0.413, so the DECK was the brightest large object and PART 2 acceptance 3
    // failed on hardware while passing on SwiftShader. Dimming the lane outright is forbidden (STATUS.md
    // prices it at litlane 0.691 -> 0.160); spreading it at constant flux is not. This pins the trade, so a
    // later tweak to either number cannot quietly dim the deck or blow its centre back out.
    const p = pool();
    const flux = p.strength * p.angle ** 2;
    assert.ok(Math.abs(flux - 0.64) < 0.02, `par-can flux ${flux.toFixed(3)} left the 0.64 the deck is lit for`);
  });
});
