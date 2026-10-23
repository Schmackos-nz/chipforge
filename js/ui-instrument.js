'use strict';
// Right-hand instrument / channel settings panel.

const INST = {
  trackId: null,

  sampleBox(tr, apply, K) {
    const I = tr.inst, smp = SMP.get(I.sample);
    const load = async () => {
      const f = await pickFile('audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm');
      if (!f) return;
      try {
        const ns = await SMP.fromFile(f);
        pushUndo();
        I.sample = ns.id; I.sLs = 0; I.sLe = 1; I.sStart = 0;
        if (/^(Track|Sample)/.test(tr.name)) tr.name = ns.name.slice(0, 24);
        changed({ lists: true });
        this.render(true);
        toast('Loaded ' + ns.name);
      } catch (e) { toast('Could not read that audio file', 3500); }
    };
    const cv = h('canvas', { class: 'smpthumb', height: 60, title: smp ? 'Click to edit the waveform' : 'Load a sound file', onclick: () => (smp ? openSampleEditor(tr) : load()) });
    requestAnimationFrame(() => {
      const r = window.devicePixelRatio || 1, W = Math.round((cv.clientWidth || 280) * r), H = 60 * r;
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
      if (!smp) { g.fillStyle = '#5b6680'; g.font = (12 * r) + 'px sans-serif'; g.textAlign = 'center'; g.fillText('No sound — click to load a file', W / 2, H / 2 + 4 * r); return; }
      const n = SMP.len(smp);
      if (I.sLoop) { g.fillStyle = 'rgba(255,207,90,0.12)'; g.fillRect(I.sLs * W, 0, (I.sLe - I.sLs) * W, H); }
      drawWave(g, smp, 0, n, W, H);
      if (I.sStart > 0) { g.fillStyle = '#6cc6ff'; g.fillRect(I.sStart * W, 0, 2 * r, H); }
    });
    const rootSel = h('select', { title: 'The note that plays the sound at its original pitch' },
      Array.from({ length: 73 }, (_, i) => i + 24).map(p => h('option', { value: p, selected: p === (I.sRoot || 60) }, noteName(p))));
    rootSel.onchange = () => { pushUndo(); apply('sRoot', +rootSel.value); };
    const chk = (k, label, title) => h('label', { title }, h('input', { type: 'checkbox', checked: !!I[k], onchange: e => { pushUndo(); apply(k, e.target.checked, true); } }), ' ' + label);
    return h('div', null,
      h('div', { class: 'irow' }, h('button', { onclick: load, title: 'WAV, MP3, OGG, FLAC… (also: drop a file on the window)' }, '📂 Load sound…'),
        smp ? h('button', { onclick: () => openSampleEditor(tr), title: 'Cut, trim, fade, reverse, crush…' }, '✂ Edit wave…') : null),
      cv,
      smp ? h('div', { class: 'irow dim', style: { fontSize: '11px' } }, smp.name + ' · ' + (SMP.len(smp) / smp.rate).toFixed(2) + 's') : null,
      h('div', { class: 'irow' }, h('label', null, 'Root'), rootSel),
      h('div', { class: 'irow' }, chk('sOneShot', 'One-shot', 'Play the whole sound however short the note is (drums, hits)'),
        chk('sLoop', 'Loop', 'Repeat the loop region while the note is held — set it in the editor')),
      h('div', { class: 'knobs' }, K('sStart', 'Start', 0, 0.99, { fmt: fmtPct, title: 'Skip into the sound'})));
  },

  render(force) {
    const tr = getTrack(App.selTrack);
    $('#instTrackName').textContent = tr ? '— ' + tr.name : '';
    if (!force && tr && tr.id === this.trackId) return;
    this.trackId = tr ? tr.id : null;
    const root = $('#inst');
    root.innerHTML = '';
    if (!tr) { root.append(h('div', { class: 'empty' }, 'Add a track to edit its instrument.')); return; }
    const I = tr.inst;
    let undoArmed = false;
    const start = () => { if (!undoArmed) { pushUndo(); undoArmed = true; setTimeout(() => { undoArmed = false; }, 400); } };
    const apply = (k, v, rebuild) => {
      I[k] = v;
      AE.sync();
      autosave();
      if (k === 'mono' || k === 'type') Transport.markDirty();
      if (rebuild) { this.render(true); UI.render({ lists: true }); }
      if ('adsr'.includes(k) && this.envCv) this.drawEnv();
      if (k === 'vol' || k === 'pan') MIX.syncValues();
    };
    const K = (k, label, min, max, o) => Knob(Object.assign({
      label, min, max, value: I[k], def: defaultInst()[k], onStart: start, onInput: v => apply(k, v),
    }, o || {}));
    const sec = (title, ...kids) => h('div', { class: 'isec' }, h('h4', null, title), h('div', { class: 'body' }, ...kids));

    // Preset + type
    const presetSel = h('select', { title: 'Load a preset' }, h('option', { value: '' }, 'Load preset…'));
    const cats = {};
    for (const p of PRESETS) (cats[p.cat] = cats[p.cat] || []).push(p);
    for (const c in cats) presetSel.append(h('optgroup', { label: c }, cats[c].map(p => h('option', { value: p.name }, p.name))));
    presetSel.onchange = () => {
      const pr = presetByName(presetSel.value);
      if (!pr) return;
      pushUndo();
      applyPreset(I, pr);
      changed({ lists: true });
      this.render(true);
      toast('Preset: ' + pr.name);
    };
    const typeSel = h('select', null, INST_TYPES.map(([v, l]) => h('option', { value: v, selected: v === I.type }, l)));
    typeSel.onchange = () => { pushUndo(); apply('type', typeSel.value, true); };
    const nameIn = h('input', { value: tr.name, style: { flex: 1, minWidth: 0 } });
    nameIn.onchange = () => { pushUndo(); tr.name = nameIn.value.trim() || tr.name; changed({ lists: true }); };
    const colorIn = h('input', { type: 'color', value: tr.color, style: { width: '34px', padding: '0 2px', height: '24px' } });
    colorIn.oninput = () => { tr.color = colorIn.value; changed({ lists: true }); };

    root.append(sec('Channel',
      h('div', { class: 'irow' }, nameIn, colorIn),
      h('div', { class: 'irow' }, h('label', null, 'Type'), typeSel),
      h('div', { class: 'irow' }, presetSel),
      h('div', { class: 'irow' }, h('button', { onclick: () => this.preview(), title: 'Play a test note' }, '▶ Test note'),
        I.type === 'drums' ? null : h('label', { title: 'Monophonic: one note at a time (needed for glide/legato)' },
          h('input', { type: 'checkbox', checked: I.mono, onchange: e => { pushUndo(); apply('mono', e.target.checked); } }), ' Mono / legato'))));

    // Oscillator
    const osc = [];
    if (I.type === 'pulse' || I.type === 'pwm') {
      const seg = h('div', { class: 'seg dutyseg' }, [0.125, 0.25, 0.5, 0.75].map(d => h('button', {
        class: I.duty === d ? 'on' : '', onclick: () => { pushUndo(); apply('duty', d, true); },
      }, (d * 100) + '%')));
      osc.push(h('div', { class: 'irow' }, h('label', null, 'Duty'), seg));
    }
    if (I.type === 'noise') {
      const seg = h('div', { class: 'seg dutyseg' }, [['long', 'White (long)'], ['short', 'Metallic (short)']].map(([m, l]) => h('button', {
        class: I.noiseMode === m ? 'on' : '', onclick: () => { pushUndo(); apply('noiseMode', m, true); },
      }, l)));
      osc.push(h('div', { class: 'irow' }, h('label', null, 'Mode'), seg));
    }
    if (I.type === 'wave') osc.push(this.waveEditor(tr, start));
    if (I.type === 'sample') osc.push(this.sampleBox(tr, apply, K));
    if (I.type === 'fm') {
      osc.push(h('div', { class: 'knobs' },
        K('fmRatio', 'Ratio', 0.25, 8, { step: 0.25, fmt: x => x.toFixed(2) + 'x', title: 'Modulator frequency ÷ carrier. Whole numbers = harmonic, others = bell/metal' }),
        K('fmIndex', 'Index', 0, 10, { fmt: x => x.toFixed(1), title: 'How much the modulator bends the tone (brightness)' }),
        K('fmDecay', 'Idx decay', 0.01, 3, { log: true, fmt: fmtSec, title: 'How fast the brightness falls' }),
        K('fmSus', 'Idx sustain', 0, 1, { fmt: fmtPct, title: 'Brightness held after the decay' })));
    }
    if (I.type === 'pwm') {
      osc.push(h('div', { class: 'knobs' },
        K('pwmRate', 'PWM rate', 0.05, 15, { log: true, fmt: x => x.toFixed(2) + 'Hz' }),
        K('pwmDepth', 'PWM depth', 0, 1, { fmt: fmtPct })));
    }
    if (I.type === 'drums') {
      const kitSel = h('select', null, KIT_TYPES.map(([v, l]) => h('option', { value: v, selected: (I.kit || 'chip') === v }, l)));
      kitSel.onchange = () => { pushUndo(); apply('kit', kitSel.value); this.preview(); };
      osc.push(h('div', { class: 'irow' }, h('label', null, 'Kit'), kitSel));
      osc.push(h('div', { class: 'knobs' },
        K('kitTune', 'Tune', -12, 12, { step: 1, fmt: x => (x > 0 ? '+' : '') + x + 'st' }),
        K('kitDecay', 'Decay', 0.25, 3, { fmt: x => x.toFixed(2) + 'x' })));
      osc.push(h('div', { class: 'empty', style: { padding: '6px 0 0' } }, 'Kit rows: Kick, Snare, Rim, Clap, Closed/Open Hat, 3 Toms, Crash, Cowbell. Use the piano roll — each row is one drum.'));
    } else {
      osc.push(h('div', { class: 'knobs' },
        K('octave', 'Octave', -3, 3, { step: 1, fmt: x => (x > 0 ? '+' : '') + x }),
        K('detune', 'Fine', -100, 100, { step: 1, fmt: x => Math.round(x) + 'c' }),
        I.type === 'noise' ? null : K('unison', 'Unison', 1, 7, { step: 1, fmt: x => x + (x > 1 ? ' voices' : ' voice'), title: 'Stack detuned copies for a fatter sound' }),
        I.type === 'noise' ? null : K('uniSpread', 'Spread', 0, 50, { fmt: x => Math.round(x) + 'c', title: 'Detune between unison voices' })));
    }
    root.append(sec('Oscillator', ...osc));

    if (I.type !== 'drums') {
      this.envCv = h('canvas', { class: 'envc', height: 54 });
      root.append(sec('Envelope (ADSR)',
        this.envCv,
        h('div', { class: 'knobs', style: { marginTop: '6px' } },
          K('a', 'Attack', 0.001, 2, { log: true, fmt: fmtSec, color: '#ffcf5a' }),
          K('d', 'Decay', 0.005, 3, { log: true, fmt: fmtSec, color: '#ffcf5a' }),
          K('s', 'Sustain', 0, 1, { fmt: fmtPct, color: '#ffcf5a' }),
          K('r', 'Release', 0.005, 4, { log: true, fmt: fmtSec, color: '#ffcf5a' }))));
      requestAnimationFrame(() => this.drawEnv());
    } else this.envCv = null;

    const slopeSeg = h('div', { class: 'seg dutyseg' }, [12, 24].map(sl => h('button', {
      class: (I.slope >= 24 ? 24 : 12) === sl ? 'on' : '', onclick: () => { pushUndo(); apply('slope', sl, true); },
    }, sl + ' dB/oct')));
    root.append(sec('Pass filters',
      h('div', { class: 'irow' }, h('label', null, 'Slope'), slopeSeg),
      h('div', { class: 'knobs' },
        K('cutoff', 'Low-pass', 40, 20000, { log: true, fmt: fmtHz, color: '#6cc6ff' }),
        K('reso', 'Reso', 0.1, 20, { log: true, color: '#6cc6ff' }),
        K('hpf', 'High-pass', 10, 8000, { log: true, fmt: fmtHz, color: '#6cc6ff' }))));

    if (I.type !== 'drums') {
      const fSel = h('select', null, FILTER_TYPES.map(([v, l]) => h('option', { value: v, selected: (I.fType || 'off') === v }, l)));
      fSel.onchange = () => { pushUndo(); apply('fType', fSel.value, true); };
      const on = I.fType && I.fType !== 'off', gainy = ['peaking', 'lowshelf', 'highshelf'].includes(I.fType);
      root.append(sec('Filter envelope (per note)',
        h('div', { class: 'irow' }, h('label', null, 'Type'), fSel),
        on ? h('div', { class: 'knobs' },
          K('fFreq', 'Cutoff', 20, 16000, { log: true, fmt: fmtHz, color: '#6cc6ff', title: 'Base frequency at middle C' }),
          K('fQ', gainy ? 'Width' : 'Reso', 0.1, 25, { log: true, color: '#6cc6ff' }),
          gainy ? K('fGain', 'Gain', -24, 24, { fmt: x => (x > 0 ? '+' : '') + x.toFixed(1) + 'dB', color: '#6cc6ff' }) : null,
          K('fKey', 'Key track', 0, 1, { fmt: fmtPct, color: '#6cc6ff', title: 'How much the cutoff follows the note pitch' }),
          K('fEnv', 'Env amount', -6, 6, { fmt: x => (x > 0 ? '+' : '') + x.toFixed(1) + ' oct', color: '#4fe0c0', title: 'How far the envelope sweeps the cutoff' }),
          K('fA', 'Env attack', 0.001, 3, { log: true, fmt: fmtSec, color: '#4fe0c0' }),
          K('fD', 'Env decay', 0.005, 4, { log: true, fmt: fmtSec, color: '#4fe0c0' }),
          K('fS', 'Env sustain', 0, 1, { fmt: fmtPct, color: '#4fe0c0' }),
          K('fLfoRate', 'LFO rate', 0.05, 20, { log: true, fmt: x => x.toFixed(2) + 'Hz', color: '#4fe0c0' }),
          K('fLfoDepth', 'LFO depth', 0, 4, { fmt: x => x.toFixed(2) + ' oct', color: '#4fe0c0', title: 'Wobble / wah amount' })) : null));
    }

    root.append(sec('EQ',
      h('div', { class: 'knobs' },
        K('eqLow', 'Low', -18, 18, { fmt: x => (x > 0 ? '+' : '') + x.toFixed(1) + 'dB', color: '#9be36c' }),
        K('eqMid', 'Mid', -18, 18, { fmt: x => (x > 0 ? '+' : '') + x.toFixed(1) + 'dB', color: '#9be36c' }),
        K('eqMidF', 'Mid freq', 150, 8000, { log: true, fmt: fmtHz, color: '#9be36c' }),
        K('eqHigh', 'High', -18, 18, { fmt: x => (x > 0 ? '+' : '') + x.toFixed(1) + 'dB', color: '#9be36c' }))));

    if (I.type !== 'drums') {
      const arpSel = h('select', null, Object.keys(ARP_MODES).map(k => h('option', { value: k, selected: I.arp === k }, ARP_LABELS[k])));
      arpSel.onchange = () => { pushUndo(); apply('arp', arpSel.value, true); };
      const custom = I.arp === 'custom' ? h('input', { value: I.arpCustom, title: 'Semitone offsets, e.g. 0 4 7 12', style: { width: '90px' },
        onchange: e => { pushUndo(); apply('arpCustom', e.target.value); } }) : null;
      root.append(sec('Pitch & Modulation',
        h('div', { class: 'irow' }, h('label', null, 'Chip arp'), arpSel, custom),
        h('div', { class: 'knobs' },
          K('arpSpeed', 'Arp rate', 4, 60, { fmt: x => x.toFixed(0) + 'Hz', color: '#b48cff' }),
          K('vibDepth', 'Vib depth', 0, 100, { fmt: x => Math.round(x) + 'c', color: '#b48cff' }),
          K('vibRate', 'Vib rate', 0.5, 20, { fmt: x => x.toFixed(1) + 'Hz', color: '#b48cff' }),
          K('vibDelay', 'Vib delay', 0, 1, { fmt: fmtSec, color: '#b48cff' }),
          K('sweep', 'Pitch env', -36, 36, { step: 1, fmt: x => (x > 0 ? '+' : '') + x + 'st', color: '#b48cff', title: 'Start this many semitones away and slide to the note' }),
          K('sweepTime', 'Env time', 0.01, 1, { log: true, fmt: fmtSec, color: '#b48cff' }),
          K('glide', 'Glide', 0, 0.5, { fmt: fmtSec, color: '#b48cff', title: 'Portamento from the previous note' }),
          K('tremDepth', 'Tremolo', 0, 1, { fmt: fmtPct, color: '#b48cff', title: 'Volume wobble' }),
          K('tremRate', 'Trem rate', 0.5, 20, { log: true, fmt: x => x.toFixed(1) + 'Hz', color: '#b48cff' }))));
    }

    root.append(sec('Character',
      h('div', { class: 'knobs' },
        K('bits', 'Bit depth', 1, 16, { step: 1, fmt: x => (x >= 16 ? 'off' : x + '-bit'), color: '#ff7ab6' }),
        K('drive', 'Drive', 0, 1, { fmt: fmtPct, color: '#ff7ab6' }))));

    root.append(sec('Output',
      h('div', { class: 'knobs' },
        K('vol', 'Volume', 0, 1.2, { fmt: fmtPct }),
        K('pan', 'Pan', -1, 1, { fmt: fmtPan }),
        K('delay', 'Delay send', 0, 1, { fmt: fmtPct }),
        K('reverb', 'Reverb send', 0, 1, { fmt: fmtPct }))));
  },

  preview() {
    const tr = getTrack(App.selTrack);
    if (!tr) return;
    const eng = AE.ensure();
    const p = tr.inst.type === 'drums' ? 38 : 60;
    eng.noteOn(tr, p, 110, AE.ctx.currentTime + 0.01, 0.35, false);
  },

  drawEnv() {
    const cv = this.envCv, tr = getTrack(App.selTrack);
    if (!cv || !tr || !cv.isConnected) return;
    const I = tr.inst, dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 280, H = 54;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    const hold = 0.25, total = I.a + I.d + hold + I.r, x = t => 4 + (t / total) * (W - 8), y = v => H - 5 - v * (H - 10);
    g.strokeStyle = '#ffcf5a'; g.lineWidth = 2; g.beginPath();
    g.moveTo(x(0), y(0)); g.lineTo(x(I.a), y(1)); g.lineTo(x(I.a + I.d), y(I.s)); g.lineTo(x(I.a + I.d + hold), y(I.s)); g.lineTo(x(total), y(0));
    g.stroke();
    g.fillStyle = 'rgba(255,207,90,.12)'; g.lineTo(x(0), y(0)); g.fill();
  },

  waveEditor(tr, start) {
    const I = tr.inst, cv = h('canvas', { class: 'wavec', height: 96 });
    const draw = () => {
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 280, H = 96;
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
      const cw = W / 32, chh = H / 16;
      g.strokeStyle = '#1c2029';
      for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(0, i * chh); g.lineTo(W, i * chh); g.stroke(); }
      g.fillStyle = tr.color;
      for (let i = 0; i < 32; i++) g.fillRect(i * cw + 1, H - (I.wave[i] + 1) * chh, cw - 2, chh - 1);
    };
    let painting = false;
    const paint = e => {
      const r = cv.getBoundingClientRect();
      const i = clamp(Math.floor((e.clientX - r.left) / r.width * 32), 0, 31);
      const v = clamp(15 - Math.floor((e.clientY - r.top) / r.height * 16), 0, 15);
      if (I.wave[i] !== v) { I.wave[i] = v; draw(); AE.sync(); }
    };
    cv.addEventListener('pointerdown', e => { start(); painting = true; cv.setPointerCapture(e.pointerId); I.wave = I.wave.slice(); paint(e); });
    cv.addEventListener('pointermove', e => { if (painting) paint(e); });
    cv.addEventListener('pointerup', () => { painting = false; autosave(); this.preview(); });
    const shapes = {
      Sine: i => Math.round(7.5 + 7.5 * Math.sin(i / 32 * Math.PI * 2)),
      Tri: i => (i < 16 ? i : 31 - i),
      Saw: i => Math.floor(i / 2),
      Square: i => (i < 16 ? 15 : 0),
      Organ: i => Math.round(7.5 + 3.5 * Math.sin(i / 32 * Math.PI * 2) + 2.5 * Math.sin(i / 16 * Math.PI * 2) + 1.5 * Math.sin(i / 8 * Math.PI * 2)),
      Random: () => Math.floor(Math.random() * 16),
    };
    const btns = h('div', { class: 'irow', style: { marginTop: '6px' } }, Object.keys(shapes).map(k => h('button', {
      style: { padding: '1px 6px', fontSize: '11px' },
      onclick: () => { pushUndo(); I.wave = Array.from({ length: 32 }, (_, i) => clamp(shapes[k](i), 0, 15)); draw(); AE.sync(); autosave(); this.preview(); },
    }, k)));
    requestAnimationFrame(draw);
    return h('div', null, h('label', { style: { color: 'var(--dim)', fontSize: '11px' } }, 'Draw the 32-step × 4-bit wave'), cv, btns);
  },
};
