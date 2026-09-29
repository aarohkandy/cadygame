# GROUNDING: make the world make sense (binding, 2026-09-26)

Overrides the look sections of `EMOTION_BIBLE.md` (5.x) and `SCOPE.md` where they conflict. Everything else in the bible stands.

## The verdict that caused this

The owner, after the emotion build landed: *"this doesn't look that good, think about everything like the ground, make it make sense, and do good please. make this acc high quality."*

The director looked at the same frames on a real GPU and agrees. What is actually on screen in a fight right now:

1. **The deck is a dark quad edged in glowing lines, floating in black.** It has no read of thickness, no material, no seams, no fixings. It is a shape, not an object.
2. **Nothing is planted.** Cubes, arm bases and the Core sit on the surface with no contact darkening. Every object looks pasted on rather than resting under gravity.
3. **Past the deck edge there is nothing.** No floor, no barrier, no furniture, no depth. The bowl is a thin gradient band with tiny sponsor strips at the horizon.
4. **No hardware.** The arms are 30 cm servo arms placed on a table with no mounting plate, no bolts, no cable leaving the base. Nothing says they are installed.
5. **Materials are flat.** Shells read as untextured plastic: no crevice dirt, no edge wear, no fingerprints on the gripper, no roughness variation. The deck mat and the metalwork look like the same material in different colours.
6. **Everything glows.** Emissive edges are used as decoration everywhere, which is the cheap-neon look. In a real arena, light comes from fixtures and lands on surfaces; only actual LED strips and screens emit.
7. **Scale is unreadable.** A 30 cm desk arm inside a stadium bowl, with no object of known size anywhere, so the eye cannot tell whether the arms are toys or mechs.

## The physical story everything must obey

**A television studio built around a table-sized robot arena.** The deck is 1.10 × 0.70 m. Two SO-101 arms, 30 cm each, are bolted to it. The audience is real people, far back and elevated. Every object in frame is either arena furniture at table scale, studio equipment at human scale, or the building.

The test for any element: **what is it made of, what holds it up, and who installed it?** If there is no answer, it does not ship.

## What to build

### A. The ground (the deck as a real object)
- **Build**: 18 mm plate, visible edge bevel, a brushed-aluminium trim extrusion capping the perimeter with a fine specular highlight along the top arris.
- **Surface**: matte black rubber ESD mat, roughness 0.75–0.9 with fine grain, printed graphics *into* the mat (slightly worn, not a sticker), and a subtle sheen only where the mat is scuffed by play.
- **Fixings**: hex bolt heads at the four corners and at 0.25 m intervals along the trim, countersunk, with the faint dirt ring real bolts collect.
- **Seams**: the mat is two panels with a 3 mm seam down the centreline, aligned with the existing midline graphic.
- **Reflection**: keep the planar reflection, but it belongs to the *trim and the scuffed lanes*, not the whole mat. A matte mat with a mirror finish is the current contradiction.

### B. Planting everything (this alone fixes half the cheapness)
- **Contact shadow / AO on every object that touches the deck**: both arm bases, every cube, the Core, the dock rings' hardware. Tight, dark at the contact point, falling off within 2–3 cm.
- Cubes get a soft contact darkening that tracks them as they slide and tumble.
- Arm bases get baked-in ambient occlusion where the plate meets the mat.

### C. The hardware that says "installed"
- **Mount plate** under each arm base: 6 mm steel, slightly larger footprint than the base, four visible bolts, a ground strap tag.
- **Cable harness**: a braided sleeve leaving the back of each base, sagging under its own weight into a **cable tray / drag chain** that runs to the deck edge and drops out of frame. This is the single strongest "these are real machines" cue available.
- **Dock rings** become real hardware: a shallow milled recess with a painted ring, not a glowing decal.

### D. Past the deck edge
- **Apron**: 80 mm brushed aluminium skirt around the deck at deck height.
- **Safety screen**: a low clear acrylic barrier (about 0.25 m tall at table scale) on aluminium posts around the fight area, with visible scuffs and finger smears. Slightly refractive, never fully transparent. This is what a real robot-combat arena has, it gives depth between camera and fight, and it catches the rim light beautifully.
- **Studio floor**: dark polished concrete with roughness variation and a soft, broad reflection of the overhead fixtures. Not black. Cable runs taped down with gaffer, a couple of anchored floor boxes.
- **Human-scale furniture** beyond the barrier at correct scale: two camera positions, a floor monitor on a stand, a rolling equipment case. These are the objects that tell the eye how big the deck is.

### E. Light with a source
- Every visible pool of light must have a **fixture** in frame or plausibly just out of it: overhead par cans on the truss, matching the existing cones.
- The key defines form: a specular roll across each arm shell so the eye reads curvature. No object should be lit only by flat coloured fill.
- **Delete decorative emissive edges.** Emissive is allowed on: real LED strips, screens, servo status LEDs, hot VFX. Everything else is lit, not glowing.
- The bowl stays dark and out of focus; it must never compete with the fight.

### F. Materials that read as expensive
Material contrast is what sells realism: matte rubber next to brushed aluminium next to glossy painted shell next to dark anodised servo.
- Add micro-detail to every surface: roughness variation, subtle normal breakup, crevice darkening (dirt collects in gaps), edge wear where paint rubs to primer.
- Gripper jaws: fingerprint and contact smears on the inner faces, brightest wear on the tips.
- Cubes: injection-moulded plastic with a parting line, a sink mark, and a printed number that is slightly worn.
- One "hero" material touch per object: the clearcoat streak on the shells, the machined swirl on the apron, the grain on the mat.

### G. Scale cues (cheap and decisive)
- Bolt heads, cable diameter, the acrylic barrier's thickness and the gaffer tape width are all objects with known real sizes. Getting them right sells 30 cm instantly.
- A printed scale bar or caliper graphic on the apron near the pilot side.

## Acceptance (checked on a real GPU, cockpit view, 1280 × 720)

1. **Squint test**: at a glance the frame reads deck, arms, barrier, floor, crowd, in that order of brightness. Nothing in the background is brighter than the opponent.
2. **Plant test**: pause on any frame. Every object touching the deck has a visible contact shadow; nothing floats.
3. **Material test**: a greyscale screenshot still shows four distinguishable materials (mat, metal, paint, servo) by their specular response alone.
4. **Installed test**: the cable harness and mount bolts are visible from the cockpit camera without hunting for them.
5. **Scale test**: a viewer who has never seen the game guesses the deck is about a metre across, not a football pitch.
6. **Source test**: for every bright pool on the deck, the fixture that makes it is identifiable.
7. **No decorative glow**: nothing emits light except LED strips, screens, status LEDs and hot VFX.
8. **Budget unchanged**: ≤ 90 draw calls, ≤ 0.45 M triangles, 60 fps p95 at DEFAULT, program count flat after prewarm.

---

# PART 2: THEATRE (binding, 2026-09-27)

The grounding pass worked: the deck is a real object, everything is planted, the hardware and studio furniture read, materials have detail. **Now the show is missing.** The director's real-GPU look at the cockpit view:

1. **The frame is dim and flat.** Everything sits in a narrow mid-dark band: no true blacks, no bright speculars, nothing pops. It reads as a dim workshop, not a televised arena.
2. **The arms are matte and unlit.** No specular roll defines their curvature and no rim separates them from the background. The blue viewmodel arm is a flat silhouette; the opponent is barely brighter than the mat.
3. **The upper half of the frame is a dead grey void** — a plain grey wall above the barrier with a thin white band and a few tiny sponsor strips. This is now the single cheapest element on screen.
4. **The crowd is invisible and the wrong size.** It is still built at miniature scale while the new studio furniture is at true human scale.
5. **The cubes are near-black on a dark mat.** They are hard to see and the Core does not read as a prize worth fighting over.
6. **Tutorial captions are enormous** — "SWING THE MOUSE ACROSS IT" spans half the screen.
7. **No atmosphere.** No visible haze or beams, so there is no depth between the camera and the back wall.

**The target is both: grounded AND theatrical.** Keep every physical rule from Part 1. Add the dynamic range and drama of a televised night arena:

- **Real dynamic range.** Deep true blacks in the corners and under the deck, a bright key that makes specular highlights snap on the shells and the trim, and midtones that fall away into shadow. At least 5% of pixels near black and visible highlight pixels in every fight frame.
- **The key defines form.** A moving specular roll across each arm as it swings is what makes a machine look expensive.
- **Saturated colour on the machines, not smeared over the room.** The team colours belong to the paint, the LEDs and the strips; the air and the concrete stay neutral.
- **Depth through atmosphere.** Visible haze catching the beams, so there are three readable planes: viewmodel arm, opponent, background.
- **A back wall that is a place.** Dark, with sparse deliberate practicals: a lit ribbon, a couple of doorways or vomitories, equipment silhouettes, and a real crowd at human scale, dim and glittering, never brighter than the fight.
- **Readable objects.** The Core is unmistakably the prize; clutter cubes read against the mat without glowing.
- **Quiet UI.** Prompts and captions sit in the lower third at a fraction of their current size.

## Part 2 acceptance (real GPU, cockpit, 1280 × 720, DEFAULT)

1. Luminance histogram of a fight frame: ≥ 5% of pixels at or below 0.03 display luma, and ≥ 0.5% at or above 0.85, with a mean between 0.12 and 0.28.
2. Swinging the arm through the key visibly moves a specular highlight along its shell.
3. Greyscale: the opponent is the brightest large object; the back wall is at least 8× darker than the opponent.
4. Three depth planes are separable in a still frame.
5. No region of the frame larger than a fifth of the screen is flat untextured grey.
6. Crowd and furniture read at the same human scale; the deck still reads about a metre across.
7. The Core is identifiable as the prize within one second by someone who has never played.
8. No caption or prompt taller than 6% of frame height during a fight.
9. Part 1 acceptance still passes, and the budget holds: ≤ 90 draws at DEFAULT in a live round, ≤ 0.45 M triangles, 60 fps, programs flat after prewarm.
