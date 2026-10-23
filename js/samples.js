'use strict';
// Imported sound files. The PCM lives here (and in IndexedDB) rather than in the song, so undo and autosave stay
// small; instruments of type 'sample' just point at an id. Saved project files embed the audio as base64.

const SMP = {
  map: new Map(), // id -> { id, name, rate, ch: [Float32Array...], ver }
  MAX_SEC: 60,

  get(id) { return id ? this.map.get(id) || null : null; },
  len(s) { return s.ch[0].length; },

  put(s, quiet) {
    s.ver = (s.ver || 0) + 1;
    this.map.set(s.id, s);
    if (!quiet) this.persist(s);
    return s;
  },

  // ---- IndexedDB
  db() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no IndexedDB'));
      const r = indexedDB.open('chipforge', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('samples', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async persist(s) {
    try {
      const d = await this.db();
      d.transaction('samples', 'readwrite').objectStore('samples').put({ id: s.id, name: s.name, rate: s.rate, ch: s.ch });
    } catch (e) { /* private mode: samples last for this session only */ }
  },
  async loadAll() {
    try {
      const d = await this.db();
      const all = await new Promise((res, rej) => { const r = d.transaction('samples').objectStore('samples').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const s of all) if (!this.map.has(s.id)) this.put({ id: s.id, name: s.name, rate: s.rate, ch: s.ch.map(c => c instanceof Float32Array ? c : new Float32Array(c)) }, true);
    } catch (e) { /* nothing stored */ }
  },
  // drop stored samples no track (or undo step) has referenced for a while — only ones not used by the current song
  async gc() {
    const used = new Set(App.song.tracks.map(t => t.inst.sample).filter(Boolean));
    for (const u of App.undoStack.slice(-20)) for (const m of u.matchAll(/"sample":"([^"]+)"/g)) used.add(m[1]);
    try {
      const d = await this.db(), st = d.transaction('samples', 'readwrite').objectStore('samples');
      for (const id of [...this.map.keys()]) if (!used.has(id)) { st.delete(id); this.map.delete(id); }
    } catch (e) { /* ignore */ }
  },

  // ---- import
  async decode(arrayBuf) {
    const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = AE.ctx || new C(1, 1, 44100);
    return await new Promise((res, rej) => { const p = ctx.decodeAudioData(arrayBuf, res, rej); if (p && p.catch) p.catch(rej); });
  },
  async fromFile(file) {
    const ab = await this.decode(await readFile(file));
    const n = Math.min(ab.length, Math.round(ab.sampleRate * this.MAX_SEC)), ch = [];
    for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) ch.push(ab.getChannelData(c).slice(0, n));
    const s = this.put({ id: uid('s'), name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), rate: ab.sampleRate, ch });
    if (ab.length > n) toast('Trimmed to the first ' + this.MAX_SEC + ' seconds', 3500);
    return s;
  },

  // ---- project files
  toB64(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = clamp(Math.round(f32[i] * 32767), -32768, 32767);
    const u8 = new Uint8Array(i16.buffer);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  fromB64(b) {
    const s = atob(b), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    const i16 = new Int16Array(u8.buffer), f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    return f;
  },
  embed(song) {
    const out = {};
    for (const tr of song.tracks) { const s = this.get(tr.inst.sample); if (s && !out[s.id]) out[s.id] = { name: s.name, rate: s.rate, ch: s.ch.map(c => this.toB64(c)) }; }
    return out;
  },
  unembed(data) {
    for (const id in data || {}) { const d = data[id]; this.put({ id, name: d.name, rate: d.rate, ch: d.ch.map(c => this.fromB64(c)) }); }
  },

  // new track playing a freshly imported file
  async importAsTrack(file) {
    let s;
    try { s = await this.fromFile(file); } catch (e) { return toast('Could not read that audio file', 3500); }
    pushUndo();
    const inst = Object.assign(defaultInst('sample'), { sample: s.id, a: 0.001, d: 0.1, s: 1, r: 0.05 });
    const tr = addTrack(App.song, s.name.slice(0, 24) || 'Sample', inst);
    const pat = addPattern(App.song, tr.id, tr.name + ' 1', 1, [{ t: 0, d: TPB, p: 60, v: 110 }]);
    App.selTrack = tr.id; App.selPattern = pat.id;
    changed({ full: true });
    ARR.layout();
    toast('Imported ' + s.name + ' — ' + noteName(60) + ' plays it at its original pitch');
    return tr;
  },
};

// Peak (min/max) overview of a channel range, one pair per pixel column.
function drawWave(g, s, x0, x1, W, H, o) {
  o = o || {};
  const d = s.ch[0], d2 = s.ch[1], n = x1 - x0, mid = H / 2;
  g.fillStyle = o.color || '#7cf28a';
  for (let x = 0; x < W; x++) {
    const a = x0 + Math.floor(x * n / W), b = Math.max(a + 1, x0 + Math.floor((x + 1) * n / W));
    let lo = 1, hi = -1;
    for (let i = a; i < b && i < d.length; i += Math.max(1, (b - a) >> 8)) {
      const v = d2 ? (d[i] + d2[i]) / 2 : d[i];
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (hi < lo) continue;
    const y0 = mid - hi * mid * 0.95, y1 = mid - lo * mid * 0.95;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

// ------------------------------------------------------------------ waveform editor
function openSampleEditor(tr) {
  const I = tr.inst;
  let s = SMP.get(I.sample);
  if (!s) return toast('Load a sound first');
  // work on a copy; Save writes it back
  let cur = { rate: s.rate, ch: s.ch.map(c => c.slice()) };
  const hist = [], redo = [];
  let clip = null, view = [0, SMP.len(cur)], sel = null, cursor = 0, playSrc = null, playStart = 0, playFrom = 0, playTo = 0;
  let loopS = I.sLs, loopE = I.sLe;
  const L = () => cur.ch[0].length;
  const snap = () => { hist.push({ rate: cur.rate, ch: cur.ch.map(c => c.slice()), loopS, loopE }); if (hist.length > 40) hist.shift(); redo.length = 0; };
  const restore = st => { cur = { rate: st.rate, ch: st.ch }; loopS = st.loopS; loopE = st.loopE; view = [0, L()]; sel = null; cursor = Math.min(cursor, L()); };
  const range = () => sel && sel[1] - sel[0] > 0 ? sel : null;
  const secs = n => (n / cur.rate).toFixed(3) + 's';

  const cv = h('canvas', { class: 'smpcv', height: 220 });
  const ov = h('canvas', { class: 'smpov', height: 36, title: 'Overview — click or drag to move the view' });
  const info = h('span', { class: 'chip' });
  const rootSel = h('select', { title: 'The note that plays the sound at its original pitch' },
    Array.from({ length: 73 }, (_, i) => i + 24).map(p => h('option', { value: p, selected: p === (I.sRoot || 60) }, noteName(p))));

  const draw = () => {
    const r = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * r) || 800, H = Math.round(220 * r);
    if (cv.width !== W) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'), n = view[1] - view[0], X = i => (i - view[0]) / n * W;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1e2433'; g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.stroke();
    if (I.sLoop) {
      const a = X(loopS * L()), b = X(loopE * L());
      g.fillStyle = 'rgba(255,207,90,0.08)'; g.fillRect(a, 0, b - a, H);
      g.fillStyle = '#ffcf5a'; g.fillRect(a, 0, 2 * r, H); g.fillRect(b - 2 * r, 0, 2 * r, H);
    }
    const rs = range();
    if (rs) { g.fillStyle = 'rgba(108,198,255,0.22)'; g.fillRect(X(rs[0]), 0, X(rs[1]) - X(rs[0]), H); }
    if (L()) drawWave(g, cur, view[0], view[1], W, H);
    g.fillStyle = '#e9edf5'; g.fillRect(Math.round(X(cursor)), 0, r, H);
    if (playSrc) { const p = playFrom + (AE.ctx.currentTime - playStart) * cur.rate; if (p < playTo) { g.fillStyle = '#ff6b6b'; g.fillRect(Math.round(X(p)), 0, 2 * r, H); } }
    // overview
    const OW = Math.round(ov.clientWidth * r) || 800, OH = Math.round(36 * r);
    if (ov.width !== OW) { ov.width = OW; ov.height = OH; }
    const og = ov.getContext('2d');
    og.fillStyle = '#0b0d12'; og.fillRect(0, 0, OW, OH);
    if (L()) {
      drawWave(og, cur, 0, L(), OW, OH, { color: '#3f7d4a' });
      og.strokeStyle = '#6cc6ff'; og.lineWidth = r; og.strokeRect(view[0] / L() * OW + 0.5, 0.5, Math.max(2, (view[1] - view[0]) / L() * OW) - 1, OH - 1);
    }
    info.textContent = L() ? (cur.ch.length > 1 ? 'Stereo' : 'Mono') + ' · ' + cur.rate + ' Hz · ' + secs(L()) + (rs ? ' · selection ' + secs(rs[1] - rs[0]) : ' · cursor ' + secs(cursor)) : 'Empty';
  };
  let raf = 0;
  const anim = () => { draw(); if (playSrc && document.body.contains(cv)) raf = requestAnimationFrame(anim); };

  // ---- mouse: drag selects, shift extends, wheel zooms, alt/middle drag scrolls
  const idxAt = e => { const b = cv.getBoundingClientRect(); return clamp(Math.round(view[0] + (e.clientX - b.left) / b.width * (view[1] - view[0])), 0, L()); };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const i = idxAt(e);
    if (e.button === 1 || e.altKey) {
      const x0 = e.clientX, v0 = view.slice(), b = cv.getBoundingClientRect();
      cv.onpointermove = ev => { const d = Math.round((x0 - ev.clientX) / b.width * (v0[1] - v0[0])), w = v0[1] - v0[0]; const a = clamp(v0[0] + d, 0, L() - w); view = [a, a + w]; draw(); };
    } else {
      const anchor = e.shiftKey && range() ? (Math.abs(i - sel[0]) < Math.abs(i - sel[1]) ? sel[1] : sel[0]) : i;
      sel = e.shiftKey ? [Math.min(anchor, i), Math.max(anchor, i)] : null; cursor = i;
      cv.onpointermove = ev => { const j = idxAt(ev); sel = [Math.min(anchor, j), Math.max(anchor, j)]; draw(); };
    }
    draw();
  });
  cv.addEventListener('pointerup', () => { cv.onpointermove = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const b = cv.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width, n = view[1] - view[0];
    if (!(e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) || e.shiftKey) {
      const d = Math.round((e.deltaX || e.deltaY) / b.width * n); const a = clamp(view[0] + d, 0, L() - n); view = [a, a + n];
    } else {
      const nn = clamp(Math.round(n * Math.pow(1.0015, e.deltaY)), Math.min(L(), 64), L()), c = view[0] + fx * n;
      const a = clamp(Math.round(c - fx * nn), 0, L() - nn); view = [a, a + nn];
    }
    draw();
  }, { passive: false });
  const ovMove = e => { const b = ov.getBoundingClientRect(), n = view[1] - view[0]; const a = clamp(Math.round((e.clientX - b.left) / b.width * L() - n / 2), 0, L() - n); view = [a, a + n]; draw(); };
  ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); ovMove(e); ov.onpointermove = ovMove; });
  ov.addEventListener('pointerup', () => { ov.onpointermove = null; });

  // ---- edits
  const edit = (name, fn, needSel) => {
    const rs = range();
    if (needSel && !rs) return toast('Select part of the wave first (drag across it)');
    snap();
    fn(rs || [0, L()]);
    view = [clamp(view[0], 0, L()), clamp(Math.max(view[1], view[0] + 1), 0, L())];
    if (view[1] - view[0] < 2) view = [0, L()];
    cursor = Math.min(cursor, L());
    setStatus(name);
    draw();
  };
  const splice = (a, b, ins) => { cur.ch = cur.ch.map((c, k) => { const add = ins ? ins[Math.min(k, ins.length - 1)] : new Float32Array(0); const o = new Float32Array(c.length - (b - a) + add.length); o.set(c.subarray(0, a)); o.set(add, a); o.set(c.subarray(b), a + add.length); return o; }); };
  const each = (rs, f) => { for (const c of cur.ch) for (let i = rs[0]; i < rs[1]; i++) c[i] = f(c[i], i, rs); };
  const copySel = () => { const rs = range(); if (!rs) return toast('Nothing selected'); clip = cur.ch.map(c => c.slice(rs[0], rs[1])); toast('Copied ' + secs(rs[1] - rs[0])); };
  const peakOf = rs => { let p = 0; for (const c of cur.ch) for (let i = rs[0]; i < rs[1]; i++) p = Math.max(p, Math.abs(c[i])); return p; };
  const resample = (ratio) => { // ratio > 1 = higher & shorter
    cur.ch = cur.ch.map(c => { const n = Math.max(1, Math.floor(c.length / ratio)), o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * ratio, j = Math.floor(x), t = x - j; o[i] = (c[j] || 0) * (1 - t) + (c[j + 1] || 0) * t; } return o; });
  };
  const ops = {
    cut: () => { if (!range()) return toast('Nothing selected'); copySel(); edit('Cut', rs => { splice(rs[0], rs[1]); cursor = rs[0]; sel = null; }, true); },
    copy: copySel,
    paste: () => { if (!clip) return toast('Copy part of the wave first'); edit('Paste', rs => { const at = range() ? rs : [cursor, cursor]; if (clip.length < cur.ch.length) clip = cur.ch.map(() => clip[0]); splice(at[0], at[1], clip); sel = [at[0], at[0] + clip[0].length]; }); },
    del: () => edit('Delete', rs => { splice(rs[0], rs[1]); cursor = rs[0]; sel = null; }, true),
    crop: () => edit('Trim to selection', rs => { cur.ch = cur.ch.map(c => c.slice(rs[0], rs[1])); sel = null; cursor = 0; view = [0, L()]; }, true),
    silence: () => edit('Silence', rs => each(rs, () => 0), true),
    fadeIn: () => edit('Fade in', rs => each(rs, (v, i) => v * (i - rs[0]) / (rs[1] - rs[0]))),
    fadeOut: () => edit('Fade out', rs => each(rs, (v, i) => v * (rs[1] - i) / (rs[1] - rs[0]))),
    reverse: () => edit('Reverse', rs => { for (const c of cur.ch) c.subarray(rs[0], rs[1]).reverse(); }),
    normalize: () => edit('Normalize', rs => { const p = peakOf(rs); if (p > 0) each(rs, v => v * 0.98 / p); }),
    gain: db => edit('Gain ' + (db > 0 ? '+' : '') + db + ' dB', rs => { const k = Math.pow(10, db / 20); each(rs, v => clamp(v * k, -1, 1)); }),
    invert: () => edit('Invert', rs => each(rs, v => -v)),
    crush: () => edit('Bitcrush to ' + crushBits.value + ' bits', rs => { const q = Math.pow(2, +crushBits.value - 1); each(rs, v => Math.round(v * q) / q); }),
    downsample: () => edit('Downsample to ' + dsRate.value + ' Hz', rs => { const step = Math.max(1, cur.rate / +dsRate.value); for (const c of cur.ch) { let hold = 0; for (let i = rs[0]; i < rs[1]; i++) { if ((i - rs[0]) % step < 1) hold = c[i]; c[i] = hold; } } }),
    pitch: st => edit('Pitch ' + (st > 0 ? '+' : '') + st + ' st (changes length)', () => { resample(Math.pow(2, st / 12)); sel = null; view = [0, L()]; }),
    mono: () => { if (cur.ch.length < 2) return toast('Already mono'); edit('Mixed to mono', () => { const a = cur.ch[0], b = cur.ch[1]; cur.ch = [a.map((v, i) => (v + b[i]) / 2)]; }); },
    trimSilence: () => edit('Trimmed silence', () => { const th = 0.01; let a = 0, b = L(); const loud = i => cur.ch.some(c => Math.abs(c[i]) > th); while (a < b && !loud(a)) a++; while (b > a && !loud(b - 1)) b--; cur.ch = cur.ch.map(c => c.slice(a, b)); sel = null; cursor = 0; view = [0, L()]; }),
    loopSel: () => { const rs = range(); if (!rs) return toast('Select the part to loop'); snap(); loopS = rs[0] / L(); loopE = rs[1] / L(); I.sLoop = true; loopChk.checked = true; draw(); },
    zoomSel: () => { const rs = range(); view = rs ? [rs[0], rs[1]] : [0, L()]; draw(); },
    all: () => { sel = [0, L()]; draw(); },
    undo: () => { if (!hist.length) return toast('Nothing to undo'); redo.push({ rate: cur.rate, ch: cur.ch, loopS, loopE }); restore(hist.pop()); draw(); },
    redo: () => { if (!redo.length) return; hist.push({ rate: cur.rate, ch: cur.ch, loopS, loopE }); restore(redo.pop()); draw(); },
  };

  // ---- audition
  const stop = () => { if (playSrc) { try { playSrc.stop(); } catch (e) { /* done */ } playSrc = null; } };
  const play = () => {
    stop();
    if (!L()) return;
    AE.ensure();
    const rs = range();
    const b = AE.ctx.createBuffer(cur.ch.length, L(), cur.rate);
    cur.ch.forEach((d, k) => b.copyToChannel(d, k));
    const src = AE.ctx.createBufferSource(), g = AE.ctx.createGain();
    src.buffer = b; g.gain.value = 0.9; src.connect(g); g.connect(AE.ctx.destination);
    playFrom = rs ? rs[0] : cursor >= L() - 10 ? 0 : cursor; playTo = rs ? rs[1] : L();
    src.start(AE.ctx.currentTime, playFrom / cur.rate, (playTo - playFrom) / cur.rate);
    playStart = AE.ctx.currentTime; playSrc = src;
    src.onended = () => { if (playSrc === src) playSrc = null; draw(); };
    cancelAnimationFrame(raf); anim();
  };

  const crushBits = h('select', { title: 'Bit depth' }, [8, 6, 5, 4, 3, 2].map(b => h('option', { value: b }, b + '-bit')));
  const dsRate = h('select', { title: 'Sample rate' }, [16000, 11025, 8000, 5512, 4000].map(r => h('option', { value: r, selected: r === 8000 }, r + ' Hz')));
  const loopChk = h('input', { type: 'checkbox', checked: !!I.sLoop, onchange: e => { I.sLoop = e.target.checked; draw(); } });
  const B = (label, fn, title) => h('button', { onclick: fn, title: title || '' }, label);
  const save = () => {
    if (!L()) return toast('The sound is empty');
    stop();
    pushUndo();
    // a new id keeps older undo steps pointing at the old audio
    const ns = SMP.put({ id: uid('s'), name: s.name, rate: cur.rate, ch: cur.ch });
    I.sample = ns.id; I.sRoot = +rootSel.value; I.sLs = loopS; I.sLe = loopE; I.sLoop = loopChk.checked;
    close();
    changed({ lists: true });
    INST.render(true);
    toast('Sound saved');
  };
  const close = () => { stop(); cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey, true); Modal.close(); };
  const onKey = e => {
    if (!document.body.contains(cv)) return window.removeEventListener('keydown', onKey, true);
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    const map = { ' ': () => (playSrc ? stop() : play()), delete: ops.del, backspace: ops.del, escape: range() ? () => { sel = null; draw(); } : null };
    const cmap = { x: ops.cut, c: ops.copy, v: ops.paste, z: e.shiftKey ? ops.redo : ops.undo, y: ops.redo, a: ops.all, s: save };
    const f = c ? cmap[k] : (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') ? null : map[k];
    if (f) { e.preventDefault(); e.stopPropagation(); f(); }
  };
  window.addEventListener('keydown', onKey, true);

  const body = h('div', { class: 'smped' },
    h('div', { class: 'frow' }, info, h('span', { class: 'dim' }, 'Drag to select · Shift+click extends · wheel zooms · Alt+drag scrolls · Space plays')),
    cv, ov,
    h('div', { class: 'smptools' },
      B('▶ Play', play, 'Play the selection, or from the cursor (Space)'), B('■', stop, 'Stop'),
      B('Zoom sel', ops.zoomSel, 'Zoom to the selection (or out to everything)'), B('All', ops.all, 'Select all (Ctrl+A)'),
      B('↶', ops.undo, 'Undo (Ctrl+Z)'), B('↷', ops.redo, 'Redo (Ctrl+Y)')),
    h('div', { class: 'smptools' },
      B('Cut', ops.cut, 'Ctrl+X'), B('Copy', ops.copy, 'Ctrl+C'), B('Paste', ops.paste, 'Insert at the cursor, or replace the selection (Ctrl+V)'),
      B('Delete', ops.del, 'Remove the selection (Del)'), B('Trim to sel', ops.crop, 'Keep only the selection'), B('Trim silence', ops.trimSilence, 'Remove quiet bits at both ends'), B('Silence', ops.silence, 'Zero the selection')),
    h('div', { class: 'smptools' },
      B('Fade in', ops.fadeIn), B('Fade out', ops.fadeOut), B('Reverse', ops.reverse), B('Normalize', ops.normalize, 'Raise to full volume'),
      B('-3 dB', () => ops.gain(-3)), B('+3 dB', () => ops.gain(3)), B('Invert', ops.invert, 'Flip the polarity'), B('To mono', ops.mono)),
    h('div', { class: 'smptools' },
      crushBits, B('Bitcrush', ops.crush, 'Fewer volume steps = grittier'), dsRate, B('Downsample', ops.downsample, 'Hold samples for that crunchy low-rate sound'),
      B('Pitch −12', () => ops.pitch(-12)), B('−1', () => ops.pitch(-1)), B('+1', () => ops.pitch(1)), B('Pitch +12', () => ops.pitch(12))),
    h('div', { class: 'smptools' },
      h('label', null, 'Root note '), rootSel,
      h('label', { title: 'Repeat the loop region while a note is held' }, loopChk, ' Loop'), B('Loop = selection', ops.loopSel, 'Set the loop region to the selection'),
      h('span', { style: { flex: 1 } }),
      B('Cancel', close), h('button', { class: 'big', onclick: save }, 'Save sound')));
  Modal.open('Edit sound — ' + s.name, body, true);
  requestAnimationFrame(draw);
}
