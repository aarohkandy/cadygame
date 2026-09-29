// WP6 acceptance 13 and GAME_DESIGN 12.1 "pools": every VFX pool is allocated once at its fixed size and
// never grows, 20 strikes in 1 s and 3 KOs back to back stay inside the pools, and hit stop freezes particles.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createVfxSystem } from "../src/game/render/vfx/vfx-system.ts";
import { SPARK_POOL, createStreakPool, landingTime, sparkCount, createRingPool } from "../src/game/render/vfx/sparks.ts";
import { CALIBRATION } from "../src/game/render/quality.ts";
import { LED_BEAD_MAX_W_M, LED_SIZE_M } from "../src/game/render/robot-decals.ts";
import { SEVEN_SEGMENT, countdownDigit } from "../src/game/render/vfx/core-face.ts";
import { BURST_POOL, createBurstPool } from "../src/game/render/vfx/bursts.ts";
import { ARC_POOL } from "../src/game/render/vfx/arcs.ts";
import { SETTLE_MAX_MS } from "../src/game/render/vfx/derez.ts";
import { CHIP_POOL } from "../src/game/render/vfx/chips.ts";
import { CONFETTI_POOL } from "../src/game/render/vfx/confetti.ts";
import { DECAL_POOL } from "../src/game/render/vfx/decals.ts";
import { PRIZE_CUBE_POOL, PRIZE_BILL_POOL } from "../src/game/render/vfx/prize-burst.ts";
import { lockTickInterval } from "../src/game/render/vfx/lock-pulse.ts";
import {
  coreBeamEnvelope, createCoreBeam, BEAM_FADE_IN_MS, BEAM_FLARE_HOLD_MS, BEAM_FLARE_MS, BEAM_INCOMING_MAX_MS, BEAM_FLOOR_M,
} from "../src/game/render/vfx/core-beam.ts";
import { COCKPIT_EYE_EGO } from "../src/game/render/camera-math.ts";
import { AdditiveBlending, NormalBlending } from "three";
import { SLAM_HOLD_MS, SLAM_MS } from "../src/game/render/vfx/stage-cues.ts";
import { CORE_CUBE_INDEX } from "../src/game/contracts.ts";
import { createGameClock } from "../src/game/loop/game-clock.ts";
import { createEventBus } from "../src/game/core/event-bus.ts";
import { createSettingsStore } from "../src/game/core/settings.ts";
import { fakeCombat, fakeEvents, fakeFeedbackContext, fakeFrame } from "../src/game/testing/fakes.ts";

function setup() {
  const bus = createEventBus();
  const clock = createGameClock();
  const settings = createSettingsStore({ storage: null });
  const frame = fakeFrame();
  frame.docks.set([-0.12, 0, 0, 0.12, 0, 0]);
  const combat = fakeCombat();
  let phase = "fight";
  let wallMs = 1000;
  const vfx = createVfxSystem({ bus, clock, settings, frame: () => frame, combat: () => combat, phase: () => phase, nowMs: () => wallMs });
  const camera = [-0.44, -0.07, 0.24];
  const forward = [1, 0, -0.3];
  const ctx = fakeFeedbackContext({ playerSeat: "atlas" });
  let confettiBudget = 240;
  const tick = (ms = 16.7, events = []) => {
    wallMs += ms;
    clock.advanceWall(ms / 1000);
    for (const e of events) bus.emit(e);
    bus.flush(ctx);
    vfx.update(ms / 1000, wallMs, camera, forward, confettiBudget);
  };
  return { bus, clock, vfx, tick, setPhase: (p) => { phase = p; }, setTier: (n) => { confettiBudget = n; }, frame, combat };
}

/** Snapshot of every GPU buffer identity and length so growth or reallocation is detected. */
function bufferFingerprint(vfx) {
  const out = [];
  vfx.group.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    for (const [name, attr] of Object.entries(g.attributes)) out.push([`${o.name}.${name}`, attr.array, attr.array.length]);
    if (o.instanceMatrix) out.push([`${o.name}.instanceMatrix`, o.instanceMatrix.array, o.instanceMatrix.array.length]);
  });
  return out;
}

describe("vfx pools", () => {
  test("pool sizes match GAME_DESIGN 6.8", () => {
    const { vfx } = setup();
    const s = vfx.stats();
    assert.equal(s.sparks.capacity, SPARK_POOL);
    assert.equal(SPARK_POOL, 512);
    assert.equal(s.bursts.capacity, BURST_POOL);
    assert.equal(s.arcs.capacity, ARC_POOL);
    assert.equal(s.chips.capacity, CHIP_POOL);
    assert.equal(CHIP_POOL, 128);
    assert.equal(s.confetti.capacity, CONFETTI_POOL);
    assert.equal(CONFETTI_POOL, 300);
    assert.equal(s.decals.capacity, DECAL_POOL);
    assert.equal(DECAL_POOL, 64);
    assert.equal(s.ripples.capacity, 8);
    assert.equal(s.prizeCubes.capacity, PRIZE_CUBE_POOL);
    assert.equal(s.prizeBills.capacity, PRIZE_BILL_POOL);
  });

  test("spark count follows 6 + 30·m, ×1.6 on crits", () => {
    assert.equal(sparkCount(0, false), 6);
    assert.equal(sparkCount(1, false), 36);
    assert.equal(sparkCount(0.5, false), 21);
    assert.equal(sparkCount(1, true), 58);
    assert.equal(sparkCount(3, false), 36);
  });

  test("20 strikes in 1 s never allocate beyond the pools", () => {
    const { vfx, tick } = setup();
    const before = bufferFingerprint(vfx);
    for (let i = 0; i < 60; i++) {
      const events = i % 3 === 0 ? [fakeEvents.strike({ magnitude: 1, crit: i % 2 === 0, victim: i % 2 ? "atlas" : "blaze", pos: [0.01 * i, 0, 0.01] })] : [];
      tick(16.7, events);
      const s = vfx.stats();
      for (const key of ["sparks", "bursts", "arcs", "ripples", "chips", "prizeCubes", "prizeBills", "confetti"]) {
        assert.ok(s[key].active <= s[key].capacity, `${key} ${s[key].active} ≤ ${s[key].capacity}`);
      }
      assert.ok(s.decals.active <= s.decals.capacity);
    }
    const after = bufferFingerprint(vfx);
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i][1], before[i][1], `${before[i][0]} buffer identity`);
      assert.equal(after[i][2], before[i][2], `${before[i][0]} buffer length`);
    }
    assert.ok(vfx.stats().sparks.active > 0, "strikes spawned sparks");
  });

  test("3 KOs back to back and a match win stay inside the pools", () => {
    const { vfx, tick } = setup();
    const before = bufferFingerprint(vfx);
    for (let k = 0; k < 3; k++) {
      tick(16.7, [fakeEvents.phase({ phase: "round_intro" })]);
      tick(16.7, [fakeEvents.strike({ magnitude: 1, crit: true, lethal: true }), fakeEvents.ko({ victim: k % 2 ? "atlas" : "blaze" })]);
      for (let i = 0; i < 80; i++) tick(16.7);
    }
    tick(16.7, [fakeEvents.matchEnd({ winner: "atlas" }), fakeEvents.core({ stage: "lock", seat: "atlas" })]);
    for (let i = 0; i < 10; i++) tick(16.7);
    const s = vfx.stats();
    assert.ok(s.confetti.active > 0 && s.confetti.active <= CONFETTI_POOL);
    assert.ok(s.prizeCubes.active > 0 && s.prizeCubes.active <= PRIZE_CUBE_POOL);
    const after = bufferFingerprint(vfx);
    for (let i = 0; i < before.length; i++) assert.equal(after[i][1], before[i][1], before[i][0]);
  });

  test("a strike storm recycles the oldest sparks instead of growing", () => {
    const { vfx, tick } = setup();
    const storm = [];
    for (let i = 0; i < 40; i++) storm.push(fakeEvents.strike({ magnitude: 1, crit: true }));
    tick(16.7, storm);
    const s = vfx.stats();
    assert.equal(s.sparks.active, SPARK_POOL);
    assert.ok(s.sparks.recycled > 0);
  });

  test("hit stop freezes the particle clock", () => {
    const { vfx, tick, clock } = setup();
    tick(16.7);
    const t0 = vfx.nowS;
    clock.requestHitstop(100);
    tick(16.7);
    assert.equal(vfx.nowS, t0, "frozen during hit stop");
  });

  test("scuffs only land under 2 cm and are wiped by the round re-render", () => {
    const { vfx, tick } = setup();
    tick(16.7, [fakeEvents.strike({ magnitude: 0.8, pos: [0, 0, 0.01] }), fakeEvents.strike({ magnitude: 0.8, pos: [0, 0, 0.1] })]);
    assert.equal(vfx.decals.count, 1);
    tick(16.7, [fakeEvents.phase({ phase: "round_intro" })]);
    assert.equal(vfx.decals.count, 0);
    assert.ok(vfx.scanRenderY < 100, "re-render scan running");
  });

  test("strike to a side flashes that side's LED strip for 120 ms", () => {
    const { vfx, tick } = setup();
    tick(16.7, [fakeEvents.strike({ victim: "blaze", magnitude: 0.6 })]);
    const now = 1000 + 16.7 + 20;
    assert.ok(vfx.cues.ledFlash("blaze", now) > 0.7);
    assert.equal(vfx.cues.ledFlash("atlas", now), 0);
    assert.equal(vfx.cues.ledFlash("blaze", now + 130), 0);
  });

  test("ring pool recycles and counts", () => {
    const p = createRingPool(4);
    for (let i = 0; i < 6; i++) p.alloc(0, 1);
    assert.equal(p.active(0.5), 4);
    assert.equal(p.recycled, 2);
    assert.equal(p.active(2), 0);
  });

  test("lock-in ticks speed up under 3 s and 1 s", () => {
    assert.equal(lockTickInterval(6), 1);
    assert.equal(lockTickInterval(2.5), 0.5);
    assert.equal(lockTickInterval(0.5), 0.25);
  });

  test("core beam: incoming fades in over 400 ms, drop flares 60 ms then is gone by 700 ms", () => {
    const e = { alpha: 0, radius: 0, ring: 0, ringHz: 0, flare: 0 };
    assert.equal(coreBeamEnvelope(0, -1, -1, e).alpha, 0, "idle");
    const half = coreBeamEnvelope(1000 + BEAM_FADE_IN_MS / 2, 1000, -1, e).alpha;
    const full = coreBeamEnvelope(1000 + BEAM_FADE_IN_MS, 1000, -1, e).alpha;
    assert.ok(half > 0 && half < full, `fade in ${half} < ${full}`);
    const early = coreBeamEnvelope(1000 + 500, 1000, -1, e).ringHz;
    const late = coreBeamEnvelope(1000 + 2900, 1000, -1, e).ringHz;
    assert.ok(late > early, "ring pulses faster as the drop nears");
    assert.equal(coreBeamEnvelope(1000 + BEAM_INCOMING_MAX_MS, 1000, -1, e).alpha, 0, "a drop that never comes times out");
    const flare = coreBeamEnvelope(4000 + BEAM_FLARE_HOLD_MS - 1, 1000, 4000, e);
    assert.equal(flare.flare, 1);
    assert.ok(flare.alpha > full && flare.radius > coreBeamEnvelope(1000 + 1000, 1000, -1, { ...e }).radius, "drop flares brighter and wider");
    assert.ok(coreBeamEnvelope(4000 + BEAM_FLARE_MS / 2, 1000, 4000, e).alpha < 0.5);
    assert.equal(coreBeamEnvelope(4000 + BEAM_FLARE_MS, 1000, 4000, e).alpha, 0);
    assert.ok(coreBeamEnvelope(9000 + 800, 9000, 4000, e).alpha > 0, "a newer incoming (sudden death) telegraphs again");
  });

  test("core beam stays out of the cockpit sightline and never blooms (playtest: white slab at DROP)", () => {
    const beam = createCoreBeam();
    assert.ok(BEAM_FLOOR_M >= COCKPIT_EYE_EGO[2] + 0.15, `column starts ${BEAM_FLOOR_M} m up, eye at ${COCKPIT_EYE_EGO[2]} m`);
    assert.equal(beam.column.material.uniforms.uFloor.value > 0.3, true, "shader cutoff wired");
    assert.equal(beam.column.material.blending, NormalBlending);
    assert.equal(beam.ring.material.blending, NormalBlending);
    beam.dispose();
  });

  test("the Core lands with a shockwave the frame it touches the mat, not before", () => {
    const { vfx, tick, frame } = setup();
    const ci = CORE_CUBE_INDEX * 3;
    frame.cubes.pos[ci] = 2.4; frame.cubes.pos[ci + 1] = 0; frame.cubes.pos[ci + 2] = 0.02;   // parked
    tick(16.7, [fakeEvents.core({ stage: "incoming" })]);
    for (let i = 0; i < 30; i++) tick(16.7);
    assert.ok(vfx.coreBeam.column.visible, "column telegraphs the drop point");
    assert.equal(vfx.coreBeam.column.position.x, 0);
    frame.cubes.pos[ci] = 0.03; frame.cubes.pos[ci + 2] = 0.22;
    tick(16.7, [fakeEvents.core({ stage: "drop" })]);
    assert.equal(vfx.coreBeam.envelope.flare, 1, "drop flares");
    assert.equal(vfx.coreBeam.column.position.x, 0.03, "beam follows the biased drop point");
    const falling = vfx.stats().bursts.active;
    frame.cubes.pos[ci + 2] = 0.1;
    tick(16.7);
    assert.ok(vfx.stats().bursts.active <= falling, "no landing burst mid-air");
    frame.cubes.pos[ci + 2] = 0.021;
    tick(16.7);
    assert.ok(vfx.stats().bursts.active > falling, "landing shockwave");
    assert.ok(vfx.hitLight.intensity > 0 || vfx.stats().bursts.active > 0);
    for (let i = 0; i < 60; i++) tick(16.7);
    assert.equal(vfx.coreBeam.column.visible, false, "column gone after the flare");
  });

  test("ENGAGE slams the stage lights on; resuming from pause does not", () => {
    const { vfx, tick } = setup();
    tick(16.7, [fakeEvents.phase({ phase: "round_intro" })]);
    const bursts0 = vfx.stats().bursts.active;
    tick(16.7, [fakeEvents.phase({ phase: "fight" })]);
    const at = 1000 + 2 * 16.7;
    assert.equal(vfx.cues.slam(at + SLAM_HOLD_MS - 1), 1);
    assert.ok(vfx.cues.slam(at + 300) > 0 && vfx.cues.slam(at + 300) < 1);
    assert.equal(vfx.cues.slam(at + SLAM_MS), 0);
    assert.ok(vfx.cues.ledFlash("atlas", at + 20) > 0 && vfx.cues.ledFlash("blaze", at + 20) > 0, "both edges flash");
    assert.ok(vfx.hitLight.intensity > 1, "overhead punch");
    assert.equal(vfx.stats().bursts.active, bursts0 + 2, "deck-wide ring");
    for (let i = 0; i < 60; i++) tick(16.7);
    assert.equal(vfx.hitLight.intensity, 0);
    tick(16.7, [fakeEvents.phase({ phase: "paused" })]);
    tick(16.7, [fakeEvents.phase({ phase: "fight" })]);
    assert.equal(vfx.cues.slam(1000 + 64 * 16.7 + 10), 0, "unpause is quiet");
  });

  test("heavy strikes throw debris, light ones do not", () => {
    const light = setup();
    light.tick(16.7, [fakeEvents.strike({ magnitude: 0.3, crit: false })]);
    assert.equal(light.vfx.stats().chips.active, 0);
    const heavy = setup();
    heavy.tick(16.7, [fakeEvents.strike({ magnitude: 0.8, crit: false })]);
    assert.ok(heavy.vfx.stats().chips.active >= 2);
    const crit = setup();
    crit.tick(16.7, [fakeEvents.strike({ magnitude: 0.8, crit: true })]);
    assert.ok(crit.vfx.stats().chips.active > heavy.vfx.stats().chips.active);
  });

  test("impacts scale with strength: heavy hits arc, flare and ring the deck; light hits do not", () => {
    const light = setup();
    light.tick(16.7, [fakeEvents.strike({ magnitude: 0.2, crit: false })]);
    const heavy = setup();
    heavy.tick(16.7, [fakeEvents.strike({ magnitude: 0.8, crit: false })]);
    const crit = setup();
    crit.tick(16.7, [fakeEvents.strike({ magnitude: 0.8, crit: true })]);
    assert.equal(light.vfx.stats().arcs.active, 0, "no arcs on a light hit");
    assert.ok(heavy.vfx.stats().arcs.active >= 2, "heavy hit arcs down the victim's arm");
    assert.ok(crit.vfx.stats().arcs.active > heavy.vfx.stats().arcs.active, "crits arc more");
    assert.ok(heavy.vfx.stats().bursts.active > light.vfx.stats().bursts.active + 2, "star, deck ring, attacker ring");
    assert.ok(heavy.vfx.stats().sparks.active > light.vfx.stats().sparks.active);
    light.tick(10); heavy.tick(10);
    assert.ok(heavy.vfx.hitLight.intensity > light.vfx.hitLight.intensity, "hit light scales with the hit");
  });

  test("clashes crackle with arcs between the grippers; deflects burst a blue ring", () => {
    const { vfx, tick } = setup();
    tick(16.7, [fakeEvents.clash({})]);
    assert.ok(vfx.stats().arcs.active >= 3);
    const d = setup();
    d.tick(16.7, [fakeEvents.deflect({})]);
    assert.ok(d.vfx.stats().bursts.active >= 4, "chevrons, ring, flash, glow");
    assert.ok(d.vfx.stats().sparks.active >= 10);
  });

  test("the KO: white flash, slow motion, arcs, then a shatter at settle; confetti cannons only when it won the match", () => {
    const { vfx, tick } = setup();
    tick(16.7);
    tick(16.7, [fakeEvents.ko({ victim: "blaze" })]);
    assert.ok(vfx.koFlash > 0.8, `white flash ${vfx.koFlash}`);
    assert.ok(vfx.stats().arcs.active >= 4, "the loser shorts out");
    tick(16.7);
    assert.ok(vfx.hitLight.intensity > 3, "KO light punch");
    const t0 = vfx.nowS;
    tick(100);
    assert.ok(vfx.nowS - t0 < 0.05, "slow-motion window on the VFX clock");
    assert.equal(vfx.stats().confetti.active, 0, "no confetti before the arm settles");
    tick(16.7, [fakeEvents.matchEnd({ winner: "atlas" })]);   // the director declares the match once the KO resolves
    const burst = vfx.stats().confetti.active;
    assert.ok(burst > 0 && burst <= 240, "the pilot's win bursts confetti at the camera");
    const ticks = Math.ceil(SETTLE_MAX_MS / 16.7) + 2;
    for (let i = 0; i < ticks; i++) tick(16.7);
    // Burst 240 + four cannons of 48 exceed the 300 pool: the ring has to recycle, which the burst alone never causes.
    assert.ok(vfx.confetti.pool.recycled >= 4 * Math.round(240 * 0.2) - (CONFETTI_POOL - 240), "four cannons fired at settle");
    assert.ok(vfx.stats().prizeCubes.active > 0, "team-colour shatter");
    for (let i = 0; i < 200; i++) tick(16.7);
    assert.equal(vfx.koFlash, 0);
    const t1 = vfx.nowS;
    tick(100);
    assert.ok(Math.abs(vfx.nowS - t1 - 0.1) < 1e-9, "full speed after the window");
  });

  test("a round KO shatters without confetti; the AI winning the match gets no cannons either", () => {
    const round = setup();
    round.tick(16.7, [fakeEvents.ko({ victim: "blaze" })]);
    for (let i = 0; i < Math.ceil(SETTLE_MAX_MS / 16.7) + 4; i++) round.tick(16.7);
    assert.ok(round.vfx.stats().prizeCubes.active > 0, "the shatter still happens");
    assert.equal(round.vfx.stats().confetti.active, 0, "no confetti on a round KO");
    const loss = setup();
    loss.tick(16.7, [fakeEvents.ko({ victim: "atlas", attacker: "blaze" }), fakeEvents.matchEnd({ winner: "blaze" })]);
    for (let i = 0; i < Math.ceil(SETTLE_MAX_MS / 16.7) + 4; i++) loss.tick(16.7);
    assert.equal(loss.vfx.stats().confetti.active, 0, "the pilot's loss is not a show");
  });

  test("sparks from an m 0.8 hit land on the deck and are still there 10 s later, gone by 12 s", () => {
    const { vfx, tick } = setup();
    tick(16.7, [fakeEvents.strike({ magnitude: 0.8, pos: [0, 0, 0.12], normal: [1, 0, 0] })]);
    for (let i = 0; i < 60; i++) tick(16.7);
    const landed = vfx.sparks.pool.active(vfx.nowS);
    assert.ok(landed >= 1, `${landed} sparks resting on the deck after 1 s`);
    const aLand = vfx.sparks.mesh.geometry.getAttribute("aLand").array;
    let finite = 0;
    for (let i = 0; i < SPARK_POOL; i++) if (aLand[i * 2] < 1e8) finite++;
    assert.ok(finite >= landed, "landed sparks carry a finite landing time");
    for (let i = 0; i < 9 * 60; i++) tick(16.7);
    assert.ok(vfx.sparks.pool.active(vfx.nowS) >= 1, "still on the deck 10 s later");
    for (let i = 0; i < 2 * 60; i++) tick(16.7);
    assert.equal(vfx.sparks.pool.active(vfx.nowS), 0, "cooled away by 12 s");
    assert.ok(landingTime(0.1, 0) > 0.14 && landingTime(0.1, 0) < 0.15);
    assert.equal(landingTime(-0.01, 1), Infinity);
  });

  test("every pool is Prewarmable: prewarmDraw leaves each mesh visible with something to draw, and nothing allocates", () => {
    const { vfx, tick } = setup();
    const before = bufferFingerprint(vfx);
    vfx.prewarmDraw();
    for (const m of [vfx.sparks.mesh, vfx.bursts.mesh, vfx.arcs.mesh, vfx.ripples.mesh, vfx.chips.mesh, vfx.confetti.mesh, vfx.decals.mesh,
      vfx.smears.mesh, vfx.lockPulse.mesh, vfx.scan.mesh, vfx.coreBeam.column, vfx.coreBeam.ring, vfx.coreFace.mesh, vfx.prize.cubes.mesh]) {
      assert.equal(m.visible, true, m.name);
    }
    assert.ok(vfx.sparks.pool.active(0) >= 1 && vfx.bursts.pool.active(0) >= 1 && vfx.arcs.pool.active(0) >= 1);
    assert.ok(vfx.hitLight.intensity > 0);
    assert.ok(vfx.hitLight.layers.isEnabled(5), "hit light on REFLECTION_LAYER");
    const after = bufferFingerprint(vfx);
    for (let i = 0; i < before.length; i++) assert.equal(after[i][1], before[i][1], before[i][0]);
    tick(16.7);
    assert.equal(vfx.decals.count, 1, "the prewarm scuff is a zero-strength slot, cleared with the round");
  });

  test("dock rings draw only while a Core is in play; the Core face counts the lock-in on the cube", () => {
    const { vfx, tick, combat, frame } = setup();
    combat.core.phase = "dormant";
    tick(16.7);
    assert.equal(vfx.lockPulse.mesh.visible, false, "no Core, no ring");
    assert.equal(vfx.coreFace.mesh.visible, false);
    combat.core.phase = "live";
    tick(16.7);
    assert.equal(vfx.lockPulse.mesh.visible, true);
    assert.equal(vfx.coreFace.mesh.visible, false, "unowned: no countdown yet");
    combat.core.owner = "atlas"; combat.core.dockedIn = "atlas"; combat.core.lockInRemainingS = 6.2; combat.core.lockInTotalS = 8;
    frame.cubes.pos[CORE_CUBE_INDEX * 3] = -0.12; frame.cubes.pos[CORE_CUBE_INDEX * 3 + 2] = 0.0205;
    frame.cubes.quat[CORE_CUBE_INDEX * 4] = 1;
    tick(16.7);
    assert.equal(vfx.coreFace.mesh.visible, true);
    assert.equal(vfx.coreFace.mesh.material.uniforms.uMask.value, SEVEN_SEGMENT[7], "6.2 s left shows 7");
    assert.ok(Math.abs(vfx.coreFace.mesh.position.z - 0.0411) < 1e-6, "rides the top face");
    assert.equal(countdownDigit(0.3), 1);
    assert.equal(countdownDigit(0), 0);
    assert.equal(countdownDigit(12), 9);
  });

  test("the low tier throws fewer particles", () => {
    const high = setup();
    high.setTier(300);
    high.tick(16.7);
    high.tick(16.7, [fakeEvents.strike({ magnitude: 1, crit: false })]);
    const low = setup();
    low.setTier(140);
    low.tick(16.7);
    low.tick(16.7, [fakeEvents.strike({ magnitude: 1, crit: false })]);
    assert.ok(low.vfx.stats().sparks.active < high.vfx.stats().sparks.active);
    assert.equal(high.vfx.stats().sparks.active, sparkCount(1, false));
  });

  test("impact light is additive HDR; the Core column stays normal-blended", () => {
    const { vfx } = setup();
    assert.equal(vfx.sparks.mesh.material.blending, AdditiveBlending);
    assert.equal(vfx.bursts.mesh.material.blending, AdditiveBlending);
    assert.equal(vfx.arcs.mesh.material.blending, AdditiveBlending);
  });
});

// The director's real-GPU review, 2026-09-27: two emitters blew out on a real GPU and both had the same
// shape of cause — a number that nothing downstream actually read.
describe("emitters that blew out", () => {
  test("a strike spark is filament-warm and scales with CALIBRATION.emissive.spark, not a literal", () => {
    const pool = createStreakPool(8, "spark-calibration");
    pool.spawn(0, 0, 0, 0.1, 0, 0, 1, 0.3, "hit");
    const [r, g, b] = pool.mesh.geometry.getAttribute("aCore").array;
    // Neutral white is what clips to a colourless disc when twenty coincident streaks add up.
    assert.ok(r > g && g > b, `warm core, not neutral white (${r}, ${g}, ${b})`);
    assert.ok(Math.abs(r - 1.125 * CALIBRATION.emissive.spark) < 1e-4, `hit core tracks the calibration (${r})`);
    pool.dispose();
  });

  test("the contact flash and star are filament-warm multiples of the same calibration", () => {
    // With every contact pool pinned at age 50 ms, hiding the burst pool alone took a frame from 10 220
    // colourless pixels >= 0.95 to zero: this disc is what clips, and the sparks and arcs only clipped on
    // top of it. Re-hardcoding a literal here, or going back to neutral white, puts that blob back.
    const pool = createBurstPool(4);
    pool.spawn(0, "flash", 0, 0, 0.1);
    pool.spawn(0, "star", 0, 0, 0.1);
    const c = pool.mesh.geometry.getAttribute("aColor").array;
    for (const [name, i, gain] of [["flash", 0, 1.5], ["star", 3, 1.125]]) {
      const [r, g, b] = [c[i], c[i + 1], c[i + 2]];
      assert.ok(r > g && g > b, `${name} core is warm, not neutral white (${r}, ${g}, ${b})`);
      assert.ok(Math.abs(r - gain * CALIBRATION.emissive.spark) < 1e-4, `${name} tracks the calibration (${r})`);
    }
    pool.dispose();
  });

  test("the LED bead / flank-strip threshold separates the two families", () => {
    // Servo beads and flank strips share one instanced mesh; the shader clamps a bead's angular size near
    // the eye and must never clamp a strip, and this width is the only thing that tells them apart.
    assert.ok(LED_SIZE_M.x < LED_BEAD_MAX_W_M, `a bead is under the threshold (${LED_SIZE_M.x})`);
    assert.ok(LED_BEAD_MAX_W_M < 0.02, "a strip is over it (stl-geometry.test.mjs pins strips at > 0.02 m long)");
  });
});
