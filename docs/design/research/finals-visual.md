# THE FINALS: visual identity research, and an original style guide for our robot duel

Track: visual identity. Written 2026-09-16 for the `fps-duel` branch.

This doc has two halves:

1. **Research.** What THE FINALS (Embark Studios, 2023) actually does visually, and why. Claims are cited.
2. **Translation.** An original style guide for our first-person SO-101 duel: tokens, fonts, shapes, motion, set dressing, and a three.js lighting recipe you can build from directly.

How sure each claim is:

- **[V]** means verified from the cited source.
- **[O]** means observed from gameplay footage and screenshots I remember, not re-checked against a source this session. Before copying any exact detail marked [O], compare it with the screenshot galleries at <https://interfaceingame.com/games/the-finals/> (it has HUD, pre-match, summary, loading, death-cam, and store screens).
- **[I]** means my own inference or design recommendation.

> **Legal line (repeat this in every design review).** We copy the *grammar*: bright daylight arenas, a broadcast framing, slanted condensed type, sticker badges, satisfying pristine-to-wrecked destruction. We never copy the *vocabulary*. That means no "THE FINALS" name, logo, or wordmark. No sponsor names (OSPUZE, ISEUL-T, HOLTOW, VAIIYA, ENGIMO, DISSUN, VOLPE, ALFA ACTA, MultiCo, IVADA, TRENTILA, COMETA). No announcer names (Scotty, June) or their lines, no "Nama Tama", no arena names, no ripped audio, textures, or screenshots, and none of their typefaces (Saira on the website, Dharma Gothic on posters). All of our names, marks, and palettes below are original.

---

## Part 1: Research

### 1.1 The framing: a virtual game show

- **[V]** The game is set in a fictional VR combat game show in the year 2100. It has holographic crowds and commentary from two hosts. Wikipedia lists *The Running Man*, *The Hunger Games*, and *Gladiator* as inspirations. <https://en.wikipedia.org/wiki/The_Finals>
- **[V]** Director Gustav Tilleby said the game-show frame exists to *license stylistic mixing*. Inside an entertainment show, a ballerina can fight next to a soldier or a cowboy. He wanted to escape a decade of military Battlefield visuals. <https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design>
- **[V]** The team works from three style and tone pillars, and they turn down features that break them (same source):
  1. **Appeal & Brutality.** Arenas start pristine and inviting, then get wrecked. Breaking something colorful feels better than breaking something already dirty.
  2. **Realism & Stylization.** Things are exaggerated but follow grounded logic, so nothing surprises the player mechanically.
  3. **Chaos & Control.** Destruction runs wild, but the visual design stays clean and uncluttered so the player can read the fight.
- **[V]** Their mascot stands for pillar 1: a cute character that gets crushed and always comes back happy. That is the promise that VR destruction has no consequences (same source).
- **[V]** The game is framed as a tournament. In Cashout, eight teams play two qualifying rounds of 3v3v3v3, and the top two teams from each go on. The final is 3v3, first team to $50,000. Money is the score: vault cash boxes are worth $10k, then $15k, then $22k, and each elimination pays $500. <https://www.thefinals.wiki/wiki/Cashout>
- **[V]** "Game show events" start midway through a round and last 2 minutes. Examples are meteor showers, low gravity, mega damage, orbital lasers, alien invasions, and "the dead go boom". They are disabled in ranked. <https://www.thefinals.wiki/wiki/Game_Show_Events>
- **[V]** There is a separate Announcer who delivers larger-than-life commentary at match start, after team wipes, and during streaks. Some arenas use announcers in the local language. <https://www.thefinals.wiki/wiki/The_Announcer>. The two host commentators play different parts: an ex-contestant and a data analyst. <https://www.thefinals.wiki/wiki/Scotty_and_June>
- **[V]** Critics called the text-to-speech host voices flat and repetitive. <https://gameinformer.com/review/the-finals/appetite-for-destruction>. Embark has spoken about using AI in production. <https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals>. **Lesson [I]:** the *broadcast framing* is what lands. Repetitive voiced chatter hurts it. Lean on graphics and SFX, and keep any voice lines rare and short.

**Why it works [I]:** the frame makes every piece of UI *diegetic to a TV broadcast*. Scoreboards, lower thirds, sponsor bugs, and replay stingers all feel like they belong. That is the license we want: two robot arms fighting on a tabletop become a televised sport, and the HUD becomes the TV package.

### 1.2 Sponsors and corporate satire

- **[V]** Fictional megacorps sponsor "the show itself, Seasons, contestants, Cosmetics, Arenas". Players sign with a sponsor each season to earn fans and cosmetics. Arena brands show up on storefronts and billboards: a soda, a casino, a skate brand, sunglasses, a racing brand. <https://www.thefinals.wiki/wiki/Sponsors>, <https://www.thefinals.wiki/wiki/Sponsorships>
- **[V]** The sponsors have satirical personalities: an insurance giant, a Korean fashion house, the most popular beverage brand, and a cybersecurity firm run by an AI CEO. <https://the-finals.fandom.com/wiki/Sponsors>
- **[V]** One arena is split into districts, each owned by a sponsor, and its architecture follows each brand. <https://www.thefinals.wiki/wiki/Arenas>
- **[O]** Each sponsor mark is a flat, 1–2 color wordmark or monogram, usually all caps, often with a simple geometric glyph. Each brand owns one strong color, and together they read like motorsport livery.
- **[I] Takeaway:** a sponsor is a *color plus a shape plus a joke*. Two or three of them are enough to dress a whole stage when they repeat as decals, banners, and presenter credits.

### 1.3 Arenas, stage dressing, and lighting

- **[V]** The launch arenas were Monaco, Seoul, Las Vegas, and Skyway Stadium. Later came Bernal, Kyoto, Fortune Stadium, and SYS$HORIZON, which is a "glitchy, neon-filled cityscape" made of voxel blocks with a horizon that is still "loading". Arenas have time-of-day and weather variants. <https://www.thefinals.wiki/wiki/Arenas>, <https://liquipedia.net/thefinals/Portal:Arenas>
- **[V]** Reviewers praised arenas that were "gorgeously lit, fully destructible" and noted variants such as sandstorms reshaping Vegas. <https://gameinformer.com/review/the-finals/appetite-for-destruction>. Other reviewers called the game very bright and colorful, with a game-show style, a rowdy crowd, and excited announcers. <https://www.gamespot.com/reviews/the-finals-review-an-explosive-game-show/1900-6418164/>
- **[V]** Lighting is dynamic global illumination (NVIDIA RTXGI). Light bounces and updates as walls open up, and it interacts with volumetric fog and smoke. <https://www.nvidia.com/en-us/geforce/news/the-finals-released-reflex-dlss-3-ray-tracing-geforce-rtx/>
- **[O]** The base look is **clean, bright daylight**. It uses a high sun, a soft sky fill, and warm bounce light, with little haze. Color comes from *objects*, not from colored lights: bright facades, signage, cars, and team outfits. Neon and emissive light only takes over in night variants and in the "virtual" arenas.
- **[O]** Stadium-style arenas bring back the TV-studio vocabulary: big video walls, truss rigs, sponsor banners, and holographic crowd stands. Objectives such as vaults and cashout stations are **chunky, glowing, over-designed props** that you can see from far away.
- **[I]** For us, daylight is the base, emissive LEDs are the accent, and nothing muddy, dim, or grungy stays on screen until the fight *causes* it.

### 1.4 Materials

- **[O]** The materials are grounded PBR, not cel-shaded: painted metal, glazed tile, plastic, concrete, glass. Textures are clean with low grunge and high albedo. The stylization lives in *form and color* (fat bevels, oversized props, brand graphics), not in the shading.
- **[O]** Objective props use glossy car-paint plastics, polished chrome, and strong emissive seams. Cosmetics mix streetwear fabrics with sports kit and costume pieces.
- **[V]** The official site (reachthefinals.com, read 2026-09-16) draws "metallic" UI panels as CSS gradients. One panel uses four corner colors (`#B9B2AD` TL, `#112029` TR, `#EEF1F6` BL, `#6D6F7B` BR). Another uses "slanted reflective lines" at 172° with stops in `#0D1118`, `#C6D2E5`, `#F4A642`, `#DA7817`, and `#98300B` (fake chrome and gold foil). So chrome and foil sheen is part of the current brand language.

### 1.5 Destruction and debris

- **[V]** Destruction is server-side and synced for everyone, and whole buildings can collapse. <https://www.nvidia.com/en-us/geforce/news/the-finals-geforce-game-ready-driver/>, <https://en.wikipedia.org/wiki/The_Finals>
- **[V]** Assets are pre-fractured in Houdini, with the seams hidden until damage shows them. Fracturing in real time was too costly and too unpredictable for a fast multiplayer game. <https://80.lv/articles/how-embark-studios-built-procedural-environments-for-the-finals-using-houdini>
- **[O]** What destruction looks like: chunks are *big and readable* (tens of centimetres to metres), not fine powder. A short, bright dust puff reads mostly white or grey against daylight. Interiors show plaster and rebar colors. Chunks tumble with real physics and settle. Smoke is dense and volumetric, and it lingers from explosives and smoke gadgets.
- **[I]** The satisfaction comes from **contrast** (clean then broken), **mass** (big pieces with weight), and **persistence** (the damage stays for the rest of the round).

### 1.6 VFX

- **[O]** Explosions have a hot white-yellow core, a short orange fireball, a quick shockwave ring, and a dark smoke column. Sparks are thin additive streaks with gravity.
- **[V]** When a contestant is eliminated, a **revive statue** stays behind. Allies can carry it and hold interact on it. A skull icon above it fills up to show the respawn timer. Revival makes a hologram that re-materializes in place. <https://www.thefinals.wiki/wiki/Revive_Statue>
- **[O]** Death and respawn effects borrow from the VR frame: a digital de-rez or re-materialize with glitchy, pixelated edges. SYS$HORIZON turns this into a whole art direction.
- **[V/O]** Money is physical. Players carry cash boxes and throw them into stations. In Bank It, coins drop from eliminated players ([V] <https://www.thefinals.wiki/wiki/Coin_(Bank_It)>). **[O]** Cashing out and picking up coins give golden particle bursts with a fast count-up number on the HUD.

### 1.7 UI and HUD

**Typography.**
- **[V]** The official website loads **Saira Condensed** (500) and **Saira Extra Condensed** (400), plus Poppins for body text. It uses `font-style: italic` in several places. Read from the reachthefinals.com source on 2026-09-16.
- **[V, third-party, low confidence]** A font-identification site credits the poster type to **Dharma Gothic**, a heavy condensed grotesque. <https://fontsbird.com/the-finals-font/>
- **[O]** In-game type is **all caps, heavy, condensed, often italic or slanted**. Numbers are tall and tight. Labels are small caps-height text with wide tracking. There is almost no sentence-case prose during a match.

**Color in UI.**
- **[V]** The official key art is mostly signal red on near-black. Squarespace's image color averages give top-left `#D21F3C` and top-right `#11111A`, with center `#6F1627` and suggested background `#852538`. The selection outline on the site is `#F7BB2B` (gold). The dark base is `#0D1118`.
- **[V]** In a match, *your team is always blue*. Enemy teams get distinct colors (pink, salmon, purple, orange...), and players complain those look too similar. There is an option to make all enemies red. <https://steamcommunity.com/app/2073850/discussions/0/6026443283691066949/>
- **[I] Lesson:** one team color per side, with very different hues and luminance. We only have two sides, so that problem goes away.

**HUD layout [O]** (compare with interfaceingame before copying proportions):
- The center is kept nearly empty: a small crosshair, hitmarkers, and damage numbers.
- **Top center:** the broadcast strip. It shows team cash totals as colored chips, the round timer, and objective state (vault or station letters with progress rings).
- **Top right:** the kill feed. Each entry is a compact slanted row with a team-colored name, a weapon glyph, and the victim.
- **Bottom left:** a health bar with a number, plus contestant identity. **Bottom right:** weapon name, ammo count in big condensed numerals, and gadget slots with cooldowns.
- **Objective markers** are diamond or hex world-space icons with letters and distance. They clamp to the screen edge when off-screen.
- **Revive and teammate state** use skull and timer icons over statues ([V] above).

**Hit feedback.**
- **[V]** Hits show a crosshair-style marker and floating damage numbers over the target. The headshot color is a user setting shared by marker and numbers. Headshot multipliers vary by weapon. Steam guide: <https://steamcommunity.com/sharedfiles/filedetails/?id=3421108552>
- **[O]** Normal hits are white, crits use a second color, and eliminations get a distinct, heavier marker and a sound. Damage numbers pop, drift, and fade quickly. They never linger.

**Broadcast graphics, menus, and loading [O].**
- Panels are slanted parallelograms and angled cuts. Nameplates look like sports lower thirds.
- There are hazard or diagonal stripes, halftone dot fields and dithered gradients, and sticker-style badges (tilted, thick outline, hard drop shadow) for fan counts, ranks, and "NEW" labels.
- Stencil-like numerals and big season numbers fill whole panels.
- **Pre-match and intros** show the teams as a lineup of contestant cards with team name and color, like TV player introductions.
- **Summary and end-of-round** screens are big title cards with a team placement ("WINNER"-style), stat tiles, and cash earned counting up.
- **Menus** are full-bleed character renders on a clean studio background, big condensed tabs across the top, and chunky slanted buttons with the selected state in a signal color.
- **Loading** screens use full-bleed key art or arena art with small condensed metadata and a thin progress indicator.
- **[V]** There is a dedicated **pre-match** screen category, plus **summary**, **death camera**, **progression**, and **league** screens. <https://interfaceingame.com/games/the-finals/>

### 1.8 Distilled principles (what to take)

1. **The frame explains the UI.** Every overlay is a piece of TV graphics.
2. **Pristine, then wrecked.** Start bright and clean so damage reads and feels good.
3. **Daylight is the base, color comes from objects, emissives are accents.**
4. **Type is loud, but there is very little of it.** Condensed, heavy, italic, all caps, big numbers, tiny labels.
5. **Slants and stickers, not rounded cards.** No soft glassmorphism, no pastel dashboards.
6. **Hit feedback is fast.** It pops and is gone in under a second.
7. **Chaos in the world, control in the HUD.** The HUD stays calm and anchored while the scene goes wild.

---

## Part 2: Original style guide for our robot duel

### 2.1 The show and its brands (original IP)

**Show name: `TORQUE LIMIT`**
- Tagline: *"Live from the benchtop."* The name is a nod to the real 2.94 N·m servo ceiling that every contestant fights against.
- Wordmark [I]: `TORQUE` in heavy condensed italic and `LIMIT` in outline stroke, sitting on a Signal-orange parallelogram. A small gauge-needle glyph at −12° replaces the dot on the "i".
- In-universe premise: a streamed pro league for desktop robot arms. Human pilots face AI contestants, and anyone can register their own AI.
  - **Registering a policy** is the "contestant sign-up".
  - **Verifying it** earns a `CLEARED FOR BROADCAST` sticker.
  - This keeps the policy-verification harness *inside* the fiction.
- Mascot [I]: **"Bit"**, a smiling 4 cm foam cube (same size as our physics cubes). It sits on the loading screen and gets knocked around in the intro sting. It follows the "crushed but always fine" idea without copying any design.

**Sponsor 1: `OHMSTEAD`** (industrial power and insurance megacorp)
- Line: *"Rated for every Newton."* It sponsors the **integrity bar** ("Integrity by OHMSTEAD") and the round-start card.
- Mark: an Ω-like arch built from two stacked chevrons, next to an extra-bold condensed wordmark.
- Colors: Ink `#0E0F14` on Volt `#FFD60A`, with hazard-stripe accents.

**Sponsor 2: `PULPO POP`** (soda with an eight-armed octopus mascot, a joke on robot arms)
- Line: *"Eight arms. Zero chill."* It sponsors **replays and KO stingers** ("Knockout brought to you by PULPO POP").
- Mark: a round bubble logo with a cartoon octopus, in lowercase rounded-heavy lettering. It deliberately *contrasts* with the harsh show type, the way real sponsor marks do.
- Colors: Pop Magenta `#FF3D8B` and Fizz Cyan `#3DE0FF` on white.

Run a quick trademark search on both names before shipping. They are fictional, but check anyway.

### 2.2 Palette tokens

Built for two sides that look nothing alike and a bright daylight stage. The hues deliberately step away from THE FINALS' red `#D21F3C` and gold `#F7BB2B`. Our brand color leans orange and our highlight is a greener yellow.

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#0E0F14` | Panel base, text on light, outlines, sticker shadows |
| `--ink-700` | `#1C1F29` | Raised panel, HUD plate fill (at 88% alpha) |
| `--ink-500` | `#3A3F4D` | Dividers, inactive pips |
| `--paper-50` | `#F6F3EC` | Text on dark, light panels, menus background |
| `--paper-200` | `#E6E0D3` | Secondary light surface, stage deck base |
| `--concrete-400` | `#B9B4AA` | Stage floor off-deck, neutral props |
| `--chrome-100` | `#E9EEF4` | Metallic highlight stop |
| `--chrome-500` | `#8B95A3` | Metallic mid stop |
| `--signal-500` | `#FF4A1C` | **Show brand color**: TORQUE LIMIT plates, primary buttons, selected tabs |
| `--signal-700` | `#C2300B` | Pressed and hover-deep, stripe shade |
| `--volt-400` | `#FFD60A` | Highlight, prize cubes, score count-ups, "new" stickers (use ink text on it) |
| `--p1-500` | `#2A6BFF` | **Human pilot** (cobalt): nameplate, rim light, LED strips |
| `--p1-300` | `#8DB4FF` | P1 glow and hologram tint |
| `--ai-500` | `#FF2E7E` | **AI contestant** (hot magenta): nameplate, rim light, LED strips |
| `--ai-300` | `#FF9CC3` | AI glow and hologram tint |
| `--strike-400` | `#FFF36B` | Strike hitmarker and damage numbers (hot yellow-white) |
| `--crit-400` | `#B6FF2E` | Critical strike (high-speed impact) marker and numbers |
| `--block-400` | `#3DE0FF` | Blocked contact: shield ripple, "BLOCK" tag |
| `--danger-500` | `#FF1F3D` | Low integrity pulse, KO flash (short bursts only) |
| `--ok-400` | `#39F2A0` | "Policy verified", "cleared" states in menus |

Rules [I]:
- **Contrast.** Use `--ink-900` text on volt, strike, crit, and block colors (all ≥ 10:1). Use `--paper-50` text on signal, p1, and ai colors, only at ≥ 18px bold. Never put magenta next to signal orange without an ink separator; they vibrate.
- **Color budget per frame.** A neutral base (ink or paper) plus **one** side color per half of the screen plus **one** accent (volt or signal). Hit colors only appear for less than 700 ms.
- **Team colors only mean teams.** Never use cobalt or magenta for anything else, such as buttons or warnings.
- **Colorblind mode.** Keep hue *and* luminance different (p1 is darker, ai is lighter). The optional alt pair is `#2A6BFF` against `#FF9F1C` (orange). Always add a shape cue: P1 plates are cut on the left, AI plates on the right.

CSS:

```css
:root {
  --ink-900:#0E0F14; --ink-700:#1C1F29; --ink-500:#3A3F4D;
  --paper-50:#F6F3EC; --paper-200:#E6E0D3; --concrete-400:#B9B4AA;
  --chrome-100:#E9EEF4; --chrome-500:#8B95A3;
  --signal-500:#FF4A1C; --signal-700:#C2300B; --volt-400:#FFD60A;
  --p1-500:#2A6BFF; --p1-300:#8DB4FF; --ai-500:#FF2E7E; --ai-300:#FF9CC3;
  --strike-400:#FFF36B; --crit-400:#B6FF2E; --block-400:#3DE0FF;
  --danger-500:#FF1F3D; --ok-400:#39F2A0;
}
```

Wire these into Tailwind 4 with `@theme { --color-signal-500: … }` so `bg-signal-500` and similar classes exist.

### 2.3 Typography (Google Fonts, free)

| Role | Family (exact) | Weights and styles | Notes |
|---|---|---|---|
| **Display**: title cards, "KNOCKOUT", round numbers, the wordmark | **Anton** | 400 (the only weight; it is already ultra-heavy) | Anton has no italic. Slant it with `transform: skewX(-10deg)` on the container, not synthetic italic. Line height 0.86, tracking −0.01em. |
| **HUD and UI**: nameplates, feed, labels, buttons, big numerals | **Barlow Condensed** | 500, 700, 800, 900, plus *italic* 700/800/900 | Real italics. Use `font-variant-numeric: tabular-nums` on timers and counters. Labels are 600, tracking +0.08em, all caps. |
| **Telemetry and harness data**: policy name, Hz, joint angles, forces | **Chivo Mono** | 400, 700 | Use it sparingly. It marks "machine truth" (policy output, physics numbers), which is the harness side of the fiction. |

Load them with `next/font/google` (`Anton`, `Barlow_Condensed`, `Chivo_Mono`) so they are self-hosted at build time. There is no runtime CDN, and it works offline. **Do not use Saira or Saira Extra Condensed** (the reference's web fonts) or Dharma Gothic lookalikes.

Type scale for HUD (1080p reference; scale with `clamp()` and `vh`):

| Token | Size | Family and weight |
|---|---|---|
| `display-xl` | 160px | Anton |
| `display-l` | 96px | Anton |
| `num-xl` | 64px | Barlow Condensed 900 italic (integrity %, timer) |
| `num-m` | 36px | Barlow Condensed 800 italic (damage numbers) |
| `plate` | 28px | Barlow Condensed 800 italic, all caps (names) |
| `label` | 13px | Barlow Condensed 600, all caps, +0.1em |
| `mono` | 12px | Chivo Mono 400 |

### 2.4 Shapes: panels, cuts, stickers, stripes

A single slant angle holds the whole system together: **12°**. The horizontal offset is `h × tan(12°) ≈ 0.2126 h`.

```css
/* Slanted plate (parallelogram). --h is the plate height. */
.plate { --cut: calc(var(--h, 44px) * 0.2126);
  clip-path: polygon(var(--cut) 0, 100% 0, calc(100% - var(--cut)) 100%, 0 100%); }

/* P1 nameplate: square on the right, cut on the left (points toward center). */
.plate-p1 { clip-path: polygon(var(--cut) 0, 100% 0, 100% 100%, 0 100%); }
/* AI nameplate: mirrored. */
.plate-ai { clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% 100%, 0 100%); }

/* Notched tag: one clipped corner, used for feed rows and chips. */
.tag { clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%); }

/* Sticker badge. */
.sticker { transform: rotate(-4deg); background: var(--volt-400); color: var(--ink-900);
  border: 3px solid var(--paper-50); box-shadow: 4px 4px 0 var(--ink-900);
  font: 800 italic 14px/1 "Barlow Condensed"; text-transform: uppercase; padding: 4px 10px; }

/* Hazard stripe band. */
.stripes { background: repeating-linear-gradient(-45deg,
  var(--volt-400) 0 10px, var(--ink-900) 10px 20px); }

/* Halftone field (use at 8–15% opacity inside panels, or as a fade mask). */
.halftone { background-image: radial-gradient(var(--ink-900) 1.2px, transparent 1.4px);
  background-size: 6px 6px; }

/* Foil sheen for "premium" plates (winner card, verified badge). */
.foil { background: linear-gradient(168deg, var(--chrome-500) 0%, var(--chrome-100) 22%,
  var(--chrome-500) 38%, var(--volt-400) 52%, var(--chrome-100) 64%, var(--chrome-500) 100%); }
```

Composition rules [I]:
- **Layering.** A plate is built from a 4px signal or side-color *lip* on its leading edge, an ink body, then paper text. The layers are offset by 3–4px along the slant, like printed stickers misregistered.
- **Stencil numerals.** Round numbers and the timer can use a 2px ink "bridge" cut (a CSS mask with a horizontal bar) to read like spray stencil. Use it on display sizes only.
- **Corner radius is 0 everywhere.** The only round thing is the PULPO POP logo.
- **Nothing floats without an anchor.** Every HUD cluster sits flush to a screen-safe edge (4% inset) with a stripe or lip touching that edge.

### 2.5 HUD layout for the first-person duel

The screen is 16:9 with a 4% safe inset.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [P1 plate ▰▰▰ integrity] [●●○ rounds] [ 1:24 volt box ] [○●● rounds] [AI plate ▰▰▰] │  top-center tote
│                                                     POLICY blaze_v3.js · 50Hz ▸│  AI feed chip (mono)
│                                                              ┌ feed ───────────┐│
│                                                              │ ATLAS ▸STRIKE 14N││ top-right event feed
│                                                              │ BLAZE ▸BLOCK     ││
│                             ·  ╳  ·                          └─────────────────┘│ center: dot + 4 ticks
│                         +23 (in-world numbers)                                │
│ ┌ INTEGRITY by OHMSTEAD ┐                                ┌ GRIP ● OPEN ───────┐ │
│ │ 72  ▰▰▰▰▰▰▰▱▱▱       │                                │ LUNGE  ▰▰▰▱  GUARD │ │ bottom-right: grip, moves,
│ │ [arm silhouette: 6 joint pips, hit joints flash]      │ SERVO HEAT ▰▰▱▱▱   │ │ servo heat / torque use
│ └───────────────────────┘                                └────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Top-center tote board** is the only always-on broadcast strip. Integrity sits on the nameplates so both fighters' health is in one glance, like a fighting game. The **policy chip** under the AI plate shows the file name, hash prefix, and control rate in Chivo Mono. That is the harness showing through the show.
- **Event feed** (the kill-feed equivalent) lists STRIKE, BLOCK, CUBE SCORED, KO, and POLICY FAULT (NaN or timeout). Each row is a notched ink tag with a 4px side-color lip, with the force in mono. There are at most 4 rows.
- **Integrity panel (bottom-left)** has a big italic number, a 10-segment bar, and an **SO-101 silhouette with 6 joint pips**. A joint that just took a strike flashes `--strike-400` for 300 ms. This teaches players where contact happens.
- **Bottom-right panel** shows gripper state, move cooldowns, and **servo heat**: a live torque-saturation meter drawn from actuator force against the 2.94 N·m limit. It turns the real servo constraint into a readable stamina bar.
- **Objective markers** go over the cubes, if cubes are the prize. They are diamond icons, volt when neutral and side-colored when controlled, clamped to the screen edge with an arrow when off-screen, at 60% opacity when nearer than 0.1 m so they don't block the fight.
- **Crosshair** is a 4px dot plus four 6px ticks with a 1px ink outline. It never changes color except in hit states.
- **Performance rule [I]:** anything that changes at 60 Hz (bars, heat, timer) updates through refs or CSS variables (`el.style.setProperty('--v', x)`), not React state. React renders structure only.

### 2.6 Hit feedback spec (fast, never lingering)

| Event (from our physics classifier) | Marker | Number | Screen / world | Sound cue (original) |
|---|---|---|---|---|
| **Strike** | `╳` 4 strokes, `--strike-400`, 1px ink outline, 22px | Damage in `num-m`, strike color | 20–40 spark streaks at the contact point, 2px screen shake for 90 ms | Short metallic *tink* plus low thump |
| **Crit strike** (contact speed above the threshold) | `╳` 28px, `--crit-400`, plus 4 outward ticks | `num-m` ×1.25, crit color, a "!" suffix | Sparks ×2, 40 ms hit-stop (render-only, never physics), chromatic aberration 0.002 decaying over 150 ms | Brighter *clank* plus a sub-bass drop |
| **Block** | Hex outline, `--block-400` | None, just a small "BLOCK" tag | Cyan hex-shield ripple (a ring decal on the contact normal), dull sparks | Dampened *thock* |
| **KO** | Big `╳` in `--danger-500`, 48px, rotates 8° | None | Full KO card (2.8), rival arm de-rez, volt confetti and cube burst | Stinger plus crowd swell |

Damage number behavior:
- Pop from scale 1.4 to 1.0 in 80 ms, then rise 28px over 600 ms with ease-out, then fade out over the last 200 ms.
- Horizontal jitter is ±10px.
- **Combo stacking:** a second hit within 400 ms *adds* to the existing number and re-pops it at scale 1.2 instead of spawning a new one.

### 2.7 Motion rules for UI

Global easing tokens:

```css
--ease-slam:    cubic-bezier(.2, 1.5, .35, 1);   /* overshoot in */
--ease-snap:    cubic-bezier(.3, 0, 0, 1);       /* quick settle */
--ease-exit:    cubic-bezier(.6, 0, .9, .4);     /* accelerate out */
```

| Motion | Keyframes | Total |
|---|---|---|
| **Slam-in** (title words, stickers) | 0 ms: scale 1.8, opacity 0, skewX −20° → 90 ms: scale 0.94, opacity 1, skewX −10° → 160 ms: 1.03 → 240 ms: 1.0 | 240 ms |
| **Plate slide** (nameplates, feed rows) | translateX ±48px to −4px (overshoot) over 140 ms `--ease-slam`, then to 0 by 200 ms | 200 ms |
| **Sticker stamp** | rotate −12° to −4°, scale 1.3 to 1 over 160 ms `--ease-slam`, plus a 2px shake of the parent over 80 ms | 160 ms |
| **Number count-up** | Tabular digits roll over 350 ms `--ease-snap`, then a final pop to scale 1.15 and back over 120 ms | 470 ms |
| **Exit** | translateX +40px, opacity 0, 140 ms `--ease-exit` | 140 ms |
| **Stagger** | Siblings enter 40 ms apart, capped at 6 | |
| **Feed row life** | enter 200 ms, hold 4500 ms, collapse height over 160 ms | |
| **Low integrity (< 25%)** | Integrity plate lip pulses `--danger-500`, 0.6 to 1 opacity, period 700 ms. No full-screen red vignette beyond 12% opacity. | |

Rules [I]:
- **Animate `transform` and `opacity` only**, plus `clip-path` for wipes on one element at a time.
- **Diagonal wipes.** Every full-screen transition is a 12° diagonal wipe: an ink panel with a signal lip, 220 ms in, 180 ms out.
- **Nothing in the HUD eases longer than 500 ms** except count-ups on summary screens.
- **Reduced motion** (`prefers-reduced-motion`): replace slams with 120 ms fades, and remove shake, hit-stop, and chromatic aberration.
- **UI and audio sync.** A slam's 90 ms impact frame lines up with the SFX transient. Schedule the sound at the animation's start plus 90 ms.

### 2.8 Title cards: intro, round, outro

**Match intro (about 3.2 s, skippable after 1 s)**
1. **0 ms.** The screen splits on a 12° diagonal: the cobalt half slides in from the left and the magenta half from the right (200 ms, `--ease-slam`). A halftone gradient fades toward the seam.
2. **180 ms.** Nameplates slam in. On the pilot's side: pilot name. On the AI side: the policy name in Anton, with the policy chip in Chivo Mono under it (`blaze_v3.js · sha 9f2c1a · 50 Hz`).
3. **420 ms.** A "VS" sticker stamps onto the seam: volt, rotated −4°.
4. **700 ms.** Sponsor ribbon: `PRESENTED BY OHMSTEAD` in a stripe band along the bottom.
5. **2600 ms.** Diagonal wipe out to the first-person view.

**Round start.** "ROUND 2" slams in, then `3 · 2 · 1` at 800 ms beats (each is a slam-in plus a small tick SFX), then **"ENGAGE"** in signal orange with a 6px shake for 120 ms. Servo control unlocks on that frame.

**Knockout.** `KNOCKOUT` in Anton, 160px, slams in with foil fill. A PULPO POP bug sits in the corner. Replay starts within 600 ms. Replays use slow motion, a real replay of the recorded MuJoCo state, a letterbox, and a `REPLAY` sticker.

**Match end.** The `WINNER` card uses the winning side color, then stat stickers stamp in one by one at 120 ms each:
- strikes landed
- max impact force (N)
- blocks
- cubes scored
- average servo heat
- **for AI:** policy faults and mean inference ms

The last sticker is `CLEARED FOR BROADCAST` (`--ok-400`) or `POLICY FAULT` (`--danger-500`). The duel doubles as a verification report.

### 2.9 Menus and loading

- **Main menu.** Paper-50 studio background with a large 3D SO-101 render (our actual model, lit with the stage recipe) on the left two-thirds. Heavy condensed tabs run along the top: `DUEL · CONTESTANTS · REPLAYS · SETTINGS`. The primary button is a signal plate at 64px tall; hover pushes it 6px along the slant and reveals a volt lip.
- **Contestants** (the policy loader): each loaded policy is a trading-card-style panel with a name, author, obs/action spec, control rate, and last result. Drop a JS/JSON file on the "REGISTER CONTESTANT" slot, a dashed volt stripe border. Sanity checks animate as a checklist, then stamp `CLEARED FOR BROADCAST`.
- **Loading** (the MuJoCo WASM boot): a full-bleed diagonal stripe field (ink and ink-700 at 12°) scrolls slowly at 20 px/s. The show wordmark sits center. Bit gets tossed across a progress bar made of 10 cube segments. There are rotating one-line tips in Barlow Condensed 600 and a mono status line (`compiling arena.xml · 2 contestants · 9 cubes`).

### 2.10 Arena set dressing: a robot game-show stage around the tabletop

Scale matters. Our world is small: mounts are 0.64 m apart, cubes are 4 cm, the floor plane is 2.4 m. A first-person camera near an arm's wrist sees everything at *miniature scale*. So we build a **tabletop TV studio at 1:1 robot scale** with a real-world set in soft focus behind it.

**Inside the physics floor.** These are visual only, unless noted. Don't add colliders that change the fight without a physics review.
1. **The deck.** A 1.10 × 0.70 m raised plate, 18 mm tall, with a 3 mm bevel and paper-200 glossy clearcoat (`roughness 0.35`, `clearcoat 0.6`). It needs a physics counterpart only if its surface height changes, so keep the collision plane at z=0 and model the deck as a flush inlay.
2. **Deck graphics** (decal textures authored as SVG and baked into a canvas texture):
   - the TORQUE LIMIT wordmark at center, huge and rotated 90° so it reads from both corners
   - a 12° hazard stripe border
   - side half-zones tinted cobalt and magenta at 18%, matching the existing `atlas_zone` and `blaze_zone` sites
   - small OHMSTEAD logos on the corners
3. **LED edge strips** along the deck bevel in each side's color: emissive intensity 3.0, `toneMapped:false` so they bloom. They **flash white for 120 ms** on a strike to that side, and pulse during a KO.
4. **Corner pylons.** Four 12 cm hex posts, each with a light head (emissive volt) and a small fan of **confetti cannons** that fire on KO: instanced paper quads in volt, signal, and paper colors, visual only.
5. **Prize cubes.** The 9 cubes get a volt car-paint material with thin ink edge seams and a tiny embossed Bit face on one side. When a cube is scored, its seams go emissive for 300 ms.

**Around the table (soft-focus background, 0.8–4 m):**
6. **Overhead truss rig.** A square truss 1.4 m above the deck with 8 par-can meshes (their emissive lenses match the real spot lights in 2.11) and a hanging **jumbotron cluster**: four LED screens showing the tote board and replays, rendered as a render-target texture.
7. **Hologram crowd stands.** Two tiered bleachers 1.5–3 m out. Figures are **instanced billboards** (about 400) with a hologram shader: a 1-bit dither of silhouettes tinted `--p1-300` or `--ai-300` by side, scanline scroll, and random flicker. On a strike, the near rows "jump" (vertex offset 2 cm for 250 ms). Cheap, readable, and in keeping with a digital crowd without copying any asset.
8. **Sponsor boards.** Slanted 12° LED boards ringing the stage floor, with a scrolling texture of the TORQUE LIMIT, OHMSTEAD, and PULPO POP marks. They take over with a single color flood during stingers.
9. **Studio props.** A tiny camera crane that slowly tracks, a presenter desk with two empty chairs (no presenter characters), cable ramps with stripe tape, and road cases with stencil numerals.
10. **Backdrop.** A bright daylight **sky cyclorama**: a gradient `#CFE3F7` to `#F6F3EC` at the horizon, plus a big soft "window" light form. No night by default. An optional "prime time" variant swaps to ink and emissives.

**Pristine to wrecked [I].** Every contact leaves a trace for the rest of the round:
- **Strike** leaves a scuff decal on the deck or arm shell (a small dark smear with metal-bright center, pooled at 64).
- **Cubes** stay where physics throws them.
- **Hard strikes** knock banner flags to hang crooked (spring animation) and fire a 3–5 chunk **foam-debris** burst: visual-only rigid quads that settle within 1 s.
- **KO** shatters the loser's deck-side light panel into big emissive shards.

**Round reset** is a *show moment*: a fast 400 ms "re-render" wipe (a voxel-scan line sweeps across) restores everything to pristine. This echoes the VR frame in our own way.

### 2.11 Lighting recipe (three.js 0.185 / R3F 9)

Target look: **bright studio daylight, saturated object colors, tight glints on chrome, bloom only on emissives.**

**Renderer**

```tsx
<Canvas
  shadows={{ type: THREE.PCFSoftShadowMap }}
  dpr={[1, 1.5]}
  gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
  onCreated={({ gl }) => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.NoToneMapping; // tone map in the post chain (below)
  }}
  camera={{ fov: 78, near: 0.005, far: 30 }} // FP: wide FOV, tiny near plane at robot scale
/>
```

If you run *without* post-processing, set `gl.toneMapping = THREE.NeutralToneMapping` (Khronos PBR Neutral) and `toneMappingExposure = 1.05`. Neutral keeps brand hues and saturation much better than ACES, which desaturates and shifts bright oranges and magentas. Use `AgXToneMapping` only for a filmic "prime time" night variant.

**Lights** (physically based units; three r155+ has no legacy lights)

| Light | Type | Color | Intensity | Placement and notes |
|---|---|---|---|---|
| Sun (key) | `DirectionalLight` | `#FFF3DE` | **3.2** | Elevation ~55°, azimuth off the long axis of the duel (so neither side is backlit). `castShadow`, `shadow.mapSize 2048`, ortho shadow camera ±0.7 m, near 0.1, far 4, `bias -0.0003`, `normalBias 0.015`. |
| Sky fill | `HemisphereLight` | sky `#DCEBFF`, ground `#D8C8AE` | **1.1** | Cool sky and warm bounce, which replaces flat `ambientLight`. |
| P1 rim | `SpotLight` | `#5C8DFF` | **9** (cd), `decay 2`, `distance 0` | Behind and above the pilot's arm, 1.2 m out, aimed at the rival arm's shoulder. `angle 0.42`, `penumbra 0.7`, no shadow. |
| AI rim | `SpotLight` | `#FF4F95` | **9** | Mirror of the above. Gives each robot a colored silhouette edge. |
| Deck top-fill | `RectAreaLight` | `#FFFFFF` | **3.5** | 1.2 × 0.4 m, 1.3 m above the deck pointing down (the "truss softbox"). Needs `RectAreaLightUniformsLib.init()`; no shadows. |
| Hit flash | `PointLight` (the existing one) | strike or crit color | 0 → **2.5** → 0 over 90 ms | `distance 0.35`, `decay 2` at the contact point. Reuse the single instance. |

**Reflections.** Use a drei `<Environment resolution={256} frames={1}>` built from **`<Lightformer>`s**:
- a large white rect overhead (intensity 2)
- two thin strips at the sides in `#5C8DFF` and `#FF4F95` (intensity 1.5) for team-colored highlights on the chrome
- a warm ring behind the camera (intensity 0.8)

Set `scene.environmentIntensity = 0.7`. This avoids fetching external HDR files, so it works offline.

**Materials.**
- Arm shells: `MeshPhysicalMaterial` with `roughness 0.38`, `clearcoat 0.4`, `clearcoatRoughness 0.2`.
- Servo bodies: `metalness 0.1`, `roughness 0.55`, color `#1C1F29`.
- Chrome and prop accents: `metalness 1`, `roughness 0.12`.
- LEDs, par-can lenses, and hologram crowd: `MeshBasicMaterial` or emissive with **`toneMapped: false`** and color values above 1 (e.g. `new THREE.Color("#2A6BFF").multiplyScalar(4)`). Only these feed bloom.

**Atmosphere.** Replace the current warm near fog (`#e6e1d5`, 2.6–5) with `new THREE.Fog("#E4ECF5", 2.0, 9.0)`. The stage stays crisp, and the crowd and truss fall into cool daylight haze, which separates foreground from background.

**Post chain.** Add dependency `@react-three/postprocessing` (pmndrs, MIT). It is not installed yet.

```tsx
<EffectComposer multisampling={0} enableNormalPass={false}>
  <SMAA />
  <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.15}
         intensity={0.75} radius={0.72} levels={6} />
  <HueSaturation saturation={0.08} />
  <BrightnessContrast contrast={0.06} />
  <ChromaticAberration offset={hitAberrationRef} radialModulation modulationOffset={0.3} />
  {/* offset is a Vector2 driven 0.002 → 0 over 150 ms on crits only */}
  <Vignette offset={0.32} darkness={0.38} />
  <ToneMapping mode={ToneMappingMode.NEUTRAL} />
</EffectComposer>
```

- **Bloom threshold is 1.0 in linear HDR**, so bright daylight surfaces (which tone map near white but sit below 1.0 before tone mapping) do *not* bloom. Only `toneMapped:false` emissives above 1 do. That is the "clean daylight, glowing accents" split.
- If the frame drops, lower `levels` to 4 and run bloom at half resolution (`resolutionScale={0.5}`) before touching anything else.
- **Budget:** 60 fps at dpr 1.5 on an M-series laptop. Use one shadow-casting light only, 400 instanced crowd quads in one draw, and one render target for the jumbotron at 512², updated at 15 Hz.

**Time-of-show variants [I].** These are changes to the same recipe:
- **Matinee** (default): the settings above.
- **Prime Time:** sun 0.4 `#9FB4FF`, hemisphere 0.35, rims 16, emissives ×1.5, fog `#141726`, `ToneMappingMode.AGX`.
- **Overdrive** (event): all LEDs go signal orange and strobe at 4 Hz for 1 s, and bloom intensity rises to 1.1 for the duration.

### 2.12 VFX kit (original, build list)

| Effect | Build | Colors | Life |
|---|---|---|---|
| Strike sparks | Instanced stretched quads (velocity-aligned), additive, gravity 9.8, 24 per hit | core `#FFFFFF` to `--strike-400` to `--signal-500` | 180–320 ms |
| Crit burst | Sparks ×2, plus a 1-frame white disc flash (`toneMapped:false`, intensity 6), plus a ring shockwave decal | white, crit | 60 ms flash, 250 ms ring |
| Block ripple | Hex-grid ring shader on a quad oriented to the contact normal, expanding 0 to 6 cm | `--block-400` | 220 ms |
| Scuff decal | `DecalGeometry` or a projected quad, pooled at 64 | dark `#2A2A2A` with bright metal center | persists for the round |
| Foam debris | 3–5 small boxes with a simple JS ballistic plus ground bounce (not MuJoCo) | paper, concrete | settles by 1 s, fades at 3 s |
| KO de-rez | Dissolve shader on the loser's arm: world-space voxel noise threshold sweeping up, with an emissive edge in their side color, plus a volt cube burst (30 instanced 1 cm cubes) | side color, volt | 900 ms |
| Round-reset scan | Plane-sweep shader: a thin signal-orange line with a voxel trail restores the scene | signal | 400 ms |
| Confetti | 300 instanced quads, flutter via rotation noise | volt, signal, paper | 2.5 s |
| Servo overheat | Thin heat-haze sprite plus sparse grey puffs at the shoulder servo when heat is above 85% | grey `#9AA0A8` at 40% | loop while hot |

Visual effects never write back into MuJoCo. Physics stays the source of truth, and effects are driven *by* its contact events.

### 2.13 Broadcast events (optional flavor, real physics)

These are our own equivalent of mid-round show events. Each one changes *real MuJoCo parameters* and gets a lower-third banner: a stripe band with the event name in Anton, a mono subline showing the exact parameter change (harness honesty), and a 15 s duration.

- `SLICK DECK`: floor friction 1.0 → 0.35
- `HEAVY METAL`: cube mass ×3
- `REDLINE`: actuator force limit +15% for both arms
- `SLOW-MO SHOWDOWN`: the render-time scale changes; the physics step stays the same

Keep them off in "Verification" mode, so policy results stay comparable.

### 2.14 Do and don't checklist

**Do**
- Bright daylight stage, pristine at round start.
- One side color per half of the screen, plus one accent.
- Anton, Barlow Condensed, and Chivo Mono.
- 12° slants, notches, stickers, stripes, halftone.
- Slam-ins of 240 ms or less.
- Show the policy's identity and health on screen as part of the show.

**Don't**
- Use THE FINALS names, sponsors, hosts, mascot, arena names, fonts, audio, or screenshots.
- Use rounded glass cards, gradients-for-everything, or pastel dashboard styling (the current light UI must go).
- Use red and green as the only team cue.
- Put full-screen red damage vignettes over 12%.
- Use voiced announcer chatter on every event. It was criticized in the reference; keep voice rare.
- Let HUD bars re-render React trees at 60 Hz.

---

## Sources

- Wikipedia, *The Finals*: <https://en.wikipedia.org/wiki/The_Finals>
- THE FINALS Wiki, *Meet The Makers: Direction and Design*: <https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Direction_and_Design>
- THE FINALS Wiki, *Meet The Makers: Character and Concept Art*: <https://www.thefinals.wiki/wiki/Meet_The_Makers%CB%90_Character_and_Concept_Art>
- THE FINALS Wiki, *Cashout*: <https://www.thefinals.wiki/wiki/Cashout>
- THE FINALS Wiki, *Game Show Events*: <https://www.thefinals.wiki/wiki/Game_Show_Events>
- THE FINALS Wiki, *The Announcer*: <https://www.thefinals.wiki/wiki/The_Announcer>; *Scotty and June*: <https://www.thefinals.wiki/wiki/Scotty_and_June>
- THE FINALS Wiki, *Sponsors*: <https://www.thefinals.wiki/wiki/Sponsors>; *Sponsorships*: <https://www.thefinals.wiki/wiki/Sponsorships>; Fandom *Sponsors*: <https://the-finals.fandom.com/wiki/Sponsors>
- THE FINALS Wiki, *Arenas*: <https://www.thefinals.wiki/wiki/Arenas>; Liquipedia *Arenas*: <https://liquipedia.net/thefinals/Portal:Arenas>
- THE FINALS Wiki, *Revive Statue*: <https://www.thefinals.wiki/wiki/Revive_Statue>; *Coin (Bank It)*: <https://www.thefinals.wiki/wiki/Coin_(Bank_It)>
- NVIDIA GeForce News (RTXGI, destruction lighting): <https://www.nvidia.com/en-us/geforce/news/the-finals-released-reflex-dlss-3-ray-tracing-geforce-rtx/>, <https://www.nvidia.com/en-us/geforce/news/the-finals-geforce-game-ready-driver/>
- 80.lv, procedural buildings and pre-fracturing in Houdini: <https://80.lv/articles/how-embark-studios-built-procedural-environments-for-the-finals-using-houdini>
- Game Informer review: <https://gameinformer.com/review/the-finals/appetite-for-destruction>
- GameSpot review: <https://www.gamespot.com/reviews/the-finals-review-an-explosive-game-show/1900-6418164/>
- Game Developer on AI in production: <https://www.gamedeveloper.com/audio/embark-studios-ai-let-devs-do-more-with-less-when-making-the-finals>
- Steam discussion on team colors: <https://steamcommunity.com/app/2073850/discussions/0/6026443283691066949/>
- Steam guide on weapon stats, hit markers, and headshot color: <https://steamcommunity.com/sharedfiles/filedetails/?id=3421108552>
- Interface In Game screen catalog (use for visual verification of [O] items): <https://interfaceingame.com/games/the-finals/>
- Official site source (fonts, key-art color averages, metallic gradient stops), read 2026-09-16: <https://www.reachthefinals.com/>
- Poster font attribution (third party, low confidence): <https://fontsbird.com/the-finals-font/>
