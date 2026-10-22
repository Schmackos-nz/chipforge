'use strict';
// Look-ahead scheduler: a 20ms timer schedules every tick that falls inside the next 120ms.

const Transport = {
  playing: false,
  mode: 'song',
  songPos: 0,      // start tick in song mode
  patPos: 0,       // start tick in pattern mode
  nextTick: 0, nextTime: 0,
  rangeStart: 0, rangeEnd: 0,
  events: null,
  anchors: [],
  timer: null,

  spt() { return 60 / (App.song.bpm * TPB); },
  markDirty() { this.events = null; },

  buildEvents() {
    const s = App.song, ev = new Map(), bt = barTicks(s);
    const add = (tick, o) => { let a = ev.get(tick); if (!a) ev.set(tick, (a = [])); a.push(o); };
    if (this.mode === 'pattern') {
      const pat = getPattern(App.selPattern), len = pat ? pat.bars * bt : bt;
      if (pat) {
        const tr = getTrack(pat.track);
        let notes = pat.notes.filter(n => n.t < len).map(n => ({ t: n.t, d: Math.min(n.d, len - n.t), p: n.p, v: n.v }));
        if (tr && tr.inst.mono) notes = monoTrim(notes);
        for (const n of notes) add(n.t, { tr: pat.track, p: n.p, v: n.v, d: n.d });
      }
      this.rangeStart = 0; this.rangeEnd = len;
    } else {
      for (const [tid, notes] of flattenSong(s, true)) for (const n of notes) add(n.t, { tr: tid, p: n.p, v: n.v, d: n.d });
      if (s.loop.on && s.loop.end > s.loop.start) { this.rangeStart = s.loop.start * bt; this.rangeEnd = s.loop.end * bt; }
      else { this.rangeStart = 0; this.rangeEnd = Math.max(bt, songEndBar(s) * bt); }
    }
    this.events = ev;
    if (this.playing && (this.nextTick < this.rangeStart || this.nextTick >= this.rangeEnd)) this.nextTick = this.rangeStart;
  },

  play() {
    if (this.playing) return;
    const eng = AE.ensure();
    eng.syncAll(App.song);
    this.playing = true;
    this.buildEvents();
    let start = this.mode === 'song' ? this.songPos : this.patPos;
    if (start < this.rangeStart || start >= this.rangeEnd) start = this.rangeStart;
    this.nextTick = start;
    this.nextTime = AE.ctx.currentTime + 0.06;
    this.anchors = [];
    this.timer = setInterval(() => this.pump(), 20);
    this.pump();
    UI.transportChanged();
  },
  stop() {
    if (!this.playing) { if (this.mode === 'song') this.songPos = 0; else this.patPos = 0; UI.transportChanged(); return; }
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    if (AE.engine) AE.engine.silenceAll();
    this.anchors = [];
    Rec.stopAll();
    UI.transportChanged();
  },
  toggle() { if (this.playing) this.stop(); else this.play(); },
  setMode(m) {
    if (this.mode === m) return;
    const was = this.playing;
    if (was) this.stop();
    this.mode = m;
    this.markDirty();
    if (was) this.play();
    UI.transportChanged();
  },
  setSongPos(tick) {
    this.songPos = Math.max(0, tick);
    if (this.playing && this.mode === 'song') { this.stop(); this.play(); }
    UI.transportChanged();
  },
  setPatPos(tick) {
    this.patPos = Math.max(0, tick);
    if (this.playing && this.mode === 'pattern') { this.stop(); this.play(); }
    UI.transportChanged();
  },

  pump() {
    const ctx = AE.ctx;
    if (!this.events) this.buildEvents();
    const ahead = ctx.currentTime + 0.12;
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.02; // tab was asleep: skip instead of bursting
    while (this.nextTime < ahead) {
      const spt = this.spt();
      this.doTick(this.nextTick, this.nextTime, spt);
      this.nextTime += spt;
      this.nextTick++;
      if (this.nextTick >= this.rangeEnd) this.nextTick = this.rangeStart;
    }
    const cut = ctx.currentTime - 0.3;
    let i = 0;
    while (i < this.anchors.length - 1 && this.anchors[i][1] < cut) i++;
    if (i) this.anchors.splice(0, i);
    AE.engine.prune();
  },

  doTick(tick, time, spt) {
    const s = App.song;
    this.anchors.push([tick, time]);
    if (App.metronome && tick % TPB === 0) AE.engine.click(time, ((tick / TPB) % s.beatsPerBar) === 0);
    const evs = this.events.get(tick);
    if (!evs) return;
    const swing = (tick % (TPB / 2)) === TPB / 4 ? s.swing * (TPB / 4) * spt * 0.6 : 0;
    for (const e of evs) {
      const tr = getTrack(e.tr);
      if (tr) AE.engine.noteOn(tr, e.p, e.v, time + swing, e.d * spt, true);
    }
  },

  // Tick currently being heard (fractional), or null when stopped.
  currentTick() {
    if (!this.playing || !AE.ctx) return null;
    const now = AE.ctx.currentTime;
    let a = null;
    for (let i = this.anchors.length - 1; i >= 0; i--) if (this.anchors[i][1] <= now) { a = this.anchors[i]; break; }
    if (!a) return this.anchors.length ? this.anchors[0][0] : this.rangeStart;
    return a[0] + Math.min(1, (now - a[1]) / this.spt());
  },
};

// Recording from the typing keyboard / MIDI input into the open pattern.
const Rec = {
  held: new Map(),
  undoPushed: false,
  relTick() {
    const pat = getPattern(App.selPattern);
    const tick = Transport.currentTick();
    if (!pat || tick == null) return null;
    const len = pat.bars * barTicks();
    if (Transport.mode === 'pattern') return tick % len;
    const clip = App.song.clips.find(c => c.pattern === pat.id && tick >= c.bar * barTicks() && tick < c.bar * barTicks() + len);
    return clip ? tick - clip.bar * barTicks() : null;
  },
  on(id, pitch, vel) {
    if (!App.rec || !Transport.playing) return;
    const t = this.relTick();
    if (t == null) return;
    this.held.set(id, { pitch, vel, t });
  },
  off(id) {
    const h0 = this.held.get(id);
    if (!h0) return;
    this.held.delete(id);
    const pat = getPattern(App.selPattern);
    if (!pat) return;
    const len = pat.bars * barTicks();
    let end = this.relTick();
    if (end == null || end < h0.t) end = len;
    const u = App.snap;
    let t = Math.round(h0.t / u) * u;
    if (t >= len) t = 0;
    const d = Math.max(u, Math.round((end - h0.t) / u) * u);
    if (!this.undoPushed) { pushUndo(); this.undoPushed = true; }
    pat.notes.push({ t, d: Math.min(d, len - t), p: h0.pitch, v: h0.vel });
    // Don't rebuild events mid-loop (would re-trigger what was just played live) — just redraw.
    autosave();
    PR.requestDraw(); ARR.requestDraw();
  },
  stopAll() {
    for (const id of [...this.held.keys()]) this.off(id);
    if (this.undoPushed) { this.undoPushed = false; changed({}); }
  },
};
