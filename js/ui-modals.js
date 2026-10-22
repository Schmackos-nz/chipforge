'use strict';
// Dialogs: Compose/Extend, Chord import, Export, MIDI import, Add track, Help, text prompt.

const Modal = {
  open(title, body, wide) {
    $('#mtitle').textContent = title;
    const mb = $('#mbody');
    mb.innerHTML = '';
    mb.append(body);
    $('.mbox').style.width = wide ? 'min(900px,95vw)' : '';
    $('#modal').classList.remove('hidden');
  },
  close() { $('#modal').classList.add('hidden'); $('#mbody').innerHTML = ''; },
  isOpen() { return !$('#modal').classList.contains('hidden'); },
};

function askText(title, value) {
  return new Promise(res => {
    const inp = h('input', { value: value || '', style: { width: '100%' } });
    const ok = () => { const v = inp.value.trim(); Modal.close(); res(v || null); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { Modal.close(); res(null); } });
    Modal.open(title, h('div', null, inp, h('div', { class: 'frow', style: { marginTop: '10px', justifyContent: 'flex-end' } },
      h('button', { onclick: () => { Modal.close(); res(null); } }, 'Cancel'), h('button', { class: 'big', onclick: ok }, 'OK'))));
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
}

function keyOptions(sel) { return NOTE_NAMES.map((n, i) => h('option', { value: i, selected: i === sel }, n)); }
function scaleOptions(sel) { return Object.keys(SCALES).map(k => h('option', { value: k, selected: k === sel }, SCALES[k].name)); }

// ------------------------------------------------------------------ Compose / Extend
function openCompose() {
  const s = App.song;
  const an = Gen.analyze(s);
  const barSec = s.beatsPerBar * 60 / s.bpm;
  const curSec = an.nBars * barSec;
  const keySel = h('select', null, h('option', { value: 'auto' }, 'Auto: ' + NOTE_NAMES[an.key.root] + ' ' + SCALES[an.key.scale].name),
    NOTE_NAMES.map((n, i) => Object.keys(SCALES).map(sc => h('option', { value: i + '|' + sc }, n + ' ' + SCALES[sc].name))));
  const keyOv = () => { if (keySel.value === 'auto') return null; const [r, sc] = keySel.value.split('|'); return { root: +r, scale: sc }; };
  const roles = an.tracks.filter(t => t.role !== 'empty').map(t => h('span', { class: 'chip', title: t.tr.name }, t.tr.name + ': ' + t.role));
  const chordChips = [];
  for (let b = 0; b < Math.min(an.nBars, 16); b++) {
    const a = an.chords[b * 2], c = an.chords[b * 2 + 1];
    chordChips.push(h('span', { class: 'chip', title: 'Bar ' + (b + 1) }, chordsEqual(a, c) ? chordName(a) : chordName(a) + ' ' + chordName(c)));
  }
  const seedIn = h('input', { type: 'number', value: Math.floor(Math.random() * 9999), style: { width: '80px' } });
  const dice = h('button', { title: 'New random seed', onclick: () => { seedIn.value = Math.floor(Math.random() * 99999); } }, '🎲');
  const creat = h('input', { type: 'range', min: 0, max: 100, value: 50, style: { width: '140px' } });
  const creatLbl = h('span', null, 'Balanced');
  creat.oninput = () => { const v = +creat.value; creatLbl.textContent = v < 25 ? 'Faithful (lots of repeats)' : v < 60 ? 'Balanced' : v < 85 ? 'Adventurous' : 'Wild'; };
  const target = h('input', { value: fmtTime(Math.max(curSec * 3, 180)), style: { width: '80px' } });
  const est = h('span', { class: 'chip' });
  const updEst = () => { const t = parseTime(target.value); est.textContent = t ? Math.ceil(t / barSec) + ' bars' : '?'; };
  target.oninput = updEst; updEst();
  const ending = h('input', { type: 'checkbox', checked: true });
  const presets = h('span', null, [['2:00', 120], ['3:00', 180], ['5:00', 300], ['10:00', 600]].map(([l, v]) => h('button', { style: { padding: '1px 6px' }, onclick: () => { target.value = l; updEst(); } }, l)));
  const opts = () => ({ creativity: +creat.value / 100, seed: +seedIn.value || 1, key: keyOv(), ending: ending.checked });

  const doExtend = () => {
    const t = parseTime(target.value);
    if (!t) return toast('Enter a length like 5:00');
    pushUndo();
    try {
      const r = Gen.extend(App.song, t, opts());
      Modal.close();
      changed({ full: true });
      ARR.layout();
      UI.setView('arrange');
      toast(`Extended by ${r.added} bars in ${r.sections} sections (${NOTE_NAMES[r.key.root]} ${SCALES[r.key.scale].name}) — Ctrl+Z to undo`, 5000);
    } catch (e) { App.undoStack.pop(); toast(e.message, 4000); }
  };
  const doFill = () => {
    pushUndo();
    try {
      const r = Gen.fillGaps(App.song, opts());
      Modal.close(); changed({ full: true });
      toast('Filled ' + r.filled + ' silent bars — Ctrl+Z to undo', 4000);
    } catch (e) { App.undoStack.pop(); toast(e.message, 4000); }
  };

  const styleSel = h('select', null, Object.keys(Gen.STYLES).map(k => h('option', { value: k }, Gen.STYLES[k].name)));
  const nsKey = h('select', null, h('option', { value: 'r' }, 'Random key'), keyOptions(-1));
  const nsLen = h('input', { value: '1:30', style: { width: '70px' } });
  const doNew = () => {
    const len = parseTime(nsLen.value) || 0;
    pushUndo();
    try {
      App.song = Gen.newSong(styleSel.value, { seed: +seedIn.value || 1, key: nsKey.value === 'r' ? null : +nsKey.value, lengthSec: len, creativity: +creat.value / 100 });
      App.selTrack = null; App.selPattern = null;
      Modal.close();
      afterLoad();
      UI.syncTop();
      ARR.layout();
      UI.setView('arrange');
      toast('New ' + Gen.STYLES[styleSel.value].name + ' song — Ctrl+Z to get your old one back', 4500);
    } catch (e) { App.undoStack.pop(); toast(e.message, 4000); }
  };

  const body = h('div', null,
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('h3', null, 'What I hear in your song'),
      h('p', null, `${an.nBars} bars (${fmtTime(curSec)}) at ${s.bpm} BPM · detected key `, h('b', null, NOTE_NAMES[an.key.root] + ' ' + SCALES[an.key.scale].name)),
      h('div', { class: 'chips' }, roles.length ? roles : h('span', { class: 'chip err' }, 'no notes yet')),
      h('div', { class: 'chips' }, chordChips)),
    h('div', { class: 'frow' }, h('label', null, 'Key'), keySel),
    h('div', { class: 'frow' }, h('label', null, 'Creativity'), creat, creatLbl),
    h('div', { class: 'frow' }, h('label', null, 'Seed'), seedIn, dice, h('span', { class: 'empty', style: { padding: 0 } }, 'Same seed = same result. Undo and re-roll if you don’t like it.')),
    h('div', { class: 'mgrid' },
      h('div', { class: 'card' },
        h('h3', null, '⟶ Extend song'),
        h('p', null, 'Grows the song to the target length in sections: repeats, variations (same chords, re-worked melodies), new sections (fresh chord progression in your style, your parts re-harmonised onto it), breakdowns and an outro.'),
        h('div', { class: 'frow' }, h('label', null, 'Target length'), target, est),
        h('div', { class: 'frow' }, presets),
        h('div', { class: 'frow' }, h('label', null, ending, ' End with an outro')),
        h('button', { class: 'big purple', onclick: doExtend }, '✨ Extend')),
      h('div', { class: 'card' },
        h('h3', null, '▦ Fill silent gaps'),
        h('p', null, 'Finds bars where every track is silent (between your first and last bars) and writes material into them from the surrounding sections.'),
        h('button', { class: 'big purple', onclick: doFill }, '✨ Fill gaps'),
        h('h3', { style: { marginTop: '16px' } }, '★ New song from a style'),
        h('p', null, 'Replaces the project with a fresh 4-track song (undoable). Pick a length to have it extended automatically.'),
        h('div', { class: 'frow' }, h('label', null, 'Style'), styleSel),
        h('div', { class: 'frow' }, h('label', null, 'Key'), nsKey),
        h('div', { class: 'frow' }, h('label', null, 'Length'), nsLen),
        h('button', { class: 'big', onclick: doNew }, '★ Generate song'))));
  Modal.open('✨ Compose / Extend', body, true);
}

// ------------------------------------------------------------------ Chord progression import
function openChords() {
  const s = App.song;
  const ta = h('textarea', { rows: 3, placeholder: 'C G Am F   or   I V vi IV   or   Am:2 F G   (":2" = twice as long, "%" = hold, N.C. = rest)' });
  ta.value = 'I V vi IV';
  const keySel = h('select', null, keyOptions(s.key));
  const scSel = h('select', null, scaleOptions(s.scale));
  const preset = h('select', null, h('option', { value: '' }, 'Common progressions…'),
    [['I V vi IV', 'Pop: I–V–vi–IV'], ['vi IV I V', 'Sad pop: vi–IV–I–V'], ['I vi IV V', "50s: I–vi–IV–V"], ['ii V I I', 'Jazz: ii–V–I'],
      ['I IV V IV', 'Rock: I–IV–V–IV'], ['I bVII IV I', 'Mixolydian: I–bVII–IV–I'], ['i bVI bIII bVII', 'Epic: i–bVI–bIII–bVII'],
      ['i bVII bVI V', 'Andalusian: i–bVII–bVI–V'], ['i iv v i', 'Minor: i–iv–v–i'], ['i VI III VII', 'Minor anthem: i–VI–III–VII'],
      ['I iii IV iv', 'Bittersweet: I–iii–IV–iv'], ['I II IV I', 'Lydian lift: I–II–IV–I'], ['vi IV V iii', 'Heroic: vi–IV–V–iii'],
      ['I V vi iii IV I IV V', 'Canon: I–V–vi–iii–IV–I–IV–V'], ['i bII i V', 'Villain: i–bII–i–V']].map(([v, l]) => h('option', { value: v }, l)));
  preset.onchange = () => { if (preset.value) { ta.value = preset.value; upd(); } };
  const unit = h('select', null, [[1, '1 beat'], [2, '2 beats'], [4, '1 bar (4 beats)'], [8, '2 bars']].map(([v, l]) => h('option', { value: v, selected: v === s.beatsPerBar }, l)));
  const startBar = h('input', { type: 'number', min: 1, value: Math.floor(Transport.songPos / barTicks()) + 1, style: { width: '64px' } });
  const mkC = h('input', { type: 'checkbox', checked: true }), mkB = h('input', { type: 'checkbox', checked: true });
  const cStyle = h('select', null, [['block', 'Block chords'], ['arpUp', 'Arpeggio up (16ths)'], ['arpDown', 'Arpeggio down'], ['arpUpDown', 'Arpeggio up/down'], ['broken', 'Broken 1-5-3-5'], ['stabs', '8th stabs'], ['offbeat', 'Off-beat stabs'], ['pulse', 'Quarter pulses']].map(([v, l]) => h('option', { value: v }, l)));
  const bStyle = h('select', null, [['whole', 'Whole notes'], ['quarters', 'Quarters'], ['eighths', 'Driving 8ths'], ['octave', 'Octave bounce'], ['rootFifth', 'Root–fifth'], ['walk', 'Walking']].map(([v, l]) => h('option', { value: v, selected: v === 'octave' }, l)));
  const trackOpts = sel => [h('option', { value: 'new' }, 'New track')].concat(s.tracks.filter(t => t.inst.type !== 'drums').map(t => h('option', { value: t.id, selected: t.id === sel }, t.name)));
  const cTrack = h('select', null, trackOpts()), bTrack = h('select', null, trackOpts());
  const setKey = h('input', { type: 'checkbox', checked: true });
  const chips = h('div', { class: 'chips' });
  const upd = () => {
    const r = parseProgression(ta.value, +keySel.value, scSel.value);
    chips.innerHTML = '';
    for (const it of r.items) chips.append(h('span', { class: 'chip' }, (it.chord ? chordName(it.chord) : 'N.C.') + (it.len !== 1 ? ' ×' + it.len : '')));
    for (const e of r.errors) chips.append(h('span', { class: 'chip err', title: 'Not understood' }, e + '?'));
    return r;
  };
  ta.oninput = upd; keySel.onchange = upd; scSel.onchange = upd;
  upd();

  const fromMidi = async () => {
    const f = await pickFile('.mid,.midi');
    if (!f) return;
    try {
      const m = Midi.parse(await readFile(f));
      const notes = [];
      for (const t of m.tracks) for (const n of t.notes) if (n.ch !== 9) notes.push(n);
      if (!notes.length) return toast('No notes in that MIDI file');
      const hist = new Array(12).fill(0);
      for (const n of notes) hist[pc(n.p)] += n.d;
      const k = detectKey(hist);
      keySel.value = k.root; scSel.value = k.scale;
      ta.value = Gen.chordsFromNotes(notes, m.ppq, +unit.value, k.root, k.scale);
      upd();
      toast('Detected ' + NOTE_NAMES[k.root] + ' ' + k.scale + ' — edit the chords if needed, then Import');
    } catch (e) { toast('MIDI error: ' + e.message, 4000); }
  };
  const go = () => {
    const r = upd();
    if (!r.items.some(i => i.chord)) return toast('No chords to import');
    pushUndo();
    if (setKey.checked) { s.key = +keySel.value; s.scale = scSel.value; }
    const res = Gen.chordsToTracks(s, r.items, {
      unitBeats: +unit.value, startBar: Math.max(0, (+startBar.value || 1) - 1), makeChords: mkC.checked, makeBass: mkB.checked,
      chordStyle: cStyle.value, bassStyle: bStyle.value, chordTrack: cTrack.value, bassTrack: bTrack.value,
    });
    Modal.close();
    if (res.patterns[0]) { App.selTrack = res.patterns[0].track; App.selPattern = res.patterns[0].id; }
    UI.syncTop();
    changed({ full: true });
    ARR.layout();
    toast('Imported ' + r.items.length + ' chords (' + res.bars + ' bars)');
  };

  Modal.open('Chord progression', h('div', null,
    h('div', { class: 'frow' }, preset, h('button', { onclick: fromMidi, title: 'Detect the chords in a MIDI file' }, 'From MIDI file…')),
    ta, chips,
    h('div', { class: 'mgrid', style: { marginTop: '10px' } },
      h('div', { class: 'card' },
        h('h3', null, 'Harmony'),
        h('div', { class: 'frow' }, h('label', null, 'Key'), keySel, scSel),
        h('div', { class: 'frow' }, h('label', null, 'Each chord lasts'), unit),
        h('div', { class: 'frow' }, h('label', null, 'Start at bar'), startBar),
        h('div', { class: 'frow' }, h('label', null, setKey, ' Set song key'))),
      h('div', { class: 'card' },
        h('h3', null, 'Parts to write'),
        h('div', { class: 'frow' }, h('label', null, mkC, ' Chords'), cStyle, cTrack),
        h('div', { class: 'frow' }, h('label', null, mkB, ' Bass'), bStyle, bTrack),
        h('p', null, 'Tip: after importing, select the lead track, add a pattern over the chords and press ✨ Generate in the piano roll for a melody.'))),
    h('div', { class: 'frow', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'big', onclick: go }, 'Import chords'))), true);
}

// ------------------------------------------------------------------ Export
function openExport() {
  const s = App.song;
  const fmt = h('select', null, h('option', { value: '16' }, 'WAV 16-bit'), h('option', { value: '8' }, 'WAV 8-bit (crunchy, tiny)'));
  const sr = h('select', null, [44100, 48000, 32000, 22050, 11025].map(v => h('option', { value: v }, v + ' Hz' + (v <= 22050 ? ' (lo-fi)' : ''))));
  const rng = h('select', null, h('option', { value: 'song' }, 'Whole song'), h('option', { value: 'loop', disabled: !(s.loop.end > s.loop.start) }, 'Loop region (bars ' + (s.loop.start + 1) + '–' + s.loop.end + ')'));
  const seamless = h('input', { type: 'checkbox' });
  const norm = h('input', { type: 'checkbox', checked: true });
  const tail = h('input', { type: 'number', value: 2, min: 0, max: 10, step: 0.5, style: { width: '60px' } });
  const bar = h('div', { class: 'prog' }, h('div'));
  const info = h('p', null, '');
  const busy = on => { $$('button', body).forEach(b => { b.disabled = on; }); bar.firstChild.style.width = on ? '60%' : '100%'; };
  const base = safeName(s.name);
  const go = async stems => {
    if (!s.clips.length) return toast('Nothing to export yet');
    const [a, b] = Exporter.range(rng.value);
    busy(true);
    info.textContent = stems ? 'Rendering stems…' : 'Rendering…';
    try {
      const o = { startTick: a, endTick: b, sampleRate: +sr.value, tail: seamless.checked ? Math.max(2, +tail.value) : +tail.value, seamless: seamless.checked };
      if (!stems) {
        const r = await Exporter.render(o);
        download(new Blob([Exporter.wav(r.chans, r.sr, +fmt.value, norm.checked)], { type: 'audio/wav' }), base + (seamless.checked ? '_loop' : '') + '.wav');
        info.textContent = 'Done — ' + fmtTime(r.chans[0].length / r.sr) + ' rendered.';
      } else {
        const files = [];
        const tracks = s.tracks.filter(t => s.clips.some(c => c.track === t.id));
        for (let i = 0; i < tracks.length; i++) {
          info.textContent = 'Rendering stem ' + (i + 1) + '/' + tracks.length + ': ' + tracks[i].name;
          bar.firstChild.style.width = Math.round((i / tracks.length) * 100) + '%';
          const r = await Exporter.render(Object.assign({ only: tracks[i].id }, o));
          files.push({ name: String(i + 1).padStart(2, '0') + '_' + safeName(tracks[i].name) + '.wav', data: Exporter.wav(r.chans, r.sr, +fmt.value, false) });
        }
        download(Exporter.zip(files), base + '_stems.zip');
        info.textContent = 'Done — ' + files.length + ' stems zipped.';
      }
    } catch (e) { info.textContent = 'Export failed: ' + e.message; }
    busy(false);
  };
  const body = h('div', null,
    h('div', { class: 'mgrid' },
      h('div', { class: 'card' },
        h('h3', null, 'Audio'),
        h('div', { class: 'frow' }, h('label', null, 'Format'), fmt),
        h('div', { class: 'frow' }, h('label', null, 'Sample rate'), sr),
        h('div', { class: 'frow' }, h('label', null, 'Range'), rng),
        h('div', { class: 'frow' }, h('label', null, 'Tail (sec)'), tail),
        h('div', { class: 'frow' }, h('label', { title: 'Wraps echoes and releases from the end back onto the start so the file loops perfectly in a game engine' }, seamless, ' Seamless game loop')),
        h('div', { class: 'frow' }, h('label', null, norm, ' Normalize')),
        h('div', { class: 'frow' }, h('button', { class: 'big', onclick: () => go(false) }, '⤓ Export WAV'), h('button', { onclick: () => go(true) }, '⤓ Stems (.zip)')),
        bar, info),
      h('div', { class: 'card' },
        h('h3', null, 'Other formats'),
        h('p', null, 'MIDI keeps every note for use in another DAW. The project file keeps everything (instruments, mixer, patterns) for reopening here.'),
        h('div', { class: 'frow' }, h('button', { onclick: () => { download(new Blob([Midi.write(s)], { type: 'audio/midi' }), base + '.mid'); toast('MIDI exported'); } }, '⤓ MIDI (.mid)')),
        h('div', { class: 'frow' }, h('button', { onclick: () => saveProject() }, '⤓ Project (.chipforge.json)')),
        h('p', { style: { marginTop: '14px' } }, 'Seamless loop tip: set the loop region to whole bars of your loop (drag the playlist ruler), choose “Loop region” and tick “Seamless game loop”.'))));
  Modal.open('Export', body, true);
}

// ------------------------------------------------------------------ MIDI import
async function openImportMidi() {
  const f = await pickFile('.mid,.midi');
  if (!f) return;
  let m;
  try { m = Midi.parse(await readFile(f)); } catch (e) { return toast('MIDI error: ' + e.message, 4000); }
  const total = m.tracks.reduce((a, t) => a + t.notes.length, 0);
  if (!total) return toast('That MIDI file has no notes');
  const s = App.song;
  const replace = h('input', { type: 'checkbox', checked: !s.clips.length });
  const tempo = h('input', { type: 'checkbox', checked: !s.clips.length });
  const at = h('input', { type: 'number', min: 1, value: s.clips.length ? songEndBar() + 1 : 1, style: { width: '64px' } });
  const split = h('select', null, [1, 2, 4, 8].map(v => h('option', { value: v, selected: v === 4 }, v + ' bars')));
  const go = () => {
    pushUndo();
    if (replace.checked) { const keep = App.song; App.song = emptySong(); App.song.name = f.name.replace(/\.midi?$/i, ''); App.song.master = keep.master; }
    const n = Midi.importInto(App.song, m, { at: replace.checked ? 0 : Math.max(0, +at.value - 1), split: +split.value, setTempo: tempo.checked || replace.checked });
    const an = Gen.analyze(App.song);
    if (replace.checked) { App.song.key = an.key.root; App.song.scale = an.key.scale; }
    Modal.close();
    App.selTrack = null;
    afterLoad();
    UI.syncTop();
    ARR.layout();
    UI.setView('arrange');
    toast('Imported ' + n + ' tracks, ' + total + ' notes');
  };
  Modal.open('Import MIDI — ' + f.name, h('div', null,
    h('p', { class: 'empty', style: { padding: 0 } }, `${m.tracks.filter(t => t.notes.length).length} tracks · ${total} notes · ${Math.round(m.bpm)} BPM`),
    h('div', { class: 'frow' }, h('label', null, replace, ' Replace current project')),
    h('div', { class: 'frow' }, h('label', null, tempo, ' Use the file’s tempo')),
    h('div', { class: 'frow' }, h('label', null, 'Place at bar'), at),
    h('div', { class: 'frow' }, h('label', null, 'Chop into patterns of'), split),
    h('div', { class: 'frow', style: { justifyContent: 'flex-end' } }, h('button', { class: 'big', onclick: go }, 'Import'))));
}

// ------------------------------------------------------------------ Add track
function openAddTrack() {
  const grid = h('div', { class: 'presetgrid' }, PRESETS.map(p => h('button', {
    onclick: () => {
      pushUndo();
      const tr = addTrack(App.song, p.name.replace(/ \d.*%| Kit/g, '').trim() || p.name, instFromPreset(p.name));
      const pat = addPattern(App.song, tr.id, tr.name + ' 1', 1, []);
      App.selTrack = tr.id; App.selPattern = pat.id;
      Modal.close();
      changed({ full: true });
      ARR.layout();
      toast('Added ' + tr.name);
    },
  }, p.name, h('small', null, p.cat + ' · ' + (INST_TYPES.find(x => x[0] === p.p.type) || ['', ''])[1]))));
  Modal.open('Add instrument track', grid, true);
}

// ------------------------------------------------------------------ Help
function openHelp() {
  const rows = [
    ['Space', 'Play / stop'], ['Home', 'Back to start'], ['F5 / F7 / F9', 'Playlist / Piano roll / Mixer'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S / Ctrl+O', 'Save / open project'],
    ['Z S X D C V … / Q 2 W 3 E …', 'Typing piano (two octaves) on the selected track'], ['PageUp / PageDown', 'Typing-piano octave'],
    ['Piano roll: click / drag', 'Draw a note, drag right for length'], ['Drag note / edge', 'Move / resize (Alt = no snap, Shift+drag = copy)'],
    ['Right-click', 'Delete notes / clips'], ['Ctrl+drag', 'Box select'], ['Ctrl+A, C, X, V, D', 'Select all, copy, cut, paste, duplicate'],
    ['↑ ↓ (Shift = octave)', 'Transpose selection'], ['← →', 'Nudge selection (Shift = bar)'], ['Delete', 'Delete selection'],
    ['Ctrl+wheel / Alt+wheel', 'Zoom horizontally / row height'],
    ['B / E / D / C (typing piano off)', 'Draw / select / erase / chord tool'],
    ['Playlist: click', 'Paint the selected pattern; drag to stamp copies'], ['Playlist: drag ruler', 'Set loop region (click = set position)'],
    ['Track header M / S', 'Mute / solo (Ctrl+S-click = exclusive)'],
  ];
  Modal.open('ChipForge — shortcuts', h('div', null,
    h('table', { class: 'keys' }, rows.map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b)))),
    h('p', { class: 'empty', style: { padding: '12px 0 0' } }, 'Projects autosave in this browser. Use Save to keep a file. ✨ Compose / Extend grows a song from what you have written; ✨ Vary and ✨ Generate in the piano roll work on one pattern.')), true);
}

// ------------------------------------------------------------------ project files
function saveProject() {
  const s = App.song;
  download(new Blob([JSON.stringify(s)], { type: 'application/json' }), safeName(s.name) + '.chipforge.json');
  toast('Project saved');
}
async function openProject() {
  const f = await pickFile('.json,.chipforge');
  if (!f) return;
  try {
    const s = JSON.parse(await readFile(f, 'text'));
    if (!s || !Array.isArray(s.tracks) || !Array.isArray(s.patterns)) throw new Error('not a ChipForge project');
    pushUndo();
    if (Transport.playing) Transport.stop();
    App.song = s;
    App.selTrack = null;
    afterLoad();
    UI.syncTop();
    ARR.layout();
    toast('Opened ' + f.name);
  } catch (e) { toast('Could not open: ' + e.message, 4000); }
}
