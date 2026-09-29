# First-person melee and cockpit feel: research and how to build it in our stack

Track: tech of feel. Sibling docs: `codebase.md` (what exists, exact loop timing) and `finals-feel.md` (event catalog, broadcast, match flow). This doc owns **the frame loop, camera, input latency, juice parameters, rendering and post-processing, and the performance budget**. Where it disagrees with a sibling doc, section 11 says so and explains why.

Stack facts verified on 2026-09-16 (local `node_modules` + npm registry):

| Package | Installed / latest | Peer requirements |
|---|---|---|
| `three` | 0.185.1 | |
| `@react-three/fiber` | 9.7.0 | |
| `@react-three/drei` | 10.7.8 | |
| `@mujoco/mujoco` | 3.12.0 installed (package.json asks `^3.13.0`) | |
| `postprocessing` | 6.39.5 (latest) | `three >= 0.168.0 < 0.187.0` ✔ |
| `@react-three/postprocessing` | 3.1.1 (latest) | `react ^19`, `three >= 0.156`, `postprocessing ^6.36.0`, `@react-three/fiber >= 9.7.0` ✔; deps `n8ao ^2`, `maath ^0.10.8` |

Install: `npm i postprocessing@6.39.5 @react-three/postprocessing@3.1.1`. Pin exactly: `postprocessing` caps three below 0.187, so a three bump to 0.187 must wait for a postprocessing release.

---

## 0. TL;DR

1. **The camera is intent, the arm is physics.** Our arms are torque-limited PD servos. I measured a 1 rad pan step in our model: 50% in 160 ms, 90% in 245 ms, peak 4.7 rad/s. That is a built-in Mordhau-style windup we should keep, not hide. So the *camera* must answer the mouse in the same frame (0 smoothing), and the arm visibly swings after it. That split is what makes a heavy weapon feel responsive instead of floaty.
2. **Replace the loop.** Drop `setInterval(16)` + 4 substeps (runs sim 1.25x fast) + React `setSnapshot` per tick + `lerp(exp(-14dt))` render smoothing (~70 ms of added visual lag). Use one `useFrame` fixed-step accumulator at 200 Hz, and interpolate `xpos`/`xquat` between the last two steps. Measured `mj_step` cost for our 2-arm + 9-cube scene: **0.069 ms** (Node 22 / V8, Apple M5). 3-4 steps per frame is ~0.3 ms even on an M1 Air. No Worker needed for physics.
3. **Render bodies straight from MuJoCo `xpos`/`xquat`**, not from our own joint forward kinematics. The pixels then match the contacts exactly, which matters for sparks and for a policy harness.
4. **Hit stop pauses the sim clock** (the policy sees no time pass). Block 50 ms, strike 67-133 ms scaled by impact, cap 150 ms. During the pause, the victim's rendered links vibrate (Sakurai), and the camera kick and sparks keep animating in wall time.
5. **Camera juice stays rotation-only** (Eiserloh: translation shake feels bad in 3D). Trauma² with Perlin/simplex noise at ~18-22 Hz, max 1.5° yaw/pitch, 2.5° roll. Plus a directional kick spring and an FOV punch spring. All of it is additive *after* the input-driven pose.
6. **Telegraph from physics, not animation.** Servo tracking error `|ctrl − qpos|` is known one physics step before the arm moves. Drive the opponent's servo LED emissive and the whine pitch from it. That tell is honest for any uploaded policy.
7. **Tone mapping: Khronos PBR Neutral** (`ToneMappingMode.NEUTRAL`) at exposure 1.0, applied at the end of the composer. The renderer itself runs `NoToneMapping` + sRGB output. Neutral keeps team colors on lit 3D surfaces close to the same hex in the DOM HUD. ACES, which R3F uses by default today, shifts oranges toward yellow.
8. **Post stack (one merged pass):** MSAA 4 on HalfFloat → Bloom (threshold 1.0, mipmap blur) → ChromaticAberration (0 at rest, impact-driven, radial) → Vignette → ToneMapping NEUTRAL → optional grain. No full-screen motion blur: use gripper smear ribbons instead. N8AO only on the high tier.
9. **60 fps on a MacBook Air:** DPR cap 1.5 with `PerformanceMonitor` stepping down to 1.0. Remove `ContactShadows` (it re-renders ~800k tris every frame). One tight 2048 PCF shadow map. Decimate the opponent arm and all shadow casters. Zero React renders per frame. Target p95 CPU ≤ 6 ms and GPU ≤ 9 ms, leaving thermal headroom on a fanless machine.
10. **Pointer Lock with `unadjustedMovement: true`**, accumulate `movementX/Y` from `pointerrawupdate` where available, and consume the latest deltas in the render frame for the camera and in each fixed step for servo targets. Motion-to-photon for the camera ≈ one display frame + compositor (≈ 20-35 ms).

---

## 1. What best-in-class games do (research), and what we take

### 1.1 THE FINALS (Embark Studios): style and feel facts we can cite

- Premise: a fictional VR combat game show in 2100, with holographic crowds and commentary. Embark named The Hunger Games, The Running Man and Gladiator as inspirations. Released 7 Dec 2023 on Unreal Engine 5. ([Wikipedia](https://en.wikipedia.org/wiki/The_Finals))
- Design pillars from Embark's creative and design directors, all framed as contrasts. **Appeal vs brutality:** pristine, inviting arenas that you then tear apart. **Realism vs stylization:** over-the-top play grounded in reality. **Chaos vs control:** sleek, uncluttered visuals so destruction stays readable. ([Meet the Makers: Direction and Design](https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design))
- Readability: the three body types differ drastically in height so you know at a glance what is attacking you. ([Meet the Makers: Character and Concept Art](https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Character_and_Concept_Art))
- Lighting: NVIDIA RTXGI recomputes light and shadow as buildings open up. Destruction runs server-side so every player sees the same result. ([NVIDIA](https://www.nvidia.com/en-us/geforce/news/the-finals-closed-beta-dlss-reflex-ray-tracing/), [VideoGamer on the engine](https://www.videogamer.com/guides/the-finals-game-engine/))
- Melee (Season 11, July 2026): **Precision hits** at the centre of the swing do more damage than glancing hits, and a dedicated crosshair shows the precision zone. Lunges reach ~4.5 m, cost stamina, and **each precision hit refills stamina immediately**; stamina otherwise regenerates in about 2 s. ([TechTimes](https://www.techtimes.com/articles/319995/20260709/finals-galaxy-masters-live-melee-gets-precision-stamina-systems.htm))
- Post-processing: the community reports chromatic aberration, film grain and motion blur with no full in-game off switch, and ships ini overrides to kill them. Treat this as community-sourced. ([Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3464978609), [games.gg settings guide](https://games.gg/the-finals/guides/the-finals-pc-graphics-settings-guide/))

**What we take (translated, not copied):**
- *Pristine then broken.* Start each round with spotless, high-key arena lighting. Let marks accumulate from physics: scuffs where links grind, cube tumble marks, spark scorch decals that persist all round. That is Nijman's "permanence" (1.4) applied to the Finals pillar.
- *Precision rewards feel.* Our physics already computes contact-point speed. Define a "clean hit" as strike speed ≥ threshold with contact on the opponent's distal links, and give it its own sound, flash and a stamina-like refund. It is the direct analogue of the precision zone, and it makes accuracy feel good.
- *Readability over realism.* Team-colored rim lighting on the opponent. A clean, uncluttered backdrop. Sparks as the loudest thing on screen.
- *Settings:* ship CA, grain and camera-motion sliders. Embark's players had to hack ini files for this, so we should do better.

### 1.2 Mordhau and Chivalry 2: first-person swings with weight

- Mordhau **drags and accels**: turning the camera against the swing slows it (hits late, past the parry), turning with it speeds it up. The feint window stays open until the last 50 ms of the windup. Ripostes skip the windup and have hyper-armor. ([Mordhau Wiki: Swing Manipulation](https://mordhau.fandom.com/wiki/Swing_Manipulation), [Combat](https://mordhau.fandom.com/wiki/Combat))
- Chivalry 2 splits an attack into Holding (a fixed **350 ms** for all weapons), Windup (no hitbox), Release (hitbox active) and Recovery. The riposte window is about **0.5 s**. Counters are perfect parries with no stamina loss. ([Chivalry 2 Wiki: Combat](https://chivalry2.fandom.com/wiki/Combat))

**Translation:** We get drags and accels *for free*, and honestly. The swing is a servo chasing a mouse-driven target, and the arm's contact speed decides strike vs block (`STRIKE_SPEED_THRESHOLD`). Flicking the mouse against a swing mid-flight really does slow the gripper. Don't add animation-driven swings. Do:
- Map mouse X to shoulder_pan target and mouse Y to lift/elbow (or to a task-space target via a fast IK with **no rate limit on the target**). The torque limit (2.94 Nm) is the real rate limiter, and it's the thing policies face too.
- Show the **commanded pose as a faint ghost** (optional, on by default in tutorial) so the player reads "I asked, it's coming". This is the cockpit equivalent of Chivalry's windup silhouette.
- A "feint" is simply reversing the target before contact. The servo whine rising and falling tells the opponent (and the player) what happened.

### 1.3 Titanfall 2 and Armored Core VI: being a machine

- Armored Core VI's ACS: each hit adds **Impact** to a posture bar. When it fills, the target is **staggered** and takes bonus "direct hit" damage. ([Armored Core Wiki: Stability/ACS](https://armoredcore.fandom.com/wiki/Attitude_Control_System), [Dot Esports](https://dotesports.com/armored-core/news/armored-core-6-what-are-stagger-and-impact-in-ac6))
- Titanfall 2 moves its HUD onto the titan's cockpit: diegetic, framed by the canopy, and part of the machine. ([Interface In Game: Titanfall 2](https://interfaceingame.com/games/titanfall-2/))

**Translation:**
- **Servo strain as posture.** We already have actuator forces (`data.actuator_force`, `qfrc_actuator`). A servo pinned at its torque limit while displaced from target is "overloaded". Accumulate strain from impact impulses plus saturation time. When it overflows, the servos go limp for ~400 ms (scale `kp` down in `model.actuator_gainprm` / `biasprm`, then restore). That is a physically real stagger a policy must handle, and it reads beautifully in first person: the view sags, the HUD flickers.
- **Cockpit HUD.** Draw the key readouts *on the machine*: servo temperature and strain bars as emissive decals on your own upper-arm housing (visible in the lower frame), and a round timer on a floating in-world panel above the table. Keep the DOM HUD for score, the announcer ticker and menus. See 4.7.

### 1.4 Juice canon: Vlambeer, Eiserloh, Sakurai

- Nijman's *Art of Screenshake* lists ~30 tricks. The core ones are hit pause (sleep a frame or a few on impact), camera kick, permanence (debris and shells stay), bigger impacts, and knockback. ([talk notes](http://notebook.maryrosecook.com/Theartofscreenshake,JanWillemNijman.html), [experiments write-up](https://www.bluetengu.com/2014/12/12/art-of-screenshake-experiments/))
- Eiserloh, GDC 2016 *Juicing Your Cameras With Math*:
  - Keep `trauma ∈ [0,1]`; hits add to it and it decays linearly. Shake = trauma² or trauma³.
  - Offsets = `max × shake × noise`. Use Perlin noise with a different seed per channel, which is smoother and survives pause and slow-motion.
  - In 3D, translational shake alone is "lame", so prefer rotational.
  - Smoothing by asymptotic averaging: `x += (target − x) × k`, scaled by time scale.
  ([transcript](https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt), [GDC Vault](https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing))
- Sakurai, *Thinking About Hitstop*: more damage gives longer hitstop, with a **hard cap**. Characters **vibrate** during the freeze (horizontal on ground, vertical in air), and the vibration decays through the freeze. The attacker keeps creeping forward imperceptibly. ([Source Gaming translation](https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/))
- Concrete numbers from Smash: Melee hitlag = `floor(d/3 + 3)` frames with a **20-frame cap**. Ultimate uses `(d·0.65 + 6)`-based frames, capped at 30. ([SmashWiki: Hitlag](https://www.ssbwiki.com/Hitlag))

### 1.5 Doom Eternal and Nidhogg: pacing and tension

- id's "push forward" design removes anything that makes the player retreat or wait. Resources come from aggression, so movement becomes damage becomes resources becomes movement. ([Game Developer](https://www.gamedeveloper.com/game-platforms/pushing-push-forward-combat-with-gameplay))
- Nidhogg holds the sword at three heights, and meeting the opponent's height disarms them. Messhof tuned it to play *slowly*, with players waiting for the other to commit, like Bushido Blade. ([Wikipedia](https://en.wikipedia.org/wiki/Nidhogg_(video_game)))

**Translation:** For a 1v1 duel we want Nidhogg's standoff *punctuated* by Doom-style bursts:
- **Stance heights** (low, mid, high guard) as hotkeys or scroll wheel that set the lift and elbow target band. A matching stance against an incoming strike turns it into a block. This emerges from geometry, with no rule needed.
- **Push forward:** the "clean hit" refund (1.1) and strain recovery on landing hits reward aggression. Turtling lets strain accumulate.

### 1.6 Latency and buffering numbers

- Claypool & Claypool: fast, precise first-person tasks should keep latency **≤ 100 ms**. Users notice latency from about 85 ms. ([Claypool, *Latency and player actions in online games*](https://web.cs.wpi.edu/~claypool/papers/precision-deadline/final.pdf))
- Street Fighter 6 buffers most moves up to **4 frames early** (a 5-frame window), dashes and wakeup reversals up to 7 frames, and quarter-circle motions over 11 frames. ([SuperCombo SF6 Game Data](https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data), [EventHubs breakdown](https://www.eventhubs.com/news/2023/jun/17/sf6-input-trouble-breakdown/))
- Browser: `requestPointerLock({ unadjustedMovement: true })` bypasses OS mouse acceleration and fixes Chrome's occasional huge-delta "teleport" bug. Chrome and Edge support it; others fall back. ([web.dev](https://web.dev/articles/disable-mouse-acceleration), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock))
- The `desynchronized` canvas hint skips compositor queueing for lower latency. ([Chrome for Developers](https://developer.chrome.com/blog/desynchronized)) It is aimed at 2D/ink apps. Test it with WebGL on macOS before relying on it, because it can cause tearing, and treat it as an experiment flag.
- Fixed timestep with interpolation: accumulate frame time, step a fixed `dt`, and render `lerp(prev, curr, alpha = accumulator/dt)`. ([Gaffer On Games: Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/))

---

## 2. Measurements from our actual model

Run in Node 22 against `public/models/robotstudio_so101/arena.xml`, on an Apple M5 (scripts in the session scratchpad; easy to re-run):

| Measurement | Result | Consequence |
|---|---|---|
| `mj_step` (2 arms, 9 cubes, 38 active contacts, nv=66, dt=5 ms) | **0.069 ms/step** | 200 Hz costs ~0.23 ms per 60 Hz frame. Expect ~2x on an M1 Air, so still under 0.5 ms. Physics stays on the main thread. |
| Reading 28 bodies' `xpos`/`xquat` | 0.005 ms | Free. Read every step. |
| Pan step 1.0 rad | t50 160 ms, t90 245 ms, peak 4.7 rad/s | This is the swing windup. A big haymaker takes ~¼ s. |
| Pan step 0.3 rad | t50 75 ms, t90 105 ms | Small corrections feel crisp. |
| Elbow step 0.8 rad | t50 155 ms, t90 240 ms | |
| Wrist flex step 0.8 rad | t50 125 ms, t90 195 ms, peak 4.9 rad/s | The wrist is the fastest "jab". Design light attacks around it. |
| Shoulder lift step +0.8 rad | t50 150 ms, **never reaches 90% within 1 s** | Lifting against gravity saturates torque. Overhead slams are slow to raise and fast to fall. That's a natural heavy attack, so keep it. |
| Visual STL triangles | 363k unique; ~400-450k per arm with the 5 repeated `sts3215` meshes | Two arms ≈ 0.8-0.9M tris per pass. Triangle count, not shading, is the GPU cost. |
| STL normals | `STLLoader` geometry is non-indexed, so `computeVertexNormals()` gives **flat facets** | The player's own arm fills the lower third of the screen in first person, so facets will show. See 5.6. |

---

## 3. The feel model: where every millisecond goes

### 3.1 Two response channels

```
mouse/stick ──► (A) CAMERA  aim yaw/pitch ── same render frame ──────────────► photons ≈ 1 frame
            └─► (B) SERVO TARGETS ── next 5 ms fixed step ──► PD servo ──► arm moves (75–250 ms by physics)
                                                          └─► instant cues: whine pitch, LED glow, ghost pose
```

- **(A) must be ≤ 1 frame.** Camera yaw is driven by the *aim* (the integral of mouse X), not the physical `shoulder_pan` angle. The body is fixed to the table, so the camera sits on the `shoulder` body's position and looks along the aim direction. Allow the aim to lead the physical pan by at most **±35°**. Past that the aim clamps, so you can't look behind your own arm and swing blind. When clamped, push a subtle 0.5° "strain" wobble.
- **(B) is honest physics.** Latency from input to torque is ≤ 5 ms (one fixed step). The visible swing takes as long as the servo takes. To keep that from feeling floaty, fire **instant feedback** in the same frame the target changes:
  1. servo whine onset and pitch proportional to tracking error (`arena-audio.mjs` already has motion energy; feed it `|ctrl − qpos|` instead, which leads motion)
  2. the servo LED on each motor housing brightens with its own error
  3. an optional ghost pose
  4. a tiny camera "lean" (≤ 0.6° roll) toward the commanded pan acceleration

### 3.2 Latency budget (60 Hz display, Chrome, macOS)

| Stage | Budget | How |
|---|---|---|
| OS input → JS event | 1-4 ms | `pointerrawupdate` (falls back to `pointermove`) accumulates `movementX/Y` into a ref. No React. |
| Event → consumed | ≤ 16.7 ms worst, ~8 avg | Camera reads the accumulator at the top of `useFrame` (priority −3). Each fixed step reads the latest aim when writing `ctrl`. |
| Fixed-step quantization | ≤ 5 ms | dt = 5 ms |
| Render interpolation delay | ≤ 5 ms | We render `lerp(prev, curr, α)`, i.e. up to one step in the past. The camera does **not** use this path. |
| Render + GPU | ≤ 16.7 ms | budget in §7 |
| Compositor + scanout | ~8-17 ms | Chrome's compositor. `desynchronized` is an experiment (1.6). |
| **Camera motion-to-photon** | **≈ 20-35 ms** | well under Claypool's 100 ms |
| **Arm first-visible-motion** | **≈ 30-45 ms** | Servo acceleration is high even when full travel takes 250 ms. The *onset* is fast. |

What we remove from today's path (see `codebase.md` §4 and §13): the `setInterval` beat against rAF, React reconciliation per tick, the `exp(-14·dt)` lerp (τ ≈ 71 ms), and the task-space IK target rate limit.

### 3.3 Input buffering (discrete actions)

Continuous aim is never buffered: it is consumed as the latest value. Discrete actions (grip toggle, stance change, "brace", round-start ready) go into a buffer:
- **100 ms** default window (~6 frames at 60 Hz, a little more lenient than SF6's 4-frame early buffer, since our actions resolve through physics)
- **150 ms** for actions pressed during hit stop, because the freeze eats visual time and players press through it

```ts
type Buffered = { action: Action; t: number }; // t = performance.now()
const BUFFER_MS = 100;
function consume(buf: Buffered[], canAct: (a: Action) => boolean, now: number) {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (now - b.t > (hitstopActive ? 150 : BUFFER_MS)) { buf.splice(i--, 1); continue; }
    if (canAct(b.action)) { buf.splice(i--, 1); return b.action; }
  }
  return null;
}
```

---

## 4. Juice spec (exact parameters)

Everything takes one normalized `magnitude ∈ [0,1]` from the combat event. Reuse `impactIntensity(force, kind)` from `arena-audio.mjs`, as `finals-feel.md` §4.1 proposes. A global **Camera motion** setting (0-100%) multiplies every camera channel in 4.2-4.4. A **Screen effects** setting scales CA, vignette pulse and speed lines. `prefers-reduced-motion` defaults both to 30%.

### 4.1 Hit stop and time dilation

| Event | Hit stop (wall ms) | Formula | Extra |
|---|---|---|---|
| Block (arm-arm, not strike) | 33-50 | `33 + 17·m` | only on contact *onset* (new `eventId`), not while grinding |
| Strike landed or received | 67-133 | `67 + 66·m` | victim link vibration, see below |
| Clean hit (1.1) | +17 | added | distinct sound layer |
| Stagger trigger (1.3) | 150 (cap) | fixed | then time scale 0.35 → 1.0 over 350 ms (ease-out cubic) |
| Round-winning hit | 150 | fixed | then 0.2x for 500 ms, ease back over 300 ms, audio low-pass 800 Hz and pitch −4 st during it |

- **Hard cap: 150 ms** for any single freeze. Merge freezes within 200 ms: `remaining = max(remaining, new)`, never summed (Sakurai's cap). At 60 Hz, 67 ms = 4 frames and 133 ms = 8 frames, in line with Melee's `d/3 + 3`.
- **What freezes:** the *sim clock* (no `mj_step`, so policies get no ticks), the render interpolation α, and the physics of spark particles.
- **What keeps running in wall time:** the camera kick spring and trauma decay (so the freeze *lands* on the camera), the impact flash envelope, UI, and audio.
- **Victim vibration** (Sakurai): during the freeze, offset the *rendered* group of the hit link and its children by `A·(1 − t/T)·sign(sin(2π·30·t))` along the contact normal (horizontal) with A = 1.5 mm world (≈3 mm render). Attacker side A/3. Render-only, so the sim is untouched.
- **Policy harness:** pausing the sim clock doesn't change any per-tick trajectory. An AI-vs-AI log with hit stop is bit-identical to one without, so it's safe there. Human vs AI is different: the freeze gives the human extra *wall-clock* reaction time. So "Harness (ranked)" caps hit stop at 50 ms and turns off time dilation. See §11.

### 4.2 Trauma shake (rotation only)

```ts
// per render frame, wall-clock dt (not sim dt)
trauma = Math.max(0, trauma - 1.6 * dt);          // linear decay: 1.0 → 0 in 0.625 s
const s = trauma * trauma;                          // Eiserloh: trauma²
const t = performance.now() / 1000;
yaw   = MAX_YAW   * s * noise1(SEED_Y, t * FREQ);   // noise1 ∈ [-1,1], simplex/Perlin
pitch = MAX_PITCH * s * noise1(SEED_P, t * FREQ);
roll  = MAX_ROLL  * s * noise1(SEED_R, t * FREQ);
```

| Param | Value | Why |
|---|---|---|
| `MAX_YAW`, `MAX_PITCH` | 1.5° | Anything over ~2° in first person reads as nausea and fights your aim. |
| `MAX_ROLL` | 2.5° | Roll doesn't disturb aim. It's the "robot got rattled" axis. |
| `FREQ` | 18 Hz (received), 24 Hz (dealt) | Higher reads as metallic buzz, lower as a heavy slam. |
| Trauma added | block 0.15 + 0.15m; strike received 0.30 + 0.40m; strike dealt 0.10 + 0.15m; stagger 0.6; servo saturated (per second held) +0.25 | clamp to 1 |
| Translation | **0** | Eiserloh (3D); it also avoids clipping into our own arm at 1 cm |

`noise1`: a 20-line 1D gradient noise, or `maath`'s noise (`maath` already arrives as a dependency of `@react-three/postprocessing`).

### 4.3 Directional kick (a critically damped spring)

A kick reads better than shake because it tells you where the hit came from. On receiving a strike, set the spring velocity so the view rotates *away* from the contact point:

```ts
// dir = contact point relative to camera, in camera space; kick axis = cross(forward, dir)
kickVel.addScaledVector(axisFromContact, THREE.MathUtils.degToRad(2 + 4 * m) * OMEGA);
// critically damped spring, integrated in wall time
const OMEGA = 22; // rad/s → settles in ~0.25 s, no overshoot
kickVel.addScaledVector(kickAng, -OMEGA * OMEGA * dt).multiplyScalar(Math.exp(-2 * OMEGA * dt)); // semi-implicit
kickAng.addScaledVector(kickVel, dt);
```

(Use the exact closed-form critically damped update if you want it framerate-perfect. The semi-implicit form above is stable at `dt ≤ 1/30`.) Peak displacement is about `2° + 4°·m`. On *dealing* a strike, apply a 0.8° recoil kick along pitch (toward the camera), so hits "push back" into your hands.

### 4.4 FOV punch

- Base vertical FOV **72°** (≈ 100° horizontal at 16:10 on a MacBook display). The player's own arm and the opponent both have to fit. The current 39° is a dashboard lens.
- A second spring on FOV (ω = 18):
  - dealt strike: **−2.5°·(0.5+m)** (punch in, emphasizing contact)
  - received strike: **+3°·m** (the world recoils away)
  - stagger: +5°
  - round win: −6° held through the slowdown
- Optional **ADS peek**: hold RMB to blend to the real `wrist_cam` (fovy 48.46°) over 120 ms, as a gripper's-eye scope for precise grabs. It needs roll compensation (the camera is rolled ~90° at the start pose, per `codebase.md` §8). Pure bonus, and a nice nod to the real hardware.

### 4.5 Chromatic aberration, vignette, flash

| Channel | Rest | On event | Decay |
|---|---|---|---|
| `ChromaticAberration.offset` (radialModulation, modulationOffset 0.25) | 0.0 | received strike: `0.0015 + 0.004·m`; stagger 0.006 | exponential, τ = 90 ms |
| `Vignette` darkness / offset | 0.40 / 0.30 | received strike: darkness +0.25·m | τ = 200 ms |
| Colored damage edge (DOM `radial-gradient` overlay, team-opponent tint) | opacity 0 | 0.35·m, from the hit side (left or right) | τ = 250 ms |
| Impact flash (existing `ImpactMarker` sphere and light) | | intensity ×1.5 in first person; make the sphere HDR (color × 6) so it blooms | existing envelope |

CA cost: `ChromaticAberrationEffect` adds 3 texture taps inside the merged effect pass. At offset 0 it still runs those taps (cheap). Keep it mounted, because mounting or unmounting effects recompiles the merged shader, and drive only the `offset` uniform.

### 4.6 Speed lines and smears (instead of motion blur)

- **No full-screen motion blur.** It costs a velocity buffer we don't have, and pmndrs `postprocessing` has no built-in per-object motion blur. It also blurs exactly the thing the player is tracking, which is why competitive players disable it (1.1).
- **Gripper smear ribbon:** keep the last 8 *interpolated* render positions of each arm's `gripperframe` site (read `site_xpos`). Draw a camera-facing triangle strip with alpha fading along its length, additive, HDR color ×2 team tint. Show it only when tip speed exceeds 0.9 m/s sim (≈1.85 render u/s), with width proportional to speed. Pure GPU buffer update, no allocations. (drei `<Trail>` works too, but it samples in its own `useFrame` and doesn't know about interpolation α. Write our own ~60 lines.)
- **Speed lines:** on a *dealt* clean hit or a stagger, show 90-140 ms of radial streaks in a screen-space overlay: an SVG or canvas2D layer above the WebGL canvas with 24 lines, inner radius 38% of the screen diagonal, opacity 0.35. No shader recompiles, and it can be tuned in CSS.

### 4.7 Viewmodel, sway, bob, cockpit

- **The player's own arm is the viewmodel, and it is never faked.** No sway or bob on the arm itself: it is physics, and it's the hitbox the opponent is striking.
- **Camera sway from real dynamics:**
  - roll = `clamp(−0.012 · panAccel_rad_s², ±3°)`
  - pitch = `clamp(0.006 · liftAccel, ±1.5°)`
  - Take the accelerations from `qacc` of the *physical* joints, low-passed with a one-pole filter at 12 Hz. This is secondary motion: it can lag, because it isn't the input path.
- **Idle life:** servo hum as 0.04° at 7 Hz noise while any servo error exceeds 0.02 rad. Otherwise nothing. Stillness makes the standoff tense (Nidhogg).
- **No head bob:** the base doesn't walk. If a future mode adds a mobile base, use bob only from base velocity, with ≤ 0.4° amplitude.
- **Cockpit diegesis:**
  - An emissive "strain" strip on your `upper_arm` housing (the lower frame of view). Map color from team → white → red as strain rises.
  - Opponent servo LEDs driven by *their* tracking error: the telegraph (§0.6).
  - A thin in-world round timer ring at the table centre.
  - The DOM HUD holds only score, timer text, announcer ticker and damage edge. Update it via refs at ≤ 20 Hz, with `textContent` writes and no React state.
- **Gamepad rumble** (Chrome supports it):

  ```ts
  pad.vibrationActuator?.playEffect("dual-rumble", {
    duration: 60 + 80 * m,
    strongMagnitude: received ? 0.5 + 0.5 * m : 0.2,
    weakMagnitude: 0.3 + 0.4 * m,
  })
  ```

  Fire on the event frame, not after hit stop.

### 4.8 Anticipation and telegraphing (both sides)

| Tell | Source signal | Lead time over visible motion | Honest for any policy? |
|---|---|---|---|
| Servo LED brightness per joint | `|ctrl_j − qpos_j|` (normalized by 1 rad) | 1 physics step, plus the ~30 ms before visible travel | ✔ (it's their command) |
| Whine pitch and gain | Σ error × `actuator_force` saturation | same | ✔ |
| Opponent "intent ghost" (training aid; off in ranked) | `ctrl` pose rendered as a 12%-opacity hologram | full servo latency (75-250 ms) | ✔ but too generous. Assist mode only. |
| Lift wind-up creak | shoulder_lift torque saturated for > 80 ms while rising | the overhead slam's natural ~300 ms raise | ✔ |

Our rule: **no animation-authored anticipation.** Physics already has a windup, and our job is to make it *visible and audible*.

---

## 5. Rendering: color, tone mapping, post-processing, lighting

### 5.1 Color management

- R3F 9 `Canvas` defaults (verified in `node_modules/@react-three/fiber`): `gl.outputColorSpace = SRGBColorSpace`, `gl.toneMapping = ACESFilmicToneMapping`. `THREE.ColorManagement.enabled` is true by default, so hex colors in JSX are treated as sRGB and converted to linear.
- With `<EffectComposer>`, `@react-three/postprocessing` forces `gl.toneMapping = NoToneMapping` (source: "threejs disallows tonemapping on render targets") and renders into a **HalfFloat** buffer. Tone mapping must then be an effect at the end. Set `<Canvas flat>` anyway so a composer-less fallback path stays consistent.
- Albedo textures (if we add decals or labels): `texture.colorSpace = SRGBColorSpace`. Data maps (normal, roughness, AO) stay `NoColorSpace`.
- The DOM HUD uses the same hex tokens as the 3D team colors. Under Neutral tone mapping at exposure 1, a diffuse surface lit to ~1.0 comes out at close to its authored hex, so `#ef6b42` in CSS matches the arm. Under ACES it doesn't.

### 5.2 Tone mapper choice

| Mapper | For us |
|---|---|
| ACES Filmic (current default) | Filmic contrast, but shifts saturated orange and red toward yellow and darkens mids. Team colors drift from the HUD. |
| AgX (`ToneMappingMode.AGX`) | Best at very bright emissive (sparks go gracefully to white). Desaturates mids noticeably, which reads a bit "grey film". Good A/B candidate for a moody arena variant. |
| **Khronos PBR Neutral (`ToneMappingMode.NEUTRAL`)** | Built for true-to-life base colors; it leaves colors below the highlight knee almost untouched and compresses only highlights. Fits a clean, high-key, bright game-show look with punchy team colors. **Pick this.** ([Khronos](https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products), [spec](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md)) |

`postprocessing` 6.39's `ToneMappingMode` enum: LINEAR 0, REINHARD 1, REINHARD2 2, REINHARD2_ADAPTIVE 3, UNCHARTED2 4, CINEON 5, ACES_FILMIC 6, AGX 7, NEUTRAL 8 (verified from source). Exposure: set `gl.toneMappingExposure = 1.0`. The effect reads the renderer's exposure. Tune lights, not exposure.

### 5.3 Post stack (one merged pass)

```tsx
import { EffectComposer, Bloom, ChromaticAberration, Vignette, ToneMapping, Noise, N8AO } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { HalfFloatType, Vector2 } from "three";

const caOffset = new Vector2(0, 0); // mutated by the juice system; never re-render React for it

<EffectComposer multisampling={tier.msaa /* 4 high/med, 0 low */} frameBufferType={HalfFloatType} enableNormalPass={false}>
  {tier.ao ? <N8AO halfRes aoRadius={0.35} intensity={2} distanceFalloff={1} quality="performance" /> : <></>}
  <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.08} intensity={0.7} radius={0.72} levels={tier.bloomLevels /* 6 high, 4 low */} />
  <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.25} />
  <Vignette ref={vignetteRef} offset={0.3} darkness={0.4} eskil={false} />
  <ToneMapping mode={ToneMappingMode.NEUTRAL} />
  {tier.grain ? <Noise premultiply opacity={0.025} blendFunction={BlendFunction.SOFT_LIGHT} /> : <></>}
</EffectComposer>
```

Notes:
- **Order:** bloom must see HDR values before tone mapping. CA and vignette are effectively LDR-independent. Grain goes last so it isn't tone-mapped. `EffectComposer` merges compatible effects into a single `EffectPass`, so everything except N8AO is **one fullscreen draw** plus bloom's mip chain.
- **Toggle by uniform, not by mounting.** Adding or removing an effect rebuilds the merged shader, a visible 50-200 ms hitch on first use. Tiers are chosen once at load or on `PerformanceMonitor` decline (with a short fade).
- **Bloom threshold 1.0** means only HDR emitters bloom: sparks, the flash, LEDs, smears. Set those materials' colors > 1 (e.g. `color.setRGB(6, 4.5, 2)`). The clean arena stays crisp, which matters for "sleek and uncluttered" (1.1).
- **MSAA 4, not SMAA.** The arms are thin, high-contrast silhouettes, and SMAA crawls on sub-pixel edges in motion. 8x (the composer default) is wasteful at DPR 1.5.
- **Alternative with no dependency:** three r185's `WebGLRenderer` has `outputBufferType: HalfFloatType` plus `renderer.setEffects([...passes])`, with tone mapping and color conversion applied automatically (verified in `node_modules/three/src/renderers/WebGLRenderer.js`). It takes `three/examples` passes, which aren't merged the way pmndrs effects are, so each effect is its own fullscreen draw. Use it only if `postprocessing` falls behind a future three bump.
- **The composer runs at `renderPriority` 1.** In R3F, any `useFrame` with a positive priority disables automatic rendering, and callbacks run in ascending priority order (R3F docs). So all our game logic must use priorities ≤ 0 (§6.2).

### 5.4 Lighting for a clean game-show arena

- Replace `ambientLight 1.45` (flat, kills form) with a `hemisphereLight` (sky `#fff6ea`, ground `#b9b3a6`, intensity 0.9) plus **one** key `directionalLight` (intensity 2.6, casts shadows) plus a drei `<Environment resolution={128} frames={1}>` built from `<Lightformer>` softboxes: two long strips overhead and one team-tinted rim on each side of the arena.
  - Lightformers are procedural, so there's no network fetch. drei's `preset` HDRs load from a CDN, which breaks "runs locally".
  - `frames={1}` bakes the env once. Re-bake only on round change (for "arena lights dim for overtime" moments).
- Materials: servo housings `roughness 0.35 metalness 0.2` (as now), 3D-printed parts `roughness 0.55`. The env map gives the specular strips that make the arms read as manufactured objects in close-up.
- Opponent rim: a fresnel term in `onBeforeCompile` on the opponent's accent materials (`emissive += team * pow(1 − dot(N,V), 3) * 0.6`). It's cheap and gives the silhouette readability THE FINALS emphasizes (1.1).

### 5.5 Shadows

- **Remove `ContactShadows`** in first person. It re-renders the whole scene (~0.8M tris) into a depth target every frame, then blurs. The real shadow map covers it.
- One directional light with `shadow-mapSize 2048`, orthographic shadow camera tightly fitted to the table (render-space ±1.0 × ±0.8), `shadow-bias -0.0004`, `shadow-normalBias 0.02`, `shadows="percentage"` (PCF), as today.
- Shadow casters use decimated geometry (5.6) via a `customDepthMaterial` trick, or a separate shadow-only mesh set with `layers`. Simplest: give each visual mesh an invisible low-poly twin with `castShadow` true, and set the visual mesh `castShadow` false.
- Drop `<Grid infiniteGrid>` and fog in first person. A textured, clean tabletop (subtle panel lines as a 1K texture) reads better up close and costs one sample.

### 5.6 Geometry (the biggest GPU lever)

1. **Smooth normals with creases:** after `STLLoader`, run `BufferGeometryUtils.mergeVertices(geom, 1e-4)` then `BufferGeometryUtils.toCreasedNormals(geom, THREE.MathUtils.degToRad(35))`. This removes the flat faceting (§2) and indexes the mesh (~2-3x fewer vertices uploaded).
2. **Decimate offline** with `meshoptimizer` (`npx gltfpack` or the `meshoptimizer` npm simplifier, both free and local):
   - own arm LOD0 = 100% (it's inches from the eye)
   - opponent arm = 35%
   - shadow twins = 15%
   Store the results as `.glb` with meshopt compression in `public/models/...`, and keep the STLs for MuJoCo collision and inertia.
3. **Instance or merge the 5 `sts3215` servo meshes per arm.** They're parented to different moving bodies, so use a merge per body rather than true instancing. Or accept the extra draws (~40 draw calls total is fine).
4. **Cache STL buffers once** and feed both the MuJoCo VFS and the parse (`codebase.md` §13.6).

---

## 6. Code patterns for R3F 9

### 6.1 Ownership

```
<Canvas flat dpr={dpr} gl={{ antialias: false, powerPreference: "high-performance", stencil: false, depth: true }}
        camera={{ fov: 72, near: 0.005, far: 12 }}>
  <GameLoop/>           // useFrame -3: input; -2: sim; -1: camera + juice    (no rendering)
  <ArenaWorld/>         // useFrame 0: bodies, sparks, smears read shared buffers
  <PostStack/>          // EffectComposer renderPriority 1 (renders)
</Canvas>
<HudOverlay/>           // DOM, subscribes to a 20 Hz store tick, never to the frame
```

- `antialias: false` on the context, because MSAA lives in the composer's render target. Leaving both on double-resolves.
- A module-level `game` object (plain TS, not React state) holds: engine, buffers, clock, input accumulators, event queue, juice state. Components get it via context or import. React state only for menus and round-level UI.

### 6.2 `useFrame` ordering

| Priority | Component | Job |
|---|---|---|
| −3 | `InputSampler` | read the pointer-delta accumulator, gamepad poll (move the existing gamepad rAF loop here), update aim yaw/pitch |
| −2 | `SimDriver` | hit stop and time scale, fixed-step accumulator, write ctrl, `mj_step`, swap state buffers, emit combat events |
| −1 | `CameraRig` + `JuiceSystem` | compose camera: anchor ⊕ aim ⊕ sway ⊕ kick ⊕ shake ⊕ FOV; update CA, vignette, flash uniforms |
| 0 | world components | apply interpolated body transforms, particles, smears |
| 1 | `EffectComposer` | render |

Because a positive priority exists (the composer), R3F won't auto-render. Everything ≤ 0 runs first, in order, every frame.

### 6.3 Fixed-step driver with interpolation (replaces `setInterval`)

```ts
const DT = 0.005, MAX_STEPS = 8;           // 40 ms of catch-up max; beyond that we drop time (never spiral)
const NB = model.nbody;
let prevPos = new Float64Array(NB * 3), currPos = new Float64Array(NB * 3);
let prevQuat = new Float64Array(NB * 4), currQuat = new Float64Array(NB * 4);

function readBodies(dst3: Float64Array, dst4: Float64Array) {
  dst3.set(data.xpos);   // fresh view each call: WASM memory can grow (views detach)
  dst4.set(data.xquat);  // MuJoCo order w,x,y,z
}

useFrame((_, frameDt) => {
  const c = game.clock;
  const wall = Math.min(frameDt, 0.1);      // tab-switch guard
  c.hitstop = Math.max(0, c.hitstop - wall);
  c.timeScale = c.dilation.sample(wall);    // eased curve, 1 when idle
  if (c.hitstop === 0) c.acc += wall * c.timeScale;

  let n = 0;
  while (c.acc >= DT && n < MAX_STEPS) {
    game.controls.writeCtrl(data.ctrl, c.simTime);   // human aim → targets; policy → targets (sim-time ticks)
    [prevPos, currPos] = [currPos, prevPos];
    [prevQuat, currQuat] = [currQuat, prevQuat];
    module.mj_step(model, data);
    readBodies(currPos, currQuat);
    game.combat.scan(data, c.simTime);               // per-step contact classify → queue events (no allocation)
    c.simTime += DT; c.acc -= DT; n++;
  }
  if (n === MAX_STEPS) c.acc = 0;
  c.alpha = c.hitstop > 0 ? c.alphaFrozen : c.acc / DT;
  if (c.hitstop === 0) c.alphaFrozen = c.alpha;

  for (const e of game.combat.drain()) game.juice.onEvent(e);  // may set c.hitstop for next frame
}, -2);
```

Rendering bodies (priority 0), with no per-frame allocation:

```ts
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
useFrame(() => {
  const a = game.clock.alpha;
  for (const { bodyId, group } of bodyGroups) {           // flat list, each group parented to the Z-up→Y-up root
    const i3 = bodyId * 3, i4 = bodyId * 4;
    group.position.set(
      prevPos[i3]   + (currPos[i3]   - prevPos[i3])   * a,
      prevPos[i3+1] + (currPos[i3+1] - prevPos[i3+1]) * a,
      prevPos[i3+2] + (currPos[i3+2] - prevPos[i3+2]) * a);
    _qa.set(prevQuat[i4+1], prevQuat[i4+2], prevQuat[i4+3], prevQuat[i4]);
    _qb.set(currQuat[i4+1], currQuat[i4+2], currQuat[i4+3], currQuat[i4]);
    group.quaternion.slerpQuaternions(_qa, _qb, a);
  }
}, 0);
```

- Build **one flat group per MuJoCo body** (not nested) and keep the existing MJCF *geom-local* transforms for the STL meshes inside each group. Body frames in `xpos`/`xquat` are the MJCF body frames, so the geom offsets from the XML stay valid. Don't mix `geom_xpos` with raw STL vertices: MuJoCo re-centers mesh geoms at compile time.
- Keep the world root `<group scale={2.05} rotation={[-Math.PI/2, 0, 0]}>` as today, so all sim-space math stays in metres.
- Policies: call on sim-time ticks inside the step loop (e.g. every 4th step = 50 Hz, configurable per policy), with a preallocated observation object. An async or remote policy must never block the loop. Hold the last action and log the tick delay (see `codebase.md` §4 item 4).

### 6.4 Input

```ts
async function lock(canvas: HTMLCanvasElement) {
  try { await canvas.requestPointerLock({ unadjustedMovement: true }); }
  catch { await canvas.requestPointerLock(); }  // Firefox/Safari or unsupported platform
}
const acc = { dx: 0, dy: 0 };
const onMove = (e: PointerEvent) => { acc.dx += e.movementX; acc.dy += e.movementY; };
canvas.addEventListener("onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove", onMove as EventListener, { passive: true });

// priority −3
useFrame(() => {
  const k = settings.sensitivityRadPerCount;             // default 0.0022 rad/count at 800 DPI-ish
  aim.yaw   -= acc.dx * k;  aim.pitch = clamp(aim.pitch - acc.dy * k * settings.invertY, -0.9, 0.6);
  acc.dx = acc.dy = 0;
  aim.yaw = clamp(aim.yaw, physPan - LEAD_MAX, physPan + LEAD_MAX); // LEAD_MAX = 35°
}, -3);
```

- Mapping aim to servos: `pan_target = aim.yaw`. Pitch plus the stance band sets a task-space reach point, solved by the existing position IK **once per fixed step** without the `stepTaskSpaceTarget` speed limit (keep a *distance* clamp to the reach envelope). If IK is too slow per step, solve at 50 Hz and hold. Servo lag hides the step.
- Gamepad: move polling into priority −3 and apply a response curve `sign(x)·|x|^1.8` with a 0.08 radial deadzone. Aim assist for stick only: 15% slowdown when the crosshair ray passes within 4° of the opponent's gripper.

### 6.5 Camera rig (zero-lag input path, smoothed secondary path)

```ts
const eye = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ");
useFrame((state, frameDt) => {
  const cam = state.camera as THREE.PerspectiveCamera;
  const dt = Math.min(frameDt, 1 / 30);
  // 1) anchor: interpolated shoulder body position (sim metres) → render space, + eye offset in aim-yaw frame
  bodyPosition(SHOULDER_ID, game.clock.alpha, eye);           // same lerp as bodies
  toRender(eye);                                              // ×2.05, (x,y,z)→(x,z,−y)
  eye.addScaledVector(up, EYE_UP).addScaledVector(backFromYaw(aim.yaw), EYE_BACK); // EYE_UP ≈ 0.30, EYE_BACK ≈ 0.22 render units
  // 2) orientation: aim (raw, unsmoothed) ⊕ sway (filtered) ⊕ kick (spring) ⊕ shake (noise)
  juice.update(dt);                                           // advances springs + trauma in WALL time
  e.set(aim.pitch + juice.pitch, aim.yaw + juice.yaw, juice.roll);
  cam.quaternion.setFromEuler(e);
  cam.position.copy(eye);
  // 3) lens
  const fov = settings.fov + juice.fovOffset;
  if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
}, -1);
```

Rules:
- **Nothing on the aim path is filtered.** Filters go only on the sway input (joint accelerations). Springs are additive offsets that return to zero, so they never delay where you're looking.
- The anchor position uses the same α interpolation as the bodies, so the camera never jitters relative to the arm it's mounted on. An un-interpolated camera on an interpolated arm gives 5 ms stair-stepping, which is visible at 120 Hz.
- Near plane 0.005 render units. Pull the eye back if the own `upper_arm` would intersect it: check the distance to the `upper_arm` body at the start pose range, and clamp `EYE_BACK`.
- Pause, menus, or losing pointer lock: freeze aim, keep the sim paused, and show a "click to resume" overlay. Never let `movementX` spikes in on re-lock (drop the first event after lock).

### 6.6 Zero React per frame

- The HUD reads `game.hud` (plain numbers) via a `setInterval(50)` or rAF throttle that writes `el.textContent` or `style.transform` directly. React only mounts it.
- Events that need React (round end, KO card) go through a tiny emitter that calls `setState` **at most a few times per round**.
- No `new Vector3/Quaternion/Color` inside `useFrame`, no array spreads, no `Array.from` in `snapshot()` on the hot path. Preallocate event objects in a ring buffer (size 32).

### 6.7 Juice state (sketch)

```ts
export class Juice {
  trauma = 0; hitstopReq = 0;
  kick = new CritSpring3(22); fov = new CritSpring1(18); roll = 0; pitch = 0; yaw = 0; fovOffset = 0;
  ca = 0; vig = 0; edge = 0;
  onEvent(e: CombatEvent) {
    const m = e.magnitude, mine = e.victim === "player";
    if (e.kind === "block" && e.onset) { this.addTrauma(0.15 + 0.15 * m); game.clock.hitstop = Math.max(game.clock.hitstop, (33 + 17 * m) / 1000); }
    if (e.kind === "strike") {
      game.clock.hitstop = Math.min(0.15, Math.max(game.clock.hitstop, (67 + 66 * m + (e.clean ? 17 : 0)) / 1000));
      if (mine) { this.addTrauma(0.3 + 0.4 * m); this.kick.impulseFrom(e.contactDirCam, deg(2 + 4 * m)); this.fov.impulse(3 * m); this.ca = 0.0015 + 0.004 * m; this.vig = 0.25 * m; this.edge = 0.35 * m; }
      else      { this.addTrauma(0.1 + 0.15 * m); this.kick.impulsePitch(deg(0.8)); this.fov.impulse(-2.5 * (0.5 + m)); }
      rumble(e, m); audio.hit(e);   // audio on the event frame, not after the freeze
    }
  }
  update(dt: number) { /* decay trauma 1.6/s, springs, exp decays τ: ca 0.09, vig 0.2, edge 0.25; write uniforms; compose yaw/pitch/roll */ }
}
```

---

## 7. Performance budget: 60 fps on a MacBook Air (M1-M4) in Chrome

Targets are p95 over a 10-minute session, **measured after 5 minutes** (a fanless Air throttles around then).

| Bucket | Budget | Notes |
|---|---|---|
| Input + sim (3-4 `mj_step` + contact scan) | **1.0 ms** | measured 0.07 ms/step on M5 → ~0.15 on M1; the contact walk is the larger half (`codebase.md` §13.4) |
| Policy inference (JS) | 1.0 ms at 50 Hz, amortized | heavier models go to a Worker with a 1-tick-late contract, logged |
| Scene update (body transforms, particles, smears, juice) | 1.0 ms | zero allocations; `renderer.info` check |
| Three.js render submission | 2.0 ms | ≤ 60 draw calls, ≤ 1.2M tris incl. shadows |
| **CPU total** | **≤ 6 ms** | leaves ~10 ms for GC, the browser and the compositor |
| GPU main pass at DPR 1.5, MSAA 4 | 5 ms | Air 13" viewport ≈ 1470×850 CSS → 2205×1275 px ≈ 2.8 MP |
| Shadow pass (decimated casters) | 1 ms | |
| Post (merged pass + bloom mips) | 2 ms | bloom at half res by default in mipmap mode |
| **GPU total** | **≤ 9 ms** | |

Quality tiers use drei `<PerformanceMonitor onDecline onIncline flipflops={3}>`. Don't use `<AdaptiveDpr>`: DPR changes mid-fight are visible. Step tiers only between rounds, unless fps stays below 50 for 2 s:

| Tier | DPR | MSAA | Bloom levels | AO | Shadow map | Grain | Opponent LOD |
|---|---|---|---|---|---|---|---|
| High (M-Pro, desktop GPU) | min(2, device) | 4 | 6 | N8AO half-res | 2048 | on | 60% |
| **Default (Air)** | 1.5 | 4 | 5 | off | 2048 | on | 35% |
| Low | 1.0 | 0, add the `SMAA` effect instead | 4 | off | 1024 | off | 20% |

Measurement kit:
- `stats-gl` (npm, free) for CPU/GPU ms with `EXT_disjoint_timer_query_webgl2`
- `gl.info.render.calls/triangles` in a debug overlay
- Chrome Performance panel with "Screenshots" plus the frames track to verify no dropped frames during hit stop (a common source of accidental hitches: shader compile on the first spark or first CA use; pre-warm with `gl.compile(scene, camera)` and one hidden spark burst during the round intro)

Other perf rules:
- `frameloop="always"` while in a round. `"demand"` in menus to save battery.
- Pre-compile every material variant at load (team tints, ghost, smear) with `renderer.compileAsync(scene, camera)` behind the loading screen.
- The Next.js page must be a client-only dynamic import (`ssr: false`) for the Canvas, as today.

---

## 8. Audio timing hooks (for the audio track)

- `new AudioContext({ latencyHint: "interactive" })`. Log `baseLatency + outputLatency` at startup: typically ~10-20 ms on macOS.
- Fire impact one-shots **on the event frame**, before the freeze. Hit stop is visual weight; sound must not wait.
- During dilation, scale `playbackRate` on looping servo beds by `timeScale^0.5` and sweep a low-pass (1.2 kHz → 20 kHz on release). One-shots stay unpitched so hits stay crisp.
- Servo whine frequency: `f = 180 Hz + 900 Hz × clamp(|ctrl−qpos|/0.6, 0, 1)` per arm, gain ∝ `|actuator_force|/2.94`. This is the audible telegraph from 4.8.

---

## 9. Implementation order (smallest steps that change how it feels)

1. `SimDriver` (6.3) + interpolated body rendering from `xpos`/`xquat`. Delete `setInterval`, `setSnapshot`-per-tick and joint lerps. *The single biggest jump in smoothness.*
2. First-person `CameraRig` (6.5) + pointer lock + unrate-limited targets (6.4). *Removes the floatiness.*
3. Servo LED / whine telegraph (4.8) + ghost pose toggle.
4. `Juice`: hit stop, trauma, kick, FOV (4.1-4.4).
5. Post stack + Neutral tone mapping + Lightformer environment, and remove ContactShadows/Grid/fog (5.x).
6. Geometry: creased normals, then meshopt LODs and shadow twins (5.6).
7. CA, vignette, damage edge, smears, speed lines, rumble (4.5-4.7).
8. Tiers + `PerformanceMonitor` + stats overlay (7).
9. Strain/stagger (1.3) as the first gameplay system built on the loop.

Each step is testable on its own. Add a `?debug=feel` overlay showing: fps, CPU/GPU ms, steps per frame, α, hitstop remaining, trauma, aim lead vs physical pan, and last event magnitude.

---

## 10. Pitfalls specific to us

- **The two clocks:** policies, match timer and scoring must use `simTime`. Juice decays use wall time. Mixing them makes hit stop freeze the shake too (it looks dead) or fast-forward the timer.
- **Cached WASM views:** `data.xpos` etc. are views into WASM memory, which is growable (`updateMemoryViews` exists in `mujoco.js`). Copy with `.set()` every step; never hold a view across frames.
- **Two cameras fighting:** remove `OrbitControls` and the preset `CameraRig` from the first-person route entirely (`codebase.md` §8 notes they already conflict).
- **Shader hitches on first effect use** (7). Pre-warm.
- **Spark colors are LDR today** (`toneMapped={false}`, values ≤ 1). With bloom threshold 1.0 they won't glow. Multiply by 4-8.
- **`near = 0.005` z-fighting** on distant table markings. Use `polygonOffset` on floor decals rather than a log depth buffer (log depth disables early-z and costs fill rate).
- **Pointer-lock permission prompts:** newer Chrome versions may gate pointer lock behind user gesture or site permission UX. Always request from a click handler and handle rejection with a visible "click to fight" state.

---

## 11. Reconciling with `finals-feel.md`

| Topic | `finals-feel.md` | This doc | Resolution proposed |
|---|---|---|---|
| Hit stop in Harness | "sim can't freeze without breaking the harness"; render-only freeze | Freezing the **sim clock** is deterministic: per-tick trajectories are identical with or without it, so AI-vs-AI is unaffected. It only changes *wall-clock* reaction time for a human. | Arcade: sim-clock hit stop (4.1). Harness AI-vs-AI: allowed (purely cosmetic in wall time). Harness human-vs-AI (ranked): cap 50 ms, no dilation. |
| Arcade hit stop mechanism | timeScale 0.15 for 45-90 ms | full freeze 33-150 ms, dilation only for stagger and round win | A full freeze reads crisper (Sakurai, Smash). A 0.15 scale for < 100 ms is visually indistinguishable from a freeze but still steps physics, which lets contacts continue resolving mid-"freeze". Prefer a full freeze. |
| Shake | 2.2° yaw/pitch, 1.2° roll, 6 mm translation, decay 1.6/s, 22 Hz | 1.5° yaw/pitch, 2.5° roll, **0 translation**, decay 1.6/s, 18/24 Hz | Rotation-only per Eiserloh's 3D advice. Less yaw/pitch because aim precision matters in a duel. More roll because it doesn't disturb aim. |
| Kick | 1.5° + 3°·m, ω = 18 | 2° + 4°·m, ω = 22 | Similar. Pick after playtest. Both expose the same slider. |
| FOV punch | +3° on landing a strike | −2.5°·(0.5+m) on dealing (punch in), +3°·m on receiving | Punch-in on your own hit focuses the contact, recoil-out on theirs. Playtest both. The event bus makes it a one-line swap. |

---

## Sources

- THE FINALS: [Wikipedia](https://en.wikipedia.org/wiki/The_Finals) · [Meet the Makers: Direction and Design](https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design) · [Meet the Makers: Character and Concept Art](https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Character_and_Concept_Art) · [NVIDIA: RTXGI, Reflex](https://www.nvidia.com/en-us/geforce/news/the-finals-closed-beta-dlss-reflex-ray-tracing/) · [VideoGamer: engine](https://www.videogamer.com/guides/the-finals-game-engine/) · [TechTimes: Season 11 melee](https://www.techtimes.com/articles/319995/20260709/finals-galaxy-masters-live-melee-gets-precision-stamina-systems.htm) · [Steam guide: CA, motion blur, grain](https://steamcommunity.com/sharedfiles/filedetails/?id=3464978609) · [games.gg settings](https://games.gg/the-finals/guides/the-finals-pc-graphics-settings-guide/)
- Melee: [Mordhau Wiki: Swing Manipulation](https://mordhau.fandom.com/wiki/Swing_Manipulation) · [Mordhau Wiki: Combat](https://mordhau.fandom.com/wiki/Combat) · [Chivalry 2 Wiki: Combat](https://chivalry2.fandom.com/wiki/Combat)
- Mech: [Armored Core Wiki: ACS](https://armoredcore.fandom.com/wiki/Attitude_Control_System) · [Dot Esports: AC6 stagger](https://dotesports.com/armored-core/news/armored-core-6-what-are-stagger-and-impact-in-ac6) · [Interface In Game: Titanfall 2](https://interfaceingame.com/games/titanfall-2/)
- Pacing: [Game Developer: Push Forward](https://www.gamedeveloper.com/game-platforms/pushing-push-forward-combat-with-gameplay) · [Nidhogg (Wikipedia)](https://en.wikipedia.org/wiki/Nidhogg_(video_game))
- Juice: [Eiserloh GDC 2016 transcript](https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt) · [GDC Vault](https://gdcvault.com/play/1023146/Math-for-Game-Programmers-Juicing) · [Sakurai: Thinking About Hitstop](https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/) · [SmashWiki: Hitlag](https://www.ssbwiki.com/Hitlag) · [Nijman: Art of Screenshake notes](http://notebook.maryrosecook.com/Theartofscreenshake,JanWillemNijman.html) · [Blue Tengu experiments](https://www.bluetengu.com/2014/12/12/art-of-screenshake-experiments/)
- Latency and input: [Claypool: Latency and player actions](https://web.cs.wpi.edu/~claypool/papers/precision-deadline/final.pdf) · [SuperCombo: SF6 Game Data](https://wiki.supercombo.gg/w/Street_Fighter_6/Game_Data) · [EventHubs: SF6 inputs](https://www.eventhubs.com/news/2023/jun/17/sf6-input-trouble-breakdown/) · [web.dev: disable mouse acceleration](https://web.dev/articles/disable-mouse-acceleration) · [MDN: requestPointerLock](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock) · [Chrome: desynchronized hint](https://developer.chrome.com/blog/desynchronized) · [Gaffer: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- Rendering: [Khronos PBR Neutral announcement](https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products) · [PBR Neutral spec](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md) · [registry: @react-three/postprocessing](https://registry.npmjs.org/@react-three/postprocessing/latest) · [registry: postprocessing](https://registry.npmjs.org/postprocessing/latest) · [react-postprocessing EffectComposer source](https://github.com/pmndrs/react-postprocessing/blob/master/src/EffectComposer.tsx) · [postprocessing ToneMappingMode](https://github.com/pmndrs/postprocessing/blob/main/src/enums/ToneMappingMode.js) · [R3F hooks docs](https://github.com/pmndrs/react-three-fiber/blob/master/docs/API/hooks.mdx)
- Local verification: `node_modules/three/src/renderers/WebGLRenderer.js` (`outputBufferType`, `setEffects`), `node_modules/@react-three/fiber` (Canvas `flat`/`linear` defaults), `node_modules/@mujoco/mujoco/mujoco.js` (growable memory), and servo step-response and `mj_step` benchmarks against `public/models/robotstudio_so101/arena.xml`.
