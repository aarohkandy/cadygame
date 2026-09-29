# Codebase map: RoboArena as it stands (before the first-person rebuild)

Scope: every file in `src/` and `tests/`, `public/models/robotstudio_so101/arena.xml`, the body/site/camera parts of `so101.xml`, `package.json`, `next.config.ts`, `AGENTS.md`, `README.md`, and the Next.js 16 guides in `node_modules/next/dist/docs/`.
Branch checked: `fps-duel`. Line numbers match the tree on 2026-09-16.
Measured numbers (body poses, timings, triangle counts) come from a probe script that loads the real `arena.xml` in `@mujoco/mujoco` 3.12.0 under Node 22.23.1. Node's V8 runs WASM at roughly browser speed, so treat the timings as estimates, not browser benchmarks.

---

## 0. TL;DR for the rebuild team

1. **Physics is cheap; the React loop is expensive.** One `mj_step` takes about 47 µs with no contact and about 97 µs with 44 contacts. `mj_kinematics` takes about 1.6 µs. A full 4-substep frame, contact walk and IK included, stays under 1 ms. What costs time is `setSnapshot`/`setReward`/`setElapsed` on every 16 ms tick. Each call re-renders the 1,019-line `ArenaApp` and the whole R3F scene props tree (`src/components/arena-app.tsx:417,458-460`).
2. **The clock is wrong.** Each tick is a `setInterval` of 16 ms (`arena-app.tsx:305`) that advances the game clock by 0.016 s (`:306`) but advances physics by 4 × 5 ms = 20 ms (`:410`, `arena.xml:7`). Simulated time therefore runs about **1.25× real time**, and the match clock and `simTime` drift apart. The loop has no accumulator, isn't tied to rAF, and doesn't interpolate.
3. **"Floaty" has three causes stacked on top of each other.**
   - The task-space target moves at a capped 0.28 m/s inside a small workspace box (`src/lib/arm-participation.mjs:19-23,102-127`).
   - A PD servo with a 2.94 N·m limit then chases that target.
   - The renderer adds an exponential lerp at 14/s (τ ≈ 71 ms) (`arena-scene.tsx:309-320`).
4. **Keep the physics boundary** (`src/lib/mujoco-engine.ts`), the MJCF (`arena.xml` + vendored `so101.xml`), the contact classifier idea, the policy worker sandbox, the gamepad helpers, and the procedural audio *primitives*. **Rewrite** the app shell, the frame loop, state ownership, the camera system, the scene style, and the HUD.
5. **Where to mount a first-person camera:** `atlas_shoulder` is the best stable "head". It turns only with `shoulder_pan`, which maps naturally to mouse-X yaw. `atlas_wrist_cam` / `camera_mount` rolls and pitches with every joint (at the start pose its up-vector lies nearly horizontal), so it would cause motion sickness if used raw. Details in section 8.
6. **World scale:** MuJoCo works in metres, Z-up. The mounts sit at x = ±0.32 (0.64 m apart). At the start pose the gripper tip is 0.184 m high. The renderer scales by **2.05** and maps MuJoCo (x, y, z) to three.js (x, z, −y) (`arena-scene.tsx:35,810`).

---

## 1. Stack and project configuration

| Item | Value | Source |
|---|---|---|
| next | 16.3.3 (Turbopack is the default for dev and build) | `package.json:16`; `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:126-160` |
| react / react-dom | 19.2.8 | `package.json:17-18` |
| three | 0.185.1; @react-three/fiber 9.7.0; @react-three/drei 10.7.8 | `package.json:13-19` (installed versions checked in `node_modules`) |
| @mujoco/mujoco | package.json asks for `^3.13.0`, but **3.12.0 is installed** (`mj_versionString()` = 3.12.0). The package also ships a multithreaded `mt/` build that needs COOP/COEP headers. | `package.json:12`, `node_modules/@mujoco/mujoco/package.json`, README "Threading Models" |
| tailwindcss | 4.3.3, imported in `globals.css:1` but almost unused (only `h-full antialiased`, `min-h-full flex flex-col` in `layout.tsx:47,49`) | |
| Tests | `node --test tests/*.test.mjs`: **19/19 pass in about 4.3 s** | `package.json:9` |
| Lint | `eslint` flat config (`eslint.config.mjs`), ignores `public/mujoco.js` | |

`next.config.ts` (9 lines) sets only `logging.browserToTerminal: "error"`. **`output: 'export'` is not set**, although `README.md` says "The app is statically exported and also prepares a lightweight hosting worker in `dist/`". Neither claim is true in the current tree.

`public/mujoco.js` and `public/mujoco.wasm` (10.1 MB) are byte-identical copies of `node_modules/@mujoco/mujoco/mujoco.{js,wasm}` (same SHA-1). The engine loads them from `/mujoco.js` with an indirect `import()` so the bundler can't see the module (`src/lib/mujoco-engine.ts:150-157`). **Risk:** upgrading the npm package won't update `public/`. Add a copy step or a check.

`AGENTS.md` rules that apply to the rebuild:
- Read the Next docs in `node_modules/next/dist/docs/` before writing Next code.
- After every change: run the tests, check console output, and screenshot UI changes.
- Use Conventional Commits.
- Read `STYLES.md` before UI work. It **does not exist** yet, so the rebuild should create one for the new art direction.
- `CLAUDE.md` only imports `AGENTS.md`.

### Next.js 16 points that matter for a client-heavy single-page game

- **Client boundary.** `src/app/page.tsx` (5 lines) is a Server Component that renders `<ArenaApp/>`, which starts with `"use client"` (`arena-app.tsx:1`). Client Components are still **prerendered to HTML at build time**. Any `window`/`navigator`/`AudioContext` access must stay inside effects, or the component must load through `next/dynamic(..., { ssr: false })` from a Client Component. `ssr:false` is not allowed in Server Components (`docs/01-app/02-guides/single-page-applications.md:205-219`, `lazy-loading.md:66-95`). The whole game canvas plus HUD should be one `ssr:false` island, which avoids a hydration pass over a WebGL tree.
- **Static export.** Setting `output: 'export'` makes `next build` write `out/` (`static-exports.md`). That mode does not support `headers()`, rewrites, redirects, proxy, Server Actions, or default image optimisation (`static-exports.md` "Unsupported Features"). **Consequence:** the MuJoCo `mt` build needs `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`, which can't come from `next.config` under static export. The static host would have to set them. Given the measured physics cost, the single-threaded build is enough.
- **Fonts.** `next/font/google` downloads CSS and font files **at build time** and self-hosts them, so the browser never contacts Google (`docs/01-app/03-api-reference/02-components/font.md:13`). Building needs network the first time. For fully offline builds, use `next/font/local` with the font files vendored (`01-getting-started/13-fonts.md:264+`). The current `layout.tsx:5-13` loads Geist and Geist Mono and exposes CSS variables, but `globals.css:6` forces `Arial` and Georgia, so those fonts are downloaded and never used.
- **Strict Mode** is on by default in the App Router (`05-config/01-next-config-js/reactStrictMode.md:8`). In dev, effects run twice. `MujocoEngine.create()` (`arena-app.tsx:275-301`) and `useSO101Model` (`arena-scene.tsx:163-272`) therefore start **twice**: two 10 MB WASM instantiations and about 36 STL fetches. The `alive` flags make this correct but slow. A module-level singleton or promise cache fixes it.
- **Runtime requirements:** Node ≥ 20.9, and Chrome/Edge/Firefox 111+ or Safari 16.4+ (`version-16.md:118-124`).
- **React 19.2:** `useEffectEvent` and `<Activity>` are available (`version-16.md:385-393`). `useEffectEvent` removes the dependency-array churn in the input effects (section 5). `reactCompiler` is stable but off by default and adds a Babel step (`version-16.md:395-438`). It doesn't help a ref-driven game loop much.
- `layout.tsx:42` uses the global `LayoutProps<"/">` type generated by Next typegen.

---

## 2. Module map

| File | Lines | Responsibility |
|---|---|---|
| `src/app/layout.tsx` | 52 | Root layout: metadata/OG (`:15-40`) and Geist fonts (unused, see above). |
| `src/app/page.tsx` | 5 | Renders `ArenaApp`. |
| `src/app/globals.css` | 138 | The entire dashboard skin: light cream palette (`:3`), a three-column grid (`:30`), many classes each written on one long line, font sizes of 5–9 px, and breakpoints at 1050/760/700/540 (`:134-137`). Nothing here fits a first-person game HUD. |
| `src/components/arena-app.tsx` | 1019 | **Owns everything.** Task list, match state, engine lifecycle, the physics tick, the built-in policies and the Blaze script, keyboard/gamepad/joystick input, policy upload, scoring, audio sync, and all the dashboard JSX. |
| `src/components/arena-scene.tsx` | 841 | R3F `<Canvas>`: parses `so101.xml` itself, loads STLs, clones two robots, applies joint angles, draws cubes and "race" props, spark and flash VFX, the camera rig and OrbitControls, lights, grid and contact shadows. |
| `src/components/controller-map.tsx` | 69 | Modal diagram of the Xbox layout. |
| `src/lib/mujoco-engine.ts` | 414 | **Physics boundary.** Loads the WASM and model, reset/step/snapshot, contact summary and strike classification, Atlas IK (FK through a second `MjData`). |
| `src/lib/arm-participation.mjs` | 290 | `JOINT_CONTROLS` limits and speeds (`:3-10`), manual workspace constants (`:13-23`), policy action validation (`:30-43`), JSON trajectory parse and sample (`:49-94`), `stepTaskSpaceTarget` (`:102-127`), the policy Web Worker source (`:129-160`), `UploadedPolicyRunner` (`:162-290`). |
| `src/lib/task-space-ik.mjs` | 104 | Damped least-squares 3-DoF position IK with a finite-difference Jacobian, plus a 3×3 Gauss–Jordan solve. |
| `src/lib/manual-controls.mjs` | 199 | Hand and joint key maps and legends, stepping for joints, height, gripper and wrist roll. |
| `src/lib/gamepad-controls.mjs` | 69 | Standard-mapping indices, radial deadzone (0.14), rising-edge button reads, `PRECISION_SPEED_SCALE` 0.35. |
| `src/lib/arena-audio.mjs` | 822 | Procedural Web Audio: servo whir bed, three-layer contact scrape bed, impact, cube tap, grip click and servo one-shots. Pure helpers are exported for tests. |
| `public/policies/example-policy.js` | 18 | Example worker policy (`act(observation)` returns 6 radians). |
| `tests/*.test.mjs` | 447 total | See section 11. |

---

## 3. Data flow: input → targets → `engine.step` → snapshot → render/audio

```
 keyboard (window keydown/up)  ─┐  manualKeysRef: Set<string>          arena-app.tsx:721-789
 on-screen joystick (pointer)  ─┤  joystickRef {x,y}                   :574-593, 930-964
 gamepad (rAF poll)            ─┤  gamepadMoveRef, cameraControlRef    :595-719
 uploaded policy (Worker)      ─┤  UploadedPolicyRunner.lastAction     arm-participation.mjs:239-272
 built-in policy fn            ─┘  policyTargets()                     arena-app.tsx:131-159
                  │
   setInterval(16ms) tick  arena-app.tsx:303-475
                  │ hand mode: stepTaskSpaceTarget → stepHandHeight/stepGripper/stepWristRoll
                  │            → engine.solveAtlasIK(target, seed, gripper, roll)   :322-386
                  │ joint mode: stepJointTargets                                      :314-320
                  │ policy:     runner.nextTargets(observation built from snapshotRef) :388-403
                  ▼
   atlasTargets (6 rad)  +  opponentPolicyTargets(task, elapsed)  (Blaze, open-loop)  :409
                  ▼
   engine.step(atlas, blaze, 4)  → writes data.ctrl[0..11], 4× mj_step + readContacts  mujoco-engine.ts:223-249
                  ▼
   PhysicsSnapshot {joints, opponentJoints, cubes[9], contacts, armContacts, cubeContacts,
                    collision{kind, attacker, force, impulse, position, links, eventId},
                    atlasEndEffector, simTime}                                          mujoco-engine.ts:24-34, 251-278
                  ├─► snapshotRef.current + setSnapshot(next)   (React state!)          arena-app.tsx:416-417
                  ├─► combat stats on new eventId (setCombatStats)                      :428-436
                  ├─► audioRef.sync({joints, opponentJoints, contacts, collision, running}) :439-447
                  ├─► reward/score (setReward/setOpponentReward/setElapsed)             :449-472
                  ▼
   <ArenaScene joints opponentJoints cubes cubeOwners collision ...>  (props)          :867
        CompetitorRobot.useFrame lerps joint angles (14/s)                               arena-scene.tsx:309-320
        HeistCube.useFrame lerps pos/quat (24/s)                                         :367-372
        ImpactMarker: sparks/flash per new eventId + grind embers                        :456-740
```

Two points about this flow:
- **The renderer never reads MuJoCo body poses (`xpos`/`xquat`).** It rebuilds forward kinematics in three.js from `qpos` joint angles, using a transform tree parsed by hand from `so101.xml`. The two stay consistent only while the MJCF parser handles every transform attribute the file uses (`pos`, `quat`, `euler`, handled in `applyTransform` at `arena-scene.tsx:149-158`).
- **Blaze is not a policy slot.** It always runs `opponentPolicyTargets` (`arena-app.tsx:161-168`): the "heist" choreography at time × 1.4 plus a small pan wobble. It ignores the player entirely. Uploaded policies only drive **Atlas**.

---

## 4. Frame loop timing (exact)

| Quantity | Value | Where |
|---|---|---|
| Tick scheduler | `window.setInterval(..., 16)` | `arena-app.tsx:305,473` |
| Game clock per tick | +0.016 s (`elapsedRef`) | `:306` |
| Physics per tick | 4 substeps × `timestep=0.005` = **0.020 s** | `:410`; `arena.xml:7` (`arena.xml`'s `<option>` replaces the attached `so101.xml`'s; the probe confirms iterations=20, ls_iterations=30) |
| Solver | `implicitfast`, elliptic cone, impratio 10 | `arena.xml:7-8` |
| Real-time ratio | nominal 20/16 = **1.25×** fast; actual rate depends on timer jitter | derived |
| UI label | "MuJoCo · 200 Hz" | `arena-app.tsx:889` (true of sim time only) |
| Render | R3F rAF (display rate), unrelated to the tick; `dpr [1,1.6]` | `arena-scene.tsx:837` |
| Render smoothing | joints `1-exp(-14·dt)`, cubes `1-exp(-24·dt)` | `arena-scene.tsx:310,369` |
| Gamepad poll | its own rAF loop | `arena-app.tsx:637-700` |
| Heist match | `HEIST_MATCH_LENGTH = 60` of *game clock* ≈ 75 s of sim time | `:78,220,462` |

Failure modes:
1. `setInterval` is throttled in background tabs (about 1 Hz or slower). The clamp to ≥ 4 ms and main-thread GC jitter both skip or bunch ticks, and nothing catches up.
2. Game time (`elapsed`) and physics time (`simTime`) disagree. Policies receive `observation.time = nextElapsed` (`:391`), not `simTime`, so a policy trained on real `dt` sees a clock that runs 25 % slow.
3. The renderer lerps toward the latest snapshot and never interpolates between the two most recent physics states. Lag is roughly 70 ms and depends on frame rate.
4. `UploadedPolicyRunner.nextTargets` returns `lastAction` and fires an async request (`arm-participation.mjs:239-249`). Actions always arrive **at least one tick late**, and the 500 ms timeout kills the policy permanently (`:245-247`).

**Recommendation:** use a fixed-step accumulator driven by rAF (or a dedicated Worker that owns MuJoCo) at dt = 5 ms. Poll input every render frame, copy body `xpos`/`xquat` into preallocated Float32Arrays, and interpolate render transforms by `alpha = accumulator/dt`. Clamp catch-up to a few steps per frame to avoid a spiral of death.

---

## 5. Where state lives and what re-renders

**React state in `ArenaApp` (`arena-app.tsx:171-195`)** holds 25 `useState` values. The ones that change **every physics tick** are:
- `snapshot` (`:417`)
- `reward` and `opponentReward` (`:458-459`)
- `elapsed`, on about half of all ticks: `Math.floor(t*10) % 2 === 0` is true for alternating 0.1 s windows (`:460`)
- `combatStats` on each new contact event (`:430`)
- `manualLifted` and `manualGripping` on threshold crossings (`:345-348,365-368`)

React batches these into roughly **one full `ArenaApp` render per tick (~62 Hz)**. That render rebuilds all dashboard JSX (`:842-1018`) and passes brand-new `joints`/`cubes`/`collision` objects to `ArenaScene`, so the entire R3F element tree reconciles every tick. The gamepad rAF adds `setJoystickVisual` at display rate while the stick moves (`:660-668`).

**Refs (the "real" game state)** (`:196-217`):
- `engineRef`, `snapshotRef`, `targetsRef`, `manualTargetRef`
- `joystickRef`, `gamepadMoveRef`, `cameraControlRef`
- `gamepadIndexRef`, `gamepadButtonsRef`
- `manualKeysRef`, `manualLiftedRef`, `manualGrippingRef`, `manualPrecisionRef`, `manualDriveModeRef`, `shiftHeldRef`
- `uploadedPolicyRef`, `uploadRequestRef`, `elapsedRef`, `lastCollisionEventRef`, `audioRef`

Many values are duplicated as a ref plus state so the loop can read them and the UI can show them. Every toggle has to write both (e.g. `:519-535`).

**Effect churn:**
- The tick effect depends on `[controlMode, matchLength, policyChoice, running, selectedTaskId, updateTargets]` (`:475`), so changing any of them rebuilds the interval.
- The gamepad effect depends on 9 values, including `running` and callbacks whose identity changes with `matchLength`/`randomization`/`selectedTaskId` (`:709-719`). It tears down and re-subscribes window listeners on every start/pause.
- The keyboard effect has 11 dependencies (`:789`).
- `useEffectEvent` (React 19.2) or a plain input system outside React would remove all of this.

**Inside the scene**, animation state is kept in `userData.jointAngle` on the three.js groups (`arena-scene.tsx:314-316`) and in refs such as `sparksRef` and `flashesRef` (`:462-465`).

---

## 6. How the scene reads MJCF and renders STL meshes

`useSO101Model` (`arena-scene.tsx:160-275`):
1. Fetches `/models/robotstudio_so101/so101.xml` (not `arena.xml`) and parses it with `DOMParser` (`:168-173`).
2. Builds maps of mesh name → file (`asset > mesh[file]`, name defaults to the filename stem) and material → rgba (`:175-187`).
3. Loads only meshes used by `geom[class="visual"]` with `STLLoader.loadAsync`, then runs `computeVertexNormals()` on the non-indexed STL, which yields faceted normals (`:189-205`).
4. `buildBody` recurses over `<body>` elements (`:207-241`):
   - The group transform comes from `pos` + `quat` (MuJoCo wxyz → three xyzw, `:140-143`) or `euler`, assumed to be XYZ radians (`:149-158`).
   - The first child `<joint>` stores `jointName`/`jointAxis` in `userData`.
   - Each visual geom becomes a mesh with a `MeshStandardMaterial`. Servo bodies (`sts3215*`) get roughness 0.34 and metalness 0.2; other parts get 0.52/0.03 and `isAccent=true`. Every mesh casts and receives shadows.
5. Only the first `worldbody > body` (`base`) is used (`:243-245`).

`CompetitorRobot` (`:277-323`):
- Deep-clones the source group, clones every material, and tints accent materials green (`#2f8062`) or orange (`#ef6b42`) (`:38-39`). Geometries are shared.
- Collects joint groups by name. Each frame it sets `group.quaternion = baseQuaternion * axisAngle(axis, lerpedAngle)` (`:309-320`).
- It **allocates a new `THREE.Quaternion` per joint per frame** (`:317`).

Placement (`Scene`, `:809-819`):
```
<group scale=2.05 rotation=[-π/2,0,0]>          // MuJoCo Z-up → three Y-up, ×2.05
  <group position=[-0.32,0,0]>  Atlas </group>
  <group position=[ 0.32,0,0] rotation=[0,0,π]> Blaze </group>
  <ImpactMarker/>                                // sparks in MuJoCo coordinates
</group>
```
Cubes render inside an identical scaled and rotated group (`:405-409`), as 0.04 m `boxGeometry` meshes. Their positions come from `qpos`, **not** from MJCF geoms.

Everything else is authored in **unscaled three.js world units** and matches physics only by eye:
- territory zones at x = ±0.37, r = 0.235 (`:382-401`)
- arena ring r = 0.62 and corner rings at ±0.57 (`:325-346`), while the robots actually sit at ±0.656
- the ground plane (`:822-825`), `Grid` (`:827`), `ContactShadows` (`:828`)

Scoring uses physics coordinates: a cube belongs to a side if it is within 0.105 m of (±0.18, 0) (`arena-app.tsx:116-120`), which renders at about ±0.369 world.

**Visual budget (measured from STL sizes):** 14 unique visual meshes. `sts3215_03a_v1` is used 5×. Total is **401,340 triangles per arm, about 803k for both**, in about 18 meshes per arm. With `shadows="percentage"` (1024² map, `:806,837`) and drei `ContactShadows` (which renders the scene into a depth target and blurs it every frame), the arm geometry is drawn about 3× per frame. The STLs total about 17.9 MB. Both the engine (`mujoco-engine.ts:156-161`, `force-cache`) and `STLLoader` (a separate fetch path) download them. `arena.xml` is fetched `no-store` (`:158`).

"Stack Blocks" and "Push to Target" are **not simulated**:
- In the engine, their cubes are parked at x ≈ 2 m (`mujoco-engine.ts:204-210`).
- `RaceObjects` draws spinning boxes whose position depends on `progress` (`arena-scene.tsx:414-450`).
- Progress is just `elapsed/matchLength × constant` (`arena-app.tsx:449-457`).
- `ProgressRing` passes `progress` into `ringGeometry` `args`, so it **rebuilds the geometry on every tick** (`arena-scene.tsx:355-357`).

Other cosmetic or fake UI:
- Episode and success counts (1248/899, `arena-app.tsx:193-194`)
- "SEASON 01 · 12 DAYS LEFT" (`:863`)
- "Domain randomization: Lighting/Friction/Object pose/Camera" (`:1010`). In reality the only randomization is ±6 mm of cube XY jitter (`mujoco-engine.ts:211-214`).
- "ADAPTIVE RIVAL" (`:896`), although Blaze is a fixed script.
- Nav tabs and the profile button, which do nothing (`:846-847`).

---

## 7. Contact and strike classification

`MujocoEngine` constructor (`mujoco-engine.ts:120-147`) precomputes per-geom tables:
- `geomCompetitors[g]`: `"atlas"`/`"blaze"`/`null`, from the body-name prefix
- `geomIsCube[g]`
- cube `qposadr`

`readContacts()` (`:321-384`) iterates `data.contact` through embind: `contacts.get(i)`, then `.delete()` on each item and on the vector.
- It counts `cubeContacts` when an arm geom touches a cube geom (`:335`).
- It skips any pair that isn't Atlas-vs-Blaze (`:336`).
- For cross-arm pairs:
  - `force = |efc_force[contact.efc_address]|`, the **first constraint row, i.e. the normal force in N** (`:339-342`).
  - The contact point's speed on each body comes from `cvel` translated from the root subtree COM to `contact.pos` (`contactPointSpeed`, `:386-406`). The formula matches MuJoCo's convention: `cvel` is [ω; v] at `subtree_com[body_rootid]`.
  - **strike** when `force ≥ 0.65` **and** `max(speedA, speedB) ≥ 0.08 m/s` **and** `|speedA − speedB| ≥ 0.05 m/s` (`:46-48,355-357`). The attacker is the faster side, with ties going to Atlas (`:354`). Otherwise **block**.
  - Only the strongest contact by force is kept (`:343`). `impulse = force × timestep`, which is one step's impulse, not an integral over the contact (`:364`).

`step()` (`:223-249`) merges its 4 substeps:
- `armContacts`/`cubeContacts` take the max
- `collision` comes from the highest-force substep
- `total` comes from the last substep

`eventId` increments on the **rising edge of any cross-arm contact at frame granularity** (`:243-247`) and stays constant while contact persists.

**Implications for a fighting game:**
- Stats count a hit exactly once, using the **kind seen on the first frame** of a contact episode (`arena-app.tsx:428-436`). A graze that becomes a hard swing while the arms stay touching counts as a "block". Audio `playImpact` fires once per `eventId` as well (`arena-audio.mjs:283-287`).
- Nothing records which link was hit beyond readable names (`atlasLink`/`blazeLink`, e.g. "moving jaw so101 v1"). There are no damage zones, no relative normal velocity, no per-contact frame (`contact.frame`), and no hit direction.
- Thresholds are low compared with the forces this hardware can produce. A PD servo at kp 998 saturates at 2.94 N·m (see below), so forces of a few newtons are typical, and `impactIntensity` normalises by 2.4 N (`arena-audio.mjs:18`).
- Arm geometry: each arm has **30 collidable geoms** (boxes, spheres, capsules, and `maxhullvert=64` convex hulls of the gripper meshes in group 4) with contype/conaffinity 1/1. Visual meshes are contype 0 (`so101.xml:17-28`). Cubes are 2/7 and the floor is 4/7 (`arena.xml:23-25,31-32`), so arms collide with cubes, the floor, each other, and non-adjacent links of the same arm. With arms pressed together the probe measured `ncon = 44`.
- Actuators: `position` with kp 998.22, kv 2.731, forcerange ±2.94 (`so101.xml:31-39`), joint damping 0.60, frictionloss 0.052, armature 0.028. Wrist-roll `ctrlrange` is **asymmetric**: −2.74385…**2.84121** (`so101.xml:253`), while the joint range and `JOINT_CONTROLS` are ±2.74385 (`arm-participation.mjs:8`).
- Masses: base 0.147 kg, shoulder 0.100, upper arm 0.103, lower arm 0.104, wrist 0.079, gripper 0.087 plus camera mount 0.012 plus jaw 0.012. Cube mass is 0.08 kg (`arena.xml:23`).

---

## 8. World scale and every candidate first-person camera host

MuJoCo world, metres, Z-up. Atlas faces +x toward Blaze; Blaze is rotated π about Z (`arena.xml:36-41`). Poses below are for `START_POSE = [0, -0.62, 1.08, -0.48, 0, 0.72]` (`mujoco-engine.ts:41`), measured with `mj_forward`:

| Body / site / camera | World pos (x, y, z) | Moves with | FPS-camera suitability |
|---|---|---|---|
| `atlas_mount` / `atlas_base` / site `atlas_baseframe` | (−0.320, 0, 0) | nothing (fixed) | Stable, but on the table surface. Good as a fixed "cockpit" origin with a manual height offset. |
| `atlas_shoulder` | (−0.281, 0, 0.062) | `shoulder_pan` only (yaw about world Z) | **Best head anchor.** Yaw follows the arm's pan, so mouse-X → pan feels like turning the head. Needs an eye offset of about +0.10–0.20 m up and a little back, because 6 cm high sits below the gripper. |
| `atlas_upper_arm` | (−0.251, −0.018, 0.117) | pan + lift | Pitches with shoulder_lift, which is nauseating while swinging. |
| `atlas_lower_arm` | (−0.293, −0.018, 0.225) | pan + lift + elbow | Highest link at rest (the elbow sits above the shoulder), and it swings hard. |
| `atlas_wrist` | (−0.170, −0.018, 0.169) | + wrist_flex | |
| `atlas_gripper` = `atlas_camera_mount` (same frame, no pos offset) | (−0.109, 0, 0.171) | all 5 arm joints | |
| site `atlas_gripperframe` | (−0.011, −0.001, 0.184) | all 5 | The IK target point (`mujoco-engine.ts:127-132`). Good for a crosshair or aim point, not for the eye. |
| camera `atlas_wrist_cam` | (−0.064, 0.055, 0.174), fovy 48.46°, 1920×1080, on `atlas_camera_mount` | all 5 | Real hardware wrist camera (`so101.xml:203-205`). At the start pose its xmat up-axis is (0.54, 0.84, 0.05), so the image is rolled about 90°. Useful as a "robot's-eye" picture-in-picture or policy observation, not as the main view. |
| `atlas_moving_jaw_so101_v1` | (−0.086, 0.018, 0.192) | + gripper | |
| Blaze mirrors | x and y negated (e.g. `blaze_shoulder` (0.281, 0, 0.062)) | | |
| world sites `atlas_zone` / `blaze_zone` | (∓0.18, 0, 0.01), r 0.11 | fixed | Scoring zones (`arena.xml:72-73`). |

Reach, sampled from 4,000 random configurations:
- The gripperframe gets up to about 0.50 m from the shoulder and up to 0.527 m high.
- **Atlas reaches as far as x ≈ +0.149**, and Blaze symmetrically to −0.149, so the reach envelopes overlap by about 0.30 m around the centre line. That overlap is the fighting space.
- With all joints at 0 (and gripper 0.72), Atlas's gripperframe sits at (0.071, 0, 0.246).

In render space multiply by 2.05 and map (x, y, z) → (x, z, −y). The current Canvas camera is fov 39, near 0.01, far 20 (`arena-scene.tsx:837`). A camera 0.1–0.4 render-units from the player's own arm will clip at `near = 0.01` only in extreme poses. Lower it to about 0.005 and use a logarithmic depth buffer or tighter far plane if z-fighting appears.

**Existing camera presets** (`arena-scene.tsx:742-747`, all looking at (0, 0.32, 0)):
- `arena` (0, 1.18, 2.15)
- `atlas` (−1.42, 0.72, 0.62): third-person over Atlas's side, **not** first-person
- `blaze` (1.42, 0.72, −0.62)
- `overhead` (0.01, 2.65, 0.01)

`CameraRig` (`:749-796`) lerps position at 6.2/s on preset change or reset and orbits `arena` from the gamepad right stick (θ at 1.75 rad/s, φ at 1.35 rad/s, clamped 0.18–1.48). drei `OrbitControls` is enabled only for `arena` (`:830`) and writes the same camera, so two controllers fight over it. D-pad selects presets (`arena-app.tsx:681-684`); right-stick click recenters (`:677-680`).

**Recommendation:** drive the camera from the MuJoCo body pose, not from the three.js joint tree:
- position = `xpos[atlas_shoulder]` + R_yaw · eyeOffset
- orientation = yaw from `shoulder_pan` (or the player's aim yaw) + player pitch, with no roll

Then render Atlas's own forearm and gripper in view as the "weapon/hands" layer.

---

## 9. Input and control details (what makes it floaty)

- **Hand mode (default):**
  - Target XY moves at `JOYSTICK_SPEED = 0.28 m/s` and is clamped to X ∈ [−0.075, 0.035], Y ∈ [−0.14, 0.14], and a reach annulus of 0.245–0.355 m from Atlas's base (`arm-participation.mjs:19-23,102-122`).
  - Height glides to 0.064 or 0.18 m at 0.28 m/s (`:14,123-126`), or holds R/F at 0.28 m/s (`manual-controls.mjs:132-141`).
  - IK runs up to 12 iterations with damping 0.018, tolerance 1.5 mm, and a max joint step of 0.14 rad per iteration (`task-space-ik.mjs:17-26`). Each iteration makes 5 FK calls, so up to 61 `mj_kinematics` calls per tick, about 0.1 ms.
  - The seed is the previous *target*, not the measured `qpos` (`arena-app.tsx:381-386`).
- **Joint mode (Tab):** holding keys moves each joint at 1.05–1.55 rad/s (`arm-participation.mjs:4-9`, `manual-controls.mjs:111-122`).
- **Precision:** 0.35× through P, Shift, or gamepad X (`gamepad-controls.mjs:29`).
- **Gamepad:**
  - LS moves; A grip, Y lift, X precision, B home (`arena-app.tsx:686-691`).
  - Menu toggles run, View opens the map.
  - Triggers and bumpers are **unused**, although their indices are defined (`gamepad-controls.mjs:7-10`).
  - Only the first `mapping === "standard"` pad is used.
- **Keyboard:** Space toggles run (`arena-app.tsx:733-738`), X resets (`:739-742`), B homes (`:763`). The **README says Home is `R`**, but R is now "raise" (`README.md:47`, `manual-controls.mjs:24`).
- There is no pointer lock and no mouse look.

---

## 10. Audio system (`src/lib/arena-audio.mjs`)

- **Unlock:** `ArenaAudio` is created in an effect (`arena-app.tsx:266-273`). The graph is built lazily and resumed only when the user starts a match (`toggleRun` → `resume()`, `:482`; `arena-audio.mjs:175-180`). `suspend()` exists but is never called, so on pause the beds ramp to 0 while the oscillators keep running.
- **Graph** (`ensureGraph`, `:366-483`): master gain 0.55 → compressor (−18 dB threshold, 3.2:1 ratio, 3 ms attack, 120 ms release) → destination. The persistent looping sources are:
  - **scrape dry** (grit noise → bandpass 780 Hz)
  - **scrape body** (brown noise → lowpass 180 Hz)
  - **scrape grit** (bandpass 1600 Hz)
  - **servo bed** (saw 92 Hz + square 148 Hz + bandpassed noise → lowpass 900 Hz)
  - Noise buffers are generated once: 0.5 s brown and 0.4 s grit (`:80-108`).
- **`sync(frame)`**, called every physics tick (`:239-364`):
  - Motion energy is Σ|Δq|/dt over both arms (`:28-36`). It drives the servo bed level (`(E−0.35)/7.5`, smoothed at 0.28) and pitch (64 + 5·E Hz) (`:270-279,602-612`).
  - Gripper edges below 0.45 rad → `playGripClick`. Gripper speed > 1.8 rad/s → `playGripServo`, throttled to 90 ms (`:281,353-359,620-634`).
  - A new `collision.eventId` → `playImpact` (`:283-287,642-721`). That call builds 5–6 filtered noise bursts plus a sub-thud sine (48/62 Hz). Level comes from `impactIntensity(force, kind)` (`:16-20`): strike 0.42–1.0, block 0.22–0.67, force normalised by 2.4 N.
  - Contact scrape levels come from pressure = force/2.2 and slip = (E−0.2)/6.5 (`:45-56`). The beds use asymmetric smoothing (attack 0.78, ease 0.45) plus a 180 ms release tail and a separation "peel" one-shot (`:289-331,532-567`). Stick-slip grains fire at up to 3 per tick (`:334-344,575-595`).
  - Cube taps fire when `cubeContacts` increases, capped at 3 (`:346-351,728-757`).
- **Cost:** every one-shot allocates new `AudioBufferSourceNode`/`BiquadFilterNode`/`GainNode` objects. Sustained sliding can create hundreds of short-lived nodes per second. `sync` also copies both joint arrays every tick (`:361-362`).
- **No spatialisation** (no `PannerNode`), no listener tied to the camera, no music, no announcer, no UI sounds. Parameters use `cancelScheduledValues` + `linearRamp` on every tick (`ramp`, `:491-496`).
- **Keep:** the physics-driven synthesis model and the pure helpers. **Add:** a voice pool, HRTF panning at `collision.position` relative to a first-person listener, and event buses (hit, block, KO, round).

---

## 11. Tests (`npm test` → `node --test tests/*.test.mjs`, 19 pass, ~4.3 s)

| File | What it covers |
|---|---|
| `tests/arena-audio.test.mjs` | `impactIntensity` ordering, `motionEnergy`, `gripperActivity` edges, `contactScrapeLevels` (pressed vs sliding), `clamp`. |
| `tests/arm-participation.test.mjs` | Joystick normalisation and workspace clamp; JSON trajectory parse and interpolate; action validation errors. |
| `tests/gamepad-controls.test.mjs` | Standard indices, radial deadzone circularity, rising-edge buttons. |
| `tests/manual-controls.test.mjs` | Distinct hand/joint key maps; joint, height, gripper and roll stepping with precision. |
| `tests/mujoco-duel.test.mjs` | Compiles the real `arena.xml` via the npm `@mujoco/mujoco` (`:16-28`). Asserts nu=12, nq=75, nv=66, named bodies/sites/cube joints, and a collision-free reset pose (`:113-126`). IK reaches (0.02, −0.06, 0.08) within 2 mm (`:128-161`). Contested poses block (peak force > 1 N, elbows stay > 0.75 rad) (`:163-180`). The attacker's contact point is faster by more than 0.05 m/s, and the arm can touch `cube_4` (`:182-209`). |

Gaps:
- `mujoco-engine.ts` is **not imported by any test**, because it is TypeScript using the `@/` alias. The test file **duplicates** `contactPointSpeed` and the contact walk (`mujoco-duel.test.mjs:52-111`), so the strike thresholds, substep merge and `eventId` logic are untested.
- There are no render, timing, input-integration, policy-worker, or browser tests.
- **Rebuild advice:** move the engine to plain `.mjs` (or `.ts` without path aliases; Node 22.18+ strips types) so tests import the real module. Add deterministic replay tests (fixed seed, fixed input script → hash of qpos after N steps) and a real-time-factor test for the new loop.

---

## 12. Policy harness (for "swap in your own model")

- **Upload** accepts `.js`/`.mjs` (a module Worker built from a Blob URL, which `import()`s the policy Blob) or `.json` trajectories (fps 1–240, ≤ 100k frames, linear interpolation) (`arm-participation.mjs:49-94,186-222`).
- **Observation**, built at `arena-app.tsx:390-403`: `time` (game clock, not sim time), `task`, `joints`, `opponentJoints`, 9 cube poses, contact counts, `collision`. It has **no joint velocities, no body or EE poses, no actuator forces, and no side/frame info**. Observations are in Atlas's world frame, so a policy can't simply be mirrored to play as Blaze.
- **Safety:**
  - Actions must be 6 finite numbers inside `JOINT_CONTROLS` limits, or the runner fails permanently (`:30-43,268-271`).
  - Only one outstanding `act()` is allowed, with a 500 ms timeout (`:241-247`).
  - `reset` is fired asynchronously without waiting for completion (`:230-236`).
  - Worker code can still `fetch`/`import` from the network; that's acceptable locally.
- **For the rebuild:** define a symmetric `Controller` interface (human, scripted AI, and uploaded policy all implement `reset(ctx)` and `act(obs) → 6 targets`) usable for either arm. Express observations in the controlling arm's own frame, supply sim time and `dt`, and run at a declared control rate decoupled from rendering. Keep the validation and worker isolation.

---

## 13. Performance hot spots (ranked)

1. **Per-tick React renders** of `ArenaApp` and the `ArenaScene` element tree from `setSnapshot`/`setReward`/`setOpponentReward`/`setElapsed` (`arena-app.tsx:417,458-460`). All transforms should flow through refs or a store read in `useFrame`, and the HUD should update at 10–20 Hz or through direct DOM or `textContent` writes.
2. **The scene is drawn about 3× per frame at about 803k triangles**: the main pass, a PCF shadow map (`arena-scene.tsx:806,837`), and drei `ContactShadows` re-rendering depth plus blur (`:828`). `Grid infiniteGrid` (`:827`) and `fog` add shader cost. Decimated meshes (merge or instance the 5 `sts3215` servo meshes per arm) and baked or ambient-occlusion shadows would save most of it.
3. **Per-frame allocations:**
   - `new THREE.Quaternion` per joint (`:317`)
   - `new Vector3`/`Quaternion` per cube (`:370-371`)
   - `new Vector3(...collision.position)` for grind embers (`:568`)
   - `spawnImpactSparks` creating objects and colours (`:78-121`)
   - `Array.from`/spread in `snapshot()` (`mujoco-engine.ts:251-278`) and `readContacts()` (`:325,360-369`)
   - observation deep copies for policies (`arena-app.tsx:392-402`)
   - audio node creation per one-shot
4. **Embind contact walk:** about 28 µs per walk at 44 contacts, times 4 substeps (`mujoco-engine.ts:321-384`). It's acceptable, but reading `efc_force` for every contact plus `contact.pos` as a new typed-array view allocates. Batch by reading `data.contact` once per frame (the last substep), or track the per-substep max with minimal property access.
5. **`ProgressRing` geometry rebuilt every tick** in race tasks (`arena-scene.tsx:355-357`).
6. **Double loading:** Strict Mode double effects (section 1), plus about 17.9 MB of STL fetched by both the engine and `STLLoader`, plus 10.1 MB of WASM. Cache the STL ArrayBuffers once and feed both MuJoCo's VFS and a `BufferGeometry` parse from them.
7. **Effect churn** re-subscribing window listeners on every run/pause (`arena-app.tsx:709-719,789`).
8. **Typed-array views:** `data.qpos` and friends return **new views on each property access** (the probe found `data.qpos !== data.qpos`, about 0.08 µs each). This is cheap, but views detach if WASM memory grows, so don't cache them across a `new MjData` or model reload.

---

## 14. Keep / rewrite / risks

### Keep (with small edits)
- `public/models/robotstudio_so101/so101.xml` and its assets: the vendored, unmodified Menagerie model (Apache-2.0; `LICENSE`/`README.md`/`CHANGELOG.md` retained).
- `arena.xml` structure: the `<attach prefix>` twin, mounts at ±0.32, and the contype scheme. Remove the cubes or make them optional props for a fighting mode.
- `MujocoEngine` as the single physics boundary: the loader trick (`:150-191`), precomputed geom tables, `contactPointSpeed`, `dispose`. Extend it with body-pose export, per-contact normal velocity, contact frame, link-level hit zones, and per-substep event emission.
- `task-space-ik.mjs`: keep it as an *optional* assist, for example aim-point IK for "punch toward crosshair".
- `gamepad-controls.mjs` (deadzone and edges) and `manual-controls.mjs` key-map ideas.
- `UploadedPolicyRunner` validation and worker isolation, plus the JSON trajectory format.
- `arena-audio.mjs` pure helpers and synthesis recipes, restructured behind a pooled, spatial event bus.
- The spark VFX approach (additive points plus streaks, heat-colour ramp, `onBeforeCompile` size attribute, `arena-scene.tsx:456-740`): rescale and restyle it.
- The `tests/mujoco-duel.test.mjs` physics assertions.

### Rewrite
- `arena-app.tsx` in full: split into a game loop (fixed-step accumulator), input system (pointer lock, mouse, keyboard, gamepad incl. triggers), controller slots (human/AI/policy per arm), match/round/health rules, and a thin HUD. React should own menus only.
- The `arena-scene.tsx` rendering model: drive transforms from MuJoCo `xpos`/`xquat` with interpolation, not a re-parsed joint tree. The hand-rolled MJCF parser can stay only for loading visual meshes by body name. Replace the presets, `CameraRig` and `OrbitControls` with a first-person rig anchored at `*_shoulder` and a spectator/replay cam.
- `globals.css` and the whole light-dashboard visual language, plus `layout.tsx` fonts and metadata.
- Blaze's open-loop script (`arena-app.tsx:161-168`): replace it with a reactive AI controller behind the same interface as uploaded policies.
- Remove the fake telemetry (season, episode counts, domain randomization, race tasks).

### Risks
1. **Physics feel vs. authenticity.** STS3215 limits (2.94 N·m, kp 998, kv 2.73) are why motion is slow. Raising `forcerange` would make the game fast but no longer "a real SO-101". Decide early whether a "tuned arcade" actuator profile is allowed and label it in the harness. Policies must be verified on the stock profile.
2. **Time base.** Every downstream number (strike speed thresholds, audio energy, policy `dt`) was tuned under a 1.25× clock with a lerped render. Retune after fixing the loop.
3. **Motion sickness.** Any camera parented to a moving link inherits pitch and roll from the PD servos' oscillation. Stabilise it with yaw-only parenting plus low-pass filtering, and keep FOV fixed.
4. **Main-thread contention.** Physics, IK, audio scheduling and R3F all share one thread. Moving MuJoCo into a Worker (posting pose Float32Arrays or a SharedArrayBuffer) conflicts with static export's lack of COOP/COEP headers if SAB is used. Transferable ArrayBuffers avoid that.
5. **Asset weight.** About 28 MB of first load (WASM + STL) and about 803k triangles. Decimating derived meshes must preserve license attribution, and the collision model must stay untouched.
6. **Version drift.** `package.json` says `^3.13.0` but 3.12.0 is installed, and the `public/` runtime is a manual copy.
7. **Contact event semantics.** A single `eventId` per contact episode means sustained grinding never yields a second hit. A combat system needs per-impact detection (a rise in normal impulse or relative normal velocity), not contact-presence edges.
8. **Next 16 prerender.** Any top-level browser API access in new game modules will break `next build`. Keep the game an `ssr:false` island.
9. **Style inspiration.** Emulate the qualities without copying assets or names. Reference points about THE FINALS:
   - It is a first-person, team-based "virtual combat game show" shooter from Embark Studios ([Business Wire announcement](https://www.businesswire.com/news/home/20230223005976/en/); [Game Informer review](https://gameinformer.com/review/the-finals/appetite-for-destruction)).
   - Its destruction and movement physics run server-side, so all players see the same result ([Digital Trends preview](https://www.digitaltrends.com/gaming/the-finals-preview-destruction-will-make-developers-panic/); [GDC Vault talk "Engineering Mayhem"](https://gdcvault.com/play/1034307/Engineering-Mayhem-Technical-Deep-Dive)).
   - Its arenas are procedurally built in Houdini ([SideFX case study](https://www.sidefx.com/community/making-the-procedural-buildings-of-the-finals-using-houdini/)).
   - Parallel for this project: the MuJoCo world is the single authoritative simulation, and every hit, spark and sound must come from it. Don't fake outcomes client-side the way the current race tasks do.
