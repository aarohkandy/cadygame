# TORQUE LIMIT: Build plan (sprint contract)

**Precedence:** `SCOPE.md` > this file > `GAME_DESIGN.md`. This file turns SCOPE into file ownership, contract edits, stubs, acceptance criteria, and wiring. Where this file is silent, follow `GAME_DESIGN.md`.

**Sprint boundary.** SCOPE 2.1 items 1 to 10 are in this sprint. Item 11 and all of SCOPE 4 (web static export, PWA, Electron, Capacitor, `docs/APPS.md`) are **not** in this sprint. No package creates a manifest, service worker, `electron/`, `capacitor.config.*`, or `output: "export"` config. Two things from SCOPE 4 are in this sprint because the game needs them regardless: **touch controls** (WP3) and **no network at runtime** (every package).

**Branch:** `fps-duel`. Nobody commits, pushes, or changes branches. The dev server on port 3000 stays up; nobody starts another server on 3000 or kills it.

---

## 0. Decisions this plan makes

SCOPE leaves these open. They are binding for the sprint; the product owner can reverse any of them by editing this section.

| # | Decision | Why |
|---|---|---|
| D1 | **Verification tasks (GAME_DESIGN 5.11) are cut**: `TaskId`, the `task` phase and event, `task-objectives.ts`, JIG `chase`, `tasks-v1`, RUN TASK. | Not in SCOPE 2.1's Lab list; finished beats broad. |
| D2 | **Only the `smoke-v1` suite exists.** It runs from `npm run eval` and `HarnessApi.runSuite`. The Lab has no RUN SUITE button. `gauntlet-v2`, the Bradley–Terry rating, and the baseline regression gate (`--baseline`, exit code 2) are cut. Aggregates keep the seed-bootstrap win-rate CI. | SCOPE 2.1 item 10 names the smoke suite only; the others are nightly/scale tooling. |
| D3 | **Proxy bots: `human_proxy` only.** It is needed by `replay-verify` (human-vs-builtin Proving Ground verify) and `headless-runner` tests. It is not offered in the Lab. `heavy-guess` is tested with a scripted observation stream instead of `heavy_mixer`. | SCOPE 2.2. |
| D4 | **DEMO preset is removed from the contracts** for this sprint (`MatchPreset` has three values). Adding it later is a contract bump. | SCOPE 2.1 item 4 makes it optional; a half-typed preset would be a dead path. |
| D5 | **Episode format `torquelimit.episode/3`**: one JSON document, file extension `.tlep.json`. Every typed column, RLE stream, `SimState`, and checkpoint is stored as `{ dtype, length, b64 }` holding the exact little-endian bytes (float64 stays float64, float32 stays float32). IndexedDB stores the in-memory `Episode` by structured clone; JSON encoding happens only on export, and decoding on import. No worker, no gzip, no binary container. | SCOPE 2.2 (`.tlep` codec cut). |
| D6 | **Replay viewer stays** (scrub, speeds, event markers, broadcast/cockpit cameras, target ghost, brain panel, VERIFY). JOINT PLOTS, FORCES, TAKE OVER, COMPARE, and EXPORT HUMAN DEMOS are cut. | Verify needs a home; SCOPE cuts take over and compare. |
| D7 | **Profile keeps only**: local W–L per entrant and tier, and personal bests for the post-match superlatives (`NEW PB`). No rep, levels, cosmetics, medals, league, daily, drills, rival, scouting. Entrant cards show no flaw line and no medals row. `flaw` events stay (the AI still adapts and the hosts call a patch). | SCOPE 2.1 item 1 "post-match with bragging stats"; SCOPE 2.2. |
| D8 | **Steal rule** (SCOPE 2.1 item 3), exact: the lock-in countdown belongs to the Core, not the seat. A steal (the old "pry" test in GAME_DESIGN 2.5, unchanged) pauses the countdown and marks the Core loose. Whoever next docks it in **their own** dock becomes owner and the countdown **resumes from the remaining value**, clamped to that seat's full lock-in (`min(remaining, lockInS[seat])`: 8.0, 6.0 underdog, 4.0 sudden death). The original owner re-docking also resumes. A late steal is a steal with ≤ 2.0 s remaining. The word "pry" is replaced by "steal" everywhere (types, events, stats, copy). | SCOPE 1.2 objective words and 2.1 item 3. |
| D9 | **Two hosts replace THE OPERATOR.** Captions always; host voice via Web Speech API, off by default. GAME_DESIGN 8.5's "numbers are never spoken" and `readAloudBy` rules are removed (they served pre-rendered VO). Copy rules become: ≤ 9 words, banned-word list kept, no exclamation marks except at most one in a ROOK P1 line; ROOK lines carry no number tokens; ≥ 60% of VALE lines carry a real number token (`{speed}`, `{ms}`, `{dmg}`, `{secs}`, `{newtons}`). Budget ≤ 6 lines per round, ≤ 2 P3; a ROOK call plus a VALE follow-up on one P1/P2 event counts as two lines. Speech from Web Speech cannot be routed through WebAudio, so the "radio/PA filter" is a synthesized squelch-in click and noise tail on `voiceBus` around each utterance plus a pitch/rate choice per host. | SCOPE 1.2, 3. |
| D10 | **Robot meshes load from the Menagerie STLs at runtime** (`STLLoader` → `mergeVertices` → crease normals 35° → per-vertex edge mask), cached in a module-level promise cache and by HTTP cache. No LODs. The two arms are ~726k triangles; to stay inside the triangle budget the **shadow pass uses collision-proxy geometry** (MJCF capsule/box geoms), not the visual meshes. Triangle gate: ≤ 1.2 M per frame including shadow. | SCOPE 2.2 (meshoptimizer bakes cut). |
| D11 | **Fonts:** `next/font/google` for DOM text (Anton, Barlow Condensed 500–900 roman and italic, Chivo Mono). For WebGL SDF text (lobby tiles, deck, jumbotron) the same faces come from `@fontsource/anton`, `@fontsource/barlow-condensed`, `@fontsource/chivo-mono` (dev dependencies), copied as `.woff` into `public/fonts/` by `scripts/sync-fonts.mjs` with `OFL.txt`. The slant is a fixed decision (panels 12°, Anton stamps `skewX(-10deg)`, stickers −4°), so there is no measurement script. | SCOPE 1.3, 2.2. |
| D12 | **Python checks that need `lerobot`/`torch` do not run on this laptop** (disk budget). `tools/export/test_to_lerobot.py` validates the exporter's frame dicts against a pure-numpy fake writer locally; the real `LeRobotDataset("./ds")` load is a documented command for the homebase server. | Team rule: keep local disk use small. |
| D13 | **Hype-to-visual and LED-strike flashes are driven from the bus, not from React.** The holographic crowd reads `game.feedback.audio.hype`; LED strips, pylons, and sponsor-board floods are driven by `vfx-system.ts`. | Zero per-frame React commits. |

---

## 1. Package file lists

Rules:
- Every path below belongs to exactly one package. A package edits only its own files. `(delete)` marks a legacy file the package removes. `(read-only)` marks a vendored or design file the package guards but does not edit.
- Tests are `tests/<name>.test.mjs` and are owned by the package that lists them.
- The only exception to "edit only your own files" is the **stub pre-phase** (section 3): WP1 creates the first compiling version of every other package's factory file. Ownership does not move; the owning package replaces the stub.
- Need a change in someone else's file: message that package's owner with the exact edit. Contract changes follow section 2.3.

### WP1: Spine (contracts, loop, director, presets, headless runner, app shell, repo config)

```files
src/game/contracts.ts
src/game/testing/fakes.ts
src/app/page.tsx
src/game/client-entry.tsx
src/game/game-root.tsx
src/game/game-handle.ts
src/game/loop/game-clock.ts
src/game/loop/sim-driver.ts
src/game/loop/event-ring.ts
src/game/loop/headless-runner.ts
src/game/match/match-director.ts
src/game/match/match-config.ts
src/game/match/presets.ts
src/game/match/replay-moments.ts
src/game/match/tutorial-script.ts
src/game/core/event-bus.ts
src/game/core/ui-store.ts
src/game/core/settings.ts
src/game/core/rng.ts
src/game/core/hud-frame.ts
scripts/sync-mujoco.mjs
scripts/check-stubs.mjs
public/mujoco.js
public/mujoco.wasm
package.json
package-lock.json
tsconfig.json
next.config.ts
eslint.config.mjs
postcss.config.mjs
next-env.d.ts
.gitignore
.claude/launch.json
README.md
AGENTS.md (read-only)
CLAUDE.md (read-only)
docs/design/SCOPE.md (read-only)
docs/design/GAME_DESIGN.md (read-only)
docs/design/BUILD_PLAN.md
docs/design/research/ai-opponent.md (read-only)
docs/design/research/codebase.md (read-only)
docs/design/research/combat-design.md (read-only)
docs/design/research/finals-feel.md (read-only)
docs/design/research/finals-visual.md (read-only)
docs/design/research/fps-feel.md (read-only)
src/components/arena-app.tsx (delete)
tests/game-clock.test.mjs
tests/hitstop-budget.test.mjs
tests/sim-driver.test.mjs
tests/event-ring.test.mjs
tests/event-bus.test.mjs
tests/headless-runner.test.mjs
tests/match-director.test.mjs
tests/replay-moments.test.mjs
tests/tutorial-script.test.mjs
tests/presets.test.mjs
tests/replay-state-restore.test.mjs
tests/rng.test.mjs
tests/settings.test.mjs
tests/import-smoke.test.mjs
```

### WP2: Physics, combat rules, kinematics, arena models

```files
public/models/robotstudio_so101/arena.xml
public/models/robotstudio_so101/arena-arcade.xml
public/models/robotstudio_so101/so101.xml (read-only)
public/models/robotstudio_so101/assets/** (read-only)
public/models/robotstudio_so101/LICENSE (read-only)
public/models/robotstudio_so101/README.md (read-only)
public/models/robotstudio_so101/CHANGELOG.md (read-only)
src/game/physics/engine.ts
src/game/physics/mujoco-loader.ts
src/game/physics/model-index.ts
src/game/physics/contact-scan.ts
src/game/physics/servo.ts
src/game/physics/sim-state.ts
src/game/physics/bench-browser.ts
src/game/combat/combat-rules.ts
src/game/combat/damage.ts
src/game/combat/heat.ts
src/game/combat/servo-states.ts
src/game/combat/core-objective.ts
src/game/combat/abilities.ts
src/game/combat/tuning.ts
src/game/kinematics/so101-kinematics.ts
scripts/bench-physics.mjs
scripts/gen-arcade-model.mjs
scripts/probe-dock-geometry.mjs
src/lib/mujoco-engine.ts (delete)
src/lib/task-space-ik.mjs (delete)
tests/mujoco-duel.test.mjs
tests/contact-scan.test.mjs
tests/arcade-model.test.mjs
tests/tunneling.test.mjs
tests/core-geometry.test.mjs
tests/combat-damage.test.mjs
tests/combat-defense.test.mjs
tests/combat-heat.test.mjs
tests/combat-abilities.test.mjs
tests/servo-states.test.mjs
tests/core-objective.test.mjs
tests/core-steal-countdown.test.mjs
tests/hitstop-table.test.mjs
tests/kinematics.test.mjs
tests/harness-model-immutable.test.mjs
tests/physical-scoring.test.mjs
tests/physics-determinism.test.mjs
```

Removed from GAME_DESIGN 11.4 WP2: `public/models/robotstudio_so101/variants/**`, `src/game/combat/task-objectives.ts`, `tests/task-objectives.test.mjs`.

### WP3: Feel (input incl. touch, pilot, assists, cockpit camera, juice, procedural audio, hosts' line bank and voice, feedback)

```files
src/game/input/input-system.ts
src/game/input/bindings.ts
src/game/input/gamepad.ts
src/game/input/touch-input.ts
src/game/input/pilot-controller.ts
src/game/input/assists.ts
src/game/input/synthetic-input.ts
src/game/input/haptics.ts
src/game/camera/cockpit-rig.ts
src/game/camera/juice.ts
src/game/camera/springs.ts
src/game/camera/noise.ts
src/game/audio/audio-engine.ts
src/game/audio/synth.ts
src/game/audio/sfx.ts
src/game/audio/kill-confirm.ts
src/game/audio/beds.ts
src/game/audio/music.ts
src/game/audio/music-score.ts
src/game/audio/crowd.ts
src/game/audio/feedback-audio.ts
src/game/audio/debug-audio.ts
src/game/announcer/announcer.ts
src/game/announcer/lines.ts
src/game/announcer/host-voice.ts
src/game/feedback/feedback-system.ts
src/game/feedback/hype.ts
src/lib/arena-audio.mjs (delete)
src/lib/gamepad-controls.mjs (delete)
src/lib/manual-controls.mjs (delete)
tests/arena-audio.test.mjs (delete)
tests/gamepad-controls.test.mjs (delete)
tests/manual-controls.test.mjs (delete)
tests/pilot-controller.test.mjs
tests/assists.test.mjs
tests/synthetic-input.test.mjs
tests/gamepad.test.mjs
tests/touch-input.test.mjs
tests/cockpit-rig.test.mjs
tests/juice.test.mjs
tests/announcer.test.mjs
tests/host-lines.test.mjs
tests/audio-graph.test.mjs
tests/synth-recipes.test.mjs
tests/music-score.test.mjs
tests/crowd-hype.test.mjs
```

Removed from GAME_DESIGN 11.4 WP3: `src/game/audio/asset-loader.ts`, `standins.ts`, `src/game/announcer/screen-reader-voice.ts`, `public/audio/**`, `tools/vo/render_lines.py`, `tools/vo/README.md`, `tools/audio/RECORDING.md`.

### WP4: AI opponent, human proxy, policy runtime, registration

```files
src/game/policy/observation.ts
src/game/policy/obs-schema.ts
src/game/policy/seat-drivers.ts
src/game/policy/in-process-driver.ts
src/game/policy/policy-worker.ts
src/game/policy/policy-rng-shim.ts
src/game/policy/bridge-worker.ts
src/game/policy/bridge-client.ts
src/game/policy/action-validation.ts
src/game/policy/chunk-executor.ts
src/game/policy/trajectory.ts
src/game/policy/proxy-driver.ts
src/game/policy/registration.ts
src/game/policy/opponent/index.ts
src/game/policy/opponent/perception.ts
src/game/policy/opponent/mind.ts
src/game/policy/opponent/decision.ts
src/game/policy/opponent/primitives.ts
src/game/policy/opponent/motor.ts
src/game/policy/opponent/personalities.ts
src/game/policy/opponent/tiers.ts
src/game/policy/opponent/dda.ts
src/game/policy/opponent/jig.ts
src/game/policy/proxy-bots/index.ts
src/game/policy/proxy-bots/human-proxy.ts
public/policies/example-policy.js
public/policies/fixtures/registration-obs-3.json
public/schemas/torquelimit.obs-3.json
scripts/gen-registration-fixture.mjs
src/lib/arm-participation.mjs (delete)
tests/arm-participation.test.mjs (delete)
tests/observation.test.mjs
tests/obs-schema.test.mjs
tests/action-validation.test.mjs
tests/chunk-executor.test.mjs
tests/trajectory.test.mjs
tests/seat-drivers.test.mjs
tests/rng-shim.test.mjs
tests/bridge-client.test.mjs
tests/registration.test.mjs
tests/example-policy.test.mjs
tests/opponent-determinism.test.mjs
tests/opponent-behavior.test.mjs
tests/opponent-humanness.test.mjs
tests/heavy-guess.test.mjs
tests/dda.test.mjs
tests/flaws.test.mjs
tests/proxy-bots.test.mjs
```

Removed from GAME_DESIGN 11.4 WP4: `src/game/policy/proxy-bots/exploit-bots.ts`; the fixture becomes `.json` (D5 encoding) instead of `.bin`.

### WP5: Harness (recording, JSON episodes, stores, replay, verify, stats, smoke suite, bridge tooling, LeRobot export, CLI)

```files
src/game/harness/recorder.ts
src/game/harness/typed-b64.ts
src/game/harness/episode-format.ts
src/game/harness/idb.ts
src/game/harness/episode-store.ts
src/game/harness/episode-store-fs.ts
src/game/harness/entrant-store.ts
src/game/harness/moment-buffer.ts
src/game/harness/replay-player.ts
src/game/harness/stats.ts
src/game/harness/verdict.ts
src/game/harness/aggregate.ts
src/game/harness/suite.ts
src/game/harness/determinism.ts
src/game/harness/provenance.ts
src/game/harness/harness-api.ts
scripts/eval.mjs
tools/bridge/torquelimit_bridge.py
tools/bridge/example_policy_server.py
tools/bridge/calibration.py
tools/bridge/test_calibration.py
tools/bridge/test_bridge_protocol.py
tools/bridge/README.md
tools/export/to_lerobot.py
tools/export/test_to_lerobot.py
tools/export/requirements.txt
docs/HARNESS.md
tests/recorder.test.mjs
tests/typed-b64.test.mjs
tests/episode-format.test.mjs
tests/episode-store.test.mjs
tests/storage-eviction.test.mjs
tests/entrant-store.test.mjs
tests/moment-buffer.test.mjs
tests/stats.test.mjs
tests/verdict.test.mjs
tests/aggregate.test.mjs
tests/replay-verify.test.mjs
tests/suite.test.mjs
tests/eval-cli.test.mjs
```

Removed from GAME_DESIGN 11.4 WP5: `episode-codec-worker.ts`, `replay-driver.ts`, `takeover.ts`, `compare.ts`, `video-recorder.ts`, and tests `regression-gate`, `takeover`, `compare`.

### WP6: Stage (world rendering, game-show set, holographic crowd, cameras, reticle overlay, lighting, post, VFX incl. de-rez)

```files
src/game/render/arena-canvas.tsx
src/game/render/frame-timing.ts
src/game/render/robot-assets.ts
src/game/render/robot-materials.ts
src/game/render/robot-decals.ts
src/game/render/robot-view.tsx
src/game/render/ghost-arm.tsx
src/game/render/reticle-overlay.tsx
src/game/render/range-arcs.tsx
src/game/render/cubes-view.tsx
src/game/render/stage.tsx
src/game/render/stage-deck.tsx
src/game/render/deck-texture.ts
src/game/render/brand-textures.ts
src/game/render/led-strips.tsx
src/game/render/pylons.tsx
src/game/render/truss-rig.tsx
src/game/render/jumbotron.tsx
src/game/render/sponsor-boards.tsx
src/game/render/hopper.tsx
src/game/render/cyclorama.tsx
src/game/render/holo-crowd.tsx
src/game/render/holo-crowd-material.ts
src/game/render/lobby-tiles.tsx
src/game/render/lighting.tsx
src/game/render/post-stack.tsx
src/game/render/camera-director.tsx
src/game/render/camera-math.ts
src/game/render/shadow-proxies.ts
src/game/render/blob-shadows.ts
src/game/render/quality.ts
src/game/render/interpolate.ts
src/game/render/prewarm.ts
src/game/render/debug-scenes.tsx
src/game/render/vfx/vfx-system.ts
src/game/render/vfx/sparks.ts
src/game/render/vfx/bursts.ts
src/game/render/vfx/ripples.ts
src/game/render/vfx/smears.ts
src/game/render/vfx/decals.ts
src/game/render/vfx/chips.ts
src/game/render/vfx/confetti.ts
src/game/render/vfx/prize-burst.ts
src/game/render/vfx/derez.ts
src/game/render/vfx/haze.ts
src/game/render/vfx/lock-pulse.ts
src/game/render/vfx/rerender-scan.ts
src/game/render/vfx/stage-cues.ts
src/components/arena-scene.tsx (delete)
tests/interpolate.test.mjs
tests/camera-math.test.mjs
tests/reticle-projection.test.mjs
tests/vfx-pools.test.mjs
tests/derez-timeline.test.mjs
tests/stl-geometry.test.mjs
tests/deck-texture-layout.test.mjs
tests/crowd-instancing.test.mjs
```

Removed from GAME_DESIGN 11.4 WP6: `policy-cameras.ts`, `laptop-screen.tsx`, `crowd.tsx` (replaced by `holo-crowd.tsx`), `bench-reset.ts` (replaced by `rerender-scan.ts`), `scripts/bake-meshes.mjs`, `scripts/bake-set.mjs`, `public/models/so101-render/**`, `public/models/set/**`, tests `mesh-bake`, `set-bake`. `public/fonts/**` moved to WP7.

### WP7: Broadcast UI (screens, HUD DOM, brand: show, hosts, sponsors, mascot, fonts, styles)

```files
src/app/layout.tsx
src/app/globals.css
src/app/favicon.ico
src/app/fonts.ts
STYLES.md
public/og.png
public/file.svg (delete)
public/globe.svg (delete)
public/next.svg (delete)
public/vercel.svg (delete)
public/window.svg (delete)
public/fonts/**
scripts/sync-fonts.mjs
docs/design/screens/**
src/game/brand/marks.ts
src/game/brand/sponsors.ts
src/game/brand/mascot.ts
src/game/brand/hosts.ts
src/game/brand/wordmark.tsx
src/game/brand/slant.ts
src/game/ui/broadcast-ui.tsx
src/game/ui/kit/plate.tsx
src/game/ui/kit/stamp.tsx
src/game/ui/kit/sticker.tsx
src/game/ui/kit/slant-button.tsx
src/game/ui/kit/wipe.tsx
src/game/ui/kit/count-up.tsx
src/game/ui/kit/tabs.tsx
src/game/ui/kit/slider.tsx
src/game/ui/kit/toggle.tsx
src/game/ui/kit/glyphs.tsx
src/game/ui/kit/hazard.tsx
src/game/ui/kit/halftone.tsx
src/game/ui/screens/boot-screen.tsx
src/game/ui/screens/title-screen.tsx
src/game/ui/screens/cockpit-choice.tsx
src/game/ui/screens/green-room.tsx
src/game/ui/screens/loadout-picker.tsx
src/game/ui/screens/entrants-screen.tsx
src/game/ui/screens/register-entrant.tsx
src/game/ui/screens/lab-screen.tsx
src/game/ui/screens/lab-results.tsx
src/game/ui/screens/replays-screen.tsx
src/game/ui/screens/replay-viewer.tsx
src/game/ui/screens/settings-screen.tsx
src/game/ui/screens/pause-menu.tsx
src/game/ui/screens/post-match-screen.tsx
src/game/ui/screens/tutorial-overlay.tsx
src/game/ui/screens/click-to-fight.tsx
src/game/ui/hud/hud.tsx
src/game/ui/hud/hud-runtime.ts
src/game/ui/hud/tote-board.tsx
src/game/ui/hud/player-strip.tsx
src/game/ui/hud/policy-chip.tsx
src/game/ui/hud/event-feed.tsx
src/game/ui/hud/damage-numbers.tsx
src/game/ui/hud/damage-edges.tsx
src/game/ui/hud/kit-panel.tsx
src/game/ui/hud/captions.tsx
src/game/ui/hud/banners.tsx
src/game/ui/hud/banner-queue.ts
src/game/ui/hud/core-marker.tsx
src/game/ui/hud/best-score-strip.tsx
src/game/ui/hud/match-intro.tsx
src/game/ui/hud/replay-overlay.tsx
src/game/ui/hud/hold-skip-bar.tsx
src/game/ui/hud/stats-overlay.tsx
src/game/ui/hud/debug-overlay.tsx
src/game/ui/hud/format.ts
src/game/ui/meta/profile.ts
src/game/ui/meta/superlatives.ts
src/components/controller-map.tsx (delete)
tests/hud-format.test.mjs
tests/banner-queue.test.mjs
tests/damage-number-merge.test.mjs
tests/styles-tokens.test.mjs
tests/copy-labels.test.mjs
tests/profile.test.mjs
tests/superlatives.test.mjs
tests/brand-marks.test.mjs
tests/ip-guard.test.mjs
```

Removed from GAME_DESIGN 11.4 WP7: `scripts/measure-font-slant.mjs`; screens `league-screen`, `daily-screen`, `compare-view`, `drill-overlay`; meta `league`, `medals`, `daily`, `drills`, `rival`, `scouting`; tests `league`, `medals`, `daily-seed`, `drills-offer`, `scouting`. Added: fonts moved in from WP6, `fonts.ts`, `sponsors.ts`, `mascot.ts`, `hosts.ts`, `sticker.tsx`, `halftone.tsx`, `stats-overlay.tsx`, `superlatives.ts`, `docs/design/screens/**`.

### Not assigned to anyone this sprint

Packaging (SCOPE 4): `public/manifest.webmanifest`, service worker, icons, `electron/**`, `capacitor.config.*`, `docs/APPS.md`, any `app:*` npm script. Build outputs (`.next/`, `.eval/`, `node_modules/`) are generated and ignored.

---

## 2. Contract adjustments (applied by WP1 to GAME_DESIGN 11.2 before the parallel phase)

WP1 writes `src/game/contracts.ts` from GAME_DESIGN 11.2 **with every edit below applied**, then sets `CONTRACTS_VERSION = "3.0.0"`. Edits are listed by section of the 11.2 listing. "Remove" means delete the symbol and every field, union member, parameter, or comment that references it.

### 2.1 Removals (cut features)

| Symbol or field | Edit | Cut feature |
|---|---|---|
| `ArenaVariantId` | Remove the type. Remove `ModelInfo.variant`, the `variant?` option of `CreatePhysicsEngine`, `RulesConfig.variant`, `MatchConfig.variant`, `ResetContext.arena.variant`, `EpisodeMeta.variant`, and the `{ kind: "variant" }` member of `SimMutation`. Change the `PhysicsFrame.docks` comment to `// 2×3, world dock centres (atlas, blaze), static`. | arena variants |
| `MatchPreset` `"demo"` | `export type MatchPreset = "arcade" \| "proving_ground" \| "harness";` and drop the `demo` keys from `PRESET_PHYSICS` and `PRESET_SCORING`. Remove `DemoSessionMeta`, `MatchConfig.demo`, `EpisodeMeta.demo`. | DEMO (D4) |
| Tasks | Remove `TaskId`, `TaskState`, `CombatSnapshot.task`, `RulesConfig.task`, `MatchConfig.task`, `ResetContext.task`, the `task` `GameEvent`, `"task"` from `MATCH_PHASES`, `"task"` from `EngineResetOptions.layout`, `"chase"` from `JigBehavior`. | tasks (D1) |
| `combatDamage` | Remove from `RulesConfig` and `MatchConfig`. | `core-race-v1` suite |
| `ProxyBotId` | `export type ProxyBotId = "human_proxy";` | exploit bots (D3) |
| Replay driver | Remove `{ kind: "replay"; episodeId: string; seat: Seat }` from `DriverSpec`; the `Exclude<…>` in `CreateSeatDriver` and `CreateInProcessSeatDriver` becomes `Exclude<DriverSpec, { kind: "human" } \| { kind: "proxy" }>`. | take over |
| Policy images | Remove `CameraImageId`, `ImageRequest`, `ObsImages`, `PolicyImageSource`, `SeatConfig.images`, `Observation.images`, the `images` parameter of `ObservationBuilder.build`, `ResetContext.images`, `SeatMeta.images`, `TickRecord.images`, `Episode.video`, `GameView.policyImages`, `CreateHeadlessMatchRunner` dep `images`. Delete the render-side services section header. | policy image cameras, video recorder |
| Take over / compare | Remove `MatchConfig.parent`; `EpisodeMeta.parentEpisodeId`, `branchFrame`, `policyState`; `ReplayPlayer.takeOver`; `HarnessApi.createReplayDriver`, `compare`, `compareToBaseline`; `CompareResult`, `RegressionReport`. | take over, compare, regression gate (D2) |
| Rating | Remove `AggregateStats.rating` and `ratingCi`. | D2 |
| Suites | `export type SuiteId = "smoke-v1";` Remove `SuiteResult.heatmap`. | nightly suites (D2) |
| Binary codec | Replace `EpisodeCodec` (see 2.2). In `EpisodeStore`: `exportBlob(id: string): Promise<Blob>` (JSON only); remove `exportHumanDemos`. | `.tlep` codec (D5), EXPORT HUMAN DEMOS (D6) |
| Meta screens | `Screen` loses `"league" \| "daily" \| "compare" \| "drill"`. `MatchConfig.context` becomes `"quick" \| "lab" \| "tutorial" \| "warmup" \| "attract" \| "suite"`. Remove the "daily" and "league" wording from `UiState` comments and `MatchDirector` comments. | league, daily, drills, compare |
| Operator | Remove the `"OPS"` speaker (replaced in 2.2). `Settings.audio.operatorVoice` and `screenReaderVoice` removed (replaced in 2.2). | Piper VO, screen-reader voice |
| Audio assets | Remove `AudioControl.load` and `AudioControl.standinsInUse` (replaced in 2.2). | recorded audio |
| Brand | Remove `TokenColor` values `"ink-500" \| "paper-50" \| "prize"` naming (replaced in 2.2). | Archivo/workbench identity |

### 2.2 Additions and changes

Paste these into the named sections of `contracts.ts`, replacing the originals where a symbol already exists.

**Primitives section:**

```ts
export const CONTRACTS_VERSION = "3.0.0";
export type HostId = "rook" | "vale";
export type InputDevice = "keyboard_mouse" | "gamepad" | "touch" | "synthetic";
```

**Combat section: the Core with a steal that inherits the countdown (D8).**

```ts
export interface CoreState {
  phase: "dormant" | "incoming" | "live";
  owner: Seat | null;                  // seat whose countdown runs while docked in its own dock; null before the first dock
  dockedIn: Seat | null;               // dock currently holding the Core (only a seat's own dock counts)
  lockInRemainingS: number;            // the Core's countdown; paused while undocked; inherited on steal (D8)
  lockInTotalS: number;                // full lock-in of the current owner (8, 6 underdog, 4 sudden death), for the ring UI
  contested: boolean;
  loose: boolean;                      // true after a steal until someone docks it
  stolenFrom: Seat | null;             // owner at the moment of the last steal; cleared on the next dock
  lastTouchedBy: Seat | null;
}
```

Rules text that WP2 implements and `core-steal-countdown` tests: on steal, `loose = true`, `stolenFrom = owner`, countdown paused. On the next dock of a loose Core by seat `s` in `s`'s own dock: `owner = s`, `lockInTotalS = lockInS[s]` (4.0 in sudden death), `lockInRemainingS = min(lockInRemainingS, lockInTotalS)`, `loose = false`, `stolenFrom = null`, emit `core` stage `lock_in_resume` with `inherited: s !== previousOwner`. The first dock of an unowned Core starts at `lockInS[s]` and emits `lock_in_start`.

**Events section:** replace the `core` member of `GameEvent`:

```ts
  | (EvBase & { type: "core"; stage: "incoming" | "drop" | "lock_in_start" | "lock_in_resume" | "contested_on" | "contested_off" | "steal" | "lock";
                seat: Seat | null; from: Seat | null; remainingS: number; late: boolean; inherited: boolean })
```

`late` is true only on `steal` with `remainingS ≤ 2.0`. `inherited` is true only on `lock_in_resume` when the docking seat is not the seat that owned the countdown before the steal.

**Match config section:**

```ts
export type JigBehavior = "parked_in_reach" | "idle" | "hold_guard" | "slow_heavy" | "sparring";
export interface SeatConfig {
  seat: Seat; displayName: string; driver: DriverSpec; loadout: LoadoutId;
  decisionHz: number;
  chunkExecute: ChunkExecute; temporalEnsembleM: number | null;
}
// MatchConfig: fields id, preset, timing, turbo, controlHz, timestep, seed, bestOf, roundLengthS, seats,
// actionDelayTicks, fairDelayMs, strictLimits, record, keepEpisodes, tutorial, fastShow, showKit, context (as edited in 2.1).
```

**Policy section: registration (WP4) and entrants (WP5).**

```ts
export type RegistrationCheckId = "parsed" | "exports_act" | "reset" | "cold_act" | "fixture_acts" | "finite" | "limits" | "deterministic";
export interface RegistrationRow {
  id: RegistrationCheckId; label: string;              // label e.g. "COLD ACT · 41 ms", caps, ≤ 3 words before the mono detail
  status: "pass" | "fail" | "warn"; detail: string | null; fixtureIndex: number | null;
}
export interface RegistrationResult { ok: boolean; rows: RegistrationRow[]; name: string; sha256: string; coldActMs: number; p99ActMs: number; deterministic: boolean; }
export type RunRegistration = (spec: Extract<DriverSpec, { kind: "module" } | { kind: "trajectory" }>, onRow: (row: RegistrationRow) => void, signal?: AbortSignal) => Promise<RegistrationResult>;
export interface BridgeHello { name: string; version: string | null; claimedSha256: string | null; provenance: Record<string, unknown> | null; supportsChunks: boolean; maxChunk: number; chunkHz: number; }
export type ProbeBridge = (url: string, allowLan: boolean) => Promise<BridgeHello>;   // hello → hello_ok → bye

export interface EntrantRecord { id: string; kind: "module" | "trajectory"; fileName: string; name: string; source: string; sha256: string; created: string; }
export interface EntrantStore { list(): Promise<EntrantRecord[]>; save(e: Omit<EntrantRecord, "id" | "created">): Promise<EntrantRecord>; remove(id: string): Promise<void>; }
```

**Pilot section: touch input and device.**

```ts
export interface TouchInput {
  swing(x: number, y: number): void;         // absolute swing stick, each in [−1, 1] after the radial deadzone; maps like RS (GAME_DESIGN 3.4)
  stance(x: number): void;                   // [−1, 1] stance drift, like LS x
  reach(y: number): void;                    // [−1, 1] reach spring, like LS y (up = out)
  button(id: "strike" | "guard" | "grip" | "overdrive" | "ability", down: boolean): void;  // strike: tap = jab, hold = charge, release = heavy
  release(): void;                           // all touches ended (app backgrounded, lock lost)
}
// PilotController changes:
//   readonly device: InputDevice;
//   touch(): TouchInput;                    // same command path as the gamepad; recorded as device "touch"
```

`Settings.controls` gains `touch: { mode: "auto" | "on" | "off"; stickRadiusPx: number; opacity01: number }` (defaults `auto`, 96, 0.8; `auto` shows touch controls when `matchMedia("(pointer: coarse)")` matches).

**Feedback section: procedural audio and hosts.**

```ts
export interface AudioControl {
  unlock(): Promise<void>;
  prepare(onProgress: (done: number, total: number) => void): Promise<void>;   // builds the graph and pre-synthesizes noise/impulse/wavetable buffers during boot
  setMusic(state: MusicState): void;
  playUi(cue: UiCue, whenMs?: number): void;
  setVolumes(v: Settings["audio"]): void;
  readonly hype: number;
  readonly latencyMs: number;
  readonly activeVoices: number;            // ?debug=audio
}
export type UiCue = "hover" | "select" | "back" | "slam" | "stamp" | "sticker" | "countdown_beat" | "engage" | "tick" | "shutter";
export interface Caption { speaker: HostId; lineId: string; text: string; priority: 1 | 2 | 3; durationMs: number; }
```

`Settings.audio` becomes `{ master: number; sfx: number; music: number; crowd: number; voice: number; captions: "full" | "big" | "off"; hostVoice: boolean }` (`hostVoice` default `false`; `voice` sets `SpeechSynthesisUtterance.volume` and the squelch layer gain).

**Harness section: JSON episode format (D5).**

```ts
export const EPISODE_FORMAT = "torquelimit.episode/3";
export type TypedDtype = "f64" | "f32" | "u32" | "i32" | "i16" | "u8";
export interface EncodedTyped { dtype: TypedDtype; length: number; b64: string; }   // exact little-endian bytes, base64
export interface EncodedSimState { time: number; qpos: EncodedTyped; qvel: EncodedTyped; ctrl: EncodedTyped; qacc_warmstart: EncodedTyped; servo: EncodedTyped; }
export interface EpisodeJson {
  format: typeof EPISODE_FORMAT;
  meta: EpisodeMeta & { result: MatchResultRecord };
  columns: Record<string, EncodedTyped>;
  shapes: Record<string, number[]>;
  steps: {
    ctrl: { steps: EncodedTyped; values: EncodedTyped; width: number };
    intents: { steps: EncodedTyped; values: EncodedTyped; width: number };
    mutations: (Exclude<SimMutation, { kind: "reset" }> | { kind: "reset"; step: number; seed: number; round: number; state: EncodedSimState })[];
    checkpoints: { step: number; state: EncodedSimState; checksum: number }[];
  };
  sparse: Record<string, { frame_index: number; value: unknown }[]>;
  events: GameEvent[];
}
export interface EpisodeCodec {
  encode(ep: Episode): Blob;                 // application/json, EpisodeJson
  decode(text: string): Episode;             // throws EpisodeFormatError on a wrong format string, unknown dtype, or length mismatch
}
```

`EpisodeMeta.format` becomes `typeof EPISODE_FORMAT`. `SeatMeta` gains `inputDevice: InputDevice | null` (null for policy seats). `PhysicalSeatStats` renames `pries` → `steals`, `latePries` → `lateSteals`. `HarnessApi` becomes:

```ts
export interface HarnessApi {
  readonly recorder: Recorder; readonly moments: MomentBuffer;
  readonly store: EpisodeStore; readonly entrants: EntrantStore; readonly codec: EpisodeCodec;
  createRecorder(): Recorder;
  createReplayPlayer(engine: PhysicsEngine, clock: GameClock, rules: CombatRules): ReplayPlayer;
  computeStats(ep: Episode): EpisodeStats;
  aggregate(eps: readonly EpisodeStats[], subjectSeat: Seat, seedOf: (i: number) => number): AggregateStats;
  runSuite(opts: SuiteOptions): Promise<SuiteResult>;
  checkDeterminism(ep: Episode): Promise<VerifyResult>;
  checkPolicyDeterminism(driverSpec: DriverSpec, seat: Seat): Promise<boolean>;
}
export type CreateEntrantStore = (kind: "indexeddb" | { fsRoot: string }) => EntrantStore;
export type CreateEpisodeCodec = () => EpisodeCodec;
```

**Game handle section:**

```ts
export interface GameView { camera: PerspectiveCamera | null; canvas: HTMLCanvasElement | null; lastPose: CameraPose | null; }
// GameHandle gains:
//   readonly runRegistration: RunRegistration;   // WP4, used by register-entrant.tsx
//   readonly probeBridge: ProbeBridge;           // WP4, used by the entrants bridge card and the Lab
```

**UI store section:** `BestScoreTile.label` stays `"HARDEST HIT" | "FASTEST STRIKE" | "OBJECTIVE"` (OBJECTIVE shows lock-in held or steals). `UiState` unchanged apart from comments.

**Brand section:**

```ts
export type TokenColor = "ink" | "paper" | "signal" | "volt" | "cobalt" | "magenta" | "strike" | "crit" | "block";
export type BrandMarkId = "torqueLimit" | "needle" | "ohmstead" | "pulpoPop" | "bit";
export interface BrandMark { viewBox: string; paths: { d: string; fill: TokenColor; stroke?: TokenColor; strokeWidth?: number }[]; }
export interface HostProfile { id: HostId; tag: "ROOK" | "DR. VALE"; role: "hype" | "analyst"; lip: TokenColor; speech: { pitch: number; rate: number; preferredVoiceNames: readonly string[] }; }
```

Token hex values are SCOPE 1.3's: ink `#0E0F14`, paper `#F6F3EC`, signal `#FF4A1C`, volt `#FFD60A`, cobalt `#2A6BFF`, magenta `#FF2E7E`, strike `#FFF36B`, crit `#B6FF2E`, block `#3DE0FF`. `JuiceOutput.edge.color` must be one of these hex strings.

### 2.3 After the contracts land

A contract change after the parallel phase starts needs: a message to every package that imports the changed symbol, agreement from each, WP1 applying it, and a `CONTRACTS_VERSION` patch bump. No package edits `contracts.ts` itself.

---

## 3. Stub protocol

**Goal:** the whole tree typechecks, lints, passes `import-smoke`, and boots to a blank Title before any package starts its real work, so seven packages can build in parallel against real imports.

**Pre-phase (WP1 only, in order):**
1. `package.json`: `"type": "module"`, exact pins per GAME_DESIGN 10.1 minus `meshoptimizer`, plus `postprocessing@6.39.5`, `@react-three/postprocessing@3.1.1`, `typescript-eslint` (dev, exact), `@fontsource/anton`, `@fontsource/barlow-condensed`, `@fontsource/chivo-mono` (dev, exact). Scripts: `dev` and `build` run `sync-mujoco.mjs` and `sync-fonts.mjs` first; `start`, `lint`, `typecheck`, `test`, `bench`, `gen:arcade-model`, `probe:docks`, `gen:fixture`, `sync:fonts`, `eval`, `check:stubs`. No `bake:*`, `measure:slant`, or `app:*` scripts. `npm install` once.
2. `tsconfig.json`, `eslint.config.mjs` per GAME_DESIGN 10.1/10.8.
3. WP2 runs `probe-dock-geometry.mjs` (day 0) and hands the dock values to WP1; until then WP1 uses the provisional values and marks the two constants with the probe name in a comment.
4. `src/game/contracts.ts` with section 2 applied.
5. `src/game/testing/fakes.ts` (fakes for every interface a test needs, minus the cut ones: no `FakeImageSource`).
6. A stub for **every export in the table below**, in the owning package's file, plus WP1's own real skeleton of `game-handle.ts`, `game-root.tsx`, `client-entry.tsx`, `page.tsx`.
7. `scripts/check-stubs.mjs` and `tests/import-smoke.test.mjs`.
8. Delete `src/components/arena-app.tsx` and point `page.tsx` at `ClientEntry`. Other legacy files are deleted by their owners (section 1), in this order so the tree always typechecks: WP6 and WP7 delete their `src/components/*` files first thing in the parallel phase; WP2, WP3, and WP4 delete `src/lib/*` files and their old tests only once `src/components/` is empty.
9. `npm run typecheck && npm run lint && npm test && npm run build` all pass; `localhost:3000` renders the stub Title with 0 console errors.

**Stub rules:**
- The exported name, kind, and signature are exactly the contract type (e.g. `export const createPhysicsEngine: CreatePhysicsEngine = async (opts) => …`).
- A stub returns an **inert, type-correct object**: zeroed typed arrays of the right lengths, `readonly` state objects with defaults, methods that do nothing and return the documented neutral value. Async methods resolve. A stub never throws at import or construction, so `createGame()` completes and `import-smoke` can call every factory with fakes.
- A method that cannot have a neutral value (e.g. `ReplayPlayer.verify`) resolves `{ verdict: "error", message: "not built", … }`.
- Each stub file carries exactly one marker line: `export const __STUB__ = "<package id>";`. `npm run check:stubs` fails while any `__STUB__` export exists anywhere under `src/`. The owning package deletes the marker when the real implementation lands. `check:stubs` passing is part of the definition of done; `import-smoke` does not require it.
- Stubs contain no `TODO`, no `console.log`, and no UI text.
- The owning package replaces the stub in place and **keeps every exported signature**. Adding exports is free; removing or changing one is a contract change (2.3).

**Stubbed exports (trimmed GAME_DESIGN 11.3):**

| Export | File | Owner |
|---|---|---|
| `createGame(): Promise<GameHandle>` | `src/game/game-handle.ts` | WP1 |
| `createGameClock`, `createEventBus`, `createSeatEventRing`, `createUiStore`, `createSettingsStore`, `createHudFrame` | `src/game/loop/game-clock.ts`, `src/game/core/event-bus.ts`, `src/game/loop/event-ring.ts`, `src/game/core/ui-store.ts`, `src/game/core/settings.ts`, `src/game/core/hud-frame.ts` | WP1 |
| `createRng`, `substream`, `gaussian`, `exGaussian` | `src/game/core/rng.ts` | WP1 |
| `createHeadlessMatchRunner: CreateHeadlessMatchRunner` | `src/game/loop/headless-runner.ts` | WP1 |
| `presetRules(preset): { physics, scoring, timestep, pilotRules, hitstop, fairDelayDefaultMs }` | `src/game/match/presets.ts` | WP1 |
| `createPhysicsEngine: CreatePhysicsEngine` | `src/game/physics/engine.ts` | WP2 |
| `createCombatRules: CreateCombatRules` | `src/game/combat/combat-rules.ts` | WP2 |
| `hitstopMsFor: HitstopMsFor`, `tuning` | `src/game/combat/tuning.ts` | WP2 |
| `createKinematics(): So101Kinematics` | `src/game/kinematics/so101-kinematics.ts` | WP2 |
| `runBrowserBench(): Promise<object>` | `src/game/physics/bench-browser.ts` | WP2 |
| `createPilotController: CreatePilotController` | `src/game/input/pilot-controller.ts` | WP3 |
| `TouchLayer: (props: { game: GameHandle }) => JSX.Element \| null` | `src/game/ui/touch/touch-layer.tsx` | WP7 |
| `createCockpitRig: CreateCockpitRig` | `src/game/camera/cockpit-rig.ts` | WP3 |
| `createFeedbackSystem: CreateFeedbackSystem` | `src/game/feedback/feedback-system.ts` | WP3 |
| `createSeatDriver: CreateSeatDriver` | `src/game/policy/seat-drivers.ts` | WP4 |
| `createInProcessSeatDriver: CreateInProcessSeatDriver` | `src/game/policy/in-process-driver.ts` | WP4 |
| `createProxyBot: CreateProxyBot` | `src/game/policy/proxy-bots/index.ts` | WP4 |
| `createObservationBuilder(info: ModelInfo): ObservationBuilder`, `createObservationDelayLine(): ObservationDelayLine` | `src/game/policy/observation.ts` | WP4 |
| `act`, `reset`, `policyName` (built-in policy module) | `src/game/policy/opponent/index.ts` | WP4 |
| `runRegistration: RunRegistration`, `probeBridge: ProbeBridge` | `src/game/policy/registration.ts` | WP4 |
| `createHarnessApi: CreateHarnessApi` | `src/game/harness/harness-api.ts` | WP5 |
| `createEpisodeStore: CreateEpisodeStore` | `src/game/harness/episode-store.ts` (IndexedDB) and `src/game/harness/episode-store-fs.ts` (Node) | WP5 |
| `createEntrantStore: CreateEntrantStore` | `src/game/harness/entrant-store.ts` | WP5 |
| `createEpisodeCodec: CreateEpisodeCodec` | `src/game/harness/episode-format.ts` | WP5 |
| `ArenaCanvas: (props: { game: GameHandle; onTileHover?: (id: string \| null) => void; onTileActivate?: (id: string) => void }) => JSX.Element` | `src/game/render/arena-canvas.tsx` | WP6 |
| `cameraMath` (pure pose functions for every camera mode) | `src/game/render/camera-math.ts` | WP6 |
| `BroadcastUi: (props: { game: GameHandle }) => JSX.Element` | `src/game/ui/broadcast-ui.tsx` | WP7 |
| `MARKS: Record<BrandMarkId, BrandMark>` | `src/game/brand/marks.ts` (re-exports sponsor and mascot marks from `sponsors.ts` and `mascot.ts`) | WP7 |
| `HOSTS: Record<HostId, HostProfile>` | `src/game/brand/hosts.ts` | WP7 |
| `SLANT_PANEL_DEG = 12`, `SLANT_STAMP_DEG = 10`, `STICKER_TILT_DEG = -4` | `src/game/brand/slant.ts` | WP7 |

`marks.ts`, `hosts.ts`, and `slant.ts` stubs hold real placeholder-free data where the value is already decided (slant constants, host tags and roles) and an empty-path `BrandMark` (`paths: []`, correct `viewBox`) where art is pending.

---

## 4. Per-package acceptance criteria

Global gates for every package: its tests pass; `npm run typecheck`, `lint` (0 warnings in `src/game/**`), `test`, and `build` stay green after each merge into the working tree; no `TODO`, no placeholder copy, no fake numbers, no dead buttons; no runtime network requests except `localhost` bridge traffic; no THE FINALS names, marks, fonts, or copy (`ip-guard`).

### WP1: Spine
1. Pre-phase complete per section 3, step 9. `import-smoke` imports every non-React `src/game/**/*.ts` in Node and calls each factory with fakes.
2. Director phase table: every row of GAME_DESIGN 2.2 in both show modes, measured with a fake clock (±1 frame), minus `task`. KO → ENGAGE ≤ 4.0 s with Fast show; rematch → ENGAGE = 3.4 s standard.
3. Real-time factor: over 60 s wall in the browser, `simTime` advances 60.0 s ± 0.5% in every preset, deviating only by granted hit stop and dilation.
4. Hit stop: a strike emitted at step k means no step k+1 runs before the freeze ends. Ten m = 1 strikes within 600 ms grant ≤ 120 ms total.
5. Live actions apply exactly `actionDelayTicks` after the request; in eval a 2 s-per-act fake policy yields the same checksums as an instant one; a never-answering one errors the episode after 30 s.
6. Events from steps after a seat's last control tick of frame N appear in that seat's observation at frame N+1.
7. After any replay phase the engine state equals the pre-replay state bit for bit.
8. React Profiler shows 0 commits during 10 s of a fight.
9. `sync-mujoco.mjs` fails the build when `public/mujoco.wasm` differs from the package WASM.
10. `replay-moments`: earned-replay selection per GAME_DESIGN 8.6 with "pry" read as "steal"; priority 1 > 2 > 3 > 4; no replay when nothing qualifies.
11. `tutorial-script`: each Calibration step (GAME_DESIGN 7.3.9) completes only on its real event and drives the right JIG behaviour; Esc → SKIP lands in the BACKLASH Rookie best-of-1.
12. Settings v2 load with try/catch; migration from any older key set drops removed keys (`operatorVoice`, `screenReaderVoice`) and adds `hostVoice` and `controls.touch` defaults.
13. `npm run check:stubs` passes at the end of the sprint.

### WP2: Physics, combat, kinematics
1. Hook: a scripted full hook in Arcade Pivot against a stationary blaze at home is attributed to atlas with ν ≥ 0.9 and damage 31 ± 3; stock gives 31 ± 3 `physicalDamage`.
2. Loadout balance: reference hook 30 ± 3 for Whip, Pivot, Anvil; hooks-to-kill differ by ≤ 1 for every pair.
3. Limp victim still attributed to the attacker; an 800 ms slow push scores 0.
4. No self-stagger: zero stagger events for a 1.4 rad flick with no contact at every loadout and stock, a guard press, a Stunned or Cutout arm sweeping, and the built-in HOOK path; a pinned arm pushed for 150 ms does stagger.
5. Combo bound: follow-ups within one Stagger ≤ 25; opener plus follow-ups ≤ 60 per loadout pair; guarded strikes never stagger.
6. Deflect window: −151 ms fails, −150 passes, +5 passes, +6 is `late_guard`, +31 neither; a press during the triggering hit stop never deflects; a charge-cancel press opens no window.
7. Physical scoring: toggling guard every tick in stock scores identically to guard false; forcing heat to 0 changes nothing.
8. Heat: flick spam every 250 ms reaches Cutout in 4–8 s; a hook every 1.5 s never does over 30 s.
9. Offline droop ≥ 5 cm within 1 s in every preset.
10. Dock geometry gate passes on committed values.
11. **Steal (`core-objective`, `core-steal-countdown`)**: dragging the docked Core out with the opponent gripper emits `core` `steal` and pauses; with 5.2 s remaining, the stealer docking in its own dock emits `lock_in_resume` with `inherited: true` and locks after 5.2 s ± 1 step; the original owner re-docking resumes from the same value with `inherited: false`; an underdog stealing an 8.0 s owner's Core at 7.0 s resumes at 6.0; in sudden death the clamp is 4.0; a steal at ≤ 2.0 s has `late: true`; KO mid-countdown still ends the round.
12. Harness immutability: after a full stock match with every intent spammed, every `model.actuator_*` and `dof_*` array equals a fresh compile except the recorded Offline profile.
13. Arcade model: stripping hull geoms from `arena-arcade.xml` reproduces `arena.xml`; a Whip hook at max speed at the opponent camera_mount registers an onset in 100/100 seeded trials.
14. IK: roll-axis RMS < 1 mm over 2,000 targets; FK gripperframe within 1e-6 m of `site_xpos` over 1,000 samples.
15. Determinism: same seed and per-step ctrl/intents → same checksum after 2,000 steps in every preset and timestep.
16. Bench: p95 ≤ 1.2 ms per 16.7 ms of sim in Node and on `?debug=bench`.
17. Abilities: SNAP, RECOIL COIL, BULWARK, Overdrive, and Burst each have a fixture matching GAME_DESIGN 4.6/4.8 numbers.

### WP3: Feel
1. Same-frame command: a mouse delta before `sampleFrame` changes `command`, `ghost`, and `rangeCue` in that call; `look` changes only through the 250 ms stance filter.
2. Flick: a 400-count X delta at sensitivity 1.0 gives Δψ = 0.600 rad; `writeCommand` clamps the pan target to q + 0.60.
3. Reach spring: W down → `r_offset` +0.12 same frame; W up → 0; W held 1.0 s creeps `r_stance` 0.15 m.
4. Jab, charge, cancel per GAME_DESIGN 11.4 WP3 criterion 4.
5. Grab assist: cube 3 cm from the tip → roll aligned ± 0.05 rad and roll-axis target over the cube ± 2 mm in the same frame.
6. Frozen sampling: during a freeze the ghost holds; deltas apply on the first post-freeze frame; a guard press during a freeze carries the post-freeze sim time.
7. Camera: a 1.4 rad flick at 6 Hz moves camera yaw < 2° peak to peak (Standard); sway < 1° over a 30 s fight; position constant.
8. Gamepad parity: a −1 → +1 swing in 50 ms gives a 1.80 rad ψ step; radial deadzone.
9. **Touch parity (`touch-input`)**: a swing-stick sweep −1 → +1 in 50 ms gives the same 1.80 rad ψ step as the gamepad; a strike touch held 150 ms is a jab and 400 ms is a charge; guard, grip (with grab assist), stance, and reach map to the same command fields as the gamepad; `release()` clears every held intent; multi-touch (stick + guard + strike at once) works. `TouchControls` renders only when `settings.controls.touch.mode` resolves on, uses kit classes from `globals.css`, meets 44 px minimum targets, and never triggers browser scroll, zoom, or text selection.
10. Juice budget: per event type, active channels never exceed the tier budget (GAME_DESIGN 8.1); ordinary strikes never set `chromaticOffset`.
11. **Hosts (`announcer`, `host-lines`)**: ≤ 6 lines per round, ≤ 2 P3; no line repeats within the last 20; P1 interrupts with a 60 ms fade; every P1/P2 event has ≥ 8 variants split across ROOK and VALE and every P3 event ≥ 4; lines pass D9's copy rules; tokens resolve from real event fields (no invented values); captions land in `UiStore.captions` with the right `speaker`; with `hostVoice` on, speech uses `HOSTS[id].speech`, ducks music −8 dB and crowd −5 dB, and is wrapped in the squelch layer; with no voices available the setting reports `NO VOICE` and stays off.
12. **Audio**: zero `AudioNode`s created per frame by beds; every recipe in `synth-recipes` renders in `OfflineAudioContext` (`?debug=audio`) with peak ≤ −0.5 dBFS after the limiter and no NaN samples; each strike call randomizes pitch and filter within its recipe range (two consecutive renders differ, both within range); servo whine frequency and gain track joint velocity and load per GAME_DESIGN 9.3; `kill-confirm` renders the sub thump, servo ratchet, bell, and a rhythmic gap in that order at fixed offsets; the music bed has percussion, bass, and stabs, round-start and victory stingers, and a final-round arrangement; big moments (KO, lock, match end, P1 speech) duck the mix. No audio file is fetched anywhere.
13. Event-frame audio: the strike transient onset is ≤ 1 render frame after the strike step (`?debug=feel` log).
14. Proxy parity: a `SyntheticInput` sequence produces the same `ctrl` stream as the equivalent recorded real input events.
15. Crowd hype: impulses, decay, floors, and refractory per GAME_DESIGN 8.7 with steal and late steal replacing pry; the home crowd groans when the pilot is stolen from or KO'd.

### WP4: AI and policy runtime
1. Seat rotation symmetry to 1e-9 (dict) and `Math.fround` (flat).
2. Schema: flat blocks match `torquelimit.obs-3.json` index by index; quaternions w ≥ 0; physical scoring zeroes `game[10..15]`.
3. Determinism: identical built-in actions over 3,000 acts from one seed in Node; a module calling `Math.random` and `Date.now` is deterministic under the shim in eval.
4. Bot sweeps (headless): Pro OVERSHOOT beats JIG `hold_guard` in ≥ 90% of 20 seeds; Champion beats Rookie ≥ 80%; personality pairs at Pro within 35–65% over 50 seeds (run on the homebase server if it exceeds 180 s locally; the in-repo test uses 12 seeds with a widened 25–75% band).
5. Heavy guess: against a scripted public-charge observation stream with random release delays, heavy parry success over 30 seeds is ≤ tier cap + 5 pp at Pro and Champion, and every guess appears in `debug.parryGuess`.
6. Humanness: reaction medians within tier μ + τ ± 40 ms, p10 ≥ 150 ms; chatter at Pro ≤ 2 sign changes/s per joint.
7. Never violates: 0 violations over 100 bot matches.
8. Worker safety: throw / NaN / 600 ms sleep / 7 numbers → error / error / timeout (live) / error without killing a lenient match; in eval the sleeper is `slow` with the same outcome as a fast module.
9. Chunks: a 100-step `full_chunk` executes all 100 entries with no requests between; entries older than the tick are skipped via `chunkStartT`.
10. Bridge: against `tools/bridge/torquelimit_bridge.py`, hello → reset → warmup → 500 acts with two seats completes with 0 errors and median round trip < 5 ms; a mismatched `obs_schema_hash` is rejected; hello carries no image request.
11. DDA: two player match losses → next match starts at k − 0.2; k never increases in the round after a player round loss; frozen in eval, stock presets, replay, last 10 s of a deciding round, and at Champion.
12. Registration: `example-policy.js` passes every row, shows cold act separately, and plays a full match; a NaN module fails with `fixtureIndex` set; a trajectory JSON over 100k frames or fps outside 1–240 fails at `parsed`.
13. `human_proxy` completes a Proving Ground match against BACKLASH Contender with the real `PilotController`, and its ctrl stream is identical across two runs with the same seed.

### WP5: Harness
1. Round trip: record → `codec.encode` → `codec.decode` gives byte-identical columns, RLE streams, checkpoints, mutations, and events; float64 and float32 values are bit-identical (compared as bytes, NaN included).
2. Verify: a 3-round bot-vs-bot eval episode, exported and re-imported, verifies `bit_exact`; a human-vs-builtin Proving Ground episode recorded with `human_proxy` verifies `bit_exact` after the round trip; mutating one `sim.ctrl` value at step 5,000 returns `diverged` at the first checkpoint after it with `divergedFrame` set.
3. Kinematic replay: body poses at any seek time match live-recorded poses to 1e-9.
4. Alignment: actionDelayTicks 1, decimation 2, fair delay 120 ms → every `action_raw` row's `policy.request_frame_index` points at the row whose delivered observation the echo policy received.
5. Stats: hand-built fixtures with known answers for reaction raw and net, jerk, chatter, LDLJ, physical block rate, steals and late steals, bootstrap CI.
6. Verdict: CLEARED FOR BROADCAST per GAME_DESIGN 5.10.3 with a fixture for each failing reason; Arcade reports always carry ARCADE PHYSICS · NOT VERIFICATION.
7. Size and speed: a 3-round, 45 s-per-round Arcade episode with a human seat exports to ≤ 17 MB of JSON; the recorder adds ≤ 0.3 ms per control tick; `store.save` of that episode takes ≤ 50 ms on the main thread.
8. Storage: a 1.1 GB simulated fill of non-human episodes asks before evicting and never evicts a human episode; entrants persist across reloads.
9. Import rejects a wrong `format`, an unknown dtype, or a length mismatch with a named error shown by the UI; a valid import appears in the Replays list and verifies.
10. CLI: `node scripts/eval.mjs --suite smoke-v1 --policy public/policies/example-policy.js --out .eval/smoke` exits 0 and writes 6 `.tlep.json` episodes plus `results.json` with win rate and seed-bootstrap CI.
11. Python: `python -m pytest tools/bridge tools/export` passes locally with only `websockets`, `numpy`, and `pytest` installed; `torquelimit_bridge.py` and `example_policy_server.py` start with one command each and serve bridge/2; `to_lerobot.py` refuses Arcade episodes without `--allow-arcade`, produces one episode per round with `observation.state` [6], `action` [6], `next.done`, `next.reward`, `task`, monotonic timestamps (checked by the fake writer); `docs/HARNESS.md` gives the homebase command for the real `LeRobotDataset` load (D12).

### WP6: Stage
1. Pixels match contacts: spark spawns coincide with contact surfaces (0.25× replay check); α = 0.5 gives exact lerp/slerp.
2. Reticle on the same frame: `?debug=feel` reports 0 px between the reticle bracket centre and the projected ghost tip over a 30 s flick session.
3. Spark contrast ≥ 3:1 against the deck at the midline and against the deck border graphics on DEFAULT (`?debug=contrast`).
4. Calibration: `?debug=greycard` grey card 0.46 ± 0.02, brightest lit paper ≤ 0.75; max lit-surface pre-tonemap luminance below the bloom threshold; only `toneMapped: false` emissives (LED strips, par-can lenses, jumbotron, holo crowd, charge glow) bloom. Values recorded for WP7's `STYLES.md`.
5. Performance (DEFAULT, M1 Air, Chrome): p95 frame ≤ 16.7 ms over a 3-round match after 5 min; ≤ 80 draw calls; ≤ 1.2 M triangles including shadow (D10); holo crowd is one instanced draw; jumbotron render target 512² at ≤ 15 Hz; `renderer.info.programs.length` never grows after pre-warm, including across tier changes and the first crit, deflect, de-rez, confetti, and lock.
6. Zero allocation: no `new THREE.*` inside any `useFrame`; heap flat ± 2 MB over 60 s of fighting.
7. Colour: team, prize, strike, crit, and block tokens within ΔE ≤ 3 in a lit frame; colourblind mode screenshots pass a simulator check.
8. Cockpit: opponent base and the Core docks visible at FOV 62 for every command in range; own-arm dither engages within 0.12 render units.
9. Lobby tiles: gripper occludes and is occluded by tiles; keyboard activation changes screen with no jab.
10. **Stage set**: deck with painted graphics (wordmark, 12° hazard border, cobalt/magenta half-zones at 18%, Core dock rings in volt, OHMSTEAD corner marks); team-colour LED edge strips flash white 120 ms on a strike to that side and pulse on KO; four corner pylons; overhead truss with 8 par cans whose lenses match the real spot colours; jumbotron showing the live broadcast feed and tote; sponsor boards scrolling TORQUE LIMIT, OHMSTEAD, PULPO POP, and BIT; daylight cyclorama; the Core hopper. All brand art comes from WP7 `MARKS`; no text is baked into images.
11. **Holographic crowd**: instanced billboards (≈ 400) in stands on both sides, dithered silhouettes tinted by side, scanline scroll and flicker; lean and jump driven by `game.feedback.audio.hype` and strike events; density drops to the LOW tier count.
12. **De-rez KO**: on `ko`, after the servo slump has settled (GAME_DESIGN 8.3 settle rule), the loser's shell dissolves with a world-space voxel threshold sweep and a team-colour emissive edge over 900 ms, plus a volt cube burst; the slump itself is never hidden (`derez-timeline` checks the start is after settle); the arm is restored pristine by the round re-render scan (400 ms signal-orange sweep) at `round_intro`.
13. **Celebrations**: confetti (BIT cubes, volt, signal, paper) and cash-style prize bursts on player match wins and locks; pools never allocate beyond size (20 strikes in 1 s, 3 KOs back to back).
14. STL geometry cache: both arms share one parsed geometry per mesh; a second `createGame()` in Strict Mode fetches no STL twice.

### WP7: Broadcast UI and brand
1. Screenshot review: every screen (boot, title, cockpit choice, green room, loadout, entrants, register entrant, lab, lab results, replays, replay viewer, settings, pause, click to fight, tutorial, match intro, post-match) at 1920×1080, 1280×720, and 390×844 (touch), saved to `docs/design/screens/`; no overflow or overlap; labels caps and ≤ 3 words (`copy-labels`); no Unicode symbol glyphs in rendered text; no `backdrop-filter` in `globals.css`; no rounded corners.
2. No per-frame React: 0 commits during 10 s of fighting while the HUD updates.
3. Rematch: post-match → ENGAGE 3.4 s; Enter / R / A start it with no mouse movement; hold-to-skip reaches the next `round_intro` within 450 ms.
4. Registration UI: the example policy animates every row and REGISTERED; a NaN module stamps `FAILED AT FIXTURE n`; cold act shown separately; the bridge card shows name, CLAIMED SHA, and provenance from `probeBridge`.
5. Reduced motion: impact and celebration tiers become ≤ 120 ms fades.
6. Damage numbers: merge (12 + 19 → 31 re-popped); graze shows a tag and no number; numbers use Anton or Barlow Condensed italic per `STYLES.md`, physics readouts use Chivo Mono.
7. Colour semantics: `styles-tokens` parses `globals.css` and fails if volt, block, strike, or crit tokens are referenced outside their allowed components; contrast rules pass.
8. **Brand**: `brand-marks` validates every `MARKS` entry (non-empty paths, parseable `d`, only `TokenColor` fills); the wordmark, needle, OHMSTEAD ("Keeping you grounded"), PULPO POP, and BIT are original SVG path data; `ip-guard` scans `src/`, `public/`, `STYLES.md`, and `README.md` for THE FINALS' name, Embark, the Saira family, and the reference game's sponsor, host, and arena names, and fails on any hit.
9. **Type**: `layout.tsx` loads Anton, Barlow Condensed (500–900, italic), and Chivo Mono through `src/app/fonts.ts` as CSS variables; Anton display text uses `skewX(-10deg)`; no other font families appear in computed styles; `public/fonts/` holds the three `.woff` families and `OFL.txt` from `sync-fonts.mjs`.
10. **Hosts on screen**: captions show a ROOK or DR. VALE tag plate from `HOSTS` (lip colour per `HostProfile`), one caption at a time, broadcast tier, caption size setting honoured.
11. **Lobby is fun, not a dashboard**: the arm follows the cursor, tiles break on click, loadout cards re-tune the arm live, callsign plate with W–L; menu is FIGHT, ENTRANTS, LOADOUT, WARM UP, THE LAB, REPLAYS, SETTINGS; every item works.
12. **KO and lock stamps**: KNOCKOUT with a **SHORTED OUT** sticker stamp, LOCKED, STOLEN, LATE STEAL, VICTORY and MVP stats with chrome/gold-foil gradients, all celebration tier and within the 240 ms slam-in budget.
13. **Post-match**: VICTORY/DEFEAT, score pips, top 3 superlatives with `NEW PB` from `superlatives.ts` against `profile.ts` history, tabs STATS · TIMELINE · MODEL REPORT (model report for any non-human seat with the preset stamp); buttons REMATCH, SWAP OPPONENT, GREEN ROOM, PIN REPLAY, EXPORT EPISODE; W–L per entrant and tier persists (`profile`).
14. **Lab**: seat driver HUMAN · BUILT-IN · MODULE · TRAJECTORY · BRIDGE; preset ARCADE · PROVING GROUND · HARNESS; timing, control Hz, seed, rounds, action delay, fair delay, limits, record, render/turbo; FIGHT IT, RUN MATCH, VERIFY LAST EPISODE, CHECK POLICY DETERMINISM; results with win rate and CI, six headline bars, details, verdict stamp, EXPORT EPISODE, EXPORT STATS, OPEN REPLAY. Replays screen: list, storage meter, WILL EVICT N confirm, import drop zone, verify with progress.
15. Settings: every control in GAME_DESIGN 7.3.8 minus operator/screen-reader voice, plus HOST VOICE `OFF | ON` and a TOUCH tab (mode, stick size, opacity); every change applies live.

---

## 5. Integration responsibilities (trimmed GAME_DESIGN 11.5)

| Integration | Wired in | By |
|---|---|---|
| All factories → `GameHandle` (incl. `runRegistration`, `probeBridge`, `harness.entrants`, `harness.codec`) | `src/game/game-handle.ts` | WP1 |
| Canvas mounting, `frameTick` at −2, `runAfterRender` at +2, `game.view` camera/canvas/lastPose writes, display latency | `src/game/render/arena-canvas.tsx`, `frame-timing.ts` | WP6 |
| UI mounting over the canvas; loading progress from `engine`, `feedback.audio.prepare`, STL cache, pre-warm | `src/game/game-root.tsx` | WP1 |
| Touch controls mounting over the HUD (the layer gates itself on touch mode, coarse pointer, fight screens and overlay) | `src/game/ui/broadcast-ui.tsx` renders `ui/touch/touch-layer.tsx` | WP7 |
| Touch → command | `ui/touch/touch-layer.tsx` → `pilot.touch()` | WP7 |
| Bus subscribers | `feedback-system.ts` (WP3) and `vfx-system.ts` (WP6) subscribe in their factories; `hud-runtime.ts` (WP7) subscribes on mount. Nobody calls feedback directly. | each owner |
| Rules events → bus, event ring, recorder | `sim-driver.ts` | WP1 |
| Hit stop request and loop break | `sim-driver.ts` using WP2's `hitstopMsFor` | WP1 |
| Offline profile, Core placements (rules → engine, recorded) | `sim-driver.ts` | WP1 |
| Preset → pilot rules, scoring, timestep | `match/presets.ts` → `pilot.setRules`, `RulesConfig`, `EngineResetOptions` | WP1 |
| Juice → post uniforms | `post-stack.tsx` | WP6 |
| Juice → camera | `cockpit-rig.ts` (compute), `camera-director.tsx` (apply) | WP3 / WP6 |
| `HudFrame` → reticle overlay (WebGL) and HUD DOM | `reticle-overlay.tsx` / `hud-runtime.ts` | WP6 / WP7 |
| Captions → HUD | `announcer.ts` sets `UiStore.captions` with a `HostId`; `captions.tsx` renders with `HOSTS` | WP3 / WP7 |
| Hype → holographic crowd; strike/KO/lock → LED strips, pylons, sponsor-board floods | `holo-crowd.tsx` reads `game.feedback.audio.hype`; `vfx/stage-cues.ts` subscribes to the bus | WP6 |
| Brand marks → WebGL textures (deck, sponsor boards, jumbotron frame, confetti BIT decal) | `brand-textures.ts` rasterizes WP7 `MARKS` via `Path2D` | WP6 |
| SDF text fonts | `lobby-tiles.tsx`, `stage-deck.tsx`, `jumbotron.tsx` load `public/fonts/*.woff` produced by WP7 `sync-fonts.mjs` | WP6 / WP7 |
| Lobby tiles ↔ menu | `ArenaCanvas` `onTileHover` / `onTileActivate` props ↔ `green-room.tsx` | WP6 / WP7 |
| Lobby cursor → arm | `green-room.tsx` raycasts ego z = 0.15 and calls `game.pilot.setCursorTarget` | WP7 |
| Lab → run, verify, determinism; Replays → list, import, export, verify | `lab-screen.tsx`, `replays-screen.tsx`, `replay-viewer.tsx` call `game.director`, `game.harness`, `game.replay` | WP7 |
| Entrants → registration and persistence | `register-entrant.tsx` calls `game.runRegistration`, then `game.harness.entrants.save` | WP7 |
| Match end → episode save, stats, W–L and PB update | director saves via `harness.store` and sets `UiState.lastEpisodeId/lastStats` (WP1); `post-match-screen.tsx` updates `profile.ts` once per match id (WP7) | WP1 / WP7 |
| `debug.flaw` / `debug.dda` → events → host calls | `sim-driver.ts` → bus → `announcer.ts` | WP1 / WP3 |
| Proxy bot → pilot | `proxy-driver.ts` uses `pilot.synthetic()` | WP4 |
| Headless runner → CLI and smoke suite | `scripts/eval.mjs`, `suite.ts` | WP5 |
| Episode verify re-sim | `replay-player.ts` `verify` uses `createPhysicsEngine` + `createCombatRules` | WP5 |
| `package.json` scripts for every package's scripts (`sync:fonts`, `gen:fixture`, `probe:docks`, `bench`, `gen:arcade-model`, `eval`) | `package.json` | WP1 |
| Screenshots of every screen and key HUD moment (first strike, graze, crit, deflect, late guard, clash, stagger, burst, KO slump before and after KNOCKOUT, de-rez, steal, lock, sudden death, low integrity, range cue lit, touch layout) | `docs/design/screens/` | WP7 (captures), WP6 supplies the `?debug` scenes |

---

## 6. Sprint definition of done (this sprint's slice of SCOPE 5)

- `npm run typecheck`, `lint`, `test`, `build`, and `check:stubs` pass.
- `localhost:3000` boots with zero console errors; a full match (lobby, intro, three rounds or a 2–0, KO or lock, post-match, rematch) plays end to end with mouse and keyboard; a match is playable with touch controls in a 390×844 touch-emulated viewport.
- A PROVING GROUND match against `public/policies/example-policy.js` produces a model report, an exportable `.tlep.json` episode, and a successful re-import and BIT-EXACT verify.
- `npm run eval -- --suite smoke-v1 --policy public/policies/example-policy.js --out .eval/smoke` exits 0.
- Screenshots in `docs/design/screens/` reviewed against SCOPE and `finals-visual.md`.
- Every acceptance criterion in section 4 is met or has a written, owner-approved exception in this file.
- Packaging (PWA, Electron, Capacitor) is explicitly deferred to the next sprint.

---

## 7. Disjointness check

Every path in the ` ```files ` blocks of section 1 was extracted by script and checked for exact duplicates, for glob overlap (a `/**` entry containing another listed path), and for coverage of every file currently in the repo (excluding `node_modules/`, `.next/`, `.git/`). Result recorded below by the producer at plan time.

Script: `node disjoint.mjs` (producer scratchpad; logic: parse each `### WPn` heading, collect lines inside the following ` ```files ` blocks, strip the `(delete)` / `(read-only)` tags, then check).

| Check | Result |
|---|---|
| Entries extracted | 377 (WP1 60, WP2 44, WP3 47, WP4 48, WP5 40, WP6 57, WP7 81) |
| Unique paths | 377 |
| Exact duplicates across or within packages | **0** |
| Glob entries (`/**`) containing another listed path | **0** (`robotstudio_so101/assets/**` WP2, `public/fonts/**` WP7, `docs/design/screens/**` WP7) |
| Files currently in the repo (`git ls-files --cached --others --exclude-standard`) | 71 |
| Repo files not owned by any package | **0** |

Any package that adds a file not listed here adds it to its own block and reruns the check; a new path under another package's directory prefix needs that owner's agreement first.
