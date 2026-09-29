import assert from "node:assert/strict";
import { test } from "node:test";
import { createPolicyRngShim, realNow } from "../src/game/policy/policy-rng-shim.ts";
import { createInProcessSeatDriver } from "../src/game/policy/in-process-driver.ts";
import { registrationContext } from "../src/game/policy/registration.ts";
import { emptyObservation } from "../src/game/policy/observation.ts";

test("run() swaps Math.random to the seeded generator and restores the host's", () => {
  const hostRandom = Math.random;
  const shim = createPolicyRngShim(42);
  const a = shim.run(() => [Math.random(), Math.random()]);
  assert.equal(Math.random, hostRandom);
  shim.reseed(42);
  const b = shim.run(() => [Math.random(), Math.random()]);
  assert.deepEqual(a, b);
  shim.reseed(43);
  assert.notDeepEqual(shim.run(() => [Math.random(), Math.random()]), a);
});

test("eval clock: Date.now and performance.now read sim time inside run(), real time outside", () => {
  const shim = createPolicyRngShim(1);
  shim.setEvalClock(true);
  shim.setSimTimeMs(1234.5);
  const [d, p] = shim.run(() => [Date.now(), performance.now()]);
  assert.equal(d, 1234);
  assert.equal(p, 1234.5);
  assert.ok(Date.now() > 1_600_000_000_000);
  shim.setEvalClock(false);
  assert.ok(shim.run(() => Date.now()) > 1_600_000_000_000);
  assert.ok(realNow() > 0);
});

test("a module calling Math.random and Date.now is deterministic under the shim in eval", async () => {
  const source = `
    let noise = 0;
    export function reset() { noise = Math.random(); }
    export function act(obs) {
      const r = Math.random() * 0.1 + noise * 0.01;
      const clock = (Date.now() % 1000) / 1e4 + (performance.now() % 1000) / 1e5;
      return [r, clock, 0, 0, 0, 0.04];
    }`;
  const run = async () => {
    const drv = await createInProcessSeatDriver({ kind: "module", fileName: "noisy.mjs", source, sha256: "x" }, "blaze", {});
    await drv.reset(registrationContext("blaze", 99));
    const out = [];
    for (let i = 0; i < 50; i++) {
      const obs = emptyObservation("blaze");
      obs.t = i * 0.04;
      drv.request(obs, i);
      out.push((await drv.waitForResult(1000)).action.targets);
    }
    drv.dispose();
    return out;
  };
  const first = await run();
  await new Promise((r) => setTimeout(r, 15));
  const second = await run();
  assert.deepEqual(first, second);
  assert.ok(first.some((t) => t[0] !== first[0][0]), "the module really is random");
});
