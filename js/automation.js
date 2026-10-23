'use strict';
// Automation: dial movements recorded against song time and played back.
// song.automation = { <trackId | 'master'>: { <param>: [[tick, value], ...] } }  (points sorted by tick)
// Any numeric instrument setting can be automated, so every dial, fader and header bar works without wiring.
// Recording ("touch" mode): with Record armed in Song mode, moving a control while the song plays writes it;
// letting go hands the control back to whatever was recorded before. Moving an automated control without
// Record just overrides it until you let go.

const Auto = {
  INT: new Set(['bits', 'unison', 'octave', 'slope', 'kitTune']),
  SKIP: new Set(['revSize', 'delayBeats']), // rebuilding the reverb / delay grid mid-song would glitch
  last: new Map(),     // 'id|key' -> value last seen or applied
  touched: new Map(),  // 'id|key' -> { prev, lastPush } while the user holds a control
  down: false, wheelUntil: 0, wasPlaying: false, prevTick: null, uiAt: 0, uiDirty: false, undone: false, warned: false,

  init() {
    window.addEventListener('pointerdown', () => { this.down = true; }, true);
    window.addEventListener('pointerup', () => { this.down = false; }, true);
    window.addEventListener('pointercancel', () => { this.down = false; }, true);
    window.addEventListener('wheel', () => { this.wheelUntil = performance.now() + 350; }, { capture: true, passive: true });
    window.addEventListener('input', () => { this.wheelUntil = performance.now() + 350; }, true);
  },
  userActive() { return this.down || performance.now() < this.wheelUntil; },

  lanes(s, id, make) {
    s.automation = s.automation || {};
    if (!s.automation[id] && make) s.automation[id] = {};
    return s.automation[id] || null;
  },
  has(s) { return !!s.automation && Object.values(s.automation).some(o => Object.values(o).some(p => p.length)); },
  targets(s) { return s.tracks.map(t => [t.id, t.inst]).concat([['master', s.master]]); },
  keys(obj) { return Object.keys(obj).filter(k => typeof obj[k] === 'number' && !this.SKIP.has(k)); },

  valueAt(pts, tick, k) {
    if (!pts.length) return null;
    if (tick <= pts[0][0]) return pts[0][1];
    const n = pts.length;
    if (tick >= pts[n - 1][0]) return pts[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= tick) lo = m; else hi = m; }
    const [t0, v0] = pts[lo], [t1, v1] = pts[hi];
    const v = t1 > t0 ? v0 + (v1 - v0) * (tick - t0) / (t1 - t0) : v1;
    return this.INT.has(k) ? Math.round(v) : v;
  },

  // Set every automated value for this tick (used by export on a copy of the song). Returns true if anything moved.
  apply(s, tick) {
    let moved = false;
    for (const [id, obj] of this.targets(s)) {
      const L = s.automation && s.automation[id];
      if (!L) continue;
      for (const k in L) {
        const v = this.valueAt(L[k], tick, k);
        if (v != null && obj[k] !== v) { obj[k] = v; moved = true; }
      }
    }
    return moved;
  },

  // Called every animation frame.
  frame() {
    const s = App.song, playing = Transport.playing && Transport.mode === 'song';
    if (!playing) {
      if (this.wasPlaying) this.endPass();
      this.wasPlaying = false;
      this.last.clear();
      if (App.rec && Transport.playing && !this.warned) { this.warned = true; toast('Automation records in SONG mode — switch from PAT to SONG to record dial moves', 4000); }
      return;
    }
    const tick = Transport.currentTick();
    if (tick == null) return;
    if (!this.wasPlaying) { this.wasPlaying = true; this.prevTick = tick; this.last.clear(); this.touched.clear(); }
    if (tick < this.prevTick) this.prevTick = tick; // looped back round
    const active = this.userActive(), rec = App.rec;
    let moved = false;
    for (const [id, obj] of this.targets(s)) {
      const L = s.automation && s.automation[id];
      for (const k of this.keys(obj)) {
        const key = id + '|' + k, cur = obj[k], seen = this.last.get(key), pts = L && L[k];
        let t = this.touched.get(key);
        if (!t && seen !== undefined && cur !== seen && active) {
          // the user grabbed this control
          t = { lastPush: -1e9, lastVal: null };
          this.touched.set(key, t);
          if (rec) {
            this.beginWrite();
            const lane = this.lane(s, id, k);
            const before = lane.length ? this.valueAt(lane, tick - 1, k) : seen;
            this.insert(lane, Math.max(0, tick - 1), before, this.prevTick, Math.max(0, tick - 1));
          }
        }
        if (t) {
          if (!active) { this.touched.delete(key); this.last.set(key, cur); continue; }
          if (rec) {
            const lane = this.lane(s, id, k);
            if (cur !== t.lastVal || tick - t.lastPush >= TPB / 2) {
              this.insert(lane, tick, cur, this.prevTick, tick);
              t.lastPush = tick; t.lastVal = cur;
            } else this.insert(lane, null, null, this.prevTick, tick); // holding still: keep overwriting
          }
          this.last.set(key, cur);
          continue;
        }
        if (pts && pts.length) {
          const v = this.valueAt(pts, tick, k);
          if (v !== cur) { obj[k] = v; moved = true; }
          this.last.set(key, v);
        } else this.last.set(key, cur);
      }
    }
    this.prevTick = tick;
    if (moved) { AE.sync(); this.uiDirty = true; }
    if (this.touched.size && rec) ARR.requestDraw();
    const now = performance.now();
    if (this.uiDirty && !this.down && now - this.uiAt > 120) {
      // let the dials visibly follow the automation
      this.uiAt = now; this.uiDirty = false;
      const sel = getTrack(App.selTrack);
      if (sel && s.automation && s.automation[sel.id]) INST.render(true);
      if (App.view === 'mixer') MIX.syncValues();
      ARR.requestDraw();
    }
  },

  lane(s, id, k) { const L = this.lanes(s, id, true); return L[k] || (L[k] = []); },
  // remove points in (from, to], then add [t, v] in order
  insert(lane, t, v, from, to) {
    for (let i = lane.length - 1; i >= 0; i--) if (lane[i][0] > from && lane[i][0] <= to && lane[i][0] !== t) lane.splice(i, 1);
    if (t == null) return;
    const p = [Math.round(t * 100) / 100, v];
    let i = lane.length;
    while (i > 0 && lane[i - 1][0] > p[0]) i--;
    if (i > 0 && lane[i - 1][0] === p[0]) lane[i - 1] = p; else lane.splice(i, 0, p);
  },
  beginWrite() {
    if (this.undone) return;
    this.undone = true;
    pushUndo();
    setStatus('Recording automation…');
  },
  endPass() {
    this.touched.clear();
    if (this.undone) { this.undone = false; autosave(); toast('Automation recorded — press Play to hear it back'); ARR.requestDraw(); }
  },

  clear(s, id, k) {
    pushUndo();
    if (!s.automation || !s.automation[id]) return;
    if (k) delete s.automation[id][k]; else delete s.automation[id];
    autosave(); ARR.requestDraw();
  },
  prune(s) {
    if (!s.automation) { s.automation = {}; return; }
    const ids = new Set(s.tracks.map(t => t.id).concat(['master']));
    for (const id in s.automation) {
      if (!ids.has(id)) { delete s.automation[id]; continue; }
      for (const k in s.automation[id]) if (!s.automation[id][k].length) delete s.automation[id][k];
    }
  },

  LABELS: { vol: 'Volume', pan: 'Pan', boost: 'Boost', cutoff: 'Low-pass', reso: 'Resonance', hpf: 'High-pass', delay: 'Delay send', reverb: 'Reverb send',
    drive: 'Drive', bits: 'Bit depth', detune: 'Fine tune', a: 'Attack', d: 'Decay', s: 'Sustain', r: 'Release', fFreq: 'Filter cutoff', fQ: 'Filter reso',
    fEnv: 'Filter env', eqLow: 'EQ low', eqMid: 'EQ mid', eqHigh: 'EQ high', eqMidF: 'EQ mid freq', vibDepth: 'Vibrato', tremDepth: 'Tremolo',
    delayFb: 'Delay feedback', delayRet: 'Delay volume', revRet: 'Reverb volume', fmIndex: 'FM index', fmRatio: 'FM ratio', pwmDepth: 'PWM depth', pwmRate: 'PWM rate' },
  label(k) { return this.LABELS[k] || k; },
  COLORS: ['#ffffff', '#ffcf5a', '#6cc6ff', '#ff7ab6', '#9be36c', '#ff9b5a', '#b48cff'],

  // little panel listing a target's lanes with clear buttons
  listEl(id, onChange) {
    const s = App.song, L = s.automation && s.automation[id], keys = L ? Object.keys(L).filter(k => L[k].length) : [];
    if (!keys.length) return h('div', { class: 'autolist dim' }, 'No automation. Arm ● Record, play in SONG mode and move any dial.');
    return h('div', { class: 'autolist' },
      h('div', { class: 'autohd' }, h('b', null, 'Automation'), h('button', { onclick: () => { this.clear(s, id); onChange && onChange(); } }, 'Clear all')),
      keys.map((k, i) => h('div', { class: 'autorow' },
        h('span', { class: 'sw', style: { background: this.COLORS[i % this.COLORS.length] } }),
        h('span', { style: { flex: 1 } }, this.label(k)), h('small', null, L[k].length + ' pts'),
        h('button', { title: 'Delete this automation', onclick: () => { this.clear(s, id, k); onChange && onChange(); } }, '✕'))));
  },
};
