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
// Kit voicings: kick [start Hz, end Hz, decay], snare [noise rate, decay, hp], hat [rate, closed decay, hp, open decay].
const DRUM_KITS = {
  chip: { kick: [170, 42, 0.24], click: 0.5, snare: [0.85, 0.17, 900], hat: [1.4, 0.045, 7000, 0.3], tom: 1, body: null, short: false },
  boom: { kick: [125, 34, 0.6], click: 0.25, snare: [0.6, 0.24, 500], hat: [1.2, 0.06, 6500, 0.45], tom: 0.75, body: 'sine', short: false },
  tight: { kick: [210, 55, 0.11], click: 0.7, snare: [1.1, 0.09, 1800], hat: [1.7, 0.025, 8000, 0.16], tom: 1.25, body: null, short: true },
  arcade: { kick: [150, 45, 0.2], click: 0.6, snare: [0.7, 0.14, 1300], hat: [1.0, 0.04, 5000, 0.25], tom: 1, body: 'pulse', short: true },
};
const DRUM_NAME = {};
DRUM_KIT.forEach(d => { DRUM_NAME[d.p] = d.name; });

const INST_TYPES = [
  ['pulse', 'Pulse / Square'], ['triangle', 'Triangle (NES)'], ['saw', 'Saw (4-bit)'], ['sine', 'Sine (4-bit)'],
  ['wave', 'Wavetable (GB)'], ['fm', 'FM 2-op (Genesis)'], ['pwm', 'PWM Pulse (C64 SID)'], ['ssaw', 'Saw (smooth)'],
  ['ssine', 'Sine (pure)'], ['noise', 'Noise (LFSR)'], ['drums', 'Drum Kit'], ['sample', 'Sample (imported sound)'],
];
const KIT_TYPES = [['chip', 'Chip (NES)'], ['boom', 'Boom (808-ish)'], ['tight', 'Tight (Game Boy)'], ['arcade', 'Arcade (buzzy)']];
const FILTER_TYPES = [['off', 'Off'], ['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass'], ['notch', 'Notch'], ['peaking', 'Peak'], ['lowshelf', 'Low shelf'], ['highshelf', 'High shelf']];
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
    delay: 0, reverb: 0, kitTune: 0, kitDecay: 1, kit: 'chip',
    unison: 1, uniSpread: 14,
    fmRatio: 2, fmIndex: 2.5, fmDecay: 0.4, fmSus: 0.35,
    pwmRate: 2.5, pwmDepth: 0.4,
    slope: 12,
    // per-note filter with its own envelope and LFO
    fType: 'off', fFreq: 1800, fQ: 2, fGain: 6, fEnv: 0, fA: 0.002, fD: 0.25, fS: 0, fKey: 0.5, fLfoRate: 3, fLfoDepth: 0,
    tremRate: 5, tremDepth: 0,
    eqLow: 0, eqMid: 0, eqMidF: 1000, eqHigh: 0,
    // imported sound: id in SMP, root note, loop region (fractions of the length), one-shot ignores note length
    sample: null, sRoot: 60, sLoop: false, sLs: 0, sLe: 1, sOneShot: false, sStart: 0,
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
  { name: 'Boom Kit', cat: 'Drums', p: { type: 'drums', kit: 'boom', vol: 0.8 } },
  { name: 'Tight GB Kit', cat: 'Drums', p: { type: 'drums', kit: 'tight', vol: 0.8 } },
  { name: 'Arcade Kit', cat: 'Drums', p: { type: 'drums', kit: 'arcade', bits: 6, vol: 0.75 } },
  // FM
  { name: 'FM E-Piano', cat: 'FM', p: { type: 'fm', fmRatio: 1, fmIndex: 1.8, fmDecay: 0.5, fmSus: 0.15, a: 0.002, d: 0.9, s: 0.25, r: 0.3, vol: 0.55, reverb: 0.2 } },
  { name: 'FM Slap Bass', cat: 'FM', p: { type: 'fm', fmRatio: 1, fmIndex: 4, fmDecay: 0.12, fmSus: 0.2, a: 0.001, d: 0.3, s: 0.5, r: 0.06, vol: 0.6 } },
  { name: 'FM Bell', cat: 'FM', p: { type: 'fm', fmRatio: 3.5, fmIndex: 3, fmDecay: 1.2, fmSus: 0.2, a: 0.001, d: 1.6, s: 0, r: 0.8, vol: 0.4, reverb: 0.3 } },
  { name: 'FM Brass', cat: 'FM', p: { type: 'fm', fmRatio: 1, fmIndex: 3, fmDecay: 0.6, fmSus: 0.7, a: 0.05, d: 0.3, s: 0.8, r: 0.12, vol: 0.45, vibDepth: 12 } },
  { name: 'FM Marimba', cat: 'FM', p: { type: 'fm', fmRatio: 4, fmIndex: 2, fmDecay: 0.08, fmSus: 0, a: 0.001, d: 0.35, s: 0, r: 0.15, vol: 0.6 } },
  { name: 'FM Steel Drum', cat: 'FM', p: { type: 'fm', fmRatio: 1.41, fmIndex: 2.2, fmDecay: 0.3, fmSus: 0.2, a: 0.001, d: 0.5, s: 0, r: 0.3, vol: 0.5, delay: 0.2 } },
  { name: 'FM Growl Lead', cat: 'FM', p: { type: 'fm', fmRatio: 0.5, fmIndex: 5, fmDecay: 2, fmSus: 0.9, a: 0.002, d: 0.2, s: 0.8, r: 0.08, vol: 0.4, drive: 0.3 } },
  // PWM / SID
  { name: 'SID PWM Lead', cat: 'PWM', p: { type: 'pwm', duty: 0.5, pwmRate: 3, pwmDepth: 0.6, a: 0.003, d: 0.2, s: 0.7, r: 0.08, vibDepth: 16, vibDelay: 0.2, vol: 0.45 } },
  { name: 'SID PWM Pad', cat: 'PWM', p: { type: 'pwm', duty: 0.5, pwmRate: 0.8, pwmDepth: 0.8, unison: 2, uniSpread: 9, a: 0.3, d: 0.6, s: 0.7, r: 0.7, cutoff: 3200, reverb: 0.35, vol: 0.38 } },
  { name: 'SID Bass', cat: 'PWM', p: { type: 'pwm', duty: 0.3, pwmRate: 5, pwmDepth: 0.3, a: 0.001, d: 0.15, s: 0.6, r: 0.05, fType: 'lowpass', fFreq: 400, fQ: 4, fEnv: 3, fD: 0.15, fS: 0.1, vol: 0.55 } },
  // Synth (smooth + filters)
  { name: 'Supersaw Lead', cat: 'Synth', p: { type: 'ssaw', unison: 5, uniSpread: 22, a: 0.004, d: 0.2, s: 0.75, r: 0.15, cutoff: 7000, vol: 0.35, delay: 0.25 } },
  { name: 'Detuned Square', cat: 'Synth', p: { type: 'pulse', duty: 0.5, unison: 2, uniSpread: 10, a: 0.002, d: 0.2, s: 0.7, r: 0.08, vol: 0.45 } },
  { name: 'Acid Bass', cat: 'Synth', p: { type: 'ssaw', mono: true, glide: 0.05, a: 0.001, d: 0.2, s: 0.5, r: 0.05, fType: 'lowpass', fFreq: 300, fQ: 12, fEnv: 3.5, fA: 0.001, fD: 0.18, fS: 0.1, fKey: 0.3, vol: 0.5, drive: 0.2 } },
  { name: 'Square Pluck', cat: 'Synth', p: { type: 'pulse', duty: 0.25, a: 0.001, d: 0.25, s: 0, r: 0.1, fType: 'lowpass', fFreq: 500, fQ: 3, fEnv: 4, fA: 0.001, fD: 0.12, fS: 0, vol: 0.55 } },
  { name: 'Wah Lead', cat: 'Synth', p: { type: 'ssaw', a: 0.01, d: 0.2, s: 0.8, r: 0.1, fType: 'bandpass', fFreq: 900, fQ: 5, fLfoRate: 2.5, fLfoDepth: 1.5, vol: 0.5 } },
  { name: 'Sub Bass', cat: 'Synth', p: { type: 'ssine', a: 0.002, d: 0.1, s: 0.95, r: 0.06, vol: 0.8 } },
  { name: 'Sweep Pad', cat: 'Synth', p: { type: 'ssaw', unison: 3, uniSpread: 12, a: 0.6, d: 1, s: 0.8, r: 1.2, fType: 'lowpass', fFreq: 500, fQ: 4, fEnv: 2.5, fA: 1.5, fD: 2, fS: 0.4, reverb: 0.45, vol: 0.32 } },
  { name: 'Tremolo Organ', cat: 'Synth', p: { type: 'wave', wave: [8, 12, 14, 15, 14, 13, 13, 14, 15, 14, 12, 10, 9, 9, 10, 9, 7, 5, 4, 5, 6, 6, 5, 3, 1, 0, 1, 2, 2, 1, 2, 4], tremRate: 6, tremDepth: 0.5, a: 0.01, d: 0.1, s: 0.9, r: 0.08, vol: 0.45 } },
  { name: 'Choir Ooh', cat: 'Synth', p: { type: 'ssine', unison: 4, uniSpread: 16, a: 0.25, d: 0.4, s: 0.8, r: 0.5, vibDepth: 10, vibRate: 5, fType: 'peaking', fFreq: 700, fQ: 2, fGain: 9, reverb: 0.4, vol: 0.4 } },
  { name: 'Telephone Lead', cat: 'Synth', p: { type: 'pulse', duty: 0.25, a: 0.002, d: 0.2, s: 0.7, r: 0.06, hpf: 600, cutoff: 3000, slope: 24, vol: 0.6 } },
  // SFX
  { name: 'Coin', cat: 'SFX', p: { type: 'pulse', duty: 0.5, arp: 'custom', arpCustom: '0 5', arpSpeed: 14, a: 0.001, d: 0.35, s: 0, r: 0.1, vol: 0.5 } },
  { name: 'Siren', cat: 'SFX', p: { type: 'pulse', duty: 0.5, vibDepth: 300, vibRate: 2, vibDelay: 0, a: 0.01, d: 0.1, s: 1, r: 0.1, vol: 0.4 } },
  { name: 'Explosion', cat: 'SFX', p: { type: 'noise', a: 0.001, d: 0.9, s: 0, r: 0.3, fType: 'lowpass', fFreq: 300, fQ: 1, fEnv: 4, fD: 0.4, fS: 0, vol: 0.7 } },
  { name: 'Power Up', cat: 'SFX', p: { type: 'pulse', duty: 0.125, sweep: -24, sweepTime: 0.4, arp: 'off', a: 0.001, d: 0.5, s: 0, r: 0.1, vol: 0.5 } },
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
function ssawData() { const a = []; for (let i = 0; i < 256; i++) a.push(i / 128 - 1); return dcFree(a); }
function ssineData() { const a = []; for (let i = 0; i < 256; i++) a.push(Math.sin(i / 256 * Math.PI * 2)); return a; }
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
      case 'ssaw': return this.buf('ssaw', ssawData);
      case 'ssine': return this.buf('ssine', ssineData);
      case 'wave': return this.buf('w' + I.wave.join(','), () => waveData(I.wave));
      default: return this.buf('p' + I.duty, () => pulseData(I.duty));
    }
  }
  sampleBuf(id) {
    const s = SMP.get(id);
    if (!s) return null;
    const key = 'smp:' + id + ':' + s.ver;
    let b = this.bufs.get(key);
    if (!b) { b = this.ctx.createBuffer(s.ch.length, s.ch[0].length, s.rate); s.ch.forEach((d, k) => b.copyToChannel(d, k)); this.bufs.set(key, b); }
    return b;
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
    if (this.realtime) { m.analyser = c.createAnalyser(); m.analyser.fftSize = 8192; m.out.connect(m.analyser); }
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
    const bq = type => { const f = c.createBiquadFilter(); f.type = type; return f; };
    ch.hp = bq('highpass'); ch.hp2 = bq('highpass'); ch.lp = bq('lowpass'); ch.lp2 = bq('lowpass');
    ch.eqL = bq('lowshelf'); ch.eqM = bq('peaking'); ch.eqH = bq('highshelf');
    ch.eqL.frequency.value = 220; ch.eqH.frequency.value = 4000; ch.eqM.Q.value = 0.9;
    ch.crush = c.createWaveShaper(); ch.drv = c.createWaveShaper();
    ch.vol = c.createGain(); ch.pan = c.createStereoPanner(); ch.mute = c.createGain();
    ch.dSend = c.createGain(); ch.rSend = c.createGain();
    ch.input.connect(ch.hp); ch.hp.connect(ch.hp2); ch.hp2.connect(ch.lp); ch.lp.connect(ch.lp2);
    ch.lp2.connect(ch.eqL); ch.eqL.connect(ch.eqM); ch.eqM.connect(ch.eqH); ch.eqH.connect(ch.crush); ch.crush.connect(ch.drv);
    ch.drv.connect(ch.vol); ch.vol.connect(ch.pan); ch.pan.connect(ch.mute); ch.mute.connect(this.m.bus);
    ch.mute.connect(ch.dSend); ch.dSend.connect(this.m.delayIn);
    ch.mute.connect(ch.rSend); ch.rSend.connect(this.m.revIn);
    if (this.realtime) { ch.meter = c.createAnalyser(); ch.meter.fftSize = 4096; ch.mute.connect(ch.meter); }
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
    // 24 dB/oct = a second identical stage; at 12 dB/oct the extra stages sit wide open.
    const steep = I.slope >= 24;
    this.setP(ch.hp2.frequency, steep ? clamp(I.hpf, 10, ny) : 10);
    this.setP(ch.lp2.frequency, steep ? clamp(I.cutoff, 30, ny) : ny);
    this.setP(ch.lp2.Q, 0); // dB; keeps the second stage free of its own resonant peak
    this.setP(ch.hp2.Q, 0);
    this.setP(ch.eqL.gain, I.eqLow || 0);
    this.setP(ch.eqM.gain, I.eqMid || 0);
    this.setP(ch.eqM.frequency, clamp(I.eqMidF || 1000, 60, ny));
    this.setP(ch.eqH.gain, I.eqHigh || 0);
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

  // Build the raw oscillator(s) for one note: { out, nodes to start/stop, det = pitch automation target }.
  makeOsc(I, f, t) {
    const c = this.ctx, out = c.createGain(), nodes = [], params = [], offs = [];
    const n = I.type === 'noise' ? 1 : clamp(Math.round(I.unison || 1), 1, 7);
    out.gain.value = (I.type === 'pwm' ? 0.5 : 1) / Math.sqrt(n);
    for (let i = 0; i < n; i++) {
      const off = n > 1 ? (I.uniSpread || 0) * (i / (n - 1) * 2 - 1) : 0;
      if (I.type === 'fm') {
        const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
        car.frequency.value = f; mod.frequency.value = f * I.fmRatio;
        const dev = I.fmIndex * f * I.fmRatio; // peak deviation in Hz
        mg.gain.setValueAtTime(dev, t);
        mg.gain.setTargetAtTime(dev * clamp(I.fmSus, 0, 1), t, Math.max(0.005, I.fmDecay) / 3);
        mod.connect(mg); mg.connect(car.frequency); car.connect(out);
        nodes.push(car, mod); params.push(car.detune, mod.detune); offs.push(off, off);
        continue;
      }
      if (I.type === 'sample') {
        const sb = this.sampleBuf(I.sample);
        if (!sb) break;
        const src = c.createBufferSource();
        src.buffer = sb;
        src.playbackRate.value = f / mtof(I.sRoot || 60);
        if (I.sLoop) { src.loop = true; src.loopStart = clamp(I.sLs, 0, 1) * sb.duration; src.loopEnd = Math.max(src.loopStart + 0.002, clamp(I.sLe, 0, 1) * sb.duration); }
        src.connect(out);
        src.startOffset = clamp(I.sStart || 0, 0, 0.99) * sb.duration;
        nodes.push(src); params.push(src.detune); offs.push(off);
        continue;
      }
      const src = c.createBufferSource();
      src.loop = true;
      if (I.type === 'noise') {
        const short = I.noiseMode === 'short';
        src.buffer = this.noiseBuf(short);
        src.playbackRate.value = f * (short ? 93 : 32) / c.sampleRate;
      } else {
        src.buffer = I.type === 'pwm' ? this.buf('ssaw', ssawData) : this.waveBuf(I);
        src.playbackRate.value = f * src.buffer.length / c.sampleRate;
      }
      src.connect(out);
      if (I.type === 'pwm') {
        // Pulse = saw minus a delayed saw; sweeping the delay sweeps the pulse width.
        const dl = c.createDelay(0.2), inv = c.createGain(), lg = c.createGain(), lfo = c.createOscillator();
        const w = clamp(I.duty, 0.05, 0.95);
        dl.delayTime.value = w / f;
        inv.gain.value = -1;
        lfo.type = 'triangle'; lfo.frequency.value = I.pwmRate * (1 + i * 0.13);
        lg.gain.value = clamp(I.pwmDepth, 0, 1) * Math.min(w, 1 - w) * 0.95 / f;
        lfo.connect(lg); lg.connect(dl.delayTime);
        src.connect(dl); dl.connect(inv); inv.connect(out);
        nodes.push(lfo);
      }
      nodes.push(src); params.push(src.detune); offs.push(off);
    }
    const det = {
      setValueAtTime(v, tt) { params.forEach((p, i) => p.setValueAtTime(v + offs[i], tt)); },
      linearRampToValueAtTime(v, tt) { params.forEach((p, i) => p.linearRampToValueAtTime(v + offs[i], tt)); },
      connectFrom(node) { for (const p of params) node.connect(p); },
    };
    return { out, nodes, det };
  }

  // Schedule a note. dur in seconds, or null for a held (live) note that returns a voice with release().
  noteOn(tr, pitch, vel, t, dur, register) {
    const ch = this.chains.get(tr.id);
    if (!ch) return null;
    const I = tr.inst, c = this.ctx;
    if (I.type === 'drums') { this.drum(ch, I, pitch, vel, t, register); return null; }
    const p = pitch + 12 * (I.octave || 0);
    const osc = this.makeOsc(I, mtof(p), t), nodes = osc.nodes;
    if (I.type === 'sample' && I.sOneShot && !I.sLoop) {
      // one-shot: play the whole sound whatever the note length
      const sb = this.sampleBuf(I.sample);
      if (sb) dur = sb.duration * (1 - clamp(I.sStart || 0, 0, 0.99)) / (mtof(p) / mtof(I.sRoot || 60));
    }
    const A = Math.max(0.001, I.a), D = Math.max(0.002, I.d), S = clamp(I.s, 0, 1), R = Math.max(0.004, I.r);
    const base = I.detune || 0, det = osc.det;
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

    const lfoNode = (rate, type) => { const o = c.createOscillator(); o.type = type || 'triangle'; o.frequency.value = rate; nodes.push(o); return o; };
    if (I.vibDepth > 0) {
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, t + I.vibDelay);
      lg.gain.linearRampToValueAtTime(I.vibDepth, t + I.vibDelay + 0.12);
      lfoNode(I.vibRate).connect(lg); det.connectFrom(lg);
    }

    let post = osc.out;
    if (I.fType && I.fType !== 'off') {
      // Per-note filter: envelope and LFO move it in cents via detune, so key tracking stays exact.
      const vf = c.createBiquadFilter(), ny = c.sampleRate / 2 - 200;
      vf.type = I.fType;
      vf.frequency.value = clamp(I.fFreq * Math.pow(2, (p - 60) / 12 * (I.fKey || 0)), 20, ny);
      vf.Q.value = I.fQ; vf.gain.value = I.fGain;
      const amt = (I.fEnv || 0) * 1200, fA = Math.max(0.001, I.fA);
      if (amt) {
        vf.detune.setValueAtTime(0, t);
        vf.detune.linearRampToValueAtTime(amt, t + fA);
        vf.detune.setTargetAtTime(amt * clamp(I.fS, 0, 1), t + fA, Math.max(0.003, I.fD) / 3);
      }
      if (I.fLfoDepth > 0) { const fg = c.createGain(); fg.gain.value = I.fLfoDepth * 1200; lfoNode(I.fLfoRate, 'sine').connect(fg); fg.connect(vf.detune); }
      post.connect(vf); post = vf;
    }
    if (I.tremDepth > 0) {
      const tg = c.createGain(), td = c.createGain(), dep = clamp(I.tremDepth, 0, 1) / 2;
      tg.gain.value = 1 - dep; td.gain.value = dep;
      lfoNode(I.tremRate, 'sine').connect(td); td.connect(tg.gain);
      post.connect(tg); post = tg;
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
    post.connect(g); g.connect(ch.input);
    for (const n of nodes) n.start(t, n.startOffset || 0);
    const stopAll = end => { for (const n of nodes) n.stop(end); };
    if (dur != null) {
      const end = t + dur + R + 0.03;
      stopAll(end);
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
        stopAll(t2 + R + 0.03);
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
    const K = DRUM_KITS[I.kit] || DRUM_KITS.chip;
    const body = K.body === 'sine' ? this.buf('ssine', ssineData) : K.body === 'pulse' ? pulse50 : null;
    switch (pitch) {
      case 36: tone(K.kick[0], K.kick[1], K.kick[2], v * 1.6, body); noise(0.5, 0.012, v * K.click); break;
      case 38: noise(K.snare[0], K.snare[1], v * 0.95, K.snare[2], K.short); tone(230, 150, 0.07, v * 0.7, pulse50); break;
      case 39: noise(0.9, 0.018, v * 0.8, 1200, false, 0); noise(0.9, 0.018, v * 0.8, 1200, false, 0.012); noise(0.9, 0.16, v * 0.75, 1200, false, 0.024); break;
      case 37: tone(820, 760, 0.03, v * 0.8, pulse50); break;
      case 42: noise(K.hat[0], K.hat[1], v * 0.55, K.hat[2], K.short); break;
      case 46: noise(K.hat[0], K.hat[3], v * 0.45, K.hat[2] - 1000, K.short); break;
      case 49: noise(1.1, 1.3, v * 0.5, 3500); noise(1.3, 0.6, v * 0.18, 5000, true); break;
      case 45: tone(140 * K.tom, 72 * K.tom, 0.3, v * 1.2, body); break;
      case 47: tone(190 * K.tom, 98 * K.tom, 0.28, v * 1.2, body); break;
      case 50: tone(260 * K.tom, 135 * K.tom, 0.26, v * 1.2, body); break;
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
