# TORQUE LIMIT: Build scope override (binding)

**Precedence:** this file overrides `GAME_DESIGN.md` wherever they disagree. `GAME_DESIGN.md` stays the detailed reference for everything this file does not change.

**Why this exists:** the design went through an adversarial critique that pulled the identity away from what the product owner asked for, planned work that cannot be done (recording audio from a physical robot that does not exist), and grew a retention layer too large to finish well. The product owner's brief is: a first-person 1v1 robot fight, human vs AI, that feels like a 2026 AAA game, copies the art style and feel of THE FINALS as closely as is legally possible, doubles as a harness to verify the owner's own robot policies, and is ready to ship as an app in several forms. Finished and polished beats broad and half-built.

---

## 1. Identity: the game-show look is back

**Supersedes:** GAME_DESIGN 1.2 pillar P3 wording, 1.3 rows Venue / Host / Sponsors / Mascot, all of 1.5 (distance audit), 6.1, 6.5, 6.6, 8.5 voices, 8.7, 12.3 "Look and sound" rows that reference the workbench or the distance audit.

### 1.1 The IP line (narrow, and the only one)

Style, genre conventions, and design patterns are not protected and are **wanted**. Copy the *feel* hard.

**Never use from THE FINALS:** its name or any Embark mark; logos; sponsor names (e.g. its megacorps and soda brands); character, host, or announcer names; announcer lines or catchphrases; arena or map names; its fonts (Saira, Saira Condensed, Saira Extra Condensed); audio; textures, screenshots, icons, or other assets; its unique made-up vocabulary. Do not trace or pixel-match its HUD layouts; build ours from the principles.

**Allowed and wanted:** a live TV game show framing; a bright, high-key, saturated arena; sponsor-style **original** fictional brands; two **original** hosts with commentary; a holographic/virtual crowd; bold condensed slanted display type; sticker badges, angled panels, hazard stripes, halftone, chrome and foil treatments; a stylized digital dissolve on elimination; a timed deposit objective that can be stolen, including a steal that inherits the countdown; confetti and cash-style bursts; contestant intros and victory poses; a punchy kill-confirm sound built from our own synthesis.

### 1.2 The show

| Element | Decision |
|---|---|
| Show | **TORQUE LIMIT**, tagline *"Live from the benchtop."* |
| Framing | A glossy, televised **virtual arena game show** for robot arms. The fight table is a stage set: painted deck graphics, team-colour LED edge strips that flash on strikes, corner pylons, an overhead truss with par-can lights, a jumbotron, sponsor banners, and a holographic crowd in stands around the stage. Bright, clean, and it gets messy as the round goes. |
| Hosts | Two original voices, captioned: **ROOK** (hype, big moments) and **DR. VALE** (dry analyst who quotes real numbers: m/s, newtons, ms). Captions always; synthesized voice off by default (see 3). |
| Sponsors | **OHMSTEAD** (power utility megacorp, "Keeping you grounded") and **PULPO POP** (eight-armed octopus soda). Original. On banners, deck decals, stat stickers, and the loading screen. |
| Mascot | **BIT**, a smiling 4 cm foam cube. Appears on the loading screen, the Core's decal, and confetti. |
| Contestants | Human side **PILOT** (cobalt). AI side entrants **OVERSHOOT** (pressure), **BACKLASH** (counter-puncher), **DEADBAND** (trickster), tutorial arm **JIG** (magenta). A user model appears under its file name. |
| Objective words | The **Core**. You **dock** it and it **locks** the round. The opponent **steals** it. |
| KO | Keep the physical servo brownout slump (GAME_DESIGN 8.3), and add a team-colour digital de-rez burst plus a **SHORTED OUT** stamp. |
| Harness words | Keep GAME_DESIGN's: Register Entrant, The Lab, CLEARED FOR BROADCAST, POLICY FAULT. |

### 1.3 Art direction tokens

Use `docs/design/research/finals-visual.md` as the style guide, with these decisions:

- **Palette:** ink `#0E0F14`, paper `#F6F3EC`, signal orange `#FF4A1C` (show brand), volt yellow `#FFD60A` (Core / prize), cobalt `#2A6BFF` (pilot), magenta `#FF2E7E` (AI), strike `#FFF36B`, crit `#B6FF2E`, block/deflect `#3DE0FF`. One colour, one meaning still holds.
- **Type (Google Fonts via `next/font/google`, self-hosted at build):** **Anton** for display and stamps (rendered with a `skewX(-10deg)` slant); **Barlow Condensed** 500 to 900 with real italics for HUD and menus; **Chivo Mono** for numbers from physics and policies. This replaces GAME_DESIGN 6.3's Archivo-only rule.
- **Shapes:** one 12 degree slant for panels, notched corners, square corners everywhere, stickers tilted -4 degrees with a hard 4 px offset shadow, hazard stripes, halftone dots, chrome and gold-foil gradients on premium stamps (VICTORY, MVP stats).
- **Lighting:** high-key studio daylight. Directional key as the only shadow caster, hemisphere fill, cobalt and magenta rim spots, softbox over the deck, Lightformer environment (no HDR downloads), neutral or AgX tone mapping, bloom only on emissives. Keep the grey-card exposure calibration idea: nothing lit should blow out.
- **Motion:** slam-ins with overshoot (240 ms), slides 200 ms, exits 140 ms, damage numbers pop 1.4 to 1 in 80 ms.

## 2. Scope cut

### 2.1 In scope (must be complete and polished)

1. Boot/loading screen, title with attract match, a fun **lobby** (not a dashboard), settings, pause, match intro, round flow, post-match with bragging stats, one-key rematch.
2. First-person cockpit camera, command/ghost control model, strikes (flick, jab, charge, heavy), guard/deflect/clash, heat, stagger/burst, grip with grab assist, dock magnet, range cue, mouse+keyboard and gamepad (GAME_DESIGN 3 and 4, complete).
3. The Core with dock, lock-in, and **steal that inherits the remaining countdown** (this replaces GAME_DESIGN's "pry only pauses" rule; keep the underdog and Sudden Death timings).
4. Loadouts and abilities from GAME_DESIGN 4.8. Presets **ARCADE**, **PROVING GROUND**, **HARNESS** (GAME_DESIGN 4.10). DEMO is optional; build it only if everything else is done.
5. Built-in opponent with all four personalities and difficulty tiers, as a policy through the same interface as uploads (GAME_DESIGN 5.5). Adaptive difficulty that is invisible.
6. The Lab: seat selection (human, built-in, uploaded JS module, JSON trajectory, local bridge), preset, seed, best-of, run, model report with CLEARED/FAULT, episode export and re-import, re-simulate and verify.
7. Local Python bridge `torquelimit.bridge/2` with a working example policy server, and `tools/export/to_lerobot.py`.
8. All game feel from GAME_DESIGN 8.1 to 8.4 and 8.6 (event table, camera juice, KO, lock, replay of the deciding moment).
9. Procedural audio for everything (see 3), announcer captions with the two hosts, crowd reactions, a music bed with stingers.
10. Headless runner and `npm run eval` smoke suite.
11. App packaging (see 4).

### 2.2 Cut (do not build; leave no dead buttons for them)

League, medals, daily challenge, drills, rival, scouting, Rep currency and profile progression beyond local W-L per opponent and settings; video recorder; COMPARE and TAKE OVER; nightly balance, exploit, and heavy suites and their proxy bots (keep one human-proxy bot only if the headless tests need it); policy image cameras and the laptop screen render target; arena variants; `.tlep` binary codec worker (use a versioned JSON episode with full-precision Float64 columns stored as base64); `meshoptimizer` bake scripts (load the Menagerie STLs directly, cache geometry); font slant measurement script; Piper voice-over tooling; `tools/audio/RECORDING.md`.

Every screen that remains must be fully functional. If a GAME_DESIGN section only serves a cut feature, skip it.

## 3. Audio

**Supersedes:** GAME_DESIGN 9.2 (recording plan), 9.7 (stand-ins as bugs), and the "recorded audio" parts of 1.4 and 12.3.

All audio is **synthesized locally with WebAudio**; no audio files are required. Port and extend the recipes in `src/lib/arena-audio.mjs`. Standards: layered transients (sub thump + mid body + high tick), randomized pitch and filter per hit, servo whine tied to joint velocity, a kill-confirm built as sub thump, servo ratchet, bell, and a rhythmic gap; crowd as filtered noise swells with cheers and groans on events; a driving synthesized music bed (percussion + bass + stabs) with round-start and victory stingers and a final-round arrangement. The mix must duck under big moments. Host voice: captions always on; optional Web Speech API voices behind a settings toggle, off by default, processed through a radio/PA filter where possible.

## 4. App packaging (new work package)

Ship the same game in four forms from one codebase. Local disk budget for new tooling is about 2 GB total; never install Xcode, Android Studio, the Android SDK, or Rust on this machine.

1. **Web:** `npm run dev` on localhost, and a production static export that works when served from any static host.
2. **PWA:** web app manifest, icons, theme colour, and a service worker that caches the app shell, `mujoco.wasm`, models, and fonts so the game works offline after first load and is installable from Chrome and Safari.
3. **Desktop:** Electron wrapper (`electron`, `electron-builder`, dev dependencies) that loads the static export from disk with a strict CSP, a secure `webPreferences` setup (contextIsolation on, nodeIntegration off, no remote module), pointer lock and gamepad working, and `npm run app:dev` plus `npm run app:mac` producing an unsigned `.app`/`.dmg` for Apple Silicon. Build outputs go in a gitignored directory.
4. **Mobile:** Capacitor configuration and `docs/APPS.md` instructions for iOS and Android. Touch controls must exist for the in-game controls (virtual swing stick, reach, guard, grip, jab/charge) so a mobile build is playable. Native projects are not built on this machine; an Android build may be produced on the remote Linux server later.

## 5. Definition of done

Everything in `GAME_DESIGN.md` 12.1 and 12.2 that applies to in-scope features, plus:

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass.
- The game boots on localhost with zero console errors, and a full match (lobby, intro, three rounds or a 2-0, KO or lock, post-match, rematch) plays end to end with mouse and keyboard.
- A match against `public/policies/example-policy.js` in PROVING GROUND produces a model report, an exportable episode, and a successful re-simulation verify.
- Screenshots of every screen and key HUD moments are saved to `docs/design/screens/` and reviewed against this file and `finals-visual.md`.
- The PWA installs and runs offline; the Electron app launches and plays a match.
