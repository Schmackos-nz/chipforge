'use strict';
// Music theory: scales, chord parsing (symbols + roman numerals), voicing, key & chord detection.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pc = p => ((p % 12) + 12) % 12;
function noteName(p) { return NOTE_NAMES[pc(p)] + (Math.floor(p / 12) - 1); }

const SCALES = {
  major: { name: 'Major', iv: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', iv: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: 'Harmonic Minor', iv: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: 'Dorian', iv: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', iv: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', iv: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', iv: [0, 2, 4, 5, 7, 9, 10] },
  majorPent: { name: 'Major Pentatonic', iv: [0, 2, 4, 7, 9] },
  minorPent: { name: 'Minor Pentatonic', iv: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', iv: [0, 3, 5, 6, 7, 10] },
};
const scaleIv = n => (SCALES[n] || SCALES.major).iv;
const isMinorScale = n => { const iv = scaleIv(n); return iv.includes(3) && !iv.includes(4); };
const heptaOf = n => { const iv = scaleIv(n); return iv.length === 7 ? iv : (isMinorScale(n) ? SCALES.minor.iv : SCALES.major.iv); };
function scalePcs(root, scaleName) { return scaleIv(scaleName).map(i => pc(i + root)); }

const CHORD_TYPES = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '5': [0, 7],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], '7sus4': [0, 5, 7, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14],
};
const Q_ALIAS = {
  maj: '', M: '', major: '', min: 'm', minor: 'm', '-': 'm', mi: 'm', o: 'dim', '°': 'dim', 'ø': 'm7b5', 'ø7': 'm7b5',
  o7: 'dim7', '°7': 'dim7', '+': 'aug', M7: 'maj7', Maj7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', min7: 'm7', '-7': 'm7',
  mi7: 'm7', sus: 'sus4', dom7: '7', add2: 'add9', '2': 'sus2', m7b5: 'm7b5',
};
function normQ(q) { if (q in CHORD_TYPES) return q; if (q in Q_ALIAS) return Q_ALIAS[q]; return null; }
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pcFromName(letter, acc) {
  let v = NOTE_PC[letter.toUpperCase()];
  if (acc === '#' || acc === '♯') v++;
  else if (acc === 'b' || acc === '♭') v--;
  return pc(v);
}
function makeChord(root, q, bass) { return { root: pc(root), q, iv: CHORD_TYPES[q].slice(), bass: bass == null ? null : pc(bass) }; }
function chordName(c) { if (!c) return 'N.C.'; return NOTE_NAMES[c.root] + c.q + (c.bass != null && c.bass !== c.root ? '/' + NOTE_NAMES[c.bass] : ''); }
function chordPcs(c) { return c.iv.map(i => pc(c.root + i)); }
function chordHas(c, p) { return chordPcs(c).includes(pc(p)); }
function chordsEqual(a, b) { return !!(a && b && a.root === b.root && a.q === b.q); }

function parseChordSymbol(tok) {
  const m = tok.match(/^([A-Ga-g])([#b♯♭]?)([^/]*)(?:\/([A-Ga-g])([#b♯♭]?))?$/);
  if (!m) return null;
  const q = normQ(m[3]);
  if (q == null) return null;
  return makeChord(pcFromName(m[1], m[2]), q, m[4] ? pcFromName(m[4], m[5]) : null);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// Roman numerals use the key's own scale; with an explicit accidental (bVII, #iv) they are read
// against the major scale, so both "i VI VII" and "i bVI bVII" mean the same thing in a minor key.
function parseRoman(tok, keyRoot, scaleName) {
  const m = tok.match(/^([b#♭♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)([^/]*)$/);
  if (!m) return null;
  const num = m[2], suf = m[3], lower = num === num.toLowerCase();
  const deg = ROMAN.indexOf(num.toUpperCase());
  const base = m[1] ? SCALES.major.iv : heptaOf(scaleName);
  const acc = m[1] === 'b' || m[1] === '♭' ? -1 : m[1] ? 1 : 0;
  const root = keyRoot + base[deg] + acc;
  let q;
  if (['°', 'o', 'dim'].includes(suf)) q = 'dim';
  else if (['°7', 'o7', 'dim7'].includes(suf)) q = 'dim7';
  else if (['ø', 'ø7', 'm7b5'].includes(suf)) q = 'm7b5';
  else if (['+', 'aug'].includes(suf)) q = 'aug';
  else if (suf === '') q = lower ? 'm' : '';
  else if (suf === '7') q = lower ? 'm7' : '7';
  else if (['maj7', 'M7', 'Δ', 'Δ7'].includes(suf)) q = 'maj7';
  else if (suf === '6') q = lower ? 'm6' : '6';
  else if (suf === '9') q = lower ? 'm9' : '9';
  else if (suf === 'add9') q = lower ? 'madd9' : 'add9';
  else if (['sus2', 'sus4', 'sus', '5', '7sus4'].includes(suf)) q = normQ(suf);
  else return null;
  return makeChord(root, q, null);
}

// "C G Am F", "I V vi IV", "Am:2 F G" (":2" = two chord lengths), "%" repeats, "N.C." rests.
function parseProgression(text, keyRoot, scaleName) {
  const items = [], errors = [];
  const toks = String(text).replace(/[–—]/g, ' ').split(/[\s,|]+/).filter(t => t && t !== '-');
  for (let tok of toks) {
    let len = 1;
    const mm = tok.match(/^(.+?)[:*](\d+(?:\.\d+)?)$/);
    if (mm) { tok = mm[1]; len = parseFloat(mm[2]) || 1; }
    if (tok === '%' || tok === '.' || tok === '/') { if (items.length) items[items.length - 1].len += len; continue; }
    if (/^(n\.?c\.?|_|x|rest)$/i.test(tok)) { items.push({ chord: null, len }); continue; }
    const c = parseRoman(tok, keyRoot, scaleName) || parseChordSymbol(tok);
    if (!c) { errors.push(tok); continue; }
    items.push({ chord: c, len });
  }
  return { items, errors };
}

function romanOf(c, keyRoot, scaleName) {
  if (!c) return '–';
  const rel = pc(c.root - keyRoot);
  const sc = heptaOf(scaleName);
  let deg = sc.indexOf(rel), acc = '';
  if (deg < 0) {
    deg = SCALES.major.iv.indexOf(pc(rel + 1));
    acc = 'b';
    if (deg < 0) { deg = SCALES.major.iv.indexOf(pc(rel - 1)); acc = '#'; }
  }
  if (deg < 0) return chordName(c);
  const minorQ = ['m', 'm7', 'm6', 'm9', 'madd9', 'dim', 'dim7', 'm7b5'].includes(c.q);
  let r = ROMAN[deg];
  if (minorQ) r = r.toLowerCase();
  const suf = { dim: '°', dim7: '°7', m7b5: 'ø', aug: '+', '7': '7', m7: '7', maj7: 'maj7', '6': '6', m6: '6', sus2: 'sus2', sus4: 'sus4' }[c.q] || '';
  return acc + r + suf;
}

// Close voicing near `center`, choosing the inversion that moves least from `prev`.
function voiceChord(ch, center, prev) {
  center = center || 62;
  const ivs = [];
  for (const i of ch.iv) { const v = pc(i); if (!ivs.includes(v)) ivs.push(v); }
  const use = ivs.slice(0, 4);
  let best = null, bs = 1e9;
  for (let inv = 0; inv < use.length; inv++) {
    for (let base = center - 13; base <= center + 2; base++) {
      if (pc(base) !== pc(ch.root + use[inv])) continue;
      const notes = [base];
      let last = base;
      for (let k = 1; k < use.length; k++) {
        const want = pc(ch.root + use[(inv + k) % use.length]);
        let p = last + 1;
        while (pc(p) !== want) p++;
        notes.push(p);
        last = p;
      }
      let s;
      if (prev && prev.length) {
        s = 0;
        for (const n of notes) { let m = 99; for (const q of prev) m = Math.min(m, Math.abs(n - q)); s += m; }
        s += Math.abs(notes.reduce((a, b) => a + b, 0) / notes.length - center) * 0.35;
      } else s = Math.abs(notes.reduce((a, b) => a + b, 0) / notes.length - center);
      if (s < bs) { bs = s; best = notes; }
    }
  }
  return best || [center];
}
function bassPitch(ch, low) {
  low = low == null ? 36 : low;
  const b = ch.bass != null ? ch.bass : ch.root;
  let p = low;
  while (pc(p) !== b) p++;
  return p;
}

// Krumhansl-Schmuckler key finding.
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function detectKey(hist) {
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b);
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? n / Math.sqrt(da * db) : 0;
  };
  let best = { root: 0, scale: 'major', score: -2 };
  for (let r = 0; r < 12; r++) {
    for (const [prof, sc] of [[KS_MAJ, 'major'], [KS_MIN, 'minor']]) {
      const rot = [];
      for (let i = 0; i < 12; i++) rot.push(prof[pc(i - r)]);
      const s = corr(hist, rot);
      if (s > best.score) best = { root: r, scale: sc, score: s };
    }
  }
  return best;
}

const DETECT_Q = ['', 'm', 'dim', '7', 'm7', 'maj7', 'sus4', 'sus2'];
function detectChord(w, bassPc, keyRoot, scaleName) {
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 1e-6) return null;
  const sc = scalePcs(keyRoot, scaleName);
  let best = null, bs = -1e9;
  for (let r = 0; r < 12; r++) {
    for (const q of DETECT_Q) {
      const tones = CHORD_TYPES[q].map(i => pc(r + i));
      let inW = 0;
      for (const t of tones) inW += w[t];
      let s = inW - 0.7 * (total - inW);
      for (const t of tones) if (w[t] < total * 0.04) s -= total * 0.18;
      if (tones.length > 3) s -= total * 0.08;
      if (q.startsWith('sus')) s -= total * 0.06;
      if (bassPc === r) s += total * 0.2;
      if (tones.every(t => sc.includes(t))) s += total * 0.06;
      if (s > bs) { bs = s; best = makeChord(r, q, null); }
    }
  }
  return best;
}

// Scale-step arithmetic so melodies can be moved "diatonically".
function toScaleIdx(p, keyRoot, iv) {
  const rel = p - keyRoot, oct = Math.floor(rel / 12), r = pc(rel);
  let d = 0;
  for (let i = 0; i < iv.length; i++) if (iv[i] <= r) d = i;
  return { idx: oct * iv.length + d, chrom: r - iv[d] };
}
function fromScaleIdx(idx, chrom, keyRoot, iv) {
  const n = iv.length, oct = Math.floor(idx / n), d = ((idx % n) + n) % n;
  return keyRoot + oct * 12 + iv[d] + (chrom || 0);
}
function shiftInScale(p, steps, keyRoot, iv) { return fromScaleIdx(toScaleIdx(p, keyRoot, iv).idx + steps, 0, keyRoot, iv); }
function snapToScale(p, keyRoot, iv) {
  const sc = iv.map(i => pc(i + keyRoot));
  if (sc.includes(pc(p))) return p;
  for (let k = 1; k < 6; k++) { if (sc.includes(pc(p - k))) return p - k; if (sc.includes(pc(p + k))) return p + k; }
  return p;
}
function nearestChordTone(p, ch) {
  const pcs = chordPcs(ch);
  let best = p, bd = 99;
  for (let d = -7; d <= 7; d++) if (pcs.includes(pc(p + d)) && Math.abs(d) < bd) { bd = Math.abs(d); best = p + d; }
  return best;
}

// Move a note written against `src` so it plays the same role against `tgt`:
// chord tones map to the matching chord tone, everything else moves diatonically with the root.
function mapPitchToChord(p, src, tgt, keyRoot, iv) {
  if (!src || !tgt || chordsEqual(src, tgt)) return p;
  const rel = pc(p - src.root);
  const k = src.iv.map(pc).indexOf(rel);
  if (k >= 0) {
    const want = pc(tgt.root + tgt.iv[Math.min(k, tgt.iv.length - 1)]);
    let best = p, bd = 99;
    for (let d = -6; d <= 6; d++) if (pc(p + d) === want && Math.abs(d) < bd) { bd = Math.abs(d); best = p + d; }
    return best;
  }
  const n = iv.length;
  const rs = toScaleIdx(src.root + 60, keyRoot, iv).idx, rt = toScaleIdx(tgt.root + 60, keyRoot, iv).idx;
  let sh = (((rt - rs) % n) + n) % n;
  if (sh > n / 2) sh -= n;
  return shiftInScale(p, sh, keyRoot, iv);
}
