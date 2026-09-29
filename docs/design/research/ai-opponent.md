# AI opponent and model-verification harness

Status: research and design, 2026-09-16. Branch `fps-duel`.
Scope: (1) a built-in opponent that plays like a person, not a script, and (2) a
harness that lets anyone swap in their own robot policy, run it under fixed seeds,
record the match, replay it, and compare models with numbers.

The rule running through the whole document: **the built-in opponent is itself a
policy.** It uses the same `reset(context)` / `act(observation)` contract, the same
Web Worker, the same 500 ms budget, and the same joint-limit checks as an uploaded
model. If the built-in AI can't do something through that interface, an uploaded
model can't either. That keeps the comparison fair.

---

## 0. What the code does today (and what that means for the design)

Read before writing this: `src/lib/arm-participation.mjs`, `src/lib/mujoco-engine.ts`,
`src/lib/task-space-ik.mjs`, `src/components/arena-app.tsx`,
`public/models/robotstudio_so101/{arena,so101}.xml`, `tests/mujoco-duel.test.mjs`.

### 0.1 Measured facts about the arms

I measured these with MuJoCo 3.12 WASM in Node, using the repo's `arena.xml`
(scratch scripts, not committed):

| Quantity | Value | Why it matters |
|---|---|---|
| Mount separation | 0.64 m (Atlas at x = -0.32, Blaze at +0.32, Blaze rotated π about z) | Midline is 0.32 m in front of each base |
| End effector (EE, the `gripperframe` site) at `START_POSE` | Atlas (-0.011, -0.001, 0.184), Blaze (+0.011, +0.001, 0.184) | **The grippers start 2.2 cm apart.** The round-start pose needs to pull back to a guard, or every round opens with a contact event |
| Max forward reach (pan = 0, EE z ≥ 2 cm) | ≈ 0.48 m from own base | Reaches 0.16 m past the midline. The opponent's base (0.64 m) and shoulder (≈0.60 m) are **out of reach**. You can hit the forearm, wrist, and gripper, plus the upper arm and elbow when the other arm extends. |
| Reach at z = 0.03 / 0.08 / 0.15 / 0.25 m | 0.47 / 0.48 / 0.48 / 0.46 m | Nearly a cylinder, so height is a free tactical variable |
| Terminal joint speed | ≈ 4.8 rad/s on every joint | Set by joint damping 0.60 N·m·s/rad against the 2.94 N·m torque cap (2.94 / 0.6 ≈ 4.9). With kp = 998, any target error above 3 mrad saturates torque, so **the servos act bang-bang, and target shaping is the only way to control speed.** |
| Single-joint step, pan +0.3 rad | t90 = 105 ms | Short pokes |
| Single-joint step, pan +1.0 rad | t90 = 245 ms, EE peak 1.28 m/s | |
| Shoulder-lift ±0.6 rad | t90 ≈ 185 ms | |
| Guard (ego x 0.20, z 0.15) → extended (x 0.40), joint-space straight line | 0.20 m of EE travel, t90 ≈ 310 ms, peak 1.45 m/s | A full jab is **slower than human reaction time (~250 ms)**, so a long jab can be reacted to |
| Overhead (x .18, z .30) → low (x .38, z .04) | 0.24 m, t90 ≈ 340 ms, peak 1.44 m/s | The slam can be reacted to. That's correct, and it's why the slam needs a big payoff. |
| Pan sweep +0.9 → -0.5 rad at jab radius | 0.30 m arc, t90 ≈ 240 ms, peak 1.67 m/s | The hook is the fastest high-speed contact |

**Design consequence.** Attack duration compared with reaction time is the main
balance knob in fighting games: moves faster than about 12 to 19 frames at 60 fps
can't be reacted to (Killer Instinct's Shadow AI tuned to this band, see §1.1).
Here, **short pokes of 5 to 8 cm (≈100 to 150 ms) can't be reacted to, and full
jabs, slams, and sweeps (240 to 340 ms) can.** That split falls out of the real
STS3215 servo parameters. Don't change them. Build the mind games on top of them.

### 0.2 Defects and gaps in the current code that the harness must fix

1. **Two clocks.** `arena-app.tsx:306` advances `elapsed` by 0.016 s per tick, but
   `engine.step(..., 4)` advances physics by 4 × 0.005 = 0.020 s. The `time` that
   policies see runs 20% slower than sim time. The tick is also a
   `setInterval(16)` on the React thread, which jitters.
2. **Action latency varies from run to run.** `UploadedPolicyRunner.nextTargets`
   returns `lastAction` right away and posts the request. The answer lands some
   number of 16 ms ticks later, depending on machine load. Two runs with the same
   inputs give different trajectories.
3. **Unseeded randomness.** `MujocoEngine.reset({ randomizeCubes })` uses
   `Math.random()`.
4. **Hits are logged on the first frame of a contact.** `combatStats` uses
   `collision` from the frame where `eventId` first changes. A contact that starts
   as a light "block" and peaks as a "strike" three substeps later is counted as a
   block. Damage and stats must use the **peak over the whole contact event**,
   finalized when the contact ends.
5. **Attacker attribution is scalar.** "Faster contact-point speed" decides the
   attacker, so a fast parry into a slow jab counts as a strike by the parrier.
   That may be the design you want (active parry rewarded), but decide it on
   purpose. A better signal is the relative velocity projected on the contact
   normal (who is moving *into* whom).
6. **The observation is too thin and in the wrong frame.** No joint velocities, no
   EE pose, no health or round state. Everything is in world coordinates, and
   Blaze's mount is rotated π, so a policy trained as Atlas can't play as Blaze.
7. **One bad value kills the policy.** `validatePolicyAction` throws, and
   `handleWorkerMessage` calls `fail()`. For a verification harness that's too
   blunt: record a joint-limit violation, clamp, and keep going in lenient mode.
   Keep today's behavior as strict mode.
8. `so101.xml` sets `wrist_roll` ctrlrange to `-2.74385 2.84121`, while the joint
   range and `JOINT_CONTROLS` are ±2.74385. Use the joint range as the contract.
9. The opponent (`opponentPolicyTargets`) is `sin(t)` choreography that ignores the
   player.
10. The built-in IK (`solveAtlasIK`) calls `mj_kinematics` on the main thread. A
    Worker has no MuJoCo, so **the opponent policy needs its own forward
    kinematics** (§3.2).

---

## 1. Research: what makes a game AI feel human

### 1.1 Prior art worth copying

**Killer Instinct (2013), Shadow AI.** Case-based reasoning. Every player action is
recorded with the game state, and at runtime the AI retrieves the nearest
neighbours using **more than 40 similarity metrics**. States are stored
**relative** (distance to the opponent, relative health), so patterns carry over
between situations. Retrieved actions are ranked by value, but the AI sometimes
picks a lower-ranked one on purpose, **"in order to trick its opponent."** It
updates mid-match when punished for an action. The target was human reaction speed
of about **12 to 19 frames at 60 fps (200 to 317 ms)**. It keeps 40 matches per
opponent, 400 to 700 patterns per match.
Source: https://www.gamedeveloper.com/programming/the-killer-groove-the-shadow-ai-of-killer-instinct ,
https://www.aiandgames.com/p/how-killer-instincts-shadow-mode

What to take: relative state features, value ranking with a deliberate
lower-ranked pick, adaptation when punished, reaction delays in the human band.

**Tekken 8, Super Ghost.** Machine-learned imitation of a specific player. It
copies their **mistakes** as well as their strengths, and it won't do anything the
player never demonstrated. That includes defensive options such as punishes and
sidesteps.
Sources: https://en.bandainamcoent.eu/tekken/news/tekken-8-discover-about-super-ghost-battles ,
https://www.dexerto.com/tekken/tekken-8-players-blown-away-by-revolutionary-ghost-ai-system-that-can-copy-pros-2434093/

What to take: humans read "mistakes that fit a style" as personality and "random
mistakes" as a bot. Error modes should belong to the personality.

**FightingICE (fighting-game AI research platform).** Gives AI entrants a
**15-frame (~250 ms) delayed game state** to simulate human response time.
Source: https://www.slideshare.net/ftgaic/2019-fighting-game-ai-competition

What to take: use delayed perception instead of a slowed-down decision rate.

**Left 4 Dead AI Director (Valve, Mike Booth, GDC 2009).** Adaptive dramatic
pacing: it tracks each player's emotional intensity, which rises with damage and
danger. It builds up, peaks, and then **relaxes**, like Counter-Strike's rhythm.
It was built as "a layered set of extremely simple, playtestable algorithms."
Source: https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf

What to take: exchanges need breathing room. After a flurry, the opponent backs off
and resets spacing. That rhythm reads as human.

**Hunicke, "The Case for Dynamic Difficulty Adjustment in Games" (ACE 2005), and
the Hamlet system.** Players like unpredictability but **feel cheated if they
notice the game adjusting.** Adjust without degrading the core experience.
Sources: https://dl.acm.org/doi/10.1145/1178477.1178573 ,
https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf

What to take: rubber-band only *perception and decision* parameters, never physics.
Change them slowly, between exchanges, and within bounds.

**Utility AI, Dave Mark's Infinite Axis Utility System (GDC AI Summit).** Each
action has considerations. Each consideration maps a normalized input through a
**response curve** (linear, logistic, logit…) to [0,1], and the consideration
scores are **multiplied**. A single zero vetoes the action. More considerations
drag scores down, which needs a compensation factor.
Sources: https://www.gameai.com/iaus.php ,
https://www.cloderic.com/content/2013-04-24-ai-summit-2013-takeaway

**Sirlin, Yomi layers ("Playing to Win").** Mind games run in layers: a move, its
counter, the counter to the counter. Supporting **up to layer 3** is the minimum
complete set, because layer 4 wraps back to layer 0.
Source: https://www.sirlin.net/ptw-book/7-spies-of-the-mind

What to take: the opponent model only has to predict the player's *next category*
of move and choose among {do it, counter it, counter the counter}. Deeper
recursion adds nothing.

**Reaction-time distributions.** Human RTs are right-skewed and well described by
an **ex-Gaussian** (a Gaussian μ, σ plus an exponential τ tail).
Sources: https://lindeloev.github.io/shiny-rt/ ,
https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2014.01548/full

A Gaussian delay reads as mechanical because it's symmetric and has no "late
reaction" tail. Sample from the ex-Gaussian.

**Motor noise.** Noise grows with the size and speed of the motor command
(signal-dependent noise; Harris & Wolpert, *Nature* 394:780, 1998). Fast moves are
less precise, so a hasty punish should miss more often than a deliberate one.

### 1.2 Embark's own direction (context only, not copied)

- THE FINALS is Embark Studios' free-to-play FPS on Unreal Engine 5, released
  7 Dec 2023. Its premise is a VR combat **game show** with holographic crowds and
  sponsors. It has three body builds (Light 150 HP, Medium 250, Heavy 350), and
  destruction is server-side.
  https://en.wikipedia.org/wiki/The_Finals ,
  https://gamesbeat.com/embark-studios-unveils-the-finals-team-based-shooter-game/
- Two announcers comment on the match. Embark used TTS for voices, which drew
  criticism. https://en.wikipedia.org/wiki/The_Finals ,
  https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals
- The Season 11 melee rework (July 2026) added a **stamina** system with lunges of
  varying distance and "precision-based" damage.
  https://www.shacknews.com/article/149942/the-finals-season-11-features
- Embark's ARC Raiders robots use **ML-trained locomotion** that rebalances when
  damaged, which creates emergent behavior.
  https://www.pcgamer.com/gaming-industry/arc-raiders-use-of-ai-highlights-the-tension-and-confusion-over-where-machine-learning-ends-and-generative-ai-begins/

Implications for our design, in original terms only (no names, voices, or assets):
- **Game-show framing** for the harness: contestants (policies) have a "card" with
  a name, archetype, and record. The stats panel is presented like a broadcast
  lower-third, not a lab table.
- **Commentary built from events.** The event stream in §7 (strike, block, whiff
  punish, feint bitten, comeback) is exactly what an original commentator or
  caption system would react to. Record the events once and use them for stats,
  replay markers, and commentary.
- **Physics as the spectacle.** Hit reactions come from MuJoCo, not canned
  animation. This matches the "emergent because it's simulated" appeal of Embark's
  robots.
- **A stamina-like resource is optional.** If the combat track adds one, it slots
  into the observation (`self.stamina`) without schema changes. It's reserved in §5.

### 1.3 Bot tells to avoid (every one of these shows up in playtests as "it's a bot")

| Tell | Fix in this design |
|---|---|
| Reacts on the exact frame an attack starts | Ex-Gaussian reaction delay on a delayed perception buffer (§2.3) |
| Identical motion every time | Parameters jittered once per primitive (target offset, duration scale), not per tick |
| Per-tick jitter (servo "buzz") | Noise is low-frequency and per primitive. The action-jerk metric catches regressions (§8). |
| Perfect punish of every whiff | Punish probability below 1, per tier. Punishes use hasty execution noise. |
| Never idles, or idles perfectly still | Idle "breathing" guard sway at 0.3 to 0.6 Hz and 5 to 15 mm, with occasional weight shifts (small pan drift) |
| Mood flips instantly | Mood is a low-pass state variable (τ ≈ 4 to 8 s) |
| Obviously throws the match when you're losing | DDA never makes the AI stand still. It lengthens reaction time, raises the telegraph, and lowers punish probability, all within bounds. |
| Spams the move that works | Novelty decay: an action's utility drops each time it's used in the last ~10 s. The player's adaptation gets a chance to work. |
| No reaction to getting hit | "Rattled" state: a short guard-up retreat, plus a mood shift toward caution or anger depending on personality |
| Doesn't celebrate or respond socially | Showboat primitives after big moments (gripper "clap", a pause, a slow re-guard). These are 0 to 400 ms of **free** vulnerability, which also gives the player an opening. |

---

## 2. Built-in opponent architecture

### 2.1 Layers (all inside one policy module in a Worker)

```
observation (ego frame, §5)
   │
   ▼
[Perception]  delayed buffer · event detectors · opponent model (habit n-gram)
   │  perceived state (lagged), events with reaction-release times
   ▼
[Mind]        mood (aggression, composure, focus) · difficulty/DDA knobs · personality
   │
   ▼
[Decision]    commitment FSM  ──neutral──▶  utility selector (10 Hz think)
   │            ▲                             │ Boltzmann pick among top-k
   │            └────── primitive done / interrupted by hit ◀──┘
   ▼
[Motor]       primitive (task-space keyframes) → min-jerk path → noise → IK → 6 joint targets
   │
   ▼
action [6] (+ optional debug payload)
```

The **commitment FSM** gives the fighting-game structure. The **utility selector**
gives smooth, situation-aware choices. The **motor layer** makes it move like
something with mass instead of a lookup table.

### 2.2 Commitment FSM

States:

- `NEUTRAL`: guard plus footwork micro-movement. The utility selector runs every
  100 ms (± 20 ms jitter).
- `COMMITTED(primitive, phase)`: phases are `windup → active → follow → recover`.
  - `windup` can be cancelled (this is how feints work). Cancel is only allowed if
    the primitive has `cancelable: true` and `phaseProgress < cancelWindow`.
  - `active` and `follow` can't be cancelled. This is where whiffs become
    punishable.
  - `recover` can be cancelled only into `GUARD`, and only after
    `recoverMinMs × tier.recoverScale`.
- `RATTLED`: entered when a strike lands on us with force ≥ `rattleForce`. Lasts
  150 to 350 ms (scaled by force). Retreats the EE along −x and raises the guard.
  Nothing is chosen. This is our "hitstun," driven by the AI's own policy, while
  physics provides the actual knockback.
- `RESET_SPACING`: after an exchange of 3 or more contact events within 2 s, drift
  back to a preferred guard distance for 400 to 900 ms at low utility pressure.
  This is the L4D "relax" beat.
- `ROUND_TRANSITION`: countdown or KO. Plays the showboat or reset primitive and
  ignores combat.

### 2.3 Perception: delayed, imperfect, event-driven

```js
// every act() call
buffer.push(observation);                       // ring buffer, 1.5 s at control rate
const lag = mind.perceptionLagMs;               // tier base, DDA-adjusted (e.g. 90 ms)
const seen = buffer.at(obs.t - lag / 1000);     // world as the AI "sees" it

// Event detectors run on `seen`, not on `obs`.
// attackOnset: opponent EE speed toward our guard volume > 0.35 m/s for ≥ 40 ms
//              OR opponent EE rising above z 0.24 with speed > 0.3 m/s (slam windup)
// whiff:       opponent attack active phase ended with no contact event, and its EE
//              is beyond our midline (ego x < 0.32) with outward velocity < 0.1 m/s
// feintSuspect: attackOnset followed by EE decel to < 0.1 m/s within 120 ms
for (const ev of detectors.run(seen)) {
  ev.releaseAt = obs.t + exGaussian(rng, tier.rt.mu, tier.rt.sigma, tier.rt.tau) / 1000;
  pending.push(ev);  // the decision layer only sees events whose releaseAt ≤ now
}
```

Ex-Gaussian sampler, deterministic from a seeded RNG:

```js
export function exGaussian(rng, mu, sigma, tau) {
  const u1 = Math.max(rng(), 1e-12), u2 = rng();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const expo = -tau * Math.log(Math.max(rng(), 1e-12));
  return Math.max(120, mu + sigma * gauss + expo);   // physiological floor
}
```

Two ways to act faster than a reaction, both human:
1. **Anticipation (reads).** If the opponent model predicts the next player action
   with probability `p ≥ tier.readThreshold`, the AI can pre-commit a counter
   before the event happens. The harness logs it as an `anticipation`, not a
   reaction (§8).
2. **Pre-loaded reactions.** In `NEUTRAL` with the guard up, a *block* (not a
   punish) uses `mu × 0.8`. Humans who are "waiting for it" are faster.

**Opponent model (habit reader).** Detected player actions are discretized into a
small alphabet: `J` jab/poke, `S` slam, `H` hook/sweep, `G` guard hold, `F` feint,
`T` throw/cube grab, `A` advance, `R` retreat. The model keeps order-1 and order-2
Markov counts with exponential decay (half-life ≈ 20 events), plus
situation-conditioned counts keyed on `{afterBlocked, afterHit, afterWhiff}`.
Prediction is `P(next | last two, situation)` with Laplace smoothing.
Sirlin's layer-3 cap is used directly: for predicted action X, the selector gets
bonus utility for `counter(X)` and a smaller bonus for `counter(counter(X))` when
the model has seen the player *adapt* (switch after being countered twice).

### 2.4 Mind: mood that shifts with score, health, and time

State (all in [0,1], low-passed with time constant `τ_mood` per personality):

- `aggression`: target = `base + wHealth·(myHP − oppHP) + wScore·scoreDiff + wClock·clutch + wTilt·recentHitsTaken`
  (the sign of `wTilt` is per personality: tilt-prone archetypes get **more**
  aggressive when hit, composed ones get **less**)
- `composure`: drops on strikes taken and bitten feints, recovers during quiet.
  Low composure adds execution noise and shortens think time (panic).
- `focus`: rises during long exchanges, falls in idle. Scales reaction μ by
  `1 − 0.08·focus`.

`clutch` = 1 in the last 10 s of a close round. `desperation` = `oppHP − myHP > 40`.
Both push toward high-risk, high-reward primitives (slam, throw). That reads as
drama, not randomness.

### 2.5 Decision: utility selector

Every think tick in `NEUTRAL`:

```
score(a) = weight_personality(a)
         × Π considerations_a(curves)           // IAUS product
         × compensation(n_considerations)       // Dave Mark's make-up factor
         × novelty(a)                           // e^(−uses_in_last_10s / 2)
         × readBonus(a)                         // opponent-model counter bonus
choice   = softmax_sample(scores, temperature = personality.temp × (1.3 − composure·0.6))
```

Softmax sampling is how Killer Instinct's "sometimes pick lower-ranked" gets
generalized. Temperature is the personality's unpredictability.

Considerations, with inputs normalized to [0,1] and curves as (type, params):

| Action | Considerations (all multiplied) |
|---|---|
| `JAB` | inReach(dist from my EE to opp forearm point; logistic centred 0.16 m, falling) · oppNotActive (1 − oppAttackPhase∈{active}) · aggression^0.7 · safety(1 − threat) |
| `POKE` (short, can't be reacted to) | inReach(logistic centred 0.09 m) · oppExtended (opp EE ego x < 0.36) · aggression^0.5 |
| `HOOK` | lateralOpening(opp EE |y| offset from my guard line; linear) · inReach(radius) · (1 − oppGuardHigh) · aggression |
| `SLAM` | oppRecovering OR oppLowGuard · whiffWindow · aggression² · desperation boost · clutch boost |
| `WHIFF_PUNISH` (uses JAB or SLAM motor) | pendingEvent(whiff released) · windowRemaining(opp recover ms left > my move t90; step) · tier.punishProb gate |
| `GUARD` / `PARRY` | threat(pending attackOnset released; step) · (1 − aggression)^0.5. PARRY also needs composure > 0.5 and tier.parry |
| `FEINT` | personality.feintRate · oppReactsToWindups (model: P(player blocks within 300 ms of our windup)) · aggression |
| `GRAB_THROW` | cubeNear(cube within 0.06 m of reachable low zone; logistic) · (1 − threat) · personality.throwAffinity · oppDistracted (opp EE low or retreating) |
| `ADVANCE` / `RETREAT` / `CIRCLE` | spacingError(my guard x vs personality.preferredRange; ± curve) · rhythm (RESET_SPACING bias) |
| `SHOWBOAT` | justLandedBig (event within 600 ms, force ≥ p90) · (1 − threat) · personality.showboat |
| `IDLE_SWAY` | constant 0.05 floor, so the AI is never frozen |

`threat` = logistic of (opp EE closing speed toward my guard volume × proximity).
It feeds both GUARD (up) and the risky attacks (down).

### 2.6 Motor: primitives in task space

All coordinates are in the **ego frame** (§5.1): +x toward the opponent from our
base, +z up, meters. The midline is x = 0.32. Each primitive is data:

```js
/** @typedef {{ x:number, y:number, z:number, pitch?:number, roll?:number, grip?:number }} Key */
export const JAB = {
  id: "jab", cancelable: true, cancelWindow: 0.7, damageClass: "light",
  phases: [
    { name: "windup",  ms: [70, 110],  to: ({ guard }) => ({ ...guard, x: guard.x - 0.025, z: guard.z + 0.01 }) },
    { name: "active",  ms: [110, 150], to: ({ aim }) => ({ ...aim, x: aim.x + 0.03 }) },   // overshoot = "punch through"
    { name: "follow",  ms: [60, 90],   to: ({ aim }) => ({ ...aim, x: aim.x + 0.03 }) },
    { name: "recover", ms: [160, 240], to: ({ guard }) => guard },
  ],
};
```

`aim` is the **predicted** opponent contact point at `t + activeMs`, from the
perceived (lagged) opponent EE and forearm midpoint, extrapolated at constant
velocity and clamped to reach (≤ 0.47 m radial).

Primitive library (durations are at tier "Contender", before personality and noise):

| Primitive | Keyframes (ego) | Phases (ms) | Notes |
|---|---|---|---|
| **GUARD** | EE (0.20, y_track, 0.15), pitch −0.3, grip closed 0.04 | continuous | `y_track` follows opp EE y with gain 0.6 and a 150 ms lag. The forearm presents across the attack line. |
| **PARRY** | from guard, lateral snap ±0.05 m in y toward the incoming EE path, z +0.02 | 90 active / 150 recover | Intended to register as the faster side (see §0.2.5) |
| **POKE** | guard → x + 0.07 | 40 / 70 / 30 / 120 | Can't be reacted to. Low damage. Used to test the guard. |
| **JAB** | guard → aim + 0.03 overshoot | 90 / 130 / 75 / 200 | Main tool |
| **HOOK / SWEEP** | pan out to ±0.9 rad at r = 0.36 m, z 0.10 → sweep through to ∓0.4 | 220 / 180 / 80 / 300 | Mostly joint-space on pan with IK holding the radius. Also clears cubes from the midline. |
| **SLAM** | (0.18, y_aim, 0.30) pitch −1.2 → (aim.x, aim.y, 0.03) | 330 / 150 / 60 / 450 | Big telegraph, big damage. The long recovery is where whiffs get punished. |
| **FEINT(x)** | runs windup of JAB or SLAM to 40–70% then cancels to GUARD or chains into the other | windup × 0.55 then 120 back | "Bitten" is detected when the opponent's guard or parry started during the feint (logged) |
| **GRAB_THROW** | approach (cube.x, cube.y, 0.08) open 1.15 → descend z 0.025 → close 0.04 (hold 120 ms) → lift z 0.16 → fling: pan and elbow extend toward opp EE, release grip at EE speed ≥ 0.9 m/s with velocity pointing within 20° of target | 350 / 250 / 200 / 300 | Cubes are 0.08 kg, 4 cm. A thrown cube is a projectile. Whether cube hits deal damage is a combat-track decision; the harness logs `cube_hit` events either way. |
| **BIND** | press the forearm onto opp forearm with 1 to 2 cm of penetration target, hold | 300 to 800 hold | Pins a committed arm. Creates a "block" contact with sustained force. |
| **ADVANCE / RETREAT** | guard.x ± 0.04 to 0.06 | 180 to 260 | "Footwork." Arms can't walk, so spacing is guard radius. |
| **CIRCLE** | guard pan ± 0.15 to 0.3 rad | 250 to 400 | Changes the attack line |
| **RATTLED** | guard.x − 0.06, z + 0.04, pitch up | 150 to 350 | Automatic on a heavy hit |
| **SHOWBOAT** | gripper open/close twice at 3 Hz, then slow raise and re-guard | 400 to 900 | Gives the player a free opening |
| **IDLE_SWAY** | ±(5–15 mm) Lissajous on the guard at 0.3 to 0.6 Hz | continuous | Never perfectly still |

**Path generation.** Between keyframes, use **minimum-jerk** interpolation in task
space (Flash & Hogan profile `s = 10τ³ − 15τ⁴ + 6τ⁵`). Solve IK every policy step
and send the IK result as the joint target. Because the servos saturate
(§0.1), a target far ahead of the arm means "full speed." For attacks, the solver
therefore **leads** the path by `leadMs` (40 to 80 ms, per primitive). Guard and
footwork track the path tightly (leadMs = 0) and look smooth and deliberate.

**Execution noise, sampled once per primitive instance:**

```js
const speed = pathLength / activeSeconds;                           // m/s demanded
const sigmaPos = tier.noise.posBase + tier.noise.posK * speed;      // Harris & Wolpert: grows with speed
aimOffset = gaussian3(rng, sigmaPos * (1.4 - composure * 0.6));
durationScale = Math.exp(gaussian(rng, 0, tier.noise.timeCV));     // log-normal
windupExtra = personality.telegraph * rng();                        // some personalities telegraph more
```

Add a slow Ornstein–Uhlenbeck drift on the guard pose (θ = 2/s, σ = 4 mm) for
"hand tremor." Nothing else is random per tick.

### 2.7 IK inside the Worker

The Worker has no MuJoCo. Ship `so101-kinematics.mjs`:

- **FK**: the chain of fixed transforms taken from `so101.xml` (body `pos` and
  `quat` for shoulder, upper_arm, lower_arm, wrist, gripper, then the
  `gripperframe` site offset (0.012, −0.000218, −0.098127) with quat (1,0,1,0)),
  each followed by a rotation about local z by the joint angle. That's 6 matrix
  multiplies, microseconds.
- **Test**: `tests/so101-kinematics.test.mjs` samples 1,000 random joint vectors
  and asserts the analytic FK matches `data.site_xpos` for `atlas_gripperframe`
  (minus the mount offset) within 1e-6 m, using the same Node MuJoCo loader as
  `tests/mujoco-duel.test.mjs`.
- **IK**: reuse `solvePositionIK` (it takes a `positionFor` callback) with the
  analytic FK, extended to a 4-row task (x, y, z, tool pitch). Tool pitch is
  approximately `shoulder_lift + elbow_flex + wrist_flex` plus a constant; measure
  the constant with FK. Warm-start from the previous solution. Budget: 12
  iterations × 5 FK calls ≈ 0.1 ms.
- Output is clamped to `JOINT_CONTROLS` limits with a 0.01 rad margin, so the
  built-in AI **never** registers a joint-limit violation. That makes it a useful
  control in the stats panel.

### 2.8 Difficulty tiers

| Knob | Rookie | Contender | Pro | Champion |
|---|---|---|---|---|
| Reaction ex-Gaussian μ / σ / τ (ms) | 330 / 45 / 140 | 260 / 35 / 90 | 215 / 28 / 55 | 185 / 22 / 35 |
| Perception lag (ms, included in reaction) | 110 | 90 | 70 | 60 |
| Think interval (ms) | 160 | 110 | 90 | 80 |
| Position noise base / per m/s (mm) | 14 / 18 | 9 / 12 | 6 / 8 | 4 / 6 |
| Timing CV | 0.18 | 0.12 | 0.08 | 0.06 |
| Whiff-punish probability | 0.25 | 0.5 | 0.75 | 0.9 |
| Feint recognition (P not bitten) | 0.1 | 0.35 | 0.6 | 0.75 |
| Read threshold (anticipation) | never | 0.75 | 0.6 | 0.5 |
| Opponent-model memory half-life | 8 events | 15 | 25 | 40 |
| Uses PARRY / BIND | no / no | yes / no | yes / yes | yes / yes |
| Recover-phase scale | 1.3 | 1.1 | 1.0 | 0.95 |
| Softmax temperature multiplier | 1.4 | 1.0 | 0.8 | 0.7 |
| DDA band (± fraction of the tier's values) | ±25% | ±15% | ±10% | 0 (off) |

Rookie also gets **characteristic mistakes**: it drops the guard for 300 ms after
landing a hit (celebrating), repeats its last successful action with a +50%
utility bonus (so it's readable), and bites most feints. These mistakes are
learnable, and learning to exploit them is where the fun comes from.

Reaction floors: Champion's median of about 205 ms is above the human-gamer
median. Its edge comes from **reads, spacing, and punish rate**, not superhuman
reflexes. That's what separates "good opponent" from "aimbot."

### 2.9 Invisible dynamic difficulty (live play only)

- **Signal**: an exchange-level performance estimate
  `perf = EMA( (dmgDealt − dmgTaken) / (dmgDealt + dmgTaken + 10) )`, updated only
  at the **end of an exchange** (≥ 600 ms with no contact). Target `perf ≈ +0.05`
  for the AI, meaning the player loses slightly more exchanges than they win but
  wins often enough to stay.
- **Actuation**: one scalar `k ∈ [−1, 1]` changes by at most ±0.1 per exchange and
  is mapped to the tier's DDA band on: reaction μ, perception lag, punish
  probability, feint recognition, softmax temperature, and slam telegraph length.
  **Never** on torque, servo gains, reach, IK, or damage numbers. The player can
  never observe a physical difference.
- **Freeze rules**: no change during an exchange, none in the final 10 s of a
  deciding round (comebacks have to be earned), and off entirely in eval mode,
  replay, or the Champion tier.
- **Log**: `k` is written to the episode record every exchange (`events: dda`), so
  playtests can check that DDA isn't hiding a balance problem.

Per Hunicke, being noticed is the failure mode. A playtest check: blinded players
rate "did it go easy on you?" on DDA-on and DDA-off builds. If they can tell,
shrink the band.

### 2.10 Three personalities

These are original contestant names for the built-in roster. They're usable with
any tier, and they're data (`personalities.mjs`), not code branches.

**KESTREL, the pressure fighter.** Small, fast, doesn't stop. Wants to be in your
face at x ≈ 0.26 (ahead of the midline zone) and wins through volume.
- Weights: POKE 1.4, JAB 1.3, FEINT 1.2, HOOK 0.9, SLAM 0.5, GRAB_THROW 0.3, GUARD 0.7, SHOWBOAT 0.8
- Base aggression 0.75. **Tilt: gets angrier when hit** (wTilt +0.25). τ_mood 4 s.
- Telegraph low (windup × 0.85). Execution noise × 1.15, so it misses from haste.
- Temperature 1.1. Novelty decay strong, so it keeps mixing things up.
- Characteristic weakness: over-commits after a blocked jab (30% chance of chaining
  straight into a second jab without re-checking threat). Readable and punishable.

**BASALT, the counter-puncher.** Heavy, patient, calm. Sits back at x ≈ 0.18,
guards, waits for a whiff, then slams.
- Weights: GUARD 1.5, PARRY 1.3, WHIFF_PUNISH 1.6, SLAM 1.3, BIND 1.2, JAB 0.7, FEINT 0.3, POKE 0.4
- Base aggression 0.3. **Composed: hits make it more cautious** (wTilt −0.15). τ_mood 8 s.
- Execution noise × 0.8, reaction μ + 15 ms (slower but precise). Slams have
  windup × 1.15 (a readable "heavy" feel).
- Temperature 0.7 (predictable but solid).
- Characteristic weakness: bites feints often (feint recognition × 0.6) because
  it's hungry for whiffs. Short pokes can bait out a slam. Also slow to react to
  cube throws.

**MAGPIE, the trickster opportunist.** Spacing games, feints, and cube theft. It
fights at the edge of reach (x ≈ 0.22, lots of CIRCLE) and throws cubes when you
over-guard.
- Weights: FEINT 1.5, GRAB_THROW 1.6, CIRCLE 1.4, HOOK 1.2, JAB 0.9, SLAM 0.7, GUARD 0.9, SHOWBOAT 1.3
- Base aggression 0.5. Mood swings with **score** more than health (wScore
  doubled). τ_mood 5 s.
- Opponent model weight × 1.5, half-life × 1.3: the best reader. Switches its
  game plan between rounds (the top-weighted action for the next round is
  re-rolled toward what the player handled worst).
- Temperature 1.3.
- Characteristic weakness: fragile under pressure. Composure drops 2× faster, and
  once composure is below 0.3 it retreats and throws wild (noise × 1.6). Pressure
  from a KESTREL-style player beats it.

Visual identity belongs to the art track: a distinct accent colour per contestant,
a card, and an idle style (KESTREL bounces its sway at 0.6 Hz, BASALT is nearly
still at 0.3 Hz with deep breaths, MAGPIE circles).

### 2.11 Module layout and interface

```
public/policies/opponent/            ← same-origin ES modules (relative imports work in a module Worker)
  index.mjs          export policyName, reset(context), act(observation)
  rng.mjs            sfc32 + splitmix seeding, gaussian, exGaussian
  so101-kinematics.mjs  FK chain + DLS IK (position + pitch)
  perception.mjs     ring buffer, detectors, habit n-gram
  mind.mjs           mood, DDA
  decision.mjs       FSM + utility selector
  primitives.mjs     data table + min-jerk path + noise
  personalities.mjs  KESTREL, BASALT, MAGPIE
  tiers.mjs          Rookie…Champion
tests/opponent-*.test.mjs            unit tests against Node MuJoCo (FK parity, IK reach, determinism)
```

To load it, add `UploadedPolicyRunner.fromUrl(url, name)`. It does the same Worker
bootstrap but imports a same-origin URL instead of a Blob. (Blob-URL modules can't
resolve relative imports, which is why uploaded policies must be single files or
pre-bundled.) The **built-in AI goes through exactly the same runner, timeout, and
validation as a user model.**

`reset(context)` receives (§5.3) `{ schema, side, seed, config: { tier, personality, dda } }`.
`act()` returns either the legacy `number[6]` or:

```ts
{ action: number[6],
  debug?: { state: "NEUTRAL"|"COMMITTED"|..., primitive?: string, phase?: string,
            intent?: string, mood?: {aggression:number, composure:number, focus:number},
            utilities?: Record<string, number>, dda?: number } }
```

`debug` goes into the recording (`policy.debug` column, sparse) and drives an
optional "AI brain" overlay in replay. That overlay is a big help when tuning, and
it's also a good broadcast gimmick.

Compute cost per `act()` is well under 1 ms, so the 500 ms budget is irrelevant for
the built-in opponent. It exists for uploaded models.

---

## 3. Harness: running the user's model as the opponent (or as the player)

### 3.1 Slots

A match has two **seats**, `atlas` and `blaze`. Each seat has a **driver**:

| Driver | Source | Transport |
|---|---|---|
| `human` | keyboard/gamepad/first-person controls | main thread |
| `builtin` | `public/policies/opponent/index.mjs` + `{tier, personality}` | module Worker (same-origin URL) |
| `module` | uploaded `.js/.mjs` (single file, or bundled) | module Worker (Blob URL, as today) |
| `trajectory` | uploaded `.json` action list | main thread sampler (as today) |
| `bridge` | local Python/any-language server | WebSocket (preferred) or HTTP POST, via a proxy Worker |
| `replay` | a recorded episode's action column for that seat | main thread |

Every driver sits behind one interface:

```ts
interface SeatDriver {
  readonly kind: "human" | "builtin" | "module" | "trajectory" | "bridge" | "replay";
  readonly name: string;
  reset(ctx: ResetContext): Promise<void>;          // resolves when policy acknowledges
  request(obs: Observation): void;                  // non-blocking
  poll(): ActionResult | null;                       // latest completed response, if any
  dispose(): void;
}
type ActionResult = { tick: number; action: number[]; chunk?: number[][]; chunkHz?: number;
                      computeMs: number; debug?: unknown; status: "ok"|"late"|"timeout"|"error"|"clamped" };
```

Users typically pick the opponent in the UI: "Opponent: BASALT · Pro", or
"Opponent: my_act_v3.mjs", or "Opponent: Bridge ws://127.0.0.1:8765". Model vs
model is just both seats set to non-human drivers.

### 3.2 Fixed-step loop and the two timing modes

Replace the `setInterval(16)` loop with a fixed-timestep accumulator:

- **Physics**: 200 Hz (`timestep 0.005`), unchanged.
- **Control tick**: 50 Hz = 4 substeps. Actions are written to `ctrl` once per
  control tick.
- **Policy rate**: `decimation` control ticks per decision. The default is 2
  (25 Hz); allowed values are 1/2/5 (50/25/10 Hz). Each seat has its own.
- **Recording**: every control tick (50 Hz).
- `observation.t` = `data.time` (sim time). The UI's clock is also sim time. That
  fixes §0.2.1.

**Live mode** (human playing): the render loop runs the accumulator in real time.
A seat's request goes out at its decision tick. The result is applied at the first
control tick after it arrives. If it hasn't arrived by the next decision tick, the
seat holds the previous action and the step is logged `late`. After 500 ms without
a reply, the step is logged `timeout` and the seat holds its **last safe pose**
(today's behavior). The match continues. After 3 consecutive timeouts the seat is
flagged `disconnected`, and the round is forfeited in ranked or eval, but not in
casual play.

**Eval mode** (lockstep, deterministic):
1. At the decision tick, build obs → `request()` → **simulation pauses** until the
   response arrives or 500 ms of wall time pass.
2. The action takes effect after exactly `actionDelayTicks` control ticks
   (default 1 = 20 ms, configurable 0 to 5). This models inference latency
   **deterministically**, so results don't depend on how fast the laptop is.
3. A real timeout (> 500 ms wall) is still honoured, logged, and marks the episode
   `determinism: "broken-by-timeout"`.
4. Rendering is optional. Headless "turbo" mode runs as fast as the policies
   answer, and batch runs of N seeds happen here.
5. With a chunked response (`chunk` + `chunkHz`), the harness executes the chunk
   open-loop, re-sampled to 50 Hz, until the next decision tick. The rest of the
   chunk is discarded, matching how ACT-style policies are usually run. Optional
   `temporalEnsemble: true` blends overlapping chunks.

Optional CLI: `scripts/eval.mjs` runs the same loop in Node (MuJoCo WASM already
loads there, see `tests/mujoco-duel.test.mjs`). It supports `builtin`, `module`
(dynamic import), and `bridge` drivers, which gives CI and a training loop the
exact browser rules. Human and trajectory drivers are browser-only.

### 3.3 Determinism and seeds

- **Master seed** (uint32, shown in UI, copyable, included in share URLs as a
  **non-personal** match setting). Substreams come from SplitMix64:
  `physicsInit` (cube jitter, start-pose perturbation ±0.02 rad),
  `seat.atlas` and `seat.blaze` (passed to `reset` as `seed`), `dda` (live only),
  and `arena` (future hazards).
- Replace `Math.random()` in `MujocoEngine.reset` with the `physicsInit` stream.
- `rng.mjs` exports `sfc32`. Policies are **asked** to seed from `context.seed`. The
  harness can't force a user module to be deterministic, so it **verifies**
  instead (below).
- Every episode records a **provenance block**: `mj_versionString()`, SHA-256 of
  `arena.xml` + `so101.xml` (via `crypto.subtle.digest`), SHA-256 of the policy
  source (module text / JSON / bridge-reported hash), harness git commit
  (build-time env), schema versions, `navigator.userAgent`, mode, decimation,
  actionDelayTicks, and seed.
- **State checksums**: every 50 ticks, record `fnv1a(Float64Array(qpos) ∥ Float64Array(qvel))`.
- **Determinism check** button: re-run the episode in eval mode with the same seed
  and drivers, and compare checksums. It reports the first diverging tick. Two
  causes show up in practice: (a) the policy isn't seeded or reads wall time,
  (b) a cross-browser `Math.sin/exp` difference inside a JS policy (V8 vs
  SpiderMonkey). MuJoCo itself is deterministic for identical binaries and inputs.
  Same-browser reruns should match bit for bit.

---

## 4. Local bridge protocol (Python or any language)

### 4.1 Transport

- **WebSocket** `ws://127.0.0.1:<port>` (default 8765), JSON text frames. Loopback
  only. The UI refuses non-loopback hosts unless an "allow LAN" toggle is on, since
  observations can reveal what a user is testing.
- Optional **HTTP** fallback: `POST http://127.0.0.1:<port>/v1/{hello,reset,act}`
  with the same JSON bodies. The server must answer CORS for the app origin
  (`Access-Control-Allow-Origin: http://localhost:3000`).
- The browser side runs in a small proxy Worker, so the main loop's `SeatDriver`
  is identical for bridge and module drivers.
- Note: a page served over `https://` can't open `ws://` (mixed content). Run the
  app on `http://localhost` for bridge use, or give the server a local TLS cert.

### 4.2 Messages (protocol `roboarena.bridge/1`)

All messages carry `type`. Requests from the browser carry `id` (monotonic int).
Replies echo it.

```jsonc
// browser → server, on connect
{ "type": "hello", "id": 1, "protocol": "roboarena.bridge/1",
  "observation_schema": "roboarena.obs/2", "control_hz": 50, "decimation": 2,
  "joint_names": ["shoulder_pan","shoulder_lift","elbow_flex","wrist_flex","wrist_roll","gripper"],
  "joint_limits": [[-1.91986,1.91986],[-1.74533,1.74533],[-1.69,1.69],[-1.65806,1.65806],[-2.74385,2.74385],[-0.17453,1.74533]],
  "units": "rad", "formats": ["dict","flat"] }

// server → browser
{ "type": "hello_ok", "id": 1, "policy": { "name": "act_so101_v3", "version": "2026-09-10",
  "sha256": "…optional…" },
  "obs_format": "flat",                 // "dict" = full §5 object, "flat" = §5.2 vector only (smaller)
  "supports_chunks": true, "max_chunk": 50, "chunk_hz": 50 }

// browser → server, start of each episode/round
{ "type": "reset", "id": 2, "episode_id": "2026-09-16T18-02-11Z-7f3a", "round": 1,
  "seed": 3141592653, "side": "blaze", "context": { /* §5.3 ResetContext */ } }
// server → browser
{ "type": "reset_ok", "id": 2 }

// browser → server, each decision tick
{ "type": "act", "id": 57, "tick": 110, "t": 2.2, "obs": { /* §5.1 dict or */ },
  "state": [/* §5.2 flat float array, always included */] }
// server → browser
{ "type": "action", "id": 57, "action": [0.01,-0.4,0.9,-0.3,0.0,0.05] }
// or chunked
{ "type": "action", "id": 57, "chunk": [[…6…],[…6…]], "chunk_hz": 50, "info": { "entropy": 0.12 } }

// either direction
{ "type": "error", "id": 57, "message": "CUDA OOM", "fatal": false }
{ "type": "ping", "id": 58 }  →  { "type": "pong", "id": 58 }
{ "type": "bye" }
```

Rules:
- Answer each `act` with the same `id`. Stale ids are dropped and logged `late`.
- The time budget is 500 ms wall per `act`, as for Worker modules. Eval mode waits
  up to that long. Live mode doesn't wait.
- Actions are radians in the ego joint convention (identical for both seats,
  §5.1). Out-of-range values → `clamped` status plus a violation event (lenient)
  or a seat failure (strict).
- `info` is free-form and stored as the sparse `policy.info` column (≤ 4 KB per
  step).

### 4.3 Reference server (shipped as `tools/bridge/roboarena_bridge.py`)

```python
# pip install websockets numpy
import asyncio, json, numpy as np, websockets

class Policy:                      # replace with your model
    name = "zero_guard"
    def reset(self, seed, context): self.rng = np.random.default_rng(seed)
    def act(self, state: np.ndarray, obs: dict | None) -> list[float]:
        return [0.0, -1.15, 0.59, 1.43, 0.0, 0.05]   # a guard pose

async def serve(ws):
    policy = Policy()
    async for raw in ws:
        msg = json.loads(raw)
        t = msg["type"]
        if t == "hello":
            await ws.send(json.dumps({"type": "hello_ok", "id": msg["id"],
                "policy": {"name": policy.name, "version": "dev"},
                "obs_format": "flat", "supports_chunks": False}))
        elif t == "reset":
            policy.reset(msg["seed"], msg["context"])
            await ws.send(json.dumps({"type": "reset_ok", "id": msg["id"]}))
        elif t == "act":
            a = policy.act(np.asarray(msg["state"], dtype=np.float32), msg.get("obs"))
            await ws.send(json.dumps({"type": "action", "id": msg["id"], "action": list(map(float, a))}))
        elif t == "ping":
            await ws.send(json.dumps({"type": "pong", "id": msg["id"]}))

async def main():
    async with websockets.serve(serve, "127.0.0.1", 8765, max_size=2**22):
        await asyncio.Future()

asyncio.run(main())
```

A LeRobot-trained policy goes inside `Policy.act`. The one real trap is
**units and calibration**: LeRobot's SO-101 follower reports calibrated positions
named `shoulder_pan.pos` … `gripper.pos`
(https://huggingface.co/docs/lerobot/main/en/so101), which depending on config are
range-normalized or degrees, and the gripper is 0 to 100. The sim uses radians.
Ship `tools/bridge/calibration.py` with an explicit `sim_rad ↔ lerobot_units` map
per joint (sign, offset, scale), and make it the first thing the README tells
people to check. A policy that looks "insane" in the arena is usually a
calibration mismatch.

---

## 5. Observation schema `roboarena.obs/2`

### 5.1 Ego frame (the key design decision)

Every seat observes the world **from its own base**:

- Origin at its mount's base frame on the table plane.
- **+x points at the opponent's base**, +z up, +y = z × x (right-handed; +y is to
  the seat's left).
- Atlas: `p_ego = p_world − (−0.32, 0, 0)`.
  Blaze: `p_ego = Rz(π)·(p_world − (0.32, 0, 0))`, i.e. `(−(x−0.32), −y, z)`.
- Quaternions are rotated the same way. Velocities rotate but don't translate.
- **Joint angles need no transform**: both arms are the same model, and the mount
  rotation sits above `shoulder_pan`. Joint vectors are therefore directly
  comparable, and **one policy can play either seat.**
- The opponent's base is always at (0.64, 0, 0). The midline is x = 0.32.

### 5.2 Structured observation (dict)

```ts
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];     // w, x, y, z (MuJoCo order)

interface Observation {
  schema: "roboarena.obs/2";
  tick: number;                // control tick index since episode start
  t: number;                   // sim seconds since episode start (data.time − t0)
  dt: number;                  // seconds between this and the previous observation for this seat
  side: "atlas" | "blaze";     // informational only; the numbers are already ego-frame
  self: ArmState;
  opponent: ArmState;          // full-information game: the opponent's proprioception is visible
  cubes: { pos: Vec3; quat: Quat; linvel: Vec3; owner: "self" | "opponent" | "neutral"; held_by: "self" | "opponent" | null }[]; // length 9
  contacts: ContactEvent[];    // events finalized since this seat's previous observation (§0.2.4)
  active_contact: { touching: boolean; force: number; self_link: string; opponent_link: string } ;
  round: {
    index: number; best_of: number;            // e.g. 1 of 3
    phase: "countdown" | "fight" | "ko" | "time_up" | "round_over" | "match_over";
    time_remaining: number;                    // seconds, fight phase
    round_length: number;
    rounds_won: { self: number; opponent: number };
    score: { self: number; opponent: number }; // mode-dependent (cubes, points)
  };
  last_action: number[6];      // the target actually applied last control tick (after clamping/delay)
  status: { late_steps: number; clamped_steps: number };  // this seat's own health, so policies can self-diagnose
}

interface ArmState {
  q: number[6];                // joint positions, rad (qpos)
  qd: number[6];               // joint velocities, rad/s (qvel)
  tau: number[6];              // actuator forces, N·m (actuator_force); saturation = ±2.94
  ctrl: number[6];             // current servo targets
  ee: { pos: Vec3; quat: Quat; linvel: Vec3; angvel: Vec3 };   // gripperframe site, ego frame
  elbow_pos: Vec3;             // lower_arm body origin, a cheap second keypoint for spacing
  wrist_pos: Vec3;             // wrist body origin
  gripper_opening: number;     // = q[5]
  health: number;              // 0..health_max
  health_max: number;
  stamina: number | null;      // reserved for the combat track; null if unused
  stunned_ms: number;          // >0 if the game imposes a state; 0 today
}

interface ContactEvent {
  kind: "strike" | "block" | "cube_hit" | "table_hit";
  attacker: "self" | "opponent" | null;
  peak_force: number;          // N, max over the event
  peak_rel_speed: number;      // m/s, contact-point relative speed at peak
  normal_speed: number;        // m/s, relative velocity along contact normal (attacker into defender)
  pos: Vec3;                   // ego frame
  self_link: string; opponent_link: string;   // "gripper", "lower arm", …
  damage_to_self: number; damage_to_opponent: number;
  t_start: number; t_end: number;
}
```

`owner`, `score`, health, and damage are computed by the game rules (combat track).
The harness only moves them into this shape.

### 5.3 Flat state vector (`observation.state`, float32, length 64)

Used for ML policies, the bridge's `state` field, and LeRobot export. The order is
fixed. Names go in `meta.features["observation.state"].names`.

| Index | Name(s) | Notes |
|---|---|---|
| 0–5 | `self.q.{shoulder_pan,shoulder_lift,elbow_flex,wrist_flex,wrist_roll,gripper}` | rad |
| 6–11 | `self.qd.*` | rad/s |
| 12–17 | `opp.q.*` | rad |
| 18–23 | `opp.qd.*` | rad/s |
| 24–26 | `self.ee.pos.{x,y,z}` | ego m |
| 27–30 | `self.ee.quat.{w,x,y,z}` | |
| 31–33 | `self.ee.linvel.{x,y,z}` | m/s |
| 34–36 | `opp.ee.pos.{x,y,z}` | ego m |
| 37–40 | `opp.ee.quat.{w,x,y,z}` | |
| 41–43 | `opp.ee.linvel.{x,y,z}` | m/s |
| 44–46 | `opp.elbow_pos.{x,y,z}` | ego m |
| 47–52 | `self.tau.*` | N·m |
| 53 | `self.health_frac` | health / health_max |
| 54 | `opp.health_frac` | |
| 55 | `round.time_remaining_frac` | |
| 56 | `round.phase_is_fight` | 0/1 |
| 57 | `round.rounds_won_diff` | self − opp |
| 58 | `score_diff_norm` | (self − opp) / max(1, self + opp) |
| 59 | `contact.touching` | 0/1 |
| 60 | `contact.force` | N (current, not event) |
| 61 | `last_strike_age_s_self_hit` | seconds since self last struck opp, capped at 5 |
| 62 | `last_strike_age_s_self_taken` | seconds since self was last struck, capped at 5 |
| 63 | `self.stamina_frac` | 1.0 if unused |

`observation.environment_state` (float32, 9 × 7 = 63): cube `pos(3) + quat(4)` in
ego frame, ordered by cube index. This is LeRobot's conventional key for
non-proprioceptive state.

**Versioning.** `schema` is checked at `reset`. Keep `roboarena.obs/1` (today's
world-frame object) behind a compatibility flag for one release so existing
uploads keep working, then drop it.

### 5.4 ResetContext

```ts
interface ResetContext {
  schema: "roboarena.obs/2";
  protocol: "roboarena.policy/2";
  side: "atlas" | "blaze";
  seed: number;                                  // seat substream
  episode_id: string; round: number;
  control_hz: 50; decision_hz: number; action_delay_ticks: number;
  mode: "live" | "eval";
  strict_limits: boolean;
  joint_names: string[]; joint_limits: [number, number][];
  home_pose: number[6];                          // round-start guard pose (not START_POSE, see §0.1)
  arena: { opponent_base: [0.64, 0, 0]; midline_x: 0.32; zones: { self: {center: Vec3, radius: number}, opponent: {...} } };
  rules: { round_length: number; best_of: number; health_max: number; mode: string };
  config?: Record<string, unknown>;              // builtin: {tier, personality, dda}
}
```

---

## 6. Action contract (unchanged core, clarified)

- `number[6]` absolute joint **position targets** in radians, order
  `shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper`.
  They're written straight to MuJoCo `ctrl` (servo setpoints). The servo model does
  the rest: kp 998, kv 2.73, ±2.94 N·m.
- Optional chunk: `number[K][6]` at `chunk_hz` (K ≤ 100).
- Validation per step:
  - NaN or Infinity → `error` (strict: seat fails; lenient: hold last action).
  - Out of limits → `clamped` + `joint_limit_violation` event with the joint
    index and overshoot.
- No hidden smoothing or rate limiting of policy actions. **What the model outputs
  is what the servo gets.** Smoothness is measured (§8), never silently repaired.
  The human input path is separate and may shape its own targets.

---

## 7. Episode recording, export, and replay

### 7.1 What is recorded

At 50 Hz, every control tick, for both seats regardless of driver (a human is
recorded exactly like a model, which gives free teleop datasets):

- `timestamp`, `frame_index`, `episode_index`, `index` (LeRobot core columns)
- `observation.state.{atlas,blaze}`: float32[64], each ego-frame
- `observation.environment_state.{atlas,blaze}`: float32[63]
- `action.{atlas,blaze}`: float32[6], the **applied** target
- `action_raw.{atlas,blaze}`: float32[6], the **returned** target before clamp or
  hold (NaN where no new action arrived that tick)
- `policy.status.{seat}`: uint8 enum ok/held/late/timeout/clamped/error
- `policy.compute_ms.{seat}`: float32, on decision ticks
- `sim.qpos` float64[75], `sim.qvel` float64[66]: exact state for kinematic replay
- `sim.checksum` every 50 ticks
- `policy.debug.{seat}`, `policy.info.{seat}`: sparse `{frame_index, value}` lists

`events[]` is a time-ordered list:
`round_start, round_end, ko, time_up, strike, block, cube_hit, table_hit,
cube_score, attack_onset, whiff, feint, reaction, joint_limit_violation,
late_action, timeout, policy_error, disconnect, dda, pause, resume, human_input_device_change`.
Each has `{ t, frame_index, seat?, data }`.

`attack_onset`, `whiff`, `feint`, and `reaction` are **derived by the harness from
the trajectory with policy-agnostic detectors** (the same code as §2.3, run on
ground truth with no lag), so they're comparable across models. The built-in AI's
own intent labels live separately in `policy.debug`.

### 7.2 File format `roboarena.episode/1` (JSON, columnar)

```jsonc
{
  "format": "roboarena.episode/1",
  "meta": {
    "fps": 50, "robot_type": "so101_sim_mujoco", "codebase": "roboarena",
    "created": "2026-09-16T18:02:11Z", "episode_id": "…", "seed": 3141592653,
    "mode": "eval", "decimation": { "atlas": 2, "blaze": 2 }, "action_delay_ticks": 1,
    "provenance": { "mujoco": "3.12.0", "model_sha256": "…", "harness_commit": "…", "user_agent": "…" },
    "seats": {
      "atlas": { "driver": "human", "name": "You", "input": "gamepad" },
      "blaze": { "driver": "builtin", "name": "BASALT", "tier": "pro", "policy_sha256": "…" }
    },
    "rules": { "round_length": 60, "best_of": 3, "health_max": 100, "mode": "duel" },
    "features": {
      "observation.state": { "dtype": "float32", "shape": [64], "names": ["self.q.shoulder_pan", "…"] },
      "observation.environment_state": { "dtype": "float32", "shape": [63], "names": ["cube0.pos.x", "…"] },
      "action": { "dtype": "float32", "shape": [6],
        "names": ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"] }
    },
    "result": { "winner": "atlas", "rounds": [ { "winner": "atlas", "reason": "ko", "t_end": 41.2 } ] },
    "stats": { /* §8 computed at save; recomputable */ }
  },
  "columns": {
    "timestamp": [0, 0.02, …],
    "frame_index": [0, 1, …],
    "observation.state.atlas": [[…64…], …],
    "action.atlas": [[…6…], …],
    "sim.qpos": [[…75…], …]
    /* … */
  },
  "sparse": { "policy.debug.blaze": [ { "frame_index": 12, "value": { "primitive": "jab", "phase": "windup" } } ] },
  "events": [ { "t": 3.14, "frame_index": 157, "type": "strike", "seat": "atlas", "data": { "peak_force": 2.1, "damage": 12 } } ]
}
```

Size: a 3-round, 60 s match is 9,000 frames. With ~350 floats per frame that's
about 3.2M numbers. Floats are written with 5 significant digits (qpos keeps full
precision), and the file is saved as `.json.gz` via the browser-native
`CompressionStream("gzip")`, roughly 8 to 15 MB. Plain `.json` is an export
option. Saving goes through a normal Blob download in the local app. Recent
episodes are also kept in IndexedDB (capped at 1 GB, oldest evicted) so the stats
panel can aggregate without re-importing.

### 7.3 LeRobot export

LeRobot v3 datasets are Parquet shards plus `meta/info.json` (features, dtypes,
shapes, fps, path templates), `meta/stats.json`, `meta/tasks.jsonl`, and
`meta/episodes/`. Frames carry `observation.state`, `action`, `timestamp`,
`frame_index`, `episode_index`, and `index`.
(https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3)

The browser can't write Parquet cheaply, so ship
`tools/export/to_lerobot.py episode*.json.gz --seat blaze --out ./ds --units rad|lerobot`.
It uses `LeRobotDataset.create(...)`, `add_frame`, `save_episode`, and
`finalize()` (the docs warn that skipping `finalize` corrupts Parquet). Export is
**one dataset per seat** because LeRobot assumes one robot per frame. The
opponent's state stays in the ego `observation.state` vector, which is the natural
input for a fighting policy anyway. `task` is a string like
`"duel vs BASALT pro"`, so task-conditioned policies can use it.

### 7.4 Replay

Two replay modes, both on the recorded file:

1. **Kinematic replay (always exact).** Each frame, write `sim.qpos` into
   `data.qpos`, call `mj_forward`, and render. Scrub, 0.25× to 4× speed, frame
   step. The timeline shows event markers (strike = accent tick, block = neutral,
   whiff/feint = hollow, timeout = red). Clicking an event jumps to 1 s before it.
   Camera: free, either seat's first-person view, or broadcast. Overlays: the
   `policy.debug` "brain" panel, per-seat action vs actual joint plots, and
   contact force.
2. **Physics re-sim (verification).** Reset with the recorded seed and feed
   `action.{seat}` columns into the engine tick by tick. Compare `sim.checksum`.
   The result is either "Replay verified bit-exact" or "Diverged at t = 12.34 s
   (frame 617)". It also enables **"take over"**: pause a replay at any frame,
   restore state from `sim.qpos/qvel`, and play from there as a human against the
   recorded opponent's live policy. This is great for reproducing a policy failure
   by hand.

---

## 8. Stats panel: metrics and exact definitions

All stats are a **pure function of the episode file** (`src/lib/episode-stats.mjs`,
unit-tested), so a live match, an imported recording, and a Node CLI batch produce
identical numbers.

### 8.1 Per episode, per seat

| Metric | Definition |
|---|---|
| **Result** | round wins, match win/loss/draw, win reason (KO / time / forfeit) |
| **Strikes landed / taken** | count of `strike` events with `attacker = seat` / `attacker = other` |
| **Damage dealt / taken** | Σ `damage` on those events |
| **Attack attempts** | count of harness-detected `attack_onset` for the seat (EE speed toward opponent guard volume > 0.35 m/s sustained ≥ 40 ms, debounced 150 ms) |
| **Strike accuracy** | strikes landed / attack attempts |
| **Blocks** | `block` events during an opponent attack window (onset → +400 ms) where seat is defender |
| **Block rate** | attacks received that produced block and no strike / attacks received |
| **Whiffs** | attacks whose active window ended without a contact event, per the §2.3 detector |
| **Whiff punishes** | strikes landed ≤ 600 ms after an opponent `whiff` |
| **Reaction latency** | for each opponent `attack_onset` at t₀: the first t > t₀ where the seat's **applied action** changes by ‖Δa‖₂ > 0.08 rad within 60 ms in a direction that reduces the distance to the threat line, or EE acceleration > 3 m/s² away from it. Report median, p10, p90, n. Responses < 120 ms count as **anticipations** (reported separately, not in the median). No response within 800 ms counts as **no reaction**. |
| **Decision compute** | `policy.compute_ms` median / p99 / max |
| **Late actions / timeouts / errors** | counts from `policy.status`, and late fraction of decision ticks |
| **Joint-limit violations** | count of `clamped` steps, per joint, max overshoot (rad) |
| **Near-limit dwell** | fraction of ticks with any \|q − limit\| < 0.03 rad (strains real servos) |
| **Torque saturation** | fraction of ticks with any \|τ\| ≥ 0.98 × 2.94 N·m. A sim-to-real flag: STS3215s overheat when saturated for long. |
| **Action jerk** | on decision-rate actions aₖ with period h: `J = sqrt(mean_k ‖(a_{k+1} − 3a_k + 3a_{k−1} − a_{k−2}) / h³‖²)`, in rad/s³, per joint and total |
| **Action chatter** | sign changes of Δaₖ per joint per second, counting only \|Δa\| > 0.01 rad (catches bang-bang oscillation that jerk can mask) |
| **Executed smoothness** | log dimensionless jerk (LDLJ) of the EE path per attack: `−ln( (T³ / v_peak²) ∫ ‖d²v/dt²‖² dt )`, averaged. Higher (less negative) is smoother, and it's comparable across move lengths. |
| **Energy** | Σ \|τ · qd\| · dt (J) |
| **Table hits** | count of `table_hit` events with force > 3 N (a real arm would be damaged) |
| **Idle fraction** | fraction of time with ‖qd‖ < 0.05 rad/s and no contact |
| **Determinism** | verified / diverged at frame N / not checked |

### 8.2 Aggregate and compare

- **Scope filters**: model × opponent (built-in personality × tier, or another
  model) × seed set × mode.
- **Win rate** with a **Wilson 95% CI**. Draws count as half. Display is
  "63% (54–71) over 100 matches."
- **Benchmark suites** (fixed and versioned, e.g. `gauntlet-v1`): seeds 1 to 20 ×
  {KESTREL, BASALT, MAGPIE} × {Contender, Pro, Champion} × both seats =
  360 matches, eval mode, DDA off. Output is a 3 × 3 heatmap of win rate plus a
  summary rating: **Elo/Bradley–Terry fit with the built-in tiers as fixed
  anchors** (Rookie 800, Contender 1200, Pro 1500, Champion 1800). The anchors are
  frozen per suite version so ratings are comparable over time.
- **Side-by-side compare**: pick 2 to 4 models, and every metric gets a bar with
  CI. Differences whose CIs don't overlap are highlighted. Sort by "biggest
  difference" first.
- **Regression gate** (CLI): `scripts/eval.mjs --suite gauntlet-v1 --policy a.mjs --baseline results/b.json`
  exits non-zero if win rate drops by more than the CI half-width, or timeouts or
  violations rise.
- **Humanness report** (for tuning the built-in AI against human recordings): KS
  distance of reaction-latency distributions, action-jerk ratio, n-gram entropy of
  action categories, idle fraction. The built-in AI should sit inside the human
  range on all four.

### 8.3 Presentation

It's a broadcast-style card in the game UI, not a spreadsheet. Two contestant
cards face each other: big win rate, record, and rating, then 6 headline bars
(strikes, damage, block rate, reaction median, jerk, reliability = 1 − late −
timeout − violation fractions). "Details" expands into the full §8.1 table and
per-event lists that jump into replay. Styling follows the visual track's original
game-show language.

---

## 9. Build order

1. **Fixed-step loop + seeded RNG + sim-time clock** (fixes §0.2.1–3). Add a test
   that the same seed plus the same actions gives the same checksum.
2. **Contact events** finalized per event with peak force, normal speed, and damage
   hook (§0.2.4–5). Refactor `readContacts` to accumulate per `eventId`.
3. **Observation v2 + ego transform + flat vector.** Test that the Atlas and Blaze
   observations of a mirrored state are equal.
4. **SeatDriver + eval lockstep + lenient/strict validation.** Port `module` and
   `trajectory` drivers onto it.
5. **Recorder + JSON/gzip export + kinematic replay.**
6. **Analytic FK/IK + FK parity test.** Then the built-in opponent: perception →
   primitives (GUARD, JAB, SLAM first) → utility → the rest of the primitives →
   personalities → tiers → DDA.
7. **Stats module + panel.** Physics re-sim verification.
8. **Bridge** (WS proxy Worker + Python reference + calibration map), then the
   **Node CLI** and `gauntlet-v1`.
9. **LeRobot exporter.**

Steps 1 to 5 are harness work that also unblocks the human first-person game
(correct clock, events, damage). Step 6 is the part that decides whether the game
is fun. Tune it with replays plus the debug overlay, against recordings of real
human play captured by step 5.

---

## 10. Open questions for other tracks

- **Combat rules**: health model, damage formula from `peak_force` /
  `normal_speed` / link, stamina (y/n), whether cube hits damage. The schema
  reserves all of these.
- **Human controls**: whether the human's attack buttons should trigger **the same
  primitive library** (§2.6). Recommendation: yes, as an option. It makes human
  and AI symmetric, gives the player authored-feeling moves on bang-bang servos,
  and means a policy trained on human data learns the same move vocabulary.
- **Round-start pose**: replace `START_POSE` (grippers 2.2 cm apart) with a guard
  pose at ego x ≈ 0.20.
- **Parry attribution**: see §0.2.5.

## Sources

- Killer Instinct Shadow AI: https://www.gamedeveloper.com/programming/the-killer-groove-the-shadow-ai-of-killer-instinct , https://www.aiandgames.com/p/how-killer-instincts-shadow-mode
- Tekken 8 Super Ghost: https://en.bandainamcoent.eu/tekken/news/tekken-8-discover-about-super-ghost-battles , https://www.dexerto.com/tekken/tekken-8-players-blown-away-by-revolutionary-ghost-ai-system-that-can-copy-pros-2434093/
- FightingICE 15-frame delay: https://www.slideshare.net/ftgaic/2019-fighting-game-ai-competition
- Left 4 Dead AI Director: https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf
- Hunicke DDA: https://dl.acm.org/doi/10.1145/1178477.1178573 , https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf
- Infinite Axis Utility System: https://www.gameai.com/iaus.php , https://www.cloderic.com/content/2013-04-24-ai-summit-2013-takeaway
- Sirlin yomi layers: https://www.sirlin.net/ptw-book/7-spies-of-the-mind
- Ex-Gaussian reaction times: https://lindeloev.github.io/shiny-rt/ , https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2014.01548/full
- Signal-dependent motor noise: Harris & Wolpert, "Signal-dependent noise determines motor planning", Nature 394:780–784 (1998)
- THE FINALS facts: https://en.wikipedia.org/wiki/The_Finals , https://gamesbeat.com/embark-studios-unveils-the-finals-team-based-shooter-game/ , https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals , https://www.shacknews.com/article/149942/the-finals-season-11-features
- Embark ML locomotion (ARC Raiders): https://www.pcgamer.com/gaming-industry/arc-raiders-use-of-ai-highlights-the-tension-and-confusion-over-where-machine-learning-ends-and-generative-ai-begins/
- LeRobot dataset v3: https://huggingface.co/docs/lerobot/en/lerobot-dataset-v3 ; SO-101 feature names: https://huggingface.co/docs/lerobot/main/en/so101
