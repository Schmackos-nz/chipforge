'use strict';
// Piano roll: canvas drawn under a transparent native scroller (so scrolling feels native).

const CHORD_SHAPES = {
  maj: [0, 4, 7], min: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6],
  sus2: [0, 2, 7], sus4: [0, 5, 7], pow: [0, 7, 12], oct: [0, 12], diatonic: 'tri', diatonic7: 'sev',
};

const PR = {
  ppt: 1.9, rowH: 15, KEYW: 72, RULER: 22,
  sel: new Set(), drag: null, lastLen: 12, vel: 100,
  pressed: new Set(), ghost: true, scaleHL: true, chordType: 'diatonic', needs: true, rows_: null,

  init() {
    this.wrap = $('#prWrap'); this.cv = $('#prCanvas'); this.sc = $('#prScroll'); this.sp = this.sc.firstElementChild;
    this.vcv = $('#velCanvas'); this.vwrap = $('#velWrap');
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    new ResizeObserver(() => this.resize()).observe(this.vwrap);
    this.sc.addEventListener('scroll', () => this.requestDraw());
    this.sc.addEventListener('mousedown', e => this.down(e));
    this.sc.addEventListener('contextmenu', e => e.preventDefault());
    this.sc.addEventListener('mousemove', e => { if (!this.drag) this.hoverCursor(e); });
    this.sc.addEventListener('wheel', e => {
      if (e.ctrlKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX); }
      else if (e.altKey) { e.preventDefault(); this.rowH = clamp(this.rowH + (e.deltaY < 0 ? 1 : -1), 8, 28); this.layout(); }
    }, { passive: false });
    this.vcv.addEventListener('mousedown', e => this.velDown(e));
    this.buildToolbar();
    this.scrolledOnce = false;
  },

  pat() { return getPattern(App.selPattern); },
  track() { const p = this.pat(); return p ? getTrack(p.track) : getTrack(App.selTrack); },
  isDrums() { const t = this.track(); return !!t && t.inst.type === 'drums'; },
  rows() {
    if (this.isDrums()) return DRUM_KIT.map(d => d.p);
    if (!this.rows_) { this.rows_ = []; for (let p = 108; p >= 21; p--) this.rows_.push(p); }
    return this.rows_;
  },
  tool() { return App.tool; },
  snapU(e) { return e && e.altKey ? 1 : App.snap; },
  tickAt(mx) { return (mx - this.KEYW + this.sc.scrollLeft) / this.ppt; },
  rowAt(my) { return Math.floor((my - this.RULER + this.sc.scrollTop) / this.rowH); },
  xOf(t) { return this.KEYW + t * this.ppt - this.sc.scrollLeft; },
  yOf(r) { return this.RULER + r * this.rowH - this.sc.scrollTop; },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const [cv, el] of [[this.cv, this.wrap], [this.vcv, this.vwrap]]) {
      const w = el.clientWidth, hh = el.clientHeight;
      if (!w || !hh) continue;
      cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
      cv.style.width = w + 'px'; cv.style.height = hh + 'px';
    }
    this.layout();
  },
  layout() {
    const pat = this.pat(), bt = barTicks();
    const bars = pat ? Math.max(pat.bars + 2, 4) : 4;
    this.sp.style.width = (this.KEYW + bars * bt * this.ppt) + 'px';
    this.sp.style.height = (this.RULER + this.rows().length * this.rowH) + 'px';
    this.requestDraw();
  },
  zoom(f, clientX) {
    const r = this.sc.getBoundingClientRect();
    const mx = clientX != null ? clientX - r.left : this.sc.clientWidth / 2;
    const tick = this.tickAt(mx);
    this.ppt = clamp(this.ppt * f, 0.35, 12);
    this.layout();
    this.sc.scrollLeft = Math.max(0, tick * this.ppt - (mx - this.KEYW));
  },
  scrollToNotes() {
    const pat = this.pat();
    if (!pat || this.isDrums()) { this.sc.scrollTop = 0; return; }
    let sum = 0;
    for (const n of pat.notes) sum += n.p;
    const center = pat.notes.length ? sum / pat.notes.length : 66;
    const row = this.rows().indexOf(Math.round(center));
    this.sc.scrollTop = Math.max(0, row * this.rowH - this.sc.clientHeight / 2);
  },
  open(patId) {
    const pat = getPattern(patId);
    if (!pat) return;
    App.selPattern = patId;
    App.selTrack = pat.track;
    this.sel.clear();
    UI.setView('piano');
    this.layout();
    this.sc.scrollLeft = 0;
    this.scrollToNotes();
    UI.render({ lists: true });
  },
  requestDraw() { this.needs = true; },

  hit(tick, row) {
    const pat = this.pat(), rows = this.rows();
    if (!pat) return null;
    for (let i = pat.notes.length - 1; i >= 0; i--) {
      const n = pat.notes[i];
      if (rows.indexOf(n.p) === row && tick >= n.t && tick < n.t + n.d) return n;
    }
    return null;
  },
  hoverCursor(e) {
    const r = this.sc.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let cur = 'default';
    if (mx > this.KEYW && my > this.RULER) {
      const n = this.hit(this.tickAt(mx), this.rowAt(my));
      if (n) cur = this.xOf(n.t + n.d) - mx < Math.max(5, Math.min(10, n.d * this.ppt * 0.3)) ? 'ew-resize' : 'move';
      else cur = App.tool === 'erase' ? 'not-allowed' : App.tool === 'select' ? 'crosshair' : 'copy';
    } else if (mx <= this.KEYW) cur = 'pointer';
    this.sc.style.cursor = cur;
  },
  chordPitches(root) {
    const shape = CHORD_SHAPES[this.chordType] || CHORD_SHAPES.maj;
    const s = App.song;
    if (shape === 'tri' || shape === 'sev') {
      const iv = scaleIv(s.scale), r = snapToScale(root, s.key, iv);
      const steps = shape === 'tri' ? [0, 2, 4] : [0, 2, 4, 6];
      return steps.map(k => shiftInScale(r, k, s.key, iv));
    }
    return shape.map(i => root + i);
  },
  capture() {
    const mv = e => this.move(e), up = e => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); this.up(e); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  },
  local(e) { const r = this.sc.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },

  down(e) {
    const [mx, my] = this.local(e);
    if (mx > this.sc.clientWidth || my > this.sc.clientHeight) return; // on a scrollbar
    const pat = this.pat();
    if (!pat) return;
    e.preventDefault();
    AE.ensure();
    const rows = this.rows(), tick = this.tickAt(mx), row = this.rowAt(my), u = this.snapU(e);
    if (my < this.RULER) {
      if (mx > this.KEYW) Transport.setPatPos(Math.floor(Math.max(0, tick) / barTicks() * 4) * barTicks() / 4);
      return;
    }
    if (mx < this.KEYW) {
      if (row >= 0 && row < rows.length) { this.drag = { type: 'keys', pitch: rows[row] }; liveOn('mouse', rows[row], 100); this.capture(); }
      return;
    }
    if (row < 0 || row >= rows.length) return;
    const pitch = rows[row], hit = this.hit(tick, row);
    if (e.button === 2 || App.tool === 'erase') {
      pushUndo();
      this.drag = { type: 'erase', changed: false };
      this.eraseAt(tick, row);
      this.capture();
      return;
    }
    if (e.button !== 0) return;
    if (hit) {
      if (e.ctrlKey) { if (this.sel.has(hit)) this.sel.delete(hit); else this.sel.add(hit); this.requestDraw(); return; }
      if (!this.sel.has(hit)) { this.sel.clear(); this.sel.add(hit); }
      const nearEnd = this.xOf(hit.t + hit.d) - mx < Math.max(5, Math.min(10, hit.d * this.ppt * 0.3));
      if (nearEnd) this.drag = { type: 'resize', anchor: hit, orig: [...this.sel].map(n => [n, n.d]), t0: tick, pushed: false };
      else {
        this.drag = { type: 'move', anchor: hit, orig: [...this.sel].map(n => [n, n.t, n.p]), t0: tick, row0: row, pushed: false, dup: e.shiftKey, lastP: hit.p };
        liveOn('mouse', hit.p, hit.v);
      }
      this.capture();
      this.requestDraw();
      return;
    }
    if (App.tool === 'select' || e.ctrlKey) {
      if (!e.shiftKey && !e.ctrlKey) this.sel.clear();
      this.drag = { type: 'marquee', t0: tick, r0: row, t1: tick, r1: row, base: new Set(this.sel) };
      this.capture();
      this.requestDraw();
      return;
    }
    pushUndo();
    const t = Math.max(0, Math.floor(tick / u) * u);
    const pitches = App.tool === 'chord' && !this.isDrums() ? this.chordPitches(pitch) : [pitch];
    this.sel.clear();
    const made = [];
    for (const p of pitches) {
      if (p < 0 || p > 127) continue;
      const n = { t, d: this.lastLen, p, v: this.vel };
      pat.notes.push(n); made.push(n); this.sel.add(n);
    }
    liveOn('mouse', pitch, this.vel);
    if (pitches.length > 1) setTimeout(() => { for (const p of pitches.slice(1)) previewOnce(p, this.vel); }, 0);
    this.drag = { type: 'draw', notes: made, t0: t, u, moved: false };
    this.capture();
    this.edited(true);
  },

  move(e) {
    const d = this.drag;
    if (!d) return;
    const pat = this.pat();
    const [mx, my] = this.local(e);
    const tick = this.tickAt(mx), row = this.rowAt(my), rows = this.rows(), u = this.snapU(e);
    if (d.type === 'keys') {
      const p = rows[clamp(row, 0, rows.length - 1)];
      if (p !== d.pitch) { liveOff('mouse'); d.pitch = p; liveOn('mouse', p, 100); }
      return;
    }
    if (d.type === 'erase') { this.eraseAt(tick, row); return; }
    if (d.type === 'draw') {
      const len = Math.ceil((tick - d.t0) / d.u) * d.u;
      if (len > d.u || d.moved) { d.moved = true; for (const n of d.notes) n.d = Math.max(d.u, len); this.edited(true); }
      return;
    }
    if (d.type === 'marquee') {
      d.t1 = tick; d.r1 = row;
      const t0 = Math.min(d.t0, d.t1), t1 = Math.max(d.t0, d.t1), r0 = Math.min(d.r0, d.r1), r1 = Math.max(d.r0, d.r1);
      this.sel = new Set(d.base);
      for (const n of pat.notes) { const r = rows.indexOf(n.p); if (r >= r0 && r <= r1 && n.t < t1 && n.t + n.d > t0) this.sel.add(n); }
      this.requestDraw();
      return;
    }
    if (d.type === 'move') {
      let dt = Math.round((tick - d.t0) / u) * u;
      const dRow = row - d.row0;
      if (!d.pushed) {
        if (dt === 0 && dRow === 0) return;
        pushUndo();
        d.pushed = true;
        if (d.dup) for (const [n] of d.orig) pat.notes.push(Object.assign({}, n)); // copies stay behind
      }
      const minT = Math.min(...d.orig.map(o => o[1]));
      if (minT + dt < 0) dt = -minT;
      for (const [n, t0, p0] of d.orig) {
        n.t = t0 + dt;
        if (this.isDrums()) n.p = rows[clamp(rows.indexOf(p0) + dRow, 0, rows.length - 1)];
        else n.p = clamp(p0 - dRow, 0, 127);
      }
      if (d.anchor.p !== d.lastP) { liveOff('mouse'); liveOn('mouse', d.anchor.p, d.anchor.v); d.lastP = d.anchor.p; }
      this.edited(true);
      return;
    }
    if (d.type === 'resize') {
      const dt = Math.round((tick - d.t0) / u) * u;
      if (!d.pushed) { if (dt === 0) return; pushUndo(); d.pushed = true; }
      for (const [n, d0] of d.orig) n.d = Math.max(u === 1 ? 1 : Math.min(u, d0), d0 + dt);
      this.edited(true);
    }
  },

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    liveOff('mouse');
    const pat = this.pat();
    if (d.type === 'erase') { if (!d.changed) App.undoStack.pop(); else this.edited(); return; }
    if (d.type === 'draw') { if (d.moved && d.notes[0]) this.lastLen = d.notes[0].d; growPattern(pat); this.edited(); this.layout(); return; }
    if ((d.type === 'move' || d.type === 'resize') && d.pushed) {
      if (d.type === 'resize') this.lastLen = d.anchor.d;
      growPattern(pat);
      this.edited();
      this.layout();
      return;
    }
    if (d.type === 'move' && !d.pushed) this.lastLen = d.anchor.d;
    this.requestDraw();
  },

  eraseAt(tick, row) {
    const n = this.hit(tick, row);
    if (!n) return;
    const pat = this.pat();
    pat.notes.splice(pat.notes.indexOf(n), 1);
    this.sel.delete(n);
    this.drag.changed = true;
    this.edited(true);
  },

  // light=true while dragging: just redraw; otherwise do the full change pipeline.
  edited(light) {
    if (light) { Transport.markDirty(); this.requestDraw(); ARR.requestDraw(); return; }
    changed({});
  },

  // ---- keyboard commands
  key(e) {
    const pat = this.pat();
    if (!pat) return false;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, rows = this.rows();
    const sel = [...this.sel];
    if (ctrl && k.toLowerCase() === 'a') { this.sel = new Set(pat.notes); this.requestDraw(); return true; }
    if (ctrl && k.toLowerCase() === 'c') { if (sel.length) { App.clipNotes = sel.map(n => Object.assign({}, n)); toast(sel.length + ' notes copied'); } return true; }
    if (ctrl && k.toLowerCase() === 'x') { if (sel.length) { App.clipNotes = sel.map(n => Object.assign({}, n)); pushUndo(); pat.notes = pat.notes.filter(n => !this.sel.has(n)); this.sel.clear(); this.edited(); } return true; }
    if (ctrl && k.toLowerCase() === 'v') {
      if (!App.clipNotes || !App.clipNotes.length) return true;
      pushUndo();
      const minT = Math.min(...App.clipNotes.map(n => n.t));
      let at = Transport.currentTick();
      at = at == null ? (sel.length ? Math.max(...sel.map(n => n.t + n.d)) : Transport.patPos) : at % (pat.bars * barTicks());
      at = Math.round(at / App.snap) * App.snap;
      this.sel.clear();
      for (const n of App.clipNotes) { const c = Object.assign({}, n, { t: n.t - minT + at }); pat.notes.push(c); this.sel.add(c); }
      growPattern(pat); this.edited(); this.layout();
      return true;
    }
    if (ctrl && k.toLowerCase() === 'd') {
      if (!sel.length) return true;
      pushUndo();
      const s0 = Math.min(...sel.map(n => n.t)), s1 = Math.max(...sel.map(n => n.t + n.d));
      const span = Math.ceil((s1 - s0) / App.snap) * App.snap;
      this.sel.clear();
      for (const n of sel) { const c = Object.assign({}, n, { t: n.t + span }); pat.notes.push(c); this.sel.add(c); }
      growPattern(pat); this.edited(); this.layout();
      return true;
    }
    if (k === 'Delete' || k === 'Backspace') {
      if (!sel.length) return true;
      pushUndo();
      pat.notes = pat.notes.filter(n => !this.sel.has(n));
      this.sel.clear();
      this.edited();
      return true;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!sel.length) return false;
      pushUndo();
      const dir = k === 'ArrowUp' ? 1 : -1;
      for (const n of sel) {
        if (this.isDrums()) n.p = rows[clamp(rows.indexOf(n.p) - dir, 0, rows.length - 1)];
        else n.p = clamp(n.p + dir * (e.shiftKey ? 12 : 1), 0, 127);
      }
      if (sel.length === 1) previewOnce(sel[0].p, sel[0].v);
      this.edited();
      return true;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!sel.length) return false;
      pushUndo();
      const dir = k === 'ArrowRight' ? 1 : -1, step = e.shiftKey ? barTicks() : App.snap;
      if (dir < 0 && Math.min(...sel.map(n => n.t)) - step < 0) return true;
      for (const n of sel) n.t += dir * step;
      growPattern(pat); this.edited(); this.layout();
      return true;
    }
    return false;
  },

  // ---- toolbar actions
  targetNotes() { const p = this.pat(); return this.sel.size ? [...this.sel] : (p ? p.notes : []); },
  quantize() {
    const notes = this.targetNotes();
    if (!notes.length) return;
    pushUndo();
    for (const n of notes) { n.t = Math.round(n.t / App.snap) * App.snap; n.d = Math.max(App.snap, Math.round(n.d / App.snap) * App.snap); }
    this.edited(); toast('Quantized to ' + snapName(App.snap));
  },
  legato() {
    const pat = this.pat(), notes = this.targetNotes().slice().sort((a, b) => a.t - b.t);
    if (!notes.length) return;
    pushUndo();
    const starts = [...new Set(notes.map(n => n.t))].sort((a, b) => a - b);
    for (const n of notes) { const nx = starts.find(s => s > n.t); n.d = (nx != null ? nx : pat.bars * barTicks()) - n.t; }
    this.edited(); toast('Legato');
  },
  transpose(st) {
    const notes = this.targetNotes();
    if (!notes.length || this.isDrums()) return;
    pushUndo();
    for (const n of notes) n.p = clamp(n.p + st, 0, 127);
    this.edited();
  },
  reverse() {
    const pat = this.pat(), notes = this.targetNotes();
    if (!notes.length) return;
    pushUndo();
    const s0 = Math.min(...notes.map(n => n.t)), s1 = Math.max(...notes.map(n => n.t + n.d));
    for (const n of notes) n.t = s0 + (s1 - (n.t + n.d));
    growPattern(pat); this.edited();
  },
  humanizeVel() {
    const notes = this.targetNotes();
    if (!notes.length) return;
    pushUndo();
    for (const n of notes) n.v = clamp(Math.round(n.v + (Math.random() - 0.5) * 24), 20, 127);
    this.edited();
  },
  setLength(bars) {
    const pat = this.pat();
    if (!pat) return;
    pushUndo();
    pat.bars = clamp(bars, 1, 64);
    this.edited();
    this.layout();
  },

  buildToolbar() {
    const tb = $('#prTools');
    tb.innerHTML = '';
    this.patSel = h('select', { title: 'Pattern being edited', style: { maxWidth: '150px' } });
    this.patSel.onchange = () => this.open(this.patSel.value);
    this.lenLbl = h('span', { style: { minWidth: '44px', textAlign: 'center' } });
    const toolBtn = (t, label, title) => h('button', { 'data-tool': t, title, onclick: () => UI.setTool(t) }, label);
    const snapSel = h('select', { id: 'snapSel', title: 'Grid snap (hold Alt to drag without snap)' }, SNAPS.map(([v, l]) => h('option', { value: v }, l)));
    snapSel.onchange = () => { App.snap = +snapSel.value; this.requestDraw(); };
    const chordSel = h('select', { title: 'Chord shape for the chord tool' }, Object.keys(CHORD_SHAPES).map(k => h('option', { value: k, selected: k === this.chordType },
      k === 'diatonic' ? 'In-key triad' : k === 'diatonic7' ? 'In-key 7th' : k)));
    chordSel.onchange = () => { this.chordType = chordSel.value; UI.setTool('chord'); };
    const velIn = h('input', { type: 'range', min: 1, max: 127, value: this.vel, style: { width: '60px' }, title: 'Velocity for new notes' });
    velIn.oninput = () => { this.vel = +velIn.value; };
    const tog = (label, key, title) => {
      const b = h('button', { class: 'tog' + (this[key] ? ' on' : ''), title }, label);
      b.onclick = () => { this[key] = !this[key]; b.classList.toggle('on', this[key]); this.requestDraw(); };
      return b;
    };
    const roleSel = h('select', { title: 'What to generate into this pattern' }, [['melody', 'Melody'], ['bass', 'Bassline'], ['chords', 'Chords'], ['arp', 'Arpeggio'], ['drums', 'Drum beat']].map(([v, l]) => h('option', { value: v }, l)));
    this.roleSel = roleSel;
    tb.append(
      this.patSel,
      h('button', { title: 'New empty pattern on this track', onclick: () => UI.newPattern() }, '＋'),
      h('button', { title: 'Clone this pattern (make unique copy)', onclick: () => UI.clonePattern() }, '⧉'),
      h('span', { class: 'sep' }),
      h('button', { title: 'Shorter', onclick: () => { const p = this.pat(); if (p) this.setLength(p.bars - 1); } }, '−'),
      this.lenLbl,
      h('button', { title: 'Longer', onclick: () => { const p = this.pat(); if (p) this.setLength(p.bars + 1); } }, '+'),
      h('span', { class: 'sep' }),
      toolBtn('draw', '✎ Draw', 'Draw / move / resize notes (right-click deletes)'),
      toolBtn('select', '⬚ Select', 'Box select (or Ctrl+drag in draw mode)'),
      toolBtn('erase', '⌫ Erase', 'Erase notes'),
      toolBtn('chord', '♫ Chord', 'Stamp a whole chord with one click'),
      chordSel,
      h('span', { class: 'sep' }),
      h('label', null, 'Snap', snapSel),
      h('label', null, 'Vel', velIn),
      tog('Scale', 'scaleHL', 'Highlight notes in the song key'),
      tog('Ghosts', 'ghost', 'Show other tracks playing at the same time'),
      h('span', { class: 'sep' }),
      h('button', { title: 'Quantize selection (or all) to snap', onclick: () => this.quantize() }, 'Quantize'),
      h('button', { title: 'Stretch notes to meet the next note', onclick: () => this.legato() }, 'Legato'),
      h('button', { title: 'Transpose down an octave', onclick: () => this.transpose(-12) }, '−8va'),
      h('button', { title: 'Transpose up an octave', onclick: () => this.transpose(12) }, '+8va'),
      h('button', { title: 'Reverse selection in time', onclick: () => this.reverse() }, 'Reverse'),
      h('button', { title: 'Randomise velocities a little', onclick: () => this.humanizeVel() }, 'Humanize'),
      h('span', { class: 'sep' }),
      h('button', { class: 'gen', title: 'Make a variation of this pattern that still fits the song', onclick: () => UI.varyPattern() }, '✨ Vary'),
      roleSel,
      h('button', { class: 'gen', title: 'Generate this part over the song’s chords (replaces the pattern)', onclick: () => UI.generatePart(roleSel.value) }, '✨ Generate'),
      h('span', { class: 'sep' }),
      h('button', { title: 'Zoom out (Ctrl+wheel)', onclick: () => this.zoom(1 / 1.3) }, '－'),
      h('button', { title: 'Zoom in (Ctrl+wheel)', onclick: () => this.zoom(1.3) }, '＋'),
    );
  },
  syncToolbar() {
    const tr = getTrack(App.selTrack);
    const pats = tr ? trackPatterns(tr.id) : [];
    this.patSel.innerHTML = '';
    if (!pats.length) this.patSel.append(h('option', { value: '' }, '(no pattern)'));
    for (const p of pats) this.patSel.append(h('option', { value: p.id, selected: p.id === App.selPattern }, p.name));
    const pat = this.pat();
    this.lenLbl.textContent = pat ? pat.bars + (pat.bars === 1 ? ' bar' : ' bars') : '–';
    $$('#prTools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === App.tool));
    $('#snapSel').value = String(App.snap);
    if (tr) this.roleSel.value = tr.inst.type === 'drums' || tr.inst.type === 'noise' ? 'drums' : /bass/i.test(tr.name) || tr.inst.type === 'triangle' ? 'bass' : /harm|chord|pad/i.test(tr.name) ? 'chords' : /arp/i.test(tr.name) ? 'arp' : 'melody';
  },

  // ---- velocity lane
  velDown(e) {
    const pat = this.pat();
    if (!pat) return;
    pushUndo();
    let changedAny = false;
    const apply = ev => {
      const r = this.vcv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const v = clamp(Math.round((1 - my / r.height) * 127), 1, 127);
      const hits = pat.notes.filter(n => Math.abs(this.xOf(n.t) - mx) < Math.max(4, Math.min(n.d * this.ppt, 8)) && (!this.sel.size || this.sel.has(n)));
      for (const n of hits) { n.v = v; changedAny = true; }
      this.requestDraw();
    };
    apply(e);
    const up = () => { window.removeEventListener('mousemove', apply); window.removeEventListener('mouseup', up); if (changedAny) this.edited(); else App.undoStack.pop(); };
    window.addEventListener('mousemove', apply);
    window.addEventListener('mouseup', up);
  },

  // ---- drawing
  ghostNotes(pat) {
    if (!this.ghost) return [];
    const clip = App.song.clips.find(c => c.pattern === pat.id);
    if (!clip) return [];
    const bt = barTicks(), s = clip.bar * bt, e = s + pat.bars * bt, out = [];
    for (const [tid, notes] of flattenSong(App.song, false)) {
      if (tid === pat.track) continue;
      const tr = getTrack(tid);
      if (!tr || tr.inst.type === 'drums' || tr.inst.type === 'noise') continue;
      for (const n of notes) if (n.t >= s && n.t < e) out.push({ t: n.t - s, d: n.d, p: n.p, c: tr.color });
    }
    return out;
  },
  playTick(pat) {
    const tick = Transport.currentTick();
    if (tick == null) return null;
    const len = pat.bars * barTicks();
    if (Transport.mode === 'pattern') return App.selPattern === pat.id ? tick % len : null;
    const bt = barTicks();
    const clip = App.song.clips.find(c => c.pattern === pat.id && tick >= c.bar * bt && tick < c.bar * bt + len);
    return clip ? tick - clip.bar * bt : null;
  },

  draw() {
    this.needs = false;
    const cv = this.cv, g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = cv.width / dpr, H = cv.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#12141a'; g.fillRect(0, 0, W, H);
    const pat = this.pat(), tr = this.track(), rows = this.rows(), drums = this.isDrums();
    if (!pat) {
      g.fillStyle = '#8a91a3'; g.font = '14px system-ui'; g.textAlign = 'center';
      g.fillText(tr ? 'No pattern yet — click ＋ to create one.' : 'Add a track first.', W / 2, H / 2);
      this.drawVel(null);
      return;
    }
    const s = App.song, bt = barTicks(), sl = this.sc.scrollLeft, st = this.sc.scrollTop;
    const scPcs = scalePcs(s.key, s.scale);
    const r0 = Math.max(0, Math.floor(st / this.rowH)), r1 = Math.min(rows.length - 1, Math.ceil((st + H) / this.rowH));
    // rows
    for (let r = r0; r <= r1; r++) {
      const p = rows[r], y = this.yOf(r);
      const black = !drums && [1, 3, 6, 8, 10].includes(pc(p));
      let col = black ? '#171a21' : '#1c2028';
      if (!drums && this.scaleHL) {
        if (!scPcs.includes(pc(p))) col = '#13151b';
        else if (pc(p) === s.key) col = '#1f2a24';
      }
      if (drums) col = r % 2 ? '#1a1d24' : '#1d2129';
      g.fillStyle = col; g.fillRect(this.KEYW, y, W, this.rowH);
      g.fillStyle = pc(p) === 0 && !drums ? '#2a303c' : '#181b22';
      g.fillRect(this.KEYW, y + this.rowH - 1, W, 1);
    }
    // grid
    const t0 = Math.max(0, Math.floor(sl / this.ppt)), t1 = (sl + W) / this.ppt;
    const minor = Math.max(App.snap, this.ppt * App.snap < 6 ? TPB : App.snap);
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = Math.round(this.xOf(t)) + 0.5;
      g.fillStyle = t % bt === 0 ? '#3a4152' : t % TPB === 0 ? '#272c37' : '#1e222b';
      g.fillRect(x, this.RULER, 1, H);
    }
    // beyond pattern end
    const endX = this.xOf(pat.bars * bt);
    if (endX < W) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(Math.max(this.KEYW, endX), this.RULER, W, H); g.fillStyle = '#ff7ab6'; g.fillRect(endX, this.RULER, 2, H); }
    // loop start marker (pattern mode)
    // ghost notes
    for (const n of this.ghostNotes(pat)) {
      const r = rows.indexOf(n.p);
      if (r < r0 || r > r1) continue;
      g.fillStyle = n.c + '30';
      g.fillRect(this.xOf(n.t), this.yOf(r) + 2, Math.max(2, n.d * this.ppt - 1), this.rowH - 4);
    }
    // notes
    g.font = '10px system-ui'; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const n of pat.notes) {
      const r = rows.indexOf(n.p);
      if (r < r0 - 1 || r > r1 + 1) continue;
      const x = this.xOf(n.t), w = Math.max(3, n.d * this.ppt - 1), y = this.yOf(r);
      if (x > W || x + w < this.KEYW) continue;
      const selN = this.sel.has(n);
      g.globalAlpha = 0.55 + 0.45 * (n.v / 127);
      g.fillStyle = tr.color;
      g.fillRect(x, y + 1, w, this.rowH - 2);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + w - 3, y + 1, 3, this.rowH - 2);
      if (selN) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 1.5, w - 1, this.rowH - 3); }
      if (w > 26 && this.rowH >= 11) { g.fillStyle = '#0c0e12'; g.fillText(drums ? DRUM_NAME[n.p] || '' : noteName(n.p), x + 3, y + this.rowH / 2 + 0.5); }
    }
    // marquee
    const d = this.drag;
    if (d && d.type === 'marquee') {
      const x0 = this.xOf(Math.min(d.t0, d.t1)), x1 = this.xOf(Math.max(d.t0, d.t1));
      const y0 = this.yOf(Math.min(d.r0, d.r1)), y1 = this.yOf(Math.max(d.r0, d.r1) + 1);
      g.fillStyle = 'rgba(124,242,138,.12)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = '#7cf28a'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    }
    // playhead / start marker
    const pt = this.playTick(pat);
    if (pt != null) { const x = this.xOf(pt); g.fillStyle = '#7cf28a'; g.fillRect(x, this.RULER, 2, H); }
    // keys column
    for (let r = r0; r <= r1; r++) {
      const p = rows[r], y = this.yOf(r);
      const black = !drums && [1, 3, 6, 8, 10].includes(pc(p));
      const pressed = this.pressed.has(p);
      g.fillStyle = pressed ? '#7cf28a' : drums ? '#252a34' : black ? '#16181d' : '#d8dbe2';
      g.fillRect(0, y, this.KEYW, this.rowH - 1);
      if (drums || pc(p) === 0 || this.rowH >= 13) {
        g.fillStyle = pressed ? '#0c0e12' : drums ? '#d9dde7' : black ? '#7f8696' : '#30343e';
        g.font = (pc(p) === 0 && !drums ? 'bold ' : '') + '10px system-ui';
        g.fillText(drums ? DRUM_NAME[p] : noteName(p), 6, y + this.rowH / 2 + 0.5);
      }
    }
    g.fillStyle = '#333845'; g.fillRect(this.KEYW - 1, this.RULER, 1, H);
    // ruler
    g.fillStyle = '#1a1d24'; g.fillRect(0, 0, W, this.RULER);
    g.fillStyle = '#8a91a3'; g.font = '11px system-ui';
    for (let b = Math.floor(t0 / bt); b * bt <= t1; b++) {
      const x = this.xOf(b * bt);
      if (x < this.KEYW - 2) continue;
      g.fillStyle = b < pat.bars ? '#c9ced9' : '#5c6272';
      g.fillRect(x, 10, 1, 12);
      g.fillText(String(b + 1), x + 4, 12);
      g.fillStyle = '#3a4152';
      for (let k = 1; k < s.beatsPerBar; k++) g.fillRect(this.xOf(b * bt + k * TPB), 16, 1, 6);
    }
    if (Transport.mode === 'pattern') {
      const x = this.xOf(Transport.patPos);
      if (x >= this.KEYW) { g.fillStyle = '#7cf28a'; g.beginPath(); g.moveTo(x - 5, 2); g.lineTo(x + 5, 2); g.lineTo(x, 9); g.fill(); }
    }
    g.fillStyle = '#252933'; g.fillRect(0, 0, this.KEYW, this.RULER);
    g.fillStyle = tr.color; g.fillRect(0, 0, 4, this.RULER);
    g.fillStyle = '#d9dde7'; g.font = 'bold 11px system-ui';
    g.fillText(tr.name.slice(0, 10), 8, 12);
    this.drawVel(pat);
  },
  drawVel(pat) {
    const cv = this.vcv, g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = cv.width / dpr, H = cv.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#101217'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5c6272'; g.font = '10px system-ui'; g.textBaseline = 'top';
    g.fillText('VELOCITY', 6, 6);
    if (!pat) return;
    const tr = getTrack(pat.track);
    for (const n of pat.notes) {
      const x = this.xOf(n.t);
      if (x < this.KEYW || x > W) continue;
      const hh = (n.v / 127) * (H - 8);
      g.fillStyle = this.sel.has(n) ? '#ffffff' : tr.color;
      g.fillRect(x, H - hh, 3, hh);
      g.fillRect(x, H - hh, Math.min(10, Math.max(3, n.d * this.ppt - 2)), 2);
    }
  },
};

const SNAPS = [[1, 'None'], [3, '1/64'], [6, '1/32'], [8, '1/16 T'], [12, '1/16'], [16, '1/8 T'], [24, '1/8'], [48, '1/4'], [96, '1/2'], [192, 'Bar']];
function snapName(v) { const s = SNAPS.find(x => x[0] === v); return s ? s[1] : v + ' ticks'; }
