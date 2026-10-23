'use strict';
// App shell: top bar, channel rack, pattern list, keyboard, MIDI input and the render loop.

function liveOn(id, pitch, vel) {
  const tr = getTrack(App.selTrack) || (PR.pat() && getTrack(PR.pat().track));
  if (!tr) return;
  const eng = AE.ensure();
  if (App.live.has(id)) liveOff(id);
  const v = eng.noteOn(tr, pitch, vel || 100, AE.ctx.currentTime + 0.005, null, false);
  App.live.set(id, { v, pitch });
  PR.pressed.add(pitch);
  PR.requestDraw();
  Rec.on(id, pitch, vel || 100);
}
function liveOff(id) {
  const o = App.live.get(id);
  if (!o) return;
  if (o.v) o.v.release(AE.ctx.currentTime);
  App.live.delete(id);
  if (![...App.live.values()].some(x => x.pitch === o.pitch)) PR.pressed.delete(o.pitch);
  PR.requestDraw();
  Rec.off(id);
}
function previewOnce(pitch, vel) {
  const tr = getTrack(App.selTrack);
  if (!tr) return;
  const eng = AE.ensure();
  eng.noteOn(tr, pitch, vel || 100, AE.ctx.currentTime + 0.005, 0.25, false);
}

const UI = {
  render(opts) {
    opts = opts || {};
    this.renderTracks();
    this.renderPatterns();
    INST.render(!!opts.full || !!opts.lists);
    PR.syncToolbar();
    PR.layout();
    ARR.layout();
    if (App.view === 'mixer') MIX.render();
    this.transportChanged();
  },

  setView(v) {
    App.view = v;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $$('.view').forEach(el => el.classList.toggle('on', el.id === 'view-' + v));
    if (v === 'mixer') MIX.render();
    if (v === 'arrange' && !Transport.playing && Transport.mode !== 'song') Transport.setMode('song');
    requestAnimationFrame(() => { PR.resize(); ARR.resize(); });
  },
  setTool(t) {
    App.tool = t;
    $$('#prTools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  },

  selectTrack(id) {
    App.selTrack = id;
    const pat = getPattern(App.selPattern);
    if (!pat || pat.track !== id) { const ps = trackPatterns(id); App.selPattern = ps[0] ? ps[0].id : null; }
    PR.sel.clear();
    this.render({ lists: true });
  },
  async renameTrack(id) {
    const tr = getTrack(id);
    const v = await askText('Rename track', tr.name);
    if (v) { pushUndo(); tr.name = v; changed({ full: true }); }
  },
  newPattern() {
    const tr = getTrack(App.selTrack);
    if (!tr) return toast('Select a track first');
    pushUndo();
    const cur = getPattern(App.selPattern);
    const p = addPattern(App.song, tr.id, nextPatternName(App.song, tr.id), cur && cur.track === tr.id ? cur.bars : 1, []);
    App.selPattern = p.id;
    PR.sel.clear();
    changed({ lists: true });
    if (App.view !== 'piano') this.setView('piano');
  },
  clonePattern() {
    const p = getPattern(App.selPattern);
    if (!p) return;
    pushUndo();
    const c = addPattern(App.song, p.track, p.name + ' copy', p.bars, deepClone(p.notes));
    App.selPattern = c.id;
    changed({ lists: true });
    toast('Cloned — place it in the playlist by clicking a row');
  },
  deletePattern(id) {
    pushUndo();
    const s = App.song;
    s.patterns = s.patterns.filter(p => p.id !== id);
    s.clips = s.clips.filter(c => c.pattern !== id);
    if (App.selPattern === id) { const ps = trackPatterns(App.selTrack); App.selPattern = ps[0] ? ps[0].id : null; }
    changed({ lists: true });
  },
  varyPattern() {
    const p = getPattern(App.selPattern);
    if (!p) return toast('No pattern open');
    pushUndo();
    try { Gen.varyPattern(App.song, p.id, 0.55, Math.floor(Math.random() * 1e6)); PR.sel.clear(); changed({}); toast('Varied “' + p.name + '” — press again for another take, Ctrl+Z to undo'); }
    catch (e) { App.undoStack.pop(); toast(e.message); }
  },
  generatePart(role) {
    const p = getPattern(App.selPattern);
    if (!p) return toast('No pattern open');
    pushUndo();
    try { Gen.generatePart(App.song, p.id, role, Math.floor(Math.random() * 1e6)); PR.sel.clear(); changed({}); PR.scrollToNotes(); toast('Generated ' + role + ' — press again to re-roll, Ctrl+Z to undo'); }
    catch (e) { App.undoStack.pop(); toast(e.message); }
  },

  renderTracks() {
    const root = $('#trackList'), s = App.song;
    root.innerHTML = '';
    if (!s.tracks.length) { root.append(h('div', { class: 'empty' }, 'No tracks. Click “＋ Track”, import chords or MIDI, or use ✨ Compose → New song.')); return; }
    s.tracks.forEach((tr, i) => {
      const vol = h('input', { type: 'range', min: 0, max: 120, value: Math.round(tr.inst.vol * 100), title: 'Volume' });
      vol.addEventListener('pointerdown', () => pushUndo());
      vol.oninput = () => { tr.inst.vol = vol.value / 100; AE.sync(); autosave(); };
      vol.onclick = e => e.stopPropagation();
      const btn = (cls, label, title, fn) => h('button', { class: cls, title, onclick: e => { e.stopPropagation(); fn(); } }, label);
      const row = h('div', { class: 'trk' + (tr.id === App.selTrack ? ' sel' : '') + (tr.mute ? ' muted' : ''), onclick: () => this.selectTrack(tr.id), ondblclick: () => this.renameTrack(tr.id) },
        h('div', { class: 'sw', style: { background: tr.color } }),
        h('div', { class: 'nm' }, h('b', null, tr.name), h('small', null, (INST_TYPES.find(x => x[0] === tr.inst.type) || ['', ''])[1])),
        h('div', { class: 'ctl' },
          vol,
          btn('m' + (tr.mute ? ' on' : ''), 'M', 'Mute', () => { pushUndo(); tr.mute = !tr.mute; changed({ lists: true }); }),
          btn('s' + (tr.solo ? ' on' : ''), 'S', 'Solo', () => { pushUndo(); tr.solo = !tr.solo; changed({ lists: true }); }),
          btn('', '⋯', 'Track options', () => this.trackMenu(tr, i))));
      root.append(row);
    });
  },
  trackMenu(tr, i) {
    const s = App.song;
    const act = fn => () => { Modal.close(); fn(); };
    Modal.open('Track: ' + tr.name, h('div', { class: 'frow' },
      h('button', { onclick: act(() => this.renameTrack(tr.id)) }, 'Rename'),
      h('button', { onclick: act(() => {
        pushUndo();
        const c = deepClone(tr);
        c.id = uid('t'); c.name = tr.name + ' copy';
        s.tracks.splice(i + 1, 0, c);
        const map = {};
        for (const p of trackPatterns(tr.id)) { const np = addPattern(s, c.id, p.name, p.bars, deepClone(p.notes)); map[p.id] = np.id; }
        for (const cl of s.clips.filter(x => x.track === tr.id)) addClip(s, c.id, map[cl.pattern], cl.bar);
        changed({ full: true });
      }) }, 'Duplicate (with clips)'),
      h('button', { disabled: i === 0, onclick: act(() => { pushUndo(); s.tracks.splice(i, 1); s.tracks.splice(i - 1, 0, tr); changed({ lists: true }); }) }, 'Move up'),
      h('button', { disabled: i === s.tracks.length - 1, onclick: act(() => { pushUndo(); s.tracks.splice(i, 1); s.tracks.splice(i + 1, 0, tr); changed({ lists: true }); }) }, 'Move down'),
      h('button', { class: 'danger', onclick: act(() => {
        pushUndo();
        s.tracks = s.tracks.filter(t => t.id !== tr.id);
        s.patterns = s.patterns.filter(p => p.track !== tr.id);
        s.clips = s.clips.filter(c => c.track !== tr.id);
        if (App.selTrack === tr.id) App.selTrack = null;
        afterLoad();
        toast('Deleted ' + tr.name + ' (Ctrl+Z to undo)');
      }) }, 'Delete track')));
  },

  renderPatterns() {
    const root = $('#patternList');
    root.innerHTML = '';
    const tr = getTrack(App.selTrack);
    $('#patTrackName').textContent = tr ? '— ' + tr.name : '';
    if (!tr) return;
    const pats = trackPatterns(tr.id);
    if (!pats.length) root.append(h('div', { class: 'empty' }, 'No patterns. Click ＋ to make one, then paint it into the playlist.'));
    const uses = {};
    for (const c of App.song.clips) uses[c.pattern] = (uses[c.pattern] || 0) + 1;
    for (const p of pats) {
      root.append(h('div', {
        class: 'pat' + (p.id === App.selPattern ? ' sel' : ''),
        onclick: () => { App.selPattern = p.id; PR.sel.clear(); this.render({}); },
        ondblclick: () => PR.open(p.id),
        title: 'Click to select (then click the playlist to paint it). Double-click to edit.',
      },
      h('span', { class: 'sw', style: { width: '8px', height: '8px', borderRadius: '2px', background: tr.color } }),
      h('span', { class: 'pn' }, p.name),
      h('small', null, p.bars + 'b · ' + p.notes.length + 'n' + (uses[p.id] ? ' · ×' + uses[p.id] : '')),
      h('button', { title: 'Rename', onclick: async e => { e.stopPropagation(); const v = await askText('Rename pattern', p.name); if (v) { pushUndo(); p.name = v; changed({ lists: true }); } } }, '✎'),
      h('button', { class: 'danger', title: 'Delete pattern and its clips', onclick: e => { e.stopPropagation(); this.deletePattern(p.id); } }, '✕')));
    }
  },

  syncTop() {
    const s = App.song;
    $('#bpm').value = s.bpm;
    $('#tsig').value = String(s.beatsPerBar);
    $('#swing').value = Math.round(s.swing * 100);
    $('#keyRoot').value = String(s.key);
    $('#keyScale').value = s.scale;
    $('#masterVol').value = Math.round(s.master.vol * 100);
    document.title = (s.name && s.name !== 'Untitled' ? s.name + ' — ' : '') + 'ChipForge';
  },
  transportChanged() {
    $('#btnPlay').textContent = Transport.playing ? '❚❚' : '▶';
    $('#btnPlay').classList.toggle('on', Transport.playing);
    $('#btnRec').classList.toggle('on', App.rec);
    $('#btnLoop').classList.toggle('on', App.song.loop.on);
    $('#btnMetro').classList.toggle('on', App.metronome);
    $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === Transport.mode));
    PR.requestDraw(); ARR.requestDraw();
  },
  updateLcd() {
    const s = App.song;
    let tick = Transport.currentTick();
    if (tick == null) tick = Transport.mode === 'song' ? Transport.songPos : Transport.patPos;
    const bt = barTicks(), bar = Math.floor(tick / bt), beat = Math.floor((tick % bt) / TPB), sub = Math.floor((tick % TPB) / (TPB / 4));
    const txt = String(bar + 1).padStart(3, '0') + ':' + (beat + 1) + ':' + String(sub + 1).padStart(2, '0') + '  ' + fmtTime(tick * 60 / (s.bpm * TPB));
    const el = $('#lcd');
    if (el.textContent !== txt) el.textContent = txt;
  },
  drawScope() {
    const cv = $('#scope'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#7cf28a'; g.lineWidth = 1.2; g.beginPath();
    if (AE.engine && AE.engine.m.analyser) {
      const an = AE.engine.m.analyser, b = this._sb || (this._sb = new Float32Array(an.fftSize));
      an.getFloatTimeDomainData(b);
      let start = 0;
      for (let i = 1; i < b.length / 2; i++) if (b[i - 1] < 0 && b[i] >= 0) { start = i; break; }
      for (let x = 0; x < W; x++) { const v = b[start + Math.floor(x * 3)] || 0; const y = H / 2 - v * H * 0.9; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
    } else { g.moveTo(0, H / 2); g.lineTo(W, H / 2); }
    g.stroke();
  },
};

// ------------------------------------------------------------------ touch / small screens
function initMobile() {
  const narrow = window.matchMedia('(max-width: 900px)'), coarse = window.matchMedia('(pointer: coarse)');
  const scrim = $('#scrim');
  const drawer = (id, open) => {
    for (const a of ['#left', '#right']) $(a).classList.toggle('open', a === id && open);
    scrim.classList.toggle('on', !!open);
  };
  $('#btnRack').onclick = () => drawer('#left', !$('#left').classList.contains('open'));
  $('#btnInst').onclick = () => drawer('#right', !$('#right').classList.contains('open'));
  scrim.onclick = () => drawer(null, false);
  for (const a of ['#left', '#right']) $(a + ' .phead').append(h('button', { class: 'mob-narrow', title: 'Close', onclick: () => drawer(null, false) }, '✕'));
  narrow.addEventListener('change', () => { if (!narrow.matches) drawer(null, false); });
  const touchBtn = $('#btnTouch');
  touchBtn.onclick = () => {
    const on = document.body.classList.toggle('touchedit');
    touchBtn.classList.toggle('on', on);
    touchBtn.textContent = on ? '✎ Edit' : '✋ Scroll';
  };
  // Bigger rows for fingers, narrower headers for phones.
  if (coarse.matches) { PR.rowH = 20; ARR.rowH = 52; }
  if (narrow.matches) { PR.KEYW = 52; ARR.HEAD = 120; }
}

// ------------------------------------------------------------------ keyboard
const PIANO_KEYS = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12, l: 13, '.': 14, ';': 15, '/': 16,
  q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 };
const KIT_UP = DRUM_KIT.map(d => d.p).reverse();
function typedPitch(k) {
  const off = PIANO_KEYS[k];
  if (off == null) return null;
  const tr = getTrack(App.selTrack);
  if (tr && tr.inst.type === 'drums') return KIT_UP[off % KIT_UP.length];
  return clamp((App.octave + 1) * 12 + off, 0, 127);
}

document.addEventListener('keydown', e => {
  if (Modal.isOpen()) { if (e.key === 'Escape') Modal.close(); return; }
  const tag = e.target.tagName, k = e.key, ctrl = e.ctrlKey || e.metaKey;
  // A focused dropdown only swallows plain keys, so Ctrl+C/V still work after changing e.g. snap.
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox', 'color'].includes(e.target.type)) || (tag === 'SELECT' && !ctrl);
  if (typing) return;
  if (k === ' ') { e.preventDefault(); Transport.toggle(); return; }
  if (k === 'F5' || k === 'F7' || k === 'F9') { e.preventDefault(); UI.setView(k === 'F5' ? 'arrange' : k === 'F7' ? 'piano' : 'mixer'); return; }
  if (k === 'Home') { e.preventDefault(); Transport.setSongPos(0); Transport.setPatPos(0); return; }
  if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
  const editor = App.view === 'piano' ? PR : App.view === 'arrange' ? ARR : null;
  if (editor && (ctrl || ['Delete', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k))) {
    if (editor.key(e)) { e.preventDefault(); return; }
  }
  if (ctrl || e.altKey) return;
  if (k === 'PageUp') { e.preventDefault(); App.octave = clamp(App.octave + 1, 0, 8); $('#octVal').textContent = App.octave; return; }
  if (k === 'PageDown') { e.preventDefault(); App.octave = clamp(App.octave - 1, 0, 8); $('#octVal').textContent = App.octave; return; }
  const lk = k.toLowerCase();
  if (App.typingPiano) {
    if (e.repeat) { if (PIANO_KEYS[lk] != null) e.preventDefault(); return; }
    const p = typedPitch(lk);
    if (p != null) { e.preventDefault(); liveOn('k:' + lk, p, PR.vel); }
    return;
  }
  const tools = { b: 'draw', p: 'draw', e: 'select', d: 'erase', c: 'chord' };
  if (tools[lk]) { UI.setTool(tools[lk]); return; }
  if (lk === 'q' && App.view === 'piano') PR.quantize();
});
document.addEventListener('keyup', e => { liveOff('k:' + e.key.toLowerCase()); });
window.addEventListener('blur', () => { for (const id of [...App.live.keys()]) liveOff(id); });

// ------------------------------------------------------------------ MIDI input
async function enableMidi() {
  if (!navigator.requestMIDIAccess) return toast('This browser has no Web MIDI support');
  try {
    const acc = await navigator.requestMIDIAccess();
    const hook = () => {
      let n = 0;
      for (const inp of acc.inputs.values()) {
        n++;
        inp.onmidimessage = ev => {
          const [st, d1, d2] = ev.data, hi = st & 0xF0;
          if (hi === 0x90 && d2 > 0) liveOn('midi:' + d1, d1, d2);
          else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) liveOff('midi:' + d1);
        };
      }
      $('#btnMidi').classList.toggle('on', n > 0);
      toast(n ? 'MIDI input: ' + n + ' device(s) connected' : 'No MIDI devices found');
    };
    acc.onstatechange = hook;
    hook();
  } catch (e) { toast('MIDI access denied'); }
}

// ------------------------------------------------------------------ boot
function boot() {
  let loaded = null;
  try { const raw = localStorage.getItem('chipforge.autosave'); if (raw) loaded = JSON.parse(raw); } catch (e) { loaded = null; }
  App.song = loaded && Array.isArray(loaded.tracks) ? loaded : Gen.newSong('overworld', { seed: 7, key: 0 });
  normalizeSong(App.song);
  App.selTrack = App.song.tracks[0] ? App.song.tracks[0].id : null;
  const ps = App.selTrack ? trackPatterns(App.selTrack) : [];
  App.selPattern = ps[0] ? ps[0].id : null;

  $('#keyRoot').append(...keyOptions(0));
  $('#keyScale').append(...scaleOptions('major'));
  $('#bpm').onchange = () => { pushUndo(); App.song.bpm = clamp(+$('#bpm').value || 120, 30, 320); changed({}); };
  $('#tsig').onchange = () => { pushUndo(); App.song.beatsPerBar = +$('#tsig').value; changed({}); };
  $('#swing').addEventListener('pointerdown', () => pushUndo());
  $('#swing').oninput = () => { App.song.swing = $('#swing').value / 100; autosave(); };
  $('#keyRoot').onchange = () => { pushUndo(); App.song.key = +$('#keyRoot').value; changed({}); };
  $('#keyScale').onchange = () => { pushUndo(); App.song.scale = $('#keyScale').value; changed({}); };
  $('#masterVol').oninput = () => { App.song.master.vol = $('#masterVol').value / 100; AE.sync(); autosave(); };

  $('#btnPlay').onclick = () => Transport.toggle();
  $('#btnStop').onclick = () => Transport.stop();
  $('#btnHome').onclick = () => { Transport.setSongPos(0); Transport.setPatPos(0); };
  $('#btnRec').onclick = () => { App.rec = !App.rec; UI.transportChanged(); if (App.rec) toast('Record armed: play notes while the song plays — they land in the open pattern'); };
  $('#btnLoop').onclick = () => {
    pushUndo();
    const l = App.song.loop;
    if (!l.on && !(l.end > l.start)) { l.start = 0; l.end = Math.max(1, songEndBar()); }
    l.on = !l.on;
    changed({});
  };
  $('#btnMetro').onclick = () => { App.metronome = !App.metronome; UI.transportChanged(); };
  $$('#modeSeg button').forEach(b => { b.onclick = () => Transport.setMode(b.dataset.mode); });
  $$('#tabs button').forEach(b => { b.onclick = () => UI.setView(b.dataset.view); });
  $('#spec').onclick = () => UI.setView('mixer');
  // drop audio files anywhere to import them as sample tracks
  window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    if (e.defaultPrevented) return;
    const fs = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter(f => /^audio\/|\.(wav|mp3|ogg|flac|m4a|aac|webm|aiff?)$/i.test(f.type + ' ' + f.name));
    if (!fs.length) return;
    e.preventDefault();
    for (const f of fs) await SMP.importAsTrack(f);
  });
  SMP.loadAll().then(() => { SMP.gc(); INST.render(true); AE.sync(); });
  $('#addTrack').onclick = openAddTrack;
  $('#addPattern').onclick = () => UI.newPattern();
  $('#btnTyping').onclick = () => { App.typingPiano = !App.typingPiano; $('#btnTyping').classList.toggle('on', App.typingPiano); toast(App.typingPiano ? 'Typing piano on' : 'Typing piano off — letter keys are tool shortcuts'); };
  $('#octUp').onclick = () => { App.octave = clamp(App.octave + 1, 0, 8); $('#octVal').textContent = App.octave; };
  $('#octDn').onclick = () => { App.octave = clamp(App.octave - 1, 0, 8); $('#octVal').textContent = App.octave; };
  $('#btnMidi').onclick = enableMidi;
  $('#mclose').onclick = () => Modal.close();
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') Modal.close(); });
  const actions = {
    new: () => { pushUndo(); if (Transport.playing) Transport.stop(); App.song = emptySong(); const tr = addTrack(App.song, 'Lead', instFromPreset('NES Lead 25%')); addTrack(App.song, 'Bass', instFromPreset('Triangle Bass')); addTrack(App.song, 'Drums', instFromPreset('Drum Kit')); addPattern(App.song, tr.id, 'Lead 1', 4, []); App.selTrack = null; afterLoad(); UI.syncTop(); toast('New project (Ctrl+Z to undo)'); },
    open: openProject, save: saveProject, importMidi: openImportMidi, chords: openChords, export: openExport, compose: openCompose, help: openHelp,
  };
  $$('[data-act]').forEach(b => { b.onclick = () => actions[b.dataset.act](); });

  PR.init();
  ARR.init();
  UI.syncTop();
  UI.setView('arrange');
  initMobile();
  UI.setTool('draw');
  UI.render({ full: true });
  setTimeout(() => PR.scrollToNotes(), 50);

  const loop = () => {
    if (Transport.playing) { PR.requestDraw(); ARR.requestDraw(); }
    if (App.view === 'piano' && PR.needs) PR.draw();
    if (App.view === 'arrange' && ARR.needs) ARR.draw();
    UI.updateLcd();
    UI.drawScope();
    SPEC.tick();
    MIX.tick();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setStatus(loaded ? 'Restored your last session' : 'Demo song loaded — press Space to play, or ✨ Compose to make it longer');
}
boot();
