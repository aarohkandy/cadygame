# TORQUE LIMIT

*Live from the benchtop.* A first-person 1v1 robot-arm fight: you pilot one SO-101 arm from its camera mount against a built-in AI arm (or your own policy), in a glossy televised game-show arena. The same match loop doubles as a harness for verifying robot policies: every match can be recorded as a bit-exact, re-simulatable episode.

Binding design documents, in precedence order: [`docs/design/SCOPE.md`](docs/design/SCOPE.md), [`docs/design/BUILD_PLAN.md`](docs/design/BUILD_PLAN.md), [`docs/design/GAME_DESIGN.md`](docs/design/GAME_DESIGN.md). Policy authors want [`docs/HARNESS.md`](docs/HARNESS.md); the web, desktop and mobile builds are in [`docs/APPS.md`](docs/APPS.md).

## Start it

Node 22.18 or newer (the tests import TypeScript directly through Node's type stripping). Nothing else to install, no API key, no account, no network at run time.

```bash
npm install
npm run dev            # http://localhost:3000
```

`npm run dev` copies the pinned MuJoCo runtime and the show's typefaces into `public/` before starting Next, so a fresh clone needs no extra step:

- `node scripts/sync-mujoco.mjs` **verifies** `public/mujoco.js` and `public/mujoco.wasm` against the pinned `@mujoco/mujoco`. Both files are committed; if one is stale or hand-edited the command fails rather than shipping physics that disagrees with the Node tests. Re-copy with `node scripts/sync-mujoco.mjs --write`.
- `node scripts/sync-fonts.mjs` copies Anton, Barlow Condensed and Chivo Mono `.woff` files from the pinned `@fontsource` packages into `public/fonts/` (WebGL SDF text reads `.woff`, not `.woff2`) and writes `OFL.txt`. It is idempotent and silent when current.

**Port.** Next takes 3000 unless it is busy. `PORT=3100 npm run dev` picks another. The dev server prints the URL it actually bound.

**First load** fetches a 10 MB `mujoco.wasm` and the arm meshes; the boot ladder on screen is real progress, and the whole thing then runs from the browser cache. Use Chrome, Edge or another Chromium browser: the game needs WebGL 2, pointer lock and `WebAssembly`. Safari works but has not been measured.

**What you should see.** Boot ladder → Title with an attract match playing behind it → *press any key* → **PICK YOUR MOUNT** (STANDARD carries full camera shake, STABLE halves it; changeable later under SETTINGS → CAMERA) → **GREEN ROOM**. From the Green Room the running order is `01 FIGHT · 02 ENTRANTS · 03 LOADOUT · 04 WARM UP · 05 THE LAB · 06 REPLAYS · 07 SETTINGS`. The first FIGHT is **CALIBRATION**, a short tutorial against JIG; after that FIGHT goes straight to whoever is on the call sheet.

Click the arena once to take pointer lock. `Esc` releases it and pauses.

## Controls

Mouse and keyboard, with the rebindable actions marked **R** (SETTINGS → CONTROLS):

| Input | Action |
|---|---|
| Mouse X / Y | Aim: yaw and elevation. No smoothing, no acceleration. Sensitivity, vertical multiplier and invert-Y are in SETTINGS. |
| **LMB** tap / hold / release | Jab / charge / heavy release. **R** as `STRIKE KEY` = `J`. |
| **RMB** hold | Guard. The press edge is a deflect attempt; pressed while charging it cancels the charge. **R** as `GUARD KEY` = `K`. |
| `W` / `S` | Reach out / in. Hold past 400 ms to step the stance. **R** (also `↑` / `↓`) |
| `A` / `D` | Stance drift left / right — the camera follows. **R** (also `←` / `→`) |
| `Space` hold | Grip closed; release opens. Grab assist snaps the jaws onto a cube. **R** |
| `Shift` hold | Overdrive. A *press* while Staggered is Burst. Hidden for a profile's first 3 matches. **R** |
| `F` | Loadout ability (SNAP, RECOIL COIL or BULWARK, depending on the loadout). Hidden for the first 3 matches. **R** |
| `Q` / `E` | Wrist roll − / +. Advanced; grab assist sets roll for you. **R** |
| Mouse wheel | Tool pitch, in notches. Advanced. |
| `Tab` hold | Stats overlay: strike speed, heat, reaction time, policy detail. **R** as `STATS` |
| `Esc` | Pause. Not rebindable. |
| `Enter` / `R` | Rematch, on the post-match screen. **R** |

Gamepad (standard mapping, no setup — plug it in and it takes over):

| Input | Action |
|---|---|
| Right stick | **Absolute** swing stick: the stick position *is* the aim. A full flick is a full-speed hook. Click re-centres on the opponent. |
| Left stick | X: stance drift. Y: reach. |
| RT / LT | Strike (tap jab, hold charge, release heavy) / guard. |
| RB / LB | Grip / overdrive (press while Staggered = Burst). |
| `Y` | Ability. `X` / `B`: wrist roll. D-pad up/down: tool pitch. |
| **View** | Stats overlay, held — the same rebindable STATS action as the key. |
| **Menu** | Pause. `A` holds to skip an intro; in menus `A` activates, `B` goes back, LB/RB change tabs, the stick and d-pad move focus. |

Touch: on a phone or tablet the on-screen layer appears by itself (SETTINGS → CONTROLS → TOUCH forces it on or off). Two sticks in the bottom corners, STRIKE / GUARD / GRIP / DRIVE / ABILITY on the thumb arcs.

There is no OPTICS key or button: the picture-in-picture it belonged to is cut by SCOPE 2.2, and nothing is left bound to it.

## Presets

A preset fixes the physics model, the scoring, the timestep, and how much the game is allowed to help you. It is chosen per match — in the Green Room for a model opponent, and on every row of THE LAB.

| | **ARCADE** | **PROVING GROUND** | **HARNESS** |
|---|---|---|---|
| Physics | `arena-arcade.xml`: strike hulls, loadouts, servo states, doubled torque | stock `arena.xml` | stock `arena.xml` |
| Timestep / control | 2.5 ms, 50 Hz | 5 ms, 50 Hz | 5 ms at 50 Hz; 1/600 s at 30 or 60 Hz |
| Scoring | full game scoring | physical: raw × zone × tool | physical |
| Human seat | yes, with jab and charge macros, leash, guard blend, assists and aim assist | yes — leash, guard blend and assists, but no macros and no aim assist | no |
| Hit stop, dilation, comebacks | on | off | off |
| Report stamp | `ARCADE PHYSICS · NOT VERIFICATION` | `CLEARED FOR BROADCAST` or `POLICY FAULT` | same |

A policy is only ever *verified* in PROVING GROUND or HARNESS. ARCADE is the show; it changes the robot, so a stock-trained policy is out of distribution there by design.

## Register a policy

A policy is a single `.js`/`.mjs` module exporting `act(obs)` (and optionally `reset(ctx)`, `policyName`, `provenance`), a `.json` trajectory, or a local Python process on the bridge. `act` returns six absolute joint targets in radians. [`public/policies/example-policy.js`](public/policies/example-policy.js) is a complete, working one.

**In the game.** GREEN ROOM → `02 ENTRANTS` → drop the file on **REGISTER ENTRANT** (or click it and pick the file). Registration runs a checklist in front of you — FILE PARSED, EXPORTS act(), RESET OK, COLD ACT, 200 FIXTURE ACTS with p99, ACTIONS FINITE, WITHIN LIMITS, DETERMINISTIC — and nothing is accepted that fails one. The entrant is kept in the browser under an id derived from its kind and SHA-256, so it survives a reload; registering the same file again just updates its name. It is then selectable as your opponent in the Green Room and in both seats of THE LAB.

**From the command line**, with no browser:

```bash
npm run eval -- --suite smoke-v1 --policy public/policies/example-policy.js --out .eval/smoke
```

Six matches against OVERSHOOT, BACKLASH and DEADBAND at Contender, both seats, then a bit-exact replay check. It prints a per-match line, the gate table (MATCHES COMPLETE, POLICY HANGS, POLICY ERRORS, POLICY DISCONNECTS, REPLAY BIT-EXACT) and writes the episodes plus `results.json` to `--out`. `--policy` also takes `builtin:overshoot:pro`, a `.json` trajectory, or `ws://host:port` for a bridge.

[`docs/HARNESS.md`](docs/HARNESS.md) is the reference: the observation schema `torquelimit.obs/3`, seats and timing, the bridge protocol, the episode format, the statistics and the verdict, and the limits a policy must stay inside.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `sync-mujoco` (verify) + `sync-fonts` + `next dev`. |
| `npm run build` / `npm start` | The same two syncs + `next build`, then the production server. |
| `npm run typecheck` | `tsc --noEmit` over the whole tree. |
| `npm run lint` | ESLint (Next core web vitals, TypeScript, `import type` enforced under `src/game`). |
| `npm test` | `node --test tests/*.test.mjs` — 797 tests in 147 suites. |
| `npm run eval -- --suite smoke-v1 --policy <file> --out <dir>` | The headless smoke suite (above). |
| `npm run check:stubs` | Fails while any package still ships a stub. None do. |
| `npm run bench` | Headless physics bench (`scripts/bench-physics.mjs`). |
| `npm run sync:fonts` | The font copy on its own; `--check` verifies without writing. |
| `npm run gen:arcade-model` | Regenerates `public/models/robotstudio_so101/arena-arcade.xml` and `so101-arcade.xml`. |
| `npm run gen:fixture` | Regenerates the registration fixture observations in `public/policies/fixtures/`. |
| `npm run probe:docks` | The dock geometry gate: every loadout's own dock inside 70% extension, the opponent's inside 85%. |
| `npm run build:web` | Static export to `out/` with the service worker (see `docs/APPS.md`). |
| `npm run app:serve` | Serves `out/` with correct MIME types on port 4300. |
| `npm run app:dev` / `npm run app:mac` | Electron shell against the export / packaged unsigned arm64 `.app` + `.dmg` in `dist-app/`. |
| `npm run app:icons` | Regenerates the app icon SVGs (and PNGs where a rasteriser is available). |

Query flags on the dev server: `?debug=feel` (fps, frame and CPU p95, draw calls, triangles, programs, hit stop and its budget, juice and stance offsets, reticle error), `?debug=greycard`, `?debug=contrast`, `?debug=vfx`, and `?debug=bench`, which runs the browser physics bench instead of the game and prints its report.

## Spine (WP1)

The spine is the dependency root every other package builds on. Everything lives under `src/game/`.

- **Contracts.** [`contracts.ts`](src/game/contracts.ts) holds every shared type and protocol constant (`CONTRACTS_VERSION` 3.0.0). Erasable TypeScript only, so Node runs it without a compiler. Changing a contract after the parallel phase follows BUILD_PLAN 2.3.
- **App shell.** [`src/app/page.tsx`](src/app/page.tsx) renders [`client-entry.tsx`](src/game/client-entry.tsx), the page's only client boundary, which loads [`game-root.tsx`](src/game/game-root.tsx) with `next/dynamic` and `ssr: false`. `game-root` builds the game once per page load, shows real boot progress, prepares audio, waits out the 900 ms boot minimum, enters the Title, and mounts `ArenaCanvas` (WP6) under `BroadcastUi` (WP7). It also pauses on tab hide and forwards pointer-lock changes to the director.
- **Game handle.** [`game-handle.ts`](src/game/game-handle.ts) `createGame()` wires every package factory into one `GameHandle`. WP6 calls `frameTick(wallDtS)` at `useFrame` priority -2: the sim-driver steps physics, the director advances wall-time phases, the bus flushes the frame's events once (feedback, VFX, and HUD subscribe to it), feedback updates, and the mutable `HudFrame` is filled. `runAfterRender()` at +2 runs the HUD runtime's post-render hooks.
- **Loop.** [`loop/game-clock.ts`](src/game/loop/game-clock.ts) (accumulator, hit stop capped at 150 ms each and 120 ms per rolling 600 ms, dilation), [`loop/sim-driver.ts`](src/game/loop/sim-driver.ts) (fixed-step physics, control ticks, policy scheduling in live and eval timing, action delay, fair delay, recording, checkpoints, moment buffer), [`loop/event-ring.ts`](src/game/loop/event-ring.ts) (per-seat events since the last observation), [`loop/headless-runner.ts`](src/game/loop/headless-runner.ts) (the same sim-driver and director with presentation collapsed to eval step counts, for the CLI and smoke suite).
- **Match.** [`match/match-director.ts`](src/game/match/match-director.ts) runs every phase from boot to post-match, earned replays ([`replay-moments.ts`](src/game/match/replay-moments.ts)), the Calibration tutorial ([`tutorial-script.ts`](src/game/match/tutorial-script.ts)), pause and pointer-lock rules, and saving finished episodes. [`presets.ts`](src/game/match/presets.ts) is the ARCADE / PROVING GROUND / HARNESS table; [`match-config.ts`](src/game/match/match-config.ts) builds and validates `MatchConfig`.
- **Core.** [`core/event-bus.ts`](src/game/core/event-bus.ts), [`ui-store.ts`](src/game/core/ui-store.ts) (low-rate React state), [`settings.ts`](src/game/core/settings.ts) (localStorage v2 with migration), [`rng.ts`](src/game/core/rng.ts) (sfc32 with named substreams), [`hud-frame.ts`](src/game/core/hud-frame.ts) (allocation-free per-frame HUD data).
- **Fakes.** [`testing/fakes.ts`](src/game/testing/fakes.ts) provides fake engines, rules, drivers, pilots, feedback, recorders, and event builders for tests.

### Stub protocol

Each package's factory exists from day one so the tree always typechecks, lints, tests, and boots. A stub returns an inert, type-correct object and carries exactly one marker line, `export const __STUB__ = "WPn";`. The owning package replaces the stub in place, keeps every exported signature, and deletes the marker. `npm run check:stubs` lists the remaining stubs by package and passes only when none remain — none do. [`tests/import-smoke.test.mjs`](tests/import-smoke.test.mjs) imports every non-React module under `src/game` in Node, calls each factory with fakes, and boots `createGame()` through the Title; it kept passing as each stub was replaced, and still does.

## Model sources

- [Google DeepMind MuJoCo Menagerie SO-101](https://github.com/google-deepmind/mujoco_menagerie/tree/main/robotstudio_so101) (Apache-2.0; its `LICENSE`, `README.md`, and `CHANGELOG.md` are kept beside the assets)
- [Google DeepMind MuJoCo JavaScript bindings](https://github.com/google-deepmind/mujoco/tree/main/wasm)
- [Hugging Face LeRobot SO-101 guide](https://huggingface.co/docs/lerobot/so101)
