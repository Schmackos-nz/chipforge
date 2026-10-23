'use strict';
// Song model, undo/redo, autosave.
// Song = tracks (instrument + mixer settings) + patterns (notes, owned by a track) + clips (pattern placed at a bar).
// Note = { t: start tick, d: length ticks, p: midi pitch, v: velocity 1-127 }, ticks relative to the pattern.

const TRACK_COLORS = ['#7cf28a', '#ff7ab6', '#6cc6ff', '#ffcf5a', '#b48cff', '#ff9a5a', '#5affe0', '#e8e86a', '#ff6b6b', '#9ad0ff'];

const App = {
  song: null, selTrack: null, selPattern: null, view: 'arrange',
  undoStack: [], redoStack: [],
  tool: 'draw', snap: 12, octave: 4, typingPiano: true, rec: false, metronome: false,
  live: new Map(),
};

function emptySong() {
  return {
    format: 'chipforge', version: 1, name: 'Untitled', bpm: 120, beatsPerBar: 4, swing: 0, key: 0, scale: 'major',
    master: { vol: 0.8, boost: 0, delayBeats: 0.75, delayFb: 0.35, delayRet: 0.8, revSize: 1.8, revRet: 0.7, comp: true },
    tracks: [], patterns: [], clips: [], markers: [], loop: { on: false, start: 0, end: 4 },
  };
}
function barTicks(s) { return (s || App.song).beatsPerBar * TPB; }
function getTrack(id, s) { return (s || App.song).tracks.find(t => t.id === id); }
function getPattern(id, s) { return (s || App.song).patterns.find(p => p.id === id); }
function trackPatterns(tid, s) { return (s || App.song).patterns.filter(p => p.track === tid); }
function patternMap(s) { return new Map(s.patterns.map(p => [p.id, p])); }
function songEndBar(s) {
  s = s || App.song;
  const pm = patternMap(s);
  let e = 0;
  for (const c of s.clips) { const p = pm.get(c.pattern); if (p) e = Math.max(e, c.bar + p.bars); }
  return e;
}
function addTrack(s, name, inst) {
  const used = new Set(s.tracks.map(t => t.color));
  const color = TRACK_COLORS.find(c => !used.has(c)) || TRACK_COLORS[s.tracks.length % TRACK_COLORS.length];
  const tr = { id: uid('t'), name, color, inst, mute: false, solo: false };
  s.tracks.push(tr);
  return tr;
}
function addPattern(s, trackId, name, bars, notes) {
  const p = { id: uid('p'), track: trackId, name, bars: bars || 1, notes: notes || [] };
  s.patterns.push(p);
  return p;
}
function addClip(s, trackId, patId, bar) { const c = { id: uid('c'), track: trackId, pattern: patId, bar }; s.clips.push(c); return c; }
function nextPatternName(s, tid) {
  const tr = getTrack(tid, s);
  const n = trackPatterns(tid, s).length + 1;
  return (tr ? tr.name : 'Pattern') + ' ' + n;
}
function growPattern(pat) {
  const bt = barTicks();
  let end = 0;
  for (const n of pat.notes) end = Math.max(end, n.t + n.d);
  pat.bars = Math.max(pat.bars, Math.ceil(end / bt - 1e-9), 1);
}

function monoTrim(notes) {
  const a = notes.slice().sort((x, y) => x.t - y.t);
  for (let i = 0; i < a.length - 1; i++) {
    const nx = a[i + 1];
    if (nx.t > a[i].t && a[i].t + a[i].d > nx.t) a[i] = Object.assign({}, a[i], { d: nx.t - a[i].t });
  }
  return a;
}
// All notes of every track in absolute song ticks.
function flattenSong(s, applyMono) {
  const bt = barTicks(s), pm = patternMap(s), res = new Map();
  for (const tr of s.tracks) res.set(tr.id, []);
  for (const c of s.clips) {
    const p = pm.get(c.pattern), arr = res.get(c.track);
    if (!p || !arr) continue;
    const len = p.bars * bt, off = c.bar * bt;
    for (const n of p.notes) {
      if (n.t >= len) continue;
      arr.push({ t: off + n.t, d: Math.min(n.d, len - n.t), p: n.p, v: n.v });
    }
  }
  for (const [id, arr] of res) {
    arr.sort((a, b) => a.t - b.t || a.p - b.p);
    if (applyMono) { const tr = getTrack(id, s); if (tr && tr.inst.mono) res.set(id, monoTrim(arr)); }
  }
  return res;
}

function normalizeSong(s) {
  const base = emptySong();
  for (const k of Object.keys(base)) if (s[k] == null) s[k] = base[k];
  s.master = Object.assign(base.master, s.master);
  s.loop = Object.assign(base.loop, s.loop);
  for (const tr of s.tracks) tr.inst = Object.assign(defaultInst(tr.inst && tr.inst.type), tr.inst);
  const tids = new Set(s.tracks.map(t => t.id));
  s.patterns = s.patterns.filter(p => tids.has(p.track));
  const pids = new Set(s.patterns.map(p => p.id));
  s.clips = s.clips.filter(c => pids.has(c.pattern) && tids.has(c.track));
  return s;
}

// --- undo / autosave ---------------------------------------------------------------
function pushUndo() {
  App.undoStack.push(JSON.stringify(App.song));
  if (App.undoStack.length > 120) App.undoStack.shift();
  App.redoStack.length = 0;
}
function undo() {
  if (!App.undoStack.length) return toast('Nothing to undo');
  App.redoStack.push(JSON.stringify(App.song));
  App.song = JSON.parse(App.undoStack.pop());
  afterLoad();
  setStatus('Undo');
}
function redo() {
  if (!App.redoStack.length) return toast('Nothing to redo');
  App.undoStack.push(JSON.stringify(App.song));
  App.song = JSON.parse(App.redoStack.pop());
  afterLoad();
  setStatus('Redo');
}
const autosave = debounce(() => {
  try { localStorage.setItem('chipforge.autosave', JSON.stringify(App.song)); } catch (e) { /* storage full or blocked */ }
}, 700);

// Call after replacing App.song wholesale (load, undo, generate).
function afterLoad() {
  normalizeSong(App.song);
  if (!getTrack(App.selTrack)) App.selTrack = App.song.tracks[0] ? App.song.tracks[0].id : null;
  if (!getPattern(App.selPattern) || getPattern(App.selPattern).track !== App.selTrack) {
    const ps = App.selTrack ? trackPatterns(App.selTrack) : [];
    App.selPattern = ps[0] ? ps[0].id : null;
  }
  if (typeof PR !== 'undefined') PR.sel.clear();
  if (typeof ARR !== 'undefined') ARR.sel.clear();
  changed({ full: true });
}

// Central "something in the song changed" hook.
function changed(opts) {
  opts = opts || {};
  Transport.markDirty();
  AE.sync();
  autosave();
  if (typeof UI !== 'undefined') UI.render(opts);
}
