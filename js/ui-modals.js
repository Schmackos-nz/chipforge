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

// ------------------------------------------------------------------ Part list editor (shared)
// Up to Gen.MAX_PARTS rows: role · style · instrument (preset or existing track) · octave · volume.
function PartsEditor(initial, opt) {
  opt = opt || {};
  let parts = initial.map(p => Object.assign({}, p));
  const list = h('div', { class: 'parts' });
  const countLbl = h('span', { class: 'chip' });
  const addBtn = h('button', { title: 'Add another part' }, '＋ Add part');
  const roleOpts = () => Object.keys(Gen.ROLES).map(r => [r, Gen.ROLES[r].name]);
  const presetOpts = (sel, track) => {
    const cats = {};
    for (const p of PRESETS) (cats[p.cat] = cats[p.cat] || []).push(p);
    const out = [];
    if (opt.tracks && opt.tracks.length) out.push(h('optgroup', { label: 'Existing track' }, opt.tracks.map(t => h('option', { value: 'track:' + t.id, selected: track === t.id }, '→ ' + t.name))));
    for (const c in cats) out.push(h('optgroup', { label: c }, cats[c].map(p => h('option', { value: p.name, selected: !track && p.name === sel }, p.name))));
    return out;
  };
  const render = () => {
    list.innerHTML = '';
    parts.forEach((p, i) => {
      const R = Gen.ROLES[p.role];
      const role = h('select', { title: 'What this part plays' }, roleOpts().map(([v, l]) => h('option', { value: v, selected: v === p.role }, l)));
      role.onchange = () => { const np = Gen.part(role.value); np.octave = p.octave; parts[i] = np; render(); };
      const style = h('select', { title: 'How it plays' }, R.styles.map(([v, l]) => h('option', { value: v, selected: v === p.style }, l)));
      style.onchange = () => { p.style = style.value; };
      const inst = h('select', { title: 'Instrument preset (or write into an existing track)' }, presetOpts(p.preset, p.track));
      inst.onchange = () => { if (inst.value.startsWith('track:')) { p.track = inst.value.slice(6); } else { p.track = null; p.preset = inst.value; } };
      const oct = h('select', { title: 'Register (octaves)' }, [-2, -1, 0, 1, 2].map(v => h('option', { value: v, selected: v === (p.octave || 0) }, (v > 0 ? '+' : '') + v + ' oct')));
      oct.onchange = () => { p.octave = +oct.value; };
      const vol = h('input', { type: 'range', min: 5, max: 110, value: Math.round((p.vol != null ? p.vol : R.vol) * 100), title: 'Volume', style: { width: '64px' } });
      vol.oninput = () => { p.vol = vol.value / 100; };
      const test = h('button', { title: 'Hear this instrument', onclick: () => {
        const eng = AE.ensure();
        const tr = { id: '__preview', inst: p.track ? getTrack(p.track).inst : instFromPreset(p.preset) };
        eng.syncTrack(tr, true);
        const now = AE.ctx.currentTime + 0.02;
        if (tr.inst.type === 'drums') [36, 42, 38, 42].forEach((n, k) => eng.noteOn(tr, n, 110, now + k * 0.15, 0.1));
        else [60, 64, 67, 72].forEach((n, k) => eng.noteOn(tr, n + 12 * (p.octave || 0) - (p.role === 'bass' ? 24 : 0), 105, now + k * 0.15, 0.13));
      } }, '▶');
      const del = h('button', { class: 'danger', title: 'Remove part', onclick: () => { parts.splice(i, 1); render(); } }, '✕');
      list.append(h('div', { class: 'prow' }, h('span', { class: 'pnum' }, i + 1), role, style, inst, oct, vol, test, del));
    });
    countLbl.textContent = parts.length + ' / ' + Gen.MAX_PARTS + ' parts';
    addBtn.disabled = parts.length >= Gen.MAX_PARTS;
  };
  addBtn.onclick = () => {
    const used = new Set(parts.map(p => p.role));
    const next = ['arp', 'pad', 'perc', 'bells', 'counter', 'double', 'chords', 'lead', 'bass', 'drums'].find(r => !used.has(r)) || 'arp';
    parts.push(Gen.part(next));
    render();
  };
  const nSel = h('select', { title: 'How many parts' }, Array.from({ length: Gen.MAX_PARTS }, (_, i) => h('option', { value: i + 1, selected: i + 1 === 6 }, (i + 1) + ' parts')));
  const rnd = h('button', { title: 'Pick a random band of this size' }, '🎲 Random band');
  rnd.onclick = () => { parts = Gen.randomBand(+nSel.value, makeRng(Math.floor(Math.random() * 1e9))); render(); };
  render();
  const el = h('div', null, list, h('div', { class: 'frow', style: { marginTop: '6px' } }, addBtn, nSel, rnd, countLbl, opt.extraButtons || null));
  return {
    el,
    get: () => parts.map(p => Object.assign({}, p)),
    set: ps => { parts = ps.map(p => Object.assign({}, p)); render(); },
  };
}

// ------------------------------------------------------------------ Compose / Extend
let _composeTab = 'extend';
function openCompose(tab) {
  if (tab) _composeTab = tab;
  const s = App.song;
  const an = Gen.analyze(s);
  const barSec = s.beatsPerBar * 60 / s.bpm;
  const curSec = an.nBars * barSec;

  // shared controls
  const seedIn = h('input', { type: 'number', value: Math.floor(Math.random() * 9999), style: { width: '80px' } });
  const dice = h('button', { title: 'New random seed', onclick: () => { seedIn.value = Math.floor(Math.random() * 99999); } }, '🎲');
  const creat = h('input', { type: 'range', min: 0, max: 100, value: 50, style: { width: '140px' } });
  const creatLbl = h('span', null, 'Balanced');
  creat.oninput = () => { const v = +creat.value; creatLbl.textContent = v < 25 ? 'Faithful (lots of repeats)' : v < 60 ? 'Balanced' : v < 85 ? 'Adventurous' : 'Wild'; };
  const seed = () => +seedIn.value || 1;
  const shared = h('div', null,
    h('div', { class: 'frow' }, h('label', null, 'Creativity'), creat, creatLbl),
    h('div', { class: 'frow' }, h('label', null, 'Seed'), seedIn, dice, h('span', { class: 'empty', style: { padding: 0 } }, 'Same seed = same result. Everything here is undoable (Ctrl+Z).')));

  const keySel = h('select', null, h('option', { value: 'auto' }, 'Auto: ' + NOTE_NAMES[an.key.root] + ' ' + SCALES[an.key.scale].name),
    NOTE_NAMES.map((n, i) => Object.keys(SCALES).map(sc => h('option', { value: i + '|' + sc }, n + ' ' + SCALES[sc].name))));
  const keyOv = () => { if (keySel.value === 'auto') return null; const [r, sc] = keySel.value.split('|'); return { root: +r, scale: sc }; };

  const finish = msg => { Modal.close(); afterLoad(); UI.syncTop(); ARR.layout(); UI.setView('arrange'); toast(msg, 5000); };
  const attempt = fn => { pushUndo(); try { fn(); } catch (e) { App.undoStack.pop(); toast(e.message, 4500); } };

  // --- Extend tab
  const target = h('input', { value: fmtTime(Math.max(curSec * 3, 180)), style: { width: '80px' } });
  const est = h('span', { class: 'chip' });
  const updEst = () => { const t = parseTime(target.value); est.textContent = t ? Math.ceil(t / barSec) + ' bars' : '?'; };
  target.oninput = updEst; updEst();
  const ending = h('input', { type: 'checkbox', checked: true });
  const presets = [['2:00', 120], ['3:00', 180], ['5:00', 300], ['10:00', 600]].map(([l]) => h('button', { style: { padding: '1px 6px' }, onclick: () => { target.value = l; updEst(); } }, l));
  const roles = an.tracks.filter(t => t.role !== 'empty').map(t => h('span', { class: 'chip', title: t.tr.name }, t.tr.name + ': ' + t.role));
  const chordChips = [];
  for (let b = 0; b < Math.min(an.nBars, 16); b++) {
    const a = an.chords[b * 2], c = an.chords[b * 2 + 1];
    chordChips.push(h('span', { class: 'chip', title: 'Bar ' + (b + 1) }, chordsEqual(a, c) ? chordName(a) : chordName(a) + ' ' + chordName(c)));
  }
  const extendTab = h('div', null,
    h('div', { class: 'card', style: { marginBottom: '10px' } },
      h('h3', null, 'What I hear in your song'),
      h('p', null, `${an.nBars} bars (${fmtTime(curSec)}) at ${s.bpm} BPM · key `, h('b', null, NOTE_NAMES[an.key.root] + ' ' + SCALES[an.key.scale].name)),
      h('div', { class: 'chips' }, roles.length ? roles : h('span', { class: 'chip err' }, 'no notes yet')),
      h('div', { class: 'chips' }, chordChips)),
    h('div', { class: 'mgrid' },
      h('div', { class: 'card' },
        h('h3', null, '⟶ Extend song'),
        h('p', null, 'Grows the song to the target length in 8-bar sections: repeats, variations, new sections (fresh progression in your style with your parts re-harmonised onto it), breakdowns and an outro.'),
        h('div', { class: 'frow' }, h('label', null, 'Target length'), target, est),
        h('div', { class: 'frow' }, presets),
        h('div', { class: 'frow' }, h('label', null, ending, ' End with an outro')),
        h('div', { class: 'frow' }, h('label', null, 'Key'), keySel),
        h('button', { class: 'big purple', onclick: () => {
          const t = parseTime(target.value);
          if (!t) return toast('Enter a length like 5:00');
          attempt(() => {
            const r = Gen.extend(App.song, t, { creativity: +creat.value / 100, seed: seed(), key: keyOv(), ending: ending.checked });
            finish(`Extended by ${r.added} bars in ${r.sections} sections — Ctrl+Z to undo`);
          });
        } }, '✨ Extend')),
      h('div', { class: 'card' },
        h('h3', null, '▦ Fill silent gaps'),
        h('p', null, 'Writes material into bars where every track is silent (between your first and last bars), built from the surrounding sections.'),
        h('button', { class: 'big purple', onclick: () => attempt(() => { const r = Gen.fillGaps(App.song, { creativity: +creat.value / 100, seed: seed(), key: keyOv() }); finish('Filled ' + r.filled + ' silent bars — Ctrl+Z to undo'); }) }, '✨ Fill gaps'))));

  // --- Add parts tab
  const addEd = PartsEditor([Gen.part('counter', 'thirds'), Gen.part('bells', 'sparse'), Gen.part('perc', 'hats8')]);
  const fromBar = h('input', { type: 'number', min: 1, value: 1, style: { width: '64px' } });
  const addTab = h('div', null,
    h('p', { class: 'empty', style: { padding: '0 0 8px' } }, 'Add new players to the song you already have. They follow its chords bar by bar; counter-melodies and echoes follow its lead line. Silent stretches stay silent.'),
    addEd.el,
    h('div', { class: 'frow', style: { marginTop: '10px' } }, h('label', null, 'Start at bar'), fromBar,
      h('button', { class: 'big purple', onclick: () => attempt(() => {
        const ps = addEd.get();
        if (!ps.length) throw new Error('Add at least one part');
        const r = Gen.addParts(App.song, ps, { seed: seed(), startBar: (+fromBar.value || 1) - 1, key: keyOv() });
        finish('Added ' + r.tracks.length + ' part(s) — Ctrl+Z to undo');
      }) }, '✨ Add parts')));

  // --- New song tab
  const styleSel = h('select', null, Object.keys(Gen.STYLES).map(k => h('option', { value: k }, Gen.STYLES[k].name)));
  const nsKey = h('select', null, h('option', { value: 'r' }, 'Random key'), keyOptions(-1));
  const nsScale = h('select', null, h('option', { value: '' }, 'Style default'), scaleOptions(''));
  const nsBpm = h('input', { type: 'number', min: 40, max: 260, placeholder: 'style', style: { width: '70px' } });
  const nsProg = h('input', { placeholder: 'style default — or e.g. i bVI bIII bVII', style: { flex: 1, minWidth: '180px' } });
  const nsLen = h('input', { value: '2:00', style: { width: '70px' } });
  const nsBars = h('select', null, h('option', { value: 8 }, '8-bar theme'), h('option', { value: 16 }, '16-bar theme'));
  const nsLayer = h('input', { type: 'checkbox', checked: true });
  const nsMotif = h('input', { placeholder: 'optional, e.g. E G A G E D', style: { width: '200px' } });
  const newEd = PartsEditor(Gen.STYLES.overworld.parts);
  styleSel.onchange = () => newEd.set(Gen.STYLES[styleSel.value].parts);
  const motifPitches = txt => {
    if (!txt.trim()) return null;
    const o = Gen.interpret('motif: ' + txt);
    return o.motif || null;
  };
  const buildNew = (styleKey, o, msg) => attempt(() => {
    if (Transport.playing) Transport.stop();
    App.song = Gen.newSong(styleKey, Object.assign({ seed: seed(), creativity: +creat.value / 100 }, o));
    App.selTrack = null; App.selPattern = null;
    finish(msg);
  });
  const newTab = h('div', null,
    h('div', { class: 'mgrid' },
      h('div', null,
        h('div', { class: 'frow' }, h('label', null, 'Style'), styleSel),
        h('div', { class: 'frow' }, h('label', null, 'Key / scale'), nsKey, nsScale),
        h('div', { class: 'frow' }, h('label', null, 'Tempo (BPM)'), nsBpm),
        h('div', { class: 'frow' }, h('label', null, 'Chords'), nsProg)),
      h('div', null,
        h('div', { class: 'frow' }, h('label', null, 'Length'), nsLen, nsBars),
        h('div', { class: 'frow' }, h('label', null, 'Melody motif'), nsMotif),
        h('div', { class: 'frow' }, h('label', null, nsLayer, ' Build up from an intro')))),
    h('h3', { style: { margin: '8px 0 6px', fontSize: '13px', color: 'var(--acc)' } }, 'Band'),
    newEd.el,
    h('div', { class: 'frow', style: { justifyContent: 'flex-end', marginTop: '10px' } },
      h('button', { class: 'big', onclick: () => {
        const ps = newEd.get();
        if (!ps.length) return toast('Add at least one part');
        buildNew(styleSel.value, {
          key: nsKey.value === 'r' ? null : +nsKey.value, scale: nsScale.value || null, bpm: +nsBpm.value || null, prog: nsProg.value,
          lengthSec: parseTime(nsLen.value) || 0, bars: +nsBars.value, layer: nsLayer.checked, parts: ps, motif: motifPitches(nsMotif.value),
        }, 'New ' + Gen.STYLES[styleSel.value].name + ' song with ' + ps.length + ' parts — Ctrl+Z to get your old one back');
      } }, '★ Generate song')));

  // --- Describe tab
  const desc = h('textarea', { rows: 5, placeholder: 'Describe the song…' });
  desc.value = 'A spooky haunted castle at night, slow and atmospheric with music box bells and a walking bass, builds from an intro, 3 minutes. Motif: E G F# E B';
  const understood = h('div', { class: 'chips' });
  const show = o => { understood.innerHTML = ''; for (const n of o.notes) understood.append(h('span', { class: 'chip' }, n)); for (const p of o.parts) understood.append(h('span', { class: 'chip', style: { borderColor: '#7d61c4' } }, Gen.ROLES[p.role].short + ' · ' + p.style)); };
  const read = () => { const o = Gen.interpret(desc.value, seed()); show(o); return o; };
  desc.oninput = debounce(read, 250);
  const toForm = o => {
    styleSel.value = o.style;
    nsKey.value = o.key != null ? String(o.key) : 'r';
    nsScale.value = o.scale || '';
    nsBpm.value = o.bpm || '';
    nsProg.value = o.prog || '';
    nsLen.value = o.lengthSec ? fmtTime(o.lengthSec) : '2:00';
    nsLayer.checked = !!o.layer;
    nsMotif.value = o.motif ? o.motif.map(noteName).join(' ') : '';
    newEd.set(o.parts);
  };
  const descTab = h('div', null,
    h('p', { class: 'empty', style: { padding: '0 0 8px' } }, 'Write what the song should feel like. Places, moods, speed, instruments, length, key (“in D minor”), chords (“chords: i VI III VII”) and a melody (“motif: E G A G”) are all understood. Everything is interpreted offline in the app.'),
    desc,
    h('div', { class: 'frow', style: { marginTop: '6px' } },
      ['Sunny seaside town, cheerful and bouncy with a flute, 2 minutes', 'Frantic escape from a collapsing space station, 9 instruments, very fast', 'Sad rainy goodbye in A minor, minimal, slow, 1:30', 'Epic final boss in a volcano, gritty, driving, with echo', 'Dreamy puzzle menu with chimes, no drums']
        .map(t => h('button', { style: { padding: '1px 6px', fontSize: '11px' }, onclick: () => { desc.value = t; read(); } }, t.split(',')[0]))),
    h('h3', { style: { margin: '10px 0 4px', fontSize: '13px', color: 'var(--acc)' } }, 'Understood'),
    understood,
    h('div', { class: 'frow', style: { justifyContent: 'flex-end', marginTop: '10px' } },
      h('button', { onclick: () => { toForm(read()); setTab('new'); } }, 'Edit details first →'),
      h('button', { class: 'big purple', onclick: () => {
        const o = read();
        buildNew(o.style, { key: o.key, scale: o.scale, bpm: o.bpm, prog: o.prog, lengthSec: o.lengthSec || 120, layer: o.layer, parts: o.parts, motif: o.motif, swing: o.swing, name: o.name },
          '“' + o.name + '” — ' + o.parts.length + ' parts. Ctrl+Z to get your old song back');
      } }, '✨ Make this song')));
  setTimeout(read, 0);

  const tabs = { describe: ['✍ Describe', descTab], extend: ['⟶ Extend / fill', extendTab], add: ['＋ Add parts', addTab], new: ['★ New song', newTab] };
  const bar = h('div', { class: 'mtabs' });
  const host = h('div');
  const setTab = k => {
    _composeTab = k;
    $$('button', bar).forEach(b => b.classList.toggle('on', b.dataset.k === k));
    host.innerHTML = '';
    host.append(tabs[k][1]);
  };
  for (const k in tabs) bar.append(h('button', { 'data-k': k, onclick: () => setTab(k) }, tabs[k][0]));
  Modal.open('✨ Compose', h('div', null, bar, shared, host), true);
  setTab(_composeTab);
}

// ------------------------------------------------------------------ Chord progression import
function openChords() {
  const s = App.song;
  const ta = h('textarea', { rows: 3, placeholder: 'C G Am F   or   I V vi IV   or   Am:2 F G   (":2" = twice as long, "%" = hold, N.C. = rest)' });
  ta.value = 'I V vi IV';
  const keySel = h('select', null, keyOptions(s.key));
  const scSel = h('select', null, scaleOptions(s.scale));
  const preset = h('select', null, h('option', { value: '' }, 'Common progressions…'),
    [['I V vi IV', 'Pop: I–V–vi–IV'], ['vi IV I V', 'Sad pop: vi–IV–I–V'], ['I vi IV V', '50s: I–vi–IV–V'], ['ii V I I', 'Jazz: ii–V–I'],
      ['I IV V IV', 'Rock: I–IV–V–IV'], ['I bVII IV I', 'Mixolydian: I–bVII–IV–I'], ['i bVI bIII bVII', 'Epic: i–bVI–bIII–bVII'],
      ['i bVII bVI V', 'Andalusian: i–bVII–bVI–V'], ['i iv v i', 'Minor: i–iv–v–i'], ['i VI III VII', 'Minor anthem: i–VI–III–VII'],
      ['I iii IV iv', 'Bittersweet: I–iii–IV–iv'], ['I II IV I', 'Lydian lift: I–II–IV–I'], ['vi IV V iii', 'Heroic: vi–IV–V–iii'],
      ['I V vi iii IV I IV V', 'Canon: I–V–vi–iii–IV–I–IV–V'], ['i bII i V', 'Villain: i–bII–i–V']].map(([v, l]) => h('option', { value: v }, l)));
  preset.onchange = () => { if (preset.value) { ta.value = preset.value; upd(); } };
  const unit = h('select', null, [[1, '1 beat'], [2, '2 beats'], [4, '1 bar (4 beats)'], [8, '2 bars']].map(([v, l]) => h('option', { value: v, selected: v === s.beatsPerBar }, l)));
  const repeat = h('select', null, [1, 2, 3, 4, 8].map(v => h('option', { value: v }, '×' + v)));
  const startBar = h('input', { type: 'number', min: 1, value: Math.floor(Transport.songPos / barTicks()) + 1, style: { width: '64px' } });
  const setKey = h('input', { type: 'checkbox', checked: true });
  const chips = h('div', { class: 'chips' });
  const ed = PartsEditor([Gen.part('chords', 'block'), Gen.part('bass', 'octave')], { tracks: s.tracks });
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
    const parts = ed.get();
    if (!parts.length) return toast('Add at least one part to write');
    pushUndo();
    if (setKey.checked) { s.key = +keySel.value; s.scale = scSel.value; }
    let items = [];
    for (let k = 0; k < +repeat.value; k++) items = items.concat(r.items);
    const res = Gen.chordsToTracks(s, items, { unitBeats: +unit.value, startBar: Math.max(0, (+startBar.value || 1) - 1), parts, seed: Math.floor(Math.random() * 1e6) });
    Modal.close();
    if (res.patterns[0]) { App.selTrack = res.patterns[0].track; App.selPattern = res.patterns[0].id; }
    UI.syncTop();
    changed({ full: true });
    ARR.layout();
    toast('Imported ' + items.length + ' chords into ' + parts.length + ' part(s), ' + res.bars + ' bars');
  };

  Modal.open('Chord progression', h('div', null,
    h('div', { class: 'frow' }, preset, h('button', { onclick: fromMidi, title: 'Detect the chords in a MIDI file' }, 'From MIDI file…')),
    ta, chips,
    h('div', { class: 'frow', style: { marginTop: '8px' } },
      h('label', null, 'Key'), keySel, scSel, h('label', null, setKey, ' Set song key'),
      h('label', null, 'Each chord'), unit, h('label', null, 'Repeat'), repeat, h('label', null, 'Start bar'), startBar),
    h('h3', { style: { margin: '10px 0 6px', fontSize: '13px', color: 'var(--acc)' } }, 'Parts to write over these chords'),
    ed.el,
    h('p', { class: 'empty', style: { padding: '8px 0 0' } }, 'Pick “→ existing track” in the instrument list to write into a track you already have. Melody parts are generated over the chords; counter-melodies and echoes follow the generated lead.'),
    h('div', { class: 'frow', style: { justifyContent: 'flex-end', marginTop: '8px' } }, h('button', { class: 'big', onclick: go }, 'Import chords'))), true);
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
  const imp = h('button', { class: 'big', onclick: async () => { const f = await pickFile('audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm'); if (f) { Modal.close(); SMP.importAsTrack(f); } } }, '📂 Import a sound file (WAV, MP3, OGG…)');
  Modal.open('Add instrument track', h('div', null, h('div', { class: 'frow', style: { marginBottom: '10px' } }, imp, h('span', { class: 'dim' }, 'or drop audio files anywhere on the window')), grid), true);
}

// ------------------------------------------------------------------ Help
function openHelp() {
  const rows = [
    ['Space', 'Play / stop'], ['Home', 'Back to start'], ['F5 / F7 / F9', 'Playlist / Piano roll / Mixer'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S / Ctrl+O', 'Save / open project (everything else is in the File / Edit / Track / Tools / View menus)'],
    ['Z S X D C V … / Q 2 W 3 E …', 'Typing piano (two octaves) on the selected track'], ['PageUp / PageDown', 'Typing-piano octave'],
    ['Piano roll: click / drag', 'Draw a note, drag right for length'], ['Drag note / edge', 'Move / resize (Alt = no snap, Shift+drag = copy)'],
    ['Right-click', 'Delete notes / clips'], ['Ctrl/Shift+drag (or ⬚ Select tool)', 'Box select notes or clips; Ctrl+click toggles one'], ['Drag the piano-roll ruler', 'Select every note in that time range'], ['Esc', 'Clear selection'], ['Touch: ✋ Scroll / ✎ Edit', 'Scroll mode: drag scrolls, tap edits. Edit mode: drag moves / selects. ☰ and 🎛 open the side panels on phones'], ['Ctrl+A, C, X, V, D', 'Select all, copy, cut, paste (at the mouse), duplicate — also as toolbar buttons'],
    ['↑ ↓ (Shift = octave)', 'Transpose selection'], ['← →', 'Nudge selection (Shift = bar)'], ['Delete', 'Delete selection'],
    ['● Record + Play (SONG mode)', 'Move any dial / fader / slider to record automation; release to stop writing. Replays (and exports) exactly. Lines show in the playlist; clear them in the track ⚙ or the Mixer master strip'],
    ['Ctrl+wheel / Alt+wheel', 'Zoom horizontally / row height'],
    ['Playlist track header', 'Drag the coloured bar for volume, the L–R bar for pan (double-click resets); ⚙ opens a mini mixer with sends, filters, EQ, drive and bits'],
    ['B / E / D / C (typing piano off)', 'Draw / select / erase / chord tool'],
    ['Drop audio files on the playlist', 'Places the sound on a new lane under the one you drop on, at that bar (an empty sample lane takes it instead). Drag a sample’s waveform from the instrument panel to place it again; ✂ Edit wave… cuts, trims, fades, reverses and crushes it'], ['Mixer → Spectrum', 'Frequency view of the master or any track; hover for Hz / note'],
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
  const smp = SMP.embed(s);
  download(new Blob([JSON.stringify(Object.keys(smp).length ? Object.assign({}, s, { sampleData: smp }) : s)], { type: 'application/json' }), safeName(s.name) + '.chipforge.json');
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
    SMP.unembed(s.sampleData);
    delete s.sampleData;
    App.song = s;
    App.selTrack = null;
    afterLoad();
    UI.syncTop();
    ARR.layout();
    toast('Opened ' + f.name);
  } catch (e) { toast('Could not open: ' + e.message, 4000); }
}
