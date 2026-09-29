// src/game/audio/beds.ts (WP8)
// Servo life for both arms (EMOTION_BIBLE 7): the audible telegraph of the fight, alive from the first relay click
// of the boot ritual. Every node is created once in createBeds; update() moves AudioParams and schedules only the
// rare one-shots (stop clicks, jitter clicks), so an idle frame allocates nothing.
//
//   hold buzz    (per arm)  50 Hz saw, AM by an 8–12 % duty pulse (two squares, one delayed) → BP 1.2 kHz;
//                           −38 dB at zero tracking error rising to −26 dB at saturation
//   whine        (per arm)  600 + 2400·v/vmax Hz saw + 2nd harmonic at −9 dB; attack 15 ms / release 80 ms.
//                           The player's whine follows measured joint speed; the opponent's follows its COMMANDED
//                           velocity (Δctrl per frame) so it leads its motion, panned by azimuth at −4 dB
//   gear chatter (per arm)  band-passed noise AM at 18 Hz from summed joint speed
//   strain growl (per arm)  55 Hz AM 11 Hz when saturated and not moving (the stall behind a blocked strike)
//   jitter clicks(per arm)  Poisson 0.5–3 / s ∝ tracking error (one-shots, only while erring)
//   stop click   (per arm)  a servo brakes, it does not fade: one click when the arm comes to rest
//   heat hiss    (player)   HP noise above heat 70, −30 → −18 dB
//   near-KO      (victim)   you: the whole bed stutters at 0.9 Hz (a heartbeat); AI: brownout flicker at 12 Hz
//                           with relay clicks; the hunter's 2nd harmonic rises to −3 dB
//   dock siren              E5 / B4 alternating at 3 Hz, −12 dB; a steal drives it to 5 Hz with a square component
//   contact scrape          two band-passed pink layers from arm–arm force and slip
//   charge whine (player)   triangle rising with the charge level
// Hit stop and dilation pull every bed through a 1.2 kHz low-pass and slow it by timeScale^0.5. An offline (KO'd)
// arm is silent. Idle 5 s: the sfx bus sits between −45 and −30 dBFS (alive, not loud).

import type { ArmFrame, CombatSnapshot, PhysicsFrame, Seat } from "../contracts.ts";
import { click, dbToGain, type SynthContext } from "./synth.ts";

export const BED_SMOOTH_S = 0.03;
export const WHINE_ATTACK_S = 0.015;
export const WHINE_RELEASE_S = 0.08;
export const WHINE_BASE_HZ = 600;
export const WHINE_SPAN_HZ = 2400;
/** Summed joint speed (rad/s over six joints) that reads as full whine. */
export const WHINE_VMAX = 6;
export const HOLD_DB_MIN = -38;
export const HOLD_DB_MAX = -26;
export const OPPONENT_DB = -4;
export const HARMONIC_DB = -9;
export const HARMONIC_HUNT_DB = -3;
export const STRAIN_ERR_RAD = 0.3;
export const STRAIN_SPEED = 0.3;
export const JITTER_RATE_MIN = 0.5;
export const JITTER_RATE_MAX = 3;
export const HEARTBEAT_HZ = 0.9;
export const BROWNOUT_HZ = 12;
export const SIREN_DB = -12;
export const SIREN_HZ = { dock: 3, steal: 5 } as const;
export const SIREN_NOTES = { hi: 659.25, lo: 493.88 } as const;   // E5 / B4

export interface ServoLifeParams { speed: number; error: number; load: number; freq: number; whineGain: number; holdGain: number; strain: number; jitterRate: number }

/** Pure mapping from one arm's frame to its servo life (7). `speed` is Σ|q̇| (measured) or Σ|Δctrl|/dt (commanded). */
export function servoLifeParams(arm: ArmFrame, speed: number, out: ServoLifeParams): ServoLifeParams {
  let load = 0;
  let error = 0;
  for (let j = 0; j < 5; j++) {
    const fr = Math.abs(arm.forceRange[j]);
    load += fr > 1e-6 ? Math.min(1, Math.abs(arm.tau[j]) / fr) : 0;
    error += Math.abs(arm.ctrl[j] - arm.q[j]);
  }
  load = Number.isFinite(load) ? load / 5 : 0;
  error = Number.isFinite(error) ? error : 0;
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const v01 = Math.min(1, v / WHINE_VMAX);
  const err01 = Math.min(1, error / 1.0);
  out.speed = v;
  out.error = error;
  out.load = load;
  out.freq = WHINE_BASE_HZ + WHINE_SPAN_HZ * v01;
  out.whineGain = dbToGain(-20) * Math.min(1, 0.85 * v01 + 0.35 * load);
  out.holdGain = dbToGain(HOLD_DB_MIN + (HOLD_DB_MAX - HOLD_DB_MIN) * Math.max(err01, load));
  out.strain = error > STRAIN_ERR_RAD && v < STRAIN_SPEED ? Math.min(1, (error - STRAIN_ERR_RAD) / 0.5 + load) : 0;
  out.jitterRate = err01 > 0.05 ? JITTER_RATE_MIN + (JITTER_RATE_MAX - JITTER_RATE_MIN) * err01 : 0;
  return out;
}

export function gearChatterGain(arm: ArmFrame): number {
  let speed = 0;
  for (let j = 0; j < 6; j++) speed += Math.abs(arm.qd[j]);
  return Number.isFinite(speed) ? dbToGain(-24) * Math.min(1, speed / 20) : 0;
}

/** Heat hiss above 70: −30 → −18 dB over 70 → 100. */
export function heatHissGain(heat: number): number {
  if (!(heat >= 70)) return 0;
  const k = Math.min(1, (heat - 70) / 30);
  return dbToGain(-30 + 12 * k);
}

/** Σ|q̇| over six joints. */
export function jointSpeed(arm: ArmFrame): number {
  let s = 0;
  for (let j = 0; j < 6; j++) s += Math.abs(arm.qd[j]);
  return Number.isFinite(s) ? s : 0;
}

export interface BedInput {
  frame: PhysicsFrame | null;
  combat: CombatSnapshot | null;
  playerSeat: Seat | null;
  /** Arms are powered and on screen (from the boot ritual's first relay click). */
  active: boolean;
  timeScale: number;
  frozen: boolean;
  /** Near-KO (7 F): the victim and u = 1 − integrity / 20; null when nobody is under 20. */
  nearKo?: { seat: Seat; u: number } | null;
  /** Dock siren state (6): off, the 3 Hz countdown siren, or the 5 Hz steal alarm. */
  siren?: "off" | "dock" | "steal";
  /** Opponent azimuth in radians (left negative) for the pan; 0 when unknown. */
  opponentAzimuth?: number;
}

export interface Beds {
  update(now: number, input: BedInput): void;
  /** Number of AudioNodes the beds own (constant after construction). */
  readonly nodeCount: number;
  /** One-shots scheduled by the last update (stop and jitter clicks), for tests. */
  readonly lastOneShots: number;
  dispose(): void;
}

interface ArmBed {
  saw: OscillatorNode; harm: OscillatorNode; harmLevel: GainNode; band: BiquadFilterNode; whine: GainNode; pan: StereoPannerNode; level: GainNode;
  hold: OscillatorNode; holdAm: GainNode; holdBand: BiquadFilterNode; holdGain: GainNode;
  chatterSrc: AudioBufferSourceNode; chatter: GainNode;
  strainOsc: OscillatorNode; strainGain: GainNode;
  gate: GainNode; gateLfo: OscillatorNode; gateDepth: GainNode;
  last: { freq: number; gain: number; hold: number; chatter: number; strain: number; pan: number; level: number; harm: number; moving: boolean; gateHz: number };
  ctrlPrev: Float64Array; jitterAcc: number;
}

export function createBeds(s: SynthContext, dest: AudioNode): Beds {
  const { ctx } = s;
  let nodes = 0;
  let oneShots = 0;
  const n = <T extends AudioNode>(node: T): T => { nodes++; return node; };
  const sources: AudioScheduledSourceNode[] = [];

  const master = n(ctx.createGain());
  const tone = n(ctx.createBiquadFilter());
  tone.type = "lowpass";
  tone.frequency.value = 18000;
  tone.Q.value = 0.5;
  master.connect(tone);
  tone.connect(dest);

  function loopNoise(color: "white" | "pink" | "brown"): AudioBufferSourceNode {
    const src = n(ctx.createBufferSource());
    src.buffer = s.noise[color];
    src.loop = true;
    sources.push(src);
    return src;
  }
  function osc(type: OscillatorType, freq: number): OscillatorNode {
    const o = n(ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    sources.push(o);
    return o;
  }

  function armBed(): ArmBed {
    // Whine: saw + 2nd harmonic at −9 dB through a tracking band-pass.
    const saw = osc("sawtooth", WHINE_BASE_HZ);
    const harm = osc("sine", WHINE_BASE_HZ * 2);
    const harmLevel = n(ctx.createGain());
    harmLevel.gain.value = dbToGain(HARMONIC_DB);
    const band = n(ctx.createBiquadFilter());
    band.type = "bandpass"; band.frequency.value = 1500; band.Q.value = 1.1;
    const whine = n(ctx.createGain());
    whine.gain.value = 0;
    saw.connect(band); harm.connect(harmLevel); harmLevel.connect(band); band.connect(whine);

    // Hold buzz: 50 Hz saw AM by a narrow pulse (two squares summed, one detuned → beating duty) → BP 1.2 kHz.
    const hold = osc("sawtooth", 50);
    const holdAm = n(ctx.createGain());
    holdAm.gain.value = 0.12;
    const pulse = osc("square", 50);
    const pulseDepth = n(ctx.createGain());
    pulseDepth.gain.value = 0.1;
    pulse.connect(pulseDepth); pulseDepth.connect(holdAm.gain);
    const holdBand = n(ctx.createBiquadFilter());
    holdBand.type = "bandpass"; holdBand.frequency.value = 1200; holdBand.Q.value = 1.4;
    const holdGain = n(ctx.createGain());
    holdGain.gain.value = 0;
    hold.connect(holdAm); holdAm.connect(holdBand); holdBand.connect(holdGain);

    // Gear chatter.
    const chatterSrc = loopNoise("white");
    const chatterBand = n(ctx.createBiquadFilter());
    chatterBand.type = "bandpass"; chatterBand.frequency.value = 2600; chatterBand.Q.value = 3;
    const chatterAm = n(ctx.createGain());
    chatterAm.gain.value = 0.55;
    const chatterLfo = osc("square", 18);
    const chatterDepth = n(ctx.createGain());
    chatterDepth.gain.value = 0.45;
    chatterLfo.connect(chatterDepth); chatterDepth.connect(chatterAm.gain);
    const chatter = n(ctx.createGain());
    chatter.gain.value = 0;
    chatterSrc.connect(chatterBand); chatterBand.connect(chatterAm); chatterAm.connect(chatter);

    // Strain growl: 55 Hz AM 11 Hz.
    const strainOsc = osc("sawtooth", 55);
    const strainAm = n(ctx.createGain());
    strainAm.gain.value = 0.5;
    const strainLfo = osc("sine", 11);
    const strainDepth = n(ctx.createGain());
    strainDepth.gain.value = 0.5;
    strainLfo.connect(strainDepth); strainDepth.connect(strainAm.gain);
    const strainLp = n(ctx.createBiquadFilter());
    strainLp.type = "lowpass"; strainLp.frequency.value = 400; strainLp.Q.value = 1;
    const strainGain = n(ctx.createGain());
    strainGain.gain.value = 0;
    strainOsc.connect(strainAm); strainAm.connect(strainLp); strainLp.connect(strainGain);

    // Near-KO gate (heartbeat / brownout flicker) → seat level (−4 dB for the opponent) → pan → master.
    const gate = n(ctx.createGain());
    gate.gain.value = 1;
    const gateLfo = osc("square", HEARTBEAT_HZ);
    const gateDepth = n(ctx.createGain());
    gateDepth.gain.value = 0;
    gateLfo.connect(gateDepth); gateDepth.connect(gate.gain);
    const level = n(ctx.createGain());
    level.gain.value = 1;
    const pan = n(ctx.createStereoPanner());
    for (const src of [whine, holdGain, chatter, strainGain]) src.connect(gate);
    gate.connect(level); level.connect(pan); pan.connect(master);
    return {
      saw, harm, harmLevel, band, whine, pan, level, hold, holdAm, holdBand, holdGain, chatterSrc, chatter, strainOsc, strainGain, gate, gateLfo, gateDepth,
      last: { freq: -1, gain: -1, hold: -1, chatter: -1, strain: -1, pan: 2, level: -1, harm: -1, moving: false, gateHz: HEARTBEAT_HZ },
      ctrlPrev: new Float64Array(6).fill(Number.NaN), jitterAcc: 0,
    };
  }

  const arms: Record<Seat, ArmBed> = { atlas: armBed(), blaze: armBed() };

  // Contact scrape.
  const scrapeSrc = loopNoise("pink");
  const scrapeLo = n(ctx.createBiquadFilter());
  scrapeLo.type = "bandpass"; scrapeLo.frequency.value = 780; scrapeLo.Q.value = 1.1;
  const scrapeHi = n(ctx.createBiquadFilter());
  scrapeHi.type = "bandpass"; scrapeHi.frequency.value = 1600; scrapeHi.Q.value = 2.6;
  const scrapeGain = n(ctx.createGain());
  scrapeGain.gain.value = 0;
  scrapeSrc.connect(scrapeLo); scrapeSrc.connect(scrapeHi); scrapeLo.connect(scrapeGain); scrapeHi.connect(scrapeGain); scrapeGain.connect(master);

  // Heat hiss (player).
  const heatSrc = loopNoise("white");
  const heatHp = n(ctx.createBiquadFilter());
  heatHp.type = "highpass"; heatHp.frequency.value = 6000; heatHp.Q.value = 0.7;
  const heatGain = n(ctx.createGain());
  heatGain.gain.value = 0;
  heatSrc.connect(heatHp); heatHp.connect(heatGain); heatGain.connect(master);

  // Charge whine (player).
  const chargeOsc = osc("triangle", 320);
  const chargeGain = n(ctx.createGain());
  chargeGain.gain.value = 0;
  chargeOsc.connect(chargeGain); chargeGain.connect(master);

  // Dock siren: two tones alternated by a square LFO; the steal alarm adds a square component and 5 Hz.
  const sirenA = osc("sine", SIREN_NOTES.hi);
  const sirenB = osc("sine", SIREN_NOTES.lo);
  const sirenSq = osc("square", SIREN_NOTES.hi);
  const sirenSqLevel = n(ctx.createGain());
  sirenSqLevel.gain.value = 0;
  const sirenLfo = osc("square", SIREN_HZ.dock);
  const gA = n(ctx.createGain());
  gA.gain.value = 0.5;
  const gB = n(ctx.createGain());
  gB.gain.value = 0.5;
  const depthA = n(ctx.createGain());
  depthA.gain.value = 0.5;
  const depthB = n(ctx.createGain());
  depthB.gain.value = -0.5;
  sirenLfo.connect(depthA); depthA.connect(gA.gain);
  sirenLfo.connect(depthB); depthB.connect(gB.gain);
  const sirenGain = n(ctx.createGain());
  sirenGain.gain.value = 0;
  sirenA.connect(gA); sirenSq.connect(sirenSqLevel); sirenSqLevel.connect(gA); sirenB.connect(gB); gA.connect(sirenGain); gB.connect(sirenGain); sirenGain.connect(master);

  const t0 = ctx.currentTime;
  for (const src of sources) src.start(t0);

  const life: ServoLifeParams = { speed: 0, error: 0, load: 0, freq: WHINE_BASE_HZ, whineGain: 0, holdGain: 0, strain: 0, jitterRate: 0 };
  let lastTone = -1;
  let lastScale = -1;
  let lastSiren: BedInput["siren"] = "off";
  let lastNow = Number.NaN;

  function target(param: AudioParam, value: number, now: number, tau = BED_SMOOTH_S): void {
    param.setTargetAtTime(Number.isFinite(value) ? value : 0, now, tau);
  }

  return {
    get nodeCount() { return nodes; },
    get lastOneShots() { return oneShots; },

    update(now, input) {
      oneShots = 0;
      const { frame, combat, playerSeat } = input;
      const dt = Number.isFinite(lastNow) ? Math.max(1e-3, Math.min(0.25, now - lastNow)) : 1 / 60;
      lastNow = now;
      const on = input.active && frame !== null;
      const scale = Math.sqrt(Math.max(0.05, Math.min(1, input.timeScale)));
      const toneHz = input.frozen || input.timeScale < 0.99 ? 1200 : 18000;
      if (toneHz !== lastTone) { target(tone.frequency, toneHz, now, input.frozen ? 0.01 : 0.12); lastTone = toneHz; }
      if (Math.abs(scale - lastScale) > 1e-3) {
        for (const src of [scrapeSrc, arms.atlas.chatterSrc, arms.blaze.chatterSrc]) target(src.playbackRate, scale, now, 0.02);
        lastScale = scale;
      }
      const nearKo = input.nearKo ?? null;

      for (const seat of ["atlas", "blaze"] as const) {
        const a = arms[seat];
        if (!on) {
          if (a.last.gain !== 0) {
            target(a.whine.gain, 0, now, 0.08); target(a.holdGain.gain, 0, now, 0.08); target(a.chatter.gain, 0, now, 0.08); target(a.strainGain.gain, 0, now, 0.08);
            a.last.gain = 0; a.last.hold = 0; a.last.chatter = 0; a.last.strain = 0;
          }
          a.ctrlPrev.fill(Number.NaN);
          continue;
        }
        const arm = (frame as PhysicsFrame).arms[seat];
        const opponent = playerSeat !== null && seat !== playerSeat;
        // The opponent's whine leads its motion: commanded velocity, Σ|Δctrl| / dt.
        let speed: number;
        if (opponent) {
          let d = 0;
          for (let j = 0; j < 6; j++) {
            const prev = a.ctrlPrev[j];
            if (Number.isFinite(prev)) d += Math.abs(arm.ctrl[j] - prev);
            a.ctrlPrev[j] = arm.ctrl[j];
          }
          speed = d / dt;
        } else {
          speed = jointSpeed(arm);
        }
        servoLifeParams(arm, speed, life);
        const offline = combat?.seats[seat].servoState === "offline";
        const gain = offline ? 0 : life.whineGain;
        const freq = life.freq * scale;
        if (Math.abs(freq - a.last.freq) > 0.5) {
          const rising = freq > a.last.freq;
          const tau = rising ? WHINE_ATTACK_S : WHINE_RELEASE_S;
          target(a.saw.frequency, freq, now, tau);
          target(a.harm.frequency, freq * 2, now, tau);
          target(a.band.frequency, Math.min(9000, freq * 1.6), now, tau);
          a.last.freq = freq;
        }
        if (Math.abs(gain - a.last.gain) > 1e-4) { target(a.whine.gain, gain, now, gain > a.last.gain ? WHINE_ATTACK_S : WHINE_RELEASE_S); a.last.gain = gain; }
        const hold = offline ? 0 : life.holdGain;
        if (Math.abs(hold - a.last.hold) > 1e-4) { target(a.holdGain.gain, hold, now, 0.05); a.last.hold = hold; }
        const ch = offline ? 0 : gearChatterGain(arm);
        if (Math.abs(ch - a.last.chatter) > 1e-4) { target(a.chatter.gain, ch, now); a.last.chatter = ch; }
        const strain = offline ? 0 : dbToGain(-22) * life.strain;
        if (Math.abs(strain - a.last.strain) > 1e-4) { target(a.strainGain.gain, strain, now, strain > a.last.strain ? 0.15 : 0.05); a.last.strain = strain; }
        // Stop click: the arm was moving and came to rest. It brakes; it does not fade.
        const moving = speed > 0.6;
        if (!moving && a.last.moving && !offline) { click(s, a.pan, now, { gain: dbToGain(-18) * 2, highpass: 2200, lenS: 0.004, body: 700 }); oneShots++; }
        a.last.moving = moving;
        // Jitter clicks: Poisson at 0.5–3 / s while the servo is erring.
        if (!offline && life.jitterRate > 0) {
          a.jitterAcc += life.jitterRate * dt;
          if (a.jitterAcc >= 1 && s.rng.next() < 0.5) {
            a.jitterAcc = 0;
            click(s, a.pan, now + s.rng.range(0, 0.01), { gain: dbToGain(-30) * 3 * (0.5 + life.error), highpass: 3000, lenS: 0.003 });
            oneShots++;
          }
        } else a.jitterAcc = 0;
        // Near-KO: the victim stutters (you: 0.9 Hz heartbeat; AI: 12 Hz brownout flicker); the hunter's harmonic rises.
        const u = nearKo === null ? 0 : Math.max(0, Math.min(1, nearKo.u));
        const victim = nearKo !== null && nearKo.seat === seat;
        const hunter = nearKo !== null && nearKo.seat !== seat;
        const gateHz = victim && opponent ? BROWNOUT_HZ : HEARTBEAT_HZ;
        if (gateHz !== a.last.gateHz) { a.gateLfo.frequency.setValueAtTime(gateHz, now); a.last.gateHz = gateHz; }
        const depth = victim ? 0.45 * u : 0;
        target(a.gateDepth.gain, depth, now, 0.2);
        target(a.gate.gain, 1 - depth, now, 0.2);
        const harm = dbToGain(hunter ? HARMONIC_DB + (HARMONIC_HUNT_DB - HARMONIC_DB) * u : HARMONIC_DB);
        if (Math.abs(harm - a.last.harm) > 1e-4) { target(a.harmLevel.gain, harm, now, 0.3); a.last.harm = harm; }
        if (victim && opponent && s.rng.next() < dt * 2 * u) {
          click(s, a.pan, now, { gain: 0.3, highpass: 1900, lenS: 0.005, body: 420 });      // brownout relay clicks
          oneShots++;
        }
        const level = opponent ? dbToGain(OPPONENT_DB) : 1;
        if (level !== a.last.level) { target(a.level.gain, level, now, 0.1); a.last.level = level; }
        const az = Number.isFinite(input.opponentAzimuth ?? 0) ? (input.opponentAzimuth ?? 0) : 0;
        const pan = playerSeat === null ? (seat === "atlas" ? -0.35 : 0.35) : opponent ? Math.max(-0.8, Math.min(0.8, Math.sin(az))) : -0.15;
        if (Math.abs(pan - a.last.pan) > 1e-3) { target(a.pan.pan, pan, now, 0.2); a.last.pan = pan; }
      }

      let scrape = 0;
      let slip = 0;
      if (on && frame) {
        const act = frame.active;
        if (act.armArmTouching) {
          const pressure = Math.min(1, act.maxArmForce / 2.2);
          const va = frame.arms.atlas.eeVel, vb = frame.arms.blaze.eeVel;
          slip = Math.min(1, Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]) / 1.5);
          scrape = 0.3 * pressure * (0.25 + 0.75 * slip);
        }
      }
      target(scrapeGain.gain, scrape, now, scrape > 0 ? 0.012 : 0.1);
      target(scrapeLo.frequency, 560 + 520 * slip, now, 0.03);
      target(scrapeHi.frequency, 1200 + 900 * slip, now, 0.03);

      const me = playerSeat !== null && combat ? combat.seats[playerSeat] : null;
      const full = combat?.scoring === "full";
      target(heatGain.gain, on && me && full ? heatHissGain(me.heat) : 0, now, 0.1);
      const c = on && me && me.charging ? Math.max(0, Math.min(1, me.charge)) : 0;
      target(chargeGain.gain, c > 0 ? 0.03 + 0.05 * c : 0, now, 0.04);
      target(chargeOsc.frequency, (320 + 380 * c) * scale, now, 0.04);

      const siren = on ? (input.siren ?? "off") : "off";
      if (siren !== lastSiren) {
        target(sirenGain.gain, siren === "off" ? 0 : dbToGain(SIREN_DB), now, siren === "off" ? 0.08 : 0.03);
        target(sirenSqLevel.gain, siren === "steal" ? 0.35 : 0, now, 0.03);
        sirenLfo.frequency.setValueAtTime(siren === "steal" ? SIREN_HZ.steal : SIREN_HZ.dock, now);
        lastSiren = siren;
      }
    },

    dispose() {
      const t = ctx.currentTime;
      for (const src of sources) {
        try { src.stop(t + 0.05); } catch { /* already stopped */ }
      }
      master.disconnect();
    },
  };
}
