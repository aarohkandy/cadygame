/**
 * Procedural arena audio locked to MuJoCo contacts and joint motion.
 * Uses the Web Audio API so intensity can track force / velocity every tick.
 */

/** @param {number} value @param {number} min @param {number} max */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps collision force into a 0…1 impact intensity used by sparks + SFX.
 * @param {number} force
 * @param {"none" | "block" | "strike"} kind
 */
export function impactIntensity(force, kind) {
  if (kind === "none") return 0;
  const normalized = clamp(force / 2.4, 0, 1);
  return kind === "strike" ? 0.42 + normalized * 0.58 : 0.22 + normalized * 0.45;
}

/**
 * Joint-space motion energy for servo whir (rad/s aggregate).
 * @param {number[]} previous
 * @param {number[]} next
 * @param {number} deltaSeconds
 */
export function motionEnergy(previous, next, deltaSeconds) {
  if (!previous?.length || !next?.length || deltaSeconds <= 0) return 0;
  const count = Math.min(previous.length, next.length);
  let energy = 0;
  for (let index = 0; index < count; index += 1) {
    energy += Math.abs(next[index] - previous[index]) / deltaSeconds;
  }
  return energy;
}

/**
 * Contact grind levels from pressure (force) + slip (motion while touching).
 * Sliding under load should dominate; static press is only a quiet creak.
 * @param {boolean} inContact
 * @param {number} force
 * @param {number} motionEnergyValue
 */
export function contactScrapeLevels(inContact, force, motionEnergyValue) {
  if (!inContact) {
    return { pressure: 0, slip: 0, dry: 0, body: 0, grit: 0 };
  }
  const pressure = clamp(force / 2.2, 0, 1);
  const slip = clamp((motionEnergyValue - 0.2) / 6.5, 0, 1);
  // Quiet when merely pressed together; loud only when surfaces actually slide.
  const dry = clamp(slip * (0.25 + pressure * 0.85), 0, 1);
  const body = clamp(pressure * 0.35 + slip * pressure * 0.55, 0, 0.85);
  const grit = clamp(slip * slip * (0.2 + pressure), 0, 1);
  return { pressure, slip, dry, body, grit };
}

/**
 * Gripper joint activity and close/open edge detection.
 * @param {number} previous
 * @param {number} next
 * @param {number} deltaSeconds
 * @param {number} [closedThreshold]
 */
export function gripperActivity(previous, next, deltaSeconds, closedThreshold = 0.45) {
  const speed = deltaSeconds > 0 ? Math.abs(next - previous) / deltaSeconds : 0;
  const wasClosed = previous < closedThreshold;
  const isClosed = next < closedThreshold;
  return {
    speed,
    closingEdge: !wasClosed && isClosed,
    openingEdge: wasClosed && !isClosed,
  };
}

/**
 * @param {AudioContext} context
 * @param {number} seconds
 */
function createNoiseBuffer(context, seconds = 0.35) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    // Soft brownish noise — less harsh than pure white for metal/gear beds.
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[index] = last * 3.5;
  }
  return buffer;
}

/** Drier, grainier noise for plastic/ABS surface rubbing. */
function createGritNoiseBuffer(context, seconds = 0.4) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    // Mix white with a little pink so rub has texture without hissing like an arc.
    last = 0.92 * last + 0.08 * white;
    const grain = Math.random() < 0.03 ? white * 1.8 : 0;
    data[index] = clamp(white * 0.45 + last * 0.7 + grain, -1, 1);
  }
  return buffer;
}

export class ArenaAudio {
  constructor() {
    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {DynamicsCompressorNode | null} */
    this.compressor = null;
    /** @type {AudioBuffer | null} */
    this.noiseBuffer = null;
    /** @type {AudioBuffer | null} */
    this.gritNoiseBuffer = null;

    /** @type {GainNode | null} */
    this.scrapeDryGain = null;
    /** @type {GainNode | null} */
    this.scrapeBodyGain = null;
    /** @type {GainNode | null} */
    this.scrapeGritGain = null;
    /** @type {BiquadFilterNode | null} */
    this.scrapeDryFilter = null;
    /** @type {BiquadFilterNode | null} */
    this.scrapeBodyFilter = null;
    /** @type {BiquadFilterNode | null} */
    this.scrapeGritFilter = null;
    /** @type {AudioBufferSourceNode | null} */
    this.scrapeDrySource = null;
    /** @type {AudioBufferSourceNode | null} */
    this.scrapeBodySource = null;
    /** @type {AudioBufferSourceNode | null} */
    this.scrapeGritSource = null;

    /** @type {GainNode | null} */
    this.servoGain = null;
    /** @type {OscillatorNode | null} */
    this.servoOscA = null;
    /** @type {OscillatorNode | null} */
    this.servoOscB = null;
    /** @type {BiquadFilterNode | null} */
    this.servoFilter = null;
    /** @type {GainNode | null} */
    this.servoNoiseGain = null;
    /** @type {AudioBufferSourceNode | null} */
    this.servoNoise = null;

    /** @type {number[] | null} */
    this.previousJoints = null;
    /** @type {number[] | null} */
    this.previousOpponentJoints = null;
    this.previousCubeContacts = 0;
    this.lastCollisionEventId = 0;
    this.lastGripServoAt = -1;
    this.slipCarry = 0;
    this.wasInContact = false;
    this.releaseSlip = 0;
    this.releasePressure = 0;
    this.unlocked = false;
    this.enabled = true;
    this.smoothedServo = 0;
    this.smoothedDry = 0;
    this.smoothedBody = 0;
    this.smoothedGrit = 0;
  }

  /** Unlock audio after a user gesture (Start Match). */
  async resume() {
    this.ensureGraph();
    if (!this.context) return;
    if (this.context.state === "suspended") await this.context.resume();
    this.unlocked = this.context.state === "running";
  }

  suspend() {
    if (!this.context) return;
    void this.context.suspend();
  }

  dispose() {
    try {
      this.scrapeDrySource?.stop();
      this.scrapeBodySource?.stop();
      this.scrapeGritSource?.stop();
      this.servoNoise?.stop();
      this.servoOscA?.stop();
      this.servoOscB?.stop();
    } catch {
      // already stopped
    }
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.gritNoiseBuffer = null;
    this.scrapeDryGain = null;
    this.scrapeBodyGain = null;
    this.scrapeGritGain = null;
    this.scrapeDryFilter = null;
    this.scrapeBodyFilter = null;
    this.scrapeGritFilter = null;
    this.scrapeDrySource = null;
    this.scrapeBodySource = null;
    this.scrapeGritSource = null;
    this.servoGain = null;
    this.servoOscA = null;
    this.servoOscB = null;
    this.servoFilter = null;
    this.servoNoiseGain = null;
    this.servoNoise = null;
    this.unlocked = false;
  }

  /**
   * Drive continuous beds + one-shots from a physics tick.
   * @param {{
   *   deltaSeconds: number,
   *   joints: number[],
   *   opponentJoints: number[],
   *   armContacts: number,
   *   cubeContacts: number,
   *   collision: {
   *     kind: "none" | "block" | "strike",
   *     force: number,
   *     eventId: number,
   *     attacker?: string | null,
   *   },
   *   running: boolean,
   * }} frame
   */
  sync(frame) {
    if (!this.enabled || !this.unlocked) {
      this.previousJoints = [...frame.joints];
      this.previousOpponentJoints = [...frame.opponentJoints];
      this.previousCubeContacts = frame.cubeContacts;
      return;
    }
    this.ensureGraph();
    const context = this.context;
    if (!context || !this.master) return;

    const now = context.currentTime;
    const delta = Math.max(frame.deltaSeconds, 0.001);

    if (!frame.running) {
      this.snapContactBeds(now, 0, 0, 0, true);
      this.ramp(this.servoGain?.gain, 0, now, 0.08);
      this.smoothedServo = 0;
      this.smoothedDry = 0;
      this.smoothedBody = 0;
      this.smoothedGrit = 0;
      this.slipCarry = 0;
      this.wasInContact = false;
      this.releaseSlip = 0;
      this.releasePressure = 0;
      this.previousJoints = [...frame.joints];
      this.previousOpponentJoints = [...frame.opponentJoints];
      this.previousCubeContacts = frame.cubeContacts;
      return;
    }

    const atlasEnergy = motionEnergy(this.previousJoints ?? frame.joints, frame.joints, delta);
    const blazeEnergy = motionEnergy(
      this.previousOpponentJoints ?? frame.opponentJoints,
      frame.opponentJoints,
      delta,
    );
    const totalEnergy = atlasEnergy + blazeEnergy;
    const servoTarget = clamp((totalEnergy - 0.35) / 7.5, 0, 1);
    this.smoothedServo += (servoTarget - this.smoothedServo) * 0.28;
    this.updateServoBed(now, this.smoothedServo, totalEnergy);

    const gripping = this.syncGrippers(now, frame.joints, frame.opponentJoints, delta);

    if (frame.collision.eventId > 0 && frame.collision.eventId !== this.lastCollisionEventId) {
      this.lastCollisionEventId = frame.collision.eventId;
      this.playImpact(now, frame.collision);
    }
    if (frame.collision.kind === "none") this.lastCollisionEventId = 0;

    const inContact = frame.armContacts > 0 && frame.collision.kind !== "none";
    const levels = contactScrapeLevels(inContact, frame.collision.force, totalEnergy);

    if (inContact) {
      // Stay snappy while touching so grind still locks to motion.
      const attack = 0.78;
      const ease = 0.45;
      this.smoothedDry += (levels.dry - this.smoothedDry) * (levels.dry > this.smoothedDry ? attack : ease);
      this.smoothedBody += (levels.body - this.smoothedBody) * (levels.body > this.smoothedBody ? attack : ease);
      this.smoothedGrit += (levels.grit - this.smoothedGrit) * (levels.grit > this.smoothedGrit ? attack : ease);
      this.releaseSlip = levels.slip;
      this.releasePressure = levels.pressure;
      this.snapContactBeds(now, this.smoothedDry, this.smoothedBody, this.smoothedGrit, false, levels.slip, levels.pressure, "hold");
    } else {
      if (this.wasInContact) {
        // Soft separation tail — one last scrape as surfaces peel apart.
        const peel = Math.max(this.smoothedDry, this.releaseSlip, 0.2);
        this.playContactGrain(now, Math.max(0.25, this.releaseSlip), Math.max(0.2, this.releasePressure));
        this.playSeparationTail(now, peel, this.releasePressure);
      }
      // Exponential fade over ~180ms so separation doesn't click off.
      const releaseTau = 0.18;
      const releaseBlend = 1 - Math.exp(-delta / releaseTau);
      this.smoothedDry += (0 - this.smoothedDry) * releaseBlend;
      this.smoothedBody += (0 - this.smoothedBody) * releaseBlend;
      this.smoothedGrit += (0 - this.smoothedGrit) * releaseBlend;
      this.releaseSlip += (0 - this.releaseSlip) * releaseBlend;
      this.releasePressure += (0 - this.releasePressure) * releaseBlend;
      if (this.smoothedDry < 0.002) this.smoothedDry = 0;
      if (this.smoothedBody < 0.002) this.smoothedBody = 0;
      if (this.smoothedGrit < 0.002) this.smoothedGrit = 0;
      this.snapContactBeds(
        now,
        this.smoothedDry,
        this.smoothedBody,
        this.smoothedGrit,
        false,
        this.releaseSlip,
        this.releasePressure,
        "release",
      );
    }
    this.wasInContact = inContact;

    // Stick-slip ticks locked to sliding distance — not a steady welding arc.
    if (inContact && levels.slip > 0.08) {
      this.slipCarry += levels.slip * (0.55 + levels.pressure) * delta * 55;
      let grains = 0;
      while (this.slipCarry >= 1 && grains < 3) {
        this.slipCarry -= 1;
        grains += 1;
        this.playContactGrain(now + grains * 0.004, levels.slip, levels.pressure);
      }
    } else {
      this.slipCarry *= 0.72;
    }

    if (frame.cubeContacts > this.previousCubeContacts) {
      const taps = Math.min(3, frame.cubeContacts - this.previousCubeContacts);
      for (let index = 0; index < taps; index += 1) {
        this.playCubeTap(now + index * 0.012, 0.35 + Math.random() * 0.4);
      }
    }

    // Occasional gear chirp while jaws travel — throttled so it stays locked
    // to motion without stacking a new voice every physics tick.
    const gripEnergy = Math.max(gripping.atlasSpeed, gripping.blazeSpeed);
    if (gripEnergy > 1.8 && now - this.lastGripServoAt > 0.09) {
      this.lastGripServoAt = now;
      this.playGripServo(now, clamp(gripEnergy / 6, 0.15, 0.7), gripping.closing);
    }

    this.previousJoints = [...frame.joints];
    this.previousOpponentJoints = [...frame.opponentJoints];
    this.previousCubeContacts = frame.cubeContacts;
  }

  ensureGraph() {
    if (this.context) return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const master = context.createGain();
    master.gain.value = 0.55;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;

    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.compressor = compressor;
    this.noiseBuffer = createNoiseBuffer(context, 0.5);
    this.gritNoiseBuffer = createGritNoiseBuffer(context, 0.4);

    // Three contact layers: dry plastic rub, body pressure, sparse grit — not a weld arc.
    const scrapeDryFilter = context.createBiquadFilter();
    scrapeDryFilter.type = "bandpass";
    scrapeDryFilter.frequency.value = 780;
    scrapeDryFilter.Q.value = 1.1;
    const scrapeDryGain = context.createGain();
    scrapeDryGain.gain.value = 0;
    const scrapeDrySource = context.createBufferSource();
    scrapeDrySource.buffer = this.gritNoiseBuffer;
    scrapeDrySource.loop = true;
    scrapeDrySource.playbackRate.value = 1;
    scrapeDrySource.connect(scrapeDryFilter).connect(scrapeDryGain).connect(master);
    scrapeDrySource.start();

    const scrapeBodyFilter = context.createBiquadFilter();
    scrapeBodyFilter.type = "lowpass";
    scrapeBodyFilter.frequency.value = 180;
    scrapeBodyFilter.Q.value = 0.8;
    const scrapeBodyGain = context.createGain();
    scrapeBodyGain.gain.value = 0;
    const scrapeBodySource = context.createBufferSource();
    scrapeBodySource.buffer = this.noiseBuffer;
    scrapeBodySource.loop = true;
    scrapeBodySource.playbackRate.value = 0.7;
    scrapeBodySource.connect(scrapeBodyFilter).connect(scrapeBodyGain).connect(master);
    scrapeBodySource.start();

    const scrapeGritFilter = context.createBiquadFilter();
    scrapeGritFilter.type = "bandpass";
    scrapeGritFilter.frequency.value = 1600;
    scrapeGritFilter.Q.value = 2.8;
    const scrapeGritGain = context.createGain();
    scrapeGritGain.gain.value = 0;
    const scrapeGritSource = context.createBufferSource();
    scrapeGritSource.buffer = this.gritNoiseBuffer;
    scrapeGritSource.loop = true;
    scrapeGritSource.playbackRate.value = 1.15;
    scrapeGritSource.connect(scrapeGritFilter).connect(scrapeGritGain).connect(master);
    scrapeGritSource.start();

    this.scrapeDryFilter = scrapeDryFilter;
    this.scrapeDryGain = scrapeDryGain;
    this.scrapeDrySource = scrapeDrySource;
    this.scrapeBodyFilter = scrapeBodyFilter;
    this.scrapeBodyGain = scrapeBodyGain;
    this.scrapeBodySource = scrapeBodySource;
    this.scrapeGritFilter = scrapeGritFilter;
    this.scrapeGritGain = scrapeGritGain;
    this.scrapeGritSource = scrapeGritSource;

    // Dual-arm servo whir bed.
    const servoFilter = context.createBiquadFilter();
    servoFilter.type = "lowpass";
    servoFilter.frequency.value = 900;
    servoFilter.Q.value = 0.7;
    const servoGain = context.createGain();
    servoGain.gain.value = 0;
    const servoOscA = context.createOscillator();
    servoOscA.type = "sawtooth";
    servoOscA.frequency.value = 92;
    const servoOscB = context.createOscillator();
    servoOscB.type = "square";
    servoOscB.frequency.value = 148;
    const oscGainA = context.createGain();
    oscGainA.gain.value = 0.045;
    const oscGainB = context.createGain();
    oscGainB.gain.value = 0.02;
    const servoNoiseGain = context.createGain();
    servoNoiseGain.gain.value = 0.4;
    const servoNoise = context.createBufferSource();
    servoNoise.buffer = this.noiseBuffer;
    servoNoise.loop = true;
    const servoNoiseFilter = context.createBiquadFilter();
    servoNoiseFilter.type = "bandpass";
    servoNoiseFilter.frequency.value = 520;
    servoNoiseFilter.Q.value = 2.4;

    servoOscA.connect(oscGainA).connect(servoFilter);
    servoOscB.connect(oscGainB).connect(servoFilter);
    servoNoise.connect(servoNoiseFilter).connect(servoNoiseGain).connect(servoFilter);
    servoFilter.connect(servoGain);
    servoGain.connect(master);
    servoOscA.start();
    servoOscB.start();
    servoNoise.start();

    this.servoFilter = servoFilter;
    this.servoGain = servoGain;
    this.servoOscA = servoOscA;
    this.servoOscB = servoOscB;
    this.servoNoiseGain = servoNoiseGain;
    this.servoNoise = servoNoise;
  }

  /**
   * @param {AudioParam | undefined} param
   * @param {number} value
   * @param {number} now
   * @param {number} seconds
   */
  ramp(param, value, now, seconds) {
    if (!param) return;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  /**
   * Contact-bed update — fast while held, longer fade when releasing.
   * @param {number} now
   * @param {number} dry
   * @param {number} body
   * @param {number} grit
   * @param {boolean} hardOff
   * @param {number} [slip]
   * @param {number} [pressure]
   * @param {"hold" | "release"} [mode]
   */
  snapContactBeds(now, dry, body, grit, hardOff, slip = 0, pressure = 0, mode = "hold") {
    const settle = hardOff ? 0.05 : mode === "release" ? 0.1 : 0.012;
    this.ramp(this.scrapeDryGain?.gain, dry * 0.16, now, settle);
    this.ramp(this.scrapeBodyGain?.gain, body * 0.2, now, mode === "release" ? settle * 1.35 : settle);
    this.ramp(this.scrapeGritGain?.gain, grit * 0.1, now, settle);

    if (hardOff || !this.scrapeDryFilter || !this.scrapeBodyFilter || !this.scrapeGritFilter) return;

    const filterTau = mode === "release" ? 0.08 : 0.02;
    this.scrapeDryFilter.frequency.setTargetAtTime(520 + slip * 520 + pressure * 120, now, filterTau);
    this.scrapeGritFilter.frequency.setTargetAtTime(1200 + slip * 900, now, filterTau);
    this.scrapeBodyFilter.frequency.setTargetAtTime(120 + pressure * 140, now, filterTau);
    if (this.scrapeDrySource) this.scrapeDrySource.playbackRate.setTargetAtTime(0.85 + slip * 0.55, now, filterTau);
    if (this.scrapeGritSource) this.scrapeGritSource.playbackRate.setTargetAtTime(1 + slip * 0.7, now, filterTau);
    if (this.scrapeBodySource) this.scrapeBodySource.playbackRate.setTargetAtTime(0.55 + pressure * 0.25, now, filterTau);
  }

  /**
   * Soft peel-apart scrape when contact breaks — bridges the cut-off.
   * @param {number} now
   * @param {number} intensity
   * @param {number} pressure
   */
  playSeparationTail(now, intensity, pressure) {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.gritNoiseBuffer) return;

    const source = context.createBufferSource();
    source.buffer = this.gritNoiseBuffer;
    source.playbackRate.value = 0.75 + intensity * 0.35;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(640 + pressure * 220, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.16);
    filter.Q.value = 1.2;
    const gain = context.createGain();
    const peak = 0.07 + intensity * 0.1;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + 0.22);

    const body = context.createBufferSource();
    body.buffer = this.noiseBuffer;
    body.playbackRate.value = 0.55;
    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 160;
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.08 + pressure * 0.06, now + 0.01);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    body.connect(bodyFilter).connect(bodyGain).connect(master);
    body.start(now);
    body.stop(now + 0.2);
  }

  /**
   * Tiny stick-slip click while surfaces drag — denser when sliding faster.
   * @param {number} now
   * @param {number} slip
   * @param {number} pressure
   */
  playContactGrain(now, slip, pressure) {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.gritNoiseBuffer) return;

    const source = context.createBufferSource();
    source.buffer = this.gritNoiseBuffer;
    source.playbackRate.value = 1.1 + slip * 0.9 + Math.random() * 0.25;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700 + slip * 1100 + Math.random() * 200;
    filter.Q.value = 3.4;
    const gain = context.createGain();
    const peak = 0.045 + slip * 0.08 + pressure * 0.04;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + 0.04);
  }

  /**
   * @param {number} now
   * @param {number} amount
   * @param {number} energy
   */
  updateServoBed(now, amount, energy) {
    if (!this.servoGain || !this.servoOscA || !this.servoOscB || !this.servoFilter || !this.servoNoiseGain) return;
    // Keep tonal oscillators very quiet — gear noise carries the realism.
    const level = amount * 0.12;
    this.ramp(this.servoGain.gain, level, now, 0.05);
    this.ramp(this.servoNoiseGain.gain, 0.35 + amount * 0.45, now, 0.05);
    const pitch = 64 + clamp(energy, 0, 10) * 5;
    this.servoOscA.frequency.setTargetAtTime(pitch, now, 0.05);
    this.servoOscB.frequency.setTargetAtTime(pitch * 1.37 + 8, now, 0.05);
    this.servoFilter.frequency.setTargetAtTime(480 + amount * 520, now, 0.05);
  }

  /**
   * @param {number} now
   * @param {number[]} joints
   * @param {number[]} opponentJoints
   * @param {number} delta
   */
  syncGrippers(now, joints, opponentJoints, delta) {
    const prevAtlas = this.previousJoints?.[5] ?? joints[5] ?? 0.72;
    const prevBlaze = this.previousOpponentJoints?.[5] ?? opponentJoints[5] ?? 0.72;
    const atlas = gripperActivity(prevAtlas, joints[5] ?? 0.72, delta);
    const blaze = gripperActivity(prevBlaze, opponentJoints[5] ?? 0.72, delta);

    if (atlas.closingEdge || blaze.closingEdge) this.playGripClick(now, true);
    if (atlas.openingEdge || blaze.openingEdge) this.playGripClick(now, false);

    return {
      atlasSpeed: atlas.speed,
      blazeSpeed: blaze.speed,
      closing: atlas.closingEdge || blaze.closingEdge || joints[5] < prevAtlas,
    };
  }

  /**
   * Spark-synced mechanical impact — noise-driven plastic/metal hit,
   * not pitched oscillators (those read as chiptune).
   * @param {number} now
   * @param {{ kind: "none" | "block" | "strike", force: number, attacker?: string | null }} collision
   */
  playImpact(now, collision) {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.noiseBuffer || collision.kind === "none") return;

    const intensity = impactIntensity(collision.force, collision.kind);
    const isStrike = collision.kind === "strike";
    const attackerBoost = collision.attacker === "blaze" ? 1.03 : 1;
    const jitter = () => 0.88 + Math.random() * 0.24;

    /** @param {BiquadFilterType} type @param {number} frequency @param {number} q @param {number} peak @param {number} attack @param {number} release @param {number} [playbackRate] */
    const noiseBurst = (type, frequency, q, peak, attack, release, playbackRate = 1) => {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = playbackRate;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency * jitter();
      filter.Q.value = q;
      const gain = context.createGain();
      const level = Math.max(peak * intensity * attackerBoost, 0.0002);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
      source.connect(filter).connect(gain).connect(master);
      source.start(now);
      source.stop(now + release + 0.02);
    };

    // Hard contact transient — brief broadband crack, not a tone.
    noiseBurst("highpass", isStrike ? 2200 : 900, 0.55, isStrike ? 0.42 : 0.28, 0.0015, isStrike ? 0.045 : 0.03, 1.15);

    // Hollow ABS / aluminum shell body.
    noiseBurst(
      "bandpass",
      isStrike ? 620 : 380,
      isStrike ? 1.4 : 0.9,
      isStrike ? 0.34 : 0.4,
      0.003,
      isStrike ? 0.11 : 0.14,
      0.95,
    );

    // Secondary mid resonance — irregular so it doesn't ring like a note.
    noiseBurst(
      "bandpass",
      isStrike ? 1180 : 740,
      2.2,
      isStrike ? 0.22 : 0.16,
      0.002,
      isStrike ? 0.08 : 0.07,
      1.05,
    );

    if (isStrike) {
      // Bright metallic edge / spark companion — still noise, not a beep.
      noiseBurst("bandpass", 2800, 1.8, 0.28, 0.001, 0.07, 1.2);
      noiseBurst("highpass", 4500, 0.7, 0.16, 0.001, 0.05, 1.35);
    } else {
      // Dense block — more low-mid plastic knock.
      noiseBurst("lowpass", 420, 0.7, 0.32, 0.004, 0.12, 0.85);
    }

    // Mass / structure thud — one very low damped sine only (sub-musical).
    const thud = context.createOscillator();
    thud.type = "sine";
    const thudFreq = (isStrike ? 62 : 48) * jitter();
    thud.frequency.setValueAtTime(thudFreq, now);
    thud.frequency.exponentialRampToValueAtTime(Math.max(24, thudFreq * 0.55), now + 0.09);
    const thudFilter = context.createBiquadFilter();
    thudFilter.type = "lowpass";
    thudFilter.frequency.value = 140;
    const thudGain = context.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.2 * intensity, now + 0.004);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + (isStrike ? 0.12 : 0.16));
    thud.connect(thudFilter).connect(thudGain).connect(master);
    thud.start(now);
    thud.stop(now + 0.18);
  }

  /**
   * Soft plastic/wood tap when a gripper kisses a cube.
   * @param {number} now
   * @param {number} intensity
   */
  playCubeTap(now, intensity) {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.noiseBuffer) return;

    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1100 + intensity * 600;
    band.Q.value = 3.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18 * intensity, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    noise.connect(band).connect(gain).connect(master);
    noise.start(now);
    noise.stop(now + 0.08);

    const tick = context.createOscillator();
    tick.type = "triangle";
    tick.frequency.setValueAtTime(540 + intensity * 180, now);
    const tickGain = context.createGain();
    tickGain.gain.setValueAtTime(0.0001, now);
    tickGain.gain.exponentialRampToValueAtTime(0.08 * intensity, now + 0.001);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    tick.connect(tickGain).connect(master);
    tick.start(now);
    tick.stop(now + 0.05);
  }

  /**
   * Latch click when jaws finish closing or pop open.
   * @param {number} now
   * @param {boolean} closing
   */
  playGripClick(now, closing) {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.noiseBuffer) return;

    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const high = context.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = closing ? 2400 : 1600;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(closing ? 0.22 : 0.14, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    noise.connect(high).connect(gain).connect(master);
    noise.start(now);
    noise.stop(now + 0.05);

    const body = context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(closing ? 190 : 260, now);
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.09, now + 0.002);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    body.connect(bodyGain).connect(master);
    body.start(now);
    body.stop(now + 0.06);
  }

  /**
   * Short gear-whine while the gripper travels.
   * @param {number} now
   * @param {number} intensity
   * @param {boolean} closing
   */
  playGripServo(now, intensity, closing) {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const osc = context.createOscillator();
    osc.type = "sawtooth";
    const start = closing ? 240 : 300;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.linearRampToValueAtTime(closing ? 160 : 380, now + 0.08);
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700;
    filter.Q.value = 4;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07 * intensity, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(filter).connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.1);
  }
}
