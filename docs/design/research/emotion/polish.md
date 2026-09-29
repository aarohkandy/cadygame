# Polish: what "premium" looks like in browser 3D, and a look-development plan for the TORQUE LIMIT night show

Track: premium look. Written 2026-09-24 for the `fps-duel` branch. Builds on `../finals-visual.md` (style guide, HUD, the daylight lighting recipe) and the binding ART_BIBLE in `.claude/workflows/duel-primetime.js` (PRIME TIME: "the world is dark and the light is the art"). Everything in those two still applies unless a line here says otherwise.

Confidence marks, as in the sibling docs: **[V]** verified from the cited source, **[R]** read from our own tree this session, **[I]** my inference or recommendation.

Stack this is written against **[R]**: React Three Fiber 9.7, three 0.185.1, postprocessing 6.39.5 with @react-three/postprocessing 3.1.1, drei 10.7.8, Next 16. No new packages are needed for anything below.

---

## 0. TL;DR

1. **The machinery for the night show is already on disk.** `quality.ts`, `lighting.tsx`, `post-stack.tsx`, `stage-deck.tsx` (own planar reflection with a mip streak), `haze.ts` (instanced volumetric cones), `cyclorama.tsx`, `holo-crowd.tsx`, `led-strips.tsx`, `trails.ts`, `stage-cues.ts` are all PRIME TIME code (WP6) **[R]**. STATUS.md saying the pass "never ran" is stale. The owner's "unlit grey prototype" verdict is therefore about **the numbers, not missing systems**: the scene is calibrated like a product shot, not a show.
2. **The single biggest lever is exposure and value structure, and it costs zero ms.** The calibration pins an 18% grey card to **0.46 display** under the key, with a 1.12 contrast grade **[R]**. That is "correctly exposed", which is exactly what reads as flat and grey. Premium night looks sit mid-grey at roughly **0.30 to 0.35 display**, keep the darks at true black, and let only speculars and emissives pass 1.0 pre-tonemap. ACES then does the work: it compresses the LDR range into roughly 0.1 to 0.8 **[V]**, so a scene that is not lit HDR comes out washed.
3. **Bloom never touches anything lit.** Threshold 1.25 with diffuse peaking at 0.35 linear **[R]** means only LEDs glow; the clearcoat specular streak from the key, which is the "expensive paint" cue, never blooms. Drop the threshold to ~0.95 and push the key so the streak crosses it.
4. **The volumetric beams are authored too faint to be seen**: team 0.16, shafts 0.07 linear additive **[R]**. Visible show beams need ~3x that at the lamp, a hard-edged cone with a fresnel-soft rim and scrolling noise, and to be parked so they cross **behind** the opponent (rim + depth) rather than pooling on the deck.
5. **Premium browser 3D is cheap by construction**: few real lights, environment (Lightformer) reflections doing most of the specular, baked or pre-rendered lighting, instancing, and DPR caps at 1.0 to 1.5 **[V]**. Our tree already follows that; what is missing is the *hierarchy* (one focal point, value gradient, saturation reserved for meaning) and *living light* (everything else should move slowly).
6. **The lighting rulebook, in one line each**: key 45/45, fill 90° away in the complementary colour and dimmer, kicker behind and low **[V]**; rim pops foreground from background **[V]**; "don't light everything the same" **[V]**; "light for the effect you need, and to hell with physics" **[V]**; grayscale-thumbnail test: player, threat, objective must read at thumbnail size **[V]**.
7. **Living background rules** (ambient animation): 3 to 6 s cycles, amplitudes you only notice when looking (±2 to ±3°, 1 to 2% of size), five subtle layers beat one big one, stagger phases, never hard-reset **[V]**. Apply to sweeps, crowd flicker, LED ribbons, camera flashes, haze drift, jumbotron.
8. **Hits need one more cue that we do not have: the impact frame.** 1 to 3 frames of inverted or white-silhouette image on crits and KO **[V]**; ours is a uniform on the existing GradeEffect, zero new passes.
9. **UI motion tokens with numbers**: Material 3 emphasized-decelerate `cubic-bezier(.05,.7,.1,1)`, emphasized-accelerate `(.3,0,.8,.15)`, durations 200 to 400 ms for panels, 50 to 150 ms for micro **[V]**; Apple: 200 to 400 ms, springs for anything touchable, damping 0.7 to 1.0 **[V, secondary source]**. Our `--ease-slam` overshoot from finals-visual is the callout curve; stagger rows at 30 to 40 ms.
10. **Budget at 1280x720, DPR 1.25, M1 Air (16.7 ms)**: scene 2.0, shadow 1.0, reflection pass 1.4, N8AO half-res ~1.8 (about 1 ms of it is the fixed depth-aware upsample **[V]**), bloom 0.9, beams and additive overdraw 0.8, crowd and set 0.5, HUD composite 0.6, headroom ~5 ms for spikes. DoF stays HIGH-only. Section 7 has the table and the acceptance checks.

---

## 1. Where the tree actually is, and why it still reads grey

Read this before touching anything: the previous pass (`duel-primetime`) did land most of its systems, uncommitted, and the failure is one of calibration and hierarchy.

| System | On disk **[R]** | What it does now | Why it does not read premium **[I]** |
|---|---|---|---|
| Tone map and grade | `post-stack.tsx`: ACES in composer, GradeEffect (contrast 1.12, saturation 1.12, teal shadows, warm highs) | Correct pipeline | Contrast too mild; the grey card target (0.46) forces a lit-mid-grey exposure; net effect is a "correctly exposed" flat image |
| Key light | `DirectionalLight` #F4F6FF at 2.42, elevation 70° | One crisp shadow caster | 70° is near top-down: it lights the *top* of the arms, not the faces the camera sees, and puts the clearcoat specular streak out of the camera's view |
| Hemisphere + env | Hemi 0.3 (sky #2A3070), env 0.5 with an overhead softbox | Fill | Fill lifts the blacks into grey-blue; night looks want fill below 0.15 and let the rims carry the form |
| Rims | Two team SpotLights 6.5 cd, angle 0.34, low behind each seat | Team-colour edge | 6.5 cd at ~1 m is about the same as the key's share on a side face; a rim must be the *brightest* thing on the silhouette |
| Sweeps | Two 70 cd team spots on Lissajous over each half | Moving pools | Pools land on the deck at the player's feet; nothing crosses behind the opponent |
| Beams | `haze.ts`: one instanced additive cone mesh (sweeps + up to 6 shafts) | Correct technique | Strength 0.16 / 0.07 linear: below what the eye reads as a beam against #0B0D26 fog |
| Bloom | mipmap, threshold 1.25, smoothing 0.35, intensity 1.15 | Emissive-only glow | Nothing lit ever reaches 1.25; the paint's hot spot does not bloom, so the paint reads as matte plastic |
| Deck | Own planar reflection into a mip target, vertical mip streak, strength 0.85, clearcoat 1 | The right idea | Reflection of a dim scene is a dim reflection: fix the *scene* (rims, LEDs, beams) and the deck lights up for free |
| Bowl | `cyclorama.tsx`: procedural stands, fascia lines, LED ribbon, phone flashes, haze | Alive in principle | Amplitudes and rates need the ambient-animation numbers below; and "nothing behind the opponent brighter than the fight" is the right rule, but a *rim-lit* opponent is what makes that rule pay off |
| Fog | #0B0D26, near 3.5, far 16 | Deep indigo | The whole set is inside 3.5 m, so fog never separates the layers; the bowl paints its own haze |
| AO | N8AO half-res, radius 0.35, intensity 2 | Contact darkening | Fine; keep. Radius is in render units (RENDER_SCALE), verify it is ~4 cm sim, not 35 cm |
| Trails, sparks, arcs, ripples, chips, confetti, de-rez | `trails.ts`, `vfx/*` pooled | Present | Not the problem; the problem is what they sit *on* |

**Diagnosis in one sentence [I]:** every subsystem was built to a "correct" physical target (grey card, energy-conserving beams, threshold above lit diffuse), and correctness is the look of a lighting test, not of a show. Section 5 gives the numbers to change, and section 7 the measurable targets so the change is verified on the real GPU rather than argued about.

---

## 2. What premium browser 3D actually does (research)

### 2.1 The showcase pieces are cheap on purpose

- **[V]** Bruno Simon's portfolio and course are built on **baked lighting** and simple materials with post effects layered on top; the course's rendering chapters are "baked scenes" and "post-processing" (bloom, DoF) rather than many real-time lights. <https://threejs-journey.com/> , <https://medium.com/@bruno_simon/bruno-simon-portfolio-case-study-960402cc259b>
- **[V]** Lusion **pre-rendered normal, ambient-occlusion, thickness and two diffuse-illumination passes into images**, then combined them with two matcaps to render translucent objects with dynamic states; vertex data was packed as 16-bit integers with a divider (983 KB desktop, 246 KB mobile). <https://www.awwwards.com/case-study-for-lusion-by-lusion-winner-of-site-of-the-month-may.html>
- **[V]** Active Theory's "story of technology" is a decade of building their own thin engine on top of WebGL to control every draw. <https://medium.com/active-theory/the-story-of-technology-built-at-active-theory-5d17ae0e3fb4>
- **[V]** Codrops' "efficient scenes" walkthrough: **DPR capped at 1.0 desktop, 1.5 mobile**; `antialias:false, alpha:false, stencil:false, depth:false` on the canvas; environment maps and a single `Lightformer` preferred over dynamic lights; N8AO and DoF present but **dynamically disableable** on performance drops; 27 meshes / 40k triangles / 2.1 MB assets. <https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/>
- **[V]** The 2026 "100 tips" roundup: **3 or fewer dynamic lights** as a starting point; shadow maps 1024 to 2048 on desktop; point-light shadows cost `objects x 6` draws each; half-resolution post can **roughly double** frame rate when fill-bound; disable composer multisampling for speed; a 2048² PNG is ~21 MiB of VRAM with mips. <https://www.utsubo.com/blog/threejs-best-practices-100-tips>

**Translation [I]:** premium in the browser is *not* more lights and more passes. It is (a) one hard key and one or two saturated rims, (b) an environment map that carries all the specular richness (our Lightformer rig), (c) emissives and bloom for "light sources", (d) instanced set dressing, (e) a strong grade. We have all five. What separates a showcase from a prototype is *hierarchy and motion*, which is sections 3 and 5.

### 2.2 Tone mapping is where "premium" is won or lost

- **[V]** ACES Filmic in three intentionally compresses the LDR range "into something like [0.1 to 0.8]"; contrast loss is inherent, and the fixes are exposure, lighting intensity, sharpening or a LUT. <https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484>
- **[V]** three's ACES fit does not fully desaturate highlights like a reference ACES ODT. <https://github.com/mrdoob/three.js/pull/19621>
- **[V]** AgX (Blender 4 default) was added for "better fundamentals" and a more natural roll-off; the issue author explicitly says ACES is fine if you prefer its look for a scene. <https://github.com/mrdoob/three.js/issues/27362>
- **[V]** Khronos PBR Neutral exists to keep product colours true and is the wrong tool for a filmic night look. <https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products>

**Translation [I]:** keep ACES (we want the toe and the shoulder), but **light the scene HDR** so the shoulder has something to roll off: emissives x6 to x12, specular hot spots > 1.5, and exposure ~0.8 so the lit mids sit at 0.30 to 0.35 display. Try AgX as an A/B in `?debug=greycard` only after the light rig is retuned; do not swap tone mappers to fix an exposure problem. `LUT3DEffect` from postprocessing 6.39 is available for a final "show LUT" (a 32³ .cube is ~100 KB and costs one texture fetch per pixel) **[V, docs]** <https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html> ; our GradeEffect already covers contrast/split-tone, so a LUT is optional polish, not a step.

---

## 3. Stylised lighting and readability: the rules, with sources

### 3.1 Three-point, but for a camera you can predict

- **[V]** Key ≈ 45° elevation and 45° to one side; fill ≈ 90° from the key, dimmer, in a **complementary** colour; kicker/rim behind the subject, opposite and *lower* than the fill, so a glancing reflection outlines the silhouette. "Light for the effect you need, and to hell with physics." Use warm/cool temperature opposition rather than explicit colour coding. <https://www.gamedeveloper.com/design/lighting-design-fundamentals-how-and-where-to-use-colored-light>
- **[V]** Robert Yang, GDC 2018 "How to light a level": rim "highlights edges to pop the foreground from the background"; key and fill perpendicular, rim behind; **"Don't light everything the same"**; light setpieces with rim and background lights so silhouettes pop; keep a consistent lighting language; **"darker albedos produce much darker rooms than you'd think"**; flatten subtle fill lights by killing their specular. Adapt three-point by using the layout to **predict the camera angle**. <https://www.blog.radiator.debacle.us/2018/03/gdc-2018-how-to-light-level-slides-and.html>
- **[V]** In theatre a kicker is placed behind the subject so a glancing reflection forms a highlight around the outline; a complementary rim separates a character from the backdrop without undercutting the colour theme. (same gamedeveloper source)

**We can predict the camera exactly [I]:** first person, eye near the pilot arm's shoulder, looking across the deck at the AI arm. So: the *opponent* is the subject. Its key is our white key (should come from camera-left-high, ~45°, not 70° overhead), its fill is the deck reflection plus the indigo hemisphere, and its **kicker is the magenta rim from behind it on the far side**; the *pilot* arm is foreground and gets the cobalt kicker from behind the camera. That is the existing `RIM_SPOTS` layout **[R]**; the change is intensity and the key's angle.

### 3.2 Value hierarchy and saturation as meaning

- **[V]** Grayscale-thumbnail test: convert a screenshot to greyscale at thumbnail size; if player, threats and objective are not instantly visible, fix the value hierarchy before touching textures. Background values more restrained than gameplay elements; **reserve the strongest light/dark contrast for the most important information**; **"reserve saturation for meaning"**: the most saturated object wins attention, so limit competing accents; three-layer depth model foreground (framing) / midground (gameplay) / background (context, never competing). Rule of thirds is a starting point. <https://game-developers.org/how-to-make-your-game-look-good>
- **[V]** TF2 vs Overwatch: TF2 characters have "a much stricter value hierarchy" from **painted gradients** (darker at the feet, lighter toward the head/weapon); a "huge splash of colour with a single gradient" is what makes a silhouette read; a restricted palette forces shape language; team identity must be instant. <https://80.lv/articles/comparing-team-fortress-2-and-overwatch-art-direction>
- **[V]** Overwatch's overriding rule was that characters be identifiable mid-battle by silhouette, and that abilities/effects not add visual complexity. <https://www.gdcvault.com/play/1024268/The-Art-of-Overwatch-Evolving> (GDC 2017 summary via <https://www.cookandbecker.com/en/article/378/designing-overwatch.html>)

**Translation for a 6-joint arm [I]:** the arm is a chain of similar cylinders; without a painted value gradient it reads as one grey mass. Give the shell a **base-to-tip gradient** (darker at the mount, brightest at the wrist/gripper, which is the business end and the thing the player watches) via the existing custom shader hook in `robot-materials.ts` (a `vLocalPos`-driven multiply, 0.75 at the base to 1.15 at the hand). Saturation hierarchy: team paint and LEDs are the only saturated things; the bowl, stands, truss and floor are desaturated navy; signal orange and volt yellow appear only on *events* (crit, Core, KO), never as static set dressing brighter than a fascia line.

---

## 4. Living light and living backgrounds

- **[V]** Ambient animation principles (web, but the perceptual rules transfer): keep it slow, **3 to 6 s cycles**, ease-in-out; amplitudes you would "only catch if you're really looking" (**±2 to ±3° rotations, ~1 to 2% translations**); **"five subtle animations, each on separate layers, can feel rich and alive"** where one big one is boring; stagger with delays for randomness; never hard-reset between loops; respect `prefers-reduced-motion`. <https://www.smashingmagazine.com/2025/09/ambient-animations-web-design-principles-implementation/>
- **[V]** Secondary motion (weight shift, sway, micro-adjust) is "a high-value, low-cost source of life"; particles on slightly curved paths with drag feel organic, straight lines feel mechanical. <https://gamejuice.co.uk/articles/disney-12-animation-principles-games> , <https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide>
- **[V]** Guilty Gear Strive moves the camera even while the player is in control (previously taboo in the series), slows the world and throws a giant COUNTER callout on big hits, and its impact sparks make hits "self-evident" without frame data. <https://www.unrealengine.com/en-US/developer-interviews/how-guilty-gear--strive--hits-an-ultra-combo-with-groundbreaking-visuals-and-gameplay>
- **[V]** Impact frames: single high-contrast frames (inverted colours or black/white silhouettes) inserted for **1 to 3 frames** to make a hit register as a shock; in games they are timed to the hit frame. <https://brainvoyage.blog/impact-frames-meaning-animation-guide>

**The five layers for our bowl [I]** (each a uniform already plumbed through `CYC_UNIFORMS` and `lighting.tsx` **[R]**): (1) sweep spots on 8 to 14 s Lissajous, never the same period on both sides; (2) crowd hologram flicker at 2 to 4 Hz per instance, plus phone flashes at ~1 per second across the bowl, x4 with hype; (3) LED fascia ribbon scroll at 40 px/s with a 6 s brightness breath; (4) haze drift 0.02 UV/s with beams' noise scrolling *down*; (5) truss lamp "chase" every 12 s during idle phases only. Everything moves at once, nothing moves fast except on events.

---

## 5. The premium ingredient list: exact techniques for R3F 9 / three 0.185 / postprocessing 6.39

Each entry: what it is, why the eye reads it as expensive, the exact numbers, its cost, and what changes in our tree. Costs are for 1280x720 at DPR 1.25 on an M1 Air and are estimates **[I]** unless marked; measure with `?debug=feel` (fps, CPU/GPU ms, draw calls, triangles) **[R]**.

### 5.1 Exposure and value structure (0 ms, the biggest lever)

Target **[I]**: lit mid-grey on the opponent's shell at **0.30 to 0.35 display** (not 0.46), true blacks in the bowl (≤ 0.03 display), specular hot spot on clearcoat **≥ 1.6 linear** before tone mapping, LEDs **6 to 12x** token colour. That gives ACES an HDR input, which is what its shoulder is for **[V, 2.2]**.

`quality.ts CALIBRATION` changes **[I]**:
- `exposure` 1.0 → **0.85**
- `hemisphere.intensity` 0.3 → **0.12** (fill is the enemy of night; let the deck reflection be the fill)
- `environmentIntensity` 0.5 → **0.7** (more specular richness, less diffuse lift: keep the overhead softbox, drop its diffuse contribution by making it thinner and longer, 1.6 x 0.25 m, so it reads as a *streak* on the clearcoat, not a wash)
- `grade.contrast` 1.12 → **1.32**, `grade.saturation` 1.12 → **1.18**; shadow tint x2 (`[-0.004, 0.003, 0.008]`), highlight warm unchanged
- `greycard.target` 0.46 → **0.34**, tolerance 0.03 (the existing `?debug=greycard` readback and `predictDisplayValue` become the regression test for the new look, not a blocker)
- `bloom.threshold` 1.25 → **0.95**, `smoothing` 0.35 → **0.2**, `intensity` 1.15 → **0.9**, `radius` 0.72 → 0.78 (wider, softer; the mipmap chain is doing the work **[V]** <https://react-postprocessing.docs.pmnd.rs/effects/bloom>)

The grey card test at 0.34 with a 1.32 S-curve is a **~1 stop under** look with hot highlights: that is the difference between a lighting test and a title fight.

### 5.2 The light rig (3 real lights + environment, 1 shadow map)

Keep the count: **one key, two rims, two sweeps** (sweeps cast no shadows), hemisphere, Lightformer environment **[R]**. That is within the "3 or fewer dynamic lights" guidance once you note only the key has a shadow map **[V, 2.1]**.

- **Key** (`DirectionalLight`): elevation **70° → 48°**, azimuth so it comes from **camera-left and slightly behind the camera** (the pilot's seat side, ~-135° in sim yaw for the atlas seat). At 48° the clearcoat's specular lobe lands on the opponent's upper links as seen from the eye, and the shadows fall *away* from the camera across the deck, which reads as depth. Intensity 2.42 → **3.2** (the mids come down via exposure; the hot spot goes up). Shadow: keep 2048/1024 by tier, `normalBias` 0.012 **[R]**.
- **Rims** (`SpotLight`, team colour): 6.5 cd → **16 cd**, angle 0.34 → **0.30**, penumbra 0.4 → **0.6**, kept low and behind each arm as in `RIM_SPOTS` **[R]**. Rule check: at 1 m that is 16 lux against the key's ~2.1 on a side face: the rim is now the brightest thing on the silhouette, which is the whole point **[V, 3.1]**. Add `decay 2, distance 2.2` so they never reach the stands.
- **Sweeps**: keep 70 cd but re-aim: home points move from the deck halves to **a band 0.25 to 0.45 m behind each arm at 0.15 m height**, so the coloured pool crosses *behind* the opponent's silhouette (a moving background light **[V, 3.1]**) and the beam cone is seen edge-on from the eye. Periods **11 s and 14 s** (never equal), `speedHz` 0.07 → two values.
- **Hemisphere**: sky `#2A3070` → **#1C2352**, ground **#05060F**.
- **Environment**: keep the Lightformer rig (offline, no HDR fetch **[R]**); make the two horizon strips **1.8 x 0.12 m at intensity 3** in team colours so the anodised joints pick up team glints, and add one **volt strip behind the camera at 0.4** for a warm return on the pilot's hand.

### 5.3 The reflective deck (already ours; ~1.4 ms on DEFAULT)

`stage-deck.tsx` renders a mirrored camera into a mip-mapped half-float target (640x360 DEFAULT, 1024x576 HIGH) at priority 0.45 and streaks the reflection vertically down the mips **[R]**. That is a better fit than drei's `MeshReflectorMaterial` (default `resolution 256`, blur cost proportional to radius **[V]** <http://drei.docs.pmnd.rs/shaders/mesh-reflector-material>) because it shares the frame's single shadow update.

Changes **[I]**:
- Reflection strength 0.85 is fine; what is dim is the *reflected scene*. After 5.2 the rims, beams and LEDs make the reflection light up on their own.
- Add a **fresnel weighting** to the reflection (Schlick, F0 0.04, exponent 5) so it is near-mirror at grazing angles (the far half of the deck, under the opponent) and fades toward the eye. Cheap: one dot product.
- Add a **print mask** so the printed team halves are matte (roughness 0.45) and the black lacquer between them is the mirror: the eye reads "two materials" as expensive.
- LOW keeps the pass off but should get a **static cube-reflected glint**: `envMapIntensity 1.2` on the deck material, which the Lightformer environment already provides for free.

### 5.4 Bloom on emissives and hot speculars, plus one streak (~0.9 ms)

- `Bloom mipmapBlur` with `luminanceThreshold 0.95`, `levels` by tier (6/5/4) **[R]**; the mip chain gives the soft roll-off cheaply **[V]** <https://github.com/pmndrs/postprocessing/blob/main/demo/src/demos/BloomDemo.js>.
- Emissive authoring **[R]** `emissive: { led: 7, jumbotron: 3.4, crowd: 1.3, spark: 8 }`: raise **led to 10** on the deck edge only, keep crowd at 1.3 (background must not out-glow the fight **[V, 3.2]**).
- **Anamorphic streak** for the LED edges and the KO flash: no new package. Add a 1-D horizontal blur of the bloom's brightest mip as a second `Effect` (12 taps, half-res, blend ADD at 0.25, team-tinted). Cost ~0.25 ms. This is the "cinema lens" cue; ektogamat's lens-flare pass shows the same idea with dirt textures **[V]** <https://github.com/ektogamat/R3F-Ultimate-Lens-Flare>, but a full flare is overkill here.
- Never bloom the HUD: the DOM HUD is composited above the canvas already **[R]**.

### 5.5 Volumetric beams and haze (~0.8 ms of additive overdraw)

Technique on disk **[R]** = the classic "good enough" cone: an open cone mesh, additive, `depthWrite false`, brightest along the axis and near the lamp, noise scrolling down it (`haze.ts`). Same family as threex.volumetricspotlight / John Chapman **[V]** <https://github.com/jeromeetienne/threex.volumetricspotlight> and the additive-cone god-rays demo (opacity ~0.2, scale-converging beam) **[V]** <https://threejsdemos.com/demos/lighting/godrays>. Raymarched cones (Heckel: 50 steps with blue-noise dithering ≈ 250 without) are better but cost a full-screen pass **[V]** <https://blog.maximeheckel.com/posts/shaping-light-volumetric-lighting-with-post-processing-and-raymarching/>; not needed at our scale.

Changes **[I]**:
- Strength `beam.team` 0.16 → **0.45**, `beam.shaft` 0.07 → **0.18** at the lamp, falling to 0 at the deck (`pow(1 - t, 1.6)` along the axis).
- **Fresnel-soft rim**: multiply by `pow(abs(dot(N, V)), 1.4)` so the cone is dense through its middle and vanishes at its edges; that one term is what makes a cone read as light instead of as a translucent traffic cone.
- **Depth fade** against the scene depth (postprocessing exposes the depth texture; or fade over the last 4 cm above the deck) so beams do not clip hard through the arms.
- Aim: sweeps cross **behind** the opponent (5.2). Overhead shafts stay on the far half of the bowl, never between the eye and the opponent (readability rule from the ART_BIBLE).
- Fog: `near 3.5 → 1.6, far 16 → 7` so the stands genuinely sink and the deck stays crisp; the bowl shader's own haze is the far layer. Three layers: pilot arm (sharp, cobalt-rimmed), opponent (sharp, key + magenta rim), bowl (soft, blue-black) **[V, 3.2]**.

### 5.6 Materials that read as expensive (0 ms: uniforms)

three 0.185 `MeshPhysicalMaterial` supports clearcoat, sheen, iridescence and **anisotropy** (with `anisotropyRotation`) **[V]** <https://threejs.org/docs/pages/MeshPhysicalMaterial.html>. Our shells are clearcoat 1 / clearcoatRoughness 0.05 metallic-flake paint with a noise roughness breakup, wear to primer, team fresnel rim and LED emissive slots **[R]** `robot-materials.ts`.

- **Paint**: keep; add the base-to-tip **value gradient** (3.2) and lift `envMapIntensity` 1.4 → 1.8 on the shell only. Reference car paint from the docs example: metalness 0.9, roughness 0.5, clearcoat 1, clearcoatRoughness 0.1 is a duller "sedan"; ours (0.45 / 0.32 / 1 / 0.05) is the "show car"; the difference the eye keys on is the *sharp* clearcoat highlight over a *soft* base lobe, so keep the two roughnesses far apart.
- **Servos / joints**: switch the anodised slots to **anisotropy 0.6**, rotation along the joint axis, roughness 0.34 → 0.42: a brushed-metal streak that turns as the joint turns. Anisotropy enables a small extra shader path; it is the same program on both arms, so no new compiles after prewarm.
- **Optics / camera eye**: `iridescence 0.35, iridescenceIOR 1.6` on the tiny lens: the "lens coating" cue at almost no cost.
- **Wear** stays; ensure wear is *pooled at the edges* (edge mask x noise) rather than uniform, because uniform grime is what reads as "dirty prototype".
- **Decals**: team number, "SO-101" plate and the OHMSTEAD mark at the shoulder (`robot-decals.ts` exists **[R]**) at 10 to 15% coverage; readable at 1 m or not at all.

### 5.7 Contact shadows and AO (keep)

N8AO half-res: 2 to 4x faster than full-res with a **~1 ms fixed depth-aware upsample** you must not disable **[V]** <https://www.npmjs.com/package/n8ao>. Our `N8AO halfRes aoRadius 0.35 intensity 2 quality "performance"` **[R]** is the right setting; verify the radius is ~4 to 6 cm in *sim* metres after `RENDER_SCALE` (a 35 cm sim radius would darken the whole deck under the arms and flatten it). `blob-shadows.ts` already gives a cheap grounding disc under each arm for LOW **[R]**. drei's `ContactShadows` is "rather expensive" and `AccumulativeShadows` is static after accumulation **[V]** <http://drei.docs.pmnd.rs/staging/accumulative-shadows>; neither fits moving arms better than what we have.

### 5.8 Motion trails, smears and the impact frame

- **Trails** (`trails.ts`, distance-spaced ribbon above 1.0 m/s, white-hot core, 0.3 s life) **[R]**: keep; widen from 8 mm to **12 mm** and add a `pow(fade, 0.6)` so the arc holds brightness longer before it dies. Trails must render *after* the deck reflection pass so they are mirrored on the lacquer.
- **Impact frame** **[I, from V]**: on crit, clash and KO, two frames (33 ms at 60 Hz) where the GradeEffect outputs `mix(c, 1 - luma(c) tinted to the striker's team colour, uImpact)`; then one frame at 50%. It is a uniform on the effect that already exists, so it costs nothing and never compiles. Reduced-motion setting zeroes it (it is a flash).
- **Speed lines** for heavy strikes are already in fps-feel 4.6 **[R]**; unchanged.

### 5.9 Living background: the five layers with numbers

All uniforms in `CYC_UNIFORMS`, `holo-crowd`, `led-strips`, `jumbotron` **[R]**; values per section 4 **[V]**:

| Layer | Rate | Amplitude | On hype/events |
|---|---|---|---|
| Sweep spots (2) | 11 s and 14 s Lissajous | full travel of a 0.3 m band behind each arm | chase 2x between rounds; both to winner colour on KO (exists **[R]**) |
| Crowd holograms (400 instanced) | flicker 2 to 4 Hz per instance, lean cycle 5 s | 1 to 2 cm sway, brightness ±15% | jump 250 ms on strikes, arms up on KO (exists **[R]**) |
| Phone flashes in the stands | Poisson ~1/s baseline | 1 to 2 px sprites at 4x crowd emissive | x4 with hype, burst of 30 on KO |
| LED fascia ribbon + dasher | 40 px/s scroll, 6 s breath | ±20% brightness | white flood 120 ms on strikes to that side (exists **[R]**) |
| Haze + beams | UV drift 0.02/s, beam noise scroll 0.15/s downward | ±10% density | slam on ENGAGE (exists **[R]**) |
| Jumbotron | ≤ 15 Hz feed (512x288 **[R]**) | roll bar, live tote | instant replay in the 3 s after a KO (render target already exists) |

`CanvasTexture` uploads every frame are the one thing to avoid here: they read back pixels on the CPU and upload with `texSubImage2D`, with a heavy frame drop in Firefox and Safari **[V]** <https://discourse.threejs.org/t/performance-issue-with-canvastexture-and-needsupdate-on-every-frame-lottieloader-use-case-scenario/50288>. The jumbotron's ≤ 15 Hz rate and the LED ribbon being a shader (not a canvas) **[R]** are already right.

---

## 6. Composition and UI motion

### 6.1 Camera composition for a first-person arm fight

The camera is predictable (3.1), so compose it like a shot **[I, rules from V 3.2]**:
- **Opponent on the upper-right third intersection**, its gripper (the threat) near the centre-right; the pilot's own gripper occupies the lower-left third as foreground. The rule-of-thirds is a starting point **[V]**; here it also keeps the reticle line of sight clear.
- **Three depth layers with distinct treatment**: foreground pilot arm (cobalt rim, slightly *under* key, DoF-sharp), midground opponent (the brightest lit object in frame, white key + magenta rim), background bowl (soft, blue-black, only lines and dots glow). Never let a sweep pool or a shaft sit *between* eye and opponent.
- **Leading lines**: the deck's LED edges and the printed midline converge on the opponent's mount; the truss silhouette above frames it. Yang's "light for progression" becomes "light for the target" **[V]**.
- **Motion on the camera while in control** is acceptable and premium (Strive broke that taboo) **[V]**: our `cockpit-rig` kicks and FOV punch stay; add a **2° slow dutch drift** over 20 s during idle phases only, zero during fight.
- **FOV**: 78° per finals-visual **[R]**; on a heavy hit dealt, punch to 82° for 120 ms (exists as FOV_OFFSET_MAX 6° **[R]**).

### 6.2 UI motion tokens (numbers)

- **[V]** Material 3: emphasized-decelerate `cubic-bezier(0.05, 0.7, 0.1, 1.0)` for entering; emphasized-accelerate `(0.3, 0.0, 0.8, 0.15)` for exiting; emphasized `(0.2, 0, 0, 1)` default; standard `(0.2, 0, 0, 1)`; linear only for loops. Durations: short 50/100/150/200 ms (micro, small appear, icons, tooltips), medium 250/300/350/400 ms (state changes, dialogs, panels), long 450 to 600, extra-long 700 to 1000 (full-screen only). Expressive (2025) moves component motion to springs. <https://m3.material.io/styles/motion/easing-and-duration/tokens-specs> (values mirrored at <https://github.com/aldefy/compose-skill/blob/master/skills/compose-expert/references/material3-motion.md>)
- **[V]** Apple HIG: prefer quick, precise motion; springs for anything the user can touch because they absorb new input without a restart; transitions 200 to 400 ms feel right, > 500 ms sluggish; damping ratio 0.7 to 1.0 for subtle elasticity (secondary summary). <https://developer.apple.com/design/human-interface-guidelines/motion> , <https://medium.com/@foks.wang/ios-26-motion-design-guide-key-principles-and-practical-tips-for-transition-animations-74def2edbf7c>
- **[V]** SF6's UI motto was "easy to understand and easier to play", with graffiti callouts as the brand voice. <https://www.streetfighter.com/6/column/detail/ui01>

**Our token set [I]**, extending finals-visual 2.7 (`--ease-slam`, `--ease-snap`, `--ease-exit`):

| Motion | Curve | Duration | Notes |
|---|---|---|---|
| Callout slam (FIRST BLOOD, CRIT, KO) | `--ease-slam` `cubic-bezier(.2,1.5,.35,1)` | 240 ms in, hold, 180 ms out with M3 accelerate | scale 1.8 → 1.0, skew -20° → -10°; **stagger letters/words 30 ms**; the impact frame (5.8) fires on the same frame as the slam's first frame |
| Plate / feed row | M3 emphasized-decelerate | 200 ms | translateX 48 px → 0; rows stagger 40 ms |
| Numbers (damage, tote) | `--ease-snap` | 350 ms roll + 120 ms pop | tabular digits; combo merge re-pops at 1.2 |
| Bars (integrity, servo heat) | linear at 60 Hz via CSS var | none | never React state (finals-visual 2.5) |
| Round card light-sweep | linear | 900 ms | a 12° white gradient band across the card, once |
| Menu hover / press | spring, damping 0.8 | ~180 ms | scale 1.03 / 0.97 |

Rule: anything in-match is ≤ 240 ms and never overlaps the opponent's silhouette; anything between rounds may run 400 to 900 ms and fill the screen.

---

## 7. Per-frame budget and the plan

### 7.1 Budget (DEFAULT tier: 1280x720, DPR 1.25, M1 Air, Chrome, 16.7 ms)

Acceptance in BUILD_PLAN 5 / GAME_DESIGN 3193 **[R]**: p95 ≤ 16.7 ms after 5 min, ≤ 80 draw calls, ≤ 1.2 M triangles incl. shadow, program count flat after prewarm. Numbers below are GPU estimates **[I]** to be replaced by `?debug=feel` readings; the ones marked [V] have a source.

| Pass | ms | Notes |
|---|---|---|
| Physics + interpolation (CPU, main thread) | 2.5 | outside the GPU budget but on the same frame |
| Shadow map (key only, 2048, proxies) | 1.0 | one caster; sweeps and rims never cast |
| Deck reflection pass (640x360 half-float, mips) | 1.4 | shares the shadow update; LOW skips |
| Main scene (arms, deck, set, bowl, crowd instanced) | 2.0 | ≤ 80 draws |
| Beams + haze + trails + sparks (additive overdraw) | 0.8 | fill-bound: keep cones thin, sprites small |
| N8AO half-res | 1.8 | ~1 ms of it is the fixed upsample [V] |
| Bloom (5 levels, mipmap) | 0.9 | cheap relative to blur passes [V] |
| Anamorphic streak (half-res, 12 taps) | 0.25 | new, optional |
| CA + vignette + grade + tone map (merged) | 0.5 | postprocessing merges consecutive effects into one program |
| SMAA | 0 (LOW only) | MSAA 2x on DEFAULT |
| DoF | 0 (HIGH only) | doubles frame time when on [V] |
| HUD DOM composite | 0.6 | browser compositor |
| **Total** | **~12.3** | ~4.4 ms headroom for spikes (KO confetti, prewarm) |

If over budget, the order of cuts that preserves the look: reflection to 480x270 → N8AO off (blob shadows carry contact) → bloom levels 5 → 4 → beams to 3 → DPR 1.25 → 1.0 (fill-bound scenes roughly double fps at half-res **[V]**).

### 7.2 The plan, in the order that moves the needle

Each pass has a check that can be read on the real GPU with a short muted session, or from the server's headless shots for composition only (they cannot show bloom or reflections faithfully **[R]** STATUS.md).

1. **Exposure and grade (half a day, 0 ms).** Apply 5.1. Retarget `greycard` to 0.34. Check: `?debug=greycard` reads 0.34 ± 0.03; a greyscale thumbnail of a mid-fight frame shows opponent > pilot arm > deck > bowl in that value order; histogram has ≥ 5% of pixels ≤ 0.03 and ≥ 0.5% ≥ 0.95.
2. **Light rig (1 day).** Apply 5.2. Check: the opponent silhouette has a continuous magenta edge in the rest pose from the eye; the clearcoat specular streak from the key is visible on the opponent's upper two links and blooms softly; no face of either arm reads flat grey.
3. **Beams, haze, fog (half a day).** Apply 5.5. Check: both sweep cones are visible as light in the fog with soft edges; neither crosses between eye and opponent during a fight; stands sink into blue-black; bloom coverage stays under ~5% of pixels (a ≥ 10% coverage means the threshold is too low).
4. **Materials (half a day, uniforms).** Apply 5.6. Check: brushed streak turns with the joint; base-to-tip gradient visible in greyscale; wear only at edges.
5. **Living background (1 day).** Apply 5.9 numbers. Check: a 10 s idle recording has every layer moving and nothing moving faster than the eye can follow; hype visibly changes the bowl.
6. **Impact frame and UI tokens (half a day).** 5.8 and 6.2. Check: crit shows two inverted frames; callouts stagger; nothing in-match exceeds 240 ms.
7. **Budget verification (half a day).** `?debug=feel` p95 over a 3-round match, draw calls, program count; fill the table in 7.1 with real numbers and commit the doc.

Everything above is tuning of existing systems plus three small additions (fresnel on the deck reflection, anamorphic streak, impact-frame uniform). No new dependencies, no new shader programs after prewarm, all tiers keep one program per material.

---

## 8. Sources

- Bruno Simon, portfolio case study: <https://medium.com/@bruno_simon/bruno-simon-portfolio-case-study-960402cc259b> ; course: <https://threejs-journey.com/>
- Lusion case study (Awwwards): <https://www.awwwards.com/case-study-for-lusion-by-lusion-winner-of-site-of-the-month-may.html>
- Active Theory, the story of technology: <https://medium.com/active-theory/the-story-of-technology-built-at-active-theory-5d17ae0e3fb4>
- Codrops, building efficient three.js scenes: <https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/>
- 100 three.js tips (2026): <https://www.utsubo.com/blog/threejs-best-practices-100-tips>
- ACES low contrast thread: <https://discourse.threejs.org/t/acesfilmictonemapping-leading-to-low-contrast-textures/15484> ; ACES fit PR: <https://github.com/mrdoob/three.js/pull/19621> ; AgX issue: <https://github.com/mrdoob/three.js/issues/27362> ; Khronos PBR Neutral: <https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products>
- postprocessing: Bloom demo <https://github.com/pmndrs/postprocessing/blob/main/demo/src/demos/BloomDemo.js> ; Bloom docs <https://react-postprocessing.docs.pmnd.rs/effects/bloom> ; LUT3DEffect <https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html> ; GodRaysEffect <https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/GodRaysEffect.js~GodRaysEffect.html>
- N8AO: <https://www.npmjs.com/package/n8ao>
- drei MeshReflectorMaterial: <http://drei.docs.pmnd.rs/shaders/mesh-reflector-material> ; AccumulativeShadows: <http://drei.docs.pmnd.rs/staging/accumulative-shadows>
- Volumetric cones: threex.volumetricspotlight <https://github.com/jeromeetienne/threex.volumetricspotlight> ; additive-cone god rays <https://threejsdemos.com/demos/lighting/godrays> ; Maxime Heckel, shaping light <https://blog.maximeheckel.com/posts/shaping-light-volumetric-lighting-with-post-processing-and-raymarching/>
- Lens flare / streak reference: <https://github.com/ektogamat/R3F-Ultimate-Lens-Flare>
- MeshPhysicalMaterial (anisotropy, iridescence, clearcoat): <https://threejs.org/docs/pages/MeshPhysicalMaterial.html>
- CanvasTexture per-frame cost: <https://discourse.threejs.org/t/performance-issue-with-canvastexture-and-needsupdate-on-every-frame-lottieloader-use-case-scenario/50288>
- Lighting design fundamentals, coloured light: <https://www.gamedeveloper.com/design/lighting-design-fundamentals-how-and-where-to-use-colored-light>
- Robert Yang, GDC 2018 How to light a level: <https://www.blog.radiator.debacle.us/2018/03/gdc-2018-how-to-light-level-slides-and.html>
- How to make your game look good (value, focal point, layers): <https://game-developers.org/how-to-make-your-game-look-good>
- TF2 vs Overwatch art direction: <https://80.lv/articles/comparing-team-fortress-2-and-overwatch-art-direction> ; The Art of Overwatch (GDC 2017): <https://www.gdcvault.com/play/1024268/The-Art-of-Overwatch-Evolving> ; Designing Overwatch: <https://www.cookandbecker.com/en/article/378/designing-overwatch.html>
- Ambient animation principles: <https://www.smashingmagazine.com/2025/09/ambient-animations-web-design-principles-implementation/> ; Disney principles in games: <https://gamejuice.co.uk/articles/disney-12-animation-principles-games> ; idle animation guide: <https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide>
- Guilty Gear Strive (Unreal interview): <https://www.unrealengine.com/en-US/developer-interviews/how-guilty-gear--strive--hits-an-ultra-combo-with-groundbreaking-visuals-and-gameplay> ; Guilty Gear-style combo breakdown: <https://80.lv/articles/animating-guilty-gear-inspired-fighting-game-combo-in-maya>
- Impact frames: <https://brainvoyage.blog/impact-frames-meaning-animation-guide>
- Material 3 easing and duration: <https://m3.material.io/styles/motion/easing-and-duration/tokens-specs> (mirror with values: <https://github.com/aldefy/compose-skill/blob/master/skills/compose-expert/references/material3-motion.md>)
- Apple HIG motion: <https://developer.apple.com/design/human-interface-guidelines/motion> ; iOS 26 motion guide (secondary): <https://medium.com/@foks.wang/ios-26-motion-design-guide-key-principles-and-practical-tips-for-transition-animations-74def2edbf7c>
- Street Fighter 6 UI dev column: <https://www.streetfighter.com/6/column/detail/ui01>
