// src/game/render/vfx/stage-cues.ts (WP6)
// Bus-driven show cues for the set and the arms (BUILD_PLAN D13: never React). Game events become
// wall-clock envelopes that stage components read each frame:
//   LED edge strips flash white 120 ms on a strike to that side and pulse in the winner's colour on KO;
//   `pylonFlash` (read by the LED deck-edge ring) flashes on steals, locks, and KOs; `flood` tints the jumbotron
//   on locks, late steals, sudden death and match end (never on KO: GAME_DESIGN 8.3 "no light floods");
//   rim lights dim to 60% in sudden death; crowd rows jump on strikes and throw arms up on KO and
//   late steals; victim LEDs flash, staggered LEDs flicker at 12 Hz, deflect rim flashes, hand flashes;
//   on ENGAGE (phase → fight or sudden_death) the stage lights slam on: `slam` pops to 1, holds 80 ms, and
//   decays over 700 ms, and both LED edges flash with it. Before ENGAGE (the intros) the house is taken down
//   to `HOUSE_DOWN_LEVEL`, so the slam reads as the lights coming on, not just getting brighter;
//   `koFlash` is the white frame flash the post grade adds on a KO; `sponsorSwap` is the 1.5 s reaction panel on
//   the dasher ribbon (OHMSTEAD on a crit, PULPO POP on a steal); the crowd's lean comes from hype.ts through
//   FeedbackFrame.hypeLean. `isRevealPhase` / `isShowIdlePhase` key the new
//   EMOTION_BIBLE 11.9 phases for lighting.tsx and the set.
import { Color } from "three";
import { TOKEN_HEX, type GameEvent, type MatchPhase, type Seat } from "../../contracts.ts";
import { teamHex } from "../robot-materials.ts";

export const LED_FLASH_MS = 120;
export const KO_PULSE_MS = 1800;
export const FLOOD_MS = 1400;
export const PYLON_FLASH_MS = 700;
export const CROWD_JUMP_MS = 250;
export const RIM_FLASH_MS = 300;
export const HAND_FLASH_MS = 300;
export const VICTIM_LED_FLASH_MS = 160;
export const SLAM_HOLD_MS = 80;
export const SLAM_MS = 700;
export const KO_FLASH_MS = 450;
/** Sponsor reaction frame on the dasher ribbon (EMOTION_BIBLE 5.2): OHMSTEAD on a crit, PULPO POP on a steal. */
export const SPONSOR_SWAP_MS = 1500;
/** House-light level while an intro holds the room dark before ENGAGE. */
export const HOUSE_DOWN_LEVEL = 0.28;
const HOUSE_DOWN_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["match_intro", "rematch_intro", "round_intro", "entrance", "boot_ritual", "count_in"]);
/**
 * The reveal (EMOTION_BIBLE 2, 5.3): from the click to FIGHT the room is black except one cone on the opponent's
 * mount; the key is at 0.3 and the hemisphere at 0. lighting.tsx reads this; the FIGHT slam ends it.
 */
const REVEAL_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["entrance", "boot_ritual", "count_in"]);
export function isRevealPhase(phase: MatchPhase): boolean { return REVEAL_PHASES.has(phase); }

export interface StageCues {
  /** Strike flash per side 0..1 (white). */
  ledFlash(seat: Seat, nowMs: number): number;
  /** KO / lock pulse 0..1 (a 3 Hz pulse riding a decay) and its colour (linear). */
  ledPulse(nowMs: number): number;
  readonly pulseColor: Color;
  pylonFlash(nowMs: number): number;
  readonly pylonColor: Color;
  flood(nowMs: number): number;
  readonly floodColor: Color;
  /** Stage lamp level: 1 normally, 0.6 in sudden death. */
  readonly lampLevel: number;
  readonly suddenDeath: boolean;
  /** Stage-lights slam on ENGAGE, 0..1 (lighting overdrives the key and rims by it). */
  slam(nowMs: number): number;
  /** House lights (sweeps, shafts, bowl): HOUSE_DOWN_LEVEL in intros, 1 in play, overdriven by the slam. */
  houseLevel(nowMs: number): number;
  /** KO white frame flash 0..1 (post grade). */
  koFlash(nowMs: number): number;
  /** Sponsor panel swap on the dasher ribbon: atlas panel (0 OHMSTEAD, 1 PULPO POP) and 0..1 amount, panel −1 when none. */
  sponsorSwap(nowMs: number): { panel: number; amount: number };
  /** Which stand leans (−1 atlas side, +1 blaze side, 0 none): the seat that landed the last strike. Crowd tint above hype 80. */
  crowdJump(seat: Seat, nowMs: number): number;
  crowdCheer(nowMs: number): number;
  rimFlash(seat: Seat, nowMs: number): number;
  handFlash(seat: Seat, nowMs: number): number;
  victimLedFlash(seat: Seat, nowMs: number): number;
  /** Stagger LED flicker 0/1 at 12 Hz while the seat is staggered or stunned. */
  ledFlicker(seat: Seat, nowMs: number): number;
  /** Wall ms of the last Core incoming / drop (−1 none), for the core beam. */
  readonly coreIncomingAtMs: number;
  readonly coreDropAtMs: number;
  handle(e: GameEvent, playerSeat: Seat | null, nowMs: number): void;
  setColorblind(on: boolean): void;
  reset(): void;
}

const env = (at: number, dur: number, now: number): number => {
  if (at < 0) return 0;
  const t = (now - at) / dur;
  return t < 0 || t >= 1 ? 0 : 1 - t;
};

export function createStageCues(): StageCues {
  let colorblind = false;
  const ledAt: Record<Seat, number> = { atlas: -1, blaze: -1 };
  const rimAt: Record<Seat, number> = { atlas: -1, blaze: -1 };
  const handAt: Record<Seat, number> = { atlas: -1, blaze: -1 };
  const victimAt: Record<Seat, number> = { atlas: -1, blaze: -1 };
  const jumpAt: Record<Seat, number> = { atlas: -1, blaze: -1 };
  const jumpAmp: Record<Seat, number> = { atlas: 0, blaze: 0 };
  const flickerUntil: Record<Seat, number> = { atlas: -1, blaze: -1 };
  let slamAt = -1, koAt = -1, swapAt = -1, swapPanel = -1;
  const swap = { panel: -1, amount: 0 };
  let lastPhase: MatchPhase | null = null;
  let pulseAt = -1, pylonAt = -1, floodAt = -1, cheerAt = -1, floodDur = FLOOD_MS;
  let suddenDeath = false;
  let coreIncomingAtMs = -1, coreDropAtMs = -1;
  const pulseColor = new Color(TOKEN_HEX.volt);
  const pylonColor = new Color(TOKEN_HEX.volt);
  const floodColor = new Color(TOKEN_HEX.signal);
  const team = (s: Seat) => teamHex(s, colorblind);
  const cues: StageCues = {
    ledFlash: (seat, now) => env(ledAt[seat], LED_FLASH_MS, now),
    ledPulse(now) {
      const e = env(pulseAt, KO_PULSE_MS, now);
      if (e <= 0) return 0;
      const t = (now - pulseAt) / 1000;
      return e * (0.55 + 0.45 * Math.cos(t * Math.PI * 6));
    },
    pulseColor,
    pylonFlash: (now) => {
      const e = env(pylonAt, PYLON_FLASH_MS, now);
      return e * e;
    },
    pylonColor,
    flood: (now) => {
      if (floodAt < 0) return 0;
      const t = now - floodAt;
      if (t < 0 || t > floodDur) return 0;
      const attack = Math.min(1, t / 90);
      const release = t > floodDur - 400 ? (floodDur - t) / 400 : 1;
      return attack * release;
    },
    floodColor,
    get lampLevel() { return suddenDeath ? 0.6 : 1; },
    get suddenDeath() { return suddenDeath; },
    slam(now) {
      if (slamAt < 0) return 0;
      const t = now - slamAt;
      if (t < 0 || t >= SLAM_MS) return 0;
      if (t < SLAM_HOLD_MS) return 1;
      const k = (t - SLAM_HOLD_MS) / (SLAM_MS - SLAM_HOLD_MS);
      return (1 - k) * (1 - k);
    },
    houseLevel(now) {
      const slam = cues.slam(now);
      if (slam > 0) return 1 + 0.6 * slam;
      return lastPhase !== null && HOUSE_DOWN_PHASES.has(lastPhase) ? HOUSE_DOWN_LEVEL : 1;
    },
    koFlash(now) {
      const e = env(koAt, KO_FLASH_MS, now);
      return e * e;
    },
    sponsorSwap(now) {
      const e = env(swapAt, SPONSOR_SWAP_MS, now);
      // Square in over the first 10 %, hold, square out over the last 10 %: a panel swap, not a fade.
      swap.amount = e <= 0 ? 0 : Math.min(1, Math.min(e, 1 - e) * 10);
      swap.panel = swap.amount > 0 ? swapPanel : -1;
      return swap;
    },
    crowdJump: (seat, now) => env(jumpAt[seat], CROWD_JUMP_MS, now) * jumpAmp[seat],
    crowdCheer: (now) => env(cheerAt, 2200, now),
    rimFlash: (seat, now) => env(rimAt[seat], RIM_FLASH_MS, now),
    handFlash: (seat, now) => env(handAt[seat], HAND_FLASH_MS, now),
    victimLedFlash: (seat, now) => env(victimAt[seat], VICTIM_LED_FLASH_MS, now),
    ledFlicker: (seat, now) => (now < flickerUntil[seat] ? (Math.floor(now / (1000 / 24)) % 2) : 1),
    get coreIncomingAtMs() { return coreIncomingAtMs; },
    get coreDropAtMs() { return coreDropAtMs; },
    handle(e, playerSeat, now) {
      switch (e.type) {
        case "strike": {
          if (e.tier === "graze") break;
          if (e.crit) { swapAt = now; swapPanel = 0; }
          ledAt[e.victim] = now;
          victimAt[e.victim] = now;
          jumpAt[e.victim] = now;
          jumpAmp[e.victim] = Math.min(1, 0.35 + e.magnitude);
          break;
        }
        case "deflect":
          rimAt[e.attacker] = now;
          jumpAt[e.defender] = now; jumpAmp[e.defender] = 0.8;
          break;
        case "clash":
          ledAt.atlas = now; ledAt.blaze = now;
          break;
        case "burst":
          handAt[e.seat] = now;
          break;
        case "ability":
          if (e.phase === "start") handAt[e.seat] = now;
          break;
        case "servo_state":
          flickerUntil[e.seat] = e.state === "stagger" || e.state === "stun" || e.state === "micro_stagger" ? now + e.durationMs : -1;
          break;
        case "ko":
          pulseAt = now; pulseColor.set(team(e.attacker));
          pylonAt = now; pylonColor.set(team(e.attacker));
          cheerAt = now;
          koAt = now;
          break;
        case "core":
          if (e.stage === "incoming") coreIncomingAtMs = now;
          else if (e.stage === "drop") coreDropAtMs = now;
          else if (e.stage === "steal") {
            swapAt = now; swapPanel = 1;
            pylonAt = now; pylonColor.set(TOKEN_HEX.volt);
            if (e.late) { cheerAt = now; floodAt = now; floodDur = 1000; floodColor.set(TOKEN_HEX.volt); }
          } else if (e.stage === "lock") {
            pulseAt = now; pulseColor.set(TOKEN_HEX.volt);
            pylonAt = now; pylonColor.set(TOKEN_HEX.volt);
            floodAt = now; floodDur = FLOOD_MS; floodColor.set(TOKEN_HEX.volt);
            cheerAt = now;
          }
          break;
        case "match_end":
          floodAt = now; floodDur = 2400; floodColor.set(playerSeat === null || e.winner === playerSeat ? TOKEN_HEX.signal : team(e.winner));
          pylonAt = now; pylonColor.set(team(e.winner));
          if (playerSeat === null || e.winner === playerSeat) cheerAt = now;
          break;
        case "phase":
          suddenDeath = e.phase === "sudden_death" || (suddenDeath && (e.phase === "ko" || e.phase === "time_up" || e.phase === "lock"));
          if (e.phase === "sudden_death") { floodAt = now; floodDur = 1600; floodColor.set(TOKEN_HEX.signal); }
          if (e.phase === "round_intro") { coreIncomingAtMs = -1; coreDropAtMs = -1; }
          // Only a real ENGAGE slams; resuming from pause re-announces "fight" and must stay quiet.
          if ((e.phase === "fight" || e.phase === "sudden_death") && lastPhase !== e.phase && lastPhase !== "paused") {
            slamAt = now; ledAt.atlas = now; ledAt.blaze = now;
          }
          lastPhase = e.phase;
          break;
        default:
          break;
      }
    },
    setColorblind(on) { colorblind = on; },
    reset() {
      for (const s of ["atlas", "blaze"] as const) { ledAt[s] = -1; rimAt[s] = -1; handAt[s] = -1; victimAt[s] = -1; jumpAt[s] = -1; flickerUntil[s] = -1; }
      slamAt = -1; koAt = -1; swapAt = -1; swapPanel = -1; lastPhase = null; pulseAt = -1; pylonAt = -1; floodAt = -1; cheerAt = -1; suddenDeath = false; coreIncomingAtMs = -1; coreDropAtMs = -1;
    },
  };
  return cues;
}

/**
 * Phases in which the show set runs its idle show (no live round): the LED chase, the sweeps at ×2, the
 * dasher ribbon scrolling. Intros and the reveal are not idle (the house is down); a paused round is not idle
 * (nothing may move behind a pause plate that reads as "the fight is on").
 */
const IDLE_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>([
  "title", "green_room", "attract", "post_match", "outro", "verdict", "round_summary", "round_replay", "match_replay", "replay_viewer",
]);
export function isShowIdlePhase(phase: MatchPhase): boolean {
  return IDLE_PHASES.has(phase);
}
