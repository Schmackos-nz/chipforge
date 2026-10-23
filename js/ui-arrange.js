'use strict';
// Playlist / arrangement: tracks × bars, clips are pattern instances.

const ARR = {
  ppb: 54, rowH: 44, HEAD: 210, RULER: 30, lv: new Map(),
  sel: new Set(), drag: null, needs: true, follow: true, tool: 'paint', hover: null,

  init() {
    this.wrap = $('#arrWrap'); this.cv = $('#arrCanvas'); this.sc = $('#arrScroll'); this.sp = this.sc.firstElementChild;
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    this.sc.addEventListener('scroll', () => this.requestDraw());
    bindPointer(this.sc, this);
    this.sc.addEventListener('contextmenu', e => e.preventDefault());
    this.sc.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX); } }, { passive: false });
    this.sc.addEventListener('pointermove', e => {
      const [mx, my] = this.local(e);
      this.hover = mx > this.HEAD && my > this.RULER ? Math.max(0, this.barAt(mx)) : null;
      if (!this.drag) this.hoverCursor(e);
    });
    this.sc.addEventListener('mouseleave', () => { this.hover = null; });
    // drop audio files (or the waveform from the instrument panel) onto a track lane
    const isOurs = e => e.dataTransfer && [...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/x-chipforge-track');
    this.sc.addEventListener('dragover', e => {
      if (!isOurs(e)) return;
      e.preventDefault();
      const [mx, my] = this.local(e);
      this.dropHint = { bar: Math.max(0, Math.floor(this.barAt(Math.max(mx, this.HEAD)))), row: this.rowAt(Math.max(my, this.RULER)) };
      this.requestDraw();
    });
    this.sc.addEventListener('dragleave', e => { if (!this.sc.contains(e.relatedTarget)) { this.dropHint = null; this.requestDraw(); } });
    this.sc.addEventListener('drop', e => {
      if (!isOurs(e)) return;
      e.preventDefault(); e.stopPropagation();
      this.dropHint = null;
      const [mx, my] = this.local(e);
      this.dropAudio(e.dataTransfer, Math.max(0, Math.floor(this.barAt(Math.max(mx, this.HEAD)))), this.rowAt(Math.max(my, this.RULER)));
    });
    this.buildToolbar();
  },

  async dropAudio(dt, bar, row) {
    const s = App.song, own = dt.getData('text/x-chipforge-track');
    if (own) {
      const tr = getTrack(own), smp = tr && SMP.get(tr.inst.sample);
      if (!smp) return;
      pushUndo();
      this.placeSample(tr, smp, bar);
      return;
    }
    const fs = [...dt.files].filter(f => /^audio\/|\.(wav|mp3|ogg|flac|m4a|aac|webm|aiff?)$/i.test(f.type + ' ' + f.name));
    if (!fs.length) return toast('Drop audio files (WAV, MP3, OGG, FLAC…)');
    let undone = false;
    for (const f of fs) {
      let smp;
      try { smp = await SMP.fromFile(f); } catch (e) { toast('Could not read ' + f.name, 3500); continue; }
      if (!undone) { pushUndo(); undone = true; }
      const target = s.tracks[row];
      let tr;
      if (target && target.inst.type === 'sample' && (!SMP.get(target.inst.sample) || !s.clips.some(c => c.track === target.id))) {
        // an empty sample lane: load the sound into it
        tr = target; tr.inst.sample = smp.id; tr.inst.sLs = 0; tr.inst.sLe = 1; tr.inst.sStart = 0;
        if (/^(Track|Sample)/.test(tr.name)) tr.name = smp.name.slice(0, 24);
      } else {
        tr = addTrack(s, smp.name.slice(0, 24) || 'Sample', Object.assign(defaultInst('sample'), { sample: smp.id, a: 0.001, d: 0.1, s: 1, r: 0.05, sOneShot: true }));
        // put the new lane right under the one it was dropped on
        s.tracks.pop();
        s.tracks.splice(target ? row + 1 : s.tracks.length, 0, tr);
        row = s.tracks.indexOf(tr);
      }
      this.placeSample(tr, smp, bar);
    }
  },

  // Clip that plays the whole sound once, starting at the bar. Returns the bar after it.
  placeSample(tr, smp, bar) {
    const s = App.song, bt = barTicks(), I = tr.inst;
    const ticks = Math.max(1, Math.round(SMP.len(smp) / smp.rate * s.bpm / 60 * TPB));
    let pat = s.patterns.find(p => p.track === tr.id && p.fullSample === smp.id);
    if (!pat) {
      pat = addPattern(s, tr.id, smp.name.slice(0, 20), Math.max(1, Math.ceil(ticks / bt)), [{ t: 0, d: ticks, p: I.sRoot || 60, v: 110 }]);
      pat.fullSample = smp.id;
    }
    const c = addClip(s, tr.id, pat.id, bar);
    App.selTrack = tr.id; App.selPattern = pat.id;
    this.sel.clear(); this.sel.add(c);
    changed({ full: true });
    this.layout();
    toast('Placed ' + smp.name + ' at bar ' + (bar + 1));
    return bar + pat.bars;
  },

  // min/max peaks per sample, cached by version, for drawing waveforms inside clips
  peaks(smp) {
    const key = smp.id + ':' + smp.ver;
    if (this._pk && this._pk.key === key) return this._pk.v;
    this._pkc = this._pkc || new Map();
    let v = this._pkc.get(key);
    if (!v) {
      const N = 1024, d = smp.ch[0], n = d.length; v = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        let lo = 0, hi = 0;
        const a = Math.floor(i * n / N), b = Math.max(a + 1, Math.floor((i + 1) * n / N));
        for (let j = a; j < b; j += Math.max(1, (b - a) >> 6)) { if (d[j] < lo) lo = d[j]; if (d[j] > hi) hi = d[j]; }
        v[i * 2] = lo; v[i * 2 + 1] = hi;
      }
      this._pkc.set(key, v);
    }
    return v;
  },
  requestDraw() { this.needs = true; },
  resize() {
    const dpr = window.devicePixelRatio || 1, w = this.wrap.clientWidth, hh = this.wrap.clientHeight;
    if (!w || !hh) return;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(hh * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = hh + 'px';
    this.layout();
  },
  totalBars() { return Math.max(songEndBar() + 16, 64, App.song.loop.end + 8); },
  layout() {
    this.sp.style.width = (this.HEAD + this.totalBars() * this.ppb) + 'px';
    this.sp.style.height = (this.RULER + (App.song.tracks.length + 1) * this.rowH) + 'px';
    this.requestDraw();
  },
  zoom(f, clientX) {
    const r = this.sc.getBoundingClientRect(), mx = clientX != null ? clientX - r.left : this.sc.clientWidth / 2;
    const bar = this.barAt(mx);
    this.ppb = clamp(this.ppb * f, 10, 400);
    this.layout();
    this.sc.scrollLeft = Math.max(0, bar * this.ppb - (mx - this.HEAD));
  },
  barAt(mx) { return (mx - this.HEAD + this.sc.scrollLeft) / this.ppb; },
  rowAt(my) { return Math.floor((my - this.RULER + this.sc.scrollTop) / this.rowH); },
  xOf(bar) { return this.HEAD + bar * this.ppb - this.sc.scrollLeft; },
  yOf(r) { return this.RULER + r * this.rowH - this.sc.scrollTop; },
  local(e) { const r = this.sc.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },
  clipAt(tid, barF) {
    const pm = patternMap(App.song);
    for (let i = App.song.clips.length - 1; i >= 0; i--) {
      const c = App.song.clips[i];
      if (c.track !== tid) continue;
      const p = pm.get(c.pattern);
      if (p && barF >= c.bar && barF < c.bar + p.bars) return c;
    }
    return null;
  },
  hoverCursor(e) {
    const [mx, my] = this.local(e);
    let cur = 'default';
    if (my < this.RULER) cur = mx > this.HEAD ? 'text' : 'default';
    else if (mx > this.HEAD) {
      const tr = App.song.tracks[this.rowAt(my)];
      cur = tr && this.clipAt(tr.id, this.barAt(mx)) ? 'move' : this.tool === 'select' || e.ctrlKey || e.shiftKey ? 'crosshair' : tr ? 'copy' : 'default';
    }
    else {
      const L = this.hdr(), ry = my - this.yOf(this.rowAt(my));
      cur = ry > 22 && ((mx >= L.vx && mx < L.vx + L.vw) || (mx >= L.px && mx < L.px + L.pw)) ? 'ew-resize' : 'pointer';
    }
    this.sc.style.cursor = cur;
  },
  capture() { dragCapture(this); },

  down(e) {
    const [mx, my] = this.local(e);
    if (mx > this.sc.clientWidth || my > this.sc.clientHeight) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // so shortcuts reach the playlist
    const s = App.song;
    if (my < this.RULER) {
      if (mx < this.HEAD) return;
      const b = Math.max(0, Math.floor(this.barAt(mx)));
      this.drag = { type: 'ruler', b0: b, b1: b };
      this.capture();
      return;
    }
    const row = this.rowAt(my), tr = s.tracks[row];
    if (mx < this.HEAD) {
      if (!tr) return;
      const ry = my - this.yOf(row), L = this.hdr(), inX = (a, w) => mx >= a && mx < a + w;
      if (ry < 21 && inX(L.m, 18)) { pushUndo(); tr.mute = !tr.mute; changed({ lists: true }); return; }
      if (ry < 21 && inX(L.s, 18)) {
        pushUndo();
        if (e.ctrlKey) { const only = !tr.solo; s.tracks.forEach(t => { t.solo = false; }); tr.solo = only; } else tr.solo = !tr.solo;
        changed({ lists: true }); return;
      }
      if (ry < 21 && inX(L.mix, 18)) { UI.selectTrack(tr.id); this.mixPop(tr, e.clientX, e.clientY); return; }
      if (ry > 22 && (inX(L.vx, L.vw) || inX(L.px, L.pw))) {
        const k = inX(L.vx, L.vw) ? 'vol' : 'pan';
        pushUndo();
        if (e.dbl) { tr.inst[k] = defaultInst()[k]; this.hdrSet(tr, true); return; }
        this.drag = { type: 'hdr', k, tr };
        this.hdrDrag(mx);
        this.capture();
        return;
      }
      UI.selectTrack(tr.id);
      if (e.dbl) UI.renameTrack(tr.id);
      return;
    }
    const barF = Math.max(0, this.barAt(mx)), hit = tr ? this.clipAt(tr.id, barF) : null;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (e.button === 0 && !hit && (this.tool === 'select' || additive || !tr)) {
      // Box select: Select tool, Ctrl/Shift+drag, or dragging in the empty area under the tracks.
      if (!additive) this.sel.clear();
      this.drag = { type: 'marquee', b0: barF, r0: row, b1: barF, r1: row, base: new Set(this.sel) };
      this.capture();
      this.requestDraw();
      return;
    }
    if (!tr) return;
    if (e.button === 2) {
      pushUndo();
      this.drag = { type: 'erase', changed: false };
      this.eraseAt(mx, my);
      this.capture();
      return;
    }
    if (e.button !== 0) return;
    if (hit) {
      if (e.dbl) { PR.open(hit.pattern); return; }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click toggles the clip; Ctrl+drag box-selects even when starting on a clip.
        this.drag = { type: 'marquee', b0: barF, r0: row, b1: barF, r1: row, base: new Set(this.sel), toggle: hit, moved: false };
        this.capture();
        return;
      }
      if (!this.sel.has(hit)) { this.sel.clear(); this.sel.add(hit); }
      App.selTrack = tr.id; App.selPattern = hit.pattern;
      UI.render({ lists: true });
      this.drag = { type: 'move', orig: [...this.sel].map(c => [c, c.bar]), b0: barF, pushed: false, dup: e.shiftKey };
      this.capture();
      return;
    }
    // Paint the track's current pattern here.
    pushUndo();
    let pat = getPattern(App.selPattern);
    if (!pat || pat.track !== tr.id) pat = trackPatterns(tr.id)[0];
    if (!pat) pat = addPattern(s, tr.id, nextPatternName(s, tr.id), 1, []);
    const c = addClip(s, tr.id, pat.id, Math.floor(barF));
    App.selTrack = tr.id; App.selPattern = pat.id;
    this.sel.clear(); this.sel.add(c);
    this.drag = { type: 'paint', tr: tr.id, pat: pat.id, last: c.bar, b0: barF };
    this.capture();
    changed({ lists: true });
  },
  // playlist track header layout (scales with HEAD so phones get a narrower one)
  hdr() {
    const H = this.HEAD, pw = H < 160 ? 30 : 46;
    return { m: H - 66, s: H - 46, mix: H - 26, px: H - pw - 8, pw, vx: 10, vw: H - pw - 26 };
  },
  hdrDrag(mx) {
    const d = this.drag, L = this.hdr(), I = d.tr.inst;
    if (d.k === 'vol') I.vol = +clamp((mx - L.vx) / L.vw * 2, 0, 2).toFixed(3);
    else { const p = clamp((mx - L.px) / L.pw * 2 - 1, -1, 1); I.pan = Math.abs(p) < 0.06 ? 0 : +p.toFixed(2); }
    this.hdrSet(d.tr, false);
  },
  hdrSet(tr, done) {
    AE.sync(); autosave(); this.requestDraw();
    setStatus(tr.name + ' · volume ' + MIX.dbText(tr.inst.vol) + ' · pan ' + fmtPan(tr.inst.pan));
    if (done) { UI.render({ lists: true }); INST.render(true); MIX.syncValues(); }
  },

  // small mixer for one track, opened from the gear in its playlist header
  mixPop(tr, cx, cy) {
    const old = $('.hpop');
    if (old) { old.remove(); if (old.dataset.tid === tr.id) return; }
    const I = tr.inst;
    let armed = false;
    const start = () => { if (!armed) { pushUndo(); armed = true; setTimeout(() => { armed = false; }, 400); } };
    const K = (k, label, min, max, o) => Knob(Object.assign({ label, min, max, value: I[k], def: defaultInst()[k], onStart: start,
      onInput: v => { I[k] = v; AE.sync(); autosave(); this.requestDraw(); } }, o || {}));
    const tog = (k, label) => h('button', { class: 'tog' + (tr[k] ? ' on' : ''), onclick: e => { pushUndo(); tr[k] = !tr[k]; e.target.classList.toggle('on', tr[k]); changed({ lists: true }); } }, label);
    const dB = v => v.toFixed(1) + 'dB';
    const pop = h('div', { class: 'hpop' },
      h('div', { class: 'hpophead', style: { borderLeftColor: tr.color } }, h('b', null, tr.name), tog('mute', 'M'), tog('solo', 'S'),
        h('button', { title: 'Close', onclick: () => close() }, '✕')),
      h('div', { class: 'knobs' },
        K('vol', 'Volume', 0, 2, { fmt: v => MIX.dbText(v).replace(' dB', 'dB'), color: '#7cf28a' }),
        K('boost', 'Boost', 0, 24, { fmt: fmtBoost, color: '#ff5a5a', title: 'Output overdrive: gain into a soft clipper' }),
        K('pan', 'Pan', -1, 1, { fmt: fmtPan }),
        K('delay', 'Delay', 0, 1, { fmt: fmtPct }),
        K('reverb', 'Reverb', 0, 1, { fmt: fmtPct }),
        K('cutoff', 'Low-pass', 40, 20000, { log: true, fmt: fmtHz, color: '#6cc6ff' }),
        K('hpf', 'High-pass', 10, 8000, { log: true, fmt: fmtHz, color: '#6cc6ff' }),
        K('eqLow', 'Low', -18, 18, { fmt: dB, color: '#9be36c' }),
        K('eqMid', 'Mid', -18, 18, { fmt: dB, color: '#9be36c' }),
        K('eqHigh', 'High', -18, 18, { fmt: dB, color: '#9be36c' }),
        K('drive', 'Drive', 0, 1, { fmt: fmtPct, color: '#ff9b5a' }),
        K('bits', 'Bits', 2, 16, { step: 1, fmt: v => v + '-bit', color: '#ff9b5a' })),
      h('div', { class: 'frow', style: { justifyContent: 'space-between' } },
        h('button', { onclick: () => { close(); UI.setView('mixer'); } }, 'Open mixer'),
        h('button', { onclick: () => { close(); if (window.innerWidth <= 900) $('#btnInst').click(); } }, 'Sound settings…')));
    pop.dataset.tid = tr.id;
    document.body.append(pop);
    const w = pop.offsetWidth, hh = pop.offsetHeight;
    pop.style.left = clamp(cx + 8, 4, window.innerWidth - w - 4) + 'px';
    pop.style.top = clamp(cy - 20, 4, window.innerHeight - hh - 4) + 'px';
    const outside = e => { if (!pop.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const close = () => {
      pop.remove(); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', esc, true);
      UI.render({ lists: true }); INST.render(true); MIX.syncValues();
    };
    setTimeout(() => { window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', esc, true); });
  },

  move(e) {
    const d = this.drag;
    if (!d) return;
    const [mx, my] = this.local(e);
    if (d.type === 'hdr') { this.hdrDrag(mx); return; }
    const barF = Math.max(0, this.barAt(mx));
    if (d.type === 'ruler') { d.b1 = Math.max(0, Math.floor(barF)); this.requestDraw(); return; }
    if (d.type === 'erase') { this.eraseAt(mx, my); return; }
    if (d.type === 'marquee') {
      const row = this.rowAt(my);
      if (Math.abs(barF - d.b0) * this.ppb > 3 || row !== d.r0) d.moved = true;
      if (d.toggle && !d.moved) return;
      d.b1 = barF; d.r1 = row;
      const b0 = Math.min(d.b0, d.b1), b1 = Math.max(d.b0, d.b1), r0 = Math.min(d.r0, d.r1), r1 = Math.max(d.r0, d.r1);
      const pm = patternMap(App.song);
      this.sel = new Set(d.base);
      App.song.tracks.forEach((t, r) => {
        if (r < r0 || r > r1) return;
        for (const c of App.song.clips) if (c.track === t.id) { const p = pm.get(c.pattern); if (p && c.bar < b1 && c.bar + p.bars > b0) this.sel.add(c); }
      });
      this.requestDraw();
      return;
    }
    if (d.type === 'paint') {
      // Dragging after a paint click keeps stamping copies along the row (FL-style).
      const pat = getPattern(d.pat), b = Math.floor(barF);
      if (pat && b >= d.last + pat.bars) {
        for (let x = d.last + pat.bars; x + pat.bars <= b + 1; x += pat.bars) { const c = addClip(App.song, d.tr, d.pat, x); this.sel.add(c); d.last = x; }
        Transport.markDirty(); this.layout();
      }
      return;
    }
    if (d.type === 'move') {
      let db = Math.round(barF - d.b0);
      if (!d.pushed) {
        if (db === 0) return;
        pushUndo();
        d.pushed = true;
        if (d.dup) for (const [c] of d.orig) addClip(App.song, c.track, c.pattern, c.bar);
      }
      const minB = Math.min(...d.orig.map(o => o[1]));
      if (minB + db < 0) db = -minB;
      for (const [c, b0] of d.orig) c.bar = b0 + db;
      Transport.markDirty();
      this.requestDraw();
    }
  },
  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.type === 'hdr') { this.hdrSet(d.tr, true); return; }
    if (d.type === 'marquee' && d.toggle && !d.moved) { if (this.sel.has(d.toggle)) this.sel.delete(d.toggle); else this.sel.add(d.toggle); }
    if (d.type === 'ruler') {
      if (d.b0 === d.b1) Transport.setSongPos(d.b0 * barTicks());
      else {
        pushUndo();
        App.song.loop = { on: true, start: Math.min(d.b0, d.b1), end: Math.max(d.b0, d.b1) + 1 };
        Transport.setSongPos(App.song.loop.start * barTicks());
        changed({});
      }
      return;
    }
    if (d.type === 'erase') { if (!d.changed) App.undoStack.pop(); else changed({ lists: true }); return; }
    if (d.type === 'paint' || (d.type === 'move' && d.pushed)) { changed({}); this.layout(); return; }
    this.requestDraw();
  },
  eraseAt(mx, my) {
    const tr = App.song.tracks[this.rowAt(my)];
    if (!tr || mx < this.HEAD) return;
    const c = this.clipAt(tr.id, this.barAt(mx));
    if (!c) return;
    App.song.clips.splice(App.song.clips.indexOf(c), 1);
    this.sel.delete(c);
    this.drag.changed = true;
    Transport.markDirty();
    this.requestDraw();
  },

  key(e) {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, sel = [...this.sel], lk = k.toLowerCase();
    if (ctrl && lk === 'a') { this.selectAll(); return true; }
    if (ctrl && lk === 'c') { this.copy(); return true; }
    if (ctrl && lk === 'x') { this.cut(); return true; }
    if (ctrl && lk === 'v') { this.paste(); return true; }
    if (ctrl && lk === 'd') { this.duplicate(); return true; }
    if (k === 'Delete' || k === 'Backspace') { this.del(); return true; }
    if (k === 'Escape') { this.sel.clear(); this.requestDraw(); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!sel.length) return false;
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (dir < 0 && Math.min(...sel.map(c => c.bar)) === 0) return true;
      pushUndo();
      for (const c of sel) c.bar += dir;
      changed({});
      return true;
    }
    return false;
  },

  // ---- clipboard / selection (shared by shortcuts and toolbar buttons)
  selEnd(sel) { const pm = patternMap(App.song); return Math.max(...sel.map(c => c.bar + (pm.get(c.pattern) || { bars: 1 }).bars)); },
  selectAll() { this.sel = new Set(App.song.clips); this.requestDraw(); },
  copy() {
    const sel = [...this.sel];
    if (!sel.length) return toast('Select clips first (Select tool, Ctrl/Shift+drag, or Ctrl+A)');
    App.clipClips = sel.map(c => Object.assign({}, c));
    toast(sel.length + ' clip' + (sel.length > 1 ? 's' : '') + ' copied');
  },
  cut() {
    if (!this.sel.size) return;
    this.copy();
    this.del();
  },
  // Pastes at the mouse bar if it's over the playlist, else right after the selection, else at the song position.
  paste() {
    const s = App.song, pm = patternMap(s);
    if (!App.clipClips || !App.clipClips.length) return toast('Nothing copied yet');
    pushUndo();
    const sel = [...this.sel], minB = Math.min(...App.clipClips.map(c => c.bar));
    const at = this.hover != null ? Math.floor(this.hover) : sel.length ? this.selEnd(sel) : Math.floor(Transport.songPos / barTicks());
    this.sel.clear();
    for (const c of App.clipClips) if (pm.has(c.pattern)) this.sel.add(addClip(s, c.track, c.pattern, c.bar - minB + at));
    changed({}); this.layout();
  },
  duplicate() {
    const s = App.song, sel = [...this.sel];
    if (!sel.length) return;
    pushUndo();
    const span = this.selEnd(sel) - Math.min(...sel.map(c => c.bar));
    this.sel.clear();
    for (const c of sel) this.sel.add(addClip(s, c.track, c.pattern, c.bar + span));
    changed({}); this.layout();
  },
  del() {
    if (!this.sel.size) return;
    pushUndo();
    App.song.clips = App.song.clips.filter(c => !this.sel.has(c));
    this.sel.clear();
    changed({});
  },
  setTool(t) {
    this.tool = t;
    $$('#arrTools [data-atool]').forEach(b => b.classList.toggle('on', b.dataset.atool === t));
  },

  makeUnique() {
    const sel = [...this.sel];
    if (!sel.length) return toast('Select clips first');
    pushUndo();
    const s = App.song;
    for (const c of sel) {
      const p = getPattern(c.pattern);
      const np = addPattern(s, p.track, p.name + ' (u)', p.bars, deepClone(p.notes));
      c.pattern = np.id;
    }
    changed({ lists: true });
    toast('Made ' + sel.length + ' clip(s) unique');
  },
  loopSelection() {
    const sel = [...this.sel];
    if (!sel.length) return toast('Select clips first');
    const pm = patternMap(App.song);
    pushUndo();
    App.song.loop = { on: true, start: Math.min(...sel.map(c => c.bar)), end: Math.max(...sel.map(c => c.bar + pm.get(c.pattern).bars)) };
    changed({});
  },
  insertBars(n) {
    const at = Math.floor(Transport.songPos / barTicks());
    pushUndo();
    for (const c of App.song.clips) if (c.bar >= at) c.bar += n;
    for (const m of App.song.markers) if (m.bar >= at) m.bar += n;
    changed({});
    toast((n > 0 ? 'Inserted ' : 'Removed ') + Math.abs(n) + ' bar(s) at bar ' + (at + 1));
  },
  deleteBar() {
    const at = Math.floor(Transport.songPos / barTicks());
    pushUndo();
    App.song.clips = App.song.clips.filter(c => c.bar !== at);
    for (const c of App.song.clips) if (c.bar > at) c.bar -= 1;
    App.song.markers = App.song.markers.filter(m => m.bar !== at);
    for (const m of App.song.markers) if (m.bar > at) m.bar -= 1;
    changed({});
  },

  buildToolbar() {
    const tb = $('#arrTools');
    const followBtn = h('button', { class: 'tog on', title: 'Scroll with the playhead' }, 'Follow');
    followBtn.onclick = () => { this.follow = !this.follow; followBtn.classList.toggle('on', this.follow); };
    const toolBtn = (t, label, title) => h('button', { 'data-atool': t, class: this.tool === t ? 'on' : '', title, onclick: () => this.setTool(t) }, label);
    tb.append(
      toolBtn('paint', '✎ Paint', 'Click to paint the current pattern, drag clips to move, Shift+drag to copy, right-click to delete'),
      toolBtn('select', '⬚ Select', 'Drag a box to select several clips (Ctrl/Shift+drag does this in Paint mode too)'),
      h('span', { class: 'sep' }),
      h('button', { title: 'Select all clips (Ctrl+A)', onclick: () => this.selectAll() }, 'All'),
      h('button', { title: 'Copy selected clips (Ctrl+C)', onclick: () => this.copy() }, 'Copy'),
      h('button', { title: 'Cut selected clips (Ctrl+X)', onclick: () => this.cut() }, 'Cut'),
      h('button', { title: 'Paste (Ctrl+V) — at the mouse bar, or after the selection', onclick: () => this.paste() }, 'Paste'),
      h('button', { title: 'Duplicate selection right after itself (Ctrl+D)', onclick: () => this.duplicate() }, 'Dup'),
      h('button', { title: 'Delete selected clips (Del)', onclick: () => this.del() }, 'Del'),
      h('span', { class: 'empty arrhint', style: { padding: '0 4px' } }, 'double-click = edit · drag ruler = loop'),
      h('span', { style: { flex: 1 } }),
      h('button', { title: 'Copy selected clips into new, independent patterns', onclick: () => this.makeUnique() }, 'Make unique'),
      h('button', { title: 'Set loop region to the selection', onclick: () => this.loopSelection() }, 'Loop sel.'),
      h('button', { title: 'Insert an empty bar at the song position', onclick: () => this.insertBars(1) }, '+Bar'),
      h('button', { title: 'Delete the bar at the song position', onclick: () => this.deleteBar() }, '−Bar'),
      h('button', { title: 'Remove section markers', onclick: () => { pushUndo(); App.song.markers = []; changed({}); } }, 'Clear markers'),
      followBtn,
      h('button', { title: 'Zoom out', onclick: () => this.zoom(1 / 1.3) }, '－'),
      h('button', { title: 'Zoom in', onclick: () => this.zoom(1.3) }, '＋'),
    );
  },

  draw() {
    this.needs = false;
    const cv = this.cv, g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = cv.width / dpr, H = cv.height / dpr, s = App.song, bt = barTicks();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#12141a'; g.fillRect(0, 0, W, H);
    const sl = this.sc.scrollLeft, b0 = Math.floor(sl / this.ppb), b1 = Math.ceil((sl + W) / this.ppb);
    // rows
    s.tracks.forEach((t, r) => {
      const y = this.yOf(r);
      if (y > H || y + this.rowH < this.RULER) return;
      g.fillStyle = t.id === App.selTrack ? '#1c212b' : r % 2 ? '#15181e' : '#171a21';
      g.fillRect(this.HEAD, y, W, this.rowH);
      g.fillStyle = '#20242d'; g.fillRect(this.HEAD, y + this.rowH - 1, W, 1);
    });
    // loop region
    if (s.loop.on) { g.fillStyle = 'rgba(124,242,138,.05)'; g.fillRect(this.xOf(s.loop.start), this.RULER, (s.loop.end - s.loop.start) * this.ppb, H); }
    // grid
    for (let b = b0; b <= b1; b++) {
      const x = Math.round(this.xOf(b)) + 0.5;
      g.fillStyle = b % 4 === 0 ? '#323846' : '#22262f';
      g.fillRect(x, this.RULER, 1, H);
      if (this.ppb >= 90) { g.fillStyle = '#1b1e25'; for (let k = 1; k < s.beatsPerBar; k++) g.fillRect(this.xOf(b + k / s.beatsPerBar), this.RULER, 1, H); }
    }
    // markers lines
    for (const m of s.markers) { const x = this.xOf(m.bar); if (x >= this.HEAD && x <= W) { g.fillStyle = 'rgba(180,140,255,.35)'; g.fillRect(x, this.RULER, 1, H); } }
    // clips
    const pm = patternMap(s);
    const tIndex = new Map(s.tracks.map((t, i) => [t.id, i]));
    g.textBaseline = 'top';
    for (const c of s.clips) {
      const p = pm.get(c.pattern), r = tIndex.get(c.track);
      if (!p || r == null) continue;
      const x = this.xOf(c.bar), w = p.bars * this.ppb, y = this.yOf(r);
      if (x > W || x + w < this.HEAD || y > H || y + this.rowH < this.RULER) continue;
      const t = s.tracks[r];
      const muted = t.mute;
      g.globalAlpha = muted ? 0.35 : 1;
      g.fillStyle = t.color + '33'; g.fillRect(x + 1, y + 2, w - 2, this.rowH - 4);
      g.fillStyle = t.color + 'cc'; g.fillRect(x + 1, y + 2, w - 2, 12);
      g.fillStyle = '#0c0e12'; g.font = 'bold 10px system-ui';
      g.save(); g.beginPath(); g.rect(x + 1, y + 2, w - 3, this.rowH - 4); g.clip();
      g.fillText(p.name, x + 4, y + 3);
      const smp = t.inst.type === 'sample' && SMP.get(t.inst.sample);
      if (smp && p.notes.length) {
        // sample lanes: draw the actual waveform for each note (stretched by its pitch, cut by its length)
        const pk = this.peaks(smp), N = pk.length / 2, sx = this.ppb / bt, bodyY = y + 15, bodyH = this.rowH - 18, mid = bodyY + bodyH / 2;
        const secPerTick = 60 / (s.bpm * TPB), len = SMP.len(smp) / smp.rate, I = t.inst;
        g.fillStyle = t.color;
        for (const n of p.notes) {
          if (n.t >= p.bars * bt) continue;
          const rate = Math.pow(2, (n.p + 12 * (I.octave || 0) - (I.sRoot || 60)) / 12), st = clamp(I.sStart || 0, 0, 0.99);
          let durT = len * (1 - st) / rate / secPerTick;
          if (!I.sOneShot || I.sLoop) durT = I.sLoop ? n.d : Math.min(durT, n.d);
          const x0 = x + n.t * sx, wpx = Math.min(durT, p.bars * bt - n.t) * sx, amp = (n.v / 127) * bodyH / 2;
          for (let px = 0; px < wpx; px++) {
            let pos = st + (px / sx) * secPerTick * rate / len;
            if (I.sLoop && pos > I.sLe) pos = I.sLs + (pos - I.sLs) % Math.max(0.001, I.sLe - I.sLs);
            if (pos >= 1) break;
            const k = Math.min(N - 1, Math.floor(pos * N)), lo = pk[k * 2], hi = pk[k * 2 + 1];
            g.fillRect(x0 + px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
          }
        }
      } else if (p.notes.length) {
        let lo = 127, hi = 0;
        for (const n of p.notes) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
        const span = Math.max(6, hi - lo + 1), bodyY = y + 16, bodyH = this.rowH - 21, sx = this.ppb / bt;
        g.fillStyle = t.color;
        for (const n of p.notes) {
          if (n.t >= p.bars * bt) continue;
          const ny = bodyY + bodyH - ((n.p - lo + 1) / span) * bodyH;
          g.fillRect(x + n.t * sx, ny, Math.max(1, Math.min(n.d, p.bars * bt - n.t) * sx - 0.5), Math.max(1.5, bodyH / span));
        }
      }
      g.restore();
      g.globalAlpha = 1;
      if (this.sel.has(c)) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x + 1.5, y + 2.5, w - 3, this.rowH - 5); }
    }
    if (this.dropHint) {
      const { bar, row } = this.dropHint, x = this.xOf(bar), y = this.yOf(Math.min(row, s.tracks.length));
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = '#7cf28a'; g.lineWidth = 1.5;
      g.strokeRect(x + 1, y + 2, this.ppb * 2, this.rowH - 4); g.restore();
      g.fillStyle = '#7cf28a'; g.font = 'bold 10px system-ui'; g.textBaseline = 'top';
      g.fillText('Drop sound at bar ' + (bar + 1), x + 4, y + 4);
    }
    // marquee
    const d = this.drag;
    if (d && d.type === 'marquee') {
      const x0 = this.xOf(Math.min(d.b0, d.b1)), x1 = this.xOf(Math.max(d.b0, d.b1));
      const y0 = this.yOf(Math.min(d.r0, d.r1)), y1 = this.yOf(Math.max(d.r0, d.r1) + 1);
      g.fillStyle = 'rgba(124,242,138,.12)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = '#7cf28a'; g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    }
    // playhead
    const tick = Transport.mode === 'song' ? Transport.currentTick() : null;
    if (tick != null) {
      const x = this.xOf(tick / bt);
      g.fillStyle = '#7cf28a'; g.fillRect(x, this.RULER, 2, H);
      if (this.follow && !this.drag && (x > W - 40 || x < this.HEAD)) this.sc.scrollLeft = Math.max(0, (tick / bt) * this.ppb - 40);
    }
    // header column
    g.fillStyle = '#1a1d24'; g.fillRect(0, this.RULER, this.HEAD, H);
    g.textBaseline = 'middle';
    s.tracks.forEach((t, r) => {
      const y = this.yOf(r);
      if (y > H || y + this.rowH < this.RULER) return;
      g.fillStyle = t.id === App.selTrack ? '#262c38' : '#1d2028';
      g.fillRect(0, y, this.HEAD - 1, this.rowH - 1);
      g.fillStyle = t.color; g.fillRect(0, y, 4, this.rowH - 1);
      const L = this.hdr();
      g.fillStyle = t.mute ? '#6a7080' : '#d9dde7'; g.font = 'bold 12px system-ui';
      const maxC = Math.max(5, Math.floor((L.m - 14) / 7.5));
      g.fillText(t.name.length > maxC ? t.name.slice(0, maxC - 1) + '…' : t.name, 10, y + 12);
      g.fillStyle = t.mute ? '#ff6060' : '#2a2f3a'; g.fillRect(L.m, y + 4, 18, 15);
      g.fillStyle = t.solo ? '#ffcf5a' : '#2a2f3a'; g.fillRect(L.s, y + 4, 18, 15);
      g.fillStyle = '#2a2f3a'; g.fillRect(L.mix, y + 4, 18, 15);
      g.font = 'bold 10px system-ui';
      g.fillStyle = t.mute ? '#12141a' : '#9aa1b2'; g.fillText('M', L.m + 5, y + 12);
      g.fillStyle = t.solo ? '#12141a' : '#9aa1b2'; g.fillText('S', L.s + 6, y + 12);
      g.fillStyle = '#9aa1b2'; g.fillText('⚙', L.mix + 4, y + 12);
      // volume bar with a live level meter underneath, then pan
      const vy = y + 25, I = t.inst, vf = clamp(I.vol / 2, 0, 1);
      g.fillStyle = '#12151b'; g.fillRect(L.vx, vy, L.vw, 11);
      g.fillStyle = t.mute ? '#4a505e' : t.color; g.globalAlpha = 0.75; g.fillRect(L.vx, vy, L.vw * vf, 11); g.globalAlpha = 1;
      g.fillStyle = '#5b6375'; g.fillRect(L.vx + L.vw * (0.7 / 2), vy, 1, 11); g.fillRect(L.vx + L.vw / 2, vy, 1, 11);
      if (I.boost > 0.05) { g.fillStyle = '#ff5a5a'; g.fillRect(L.vx + L.vw - 3, vy, 3, 11); }
      g.fillStyle = '#e9edf5'; g.font = '9px Consolas, monospace';
      if (L.vw > 50) g.fillText(MIX.dbText(I.vol) + (I.boost > 0.05 ? ' +' + Math.round(I.boost) : ''), L.vx + 3, vy + 6);
      const an = AE.engine && (AE.engine.chains.get(t.id) || {}).meter;
      let lv = (this.lv.get(t.id) || 0) * 0.88;
      if (an && Transport.playing) {
        const b = this._mb && this._mb.length === an.fftSize ? this._mb : (this._mb = new Float32Array(an.fftSize));
        an.getFloatTimeDomainData(b);
        for (let i = 0; i < b.length; i += 4) { const a = Math.abs(b[i]); if (a > lv) lv = a; }
      }
      this.lv.set(t.id, lv);
      if (lv > 0.002) {
        const f = clamp((20 * Math.log10(lv) + 48) / 54, 0, 1);
        g.fillStyle = f > 0.9 ? '#ff5050' : f > 0.7 ? '#d8e04a' : '#3fbf5a'; g.fillRect(L.vx, vy + 13, L.vw * f, 3);
        if (!Transport.playing) this.requestDraw(); // let the meter fall after stopping
      }
      g.fillStyle = '#12151b'; g.fillRect(L.px, vy, L.pw, 11);
      const pc = L.px + L.pw / 2, pp = pc + I.pan * L.pw / 2;
      g.fillStyle = '#3a4152'; g.fillRect(pc, vy, 1, 11);
      g.fillStyle = '#6cc6ff'; g.fillRect(Math.min(pc, pp), vy + 2, Math.max(2, Math.abs(pp - pc)), 7);
      g.fillStyle = '#7f8696'; g.font = '8px system-ui'; g.fillText('L', L.px + 2, vy + 6); g.fillText('R', L.px + L.pw - 7, vy + 6);
    });
    if (!s.tracks.length) { g.fillStyle = '#8a91a3'; g.font = '13px system-ui'; g.fillText('No tracks — use “＋ Track”.', this.HEAD + 20, this.RULER + 30); }
    g.fillStyle = '#333845'; g.fillRect(this.HEAD - 1, this.RULER, 1, H);
    // ruler
    g.fillStyle = '#1a1d24'; g.fillRect(0, 0, W, this.RULER);
    g.font = '11px system-ui'; g.textBaseline = 'top';
    const step = this.ppb < 18 ? 8 : this.ppb < 30 ? 4 : this.ppb < 45 ? 2 : 1;
    for (let b = b0; b <= b1; b++) {
      const x = this.xOf(b);
      if (x < this.HEAD - 1) continue;
      g.fillStyle = '#3a4152'; g.fillRect(x, b % step ? 22 : 16, 1, 14);
      if (b % step === 0) { g.fillStyle = '#c9ced9'; g.fillText(String(b + 1), x + 3, 16); }
    }
    // loop bracket (or the one being dragged)
    let lo = s.loop.start, le = s.loop.end, show = s.loop.on;
    if (d && d.type === 'ruler' && d.b0 !== d.b1) { lo = Math.min(d.b0, d.b1); le = Math.max(d.b0, d.b1) + 1; show = true; }
    if (show) {
      const x0 = Math.max(this.HEAD, this.xOf(lo)), x1 = this.xOf(le);
      if (x1 > this.HEAD) { g.fillStyle = s.loop.on || d ? 'rgba(124,242,138,.55)' : 'rgba(124,242,138,.2)'; g.fillRect(x0, 0, x1 - x0, 5); }
    }
    // markers
    g.font = 'bold 10px system-ui';
    for (const m of s.markers) {
      const x = this.xOf(m.bar);
      if (x < this.HEAD - 1 || x > W) continue;
      const tw = g.measureText(m.name).width + 8;
      g.fillStyle = '#4a3a6e'; g.fillRect(x, 4, tw, 12);
      g.fillStyle = '#e6dcff'; g.fillText(m.name, x + 4, 5);
    }
    // song position
    if (Transport.mode === 'song') {
      const x = this.xOf(Transport.songPos / bt);
      if (x >= this.HEAD - 1) { g.fillStyle = '#7cf28a'; g.beginPath(); g.moveTo(x - 6, this.RULER - 9); g.lineTo(x + 6, this.RULER - 9); g.lineTo(x, this.RULER - 1); g.fill(); }
    }
    g.fillStyle = '#252933'; g.fillRect(0, 0, this.HEAD, this.RULER);
    g.fillStyle = '#8a91a3'; g.font = 'bold 10px system-ui'; g.textBaseline = 'middle';
    const secs = songEndBar() * s.beatsPerBar * 60 / s.bpm;
    g.fillText('PLAYLIST · ' + songEndBar() + ' bars · ' + fmtTime(secs), 8, this.RULER / 2);
  },
};
