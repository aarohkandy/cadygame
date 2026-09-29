# Combat design: a first-person physics duel between two SO-101 arms

> Track: combat mechanics and controls. Companion docs: `finals-feel.md` (feedback, match flow,
> broadcast), `finals-visual.md` (style guide), `codebase.md` (current code map).
> We borrow structure and feel from THE FINALS. We use none of its names, sponsors, characters,
> announcer lines, audio, textures or fonts. All names below are original.

Everything tagged **[measured]** comes from running the repo's own MuJoCo 3.12 WASM build
(`@mujoco/mujoco`, the same `arena.xml` + `so101.xml` the game loads) headless in Node. The
method is in Appendix A. Everything tagged **[spec]** is a design decision with its reasoning.
Claims about THE FINALS cite a URL in §16.

---

## 0. TL;DR

1. **The servo is a torque-limited bang-bang controller, not a soft spring.** With kp = 998 N·m/rad
   and a 2.94 N·m limit, the servo saturates once the error passes **2.9 mrad (0.17°)**. So any
   meaningful command runs the joint at full torque. What feels "floaty" today is the input layer:
   task-space targets move at 0.28 m/s, and the arm could do about **1.7 m/s** at the tip.
   **[measured]**
2. **Flicks are the strikes.** A raw, unsmoothed mouse flick on shoulder_pan hits the opponent's
   gripper at **1.56 m/s at stock torque** and **2.72 m/s at 2× torque**. It arrives 200 ms or
   125 ms after the flick, and the arm is still near full speed at contact. No scripted swing
   animation is needed. **[measured]**
3. **Damage must come from the relative normal approach speed at contact onset.** Don't use
   `efc_force`. Peak solver force jumped from 35 N to 615 N between near-identical swings, and it
   correlates only r ≈ 0.65 with approach speed. **[measured]**
4. **The current classifier has three real bugs:**
   - It attributes the hit using speeds from the peak-force substep, which can come after the
     impulse. A hit on a limp victim got credited to the victim.
   - It compares speed magnitudes, not velocities along the contact normal.
   - Its 0.08 m/s threshold makes about 90% of all arm contacts "strikes".

   **[measured]**
5. **Win condition:** a round ends on a KO (Integrity 100 → 0) or a Core cash-in (the Dock
   objective from `finals-feel.md`). Docks go at x = ±0.17 m with radius 0.06 m. The opponent can
   only reach the rim of your Dock, and only by extending fully, so a steal is a committed lunge
   that leaves the stealer open to punishment.
6. **Damage [spec]:** `20 · clamp((ν − 0.2)/0.4, 0, 1.75)^1.2`, then multiplied by the zone,
   loadout and state multipliers, capped at 45.
   - `ν` is approach speed divided by the attacker's theoretical top tip speed, `τmax/b · 0.36 m`.
   - That normalization makes damage mean the same thing at stock and boosted torque.
   - A full hook does about 31, a short flick about 19, a lazy swing about 10, and a shove 0.
7. **Defence:**
   - Hold Guard: incoming damage ×0.2, and your heat goes up.
   - **Deflect** (parry): press Guard 150 ms before to 30 ms after contact onset. The hit does 0
     and stuns the attacker for 650 ms.
   - **Clash:** two strikes of similar ν cancel out.

   Flicks arrive in 70–125 ms, faster than a person can react, so deflecting them takes a read.
   Charged heavies can be deflected on reaction.
8. **Heat** is our stamina, and it is physical: heat rate = `120 · mean((τ/τmax)²) − 5` per second.
   - One hook every 1.5 s is heat-neutral.
   - A flick every 250 ms overheats in about 5.7 s.
   - A shoving stalemate overheats in about 3 s.
   - Overheat triggers **Thermal Cutout**: torque ×0.35 for 2 s.

   **[measured Q values]**
9. **Stagger, stun and KO are servo profiles.** They change `forcerange`, kp and kv at runtime.
   Stagger and stun make the arm slow and pushable. **Offline** (torque ×0.05) visibly droops
   7–10 cm under gravity within 1 s. Anything above ×0.15 torque does not droop. **[measured]**
10. **Loadouts** are torque, damping and armature profiles, one per light/medium/heavy archetype.
    They're called Whip, Pivot and Anvil, and each gets one signature ability: Snap, Recoil Coil
    and Bulwark.
11. **Controls:**
    - The mouse aims the gripper in *shoulder-spherical* coordinates. Mouse X maps directly to
      shoulder_pan, so a flick is literally a pan step.
    - The camera is an over-the-right-shoulder cockpit anchored to the fixed base. It softly
      follows aim, never the physical pan, which reaches 5–10 rad/s.
    - Your own arm is the viewmodel. A ghost shows the commanded pose.
12. **Torque:** Arcade runs at **2× torque** (5.88 N·m), with class range 1.7–2.6×. We tested 3×:
    it caused solver spikes, and the tip reached 4–6 m/s against 1–6 mm thick jaw collision
    boxes. Don't boost kp, because it does nothing above 3 mrad. **Harness** mode keeps stock
    Menagerie gains, never changes the model, and only overlays scoring.

---

## 1. What the physics actually allows

### 1.1 Actuators

From `public/models/robotstudio_so101/so101.xml`:

| Parameter | Value | Consequence |
|---|---|---|
| `position kp` | 998.22 N·m/rad | linear (unsaturated) band = τmax/kp = **2.9 mrad** |
| `kv` | 2.731 N·m·s/rad | at 4.8 rad/s the kv term (13 N·m) dwarfs τmax, so braking starts only about kv·ω/kp ≈ 13 mrad before the target |
| `forcerange` | ±2.94 N·m | = 30 kg·cm, the STS3215 12 V stall torque (§16) |
| joint `damping` | 0.60 N·m·s/rad | sets terminal speed ω_t ≈ τmax/b = **4.9 rad/s** |
| `armature` | 0.028 kg·m² | reflected rotor inertia; dominates distal-link inertia |
| timestep | 5 ms, implicitfast, elliptic cones, impratio 10 | `step(…, 4)` per 16 ms tick, so sim runs **1.25× wall time** today |

The sim's terminal speed of 4.9 rad/s matches the real servo's rated no-load speed of
0.222 s/60° ≈ **4.7 rad/s** (§16). The Menagerie gains are honest, so **stock = realistic** is a
defensible basis for Harness mode.

### 1.2 Step responses (joint command step, stock vs boosted) [measured]

| Profile | Joint, Δ | Peak q̇ (rad/s) | Peak tip speed (m/s) | t to 90% |
|---|---|---|---|---|
| stock | pan, 1.2 rad | 4.78 | 1.29 | 285 ms |
| stock | elbow, −0.9 | 4.04 | 1.15 | 265 ms |
| stock | wrist_flex, 1.2 | 4.94 | 0.79 | 265 ms |
| **2× τ** | pan, 1.2 | 9.20 | 2.48 | 170 ms |
| 2× τ | elbow, −0.9 | 8.18 | 2.33 | 150 ms |
| 3× τ, 1.5× kp | pan, 1.2 | 13.0 | 3.51 | 130 ms |
| stun (τ×0.35, kp×0.15) | pan, 1.2 | 1.63 | 0.44 | 725 ms |

A long pan sweep reaches **1.72 m/s** tip speed at stock and **3.28 m/s** at 2×. The predicted
`v_tip_max = τmax/b · r` with r = 0.36 m gives 1.76 and 3.53, a close fit. §4 uses this.

**Leash test [measured]:** we clamped the command to within L of the measured angle, for
L ∈ {0.05, 0.15, 0.3, 0.6, ∞}. Peak tip speed was identical in every case (1.72 and 3.28 m/s),
because the servo saturates past 3 mrad. So a leash costs no speed. Overshoot after a full-speed
stop was 0.09 rad at stock and 0.18 rad at 2×, with 465–565 ms to settle. **The arm follows
through by itself.** Extra overshoot added in software is unnecessary for yaw strikes.

### 1.3 Reach and hurtboxes [measured]

- Mount bases are 0.64 m apart. The Atlas shoulder is at (−0.281, 0, 0.062), and the Blaze
  gripper rests at (0.109, 0, 0.17).
- Maximum forward reach of the gripperframe is x ≈ **+0.16 m** at z = 0.10–0.20, and **+0.152 m**
  at cube height (z = 0.03). That's about 0.44 m from the shoulder. `codebase.md` independently
  found +0.149.
- The opponent's upper arm and shoulder are **out of reach** (Blaze's elbow sits at x = 0.293).
  Over 600 random swings, the links that actually got struck were:

  | Victim link | Stock | 2× |
  |---|---|---|
  | gripper (fixed jaw) | 315 | 238 |
  | camera_mount | 161 | 103 |
  | moving jaw | 150 | 125 |
  | wrist | 43 | 51 |
  | lower_arm | 0 | 9 |

  **The fight happens between the hands.** Zones should split the distal chain finely rather
  than weight the whole robot (§4.3).

### 1.4 Swings against a stationary opponent (Blaze at START_POSE) [measured]

"Hook" = pan sweep −0.7 → +0.7 rad with lift = 0.14 and elbow = 0.14, which puts the tip at
x = 0.08, z = 0.16 at pan 0. The victim's contact-point speed at onset was 0 in every row.

| Swing | Profile | Contact after | Attacker speed at onset | Peak efc force | Result today |
|---|---|---|---|---|---|
| hook, instant command | stock | 200 ms | 1.56 m/s | 35 N | strike |
| hook, command ramped over 300 ms | stock | 200 ms | 1.56 | 35 | strike |
| hook, command ramped over 1 s | stock | 445 ms | 0.49 | 29 | strike (!) |
| hook, instant | 2× | 125 ms | 2.72 | 58 | strike |
| hook, instant | 3× | 100 ms | 3.10 | **615** | strike |
| short hook, 0.3 rad wind-up | stock | 105 ms | 1.24 | 105 | strike |
| short hook, 0.3 rad wind-up | 2× | **70 ms** | 2.04 | 351 | strike |
| hook into a **limp** victim (τ×0.2) | stock | 205 ms | 1.32 | 339 | **"STRIKE blaze"** (wrong) |
| hook into a limp victim | 2× | 130 ms | 2.72 | 575 | **"STRIKE blaze"** (wrong) |
| slow push, 1.5 s ramp | stock | n/a | n/a | n/a | miss (target out of path) |

Takeaways:

- Ramping the command faster than about 150 ms is invisible at stock torque, because the servo
  is the rate limiter.
- Peak force is **not monotonic** in speed. The short hook at 1.24 m/s produced 3× the force of the
  full hook at 1.56 m/s. It depends on which thin collision boxes interpenetrate in a 5 ms step.
- In the limp-victim rows, the victim's post-impact contact point moves faster than the
  attacker's. The current classifier reads speeds from the peak-force substep, which comes after
  the impulse, so it credits the victim.

### 1.5 Random-contact distribution (600 random swings, 5 ramp speeds) [measured]

Relative normal approach speed `v_n` at contact onset (m/s):

| Profile | p10 | p50 | p75 | p90 | p99 | max |
|---|---|---|---|---|---|---|
| stock | 0.07 | 0.18 | 0.31 | 0.81 | 1.80 | 2.53 |
| 2× τ | 0.16 | 0.35 | 0.62 | 1.51 | 2.81 | 4.48 |

Most contacts are grazes and shoves. Only the top ~15% are real strikes. With commands ramped over
800 ms, p90 is only 0.34 m/s at stock (0.58 at 2×). A slow, deliberate press is a shove, which
is the separation we want. Pearson r(v_n, peak efc force) = 0.69 at stock and 0.63 at 2×, with a
p99 force of 314–454 N. That's too noisy to scale damage by.

### 1.6 Servo load under typical behaviours [measured]

`Q = mean over 5 arm joints of (τ/τmax)²`, averaged over 3 s:

| Behaviour | Q stock | Q 2× |
|---|---|---|
| idle hold | 0.007 | 0.002 |
| tracking jitter ±0.1 rad | 0.027 | 0.007 |
| one full hook every 1.5 s | 0.056 | 0.035 |
| flick back and forth every 250 ms | 0.198 | 0.188 |
| flick every 125 ms | 0.206 | 0.195 |
| pushing stalemate against opponent | 0.336 | 0.331 |

Copper loss scales with current², and current scales with torque, so `Q` is a physically honest
heat proxy. It also separates rhythm from spam by about 5×.

### 1.7 Reduced-gain profiles held against gravity for 1.5 s [measured]

Gravity torque on shoulder_lift ranges from 0.28 N·m (START_POSE) to 0.88 N·m (extended).

| Profile | Tip droop, guard pose | Tip droop, extended pose |
|---|---|---|
| τ×0.5, kp×0.25 ("stagger") | 0.1 cm | 0.2 cm |
| τ×0.3, kp×0.1 ("stun") | 0.2 cm | 0.4 cm |
| τ×0.15, kp×0.05 | 0.5 cm | 10.0 cm |
| τ×0.05, kp×0.02 ("offline") | 9.7 cm | 10.1 cm |

Stagger and stun don't *look* limp. They make the arm slow (see the 725 ms stun step response)
and easy to push (victim joint displacement went 0.04 rad → 0.36 rad under the same stock hook).
Only an Offline-level cut drops the arm visibly, so the KO state is the only one that droops.

---

## 2. Fixes the existing classifier needs (`src/lib/mujoco-engine.ts`)

1. **Detect contact onset per geom pair.**
   - Keep a `Set` of active `(geom1, geom2)` keys from the previous substep. A key that wasn't
     active last substep is an onset.
   - Merge gaps under 30 ms: the jab in §1.4 produced 2–10 separate "events" in 200 ms of chatter.
   - The global `eventId` today increments only on the arm-contact rising edge across *all*
     pairs.
2. **Read velocities at onset.** After `mj_step`, `data.contact` and `data.cvel` both describe the
   **pre-integration** state, so they're consistent and pre-impulse. This matches the measured
   onset speeds, where the victim was 0.00 on every stationary target. Compute point *velocity
   vectors* (the existing `contactPointSpeed` math without the `hypot`), then:
   - `n` = `contact.frame[0..2]`, the normal from geom1 to geom2
   - `a_n = max(0, v_A·n̂_A→B)` and `b_n = max(0, v_B·n̂_B→A)`, each side's speed toward the other
   - `v_n = |(v_A − v_B)·n|`, the relative approach speed
3. **Stop using force for severity.** Keep only `efc_force > 0.3 N` as a gate that confirms real
   contact. `impulse = force × timestep` is per-substep and meaningless across an event. Delete
   it or integrate over the first 40 ms, for telemetry only.
4. **Use a single attribution rule** (see §5.3 for clashes). The attacker is the side with the
   larger normalized approach `a_n / v_tip_max(side)`, evaluated at onset only.
5. **Run the loop on sim time.** The 16 ms `setInterval` stepping 20 ms of sim makes everything
   run 1.25× fast and makes rules depend on wall time. The rules module below runs inside the
   substep loop and reads `data.time`.

---

## 3. Win condition and round structure

### 3.1 Options considered

| Option | Verdict | Why |
|---|---|---|
| Health only (KO) | Needed, not enough | Two bolted arms that can only reach each other's hands converge on mutual turtling. Both sides hover at centre in Guard. An AI policy will find that optimum fast. |
| Knock-offs / ring-outs | **Rejected** | The bases are welded to the world. A "knock-off" would need the arm to fall or the base to be freed, which breaks "the robots are SO-101 arms" and the policy-verification use. |
| Knock-offs of *cubes* (push the opponent's cubes off the table) | Rejected as the primary goal | Readable, but uses the tabletop edge, which is out of both reach envelopes (±0.16 m). |
| **Core objective (cash-out analogue)** | **Adopt** | Forces approach and commitment. It mirrors the loop from THE FINALS: a deposit starts a timed cashout that the other side can contest, and the stealer is locked into the interaction and can't fight back while stealing (§16 [F1][F2]). Our version: a steal needs a full-extension lunge. It also measures a second policy skill, manipulation, alongside contact fighting. |
| Points per strike (no health) | Rejected | Rewards chip spam, and has no comeback or KO spike. |

### 3.2 Decision [spec]

This matches `finals-feel.md` §3.1–3.3, with the changes marked "Δ":

- Each robot has **Integrity**: 100 by default, varying by loadout (§8).
- **A KO wins the round immediately.** The loser goes **Offline**, drooping visibly (§7).
- The **Core** is the centre cube (`cube_4`), tinted emissive. It spawns (activates) 15 s into the
  round, and cubes stay in the scene as clutter and light projectiles.
- **Dock:** Δ move from today's `atlas_zone`/`blaze_zone` (±0.18, r 0.11) to **x = ±0.17 m,
  r = 0.06 m**. Today the opponent can reach about 8 cm into your 22 cm zone. With the smaller
  Dock they reach only the outer ~4 cm rim, and only at ≥ 95% extension.
  - **[measured]** The owner's gripperframe reaches the Dock centre (−0.17, 0, 0.03) to within
    1 mm (pan 0, lift −1.11, elbow 1.19, wrist 1.35). The opponent's minimum x at cube height is
    −0.152, so they reach **4.2 cm** into the rim.
  - That lunge takes the opponent **480 ms at stock and 235 ms at 2×** from START_POSE. That's
    long and readable enough for the defender to hook the extended hand.
  - Keep this as a regression test (§14.3).
  - Stealing therefore means extending fully, which fixes the stealer's pose, leaves no room to
    guard, and puts the attacking hand inside the defender's easiest hook arc.
- **Lock-in:** the Core rests in your Dock (≥ 250 ms, speed < 0.05 m/s) → an 8 s countdown.
  - If the Core leaves the Dock, the countdown pauses but keeps its progress.
  - If it lands in the opponent's Dock, they inherit the remaining time (a steal).
  - Δ **Scrub:** while the opponent's gripper touches the Core inside your Dock, your countdown
    *drains* at 0.5 s per second. This rewards the lunge even if they can't drag it out, and
    matches the "defend the station" pressure.
- **Round length: 45 s.** Δ `finals-feel.md` proposes 40 s; we allow a little extra because the
  Core spawns at +15 s. Timeout → higher Integrity wins; within 5 → Sudden Death (as in
  `finals-feel.md`). **Best of 3.**
- **Time-to-kill target:** 4–7 clean strikes, or 3 charged crits. From §4, a full hook ≈ 31, so
  about 3–4 full hooks or 5–6 short flicks. With rest periods at heat-neutral rhythm (one heavy
  per ~1.5 s), a no-defence KO takes ~6–9 s. Guarding and deflects stretch real exchanges to the
  20–35 s range. **Playtest metric:** median round 25–35 s, with a KO share between 45% and 70%.
  If the KO share falls below 45%, cut Integrity 10%. If it goes above 70%, raise chip-to-guard.

---

## 4. Damage model [spec]

### 4.1 Per-event evaluation

For each onset event between an attacker link and a victim link (after attribution, §5.3):

```
v_ref   = tauMax_base(attacker) / jointDamping(attacker) * 0.36        // m/s; stock 1.76, 2x 3.53
nu      = v_n / v_ref                                                   // normalized approach speed
raw     = 20 * pow(clamp((nu - 0.20) / 0.40, 0, 1.75), 1.2)             // 0 .. 39
dmg     = min(45, raw * zone(victimLink) * tool(attackerLink) * loadoutDmg(attacker)
                     * heavy(chargeLevel) * state(victim))
```

- `v_ref` uses the attacker's **base** loadout profile, never the currently throttled one.
  Otherwise an overheated or boosted arm would change its own yardstick. Normalizing makes the
  same swing *intent* score the same in Harness (stock) and Arcade (boosted), so policy results
  are comparable across modes.
- Below ν = 0.2 an event is a **Contact** (a shove): no damage, no hit-marker, and a soft
  "thunk" only.
- **Lockout:** each attacker does damage at most once per **220 ms** (any link pair). A second
  onset inside the window, from chatter, can only raise that hit's damage to the higher value;
  it never adds a second hit.

Reference table (zone and tool ×1.0):

| ν | raw | Example (measured onset speeds) |
|---|---|---|
| < 0.20 | 0 | 2× p50 random contact (0.35 m/s → ν 0.10) |
| 0.30 | 3.7 | glancing nudge |
| 0.43 | 10 | 2× p90 random contact (1.51 m/s); stock hook with a 1 s ramp scores 0 (ν 0.28 → 2.3) |
| 0.58 | 19 | short 0.3 rad flick at 2× (2.04 m/s) |
| 0.77 | 31 | full 1.4 rad hook at 2× (2.72 m/s); stock full hook 1.56 m/s → ν 0.89 → 36 |
| ≥ 0.90 | 39 (cap of the curve) | charged heavy with torque boost |

Stock and 2× give similar numbers for "a full hook" (36 vs 31). That's the point of normalizing.

### 4.2 Multipliers

| Factor | Values |
|---|---|
| `zone(victimLink)` | `camera_mount` **Optics ×1.5 (CRIT)** · `moving_jaw` Jaw ×1.1 · `gripper` Hand ×1.0 · `wrist` ×0.8 · `lower_arm` ×0.7 · `upper_arm`/`shoulder`/`base` ×0.5 (practically unreachable, §1.3) |
| `tool(attackerLink)` | jaw, gripper or camera_mount ×1.0 · wrist ×0.85 · lower_arm ×0.7 (forearm bash) |
| `loadoutDmg` | Whip 0.85 · Pivot 1.0 · Anvil 1.2 |
| `heavy(c)` | 1 + 0.3·c for strikes released from a charge c ∈ [0, 1] (§9.4) |
| `state(victim)` | Overheated ×1.25 · Staggered ×0.8 (combo decay) · Guard ×0.2 · Deflect ×0 · Offline n/a |

Δ versus `finals-feel.md` §3.1:

- **Hit energy:** replace `e = peakForce · speed` with ν, per §1.4–1.5.
- **Optics zone:** we make only `camera_mount` the ×1.5 zone, instead of the whole gripper and
  jaw. Across the 600 random swings, gripper + jaw took ~70% of contacts. Making all of that crit
  would crit almost every hit, and the ×1.5 would stop meaning anything. The camera mount is also
  literally the robot's eye.

### 4.3 Non-arm damage

- **Thrown cubes:** a cube (not the Core) that hits an arm deals the same formula × 0.5 with no
  stagger. The attacker is the last arm whose gripper touched it within 1.0 s. `v_ref` is the
  thrower's.
- **Self-hits:** hits from a cube you knocked yourself deal no damage.
- **The Core** never does damage. It is valuable, not a weapon.

---

## 5. Guard, Deflect and Clash [spec]

### 5.1 Guard (hold)

- **Pose:** the command blends 60% toward a *guard line*: the point on the segment from your
  shoulder to the opponent's gripperframe at r = 0.24 m. The jaws close and wrist_flex tips up
  0.4 rad, so the hand becomes a shield in front of your hurtbox. The mouse still steers the other
  40%.
- **Servo:**
  - Arcade: τ×1.4 and kv×2, so the guard resists knockback.
  - Command yaw rate is capped at **2 rad/s**, so you can't strike out of guard. Release first.
- **Effects:**
  - Incoming damage ×0.2 (chip).
  - The victim gains `0.6 · raw` heat.
  - The attacker gains +10 heat (recoil).
  - Holding guard costs +6 heat/s.
- **Guard break:** reaching 100 heat while guarding → Thermal Cutout + Stagger (400 ms).

### 5.2 Deflect (parry)

- **Window:** Guard *press edge* at time P and hit onset at time T, with **T − 150 ms ≤ P ≤ T + 30 ms**
  in sim time.
  - The +30 ms covers input sampling at a 50 Hz control rate plus one render frame.
  - Condition: the victim link is distal (camera_mount, jaws, gripper, wrist, lower_arm) and the
    defender is not Stunned, Staggered or Overheated.
- **Result:**
  - 0 damage.
  - Attacker **Stunned 650 ms** and +20 heat. Defender −15 heat.
  - Big spark, and a 60 ms hit-stop in Arcade (render-only in Harness, as `finals-feel.md` §4.2
    specifies).
- **Anti-mash:** a guard press that doesn't turn into a Deflect locks out a new deflect window for
  **400 ms**, though holding guard still blocks. Mashing guard every 150 ms yields no deflects.
- **Emergent variant:** `finals-feel.md` also suggests "defender moving faster into the hit". We
  fold that in as a bonus rather than a requirement. If the defender's own `b_n / v_ref ≥ 0.2` at
  onset (a counter-swing into the attack), the stun extends to 900 ms. That's a "hard deflect".

**Why these windows:**

| Attack | Arrival after commit (Arcade 2×) | Deflectable on reaction? |
|---|---|---|
| short flick (0.3 rad) | ~70 ms [measured] | No. Needs a read. |
| full hook (1.4 rad) | ~125 ms [measured] | No. A read or a pattern. |
| charged heavy | 250–600 ms visible charge + ~125 ms travel | **Yes.** The charge glow is the telegraph. |

A typical simple visual reaction takes about a quarter second. Parrying flicks is therefore
prediction, and parrying heavies is reaction. That gives the familiar fighting-game triangle:
light beats heavy-startup, heavy beats guard (the guard chips and burns heat), and deflect beats
heavy.

### 5.3 Attribution and Clash

At onset, compute each side's normalized approach: `α = a_n / v_ref(A)` and
`β = b_n / v_ref(B)`.

- `max(α, β) < 0.2` → **Contact** (shove).
- Both ≥ 0.2 and `0.75 ≤ α/β ≤ 1.33` → **Clash**. No damage. Both sides +8 heat and a 150 ms
  micro-stagger (τ×0.7). A loud spark, and the arms bounce apart physically.
- Otherwise the attacker is the larger side. `v_n` (relative) feeds §4, so stepping into a hit
  hurts more. That's physically true, and it's the "counter-hit" feel.

This replaces the `speedDifference ≥ 0.05` rule and fixes the limp-victim misattribution, because
velocities are read only at onset (§2).

---

## 6. Heat (stamina and overheat) [spec]

```
Q      = mean over 5 arm joints of (actuator_force / forcerange_current)^2   // per substep
dH/dt  = 120 * Q * loadoutHeat - 5                                         // per second
       - 15   (extra cooling, only after Q < 0.02 for 0.8 s)
       + 6    (while guarding) + 8 (while charging) + 25 (while Overdrive held)
events:  blocked by guard +10 (attacker) · deflected +20 (attacker) · deflect success −15 (defender)
         clash +8 (both) · take hit while guarding +0.6*raw (defender)
H in [0, 100]
```

Checked against measured Q at 2× (§1.6), with loadoutHeat = 1:

| Behaviour | dH/dt | 0 → 100 in |
|---|---|---|
| idle | −5, then −20 after 0.8 s | cools fully in ~5 s |
| one full hook every 1.5 s | +4.2 − 5 ≈ **−0.8** | never; this is sustainable rhythm |
| flick every 250 ms | +17.6 | **5.7 s** |
| shoving stalemate | +34.7 | **2.9 s** |
| shoving + Overdrive | ~+60 | 1.7 s |

- **Overheat → Thermal Cutout:** torque ×0.35 for 2.0 s, incoming damage ×1.25, deflect disabled.
  Afterwards H is set to 40.
- **Normalization:** Q uses the *current* forcerange, so a boosted arm isn't punished twice.
- **Stock profile:** the same formula works (Q stock ≈ Q 2× for the same behaviour, per §1.6).
- **Harness mode:** heat is computed and exported as telemetry, but Cutout doesn't change the
  model (§12).
- **HUD:** a thin arc around the reticle. Show a shimmer and a rising servo whine from 70
  (hand-off to the audio and feel tracks).

---

## 7. Stagger, Stun, Offline: servo state machine [spec]

All states are runtime edits of `model.actuator_gainprm[i*10]` (kp),
`model.actuator_biasprm[i*10+1]` (−kp), `biasprm[i*10+2]` (−kv) and
`model.actuator_forcerange[2i..2i+1]` for that arm's six actuators. We verified that these are
writable at runtime in the JS bindings. The command (and ghost) keeps updating in every state, so
input isn't lost.

| State | Trigger | Duration | τ | kp | kv | Rules |
|---|---|---|---|---|---|---|
| **Normal** | n/a | n/a | loadout | 1 | loadout | n/a |
| **Micro-stagger** | Clash | 150 ms | ×0.7 | 1 | 1 | n/a |
| **Stagger** | Hit with dmg ≥ 10 (pre-guard), **or** tracking error `max_j \|ctrl−q\| > 0.35 rad` for > 120 ms (pushed off target: emergent knockback) | 220 + 14·dmg ms, max 750 | ×0.5 | ×0.25 | ×0.6 | No deflect. Guard allowed after 60% of the duration. Incoming dmg ×0.8. |
| **Stun** | Got deflected | 650 ms (900 on a hard deflect) | ×0.3 | ×0.1 | ×0.5 | No guard, no ability, no charge. |
| **Thermal Cutout** | H = 100 | 2.0 s | ×0.35 | 1 | 1 | Incoming ×1.25, no deflect. |
| **Offline (KO)** | Integrity 0 | Rest of round | ×0.05 | ×0.02 | ×0.2 | Arm droops 7–10 cm within 1 s [measured]. Round ends. |
| **Stagger immunity** | End of Stagger or Stun | 900 ms | n/a | n/a | n/a | Can't be re-staggered. Prevents stun-lock loops. |

Why kp matters even when τ dominates: the kp×0.25 cut widens the linear band from 3 to 12 mrad,
so the staggered arm visibly "wobbles" around its target instead of snapping. The tracking-error
trigger makes knockback emergent: a big Anvil shove on a Whip actually displaces the joints
(measured 0.36 rad displacement on a weakened victim), and the rule simply notices.

---

## 8. Loadouts: light, medium, heavy [spec]

THE FINALS separates its three builds by health (150/250/350), speed and hitbox size, and gives
each a family of specializations: mobility for Light, team utility for Medium, objective control
and defence for Heavy (§16 [F3][F4]). The robots are identical hardware, so we express the same
fantasy through **servo tuning**, which is also what a real team would tune.

| | **Whip** (light) | **Pivot** (medium) | **Anvil** (heavy) |
|---|---|---|---|
| τmax (Arcade) | ×1.7 (5.0 N·m) | ×2.0 (5.88 N·m) | ×2.6 (7.64 N·m) |
| joint damping b | ×0.7 (0.42) | ×1.0 (0.60) | ×1.4 (0.84) |
| armature | ×0.8 | ×1.0 | ×1.8 (heavier rotor, more momentum, slower off the line) |
| kv | ×1.0 | ×1.5 | ×2.0 (steadier guard, less overshoot) |
| v_ref = τ/b·0.36 | **4.3 m/s** | 3.53 m/s | 3.27 m/s |
| Integrity | 80 | 100 | 125 |
| loadoutDmg | ×0.85 | ×1.0 | ×1.2 |
| loadoutHeat | ×0.9 | ×1.0 | ×1.15 |
| Stagger duration received | ×1.3 | ×1.0 | ×0.7 |
| Identity | Fastest arrival, so flicks beat reactions. Fragile. | All-rounder, best deflect tools. | Wins shoves and guard wars. Heaviest hits. Slowest start. |

- **Checks to run** (not yet measured per loadout): hook arrival time, knockback displacement
  dealt, and heat per exchange. Tuning target: each loadout's win rate against each other is
  45–55% in bot-vs-bot sweeps (§13.3).
- **Why these numbers:** v_ref is the same order across loadouts, so damage stays fair, while
  *acceleration* (τ/armature) and *mass* differ. That's where the feel lives: the Whip twitches,
  the Anvil lurches and lands. Anvil's ×2.6 is the ceiling (§12).

### 8.1 Signature abilities (one each, on E / Y)

| Loadout | Ability | Effect | Cost / cooldown | Inspiration (structure only) |
|---|---|---|---|---|
| Whip | **Snap** | For the next 180 ms, τ×1.6 (capped at 8 N·m absolute) and kv×0.5. A flick during it lands with ν ≈ 0.9 and arrives ~25% sooner. | 2 charges, each recharges in 5 s. +12 heat per use. | Charge-based burst mobility, like a dash with several charges [F5] |
| Pivot | **Recoil Coil** | For 2.5 s your *entire* guard hold counts as a deflect window for the first hit that lands. Then it ends. | 14 s cooldown. Guard heat is doubled while active. | Utility and defence; teaches deflect timing |
| Anvil | **Bulwark** | 3 s braced guard: τ×1.5 on top of the loadout (capped at 8 N·m), kv×3, chip damage ×0 (instead of 0.2), and each blocked strike gives the attacker +20 heat. No striking. Taking 60 total raw damage ends it early. | 16 s cooldown, or after it's broken. | A frontal shield that runs on an energy pool and breaks under damage [F6] |

**Shared kit:**

- **Overdrive** (Shift/LB): τ×1.35 while held, +25 heat/s, absolute cap 8 N·m. The comeback and
  commitment button.
- **Grip, Bind and Yank:** see §9.6.

---

## 9. Control model: directing arm, following arm

### 9.1 Principle

The player never moves the arm. The player moves a **command**, which is a massless ghost pose
drawn as a translucent, emissive wireframe of the SO-101 in the player's team colour. The physical
arm chases the ghost through the servo model. Because the servo is torque-saturated for errors
over 3 mrad (§1.1), **the size and speed of the ghost's jump directly become arm velocity, and
velocity is damage (§4).** The ghost gives three things:

1. Instant feedback: the input never feels laggy, because the ghost moves on the same frame.
2. Honest physics: the arm lags because it has mass and torque limits.
3. A readable skill gap: you learn to lead your target.

The ghost is **local HUD only**. The opponent (human or AI) never sees your command, only your
arm and public state such as the charge glow (§13.1).

### 9.2 Command state

```
cmd = {
  yaw   ψ  ∈ [-1.90, 1.90] rad   → shoulder_pan directly (no IK)
  elev  θ  ∈ [-0.35, 0.90] rad   ┐
  reach r  ∈ [0.12, 0.42] m      ┘ planar 2-link + tool IK → shoulder_lift, elbow_flex
  tool  φ  ∈ [-0.8, 0.8]  rad    → wrist_flex offset from "tool level with aim ray"
  roll  ρ  ∈ [-2.74, 2.74] rad   → wrist_roll
  grip  g  ∈ {open 1.15, closed 0.04} plus analogue on gamepad
}
```

**Mapping yaw straight to `shoulder_pan`** is the most important choice. It's the fastest and
most damaging axis (1.29 m/s stock, 2.48 m/s at 2× in a 1.2 rad step; §1.2). It needs no IK
iteration, so it has zero numerical lag. And it's exactly how an FPS player's hand already
works: horizontal flick = turn.

**Vertical plane IK:**

1. Shoulder-lift pivot S in the pan-rotated frame. Tip target `T = S + r·(cos θ, sin θ)` in the
   (radial, z) plane.
2. Wrist point `W = T − L3·(cos(θ+φ), sin(θ+φ))`.
3. Two-link law of cosines on `|SW|`, with link offsets.

The SO-101 has fixed angular offsets (upper arm frame at (−0.1126, −0.028), forearm at
(−0.1349, 0.0052)). **Fit the offsets once at load** against `mj_kinematics` on ~2,000 samples
and accept if RMS < 1 mm (a unit test, like the existing IK test).

**Fallback, usable today:** keep `solvePositionIK`, seed from the **measured** qpos, and delete
the task-space speed limits (0.28 m/s) and reach clamps. The per-iteration `maxStep` is fine,
because it converges within a tick.

### 9.3 Leash and follow-through

- **Leash:** clamp each commanded joint to within **0.6 rad** of its measured angle, i.e.
  ≤ ~22 cm of ghost lead at the tip. We measured no speed cost (§1.2). It prevents the "I moved
  my mouse 3 inches and the arm is still catching up a second later" feeling. When you push past
  the leash, the ghost drags; show the leash as a stretched line.
- **Yaw follow-through: none needed.** The measured overshoot is 0.09 rad at stock and 0.18 at
  2×, because braking starts only ~13–27 mrad before the target.
- **Reach follow-through: needed.** Tip speed along the reach direction goes to 0 as the elbow
  straightens (a singularity). So a jab command targets `min(r_max, r_contact + 0.05 m)` and
  should land at ≤ 85% extension. The HUD reach pip turns hot in the 60–85% "sweet band".

### 9.4 Strike inputs

| Input | Behaviour |
|---|---|
| **Flick** (mouse or right stick) | Nothing special. ψ and θ jump, and the servo does the rest. This is the light strike. |
| **Jab**: LMB tap (< 180 ms) | r → min(r_max, r + 0.10) for 160 ms, then back. θ is unchanged. |
| **Charge**: LMB hold ≥ 180 ms | 1. Wind-up: the command retracts r by 0.06 m, cocks φ back 0.5 rad, and rotates ψ 0.45 rad *away* from the direction of the last 150 ms of mouse motion. If the mouse was still, it's a straight retract. 2. Charge c rises 0 → 1 over 600 ms (+8 heat/s), and a glow scales with c, visible to the opponent. 3. Mouse sensitivity drops to ×0.5 while charging, so you can adjust aim. |
| **Release** | 1. The command snaps to the reticle, φ goes +0.5, and r goes to r_contact + 0.05. 2. For 250 ms, τ×(1 + 0.5·c) (cap 8 N·m). 3. The next damaging event within 400 ms is tagged `heavy(c)`. A release that hits nothing within 400 ms is a **whiff**: +10 heat and 250 ms of τ×0.8 (recovery). |

### 9.5 Math prototype: mouse delta to command and contact speed

```ts
// Pointer Lock with raw deltas: element.requestPointerLock({ unadjustedMovement: true }),
// falling back to plain requestPointerLock() where unsupported (§16 [M1]).
const K = 0.0015 * sensitivity;          // rad per count; 800 DPI: 1 inch = 1.2 rad
let accX = 0, accY = 0;
onMouseMove = (e) => { accX += e.movementX; accY += e.movementY; };

// control tick = every physics substep group (20 ms of sim at 50 Hz), fixed-step on sim time
function controlTick() {
  const dψ = K * accX, dθ = -0.8 * K * accY; accX = accY = 0;
  cmd.yaw  = clamp(cmd.yaw + dψ, -1.90, 1.90);
  cmd.elev = clamp(cmd.elev + dθ, -0.35, 0.90);
  const q = ik(cmd);                               // pan = yaw; planar IK for lift/elbow/wrist
  for (j of 0..4) q[j] = clamp(q[j], qMeas[j] - 0.6, qMeas[j] + 0.6);   // leash
  // Spread the change over the 4 substeps (linear) so the ghost draws smooth at 200 Hz.
  // No effect on arm speed (saturated servo) but no 50 Hz stair-step in the ghost.
}
```

**Commanded yaw rate from a real flick:** 0.5 inch in 60 ms at 800 DPI = 400 counts →
Δψ = 0.6 rad → **10 rad/s commanded**. The servo caps it at ω_t = 4.9 (stock) or 9.8 (2×).

**Contact speed:** at radius r ≈ 0.36 m from the pan axis and ~0.6 rad of travel, the arm reaches
~85–95% of ω_t. Contact speed is therefore about 0.9·ω_t·r·cos(angle to normal):

| Profile | Contact speed (normal hit) | ν | raw |
|---|---|---|---|
| stock | 1.5 m/s | 0.86 | 35 |
| 2× | 2.9 m/s | 0.82 | 33 |

This agrees with the measured 1.56 m/s and 2.72 m/s (§1.4).

A *lazy* 150 ms drag of the same 0.6 rad commands 4 rad/s:

- stock: arm speed ≈ 4 rad/s → 1.44 m/s → ν ≈ 0.8. **Still a strike**, because stock is slow
  anyway.
- 2×: arm speed ≈ 4 rad/s → ν ≈ 0.41 → raw 9.

So **boosted torque widens the skill range**: flick speed matters more in Arcade than at stock.
That's another reason Arcade uses 2× (§12).

**Sensitivity and range:** pan range 3.8 rad ≈ 3.2 inches at the default. Offer 0.25×–3×, plus a
separate vertical multiplier (default 0.8). **No mouse acceleration and no smoothing.** The servo
is the smoothing.

### 9.6 Grip, Bind, Yank, Throw

- **Grip** (Space / RB): hold to close (g = 0.04), release to open. The jaws use condim 6 with
  friction (`so101.xml` collision_gripper). Real frictional grasps of cubes and the Core already
  work (the existing heist mode).
- **Bind (clinch):**
  - Trigger: your closing jaws touch the opponent's gripper, jaw, camera_mount or wrist with
    both jaws in contact for 120 ms.
  - Effect: activate a **predefined, inactive `weld` equality** between the two `*_gripper`
    bodies (declared in `arena.xml`, solref 0.03 1). Set its relpose to the current relative pose
    at activation.
  - Toggle it through `data.eq_active`, which is runtime-mutable since MuJoCo 3.0. Verify it's
    exposed in the 3.12 JS bindings; if not, fall back to friction-only grasping.
  - Limits: a bind lasts ≤ 1.2 s and breaks if the constraint force exceeds 25 N for 60 ms.
- **Yank:** flicking while bound drags the opponent's joints off their targets. If their
  tracking error passes 0.35 rad for 120 ms, they're Staggered by the rule in §7, with no special
  case. Releasing grip ends the bind.
- **Escape ("wrench"):** the bound player presses Guard. That costs 25 heat and breaks the bind.
  If it happens in the first 300 ms, the binder is Staggered 300 ms (a tech escape).
- **Throw:** the bases are bolted, so arms can't be thrown. Cubes can: a release during a flick
  launches the cube at tip speed, for damage per §4.3. The Core can be thrown too, toward your
  Dock, for no damage. A bounced Core that stops in a Dock counts.

---

## 10. Camera: over-the-shoulder cockpit [spec]

### 10.1 Candidates

| Host | Verdict |
|---|---|
| Wrist camera (`*_wrist_cam`, on the gripper) | **Rejected as main view.** The camera itself moves at the strike speed (1.7–3.3 m/s, 5–10 rad/s pan), and the image is rolled ~90° at rest (`codebase.md` §8). Instant nausea, and you can't see your own attack. Offer it as a picture-in-picture "Optics" feed (C key), which also shows what a vision policy would see. |
| Shoulder-anchored with yaw = physical pan | Rejected. Same problem: a 1.4 rad hook swings the whole view 80° in 150 ms. |
| **Base-anchored cockpit, yaw from command with soft follow** | **Adopt.** |
| Third-person chase | Keep as the spectator and replay camera (`finals-feel.md` §5.6). |

### 10.2 Cockpit spec

Eye position, in the arm's base frame (Atlas: +x toward the opponent):

- **E = base + (−0.12, −0.07, +0.24) m**: 12 cm behind the base, 7 cm to the **right**, 24 cm up.
- Blaze mirrors this.
- The right offset makes your arm read as a right-hand viewmodel, so the elbow (z = 0.22 at
  x = −0.29) doesn't cover the centre of the screen.
- Dither-fade your own arm links that come within 6 cm of the near plane.

Look direction:

- The base look target is the contest centre (0, 0, 0.12), about 15° down.
- **Yaw sway:** 0.35·(ψ_cmd − ψ_center), clamped to ±20°.
- **Pitch sway:** 0.25·(θ_cmd − θ₀), clamped to ±10°.
- Both run through a critically damped spring (ω = 14 rad/s). The opponent's base always stays
  in frame, so this works as a soft lock-on. The camera never reads the physical pan.

Lens and HUD:

- Vertical FOV 55° (≈ 88° horizontal at 16:9). Near plane 0.005 world units.
- **Reticle** = the ghost gripperframe projected to screen, drawn as a bracket.
- **Physical-tip marker** = a small dot. The gap between them is your "lag" at a glance.
- **Reach pip** at the reticle with the 60–85% sweet band (§9.3). Heat arc around the reticle
  (§6).

Hit feedback (shake, directional kick, FOV punch) follows the trauma model in `finals-feel.md`
§4.3. Combat supplies the magnitude as `trauma += dmg/45` (and `+0.15` on a Clash).

---

## 11. Input maps

### 11.1 Mouse and keyboard

| Input | Action |
|---|---|
| Mouse move | Aim: ψ (X), θ (Y). Raw, 1:1. |
| LMB tap / hold / release | Jab / Charge / Heavy release (§9.4) |
| RMB | Guard (hold) · Deflect (press edge) |
| W / S | Reach out / in (command rate 0.8 m/s) |
| A / D | Wrist roll (flat hand vs knife-edge; the knife-edge presents smaller jaw boxes) |
| Mouse wheel | Tool pitch φ in 0.15 rad notches |
| Space (hold) | Grip / Bind (§9.6) |
| Shift (hold) | Overdrive |
| E | Loadout ability |
| C | Optics picture-in-picture |
| Tab | Scorebug and telemetry |
| Esc | Pause (vs bot only; not in Harness) |

### 11.2 Gamepad (standard mapping)

Rate-controlled sticks can't flick. A stick moving the aim at ≤ 3.2 rad/s only produces
ν ≈ 0.3–0.4 at 2× (§9.5), so light strikes would be impossible on pad. The right stick is
therefore an **absolute swing stick**, the idea from boxing and skateboarding games where the
stick gesture is the move:

```
ψ = ψ_center + 0.90 · curve(sx)          θ = θ_center + 0.50 · curve(sy)
curve(v) = sign(v) · ((|v| − 0.12)/(1 − 0.12))^1.5   for |v| > 0.12 (radial deadzone), else 0
ψ_center += 1.6 rad/s · LSx · dt          r += 0.5 m/s · LSy · dt
ψ_center drifts toward the opponent's gripper yaw at 0.6 rad/s when LS is idle (soft aim assist;
  off in Harness and in ranked human-vs-human)
```

A full-left to full-right stick flick in ~50 ms is a 1.8 rad step, which is a full-speed hook.
That gives parity with mouse flicks.

| Input | Action |
|---|---|
| RS (absolute) | Aim and swing. RS click recentres ψ_center on the opponent. |
| LS | Reach (Y), pan centre (X) |
| RT (analogue, threshold 0.35) | Tap = Jab; hold = Charge; release = Heavy |
| LT | Guard / Deflect (press edge) |
| RB | Grip / Bind |
| LB | Overdrive |
| Y | Ability |
| X / B | Wrist roll − / + |
| D-pad up/down | Tool pitch notches |
| View | Optics picture-in-picture |

**Haptics:** `GamepadHapticActuator.playEffect("dual-rumble")` (§16 [M2]):

- Landed hit: strong 0.2 + dmg/60, 60 ms.
- Deflect: weak 1.0 / strong 0.6, 90 ms.
- Heat ≥ 70: weak 0.15 pulse at 8 Hz.

---

## 12. Should the game boost torque? Arcade vs Harness [spec]

**Yes, in Arcade. Never in Harness.**

| | **Arcade** (default for play) | **Harness** ("sim-realistic", for policy verification) |
|---|---|---|
| Servo | Loadout profiles (§8), base 2× τ, kv×1.5, **kp unchanged** | Stock Menagerie: kp 998.22, kv 2.731, ±2.94 N·m |
| Runtime model edits | Stagger/Stun/Cutout/Offline profiles, Guard, Overdrive, abilities, Bind weld | **None.** The model is byte-identical to Menagerie + arena. |
| Scoring overlay | Everything in §4–7 | Same damage (normalized ν), Integrity, Core and Deflect *scoring*. States are flagged in telemetry but never applied to the servos. |
| Timestep | 2.5 ms recommended when any profile allows tip > 3 m/s (benchmark first; see below) | 5 ms (as shipped) |
| Hit-stop | Sim time scale 0.15 for 45–90 ms (`finals-feel.md` §4.2) | Render-only |
| Heat | Cutout applies | Telemetry only |
| Aim assist | On for pad vs bot | Off |
| Determinism | Seeded | Seeded, fixed dt, sim-time policy calls, exported `qpos`/`ctrl` log |

**Why 2× is the sweet spot [measured]:**

- **Stock is honest but sluggish for a game.** A full hook takes 200 ms to land, and tip speed
  tops out at 1.7 m/s. Every committed swing is near max ν, so flick skill barely separates
  players (§9.5).
- **2× feels sharp.** Hooks land in 125 ms at 2.7 m/s, overshoot settles in ~465 ms (more kv
  shortens that), solver forces stay moderate (58 N peak on a clean hook), and slow and fast
  inputs score clearly differently.
- **3× starts to break.** The same hook produced a 615 N peak and 21 N·s within 40 ms, far above
  2×. Random swings hit 4.5 m/s. At 5 ms steps, 3.5 m/s is 17.5 mm per step, against jaw
  collision boxes that are 1–6 mm thick (`fixed_jaw_box4–7`, `moving_jaw_box2–3`), so tunneling
  and penetration spikes become likely.
- **Resulting limits:**
  - Absolute τ cap of 8 N·m, even with Overdrive, Snap or Bulwark stacked. That's why Anvil's base
    is ×2.6 and not more.
  - For any Arcade profile allowing v_ref > 3 m/s (Whip 4.3), halve the timestep to 2.5 ms, i.e.
    8 substeps per 20 ms. Benchmark the WASM step cost first: two arms + 9 cubes, target
    < 4 ms per 20 ms of sim on a mid laptop.
- **Don't boost kp.** Above 3 mrad of error it doesn't change force, and a smaller linear band
  adds contact chatter. **Do raise kv** modestly (×1.5–2). It trims the 0.18 rad overshoot
  without a big speed cost, because braking still starts only ~27–54 mrad before the target at
  9.8 rad/s. Measure before committing.

**The toggle:** a match setting "Physics: Arcade / Harness". A user model can play in either.
Only Harness results get the "verified" badge on the post-match model report (`finals-feel.md`
§7.4). A **Harness Spar** (human vs policy under Harness rules) is the most honest test: the
human gets the same stock servos.

---

## 13. AI and user-policy implications

### 13.1 Observation (v2, a superset of today's `nextTargets` input)

```
time, task, seed
joints[6], jointVel[6], actuatorForce[6]            // self (qvel and force are new)
opponentJoints[6], opponentJointVel[6]              // physical state only, never opponent ctrl/ghost
cubes[9]{position, quaternion, isCore}
core{owner, lockInRemaining, inDock: "self"|"opponent"|null}
self{integrity, heat, state, stateRemaining, abilityReady, charge}
opponent{integrity, heat, state, charging:boolean, chargeLevel}   // public: the charge glow is visible
lastEvents[]{kind: contact|strike|block|deflect|clash, attacker, dmg, zone, t}
profile: "arcade:<loadout>" | "harness"
```

### 13.2 Action

```
Required:  6 joint targets (validated as today)      ← a real-robot policy transfers unchanged
Optional:  intent{guard:boolean, charge:boolean, grip:boolean, overdrive:boolean, ability:boolean}
```

- Missing intent is treated as all false, so a pure joint-target policy still plays. It just
  can't Deflect, which matches Harness where Guard has no physical effect anyway.
- Charge wind-up for a policy isn't automated: the policy emits the poses, and `charge` only
  tags the release and applies the τ boost in Arcade.

### 13.3 Fairness rules

- The built-in bot and user policies get observations delayed **180 ms ± 30 ms** in Arcade vs a
  human (configurable; 0 in policy-vs-policy Harness). Without it, a bot can deflect every flick
  by reading onset velocities, which makes it unbeatable and teaches nothing.
- Policies run at a fixed 50 Hz on sim time. A policy that misses its tick deadline repeats its
  last action (logged).
- The balance harness runs headless bot-vs-bot sweeps in Node (like Appendix A). It reports win
  rate per loadout pair, median round length, KO share, deflect rate, and heat-cutout frequency,
  and it gates tuning changes.

---

## 14. Implementation plan

### 14.1 Modules

| File | Responsibility |
|---|---|
| `src/lib/combat/rules.mjs` | Pure, deterministic. `stepRules(state, onsetEvents, servoTelemetry, intents, dtSim) → {state, events}`. Integrity, heat, state machine, damage, Core/Dock lock-in, lockouts. No DOM, no MuJoCo. Unit-testable. |
| `src/lib/combat/servo-profiles.mjs` | Loadout and state profile tables. `composeProfile(loadout, state, modifiers) → {kpS, kvS, tauS}` with the 8 N·m cap. |
| `src/lib/mujoco-engine.ts` | Per-substep onset detection with pre-impulse normal velocities (§2). `applyServoProfile(arm, profile)` writes gainprm/biasprm/forcerange (Arcade only). Bind weld toggle. Exposes `actuator_force`, `qvel`. |
| `src/lib/input/command.mjs` | CommandState, mouse/pad mapping (§9.5, §11), leash, jab/charge sequencer, ghost pose. |
| `src/lib/input/planar-ik.mjs` | Closed-form lift/elbow/wrist with fitted offsets (§9.2). |
| Game loop | `requestAnimationFrame` with a fixed-step accumulator on **sim time**. 20 ms control ticks, each 4 substeps (8 in the Arcade high-speed profile). React state only at ≤ 20 Hz for HUD, with refs for everything else. |

### 14.2 Resolver sketch

```js
// called once per physics substep, after mj_step
for (const pair of contactPairsThisSubstep) {
  if (activePairs.has(pair.key) || recentlyEnded(pair.key, 30 /*ms*/)) continue; // not an onset
  const { aN, bN, vN, atlasLink, blazeLink } = pair;          // pre-impulse, along the normal
  const α = aN / vRef.atlas, β = bN / vRef.blaze;
  if (Math.max(α, β) < 0.2) { emit("contact"); continue; }
  if (Math.min(α, β) >= 0.2 && α / β >= 0.75 && α / β <= 1.33) { clash(); continue; }
  const atk = α > β ? "atlas" : "blaze", vic = other(atk);
  if (t - lastHitAt[atk] < 0.22) { maybeUpgradePendingHit(atk, vN); continue; }
  const nu = vN / vRef[atk];
  let raw = 20 * Math.pow(clamp((nu - 0.2) / 0.4, 0, 1.75), 1.2);
  if (deflectWindow(vic, t)) { deflect(vic, atk, bN / vRef[vic] >= 0.2); continue; }
  const mult = zone(vicLink) * tool(atkLink) * loadoutDmg[atk] * heavyTag(atk, t) * stateMult(vic);
  const dmg = Math.min(45, raw * mult);
  applyDamage(vic, dmg); addHeat(...); maybeStagger(vic, raw, dmg);
  lastHitAt[atk] = t; emit("strike", { atk, vic, dmg, zone, nu });
}
```

### 14.3 Tests to add

These go in `node --test`, using the WASM like `tests/mujoco-duel.test.mjs`:

1. A full hook at 2× (the §1.4 pose) is attributed to Atlas with ν ≥ 0.6 and damage ≥ 25.
2. **Regression:** a hook into a τ×0.05 victim is still attributed to the attacker.
3. A slow 800 ms ramp into the opponent's hand scores 0 damage.
4. Flick spam every 250 ms at 2× reaches Cutout within 4–8 s. A hook every 1.5 s never does.
5. The Offline profile droops the tip ≥ 5 cm within 1 s from an extended pose.
6. Deflect window boundaries hold: −151 ms fails, −150 passes, +30 passes, +31 fails. The
   400 ms anti-mash lockout works.
7. **Dock geometry:** the opponent's gripperframe can touch the Core at the Dock rim only with
   ≥ 95% reach extension, and never reaches the Dock centre. The owner can place it at the centre.
8. Harness mode: after a full match, `model.actuator_*` arrays are unchanged byte-for-byte.
9. Planar IK fit: RMS < 1 mm over 2,000 random reachable targets.

---

## 15. Risks and open questions

- **Tunneling at speed.** The thin jaw boxes (1–6 mm) are the risk at 2.5–4 m/s. Options, in
  order of preference:
  1. 2.5 ms timestep in Arcade.
  2. Add a slightly thicker, invisible "strike hull" capsule per hand, used only for the
     arm-vs-arm contype/conaffinity. That's a scene-level add in `arena.xml`, and the vendored
     `so101.xml` stays untouched.
  3. Cap Whip's τ.
- **Bind weld via `eq_active`** may not be exposed in the 3.12 JS bindings. The fallback is
  friction-only grasps, which already work for cubes but will slip on the opponent's hand.
- **Reaction-time assumptions** (quarter-second visual RT) need a playtest. If flick deflects
  feel impossible even with reads, widen the window to 180 ms before touching the damage numbers.
- **Integrity per loadout** (80/100/125) is untested. Bot sweeps (§13.3) decide it.
- **Turtling:** if both players camp in Guard, the fixes are the Core spawn plus guard heat. If
  guard wars still stall, add "guard fatigue" where chip multiplies up by ×0.05 per consecutive
  block.
- **The existing 1.25× sim speed** and per-tick React `setState` must be fixed before any
  timing-window tuning, or all windows are 25% too short in wall time.

---

## 16. Sources

About THE FINALS (structure and feel only; nothing copied):

- [F1] Cashout mode. The loop is: open a vault, carry the cash box to a station, deposit it, and
  defend the station. Steal timing, and double-deposit risk: https://www.thefinals.wiki/wiki/Cashout
- [F2] Cashout Station. Cashout duration is 2 min. A steal takes 6–7 s, and the stealer is locked
  into the interaction without attacking or dodging. The station can be knocked around:
  https://www.thefinals.wiki/wiki/Cashout_Station
- [F3] Builds. Light 150 HP, fastest and smallest. Medium 250. Heavy 350, slowest, largest
  hitbox. Regeneration delays: https://www.thefinals.wiki/wiki/Builds
- [F4] Specializations per build (Light mobility/stealth, Medium team utility, Heavy
  objective/defence): https://www.thefinals.wiki/wiki/Specializations
- [F5] The Light dash specialization uses multiple charges with a recharge (3 charges over 6 s,
  via search summary of https://the-finals.fandom.com/wiki/Evasive_Dash; that page returned 402 to
  our fetcher, so treat this as unverified).
- [F6] Heavy shield specialization: 850 energy, frontal only, regenerates when undamaged, needs
  300 energy to redeploy after breaking: https://www.thefinals.wiki/wiki/Mesh_Shield
- [F7] Heavy melee weapon: a precise versus glancing hit split, and a slower overhead alt attack
  with more damage and pushback. This inspired our zone multipliers and charged heavy:
  https://www.thefinals.wiki/wiki/Sledgehammer
- [F8] General context: Embark Studios, a game-show setting with in-universe hosts, server-side
  destruction, released December 2023: https://en.wikipedia.org/wiki/The_Finals

Hardware and platform:

- [S1] Feetech STS3215 12 V: 30 kg·cm stall torque, 0.222 s/60° no-load speed:
  https://www.feetechrc.com/525603.html and https://servodatabase.com/servo/feetech/sts3215
- [S2] MuJoCo `position` actuator (kp, kv, forcerange semantics):
  https://mujoco.readthedocs.io/en/stable/XMLreference.html#actuator-position
- [S3] Menagerie SO-101 gain derivation comment in `public/models/robotstudio_so101/so101.xml`
  (lines 32–38)
- [M1] Pointer Lock `unadjustedMovement` (raw mouse input):
  https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock
- [M2] Gamepad haptics: https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator

---

## Appendix A: measurement method

All numbers tagged [measured] came from Node scripts that load the repo's
`node_modules/@mujoco/mujoco` WASM, `public/models/robotstudio_so101/arena.xml` and
`so101.xml`. The loading code is the same as in `tests/mujoco-duel.test.mjs`.

- **Cubes:** parked off-table (x ≥ 2 m) unless noted.
- **Profiles:** applied by scaling `actuator_gainprm[i*10]`, `actuator_biasprm[i*10+1]`,
  `actuator_biasprm[i*10+2]` and `actuator_forcerange[2i..2i+1]` for one arm's six actuators.
- **Tip speed:** finite difference of `site_xpos[*_gripperframe]` at dt = 5 ms.
- **Contact speeds:** the `contactPointSpeed` math from `mujoco-engine.ts` in vector form.
  Normal = `contact.frame[0..2]`. Read immediately after `mj_step`, when contacts and cvel both
  describe the pre-integration state.
- **Onset:** the first substep in which a cross-arm contact exists after at least one substep
  without one.
- **Hook pose:** lift = 0.14, elbow = 0.14, wrist = 0, grip = 0.72. The tip sits at x = 0.08,
  z = 0.16 at pan 0. The hook is a pan sweep from −0.7 → +0.7 after a 300 ms settle.
- **Random sweep:** 600 trials, seed 7. Atlas start and goal poses were uniform in
  pan [−1.2, 1.2], lift [−0.4, 1.0], elbow [−0.6, 1.2], wrist [−1, 1]. Blaze was perturbed
  around START_POSE. Commands were ramped over 5/50/150/400/800 ms. Trials starting in contact
  were discarded.
- **Heat Q:** mean over 5 arm joints of (actuator_force/forcerange)², averaged over 3 s of the
  scripted behaviour.
- **Droop:** tip displacement from the settled pose after switching profiles, sampled at 0.5, 1.0
  and 1.5 s.
- **Leash:** each step, pan command = q_meas + clamp(goal − q_meas, ±L). No opponent in the path.
- **Dock reach:** grid search over pan, lift, elbow and wrist (with the other arm parked) for
  gripperframe positions at z = 0.03 ± 0.006. Lunge time = steps until the opponent tip is within
  1 cm of its minimum x, starting from START_POSE.
