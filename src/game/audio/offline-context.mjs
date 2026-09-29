// src/game/audio/offline-context.mjs (WP8)
// A compact block-based software OfflineAudioContext for Node, where WebAudio does not exist: gain, oscillator,
// buffer source, biquad, wave shaper, compressor, stereo panner, AudioParam automation and a-rate param connections,
// the subset every recipe in this package uses. The synth tests and tools/export/mixdown.mjs render the whole show
// through it, so the LUFS and crest numbers in EMOTION_BIBLE 7 are measured, never guessed. In a browser the
// platform OfflineAudioContext is used instead; this file is never bundled into the game.

const BLOCK = 128;

class SimParam {
  constructor(value) { this._value = value; this.events = []; this.inputs = []; }
  get value() { return this._value; }
  set value(v) { this._value = v; }
  _push(e) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
    return this;
  }
  setValueAtTime(v, t) { return this._push({ type: "set", v, t }); }
  linearRampToValueAtTime(v, t) { return this._push({ type: "lin", v, t }); }
  exponentialRampToValueAtTime(v, t) { return this._push({ type: "exp", v, t }); }
  setTargetAtTime(v, t, tau) { return this._push({ type: "target", v, t, tau }); }
  cancelScheduledValues(t) { this.events = this.events.filter((e) => e.t < t); return this; }
  valueAt(time) {
    let v = this._value, lastT = 0, lastV = this._value;
    const ev = this.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.t > time) {
        if (e.type === "lin") return lastV + (e.v - lastV) * (time - lastT) / Math.max(1e-9, e.t - lastT);
        if (e.type === "exp") return lastV * e.v > 0 ? lastV * Math.pow(e.v / lastV, (time - lastT) / Math.max(1e-9, e.t - lastT)) : lastV;
        return v;
      }
      if (e.type === "target") {
        const next = ev[i + 1];
        if (!next || next.t > time) {
          if (next && (next.type === "lin" || next.type === "exp") && next.t > time) {
            // A ramp after a target starts from the target's value at the target's start (spec: previous event time).
            const r = (time - e.t) / Math.max(1e-9, next.t - e.t);
            if (next.type === "lin") return lastV + (next.v - lastV) * r;
            return lastV * next.v > 0 ? lastV * Math.pow(next.v / lastV, r) : lastV;
          }
          return e.v + (lastV - e.v) * Math.exp(-(time - e.t) / e.tau);
        }
        v = e.v + (lastV - e.v) * Math.exp(-(next.t - e.t) / e.tau);
        lastT = e.t; lastV = v;
        continue;
      }
      v = e.v; lastT = e.t; lastV = v;
    }
    return v;
  }
  fill(out, t0, dt, ctx) {
    if (this.events.length === 0) out.fill(this._value);
    else for (let i = 0; i < BLOCK; i++) out[i] = this.valueAt(t0 + i * dt);
    for (const n of this.inputs) {
      if (n.silent) continue;
      const l = n.out[0], r = n.out[1];
      for (let i = 0; i < BLOCK; i++) out[i] += 0.5 * (l[i] + r[i]);
    }
    void ctx;
    return out;
  }
}

class SimNode {
  constructor(ctx) { this.ctx = ctx; this.inputs = []; this.out = [new Float32Array(BLOCK), new Float32Array(BLOCK)]; this.silent = true; this.params = []; ctx.nodes.push(this); }
  connect(dest) { dest.inputs.push(this); return dest; }
  disconnect() { for (const n of this.ctx.nodes) n.inputs = n.inputs.filter((x) => x !== this); for (const n of this.ctx.nodes) for (const p of n.params) p.inputs = p.inputs.filter((x) => x !== this); }
  mix() {
    const [L, R] = this.out;
    L.fill(0); R.fill(0);
    let any = false;
    for (const n of this.inputs) {
      if (n.silent) continue;
      any = true;
      const [a, b] = n.out;
      for (let i = 0; i < BLOCK; i++) { L[i] += a[i]; R[i] += b[i]; }
    }
    return any;
  }
  param(v) { const p = new SimParam(v); this.params.push(p); return p; }
}

class SimGain extends SimNode {
  constructor(ctx) { super(ctx); this.gain = this.param(1); this.g = new Float32Array(BLOCK); }
  process(t0, dt) {
    if (!this.mix()) { this.silent = true; return; }
    this.silent = false;
    this.gain.fill(this.g, t0, dt);
    const [L, R] = this.out;
    for (let i = 0; i < BLOCK; i++) { L[i] *= this.g[i]; R[i] *= this.g[i]; }
  }
}

class SimSource extends SimNode {
  constructor(ctx) { super(ctx); this.startT = Infinity; this.stopT = Infinity; }
  start(t = 0) { this.startT = t; }
  stop(t = 0) { this.stopT = t; }
  active(t0, dt) { return t0 + BLOCK * dt > this.startT && t0 < this.stopT; }
}

class SimOsc extends SimSource {
  constructor(ctx) { super(ctx); this.type = "sine"; this.frequency = this.param(440); this.detune = this.param(0); this.phase = 0; this.f = new Float32Array(BLOCK); this.d = new Float32Array(BLOCK); }
  process(t0, dt) {
    if (!this.active(t0, dt)) { this.silent = true; return; }
    this.silent = false;
    this.frequency.fill(this.f, t0, dt); this.detune.fill(this.d, t0, dt);
    const [L, R] = this.out;
    for (let i = 0; i < BLOCK; i++) {
      const t = t0 + i * dt;
      if (t < this.startT || t >= this.stopT) { L[i] = 0; R[i] = 0; continue; }
      const p = this.phase;
      let v;
      switch (this.type) {
        case "square": v = p < 0.5 ? 1 : -1; break;
        case "sawtooth": v = 2 * p - 1; break;
        case "triangle": v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
        default: v = Math.sin(2 * Math.PI * p);
      }
      L[i] = v; R[i] = v;
      this.phase = (p + this.f[i] * Math.pow(2, this.d[i] / 1200) * dt) % 1;
      if (this.phase < 0) this.phase += 1;
    }
  }
}

class SimBufferSource extends SimSource {
  constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; this.playbackRate = this.param(1); this.pos = 0; this.r = new Float32Array(BLOCK); this.started = false; }
  start(t = 0, offset = 0) { this.startT = t; this.offset = offset; }
  process(t0, dt) {
    if (!this.buffer || !this.active(t0, dt)) { this.silent = true; return; }
    this.silent = false;
    const b = this.buffer;
    if (!this.started) { this.pos = (this.offset ?? 0) * b.sampleRate; this.started = true; }
    this.playbackRate.fill(this.r, t0, dt);
    const [L, R] = this.out;
    const c0 = b.getChannelData(0), c1 = b.numberOfChannels > 1 ? b.getChannelData(1) : c0;
    const step = b.sampleRate * dt;
    for (let i = 0; i < BLOCK; i++) {
      const t = t0 + i * dt;
      if (t < this.startT || t >= this.stopT || this.pos >= b.length) { L[i] = 0; R[i] = 0; continue; }
      const k = Math.floor(this.pos), f = this.pos - k, k2 = (k + 1) % b.length;
      L[i] = c0[k] + (c0[k2] - c0[k]) * f;
      R[i] = c1[k] + (c1[k2] - c1[k]) * f;
      this.pos += this.r[i] * step;
      if (this.loop && this.pos >= b.length) this.pos -= b.length;
    }
  }
}

class SimBiquad extends SimNode {
  constructor(ctx) {
    super(ctx);
    this.type = "lowpass"; this.frequency = this.param(350); this.Q = this.param(1); this.gain = this.param(0); this.detune = this.param(0);
    this.s = [[0, 0, 0, 0], [0, 0, 0, 0]];
  }
  coeffs(f, Q, gainDb) {
    const fs = this.ctx.sampleRate;
    const w0 = 2 * Math.PI * Math.min(f, fs * 0.49) / fs;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    const qlin = this.type === "lowpass" || this.type === "highpass" ? Math.pow(10, Q / 20) : Math.max(1e-4, Q);
    const alpha = sin / (2 * qlin);
    switch (this.type) {
      case "highpass": b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case "bandpass": b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case "peaking": b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
      default: b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  process(t0, dt) {
    const any = this.mix();
    const quiet = this.s.every((st) => st.every((v) => Math.abs(v) < 1e-9));
    if (!any && quiet) { this.silent = true; return; }
    this.silent = false;
    for (let i = 0; i < BLOCK; i += 16) {
      const t = t0 + i * dt;
      const [b0, b1, b2, a1, a2] = this.coeffs(this.frequency.valueAt(t) * Math.pow(2, this.detune.valueAt(t) / 1200), this.Q.valueAt(t), this.gain.valueAt(t));
      for (let c = 0; c < 2; c++) {
        const x = this.out[c], st = this.s[c];
        for (let j = i; j < Math.min(BLOCK, i + 16); j++) {
          const xn = x[j];
          const yn = b0 * xn + b1 * st[0] + b2 * st[1] - a1 * st[2] - a2 * st[3];
          st[1] = st[0]; st[0] = xn; st[3] = st[2]; st[2] = Math.abs(yn) < 1e-20 ? 0 : yn;
          x[j] = yn;
        }
      }
    }
  }
}

class SimShaper extends SimNode {
  constructor(ctx) { super(ctx); this.curve = null; this.oversample = "none"; }
  process() {
    if (!this.mix()) { this.silent = true; return; }
    this.silent = false;
    const c = this.curve;
    if (!c) return;
    const n = c.length - 1;
    for (const x of this.out) {
      for (let i = 0; i < BLOCK; i++) {
        const v = Math.max(-1, Math.min(1, x[i]));
        const p = ((v + 1) / 2) * n, k = Math.floor(p), f = p - k;
        x[i] = k >= n ? c[n] : c[k] + (c[k + 1] - c[k]) * f;
      }
    }
  }
}

class SimCompressor extends SimNode {
  constructor(ctx) {
    super(ctx);
    this.threshold = this.param(-24); this.knee = this.param(30); this.ratio = this.param(12); this.attack = this.param(0.003); this.release = this.param(0.25);
    this.reduction = 0; this.env = 0;
  }
  process(t0, dt) {
    if (!this.mix()) { this.silent = true; return; }
    this.silent = false;
    const th = this.threshold.value, kn = this.knee.value, ra = this.ratio.value;
    const aC = Math.exp(-dt / Math.max(1e-4, this.attack.value)), rC = Math.exp(-dt / Math.max(1e-4, this.release.value));
    const [L, R] = this.out;
    for (let i = 0; i < BLOCK; i++) {
      const lvl = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const db = lvl > 1e-9 ? 20 * Math.log10(lvl) : -180;
      let over = db - th;
      let red = 0;
      if (over > kn / 2) red = over - over / ra;
      else if (over > -kn / 2) { over += kn / 2; red = (1 - 1 / ra) * over * over / (2 * kn); }
      this.env = red > this.env ? aC * this.env + (1 - aC) * red : rC * this.env + (1 - rC) * red;
      const g = Math.pow(10, -this.env / 20);
      L[i] *= g; R[i] *= g;
    }
  }
}

class SimPanner extends SimNode {
  constructor(ctx) { super(ctx); this.pan = this.param(0); this.p = new Float32Array(BLOCK); }
  process(t0, dt) {
    if (!this.mix()) { this.silent = true; return; }
    this.silent = false;
    this.pan.fill(this.p, t0, dt);
    const [L, R] = this.out;
    for (let i = 0; i < BLOCK; i++) {
      const m = 0.5 * (L[i] + R[i]);
      const a = ((Math.max(-1, Math.min(1, this.p[i])) + 1) / 2) * (Math.PI / 2);
      L[i] = m * Math.cos(a) * Math.SQRT2; R[i] = m * Math.sin(a) * Math.SQRT2;
    }
  }
}

class SimBuffer {
  constructor(channels, length, sampleRate) { this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate; this.data = Array.from({ length: channels }, () => new Float32Array(length)); this.duration = length / sampleRate; }
  getChannelData(c) { return this.data[c]; }
}

export class SimOfflineContext {
  constructor(channels, length, sampleRate) {
    this.channels = channels; this.length = length; this.sampleRate = sampleRate; this.currentTime = 0; this.nodes = [];
    this.destination = new SimNode(this);
    this.destination.process = function () { this.silent = !this.mix(); };
  }
  createGain() { return new SimGain(this); }
  createOscillator() { return new SimOsc(this); }
  createBufferSource() { return new SimBufferSource(this); }
  createBiquadFilter() { return new SimBiquad(this); }
  createWaveShaper() { return new SimShaper(this); }
  createDynamicsCompressor() { return new SimCompressor(this); }
  createStereoPanner() { return new SimPanner(this); }
  createBuffer(ch, len, sr) { return new SimBuffer(ch, len, sr); }
  async startRendering() {
    const order = [];
    const seen = new Set();
    const visit = (n) => {
      if (seen.has(n)) return;
      seen.add(n);
      for (const i of n.inputs) visit(i);
      for (const p of n.params) for (const i of p.inputs) visit(i);
      order.push(n);
    };
    visit(this.destination);
    const outBuf = new SimBuffer(this.channels, this.length, this.sampleRate);
    const dt = 1 / this.sampleRate;
    for (let b = 0; b < this.length; b += BLOCK) {
      const t0 = b * dt;
      for (const n of order) n.process(t0, dt);
      const [L, R] = this.destination.out;
      const n = Math.min(BLOCK, this.length - b);
      if (!this.destination.silent) { outBuf.data[0].set(L.subarray(0, n), b); if (this.channels > 1) outBuf.data[1].set(R.subarray(0, n), b); }
    }
    return outBuf;
  }
}

export const offlineFactory = (channels, length, sampleRate) => new SimOfflineContext(channels, length, sampleRate);
