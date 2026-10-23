'use strict';
// Spectrum analyser: a big log-frequency view above the mixer (master or any track) and a mini one in the top bar.

const SPEC = {
  src: 'master',
  mode: 'bars',      // 'bars' (chunky chip-style bands) | 'curve'
  hold: true,        // peak-hold line that falls slowly
  hover: null,       // x in css px while the mouse is over the big view
  peaks: new Map(),  // canvas -> Float32Array of held dB per column
  bufs: new Map(),   // analyser -> Float32Array
  FMIN: 20, FMAX: 20000, DBMIN: -96, DBMAX: -6,

  analyser(id) {
    if (!AE.engine) return null;
    if (id === 'master') return AE.engine.m.analyser || null;
    return (AE.engine.chains.get(id) || {}).meter || null;
  },

  // dB per column: each column averages (power) the bins inside its log-spaced frequency slice
  columns(an, n) {
    let b = this.bufs.get(an);
    if (!b || b.length !== an.frequencyBinCount) { b = new Float32Array(an.frequencyBinCount); this.bufs.set(an, b); }
    an.getFloatFrequencyData(b);
    const ny = an.context.sampleRate / 2, bins = b.length, out = new Float32Array(n), lr = Math.log(this.FMAX / this.FMIN);
    for (let i = 0; i < n; i++) {
      const f0 = this.FMIN * Math.exp(lr * i / n), f1 = this.FMIN * Math.exp(lr * (i + 1) / n);
      let a = f0 / ny * bins, z = f1 / ny * bins;
      if (z - a < 1) {
        // narrower than a bin: interpolate so the low end doesn't look like stairs
        const x = (a + z) / 2, j = Math.min(bins - 2, Math.floor(x)), t = x - j;
        out[i] = b[j] * (1 - t) + b[j + 1] * t;
      } else {
        let s = 0, c = 0;
        for (let j = Math.floor(a); j < Math.min(bins, Math.ceil(z)); j++) { s += Math.pow(10, b[j] / 10); c++; }
        out[i] = c ? 10 * Math.log10(s / c + 1e-20) : -200;
      }
    }
    return out;
  },

  draw(cv, an, o) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, r = o.dpr || 1;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    const fx = f => Math.log(f / this.FMIN) / Math.log(this.FMAX / this.FMIN) * W;
    const fy = db => (1 - clamp((db - this.DBMIN) / (this.DBMAX - this.DBMIN), 0, 1)) * H;
    if (o.grid) {
      g.font = (10 * r) + 'px Consolas, monospace'; g.textBaseline = 'top';
      for (const db of [-12, -24, -36, -48, -60, -72, -84]) {
        const y = Math.round(fy(db)) + 0.5;
        g.strokeStyle = '#1a1f2b'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        g.fillStyle = '#4a5368'; g.fillText(db + '', W - 26 * r, y + 2);
      }
      for (const f of [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000]) {
        const x = Math.round(fx(f)) + 0.5, major = /^[125]/.test(String(f));
        g.strokeStyle = major ? '#222838' : '#171b25'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
        if (major && f < 20000) { g.fillStyle = '#5b6680'; g.fillText(f >= 1000 ? f / 1000 + 'k' : f + '', x + 3 * r, H - 12 * r); }
      }
    }
    if (!an) return;
    const bands = o.mode === 'bars' ? (o.bands || 48) : Math.max(32, Math.floor(W / (2 * r)));
    const col = this.columns(an, bands);
    let pk = this.peaks.get(cv);
    if (!pk || pk.length !== bands) { pk = new Float32Array(bands).fill(-200); this.peaks.set(cv, pk); }
    for (let i = 0; i < bands; i++) pk[i] = col[i] > pk[i] ? col[i] : pk[i] - 0.6;

    const grd = g.createLinearGradient(0, H, 0, 0);
    grd.addColorStop(0, '#2f9e4b'); grd.addColorStop(0.55, '#7cf28a'); grd.addColorStop(0.8, '#d8e04a'); grd.addColorStop(1, '#ff5050');
    if (o.mode === 'bars') {
      const bw = W / bands, seg = Math.max(2, Math.round(H / (o.grid ? 40 : 9)));
      g.fillStyle = grd;
      for (let i = 0; i < bands; i++) {
        const y = fy(col[i]), x = Math.floor(i * bw) + 1, w = Math.max(1, Math.floor(bw) - (bw > 4 ? 2 : 1));
        // snap the bar to whole LED segments for the chip look
        const top = Math.ceil(y / seg) * seg;
        for (let yy = H - seg; yy >= top; yy -= seg) g.fillRect(x, yy + 1, w, seg - 1);
      }
      if (o.hold && o.grid) {
        g.fillStyle = '#e9edf5';
        for (let i = 0; i < bands; i++) if (pk[i] > this.DBMIN) g.fillRect(Math.floor(i * bw) + 1, Math.round(fy(pk[i])), Math.max(1, Math.floor(bw) - 2), 2 * r);
      }
    } else {
      const step = W / bands;
      g.beginPath(); g.moveTo(0, H);
      for (let i = 0; i < bands; i++) g.lineTo((i + 0.5) * step, fy(col[i]));
      g.lineTo(W, H); g.closePath();
      g.globalAlpha = 0.35; g.fillStyle = grd; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = '#7cf28a'; g.lineWidth = 1.5 * r; g.beginPath();
      for (let i = 0; i < bands; i++) { const x = (i + 0.5) * step, y = fy(col[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      if (o.hold && o.grid) {
        g.strokeStyle = 'rgba(233,237,245,0.55)'; g.lineWidth = 1 * r; g.beginPath();
        for (let i = 0; i < bands; i++) { const x = (i + 0.5) * step, y = fy(pk[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
    }
    if (o.grid && this.hover != null) {
      const x = this.hover * r, f = this.FMIN * Math.pow(this.FMAX / this.FMIN, x / W);
      const i = clamp(Math.floor(x / W * bands), 0, bands - 1), midi = Math.round(69 + 12 * Math.log2(f / 440));
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke();
      const txt = fmtHz(f) + ' Hz  ' + (midi >= 0 && midi < 128 ? noteName(midi) + '  ' : '') + (col[i] > -150 ? col[i].toFixed(1) + ' dB' : '');
      g.font = (11 * r) + 'px Consolas, monospace'; g.textBaseline = 'top';
      const tw = g.measureText(txt).width + 10 * r, tx = Math.min(x + 6 * r, W - tw - 2);
      g.fillStyle = 'rgba(11,13,18,0.85)'; g.fillRect(tx, 4 * r, tw, 17 * r);
      g.fillStyle = '#e9edf5'; g.fillText(txt, tx + 5 * r, 7 * r);
    }
  },

  // big view in the mixer (rebuilt by MIX.render)
  panel() {
    const s = App.song;
    if (this.src !== 'master' && !s.tracks.some(t => t.id === this.src)) this.src = 'master';
    const sel = h('select', { title: 'What to analyse' },
      h('option', { value: 'master', selected: this.src === 'master' }, 'Master'),
      s.tracks.map(t => h('option', { value: t.id, selected: this.src === t.id }, t.name)));
    sel.onchange = () => { this.src = sel.value; this.peaks.clear(); sel.blur(); };
    const seg = h('div', { class: 'seg' }, [['bars', 'Bars'], ['curve', 'Curve']].map(([m, l]) =>
      h('button', { class: this.mode === m ? 'on' : '', onclick: e => { this.mode = m; this.peaks.clear(); for (const b of e.target.parentNode.children) b.classList.toggle('on', b === e.target); } }, l)));
    const hold = h('button', { class: 'tog' + (this.hold ? ' on' : ''), title: 'Show the recent peak level of each band', onclick: () => { this.hold = !this.hold; hold.classList.toggle('on', this.hold); } }, 'Peak hold');
    const cv = h('canvas', { class: 'speccv' });
    cv.addEventListener('pointermove', e => { this.hover = e.offsetX; });
    cv.addEventListener('pointerleave', () => { this.hover = null; });
    this.cv = cv;
    return h('div', { class: 'specpanel' },
      h('div', { class: 'spechead' }, h('b', null, 'Spectrum'), sel, seg, hold, h('span', { class: 'dim' }, 'hover for frequency / note')),
      cv);
  },

  tick() {
    const mini = $('#spec');
    if (mini && mini.offsetParent) this.draw(mini, this.analyser('master'), { mode: 'bars', bands: 24 });
    const cv = this.cv;
    if (App.view !== 'mixer' || !cv || !cv.isConnected) return;
    const r = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * r), hh = Math.round(cv.clientHeight * r);
    if (!w || !hh) return;
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    this.draw(cv, this.analyser(this.src), { mode: this.mode, bands: Math.max(24, Math.min(96, Math.round(cv.clientWidth / 12))), grid: true, hold: this.hold, dpr: r });
  },
};
