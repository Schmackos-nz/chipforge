'use strict';
// Playlist / arrangement: tracks × bars, clips are pattern instances.

const ARR = {
  ppb: 54, rowH: 44, HEAD: 168, RULER: 30,
  sel: new Set(), drag: null, needs: true, follow: true,

  init() {
    this.wrap = $('#arrWrap'); this.cv = $('#arrCanvas'); this.sc = $('#arrScroll'); this.sp = this.sc.firstElementChild;
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    this.sc.addEventListener('scroll', () => this.requestDraw());
    this.sc.addEventListener('mousedown', e => this.down(e));
    this.sc.addEventListener('contextmenu', e => e.preventDefault());
    this.sc.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX); } }, { passive: false });
    this.sc.addEventListener('mousemove', e => { if (!this.drag) this.hoverCursor(e); });
    this.buildToolbar();
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
    else if (mx > this.HEAD) { const tr = App.song.tracks[this.rowAt(my)]; cur = tr && this.clipAt(tr.id, this.barAt(mx)) ? 'move' : tr ? 'copy' : 'default'; }
    else cur = 'pointer';
    this.sc.style.cursor = cur;
  },
  capture() {
    const mv = e => this.move(e), up = e => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); this.up(e); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  },

  down(e) {
    const [mx, my] = this.local(e);
    if (mx > this.sc.clientWidth || my > this.sc.clientHeight) return;
    e.preventDefault();
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
      const ry = my - this.yOf(row);
      const bx = this.HEAD - 50;
      if (ry > 22 && ry < 40 && mx >= bx && mx < bx + 20) { pushUndo(); tr.mute = !tr.mute; changed({ lists: true }); return; }
      if (ry > 22 && ry < 40 && mx >= bx + 23 && mx < bx + 43) {
        pushUndo();
        if (e.ctrlKey) { const only = !tr.solo; s.tracks.forEach(t => { t.solo = false; }); tr.solo = only; } else tr.solo = !tr.solo;
        changed({ lists: true }); return;
      }
      UI.selectTrack(tr.id);
      if (e.detail === 2) UI.renameTrack(tr.id);
      return;
    }
    if (!tr) { if (!e.ctrlKey) { this.sel.clear(); this.requestDraw(); } return; }
    const barF = Math.max(0, this.barAt(mx)), hit = this.clipAt(tr.id, barF);
    if (e.button === 2) {
      pushUndo();
      this.drag = { type: 'erase', changed: false };
      this.eraseAt(mx, my);
      this.capture();
      return;
    }
    if (e.button !== 0) return;
    if (hit) {
      if (e.detail === 2) { PR.open(hit.pattern); return; }
      if (e.ctrlKey) { if (this.sel.has(hit)) this.sel.delete(hit); else this.sel.add(hit); this.requestDraw(); return; }
      if (!this.sel.has(hit)) { this.sel.clear(); this.sel.add(hit); }
      App.selTrack = tr.id; App.selPattern = hit.pattern;
      UI.render({ lists: true });
      this.drag = { type: 'move', orig: [...this.sel].map(c => [c, c.bar]), b0: barF, pushed: false, dup: e.shiftKey };
      this.capture();
      return;
    }
    if (e.ctrlKey) {
      this.drag = { type: 'marquee', b0: barF, r0: row, b1: barF, r1: row };
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
  move(e) {
    const d = this.drag;
    if (!d) return;
    const [mx, my] = this.local(e);
    const barF = Math.max(0, this.barAt(mx));
    if (d.type === 'ruler') { d.b1 = Math.max(0, Math.floor(barF)); this.requestDraw(); return; }
    if (d.type === 'erase') { this.eraseAt(mx, my); return; }
    if (d.type === 'marquee') {
      d.b1 = barF; d.r1 = this.rowAt(my);
      const b0 = Math.min(d.b0, d.b1), b1 = Math.max(d.b0, d.b1), r0 = Math.min(d.r0, d.r1), r1 = Math.max(d.r0, d.r1);
      const pm = patternMap(App.song);
      this.sel.clear();
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
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, s = App.song, sel = [...this.sel];
    const pm = patternMap(s);
    if (ctrl && k.toLowerCase() === 'a') { this.sel = new Set(s.clips); this.requestDraw(); return true; }
    if (k === 'Delete' || k === 'Backspace') {
      if (!sel.length) return true;
      pushUndo();
      s.clips = s.clips.filter(c => !this.sel.has(c));
      this.sel.clear();
      changed({});
      return true;
    }
    if (ctrl && k.toLowerCase() === 'c') { if (sel.length) { App.clipClips = sel.map(c => Object.assign({}, c)); toast(sel.length + ' clips copied'); } return true; }
    if (ctrl && k.toLowerCase() === 'v') {
      if (!App.clipClips || !App.clipClips.length) return true;
      pushUndo();
      const minB = Math.min(...App.clipClips.map(c => c.bar)), at = Math.floor(Transport.songPos / barTicks());
      this.sel.clear();
      for (const c of App.clipClips) if (pm.has(c.pattern)) this.sel.add(addClip(s, c.track, c.pattern, c.bar - minB + at));
      changed({}); this.layout();
      return true;
    }
    if (ctrl && k.toLowerCase() === 'd') {
      if (!sel.length) return true;
      pushUndo();
      const b0 = Math.min(...sel.map(c => c.bar)), b1 = Math.max(...sel.map(c => c.bar + (pm.get(c.pattern) || { bars: 1 }).bars));
      this.sel.clear();
      for (const c of sel) this.sel.add(addClip(s, c.track, c.pattern, c.bar + (b1 - b0)));
      changed({}); this.layout();
      return true;
    }
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
    tb.append(
      h('span', { class: 'empty', style: { padding: '0 4px' } }, 'Click = paint pattern · drag = move/stamp · Shift+drag = copy · right-click = delete · double-click = edit · Ctrl+drag = select · drag ruler = loop'),
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
      if (p.notes.length) {
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
      g.fillStyle = t.mute ? '#6a7080' : '#d9dde7'; g.font = 'bold 12px system-ui';
      g.fillText(t.name.length > 18 ? t.name.slice(0, 17) + '…' : t.name, 10, y + 13);
      g.fillStyle = '#7f8696'; g.font = '10px system-ui';
      g.fillText((INST_TYPES.find(x => x[0] === t.inst.type) || ['', ''])[1], 10, y + 31);
      const bx = this.HEAD - 50;
      g.fillStyle = t.mute ? '#ff6060' : '#2a2f3a'; g.fillRect(bx, y + 23, 20, 16);
      g.fillStyle = t.solo ? '#ffcf5a' : '#2a2f3a'; g.fillRect(bx + 23, y + 23, 20, 16);
      g.fillStyle = t.mute ? '#12141a' : '#9aa1b2'; g.font = 'bold 10px system-ui'; g.fillText('M', bx + 6, y + 31.5);
      g.fillStyle = t.solo ? '#12141a' : '#9aa1b2'; g.fillText('S', bx + 30, y + 31.5);
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
