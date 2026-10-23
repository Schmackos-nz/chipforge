'use strict';
// Mixer: one strip per track + master with delay, reverb, compressor and a scope.

const MIX = {
  meters: [],

  render() {
    const root = $('#mixer');
    root.innerHTML = '';
    const sw = $('#specwrap'); sw.innerHTML = ''; sw.append(SPEC.panel());
    this.meters = [];
    const s = App.song;
    let armed = false;
    const start = () => { if (!armed) { pushUndo(); armed = true; setTimeout(() => { armed = false; }, 400); } };
    for (const tr of s.tracks) {
      const fader = h('input', { type: 'range', class: 'vfader', min: 0, max: 120, value: Math.round(tr.inst.vol * 100), title: 'Volume' });
      fader.addEventListener('pointerdown', start);
      fader.oninput = () => { tr.inst.vol = fader.value / 100; db.textContent = this.dbText(tr.inst.vol); AE.sync(); autosave(); INST.render(true); };
      const db = h('div', { class: 'db' }, this.dbText(tr.inst.vol));
      const meter = h('canvas', { width: 14, height: 170 });
      this.meters.push({ cv: meter, id: tr.id });
      const mb = h('button', { class: 'm' + (tr.mute ? ' on' : ''), onclick: () => { pushUndo(); tr.mute = !tr.mute; changed({ lists: true }); } }, 'M');
      const sb = h('button', { class: 's' + (tr.solo ? ' on' : ''), onclick: () => { pushUndo(); tr.solo = !tr.solo; changed({ lists: true }); } }, 'S');
      const K = (k, label, min, max, fmt) => Knob({ label, min, max, value: tr.inst[k], def: defaultInst()[k], fmt, onStart: start, onInput: v => { tr.inst[k] = v; AE.sync(); autosave(); INST.render(true); } });
      const strip = h('div', { class: 'strip' + (tr.id === App.selTrack ? ' sel' : ''), onmousedown: () => { if (App.selTrack !== tr.id) UI.selectTrack(tr.id); } },
        h('div', { class: 'snm', style: { borderTopColor: tr.color }, title: tr.name }, tr.name),
        K('pan', 'Pan', -1, 1, fmtPan),
        h('div', { class: 'fadr' }, fader, meter),
        db,
        h('div', { class: 'row' }, mb, sb),
        K('delay', 'Delay', 0, 1, fmtPct),
        K('reverb', 'Reverb', 0, 1, fmtPct),
        K('cutoff', 'LPF', 40, 20000, fmtHz),
      );
      root.append(strip);
    }
    // master
    const M = s.master;
    const MK = (k, label, min, max, fmt, o) => Knob(Object.assign({ label, min, max, value: M[k], fmt, onStart: start, onInput: v => { M[k] = v; AE.sync(); autosave(); } }, o || {}));
    const mf = h('input', { type: 'range', class: 'vfader', min: 0, max: 120, value: Math.round(M.vol * 100) });
    mf.addEventListener('pointerdown', start);
    mf.oninput = () => { M.vol = mf.value / 100; mdb.textContent = this.dbText(M.vol); $('#masterVol').value = mf.value; AE.sync(); autosave(); };
    const mdb = h('div', { class: 'db' }, this.dbText(M.vol));
    const mm = h('canvas', { width: 14, height: 170 });
    this.meters.push({ cv: mm, id: 'master' });
    const delaySel = h('select', null, [[0.25, '1/16'], [0.5, '1/8'], [0.75, '1/8 dotted'], [1, '1/4'], [1.5, '1/4 dotted'], [2, '1/2']].map(([v, l]) => h('option', { value: v, selected: M.delayBeats === v }, l)));
    delaySel.onchange = () => { pushUndo(); M.delayBeats = +delaySel.value; AE.sync(); autosave(); };
    const comp = h('button', { class: 'tog' + (M.comp ? ' on' : ''), title: 'Glue compressor on the master' }, 'Compressor');
    comp.onclick = () => { pushUndo(); M.comp = !M.comp; comp.classList.toggle('on', M.comp); AE.sync(); autosave(); };
    root.append(h('div', { class: 'strip master' },
      h('div', { class: 'snm', style: { borderTopColor: '#7cf28a' } }, 'MASTER'),
      h('div', { class: 'fadr' }, mf, mm),
      mdb,
      h('div', { class: 'irow', style: { width: '100%' } }, h('label', null, 'Delay'), delaySel),
      h('div', { class: 'knobs' },
        MK('delayFb', 'Feedback', 0, 0.9, fmtPct),
        MK('delayRet', 'Delay vol', 0, 1.5, fmtPct),
        MK('revSize', 'Rev size', 0.2, 6, x => x.toFixed(1) + 's'),
        MK('revRet', 'Rev vol', 0, 1.5, fmtPct)),
      comp));
  },
  dbText(v) { return v <= 0.0001 ? '-∞ dB' : (20 * Math.log10(v)).toFixed(1) + ' dB'; },
  syncValues() { if (App.view === 'mixer') this.render(); },

  buf: new Float32Array(2048),
  tick() {
    if (App.view !== 'mixer' || !AE.engine) return;
    for (const m of this.meters) {
      const an = m.id === 'master' ? AE.engine.m.analyser : (AE.engine.chains.get(m.id) || {}).meter;
      if (!an) continue;
      const n = an.fftSize, b = this.buf.length >= n ? this.buf.subarray(0, n) : (this.buf = new Float32Array(n));
      an.getFloatTimeDomainData(b);
      let pk = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(b[i]); if (a > pk) pk = a; }
      m.level = Math.max(pk, (m.level || 0) * 0.9);
      const g = m.cv.getContext('2d'), H = m.cv.height, W = m.cv.width;
      const db = 20 * Math.log10(m.level + 1e-6), frac = clamp((db + 48) / 54, 0, 1);
      g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
      const grd = g.createLinearGradient(0, H, 0, 0);
      grd.addColorStop(0, '#3fbf5a'); grd.addColorStop(0.7, '#d8e04a'); grd.addColorStop(1, '#ff5050');
      g.fillStyle = grd; g.fillRect(2, H - frac * H, W - 4, frac * H);
    }
  },
};
