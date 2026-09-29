# TORQUE LIMIT: optimization plan for a real 60 fps (M1/M2 MacBook Air, Chrome)

Written 2026-09-24 from the code on `fps-duel` (`src/game/render/**`, `src/game/loop/**`, `src/game/physics/**`), Node measurements on this Mac (M5) and on homebase (EPYC 9V45), and the library sources in `node_modules`. No browser session was opened; every GPU number below is an estimate to be confirmed with the protocol in section 7. CPU numbers marked *measured* are real.

The one-paragraph verdict: the game is **GPU-bound on geometry and lighting, and it draws the whole world twice**. Two arms are 296 k welded triangles each (592 k total) in a clear-coat `MeshPhysicalMaterial` lit by six punctual lights with a shadow, at DPR 1.25 with MSAA 2, and on DEFAULT and HIGH the deck's planar reflection renders the entire scene a second time every frame. On top of that the post stack runs depth-of-field and SMAA passes on every tier even when their result is discarded. Physics is not the problem (0.55 ms p50 per frame in Node on this Mac). The fixes are mostly deletions and tier gating; none needs a new dependency.

---

## 1. What one frame costs today (DEFAULT tier, cockpit, mid-fight)

Frame priorities from `arena-canvas.tsx` lines 4–14. The GPU work per frame:

| Pass | What is drawn | Triangles | Where |
|---|---|---|---|
| Shadow map (2048², PCF) | collision-proxy boxes/capsules per link, cubes | ~5 k | `lighting.tsx:104–109`, `shadow-proxies.ts` |
| Deck reflection (640×360 half-float, mipmapped) | **the whole scene again** through a mirrored camera: both full-res arms, crowd, cyclorama, LEDs, VFX | ~600 k | `stage-deck.tsx:238–252`, priority 0.45 |
| Main pass (DPR 1.25 → ≈1838×1195 = 2.2 MP, MSAA 2, half-float) | 28 arm meshes (14 per arm), deck ×4, floor, cyclorama, crowd ×2, LEDs + 2 ribbons, cubes, ghost + leash, arcs, blobs, 8 light-shaft cones, ~14 VFX pools, trails, decals, LED instances | ~600 k | `arena-canvas.tsx:217–225` |
| Post: N8AO half-res (8 samples) → **DoF (7 internal passes, output discarded)** → Bloom (5 mips) → CA + Vignette + ACES + Grade (one merged pass) → **SMAA (3 internal passes, output discarded)** | 2.2 MP × ~14 fullscreen passes | | `post-stack.tsx:112–134` |
| Reticle overlay | 1 fullscreen SDF quad | | `reticle-overlay.tsx` |
| Jumbotron feed (512×288, ≤12 Hz) | whole scene, only when **not** in the cockpit | (0 in cockpit) | `jumbotron.tsx:230–235` |

So the arms' vertex shader runs **~1.2 M triangles per frame** on DEFAULT (main + reflection), and every lit fragment evaluates 4 SpotLights + 1 PointLight + 1 shadowed DirectionalLight + hemisphere + environment, twice (clear coat) for the shells. GAME_DESIGN 10.7 budgeted ≤ 1.2 M triangles *including shadow* with the opponent at LOD1 (35 %); the LOD never shipped (D10: "no mesh LODs"), and the reflection pass was not in the budget at all.

Measured triangle counts (this repo, `so101.xml` visuals, after the 1e-4 m weld and degenerate drop in `robot-assets.ts:buildRenderGeometry`):

```
base_motor_holder_so101_v1        19 624      wrist_roll_pitch_so101_v2      31 832
under_arm_so101_v1                28 872      moving_jaw_so101_v1            23 702
wrist_roll_follower_so101_v1      23 651      upper_arm_so101_v1             22 164
rotation_pitch_so101_v1           16 912      sts3215_03a_v1 (×5)            15 166 each
motor_holder_so101_base_v1        13 808      sts3215_03a_no_horn_v1         13 418
motor_holder_so101_wrist_v1       13 208      base_so101_v2                   9 284
camera_mount 2 456, mounting plate 1 254
per arm 296 015 triangles, both arms 592 030 (raw STL before weld: 401 340 per arm)
```

Draw calls per frame (counted from the scene graph): main ≈ 65, reflection ≈ 60 (same scene minus the deck top), shadow ≈ 18, post ≈ 14 fullscreen quads, jumbotron 0 in cockpit → **≈ 155 `renderer.info.render.calls`** on DEFAULT versus the ≤ 80 the design assumed. `?debug=feel` prints this number directly (`debug-scenes.tsx:170`).

Rough GPU budget on an M1 Air at 2.2 MP (to be measured; section 7): main pass 5–7 ms, reflection 2–3 ms, post 3.5–4.5 ms, shadow 0.3 ms → **11–15 ms**, i.e. right at or over the 16.7 ms line before the compositor takes its share. That is consistent with "unoptimized" without any CPU problem.

CPU per frame, *measured in Node*:

- Physics, arms pressed together (contact walk every step), per 16.7 ms of sim: **arcade p50 0.55 ms / p95 0.78 ms on this M5**, p50 0.75 / p95 1.22 on the EPYC server (`npm run bench`). Expect ~0.9–1.3 ms on an M1 (single-thread ≈ 65–75 % of an M5). The harness preset p95 hit 1.44 ms on the M5 (one GC spike in 300 frames); the 1.2 ms gate is tight but the fight runs arcade.
- Everything else in `useFrame` allocates nothing per frame (section 5). Three's submission of ~155 draws is the largest remaining CPU item: at 15–30 µs per `MeshPhysicalMaterial` draw (four spot-light uniform blocks + shadow uniforms per draw) that is **2.5–4.5 ms of JS** on an M1, which the reflection pass doubles.

---

## 2. Ranked plan (expected ms saved on an M1 Air, DEFAULT tier)

| # | Change | Expected saving | Risk | Effort |
|---|---|---|---|---|
| 1 | Decimate the arm meshes at load with meshopt (35 % LOD for the main pass, 15 % for reflection/feed), or bake once | GPU 1.5–3 ms, CPU 0 | low (measured error ≤ 0.14 % of part extent) | 1 day |
| 2 | Stop running DoF and SMAA passes whose output is discarded (DST blend still executes 10 fullscreen passes) | GPU 1.5–2.5 ms | none | 2 h |
| 3 | Cut the reflection pass down: arms-only layer at the 15 % LOD, 480×270 on DEFAULT, every other frame | GPU 1–2 ms, CPU 1–2 ms | low | half day |
| 4 | Take the four SpotLights out of the forward shader (sweeps → deck-shader projection, rims → the existing `uRim` fresnel) | GPU 1–2 ms (largest on the shells), CPU 0.3 ms | medium (look changes, must re-calibrate 6.5) | 1 day |
| 5 | Merge each arm into one `SkinnedMesh` per material slot (rigid bone per link): 28 → 8 draws, one bone-texture upload | CPU 0.8–1.5 ms | medium | 1 day |
| 6 | DEFAULT: MSAA 0 + SMAA instead of MSAA 2; HIGH keeps MSAA 4 | GPU 0.5–1 ms | low | 1 h |
| 7 | Light-shaft cones: 3 on DEFAULT, one noise octave, tighter radii | GPU 0.3–0.8 ms (additive overdraw) | none | 1 h |
| 8 | Shadow map 1024² on DEFAULT (it is 2048 today); keep PCF | GPU 0.2–0.4 ms | none | 5 min |
| 9 | Cyclorama last among opaques (renderOrder), not first | GPU 0.1–0.3 ms | none | 5 min |
| 10 | Prewarm with `compileAsync` and re-run it after every tier change | removes 20–200 ms hitches, 0 ms/frame | none | 2 h |
| 11 | Physics substeps: leave at 400 Hz; cap `MAX_STEPS_PER_FRAME` catch-up to 12 in arcade | 0 ms normally, bounds the spiral | none | 5 min |
| 12 | Workers (physics or OffscreenCanvas) | **not recommended now** | high | — |

Items 1–4 together should take DEFAULT from an estimated 11–15 ms GPU to 6–8 ms, which is 60 fps with headroom for the spectacle pass to spend. Items 5–9 buy the CPU room and the last GPU millisecond.

---

## 3. Geometry: the STL meshes

### 3.1 Why it is expensive

Apple GPUs are tile-based deferred renderers: all geometry of a render pass goes through the vertex stage and is binned before any pixel is shaded ([Apple, "Harness Apple GPUs with Metal"](https://developer.apple.com/videos/play/wwdc2020/10602/)). 600 k triangles per pass is not free on an 8-core M1 (2.6 TFLOPS FP32, [metal-benchmarks](https://github.com/philipturner/metal-benchmarks)), and the vertex shader here is fat: `MeshPhysicalMaterial` with fog, a shadow coordinate, view position, plus the four custom varyings in `robot-materials.ts:89–102` (`vEdge`, `vLocalPos`, `vWorldPos`, `vPrintAxisLocal`). Each arm is drawn twice (main + reflection), and 4 mm-scale STL detail is invisible from a camera 0.3–0.9 m away at 1838 px wide. Anything under ~1 px of screen height (about 0.2 mm on the opponent's hand) is wasted.

### 3.2 Decimate at load (existing dependency, no bake)

`three/examples/jsm/libs/meshopt_simplifier.module.js` ships inside the installed `three@0.185.1`, so `MeshoptSimplifier` is available without a new package. Measured in Node on this Mac against the real files (`scratchpad/simplify-bench.mjs`, `simplify(index, position, 3, target, 0.01, ["LockBorder"])`):

```
per arm: 296 015 tris → 35 %: 103 587 tris   15 %: 45 023 tris
achieved relative error: 0.0001–0.0014 at 35 % (max 0.14 % of part extent), ≤ 0.01 at 15 %
time: STL parse 18 ms, weld + crease 324 ms (existing code), simplify both LODs 263 ms  (M5; expect ~2× on M1)
```

So the whole load-time pipeline stays under a second on an M1 and the 35 % mesh is visually identical at gameplay distance (the largest error, 1.4 mm relative on `base_so101_v2`, is on the static base). The parse-and-weld already yields to the main thread per mesh (`robot-assets.ts:513`), so the simplify step slots into the same loop.

Pipeline (all in `robot-assets.ts:buildAssets`):

1. `parseStl` → `buildRenderGeometry` as today (weld 1e-4 m, drop degenerates). Keep the **welded** index and positions.
2. `MeshoptSimplifier.simplify(index, position, 3, floor(index.length·0.35/3)·3, 0.01, ["LockBorder"])` on the welded, pre-crease mesh (creasing duplicates vertices, which the simplifier would treat as open borders). Do the same at 0.15 for the shadow/reflection LOD.
3. Expand the simplified index back to a triangle soup and run `buildRenderGeometry` again so crease normals (35°), the signed `edge` mask and the print axis are recomputed for the new topology. This is cheaper than `simplifyWithAttributes` and keeps the shader's `edge` attribute honest.
4. `linkSlotGeometries` builds LOD0 (35 %) and LOD1 (15 %) per (link, slot); `createArmRig` uses LOD0 for the main meshes and LOD1 for a second set of meshes on a `REFLECTION_LAYER` (see 4.3).

API reference: [meshoptimizer js README](https://github.com/zeux/meshoptimizer/blob/master/js/README.md) (`target_error` is "distance normalized to [0..1] range… 1e-2 means… below 1 % of the mesh extents"; `LockBorder` keeps open borders, which the STLs' printed bases have). The three.js forum thread on doing exactly this at runtime: [Mesh simplification using meshoptimizer](https://discourse.threejs.org/t/mesh-simplification-using-meshoptimizer/63002).

Do not use `three/addons/modifiers/SimplifyModifier.js`: it is an O(n²)-ish JS edge-collapse that takes seconds on 30 k-triangle parts and drops attributes.

### 3.3 Or bake once

GAME_DESIGN 10.6 already specifies `scripts/bake-meshes.mjs` writing `{mesh}.lod0.bin` / `.lod1.bin` / `.shadow.bin` with curvature and AO attributes. The load-time route above gets 90 % of the benefit today; the bake is worth doing later only for (a) the AO attribute (which N8AO already covers), (b) skipping the 0.6–1 s of load CPU on slow machines, and (c) a smaller download (the STLs are 17.6 MB of triangle soup; a 35 % indexed bake is ~3 MB). `meshoptimizer@1.1.1` is in `node_modules` (transitively) for the script; it would need to be a declared devDependency.

### 3.4 Shadow LOD

The shadow pass is already cheap (collision proxies, `shadow-proxies.ts`). Leave it.

---

## 4. The passes

### 4.1 Post stack: passes that run for nothing

`post-stack.tsx` keeps every effect mounted and turns DoF and SMAA "off" with `BlendFunction.DST`. In `postprocessing@6.39.5` that only removes the effect's fragment from the merged shader; `EffectPass.render` still calls `effect.update()` for every effect (`node_modules/postprocessing/build/index.js:15675–15677`), and:

- `DepthOfFieldEffect.update` renders the CoC pass, a Kawase blur (`KernelSize.MEDIUM`, several ping-pong passes), the mask pass and four bokeh passes (`index.js:5460+`). At 2.2 MP half-float that is roughly 1–2 ms of fullscreen work on an M1, on **every tier**, since `tier.dof` is false on DEFAULT and LOW.
- `SMAAEffect.update` renders clear + edge detection + weights (`index.js:11218–11221`), ~0.5–0.8 ms, wasted on HIGH and DEFAULT where `tier.smaa` is false.

The library maintainer confirms this is by design: with SKIP/DST "the update() method of the effect will still be called" ([discussion #315](https://github.com/pmndrs/postprocessing/discussions/315)).

Fix: mount `<DepthOfField>` only when `tier.dof` and `<SMAA>` only when `tier.smaa`. The merged EffectPass recompiles when its effect list changes, which is why the file avoided it; but tier changes are already confined to safe phases by `quality.ts:applyIfSafe`, and the compile can be hidden by re-running prewarm there (4.4). Alternatively give DoF its own `<EffectComposer>`-level pass (r3f `mergeMode="auto"` already splits convolution effects) and flip `pass.enabled`; the N8AO wrapper does exactly that (`@react-three/postprocessing/dist/index.js:2296`: `effect.enabled = enabled`), which is why `<N8AO enabled={false}>` really is free while DoF is not.

Also: `bokehScale` is set to 0 outside the cockpit (`post-stack.tsx:100`) — still runs all seven passes. And `POST_PREWARM_FRAMES = 3` frames with everything enabled is the right idea; keep it.

### 4.2 N8AO

Half-res "performance" (8 AO samples, 4 denoise) is the cheapest preset; N8AO's own README says half-res "generally incurs a fixed cost of around 1ms" for the depth-aware upscale and is "2x-4x" faster than full res ([n8ao](https://github.com/N8python/n8ao)). Keep it on DEFAULT as designed; its `enabled` really disables the pass. Do not touch `quality`/`aoSamples` at runtime: it "forces a recompile of all the shaders used in the AO effect".

### 4.3 The deck reflection

`stage-deck.tsx:reflect` re-renders the full scene into a 640×360 target every frame at priority 0.45. Costs: the second 600 k-triangle arm pass, the crowd, the cyclorama's noise shader over the whole target, the eight light shafts, all VFX, plus ~60 draw calls of CPU. Three things, in order:

1. **Layer it.** Give the mirror camera its own layer and put on it only what a lacquered deck plausibly mirrors: the two arms' 15 % LOD meshes (4.1), the LED strip, the cubes, the hit light. Cyclorama, crowd, ribbons, shafts, VFX, blobs stay off it; the reflection shader's mip streak (`stage-deck.tsx:123–132`) blurs so much that the crowd was never legible in it anyway. This removes ~90 % of the pass.
2. **Half the rate.** Render it on even frames only and let the odd frame reuse the target; at 30 Hz a blurred reflection of a 3 m/s gripper tip moves 5 cm between updates, invisible under the mip blur. Do this after (1), and only if (1) is not enough.
3. **480×270 on DEFAULT.** `REFLECTION_SIZE.default` is 640×360; the shader samples mips 1.0–2.8 anyway.

### 4.4 Lights in the forward shader

`lighting.tsx:buildLights` mounts: 1 DirectionalLight (shadow), 1 HemisphereLight, 2 rim SpotLights, 2 sweep SpotLights, and `vfx-system.ts` adds 1 PointLight (hit light). Three.js compiles the light count into every lit program (`WebGLPrograms.js:339–340`, `numPointLights`, `numSpotLights`) and evaluates each light per fragment; `MeshPhysicalMaterial` with `clearcoat: 1` evaluates the specular BRDF a second time per light for the coat. Light layers cannot help here: three tests `light.layers` against the **camera**, not the object (`WebGLRenderer.js:1393`), so the arms cannot opt out of the sweeps in the same pass.

What the spots actually do: the sweeps are "moving coloured pools on the lacquer deck" (`quality.ts:74–77`), the rims are "the arm's rim light against the dark bowl" (`quality.ts:69–72`). Both already have cheaper twins in the scene: the sweep cones are drawn volumetrically by `createLightShafts`, and the shells carry a team fresnel rim (`robot-materials.ts:204`, `uRim`).

Plan: drop the four SpotLights; project the two sweep pools analytically in the deck's `onBeforeCompile` (a cone from the lamp position, `smoothstep` on the angle, `1/d²` falloff, the same Lissajous target `runShow` already computes) and add the same term at ~30 % to the floor material; raise `uRim` on the shells to compensate for the lost rim kick. Result: every lit fragment evaluates 1 directional + 1 point + hemi + env instead of 6 lights, the shells' programs shrink, and each draw uploads two uniform blocks instead of six. The grey card (`?debug=greycard`) must still read 0.46; the key and hemisphere are untouched, so it should.

Keep the PointLight mounted at intensity 0 rather than removing it dynamically (removing changes `numPointLights` and recompiles every lit material mid-fight).

### 4.5 MSAA, DPR, shadow, shafts, cyclorama

- **MSAA.** postprocessing multisamples both colour and depth of the input buffer ([postprocessing README](https://github.com/pmndrs/postprocessing): "The cost of MSAA depends on the amount of triangles in the scene and the sample count. If performance is an issue, FXAA or SMAA should be used instead"). With 600 k+ triangles the edge count is high. Apple's TBDR resolves MSAA in tile memory cheaply, but the half-float multisampled attachments still double the tile traffic. Recommendation: DEFAULT = MSAA 0 + SMAA (three ~0.2 ms passes once 4.1 stops wasting them), HIGH = MSAA 4, LOW unchanged. Measure both (section 7); if MSAA 2 measures under 0.6 ms on the M1 keep it.
- **DPR.** A 13" Air's default CSS viewport is 1470×956 (2560×1664 retina, 2.0 native). DPR 1.25 → 2.2 MP, 1.0 → 1.4 MP (−36 % fragment work), 2.0 → 5.6 MP. `tierDpr` and `PerformanceMonitor` already step this; keep 1.25 as the DEFAULT target and make sure `PerformanceMonitor`'s decline (drei default `bounds` [40,60] fps, `threshold` 0.75, `flipflops` 3 in `arena-canvas.tsx:214`) actually reaches LOW on a struggling machine; it currently only queues, and applies at the next safe phase. The "3 flipflops then stop" default means a machine that dips three times stops being adapted; consider `flipflops={Infinity}` with a longer `iterations`.
- **Shadow map.** 2048² PCF on DEFAULT (`quality.ts:31`) for a shadow camera that covers ±1.4 render units (±0.68 m) of deck: 1024² gives 1.5 mm texels, plenty for contact shadows under the arms. Set DEFAULT to 1024. Caster cost is already negligible thanks to the proxies; the saving is on the receiver side (fewer cache misses per PCF tap) and the map update itself. Per the three docs PCF is the cheapest filtered type ([three.js shadowMap types](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.shadowMap)); do not move to PCFSoft or VSM.
- **Light shafts.** `SHAFTS` + 2 sweeps = 8 additive, double-sided, fog-off cones with two noise octaves per fragment (`vfx/haze.ts:135–150`). Additive transparency is real overdraw even on a TBDR. DEFAULT draws 6 + 2; from the cockpit a cone can cover a third of the screen. Set DEFAULT to 3 (as LOW), drop the second `sn()` octave on DEFAULT/LOW, and shrink `radius` 0.20–0.24 → 0.16.
- **Cyclorama.** Drawn first (`renderOrder = -10`, `depthWrite: false`) with a noise-heavy fragment shader over the whole screen. Apple's hidden-surface removal only rejects fragments that later opaque geometry will cover if that geometry is in the same pass and depth-tested — it is, but setting `renderOrder = 10` (after the arms and deck, still before transparents) makes the rejection an early-Z on every driver, not just Apple's HSR. Free.

---

## 5. CPU: loop, allocation audit, GC

### 5.1 The frame loop is sound

`sim-driver.ts:frameTick` is the fixed-step accumulator from GAME_DESIGN 10.3 with the 0.1 s wall guard, the 16-step catch-up cap and hit-stop freezing on the impact step. Render alpha is set once. `turbo-gate.ts` keeps eval matches off the renderer entirely. Nothing to change structurally.

One knob: `MAX_STEPS_PER_FRAME.arcade = 16` lets a 33 ms frame run 16 × 2.5 ms = 40 ms of physics next frame; at ~0.1 ms per step that is 1.6 ms of catch-up on top of a frame that already dropped. 12 (30 ms) drops slightly more time but flattens the spiral. Minor.

### 5.2 Allocation audit (grep of `useFrame` bodies and `update()` methods under `src/game/render`)

Clean. Every per-frame writer uses preallocated `Float64Array`/`Matrix4`/`Color` scratch (`robot-view.tsx:162–180`, `lighting.tsx:127–138`, `led-strips.tsx:197`, `blob-shadows.ts:71–75`, `vfx/*` pools). `linearColor(hex)` and `brand-textures` `Path2D`s are memoised. The three things that do allocate:

| Site | Per | Note |
|---|---|---|
| `sim-driver.ts:316` `event()` spreads `{...e}` | per game event | events are rare (a few per second) — fine |
| `sim-driver.ts:460–466` `buildObservation` for policy seats (`reuse = undefined`) and `beginTick`'s `waits: Promise[]` | per control tick, 50 Hz | by design: drivers may retain the observation. ~50 small objects/s, one scavenge every few seconds |
| `contact-scan.ts:177–241` `data.contact`, `contacts.get(i)`, `c.pos`, `c.frame` (embind wrappers and typed-array views) | per contact per step, only while `mayTouch` | the bench's 0.55 ms already includes it; ~20 contacts × 6.67 steps ≈ 130 short-lived objects per frame while the arms touch |

V8's scavenger pauses are "usually 1–5 ms" and scale with allocation rate ([DEV: GC pauses and frontend jank](https://dev.to/helloashish99/javascript-gc-pauses-allocation-rate-frontend-jank-3jig)); the harness bench's single 1.44 ms p95 spike on an otherwise 0.34 ms p50 looks exactly like one. The contact walk is the only candidate worth a second look: if the `@mujoco/mujoco` 3.12 binding exposes the flat `contact` arrays on the heap, read `geom1/geom2/efc_address/pos/frame` through `HEAPF64` views instead of `contacts.get(i)`; otherwise leave it. Profile first (5.4).

`Math.hypot` appears in the per-frame paths (`robot-view.tsx:253,320,321`, `interpolate.ts:89`); V8's `Math.hypot` is several times slower than `Math.sqrt(x*x+y*y+z*z)` because it is overflow-safe. Micro, but free to change where the result is only compared to a threshold.

### 5.3 Draw submission (the real CPU item)

~155 draws/frame on DEFAULT (section 1). Two structural cuts:

1. Reflection layering (4.3) removes ~50 of them.
2. **Skinned merge of each arm.** Today each arm is 14 `Mesh`es (one per link×slot) under 8 link `Group`s, each draw re-uploading the full light/shadow uniform set. Merge per (arm, slot) into one `SkinnedMesh` with 8 bones (one per link, every vertex weight 1.0 on its link's bone): 14 → 4 draws per arm, one `boneTexture` upload per arm per frame, and `interpolateBody` writes straight into `bone.position/quaternion`. Three's skinning vertex path costs one 4×4 fetch per vertex, negligible next to the decimation win. The own-arm dither and per-link hide (`COCKPIT_HIDDEN_LINKS`) become a per-vertex `linkId` attribute the shader already has room for (`uLinkKind` becomes an attribute). The decal and LED `InstancedMesh`es are unaffected.

Expected: 2.5–4.5 ms → ~1 ms of JS submission on an M1.

### 5.4 GC protocol

Chrome Performance panel with **Memory** ticked: the HEAP chart must be a slow sawtooth, and every "Minor GC" entry under 1 ms ([Chrome DevTools performance reference](https://developer.chrome.com/docs/devtools/performance/reference)). If scavenges appear every second or exceed 2 ms, use the Memory panel's **Allocation sampling** during a 30 s fight and sort by self size; the culprits will be named with their source line. Acceptance stays as in 10.7: heap growth < 5 MB over a 3-round match, no GC pause > 4 ms.

---

## 6. Shader compile hitches

`prewarm.ts` forces everything visible and calls the **synchronous** `gl.compile`, and `post-stack.tsx` renders three frames with all effects on. Both good; three gaps:

1. **Use `compileAsync`.** three's `WebGLRenderer.compileAsync(scene, camera)` uses `KHR_parallel_shader_compile` so the loading screen keeps animating while the driver links ([three.js docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.compileAsync); the extension is exposed in 91 % of macOS WebGL2 contexts per [web3dsurvey](https://web3dsurvey.com/webgl2/extensions/KHR_parallel_shader_compile)). It also finishes *linking* off-thread, which the sync path does on first draw.
2. **Re-prewarm after a tier change.** `PostStack` remounts the whole composer on `key={msaa-…}` and the light/effect programs change with it; `applyIfSafe` only guarantees the phase is safe, not that the shaders exist. Run `prewarmScene` + the 3-frame post prewarm again inside the safe phase, then assert `gl.info.programs.length` is unchanged afterwards (the existing `programsAfterPrewarm` baseline).
3. **Never change the light count at runtime** (4.4) and never touch N8AO `quality` (4.2): both recompile.

Everything driven by juice, cues and tiers is uniforms only (`customProgramCacheKey` per material class in `robot-materials.ts:305–307`), which is why hits do not hitch today. Keep that invariant: the `?debug=feel` line `programs N (prewarm M)` must show N = M for the whole match.

---

## 7. Profiling protocol (Chrome on the M1 Air, muted, short sessions)

Chrome on macOS has **no reliable GPU timer**: `EXT_disjoint_timer_query_webgl2` is reported on only 60 % of macOS contexts ([web3dsurvey](https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2)) and the ANGLE-Metal backend does not expose timestamps, so GPU cost is measured by **differencing**, not by reading a counter.

1. **Baseline.** `?debug=feel`, DEFAULT tier, cockpit, a full 3-round match against the built-in AI. Record `fps`, `frame p95`, `cpu p95`, `draw calls`, `triangles`, `programs` at 1 min and 5 min. (The `cpu p95` in the overlay is JS time from priority −3 to +2; `frame p95` is the rAF interval. `frame p95 ≫ cpu p95` with `cpu p95 < 6 ms` means GPU-bound.) Do **not** profile with `?debug=greycard` or `?debug=contrast`: their `readPixels` (`debug-scenes.tsx:96–113`) forces a GPU sync every 250 ms and poisons the numbers.
2. **GPU or CPU?** Performance panel, 20 s recording mid-fight, Frames track: red/yellow frames = dropped/partial ([reference](https://developer.chrome.com/docs/devtools/performance/reference)). If the Main track shows < 8 ms of work per frame but frames still miss, the GPU track will be solid and the frame is GPU-bound. Cross-check by halving DPR from the settings (`video.quality = low`): if `frame p95` drops roughly with pixel count you are fill-bound; if it does not move you are vertex- or submission-bound ([profiling-research](https://github.com/TimvanScherpenzeel/profiling-research): "If you see a measurable performance change" when varying resolution you are pixel-bound).
3. **Differencing.** Toggle one thing at a time from the console and read `frame p95` after 15 s each: `dof/smaa` mounted vs not, reflection pass on/off (`REFLECTION_STRENGTH` 0 and skip `gl.render`), spots on/off (`intensity = 0` keeps the program; to measure the *shader* cost temporarily remove them before boot), MSAA 0/2/4 per tier, shaft count 0/3/8, arm LOD 100/35/15 %. Record a table; that table is the real version of section 2.
4. **Deep trace when the panel lies.** `chrome://tracing` with the *rendering* preset (categories `gpu`, `cc`, `blink`, `viz`) shows GPU process command-buffer time per frame and the swap; use it when the Main track is idle but frames drop ([web.dev about:tracing](https://web.dev/articles/abouttracing)). The Rendering tab's **Frame Rendering Stats** gives live FPS, GPU memory and a dropped-frame counter.
5. **Compile hitches.** Performance panel, record from the title screen through the first strike, first deflect and first KO; any `ProgramBinary`/`linkProgram` under the first hit is a prewarm miss. `programs` in the overlay must not move.
6. **GC.** Section 5.4.
7. **Physics.** `npm run bench` on the Air, and `?debug=bench` in the browser (`bench-browser.ts`), which runs the same function on the real WASM/JIT; the gate is p95 ≤ 1.2 ms per 16.7 ms of sim.
8. **Acceptance** (GAME_DESIGN 12.2 item 5, unchanged): p95 frame ≤ 16.7 ms over a 3-round match after 5 minutes, `programs` never grows, and, updated by this plan, ≤ 90 draw calls and ≤ 0.5 M triangles per frame on DEFAULT including the reflection and shadow passes.

Spector.js is the right WebGL frame inspector on a Mac (no GPU-sandbox flag needed) for checking that the DoF/SMAA passes are really gone and what the reflection camera draws.

---

## 8. Workers: physics and OffscreenCanvas (why not now)

- **Physics in a worker.** `@mujoco/mujoco` has a `/mt` build using Workers + `SharedArrayBuffer`, which needs the page to be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) ([MuJoCo wasm README](https://github.com/google-deepmind/mujoco/blob/main/wasm/README.md), [web.dev COOP/COEP](https://web.dev/articles/coop-coep)). The sim costs ~1 ms on the main thread, the loop's hit-stop and event delivery are synchronous with the render frame (`sim-driver.ts:671–729`), and the Capacitor/Electron packaging would need the headers too. Moving it buys ≤ 1 ms of main-thread time at the price of a frame of input latency and a rewrite of the recorder's bit-exact contract. No.
- **OffscreenCanvas.** `@react-three/offscreen` is experimental and shims DOM events into the worker ([react-three-offscreen](https://github.com/pmndrs/react-three-offscreen)); the HUD is DOM, pointer lock and `requestPointerLock` live on the main-thread canvas (`camera-director.tsx:45–48`), and the bottleneck is the GPU, which a worker does not touch. No.
- **`desynchronized` canvas.** Chrome's low-latency canvas path does not work on macOS ([chromium graphics-dev](https://groups.google.com/a/chromium.org/g/graphics-dev/c/20qDm3ZD2f8)). Skip.

What *is* worth a worker: the load-time mesh weld + simplify (0.6–1 s of CPU, section 3.2). Do it in a `Worker` with transferable buffers so the title screen never stalls.

---

## 9. Per-tier target after this plan

| Tier | DPR | MSAA | SMAA | AO | DoF | Bloom | Shadow | Arm LOD (main / mirror) | Mirror | Shafts | Spots in shader |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HIGH | min(2, device) | 4 | mounted only if `smaa` | half-res perf | cockpit only, **mounted** | 6 | 2048 | 35 % / 15 % | 640×360, arms layer, 60 Hz | 6 | 0 (deck projection) |
| DEFAULT | 1.25 | 0 | yes (mounted) | half-res perf | **unmounted** | 5 | 1024 | 35 % / 15 % | 480×270, arms layer, 30 Hz | 3 | 0 |
| LOW | 1.0 | 0 | yes | off | unmounted | 4 | 1024 | 35 % / — | none | 2, one octave | 0 |

Triangles per frame on DEFAULT: main ≈ 207 k (arms) + ~20 k set ≈ 230 k; mirror ≈ 90 k; shadow ≈ 5 k → **≈ 0.33 M**, down from ≈ 1.2 M. Draw calls ≈ 15 (arms + decals/LEDs) + 15 (set) + 15 (VFX) + 8 (mirror) + 18 (shadow) + 11 (post) ≈ **80–90**.

---

## Sources

- N8AO README (half-res cost, presets, recompile warning): https://github.com/N8python/n8ao
- pmndrs/postprocessing README (MSAA cost, HalfFloat): https://github.com/pmndrs/postprocessing ; SKIP/DST still calls `update()`: https://github.com/pmndrs/postprocessing/discussions/315 ; DepthOfFieldEffect internals: https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/DepthOfFieldEffect.js~DepthOfFieldEffect.html
- meshoptimizer JS API: https://github.com/zeux/meshoptimizer/blob/master/js/README.md ; runtime use with three.js: https://discourse.threejs.org/t/mesh-simplification-using-meshoptimizer/63002
- three.js `compileAsync`: https://threejs.org/docs/#api/en/renderers/WebGLRenderer.compileAsync ; KHR_parallel_shader_compile issue: https://github.com/mrdoob/three.js/issues/16321 ; shadow map types: https://threejs.org/docs/#api/en/renderers/WebGLRenderer.shadowMap
- Extension support: https://web3dsurvey.com/webgl2/extensions/KHR_parallel_shader_compile , https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2 ; spec: https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/
- Apple TBDR / Metal on Apple silicon: https://developer.apple.com/videos/play/wwdc2020/10602/ , https://developer.apple.com/videos/play/wwdc2020/10631/ , https://developer.apple.com/documentation/xcode/optimizing-gpu-performance ; M1/M2 GPU numbers: https://github.com/philipturner/metal-benchmarks
- Chrome profiling: https://developer.chrome.com/docs/devtools/performance/reference , https://web.dev/articles/abouttracing , https://github.com/TimvanScherpenzeel/profiling-research
- V8 GC: https://v8.dev/blog/jank-busters , https://v8.dev/blog/free-garbage-collection , https://dev.to/helloashish99/javascript-gc-pauses-allocation-rate-frontend-jank-3jig
- DPR / fill rate: https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
- Lights cost in three.js (general): https://www.utsubo.com/blog/threejs-best-practices-100-tips , https://discourse.threejs.org/t/talk-to-me-about-point-lights-and-performance/48258
- Workers: https://github.com/google-deepmind/mujoco/blob/main/wasm/README.md , https://web.dev/articles/coop-coep , https://github.com/pmndrs/react-three-offscreen , https://evilmartians.com/chronicles/faster-webgl-three-js-3d-graphics-with-offscreencanvas-and-web-workers ; desynchronized canvas on Mac: https://developer.chrome.com/blog/desynchronized , https://groups.google.com/a/chromium.org/g/graphics-dev/c/20qDm3ZD2f8
