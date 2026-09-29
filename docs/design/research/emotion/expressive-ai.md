# An opponent that feels human: a motion language for the SO-101

Track: emotion / expressive AI. Written 2026-09-24 for TORQUE LIMIT (branch `fps-duel`).
Companion docs: `../ai-opponent.md` (decision architecture, personalities, harness),
`../finals-feel.md`, `../fps-feel.md`. This doc does not repeat the utility-AI or
reaction-time design; it says what the arm should *do with its body* so the player
believes there is someone in it.

The owner's verdict was "it doesn't have emotion". The literature below says the
same thing three different ways: **emotion in a machine is read from timing and
posture, not from features.** An articulated lamp with five servos and a gripper is
exactly the body Pixar proved this with in 1986. We already own that body. What is
missing is the phrasing.

---

## 0. The ten rules (read this if nothing else)

1. **Nothing is ever still.** Every second the arm is not attacking it breathes,
   drifts, and looks. Vector's animators: *"keep the body slightly moving at all
   times... if upset or excited, the movement would be a little faster."*
   (https://randym32.github.io/Anki.Vector.Documentation/guides/Vector%20character%20study.html)
2. **Timing is the emotion.** Same pose, different speed = different feeling.
   Lasseter: happy Luxo Jr. hops fast with little ground time; sad Jr. hops slow with
   long ground time. Acceleration predicts perceived arousal (Saerbeck & Bartneck
   2010). So: arousal is a *speed and acceleration multiplier* applied to every
   behaviour, not a separate animation set.
3. **Every action has three parts: anticipation, action, recovery.** Dark Souls 3
   guarantees tell + strike ≥ 340 ms and recovery ≥ 170 ms. Our servo numbers already
   give a 240–340 ms strike; the wind-up and the settle are the missing 60 %.
4. **The arm looks before it acts.** "The eyes lead the snatch." The gripper is the
   face. Point it at what the AI is about to do 150–400 ms before doing it. That one
   rule turns a script into an intention.
5. **Hits must land on the body.** A flinch (recoil + 6° shiver + re-guard) within
   one perception delay of any contact. If the opponent doesn't react to being hit,
   nothing the player does matters.
6. **Mistakes are the personality.** Tekken 8 Ghost copies mistakes; Halo's
   "good mistakes" (Hunter over-swing) exist so the player can feel smart. Each
   personality gets *authored* flaws, executed with its own body language.
7. **If the AI didn't show it, it didn't happen** (Orkin, F.E.A.R.). Intent that
   stays inside the utility scorer is wasted. Route decision events into body
   (tells), light (gripper LED), sound (servo pitch), and the hosts' captions.
8. **Pace it like a director.** Build → peak → relax (L4D), or the menace gauge
   (Alien: Isolation) which *sends the monster away* when tension saturates. In a
   1v1 the "relax" is the opponent backing off, resetting, breathing.
9. **Remember the player, out loud.** Nemesis: "every time a player does something,
   never shut them off, build upon it." The arm that got slammed last round guards
   high this round, and a caption says so.
10. **Tough = smart.** Halo's playtest: making enemies survive longer moved
    "not intelligent" from 20 % to 0 % with no AI changes. Perceived intelligence is
    *time on stage*. Let the opponent live long enough to have a mood.

---

## 1. Diagnosis: why it reads as a script today

| Symptom (owner) | Principle being violated | Fix section |
|---|---|---|
| "nothing moves unless the player moves" | Illusion of life rule 1: no dead frames. Servos hold a target perfectly, so the arm freezes like a fixture. | §4.1 breathing, §4.2 gaze |
| "the opponent feels like a script" | No anticipation before actions, no recovery after. Actions start from zero with no glance. | §4.4 tells, §4.3 flinch, §5 temperament |
| "hits do not feel like anything" | No reaction on the receiving body. Hit reactions come from MuJoCo only, and a PD servo at kp 998 wipes out the physical recoil within ~100 ms. | §4.3 flinch (commanded, not physical) |
| "the arms have no life" | Motion is straight-line joint interpolation. No overlap, no follow-through, no secondary action. | §3, §5 |
| "the first minute is confusing" | The opponent never announces itself. No pre-round ritual, no gaze at the player, no "I see you". | §4.2, §7, §9 |
| "no reason to play again" | No memory, no mood arc across rounds, no rivalry. | §8, §9 |

---

## 2. What the research says (digest, with the numbers)

### 2.1 Animation: Luxo Jr. and the principles

Lasseter, *Principles of Traditional Animation Applied to 3D Computer Animation*,
SIGGRAPH 1987
(https://history.siggraph.org/learning/principles-of-traditional-animation-applied-to-3d-computer-animation-by-lasseter/ ,
http://graphics.cs.cmu.edu/nsp/course/15-464/Fall05/papers/lasseter.pdf) and his
SIGGRAPH '94 course notes
(https://education.siggraph.org/static/HyperGraph/animation/character_animation/principles/lasseter_s94.htm):

- **Anticipation size = size of the decision.** "The eyes will lead the snatch by
  quite a bit because this is a big decision"; a reflex duck gets "a couple of
  frames". Translate: a heavy slam gets 300–450 ms of visible wind-up; a poke gets
  40–80 ms; a flinch gets none.
- **Timing conveys emotion.** Happy Jr. hops fast with minimal ground contact; after
  popping the ball he hops "slower" with "much more time on the ground". Both use the
  same hop. Only the timing changed.
- **Overlapping action.** "An action should not be brought to a complete stop before
  starting another action; the second action should overlap the first." Our motor
  layer currently finishes one primitive, settles, then starts the next. That gap is
  what reads as robotic.
- **Personality through the same action.** Dad "leans over the ball and uses only
  his shade to bat it"; Jr. "whacks the ball with his whole shade, putting his whole
  body into it." Same verb, two characters: which joints participate is personality.
- **Staging.** In a still scene, movement draws the eye; in a busy scene, stillness
  does. A wind-up is only readable if the rest of the body goes quiet during it.
- **Secondary action / follow-through.** In Luxo Jr. the cord and the shade wobble
  after every hop (https://en.wikipedia.org/wiki/Luxo_Jr.). Our equivalents: wrist
  roll and gripper jaws lag the arm by 30–80 ms and overshoot.
- **Timing table (from Whitaker & Halas, reproduced by Lasseter 1987)** for a head
  turn, at 24 fps: 2 frames (83 ms) "hit by a frying pan", 4 frames (167 ms) "a
  crisp order", 6 frames (250 ms) "sees something inviting", 10 frames (417 ms)
  "stretching a sore muscle". This is the scale for our gaze turns: a reactive
  glance is ~80–170 ms, a considered look is 250–400 ms.

Thomas & Johnston, *The Illusion of Life* (1981): the goal is "drawings that appear
to think and make decisions and act of their own volition"; audiences need "a
planned series of events leading the eye" (anticipation) or they cannot follow.
(https://en.wikipedia.org/wiki/Anticipation_(animation))

### 2.2 Expressive robots: the same principles measured on real motors

- **Kismet affect space** (Breazeal, IJRR 2002,
  https://interruptions.net/literature/Breazeal-IJRR02.pdf): three axes, each with a
  posture mapping. *Arousal*: high = erect posture, chin up, faster and more darting
  gaze; low = slouch, neck lean and head tilt lowered. *Valence*: head tilts up a
  bit for positive, down a bit for negative. *Stance*: open = forward lean
  ("strong engagement"), closed = withdrawal ("shrinking away from whatever the
  robot is looking at"). Emotion processes compete; only the winner above threshold
  drives expression, and "the expressive response leads the behavioural response."
  → Section 4.0 maps these three axes onto SO-101 joints directly.
- **Acceleration predicts arousal** (Saerbeck & Bartneck, HRI 2010,
  https://www.bartneck.de/publications/2010/perceptionAffectElicitedRobotMotion/saerbeckBartneckHRI2010.pdf):
  across two embodiments (a Roomba and the iCat) acceleration level predicted
  perceived arousal; valence came from an interaction of acceleration and
  curvature; embodiment had no significant effect. → Emotion is portable to a
  robot arm, and arousal is an acceleration knob.
- **Laban Effort + Shape on a manipulator** (arXiv 2505.11716,
  https://arxiv.org/html/2505.11716): Happy = sudden time, free flow, indirect
  space, "wall" shape (stretch upward, end effector at 45°). Sad = sustained,
  bound, direct, "ball" shape (joints curve inward, semicircle). Shy = sustained,
  bound, direct, "screw" shape (lean forward, end effector facing down). Angry =
  sudden, bound, direct, "pin" shape (stretch forward, end effector at 45°). 49
  participants distinguished all six trajectories on at least one
  valence/arousal/dominance axis; Happy and Shy were most liked, Angry and Hesitant
  least.
- **Anatomy of Uncertainty** (arXiv 2607.13696, https://arxiv.org/html/2607.13696):
  eleven computable descriptors for a manipulator. Recognised states (N = 55):
  *Confident* 47/55 with approach accel 0.1 m/s² and a single 1.67 s pause.
  *Hesitant* 34/55 with approach accel 0.05 m/s², 5 pauses, 3 retreats of 0.05 m.
  *Fearful* 38/55 with an abrupt retreat at 2 m/s² and a 6° shiver. *Curious* 29/55
  with 20° horizontal gaze sweeps and multiple pauses. → These are literally
  parameters for §4. Note the ratio: fear retreat is 20× the acceleration of a
  hesitant approach.
- **Low-DOF is enough** (Reachy Mini study, arXiv 2605.12786,
  https://arxiv.org/pdf/2605.12786): six basic emotions recognised from head tilt,
  antenna motion and timing alone. Guidance: prioritise temporal dynamics over
  spatial complexity; use amplitude for intensity; coordinate multiple joints
  rather than move one; keep a signature consistent across repeats.
- **Hoffman & Ju, "Designing Robots with Movement in Mind"** (JHRI 2014,
  https://dl.acm.org/doi/pdf/10.5898/JHRI.3.1.Hoffman): movement is a design
  material; people are "highly sensitive to physical movement and spatiotemporal
  affordances." Their robots (Shimon, Travis, Kip) are prototyped with animation
  sketches, Wizard-of-Oz and skeletal prototypes before any control code. → Author
  the motion language as data (keyframe tables) and iterate it in the replay
  harness; do not hard-code it into the policy.
- **Anki Cozmo / Vector** (https://en.wikipedia.org/wiki/Cozmo ,
  https://www.designnews.com/testing-measurement/from-cozmo-to-vector-how-anki-designs-robots-with-emotional-intelligence ,
  https://pycozmo.readthedocs.io/en/stable/generated/pycozmo.anim_encoder.html):
  a Pixar animator (Carlos Baena) led the character; animations are authored in
  Maya and exported as keyframe tracks (head angle, lift height, body motion,
  backpack lights, procedural face, event track). Behaviours pick from **animation
  groups** by mood, so the same trigger never plays the identical clip. When Cozmo
  wins "its eyes turn into upside-down u's", when it loses "he'll slam his forklift
  arms in frustration", and machine learning needs are turned into character: "it
  will act curious when it needs to gather information." Vector's known design gap:
  no warning signal before big reactions, which is exactly Lasseter's anticipation.
  → The SO-101 has the same DOF budget as Cozmo (lift = shoulder/elbow, head =
  wrist flex, body = pan, face = gripper + LED). Use the same pipeline: keyframe
  groups, mood-selected, with a procedural "face" on the gripper.

### 2.3 Game AI: what players actually read as human

- **Halo, "The Illusion of Intelligence"** (Butcher & Griesemer, GDC 2002,
  https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf).
  Design goals: *intelligible, interactive, unpredictable*; "transparent thought
  process"; "predictable reactions"; "breaking point" states (flee in terror,
  berserk, retreat, defensive). Randomness was **discarded** as a source of
  unpredictability; instead "analog reactions" in position and timing to an
  unpredictable player. The playtest that matters: weak-enemy build rated 20 % "not
  intelligent", 36 % "too easy"; tough-enemy build (same AI, longer lifespan) 0 %
  "not intelligent", 92 % "about right". Slide title: "Smarter = Tougher, Tougher =
  Smarter."
- **F.E.A.R., "Combat Dialogue: The Illusion of Communication"** (Orkin, Game AI
  Pro 2, https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter02_Combat_Dialogue_in_FEAR_The_Illusion_of_Communication.pdf):
  "If the AI didn't say it, it didn't happen." Dialogue broadcasts mental state and
  intention, explains *lack* of action ("Get out of there!" / "I've got nowhere to
  go!"), and creates behaviour that was never coded: "We never wrote any code for
  the AI to call in reinforcements, but the reviews said we did!"
- **Alien: Isolation** (https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation ,
  https://www.aiandgames.com/p/revisiting-alien-isolation): a Director that knows
  everything and only *advises* the creature's general area; a creature with a
  100+ node behaviour tree whose branches **unlock over the game** so it appears to
  learn (never from player deaths). A **menace gauge** rises with proximity, line
  of sight and reachability; when it peaks the Director sends the alien "backstage"
  for relief. Job priorities: finish current action (low), blend toward new
  objective (medium), interrupt everything (high). Searches are deliberately
  sub-optimal, with backtracking "to simulate doubt", and the stalk radius tightens
  on each pass.
- **Left 4 Dead Director** (Booth, GDC 2009; https://left4dead.fandom.com/wiki/The_Director):
  build-up → peak → relax, with relax lasting about 30–45 s and ending early if the
  players push. Intensity is estimated per player from damage and danger.
- **Shadow of Mordor Nemesis** (https://www.gamedeveloper.com/design/designing-i-shadow-of-mordor-i-s-nemesis-system):
  built on self-determination theory (competence, autonomy, relatedness); enemies
  remember and *reference* what the player did; defeat is a rivalry beat, not an
  end. De Plater: "Every time a player does something, never shut them off. Build
  upon [what they did]."
- **Fighting-game AI that feels cheap** (Maj, Sonic Hurricane,
  https://sonichurricane.com/?p=2452): Capcom "replaced human anticipation and
  pattern recognition with sheer mechanical reaction speed"; CPUs that "jump over
  fireballs on reaction"; rigid flowcharts that "can't develop new strengths" or
  "new weaknesses". Street Fighter 6's level 8 CPU is still described by players as
  "input reading frame perfect counters", while its V-Rival mode (AI blended with
  player data) "does this much less frequently"
  (https://gamefaqs.gamespot.com/boards/358511-street-fighter-6/80420792?page=1).
  Human-band reaction targets: Killer Instinct 12–19 frames (200–317 ms),
  FightingICE 15-frame delay (see `../ai-opponent.md` §1.1).
- **Readable attacks** (Dark Souls 3 anatomy,
  https://www.gamedeveloper.com/game-platforms/anatomy-of-an-enemy-attack-in-dark-souls-3):
  five phases: Opening Pose (telegraph), Attack Signal (weapon arc, hitbox off),
  Attack, End Pose, Return ("window of opportunity"). Attack Signal + Attack ≥ 340
  ms; Return ≥ 170 ms so the player can recognise completion. Poses reference
  Kabuki: weight and inertia held in a still frame. Punch-Out!! (Wii) makes each
  boxer's tell a red flash plus a character-specific wind-up
  (https://en.wikipedia.org/wiki/Punch-Out!!_(2009_video_game)).
- **Human posture literature** (Wallbott 1998, *Bodily expression of emotion*,
  https://onlinelibrary.wiley.com/doi/abs/10.1002/(SICI)1099-0992(1998110)28:6%3C879::AID-EJSP901%3E3.0.CO;2-W):
  224 acted takes; collapsed upper body and reduced movement for low-arousal
  states, expanded posture for pride/hot anger; boredom = head back, upper body
  collapsed, little movement. Confident stance = takes up space; hesitation =
  narrow, static "parallel stance" (https://www.skillsconverged.com/pages/body-language-of-defensive-attitude).

---

## 3. The SO-101 as a body

Joints (in order from base): `shoulder_pan` (yaw), `shoulder_lift` (pitch),
`elbow_flex`, `wrist_flex` (pitch), `wrist_roll`, `gripper`. Servo facts from
`../codebase.md` and `../ai-opponent.md` §0.1: kp 998, kv 2.73, torque cap 2.94
N·m, joint damping 0.60, so terminal speed ≈ 4.8 rad/s and any target error above
3 mrad saturates torque. **The servo is bang-bang; the commanded target trajectory is
the only timing control.** All curves below are *target* curves fed to the PD,
never physics changes.

Body-part mapping (Cozmo/Kismet analogy):

| Human/lamp part | SO-101 joint(s) | Expressive job |
|---|---|---|
| Head / face | `wrist_flex` + `wrist_roll` + gripper jaws + gripper LED | gaze direction, valence (tilt up/down), attention |
| Neck / torso | `shoulder_lift` + `elbow_flex` | arousal (erect vs slouch), stance (lean in vs withdraw), reach |
| Hips / feet | `shoulder_pan` | weight shift, circling, turning to look |
| Hands | gripper open/close | clap, grab, "fist", chatter |
| Eyes | gripper LED (add one emissive strip on each jaw, art track) + jaw aperture | blink, glare, dim when dejected |

Two composition rules:

- **Layered targets.** `q_cmd = q_base(behaviour) + q_breath(t) + q_gaze(t) +
  q_react(t)`, each layer a small additive offset with its own priority, blended
  with a per-layer weight that fades in/out over 60–120 ms. Combat primitives
  own `q_base`; breathing and gaze are always on but attenuated to 0.3 during a
  strike (staging: the body goes quiet so the tell reads).
- **Overlap by default.** A new primitive starts when the previous one is 70–85 %
  complete (by time), not at settle. The blend is a cubic ease over 80–150 ms.
  Follow-through: `wrist_roll` and gripper lag `q_base` by 40–80 ms via a
  first-order filter with τ = 50 ms and a 5–10 % overshoot.

---

## 4. The motion language

Notation: `Δ` = offset from the current guard pose in radians; times are from the
start of the behaviour; `ease` = cubic in/out unless stated; `A` = arousal
multiplier (0.6 calm … 1.5 furious) which scales both amplitude (×A^0.5) and
speed (×A). Values are starting points for the harness; tune by replay.

### 4.0 The affect posture (always on, blended under everything)

Three low-pass state variables from the mind layer (`../ai-opponent.md` §2.4):
arousal `a ∈ [0,1]`, valence `v ∈ [−1,1]`, stance `s ∈ [−1,1]` (open/closed).
Time constants: arousal τ = 1.5 s, valence τ = 4 s, stance τ = 2 s. Map:

| Axis | Joint offset | Reading |
|---|---|---|
| Arousal high | `shoulder_lift` −0.10·a (rise), `elbow_flex` −0.08·a (extend), `wrist_flex` −0.06·a (chin up), breathing rate ×(1+a), gaze darts ×(1+2a) | erect, alert, quick |
| Arousal low | the same terms with a → 0 plus `shoulder_lift` +0.08·(1−a) (slouch) | heavy, slow |
| Valence + | `wrist_flex` −0.08·v (tilt up), gripper 15 % open, LED bright | "smiling" |
| Valence − | `wrist_flex` +0.10·|v| (tilt down), gripper closed, LED dim to 40 % | sulking |
| Stance open | `elbow_flex` −0.10·s, `shoulder_lift` −0.05·s (lean in toward player) | engaged, wants to fight |
| Stance closed | `elbow_flex` +0.12·|s|, `shoulder_pan` ±0.10 away from player (turn away) | withdrawn, hurt |

These are Kismet's six prototype postures ported to five joints. Because they are
additive and slow, the player never sees them "play"; they see an opponent that is
carrying itself differently after each exchange.

### 4.1 Idle breathing (life signal)

Two superimposed cycles, phase-randomised per round so two arms never sync:

- **Breath:** `shoulder_lift` ±0.012 and `elbow_flex` ∓0.010 (antiphase, so the
  gripper rises and falls ~5–8 mm), sine at 0.30 Hz (BASALT) … 0.60 Hz (KESTREL),
  rate ×(1+a). Inhale is 45 % of the cycle, exhale 55 % (asymmetry reads as organic).
- **Sway:** `shoulder_pan` ±0.02, `wrist_roll` ±0.03, sum of two sines (0.17 Hz
  and 0.11 Hz, incommensurate) so it never repeats.
- **Weight shift:** every 4–9 s (uniform), `shoulder_pan` steps ±0.06 with a 350
  ms ease and holds; the sway centre follows it. This is the "hip shift".
- **Micro-saccade of the gripper:** every 0.8–2.5 s a 25–60 ms twitch of
  `wrist_flex` ±0.015 and gripper ±3 % aperture. In the Anatomy-of-Uncertainty
  vocabulary this is the shiver descriptor at 1°, far below the 6° fear shiver.
- **Servo audio:** breathing drives the existing servo bed at low gain so the arm
  is faintly audible even at rest (`arena-audio.mjs` motion energy already does
  this; ensure the breath is above its 0.35 threshold on inhale peaks).

### 4.2 Looking at the player (gaze)

The gripper "faces" along the wrist axis. Define `look(target, style)`:

- **Reactive glance** (player moved suddenly, cube moved): 80–170 ms turn,
  `shoulder_pan` and `wrist_flex` together, ease-out only (fast start, soft stop),
  5–8 % overshoot then a 60 ms settle.
- **Considered look** (deciding, sizing up): 250–400 ms, ease in/out, no overshoot,
  then hold 300–900 ms with micro-saccades.
- **Tracking:** while the player's gripper moves, the AI gripper follows with a
  first-order lag τ = 120 ms (KESTREL) … 220 ms (BASALT), capped at ±0.35 rad from
  guard. Latency in the human band makes this read as watching, not locking on.
- **Gaze budget:** ~60 % of idle time on the player's gripper, 25 % on the player's
  "face" (camera position), 15 % elsewhere (the Core, own gripper, the far
  corner). When about to attack, gaze snaps to the *target point* 150–400 ms
  before the primitive starts (Lasseter: eyes lead the snatch). When bluffing
  (feint), gaze goes to the *wrong* target — the first tell the player can learn
  to read, and the first the AI can learn to fake.
- **Eye contact moments:** round start, after landing a hit, after eating a hit.
  Hold on the player's camera for 600–1200 ms with the gripper jaws opening 10 %.
  This is the "I see you" beat the first minute is missing.

### 4.3 Flinch on being hit (the fix for "hits do not feel like anything")

Triggered by any contact event on the AI's body above the strike threshold, with
no perception delay (this is a reflex, not a decision; Lasseter's "couple of
frames"). Layered on top of whatever is running, priority: interrupt.

```
t = 0        contact
0–40 ms      recoil: all of shoulder_lift, elbow_flex, wrist_flex step +0.12..+0.25
             AWAY from the contact normal (scale by impulse, clamp), gripper snaps
             closed; ease-out. The PD will slam this at terminal speed: good.
40–140 ms    shiver: wrist_flex and wrist_roll ± 0.10 (≈6°) at 18 Hz, decaying τ=60 ms
             gripper LED flashes white 1 frame then drops to 30 % for 300 ms
140–400 ms   re-guard: ease back to guard with a 10 % overshoot (settle 120 ms)
400–900 ms   look at the player (reactive glance), stance closes by 0.3 for 2 s,
             arousal += 0.25 (KESTREL: valence −0.2 → anger; BASALT: stance −0.4 →
             caution; MAGPIE: composure −0.3, shiver amplitude ×1.5)
```

Scale: light contact 40 % of these amplitudes; a blocked hit is a 60 % flinch with
the shiver replaced by a "shove" (`elbow_flex` +0.06 for 90 ms then back). Being
slammed on the Core adds a 300 ms "stagger": `shoulder_pan` ±0.15 in two
alternating steps (a wobble) before re-guard. Big hits also stun the breathing for
one cycle; it resumes at 1.6× rate ("winded") and decays to normal over 6 s.

Why commanded rather than physical: with kp 998 the physical recoil is erased in
about one PD time constant, so the player never sees it. The commanded flinch is
the *body admitting it was hit*, and it must be larger than the physical one.

### 4.4 Wind-up tells (anticipation)

Every attack primitive gets an authored opening pose, scaled to the size of the
decision (Lasseter) and kept above the reaction floor for heavy moves (Dark Souls
3: tell + strike ≥ 340 ms; our strike alone is 240–340 ms).

| Primitive | Opening pose (Δ from guard) | Tell duration | Attack Signal → strike | Return (opening for player) |
|---|---|---|---|---|
| POKE (5–8 cm) | none; gripper closes 40 ms before | 0–40 ms | 100–150 ms | 120 ms |
| JAB | `elbow_flex` +0.10 (cock), `wrist_flex` −0.05, gaze on target | 90–140 ms | 310 ms | 170–220 ms |
| HOOK / sweep | `shoulder_pan` −0.20 opposite to swing, `wrist_roll` +0.3 | 150–220 ms | 240 ms | 200 ms |
| SLAM (overhead) | `shoulder_lift` −0.35 rise, `elbow_flex` −0.20, gripper opens wide, 40 ms hold at the top (Kabuki still) | 300–450 ms | 340 ms | 300–400 ms |
| GRAB_THROW | gripper opens 100 %, `wrist_flex` +0.15 (jaw drops), slow approach 0.05 m/s² | 200–300 ms | contact-driven | 250 ms |
| FEINT | the JAB or SLAM opening pose, then abort at 60–80 % of the tell, snap back with 15 % overshoot | full tell | none | 100 ms |

Tells are **per-personality scaled** (`../ai-opponent.md` §2.10: KESTREL ×0.85,
BASALT slams ×1.15). Tells also get the LED: jaws glow the accent colour ramping
over the tell, saturating at the strike, like Punch-Out's flash. That is the
learnable signature; it is also the thing a feint abuses.

Staging during a tell: breathing weight → 0.3, gaze locked, sway frozen. The
contrast against the idle noise is what makes the tell pop.

### 4.5 Hesitation and doubt (the "thinking" the player can see)

Directly from the Anatomy-of-Uncertainty numbers. Used when the utility scorer's
top two actions are within 10 % of each other, when composure is low, or as an
authored personality flaw:

- **Hesitant approach:** start a JAB tell, pause 150–300 ms at 40 %, retreat 3–5 cm
  (`elbow_flex` +0.08) over 120 ms, pause, re-approach. Up to 3 retreats
  (hesitant: 5 pauses, 3 retreats of 0.05 m recognised by 34/55).
- **Confident approach:** one pause only, at the top of the tell, 100–200 ms (the
  study's single 1.67 s pause is far too long for combat; keep the *shape*, shrink
  the time), then commit at full acceleration.
- **Hover:** gripper oscillates ±2 cm toward/away from the target at 1.5 Hz for
  400–800 ms with the gaze flicking between the target and the player's gripper.
  Reads as "should I?"; it is also the AI's most punishable state and is meant to be.

### 4.6 Taunts (only when winning or after a whiff punish; never after eating a hit)

All taunts are 400–900 ms of free vulnerability by design (see `../ai-opponent.md`
§1.3). Choose by personality from a group, never the same one twice in a row:

- **Beckon:** gripper faces the player, `wrist_flex` curls −0.25 → +0.10 twice at
  2 Hz ("come on"), jaws snap open/closed in sync.
- **Chatter:** gripper jaws open/close 4–6 times at 6–8 Hz with `wrist_roll` ±0.1
  (a laugh). LED strobes at the same rate.
- **Shrug:** `shoulder_lift` −0.12 and `wrist_roll` ±0.4 held for 300 ms, then
  slow return. Paired with a caption from the host.
- **Slow re-guard:** after a clean hit, return to guard at 0.4× speed with the
  gaze held on the player's camera. This is the cheapest and most human taunt:
  it is contempt expressed as timing only.
- **Wave-off:** `shoulder_pan` +0.25 turn away, `wrist_flex` +0.2 (looking down),
  one dismissive wrist_roll flick, then turn back. BASALT only.

### 4.7 Celebration (round or match won)

- **Big:** `shoulder_lift` −0.5, `elbow_flex` −0.4 (full stretch upward, the
  "wall" shape for Happy), gripper open, `wrist_roll` alternating ±0.6 at 3 Hz for
  1.2 s ("fist pump"), then two quick `shoulder_pan` bows ±0.2 toward the player.
  Breathing ×2 for 5 s. LED at full, pulsing at the roll frequency.
- **Cool (BASALT):** single slow nod (`wrist_flex` +0.2 over 400 ms, back over
  600 ms), gripper closes once. Nothing else moves. Stillness in a busy moment is
  staging: it draws the eye.
- **Manic (KESTREL):** four 150 ms hops of `shoulder_lift` ±0.15 with the pan
  circling ±0.3, gripper chattering. Ends abruptly and snaps to guard: it wants
  the next round.

### 4.8 Dejection (round lost)

The "ball" shape from the Laban study and Luxo Jr.'s slow hop:

```
0–600 ms     sink: shoulder_lift +0.25, elbow_flex +0.30 (curl inward), wrist_flex
             +0.35 (gripper faces the deck), gripper closes, all with ease-in only
             (starts slow, "gives up"); LED dims to 25 % over the same window
600–2500 ms  hold, breathing at 0.6× rate but 1.5× amplitude (heavy sighs),
             one slow pan away from the player (−0.2 over 900 ms)
2500 ms+     one glance back at the player (considered look, 350 ms), hold 700 ms,
             then the round-start ritual pulls it back up
```

Personality: KESTREL skips the hold and does a "slam the forklift" (Cozmo): one
`shoulder_lift` +0.4 drop at full speed hitting the deck (audio contact), then the
sink. MAGPIE's dejection is short (1.2 s) and ends in a chatter (it laughs it off).
BASALT's is the longest and the stillest.

### 4.9 Curiosity toward the Core

Cozmo's rule: turn information gathering into character. When the AI's plan
involves the Core (grab, guard, contest), or every 12–25 s in a quiet stretch:

- Gaze to the Core (considered look), hold 400 ms, gripper opens 20 %.
- Approach with the *curious* descriptor set: two pauses, 20° (0.35 rad)
  horizontal gaze sweeps across the Core, low approach acceleration.
- "Sniff": gripper hovers 3–4 cm above the Core, jaws open/close twice slowly at
  1 Hz, `wrist_roll` ±0.3 (turning the head to inspect).
- Then either commit (GRAB) or a glance back at the player and retreat. If the
  player rushes during the sniff, that is the AI's fault and the flinch fires.

### 4.10 Fear and retreat (breaking point)

Halo's "flee in terror" state for a 1v1: when health < 25 % and composure < 0.3.
Fearful set: abrupt retreat at the full 2 m/s²-class acceleration (our servos
deliver this for free), `elbow_flex` +0.35, `shoulder_lift` +0.20 (pull back and
down), 6° shiver at 15 Hz decaying over 500 ms, stance −0.8, gripper closed, LED
flickering. The AI guards high and retreats to x ≈ 0.14 for 2–4 s (the L4D relax),
then either rallies (arousal spikes, valence flips to anger, KESTREL) or keeps
turtling (BASALT). Both are legible, both are exploitable, both are stories.

### 4.11 Round-start ritual (the first minute)

Pre-round, 2.5 s, both arms:

1. 0–600 ms: rise from the slouch to guard (arousal ramps 0.2 → 0.7).
2. 600–1400 ms: eye contact with the player's camera, hold; jaws open 10 %.
3. 1400–2000 ms: personality signature. KESTREL: three fast pan feints ±0.15.
   BASALT: one slow chin-up (`wrist_flex` −0.15) and a gripper clench. MAGPIE:
   a glance at the Core, then at the player, then a chatter.
4. 2000–2500 ms: settle into guard with breathing at the personality rate.

A host caption names the opponent and one thing it wants ("BASALT waits for you
to miss"). This is the F.E.A.R. rule applied to the first minute.

---

## 5. Temperament through servo dynamics

The physical PD is fixed (policies must verify on stock servos). Temperament is
built into a **target-shaping filter** between the motor layer and the servo:

```
q_target(t) = shape_p(q_primitive(t))
```

where `shape_p` is per personality:

| Parameter | Meaning | KESTREL | BASALT | MAGPIE |
|---|---|---|---|---|
| Overshoot `ov` | command past the goal by `ov` × travel, then return | 0.12 | 0.03 | 0.08 |
| Settle `τ_settle` | time constant of the return from overshoot | 70 ms | 140 ms | 90 ms |
| Ring `ζ` | damped-sine added at arrival, amplitude 0.3·ov, 6–9 Hz | ζ = 0.35 (visible ring) | ζ = 0.9 (dead) | ζ = 0.5 |
| Ease profile | in/out shape of the primitive | ease-out (snappy start) | ease-in-out (smooth) | asymmetric, random per primitive |
| Onset jitter | delay before the primitive starts | 0–30 ms | 40–90 ms | 0–120 ms |
| Amplitude jitter | per-primitive travel scale | ±8 % | ±3 % | ±12 % |
| Follow-through lag | `wrist_roll`/gripper lag | 40 ms | 80 ms | 60 ms |
| Overlap | next primitive starts at % of previous | 70 % | 85 % | 60–80 % |
| Breath | rate / amplitude | 0.6 Hz / small | 0.3 Hz / deep | 0.45 Hz / irregular |
| Gaze lag τ | tracking the player | 120 ms | 220 ms | 150 ms, with 15 % "wrong target" glances |
| Arousal gain | how fast `a` rises on events | 1.4 | 0.7 | 1.0 |
| Valence sign on being hit | anger vs caution | −0.2 (anger) | stance −0.4 (caution) | composure −0.3 |

Because overshoot and ring live in the *command*, the physical servo still saturates
and settles exactly as before; what changes is that KESTREL visibly over-reaches
and snaps back, BASALT arrives dead on, and MAGPIE's timing never quite repeats.
That is temperament in the sense the animation literature means it: the same verb,
different timing. All jitter is per-primitive, never per-tick (per-tick jitter
reads as servo buzz, `../ai-opponent.md` §1.3).

Rule of thumb from Saerbeck: if you want the player to *feel* the opponent get
angry, raise acceleration (ease-out, higher overshoot), not amplitude.

---

## 6. Layering and interruption (how it all fits in one body)

Alien: Isolation's job priorities, applied:

| Layer | Priority | Interruptible by | Blend in/out |
|---|---|---|---|
| Affect posture (§4.0) | background | nothing (it is an offset) | slow (τ 1.5–4 s) |
| Breathing + sway (§4.1) | background | attenuated to 0.3 during tells/strikes | 100 ms |
| Gaze (§4.2) | low | any primitive that needs the wrist | 80 ms |
| Social (taunt, celebrate, dejection, curiosity) | medium | any threat above 0.4 (it aborts and re-guards with a flinch-sized snap) | 120 ms |
| Combat primitive (tell → strike → return) | high | only by the flinch, and only in tell or return (a strike in flight completes) | 80–150 ms overlap |
| Flinch (§4.3) | interrupt | nothing | 0 ms in, 120 ms out |

Animation groups (Cozmo): each social behaviour is a group of 3–5 variants with
the same silhouette and different timing; selection is weighted by mood and
excludes the last two played. Cool-down per group: taunts 8 s, celebration once per
round, curiosity 12 s, hesitation 5 s.

---

## 7. Saying it out loud (F.E.A.R. for one opponent)

There is only one enemy, so the dialogue is between the opponent's body and the
hosts. Route these events from the decision layer to the caption system, each with
a cool-down so the hosts do not narrate every tick:

| Event | Body | Host line (original, flavour only) |
|---|---|---|
| plan = whiff punish, waiting | gaze on player's gripper, stance open, gripper half-closed, breathing slow | "BASALT is waiting for a miss." |
| feint bitten (player) | chatter taunt | "Sold it." |
| feint recognised (AI ignored it) | tiny wrist_roll flick, no move | "Didn't buy that one." |
| rattled (two hits in 3 s) | flinch + closed stance + high guard | "That one landed. It's covering up." |
| plan switched (novelty decay) | considered look at the new target, then a re-guard | "Changing the plan." |
| comeback trigger (health < 25 %, arousal high) | fear set → rally: valence flips, breathing ×2 | "It's hurt and it's angry." |
| memory recall (§8) | look at the thing it remembers (player's hook side) | "Guarding the side you slammed last time." |

Orkin's point about explaining *lack* of action matters here: when the AI is turtling
because its threat model is saturated, say so ("It won't come out") or it reads as
broken.

---

## 8. Memory across rounds (Nemesis, small)

Store per match, per opponent: the move that scored on it most, the side it was
hit from, the player's average time-to-first-attack, whether feints have worked on
it. Effects must be **visible and referenced**:

- Guard biases toward the side that hurt it (pan offset 0.08, `wrist_flex` up),
  with a caption at round start.
- Tell duration for the move that beat it last round shortens by 15 % (it
  "learned"), and the host says so once.
- If the player taunted (idle > 3 s at reach while ahead), the AI's opening
  aggression rises by 0.2 and it skips its eye-contact beat: a grudge.
- Persist a name, a colour and a record across sessions in local storage ("BASALT,
  3–1 against you, last beaten by the slam"). This is the reason to come back, and
  it is the data hook: a player who has a rival demonstrates more.

---

## 9. Pacing director for a 1v1

A menace gauge per exchange, updated at 10 Hz:

```
menace += 0.15 per AI strike attempt within reach
menace += 0.25 per hit on the player
menace −= 0.05 per 100 ms with no contact
```

- menace > 0.8: the AI is sent "backstage": it disengages for 1.5–3 s (retreat to
  x ≈ 0.16, breathe, glance at the Core, a considered look at the player). L4D's
  relax, compressed. Ends early if the player advances.
- menace < 0.2 for > 4 s and the player is passive: the AI probes (a POKE or a
  beckon), which is how the first minute becomes a conversation instead of a wait.
- The gauge also modulates the hosts: no lines above 0.7 (let the fight breathe),
  colour above 0.4, coaching below 0.2.

Alien: Isolation's rule applies: the director advises, it never moves the arm.
All motion stays inside the motion language so replays stay bit-exact.

---

## 10. Verification in the harness (this is testable)

1. **Recognition test.** Render 3 s clips of each behaviour (§4.3–4.10) at neutral
   personality and have five people label them from a list of eight. Target ≥ 60 %
   for flinch, celebration, dejection, taunt (the Anatomy paper hit 53–85 % with
   strangers and no context). Below 40 %: retime, do not add joints.
2. **Life metric.** In idle, Σ|Δq|/dt over the six joints must never drop below
   0.02 rad/s for more than 400 ms. A unit test on the replay stream.
3. **Anticipation metric.** For every strike event in a replay, there must be a
   gaze-on-target event 150–400 ms earlier (except POKE) and a tell pose above the
   per-primitive minimum. Fail the balance test if not.
4. **Flinch latency.** Every contact on the AI body above threshold has a
   commanded recoil within one physics tick. Assert in `opponent-behavior.test.mjs`.
5. **No per-tick jitter.** Action-jerk metric from `../ai-opponent.md` §8 stays
   under its bound with all layers on.
6. **Overlap.** Fraction of primitive boundaries with a full settle (velocity ~0 for
   > 100 ms) must be < 10 %.

---

## 11. Build order (smallest first, each one visible on its own)

1. Breathing + sway + micro-saccades (§4.1), affect posture offsets (§4.0). One
   file, additive, zero risk to combat. The arena stops being a fixture in an hour.
2. Flinch (§4.3). Hits start feeling like something.
3. Gaze layer (§4.2) including eyes-lead-the-strike.
4. Wind-up tells per primitive (§4.4) and the tell LED.
5. Target-shaping temperament filter (§5) with the three personality rows.
6. Round-start ritual, celebration, dejection (§4.7, 4.8, 4.11).
7. Taunt and curiosity groups (§4.6, 4.9), then hesitation (§4.5).
8. Event → caption routing (§7), menace pacing (§9), memory (§8).

Everything above is data plus one additive command layer. No physics changes, no
policy retraining, and every clip is replayable in the existing harness.

---

## Sources

- Lasseter, Principles of Traditional Animation Applied to 3D Computer Animation, SIGGRAPH 1987: https://history.siggraph.org/learning/principles-of-traditional-animation-applied-to-3d-computer-animation-by-lasseter/ , http://graphics.cs.cmu.edu/nsp/course/15-464/Fall05/papers/lasseter.pdf
- Lasseter, SIGGRAPH '94 course notes: https://education.siggraph.org/static/HyperGraph/animation/character_animation/principles/lasseter_s94.htm
- Luxo Jr.: https://en.wikipedia.org/wiki/Luxo_Jr. ; anticipation: https://en.wikipedia.org/wiki/Anticipation_(animation)
- Breazeal, Regulation and Entrainment in Human–Robot Interaction, IJRR 2002: https://interruptions.net/literature/Breazeal-IJRR02.pdf ; Kismet: https://en.wikipedia.org/wiki/Kismet_(robot)
- Saerbeck & Bartneck, Perception of Affect Elicited by Robot Motion, HRI 2010: https://www.bartneck.de/publications/2010/perceptionAffectElicitedRobotMotion/saerbeckBartneckHRI2010.pdf
- Laban Shape for expressive manipulator trajectories (2025): https://arxiv.org/html/2505.11716
- Anatomy of Uncertainty: expressive descriptors of manipulator motion (2026): https://arxiv.org/html/2607.13696
- Emotional expression in low-DOF robots, Reachy Mini (2026): https://arxiv.org/pdf/2605.12786
- Hoffman & Ju, Designing Robots with Movement in Mind, JHRI 2014: https://dl.acm.org/doi/pdf/10.5898/JHRI.3.1.Hoffman
- Anki Cozmo: https://en.wikipedia.org/wiki/Cozmo ; design process: https://www.designnews.com/testing-measurement/from-cozmo-to-vector-how-anki-designs-robots-with-emotional-intelligence ; animation tracks: https://pycozmo.readthedocs.io/en/stable/generated/pycozmo.anim_encoder.html ; Vector character study: https://randym32.github.io/Anki.Vector.Documentation/guides/Vector%20character%20study.html ; animators: https://medium.com/kickstarter/animating-the-future-meet-the-cartoonists-giving-life-to-ankis-adorable-robot-vector-1def073de502
- Butcher & Griesemer, The Illusion of Intelligence (Halo), GDC 2002: https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf ; Bungie retrospective: https://www.gamedeveloper.com/game-platforms/in-depth-bungie-on-eight-years-of-i-halo-i-ai
- Orkin, Combat Dialogue in FEAR: The Illusion of Communication, Game AI Pro 2: https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter02_Combat_Dialogue_in_FEAR_The_Illusion_of_Communication.pdf ; Three States and a Plan, GDC 2006: https://www.gdcvault.com/play/1013282/Three-States-and-a-Plan
- Alien: Isolation AI: https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation , https://www.aiandgames.com/p/revisiting-alien-isolation
- Left 4 Dead Director: https://left4dead.fandom.com/wiki/The_Director ; Booth GDC 2009 slides: https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf
- Shadow of Mordor Nemesis design: https://www.gamedeveloper.com/design/designing-i-shadow-of-mordor-i-s-nemesis-system ; GDC 2018: https://www.gdcvault.com/play/1025150/Helping-Players-Hate-(or-Love)
- Maj, Thoughts on Fighting Game AI: https://sonichurricane.com/?p=2452 ; SF6 CPU/V-Rival player reports: https://gamefaqs.gamespot.com/boards/358511-street-fighter-6/80420792?page=1
- Anatomy of an Enemy Attack in Dark Souls 3: https://www.gamedeveloper.com/game-platforms/anatomy-of-an-enemy-attack-in-dark-souls-3
- Punch-Out!! (Wii) tells: https://en.wikipedia.org/wiki/Punch-Out!!_(2009_video_game)
- Wallbott, Bodily Expression of Emotion, EJSP 1998: https://onlinelibrary.wiley.com/doi/abs/10.1002/(SICI)1099-0992(1998110)28:6%3C879::AID-EJSP901%3E3.0.CO;2-W
- Defensive/hesitant body language: https://www.skillsconverged.com/pages/body-language-of-defensive-attitude
- Reaction-time and Killer Instinct / FightingICE figures: see `../ai-opponent.md` §1.1 (sources there).
