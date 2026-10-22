'use strict';
// Chip synthesis engine. One class drives both live playback (AudioContext) and export
// (OfflineAudioContext), so what you hear is exactly what gets rendered.

const TPB = 48; // ticks per beat (1/16 = 12 ticks, 1/16 triplet = 8 ticks)

// Top-to-bottom order used by the drum piano roll.
const DRUM_KIT = [
  { p: 49, name: 'Crash' }, { p: 56, name: 'Cowbell' }, { p: 50, name: 'High Tom' }, { p: 47, name: 'Mid Tom' },
  { p: 45, name: 'Low Tom' }, { p: 46, name: 'Open Hat' }, { p: 42, name: 'Closed Hat' }, { p: 39, name: 'Clap' },
  { p: 37, name: 'Rim' }, { p: 38, name: 'Snare' }, { p: 36, name: 'Kick' },
];
const DRUM_NAME = {};
DRUM_KIT.forEach(d => { DRUM_NAME[d.p] = d.name; });

const INST_TYPES = [
  ['pulse', 'Pulse / Square'], ['triangle', 'Triangle (NES)'], ['saw', 'Saw (4-bit)'], ['sine', 'Sine (4-bit)'],
  ['wave', 'Wavetable (GB)'], ['noise', 'Noise (LFSR)'], ['drums', 'Drum Kit'],
];
const ARP_MODES = {
  off: null, maj: [0, 4, 7], min: [0, 3, 7], oct: [0, 12], pow: [0, 7, 12], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  sus4: [0, 5, 7], dim: [0, 3, 6], updown: [0, 4, 7, 12, 7, 4], custom: 'custom',
};
const ARP_LABELS = { off: 'Off', maj: 'Major', min: 'Minor', oct: 'Octave', pow: 'Power', maj7: 'Maj7', min7: 'Min7', sus4: 'Sus4', dim: 'Dim', updown: 'Maj up/down', custom: 'Custom' };

function defaultWave() { const w = []; for (let i = 0; i < 32; i++) w.push(Math.round(7.5 + 7.5 * Math.sin(i / 32 * Math.PI * 2))); return w; }

function defaultInst(type) {
  return {
    type: type || 'pulse', duty: 0.5, noiseMode: 'long', wave: defaultWave(),
    octave: 0, detune: 0, vol: 0.7, pan: 0,
    a: 0.003, d: 0.12, s: 0.65, r: 0.06,
    cutoff: 18000, reso: 0.7, hpf: 20, bits: 16, drive: 0,
    vibRate: 5.5, vibDepth: 0, vibDelay: 0.15,
    arp: 'off', arpCustom: '0 4 7 12', arpSpeed: 30,
    sweep: 0, sweepTime: 0.08, glide: 0, mono: false,
    delay: 0, reverb: 0, kitTune: 0, kitDecay: 1,
  };
}

const PRESETS = [
  { name: 'Square Lead 50%', cat: 'Lead', p: { type: 'pulse', duty: 0.5, a: 0.002, d: 0.15, s: 0.7, r: 0.08, vibDepth: 18, vibRate: 5.5, vibDelay: 0.25 } },
  { name: 'NES Lead 25%', cat: 'Lead', p: { type: 'pulse', duty: 0.25, a: 0.002, d: 0.2, s: 0.6, r: 0.07, vibDepth: 14, vibRate: 6, vibDelay: 0.2 } },
  { name: 'Thin Lead 12.5%', cat: 'Lead', p: { type: 'pulse', duty: 0.125, a: 0.002, d: 0.1, s: 0.7, r: 0.05, vol: 0.6 } },
  { name: 'Echo Lead', cat: 'Lead', p: { type: 'pulse', duty: 0.25, a: 0.002, d: 0.25, s: 0.5, r: 0.1, delay: 0.4, vibDepth: 10 } },
  { name: 'Glide Lead', cat: 'Lead', p: { type: 'pulse', duty: 0.5, mono: true, glide: 0.06, a: 0.002, d: 0.2, s: 0.7, r: 0.06, vibDepth: 20 } },
  { name: '4-bit Flute', cat: 'Lead', p: { type: 'sine', a: 0.04, d: 0.2, s: 0.8, r: 0.12, vibDepth: 22, vibRate: 5, vibDelay: 0.2 } },
  { name: 'Saw Brass', cat: 'Lead', p: { type: 'saw', a: 0.03, d: 0.2, s: 0.7, r: 0.1, cutoff: 3800, reso: 2, vol: 0.5 } },
  { name: 'Crushed Saw', cat: 'Lead', p: { type: 'saw', bits: 4, drive: 0.3, a: 0.002, d: 0.15, s: 0.6, r: 0.06, vol: 0.45 } },
  { name: 'Harmony 12.5%', cat: 'Harmony', p: { type: 'pulse', duty: 0.125, a: 0.002, d: 0.18, s: 0.4, r: 0.06, vol: 0.42 } },
  { name: 'Chip Arp Major', cat: 'Harmony', p: { type: 'pulse', duty: 0.125, arp: 'maj', arpSpeed: 30, a: 0.001, d: 0.2, s: 0.5, r: 0.05, vol: 0.45 } },
  { name: 'Chip Arp Minor', cat: 'Harmony', p: { type: 'pulse', duty: 0.125, arp: 'min', arpSpeed: 30, a: 0.001, d: 0.2, s: 0.5, r: 0.05, vol: 0.45 } },
  { name: 'Soft Square Pad', cat: 'Harmony', p: { type: 'pulse', duty: 0.5, a: 0.18, d: 0.5, s: 0.6, r: 0.5, cutoff: 2600, vibDepth: 8, reverb: 0.35, vol: 0.4 } },
  { name: 'GB Wave Pad', cat: 'Harmony', p: { type: 'wave', wave: [8, 11, 13, 15, 15, 14, 12, 10, 9, 9, 10, 12, 13, 13, 11, 8, 7, 4, 2, 2, 3, 5, 6, 6, 5, 3, 1, 0, 0, 1, 3, 5], a: 0.08, d: 0.3, s: 0.7, r: 0.3, vol: 0.45 } },
  { name: 'Triangle Bass', cat: 'Bass', p: { type: 'triangle', a: 0.001, d: 0.08, s: 0.95, r: 0.03, vol: 0.85 } },
  { name: 'Pulse Bass', cat: 'Bass', p: { type: 'pulse', duty: 0.5, a: 0.001, d: 0.12, s: 0.6, r: 0.04, cutoff: 2400, vol: 0.55 } },
  { name: 'GB Wave Bass', cat: 'Bass', p: { type: 'wave', wave: Array.from({ length: 32 }, (_, i) => 15 - Math.floor(i / 2)), a: 0.001, d: 0.1, s: 0.8, r: 0.04, vol: 0.6 } },
  { name: 'Laser Zap', cat: 'SFX', p: { type: 'pulse', duty: 0.25, sweep: 24, sweepTime: 0.18, a: 0.001, d: 0.18, s: 0, r: 0.05 } },
  { name: 'Pickup Blip', cat: 'SFX', p: { type: 'pulse', duty: 0.5, arp: 'custom', arpCustom: '0 12', arpSpeed: 20, a: 0.001, d: 0.25, s: 0, r: 0.05 } },
  { name: 'Wind / Rain', cat: 'SFX', p: { type: 'noise', a: 0.6, d: 0.5, s: 0.8, r: 1.2, cutoff: 1400, vol: 0.4 } },
  { name: 'Noise Hat', cat: 'Drums', p: { type: 'noise', a: 0.001, d: 0.05, s: 0, r: 0.02, hpf: 4000, vol: 0.5 } },
  { name: 'Noise Snare', cat: 'Drums', p: { type: 'noise', a: 0.001, d: 0.16, s: 0, r: 0.05, vol: 0.6 } },
  { name: 'Metallic Noise', cat: 'Drums', p: { type: 'noise', noiseMode: 'short', a: 0.001, d: 0.2, s: 0.2, r: 0.1, vol: 0.45 } },
  { name: 'Shaker', cat: 'Drums', p: { type: 'noise', a: 0.004, d: 0.035, s: 0, r: 0.02, hpf: 6500, vol: 0.4 } },
  { name: 'Bell Sparkle', cat: 'Lead', p: { type: 'sine', a: 0.001, d: 0.35, s: 0, r: 0.25, delay: 0.35, reverb: 0.3, vol: 0.4 } },
  { name: 'Drum Kit', cat: 'Drums', p: { type: 'drums', vol: 0.8 } },
  { name: 'Crunchy Kit', cat: 'Drums', p: { type: 'drums', bits: 5, drive: 0.2, vol: 0.75 } },
];
function presetByName(n) { return PRESETS.find(p => p.name === n); }
function instFromPreset(name) { const pr = presetByName(name); return Object.assign(defaultInst(pr ? pr.p.type : 'pulse'), pr ? deepClone(pr.p) : {}); }
function applyPreset(inst, pr) {
  const keep = { vol: inst.vol, pan: inst.pan };
  for (const k of Object.keys(inst)) delete inst[k];
  Object.assign(inst, defaultInst(pr.p.type), deepClone(pr.p));
  if (pr.p.vol == null) inst.vol = keep.vol;
  inst.pan = keep.pan;
}

function arpOffsets(I) {
  if (!I.arp || I.arp === 'off') return null;
  if (I.arp === 'custom') {
    const o = String(I.arpCustom || '').split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    return o.length ? o : null;
  }
  return ARP_MODES[I.arp] || null;
}

// --- single-cycle data -------------------------------------------------------------
function dcFree(a) { const m = a.reduce((s, x) => s + x, 0) / a.length; return a.map(x => x - m); }
function pulseData(duty) { const N = 64, hi = Math.max(1, Math.round(duty * N)); const a = []; for (let i = 0; i < N; i++) a.push(i < hi ? 1 : -1); return dcFree(a); }
function triData() { const a = []; for (let i = 0; i < 32; i++) { const v = i < 16 ? 15 - i : i - 16; a.push(v / 7.5 - 1); } return a; }
function sawData() { const a = []; for (let i = 0; i < 32; i++) a.push(Math.floor(i / 2) / 7.5 - 1); return a; }
function sineData() { const a = []; for (let i = 0; i < 32; i++) a.push(Math.round((Math.sin(i / 32 * Math.PI * 2) + 1) * 7.5) / 7.5 - 1); return a; }
function waveData(w) { return dcFree(w.map(v => clamp(v, 0, 15) / 7.5 - 1)); }
function lfsrData(short) {
  let reg = 1;
  const n = short ? 93 : 32767, a = new Array(n);
  for (let i = 0; i < n; i++) {
    const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
    reg = (reg >> 1) | (bit << 14);
    a[i] = (reg & 1) ? 1 : -1;
  }
  return a;
}
function crushCurve(bits) {
  const n = 8192, c = new Float32Array(n), lv = Math.pow(2, bits - 1);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.round(x * lv) / lv; }
  return c;
}
function driveCurve(d) {
  const n = 2048, c = new Float32Array(n), k = d * 30;
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)) / (1 + d * 0.6); }
  return c;
}
function makeIR(ctx, secs) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * secs));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return b;
}

class ChipEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.realtime = typeof OfflineAudioContext === 'undefined' || !(ctx instanceof OfflineAudioContext);
    this.chains = new Map();
    this.bufs = new Map();
    this.voices = [];
    this.buildMaster();
  }

  buf(key, make) {
    let b = this.bufs.get(key);
    if (!b) {
      const data = make();
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.bufs.set(key, b);
    }
    return b;
  }
  waveBuf(I) {
    switch (I.type) {
      case 'triangle': return this.buf('tri', triData);
      case 'saw': return this.buf('saw', sawData);
      case 'sine': return this.buf('sine', sineData);
      case 'wave': return this.buf('w' + I.wave.join(','), () => waveData(I.wave));
      default: return this.buf('p' + I.duty, () => pulseData(I.duty));
    }
  }
  noiseBuf(short) { return this.buf(short ? 'nS' : 'nL', () => lfsrData(short)); }

  setP(param, v) {
    if (!isFinite(v)) return;
    if (this.realtime) param.setTargetAtTime(v, this.ctx.currentTime, 0.012);
    else param.value = v;
  }

  buildMaster() {
    const c = this.ctx, m = {};
    m.bus = c.createGain();
    m.comp = c.createDynamicsCompressor();
    m.out = c.createGain();
    m.bus.connect(m.comp); m.comp.connect(m.out);
    m.delayIn = c.createGain(); m.delay = c.createDelay(2); m.fb = c.createGain();
    m.dlp = c.createBiquadFilter(); m.dlp.type = 'lowpass'; m.dlp.frequency.value = 3500;
    m.delayOut = c.createGain();
    m.delayIn.connect(m.delay); m.delay.connect(m.dlp); m.dlp.connect(m.fb); m.fb.connect(m.delay); m.dlp.connect(m.delayOut); m.delayOut.connect(m.bus);
    m.revIn = c.createGain(); m.conv = c.createConvolver(); m.revOut = c.createGain();
    m.revIn.connect(m.conv); m.conv.connect(m.revOut); m.revOut.connect(m.bus);
    if (this.realtime) { m.analyser = c.createAnalyser(); m.analyser.fftSize = 2048; m.out.connect(m.analyser); }
    m.out.connect(c.destination);
    this.m = m;
  }

  syncMaster(song) {
    const M = song.master, m = this.m, beat = 60 / song.bpm;
    this.setP(m.out.gain, M.vol);
    this.setP(m.delay.delayTime, clamp(beat * M.delayBeats, 0.01, 1.99));
    this.setP(m.fb.gain, clamp(M.delayFb, 0, 0.92));
    this.setP(m.delayOut.gain, M.delayRet);
    this.setP(m.revOut.gain, M.revRet);
    if (this._revSize !== M.revSize) { this._revSize = M.revSize; m.conv.buffer = makeIR(this.ctx, M.revSize); }
    if (M.comp) { m.comp.threshold.value = -16; m.comp.ratio.value = 4; m.comp.knee.value = 8; m.comp.attack.value = 0.004; m.comp.release.value = 0.18; }
    else { m.comp.threshold.value = 0; m.comp.ratio.value = 1; }
  }

  makeChain() {
    const c = this.ctx, ch = {};
    ch.input = c.createGain();
    ch.hp = c.createBiquadFilter(); ch.hp.type = 'highpass';
    ch.lp = c.createBiquadFilter(); ch.lp.type = 'lowpass';
    ch.crush = c.createWaveShaper(); ch.drv = c.createWaveShaper();
    ch.vol = c.createGain(); ch.pan = c.createStereoPanner(); ch.mute = c.createGain();
    ch.dSend = c.createGain(); ch.rSend = c.createGain();
    ch.input.connect(ch.hp); ch.hp.connect(ch.lp); ch.lp.connect(ch.crush); ch.crush.connect(ch.drv);
    ch.drv.connect(ch.vol); ch.vol.connect(ch.pan); ch.pan.connect(ch.mute); ch.mute.connect(this.m.bus);
    ch.mute.connect(ch.dSend); ch.dSend.connect(this.m.delayIn);
    ch.mute.connect(ch.rSend); ch.rSend.connect(this.m.revIn);
    if (this.realtime) { ch.meter = c.createAnalyser(); ch.meter.fftSize = 512; ch.mute.connect(ch.meter); }
    ch.lastPitch = null; ch.lastEnd = -1;
    return ch;
  }

  syncTrack(tr, audible) {
    let ch = this.chains.get(tr.id);
    if (!ch) { ch = this.makeChain(); this.chains.set(tr.id, ch); }
    const I = tr.inst, ny = this.ctx.sampleRate / 2 - 200;
    this.setP(ch.hp.frequency, clamp(I.hpf, 10, ny));
    this.setP(ch.lp.frequency, clamp(I.cutoff, 30, ny));
    this.setP(ch.lp.Q, I.reso);
    if (ch._bits !== I.bits) { ch._bits = I.bits; ch.crush.curve = I.bits >= 16 ? null : crushCurve(I.bits); }
    if (ch._drive !== I.drive) { ch._drive = I.drive; ch.drv.curve = I.drive > 0 ? driveCurve(I.drive) : null; }
    this.setP(ch.vol.gain, I.vol);
    this.setP(ch.pan.pan, clamp(I.pan, -1, 1));
    this.setP(ch.mute.gain, audible ? 1 : 0);
    this.setP(ch.dSend.gain, I.delay);
    this.setP(ch.rSend.gain, I.reverb);
    return ch;
  }

  syncAll(song) {
    this.syncMaster(song);
    const anySolo = song.tracks.some(t => t.solo);
    const ids = new Set();
    for (const tr of song.tracks) { ids.add(tr.id); this.syncTrack(tr, !tr.mute && (!anySolo || tr.solo)); }
    for (const [id, ch] of this.chains) if (!ids.has(id)) { try { ch.mute.disconnect(); } catch (e) { /* already gone */ } this.chains.delete(id); }
  }

  silenceAll() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.006); } catch (e) { /* node finished */ }
    }
    this.voices = [];
    for (const ch of this.chains.values()) ch.lastPitch = null;
  }
  prune() { const now = this.ctx.currentTime; this.voices = this.voices.filter(v => v.end > now); }

  // Schedule a note. dur in seconds, or null for a held (live) note that returns a voice with release().
  noteOn(tr, pitch, vel, t, dur, register) {
    const ch = this.chains.get(tr.id);
    if (!ch) return null;
    const I = tr.inst, c = this.ctx;
    if (I.type === 'drums') { this.drum(ch, I, pitch, vel, t, register); return null; }
    const p = pitch + 12 * (I.octave || 0);
    const src = c.createBufferSource();
    if (I.type === 'noise') {
      const short = I.noiseMode === 'short';
      src.buffer = this.noiseBuf(short);
      src.playbackRate.value = mtof(p) * (short ? 93 : 32) / c.sampleRate;
    } else {
      src.buffer = this.waveBuf(I);
      src.playbackRate.value = mtof(p) * src.buffer.length / c.sampleRate;
    }
    src.loop = true;
    const A = Math.max(0.001, I.a), D = Math.max(0.002, I.d), S = clamp(I.s, 0, 1), R = Math.max(0.004, I.r);
    const base = I.detune || 0, det = src.detune;
    const relEnd = dur == null ? t + 8 : t + dur;
    const offs = arpOffsets(I);
    if (offs) {
      const st = 1 / Math.max(1, I.arpSpeed);
      let k = 0;
      for (let tt = t; tt < relEnd + R && k < 3000; tt += st, k++) det.setValueAtTime(base + offs[k % offs.length] * 100, tt);
    } else if (I.sweep) {
      det.setValueAtTime(base + I.sweep * 100, t);
      det.linearRampToValueAtTime(base, t + Math.max(0.005, I.sweepTime));
    } else if (I.glide > 0 && ch.lastPitch != null && t - ch.lastEnd < 0.6) {
      det.setValueAtTime(base + (ch.lastPitch - p) * 100, t);
      det.linearRampToValueAtTime(base, t + I.glide);
    } else det.setValueAtTime(base, t);
    ch.lastPitch = p; ch.lastEnd = relEnd;

    let lfo = null;
    if (I.vibDepth > 0) {
      lfo = c.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = I.vibRate;
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, t + I.vibDelay);
      lg.gain.linearRampToValueAtTime(I.vibDepth, t + I.vibDelay + 0.12);
      lfo.connect(lg); lg.connect(det);
      lfo.start(t);
    }

    const g = c.createGain();
    const peak = 0.3 * (vel / 127);
    const gp = g.gain;
    const levelAt = dt => dt <= A ? peak * dt / A : dt <= A + D ? peak + (peak * S - peak) * (dt - A) / D : peak * S;
    gp.setValueAtTime(0, t);
    if (dur == null) {
      gp.linearRampToValueAtTime(peak, t + A);
      gp.linearRampToValueAtTime(peak * S, t + A + D);
    } else {
      const e = t + dur;
      if (dur <= A) gp.linearRampToValueAtTime(levelAt(dur), e);
      else {
        gp.linearRampToValueAtTime(peak, t + A);
        if (dur <= A + D) gp.linearRampToValueAtTime(levelAt(dur), e);
        else { gp.linearRampToValueAtTime(peak * S, t + A + D); gp.setValueAtTime(peak * S, e); }
      }
      gp.linearRampToValueAtTime(0, e + R);
    }
    src.connect(g); g.connect(ch.input);
    src.start(t);
    if (dur != null) {
      const end = t + dur + R + 0.03;
      src.stop(end);
      if (lfo) lfo.stop(end);
      if (register) this.voices.push({ g, end });
      return null;
    }
    let done = false;
    return {
      release(t2) {
        if (done) return;
        done = true;
        t2 = Math.max(t2, c.currentTime);
        const l = levelAt(t2 - t);
        gp.cancelScheduledValues(t2);
        gp.setValueAtTime(l, t2);
        gp.linearRampToValueAtTime(0, t2 + R);
        src.stop(t2 + R + 0.03);
        if (lfo) lfo.stop(t2 + R + 0.03);
      },
    };
  }

  drum(ch, I, pitch, vel, t, register) {
    const c = this.ctx, out = ch.input, v = 0.42 * (vel / 127);
    const dk = I.kitDecay || 1, tune = Math.pow(2, (I.kitTune || 0) / 12), sr = c.sampleRate;
    const env = (node, peak, dec, delay) => {
      delay = delay || 0;
      const g = c.createGain(), s = t + delay, e = s + dec * dk;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(peak, s + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0008, e);
      g.gain.setValueAtTime(0, e + 0.001);
      node.connect(g); g.connect(out);
      if (register) this.voices.push({ g, end: e + 0.05 });
      return e;
    };
    const tone = (f0, f1, dec, peak, buf) => {
      const s = c.createBufferSource();
      s.buffer = buf || this.buf('tri', triData);
      s.loop = true;
      const N = s.buffer.length;
      s.playbackRate.setValueAtTime(f0 * tune * N / sr, t);
      s.playbackRate.exponentialRampToValueAtTime(Math.max(1e-4, f1 * tune * N / sr), t + Math.max(0.01, dec * 0.6 * dk));
      const e = env(s, peak, dec);
      s.start(t); s.stop(e + 0.02);
    };
    const noise = (rate, dec, peak, hp, short, delay) => {
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf(!!short);
      s.loop = true;
      s.playbackRate.value = rate * tune;
      let node = s;
      if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = Math.min(hp, sr / 2 - 500); s.connect(f); node = f; }
      const e = env(node, peak, dec, delay);
      s.start(t + (delay || 0)); s.stop(e + 0.02);
    };
    const pulse50 = this.buf('p0.5', () => pulseData(0.5)), pulse25 = this.buf('p0.25', () => pulseData(0.25));
    switch (pitch) {
      case 36: tone(170, 42, 0.24, v * 1.6); noise(0.5, 0.012, v * 0.5); break;
      case 38: noise(0.85, 0.17, v * 0.95, 900); tone(230, 150, 0.07, v * 0.7, pulse50); break;
      case 39: noise(0.9, 0.018, v * 0.8, 1200, false, 0); noise(0.9, 0.018, v * 0.8, 1200, false, 0.012); noise(0.9, 0.16, v * 0.75, 1200, false, 0.024); break;
      case 37: tone(820, 760, 0.03, v * 0.8, pulse50); break;
      case 42: noise(1.4, 0.045, v * 0.55, 7000); break;
      case 46: noise(1.4, 0.3, v * 0.45, 6000); break;
      case 49: noise(1.1, 1.3, v * 0.5, 3500); noise(1.3, 0.6, v * 0.18, 5000, true); break;
      case 45: tone(140, 72, 0.3, v * 1.2); break;
      case 47: tone(190, 98, 0.28, v * 1.2); break;
      case 50: tone(260, 135, 0.26, v * 1.2); break;
      case 56: tone(545, 540, 0.22, v * 0.5, pulse50); tone(810, 805, 0.22, v * 0.4, pulse50); break;
      default: tone(mtof(pitch), mtof(pitch) * 0.5, 0.2, v, pulse25);
    }
  }

  click(t, accent) {
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = this.buf('p0.5', () => pulseData(0.5));
    s.loop = true;
    s.playbackRate.value = (accent ? 1760 : 1320) * 64 / c.sampleRate;
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    s.connect(g); g.connect(this.m.bus);
    s.start(t); s.stop(t + 0.05);
  }
}

// Live audio context holder ("AE" — window.Audio is taken by the browser).
const AE = {
  ctx: null, engine: null,
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.engine = new ChipEngine(this.ctx);
      this.engine.syncAll(App.song);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.engine;
  },
  sync() { if (this.engine) this.engine.syncAll(App.song); },
};
